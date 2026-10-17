#!/usr/bin/env bash
# Compress the preset catalog for the web (decision D7): meshopt geometry + 1k WebP textures.
#
#   scripts/optimize_catalog.sh                      # all models -> catalog/out/assets-web/{Style}/
#   ONLY='In_sofa|Ja_sofa' scripts/optimize_catalog.sh   # regex filter on the file stem
#   FORCE=1 scripts/optimize_catalog.sh              # re-optimize files that already exist
#   UPLOAD=1 scripts/optimize_catalog.sh             # also rsync to gs://$CATALOG_BUCKET/assets-web/
#
# Target: <= 3 MB per model. Originals stay in assets/{Style}/ (upload with deploy/upload_catalog.sh).
# Also writes the style preview shown in the chat's style picker: assets/{Style}/{Style}.png (8 MB render)
# -> catalog/out/assets-web/{Style}/{Style}.webp (1600 px wide, ~150 KB; needs cwebp).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${CATALOG_SRC:-$REPO_ROOT/assets}"
OUT="${CATALOG_WEB_OUT:-$REPO_ROOT/catalog/out/assets-web}"
CLI_VERSION="${GLTF_TRANSFORM_VERSION:-4.1.0}"
LIMIT=$((3 * 1024 * 1024))

fsize() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1"; }
mb() { awk -v b="$1" 'BEGIN { printf "%.1f MB", b / 1048576 }'; }

[ -d "$SRC" ] || { echo "Catalog folder not found: $SRC" >&2; exit 1; }

total_in=0 total_out=0 count=0 over=0
for style in Industrial Japandi; do
  [ -d "$SRC/$style" ] || continue
  mkdir -p "$OUT/$style"
  for in_file in "$SRC/$style"/*.glb; do
    [ -e "$in_file" ] || continue
    stem="$(basename "$in_file" .glb)"
    if [ -n "${ONLY:-}" ] && ! [[ "$stem" =~ $ONLY ]]; then continue; fi
    out_file="$OUT/$style/$stem.glb"
    if [ ! -f "$out_file" ] || [ "${FORCE:-0}" = "1" ]; then
      npx -y "@gltf-transform/cli@$CLI_VERSION" optimize "$in_file" "$out_file" \
        --compress meshopt --texture-compress webp --texture-size 1024 >/dev/null
    fi
    a="$(fsize "$in_file")" b="$(fsize "$out_file")"
    total_in=$((total_in + a)) total_out=$((total_out + b)) count=$((count + 1))
    flag=""
    if [ "$b" -gt "$LIMIT" ]; then flag="  !! over 3 MB"; over=$((over + 1)); fi
    printf '%-28s %10s -> %10s%s\n' "$style/$stem" "$(mb "$a")" "$(mb "$b")" "$flag"
  done
done
printf '\n%d models: %s -> %s (%d over 3 MB)\n' "$count" "$(mb "$total_in")" "$(mb "$total_out")" "$over"

# Style previews (styles.json "cover")
for style in Industrial Japandi; do
  in_file="$SRC/$style/$style.png"
  out_file="$OUT/$style/$style.webp"
  [ -f "$in_file" ] || { echo "No style preview $in_file" >&2; continue; }
  if [ ! -f "$out_file" ] || [ "${FORCE:-0}" = "1" ]; then
    command -v cwebp >/dev/null || { echo "cwebp not found (brew install webp); skipping previews" >&2; break; }
    mkdir -p "$OUT/$style"
    cwebp -quiet -q 80 -resize 1600 0 "$in_file" -o "$out_file"
  fi
  printf '%-28s %10s -> %10s\n' "$style/$style (preview)" "$(mb "$(fsize "$in_file")")" "$(mb "$(fsize "$out_file")")"
done

if [ "${UPLOAD:-0}" = "1" ]; then
  source "$REPO_ROOT/deploy/config.sh"
  log "Syncing $OUT -> gs://$CATALOG_BUCKET/assets-web"
  # Optimized files are content-stable per name; re-run with FORCE=1 + upload to replace them.
  gc storage rsync "$OUT" "gs://$CATALOG_BUCKET/assets-web" --recursive \
    --exclude='.*(?<!\.glb)$' \
    --cache-control='public, max-age=31536000, immutable' \
    --content-type=model/gltf-binary
fi
