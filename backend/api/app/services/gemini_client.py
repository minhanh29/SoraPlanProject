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

            if self.settings.GEMINI_API_KEY:
                self._client = genai.Client(api_key=self.settings.GEMINI_API_KEY)
            else:
                self._client = genai.Client(
                    vertexai=True,
                    project=self.settings.FIREBASE_PROJECT_ID,
                    location=self.settings.GEMINI_LOCATION,
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
                if emitted or not _is_retryable(e):
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
        config = types.GenerateContentConfig(response_modalities=["IMAGE"], image_config=types.ImageConfig(aspect_ratio="1:1"))
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
    return any(s in text for s in ("unavailable", "deadline", "resource exhausted", "timeout", "temporarily"))
