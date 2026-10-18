"""GeminiClient retry rules (no network: the SDK client is replaced by a stub)."""
import pytest

from app.services import gemini_client as gc
from app.services.gemini_client import GeminiClient, GeminiError


class _Chunk:
    usage_metadata = None

    def __init__(self, text):
        from google.genai import types

        self.candidates = [types.Candidate(content=types.Content(role="model", parts=[types.Part.from_text(text=text)]))]


def _client(attempts, clock):
    """attempts: list of exceptions or reply texts, consumed one per call; each failure advances the clock."""
    calls = []

    class Models:
        def generate_content_stream(self, model, contents, config):
            calls.append(config.http_options.timeout)
            step = attempts.pop(0)
            if isinstance(step, Exception):
                clock["t"] += step.args[1] if len(step.args) > 1 else 0.1
                raise step
            yield _Chunk(step)

    c = GeminiClient(model="m")
    c._client = type("C", (), {"models": Models()})()
    return c, calls


@pytest.fixture
def clock(monkeypatch):
    clock = {"t": 0.0}
    monkeypatch.setattr(gc.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(gc.time, "sleep", lambda s: None)
    return clock


def test_chat_turn_has_a_timeout_and_retries_once_after_a_read_timeout(clock):
    c, calls = _client([TimeoutError("The read operation timed out", 20.0), "Done."], clock)
    turn = c.stream_turn("sys", [{"role": "user", "text": "hi"}], [], lambda _t: None)
    assert turn.text == "Done."
    assert calls == [c.settings.GEMINI_CHAT_TIMEOUT_SECONDS * 1000] * 2


def test_chat_turn_gives_up_after_two_timeouts(clock):
    c, calls = _client([TimeoutError("The read operation timed out", 20.0)] * 3, clock)
    with pytest.raises(GeminiError):
        c.stream_turn("sys", [{"role": "user", "text": "hi"}], [], lambda _t: None)
    assert len(calls) == 2  # never a third full-length wait


class _ApiError(Exception):
    code = 429  # like google.genai.errors.APIError


def test_quick_429s_are_retried(clock):
    c, calls = _client([_ApiError("429 RESOURCE_EXHAUSTED"), _ApiError("429 RESOURCE_EXHAUSTED"), "ok"], clock)
    assert c.stream_turn("sys", [{"role": "user", "text": "hi"}], [], lambda _t: None).text == "ok"
    assert len(calls) == 3
