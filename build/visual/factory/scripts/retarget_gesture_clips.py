#!/usr/bin/env python3
"""Gesture clip library builder — Portal M5.05 (Design K4/K5).

Builds outputs-web/clips/gesture-clips.glb: the social gesture
vocabulary (talk x2, listen/nod, point, present) on the citizen
contract rig, from the M5.05 sourcing ladder:

  gesture-talk         UAL1 (CC0) Idle_Talking_Loop, baked
  gesture-talk-seated  UAL1 (CC0) Sitting_Talking_Loop, baked
  gesture-listen       CUSTOM bespoke procedural nod (no nod clip
                       exists in the CC0 spine — UAL1's 43 clips and
                       KayKit Rig_Medium's 119 were inventoried)
  gesture-point        CUSTOM bespoke procedural point (same)
  gesture-present      CUSTOM bespoke procedural present (same)

No Mixamo clip is used, so the project owner's conditioned rung (baked output
only, raw files never published) is never reached. The UAL bake is
orientation retargeting: each mapped citizen pose bone copies its
UAL counterpart's WORLD rotation, baked with visual keying — the
same constraint-bake family build_citizen.py's lineage uses, and
the result is gated by scripts/frame_check_gesture.mjs (limb
inversion / drift checks over every cast kit), not by this script's
say-so. Procedural clips are authored exactly as the factory
authors its knock (build_citizen.py): euler keyframes on the
renamed rig, marked as Portal-authored in the extras.

Usage:
  blender -b --python scripts/retarget_gesture_clips.py -- \
      --donor outputs-v2/orrin-lowmarsh.glb \
      --out outputs-web/clips/gesture-clips.glb
"""
import bpy, os, sys, json, math

FACTORY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UAL_GLB = os.path.join(FACTORY, "assets", "ual1", "UAL1_Standard.glb")

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
OUT = os.path.join(FACTORY, args.get("out", "outputs-web/clips/gesture-clips.glb"))

# UAL (UE mannequin node names in UAL1_Standard.glb) -> citizen
# contract bone. spine_02 folds into chest's source (spine_03);
# clavicles and fingers have no contract counterpart and are
# dropped — recorded here, not hidden.
UAL_TO_CONTRACT = {
    "pelvis": "hips",
    "spine_01": "spine",
    "spine_03": "chest",
    "Head": "head",
    "upperarm_l": "arm.L", "lowerarm_l": "forearm.L", "hand_l": "hand.L",
    "upperarm_r": "arm.R", "lowerarm_r": "forearm.R", "hand_r": "hand.R",
    "thigh_l": "leg.L", "calf_l": "shin.L", "foot_l": "extra.foot.L",
    "thigh_r": "leg.R", "calf_r": "shin.R", "foot_r": "extra.foot.R",
}
UAL_CLIPS = {
    "gesture-talk": "Idle_Talking_Loop",
    "gesture-talk-seated": "Sitting_Talking_Loop",
}


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def action_fcurves(a):
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
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
donor_bones = {b.name for b in arm.pose.bones}

# ------------------------------------------------------------------ UAL bake
ual_new = import_glb(UAL_GLB)
ual_arm = next(o for o in ual_new if o.type == "ARMATURE")
ual_bones = {b.name: b.name for b in ual_arm.pose.bones}
lower = {b.name.lower(): b.name for b in ual_arm.pose.bones}
for k in list(UAL_TO_CONTRACT):
    if k not in ual_bones and k.lower() in lower:
        UAL_TO_CONTRACT[lower[k.lower()]] = UAL_TO_CONTRACT.pop(k)
missing = [c for u, c in UAL_TO_CONTRACT.items() if u not in ual_bones or c not in donor_bones]
if missing:
    raise RuntimeError(f"retarget map unresolved: {missing}; UAL bones: {sorted(ual_bones)}")

kept = {}
sources = {}
for contract, src in UAL_CLIPS.items():
    src_action = bpy.data.actions.get(src)
    if src_action is None:
        raise RuntimeError(f"UAL clip {src} not found; have {sorted(a.name for a in bpy.data.actions)}")
    f0, f1 = int(src_action.frame_range[0]), int(src_action.frame_range[1])
    # constraints: donor pose bone <- UAL bone world rotation
    bpy.context.view_layer.objects.active = arm
    for pb in arm.pose.bones:
        for con in list(pb.constraints):
            pb.constraints.remove(con)
    for ual_name, contract_name in UAL_TO_CONTRACT.items():
        pb = arm.pose.bones[contract_name]
        con = pb.constraints.new("COPY_ROTATION")
        con.target = ual_arm
        con.subtarget = ual_name
        con.target_space = "WORLD"
        con.owner_space = "WORLD"
        con.mix_mode = "REPLACE"
    if not ual_arm.animation_data:
        ual_arm.animation_data_create()
    ual_arm.animation_data.action = src_action
    if not arm.animation_data:
        arm.animation_data_create()
    baked = bpy.data.actions.new(contract)
    baked.use_fake_user = True
    arm.animation_data.action = baked
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, step=1, only_selected=False,
                     visual_keying=True, clear_constraints=True,
                     clear_parents=False, use_current_action=True,
                     bake_types={"POSE"})
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.animation_data.action = None
    kept[contract] = baked
    sources[contract] = {"pack": "Quaternius Universal Animation Library 1",
                         "source_action": src, "licence": "CC0 1.0",
                         "rung": "UAL (CC0)", "method": "orientation bake (world copy-rotation, visual keying)"}
    print(f"BAKED {contract} <- {src} frames {f0}..{f1} fcurves={len(action_fcurves(baked))}")

