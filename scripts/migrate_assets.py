#!/usr/bin/env python3
"""One-off migration to the top-level `assets` collection (docs/10-chat-refactor-plan.md §4.1).

1. Copies every projects/*/furnitureImages/* (user uploads) into assets/{id}, deduplicated by storagePath.
2. Upserts the 41 system catalog items from backend/api/app/data/system_assets.json as assets/{id}.

Dry run by default; nothing is written without --apply.

    cd backend/api
    .venv/bin/python ../../scripts/migrate_assets.py                 # dry run, prints the plan
    .venv/bin/python ../../scripts/migrate_assets.py --apply         # write to Firestore

Credentials: Application Default Credentials (`gcloud auth application-default login`), or
FIREBASE_CREDENTIALS_PATH=/path/to/key.json for a local service account key.
"""

import argparse
import datetime
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import firebase_admin
from firebase_admin import credentials, firestore

REPO_ROOT = Path(__file__).resolve().parents[1]
SYSTEM_ASSETS_JSON = REPO_ROOT / "backend/api/app/data/system_assets.json"
DEFAULT_CATALOG_BASE_URL = "https://storage.googleapis.com/soraplan-catalog"

# Old per-project furnitureType -> catalog category
TYPE_TO_CATEGORY = {
    "sofa": "Sofa",
    "couch": "Sofa",
    "armchair": "Armchair",
    "chair": "Dining Chair",
    "dining_chair": "Dining Chair",
    "stool": "Stool",
    "bench": "Dining Bench",
    "coffee_table": "Coffee Table",
    "table": "Dining Table",
    "dining_table": "Dining Table",
    "desk": "Other",
    "bed": "Bed",
    "nightstand": "Nightstand",
    "wardrobe": "Wardrobe & Storage",
    "cabinet": "Wardrobe & Storage",
    "closet": "Wardrobe & Storage",
    "storage": "Wardrobe & Storage",
    "tv_stand": "TV Stand",
    "kitchen_island": "Kitchen Counter",
    "counter": "Kitchen Counter",
    "sink": "Sink",
    "toilet": "Toilet",
    "bathtub": "Bathtub",
    "refrigerator": "Kitchen Appliance",
    "fridge": "Kitchen Appliance",
    "washer": "Appliance",
    "dryer": "Appliance",
    "lamp": "Lighting",
    "lighting": "Lighting",
}

STATUS_MAP = {
    "3d_ready": "ready",
    "ready": "ready",
    "failed_3d": "failed",
    "failed": "failed",
    "generating_3d": "generating_3d",
    "uploaded": "uploaded",
}


def init_db() -> Any:
    project_id = os.environ.get("FIREBASE_PROJECT_ID", "soraplan")
    key_path = os.environ.get("FIREBASE_CREDENTIALS_PATH")
    if key_path and os.path.isfile(key_path):
        cred = credentials.Certificate(key_path)
    else:
        cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred, {"projectId": project_id})
    return firestore.client()


def system_asset_docs(catalog_base_url: str) -> List[Dict[str, Any]]:
    """Firestore docs for the preset catalog, keyed by their stable sys_* ids."""
    base = catalog_base_url.rstrip("/")
    items = json.loads(SYSTEM_ASSETS_JSON.read_text())
    docs = []
    for item in items:
        docs.append({
            "id": item["id"],
            "ownerUid": None,
            "isSystem": True,
            "name": item["name"],
            "category": item["category"],
            "style": item["style"],
            "imagePath": item["imagePath"],
            "glbPath": item["glbPath"],
            "glbWebPath": item["glbWebPath"],
            "imageUrl": f"{base}/{item['imagePath']}",
            "glbUrl": f"{base}/{item['glbPath']}",
            "glbWebUrl": f"{base}/{item['glbWebPath']}",
            "thumbPath": item.get("thumbPath"),
            "thumbUrl": f"{base}/{item['thumbPath']}" if item.get("thumbPath") else None,
            "dims": item.get("dims"),
            "frontAxis": item.get("frontAxis", "+z"),
            "rotationOffset": item.get("rotationOffset", 0),
            "status": "ready",
            "progress": 100,
            "error": None,
            "meshyTaskId": None,
        })
    return docs


