#!/usr/bin/env python3
"""Building set builder — Portal M4.14 (Ember building set).

Assembles one GLB per place from the kit cards in kits/bld_<slug>.json
against the footprint contract in build/visual/footprint-specs.json:

  base      Quaternius Medieval Village MegaKit modular pieces
            (assets-src/packs/quaternius-village-megakit) composed on
            the 2-unit module grid + Village Pack landmarks
            (assets-src/packs/quaternius-village-pack) from .blend
            (Bell Tower, Blacksmith, Houses, Cart, benches).
  dress     NEUTRAL only (M4.15 D-9b): every surface is a flat token
            colour from the palette anchors; pack textures are
            stripped and materials remapped by role. This script reads
            no integrity/condition input and produces no variant.
  custom    Benny the Pug statue (Plaza, <= 400 tris) and the Ledger
            printing press (<= 600 tris, platen on a pivot sub-node)
            from primitives, per visual-plan/02 §5.1.
  anchors   buildings export anchor_sign / anchor_door /
            anchor_cam_interior empties (§5.2), cut_roof /
            cut_wall_front / cut_wall_side sub-nodes (§5.3), and named
            stations where recipes name them. M5.08/M4.12 read these;
            they are built now, not retrofitted.

Coordinates: Blender Z-up; the exporter converts to Y-up. Blender +Y
is north (away from the canonical camera): south face = -Y, east =
+X. Card door faces are compass directions in the scene frame.

Usage (Blender headless):
  blender -b --python scripts/build_buildings.py -- \
      [--only bld_ember_college] [--render-dir <dir>]
Prints BUILDING_SUMMARY <json> per building; writes GLBs to
outputs-buildings/ and the manifest to
build/visual/scene/building-kits.json.
"""
import bpy, json, math, os, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
args = {}
i = 0
while i < len(argv):
    if argv[i].startswith("--"):
        k = argv[i][2:]
        if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
            args[k] = argv[i + 1]; i += 2
        else:
            args[k] = True; i += 1
    else:
        i += 1

FACTORY = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
PORTAL = os.path.abspath(os.path.join(FACTORY, "..", "..", ".."))
PACKS = os.path.join(PORTAL, "assets-src", "packs")
MEGA = os.path.join(PACKS, "quaternius-village-megakit", "Medieval Village MegaKit[Standard]", "glTF")
VILLAGE = os.path.join(PACKS, "quaternius-village-pack")
SPECS = json.load(open(os.path.join(PORTAL, "build", "visual", "footprint-specs.json")))
SPEC = {s["code"]: s for s in SPECS["specs"]}
OUTDIR = os.path.join(FACTORY, "outputs-buildings")
SIGNS = os.path.join(FACTORY, "assets", "signs")
os.makedirs(OUTDIR, exist_ok=True)

# Palette anchors (build/visual/palette-anchors.json values, mirrored
# in scene.mjs PAL — the anchors arbitrate over plan constants).
# grass: amended anchor #CDEAC0 (the project owner's ruling, DECISIONS.md
# 2026-11-03, T1a — the sampled #E5CE9D read as sand). Mirror only:
# no GLB was rebuilt for the amendment; this value takes effect on
# the next factory run that uses it.
PAL = {
    "grass": 0xCDEAC0, "cobbleLit": 0xE2CFC1, "cobbleShade": 0xDCC7B4,
    "timber": 0x99775B, "trimPale": 0xCFBE95, "collegeRoof": 0x8679A0,
    "townhallRoof": 0xFDE5CF, "blossom": 0xE3B5AA, "awningCream": 0xFDCFAC,
    "signWood": 0xDDD595, "gold": 0xD9A441, "paper": 0xFFFBF0,
    "glass": 0xBFE3F2, "iron": 0x6B5138, "fawn": 0xE8C39E,
}

def hexcol(h):
    return ((h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255, 1.0)

_mats = {}
def flat(name, hexv):
    key = "flat_" + name + "_" + format(hexv, "06x")
    if key not in _mats:
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        bsdf = m.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = hexcol(hexv)
        bsdf.inputs["Roughness"].default_value = 1.0
        _mats[key] = m
    return _mats[key]

def texmat(name, path):
    key = "tex_" + name
    if key not in _mats:
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Roughness"].default_value = 0.9
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(path)
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        _mats[key] = m
    return _mats[key]

ROLE_BY_MATNAME = [
    ("RoundTiles", "roof"), ("Plaster", "wall"), ("UnevenBrick", "stone"),
    ("RedBrick", "stone"), ("Brick", "stone"), ("RockTrim", "trim"),
    ("WoodTrim", "timber"), ("Wood", "timber"), ("Metal", "iron"),
    ("Glass", "glass"), ("Vine", "leaf"), ("Leaf", "leaf"),
    ("Cloth", "cloth"), ("Fabric", "cloth"), ("Hay", "cloth"),
    ("Roof", "roof"), ("Stone", "stone"),
]

def role_of(matname, default="wall"):
    for key, role in ROLE_BY_MATNAME:
        if key.lower() in (matname or "").lower():
            return role
    return default

def recolour(objs, rolecol):
    for o in objs:
        if o.type != "MESH":
            continue
        for idx, slot in enumerate(list(o.data.materials)):
            role = role_of(slot.name if slot else "")
            o.data.materials[idx] = flat(role, rolecol.get(role, rolecol["wall"]))

def bbox_of(objs):
    mins = Vector((1e9,) * 3); maxs = Vector((-1e9,) * 3)
    for o in objs:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            v = o.matrix_world @ Vector(c)
            for k in range(3):
                mins[k] = min(mins[k], v[k]); maxs[k] = max(maxs[k], v[k])
    return mins, maxs

def tri_count(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons)
               for o in objs if o.type == "MESH")

def mk_empty(name, x, y, z, parent=None):
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    e.location = (x, y, z)
    if parent:
        e.parent = parent
    return e