# UAL objects + actions out; only donor armature + baked actions stay.
ual_arm.animation_data.action = None
for o in ual_new:
    bpy.data.objects.remove(o, do_unlink=True)
for a in list(bpy.data.actions):
    if a not in kept.values():
        bpy.data.actions.remove(a)

# ------------------------------------------------------------- procedural
# Authored on the contract rig, factory knock style. FPS 30; every
# clip loops (first key == last key on every channel).
bpy.context.scene.render.fps = 30
D = math.radians


def author(name, keys, frames):
    """keys: {bone: [(frame, (x,y,z) deg), ...]} — keyframed in full."""
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = act
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    pb = arm.pose.bones
    for bone, track in keys.items():
        b = pb[bone]
        b.rotation_mode = "XYZ"
        for frame, e in track:
            b.rotation_euler = (D(e[0]), D(e[1]), D(e[2]))
            b.keyframe_insert("rotation_euler", frame=frame)
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.animation_data.action = None
    return act


def loop_track(points, frames):
    """points: [(frame,(x,y,z))...] within 0..frames; close the loop."""
    if points[0][0] != 0:
        points = [(0, points[0][1])] + points
    if points[-1][0] != frames:
        points = points + [(frames, points[0][1])]
    return points


F = 72  # 2.4 s at 30 fps
# gesture-listen — a listening nod: two gentle head dips with a
# slight chest lean, hands still. Reads as attending, not talking:
# the arms never move (the masked drill's distinction).
kept["gesture-listen"] = author("gesture-listen", {
    "head": loop_track([(0, (0, 0, 0)), (12, (9, 0, 0)), (24, (2, 0, 0)),
                        (36, (9, 0, 0)), (48, (2, 0, 0)), (60, (0, 0, 0))], F),
    "chest": loop_track([(0, (0, 0, 0)), (24, (3, 0, 0)), (48, (3, 0, 0)), (60, (0, 0, 0))], F),
}, F)
sources["gesture-listen"] = {"pack": "CUSTOM bespoke (Portal-authored)",
                             "source_action": "procedural nod, authored on the citizen rig",
                             "licence": "Portal-authored (no third-party rights)", "rung": "CUSTOM",
                             "method": "euler keyframes, factory knock precedent"}

F = 60  # 2.0 s
# gesture-point — right arm raises and extends toward the facing
# direction, a small pulse, then lowers (looped hold for staging).
kept["gesture-point"] = author("gesture-point", {
    "arm.R": loop_track([(0, (0, 0, 0)), (10, (-78, 0, -6)), (24, (-82, 0, -6)),
                         (34, (-78, 0, -6)), (50, (0, 0, 0))], F),
    "forearm.R": loop_track([(0, (0, 0, 0)), (10, (-8, 0, 0)), (24, (-4, 0, 0)),
                             (34, (-8, 0, 0)), (50, (0, 0, 0))], F),
    "head": loop_track([(0, (0, 0, 0)), (10, (4, 0, 0)), (50, (0, 0, 0))], F),
}, F)
sources["gesture-point"] = {"pack": "CUSTOM bespoke (Portal-authored)",
                            "source_action": "procedural point, authored on the citizen rig",
                            "licence": "Portal-authored (no third-party rights)", "rung": "CUSTOM",
                            "method": "euler keyframes, factory knock precedent"}

F = 72
# gesture-present — both arms open in an offering/hand-over pose
# with a gentle bob: the hand-over beat for pay / give / trade.
kept["gesture-present"] = author("gesture-present", {
    "arm.R": loop_track([(0, (0, 0, 0)), (14, (-38, 0, -28)), (36, (-42, 0, -30)),
                         (58, (0, 0, 0))], F),
    "arm.L": loop_track([(0, (0, 0, 0)), (14, (-38, 0, 28)), (36, (-42, 0, 30)),
                         (58, (0, 0, 0))], F),
    "forearm.R": loop_track([(0, (0, 0, 0)), (14, (-42, 0, 0)), (36, (-46, 0, 0)),
                             (58, (0, 0, 0))], F),
    "forearm.L": loop_track([(0, (0, 0, 0)), (14, (-42, 0, 0)), (36, (-46, 0, 0)),
                             (58, (0, 0, 0))], F),
    "chest": loop_track([(0, (0, 0, 0)), (20, (4, 0, 0)), (52, (0, 0, 0))], F),
}, F)
sources["gesture-present"] = {"pack": "CUSTOM bespoke (Portal-authored)",
                              "source_action": "procedural present, authored on the citizen rig",
                              "licence": "Portal-authored (no third-party rights)", "rung": "CUSTOM",
                              "method": "euler keyframes, factory knock precedent"}

# ------------------------------------------------------------------ extras
arm["clip_library"] = "portal.gesture-clips/v1"
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
print("GESTURE_CLIPS_SUMMARY " + json.dumps(summary))
