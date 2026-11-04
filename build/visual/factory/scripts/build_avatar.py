#!/usr/bin/env python3
"""Office avatar factory: kit JSON -> rigged, animated GLB (+ renders).

Usage (Blender headless):
  blender -b --python build_avatar.py -- --kit kits/atlas.json \
      --output outputs/atlas.glb --renders renders

Shared rig (SOFTWARE-DESIGN spec 2.2) - EXACT bone names, no others except
namespaced extra.* :
  hips, spine, chest, head, arm.L/R, forearm.L/R, hand.L/R, leg.L/R, shin.L/R
Clips: idle, sit, type, stand, walk, knock, wait, gather.
Clip source is recorded in the kit; until UAL CC0 clips land in build/assets
all clips are PROCEDURAL (generated here) and marked in the GLB extras.
All geometry is built from Blender primitives / generated tubes in this
script - no external assets, licence-clean (project-owned output).
Front of the figure is -Y in Blender (exports to +Z in glTF).
"""
import bpy, json, math, os, sys
from mathutils import Vector

# ---------------------------------------------------------------- args
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
KIT = json.load(open(args["kit"]))
OUT = os.path.abspath(args["output"])
RENDERS = os.path.abspath(args["renders"]) if args.get("renders") else None
PID = KIT["persona_id"]
PAL = KIT["palette"]; FACE = KIT["face"]; PARTS = KIT["kit_parts"]

def hx(h):
    h = h.lstrip("#")
    return tuple(int(h[j:j + 2], 16) / 255.0 for j in (0, 2, 4))

# ---------------------------------------------------------------- scene reset
# MUST run before any datablock creation (it wipes the file).
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24

MATS = {}
def mat(name, hexcol, rough=0.85, metal=0.0, emissive=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    rgb = hx(hexcol)
    # linear approx: Blender colour inputs are linear; sRGB hex -> linear
    lin = tuple(c ** 2.2 for c in rgb)
    m.diffuse_color = (*lin, 1.0)  # Workbench renders read this
    bsdf.inputs["Base Color"].default_value = (*lin, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emissive:
        try:
            bsdf.inputs["Emission Color"].default_value = (*lin, 1.0)
            bsdf.inputs["Emission Strength"].default_value = emissive
        except Exception:
            pass
    MATS[name] = m
    return m

mat("fur", PAL["fur"]); mat("fur_dark", PAL.get("fur_dark", PAL["fur"]))
mat("fur_light", PAL.get("fur_light", "#f5f2ea"))
mat("garment", PAL["garment"]); mat("garment_dark", PAL.get("garment_dark", PAL["garment"]))
mat("accent", PAL.get("accent", "#a8873c"), rough=0.4, metal=0.6)
mat("eye", FACE["eye_colour"], rough=0.25)
mat("nose", FACE["nose_colour"], rough=0.4)
mat("dark", "#1c1a18", rough=0.3)
mat("white", "#fdfcf6"); mat("cream", "#f5f2ea")
mat("wood", "#6e4f2e", rough=0.8)
mat("red", "#c22e2e", rough=0.5)
mat("yellow", "#e8b71a", rough=0.5)
mat("green_glass", "#7fc24a", rough=0.2, emissive=0.25)
mat("pink", "#e58a9a", rough=0.5)

# ---------------------------------------------------------------- face texture
def make_face_texture():
    """Procedural 256x256 face card from kit values: fur base, lighter lower
    muzzle band, optional tabby stripes (top), optional speckles."""
    S = 256
    img = bpy.data.images.new(f"{PID}_face", S, S, alpha=False)
    fur = hx(PAL["fur"]); light = hx(FACE["muzzle_colour"]); dark = hx(PAL.get("fur_dark", PAL["fur"]))
    px = [0.0] * (S * S * 4)
    for y in range(S):
        v = y / S  # v=0 bottom of texture
        for x in range(S):
            u = x / S
            r, g, b = fur
            # muzzle band: lower-centre of the sphere's front hemisphere wraps
            # all u at low v on a UV sphere is the underside; use a soft light
            # gradient in the lower third so the chin/muzzle reads light.
            if v < 0.34:
                t = (0.34 - v) / 0.34 * 0.55
                r += (light[0] - r) * t; g += (light[1] - g) * t; b += (light[2] - b) * t
            if FACE.get("stripes") and v > 0.62:
                s = math.sin(u * math.pi * 10.0)
                band = math.sin((v - 0.62) / 0.38 * math.pi)
                if s > 0.45:
                    t = 0.45 * band
                    r += (dark[0] - r) * t; g += (dark[1] - g) * t; b += (dark[2] - b) * t
            if FACE.get("speckles"):
                h = ((x * 73856093) ^ (y * 19349663)) & 0xffff
                if h < 900 and v > 0.3:
                    t = 0.35
                    r += (dark[0] - r) * t; g += (dark[1] - g) * t; b += (dark[2] - b) * t
            idx = (y * S + x) * 4
            px[idx:idx + 4] = [r, g, b, 1.0]
    img.pixels = px
    img.update()
    m = bpy.data.materials.new("face_card")
    m.use_nodes = True
    _f = hx(PAL["fur"]); m.diffuse_color = (*(c ** 2.2 for c in _f), 1.0)
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.85
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return m
FACE_MAT = make_face_texture()

# ---------------------------------------------------------------- armature
arm_data = bpy.data.armatures.new("SharedRig")
arm = bpy.data.objects.new("Armature", arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones
def bone(name, head, tail, parent=None):
    b = eb.new(name); b.head = head; b.tail = tail
    if parent: b.parent = parent
    return b
B = {}
B["hips"]  = bone("hips",  (0, 0, 0.92), (0, 0, 1.04))
B["spine"] = bone("spine", (0, 0, 1.02), (0, 0, 1.16), B["hips"])
B["chest"] = bone("chest", (0, 0, 1.14), (0, 0, 1.30), B["spine"])
B["head"]  = bone("head",  (0, 0, 1.28), (0, 0, 1.54), B["chest"])
for s, sx in (("L", 1), ("R", -1)):
    B[f"arm.{s}"]     = bone(f"arm.{s}",     (sx * 0.19, 0, 1.27), (sx * 0.29, 0, 1.01), B["chest"])
    B[f"forearm.{s}"] = bone(f"forearm.{s}", (sx * 0.29, 0, 1.01), (sx * 0.33, 0, 0.80), B[f"arm.{s}"])
    B[f"hand.{s}"]    = bone(f"hand.{s}",    (sx * 0.33, 0, 0.80), (sx * 0.34, 0, 0.66), B[f"forearm.{s}"])
    B[f"leg.{s}"]     = bone(f"leg.{s}",     (sx * 0.11, 0, 0.90), (sx * 0.12, 0, 0.50), B["hips"])
    B[f"shin.{s}"]    = bone(f"shin.{s}",    (sx * 0.12, 0, 0.50), (sx * 0.12, 0, 0.08), B[f"leg.{s}"])
B["extra.tail"] = bone("extra.tail", (0, 0.05, 0.95), (0, 0.24, 0.80), B["hips"])
B["extra.ear.L"] = bone("extra.ear.L", (0.13, 0, 1.72), (0.17, 0, 1.90), B["head"])
B["extra.ear.R"] = bone("extra.ear.R", (-0.13, 0, 1.72), (-0.17, 0, 1.90), B["head"])
bpy.ops.object.mode_set(mode="OBJECT")

# ---------------------------------------------------------------- mesh helpers
def finish(obj, material, bone_name):
    if material:
        obj.data.materials.append(material)
    vg = obj.vertex_groups.new(name=bone_name)
    vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE"); mod.object = arm
    return obj

def add_box(name, loc, dims, material, bone_name, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    o = bpy.context.active_object; o.name = name; o.dimensions = dims
    o.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True, rotation=False)
    return finish(o, material, bone_name)

def add_sphere(name, loc, scale, material, bone_name, seg=16, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, location=loc)
    o = bpy.context.active_object; o.name = name; o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    for p in o.data.polygons: p.use_smooth = True
    return finish(o, material, bone_name)

def add_cone(name, loc, r1, r2, depth, material, bone_name, rot=(0, 0, 0), verts=12):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc)
    o = bpy.context.active_object; o.name = name; o.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True, rotation=False)
    return finish(o, material, bone_name)

def add_cyl(name, loc, r, depth, material, bone_name, rot=(0, 0, 0), verts=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc)
    o = bpy.context.active_object; o.name = name; o.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True, rotation=False)
    return finish(o, material, bone_name)

