#!/usr/bin/env python3
"""Citizen kit builder — Portal M4.10 (figure kits in civic order).

Builds one Portal citizen master GLB from the CC0 spine:

  base      a KayKit Adventurers character (Rig_Medium, 23 bones) —
            the spine's only gated-proportion-viable humanoid family
            (Quaternius bases measured and rejected for gated bodies;
            see kits/citizens/README-CAST.md for the evidence table).
  clips     KayKit Character Animations Rig_Medium sets, renamed to
            the factory contract names; wait derived from idle at
            stride 2 (the factory's own precedent); knock authored
            procedurally (as the factory authors its knock).
  chibi     the intake procedure for this rig family, one parameter
            set for the whole cast (chibi gate README's intake loop):
            head mesh split at the jaw line (z=1.50) into head +
            hairfall; head zone x1.30 about the neck pivot (Bible
            factor); below-neck zone z x0.75 about the same pivot;
            arms x0.82 about the shoulder (Bible factor); hands x1.15
            about the wrist (Bible factor); clavicle factor not
            applicable (Rig_Medium has no clavicle bones); then
            re-grounded and scaled to the Bible's 1.8-unit citizen.
  palette   the base's palette-atlas texture recoloured by role:
            per-mesh UV-footprint masks x original-colour families
            (skin / hair / garment carrier / leather / detail), each
            remapped luminance-preserved to the kit's targets; the
            garment carrier is the citizen's identity colour.

Usage (Blender headless):
  blender -b --python scripts/build_citizen.py -- \
      --kit kits/citizens/atlas-meridian.json \
      --out outputs-v2/atlas-meridian.glb
Prints CITIZEN_BUILD_SUMMARY <json> at the end.
"""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector

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

FACTORY = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
PORTAL = os.path.abspath(os.path.join(FACTORY, "..", "..", ".."))
PACKS = os.path.join(PORTAL, "assets-src", "packs")
CHAR_DIR = os.path.join(PACKS, "kaykit-adventurers",
                        "KayKit_Adventurers_2.0_FREE", "Characters", "gltf")
ANIM_DIR = os.path.join(PACKS, "kaykit-animations",
                        "KayKit_Character_Animations_1.1", "Animations", "gltf", "Rig_Medium")
PROP_DIR = os.path.join(PACKS, "kaykit-adventurers",
                        "KayKit_Adventurers_2.0_FREE", "Assets", "gltf")

KIT = json.load(open(os.path.join(FACTORY, args["kit"])))
SLUG = KIT["citizen_id"]
BUILD = KIT["build"]
BASE = BUILD["base_character"]
OUT = os.path.abspath(args["out"])

# ------------------------------------------------------- chibi intake set
PIVOT_Z = 1.241      # head-bone head height on Rig_Medium (all six bases)
S_HEAD = 1.19        # head factor about the neck pivot — the Bible's
                     # printed 1.30 was set against a normal-proportioned
                     # rig; at 1.30 the cast's measured shares land
                     # 0.42-0.45 (three bases over the production band).
                     # Intake-tuned once for the Rig_Medium family to
                     # 1.19, which centres all six bases at 0.41-0.43
                     # (gate README intake loop; measured per kit).
T_BELOW = 0.75       # below-neck vertical factor (intake-tuned; Bible
                     # names thigh/shin 0.78 for a normal-proportioned
                     # rig — Rig_Medium arrives pre-chibi, so the zone
                     # factor is tuned once for the family, per the
                     # gate README's intake loop, and recorded here)
ARM_F = 0.82         # Bible arm factor, about the shoulder joint
HAND_F = 1.15        # Bible hand factor, about the wrist joint
Z_SPLIT = 1.46       # jaw line: head mesh split into head + hairfall.
                     # Intake calibration for the Rig_Medium family
                     # (M4.10): at 1.50 with face-centroid selection the
                     # Knight head measured 0.449 (over band) — its big
                     # low beard faces drag the cut down. An exact bisect
                     # cut at 1.46 centres all six bases at 0.41-0.43.
TARGET_H = 1.8       # Bible finished citizen height

