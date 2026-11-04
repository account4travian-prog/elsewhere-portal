# Elsewhere Portal — M4.08 (+ M4.25 rest pose): retarget the KayKit
# work vocabulary onto the citizen-kit rig and export it as ONE shared
# clip library GLB.
#
# Why a library: every citizen kit is built on the same KayKit
# Rig_Medium skeleton, renamed to the factory contract names by
# build_citizen.py's BONE_RENAME and chibi-scaled by the same global
# procedure — so one set of retargeted actions binds by bone name onto
# every kit in the scene (three.js AnimationMixer resolves clip tracks
# against the target root's node names). The library carries NO mesh:
# it is the donor citizen's armature + the retargeted actions.
#
# Method (the build_citizen.py pattern, unchanged): import the KayKit
# animation GLBs so their actions land in bpy.data.actions, keep the
# mapped ones under contract names, rename every fcurve bone path
# through BONE_RENAME, delete the donor's meshes and its own actions,
# export armature + actions.
#
# Sources (all CC0, KayKit Character Animations 1.1 — assets-src/
# ASSETS.md, archive SHA-256 recorded there):
#   Rig_Medium_Tools.glb      Hammering, Digging, Pickaxing, Sawing,
#                             Chopping, Fishing_Idle/Cast/Reeling
#   Rig_Medium_General.glb    PickUp
#   Rig_Medium_Simulation.glb Lie_Idle, Lie_Down (M4.25 rest pose)
# The action table's remaining work families ride clips the kits
# already carry (type = Working_A for make/craft; gather for harvest)
# or have NO honest clip (carry — Holding_* are static holds, not a
# carry walk; nothing is faked). Coverage is recorded in
# work-citizens/work-clips-coverage.json by the frame-check run.
#
# Usage:
#   blender -b --python scripts/retarget_work_clips.py -- \
#     --donor outputs-v2/orrin-lowmarsh.glb \
#     --out outputs-web/clips/work-clips.glb
import bpy, os, sys, json

FACTORY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKS = os.path.join(FACTORY, "..", "..", "..", "assets-src", "packs")
ANIM_DIR = os.path.join(PACKS, "kaykit-animations",
                        "KayKit_Character_Animations_1.1", "Animations", "gltf", "Rig_Medium")

argv = sys.argv[sys.argv.index("--") + 1:]
args = {}
i = 0
while i < len(argv):
    if argv[i].startswith("--"):
        args[argv[i][2:]] = argv[i + 1]
        i += 2
    else:
        i += 1
DONOR = os.path.join(FACTORY, args.get("donor", "outputs-v2/orrin-lowmarsh.glb"))
OUT = os.path.join(FACTORY, args.get("out", "outputs-web/clips/work-clips.glb"))

# The factory contract rename — copied verbatim from build_citizen.py
# (the map that produced every citizen kit's bone names).
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

# Contract name -> (source file, source action). Contract names are
# Portal's; the source names stay KayKit's, in the extras + coverage.
CLIPMAP = {
    "work-hammer": ("Rig_Medium_Tools.glb", "Hammering"),
    "work-dig": ("Rig_Medium_Tools.glb", "Digging"),
    "work-pickaxe": ("Rig_Medium_Tools.glb", "Pickaxing"),
    "work-saw": ("Rig_Medium_Tools.glb", "Sawing"),
    "work-chop": ("Rig_Medium_Tools.glb", "Chopping"),
    "work-fish": ("Rig_Medium_Tools.glb", "Fishing_Idle"),
    "work-fish-cast": ("Rig_Medium_Tools.glb", "Fishing_Cast"),
    "work-fish-reel": ("Rig_Medium_Tools.glb", "Fishing_Reeling"),
    "work-pickup": ("Rig_Medium_General.glb", "PickUp"),
    "rest-lie": ("Rig_Medium_Simulation.glb", "Lie_Idle"),
    "rest-lie-down": ("Rig_Medium_Simulation.glb", "Lie_Down"),
}
ANIM_FILES = sorted({f for f, _ in CLIPMAP.values()})


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


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


# ------------------------------------------------------------------ donor
bpy.ops.wm.read_factory_settings(use_empty=True)
new = import_glb(DONOR)
arm = next(o for o in new if o.type == "ARMATURE")
for o in list(new):
    if o is not arm:
        bpy.data.objects.remove(o, do_unlink=True)
donor_actions = list(bpy.data.actions)
for a in donor_actions:
    bpy.data.actions.remove(a)

# ------------------------------------------------------------------ clips
for f in ANIM_FILES:
    imported = import_glb(os.path.join(ANIM_DIR, f))
    for o in imported:
        bpy.data.objects.remove(o, do_unlink=True)

kept = {}
sources = {}
for contract, (srcfile, src) in CLIPMAP.items():
    a = bpy.data.actions.get(src)
    if a is None:
        raise RuntimeError(f"source clip {src} ({srcfile}) not found")
    a.name = contract
    a.use_fake_user = True
    kept[contract] = a
    sources[contract] = {"pack_file": srcfile, "source_action": src,
                         "pack": "KayKit Character Animations 1.1", "licence": "CC0"}
for a in list(bpy.data.actions):
    if a not in kept.values():
        bpy.data.actions.remove(a)

# Rename fcurve bone paths onto the contract rig (build_citizen does
# the same for the kits' own clips).
for a in kept.values():
    for fc in action_fcurves(a):
        for old, newname in BONE_RENAME.items():
            fc.data_path = fc.data_path.replace(
                f'pose.bones["{old}"]', f'pose.bones["{newname}"]')

# ------------------------------------------------------------------ extras
arm["clip_library"] = "portal.work-clips/v1"
arm["clip_sources"] = json.dumps(sources)
arm["donor_kit"] = os.path.basename(DONOR)
if arm.animation_data:
    arm.animation_data.action = None

# ------------------------------------------------------------------ export
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

summary = {"out": OUT, "bytes": os.path.getsize(OUT),
           "clips": sorted(kept), "donor": os.path.basename(DONOR)}
print("WORK_CLIPS_SUMMARY " + json.dumps(summary))
