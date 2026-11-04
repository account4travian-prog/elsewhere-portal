# Alpha-Lead (octopus) — procedural exception note

Status: **GLB produced** (functional grade), with the documented exception
shape from SOFTWARE-DESIGN §2.1/§2.2 and RESEARCH §4.3.

## What was built
`outputs/alpha-lead.glb` — built by the same factory script and kit schema
as the bipeds (`kits/alpha-lead.json`, `body_plan: "octopus_hem"`):

- **Shared rig above the hem, exactly as spec'd:** the identical 17-bone
  armature (14 contract bones + `extra.tail`, `extra.ear.L/R`, unused by
  this species but present so one clip set drives everyone). The two
  working tentacles are `arm.L/R` + `forearm.L/R` + `hand.L/R` (tapered
  tube meshes instead of boxes).
- **Below the hem:** no leg meshes. An 8-tentacle skirt (tapered tubes,
  alternating body/dark teal) is skinned to `hips`, per spec §2.2
  ("its tentacle skirt is a skinned mesh weighted to `hips`").
- **Dome head** with the speckled teal face texture generated from the kit,
  amber eye geometry, a mouth line, deep-teal coat torso, and the brass
  **compass** prop (`prop.compass`, 125%, right hand).
- **All 8 clips present** (`idle, sit, type, stand, walk, knock, wait,
  gather`), 51 channels each. Sources (per UAL-NOTES.md retarget):
  idle/walk/sit/stand/wait/gather are UAL1 CC0 clips baked onto this rig
  (Idle_Loop, Walk_Loop, Sitting_Enter, Sitting_Exit, Idle_Loop@stride2,
  Idle_Talking_Loop); `type` and `knock` are procedural (UAL has neither)
  — per-clip sources are recorded in the kit and the GLB extras, never
  claimed otherwise. `sit` lowers the hips onto the skirt, which reads
  as settling, not chair-sitting.

## Validation (verified 2026-11-01)
374,408 bytes · 26 meshes · 3,672 triangles · 17 bones (0 missing, extras
namespaced) · 8 animations · props: `prop.compass` · Blender re-import
round-trip OK · three.js GLTFLoader parse OK.

## Renders
`renders/alpha-lead--front.png`, `renders/alpha-lead--iso.png` (+ sit/type
pose checks). Identity read from the renders: teal dome, amber eyes,
smile, tentacle skirt, brass compass — matches the 2D master
(`design/avatars/deepseek-alpha-lead.webp`: octopus captain, deep teal
coat, brass compass) at functional grade. Hero polish remains a
the project owner persona-milestone step (BUILD-PLAN D5), same as every persona.