BONE_RENAME = {
    "root": "extra.root", "hips": "hips", "spine": "spine", "chest": "chest",
    "head": "head",
    "upperarm.l": "arm.L", "lowerarm.l": "forearm.L", "wrist.l": "extra.wrist.L",
    "hand.l": "hand.L", "handslot.l": "extra.handslot.L",
    "upperleg.l": "leg.L", "lowerleg.l": "shin.L", "foot.l": "extra.foot.L",
    "toes.l": "extra.toes.L",
    "upperarm.r": "arm.R", "lowerarm.r": "forearm.R", "wrist.r": "extra.wrist.R",
    "hand.r": "hand.R", "handslot.r": "extra.handslot.R",
    "upperleg.r": "leg.R", "lowerleg.r": "shin.R", "foot.r": "extra.foot.R",
    "toes.r": "extra.toes.R",
}
HEAD_ZONE_SUFFIXES = ("_Head", "_Helmet", "_Mask", "_Hat", "_BearHat")  # scaled with the head
CLIPMAP = {  # factory contract name -> KayKit source action
    "idle": "Idle_A", "walk": "Walking_A", "gather": "Idle_B",
    "sit": "Sit_Floor_Down", "stand": "Sit_Floor_StandUp", "type": "Working_A",
}
ANIM_FILES = ["Rig_Medium_General.glb", "Rig_Medium_MovementBasic.glb",
              "Rig_Medium_Simulation.glb", "Rig_Medium_Tools.glb"]

summary = {"citizen": SLUG, "base": BASE}

# ---------------------------------------------------------------- helpers
def srgb_lum(rgb):
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[j:j + 2], 16) / 255.0 for j in (0, 2, 4))

def shade(hexcol, f):
    r, g, b = hex_rgb(hexcol)
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(c * 255 * f))) for c in (r, g, b))

IDENT = BUILD["garment_colour"]
IDENT_DARK = shade(IDENT, 0.68)
IDENT_DEEP = shade(IDENT, 0.8)
SKIN = BUILD["skin_colour"]
HAIR = BUILD["hair_colour"]

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]

def figure_meshes():
    return [o for o in bpy.data.objects if o.type == "MESH" and o.name != "Icosphere"]

# ---------------------------------------------------------------- import base
bpy.ops.wm.read_factory_settings(use_empty=True)
import_glb(os.path.join(CHAR_DIR, BASE + ".glb"))
ico = bpy.data.objects.get("Icosphere")
if ico:
    bpy.data.objects.remove(ico, do_unlink=True)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
summary["bones_in"] = len(arm.data.bones)

# ---------------------------------------------------------------- donor parts
gear = BUILD.get("gear", {})
if gear.get("donor_helmet"):
    new = import_glb(os.path.join(CHAR_DIR, "Knight.glb"))
    for o in new:
        if o.type == "MESH" and o.name == "Knight_Helmet":
            o.name = "Donor_Helmet"
            for m in o.modifiers:
                if m.type == "ARMATURE":
                    m.object = arm
        else:
            bpy.data.objects.remove(o, do_unlink=True)
if gear.get("donor_hat"):
    new = import_glb(os.path.join(CHAR_DIR, "Barbarian.glb"))
    for o in new:
        if o.type == "MESH" and o.name == "Barbarian_BearHat":
            o.name = "Donor_Hat"
            for m in o.modifiers:
                if m.type == "ARMATURE":
                    m.object = arm
        else:
            bpy.data.objects.remove(o, do_unlink=True)

# ---------------------------------------------------------------- gear drops
prefix = BASE.replace("_Hooded", "Hooded")  # Rogue_Hooded -> RogueHooded mesh prefix
drop = []
if gear.get("hat") is not True:
    # The Barbarian's hat mesh is named *_BearHat, not *_Hat — the first
    # batch shipped it unrenamed and un-dropped (it slid over the face
    # under the below-neck squash before anyone saw a render).
    drop.append(prefix + "_Hat")
    drop.append(prefix + "_BearHat")
if not gear.get("cape", True):
    drop.append(prefix + "_Cape")
if gear.get("visor") is False:
    drop.append(prefix + "_HelmetVisor")
if gear.get("quiver") is False:
    drop.append(prefix + "_Quiver")
if gear.get("mask") is False:
    drop.append(prefix + "_Mask")
for name in drop:
    o = bpy.data.objects.get(name)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)
summary["dropped"] = [n for n in drop if bpy.data.objects.get(n) is None]