def reparent(obj, parent):
    """Local-keeping parenting: the object's current location/rotation/
    scale become its LOCAL transform under the new parent. Every call
    site in this builder positions children in the parent's local
    space (or positions the parent afterwards), which is what this
    does. (The world-preserving variant — matrix_parent_inverse =
    inv(parent.matrix_world) — silently leaves children at the origin
    when the parent was placed first; that bug cost one build round
    and is why this helper exists in exactly one form.)"""
    obj.parent = parent
    obj.matrix_parent_inverse = Matrix.Identity(4)

def _finish_import(before, x, y, z, rotz, scale, parent, rolecol, name):
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    mins, maxs = bbox_of(new)
    cx, cy = (mins.x + maxs.x) / 2, (mins.y + maxs.y) / 2
    for o in roots:
        o.location += Vector((-cx, -cy, -mins.z))
    # Holder starts at the origin (where the normalised piece sits),
    # takes the roots as local-keeping children, and only THEN moves
    # to the placement — moving the holder moves the piece rigidly.
    holder = mk_empty(name, 0, 0, 0)
    for o in roots:
        reparent(o, holder)
    holder.location = (x, y, z)
    holder.rotation_euler = (0, 0, rotz)
    holder.scale = (scale, scale, scale) if not isinstance(scale, tuple) else scale
    if parent:
        reparent(holder, parent)
    if rolecol:
        recolour(new, rolecol)
    return holder, new

def place_mega(name, x, y, z=0.0, rotz=0.0, scale=1.0, parent=None, rolecol=None):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MEGA, name + ".gltf"))
    return _finish_import(before, x, y, z, rotz, scale, parent, rolecol, "piece_" + name)

def place_village(name, x, y, z=0.0, rotz=0.0, scale=1.0, parent=None, rolecol=None):
    path = os.path.join(VILLAGE, "Buildings", "Blends", name + ".blend")
    if not os.path.exists(path):
        path = os.path.join(VILLAGE, "Props", "Blends", name + ".blend")
    before = set(bpy.data.objects)
    with bpy.data.libraries.load(path) as (src, dst):
        dst.objects = [o for o in src.objects if o]
    for o in dst.objects:
        if o:
            bpy.context.collection.objects.link(o)
    return _finish_import(before, x, y, z, rotz, scale, parent, rolecol, "village_" + name)

# ------------------------------------------------------------- primitives
def _prim(obj, name, x, y, z, mat, parent, rotz=0.0):
    obj.name = name
    obj.location = (x, y, z)
    obj.rotation_euler = (0, 0, rotz)
    if mat:
        obj.data.materials.append(mat)
    if parent:
        reparent(obj, parent)
    return obj

