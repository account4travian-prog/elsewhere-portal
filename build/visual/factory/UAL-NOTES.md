# UAL1 — verified source data for the factory (coordinator note, 2026-11-01)

UAL1 Standard is DOWNLOADED and licence-verified (CC0 1.0, License.txt in the zip):
- Zip: `build/assets/downloads/Universal_Animation_Library_Standard_godotstore.zip`
  (14,541,205 B, sha256 18ff1a7215f4852b320203e8aaf02a1578b5c8eef9027fbaedfcedc7b85a3ac2),
  via Quaternius's official Godot Asset Store listing (download id 44).
- Extracted: `build/assets/extracted/ual1-standard/Animation Library[Standard]/`
  - Godot GLB: `Godot/AnimationLibrary_Godot_Standard.glb` (6,671,104 B) — **46 clips, 1 skin, 55 nodes**
  - Unity FBX (20,623,420 B), Unreal FBX (24,856,556 B) also in the zip.
- This is the Mar-2025 Standard build (46 clips), not the Jun-2026 itch v3.0. UAL2 is
  not yet obtained (itch anonymous $0 flow demands a payment method; Godot Store has
  no UAL2 listing) — UAL2 is additive only; do not block on it.

## Clip inventory (46) — the office-relevant ones
Idle_Loop, Idle_Talking_Loop, Walk_Loop, Walk_Formal_Loop, Jog_Fwd_Loop, Sprint_Loop,
Sitting_Enter, Sitting_Exit, Sitting_Idle_Loop, Sitting_Talking_Loop, PickUp_Table,
Interact, Fixing_Kneeling, Crouch_Idle_Loop, Dance_Loop, Jump_*, Roll, Swim_*, Pistol_*,
Punch_*, Sword_*, Spell_*, Hit_*, Death01, A_TPose.
No "typing" clip (expected — spec §2.4's `type` is seated pose + procedural forearms)
and no "knock" clip (candidates: Interact, or procedural on the shared rig).

## Rig reality check (important)
The UAL skeleton is a Rigify-style DEF rig — bone names are NOT the spec §2.2 names.
Mapping for retarget/baking (spec name → UAL DEF name):
- hips → DEF-hips · spine → DEF-spine.001 · chest → DEF-spine.003 · head → DEF-head
- arm.L/R → DEF-upper_arm.L/R · forearm.L/R → DEF-forearm.L/R · hand.L/R → DEF-hand.L/R
- leg.L/R → DEF-thigh.L/R · shin.L/R → DEF-shin.L/R (feet: DEF-foot.L/R, toes DEF-toe.L/R;
  shoulders DEF-shoulder.L/R; neck DEF-neck)

Factory consequence: bake/rename the needed UAL clips onto the factory's spec-named
rig in Blender (constraint-copy + bake, or build the factory rig with these DEF names
as the deformation bones under spec-named control bones). Either is acceptable for the
functional grade IF the exported GLB carries the spec §2.4 clip names
(idle, sit, type, stand, walk, knock, wait, gather) and the mapping is documented in
the kit metadata. Procedurally generated clips remain acceptable for v1 where a UAL
clip doesn't exist (type, knock), marked as procedural.

## Animal bases (for kit reference / future per-species rigs)
- Farm pack (CC0, local zip): Cow/Horse/Llama/Pig/Pug/Sheep/Zebra (.blend/.fbx/.obj).
- Ultimate Animated Animal Pack via Poly Pizza (Quaternius's official channel there,
  bundle page states CC0): 12 GLBs in `build/assets/extracted/quaternius-animals-polypizza/`
  (24–26 clips each) — Alpaca, Bull, Cow, Deer, Donkey, **Fox**, Horse, Husky,
  Shiba Inu, Stag, White Horse, Wolf (slug→animal mapping being confirmed by render ID).
  The Fox GLB is the verifier-1 motion/base reference. Direct Drive download of the
  full pack is quota-blocked from this VM (see ASSETS.md) — Poly Pizza GLBs are the
  obtained form; FBX/Blend forms remain in the Drive folder for a later retry.
