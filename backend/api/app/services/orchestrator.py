"""Chat orchestrator: one user turn = Gemini + tool loop, streamed into a message doc.

Context each turn (docs/10-chat-refactor-plan.md §5.3): system prompt with the current stage and what
the user is expected to do, the tools allowed in that stage, a compact project summary with stable ids,
and the last N messages (text only).
"""
import logging
import math
import re
import time
from typing import Any, Dict, List, Optional

from ..config import get_settings
from ..errors import AppException
from .common import get_owned
from .gemini_client import GeminiClient, GeminiError
from .geometry import plan_scale
from .tools import ToolContext, run_tool, tools_for_stage, TOOLS
from .workflow import Ctx, Workflow

logger = logging.getLogger("api.orchestrator")

FLUSH_SECONDS = 0.25
YES = re.compile(
    r"^\s*(yes|yeah|yep|yup|sure|ok|okay|confirm(ed)?|do it|go ahead|please do|correct|absolutely|of course|y)\b",
    re.I,
)

STAGE_GUIDE = {
    "uploading": "The upload is still finishing. Tell the user to wait a moment.",
    "cropping": "The user must crop the floor plan tightly around the drawing (handles on the canvas), then press "
                "'Confirm crop' or tell you it's done (call confirm_crop). A tight crop gives the plan reader the "
                "right scale and fewer stray marks.",
    "parsing": "The plan is being read (about a minute). Nothing to do; answer questions while waiting.",
    "reviewing_plan": "The user checks the 2D plan on the canvas and can fix walls, boxes and labels, or add boxes "
                      "with 'Add box'. When they say it looks right, call confirm_plan.",
    "choosing_style": "The user picks an interior style: Industrial (concrete, dark oak, steel) or Japandi (warm "
                      "white, light oak, sage). Call select_style when they choose.",
    "resolving_missing": "Catalog models were placed in the plan boxes. Highlighted boxes have no model: the user can "
                         "upload a photo for one (it becomes 3D in a few minutes), skip it, or rescale placed models. "
                         "Call skip_missing to skip, scale_mapped_item to rescale.",
    "scene_ready": "The 3D home is built. The user edits by dragging in 3D or by asking you. Use the item and room "
                   "ids from the summary. After changes say briefly what you did.",
}

SYSTEM_PROMPT = """You are SoraPlan's architect assistant. SoraPlan turns a floor-plan sketch into a real-scale 3D home.
Flow: crop the upload → the plan is read → the user reviews the 2D plan → picks a style → missing objects are resolved → 3D home.

Rules:
- Be brief and friendly: 1–3 short sentences unless the user asks for detail. Plain language, no internal ids in replies.
- When the user asks for something a tool can do in this stage, call the tool instead of describing it.
- Only use ids that appear in the project summary or in tool results. Never invent ids; call find_assets to get asset ids.
- Tool sizes and distances are in meters. Talk to the user in their units ({units}).
- Before destructive changes (removing items, re-cropping, changing the style or editing the plan after the 3D scene exists) ask the user to confirm and wait for an explicit yes. Then call the tool.
- If a tool returns an error, explain it simply and suggest what to do.
- Search the library at most twice per request. If nothing fits (e.g. the only match is already in the scene, inScene: true),
  say so and suggest uploading a photo of the piece they want; it becomes a 3D model in a few minutes.
- Answer general questions (why crop, how scale works, design advice) without changing anything.

Current stage: {stage}
What happens now: {guide}

Project summary:
{summary}
"""


def _fmt(v: float) -> str:
    return f"{v:.2f}"