def boxc(name, sx, sy, sz, x, y, zbase, mat, parent=None, rotz=0.0):
    """Box whose z is its BASE (sits on zbase)."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    return _prim(o, name, x, y, zbase + sz / 2, mat, parent, rotz)

def cyl(name, r, h, x, y, zbase, mat, parent=None, verts=12, rotz=0.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts)
    return _prim(bpy.context.object, name, x, y, zbase + h / 2, mat, parent, rotz)

def sph(name, r, x, y, z, mat, parent=None, scale=(1, 1, 1), seg=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=rings)
    o = bpy.context.object
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return _prim(o, name, x, y, z, mat, parent)

def cone(name, r, h, x, y, zbase, mat, parent=None, verts=10):
    bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=0, depth=h, vertices=verts)
    return _prim(bpy.context.object, name, x, y, zbase + h / 2, mat, parent)

# ------------------------------------------------------------ composition
def wall_run(build, face, modules, z, rolecol, group, family="Plaster"):
    """Place one run of wall pieces for `face` of the building whose
    footprint is build['W'] x build['D']. modules: list of per-module
    kinds: 'straight' | 'window' | 'door' | 'open'."""
    W, D = build["W"], build["D"]
    placed = []
    n = len(modules)
    for idx, kind in enumerate(modules):
        if kind == "open":
            continue
        # module centre along the face, from the face's left (viewed
        # from outside) — positions are symmetric, only the door's
        # module matters and it is centred by the recipes.
        t = -((n - 1) * 2) / 2 + idx * 2  # centre offset along the run
        if face == "south":
            x, y, rotz = t, -D / 2, 0.0
        elif face == "north":
            x, y, rotz = -t, D / 2, 0.0
        elif face == "east":
            x, y, rotz = W / 2, -t, math.pi / 2
        else:  # west
            x, y, rotz = -W / 2, t, math.pi / 2
        if kind == "door":
            pname = f"Wall_{family}_Door_Round"
        elif kind == "window":
            pname = f"Wall_{family}_Window_Wide_Round"
        else:
            pname = f"Wall_{family}_Straight"
        h, objs = place_mega(pname, x, y, z, rotz=rotz, parent=group, rolecol=rolecol)
        placed += objs
        if kind == "door":
            dh, dobjs = place_mega("Door_1_Round", x, y, z, rotz=rotz, parent=group, rolecol=rolecol)
            placed += dobjs
    return placed

def floor_tiles(build, z, piece, rolecol, group):
    W, D = build["W"], build["D"]
    placed = []
    for ix in range(int(W // 2)):
        for iy in range(int(D // 2)):
            x = -W / 2 + 1 + ix * 2
            y = -D / 2 + 1 + iy * 2
            h, objs = place_mega(piece, x, y, z, parent=group, rolecol=rolecol)
            placed += objs
    return placed

def anchors_and_cuts(build, slug, door_xy, door_face, stations):
    root = build["root"]
    cuts = {}
    for nm in ("cut_roof", "cut_wall_front", "cut_wall_side"):
        cuts[nm] = mk_empty(nm, 0, 0, 0, parent=root)
    build["cuts"] = cuts
    if door_xy:
        # anchor_door sits at the door's actual threshold centre (the
        # module the recipe placed), anchor_sign centred on the same
        # face 0.4 above the door head = 2.6 (footprint derivation).
        mk_empty("anchor_door", door_xy[0], door_xy[1], 0, parent=root)
        mk_empty("anchor_sign", door_xy[0], door_xy[1], 2.6, parent=root)
    mk_empty("anchor_cam_interior", 0, 0, 3.2, parent=root)
    for sname, (sx, sy) in stations.items():
        mk_empty("station_" + sname, sx, sy, 0, parent=root)

def sign_board(build, slug, door_face, y_off=0.0, along=0.0):
    """Physical hanging sign with the rendered text texture (§5.2).
    `along` shifts the BOARD along its face (the exported anchor_sign
    node never moves — it stays at the spec position; only the
    decorative board hangs off-centre, for faces whose centre must
    stay clear, e.g. the Ledger Press's open bay)."""
    path = os.path.join(SIGNS, f"sign_{slug}.png")
    if not os.path.exists(path) or not door_face:
        return
    W, D = build["W"], build["D"]
    facepos = {"south": (0, -D / 2 - 0.35, 0), "north": (0, D / 2 + 0.35, math.pi),
               "east": (W / 2 + 0.35, 0, math.pi / 2), "west": (-W / 2 - 0.35, 0, -math.pi / 2)}[door_face]
    sx, sy = (along, 0) if door_face in ("south", "north") else (0, along)
    g = mk_empty("sign", facepos[0] + sx, facepos[1] + sy, 0, parent=build["root"])
    g.rotation_euler = (0, 0, facepos[2])
    board = boxc("sign_board", 2.0, 0.1, 1.0, 0, 0, 2.15, flat("signwood", PAL["signWood"]), parent=g)
    # texture plane on the board's outward face (-Y local after rotz)
    bpy.ops.mesh.primitive_plane_add(size=1)
    p = bpy.context.object
    p.name = "sign_face"
    p.scale = (1.9, 0.95, 1)
    bpy.ops.object.transform_apply(scale=True)
    p.rotation_euler = (math.pi / 2, 0, 0)
    p.location = (0, -0.06, 2.65)
    p.data.materials.append(texmat("sign_" + slug, path))
    reparent(p, g)
    cyl("sign_post_l", 0.045, 0.5, -0.8, 0, 3.1, flat("timber", PAL["timber"]), parent=g, verts=6)
    cyl("sign_post_r", 0.045, 0.5, 0.8, 0, 3.1, flat("timber", PAL["timber"]), parent=g, verts=6)

def door_xy_for(face, modules, W, D):
    """World position of the 'door' module's centre (wall_run's math)."""
    n = len(modules)
    for idx, kind in enumerate(modules):
        if kind != "door":
            continue
        t = -((n - 1) * 2) / 2 + idx * 2
        if face == "south": return (t, -D / 2)
        if face == "north": return (-t, D / 2)
        if face == "east": return (W / 2, -t)
        return (-W / 2, t)
    return None

# ------------------------------------------------------------- CUSTOM: pug
def build_statue(parent):
    """Benny the Pug (CUSTOM, <= 400 tris): primitives + sphere work on
    a plinth. Fawn body, dark mask + ears (the pug read), curled tail."""
    g = mk_empty("benny_statue", 0, 0, 0, parent=parent)
    fawn = flat("fawn", PAL["fawn"]); dark = flat("timber", PAL["timber"])
    stone = flat("stone", PAL["cobbleShade"]); pale = flat("trim", PAL["trimPale"])
    boxc("plinth_base", 2.2, 2.2, 0.35, 0, 0, 0, stone, parent=g)
    boxc("plinth", 1.7, 1.7, 0.85, 0, 0, 0.35, pale, parent=g)
    body_z = 1.2
    # Segment counts are set to land the whole statue (plinth
    # included) under the recipe's 400-tri cap — the first build at
    # seg=12/rings=8 came in at 720 and was cut down to these.
    sph("pug_body", 0.52, 0, 0, body_z + 0.42, fawn, parent=g, scale=(1.0, 1.15, 0.88), seg=8, rings=5)
    sph("pug_head", 0.40, 0, -0.52, body_z + 0.78, fawn, parent=g, seg=8, rings=5)
    sph("pug_snout", 0.20, 0, -0.82, body_z + 0.66, dark, parent=g, scale=(1.1, 0.8, 0.75), seg=6, rings=4)
    cone("pug_ear_l", 0.13, 0.26, -0.26, -0.48, body_z + 1.02, dark, parent=g, verts=6)
    cone("pug_ear_r", 0.13, 0.26, 0.26, -0.48, body_z + 1.02, dark, parent=g, verts=6)
    for sx in (-0.30, 0.30):
        for sy in (-0.30, 0.32):
            cyl("pug_leg", 0.10, 0.42, sx, sy, body_z, fawn, parent=g, verts=6)
    # curled tail: a small torus arc over the back
    bpy.ops.mesh.primitive_torus_add(major_radius=0.20, minor_radius=0.07,
                                     major_segments=7, minor_segments=5)
    tail = bpy.context.object
    tail.name = "pug_tail"
    tail.location = (0, 0.55, body_z + 0.72)
    tail.rotation_euler = (0.5, 0, 0)
    tail.data.materials.append(fawn)
    reparent(tail, g)
    objs = [o for o in g.children_recursive]
    return g, tri_count(objs)

# ------------------------------------------------------------ CUSTOM: press
def build_press(parent):
    """The Ledger printing press (CUSTOM, <= 600 tris): frame, platen,
    screw, lever — tall screw + horizontal platen is the read
    (visual-plan/02 §5.1 B8). The platen + screw sit under the
    press_platen pivot sub-node: the one moving part."""
    g = mk_empty("printing_press", 0, 0, 0, parent=parent)
    timber = flat("timber", PAL["timber"]); iron = flat("iron", PAL["iron"])
    paperm = flat("paper", PAL["paper"])
    boxc("press_base", 1.9, 1.1, 0.25, 0, 0, 0, timber, parent=g)
    boxc("press_post_l", 0.22, 0.9, 2.0, -0.78, 0, 0.25, timber, parent=g)
    boxc("press_post_r", 0.22, 0.9, 2.0, 0.78, 0, 0.25, timber, parent=g)
    boxc("press_beam", 1.9, 0.95, 0.28, 0, 0, 2.25, timber, parent=g)
    boxc("press_bed", 1.5, 0.95, 0.14, 0, 0, 0.95, iron, parent=g)
    boxc("press_paper", 1.1, 0.7, 0.03, 0, 0, 1.09, paperm, parent=g)
    pivot = mk_empty("press_platen", 0, 0, 2.25, parent=g)
    cyl("press_screw", 0.13, 1.05, 0, 0, 1.2, iron, parent=pivot, verts=10)
    # screw thread rings (the silhouette's ribbing)
    for k in range(3):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.16, minor_radius=0.035,
                                         major_segments=10, minor_segments=5)
        ring = bpy.context.object
        ring.name = "press_screw_ring"
        ring.location = (0, 0, 1.45 + k * 0.3)
        ring.data.materials.append(iron)
        reparent(ring, pivot)
    boxc("press_platen_plate", 1.3, 0.85, 0.12, 0, 0, 1.14, iron, parent=pivot)
    # lever: long bar angled off the right post, knob at the end
    lever = boxc("press_lever", 0.09, 1.7, 0.09, 0, 0, 0, iron, parent=g)
    lever.location = (1.05, -0.55, 1.75)
    lever.rotation_euler = (0.9, 0, -0.5)
    sph("press_lever_knob", 0.11, 1.32, -1.22, 2.28, timber, parent=g, seg=8, rings=6)
    objs = [o for o in g.children_recursive]
    return g, tri_count(objs)

