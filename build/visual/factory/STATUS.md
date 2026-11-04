# STATUS
- Phase: factory core COMPLETE (functional grade) — pending the project owner persona-milestone approval per BUILD-PLAN D5 before any persona ships to the scene
- Last verified (2026-11-01): all 4 personas built end-to-end by scripts/build_avatar.py from kits/*.json and validated three ways (GLB JSON-chunk parse, Blender re-import round-trip, three.js 0.186.1 GLTFLoader parse — all OK; Node cannot decode the embedded PNG texture, geometry/skins/animations parse, texture is a standard embedded PNG for browsers):
  - atlas.glb — 410,340 B, 36 meshes, 4,228 tris, 17 bones, 8 clips, props prop.crescent_staff + prop.ledger
  - builder-1.glb — 356,996 B, 28 meshes, 4,288 tris, 17 bones, 8 clips, prop.spirit_level
  - verifier-1.glb — 428,136 B, 32 meshes, 4,220 tris, 17 bones, 8 clips, props prop.spectacles + prop.red_pencil + prop.calipers
  - alpha-lead.glb — 374,408 B, 26 meshes, 3,672 tris, 17 bones, 8 clips, prop.compass (shared-rig-above-hem exception, see ALPHA-LEAD.md)
  - Every GLB: 0 missing contract bones (14 required — hips, spine, chest, head, arm/forearm/hand L/R, leg/shin L/R — plus only extra.tail, extra.ear.L/R), 0 missing clips (idle, sit, type, stand, walk, knock, wait, gather; 51 channels each), 1 embedded procedural face texture generated from kit colours.
  - Clip sources (honest, per-clip, recorded in each kit's clip_sources and each GLB's armature extras): UAL1 CC0 arrived in build/assets mid-build (UAL-NOTES.md) and is retargeted onto the spec rig by world-space rotation deltas — idle=Idle_Loop (61f), walk=Walk_Loop (33f), sit=Sitting_Enter (32f), stand=Sitting_Exit (25f), wait=Idle_Loop@stride2 (31f), gather=Idle_Talking_Loop (71f) on atlas (same sources all personas). type + knock are procedural_factory (UAL has no typing/knock clip; type builds on the captured UAL sit end-pose so sit→type does not pop). Without --ual the factory falls back to fully procedural clips, marked identically.
  - Renders inspected by the factory worker: front + iso + sit/type/walk pose checks for all 4. Atlas identity reads (grey tabby, stripes, amber eyes, pink nose, white muzzle/chest, gold crescent staff, ledger) and his UAL walk/sit poses verified in renders (sit end: hips z 0.88→0.54, textbook seated type pose); beaver (round ears, wide muzzle, incisor card, paddle tail, yellow spirit level, mid-stride walk); fox (tall ears, pointed snout, spectacles, red pencil, calipers, seated type pose); alpha (teal dome, amber eyes, tentacle skirt, brass compass). Iterations made from render inspection: iso camera re-aimed at figure centre; alpha eyes moved onto the dome surface after the first render showed them embedded.
- Next: the project owner milestone review of the stills (renders/*--front.png, *--iso.png) per persona; UAL2 / animal-pack motion are additive future swaps on the same rig (kits unchanged).

## v2 detail pass (2026-11-01, the project owner: "could use a bit of improvement/better detail work")
- Pipeline: scripts/build_avatar_v2.py (v1 script + kits untouched; v1 GLBs in outputs/ unchanged). Same shared rig, same bone names, same 8 clips with the same per-clip sources — v2 GLBs are drop-in replacements in outputs-v2/.
- Validated three ways, all OK for all four (record: outputs-v2/validation.json): GLB JSON-chunk parse (0 missing contract bones, 0 missing clips, 51 channels/clip), Blender re-import round-trip, three.js 0.186.1 GLTFLoader parse (Node texture-decode caveat as v1):
  - atlas.glb — 1,027,952 B, 77 meshes, 10,004 tris, 17 bones, 8 clips
  - builder-1.glb — 934,784 B, 55 meshes, 9,012 tris, 17 bones, 8 clips
  - verifier-1.glb — 1,069,840 B, 63 meshes, 10,092 tris, 17 bones, 8 clips
  - alpha-lead.glb — 858,996 B, 54 meshes, 8,488 tris, 17 bones, 8 clips
  - Tri counts are ~2.3x v1 (more, smaller detail meshes + 512px textures): ~10k/figure worst case, ~120k for a full floor of 12 — sane for the fixed-camera desktop scene; accepted as a considered trade for the detail.
- What changed per persona:
  - All: 512px soft-edge painted face cards (crown-to-jaw gradient, soft markings — no more hard flat shapes), mottled two-tone fur texture on body parts, neck join, shoulder spheres, rounded chest/belly patches (no flat rectangles), rounded paw feet with toe grooves, eye highlights, whiskers + whisker dots solved onto the muzzle surface (v2.0 dots were buried inside the muzzles; fixed), smoother head-body join.
  - Atlas (deepest pass): tabby striping now wraps the whole figure — painted forehead M (the v2.0 geometry stripe boxes read as a crown of blocks in renders and were removed in favour of the painted card), geometry cheek stripes, forearm band, shin bands, striped tail (ringed tube, dark tip — the master's tail tip is dark grey, not white), pink inner ears, pink toe pads + toe beans. Staff: tapered crescent with a mid-arc-thick radius profile in warm emissive gold on a gnarled shaft with a knob. Ledger: open book — two angled page blocks with a ruled + handwriting page texture (transposed after renders showed the lines landing vertical on the front face), spine, ribbon bookmark, brass clasp.
  - builder-1: two separate incisors with a mouth-shadow groove (v1 was one floating card), round ears with cream inner discs, spirit level rebuilt — three vials (long horizontal + two round plumb) in dark frames, end caps, ruler ticks; paddle tail is now a rounded crosshatch-textured plate behind the legs (v2.0's axis mix-up swung it through the body and it rendered as an apron between the legs; fixed and re-rendered).
  - verifier-1: spectacles fixed — v1's rims were unrotated (edge-on) and sat below the eyes; v2 rims face forward centred on the eyes, with translucent lenses, bridge and temple arms. Snout is a tapered sphere (v1's cone read as a white disc from the front), big cream cheek ruffs, tucked chin blaze, stern brow ridges, dark ear interiors with cream fringe. Calipers rebuilt (beam, slider, thumbwheel, pointed jaws); red pencil is now hex-barrelled with wood cone, graphite point, brass ferrule and eraser.
  - alpha-lead: mantle speckle shading, brow ridges + heavy lids over the amber eyes, smile rebuilt as a surface-hugging tube with corners up (v2.0's arc read as a frown; the master smiles), naval coat panel with brass buttons and collar, skirt GROUNDED (v1 floated at z 0.42) in one teal tone (v1's alternating stripes read as trousers) with curled front tips and sucker discs on the front tentacles and working arms, elbow joint spheres + wrist-centred hand balls (bent poses no longer show detached floating parts), compass rebuilt — brass rim ring, star-rose dial texture, glass, two-tone needle, centre pin, bail loop.
- Renders: renders-v2/ — front/iso/head close-up/sit/type/walk per persona (24), every one visually inspected; three inspection-driven fix rounds (v2.0 -> v2.1 -> v2.2) are recorded in build_avatar_v2.py comments. Side-by-side sheets: sheets/<persona>--v1-vs-v2.png (scripts/make_sheets.py).
- Render engine note: v2 check renders are Cycles CPU. During the v2 session this VM's Blender 5.2 Workbench died headless for lack of libEGL.so.1 (Chromium's libEGL is a stub); libegl1 + libegl-mesa0 were apt-installed late in the session (first attempt failed on stale package lists) and a Workbench smoke render passes again as of 2026-11-01 23:05 UTC — but the inspected v2 render set is the Cycles one, kept as delivered. Engine is switchable via AVATAR_RENDER_ENGINE; the GLBs are engine-agnostic and the scene renders them in three.js regardless.
- Honest remaining gaps: (1) in the sit clip the hip-weighted hems dip below the floor line (alpha skirt tips, beaver paddle tip) — hidden by the opaque floor from the scene's fixed above-floor isometric camera, visible only in these eye-level check renders; grounding the stand pose was kept as the priority. (2) The garment remains simple boxes (vest/coat blocks) — silhouette-level, not tailored; a garment pass is future work. (3) Atlas's painted forehead stripes are subtle under flat lighting. (4) Props in the type pose follow the hands (calipers/pencil swing with the UAL pose) — same behaviour as v1. (5) File sizes grew (~1 MB/figure) on 512px textures; fine for a local desktop app.
- Next: the project owner D5 milestone review of the v2 stills (sheets/ + renders-v2/).
- Blockers: none. Known limits: renders use Blender Workbench (EEVEE stalls headless on this GPU-less VM — the GLBs themselves are engine-agnostic); alpha-lead locomotion is UAL biped motion on a meshless-leg hem body (visible cue = hips/arm motion over the skirt; a bespoke tentacle glide is future polish, ALPHA-LEAD.md); beaver incisor is a single white card (spec's incisor card, not modelled separate teeth).

---

## Portal M4.05 — factory lift + web profile + size gate (2026-11-02, this copy only)

- **Lift (EXTRACTIONS.md Entry 2):** this whole tree was copied from the VM
  mirror `~/workspace/agent-office/termi-overhaul/build/factory/` under the
  M2.14 register — 73 files, 0 symlinks, per-file SHA-256 manifest at
  `~/workspace/elsewhere-portal/extractions/entry-2-factory-manifest.sha256`,
  copy verified hash-identical. The source tree was not modified.
- **Source tests re-run on the copy, before any extension:** `load_test.mjs`
  8/8 ok (v1 mesh counts identical to the recorded `three-load-test.txt`;
  its three.js resolves from the Office spike tree by the script's own
  hardcoded import, and Node's PNG-decode caveat applies as documented);
  `validate_glb.py` output matches the recorded `outputs/validation.json`
  and `outputs-v2/validation.json` on all 8 GLBs, every compared field.
- **Meshopt choice (plan §5.2 leaves it in factory STATUS): meshopt, via
  gltfpack.** `tools/gltfpack/gltfpack` is meshoptimizer 0.24 (MIT,
  github.com/zeux/meshoptimizer releases), binary SHA-256
  `4e1b381ea7085f4f8edf888b47d36c3b21aa0014300814ab3a475c23a57faec1`.
  Draco was not needed and not taken. Two gltfpack behaviours recorded:
  it strips node extras even with `-ke` (the pipeline restores them with
  `scripts/patch_extras.py`, test-pinned), and its output needs a
  MeshoptDecoder at load (the lifted `load_test.mjs` refuses it;
  `scripts/load_test_web.mjs` is the web exports' load test).
- **Size gate:** `validate_glb.py --profile <lod0|lod1|lod2> --gate`,
  budgets in `web-profile.json`. Positive control pinned in tests: the
  desktop atlas (1,027,952 B / 10,004 tris) is rejected under lod0 with
  both overruns named. Budget-less (desktop) and unknown profiles refuse
  to gate at exit 2 — a gate that cannot fail is not a gate.
- **Web exports (outputs-web/, all four delivered kits, via
  scripts/build_web.sh):** every figure passes its gate and the
  decoder-equipped load test — LOD0: atlas 89,772 B / 2,380 tris,
  builder-1 101,484 / 2,446, verifier-1 90,388 / 2,347, alpha-lead
  93,400 / 2,372 (all 8 clips, textures at 256 px as JPEG, Armature
  extras intact). LOD1: atlas 37,576 B / 666 tris, builder-1 36,096 / 674,
  verifier-1 39,788 / 662, alpha-lead 37,828 / 680 (clips idle/walk/
  gather only, flat material colours — no image textures — animations
  resampled at 15 Hz). Tests: `test/size-gate.test.mjs` 8/8.
- **Pipeline facts learned:** at 2,500 skinned tris the raw vertex data
  alone is ~160 KB — the §5.2 LOD0 budget is only reachable *with* the
  meshopt step the plan names, never by decimation alone. The Blender
  exporter re-encodes packed images as PNG whatever the datablock format
  says (byte-identical output), so the JPEG transcode is a separate GLB
  step (`transcode_images.py`, Pillow). LOD1's JSON chunk (28 KB of its
  first 45.7 KB attempt) is what forced the flat-colour lever, not the
  geometry.
- **Environment note:** /tmp on this VM is a 512 MB tmpfs shared with
  other work and was at 100% during this build (an early builder-1
  export died of it). `build_web.sh` keeps intermediates and TMPDIR
  inside `outputs-web/.work-<persona>/` and removes them on exit.
- **Not in this entry (SE-4.2 lines still open, with their homes):** the
  new clips `talk`, `carry`, `gather-cycle` (no factory clip work done;
  lod1's talk-pose is the `gather` stand-in, recorded in
  web-profile.json); LOD2 standee production (M4.09's pipeline — the
  lod2 byte gate exists and refuses nothing yet because no standee
  exists to weigh); Portal citizen kits (M4.10 — the gate's "passes the
  launch cast" line is evidenced here against the factory's four
  delivered kits as stand-ins, and re-runs per kit via build_web.sh when
  citizen kits exist); the sample-street walking smoke (M4.01's exit
  effect half, lands with the scene side).

## Portal M4.16 — scene-side MeshoptDecoder wiring (2026-11-02, scene copy)

- **This closes the decoder debt the M4.05 entry above recorded** ("its
  output needs a MeshoptDecoder at load (the lifted `load_test.mjs`
  refuses it...); the Portal scene's own decoder wiring is M4.16's
  work, still owed there"). The scene now has its loading path:
  `build/visual/scene/figure-loader.mjs` builds the vendored r186
  GLTFLoader with `setMeshoptDecoder` applied, and `scene.mjs` routes
  figure loads through it (`loadFigure(url)`; kit placement is
  M4.10's, now unblocked on the loading side).
- **Decoder provenance:** the scene's vendored
  `vendor/meshopt_decoder.module.js` is the three r186 addons build —
  the same decoder source this factory's `scripts/load_test_web.mjs`
  wires — byte-identical (sha256 `d428e73a…f19`) to the standalone
  meshoptimizer 1.1.1 package's module. MIT (Arseny Kapoulkine);
  licence text vendored in the scene at `vendor/LICENSE.meshoptimizer.md`,
  full record in the scene's `ASSETS.md`. Nothing hand-rolled.
- **Cross-check, this factory's own outputs:** the scene harness
  (`build/visual/scene/test/figure-loader.test.mjs`, 3/3) decodes
  `outputs-web/atlas--lod0.glb` through the scene wiring and matches
  this entry's recorded counts — 2,380 tris, and 16 meshes / 17 bones /
  8 clips, identical to `load_test_web.mjs` output for the same file. A
  bare loader without the decoder rejects the file (positive control).
  Headless decode proof only; rendered pixels remain the staging
  screenshot ladder's to judge.

---

## Portal M4.09 — standee & portrait pipeline (2026-11-02, this copy only)

- **Pipeline (scripts/build_standees.sh, one command per kit or `all`):**
  (1) `render_standee.py` (Blender 5.2, Workbench) poses the kit from its
  own clips at the canonical camera — orthographic, azimuth from the
  south, elevation 35° (Rendering §4.2), transparent background,
  512×512 — and renders two passes per pose: the figure, and an
  inverted-hull pass (every figure mesh copied at +3% in flat
  outline-brown #8A6D5A, palette §2.2). (2) `finish_standees.py`
  composites hull behind figure (the figure's own pixels untouched),
  archives the 512×512 master, centre-crops to the 256×384 ship form,
  palette-quantises (libimagequant, no dither; ladder 160→16 colours)
  to lossless WebP. (3) `validate_sheet.py --profile lod2 --gate`
  weighs every sprite. (4) `--pack-atlas` writes the shared atlas +
  merged manifest and a per-kit contact sheet in `sheets/`.
  Products in `outputs-web/standees/`: `sprites/`, `masters/`,
  `portraits/`, `atlas.webp` (350,914 B), `shadow.webp` (2,246 B — the
  shared ground-shadow ellipse, 40% peak opacity, Production §7.4),
  `standees.json` (schema portal.standees/v1) + one `<kit>.standee.json`
  fragment per kit.
- **Gate unit, a recorded reading:** Rendering §8.2's "≤ 8 KB per
  standee" is applied per pose sprite (one standee = one billboard
  image; pose swaps swap sprites in the shared atlas). The stricter
  reading — a citizen's whole pose set ≤ 8 KB — would allow ~1.6 KB
  per 256×384 pose and is not achievable with these kits at the plan's
  own ship size; if that reading is ever intended it is a plan
  amendment, not something to fudge in the encoder. Verdicts below are
  under the per-sprite reading, each recorded in the manifest.
- **First run — all four delivered kits, every sprite PASS** (bytes;
  all lossless palette WebP, colours noted where the ladder dropped):
  atlas — idle 7,622 / walk-frame 6,966 / sit 7,502 / work 7,378 /
  talk 7,354; builder-1 — 7,496 / 7,750 / 8,068 / 7,086 / 7,682;
  verifier-1 — 6,994 / 8,116 / 8,056 / 6,966 / 8,082; alpha-lead —
  7,896 / 7,594 / 7,592 / 7,650 / 7,818. Per-citizen pose-set totals
  run 36.8–38.6 KB. Tightest margin: verifier-1 walk-frame, 76 B under
  the cap. Portraits (256×256 PNG, rest pose, head-and-shoulders):
  atlas 49,808 B, builder-1 43,044 B, verifier-1 51,355 B,
  alpha-lead 41,969 B — the plan names no portrait byte budget, so
  portraits are recorded UNGATED, not passed against an invented one.
  Pose frames (clip ranges start at 0 in every kit): idle = idle@24,
  walk-frame = walk@8 (the factory's walk-check quarter-frame
  precedent), sit = sit@31 (end frame), work = type@6 (the factory's
  type-check frame; `type` is the kits' work clip), talk = gather@21.
  The render stage fails loudly if poses do not actually apply
  (head-position distinctness check; observed 4 of 5 distinct on every
  kit — two poses in each kit share a rounded head position).
- **Render source — recorded deviation from Rendering §8.2's letter.**
  §8.2 says the approved LOD0 kit is posed. Posing the LOD0 file is
  not possible today: on Blender re-import, LOD0 alpha-lead's skirt
  skinning breaks — the tentacle skirt renders shortened and its
  sucker discs scatter as debris below the figure (first alpha-lead
  sheet, kept in this session's record), while the v2 master of the
  same kit poses cleanly, matching its own delivered renders. The
  pipeline therefore renders from `outputs-v2/<kit>.glb`, the master
  export the LOD0 is derived from — the standee is the same kit the
  scene ships, and Production §7.4's rule (a sheet is a product of the
  finished figure) is met. **Flagged upstream:** if the breakage is in
  the LOD0 file rather than in Blender's meshopt re-import, the scene
  (M4.16) will show it too — M4.16 should pose-check LOD0 alpha-lead
  in three.js before the swap. No LOD0 file was modified by this arm.
- **Helper-geometry exclusion — a defect this pipeline caught in
  itself.** Every LOD0 import carries a 2 m unskinned, material-less
  node named `Icosphere` (no parent, no armature modifier). It is
  invisible in figure passes (no material) but its outline-material
  hull copy painted a giant brown sphere over the first contact
  sheets. Rule now in `render_standee.py`: a mesh with no materials
  and no armature modifier is not part of the figure; exclusions are
  named per kit in the manifest (`skipped_hidden_meshes` — all four
  kits record exactly `["Icosphere"]`) and the sheets were rebuilt.
  Whether the node should exist in the exports at all is an M4.05-side
  question; this arm only declines to render it.
- **Poses the plan names that do not exist yet (exact gaps, no
  substitutes):** `carry` and `asleep` — neither clip exists in any
  factory kit (SE-4.2's new-clip line, still open since M4.05), so no
  carry or asleep sprite was rendered or faked; both are recorded as
  `gap_poses` in every kit's manifest, and the pose table is data —
  when the clips land, the pipeline picks the poses up unchanged.
  `talk` renders from `gather` (UAL Idle_Talking_Loop), the same
  recorded talk-pose stand-in M4.05 set for LOD1 — a stand-in, not a
  talk clip. The shipped set per kit is therefore idle / walk-frame /
  sit / work / talk: five poses, but not the exact five Rendering
  §8.2 names (carry and asleep out, work and talk in).
- **Stand-ins, stated plainly (per this arm's brief):** no Portal
  citizen kits exist until M4.10, so these standees derive from the
  factory's four delivered kits. The pipeline takes any kit name and
  is re-runnable per citizen kit unchanged (`build_standees.sh <kit>`,
  pinned by the determinism test).
- **Style honesty:** sheets render in Workbench's flat register under
  its studio light, not under the scene's MeshToonMaterial banding
  (§2.1) — they read darker and smoother than the Cycles v2 stills.
  "Renders in exactly the 3D style" (the M4.09 exit gate) is judged
  with the sample street at G-J1 and by the scene freeze-conformance
  capture (M4.16); this arm claims the geometry, pose, palette-hex
  outline, and framing are the plan's — not that banding conformance
  has been measured. The exit gate's second half (a standee stays
  stationary while a detailed figure walks past) is scene behaviour
  and lands with M4.16's LOD system; a standee here is a static
  sprite by construction — it cannot slide, only swap poses.
- **Tests:** `test/standee.test.mjs` 7/7 — manifest truth (input
  SHA-256 re-verified against the master GLBs, output hashes/bytes
  re-verified against disk), gate passes all 20 sprites, positive
  control (a 512×512 master PNG, 95,623 B, is rejected under lod2
  with the overrun named; report mode does not fail), figure/unknown
  profiles refuse at exit 2, gap honesty (carry/asleep recorded and
  absent), and determinism: rebuilding atlas reproduces every sprite
  and the portrait byte-identically. `test/size-gate.test.mjs` still
  8/8. Two build-script lessons recorded in place: Blender exits 0
  even when its Python throws, so build_standees.sh runs with
  pipefail and treats the summary line as the success signal; and
  Blender 5.2's image-format attribute is `file_format`, not `format`.

## Portal M4.10 — citizen kits for the launch cast (2026-11-02, this copy only)

- **Cast.** The citizens the live bundle places: 14 kits. Cast identified
  from bundle seq 143 (`build/data/feed/world-data.json`); the placed
  set (names + places) re-verified unchanged against the live bundle
  repeatedly during the build (seq 166, 184, 193 — the archiver keeps
  advancing it). Unplaced roster members (CarVideo AI AIAgent,
  Kessa Varn) got no kit. Per-kit records with full provenance (pack,
  archive SHA-256 from `assets-src/ASSETS.md`, record sources, clip
  sources) live in `kits/citizens/<slug>.json`; builder is
  `scripts/build_citizen.py`; batch driver `scripts/batch_citizens.sh`.
- **Spine choice, measured.** All kits are built on the KayKit
  Rig_Medium family (23 bones, separate `*_Head` meshes, KayKit's own
  animation pack). The Quaternius half of the spine was measured and
  rejected for gated bodies: its Standard bases are single-mesh (head
  not separable) with ~15% head share at 1.77–1.81 units — the chibi
  procedure cannot lift that into the 0.40–0.43 band (arithmetic bound
  ≈0.24), and its outfits ride a 65-bone UE rig incompatible with the
  production clips. The factory's own v2 personas also predate the
  gate (atlas measures 28.4%) — M4.10 is the first time the measure
  gate was applied to a figure.
- **Chibi procedure (one global parameter set for the whole cast).**
  Head mesh split at the jaw (z = 1.46) into `head` + `hairfall` (long
  hair falls otherwise inflate measured head height); head zone
  ×1.19 about the neck pivot, below-neck z ×0.75, arms ×0.82, hands
  ×1.15 (Look Bible factors), then re-grounded and scaled to 1.8
  units. Two intake calibrations, both recorded here per the gate
  README's intake loop: (1) the head factor is 1.19, not the Bible's
  printed 1.30 — at 1.30 the cast measures 0.42–0.45 (three bases over
  band) because the factor was set against a normal-proportioned rig;
  (2) the jaw cut is an exact bisect cut at 1.46 — face-centroid
  selection lets large low faces (the Knight's beard plates) drag the
  effective cut ~0.07 low (Knight measured 0.449, FAIL), and
  separate-by-vertex-selection leaves the first below-plane ring
  attached; the bisect + copy-and-delete cut is exact. Gear is the
  per-kit variable; the factors never vary per kit. All 14 kits pass
  the measure gate at 0.412–0.426 (production band 0.40–0.43; also
  inside the 0.38–0.42 look target except the Knights at 0.426).
- **Roles (civic order, from the record).** F1 Mayor + F2 Lecturer are
  both Atlas Meridian (bundle seq 143 ticker: "Atlas Meridian's
  lecture began at the College"; the mayor's meeting at Town Hall;
  Atlas is Mayor): Mage base, cream sash (CUSTOM, Look Bible awning
  anchor #FDCFAC, parametric, skinned to chest), spellbook prop at
  150% (the Bible's lecturer exception). F3 Carrier: Orrin Lowmarsh
  (record: "brought a ledger out of an old ruin" ×3, ruin-digging act
  sequence): Barbarian base, ledger prop at 125%. F4 Generic: the
  other 11 — one identity colour each, costume is the spine base's
  baked dress with record-claiming gear withheld (no extra props, no
  invented insignia); the only added elements in the whole cast are
  the sash, the book, and the ledger, each record-bound above.
- **Identity colours.** `citizenColor()` (app logic) has 8 palette
  colours for 14 citizens — 6 collisions. Rule: civic claim order
  (Atlas, Orrin, then bundle order); first claimant keeps the
  citizenColor; colliders take recorded derived extensions (kit JSONs
  carry `identity_colour_source`). Result: 14 unique kit colours. The
  2D stage dots still use citizenColor — a recorded divergence: dots
  are the app's existing language; kits needed uniqueness the dot
  palette cannot express.
- **Per-kit results** (LOD0 ≤122,880 B / ≤2,500 tris; LOD1 ≤40,960 B /
  ≤800 tris; standee sprites ≤8,192 B each):

  | citizen | role | base | colour | LOD0 B/tris | LOD1 B/tris | head | standees |
  |---|---|---|---|---|---|---|---|
  | atlas-meridian | F1+F2 | Mage +sash +book | #a9c46f | 104,904 / 2,328 | 39,412 / 702 | 0.412 | 5/5 |
  | orrin-lowmarsh | F3 | Barbarian +ledger | #b39de0 | 106,444 / 2,324 | 37,876 / 702 | 0.421 | 5/5 |
  | arabela-protoser | F4 | Rogue_Hooded, mask off | #7fb8e8 | 99,700 / 2,325 | 38,440 / 698 | 0.415 | 5/5 |
  | brat-natha | F4 | Knight +helmet, cape | #c98bb9 (derived) | 100,584 / 2,314 | 38,300 / 696 | 0.426 | 5/5 |
  | hark-plumbline | F4 | Rogue, grey hair | #f2b879 | 101,264 / 2,332 | 38,720 / 703 | 0.418 | 5/5 |
  | kavi-marlow | F4 | Mage, deeper skin | #e88f8f | 97,084 / 2,324 | 36,452 / 701 | 0.412 | 5/5 |
  | kevin-bianchi | F4 | Barbarian | #ef8fb5 | 100,308 / 2,322 | 37,060 / 703 | 0.421 | 5/5 |
  | lenore-nevermore | F4 | Rogue_Hooded, mask on | #7fd1c8 | 99,856 / 2,323 | 38,480 / 701 | 0.415 | 5/5 |
  | nath-between | F4 | Barbarian | #c46fa2 (derived) | 100,472 / 2,322 | 37,056 / 703 | 0.421 | 5/5 |
  | nath-borowik | F4 | Mage, cape | #4fb3a9 (derived) | 97,444 / 2,326 | 37,428 / 702 | 0.412 | 5/5 |
  | robert-wiseman | F4 | Knight +helmet, no cape | #6fa287 (derived) | 100,576 / 2,313 | 37,356 / 696 | 0.426 | 5/5 |
  | rocky-headlong | F4 | Ranger +donor bear hat | #e8c87f (derived) | 104,144 / 2,341 | 38,780 / 705 | 0.420 | 5/5 |
  | sapphire-clarke | F4 | Knight +helmet, cape | #7aa7e8 (derived) | 100,624 / 2,314 | 38,344 / 696 | 0.426 | 5/5 |
  | sarah-clarke | F4 | Rogue, cape off | #8fd0a0 | 101,028 / 2,333 | 37,720 / 701 | 0.418 | 5/5 |

  All masters pass `validate_glb.py` with 0 missing bones/clips and
  the factory load tests (masters 14/14; web load tests inside
  `build_web.sh` per kit). LOD1 "missing clips" in a raw validate run
  are the profile's intentional subset (idle/walk/gather), same as the
  stand-ins' LOD1s. Standees via the M4.09 pipeline: 70/70 sprites
  PASS (7,820–8,192 B); carry/asleep poses remain the gaps M4.09
  recorded (the standee pose table has no source clips for them).
  Contact sheets: `sheets/<slug>--standees.png`.
- **HAZARD 1 — the M4.09 skirt flag: verdict NOT A FILE DEFECT.** The
  shipped LOD0 files deform sanely in the loader the scene actually
  uses. Evidence: `scripts/pose_check.mjs` (new, this item) loads each
  LOD0 through the scene's own stack (three GLTFLoader +
  MeshoptDecoder), applies idle/walk/sit/knock/type through an
  AnimationMixer, and compares the posed point cloud against the
  master — for all 14 citizens the low-body region (bind height <0.5,
  where capes/skirts live) tracks the master with worst centroid
  delta 0.011 units and identical spread (0.25–0.30); the alpha-lead
  pair itself (the flagged files) tracks the same way (sizes within
  0.06, spread 0.261 vs 0.280, constant across poses = decimation, not
  scatter). The breakage is a Blender re-import artifact, reproduced
  here on demand: Blender's importer degrades meshopt-compressed
  skinned GLBs (the pilot LOD1 re-imports shredded; the alpha-lead
  LOD0 re-imports with its skirt displaced) while the same bytes
  measure correctly in three.js. Two method traps recorded for the
  next investigator: (a) Blender renders of web-profile GLBs are not
  evidence about the files — M4.09's own workaround (render standees
  from the masters) was the right instinct; (b) three's
  `SkinnedMesh.getVertexPosition` returns LOCAL space (it undoes
  bindMatrix) — for meshopt files the mesh node carries the
  KHR_mesh_quantization dequant scale (~0.00013), so forgetting the
  final `matrixWorld` multiply reads raw quantized integers and
  reports a ~7,700× "explosion" that is not in the files either.
  Full per-pose numbers: `work-citizens/pose-all.jsonl`.
- **HAZARD 2 — distinctness ceiling, stated exactly.** The spine caps
  base silhouettes at the six KayKit Rig_Medium bodies (Quaternius
  unusable for gated bodies, above; its two Standard outfits ride the
  incompatible UE rig). Fourteen citizens on six bodies are distinct
  by the full matrix — base × gear (helmet/visor/cape/mask/hat
  on-off, one cross-base donor) × identity garment colour × hair
  colour/style × skin tone × props — and no two cast members share
  more than a base: the three Mages differ in cape, sash+book, hair
  and skin; the three Knights in cape and colour; the Barbarians in
  colour, hair, skin and the ledger. The ceiling: citizens sharing a
  base share its baked garment CUT (e.g. all Knights wear the same
  armour pattern, tinted) — more garment variety needs outfit meshes
  the recorded spine does not contain (the Quaternius outfits cannot
  be re-rigged honestly inside this item). No purchase made, no pack
  fetched; flagged here as the ceiling, per the brief.
- **Defects found and fixed during this build.** (1) The Barbarian's
  hat mesh is named `Barbarian_BearHat`, not `*_Hat`: the first batch
  shipped it un-dropped and unrenamed on all three Barbarian kits,
  where the below-neck squash slid the bear muzzle over the face —
  every numeric gate passed it; the contact sheets caught it. Drop
  list, part names, head-zone suffixes and the donor path now handle
  `*_BearHat`; all three Barbarian kits rebuilt and re-sheeted.
  (2) Rocky's first headgear (Knight helmet donated onto the Ranger
  base) put his temple hair outside the helmet shell; replaced with
  the Barbarian bear hat as donor (reads as a fur hood; gate-valid at
  0.420). His temple hair keeps its source red-brown — the texture
  remap's leather family keeps it, while the palette hair colour
  lands on the crown region; recorded in his kit file's terms.
  (3) Prop parenting: bone-parenting with the bone's inverse matrix
  cancelled the bone transform and parked the book at the world
  origin (it also polluted the measure gate's total height to
  2.231); props now keep their authored local transform inside the
  bone frame (parent inverse = identity).
- **Pipeline extensions (recorded, minimal).** (a) `web_profile.py`
  LOD1 flatten: a textured material exports no baseColorFactor, so the
  flatten's "keep the existing base colour" produced Blender's 0.8
  grey for every part and gltfpack merged the figure into one grey
  material — citizen LOD1s would have shipped colourless. Citizen
  masters now carry the intended flat in material extras
  (`flat_colour`, written by `build_citizen.py`); the flatten restores
  it. LOD1s now carry 5–7 distinct flat materials per kit (bytes rose
  vs the merged-grey form, still in budget). (b) `finish_standees.py`
  lossy ladder extended 90/80/70 → +60/50/40: textured citizen
  sprites land 3–5% over the 8 KB budget at the old floor; the new
  rungs engage only when every existing rung fails. (c) New tool
  `scripts/pose_check.mjs` (hazard-1 method, above).
- **Scene wiring.** `build/visual/scene/figure-kits.json` (generated
  by `gen-figure-kits.py` from the kit records + live bundle; records
  bundleSeq 193 at generation) maps each PORTAL-KEY to its kit's
  LOD0/LOD1/standee manifest + identity colour. `figure-kits.mjs`
  attaches LOD1 figures over the capsule placeholders via the scene's
  `loadFigure` (M4.16 path only), hides the capsule meshes, keeps
  blob/pick/held treatment on the group, starts the idle clip, and
  leaves the capsule standing on any load failure; the frame loop
  runs only when at least one kit attached. The four stand-in
  personas are wired to NO citizen — every cast member has a real
  kit, and no placed citizen lacks one, so stand-ins remain only as
  factory test fixtures. Scene tests: `test/figure-loader.test.mjs`
  3/3 (unchanged) + new `test/figure-kits.test.mjs` 4/4 (manifest =
  live placed set; no stand-in wired; files exist; kit records match;
  every LOD1 loads through the scene loader with 23 bones and the
  LOD1 clip subset; armature extras carry the PORTAL-KEY). Manifest
  paths are build-tree paths — staging figure delivery is a publish
  step concern (M4.16/deployment scope), not wired here.
- **Exit-gate disposition (wave brief).** Mayor reads by sash +
  colour ✓ (sheet + portrait); Lecturer by the book ✓; Carrier reads
  as carrying ✓ (ledger in hand, all poses). All 14 regulars distinct,
  no shared identity colour ✓ by construction + table above. "No
  costume element without a record source": the only added elements
  are the three record-bound props/sash; base dress is spine stock,
  stated as such — a blinded masked-drill exercise was not separately
  run; the contact sheets are the standing evidence and VER can drill
  from them. "All render within budget": 70/70 sprites + 42 GLBs
  within their gates (the plan's "78" assumed ~13 citizens; actual
  cast is 14). Observed, not fixed (source behaviour, not kit
  defects): the KayKit sit clip carries some cape verts ~0.38 below
  the floor plane mid-clip on the masters themselves.

## M4.08 — work-clip library landed (2026-11-03, SURFACE lane)

- `scripts/retarget_work_clips.py` builds **`outputs-web/clips/work-clips.glb`**
  (330,708 B, armature-only): 11 clips retargeted from the CC0 KayKit
  Character Animations 1.1 packs onto the citizen rig through
  `build_citizen.py`'s own BONE_RENAME map — work-hammer, work-dig,
  work-pickaxe, work-saw, work-chop, work-fish, work-fish-cast,
  work-fish-reel, work-pickup, rest-lie, rest-lie-down. Clip sources
  are recorded in the armature extras (`clip_sources`); donor was the
  Orrin master with meshes stripped. The library lives under `clips/`
  because the size-gate census treats every top-level outputs-web GLB
  as a figure export.
- **Cross-rig defect found by the frame check, fixed at bind time:**
  glTF position tracks are absolute, and the six bases' rest offsets
  differ, so the raw library measurably dragged other kits' segments
  (Knight worst: 0.0262). The scene's `work-clips.mjs`
  `retargetClip()` re-bases each position track onto the playing
  kit's own rest offsets (deltas preserved, scale tracks dropped,
  rotations untouched). The GLB itself is not re-exported per kit.
- **Frame check** (`scripts/frame_check_work.mjs`, scene's own loader
  + retarget path, 25 samples/clip): **154/154 clip×kit checks pass**
  across all 14 cast kits — finite, binds-and-moves, no limb
  inversion, segment drift ≤0.01, root drift ≤0.5 (worst 0.12,
  rest-lie-down), feet ≥ −0.30, head above floor. Report:
  `work-citizens/work-clips-framecheck.json`.
- **Coverage** (`work-citizens/work-clips-coverage.json`, against
  `build/data/action-table.mjs` families): covered — excavate,
  build-raise-install, repair-frontier, make-craft (kit-carried
  type), harvest (kit-carried gather), pick-up. **GAP, stated not
  faked: deliver-mend and haul — the CC0 spine has no carry
  locomotion (KayKit Holding_* are static holds).** The fishing trio
  is vocabulary on the shelf; no action-table family names fishing.
- Scene side: `scene/work-clips.mjs` (loader + player with crossfade,
  refuses unknown clips), kits take per-citizen players at boot, and
  scene.html carries an honestly-labelled clip-preview bar (a
  preview, never the record). Tests: factory `test/work-clips.test.mjs`
  3/3; scene `test/work-clips.test.mjs` 4/4 (incl. the Knight re-base
  proof: raw drag >0.015, re-based ≤0.01).

## Factory contracts re-pin — persona-era suites re-pinned to the real cast (2026-11-03, factory-contracts lane)

- **Why:** `test/size-gate.test.mjs` and `test/standee.test.mjs` were
  written when outputs-web/ held only the four stand-in kits. After
  M4.10 landed the real cast alongside them, the suites' census and
  structural expectations were stale: size-gate ran 4 pass / 4 fail,
  standee 5 pass / 2 fail (baselines re-measured by this lane, Node
  v24.22.1, per file). Full per-assertion table:
  `plan-to-complete/lane-factory-contracts.md`.
- **What changed (tests only — no kit, GLB, sprite, or budget touched):**
  the cast is now derived from the landed records (scene
  `figure-kits.json` + `kits/citizens/*.json` + the non-building
  records in `kits/`), never a hard-coded list; bone expectations are
  per population (citizens 23 Rig_Medium bones, stand-ins 17), per
  VER-LOG shift 14's independent parse; the props assertion now pins
  exact equality with each kit record's own specified props (most
  citizen records specify none — the M4.10 design choice above, gear
  withheld — and the two that specify one, atlas-meridian's book and
  orrin-lowmarsh's ledger, ship exactly those); citizen armature
  extras are pinned by citizen_id/citizen_key against the scene
  manifest (stand-ins keep persona_id); the LOD0 texture floor is per
  population (citizens >= 1 image, stand-ins >= 2) with the
  JPEG-over-4096 B rule unchanged; the standee manifest census now
  covers all 18 recorded kits (14 citizens + 4 stand-ins), atlas rects
  still kits x poses + 1 (= 91). No budget number was weakened and no
  assertion was deleted; one assertion was added (export/record
  coverage in the size-gate suite).
- **No class-(c) kit defect found.** Every stale expectation traced to
  the population change with the kit records and VER shift 14 agreeing
  (bytes/tris inside budget for all 36 top-level exports; LOD0 the
  full 8-clip set and LOD1 gather/idle/walk for both populations).
- **Results after the re-pin (per file, Node v24.22.1):** size-gate
  9/9, standee 7/7, factory work-clips 3/3; cross-check scene
  figure-kits 4/4 and figure-loader 3/3 — all green.
- **Environment note:** the standee determinism rebuild failed once
  during this lane with Blender's recorded headless failure
  ("Couldn't open libEGL.so.1" — see the v2 render-engine note at the
  top of this file). The library was absent from the VM image after
  tonight's re-imaging; the host's os-intent package replay restored
  libegl1/libegl-mesa0 while this lane waited (~80 s), the dpkg lock
  was never touched, and the suite then passed in full, determinism
  included. Not a kit or contract defect.

---

## M4.14 — Ember building set (2026-11-03, BUILDINGS lane)

- **Builder:** `scripts/build_buildings.py` (Blender headless) composing
  Quaternius MegaKit modules + Village Pack landmarks on the 2-unit
  module grid from `kits/bld_<slug>.json` cards (recipes per
  visual-plan/02 §5.1 + `../footprint-specs.json`), flat family-token
  materials, lettered sign boards (script-generated textures), and two
  CUSTOM primitive builds: Benny the Pug statue (358 tris, cap 400)
  and the Ledger printing press (512 tris, cap 600, `press_platen`
  pivot). Outputs: `outputs-buildings/*.glb` (11 places, 668–17,566
  tris each) + the scene manifest `../scene/building-kits.json`.
- **Intake (M4.04 completion):** MegaKit + Village Pack filed in
  `assets-src/ASSETS.md` with licences read from inside the archives
  BEFORE first use; cold check of 5 random shipped assets passed 5/5
  (record: `plan-to-complete/lane-buildings.md`). PC mirror of the two
  new archives deferred with the reason recorded there + in ASSETS.md.
- **Scene:** `../scene/buildings.mjs` attaches each GLB over its
  node's scaffold (hides only `userData.placeholder` meshes), places
  it on the layout-v3 geometry rect its manifest `origin` names, and
  registers its meshes as building pickables; scene cards read the
  condition line from the app logic's `workTier` (M4.15 D-9b).
  `../scene/test/buildings.test.mjs` 6/6; scene suite 67/67.
- **Notable build history:** a world-preserving vs local-keeping
  parenting bug put every piece at the origin in round 1 (fixed in
  `reparent` + `_finish_import`, documented in the script); MegaKit
  roof shells leave open gables, closed by CUSTOM prism infills sized
  from each placed roof's bbox; the press failed its masked drill in
  round 1 (hidden behind the centred sign, deep in the bay) and
  passed after moving forward + off-centring the board (drill report:
  `../scene/drills/press-drill.md`); the Market awning took four
  passes to a striped box canopy that leaves the sign readable.