def add_torus(name, loc, major, minor, material, bone_name, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_segments=20, minor_segments=8,
                                     major_radius=major, minor_radius=minor, location=loc)
    o = bpy.context.active_object; o.name = name; o.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True, rotation=False)
    return finish(o, material, bone_name)

def add_tube(name, points, r0, r1, material, bone_name, radial=8):
    """Sweep a circular section along points (list of Vector)."""
    pts = [Vector(p) for p in points]
    verts, faces = [], []
    n = len(pts)
    for i, p in enumerate(pts):
        if i == 0: tan = (pts[1] - pts[0]).normalized()
        elif i == n - 1: tan = (pts[-1] - pts[-2]).normalized()
        else: tan = (pts[i + 1] - pts[i - 1]).normalized()
        ref = Vector((0, 0, 1)) if abs(tan.z) < 0.9 else Vector((1, 0, 0))
        nrm = tan.cross(ref).normalized(); binm = tan.cross(nrm).normalized()
        r = r0 + (r1 - r0) * (i / max(1, n - 1))
        for j in range(radial):
            a = 2 * math.pi * j / radial
            verts.append(tuple(p + (nrm * math.cos(a) + binm * math.sin(a)) * r))
    for i in range(n - 1):
        for j in range(radial):
            j2 = (j + 1) % radial
            faces.append((i * radial + j, i * radial + j2, (i + 1) * radial + j2, (i + 1) * radial + j))
    faces.append(tuple(range(radial - 1, -1, -1)))
    faces.append(tuple((n - 1) * radial + j for j in range(radial)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces); me.update()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    return finish(o, material, bone_name)

def join_objects(name, objs, material_order_bone):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object; o.name = name
    # re-bind whole joined mesh to one bone
    for vg in list(o.vertex_groups): o.vertex_groups.remove(vg)
    if not any(m.type == "ARMATURE" for m in o.modifiers):
        mod = o.modifiers.new("Armature", "ARMATURE"); mod.object = arm
    vg = o.vertex_groups.new(name=material_order_bone)
    vg.add(list(range(len(o.data.vertices))), 1.0, "REPLACE")
    return o

# ---------------------------------------------------------------- body build
OCTO = KIT["body_plan"] == "octopus_hem"
HEAD_C = (0, 0, 1.50)

# torso / pelvis
add_box("pelvis", (0, 0, 0.97), (0.36, 0.24, 0.20), MATS["garment_dark"], "hips")
add_box("torso", (0, 0, 1.17), (0.44, 0.27, 0.32), MATS["garment"], "chest")
# light chest patch (white muzzle/chest identity for cat & fox; vest front else)
add_box("chest_patch", (0, -0.125, 1.17), (0.27, 0.035, 0.26), MATS["fur_light"], "chest")
add_box("spine_mesh", (0, 0, 1.05), (0.34, 0.22, 0.12), MATS["garment"], "spine")

if not OCTO:
    for s, sx in (("L", 1), ("R", -1)):
        add_box(f"thigh.{s}", (sx * 0.115, 0, 0.70), (0.15, 0.17, 0.42), MATS["garment_dark"], f"leg.{s}")
        add_box(f"shin.{s}", (sx * 0.12, 0, 0.29), (0.13, 0.15, 0.44), MATS["fur"], f"shin.{s}")
        add_box(f"foot.{s}", (sx * 0.12, -0.045, 0.045), (0.13, 0.22, 0.09), MATS["fur_dark"], f"shin.{s}")
# arms (all plans; octopus arms are its two working tentacles, tubed below)
for s, sx in (("L", 1), ("R", -1)):
    if OCTO:
        add_tube(f"arm.{s}_mesh", [(sx * 0.19, 0, 1.27), (sx * 0.30, -0.02, 1.02), (sx * 0.34, -0.06, 0.88)],
                 0.075, 0.055, MATS["fur"], f"arm.{s}")
        add_tube(f"forearm.{s}_mesh", [(sx * 0.33, 0, 0.80), (sx * 0.36, -0.08, 0.70), (sx * 0.34, -0.12, 0.62)],
                 0.055, 0.028, MATS["fur"], f"forearm.{s}")
        add_sphere(f"hand.{s}_mesh", (sx * 0.34, -0.12, 0.62), (0.05, 0.05, 0.05), MATS["fur"], f"hand.{s}")
    else:
        add_box(f"arm.{s}_mesh", (sx * 0.245, 0, 1.14), (0.115, 0.115, 0.28), MATS["garment"], f"arm.{s}")
        add_box(f"forearm.{s}_mesh", (sx * 0.315, 0, 0.905), (0.10, 0.10, 0.23), MATS["fur"], f"forearm.{s}")
        add_sphere(f"hand.{s}_mesh", (sx * 0.335, 0, 0.72), (0.055, 0.055, 0.07), MATS["fur_light"] if PID == "atlas" else MATS["fur"], f"hand.{s}")

# head
if OCTO:
    add_sphere("head_mesh", HEAD_C, (0.335, 0.32, 0.315), FACE_MAT, "head", seg=20, rings=14)
else:
    add_sphere("head_mesh", HEAD_C, (0.295, 0.27, 0.29), FACE_MAT, "head", seg=20, rings=14)

# face geometry (front = -Y): muzzle, nose, eyes
snout = PARTS["snout_style"]
if snout == "cat_small":
    add_sphere("muzzle", (0, -0.225, 1.425), (0.155, 0.095, 0.10), MATS["fur_light"], "head")
    add_sphere("nose", (0, -0.295, 1.465), (0.038, 0.022, 0.026), MATS["pink"] if PID == "atlas" else MATS["nose"], "head")
elif snout == "beaver_wide":
    add_sphere("muzzle", (0, -0.21, 1.42), (0.20, 0.115, 0.115), MATS["fur_light"], "head")
    add_sphere("nose", (0, -0.30, 1.475), (0.062, 0.03, 0.04), MATS["nose"], "head")
    if FACE.get("incisors"):
        add_box("incisor_card", (0, -0.315, 1.345), (0.085, 0.018, 0.085), MATS["white"], "head")
elif snout == "fox_pointed":
    add_cone("muzzle", (0, -0.27, 1.44), 0.115, 0.035, 0.24, MATS["fur_light"], "head",
             rot=(math.radians(-90), 0, 0))
    add_sphere("nose", (0, -0.385, 1.445), (0.04, 0.028, 0.03), MATS["nose"], "head")
_eye_y = -0.298 if OCTO else -0.238   # octopus dome is deeper; eyes must sit on its surface
_pup_y = -0.328 if OCTO else -0.262
for sx in (1, -1):
    add_sphere(f"eye.{'L' if sx>0 else 'R'}", (sx * 0.108, _eye_y, 1.565), (0.046, 0.026, 0.052), MATS["eye"], "head")
    add_sphere(f"pupil.{'L' if sx>0 else 'R'}", (sx * 0.108, _pup_y, 1.57), (0.021, 0.012, 0.026), MATS["dark"], "head")
if OCTO:  # gentle mouth line for the dome face (identity from the 2D master)
    add_torus("mouth", (0, -0.285, 1.40), 0.075, 0.009, MATS["dark"], "head", rot=(math.radians(90), 0, 0))
if FACE.get("stripes"):  # tabby forehead stripes as thin dark boxes
    for dx, rz in ((-0.09, 0.25), (-0.03, 0.08), (0.03, -0.08), (0.09, -0.25)):
        add_box("stripe", (dx, -0.185, 1.735), (0.028, 0.05, 0.09), MATS["fur_dark"], "head", rot=(0.5, 0, rz))

# ears (silhouette at 115%+; fox at 135%)
es = PARTS["ear_style"]; esc = PARTS.get("ear_scale", 1.15)
for s, sx in (("L", 1), ("R", -1)):
    bn = f"extra.ear.{s}"
    if es == "cat_triangle":
        add_cone(f"ear.{s}", (sx * 0.155, 0, 1.80), 0.085 * esc, 0.008, 0.24 * esc, MATS["fur"], bn, rot=(0, sx * -0.18, 0))
        add_cone(f"ear_inner.{s}", (sx * 0.15, -0.035, 1.79), 0.048 * esc, 0.006, 0.17 * esc, MATS["pink"], bn, rot=(0, sx * -0.18, 0))
    elif es == "round":
        add_sphere(f"ear.{s}", (sx * 0.21, 0, 1.70), (0.085 * esc, 0.04, 0.085 * esc), MATS["fur"], bn)
    elif es == "fox_tall":
        add_cone(f"ear.{s}", (sx * 0.165, 0, 1.86), 0.095, 0.006, 0.36 * esc, MATS["fur"], bn, rot=(0, sx * -0.13, 0))
        add_cone(f"ear_inner.{s}", (sx * 0.158, -0.038, 1.845), 0.05, 0.005, 0.26 * esc, MATS["fur_light"], bn, rot=(0, sx * -0.13, 0))

# tail
ts = PARTS["tail_style"]
if ts == "cat_curved":
    add_tube("tail_seg1", [(0, 0.10, 0.94), (0, 0.26, 0.82), (0, 0.35, 0.86)], 0.052, 0.046, MATS["fur"], "extra.tail")
    add_tube("tail_seg2", [(0, 0.35, 0.86), (0, 0.385, 0.97)], 0.046, 0.040, MATS["fur_dark"], "extra.tail")
    add_tube("tail_seg3", [(0, 0.385, 0.97), (0, 0.37, 1.10)], 0.040, 0.030, MATS["fur"], "extra.tail")
elif ts == "fox_bushy":
    add_tube("tail_main", [(0, 0.10, 0.94), (0, 0.30, 0.80), (0, 0.42, 0.92)], 0.085, 0.075, MATS["fur"], "extra.tail")
    add_tube("tail_tip", [(0, 0.42, 0.92), (0, 0.44, 1.08)], 0.075, 0.045, MATS["fur_light"], "extra.tail")
elif ts == "beaver_paddle":
    add_box("tail_paddle", (0, 0.30, 0.52), (0.21, 0.36, 0.05), MATS["fur_dark"], "extra.tail",
            rot=(math.radians(38), 0, 0))
if OCTO:
    # tentacle-hem skirt: 8 tapered tubes weighted to hips (spec 2.1/2.2)
    for k in range(8):
        a = 2 * math.pi * k / 8
        bx, by = math.sin(a) * 0.17, math.cos(a) * 0.15
        tx, ty = math.sin(a) * 0.30, math.cos(a) * 0.27
        add_tube(f"skirt_tentacle_{k}", [(bx, by, 0.94), ((bx + tx) / 2, (by + ty) / 2, 0.68), (tx, ty, 0.42)],
                 0.068, 0.030, MATS["fur"] if k % 2 == 0 else MATS["fur_dark"], "hips")
    add_cyl("hem_band", (0, 0, 0.95), 0.235, 0.10, MATS["garment"], "hips")

# ---------------------------------------------------------------- props (125%)
HAND_R = (-0.335, -0.06, 0.72); HAND_L = (0.335, -0.06, 0.72)
def prop_staff():
    shaft = add_cyl("staff_shaft", (-0.42, -0.10, 1.02), 0.026, 1.55, MATS["wood"], "hand.R")
    pts = []
    for d in range(40, 321, 14):
        a = math.radians(d)
        pts.append((-0.42 + math.cos(a) * 0.145, -0.10, 1.86 + math.sin(a) * 0.145))
    cres = add_tube("staff_crescent", pts, 0.030, 0.030, MATS["accent"], "hand.R")
    join_objects("prop.crescent_staff", [shaft, cres], "hand.R")
def prop_ledger():
    cover = add_box("ledger_cover", (0.44, -0.10, 0.76), (0.26, 0.055, 0.34), MATS["wood"], "hand.L")
    pages = add_box("ledger_pages", (0.44, -0.135, 0.76), (0.235, 0.02, 0.315), MATS["cream"], "hand.L")
    join_objects("prop.ledger", [cover, pages], "hand.L")
def prop_level():
    body = add_box("level_body", (-0.40, -0.12, 0.86), (0.62, 0.055, 0.10), MATS["yellow"], "hand.R", rot=(0, 0, 0.35))
    b1 = add_cyl("level_bubble", (-0.40, -0.155, 0.86), 0.026, 0.06, MATS["green_glass"], "hand.R", rot=(math.radians(90), 0, 0))
    join_objects("prop.spirit_level", [body, b1], "hand.R")
def prop_pencil():
    body = add_cyl("pencil_body", (-0.36, -0.10, 0.80), 0.016, 0.30, MATS["red"], "hand.R", rot=(0.5, 0, 0.25))
    tip = add_cone("pencil_tip", (-0.325, -0.155, 0.665), 0.016, 0.001, 0.06, MATS["cream"], "hand.R", rot=(0.5, 0, 0.25))
    join_objects("prop.red_pencil", [body, tip], "hand.R")
def prop_calipers():
    a1 = add_box("caliper_arm1", (0.40, -0.10, 0.82), (0.022, 0.03, 0.30), MATS["accent"], "hand.L", rot=(0, 0, 0.16))
    a2 = add_box("caliper_arm2", (0.46, -0.10, 0.82), (0.022, 0.03, 0.30), MATS["accent"], "hand.L", rot=(0, 0, -0.16))
    bar = add_box("caliper_bar", (0.43, -0.10, 0.955), (0.16, 0.03, 0.025), MATS["accent"], "hand.L")
    join_objects("prop.calipers", [a1, a2, bar], "hand.L")
def prop_spectacles():
    parts = []
    for sx in (1, -1):
        parts.append(add_torus(f"spec_lens_{sx}", (sx * 0.108, -0.272, 1.565), 0.068, 0.008, MATS["accent"], "head"))
    parts.append(add_box("spec_bridge", (0, -0.272, 1.575), (0.075, 0.012, 0.012), MATS["accent"], "head"))
    join_objects("prop.spectacles", parts, "head")
def prop_compass():
    case = add_cyl("compass_case", (-0.40, -0.10, 0.80), 0.105, 0.032, MATS["accent"], "hand.R", rot=(math.radians(90), 0, 0))
    face = add_cyl("compass_face", (-0.40, -0.122, 0.80), 0.088, 0.034, MATS["cream"], "hand.R", rot=(math.radians(90), 0, 0))
    needle = add_box("compass_needle", (-0.40, -0.128, 0.80), (0.014, 0.006, 0.13), MATS["red"], "hand.R", rot=(0, 0.6, 0))
    join_objects("prop.compass", [case, face, needle], "hand.R")

PROP_BUILDERS = {"crescent_staff": prop_staff, "ledger": prop_ledger, "spirit_level": prop_level,
                 "red_pencil": prop_pencil, "calipers": prop_calipers, "spectacles": prop_spectacles,
                 "compass": prop_compass}
for p in KIT["props"]:
    PROP_BUILDERS[p["kind"]]()

# ---------------------------------------------------------------- animations
# All clips PROCEDURAL (kit.clip_source) until UAL CC0 clips land in
# build/assets - marked in GLB extras below. Rotations in degrees, applied
# as pose-bone euler XYZ; hips offset via pose location (local Y = up).
ALL_BONES = ["hips", "spine", "chest", "head",
             "arm.L", "forearm.L", "hand.L", "arm.R", "forearm.R", "hand.R",
             "leg.L", "shin.L", "leg.R", "shin.R", "extra.tail", "extra.ear.L", "extra.ear.R"]
D = math.radians
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")
pb = arm.pose.bones

def keyframe_pose(action, frame, pose, hips_loc=(0, 0, 0)):
    arm.animation_data.action = action
    scene.frame_set(frame)
    for name in ALL_BONES:
        b = pb[name]
        rx, ry, rz = pose.get(name, (0, 0, 0))
        b.rotation_mode = "XYZ"
        b.rotation_euler = (D(rx), D(ry), D(rz))
        b.keyframe_insert("rotation_euler", frame=frame)
    h = pb["hips"]
    h.location = hips_loc
    h.keyframe_insert("location", frame=frame)

def new_action(name):
    a = bpy.data.actions.new(name); a.use_fake_user = True
    if not arm.animation_data: arm.animation_data_create()
    return a

SIT = {"leg.L": (-85, 0, 0), "leg.R": (-85, 0, 0), "shin.L": (82, 0, 0), "shin.R": (82, 0, 0),
       "arm.L": (-28, 0, 6), "arm.R": (-28, 0, -6), "forearm.L": (-18, 0, 0), "forearm.R": (-18, 0, 0),
       "spine": (-4, 0, 0)}
SIT_LOC = (0, -0.335, 0)

# ------------------------------------------------ UAL retarget (if source given)
# UAL1 (CC0) clips live on a Rigify DEF rig; bake them onto this spec rig by
# world-space rotation deltas (rest-frame invariant), per UAL-NOTES.md mapping.
CLIP_SOURCES = {}
UAL_MAP = {"hips": "DEF-hips", "spine": "DEF-spine.001", "chest": "DEF-spine.003",
           "head": "DEF-head", "arm.L": "DEF-upper_arm.L", "forearm.L": "DEF-forearm.L",
           "hand.L": "DEF-hand.L", "arm.R": "DEF-upper_arm.R", "forearm.R": "DEF-forearm.R",
           "hand.R": "DEF-hand.R", "leg.L": "DEF-thigh.L", "shin.L": "DEF-shin.L",
           "leg.R": "DEF-thigh.R", "shin.R": "DEF-shin.R"}
UAL_CLIPS = {"idle": ("Idle_Loop", 1), "walk": ("Walk_Loop", 1),
             "sit": ("Sitting_Enter", 1), "stand": ("Sitting_Exit", 1),
             "wait": ("Idle_Loop", 2), "gather": ("Idle_Talking_Loop", 1)}
ORDER = ["hips", "spine", "chest", "head", "arm.L", "forearm.L", "hand.L",
         "arm.R", "forearm.R", "hand.R", "leg.L", "shin.L", "leg.R", "shin.R"]
SIT_CAPTURE = {"pose": None, "loc": None}

def retarget_ual(ual_path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=ual_path)
    new_objs = [o for o in bpy.data.objects if o not in before]
    ual_arm = next((o for o in new_objs if o.type == "ARMATURE"), None)
    if ual_arm is None:
        print("UAL: no armature in source, staying procedural"); return False
    if not ual_arm.animation_data: ual_arm.animation_data_create()
    if not arm.animation_data: arm.animation_data_create()
    ub = ual_arm.pose.bones; uarm_bones = ual_arm.data.bones
    rest_q, rest_head = {}, {}
    for mine, theirs in UAL_MAP.items():
        if theirs not in uarm_bones:
            print(f"UAL: missing bone {theirs}"); return False
        rest_q[theirs] = (ual_arm.matrix_world @ uarm_bones[theirs].matrix_local).to_quaternion()
        rest_head[theirs] = (ual_arm.matrix_world @ uarm_bones[theirs].matrix_local).translation
    my_rest_q, my_local_rest_q, my_parent = {}, {}, {}
    for name in ORDER:
        b = arm.data.bones[name]
        my_rest_q[name] = (arm.matrix_world @ b.matrix_local).to_quaternion()
        if b.parent:
            my_local_rest_q[name] = (b.parent.matrix_local.inverted() @ b.matrix_local).to_quaternion()
            my_parent[name] = b.parent.name
        else:
            my_local_rest_q[name] = b.matrix_local.to_quaternion(); my_parent[name] = None
    ual_hips_z = rest_head["DEF-hips"].z or 1.0
    scale_t = 0.92 / ual_hips_z
    ok = True
    for target, (src_name, stride) in UAL_CLIPS.items():
        src = bpy.data.actions.get(src_name)
        if src is None:
            print(f"UAL: clip {src_name} not found"); ok = False; continue
        ual_arm.animation_data.action = src
        f0, f1 = int(src.frame_range[0]), int(src.frame_range[1])
        frames = list(range(f0, f1 + 1, stride))
        if len(frames) > 110:  # even subsample long clips
            step = len(frames) / 110.0
            frames = [frames[int(i * step)] for i in range(110)]
        act = new_action(target)
        arm.animation_data.action = act
        for di, sf in enumerate(frames):
            scene.frame_set(sf); bpy.context.view_layer.update()
            # world deltas on the UAL rig
            deltas = {}
            for mine, theirs in UAL_MAP.items():
                cur_q = (ual_arm.matrix_world @ ub[theirs].matrix).to_quaternion()
                deltas[mine] = cur_q @ rest_q[theirs].inverted()
            dpos = ((ual_arm.matrix_world @ ub["DEF-hips"].matrix).translation - rest_head["DEF-hips"]) * scale_t
            desired_head = arm.data.bones["hips"].head_local + dpos
            bpy.context.view_layer.objects.active = arm
            bpy.ops.object.mode_set(mode="POSE")
            for name in ORDER:
                b = pb[name]
                parent_q = (arm.matrix_world @ pb[my_parent[name]].matrix).to_quaternion() if my_parent[name] else None
                base = (parent_q @ my_local_rest_q[name]) if parent_q else my_local_rest_q[name]
                desired_q = deltas[name] @ my_rest_q[name]
                q_local = base.inverted() @ desired_q
                b.rotation_mode = "XYZ"
                b.rotation_euler = q_local.to_euler("XYZ")
                if name == "hips":
                    b.location = (0, 0, 0)
                bpy.context.view_layer.update()
            # hips translation: two corrective passes in bone-local space
            hips_b = pb["hips"]
            conv = arm.data.bones["hips"].matrix_local.to_3x3().inverted()
            for _ in range(2):
                cur_head = (arm.matrix_world @ hips_b.matrix).translation
                hips_b.location = tuple(Vector(hips_b.location) + conv @ (desired_head - cur_head))
                bpy.context.view_layer.update()
            for name in ALL_BONES:
                pb[name].keyframe_insert("rotation_euler", frame=di)
            hips_b.keyframe_insert("location", frame=di)
            if target == "sit" and di == len(frames) - 1:
                SIT_CAPTURE["pose"] = {n: tuple(math.degrees(a) for a in pb[n].rotation_euler) for n in ALL_BONES}
                SIT_CAPTURE["loc"] = tuple(hips_b.location)
        CLIP_SOURCES[target] = f"ual1_cc0:{src_name}"
        print(f"UAL: baked {src_name} -> {target} ({len(frames)} frames)")
    # clear pose, remove the UAL import completely
    for b in pb:
        b.rotation_euler = (0, 0, 0); b.location = (0, 0, 0)
    arm.animation_data.action = None
    bpy.ops.object.mode_set(mode="OBJECT")
    keep_actions = set(UAL_CLIPS) | {"idle", "sit", "type", "stand", "walk", "knock", "wait", "gather"}
    for o in new_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        if a.name not in keep_actions and a.name not in CLIP_SOURCES:
            bpy.data.actions.remove(a)
    return ok

UAL_PATH = args.get("ual")
UAL_OK = False
if UAL_PATH and os.path.exists(UAL_PATH):
    try:
        UAL_OK = retarget_ual(UAL_PATH)
    except Exception as e:
        print("UAL retarget failed, staying procedural:", e)
        UAL_OK = False
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")


if "idle" not in CLIP_SOURCES:
    a = new_action("idle"); CLIP_SOURCES["idle"] = "procedural_factory"
    for f, s in ((0, 0), (24, 1), (48, 0)):
        keyframe_pose(a, f, {"spine": (0, 0, 1.6 * s if s else 0.0), "chest": (0.6, 0, 1.2 * s),
                             "head": (0, 0, -1.0 * s), "extra.tail": (0, 0, 6 * s),
                             "arm.L": (1.5 * s, 0, 2), "arm.R": (1.5 * s, 0, -2)})
if "sit" not in CLIP_SOURCES:
    a = new_action("sit"); CLIP_SOURCES["sit"] = "procedural_factory"
    keyframe_pose(a, 0, {}); keyframe_pose(a, 10, SIT, SIT_LOC)
if "stand" not in CLIP_SOURCES:
    a = new_action("stand"); CLIP_SOURCES["stand"] = "procedural_factory"
    keyframe_pose(a, 0, SIT, SIT_LOC); keyframe_pose(a, 10, {})
# type: UAL has no typing clip (spec 2.4) - seated pose + procedural forearms.
# When a UAL sit was baked, type builds on its captured end pose so sit->type
# does not pop; otherwise it uses the procedural SIT pose.
a = new_action("type"); CLIP_SOURCES["type"] = "procedural_factory"
TYPE_BASE = SIT_CAPTURE["pose"] if SIT_CAPTURE["pose"] else SIT
TYPE_LOC = SIT_CAPTURE["loc"] if SIT_CAPTURE["loc"] else SIT_LOC
for f in (0, 6, 12, 18, 24):
    ph = (f // 6) % 2
    p = dict(TYPE_BASE)
    p["forearm.L"] = (-52 if ph == 0 else -34, 0, 0) if not SIT_CAPTURE["pose"] else \
        (TYPE_BASE["forearm.L"][0] - (14 if ph == 0 else 2), TYPE_BASE["forearm.L"][1], TYPE_BASE["forearm.L"][2])
    p["forearm.R"] = (-34 if ph == 0 else -52, 0, 0) if not SIT_CAPTURE["pose"] else \
        (TYPE_BASE["forearm.R"][0] - (2 if ph == 0 else 14), TYPE_BASE["forearm.R"][1], TYPE_BASE["forearm.R"][2])
    if not SIT_CAPTURE["pose"]:
        p["arm.L"] = (-38, 0, 4); p["arm.R"] = (-38, 0, -4); p["head"] = (8, 0, 0)
    keyframe_pose(a, f, p, TYPE_LOC)
if "walk" not in CLIP_SOURCES:
    a = new_action("walk"); CLIP_SOURCES["walk"] = "procedural_factory"
    for f in (0, 6, 12, 18, 24):
        ph = math.sin(2 * math.pi * f / 24)
        keyframe_pose(a, f, {"leg.L": (26 * ph, 0, 0), "leg.R": (-26 * ph, 0, 0),
                             "shin.L": (10 + 14 * max(0, -ph), 0, 0), "shin.R": (10 + 14 * max(0, ph), 0, 0),
                             "arm.L": (-20 * ph, 0, 3), "arm.R": (20 * ph, 0, -3),
                             "extra.tail": (0, 0, 5 * ph)},
                      hips_loc=(0, 0.018 * abs(ph), 0))
a = new_action("knock"); CLIP_SOURCES["knock"] = "procedural_factory"
keyframe_pose(a, 0, {})
keyframe_pose(a, 5, {"arm.R": (-128, 0, -8), "forearm.R": (-18, 0, 0), "head": (-4, 0, 0)})
for f, fx in ((8, -48), (11, -18), (14, -48), (17, -18)):
    keyframe_pose(a, f, {"arm.R": (-128, 0, -8), "forearm.R": (fx, 0, 0), "head": (-4, 0, 0)})
keyframe_pose(a, 22, {"arm.R": (-128, 0, -8), "forearm.R": (-18, 0, 0)})
if "wait" not in CLIP_SOURCES:
    a = new_action("wait"); CLIP_SOURCES["wait"] = "procedural_factory"
    keyframe_pose(a, 0, {"arm.L": (0, 0, 2), "arm.R": (0, 0, -2)})
    keyframe_pose(a, 72, {"spine": (0, 0, 2.2), "head": (0, 0, -2.0), "extra.tail": (0, 0, 4)}, hips_loc=(0.012, 0, 0))
    keyframe_pose(a, 144, {"arm.L": (0, 0, 2), "arm.R": (0, 0, -2)})
if "gather" not in CLIP_SOURCES:
    a = new_action("gather"); CLIP_SOURCES["gather"] = "procedural_factory"
    for f, s in ((0, 0), (24, 1), (48, 0)):
        keyframe_pose(a, f, {"arm.L": (-46, 0, 6), "forearm.L": (-68, 0, 0),
                             "arm.R": (0, 0, -3), "spine": (0, 0, 1.4 * s), "head": (2, 0, -1.0 * s),
                             "extra.tail": (0, 0, 5 * s)})
bpy.ops.object.mode_set(mode="OBJECT")
# clear pose back to rest for export/renders
for b in pb:
    b.rotation_euler = (0, 0, 0); b.location = (0, 0, 0)
if arm.animation_data: arm.animation_data.action = None
scene.frame_set(0)

# ---------------------------------------------------------------- renders
def render_shot(name, cam_loc, cam_rot, frame=0, action_name=None, target=(0, 0, 0.92)):
    if action_name:
        act = bpy.data.actions.get(action_name)
        if not arm.animation_data: arm.animation_data_create()
        arm.animation_data.action = act
    scene.frame_set(frame)
    cam_data = bpy.data.cameras.new("cam"); cam_data.type = "ORTHO"; cam_data.ortho_scale = 2.55
    cam = bpy.data.objects.new("cam", cam_data); bpy.context.collection.objects.link(cam)
    cam.location = cam_loc
    if target is not None:  # aim at figure centre, not world origin
        cam.rotation_euler = (Vector(target) - Vector(cam_loc)).to_track_quat("-Z", "Y").to_euler()
    else:
        cam.rotation_euler = cam_rot
    scene.camera = cam
    light_data = bpy.data.lights.new("sun", "SUN"); light_data.energy = 3.0
    sun = bpy.data.objects.new("sun", light_data); bpy.context.collection.objects.link(sun)
    sun.rotation_euler = (D(50), D(10), D(-35))
    amb_data = bpy.data.lights.new("fill", "SUN"); amb_data.energy = 0.8
    amb = bpy.data.objects.new("fill", amb_data); bpy.context.collection.objects.link(amb)
    amb.rotation_euler = (D(70), 0, D(140))
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, -0.001))
    ground = bpy.context.active_object; ground.name = "render_ground"
    gm = bpy.data.materials.new("ground_mat"); gm.use_nodes = True
    gm.diffuse_color = (0.85, 0.82, 0.74, 1)
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.85, 0.82, 0.74, 1)
    ground.data.materials.append(gm)
    world = bpy.data.worlds.new("w"); scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.93, 0.91, 0.86, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    # Workbench: EEVEE stalls headless on GPU-less hosts; Workbench renders
    # flat material (diffuse) colours instantly and suits the diorama style.
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light = "STUDIO"; sh.color_type = "MATERIAL"
    sh.show_cavity = True; sh.cavity_type = "BOTH"
    scene.display.render_aa = "FXAA"
    scene.render.resolution_x = 640; scene.render.resolution_y = 640
    scene.render.filepath = os.path.join(RENDERS, name)
    bpy.ops.render.render(write_still=True)
    for o in (cam, sun, amb, ground):
        bpy.data.objects.remove(o, do_unlink=True)
    if arm.animation_data: arm.animation_data.action = None
    scene.frame_set(0)