# ---------------------------------------------------------------- recipes
def rolecol(wall, roof, stone=None, trim=None, timber=None, cloth=None, leaf=None):
    return {"wall": wall, "roof": roof, "stone": stone if stone is not None else wall,
            "trim": trim if trim is not None else wall, "timber": timber if timber is not None else PAL["timber"],
            "iron": PAL["iron"], "glass": PAL["glass"],
            "cloth": cloth if cloth is not None else wall,
            "leaf": leaf if leaf is not None else PAL["grass"]}

def new_build(code):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    spec = SPEC[code]
    root = mk_empty("building_root", 0, 0, 0)
    root.name = code
    fp = spec.get("footprint") or {"widthUnits": 8, "depthUnits": 8}
    return {"code": code, "spec": spec, "root": root, "slug": "bld_" + code.lower(),
            "W": fp["widthUnits"], "D": fp["depthUnits"], "pieces": [], "notes": []}

def finish_build(b, slug, door_face, stations, render_dir):
    root = b["root"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in root.children_recursive:
        o.select_set(True)
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    out = os.path.join(OUTDIR, slug + ".glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB",
                              use_selection=True, export_yup=True)
    size = os.path.getsize(out)
    tris = tri_count([o for o in root.children_recursive])
    summary = {"slug": slug, "code": b["code"], "glb": f"../factory/outputs-buildings/{slug}.glb",
               "bytes": size, "tris": tris, "pieces": b["pieces"], "notes": b["notes"]}
    print("BUILDING_SUMMARY " + json.dumps(summary))
    if render_dir:
        render_building(root, os.path.join(render_dir, slug + ".png"))
    return summary

def render_building(root, path):
    import math as _m
    cam_data = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    target = Vector((0, 0, 2.2))
    cam.location = target + Vector((0, -_m.cos(_m.radians(35)), _m.sin(_m.radians(35)))) * 34
    cam.rotation_euler = (_m.radians(55), 0, 0)
    bpy.context.scene.camera = cam
    sun_data = bpy.data.lights.new("sun", "SUN"); sun_data.energy = 3
    sun = bpy.data.objects.new("sun", sun_data); bpy.context.collection.objects.link(sun)
    sun.rotation_euler = (_m.radians(40), _m.radians(-30), 0)
    ground = bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, -0.02))
    bpy.context.object.data.materials.append(flat("grass", PAL["grass"]))
    # Cycles CPU: Workbench washes the pastel flat materials to grey
    # against its background (the factory hit the same wall in v2 and
    # inspected Cycles renders instead).
    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.samples = 24
    bpy.context.scene.cycles.device = "CPU"
    world = bpy.data.worlds.new("w"); bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.72, 0.78, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
    bpy.context.scene.render.resolution_x = 900; bpy.context.scene.render.resolution_y = 700
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

def roof_for(b, piece, rc, z, zscale=1.0, rotz=math.pi / 2):
    h, objs = place_mega(piece, 0, 0, z, rotz=rotz, scale=(1.0, 1.0, zscale),
                         parent=b["cuts"]["cut_roof"], rolecol=rc)
    b["pieces"].append(piece)
    b["last_roof_objs"] = objs
    return h