class Orchestrator:
    def __init__(self, workflow: Workflow, gemini: Optional[GeminiClient] = None):
        self.workflow = workflow
        self.conversations = workflow.conversations
        self.gemini = gemini or GeminiClient()
        self.settings = get_settings()

    # ------------------------------------------------------------------ summary

    def project_summary(self, conv: dict, project: dict) -> str:
        lines: List[str] = [f"- Title: {conv.get('title')}"]
        plan = project.get("floorPlan") or {}
        if plan:
            k = plan_scale(plan)
            lines.append(f"- Plan: {plan.get('width', 0) * k:.1f} m × {plan.get('height', 0) * k:.1f} m (drawn in {plan.get('units')}), "
                         f"{len(plan.get('walls') or [])} walls, {len(plan.get('furniture') or []) + len(plan.get('fixtures') or [])} objects")
        if project.get("style"):
            lines.append(f"- Style: {project['style']}")
        stage = conv.get("stage")
        if stage == "resolving_missing":
            lines.append("- Plan objects (componentId · label · category · model · W×D×H m):")
            for cid, e in (project.get("mapping") or {}).items():
                status = "skipped" if e.get("skipped") else ("MISSING" if not e.get("assetId") else e["assetId"])
                d = e.get("dims")
                size = f"{_fmt(d['w'])}×{_fmt(d['d'])}×{_fmt(d['h'])}" if d else "-"
                lines.append(f"  {cid} · {e.get('label')} · {e.get('category') or '?'} · {status} · {size}")
        if stage == "scene_ready":
            scene = self.workflow.scenes.get_optional(project["id"])
            if scene:
                level = scene["graph"]["levels"][0]
                meta = scene["graph"]["meta"]
                lines.append(f"- Colors: walls {meta['palette']['wall']}, floors {meta['palette']['floor']}")
                lines.append("- Rooms (roomId · name · area):")
                for r in level.get("rooms") or []:
                    lines.append(f"  {r['id']} · {r['name']} · {r['area']} m²")
                lines.append("- Items (itemId · label · category · room · position x,z m · W×D×H m · rotation°):")
                rooms = {r["id"]: r["name"] for r in level.get("rooms") or []}
                for it in level.get("items") or []:
                    d = it["dims"]
                    lines.append(
                        f"  {it['id']} · {it['label']} · {it.get('category') or '?'} · {rooms.get(it.get('roomId'), '-')} · "
                        f"{_fmt(it['position'][0])},{_fmt(it['position'][2])} · {_fmt(d['w'])}×{_fmt(d['d'])}×{_fmt(d['h'])} · "
                        f"{round(-math.degrees(it['rotationY'])) % 360}"
                    )
                b = meta["bounds"]
                lines.append(f"- Bounds: x {_fmt(b['minX'])}..{_fmt(b['maxX'])}, z {_fmt(b['minZ'])}..{_fmt(b['maxZ'])} (x right, z down on the plan)")
        return "\n".join(lines)

    @staticmethod
    def _history(messages: List[dict]) -> List[Dict[str, Any]]:
        """Last messages as text turns; cards become short system notes."""
        out: List[Dict[str, Any]] = []
        for m in messages:
            kind, role = m.get("kind"), m.get("role")
            if kind == "text" and m.get("text"):
                out.append({"role": "user" if role == "user" else "model_text", "text": m["text"]})
            elif kind and kind != "text":
                note = f"[app event: {kind}]"
                payload = m.get("payload") or {}
                if kind == "plan_ready" and payload.get("stats"):
                    note = f"[app event: plan_ready {payload['stats']}]"
                elif kind == "mapping_result":
                    note = f"[app event: mapping_result matched={payload.get('matched')} missing={len(payload.get('missing') or [])}]"
                elif kind == "scene_change":
                    note = f"[app event: scene_change {payload.get('summary')}{' (undone)' if payload.get('undone') else ''}]"
                elif kind == "plan_failed":
                    note = f"[app event: plan_failed {payload.get('error', '')[:120]}]"
                out.append({"role": "model_text", "text": note})
        # Gemini wants alternating turns starting with the user: merge neighbours with the same role
        merged: List[Dict[str, Any]] = []
        for h in out:
            if merged and merged[-1]["role"] == h["role"]:
                merged[-1] = {**merged[-1], "text": merged[-1]["text"] + "\n" + h["text"]}
            else:
                merged.append(h)
        while merged and merged[0]["role"] != "user":
            merged.pop(0)
        return merged

    # ------------------------------------------------------------------ turns

    def handle_user_text(self, conversation_id: str, uid: str, text: str) -> str:
        conv = self.conversations.get(conversation_id, uid)
        if conv.get("busy") and conv.get("busyReason") == "gemini":
            raise AppException(status_code=409, code="BUSY", detail="Still answering the previous message")
        user_confirmed = bool(YES.match(text))
        self.conversations.append_message(conversation_id, "user", "text", text=text.strip())
        self.conversations.set_busy(conversation_id, True, "gemini")
        msg_id = self.conversations.append_message(conversation_id, "assistant", "text", text="", status="streaming")
        ctx = Ctx(uid=uid, conversation_id=conversation_id, source="agent", user_confirmed=user_confirmed)

        streamed = ""
        last_flush = 0.0
        tool_log: List[Dict[str, Any]] = []
        batch_ids: List[str] = []
        summaries: List[str] = []

        def on_text(delta: str) -> None:
            nonlocal streamed, last_flush
            streamed += delta
            now = time.monotonic()
            if now - last_flush >= FLUSH_SECONDS:
                last_flush = now
                self.conversations.update_message(conversation_id, msg_id, text=streamed)

        cancel_checked = 0.0

        def should_stop() -> bool:
            nonlocal cancel_checked
            now = time.monotonic()
            if now - cancel_checked < FLUSH_SECONDS:
                return False
            cancel_checked = now
            return self.conversations.is_cancel_requested(conversation_id)

        try:
            history = self._history(self.conversations.recent_messages(conversation_id, self.settings.CHAT_HISTORY_MESSAGES))
            stopped = False
            for _round in range(self.settings.CHAT_MAX_TOOL_ROUNDS + 1):
                conv = self.conversations.get(conversation_id, uid)
                project = get_owned(self.workflow.db, "projects", conv["projectId"], uid)
                stage = conv.get("stage", "cropping")
                units = (project.get("floorPlan") or {}).get("units") or "m"
                system = SYSTEM_PROMPT.format(
                    units="feet and inches" if units == "ft" else "meters and centimeters",
                    stage=stage,
                    guide=STAGE_GUIDE.get(stage, ""),
                    summary=self.project_summary(conv, project),
                )
                tools = [t.declaration() for t in tools_for_stage(stage)] if _round < self.settings.CHAT_MAX_TOOL_ROUNDS else []
                if streamed and not streamed.endswith(("\n", " ")):
                    on_text("\n\n")
                turn = self.gemini.stream_turn(system, history, tools, on_text, should_stop)
                if should_stop() or self.conversations.is_cancel_requested(conversation_id):
                    stopped = True
                    break
                if not turn.calls:
                    break
                history.append({"role": "model", "parts": turn.parts})
                responses = []
                for call in turn.calls:
                    tctx = ToolContext(ctx=ctx, workflow=self.workflow, stage=stage)
                    try:
                        res = run_tool(call.name, call.args, tctx)
                        result: Dict[str, Any] = {"ok": True, **res.data}
                        if res.batch_id:
                            batch_ids.append(res.batch_id)
                            summaries.append(res.summary or call.name)
                        # A stage change: later calls in this round see the new stage
                        stage = self.conversations.get(conversation_id, uid).get("stage", stage)
                    except AppException as e:
                        result = {"ok": False, "error": e.code, "message": e.detail}
                    except Exception as e:  # never let a tool crash the turn
                        logger.exception("Tool %s crashed", call.name)
                        result = {"ok": False, "error": "TOOL_FAILED", "message": str(e)}
                    tool_log.append({"name": call.name, "args": call.args, "result": result})
                    responses.append({"name": call.name, "id": call.id, "response": result})
                history.append({"role": "tool", "responses": responses})

            final = streamed.strip()
            if not final:
                final = "Stopped." if stopped else ("Done — " + "; ".join(summaries) + "." if summaries else (
                    "Sorry, I couldn't finish that. Could you say it another way?" if tool_log else "Okay."))
            self.conversations.update_message(conversation_id, msg_id, text=final, status="done",
                                              **({"toolCalls": tool_log} if tool_log else {}))
            self.conversations.update(conversation_id, lastMessagePreview=final[:140])
            if batch_ids:
                self.conversations.append_message(
                    conversation_id, "assistant", "scene_change",
                    payload={"batchId": batch_ids[-1], "batchIds": batch_ids, "summary": "; ".join(summaries)},
                )
            logger.info("Turn %s: %d tool calls, %d scene batches", conversation_id, len(tool_log), len(batch_ids))
        except GeminiError as e:
            logger.error("Gemini failed for %s: %s", conversation_id, e)
            self.conversations.update_message(conversation_id, msg_id, text=streamed or "", status="error")
            self.conversations.append_message(conversation_id, "system", "error",
                                              payload={"code": "GEMINI_ERROR", "message": "The assistant is unavailable right now. Try again in a moment."})
        except Exception as e:
            logger.exception("Turn failed for %s", conversation_id)
            self.conversations.update_message(conversation_id, msg_id, text=streamed or "", status="error")
            self.conversations.append_message(conversation_id, "system", "error",
                                              payload={"code": "TURN_FAILED", "message": str(e)[:300]})
        finally:
            # A tool may have handed the chat to a longer step (e.g. parsing): only clear our own flag
            latest = self.conversations.get(conversation_id, uid)
            if latest.get("busyReason") in ("gemini", None):
                self.conversations.set_busy(conversation_id, False)
        return msg_id

    def handle_action(self, conversation_id: str, uid: str, action: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """UI buttons: same handlers as the tools, confirmation happens in the page."""
        conv = self.conversations.get(conversation_id, uid)
        if conv.get("busy") and conv.get("busyReason") in ("gemini", "mapping", "building"):
            raise AppException(status_code=409, code="BUSY", detail="Please wait for the current step to finish")
        if action not in TOOLS:
            raise AppException(status_code=400, code="UNKNOWN_ACTION", detail=f"Unknown action '{action}'")
        ctx = Ctx(uid=uid, conversation_id=conversation_id, source="ui", user_confirmed=True)
        tctx = ToolContext(ctx=ctx, workflow=self.workflow, stage=conv.get("stage", ""))
        res = run_tool(action, args, tctx)
        if action == "undo_last_change" and args.get("batchIds"):
            if not res.data.get("undone"):
                raise AppException(status_code=409, code="HISTORY_CONFLICT",
                                   detail="Newer changes were made since; use Undo in the 3D view instead")
            if args.get("messageId"):
                self.conversations.update_message(conversation_id, args["messageId"], **{"payload.undone": True})
        return res.data