if RENDERS:
    os.makedirs(RENDERS, exist_ok=True)
    render_shot(f"{PID}--front.png", (0, -4.2, 1.05), (D(90), 0, 0))
    render_shot(f"{PID}--iso.png", (2.9, -2.9, 2.6), (D(58), 0, D(45)))
    _sit_end = int(bpy.data.actions["sit"].frame_range[1]) if bpy.data.actions.get("sit") else 10
    _walk_mid = int(bpy.data.actions["walk"].frame_range[1] // 4) if bpy.data.actions.get("walk") else 6
    render_shot(f"{PID}--sit-check.png", (0, -4.2, 1.05), (D(90), 0, 0), frame=_sit_end, action_name="sit")
    render_shot(f"{PID}--type-check.png", (2.9, -2.9, 2.6), (D(58), 0, D(45)), frame=6, action_name="type")
    render_shot(f"{PID}--walk-check.png", (2.9, -2.9, 2.6), (D(58), 0, D(45)), frame=_walk_mid, action_name="walk")

# ---------------------------------------------------------------- export GLB
arm["persona_id"] = PID
arm["clip_source"] = KIT["clip_source"]  # kit-level default; per-clip truth below
arm["clip_sources"] = json.dumps(CLIP_SOURCES)
arm["kit_file"] = os.path.basename(args["kit"])
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
try:
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_animations=True,
                              export_animation_mode="ACTIONS", export_apply=True,
                              export_yup=True, export_extras=True)
except TypeError:
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_animations=True,
                              export_apply=True, export_yup=True, export_extras=True)
print(f"FACTORY_DONE {PID} -> {OUT} ({os.path.getsize(OUT)} bytes)")
