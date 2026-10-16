from .conftest import AUTH, USER_UID
from .fakes import call, say
from .flow import create_and_upload, finish_parse, to_reviewing, to_scene
from .helpers import pdf_bytes, png_bytes


def kinds(db, cid):
    return [m["kind"] for m in db.messages(cid)]


def test_create_conversation_and_upload(client, fake_db, fake_storage):
    cid = create_and_upload(client, fake_storage, png_bytes(640, 480))
    conv = fake_db.doc(f"conversations/{cid}")
    project = fake_db.doc(f"projects/{cid}")
    assert conv["ownerUid"] == USER_UID and conv["projectId"] == cid
    assert conv["title"] == "Floorplan 1"
    assert conv["stage"] == "cropping"
    assert conv["thumbnailUrl"].startswith("https://signed.example/")
    assert project["planImageOriginal"]["width"] == 640 and project["planImageOriginal"]["height"] == 480
    assert kinds(fake_db, cid) == ["crop_request"]
    assert conv["lastMessagePreview"] == "Crop your floor plan"


def test_pdf_upload_is_rendered_to_png(client, fake_db, fake_storage):
    cid = create_and_upload(client, fake_storage, pdf_bytes(), name="plan.pdf", ctype="application/pdf")
    original = fake_db.doc(f"projects/{cid}")["planImageOriginal"]
    assert original["contentType"] == "image/png" and original["width"] > 0
    assert fake_storage.blobs[original["storagePath"]][:8] == b"\x89PNG\r\n\x1a\n"


def test_rejects_unsupported_files(client):
    res = client.post("/v1/conversations", json={"fileName": "a.gif", "contentType": "image/gif", "sizeBytes": 10}, headers=AUTH)
    assert res.status_code == 400 and res.json()["code"] == "UNSUPPORTED_FILE_TYPE"


def test_upload_complete_requires_the_blob(client):
    res = client.post("/v1/conversations", json={"fileName": "a.png", "contentType": "image/png", "sizeBytes": 10}, headers=AUTH)
    res = client.post(f"/v1/conversations/{res.json()['conversationId']}/upload-complete", headers=AUTH)
    assert res.status_code == 400 and res.json()["code"] == "UPLOAD_NOT_FOUND"


def test_crop_saved_from_canvas_then_confirmed(client, fake_db, fake_storage, worker_calls):
    cid = create_and_upload(client, fake_storage, png_bytes(400, 300))
    res = client.patch(f"/v1/conversations/{cid}", json={"stageData": {"crop": {"x": 20, "y": 30, "width": 200, "height": 150}}}, headers=AUTH)
    assert res.status_code == 200
    assert fake_db.doc(f"conversations/{cid}")["stageData"]["crop"] == {"x": 20, "y": 30, "width": 200, "height": 150}
    res = client.post(f"/v1/conversations/{cid}/actions", json={"type": "confirm_crop"}, headers=AUTH)
    assert res.status_code == 200, res.text
    project = fake_db.doc(f"projects/{cid}")
    assert project["planImage"]["width"] == 200 and project["planImage"]["height"] == 150
    assert project["crop"] == {"x": 20, "y": 30, "width": 200, "height": 150}
    conv = fake_db.doc(f"conversations/{cid}")
    assert conv["stage"] == "parsing" and conv["busy"] is True
    assert kinds(fake_db, cid)[-1] == "parse_started"
    # dispatched to the worker in cropped mode, reporting back to this conversation
    assert worker_calls[-1]["json"]["cropped"] is True
    assert worker_calls[-1]["json"]["conversationId"] == cid
    job_id = fake_db.messages(cid)[-1]["payload"]["jobId"]
    assert fake_db.doc(f"jobs/{job_id}")["status"] == "queued"


def test_crop_too_small_is_rejected(client, fake_storage, worker_calls):
    cid = create_and_upload(client, fake_storage)
    res = client.post(f"/v1/conversations/{cid}/actions", json={"type": "confirm_crop", "args": {"crop": {"x": 0, "y": 0, "width": 10, "height": 10}}}, headers=AUTH)
    assert res.status_code == 400 and res.json()["code"] == "CROP_TOO_SMALL"