def _prism(b, hw, h, t, x, y, z, rotz, mat):
    verts = [(-hw, -t / 2, 0), (hw, -t / 2, 0), (0, -t / 2, h),
             (-hw, t / 2, 0), (hw, t / 2, 0), (0, t / 2, h)]
    faces = [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    mesh = bpy.data.meshes.new("gable")
    mesh.from_pydata(verts, [], faces); mesh.update()
    o = bpy.data.objects.new("gable_infill", mesh)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    o.location = (x, y, z); o.rotation_euler = (0, 0, rotz)
    reparent(o, b["root"])
    return o

def gable_infills(b, wall_top, ridge_axis, wall_hex):
    """Close the open gable triangles the MegaKit roof shells leave.
    The kit's wall system has no gable piece at these spans, so the
    infill is CUSTOM composition geometry: a flat triangular prism
    just inside each gable plane, sized from the placed roof's own
    world bbox (base at the wall top, apex a hair under the ridge)."""
    mins, maxs = bbox_of(b["last_roof_objs"])
    mat = flat("gablewall", wall_hex)
    t = 0.18
    if ridge_axis == "y":  # ridge runs north-south: gables on the ±Y faces
        hw = min(b["W"] / 2, (maxs.x - mins.x) / 2) - 0.12
        h = (maxs.z - 0.3) - wall_top
        for sgn in (-1, 1):
            _prism(b, hw, h, t, 0, sgn * (b["D"] / 2 - t / 2 - 0.04), wall_top, 0, mat)
    else:                  # ridge runs east-west: gables on the ±X faces
        hw = min(b["D"] / 2, (maxs.y - mins.y) / 2) - 0.12
        h = (maxs.z - 0.3) - wall_top
        for sgn in (-1, 1):
            _prism(b, hw, h, t, sgn * (b["W"] / 2 - t / 2 - 0.04), 0, wall_top, math.pi / 2, mat)
    b["pieces"].append("gable infills x2 (custom prism)")

def plan_walls(b, door_face, open_faces=(), window_all=False):
    W, D = b["W"], b["D"]
    plan = {}
    for face, n in (("south", int(W // 2)), ("north", int(W // 2)),
                    ("east", int(D // 2)), ("west", int(D // 2))):
        if face in open_faces:
            continue
        mods = ["window" if (window_all or k % 2) else "straight" for k in range(n)]
        if face == door_face:
            mods[n // 2] = "door"
        plan[face] = mods
    dxy = door_xy_for(door_face, plan.get(door_face, []), W, D) if door_face else None
    return plan, dxy

def exec_walls(b, plan, rc, family="Plaster", z=0.0, upper_family=None):
    cuts = b["cuts"]
    door_face = b["door_face"]
    for face, mods in plan.items():
        group = cuts["cut_wall_front"] if face == door_face else (
            cuts["cut_wall_side"] if face in ("east", "west") else b["root"])
        fam = upper_family if (upper_family and z > 0) else family
        wall_run(b, face, mods, z, rc, group, family=fam)
        b["pieces"].append(f"walls:{face}:" + ",".join(mods))

def base_building(code, door_face, rc, family="Plaster", roof_piece="Roof_RoundTiles_6x6",
                  roof_zscale=0.8, roof_rotz=0.0, upper_family=None, open_faces=(), stations=None,
                  floor_piece="Floor_WoodDark"):
    b = new_build(code)
    b["door_face"] = door_face
    plan, dxy = plan_walls(b, door_face, open_faces)
    anchors_and_cuts(b, b["slug"], dxy, door_face, stations or {})
    exec_walls(b, plan, rc, family=family)
    if upper_family:
        b["zbase"] = 3.12
        plan2, _ = plan_walls(b, door_face, open_faces)
        # upper floor: no door module — a balcony door would claim an
        # entrance the record does not have; windows + straights only.
        plan2 = {f: ["window" if m == "door" else m for m in mods] for f, mods in plan2.items()}
        exec_walls(b, plan2, rc, family=family, z=3.12, upper_family=upper_family)
        floor_tiles(b, 3.12, floor_piece, rc, b["root"])
    floor_tiles(b, 0.02, floor_piece, rc, b["root"])
    walltop = 6.24 if upper_family else 3.12
    if roof_piece:
        roof_for(b, roof_piece, rc, walltop, zscale=roof_zscale, rotz=roof_rotz)
        gable_infills(b, walltop, "y" if roof_rotz == 0 else "x", rc["wall"])
    sign_board(b, b["slug"], door_face)
    return b

# ------------------------------------------------------------ the recipes
def b_townhall(render_dir):
    rc = rolecol(PAL["trimPale"], PAL["townhallRoof"], stone=PAL["cobbleShade"], trim=PAL["trimPale"])
    b = base_building("EMBER_TOWNHALL", "south", rc, roof_zscale=0.8,
                      stations={"notice_board": (2.0, -3.4)})
    # Village bell tower on the frontage face line, offset to one end.
    # The spec's 2x2 module footprint for the tower is a derived guess
    # and its height is unstated; the recipe names the Village tower's
    # silhouette, so the tower is scaled for the silhouette (1.55x ->
    # ~3.0 x 3.5 footprint, 7.4 high) and the deviation is recorded in
    # the kit card, not hidden.
    h, objs = place_village("Bell_Tower", -2.6, -2.2, 0, scale=1.55, parent=b["root"], rolecol=rc)
    b["pieces"].append("village:Bell_Tower@1.55")
    b["notes"].append("tower scaled 1.55 for silhouette; spec tower footprint was a derived 2x2 guess, height unstated")
    # clock face on the tower's south face, hands fixed at 9:00
    bpy.ops.mesh.primitive_cylinder_add(radius=0.62, depth=0.08, vertices=24)
    clk = bpy.context.object; clk.name = "clock_face"
    clk.rotation_euler = (math.pi / 2, 0, 0)
    clk.location = (-2.6, -3.95, 5.6)
    clk.data.materials.append(texmat("clock", os.path.join(SIGNS, "clock_face.png")))
    reparent(clk, b["root"])
    # civic-gold banner + notice board by the door
    boxc("banner", 0.7, 0.08, 1.6, 1.9, -3.25, 1.5, flat("gold", PAL["gold"]), parent=b["root"])
    # on the pier between the door and the east window — a first build
    # put it over the window arch, where it read as a blank slab
    boxc("notice_board", 0.9, 0.08, 1.0, 2.0, -3.25, 1.1, flat("timber", PAL["timber"]), parent=b["root"])
    return finish_build(b, b["slug"], "south", {}, render_dir)

def b_market(render_dir):
    rc = rolecol(PAL["timber"], PAL["awningCream"], stone=PAL["cobbleShade"])
    b = new_build("MARKET_HALL"); b["door_face"] = "south"; b["slug"] = "bld_market_hall"
    plan, dxy = plan_walls(b, "south", open_faces=("south",))
    anchors_and_cuts(b, b["slug"], (0, -3), "south", {"counter": (0, -2.2)})
    exec_walls(b, plan, rc, family="Plaster")
    floor_tiles(b, 0.02, "Floor_Brick", rc, b["root"])
    roof_for(b, "Roof_RoundTiles_6x6", rc, 3.12, zscale=0.7, rotz=0.0)
    gable_infills(b, 3.12, "y", rc["wall"])
    # open stall frontage: two posts + striped awning over the apron
    # (post height set so the awning plane rests on the post tops —
    # see the awning note below)
    for sx in (-3.6, 3.6):
        boxc("stall_post", 0.24, 0.24, 2.05, sx, -3.9, 0, flat("timber", PAL["timber"]), parent=b["root"])
    # Awning placement, fourth pass (check renders in the lane note):
    # pass 1 (8.4 x 2.6 plane at -58 deg, centre z 2.95) read as a
    # fallen billboard and hid the sign; pass 2 (centre z 1.85)
    # slumped below the counter; pass 3 (plane at centre z 2.4) put
    # the edges right but a single-sided plane vanishes edge-on and
    # reads as a ribbon. This pass keeps pass 3's placement and gives
    # the awning a thin box body so it reads from every angle: high
    # edge at the wall (behind the hanging sign, which stays readable
    # in front of it), low edge out over the apron on the 2.05 posts.
    awn = boxc("awning", 7.8, 1.9, 0.06, 0, -3.65, 2.37,
               texmat("awning", os.path.join(SIGNS, "awning_stripes.png")), parent=b["root"])
    awn.rotation_euler = (math.radians(-50), 0, 0)
    # counter + crates/barrels/bins on the apron (Kenney/MegaKit stock)
    boxc("counter", 6.4, 0.7, 1.0, 0, -3.3, 0, flat("timber", PAL["timber"]), parent=b["root"])
    for px, pz in ((-2.4, 0), (2.2, 0), (0.4, 0)):
        h, objs = place_mega("Prop_Crate", px, -4.3, 0, parent=b["root"], rolecol=rc)
    h, objs = place_village("Barrel", -3.1, -4.3, 0, parent=b["root"], rolecol=rc)
    h, objs = place_village("Barrel", 3.0, -4.35, 0, parent=b["root"], rolecol=rc)
    b["pieces"] += ["stall posts+awning (procedural texture)", "Prop_Crate x3", "village:Barrel x2"]
    sign_board(b, b["slug"], "south")
    return finish_build(b, b["slug"], "south", {}, render_dir)

def b_college(render_dir):
    rc = rolecol(PAL["trimPale"], PAL["collegeRoof"], stone=PAL["cobbleShade"])
    b = base_building("EMBER_COLLEGE", "south", rc, family="UnevenBrick",
                      upper_family="Plaster", roof_zscale=0.75,
                      stations={"lectern": (0, -1.2)})
    # book stacks at the door + A-board (two slanted boards)
    for px in (-1.8, 1.9):
        boxc("book_stack", 0.55, 0.4, 0.8, px, -3.6, 0, flat("gold", PAL["gold"]), parent=b["root"])
    ab = boxc("a_board", 0.9, 0.06, 1.1, 2.9, -3.7, 0, flat("signwood", PAL["signWood"]), parent=b["root"])
    ab.rotation_euler = (0.35, 0, 0)
    b["pieces"] += ["book stacks x2", "A-board"]
    return finish_build(b, b["slug"], "south", {}, render_dir)

def b_library(render_dir):
    rc = rolecol(PAL["trimPale"], PAL["timber"], stone=PAL["cobbleShade"])
    b = base_building("LIBRARY_ANNEX", "east", rc, roof_piece="Roof_RoundTiles_4x6",
                      roof_zscale=0.85, roof_rotz=math.pi / 2, stations={"shelves_1": (-1.6, -1), "shelves_2": (-1.6, 0.8), "shelves_3": (0, 1.4)})
    # shelf rows inside (the fewest props of any building, by design)
    for sx, sy in ((-1.6, -1), (-1.6, 0.8)):
        boxc("shelf_row", 0.5, 1.8, 1.9, sx, sy, 0, flat("timber", PAL["timber"]), parent=b["root"])
    b["pieces"] += ["shelf rows x2"]
    return finish_build(b, b["slug"], "east", {}, render_dir)

def b_workshop(render_dir):
    rc = rolecol(PAL["timber"], PAL["collegeRoof"], stone=PAL["cobbleShade"])
    b = new_build("PUBLIC_WORKSHOP"); b["door_face"] = "west"; b["slug"] = "bld_public_workshop"
    anchors_and_cuts(b, b["slug"], (-3, 0), "west", {"workbench": (-1.2, 0)})
    # Village blacksmith whole, front opened by the pack's own open
    # front; rotated so its front faces the west (door) face. Scaled
    # 1.2 -> ~4.7 x 3.9, inside the 6 x 4 footprint.
    h, objs = place_village("Blacksmith", 0, 0, 0, rotz=-math.pi / 2, scale=1.2, parent=b["root"], rolecol=rc)
    b["pieces"].append("village:Blacksmith@1.2")
    boxc("workbench", 1.9, 0.8, 0.95, -1.2, 0, 0, flat("timber", PAL["timber"]), parent=b["root"])
    # gear blanks on the wall: flat discs
    for gy in (-0.9, 0.9):
        cyl("gear_blank", 0.34, 0.08, -2.85, gy, 1.6, flat("iron", PAL["iron"]), parent=b["root"], verts=12)
    b["pieces"] += ["workbench", "gear blanks x2"]
    sign_board(b, b["slug"], "west")
    return finish_build(b, b["slug"], "west", {}, render_dir)

def b_meridian(render_dir):
    rc = rolecol(PAL["cobbleLit"], PAL["collegeRoof"], stone=PAL["cobbleShade"])
    stations = {"dinner_host": (-2.8, 0)}
    for k in range(6):
        stations[f"dinner_seat_{k+1}"] = (-1.8 + (k % 3) * 1.8, -0.95 if k < 3 else 0.95)
    b = base_building("EMBER_DISTRICT_3_PLOT_18", "west", rc, roof_zscale=0.75, stations=stations)
    boxc("dinner_table", 4.6, 1.3, 0.78, 0, 0, 0, flat("timber", PAL["timber"]), parent=b["root"])
    for sx in (-1.8, 0, 1.8):
        for sy in (-0.95, 0.95):
            h, objs = place_village("Bench_1", sx, sy, 0, parent=b["root"], rolecol=rc)
    b["pieces"] += ["dinner table", "village:Bench_1 x6"]
    return finish_build(b, b["slug"], "west", {}, render_dir)

def b_press(render_dir):
    rc = rolecol(PAL["signWood"], PAL["timber"], stone=PAL["cobbleShade"])
    b = new_build("EMBER_DISTRICT_1_PLOT_31"); b["door_face"] = "east"; b["slug"] = "bld_ember_district_1_plot_31"
    plan, dxy = plan_walls(b, "east", open_faces=("east",))
    anchors_and_cuts(b, b["slug"], (3, 0), "east", {"press": (2.1, 0)})
    exec_walls(b, plan, rc, family="Plaster")
    floor_tiles(b, 0.02, "Floor_WoodDark", rc, b["root"])
    roof_for(b, "Roof_RoundTiles_4x6", rc, 3.12, zscale=0.85, rotz=math.pi / 2)
    gable_infills(b, 3.12, "x", rc["wall"])
    # open east bay: corner posts carry the roof edge
    for sy in (-1.9, 1.9):
        boxc("bay_post", 0.24, 0.24, 3.1, 2.95, sy, 0, flat("timber", PAL["timber"]), parent=b["root"])
    # THE PRESS (CUSTOM) in the bay, proud of the face line, facing east.
    # Placement tuned by the masked drill (drills/press-drill.md): the
    # first build sat at x=1.7, deep in the bay's shadow behind the
    # centred sign board, and did not read as a press at town
    # altitude; it now stands at x=2.1 at 1.15x, front near the face
    # line, and the board hangs off-centre (below).
    g, tris = build_press(b["root"])
    g.location = (2.1, 0, 0)
    g.rotation_euler = (0, 0, math.pi / 2)
    g.scale = (1.15, 1.15, 1.15)
    b["pieces"].append(f"custom:printing_press ({tris} tris)")
    if tris > 600:
        b["notes"].append(f"PRESS OVER TRI CAP: {tris} > 600")
    # newspaper stand at the door
    stand = boxc("news_stand", 0.9, 0.5, 1.05, 3.6, 1.3, 0, flat("timber", PAL["timber"]), parent=b["root"])
    boxc("news_papers", 0.8, 0.4, 0.06, 3.6, 1.3, 1.05, flat("paper", PAL["paper"]), parent=b["root"])
    b["pieces"] += ["newspaper stand"]
    # board hangs toward the south end of the bay so the press reads
    # through the bay's centre (drill fix; anchor_sign stays centred)
    sign_board(b, b["slug"], "east", along=-1.35)
    return finish_build(b, b["slug"], "east", {}, render_dir)

def b_cottage(code, village_house, roof_hex, door_hex, render_dir):
    rc = rolecol(PAL["trimPale"], roof_hex, stone=PAL["cobbleShade"])
    b = new_build(code); b["slug"] = "bld_" + code.lower()
    spec = b["spec"]
    door_face = spec["door"]["face"]
    b["door_face"] = door_face
    dxy = {"south": (0, -2), "west": (-2, 0)}[door_face]
    anchors_and_cuts(b, b["slug"], dxy, door_face, {})
    h, objs = place_village(village_house, 0, 0, 0, scale=1.4, parent=b["root"], rolecol=rc)
    b["pieces"].append(f"village:{village_house}@1.4")
    b["notes"].append("whole Village house scaled 1.4 to the 4x4 footprint; its own door is on the model — rotation set so the model front faces the spec door face")
    if door_face == "west":
        h.rotation_euler = (0, 0, -math.pi / 2)
    sign_board(b, b["slug"], door_face)
    return finish_build(b, b["slug"], door_face, {}, render_dir)

def b_plaza(render_dir):
    rc = rolecol(PAL["cobbleLit"], PAL["timber"], stone=PAL["cobbleShade"])
    b = new_build("EMBER_PLAZA_OF_UNITY"); b["slug"] = "bld_ember_plaza_of_unity"; b["door_face"] = None
    root = b["root"]
    mk_empty("anchor_cam_interior", 0, 0, 3.2, parent=root)
    # paving: Floor_Brick tiles over the full 10x10 cell, cobble tones
    bb = {"W": 10, "D": 10}
    floor_tiles(bb | {"root": root}, 0.02, "Floor_Brick", rc, root)
    g, tris = build_statue(root)
    # 1.35x: at 1x the statue topped out ~2.4 high and read as a lump
    # at town altitude (check render); 1.35x puts the centrepiece at
    # ~3.2 high — the silhouette the scene's plaza label anchor was
    # tuned to — with the plinth ~3 wide on the 10x10 paving.
    g.scale = (1.35, 1.35, 1.35)
    b["pieces"].append(f"custom:benny_statue ({tris} tris) @1.35")
    if tris > 400:
        b["notes"].append(f"STATUE OVER TRI CAP: {tris} > 400")
    # a simple well (CUSTOM-minor, primitives): the recipe names a
    # Village Pack well; the pack as downloaded contains none, so the
    # well is primitives and recorded as such in the kit card.
    wg = mk_empty("well", -3.4, 2.8, 0, parent=root)
    cyl("well_ring", 0.75, 0.8, 0, 0, 0, flat("stone", PAL["cobbleShade"]), parent=wg, verts=14)
    for sx in (-0.8, 0.8):
        boxc("well_post", 0.12, 0.12, 1.5, sx, 0, 0.8, flat("timber", PAL["timber"]), parent=wg)
    roofp = boxc("well_roof", 2.0, 1.1, 0.1, 0, 0, 2.05, flat("roof", PAL["blossom"]), parent=wg)
    roofp.rotation_euler = (0.18, 0, 0)  # a pitched cap, not a floating tabletop
    b["pieces"].append("custom:well (primitives — no well exists in the Village Pack as downloaded)")
    h, objs = place_village("Cart", 3.6, 2.6, 0, rotz=0.5, scale=1.5, parent=root, rolecol=rc)
    b["pieces"].append("village:Cart")
    for fx in (-4, -2, 2, 4):
        h, objs = place_mega("Prop_WoodenFence_Single", fx, -4.9, 0, parent=root, rolecol=rc)
    b["pieces"].append("Prop_WoodenFence_Single x4 (south edge)")
    return finish_build(b, b["slug"], None, {}, render_dir)

def b_plot30(render_dir):
    rc = rolecol(PAL["grass"], PAL["timber"], stone=PAL["cobbleShade"])
    b = new_build("EMBER_DISTRICT_1_PLOT_30"); b["slug"] = "bld_ember_district_1_plot_30"; b["door_face"] = None
    root = b["root"]
    # parcel ground: one flat plane in the paving-shade anchor (a kept
    # plot, not a building site — no paving, no foundation slab)
    bpy.ops.mesh.primitive_plane_add(size=8)
    p = bpy.context.object; p.name = "parcel_ground"
    p.location = (0, 0, 0.02)
    p.data.materials.append(flat("parcel", PAL["cobbleShade"]))
    reparent(p, root)
    # fence perimeter; the gate gap is in the NORTH run's centre
    # (gateFace: north = +Y in this frame), where the plot sign stands.
    for fx in (-3, -1, 1, 3):
        place_mega("Prop_WoodenFence_Single", fx, -3.95, 0, parent=root, rolecol=rc)  # south run (full)
    for fx in (-3.5, -1.5, 1.5, 3.5):
        place_mega("Prop_WoodenFence_Single", fx, 3.95, 0, parent=root, rolecol=rc)   # north run, centre gap
    for fy in (-3, -1, 1, 3):
        place_mega("Prop_WoodenFence_Single", -3.95, fy, 0, rotz=math.pi / 2, parent=root, rolecol=rc)
        place_mega("Prop_WoodenFence_Single", 3.95, fy, 0, rotz=math.pi / 2, parent=root, rolecol=rc)
    b["pieces"].append("Prop_WoodenFence_Single perimeter, gate gap at the north centre")
    # the plain-word plot sign at the gate, facing north (outward)
    mk_empty("anchor_sign", 0, 4.1, 2.6, parent=root)
    g = mk_empty("plot_sign", 0, 4.1, 0, parent=root)
    g.rotation_euler = (0, 0, math.pi)
    boxc("sign_post", 0.14, 0.14, 1.7, 0, 0, 0, flat("timber", PAL["timber"]), parent=g)
    board = boxc("sign_board", 2.2, 0.09, 1.1, 0, 0, 1.55, flat("signwood", PAL["signWood"]), parent=g)
    bpy.ops.mesh.primitive_plane_add(size=1)
    p2 = bpy.context.object; p2.name = "sign_face"
    p2.scale = (2.1, 1.0, 1); bpy.ops.object.transform_apply(scale=True)
    p2.rotation_euler = (math.pi / 2, 0, 0)
    p2.location = (0, -0.06, 2.1)
    p2.data.materials.append(texmat("sign_plot30", os.path.join(SIGNS, "sign_bld_ember_district_1_plot_30.png")))
    reparent(p2, g)
    b["notes"].append("honest empty plot: fence + plain-word sign only; no building, no foundation")
    return finish_build(b, b["slug"], None, {}, render_dir)

BUILDERS = {
    "bld_ember_townhall": b_townhall,
    "bld_market_hall": b_market,
    "bld_ember_college": b_college,
    "bld_library_annex": b_library,
    "bld_public_workshop": b_workshop,
    "bld_ember_district_3_plot_18": b_meridian,
    "bld_ember_district_1_plot_31": b_press,
    "bld_ember_plaza_of_unity": b_plaza,
    "bld_ember_district_1_plot_30": b_plot30,
}

def main():
    render_dir = args.get("renders")
    if render_dir:
        os.makedirs(render_dir, exist_ok=True)
    only = args.get("only")
    summaries = []
    for slug, fn in BUILDERS.items():
        if only and slug != only:
            continue
        summaries.append(fn(render_dir))
    if not only or only == "bld_ember_home_maple_cottage":
        summaries.append(b_cottage("EMBER_HOME_MAPLE_COTTAGE", "House_1", PAL["blossom"], PAL["timber"], render_dir))
    if not only or only == "bld_ember_home_willow_cottage":
        summaries.append(b_cottage("EMBER_HOME_WILLOW_COTTAGE", "House_2", PAL["awningCream"], PAL["signWood"], render_dir))
    # merge into the manifest (a --only run updates its own entry)
    mpath = os.path.join(PORTAL, "build", "visual", "scene", "building-kits.json")
    manifest = {"schema": "portal.building-kits/v1", "item": "M4.14 building set manifest",
                "generatedBy": "build/visual/factory/scripts/build_buildings.py", "buildings": {}}
    if os.path.exists(mpath):
        manifest = json.load(open(mpath))
    cards = {}
    for s in summaries:
        code = s["code"]
        spec = SPEC[code]
        manifest["buildings"][code] = {
            "code": code, "slug": s["slug"], "label": spec["label"],
            "glb": s["glb"], "bytes": s["bytes"], "tris": s["tris"],
            "card": f"../factory/kits/{s['slug']}.json",
            "origin": "paving" if code == "EMBER_PLAZA_OF_UNITY" else (
                "parcel" if code == "EMBER_DISTRICT_1_PLOT_30" else "footprint"),
            "treatment": "open place" if code == "EMBER_PLAZA_OF_UNITY" else (
                "honest empty plot" if code == "EMBER_DISTRICT_1_PLOT_30" else "building"),
        }
        # write back the as-built record into the kit card
        card_path = os.path.join(FACTORY, "kits", s["slug"] + ".json")
        card = json.load(open(card_path))
        card["pieces"] = s["pieces"]
        card["asBuilt"] = {"glb": s["glb"], "bytes": s["bytes"], "tris": s["tris"], "notes": s["notes"]}
        json.dump(card, open(card_path, "w"), indent=1)
    # the bundle seq this place set was verified against (the live
    # bundle at build time; the scene test pins manifest ⊆ live)
    try:
        live = json.load(open(os.path.join(PORTAL, "build", "data", "feed", "world-data.json")))
        manifest["bundleSeq"] = live.get("bundleSeq")
    except Exception:
        pass
    json.dump(manifest, open(mpath, "w"), indent=1)
    print("BUILDINGS_DONE " + json.dumps({"count": len(summaries), "manifest": mpath}))

main()
