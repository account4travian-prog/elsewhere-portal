# Render an existing building GLB from a chosen azimuth/elevation.
# Usage: blender -b --python render_glb.py -- <glb> <out.png> <azimuth_deg> <elev_deg> [dist_scale]
# Azimuth: 0 = from south (camera at -Y looking north), 90 = from east (+X), -90 = from west, 180 = from north.
import bpy, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
glb, out, az, el = argv[0], argv[1], float(argv[2]), float(argv[3])
dscale = float(argv[4]) if len(argv) > 4 else 1.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
objs = [o for o in bpy.data.objects if o.type == "MESH"]
mins = Vector((1e9,) * 3); maxs = Vector((-1e9,) * 3)
for o in objs:
    for c in o.bound_box:
        v = o.matrix_world @ Vector(c)
        for k in range(3):
            mins[k] = min(mins[k], v[k]); maxs[k] = max(maxs[k], v[k])
centre = (mins + maxs) / 2
size = maxs - mins
dist = max(size.x, size.y, size.z) * 1.9 * dscale
azr, elr = math.radians(az), math.radians(el)
cx = centre.x + dist * math.cos(elr) * math.sin(azr)
cy = centre.y - dist * math.cos(elr) * math.cos(azr)
cz = centre.z + dist * math.sin(elr)
cam_data = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (cx, cy, cz)
direction = Vector(centre) - cam.location
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
bpy.context.scene.camera = cam
sun_data = bpy.data.lights.new("sun", "SUN"); sun_data.energy = 3
sun = bpy.data.objects.new("sun", sun_data); bpy.context.collection.objects.link(sun)
sun.rotation_euler = (math.radians(40), math.radians(-30), 0)
bpy.ops.mesh.primitive_plane_add(size=80, location=(centre.x, centre.y, -0.02))
gm = bpy.data.materials.new("g"); gm.diffuse_color = (0.85, 0.78, 0.58, 1)
bpy.context.object.data.materials.append(gm)
bpy.context.scene.render.engine = "CYCLES"
bpy.context.scene.cycles.samples = 24
bpy.context.scene.cycles.device = "CPU"
world = bpy.data.worlds.new("w"); bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.72, 0.78, 1.0)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
bpy.context.scene.render.resolution_x = 900; bpy.context.scene.render.resolution_y = 700
bpy.context.scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print("RENDERED", out, "bbox", list(mins), list(maxs))