def test_plan_edits_are_saved_and_versioned(client, fake_db, fake_storage, worker_calls):
    cid = to_reviewing(client, fake_db, fake_storage, worker_calls)
    plan = fake_db.doc(f"projects/{cid}")["floorPlan"]
    plan["furniture"].append({"id": "box_1", "type": "furniture", "furnitureType": "unknown", "category": "Armchair",
                              "label": "Reading chair", "x": 3, "y": 14, "width": 2.5, "height": 2.5, "rotation": 0, "addedBy": "user"})
    res = client.put(f"/v1/projects/{cid}/plan", json={"floorPlan": plan}, headers=AUTH)
    assert res.status_code == 200 and res.json()["floorPlanVersion"] == 2
    saved = fake_db.doc(f"projects/{cid}")["floorPlan"]
    assert saved["furniture"][-1]["category"] == "Armchair"
    bad = client.put(f"/v1/projects/{cid}/plan", json={"floorPlan": {"width": 0, "height": 3}}, headers=AUTH)
    assert bad.status_code == 400


def test_full_flow_to_scene_and_ui_edits(client, fake_db, fake_storage, worker_calls):
    cid = to_reviewing(client, fake_db, fake_storage, worker_calls)
    client.post(f"/v1/conversations/{cid}/actions", json={"type": "confirm_plan"}, headers=AUTH)
    assert fake_db.doc(f"conversations/{cid}")["stage"] == "choosing_style"
    picker = fake_db.messages(cid)[-1]
    assert picker["kind"] == "style_picker" and [s["id"] for s in picker["payload"]["styles"]] == ["Industrial", "Japandi"]

    client.post(f"/v1/conversations/{cid}/actions", json={"type": "select_style", "args": {"style": "Japandi"}}, headers=AUTH)
    project = fake_db.doc(f"projects/{cid}")
    assert fake_db.doc(f"conversations/{cid}")["stage"] == "resolving_missing"
    assert {m["componentId"] for m in project["missing"]} == {"fur_008", "fix_006"}  # desk + shower (Gemini fake: no label)
    assert fake_db.messages(cid)[-1]["kind"] == "mapping_result"

    # rescale the sofa during mapping, apply-to-all on the chairs
    res = client.patch(f"/v1/projects/{cid}/mapping", json={"componentId": "fur_002", "dims": {"w": 2.3, "d": 0.95, "h": 0.85}}, headers=AUTH)
    assert res.status_code == 200
    res = client.patch(f"/v1/projects/{cid}/mapping", json={"componentId": "fur_006", "dims": {"w": 0.5, "d": 0.5, "h": 0.9}, "applyToSameAsset": True}, headers=AUTH)
    mapping = res.json()["mapping"]
    assert mapping["fur_007"]["dims"] == {"w": 0.5, "d": 0.5, "h": 0.9} and mapping["fur_007"]["dimsSource"] == "user"
    res = client.patch(f"/v1/projects/{cid}/mapping", json={"componentId": "fur_006", "reset": True}, headers=AUTH)
    assert res.json()["mapping"]["fur_007"]["dims"] == res.json()["mapping"]["fur_007"]["autoDims"]

    client.post(f"/v1/conversations/{cid}/actions", json={"type": "skip_missing", "args": {"componentIds": ["fix_006"]}}, headers=AUTH)
    assert fake_db.doc(f"conversations/{cid}")["stage"] == "resolving_missing"
    client.post(f"/v1/conversations/{cid}/actions", json={"type": "continue"}, headers=AUTH)
    assert fake_db.doc(f"conversations/{cid}")["stage"] == "scene_ready"
    assert fake_db.messages(cid)[-1]["kind"] == "scene_ready"

    scene = fake_db.doc(f"scenes/{cid}")
    sofa = next(i for i in scene["graph"]["levels"][0]["items"] if i["componentId"] == "fur_002")
    assert sofa["dims"] == {"w": 2.3, "d": 0.95, "h": 0.85}  # the rescale survives into 3D

    # UI drag → op batch; stale base version → 409; shared undo
    res = client.post(f"/v1/projects/{cid}/scene/ops", json={"baseVersion": scene["version"], "origin": "ui",
                      "ops": [{"op": "item.move", "id": sofa["id"], "position": [1.0, 0, 6.0]}]}, headers=AUTH)
    assert res.status_code == 200, res.text
    assert res.json()["newVersion"] == scene["version"] + 1
    stale = client.post(f"/v1/projects/{cid}/scene/ops", json={"baseVersion": scene["version"], "ops": [{"op": "item.remove", "id": sofa["id"]}]}, headers=AUTH)
    assert stale.status_code == 409 and stale.json()["code"] == "SCENE_VERSION_CONFLICT"
    assert client.post(f"/v1/projects/{cid}/scene/undo", headers=AUTH).status_code == 200
    restored = next(i for i in fake_db.doc(f"scenes/{cid}")["graph"]["levels"][0]["items"] if i["id"] == sofa["id"])
    assert restored["position"] == sofa["position"]
    assert client.post(f"/v1/projects/{cid}/scene/redo", headers=AUTH).status_code == 200