def _category(furniture_type: Optional[str]) -> str:
    key = (furniture_type or "").strip().lower().replace(" ", "_")
    return TYPE_TO_CATEGORY.get(key, "Other")


def _is_system_copy(data: Dict[str, Any]) -> bool:
    """Old projects also held copies of catalog items ('choose asset'); those are not user assets."""
    return bool(
        data.get("isSystem")
        or data.get("is_system")
        or str(data.get("gcsUri") or "").startswith("system://")
        or str(data.get("storagePath") or "").startswith("assets/")
    )


def user_asset_docs(db: Any) -> List[Dict[str, Any]]:
    docs: List[Dict[str, Any]] = []
    seen_paths = set()
    for project in db.collection("projects").stream():
        for f in project.reference.collection("furnitureImages").stream():
            data = f.to_dict() or {}
            if _is_system_copy(data):
                continue
            storage_path = data.get("storagePath")
            if not storage_path or storage_path in seen_paths:
                continue
            seen_paths.add(storage_path)
            status = STATUS_MAP.get(str(data.get("status") or "uploaded"), "uploaded")
            if data.get("meshyStatus") == "SUCCEEDED" and data.get("glbStoragePath"):
                status = "ready"
            created = data.get("uploadedAt")
            if isinstance(created, str):
                try:
                    created = datetime.datetime.fromisoformat(created)
                except ValueError:
                    created = None
            docs.append({
                "id": f.id,
                "ownerUid": data.get("ownerUid") or (project.to_dict() or {}).get("ownerUid"),
                "isSystem": False,
                "name": data.get("furnitureName") or data.get("fileName") or "Furniture",
                "category": _category(data.get("furnitureType")),
                "style": None,
                "imagePath": storage_path,
                "glbPath": data.get("glbStoragePath"),
                "glbWebPath": None,
                # Signed URLs are filled in by the API on the next GET /v1/assets?scope=mine
                "imageUrl": None,
                "glbUrl": None,
                "glbWebUrl": None,
                "urlsExpireAt": None,
                "dims": None,
                "frontAxis": "+z",
                "status": status,
                "progress": int(data.get("meshyProgress") or (100 if status == "ready" else 0)),
                "error": None,
                "meshyTaskId": data.get("meshyTaskId"),
                "createdAt": created,
                "migratedFrom": f.reference.path,
            })
    return docs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write to Firestore (default: dry run)")
    parser.add_argument("--skip-users", action="store_true", help="only seed the system catalog")
    parser.add_argument("--catalog-base-url", default=os.environ.get("CATALOG_BASE_URL", DEFAULT_CATALOG_BASE_URL))
    args = parser.parse_args()

    db = init_db()
    system = system_asset_docs(args.catalog_base_url)
    users = [] if args.skip_users else user_asset_docs(db)

    print(f"System assets to upsert: {len(system)}")
    for d in system:
        dims = d["dims"] or {}
        print(f"  {d['id']:<40} {d['category']:<20} dims={dims.get('w')}x{dims.get('d')}x{dims.get('h')}")
    print(f"User assets to copy: {len(users)}")
    for d in users:
        print(f"  {d['id']:<24} owner={d['ownerUid']} {d['category']:<18} {d['status']:<14} {d['name']}")

    if not args.apply:
        print("\nDry run: nothing written. Re-run with --apply to write.")
        return 0

    now = firestore.SERVER_TIMESTAMP
    batch = db.batch()
    pending = 0
    written = skipped = 0
    for d in system + users:
        ref = db.collection("assets").document(d["id"])
        if not d["isSystem"] and ref.get().exists:
            skipped += 1  # never overwrite a user asset that was already migrated or edited
            continue
        doc = {k: v for k, v in d.items() if k != "id"}
        doc["updatedAt"] = now
        if not doc.get("createdAt"):
            doc["createdAt"] = now
        batch.set(ref, doc, merge=True)
        pending += 1
        written += 1
        if pending >= 400:
            batch.commit()
            batch = db.batch()
            pending = 0
    if pending:
        batch.commit()
    print(f"\nWrote {written} assets ({skipped} existing user assets left untouched).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
