#!/usr/bin/env python3
"""Office avatar factory v2 (DETAIL PASS): kit JSON -> rigged, animated GLB.

Same rig, bone names, clip set and kit files as v1 (build_avatar.py) so the
outputs are drop-in replacements; v2 adds soft-edge procedural textures
(face / fur mottle / compass rose / ledger pages / paddle crosshatch),
geometry detail (whiskers, cheek ruffs, neck, paw toes, layered ear
inners, grounded alpha skirt with suckers) and rebuilt high-detail props.

Usage (Blender headless):
  blender -b --python build_avatar_v2.py -- --kit kits/atlas.json \
      --output outputs-v2/atlas.glb --renders renders-v2

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
import numpy as np

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
# v2 detail materials
mat("accent_glow", "#ffd98a", rough=0.35, metal=0.35, emissive=1.4)   # crescent moon glow
mat("steel", "#8f97a0", rough=0.3, metal=0.85)
mat("whisker", "#e8e2d2", rough=0.6)
mat("shine", "#ffffff", rough=0.1)
_lens = mat("lens", "#cfe4ee", rough=0.08)
_lens.use_nodes = True
_lb = _lens.node_tree.nodes["Principled BSDF"]
try:
    _lb.inputs["Alpha"].default_value = 0.28
    _lens.blend_method = "BLEND"
except Exception:
    pass

# ---------------------------------------------------------------- v2 textures
# Soft-edge procedural textures (numpy). All patterns are smoothstepped /
# gaussian-blurred - no hard shape edges anywhere (v1's main face flaw).
def _smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)

def _upscale(small, S):
    """Bilinear upscale of a small float array to SxS (wrap in u)."""
    n = small.shape[0]
    ys = np.linspace(0, n - 1, S); xs = np.linspace(0, n - 1, S)
    y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int)
    fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
    y1 = np.minimum(y0 + 1, n - 1); x1 = (x0 + 1) % n
    top = small[np.ix_(y0, x0)] * (1 - fx) + small[np.ix_(y0, x1)] * fx
    bot = small[np.ix_(y1, x0)] * (1 - fx) + small[np.ix_(y1, x1)] * fx
    return top * (1 - fy) + bot * fy

def _mottle(S, seed, amp=0.10):
    """Low-frequency value noise in [-amp, +amp], two octaves."""
    rng = np.random.default_rng(seed)
    n1 = _upscale(rng.random((12, 12)), S)
    n2 = _upscale(rng.random((36, 36)), S)
    n = 0.65 * n1 + 0.35 * n2
    return (n - n.mean()) * (2.0 * amp)

def _img_from_rgb(name, rgb):
    """rgb: SxSx3 float array in sRGB -> packed Blender image."""
    S = rgb.shape[0]
    px = np.ones((S, S, 4), dtype=np.float32)
    px[:, :, :3] = np.clip(rgb, 0.0, 1.0)
    img = bpy.data.images.new(name, S, S, alpha=False)
    img.pixels = px.ravel().tolist()
    img.update()
    return img

def _tex_mat(name, img, base_hex, rough=0.85):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    lin = tuple(c ** 2.2 for c in hx(base_hex))
    m.diffuse_color = (*lin, 1.0)
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    MATS[name] = m
    return m

def _blend(base, target, t):
    """base/target: (...,3) arrays or rgb tuples; t: scalar or array."""
    t = np.asarray(t, dtype=np.float64)
    if t.ndim == 2: t = t[:, :, None]
    return base * (1.0 - t) + np.array(target) * t

_SEED = abs(hash(PID)) % 100000

def make_fur_texture():
    """Body fur: soft two-tone mottling over the kit fur colour. Meshes
    without UVs (tubes) sample one texel - harmless near-base colour."""
    S = 512
    fur = np.array(hx(PAL["fur"])); dark = np.array(hx(PAL.get("fur_dark", PAL["fur"])))
    light = np.array(hx(PAL.get("fur_light", "#f5f2ea")))
    mot = _mottle(S, _SEED, amp=0.09)
    rgb = np.zeros((S, S, 3))
    rgb[:] = fur
    rgb = _blend(rgb, dark, np.clip(-mot, 0, None) * 5.0)
    rgb = _blend(rgb, light, np.clip(mot, 0, None) * 3.2)
    return _img_from_rgb(f"{PID}_fur", rgb)

def make_face_texture():
    """v2 face card, 512px: crown-to-jaw soft gradient, gaussian-soft tabby
    striping (top), soft speckle blotches, gentle muzzle lightening."""
    S = 512
    fur = np.array(hx(PAL["fur"])); light = np.array(hx(FACE["muzzle_colour"]))
    dark = np.array(hx(PAL.get("fur_dark", PAL["fur"])))
    yy, xx = np.mgrid[0:S, 0:S]
    u = xx / S; v = yy / S  # v=0 bottom of texture (sphere underside)
    rgb = np.zeros((S, S, 3)); rgb[:] = fur
    mot = _mottle(S, _SEED + 7, amp=0.07)
    rgb = _blend(rgb, dark, np.clip(-mot, 0, None) * 5.0)
    rgb = _blend(rgb, light, np.clip(mot, 0, None) * 3.0)
    # crown darker (mantle shading) -> jaw lighter, both feathered
    rgb = _blend(rgb, dark, _smoothstep(0.58, 0.95, v) * 0.38)
    rgb = _blend(rgb, light, _smoothstep(0.38, 0.05, v) * 0.50)
    if FACE.get("stripes"):
        s = np.sin(u * math.pi * 10.0)
        band = np.sin(np.clip((v - 0.55) / 0.45, 0, 1) * math.pi)
        t = _smoothstep(0.22, 0.85, s) * (band ** 1.5) * 0.68
        rgb = _blend(rgb, dark, t)
    if FACE.get("speckles"):
        rng = np.random.default_rng(_SEED + 21)
        blot = _upscale(rng.random((20, 20)), S)
        t = _smoothstep(0.58, 0.85, blot) * _smoothstep(0.25, 0.45, v) * 0.42
        rgb = _blend(rgb, dark, t)
        dots = _upscale((rng.random((48, 48)) > 0.82).astype(float), S)
        rgb = _blend(rgb, dark, _smoothstep(0.35, 0.9, dots) * 0.30)
    img = _img_from_rgb(f"{PID}_face", rgb)
    return _tex_mat("face_card", img, PAL["fur"])

def make_compass_texture():
    """Brass pocket-compass face: cream dial, tick ring, 8-point star rose."""
    S = 256
    yy, xx = np.mgrid[0:S, 0:S]
    cx = (xx - S / 2) / (S / 2); cy = (yy - S / 2) / (S / 2)
    r = np.sqrt(cx ** 2 + cy ** 2); th = np.arctan2(cy, cx)
    cream = np.array(hx("#f3e5c0")); brass = np.array(hx("#a8873c")); deep = np.array(hx("#5f4632"))
    rgb = np.zeros((S, S, 3)); rgb[:] = cream
    rgb = _blend(rgb, brass, _smoothstep(0.86, 0.90, r) * (1 - _smoothstep(0.97, 1.0, r)))
    ticks = (np.abs(np.sin(th * 24)) > 0.93) & (r > 0.78) & (r < 0.88)
    rgb[ticks] = deep
    star_r = 0.60 * (0.38 + 0.62 * np.abs(np.cos(th * 4)) ** 0.30)
    rgb = _blend(rgb, brass, _smoothstep(0.03, -0.03, r - star_r) * 0.9)
    star2_r = 0.34 * (0.38 + 0.62 * np.abs(np.sin(th * 4)) ** 0.30)
    rgb = _blend(rgb, deep, _smoothstep(0.03, -0.03, r - star2_r) * 0.85)
    rgb = _blend(rgb, deep, _smoothstep(0.09, 0.05, r))
    return _img_from_rgb(f"{PID}_compass", rgb)

def make_ledger_texture():
    """Ledger page: cream paper, faint ruled lines, red margin."""
    S = 256
    paper = np.array(hx("#f5efdd")); ink = np.array(hx("#8a7a5c")); red = np.array(hx("#b04a3a"))
    rgb = np.zeros((S, S, 3)); rgb[:] = paper
    rows = (np.arange(S) % 18) < 2
    rgb[rows] = _blend(rgb[rows], ink, 0.45)
    rgb[:, 26:29] = _blend(rgb[:, 26:29], red, 0.55)
    rng = np.random.default_rng(_SEED + 3)
    for _ in range(9):  # faint handwriting strokes on random ruled lines
        y0 = int(rng.integers(2, 13)) * 18 + 5
        x0 = int(rng.integers(36, 90)); ln = int(rng.integers(60, 170))
        rgb[y0:y0 + 3, x0:min(S - 6, x0 + ln)] = _blend(rgb[y0:y0 + 3, x0:min(S - 6, x0 + ln)], ink, 0.5)
    # transpose: on a Blender box the -Y face swaps the axes, so this puts the
    # ruled lines horizontal on the book's front face (verified by render);
    # side faces then show fine vertical lines, which read as page layers
    rgb = rgb.transpose(1, 0, 2)
    return _img_from_rgb(f"{PID}_ledger", rgb)

def make_paddle_texture():
    """Beaver paddle: dark leather-brown with soft tan crosshatch."""
    S = 256
    base = np.array(hx(PAL.get("fur_dark", "#5f3d20"))); line = np.array(hx(PAL.get("fur_light", "#c9a06a")))
    yy, xx = np.mgrid[0:S, 0:S]
    d1 = np.abs(((xx + yy) % 26) - 13) / 13.0
    d2 = np.abs(((xx - yy) % 26) - 13) / 13.0
    t = np.maximum(_smoothstep(0.86, 0.99, 1 - d1), _smoothstep(0.86, 0.99, 1 - d2)) * 0.5
    rgb = np.zeros((S, S, 3)); rgb[:] = base
    rgb = _blend(rgb, line, t)
    mot = _mottle(S, _SEED + 11, amp=0.06)
    rgb = _blend(rgb, line, np.clip(mot, 0, None) * 2.5)
    return _img_from_rgb(f"{PID}_paddle", rgb)

FACE_MAT = make_face_texture()
_tex_mat("fur_tex", make_fur_texture(), PAL["fur"])
if PID == "alpha-lead":
    _tex_mat("compass_face", make_compass_texture(), "#f3e5c0", rough=0.5)
if PID == "atlas":
    _tex_mat("ledger_pages", make_ledger_texture(), "#f5efdd", rough=0.7)
if PARTS["tail_style"] == "beaver_paddle":
    _tex_mat("paddle_tex", make_paddle_texture(), PAL.get("fur_dark", "#5f3d20"), rough=0.6)

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

def add_tube_r(name, points, radii, material, bone_name, radial=8):
    """Sweep with a per-point radius profile (tapered crescents, tail tips)."""
    pts = [Vector(p) for p in points]
    verts, faces = [], []
    n = len(pts)
    for i, p in enumerate(pts):
        if i == 0: tan = (pts[1] - pts[0]).normalized()
        elif i == n - 1: tan = (pts[-1] - pts[-2]).normalized()
        else: tan = (pts[i + 1] - pts[i - 1]).normalized()
        ref = Vector((0, 0, 1)) if abs(tan.z) < 0.9 else Vector((1, 0, 0))
        nrm = tan.cross(ref).normalized(); binm = tan.cross(nrm).normalized()
        r = radii[i]
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

def add_disc(name, loc, r, material, bone_name, rot=(math.radians(90), 0, 0), verts=14):
    """Thin cylinder disc (suckers, buttons, whisker dots, toe beans)."""
    return add_cyl(name, loc, r, 0.006, material, bone_name, rot=rot, verts=verts)

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
add_box("spine_mesh", (0, 0, 1.05), (0.34, 0.22, 0.12), MATS["garment"], "spine")
if OCTO:
    # naval coat front panel + brass buttons (the master's wave coat)
    add_box("coat_panel", (0, -0.125, 1.16), (0.30, 0.035, 0.30), MATS["garment_dark"], "chest")
    for bz in (1.245, 1.095):
        add_disc("coat_button", (0, -0.148, bz), 0.021, MATS["accent"], "chest")
    # collar: two angled coat wings at the neck + accent throat button
    for sx in (1, -1):
        add_box("coat_collar", (sx * 0.105, -0.055, 1.345), (0.21, 0.05, 0.11), MATS["garment_dark"], "chest",
                rot=(0.35, 0, sx * -0.45))
    add_disc("coat_throat_button", (0, -0.135, 1.315), 0.018, MATS["accent"], "chest")
else:
    # v2: neck join + ROUNDED chest/belly patches (v1's flat slabs are gone)
    add_cyl("neck", (0, 0, 1.315), 0.105, 0.17, MATS["fur_tex"], "chest")
    add_sphere("chest_patch", (0, -0.10, 1.175), (0.16, 0.08, 0.165), MATS["fur_light"], "chest")
    add_sphere("belly_patch", (0, -0.09, 0.985), (0.145, 0.065, 0.115), MATS["fur_light"], "hips")

if not OCTO:
    for s, sx in (("L", 1), ("R", -1)):
        add_box(f"thigh.{s}", (sx * 0.115, 0, 0.70), (0.15, 0.17, 0.42), MATS["garment_dark"], f"leg.{s}")
        add_box(f"shin.{s}", (sx * 0.12, 0, 0.29), (0.13, 0.15, 0.44), MATS["fur_tex"], f"shin.{s}")
        if PID == "atlas":  # tabby leg bands (geometry - reads in every renderer)
            for bz in (0.38, 0.22):
                add_box(f"shin_band.{s}", (sx * 0.12, 0, bz), (0.142, 0.162, 0.034), MATS["fur_dark"], f"shin.{s}")
        # v2 paw foot: rounded sphere, toe groove, atlas toe beans
        add_sphere(f"foot.{s}", (sx * 0.12, -0.035, 0.052), (0.076, 0.115, 0.052),
                   MATS["fur_light"] if PID == "atlas" else MATS["fur_tex"], f"shin.{s}")
        add_box(f"toe_groove.{s}", (sx * 0.12, -0.128, 0.078), (0.105, 0.014, 0.014), MATS["fur_dark"], f"shin.{s}")
        if PID == "atlas":
            add_disc(f"toe_pad.{s}", (sx * 0.12, -0.098, 0.022), 0.021, MATS["pink"], f"shin.{s}",
                     rot=(math.radians(118), 0, 0))
            for dx in (-0.034, 0.0, 0.034):
                add_disc(f"toe_bean.{s}", (sx * 0.12 + dx, -0.118, 0.048), 0.009, MATS["pink"], f"shin.{s}",
                         rot=(math.radians(118), 0, 0))
# arms (all plans; octopus arms are its two working tentacles, tubed below)
for s, sx in (("L", 1), ("R", -1)):
    if OCTO:
        add_tube(f"arm.{s}_mesh", [(sx * 0.19, 0, 1.27), (sx * 0.30, -0.02, 1.02), (sx * 0.34, -0.06, 0.88)],
                 0.075, 0.055, MATS["fur"], f"arm.{s}")
        add_tube(f"forearm.{s}_mesh", [(sx * 0.33, 0, 0.80), (sx * 0.36, -0.08, 0.70), (sx * 0.34, -0.12, 0.62)],
                 0.055, 0.028, MATS["fur"], f"forearm.{s}")
        # v2.1: elbow joint sphere - the bare tentacle tubes pivot around
        # different points and gaped visibly in bent poses (sit check)
        add_sphere(f"elbow.{s}", (sx * 0.335, -0.03, 0.845), (0.060, 0.058, 0.060), MATS["fur"], f"arm.{s}")
        # v2.2: centre pulled toward the wrist joint (0.33,0,0.80) - at the
        # v2.0 spot the ball orbited the joint in bent poses and floated free
        add_sphere(f"hand.{s}_mesh", (sx * 0.34, -0.07, 0.685), (0.056, 0.054, 0.056), MATS["fur"], f"hand.{s}")
        # sucker discs down the front of each working tentacle
        for t, sr in ((0.30, 0.020), (0.55, 0.017), (0.80, 0.013)):
            px = sx * (0.30 + 0.05 * t); py = -0.075 - 0.05 * t; pz = 1.02 - 0.16 * t
            add_disc(f"sucker_arm.{s}", (px, py, pz), sr, MATS["fur_light"], f"arm.{s}")
    else:
        add_sphere(f"shoulder.{s}", (sx * 0.205, 0, 1.255), (0.08, 0.075, 0.08), MATS["garment"], f"arm.{s}")
        add_box(f"arm.{s}_mesh", (sx * 0.245, 0, 1.14), (0.115, 0.115, 0.28), MATS["garment"], f"arm.{s}")
        add_box(f"forearm.{s}_mesh", (sx * 0.315, 0, 0.915), (0.10, 0.10, 0.25), MATS["fur_tex"], f"forearm.{s}")
        if PID == "atlas":  # tabby forearm band
            add_box(f"forearm_band.{s}", (sx * 0.315, 0, 0.965), (0.112, 0.112, 0.03), MATS["fur_dark"], f"forearm.{s}")
        _hm = MATS["fur_light"] if PID == "atlas" else MATS["fur_tex"]
        add_sphere(f"hand.{s}_mesh", (sx * 0.335, -0.005, 0.715), (0.058, 0.052, 0.072), _hm, f"hand.{s}")
        add_sphere(f"thumb.{s}", (sx * 0.312, -0.048, 0.70), (0.02, 0.018, 0.024), _hm, f"hand.{s}")

# head
if OCTO:
    add_sphere("head_mesh", HEAD_C, (0.335, 0.32, 0.315), FACE_MAT, "head", seg=20, rings=14)
else:
    add_sphere("head_mesh", HEAD_C, (0.295, 0.27, 0.29), FACE_MAT, "head", seg=20, rings=14)

# face geometry (front = -Y): muzzle, nose, eyes
snout = PARTS["snout_style"]
WHISK = None  # (base_x, base_y, base_z, tip_x) set per snout for whiskers/dots
if snout == "cat_small":
    add_sphere("muzzle", (0, -0.225, 1.425), (0.155, 0.095, 0.10), MATS["fur_light"], "head")
    add_sphere("nose", (0, -0.295, 1.465), (0.038, 0.022, 0.026), MATS["pink"] if PID == "atlas" else MATS["nose"], "head")
    add_box("mouth", (0, -0.294, 1.360), (0.05, 0.014, 0.012), MATS["fur_dark"], "head")  # small mouth line (on the muzzle surface; v2.0 spot was buried inside it)
    WHISK = (0.085, -0.272, 1.452, 0.37)
elif snout == "beaver_wide":
    add_sphere("muzzle", (0, -0.21, 1.42), (0.20, 0.115, 0.115), MATS["fur_light"], "head")
    add_sphere("nose", (0, -0.30, 1.475), (0.062, 0.03, 0.04), MATS["nose"], "head")
    if FACE.get("incisors"):
        # v2: mouth shadow first, then TWO teeth with a centre groove
        add_box("mouth_shadow", (0, -0.30, 1.322), (0.115, 0.02, 0.03), MATS["dark"], "head")
        for tx in (-0.021, 0.021):
            add_box("incisor", (tx, -0.302, 1.345), (0.037, 0.02, 0.088), MATS["white"], "head")
    WHISK = (0.125, -0.262, 1.448, 0.41)
elif snout == "fox_pointed":
    # v2: tapered sphere snout (v1's cone read as a white disc from the front)
    add_sphere("muzzle", (0, -0.255, 1.432), (0.108, 0.135, 0.088), MATS["fur_light"], "head")
    add_sphere("nose", (0, -0.372, 1.452), (0.043, 0.03, 0.033), MATS["nose"], "head")
    add_box("mouth", (0, -0.345, 1.372), (0.055, 0.012, 0.014), MATS["fur_dark"], "head")
    WHISK = (0.052, -0.335, 1.462, 0.34)
if WHISK:  # whisker dots + 3 whiskers per side (all whiskered masters)
    bx, by, bz, tipx = WHISK
    # dot anchors solved onto each muzzle's ellipsoid surface (v2.0 dots sat
    # at ellipsoid norm ~0.67 - buried inside the muzzle, invisible)
    _DOT = {"cat_small": (0.055, -0.312, 1.440), "beaver_wide": (0.100, -0.305, 1.450),
            "fox_pointed": (0.038, -0.372, 1.455)}[snout]
    for sx in (1, -1):
        for dz, dy in ((0.014, 0.006), (0.0, 0.0), (-0.014, -0.006)):
            add_disc("whisker_dot", (sx * _DOT[0], _DOT[1] + dy - 0.004, _DOT[2] + dz), 0.0055, MATS["fur_dark"], "head", verts=8)
        for k, (dz, droop) in enumerate(((0.018, 0.004), (0.0, -0.006), (-0.018, -0.016))):
            add_tube(f"whisker_{k}", [(sx * bx, by, bz + dz),
                                      (sx * (bx + tipx) * 0.55, by - 0.012, bz + dz + droop),
                                      (sx * tipx, by + droop * 2.2, bz + dz + droop * 1.6)],
                     0.0032, 0.0016, MATS["whisker"], "head", radial=5)
_eye_y = -0.298 if OCTO else -0.238   # octopus dome is deeper; eyes must sit on its surface
_pup_y = -0.328 if OCTO else -0.262
for sx in (1, -1):
    if OCTO:  # v2: brow ridge behind + heavy lid above (the master's sleepy gaze)
        add_sphere(f"eye_ridge.{'L' if sx>0 else 'R'}", (sx * 0.108, -0.268, 1.578), (0.078, 0.042, 0.05), MATS["fur"], "head")
    add_sphere(f"eye.{'L' if sx>0 else 'R'}", (sx * 0.108, _eye_y, 1.565), (0.046, 0.026, 0.052), MATS["eye"], "head")
    add_sphere(f"pupil.{'L' if sx>0 else 'R'}", (sx * 0.108, _pup_y, 1.57), (0.021, 0.012, 0.026), MATS["dark"], "head")
    add_sphere(f"eye_shine.{'L' if sx>0 else 'R'}", (sx * 0.108 - 0.014, _pup_y - 0.008, 1.588), (0.009, 0.006, 0.009), MATS["shine"], "head")
    if OCTO:
        add_sphere(f"eyelid.{'L' if sx>0 else 'R'}", (sx * 0.108, -0.282, 1.604), (0.056, 0.03, 0.024), MATS["fur_dark"], "head")
    if snout == "fox_pointed":  # stern brow ridges from the fox master
        add_box(f"brow.{'L' if sx>0 else 'R'}", (sx * 0.112, -0.252, 1.648), (0.105, 0.02, 0.026),
                MATS["fur_dark"], "head", rot=(0.25, 0, sx * 0.38))
if OCTO:  # v2: gentle smile as a surface-hugging tube (v1's torus read as a sticker)
    _pts = []
    for i in range(9):
        _x = -0.078 + 0.156 * i / 8
        _z = 1.364 + 0.017 * (_x / 0.078) ** 2  # v2.1: corners UP = gentle smile (v2.0's arc read as a frown)
        _y = -0.32 * math.sqrt(max(0.05, 1 - (_x / 0.335) ** 2 - ((_z - 1.50) / 0.315) ** 2)) - 0.004
        _pts.append((_x, _y, _z))
    add_tube("mouth", _pts, 0.006, 0.006, MATS["fur_dark"], "head", radial=6)
if FACE.get("stripes"):  # tabby striping: forehead comes from the painted
    # face card (soft edges) - v2.0's geometry boxes read as a crown of blocks
    # in renders and were removed; the cheek boxes stay (they read as marks)
    if PID == "atlas":  # cheek stripes (the master's striping wraps the cheeks)
        for sx in (1, -1):
            for dz, rz in ((0.03, 0.15), (-0.035, -0.1)):
                add_box("cheek_stripe", (sx * 0.238, -0.115, 1.545 + dz), (0.02, 0.045, 0.075),
                        MATS["fur_dark"], "head", rot=(0.15, sx * -0.42, rz))
# cheek ruffs: fox gets the master's big cream ruffs; atlas subtle grey volume
if snout == "fox_pointed":
    for sx in (1, -1):
        add_sphere("cheek_ruff", (sx * 0.175, -0.095, 1.375), (0.115, 0.075, 0.135), MATS["fur_light"], "head")
    add_sphere("chin_blaze", (0, -0.148, 1.358), (0.072, 0.055, 0.055), MATS["fur_light"], "head")  # v2.1: tucked up (v2.0 hung as a separate ball)
elif PID == "atlas":
    for sx in (1, -1):
        add_sphere("cheek_ruff", (sx * 0.165, -0.075, 1.395), (0.095, 0.06, 0.11), MATS["fur_tex"], "head")

# ears (silhouette at 115%+; fox at 135%) - v2 layered inners
es = PARTS["ear_style"]; esc = PARTS.get("ear_scale", 1.15)
for s, sx in (("L", 1), ("R", -1)):
    bn = f"extra.ear.{s}"
    if es == "cat_triangle":
        add_cone(f"ear.{s}", (sx * 0.155, 0, 1.80), 0.085 * esc, 0.008, 0.24 * esc, MATS["fur_tex"], bn, rot=(0, sx * -0.18, 0))
        add_cone(f"ear_inner.{s}", (sx * 0.148, -0.042, 1.785), 0.052 * esc, 0.006, 0.175 * esc, MATS["pink"], bn, rot=(0, sx * -0.18, 0))
    elif es == "round":
        add_sphere(f"ear.{s}", (sx * 0.21, 0, 1.70), (0.085 * esc, 0.04, 0.085 * esc), MATS["fur_tex"], bn)
        add_disc(f"ear_inner.{s}", (sx * 0.21, -0.038, 1.70), 0.048 * esc, MATS["fur_light"], bn)
    elif es == "fox_tall":
        add_cone(f"ear.{s}", (sx * 0.165, 0, 1.86), 0.095, 0.006, 0.36 * esc, MATS["fur_tex"], bn, rot=(0, sx * -0.13, 0))
        # cream fringe cone behind a dark inner cone (the master's ear)
        add_cone(f"ear_fringe.{s}", (sx * 0.157, -0.034, 1.845), 0.054, 0.005, 0.27 * esc, MATS["fur_light"], bn, rot=(0, sx * -0.13, 0))
        add_cone(f"ear_inner.{s}", (sx * 0.155, -0.046, 1.84), 0.036, 0.004, 0.22 * esc, MATS["nose"], bn, rot=(0, sx * -0.13, 0))

# tail - v2 detail
ts = PARTS["tail_style"]
if ts == "cat_curved":
    # one tapered sweep + thin dark tabby rings + DARK tip (per the master -
    # Atlas's tail tip is dark grey, not white)
    add_tube_r("tail_main", [(0, 0.10, 0.94), (0, 0.20, 0.855), (0, 0.28, 0.83), (0, 0.345, 0.875),
                             (0, 0.375, 0.95), (0, 0.375, 1.03), (0, 0.365, 1.12)],
               [0.052, 0.050, 0.047, 0.044, 0.040, 0.035, 0.028], MATS["fur"], "extra.tail")
    for rp, rr in ((((0, 0.222, 0.847), (0, 0.262, 0.838)), 0.050),
                   (((0, 0.312, 0.848), (0, 0.343, 0.872)), 0.045),
                   (((0, 0.374, 0.975), (0, 0.374, 1.03)), 0.038)):
        add_tube("tail_ring", [rp[0], rp[1]], rr, rr, MATS["fur_dark"], "extra.tail")
    add_tube("tail_tip", [(0, 0.372, 1.05), (0, 0.365, 1.125)], 0.036, 0.027, MATS["fur_dark"], "extra.tail")
elif ts == "fox_bushy":
    add_tube_r("tail_main", [(0, 0.10, 0.94), (0, 0.30, 0.80), (0, 0.40, 0.90)],
               [0.088, 0.082, 0.076], MATS["fur"], "extra.tail")
    _f = hx(PAL["fur"]); _l = hx(PAL["fur_light"])
    _mixhex = "#%02x%02x%02x" % tuple(int((a + b) / 2 * 255) for a, b in zip(_f, _l))
    mat("tail_blend", _mixhex)  # feathered colour junction before the white tip
    add_tube("tail_blend", [(0, 0.40, 0.90), (0, 0.425, 0.985)], 0.076, 0.066, MATS["tail_blend"], "extra.tail")
    add_tube_r("tail_tip", [(0, 0.425, 0.985), (0, 0.44, 1.09)], [0.066, 0.042], MATS["fur_light"], "extra.tail")
elif ts == "beaver_paddle":
    # rounded paddle with crosshatch texture (v1 was a bare slab)
    add_tube("tail_stalk", [(0, 0.12, 0.88), (0, 0.24, 0.64)], 0.048, 0.055, MATS["fur_dark"], "extra.tail")
    # v2.1 fix: v2.0's scale put the long axis in Y (depth) and the +38 tilt
    # swung the top through the body - it rendered as an apron between the
    # legs. The paddle is a vertical oval plate BEHIND: tall in Z, thin in Y,
    # top leaning back (-38 about X).
    _pad = add_sphere("tail_paddle", (0, 0.315, 0.50), (0.115, 0.032, 0.185), MATS["paddle_tex"], "extra.tail")
    _pad.rotation_euler = (math.radians(-38), 0, 0)
if OCTO:
    # v2 skirt: GROUNDED (v1 floated at z 0.42), one fur tone (v1's alternating
    # stripes read as trousers), curled front tips, sucker discs on the front
    for k in range(8):
        a = 2 * math.pi * k / 8
        bx, by = math.sin(a) * 0.17, math.cos(a) * 0.15
        tx, ty = math.sin(a) * 0.315, math.cos(a) * 0.285
        pts = [(bx, by, 0.96), ((bx + tx) / 2, (by + ty) / 2, 0.52), (tx, ty, 0.07)]
        if math.cos(a) < -0.5:  # front pair curls forward at the tip
            pts.append((tx, ty - 0.075, 0.13))
        add_tube_r(f"skirt_tentacle_{k}", pts, [0.070, 0.055, 0.034, 0.026][:len(pts)], MATS["fur"], "hips")
        if math.cos(a) < -0.3:  # front-facing tentacles carry suckers
            dx, dy = math.sin(a), math.cos(a)
            for t, sr in ((0.52, 0.021), (0.70, 0.017), (0.86, 0.013)):
                px = bx + (tx - bx) * t + dx * 0.052
                py = by + (ty - by) * t + dy * 0.052
                pz = 0.96 + (0.07 - 0.96) * t
                add_disc(f"skirt_sucker_{k}", (px, py, pz), sr, MATS["fur_light"], "hips",
                         rot=(math.radians(90), 0, -a + math.pi))
    add_cyl("hem_band", (0, 0, 0.95), 0.235, 0.10, MATS["garment"], "hips")

# ---------------------------------------------------------------- props (125%)
HAND_R = (-0.335, -0.06, 0.72); HAND_L = (0.335, -0.06, 0.72)
def prop_staff():
    # v2: gently gnarled shaft (3-point sweep) + knob; crescent with a radius
    # profile - fat at the crown, tapering to points - in warm glowing gold
    shaft = add_tube("staff_shaft", [(-0.415, -0.10, 0.28), (-0.435, -0.105, 0.95), (-0.42, -0.10, 1.80)],
                     0.027, 0.023, MATS["wood"], "hand.R")
    knob = add_sphere("staff_knob", (-0.448, -0.108, 1.13), (0.034, 0.032, 0.042), MATS["wood"], "hand.R")
    pts, rads = [], []
    for d in range(38, 323, 12):
        a = math.radians(d)
        pts.append((-0.42 + math.cos(a) * 0.148, -0.10, 1.875 + math.sin(a) * 0.148))
        _t = (d - 38) / 284.0  # tip -> tip along the arc; thickest mid-arc
        rads.append(0.008 + 0.026 * math.sin(math.pi * _t) ** 0.8)
    cres = add_tube_r("staff_crescent", pts, rads, MATS["accent_glow"], "hand.R", radial=10)
    join_objects("prop.crescent_staff", [shaft, knob, cres], "hand.R")
def prop_ledger():
    # v2: open book - cover, two angled textured page blocks, spine, ribbon
    parts = [add_box("ledger_cover", (0.44, -0.085, 0.76), (0.30, 0.035, 0.36), MATS["wood"], "hand.L")]
    for sx in (1, -1):
        parts.append(add_box(f"ledger_page_{sx}", (0.44 + sx * 0.068, -0.115, 0.76), (0.135, 0.022, 0.325),
                             MATS["ledger_pages"], "hand.L", rot=(0, 0, -sx * 0.16)))
    parts.append(add_cyl("ledger_spine", (0.44, -0.095, 0.76), 0.016, 0.33, MATS["garment_dark"], "hand.L"))
    parts.append(add_box("ledger_ribbon", (0.475, -0.10, 0.545), (0.022, 0.012, 0.09), MATS["red"], "hand.L"))
    parts.append(add_box("ledger_clasp", (0.44, -0.125, 0.925), (0.07, 0.014, 0.03), MATS["accent"], "hand.L"))
    join_objects("prop.ledger", parts, "hand.L")
def prop_level():
    # v2: three vials in dark frames (long horizontal + two round plumb, per
    # the master), end caps, ruler ticks - all riding the body's 0.35 tilt
    C = Vector((-0.40, -0.12, 0.86)); tilt = 0.35
    ca, sa = math.cos(tilt), math.sin(tilt)
    def at(t, dy=0.0, dz=0.0):
        return tuple(C + Vector((ca * t, sa * t + dy, dz)))
    parts = [add_box("level_body", tuple(C), (0.62, 0.055, 0.10), MATS["yellow"], "hand.R", rot=(0, 0, tilt))]
    for e in (-0.30, 0.30):
        parts.append(add_box("level_cap", at(e), (0.035, 0.06, 0.105), MATS["dark"], "hand.R", rot=(0, 0, tilt)))
    # long horizontal vial
    parts.append(add_box("level_vial_frame", at(0.0, -0.030), (0.21, 0.012, 0.052), MATS["dark"], "hand.R", rot=(0, 0, tilt)))
    _vial_rot = Vector((ca, sa, 0)).to_track_quat("Z", "Y").to_euler()
    parts.append(add_cyl("level_vial", at(0.0, -0.038), 0.020, 0.17, MATS["green_glass"], "hand.R",
                         rot=tuple(_vial_rot)))
    # two round plumb vials
    for e in (-0.185, 0.185):
        parts.append(add_disc("level_plumb_frame", at(e, -0.031), 0.034, MATS["dark"], "hand.R"))
        parts.append(add_disc("level_plumb", at(e, -0.036), 0.024, MATS["green_glass"], "hand.R"))
    for i in range(9):  # ruler ticks along the front top edge
        t = -0.24 + i * 0.06
        parts.append(add_box("level_tick", at(t, -0.029, 0.036), (0.006, 0.008, 0.020), MATS["dark"], "hand.R", rot=(0, 0, tilt)))
    join_objects("prop.spirit_level", parts, "hand.R")
def prop_pencil():
    # v2: hex body, wood cone, graphite point, brass ferrule, pink eraser -
    # laid out parametrically along one axis
    P0 = Vector((-0.345, -0.075, 0.905)); Dv = Vector((0.10, -0.16, -0.52)).normalized()
    def seg(name, t0, t1, r0, r1, material, verts=12):
        c = P0 + Dv * ((t0 + t1) / 2)
        rot = Dv.to_track_quat("Z", "Y").to_euler()
        if r0 == r1:
            return add_cyl(name, tuple(c), r0, t1 - t0, material, "hand.R", rot=rot, verts=verts)
        return add_cone(name, tuple(c), r0, r1, t1 - t0, material, "hand.R", rot=rot, verts=verts)
    parts = [seg("pencil_eraser", 0.00, 0.028, 0.0165, 0.0165, MATS["pink"]),
             seg("pencil_ferrule", 0.028, 0.058, 0.018, 0.018, MATS["accent"]),
             seg("pencil_body", 0.058, 0.318, 0.017, 0.017, MATS["red"], verts=6),
             seg("pencil_wood", 0.318, 0.372, 0.017, 0.004, MATS["cream"]),
             seg("pencil_lead", 0.372, 0.392, 0.004, 0.0008, MATS["dark"])]
    join_objects("prop.red_pencil", parts, "hand.R")
def prop_calipers():
    # v2: beam + slider + thumbwheel + two legs ending in pointed jaws
    parts = [add_box("caliper_beam", (0.43, -0.10, 0.965), (0.24, 0.028, 0.03), MATS["steel"], "hand.L"),
             add_disc("caliper_hinge", (0.345, -0.10, 0.965), 0.026, MATS["accent"], "hand.L"),
             add_box("caliper_slider", (0.475, -0.10, 0.962), (0.055, 0.042, 0.052), MATS["accent"], "hand.L"),
             add_cyl("caliper_wheel", (0.475, -0.128, 0.995), 0.02, 0.014, MATS["accent"], "hand.L",
                     rot=(math.radians(90), 0, 0)),
             add_box("caliper_leg_fixed", (0.345, -0.10, 0.815), (0.02, 0.028, 0.27), MATS["steel"], "hand.L"),
             add_box("caliper_leg_slide", (0.475, -0.10, 0.815), (0.02, 0.028, 0.27), MATS["steel"], "hand.L")]
    for lx in (0.345, 0.475):
        parts.append(add_cone("caliper_tip", (lx, -0.10, 0.645), 0.013, 0.001, 0.075, MATS["steel"], "hand.L",
                              rot=(math.radians(180), 0, 0)))
    join_objects("prop.calipers", parts, "hand.L")
def prop_spectacles():
    # v2 FIX: v1's rims were unrotated tori (edge-on smudge) and sat 0.034
    # below the eyes. Rims now face forward, centred ON the eyes, with
    # translucent lenses and temple arms back to the ears.
    parts = []
    for sx in (1, -1):
        parts.append(add_torus(f"spec_rim_{sx}", (sx * 0.108, -0.252, 1.565), 0.070, 0.010, MATS["accent"], "head",
                               rot=(math.radians(90), 0, 0)))
        parts.append(add_disc(f"spec_lens_{sx}", (sx * 0.108, -0.249, 1.565), 0.064, MATS["lens"], "head", verts=20))
        parts.append(add_box(f"spec_temple_{sx}", (sx * 0.180, -0.172, 1.572), (0.012, 0.17, 0.012), MATS["accent"], "head"))
    parts.append(add_box("spec_bridge", (0, -0.252, 1.578), (0.08, 0.013, 0.013), MATS["accent"], "head"))
    join_objects("prop.spectacles", parts, "head")
def prop_compass():
    # v2: brass case + rim ring, star-rose dial texture, glass, two-tone
    # needle with centre pin, and the bail loop from the master
    parts = [add_cyl("compass_case", (-0.40, -0.10, 0.80), 0.105, 0.034, MATS["accent"], "hand.R", rot=(math.radians(90), 0, 0)),
             add_torus("compass_rim", (-0.40, -0.120, 0.80), 0.096, 0.011, MATS["accent"], "hand.R",
                       rot=(math.radians(90), 0, 0)),
             add_disc("compass_face", (-0.40, -0.118, 0.80), 0.094, MATS["compass_face"], "hand.R", verts=24),
             add_disc("compass_glass", (-0.40, -0.126, 0.80), 0.094, MATS["lens"], "hand.R", verts=24),
             add_cone("compass_needle_n", (-0.40, -0.130, 0.8375), 0.011, 0.001, 0.075, MATS["red"], "hand.R"),
             add_cone("compass_needle_s", (-0.40, -0.130, 0.7625), 0.011, 0.001, 0.075, MATS["white"], "hand.R",
                      rot=(math.radians(180), 0, 0)),
             add_sphere("compass_pin", (-0.40, -0.132, 0.80), (0.013, 0.008, 0.013), MATS["dark"], "hand.R"),
             add_torus("compass_bail", (-0.40, -0.10, 0.925), 0.028, 0.007, MATS["accent"], "hand.R")]
    join_objects("prop.compass", parts, "hand.R")

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
def render_shot(name, cam_loc, cam_rot, frame=0, action_name=None, target=(0, 0, 0.92), ortho=2.55):
    if action_name:
        act = bpy.data.actions.get(action_name)
        if not arm.animation_data: arm.animation_data_create()
        arm.animation_data.action = act
    scene.frame_set(frame)
    cam_data = bpy.data.cameras.new("cam"); cam_data.type = "ORTHO"; cam_data.ortho_scale = ortho
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
    # v2 note: on this VM Blender 5.2's Workbench dies without libEGL.so.1;
    # AVATAR_RENDER_ENGINE=CYCLES selects the CPU fallback (slower, shaded).
    _engine = os.environ.get("AVATAR_RENDER_ENGINE", "BLENDER_WORKBENCH")
    scene.render.engine = _engine
    if _engine == "CYCLES":
        scene.cycles.samples = 24
        scene.cycles.use_denoising = False
        scene.cycles.device = "CPU"
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
    render_shot(f"{PID}--head.png", (0, -3.4, 1.52), (D(90), 0, 0), target=(0, 0, 1.52), ortho=1.05)
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
