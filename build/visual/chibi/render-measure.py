# Elsewhere Portal — M4.06 closure: heads-tall measured in RENDERED
# frames, not from accessors.
#
# The chibi measure gate (measure-figure.mjs) reads POSITION accessor
# min/max — geometry, not a frame. The M4.06 exit gate asks for a
# figure that "measures 2–2.5 heads tall in a rendered frame". This
# script renders a cast kit (its factory master, REST pose — the pose
# the gate's accessors describe; no animation applied) at two cameras
# and writes the renders beside this file:
#   canonical: the scene's own camera — orthographic, elevation 35°,
#     azimuth from the south (the sample-street view);
#   plate:     head-on orthographic at elevation 0 (the proportion
#     plate — no foreshortening; the frame a heads-tall count is
#     traditionally taken from).
# Two passes per camera: the whole figure, and the head mesh alone
# (the object the gate counts: the GLB node named "head"). Pixel
# spans come from the alpha channel; render-measure.mjs does the
# counting so the numbers are reproducible without Blender.
#
# Usage:
#   blender -b --python render-measure.py -- --kit <slug> [--outdir <dir>]
# Masters live in ../factory/outputs-v2/<slug>.glb.
import bpy, os, sys, json, math

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:]
args = {}
i = 0
while i < len(argv):
    if argv[i].startswith("--"):
        args[argv[i][2:]] = argv[i + 1]
        i += 2
    else:
        i += 1
SLUG = args.get("kit", "atlas-meridian")
MASTER = os.path.join(HERE, "..", "factory", "outputs-v2", f"{SLUG}.glb")
OUTDIR = args.get("outdir", os.path.join(HERE, "renders"))
os.makedirs(OUTDIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=MASTER)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
heads = [o for o in meshes if o.name == "head"]
if len(heads) != 1:
    raise RuntimeError(f"expected exactly one mesh object named 'head', got {[o.name for o in heads]}")
# Rest pose: no action anywhere (the import may set one), AND the
# armature renders its REST position — clearing actions alone leaves
# the importer's posed bones in place (measured: a ~5° head pitch in
# the imported pose inflated the rendered head span by ~0.05 units
# over the bind span the gate reads).
for o in bpy.data.objects:
    if o.animation_data:
        o.animation_data.action = None
    if o.type == "ARMATURE":
        o.data.pose_position = "REST"

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "FLAT"
scene.display.shading.color_type = "MATERIAL"
scene.render.film_transparent = True
scene.render.resolution_x = 512
scene.render.resolution_y = 768
scene.render.image_settings.file_format = "PNG"

cam_data = bpy.data.cameras.new("measure-cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 2.3
cam = bpy.data.objects.new("measure-cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

def aim(elev_deg, dist=8.0):
    e = math.radians(elev_deg)
    cam.location = (0.0, -dist * math.cos(e), 0.9 + dist * math.sin(e))
    cam.rotation_euler = (math.radians(90 - elev_deg), 0.0, 0.0)

def render(tag):
    scene.render.filepath = os.path.join(OUTDIR, f"{SLUG}--{tag}.png")
    bpy.ops.render.render(write_still=True)
    return scene.render.filepath

results = {}
for cam_name, elev in (("canonical", 35.0), ("plate", 0.0)):
    aim(elev)
    for o in meshes:
        o.hide_render = False
    full = render(f"{cam_name}-full")
    for o in meshes:
        o.hide_render = o.name != "head"
    head = render(f"{cam_name}-head")
    results[cam_name] = {"full": full, "head": head, "elevationDeg": elev}
for o in meshes:
    o.hide_render = False
print("RENDER_MEASURE " + json.dumps({"kit": SLUG, "master": MASTER, "cameras": results}))
