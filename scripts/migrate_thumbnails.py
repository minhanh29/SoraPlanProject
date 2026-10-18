#!/usr/bin/env python3
"""Give catalog (system) assets a WebP thumbnail: longest side 512 px, transparency kept.

New uploads get theirs in AssetService._start_generation; this backfills the catalog.
For every system asset whose image lives in the catalog bucket (assets/{Style}/{stem}.png):

1. Downloads the image, writes assets-web/{Style}/{stem}_thumb.webp to the catalog bucket
   (the same name promotion uses: assets-web/{Style}/user_{id}_thumb.webp).
2. Sets thumbPath in backend/api/app/data/system_assets.json (the bundled fallback).
3. Sets thumbPath / thumbUrl on assets/{id} in Firestore (includes promoted user assets).

Existing thumbnails are skipped unless --force. Dry run by default; nothing is written without --apply.

    cd backend/api
    .venv/bin/python ../../scripts/migrate_thumbnails.py                 # dry run, prints the plan
    .venv/bin/python ../../scripts/migrate_thumbnails.py --apply         # write

Credentials: Application Default Credentials (`gcloud auth application-default login`), or
FIREBASE_CREDENTIALS_PATH=/path/to/key.json for a local service account key. Writing the catalog
bucket needs storage.objects.create on it.
"""

import argparse
import json
import os
import posixpath
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud import storage

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend/api"))
from app.services.thumbnail import THUMB_CONTENT_TYPE, make_thumbnail  # noqa: E402

SYSTEM_ASSETS_JSON = REPO_ROOT / "backend/api/app/data/system_assets.json"
DEFAULT_CATALOG_BUCKET = "soraplan-catalog"
# Same name may be re-rendered with --force, so no immutable caching (like assets/ in upload_catalog.sh)
CACHE_CONTROL = "public, max-age=86400"


def init_db() -> Any:
    project_id = os.environ.get("FIREBASE_PROJECT_ID", "soraplan")
    key_path = os.environ.get("FIREBASE_CREDENTIALS_PATH")
    if key_path and os.path.isfile(key_path):
        cred = credentials.Certificate(key_path)
    else:
        cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred, {"projectId": project_id})
    return firestore.client()


def thumb_path_for(image_path: Optional[str]) -> Optional[str]:
    """assets/{Style}/{stem}.png -> assets-web/{Style}/{stem}_thumb.webp; None outside the catalog."""
    parts = (image_path or "").split("/")
    if len(parts) != 3 or parts[0] != "assets":
        return None
    stem = posixpath.splitext(parts[2])[0]
    return f"assets-web/{parts[1]}/{stem}_thumb.webp"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write thumbnails, JSON and Firestore (default: dry run)")
    parser.add_argument("--force", action="store_true", help="re-render thumbnails that already exist")
    parser.add_argument("--catalog-bucket", default=os.environ.get("CATALOG_BUCKET_NAME", DEFAULT_CATALOG_BUCKET))
    args = parser.parse_args()

    db = init_db()
    bucket = storage.Client().bucket(args.catalog_bucket)
    base_url = f"https://storage.googleapis.com/{args.catalog_bucket}"

    # image path -> thumb path, from the bundled catalog and every system doc in Firestore
    items: List[Dict[str, Any]] = json.loads(SYSTEM_ASSETS_JSON.read_text())
    docs = [(s.id, s.to_dict() or {}) for s in db.collection("assets").where("isSystem", "==", True).stream()]
    images: Dict[str, str] = {}
    for image_path in [i.get("imagePath") for i in items] + [d.get("imagePath") for _, d in docs]:
        thumb = thumb_path_for(image_path)
        if thumb:
            images[image_path] = thumb
        elif image_path:
            print(f"  skip {image_path}: not in the catalog bucket (legacy private system asset?)")

    print(f"Catalog images: {len(images)} (bucket gs://{args.catalog_bucket})")
    made = existing = failed = 0
    ok: Dict[str, str] = {}
    for image_path, thumb in sorted(images.items()):
        blob = bucket.blob(thumb)
        if not args.force and blob.exists():
            existing += 1
            ok[image_path] = thumb
            continue
        if not args.apply:
            print(f"  would write {thumb}")
            ok[image_path] = thumb
            continue
        try:
            src = bucket.blob(image_path).download_as_bytes()
            data = make_thumbnail(src)
        except Exception as e:
            failed += 1
            print(f"  FAILED {image_path}: {e}")
            continue
        blob.cache_control = CACHE_CONTROL
        blob.upload_from_string(data, content_type=THUMB_CONTENT_TYPE)
        made += 1
        ok[image_path] = thumb
        print(f"  {thumb:<60} {len(src) // 1024:>6} KB -> {len(data) // 1024:>4} KB")

    json_changes = [i for i in items if i.get("imagePath") in ok and i.get("thumbPath") != ok[i["imagePath"]]]
    doc_changes = [(doc_id, ok[d["imagePath"]]) for doc_id, d in docs
                   if d.get("imagePath") in ok and d.get("thumbPath") != ok[d["imagePath"]]]
    print(f"system_assets.json entries to update: {len(json_changes)}")
    print(f"Firestore system assets to update: {len(doc_changes)}")

    if not args.apply:
        print("\nDry run: nothing written. Re-run with --apply to write.")
        return 0

    for i in json_changes:
        i["thumbPath"] = ok[i["imagePath"]]
    if json_changes:
        SYSTEM_ASSETS_JSON.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n")

    batch = db.batch()
    for n, (doc_id, thumb) in enumerate(doc_changes, 1):
        batch.update(db.collection("assets").document(doc_id), {
            "thumbPath": thumb,
            "thumbUrl": f"{base_url}/{thumb}",
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        if n % 400 == 0:
            batch.commit()
            batch = db.batch()
    batch.commit()

    print(f"\nThumbnails: {made} written, {existing} already there, {failed} failed. "
          f"Updated {len(json_changes)} JSON entries and {len(doc_changes)} Firestore docs.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
