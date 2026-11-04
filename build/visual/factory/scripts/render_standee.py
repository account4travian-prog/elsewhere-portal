#!/usr/bin/env python3
"""Standee render stage — Portal M4.09 / Design A6 (Blender headless).

Renders the raw passes the finisher (scripts/finish_standees.py) turns
into standee sprites, per Production 7.4 / Rendering 8.2:

  source      the kit's master GLB (outputs-v2/<kit>.glb) — the export
              the approved LOD0 is itself derived from, so the standee
              is the same kit the scene ships. Rendering 8.2 says "each
              approved LOD0 kit is posed and captured"; posing the LOD0
              file itself is not possible today: on Blender re-import
              the LOD0 alpha-lead's skirt skinning breaks (tentacle
              skirt renders shortened, its sucker discs scattered as
              debris below the figure — comparison renders kept with
              the M4.09 STATUS entry), while the v2 master of the same
              kit poses cleanly. Whether the defect is in the LOD0
              file (would also show in three.js — M4.16 to check) or
              only in Blender's meshopt re-import, sheets are Blender
              products of the finished figure (Production 7.4), so the
              master is the correct source. Recorded deviation, not a
              silent substitution.
  camera      orthographic, canonical view: azimuth from the south,
              elevation 35 degrees (Rendering 4.2), transparent background,
              512x512 masters.
  poses       a data table over the kit's own clips (below). The factory
              kit carries idle/sit/type/stand/walk/knock/wait/gather
              (validate_glb.py's REQUIRED_CLIPS). Two of the plan's named
              standee poses have no clip anywhere in the factory —
              carry and asleep (SE-4.2's new-clip line is still open) —
              so they are NOT rendered and NOT silently substituted;
              they are recorded as gaps in render-info.json and in the
              factory STATUS. talk renders from gather, the talking loop,
              under the same recorded stand-in M4.05 set for LOD1.
  outline     each pose renders twice: the figure pass, and a hull pass —
              a +3% copy of every mesh in flat outline-brown #8A6D5A
              (palette 2.2), composited BEHIND the figure by the finisher
              (Production 7.4's inverted hull, as two passes so the
              figure's own pixels are never touched).
  portrait    rest pose, head-and-shoulders framing (factory head-shot
              precedent: target z 1.52, ortho 1.05), same two passes,
              but at the canonical 35-degree elevation.

Engine: BLENDER_WORKBENCH, shading colour from textures (figure pass) /
material diffuse (hull pass), studio light, no shadows, no cavity — a
flat cutout register; the ground shadow is the separate shared sprite
(Production 7.4). Workbench is deterministic on this host, which the
pipeline's rerun test relies on. The 3D scene's toon banding is a
three.js material; exact band conformance is the scene freeze test's
job (M4.16), not this stage's claim.

Usage (Blender headless):
  blender -b --python scripts/render_standee.py -- \
      --input outputs-v2/atlas.glb --persona atlas \
      --outdir outputs-web/standees/.work-atlas
Prints STANDEE_RENDER_SUMMARY <json> and writes render-info.json.
"""
import bpy, json, math, os, sys

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

PERSONA = args["persona"]
OUTDIR = os.path.abspath(args["outdir"])
os.makedirs(OUTDIR, exist_ok=True)

# pose name -> (clip, frame rule). Rules resolve against the clip's own
# frame range at import: "end" = settled final frame (factory sit
# precedent), ("frac", f) = start + f*(end-start) (walk uses 0.25, the
# factory's walk-check precedent end//4), ("plus", n) = start + n
# (work uses the factory's type-check frame, start+6).
POSES = {
    "idle":       ("idle",   ("frac", 0.40)),
    "walk-frame": ("walk",   ("frac", 0.25)),
    "sit":        ("sit",    "end"),
    "work":       ("type",   ("plus", 6)),
    "talk":       ("gather", ("frac", 0.30)),
}
GAP_POSES = {
    "carry":  "no carry clip exists in the factory kit (SE-4.2 new-clip "
              "line still open) — not rendered, not substituted",
    "asleep": "no asleep clip exists in the factory kit (SE-4.2 new-clip "
              "line still open) — not rendered, not substituted",
}
TALK_STANDIN = ("talk renders from the gather clip (UAL Idle_Talking_Loop) "
                "— the recorded talk-pose stand-in from M4.05 / "
                "web-profile.json, not a talk clip")

OUTLINE_HEX = "8A6D5A"  # palette 2.2: 2D outline brown

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def hex_linear(h):
    return tuple(srgb_to_linear(int(h[j:j + 2], 16) / 255.0)
                 for j in (0, 2, 4))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24
bpy.ops.import_scene.gltf(filepath=os.path.abspath(args["input"]))

arm = next((o for o in scene.objects if o.type == "ARMATURE"), None)
if arm is None:
    raise RuntimeError("no armature in imported GLB")
