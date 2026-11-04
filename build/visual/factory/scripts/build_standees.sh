#!/bin/bash
# Build standees + portraits for one or more kits (M4.09 / Design A6),
# from each kit's master GLB (outputs-v2/ — the export the approved
# LOD0 is itself derived from; see render_standee.py's header for the
# LOD0 re-import breakage that forced the master as the render source),
# and gate every sprite.
#
#   scripts/build_standees.sh atlas [builder-1 ...]
#   scripts/build_standees.sh all
#
# Pipeline (each stage a separate tool in scripts/):
#   1. render_standee.py   (Blender/Workbench) figure + hull passes at
#                          the canonical 35-degree camera, 512x512
#   2. finish_standees.py  composite, centre-crop, quantise -> sprites
#                          under outputs-web/standees/ + per-kit record
#   3. validate_sheet.py --profile lod2 --gate   the size gate — this
#                          script FAILS if any sprite is over budget
#   4. finish_standees.py --pack-atlas   shared atlas + merged manifest
#                          + per-kit contact sheets in sheets/
set -e
set -o pipefail  # Blender exits 0 even when its Python throws; the grep
                 # for the summary line is the real success check, so the
                 # pipeline must fail when the summary never appears.
cd "$(dirname "$0")/.."
BL="${BLENDER:-$HOME/workspace/tools/blender/blender-5.2.2-linux-x64/blender}"
OUT="outputs-web/standees"
mkdir -p "$OUT"

if [ "${1:-}" = "all" ]; then
  set -- atlas builder-1 verifier-1 alpha-lead
fi
[ $# -ge 1 ] || { echo "usage: build_standees.sh <persona> [...] | all" >&2; exit 2; }

for P in "$@"; do
  SRC="outputs-v2/$P.glb"
  [ -f "$SRC" ] || { echo "no such kit master GLB: $SRC" >&2; exit 2; }
  # Intermediates live in the tree, NOT /tmp (see build_web.sh: the VM's
  # /tmp is a small shared tmpfs and fills). Removed on success; kept on
  # failure for diagnosis, and the path is printed.
  TMP="$PWD/$OUT/.work-$P"
  rm -rf "$TMP"; mkdir -p "$TMP"
  export TMPDIR="$TMP/blendertmp"; mkdir -p "$TMPDIR"
  "$BL" -b --python scripts/render_standee.py -- \
    --input "$SRC" --persona "$P" --outdir "$TMP" 2>/dev/null \
    | grep STANDEE_RENDER_SUMMARY
  python3 scripts/finish_standees.py --persona "$P" --workdir "$TMP" \
    --outdir "$OUT" --source "$SRC"
  python3 scripts/validate_sheet.py --profile lod2 --gate \
    "$OUT"/sprites/"$P"--*.webp > /dev/null
  echo "LOD2 GATE PASS: $P (all sprites)"
  rm -rf "$TMP"
done

python3 scripts/finish_standees.py --pack-atlas --outdir "$OUT"
echo "STANDEES DONE: $OUT"