def test_wrong_stage_actions_are_rejected(client, fake_db, fake_storage):
    cid = create_and_upload(client, fake_storage)
    res = client.post(f"/v1/conversations/{cid}/actions", json={"type": "confirm_plan"}, headers=AUTH)
    assert res.status_code == 409 and res.json()["code"] == "WRONG_STAGE"


def test_chat_turn_answers_without_tools(client, fake_db, fake_storage, fake_gemini):
    cid = create_and_upload(client, fake_storage)
    fake_gemini.script = [say("A tight crop helps me find the walls and the scale.")]
    res = client.post(f"/v1/conversations/{cid}/messages", json={"text": "why do I need to crop?"}, headers=AUTH)
    assert res.status_code == 200
    msgs = fake_db.messages(cid)
    assert [m["role"] for m in msgs[-2:]] == ["user", "assistant"]
    assert msgs[-1]["text"].startswith("A tight crop") and msgs[-1]["status"] == "done"
    assert fake_db.doc(f"conversations/{cid}")["stage"] == "cropping"
    assert fake_db.doc(f"conversations/{cid}")["busy"] is False
    sent = fake_gemini.calls[0]
    assert "Current stage: cropping" in sent["system"]
    assert "confirm_crop" in sent["tools"] and "move_item" not in sent["tools"]


def test_chat_done_confirms_crop_through_the_tool(client, fake_db, fake_storage, fake_gemini, worker_calls):
    cid = create_and_upload(client, fake_storage)
    fake_gemini.script = [call("confirm_crop"), say("Great — reading your plan now.")]
    client.post(f"/v1/conversations/{cid}/messages", json={"text": "done"}, headers=AUTH)
    assert fake_db.doc(f"conversations/{cid}")["stage"] == "parsing"
    assert "parse_started" in kinds(fake_db, cid)
    tool_log = next(m for m in fake_db.messages(cid) if m["role"] == "assistant")["toolCalls"]
    assert tool_log[0]["name"] == "confirm_crop" and tool_log[0]["result"]["ok"] is True


def test_chat_scene_edit_posts_scene_change_with_undo(client, fake_db, fake_storage, fake_gemini, worker_calls):
    cid = to_scene(client, fake_db, fake_storage, worker_calls)
    before = next(i for i in fake_db.doc(f"scenes/{cid}")["graph"]["levels"][0]["items"] if i["id"] == "itm_fur_002")
    fake_gemini.script = [call("move_item", itemId="itm_fur_002", dx=-0.5), say("Moved the sofa 50 cm left.")]
    client.post(f"/v1/conversations/{cid}/messages", json={"text": "move the sofa 50 cm left"}, headers=AUTH)
    after = next(i for i in fake_db.doc(f"scenes/{cid}")["graph"]["levels"][0]["items"] if i["id"] == "itm_fur_002")
    assert after["position"][0] == round(before["position"][0] - 0.5, 3)
    change = fake_db.messages(cid)[-1]
    assert change["kind"] == "scene_change" and change["payload"]["summary"] == "Moved Sofa"
    # the system prompt carried the item ids
    assert "itm_fur_002 · Sofa" in fake_gemini.calls[0]["system"]
    res = client.post(f"/v1/conversations/{cid}/actions", json={"type": "undo_last_change", "args": {"batchIds": change["payload"]["batchIds"], "messageId": change["id"]}}, headers=AUTH)
    assert res.status_code == 200 and res.json()["result"]["undone"] == 1
    again = next(i for i in fake_db.doc(f"scenes/{cid}")["graph"]["levels"][0]["items"] if i["id"] == "itm_fur_002")
    assert again["position"] == before["position"]
    assert fake_db.messages(cid)[-1]["payload"]["undone"] is True


