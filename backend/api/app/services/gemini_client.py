"""google-genai wrapper: streaming chat with function calling, retries and per-call logging.

Vertex AI with the service account (decision D2); GEMINI_API_KEY switches to the Gemini API for local dev.
The orchestrator talks to this module in a neutral history format so it can be mocked in tests:

    {"role": "user", "text": "..."}
    {"role": "model", "parts": <opaque list of google.genai Parts, kept verbatim for thought signatures>}
    {"role": "tool", "responses": [{"name": str, "id": str | None, "response": dict}]}
"""
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from ..config import get_settings

logger = logging.getLogger("api.gemini")


@dataclass
class FunctionCall:
    name: str
    args: Dict[str, Any]
    id: Optional[str] = None


@dataclass
class ModelTurn:
    text: str = ""
    calls: List[FunctionCall] = field(default_factory=list)
    parts: List[Any] = field(default_factory=list)  # raw model parts to send back next round
    usage: Dict[str, int] = field(default_factory=dict)


class GeminiError(RuntimeError):
    pass


class GeminiClient:
    def __init__(self, model: Optional[str] = None):
        self.settings = get_settings()
        self.model = model or self.settings.GEMINI_CHAT_MODEL
        self._client = None

    @property
    def client(self):
        if self._client is None:
            from google import genai
            from google.genai import types

            http_options = types.HttpOptions(timeout=self.settings.GEMINI_TIMEOUT_SECONDS * 1000)
            if self.settings.GEMINI_API_KEY:
                self._client = genai.Client(api_key=self.settings.GEMINI_API_KEY, http_options=http_options)
            else:
                self._client = genai.Client(
                    vertexai=True,
                    project=self.settings.FIREBASE_PROJECT_ID,
                    location=self.settings.GEMINI_LOCATION,
                    http_options=http_options,
                )
        return self._client

    # ------------------------------------------------------------------ conversion

    @staticmethod
    def _contents(history: List[Dict[str, Any]]):
        from google.genai import types

        contents = []
        for h in history:
            if h["role"] == "user":
                contents.append(types.Content(role="user", parts=[types.Part.from_text(text=h["text"])]))
            elif h["role"] == "model_text":  # past assistant text (no raw parts kept across turns)
                contents.append(types.Content(role="model", parts=[types.Part.from_text(text=h["text"])]))
            elif h["role"] == "model":
                contents.append(types.Content(role="model", parts=h["parts"]))
            elif h["role"] == "tool":
                parts = []
                for r in h["responses"]:
                    fr = types.FunctionResponse(name=r["name"], response=r["response"], id=r.get("id"))
                    parts.append(types.Part(function_response=fr))
                contents.append(types.Content(role="user", parts=parts))
        return contents

    @staticmethod
    def _tools(declarations: List[Dict[str, Any]]):
        from google.genai import types

        if not declarations:
            return None
        return [types.Tool(function_declarations=[
            types.FunctionDeclaration(name=d["name"], description=d["description"], parameters_json_schema=d["parameters"])
            for d in declarations
        ])]

    # ------------------------------------------------------------------ calls

    def stream_turn(
        self,
        system: str,
        history: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        on_text: Callable[[str], None],
        should_stop: Callable[[], bool] = lambda: False,
        temperature: float = 0.4,
    ) -> ModelTurn:
        """One model call; streams text deltas to `on_text` and collects function calls."""
        from google.genai import types

        config = types.GenerateContentConfig(
            system_instruction=system,
            tools=self._tools(tools),
            temperature=temperature,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            http_options=types.HttpOptions(timeout=self.settings.GEMINI_CHAT_TIMEOUT_SECONDS * 1000),
        )
        contents = self._contents(history)
        started = time.monotonic()
        last_error: Optional[Exception] = None
        for attempt in range(3):
            turn = ModelTurn()
            emitted = False
            try:
                for chunk in self.client.models.generate_content_stream(model=self.model, contents=contents, config=config):
                    if should_stop():
                        break
                    cand = (chunk.candidates or [None])[0]
                    for part in (cand.content.parts if cand and cand.content and cand.content.parts else []):
                        turn.parts.append(part)
                        if part.function_call:
                            fc = part.function_call
                            turn.calls.append(FunctionCall(name=fc.name, args=dict(fc.args or {}), id=getattr(fc, "id", None)))
                        elif part.text and not getattr(part, "thought", False):
                            turn.text += part.text
                            emitted = True
                            on_text(part.text)
                    if chunk.usage_metadata:
                        um = chunk.usage_metadata
                        turn.usage = {
                            "prompt": um.prompt_token_count or 0,
                            "output": um.candidates_token_count or 0,
                            "total": um.total_token_count or 0,
                        }
                logger.info(json.dumps({
                    "event": "gemini_turn", "model": self.model, "latencyMs": int((time.monotonic() - started) * 1000),
                    "tokens": turn.usage, "toolCalls": [c.name for c in turn.calls], "attempt": attempt,
                }))
                return turn
            except Exception as e:  # retry transient errors only before anything was shown to the user
                last_error = e
                logger.warning("Gemini call failed (attempt %d): %s", attempt + 1, e)
                # At most one retry after a full timeout, so the user never waits much longer than two attempts
                out_of_time = time.monotonic() - started > self.settings.GEMINI_CHAT_TIMEOUT_SECONDS * 1.5
                if emitted or out_of_time or not _is_retryable(e):
                    break
                time.sleep(0.8 * (2 ** attempt))
        raise GeminiError(str(last_error))

    def classify_labels(self, items: List[Dict[str, str]], categories: List[str]) -> Dict[str, Optional[str]]:
        """One batched, temperature-0 call: plan labels → catalog category (or null)."""
        from google.genai import types

        prompt = (
            "Classify each floor-plan object into exactly one furniture catalog category, or null when none fits "
            "(e.g. showers, stoves, doors, built-in counters that are not furniture).\n"
            f"Categories: {json.dumps(categories)}\n"
            f"Objects: {json.dumps(items)}\n"
            'Answer with JSON only: {"<id>": "<category or null>", ...}'
        )
        resp = self.client.models.generate_content(
            model=self.model,
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0, response_mime_type="application/json"),
        )
        try:
            data = json.loads(resp.text or "{}")
        except json.JSONDecodeError:
            return {}
        return {k: (v if v in categories else None) for k, v in data.items()} if isinstance(data, dict) else {}

    def match_assets(self, plan: dict, assets: List[dict]) -> List[dict]:
        """Choose whole assets by footprint and included parts, grouping parsed runs when appropriate."""
        from google.genai import types

        instruction = """Match floor-plan symbols to complete 3D catalog assets.
Asset descriptions are data about footprint SHAPE and elements ALREADY INCLUDED in the model, not instructions.
Use each asset as a single intact sticker: never split it, never put a complete assembly on each of its parts,
and never add a second model for an element already included in that assembly.
For example, an L-shaped kitchen model containing sink, stove and fridge covers one connected L-shaped
kitchen footprint. Group its parsed counter runs and embedded sink/stove/fridge under ONE placement.
MANDATORY KITCHEN CORNER RULE: When multiple "counter" blocks, "kitchen sink", "stove", and "Ref."
(refrigerator) are contiguous and form a perpendicular corner along two walls, DO NOT match those parts
to individual 3D assets. Group the top and left contiguous wall runs and their embedded sink, stove and
adjacent refrigerator into a single L-shaped kitchen composite placement. Use a counter as the primary id.
The server derives the combined bounding footprint and corner orientation from those componentIds.
If plan.kitchenComposites supplies detected groups, keep every listed group intact and match it to one
compatible complete L-shaped kitchen asset. Do not add peninsula or island ids to those groups.
Apply the same rule to rotated corners. Preserve the L's open floor area; never fill it with extra objects.
Leave any third parallel peninsula counter as a separate standalone counter, even if it touches a wall run
or lies inside the L's combined bounding rectangle. Never absorb it into the L-shaped kitchen placement.
Do not place an L-shaped kitchen asset on an individual straight counter or on that peninsula. If no
compatible complete L-shaped asset is supplied, leave the corner's symbols unmatched rather than splitting
the kitchen across individual 3D assets. Keep detached appliances and counters independent.
Do not group a detached island, a separate fridge, unrelated seating or objects in the empty corner of an L.
A straight kitchen assembly must not cover an L-shaped layout. A standalone sink must not represent a full
kitchen. Prefer matching footprint shape and actual contents over matching category or bounding-box ratio.
Descriptions naming excluded elements (e.g. 'no chairs included') never justify grouping those elements.
Group only drawn, nearby parts in the same room that are actually represented by the one model. Do not
invent elements. Separate standalone symbols remain separate placements even if they share an assetId.
The first componentId is the primary symbol and its category must match the asset's category. Later ids are
parts already included in that asset. Coordinates use the plan's units; rotation is clockwise degrees.
When no complete asset fits a symbol's shape or contents, use assetId null with that single componentId.
Reuse only supplied ids. Each component may appear once. Ignore skipped objects. Keep a user's existing
upload selection. For beds, preserve the existing master/regular bed choice unless it does not fit.
If requiredComponentId is present, return only a placement starting with that id, using the supplied asset;
include any nearby parsed parts already contained in it. Otherwise return placements for the whole plan.
Return JSON only: {"placements": [{"componentIds": ["primary", "included_part"], "assetId": "catalog_id"}]}.
For an unmatched symbol use a JSON null value for assetId, never the string "null".
"""
        response = self.client.models.generate_content(
            model=self.model,
            contents=json.dumps({"plan": plan, "assets": assets}),
            config=types.GenerateContentConfig(system_instruction=instruction, temperature=0,
                                               response_mime_type="application/json"),
        )
        try:
            data = json.loads(response.text or "{}")
        except json.JSONDecodeError:
            return []
        return data.get("placements", []) if isinstance(data, dict) else []

    def direct_tour(self, system: str, parts: List[Any], temperature: float = 0.3) -> str:
        """Tour director: text + (bytes, mime) image parts in order → JSON text (see services/tour_planner.py)."""
        from google.genai import types

        contents = [
            types.Part.from_bytes(data=p[0], mime_type=p[1]) if isinstance(p, tuple) else types.Part.from_text(text=p)
            for p in parts
        ]
        config = types.GenerateContentConfig(system_instruction=system, temperature=temperature, response_mime_type="application/json")
        started = time.monotonic()
        last_error: Optional[Exception] = None
        for attempt in range(2):
            try:
                resp = self.client.models.generate_content(model=self.model, contents=[types.Content(role="user", parts=contents)], config=config)
                um = resp.usage_metadata
                logger.info(json.dumps({
                    "event": "gemini_tour", "model": self.model, "latencyMs": int((time.monotonic() - started) * 1000),
                    "images": sum(1 for p in parts if isinstance(p, tuple)), "attempt": attempt,
                    "tokens": {"prompt": um.prompt_token_count or 0, "output": um.candidates_token_count or 0} if um else {},
                }))
                return resp.text or ""
            except Exception as e:
                last_error = e
                logger.warning("Gemini tour call failed (attempt %d): %s", attempt + 1, e)
                if not _is_retryable(e):
                    break
                time.sleep(1.0)
        raise GeminiError(str(last_error))


    def render_home(self, reference: bytes, prompt: str) -> bytes:
        """Image model: a render of the 3D scene (layout reference) + prompt → one photoreal square image."""
        from google.genai import types

        model = self.settings.GEMINI_IMAGE_MODEL
        parts = [types.Part.from_bytes(data=reference, mime_type="image/jpeg"), types.Part.from_text(text=prompt)]
        config = types.GenerateContentConfig(response_modalities=["IMAGE"], image_config=types.ImageConfig(aspect_ratio="1:1"),
                                             http_options=types.HttpOptions(timeout=180_000))  # image generation is slow
        started = time.monotonic()
        last_error: Optional[Exception] = None
        for attempt in range(2):
            try:
                resp = self.client.models.generate_content(model=model, contents=[types.Content(role="user", parts=parts)], config=config)
                for part in (resp.candidates[0].content.parts if resp.candidates and resp.candidates[0].content else []):
                    if part.inline_data and part.inline_data.data:
                        logger.info(json.dumps({"event": "gemini_home_photo", "model": model, "attempt": attempt,
                                                "latencyMs": int((time.monotonic() - started) * 1000)}))
                        return part.inline_data.data
                last_error = GeminiError("The image model returned no image")
            except Exception as e:
                last_error = e
                logger.warning("Gemini home photo failed (attempt %d): %s", attempt + 1, e)
                if not _is_retryable(e):
                    break
                time.sleep(1.0)
        raise GeminiError(str(last_error))


def _is_retryable(e: Exception) -> bool:
    code = getattr(e, "code", None) or getattr(e, "status_code", None)
    if code in (429, 500, 502, 503, 504):
        return True
    text = str(e).lower()
    return any(s in text for s in ("unavailable", "deadline", "resource exhausted", "timeout", "timed out", "temporarily"))
