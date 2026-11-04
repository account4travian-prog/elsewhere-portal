#!/bin/bash
# Build one persona's web-profile exports (LOD0 + LOD1) from its v2 factory
# GLB, through the full M4.05 pipeline, and gate both exports.
#
#   scripts/build_web.sh <persona>        e.g. scripts/build_web.sh atlas
#
# Pipeline (each step is a separate tool in scripts/; see web-profile.json):
#   1. web_profile.py   (Blender) decimate + texture size + clip subset
#   2. transcode_images.py        PNG -> JPEG (LOD0; LOD1 flattens instead)
#   3. gltfpack -cc               meshopt compression (tools/gltfpack)
#   4. patch_extras.py            restore the Armature extras gltfpack drops
#   5. validate_glb.py --gate     the size gate — this script FAILS if it does
#   6. load_test_web.mjs          decoder-equipped load test
set -e
cd "$(dirname "$0")/.."
P="${1:?usage: build_web.sh <persona>}"
BL="${BLENDER:-$HOME/workspace/tools/blender/blender-5.2.2-linux-x64/blender}"
SRC="outputs-v2/$P.glb"
[ -f "$SRC" ] || { echo "no such factory GLB: $SRC" >&2; exit 2; }
mkdir -p outputs-web
# Intermediates live in the tree, NOT /tmp: on this VM /tmp is a small tmpfs
# shared with other work and it fills (a builder-1 export died of it,
# 2026-11-02). The work dir is removed on exit either way.
TMP="$PWD/outputs-web/.work-$P"
rm -rf "$TMP"; mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT
# Blender stages some work through TMPDIR too; keep that in the tree as well.
export TMPDIR="$TMP/blendertmp"
mkdir -p "$TMPDIR"

# --- LOD0: all clips, 256 px textures transcoded to JPEG, meshopt
"$BL" -b --python scripts/web_profile.py -- \
  --input "$SRC" --profile lod0 --output "$TMP/$P-lod0-raw.glb" 2>/dev/null \
  | grep WEB_PROFILE_SUMMARY
python3 scripts/transcode_images.py "$TMP/$P-lod0-raw.glb" "$TMP/$P-lod0-jpg.glb"
./tools/gltfpack/gltfpack -i "$TMP/$P-lod0-jpg.glb" -o "outputs-web/$P--lod0.glb" -cc -ke
python3 scripts/patch_extras.py "outputs-web/$P--lod0.glb" "$SRC"
python3 scripts/validate_glb.py --profile lod0 --gate "outputs-web/$P--lod0.glb" > /dev/null
echo "LOD0 GATE PASS: outputs-web/$P--lod0.glb"
node scripts/load_test_web.mjs "outputs-web/$P--lod0.glb" 2>/dev/null

# --- LOD1: idle/walk/gather, flat colours (profile flattens), 15 Hz resample
"$BL" -b --python scripts/web_profile.py -- \
  --input "$SRC" --profile lod1 --output "$TMP/$P-lod1-raw.glb" 2>/dev/null \
  | grep WEB_PROFILE_SUMMARY
./tools/gltfpack/gltfpack -i "$TMP/$P-lod1-raw.glb" -o "outputs-web/$P--lod1.glb" -cc -ke -af 15
python3 scripts/patch_extras.py "outputs-web/$P--lod1.glb" "$SRC"
python3 scripts/validate_glb.py --profile lod1 --gate "outputs-web/$P--lod1.glb" > /dev/null
echo "LOD1 GATE PASS: outputs-web/$P--lod1.glb"
node scripts/load_test_web.mjs "outputs-web/$P--lod1.glb" 2>/dev/null
