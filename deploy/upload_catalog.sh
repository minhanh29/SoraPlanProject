#!/usr/bin/env bash
# Sync the preset furniture catalog (GLB / USDZ / PNG) to the public catalog bucket.
#
#   deploy/upload_catalog.sh            # upload new/changed files
#   DRY_RUN=1 deploy/upload_catalog.sh  # show what would change
#
# Objects keep their logical path: assets/Japandi/Ja_sofa.glb ->
# https://storage.googleapis.com/$CATALOG_BUCKET/assets/Japandi/Ja_sofa.glb
# Only Industrial/ and Japandi/ model + image files are uploaded: the .env files,
# service account keys and JSON state that also live in assets/ never leave the machine.

source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

[ -d "$CATALOG_SRC" ] || die "Catalog folder not found: $CATALOG_SRC"

extra=()
[ "${DRY_RUN:-0}" = "1" ] && extra+=(--dry-run)

for style in Industrial Japandi; do
  [ -d "$CATALOG_SRC/$style" ] || { warn "Skipping missing $CATALOG_SRC/$style"; continue; }
  log "Syncing $style -> gs://$CATALOG_BUCKET/assets/$style"
  # rsync --exclude is a Python regex on the relative path; keep only model/image files
  gc storage rsync "$CATALOG_SRC/$style" "gs://$CATALOG_BUCKET/assets/$style" \
    --recursive \
    --exclude='.*(?<!\.glb)(?<!\.usdz)(?<!\.png)(?<!\.jpg)(?<!\.jpeg)(?<!\.webp)$' \
    --cache-control='public, max-age=86400' \
    ${extra[@]+"${extra[@]}"}
done

if [ "${DRY_RUN:-0}" != "1" ]; then
  log "Setting 3D content types"
  gc storage objects update "gs://$CATALOG_BUCKET/assets/**.glb" --content-type=model/gltf-binary >/dev/null
  gc storage objects update "gs://$CATALOG_BUCKET/assets/**.usdz" --content-type=model/vnd.usdz+zip >/dev/null
fi

log "Catalog objects:"
gc storage ls "gs://$CATALOG_BUCKET/assets/**" | sed 's/.*\.//' | sort | uniq -c
