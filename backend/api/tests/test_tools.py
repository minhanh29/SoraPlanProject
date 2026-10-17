"""Stage guard, argument validation and the confirmation rule of the tool registry."""
import pytest

from app.errors import AppException
from app.services.tools import TOOLS, ToolContext, run_tool, tools_for_stage
from app.services.workflow import Ctx

from .conftest import USER_UID


class _WF:
    """Minimal workflow double: records calls."""

    def __init__(self):
        self.calls = []

    def __getattr__(self, name):
        def f(*a, **k):
            self.calls.append(name)
            return {"stage": "x"}
        return f


def tctx(stage, confirmed=True, source="agent"):
    return ToolContext(ctx=Ctx(uid=USER_UID, conversation_id="c1", source=source, user_confirmed=confirmed), workflow=_WF(), stage=stage)


def test_every_tool_has_a_valid_declaration():
    for spec in TOOLS.values():
        d = spec.declaration()
        assert d["parameters"]["type"] == "object"
        assert set(d["parameters"].get("required", [])) <= set(d["parameters"]["properties"])
        assert spec.stages


def test_stage_tool_sets():
    assert {t.name for t in tools_for_stage("cropping")} == {"confirm_crop", "retry_parse", "find_assets"}
    scene_tools = {t.name for t in tools_for_stage("scene_ready")}
    assert {"move_item", "rotate_item", "resize_item", "remove_item", "replace_item", "add_item",
            "set_wall_color", "set_floor_color", "undo_last_change", "select_style", "edit_plan", "restart_crop"} <= scene_tools
    assert "continue" not in {t.name for t in tools_for_stage("resolving_missing")}  # UI-only alias


def test_stage_guard():
    with pytest.raises(AppException) as e:
        run_tool("confirm_plan", {}, tctx("cropping"))
    assert e.value.code == "WRONG_STAGE"


def test_unknown_tool():
    with pytest.raises(AppException) as e:
        run_tool("launch_rockets", {}, tctx("scene_ready"))
    assert e.value.code == "UNKNOWN_TOOL"


def test_confirmation_rule():
    t = tctx("scene_ready", confirmed=False)
    with pytest.raises(AppException) as e:
        run_tool("restart_crop", {}, t)
    assert e.value.code == "NEEDS_CONFIRMATION"
    assert t.workflow.calls == []
    t = tctx("scene_ready", confirmed=True)
    run_tool("restart_crop", {}, t)
    assert t.workflow.calls == ["restart_crop"]


def test_select_style_normalizes_case():
    t = tctx("choosing_style")
    run_tool("select_style", {"style": "japandi"}, t)
    assert t.workflow.calls == ["select_style"]


@pytest.mark.parametrize("args", [{"hex": "blue"}, {"hex": "#12345"}, {}])
def test_color_validation(args):
    with pytest.raises(AppException) as e:
        run_tool("set_wall_color", args, tctx("scene_ready"))
    assert e.value.code == "INVALID_COLOR"


def test_resize_needs_a_dimension(client, fake_db, fake_storage, worker_calls):
    from .flow import to_scene
    from app.deps import get_workflow  # noqa: F401  (ensures app wiring imports)

    cid = to_scene(client, fake_db, fake_storage, worker_calls)
    from app.services.scene_ops import SceneService
    from app.services.workflow import Workflow

    wf = Workflow.__new__(Workflow)
    wf.scenes = SceneService(fake_db)
    wf.db = fake_db
    t = ToolContext(ctx=Ctx(uid=USER_UID, conversation_id=cid, source="agent"), workflow=wf, stage="scene_ready")
    with pytest.raises(AppException) as e:
        run_tool("resize_item", {"itemId": "itm_fur_002"}, t)
    assert e.value.code == "NO_DIMS"
    res = run_tool("resize_item", {"itemId": "itm_fur_002", "w": 100}, t)  # clamped to 3×
    item = next(i for i in fake_db.doc(f"scenes/{cid}")["graph"]["levels"][0]["items"] if i["id"] == "itm_fur_002")
    assert res.data["applied"] and item["dims"]["w"] < 10
    run_tool("rotate_item", {"itemId": "itm_fur_002", "degrees": 90}, t)
    run_tool("set_floor_color", {"hex": "#a0b0c0", "roomIds": ["rom_003"]}, t)
    room = next(r for r in fake_db.doc(f"scenes/{cid}")["graph"]["levels"][0]["rooms"] if r["id"] == "rom_003")
    assert room["floorColor"] == "#A0B0C0"