# ---------------------------------------------------------------- animations
for f in ANIM_FILES:
    new = import_glb(os.path.join(ANIM_DIR, f))
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
kept_actions = {}
for contract, src in CLIPMAP.items():
    a = bpy.data.actions.get(src)
    if a is None:
        raise RuntimeError(f"source clip {src} not found")
    a.name = contract
    a.use_fake_user = True
    kept_actions[contract] = a
def action_fcurves(a):
    """All fcurves of a (possibly layered) action, Blender 5.x API."""
    out = []
    for layer in a.layers:
        for strip in layer.strips:
            for slot in a.slots:
                try:
                    cb = strip.channelbag(slot)
                except Exception:
                    cb = None
                if cb:
                    out.extend(list(cb.fcurves))
    return out

# wait: derived from idle at stride 2 (factory precedent: Idle_Loop@stride2)
src_idle = kept_actions["idle"]
wait = src_idle.copy()
wait.name = "wait"
wait.use_fake_user = True
f0, f1 = int(src_idle.frame_range[0]), int(src_idle.frame_range[1])
for fc in action_fcurves(wait):
    for kp in list(fc.keyframe_points):
        f = int(round(kp.co.x))
        if (f - f0) % 2 == 1 and f != f1:
            fc.keyframe_points.remove(kp)
        else:
            kp.co.x = f0 + (f - f0) // 2
            kp.handle_left.x = f0 + (kp.handle_left.x - f0) / 2
            kp.handle_right.x = f0 + (kp.handle_right.x - f0) / 2
            kp.interpolation = 'LINEAR'
kept_actions["wait"] = wait
for a in list(bpy.data.actions):
    if a not in kept_actions.values() and a.name not in kept_actions:
        bpy.data.actions.remove(a)
summary["clips"] = sorted(kept_actions)

# ------------------------------------------- rename rig to the factory contract
for old, new in BONE_RENAME.items():
    if old in arm.data.bones:
        arm.data.bones[old].name = new
for o in figure_meshes():
    for vg in o.vertex_groups:
        if vg.name in BONE_RENAME:
            vg.name = BONE_RENAME[vg.name]
for a in kept_actions.values():
    for fc in action_fcurves(a):
        for old, new in BONE_RENAME.items():
            fc.data_path = fc.data_path.replace(
                f'pose.bones["{old}"]', f'pose.bones["{new}"]')

# ------------------------------------------------- split head mesh at the jaw
head_obj = next(o for o in figure_meshes() if o.name.endswith("_Head"))
bpy.context.view_layer.objects.active = head_obj
head_obj.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
# Exact cut at the jaw plane: bisect adds an edge loop ON the plane so
# no face straddles it; then each part is a copy with the other side's
# verts deleted (deleting verts removes only that side's faces, and
# both parts keep the shared boundary loop — no gap). Two earlier
# attempts failed measurably: face-centroid selection lets large low
# faces (the Knight's beard plates) drag the effective cut ~0.07 below
# the plane (Knight measured 0.449, over band), and separate-by-vertex-
# selection leaves the first below-plane ring attached to the head.
bpy.ops.mesh.bisect(plane_co=(0, 0, Z_SPLIT), plane_no=(0, 0, 1),
                    clear_outer=False, clear_inner=False)
bpy.ops.object.mode_set(mode="OBJECT")
import bmesh as _bmesh