# Exclude non-figure helper geometry. The LOD0 exports carry a 2 m
# unskinned, material-less node named "Icosphere" (no parent, no
# armature modifier, no material — invisible in the source's own
# renders, which is why the figure pass looked clean while its
# outline-material hull copy painted a giant brown sphere over the
# first sheets; caught on the contact sheet, 2026-11-02). Rule: a mesh
# with no materials AND no armature modifier is not part of the figure.
# Excluded meshes are named in render-info.json, never silently dropped.
all_meshes = [o for o in scene.objects if o.type == "MESH"]
def is_figure(o):
    return bool(o.data.materials) or \
        any(m.type == "ARMATURE" for m in o.modifiers)
meshes = [o for o in all_meshes if is_figure(o)]
SKIPPED = [o.name for o in all_meshes if not is_figure(o)]
if arm.animation_data is None:
    arm.animation_data_create()
ad = arm.animation_data

def set_pose(clip_name):
    act = bpy.data.actions.get(clip_name)
    if act is None:
        raise RuntimeError(f"clip {clip_name!r} missing from kit")
    ad.action = act
    if getattr(act, "slots", None) and len(act.slots):
        ad.action_slot = act.slots[0]
    return act

def resolve_frame(act, rule):
    start, end = act.frame_range[0], act.frame_range[1]
    if rule == "end":
        frame = end
    elif rule[0] == "frac":
        frame = start + rule[1] * (end - start)
    elif rule[0] == "plus":
        frame = start + rule[1]
    else:
        raise ValueError(rule)
    return int(round(frame)), (float(start), float(end))

# --- inverted hull copies (+3% about the ground origin, outline material)
outline_mat = bpy.data.materials.new("sheet-outline")
outline_mat.diffuse_color = (*hex_linear(OUTLINE_HEX), 1.0)
hull_empty = bpy.data.objects.new("sheet-hull-scale", None)
scene.collection.objects.link(hull_empty)
hull_empty.scale = (1.03, 1.03, 1.03)
hulls = []
for o in meshes:
    h = o.copy()
    h.data = o.data.copy()
    h.data.materials.clear()
    h.data.materials.append(outline_mat)
    scene.collection.objects.link(h)
    h.parent = hull_empty
    hulls.append(h)

# --- camera: canonical view (azimuth from south, elevation 35 deg)
ELEV = math.radians(35)
cam_data = bpy.data.cameras.new("sheet-cam")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("sheet-cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

def aim(target, ortho_scale, dist=6.0):
    cam.location = (target[0], target[1] - math.cos(ELEV) * dist,
                    target[2] + math.sin(ELEV) * dist)
    cam.rotation_euler = (math.radians(90 - 35), 0, 0)
    cam_data.ortho_scale = ortho_scale

# --- render setup
scene.render.engine = "BLENDER_WORKBENCH"
shading = scene.display.shading
shading.light = "STUDIO"
shading.show_shadows = False
shading.show_cavity = False
scene.display.render_aa = "FXAA"
scene.render.film_transparent = True
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"

def render_pass(name, hull_pass):
    for o in meshes:
        o.hide_render = hull_pass
    for h in hulls:
        h.hide_render = not hull_pass
    shading.color_type = "MATERIAL" if hull_pass else "TEXTURE"
    scene.render.filepath = os.path.join(OUTDIR, name)
    bpy.ops.render.render(write_still=True)

info = {"persona": PERSONA, "engine": "BLENDER_WORKBENCH",
        "camera": {"projection": "ORTHO", "azimuth": "south",
                   "elevation_deg": 35, "master_px": 512},
        "skipped_hidden_meshes": SKIPPED,
        "poses": {}, "gap_poses": GAP_POSES, "notes": [TALK_STANDIN]}

head_bone = arm.pose.bones.get("head")
signatures = {}
for pose, (clip, rule) in POSES.items():
    act = set_pose(clip)
    frame, rng = resolve_frame(act, rule)
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    aim((0, 0, 0.95), 2.3)
    if head_bone:
        signatures[pose] = tuple(round(v, 3) for v in
                                 (arm.matrix_world @ head_bone.matrix).translation)
    render_pass(f"{pose}--fig.png", hull_pass=False)
    render_pass(f"{pose}--hull.png", hull_pass=True)
    info["poses"][pose] = {"clip": clip, "clip_range": rng, "frame": frame}

# portrait: rest pose (no action), head-and-shoulders
ad.action = None
scene.frame_set(0)
bpy.context.view_layer.update()
aim((0, 0, 1.52), 1.05)
render_pass("portrait--fig.png", hull_pass=False)
render_pass("portrait--hull.png", hull_pass=True)
info["portrait"] = {"clip": None, "frame": 0, "target_z": 1.52,
                    "ortho_scale": 1.05}

distinct = len(set(signatures.values()))
if distinct < 3:
    raise RuntimeError(f"pose application suspect: only {distinct} distinct "
                       f"head positions across {len(signatures)} poses")
info["pose_check"] = {"distinct_head_positions": distinct,
                      "of": len(signatures)}
with open(os.path.join(OUTDIR, "render-info.json"), "w") as f:
    json.dump(info, f, indent=1, sort_keys=True)
print("STANDEE_RENDER_SUMMARY " + json.dumps(
    {"persona": PERSONA, "poses": list(POSES), "frames":
     {p: info["poses"][p]["frame"] for p in POSES},
     "pose_check": info["pose_check"]}))