def test_destructive_tool_needs_explicit_yes(client, fake_db, fake_storage, fake_gemini, worker_calls):
    cid = to_scene(client, fake_db, fake_storage, worker_calls)
    fake_gemini.script = [call("remove_item", itemId="itm_fur_002"), say("Are you sure you want to delete the sofa?")]
    client.post(f"/v1/conversations/{cid}/messages", json={"text": "delete the sofa"}, headers=AUTH)
    items = [i["id"] for i in fake_db.doc(f"scenes/{cid}")["graph"]["levels"][0]["items"]]
    assert "itm_fur_002" in items
    log = [m for m in fake_db.messages(cid) if m["role"] == "assistant" and m.get("toolCalls")][-1]["toolCalls"]
    assert log[0]["result"]["error"] == "NEEDS_CONFIRMATION"

    fake_gemini.script = [call("remove_item", itemId="itm_fur_002"), say("Deleted.")]
    client.post(f"/v1/conversations/{cid}/messages", json={"text": "yes"}, headers=AUTH)
    items = [i["id"] for i in fake_db.doc(f"scenes/{cid}")["graph"]["levels"][0]["items"]]
    assert "itm_fur_002" not in items


def test_tool_errors_are_returned_to_the_model(client, fake_db, fake_storage, fake_gemini, worker_calls):
    cid = to_scene(client, fake_db, fake_storage, worker_calls)
    fake_gemini.script = [call("rotate_item", itemId="itm_ghost", degrees=90), say("I couldn't find that item.")]
    client.post(f"/v1/conversations/{cid}/messages", json={"text": "rotate the ghost"}, headers=AUTH)
    log = [m for m in fake_db.messages(cid) if m.get("toolCalls")][-1]["toolCalls"]
    assert log[0]["result"] == {"ok": False, "error": "UNKNOWN_ITEM", "message": "No item 'itm_ghost'. Use ids from the scene summary."}


def test_gemini_failure_posts_error_message(client, fake_db, fake_storage, fake_gemini):
    from app.services.gemini_client import GeminiError

    cid = create_and_upload(client, fake_storage)

    def boom(*a, **k):
        raise GeminiError("unavailable")

    fake_gemini.stream_turn = boom
    client.post(f"/v1/conversations/{cid}/messages", json={"text": "hi"}, headers=AUTH)
    msgs = fake_db.messages(cid)
    assert msgs[-1]["kind"] == "error" and msgs[-1]["payload"]["code"] == "GEMINI_ERROR"
    assert fake_db.doc(f"conversations/{cid}")["busy"] is False


def test_go_back_paths(client, fake_db, fake_storage, worker_calls):
    cid = to_scene(client, fake_db, fake_storage, worker_calls)
    res = client.post(f"/v1/conversations/{cid}/actions", json={"type": "edit_plan"}, headers=AUTH)
    assert res.status_code == 200 and fake_db.doc(f"conversations/{cid}")["stage"] == "reviewing_plan"
    res = client.post(f"/v1/conversations/{cid}/actions", json={"type": "restart_crop"}, headers=AUTH)
    assert res.status_code == 200 and fake_db.doc(f"conversations/{cid}")["stage"] == "cropping"
    assert fake_db.messages(cid)[-1]["kind"] == "crop_request"


def test_rename_and_delete(client, fake_db, fake_storage, worker_calls):
    cid = to_scene(client, fake_db, fake_storage, worker_calls)
    assert client.patch(f"/v1/conversations/{cid}", json={"title": "Beach house"}, headers=AUTH).status_code == 200
    assert fake_db.doc(f"projects/{cid}")["name"] == "Beach house"
    assert client.delete(f"/v1/conversations/{cid}", headers=AUTH).status_code == 204
    for path in (f"conversations/{cid}", f"projects/{cid}", f"scenes/{cid}"):
        assert fake_db.doc(path) is None
    assert fake_db.messages(cid) == []
    assert not [k for k in fake_storage.blobs if k.startswith(f"{USER_UID}/{cid}/")]


def test_other_users_cannot_touch_a_conversation(client, fake_db, fake_storage):
    cid = create_and_upload(client, fake_storage)
    fake_db.docs[f"conversations/{cid}"]["ownerUid"] = "someone_else"
    res = client.post(f"/v1/conversations/{cid}/messages", json={"text": "hi"}, headers=AUTH)
    assert res.status_code == 403


def test_project_files_returns_signed_urls(client, fake_db, fake_storage, worker_calls):
    cid = to_reviewing(client, fake_db, fake_storage, worker_calls)
    files = client.get(f"/v1/projects/{cid}/files", headers=AUTH).json()
    assert files["planOriginalUrl"].endswith(f"{cid}/original.png?exp=86400")
    assert "/plan_1.png" in files["planUrl"]


def test_finish_parse_helper_matches_worker_contract(client, fake_db, fake_storage):
    cid = create_and_upload(client, fake_storage)
    finish_parse(fake_db, cid)
    assert fake_db.doc(f"conversations/{cid}")["stage"] == "reviewing_plan"