def _delete_verts(obj, pred):
    bm = _bmesh.new()
    bm.from_mesh(obj.data)
    vs = [v for v in bm.verts if pred(v.co.z)]
    _bmesh.ops.delete(bm, geom=vs, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()

hairfall = head_obj.copy()
hairfall.data = head_obj.data.copy()
bpy.context.scene.collection.objects.link(hairfall)
_delete_verts(head_obj, lambda z: z < Z_SPLIT - 1e-6)
_delete_verts(hairfall, lambda z: z > Z_SPLIT + 1e-6)
hairfall.name = "hairfall"
head_obj.name = "head"
head_obj.select_set(False); hairfall.select_set(False)

# ------------------------------------------------------- chibi zone transform
bones = {b.name: b for b in arm.data.bones}
shoulder = {s: Vector(bones[f"arm.{s}"].head_local) for s in ("L", "R")}
wrist = {s: Vector(bones[f"extra.wrist.{s}"].head_local) for s in ("L", "R")}

def head_zone(o):
    if o.name in ("head", "hairfall", "Donor_Helmet"):
        return True
    return any(o.name.endswith(sfx) for sfx in HEAD_ZONE_SUFFIXES)

for o in figure_meshes():
    hz = head_zone(o)
    is_arm = any(o.name.endswith(sfx) for sfx in ("_ArmLeft", "_ArmRight"))
    side = None
    if is_arm:
        side = "L" if o.name.endswith("Left") else "R"
    vg_hand = None
    if is_arm:
        vg_hand = o.vertex_groups.get(f"hand.{side}")
    for v in o.data.vertices:
        p = Vector(v.co)
        if hz:
            p = Vector((p.x * S_HEAD, p.y * S_HEAD,
                        PIVOT_Z + (p.z - PIVOT_Z) * S_HEAD))
        else:
            z = PIVOT_Z + (p.z - PIVOT_Z) * T_BELOW
            x, y = p.x, p.y
            if is_arm:
                sh = shoulder[side]
                x = sh.x + (x - sh.x) * ARM_F
                if vg_hand and v.groups:
                    w = next((g.weight for g in v.groups
                              if g.group == vg_hand.index), 0.0)
                    if w >= 0.5:
                        wr = wrist[side]
                        x = wr.x + (x - wr.x) * HAND_F
                        y = wr.y + (y - wr.y) * HAND_F
                        z = wr.z + (z - wr.z) * HAND_F
            p = Vector((x, y, z))
        v.co = p

# bones follow the same maps (edit mode)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
eb = arm.data.edit_bones
for name, b in eb.items():
    for attr in ("head", "tail"):
        p = Vector(getattr(b, attr))
        base_name = name
        if base_name in ("head",):
            p = Vector((p.x * S_HEAD, p.y * S_HEAD,
                        PIVOT_Z + (p.z - PIVOT_Z) * S_HEAD))
        else:
            z = PIVOT_Z + (p.z - PIVOT_Z) * T_BELOW
            x, y = p.x, p.y
            if any(base_name.startswith(s) for s in
                   ("arm.", "forearm.", "extra.wrist.", "hand.", "extra.handslot.")):
                s = "L" if base_name.endswith(".L") else "R"
                sh = shoulder[s]
                x = sh.x + (x - sh.x) * ARM_F
            p = Vector((x, y, z))
        setattr(b, attr, p)
bpy.ops.object.mode_set(mode="OBJECT")

# re-ground + global scale to TARGET_H
def all_bounds():
    zs = []
    for o in figure_meshes():
        for v in o.data.vertices:
            zs.append(v.co.z)
    return min(zs), max(zs)

zmin, zmax = all_bounds()
for o in figure_meshes():
    for v in o.data.vertices:
        v.co.z -= zmin
bpy.ops.object.mode_set(mode="EDIT")
for name, b in eb.items():
    b.head.z -= zmin; b.tail.z -= zmin
bpy.ops.object.mode_set(mode="OBJECT")
zmin, zmax = all_bounds()
g = TARGET_H / (zmax - zmin)
for o in figure_meshes():
    for v in o.data.vertices:
        v.co = Vector(v.co) * g
bpy.ops.object.mode_set(mode="EDIT")
for name, b in eb.items():
    b.head = Vector(b.head) * g; b.tail = Vector(b.tail) * g
bpy.ops.object.mode_set(mode="OBJECT")
summary["height_after"] = round(all_bounds()[1] - all_bounds()[0], 4)
summary["global_scale"] = round(g, 4)

# ------------------------------------------------------------- rename meshes
PART_NAMES = {
    prefix + "_Body": "body", prefix + "_ArmLeft": "arm_left",
    prefix + "_ArmRight": "arm_right", prefix + "_LegLeft": "leg_left",
    prefix + "_LegRight": "leg_right", prefix + "_Cape": "cape",
    prefix + "_Helmet": "helmet", prefix + "_Mask": "mask",
    prefix + "_Hat": "hat", prefix + "_BearHat": "hat",
    prefix + "_Quiver": "quiver", "Donor_Helmet": "helmet",
    "Donor_Hat": "hat",
}
for o in figure_meshes():
    if o.name in PART_NAMES:
        o.name = PART_NAMES[o.name]
summary["meshes"] = sorted(o.name for o in figure_meshes())

# ------------------------------------------------------- pre-decimation pass
# Bring the master to ~5k tris with the head protected, so the web
# profile's own decimation to the LOD budgets stays gentle.
DECIMATE = {"head": 0.80, "hairfall": 0.70, "body": 0.55, "arm_left": 0.55,
            "arm_right": 0.55, "leg_left": 0.55, "leg_right": 0.55,
            "cape": 0.50, "helmet": 0.60, "mask": 0.70, "quiver": 0.60}
for o in figure_meshes():
    ratio = DECIMATE.get(o.name)
    if not ratio:
        continue
    mod = o.modifiers.new("citizen_decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    o.select_set(False)

# ------------------------------------------------------------- knock (procedural)
# Authored on the renamed rig, factory-style euler keyframes. A forearm
# raise with two dips + a small head nod; reads as a knock at town
# scale. Marked procedural_factory in the kit's clip_sources.
knock = bpy.data.actions.new("knock")
knock.use_fake_user = True
kept_actions["knock"] = knock
if not arm.animation_data:
    arm.animation_data_create()
arm.animation_data.action = knock
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")
pb = arm.pose.bones
D = math.radians
KNOCK_KEYS = [  # frame -> (forearm.R euler deg, arm.R euler deg, head euler deg)
    (0,  (0, 0, 0), (0, 0, 0), (0, 0, 0)),
    (4,  (-95, 0, 0), (-25, 0, 0), (4, 0, 0)),
    (7,  (-80, 0, 0), (-25, 0, 0), (4, 0, 0)),
    (10, (-95, 0, 0), (-25, 0, 0), (5, 0, 0)),
    (13, (-80, 0, 0), (-25, 0, 0), (4, 0, 0)),
    (16, (-95, 0, 0), (-25, 0, 0), (5, 0, 0)),
    (24, (0, 0, 0), (0, 0, 0), (0, 0, 0)),
]
for frame, fe, ae, he in KNOCK_KEYS:
    for bname, e in (("forearm.R", fe), ("arm.R", ae), ("head", he)):
        b = pb[bname]
        b.rotation_mode = "XYZ"
        b.rotation_euler = (D(e[0]), D(e[1]), D(e[2]))
        b.keyframe_insert("rotation_euler", frame=frame)
bpy.ops.object.mode_set(mode="OBJECT")
arm.animation_data.action = None

# ------------------------------------------------------------ texture remap
body_mat = bpy.data.objects["body"].data.materials[0]
tex_img = next(n.image for n in body_mat.node_tree.nodes
               if n.type == "TEX_IMAGE" and n.image)
tex_img.scale(512, 512)
W = H = 512

def uv_mask(obj):
    """Rasterise a mesh's UV footprint at 512^2 (pixel rows = v * H,
    Blender image order: row 0 is the image bottom, matching UV v=0)."""
    mask = np.zeros((H, W), dtype=bool)
    uv = obj.data.uv_layers.active
    if not uv:
        return mask
    loops = np.empty((len(obj.data.loops), 2), dtype=np.float64)
    uv.data.foreach_get("uv", loops.ravel())
    for p in obj.data.polygons:
        pts = loops[list(p.loop_indices)]
        tris = [(pts[0], pts[j], pts[j + 1]) for j in range(1, len(pts) - 1)]
        for a, b, c in tris:
            xs = [a[0], b[0], c[0]]; ys = [a[1], b[1], c[1]]
            x0 = max(0, int(min(xs) * W) - 1); x1 = min(W - 1, int(max(xs) * W) + 1)
            y0 = max(0, int(min(ys) * H) - 1); y1 = min(H - 1, int(max(ys) * H) + 1)
            if x1 < x0 or y1 < y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
            u = (gx + 0.5) / W; v = (gy + 0.5) / H
            d = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
            if abs(d) < 1e-12:
                continue
            w0 = ((u - a[0]) * (c[1] - a[1]) - (v - a[1]) * (c[0] - a[0])) / d
            w1 = ((b[0] - a[0]) * (v - a[1]) - (b[1] - a[1]) * (u - a[0])) / d
            inside = (w0 >= 0) & (w1 >= 0) & (w0 + w1 <= 1)
            mask[y0:y1 + 1, x0:x1 + 1] |= inside
    return mask

roles = {}
for o in figure_meshes():
    if o.name in ("head", "hairfall"):
        roles[o.name] = "head"
    elif o.name == "cape":
        roles[o.name] = "cape"
    else:
        roles[o.name] = "garment"
masks = {}
for o in figure_meshes():
    masks.setdefault(roles[o.name], np.zeros((H, W), dtype=bool))
    masks[roles[o.name]] |= uv_mask(o)

px = np.empty(W * H * 4, dtype=np.float32)
tex_img.pixels.foreach_get(px)
px = px.reshape(H, W, 4)
rgb = px[:, :, :3].copy()
R, G, B = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
mx = rgb.max(axis=2); mn = rgb.min(axis=2)
lum = 0.2126 * R + 0.7152 * G + 0.0722 * B
sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
skin_test = (R > 0.72) & (G > 0.52) & (B < 0.80) & ((R - B) > 0.14) & (sat < 0.55)
leather_test = (R > B + 0.10) & (R > G) & (G > B) & (sat > 0.22) & (sat < 0.72) \
    & (lum > 0.13) & (lum < 0.68) & ~skin_test
eye_keep = (lum < 0.30) | ((G > R + 0.08) & (G > B + 0.08) & (sat > 0.25))

def apply_target(mask, target_hex):
    if not mask.any():
        return
    t = np.array(hex_rgb(target_hex), dtype=np.float64)
    tl = max(srgb_lum(t), 0.08)
    ratio = np.clip(lum / tl, 0.35, 2.2)
    for ch in range(3):
        chan = rgb[:, :, ch]
        chan[mask] = np.clip(t[ch] * ratio[mask], 0.0, 1.0)
        rgb[:, :, ch] = chan

carrier = "steel" if BASE == "Knight" else "leather" if BASE == "Barbarian" else "saturated"
# head role
if "head" in masks:
    m = masks["head"]
    apply_target(m & skin_test, SKIN)
    rest = m & ~skin_test & ~eye_keep
    apply_target(rest, HAIR)
# garment + cape roles
for role, target in (("garment", IDENT), ("cape", IDENT_DARK)):
    if role not in masks:
        continue
    m = masks[role]
    apply_target(m & skin_test, SKIN)
    rest = m & ~skin_test
    if carrier == "saturated":
        apply_target(rest & ~leather_test & (sat > 0.20), target)
    elif carrier == "leather":
        apply_target(rest & leather_test, IDENT_DEEP if role == "garment" else IDENT_DARK)
        apply_target(rest & ~leather_test & (sat > 0.20), target)
    else:  # steel: tint the greys toward the identity colour
        steel = rest & (sat <= 0.32) & ~leather_test
        if steel.any():
            t = np.array(hex_rgb(target), dtype=np.float64)
            tl = max(srgb_lum(t), 0.08)
            ratio = np.clip(lum / tl, 0.35, 2.2)
            for ch in range(3):
                mixed = 0.5 * rgb[:, :, ch] + 0.5 * np.clip(t[ch] * ratio, 0.0, 1.0)
                rgb[steel, ch] = mixed[steel]
        apply_target(rest & ~leather_test & (sat > 0.32), target)
px[:, :, :3] = rgb
tex_img.pixels.foreach_set(px.ravel())
summary["texture_remap"] = {"carrier": carrier, "identity": IDENT}

# ------------------------------------------------- per-part materials + flats
FLATS = {"head": SKIN, "hairfall": HAIR, "body": IDENT, "arm_left": IDENT,
         "arm_right": IDENT, "leg_left": IDENT_DEEP, "leg_right": IDENT_DEEP,
         "cape": IDENT_DARK, "helmet": IDENT, "mask": IDENT_DARK,
         "quiver": "#7a5c38"}
base_mat = body_mat
for o in figure_meshes():
    mat = base_mat.copy()
    mat.name = f"{SLUG}_{o.name}"
    flat = FLATS.get(o.name, IDENT)
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        c = hex_rgb(flat)
        bsdf.inputs["Base Color"].default_value = (*c, 1.0)
    # The web profile's LOD1 flatten "keeps each material's existing base
    # colour" — but a textured material exports no baseColorFactor, so on
    # re-import the colour is Blender's 0.8 grey default and the flatten
    # greys the whole figure. Carry the intended flat in material extras;
    # web_profile.py's flatten reads it back (M4.10 extension).
    mat["flat_colour"] = flat
    o.data.materials.clear()
    o.data.materials.append(mat)
summary["flats"] = FLATS

# --------------------------------------------------------------------- props
for p in BUILD.get("props", []):
    path = os.path.join(PROP_DIR, p["kind"] + ".gltf")
    new = import_glb(path)
    bone_name = "extra.handslot." + p["hand"]
    bone = arm.data.bones[bone_name]
    bone_world = arm.matrix_world @ bone.matrix_local
    for o in new:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        o.name = f"prop.{p['name']}"
        # LOD1 flat for the prop: the book samples the source atlas's mage
        # purple (measured dominant swatch (160,16,80) family).
        for m in o.data.materials:
            if m:
                m["flat_colour"] = {"spellbook_closed": "#9c2156"}.get(
                    p["kind"], "#7a5c38")
        o.parent = arm
        o.parent_type = "BONE"
        o.parent_bone = bone_name
        # Keep the prop's authored local transform as its offset inside
        # the bone frame: world = bone_world * I * basis.
        o.matrix_parent_inverse = __import__("mathutils").Matrix.Identity(4)
        o.matrix_basis = o.matrix_basis @ __import__("mathutils").Matrix.Scale(
            p["scale"], 4)
    summary.setdefault("props", []).append(p["name"])

# ---------------------------------------------------------------------- sash
if BUILD.get("sash"):
    chest = arm.data.bones["chest"]
    cz = chest.head_local.z
    body = bpy.data.objects["body"]
    near = [v.co for v in body.data.vertices if abs(v.co.z - cz) < 0.14]
    rx = max(abs(v.x) for v in near) + 0.025
    ry = max(abs(v.y) for v in near) + 0.025
    N = 48
    verts, faces = [], []
    for i in range(N + 1):
        t = i / N
        a = 2 * math.pi * t
        cx, cy = rx * math.cos(a), ry * math.sin(a)
        zc = cz + 0.17 * math.sin(a)
        tang = Vector((-rx * math.sin(a), ry * math.cos(a), 0.17 * math.cos(a)))
        up = Vector((0, 0, 1)) - tang.normalized() * tang.normalized().z
        up.normalize()
        for s in (-0.065, 0.065):
            verts.append((cx + up.x * s, cy + up.y * s, zc + up.z * s))
    for i in range(N):
        j = i * 2
        faces.append((j, j + 1, j + 3, j + 2))
    mesh = bpy.data.meshes.new("sash")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    sash = bpy.data.objects.new("sash", mesh)
    bpy.context.scene.collection.objects.link(sash)
    mat = bpy.data.materials.new("sash_cream")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    c = hex_rgb("#FDCFAC")  # Look Bible anchor: awning/banner cream
    bsdf.inputs["Base Color"].default_value = (*c, 1.0)
    mat["flat_colour"] = "#FDCFAC"
    mesh.materials.append(mat)
    vg = sash.vertex_groups.new(name="chest")
    vg.add(list(range(len(verts))), 1.0, "REPLACE")
    mod = sash.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    summary["sash"] = True

# -------------------------------------------------------------------- extras
arm["citizen_id"] = SLUG
arm["citizen_key"] = KIT["citizen_key"]
arm["identity_colour"] = IDENT
arm["clip_source"] = KIT["clip_source"]
arm["clip_sources"] = json.dumps(KIT["clip_sources"])
arm["kit_file"] = "citizens/" + SLUG + ".json"
if arm.animation_data:
    arm.animation_data.action = None

# -------------------------------------------------------------------- export
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
try:
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB",
                              export_animations=True,
                              export_animation_mode="ACTIONS",
                              export_apply=True, export_yup=True,
                              export_extras=True)
except TypeError:
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB",
                              export_animations=True, export_apply=True,
                              export_yup=True, export_extras=True)
FIG_MESHES = [o.name for o in figure_meshes()
              if not o.name.startswith("prop.") and o.name != "sash"]
tris = 0
for name in FIG_MESHES:
    o = bpy.data.objects[name]
    o.data.calc_loop_triangles()
    tris += len(o.data.loop_triangles)
zs = [v.co.z for name in FIG_MESHES for v in bpy.data.objects[name].data.vertices]
hz = [v.co.z for v in bpy.data.objects["head"].data.vertices]
summary.update({
    "tris_master": tris,
    "bytes": os.path.getsize(OUT),
    "height_final": round(max(zs) - min(zs), 4),
    "head_share_est": round((max(hz) - min(hz)) / (max(zs) - min(zs)), 4),
    "out": OUT,
})
print("CITIZEN_BUILD_SUMMARY " + json.dumps(summary))
