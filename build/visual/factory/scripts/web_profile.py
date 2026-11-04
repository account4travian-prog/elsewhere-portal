#!/usr/bin/env python3
"""Web-profile exporter — Portal extension of the Office factory (M4.05 / SE-4.2).

Takes a factory GLB (desktop budget: ~1 MB / ~10k tris) and re-exports it
under a web profile from ../web-profile.json (plan section 5.2):

  lod0  <= 120 KB / <= 2,500 tris, textures <= 256 px, all clips
  lod1  <=  40 KB / <=   800 tris, textures <= 128 px, clips idle/walk/gather
        (gather stands in for SE-4.2's talk-pose until the talk clip exists;
        see web-profile.json)

Levers, in the order the plan names them: texture atlas size, decimation,
shared vertex-colour materials (--flatten-images drops image textures and
keeps each material's base colour), meshopt export (not available in this
environment — recorded in the factory STATUS, never silently skipped).

This is a post-processor: the factory build scripts stay the source of the
figure; this script re-imports a delivered GLB and re-exports it. That also
exercises the Office validation culture's third leg (Blender re-import
round-trip) on every run.

Usage (Blender headless):
  blender -b --python scripts/web_profile.py -- \
      --input outputs-v2/atlas.glb --profile lod0 \
      --output outputs-web/atlas--lod0.glb [--flatten-images]

Prints one JSON summary line at the end. The size gate itself is
validate_glb.py --profile <p> --gate; this script never grades its own work.
"""
import bpy, json, os, sys

argv = sys.argv[sys.argv.index("--") + 1:]
args = {}
i = 0
while i < len(argv):
    if argv[i].startswith("--"):
        key = argv[i][2:]
        if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
            args[key] = argv[i + 1]; i += 2
        else:
            args[key] = True; i += 1
    else:
        i += 1

HERE = os.path.dirname(os.path.abspath(__file__))
PROFILES = json.load(open(os.path.join(HERE, "..", "web-profile.json")))["profiles"]
PROFILE_NAME = args["profile"]
PROF = PROFILES[PROFILE_NAME]
SRC = os.path.abspath(args["input"])
OUT = os.path.abspath(args["output"])
FLATTEN = bool(args.get("flatten-images")) or bool(PROF.get("flattenImages"))

summary = {"input": os.path.basename(SRC), "profile": PROFILE_NAME}

# ---------------------------------------------------------------- import
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
summary["actions_found"] = sorted(a.name for a in bpy.data.actions)

# ------------------------------------------------------- clip subset (lod1)
keep_clips = PROF.get("clips", "all")
if keep_clips != "all":
    keep = set(keep_clips)
    for obj in bpy.data.objects:
        ad = getattr(obj, "animation_data", None)
        if not ad:
            continue
        if ad.action and ad.action.name not in keep:
            ad.action = None
        for track in list(ad.nla_tracks):
            strips = [s for s in track.strips
                      if not s.action or s.action.name not in keep]
            # remove strips whose action is not kept (whole track if emptied)
            for s in strips:
                track.strips.remove(s)
            if len(track.strips) == 0:
                ad.nla_tracks.remove(track)
    for act in list(bpy.data.actions):
        if act.name not in keep and act.users == 0:
            bpy.data.actions.remove(act)
    summary["actions_kept"] = sorted(a.name for a in bpy.data.actions)

# ---------------------------------------------------------------- textures
tex_max = PROF.get("textureMaxPx")
scaled = []
for img in list(bpy.data.images):
    if img.size[0] == 0:
        continue
    if FLATTEN:
        continue
    if tex_max and max(img.size) > tex_max:
        w, h = img.size
        f = tex_max / max(w, h)
        img.scale(max(1, round(w * f)), max(1, round(h * f)))
        scaled.append(img.name)
summary["textures_scaled"] = scaled
# NOTE: texture *bytes* are not handled here. This exporter re-encodes the
# factory's packed images as PNG regardless of the image datablock's
# file_format (observed: byte-identical output with the format set to
# JPEG). The PNG->JPEG transcode is scripts/transcode_images.py, the next
# step of the profile pipeline.

if FLATTEN:
    # Shared vertex-colour materials (plan 5.2 lever): drop image textures,
    # keep every material's existing base colour — the figure goes flat.
    # M4.10 extension: a textured material exports no baseColorFactor, so
    # on re-import its Principled base colour is Blender's 0.8 grey default
    # and "existing base colour" greys the whole figure. Citizen masters
    # (scripts/build_citizen.py) carry the intended flat in the material
    # extras key "flat_colour" (imported back as a custom property); when
    # present, restore it as the base colour before dropping the texture.
    def _hex_rgba(h):
        h = h.lstrip("#")
        out = []
        for i in (0, 2, 4):
            c = int(h[i:i + 2], 16) / 255.0
            out.append(((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92)
        return tuple(out) + (1.0,)
    dropped = 0
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        for node in list(m.node_tree.nodes):
            if node.type == "TEX_IMAGE":
                m.node_tree.nodes.remove(node)
                dropped += 1
        flat = m.get("flat_colour")
        if flat:
            bsdf = next((n for n in m.node_tree.nodes
                         if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf:
                bsdf.inputs["Base Color"].default_value = _hex_rgba(flat)
    for img in list(bpy.data.images):
        if img.users == 0:
            bpy.data.images.remove(img)
    summary["textures_flattened"] = dropped

# -------------------------------------------------------------- decimation
def total_tris():
    t = 0
    for o in meshes:
        o.data.calc_loop_triangles()
        t += len(o.data.loop_triangles)
    return t

budget = PROF.get("maxTriangles")
summary["tris_before"] = total_tris()
if budget:
    for _pass in range(4):
        cur = total_tris()
        if cur <= budget:
            break
        ratio = (budget * PROF.get("decimateTarget", 0.95)) / cur
        min_tris = PROF.get("decimateMinTris", 24)
        for o in meshes:
            o.data.calc_loop_triangles()
            if len(o.data.loop_triangles) < min_tris:
                continue  # tiny parts (whiskers, beans): decimating breaks them for ~no gain
            if o.data.shape_keys:
                continue
            arms = [(m.name, m.object) for m in o.modifiers if m.type == "ARMATURE"]
            for name, _obj in arms:
                o.modifiers.remove(o.modifiers[name])
            mod = o.modifiers.new("webprofile_decimate", "DECIMATE")
            mod.decimate_type = "COLLAPSE"
            mod.ratio = ratio
            mod.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = o
            o.select_set(True)
            bpy.ops.object.modifier_apply(modifier=mod.name)
            o.select_set(False)
            for _name, aobj in arms:
                m2 = o.modifiers.new("Armature", "ARMATURE")
                m2.object = aobj
    summary["tris_after"] = total_tris()

# ------------------------------------------------------------------ export
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB",
                          export_animations=True, export_skins=True)
summary["output"] = os.path.basename(OUT)
summary["bytes_out"] = os.path.getsize(OUT)
print("WEB_PROFILE_SUMMARY " + json.dumps(summary))
