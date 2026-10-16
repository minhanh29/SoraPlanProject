"""Gemini tool-calling eval: does the model pick the right tool with valid args?

    cd backend/api && .venv/bin/python -m evals.run_chat_tools [--model gemini-3.8-flash]

Uses real Gemini (Vertex AI with ADC, or GEMINI_API_KEY) and an in-memory project built from
tests/fixtures/floorplan_1.plan.json. Run it before changing prompts, tools or GEMINI_CHAT_MODEL.
Pass = the first function call of the first model turn matches `expect` (tool null = no call).
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from app.services.asset_mapper import map_plan  # noqa: E402
from app.services.asset_service import system_asset_doc  # noqa: E402
from app.services.common import load_system_catalog  # noqa: E402
from app.services.gemini_client import GeminiClient  # noqa: E402
from app.services.orchestrator import SYSTEM_PROMPT, STAGE_GUIDE, Orchestrator  # noqa: E402
from app.services.scene_builder import build_scene  # noqa: E402
from app.services.scene_ops import SceneService  # noqa: E402
from app.services.tools import tools_for_stage  # noqa: E402
from tests.fakes import FakeFirestore  # noqa: E402


def matches(expected, actual) -> bool:
    if isinstance(expected, dict) and "approx" in expected:
        return isinstance(actual, (int, float)) and abs(actual - expected["approx"]) <= expected.get("tol", 0)
    if isinstance(expected, list):
        return isinstance(actual, list) and sorted(map(str, expected)) == sorted(map(str, actual))
    if isinstance(expected, str) and isinstance(actual, str):
        return expected.lower() == actual.lower()
    return expected == actual


def build_context(stage: str):
    with open(os.path.join(os.path.dirname(HERE), "tests", "fixtures", "floorplan_1.plan.json")) as f:
        plan = json.load(f)
    assets = [system_asset_doc(i, "https://storage.googleapis.com/soraplan-catalog") for i in load_system_catalog()]
    mapping, missing = map_plan(plan, "Japandi", assets)
    db = FakeFirestore()
    project = {"id": "p1", "ownerUid": "u1", "floorPlan": plan,
               "style": "Japandi" if stage in ("resolving_missing", "scene_ready") else None,
               "mapping": mapping if stage in ("resolving_missing", "scene_ready") else {}}
    db.collection("projects").document("p1").set(project)
    scenes = SceneService(db)
    if stage == "scene_ready":
        scenes.save_built("p1", "u1", build_scene("p1", plan, "Japandi", {k: v for k, v in mapping.items() if v.get("assetId")}))

    class _WF:
        pass

    wf = _WF()
    wf.scenes = scenes
    orch = Orchestrator.__new__(Orchestrator)
    orch.workflow = wf
    conv = {"title": "Floorplan 1", "stage": stage}
    summary = orch.project_summary(conv, project)
    return SYSTEM_PROMPT.format(units="feet and inches", stage=stage, guide=STAGE_GUIDE[stage], summary=summary)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=None)
    ap.add_argument("--only", default=None, help="run one case id")
    args = ap.parse_args()
    client = GeminiClient(model=args.model)
    cases = [json.loads(line) for line in open(os.path.join(HERE, "chat_tools.jsonl")) if line.strip()]
    if args.only:
        cases = [c for c in cases if c["id"] == args.only]
    passed = 0
    for case in cases:
        system = build_context(case["stage"])
        tools = [t.declaration() for t in tools_for_stage(case["stage"])]
        turn = client.stream_turn(system, [{"role": "user", "text": case["utterance"]}], tools, lambda _t: None, temperature=0)
        call = turn.calls[0] if turn.calls else None
        exp = case["expect"]
        ok = (call is None) if exp["tool"] is None else (
            call is not None and call.name == exp["tool"]
            and all(matches(v, call.args.get(k)) for k, v in (exp.get("args") or {}).items())
        )
        passed += ok
        got = f"{call.name}({json.dumps(call.args)})" if call else f"text: {turn.text[:70]!r}"
        print(f"{'PASS' if ok else 'FAIL'}  {case['id']:<22} {got}")
    print(f"\n{passed}/{len(cases)} passed ({100 * passed // max(1, len(cases))}%) — target ≥ 18/20")
    return 0 if passed >= len(cases) * 0.9 else 1


if __name__ == "__main__":
    sys.exit(main())
