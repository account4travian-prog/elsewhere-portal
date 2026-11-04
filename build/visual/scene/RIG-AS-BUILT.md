# Scene scaffold — rig as built

Implements the LOOK-BIBLE-V0 §4 baseline rig card in `scene.mjs`.
**Headline: the card needed no tuning.** Final values are the card's values,
exactly; the probe gate passes on them (below).

## Final rig values (= the card)

| Area | As built |
|---|---|
| Renderer | Three.js **r186** vendored (see ASSETS.md), `outputColorSpace` sRGB, **NeutralToneMapping @ 1.15**, MSAA on, pixelRatio min(dpr, 2) |
| Materials | `MeshToonMaterial` + shared 4-texel gradient map (`#8A8A8A/#B8B8B8/#E2E2E2/#FFFFFF`, NearestFilter), one material instance per palette colour, smooth normals |
| Sun | DirectionalLight `#FFF1DC` @ **2.6**, position (−38, 52, −26), only casting light |
| Fill | Hemisphere `#BFE3F2`/`#E8D9B0` @ **0.95**; SE fill DirectionalLight `#DCEBF5` @ **0.55** from (30, 18, 34), no shadow |
| Shadows | PCFSoft, **2048²**, camera ±62 / +48 / −48, near 10 far 160, bias −0.0004, normalBias 0.6, radius 4 |
| Grounding | Blob shadows (centre alpha 0.32; citizen radius 0.55, building radius ≈ footprint half-width × 1.15) + real directional shadow. Baked AO not applicable to procedural placeholders (no kits yet) |
| Sky / fog | Gradient-dome ShaderMaterial with the card's stops (`#A8D4EC`/`#D9EDF7`/`#FDF3E3`), 8 code-generated cloud billboards @ 0.55 alpha, static; **Fog `#EAF4F8` near 180 far 620** |
| Camera — canonical | Orthographic, elevation 35°, azimuth from south, target = Plaza + (0, 0, 3) |
| Camera — follow | Perspective fov **28°**, elevation 35°, 13-unit frame height at target (distance ≈ 26.1), centred on the selected node/citizen's node |
| Figures | Placeholder capsule + head, total height ≈ 1.81 units (card: 1.8) |

## Probe — measured values

Gate: shadow/lit luminance ratio **0.50–0.65** at all probe points
(visual-plan 01 §1.2 / Bible §4).

| Probe point | Lit lum | Shadow lum | Ratio | Band |
|---|---|---|---|---|
| Cobble (pad in College shadow / pad in sun) | 219.6 | 127.3 | **0.580** | ✓ |
| Figure cheek (lit limb / shadow-side limb) | 182.3 | 100.1 | **0.549** | ✓ |

**Method used for these numbers (documented approximation):**
`probe-check.mjs` (rerunnable: `node probe-check.mjs`, exit 0) replicates
the vendored r186 shader math extracted from the source itself —
`getGradientIrradiance` (texel at dotNL·0.5+0.5, Nearest), hemisphere
mix(ground, sky, 0.5·dotNL+0.5), BRDF_Lambert 1/π, the NeutralToneMapping
GLSL verbatim, sRGB encode, then display-space luminance — the same
definition the in-page sampler uses. Shadow-side points take sun factor 0
(cobble pad inside the College roof shadow; cheek limb self-occluded).
Known residual vs pixel sampling: PCFSoft terminator softness (radius 4).

**Why not pixel sampling for the as-built numbers:** the in-page probe
(`scene.mjs`, `window.__portalProbe`) implements pixel sampling and runs
automatically on load, but direct Chromium launch from this context is
policy-blocked — `/opt/meta-chromium/chrome` refuses startup with "Hatch
WebGL domain policy is required for browser startup", and its README
confirms normal startup requires the WebGL policy supplied by
browser-daemon. The scene is left ready for the coordinator's CDP capture
route (visual-plan 01 §9: file:// load with file access allowed), which
will produce the pixel-sampled values and the screenshot; if those disagree
with the analytic values outside the PCFSoft residual, the pixel values
govern and this file gets a delta entry.

## Deviations from the card / plans (all scaffold-scoped)

1. **Overview frustum height 68, not 34.** The card's 34 units presumes
   layout v3's scale. The current shared layout at 10 units/cell spans
   ≈ 60 × 70 world units (with the staged fill row); 34 would crop the
   town, and this bookmark's job is framing the whole layout. Revisit when
   layout v3 lands.
2. **Weather grade not applied.** The live bundle reads OVERCAST (Winter,
   year 45), whose Bible grade would set sun 1.7, hemi sky `#C9D8DE`,
   cloud alpha 0.85, fog near 140. This scaffold implements the baseline
   rig the gate is defined against (per the arm's brief); weather grades
   land in a later wave, with their caption. Cloud billboards accordingly
   sit at base-grade 0.55 alpha and do not drift (drift is fair/clear only).
3. **Ground is flat planes/strips**, not the rendering plan §3.1 build
   (vertex-noise lawn, procedural cobble wedges, kerbs). Streets are strips
   drawn from the layout's own edges, so street and route graph agree;
   the rest is production-wave work.
4. **Baked AO absent** — it is a kit-build step; placeholder blocks carry
   blob + real shadow only.
5. **`preserveDrawingBuffer: true`** on the renderer — a scaffold/capture
   aid so the probe can read pixels after render; production's
   render-on-demand loop does not need it.
6. **Cheek probe is instrumentation**: a skin-anchor sphere (r 1.05) on a
   post at the Plaza plus two cobble probe pads, grouped as
   `probe-instrumentation` for one-line removal when the golden-capture
   route takes over probe duty.
7. **HTML label chips** over buildings (scaffold framing aid; the plan's
   chip ladder with collision resolution is production work).
8. Citizen markers use the app's `citizenPositions` output unmodified,
   including its per-place fan-out in grid units scaled by the same
   grid→world transform as the buildings; asleep citizens render at 55%
   opacity and 0.9 scale (a scaffold treatment — the distinct asleep
   treatment is a later-wave item). Citizens with no evidenced place
   (2 of 17 in bundle seq 12) stay off-stage, as in the app.

## M4.16 — figure loader path + MeshoptDecoder (2026-11-02)

The scene's GLTF loading path now exists and is decoder-equipped, closing
the debt the M4.05 factory entry recorded ("the Portal scene's own decoder
wiring is M4.16's work"). What landed:

- **`figure-loader.mjs`** — the one loader factory: a vendored r186
  `GLTFLoader` with `setMeshoptDecoder(MeshoptDecoder)` applied, using the
  vendored decoder (provenance + licences: ASSETS.md). `scene.mjs` creates
  the loader once (`figureLoader`, also on `window.__portalFigureLoader`
  for capture tooling) and exposes `loadFigure(url)` — fetch + parse
  through that loader — as the entry point kit placement (M4.10) will
  call. No other scene code constructs a GLTFLoader.
- **Importmap** in `scene.html`: the vendored addons import the bare
  specifier `three`; it maps to `./vendor/three.module.js`, the same file
  `scene.mjs` imports directly — one three instance.
- **Headless proof** (`test/figure-loader.test.mjs`, 3/3): the scene's
  own wiring parses the factory's `outputs-web/atlas--lod0.glb` in Node
  (bare `three` resolved to the vendored copy by the test's resolve hook)
  and the decoded census matches the factory's records for that file —
  **2,380 tris** (factory STATUS, M4.05), **16 meshes / 17 bones / the
  same 8 clip names** the factory's `load_test_web.mjs` reports for it.
  Positive control in the same file: a bare GLTFLoader without the
  decoder rejects the same GLB (`/MeshoptDecoder/`), and source pins
  fail if the wiring is removed from `figure-loader.mjs` or `scene.mjs`.
  Scope, honestly: this proves decode + scene-graph shape headlessly. It
  renders nothing and samples no pixels — the rendered-pixel check of a
  decoded figure stays with the staging screenshot ladder. Node also
  cannot decode the GLB's embedded JPEG textures (loader logs the known
  "Couldn't load texture" warnings, as the factory load tests do);
  browsers decode them normally.
- Figures on stage are still the procedural placeholders — no kit is
  placed yet. That is M4.10's work, now unblocked on the loading side.

## Files

`scene.html`, `scene.mjs`, `figure-loader.mjs`, `probe-check.mjs`,
`ASSETS.md`, `test/` (figure-loader.test.mjs + three-vendor-hook.mjs),
`vendor/` (three.module.js + three.core.js + LICENSE.three.md;
GLTFLoader.js + BufferGeometryUtils.js + SkeletonUtils.js;
meshopt_decoder.module.js + LICENSE.meshoptimizer.md). Verified from this
context: `node --check scene.mjs` parses; the logic import + layout/bundle
pipeline runs in Node (11 effective nodes, 15 edges, 15 citizens placed);
`node probe-check.mjs` exits 0.

## Live probe readout — pixels vs probe math (2026-11-02, records only)

First rendered-pixel read of the live staging scene (coordinator's
browser ladder, 2026-11-02 ~21:57 CST), against probe-check.mjs's
probe-by-approximation predictions:

- Cobble ratio: live **0.602** — inside the 0.50–0.65 band, close to
  the predicted 0.580.
- Cheek ratio: live **0.906 — GATE OUT OF BAND**, against the
  predicted **0.549**. The approximation's cheek model is wrong by a
  wide margin; the cobble model holds.

Per the standing rule, **pixels govern over probe math**: the live
0.906 is the fact, the 0.549 prediction is retired as evidence about
the rendered rig. Disposition is deferred to the G-J1 look work —
no rig change is made on this entry. The browser's by-eye read of
the same render agreed the scene is bright with localised shadows,
not half-and-half overall, which is consistent with the measured
cheek ratio and inconsistent with the approximation.

## Layout v3 + label system (M4.11/M4.13/M4.12, geometry lane, 2026-11-03)

What changed in this scene when layout v3 landed (generator:
`build/visual/layout-v3-build.mjs`; lane record:
`plan-to-complete/lane-geometry.md`):

- **Streets** are drawn from the layout's baked door-to-door street
  paths (`street.path` per edge; staged-fill edges computed at
  runtime by the same `streets.mjs`), width 3.4 — replacing the
  scaffold's centre-to-centre strips that ran through node centres.
- **Buildings** stand on their footprint-spec rects (8×6 / 6×4 / 4×4
  per M4.14's specs) at the v3-composed offsets, replacing the
  uniform 6.4×6.4 centred boxes. Heights remain the scaffold's
  BUILDING_FORM values (ungoverned by any plan source — FOOTPRINTS.md
  worklist item 7); the M4.14 kits replace the blocks wholesale.
- **Doors** sit on their spec faces at the baked anchors (2 units
  wide, one module), replacing the scaffold's all-south 1.5-wide
  doors — the Library Annex, Workshop, Meridian Hall, Ledger Press,
  and Willow Cottage doors moved to the faces their streets actually
  serve. Corner-entry shifts: Market Hall +2, College −2.
- **The Plaza** is paved over its full 10×10 cell (spec B1),
  replacing the radius-8.4 disc that spilled into neighbouring
  cells; the pedestal+orb centrepiece placeholder remains (Benny
  the Pug is M4.14's custom piece). Plots carry their 8×8 parcel
  planes; Market Hall has its stall apron; **PLOT_30 no longer gets
  a building** — parcel only, the honest empty-plot treatment.
- **Labels** are placed by `labels.mjs` (M4.12): sign rung at the
  v3 sign anchor (with a plain sign-wood board mesh at the same
  anchor), roof-tag and edge-tag rungs behind it, citizen name
  chips in the same layer yielding to signs. The fixed +8.6-unit
  floating offset is gone. Placement re-resolves only when the
  projected picture changes (mode/target/size/a walking figure).
- **Deviation kept, recorded:** scene.html's `.lbl` still renders at
  11px; the design token for in-scene labels is 12.5px
  (`font.scale.chip`). labels.mjs sizes its boxes at the token size
  (the ceiling), so placements are valid at either size. Aligning
  the CSS changes scene.html's inline `<style>`, whose SHA-256 is
  pinned in the staging Worker's CSP — that edit belongs to the
  staging lane and was not made here (the handler test caught the
  drift when it was tried; the CSS change was reverted, the header's
  staging-disclosure sentence — body text, unhashed — stayed).
- **Deviation CLOSED (2026-11-03, VER rotation 1):** `.lbl` now
  renders at the token's 12.5px. `SCENE_STYLE_SHA256` in the staging
  Worker was updated to the new style hash the documented way and
  the Worker redeployed (Version ID
  `3969c5a3-cd92-42ea-9abd-8e54311a38ff`); the staged scene page
  serves the new bytes under the new CSP — verified by fetch
  (served scene.html SHA-256 == build-tree SHA-256). Full record in
  `build/VER-LOG.md`, rotation 1.

## M4.07 — the cheek-ratio finding: the instrument was wrong, not the rig (2026-11-03, SURFACE lane)

The staging ladder's live pixel read put the cheek ratio at **0.906**,
outside the Bible's 0.50–0.65 shadow/sun band, and the first
`probe-check.mjs` predicted 0.549. Both numbers were re-derived from
the sampler up before any light was touched:

- A faithful model of the scene's own sampler (vendored-three raycast
  normals + r186 toon math, rig values imported from the token-fed
  `palette.mjs`) reproduces the live pixels: **fill-limb 0.908
  modelled vs 0.906 live; cobble 0.580 modelled vs 0.602 live.** The
  model is calibrated; the old probe-check was not (it zeroed the sun
  on its "shadow" point and used hand-derived normals).
- A disc scan over the whole probe sphere found **no visible point
  reading below 0.836** of the lit sample under the card rig. The
  sampler's south-east point is not a shadow point at all: with
  `shadowNormalBias` 0.6 it samples as lit, and it faces the SE fill
  plus the hemisphere dome. A grid search over card-family rigs found
  no setting that puts that point in band without breaking the cobble
  pair, which shares the same sun/ambient balance.
- Conclusion: the Bible's quantity is a cheek **in shadow**. The pair
  is therefore measured the way the cobble pair already was — the
  same sun-side cheek point on two identical spheres, one standing in
  the College's cast shadow. **Model ratio 0.535, in band.** The scene
  now builds that second sphere (skin anchor, beside the shadow cobble
  pad, clear of it from the overview camera) and `runProbe` reports
  `{cobbleRatio, cheekRatio, fillLimbRatio, verdict}` with the old
  limb kept as a labelled diagnostic — not gated, never hidden.
- **No light values changed.** Sun 2.6, hemi 0.95, fill 0.55, Neutral
  @ 1.15, gradient texels — the rig stays the Bible card, now fed from
  tokens (`palette.mjs`, generated from the token artefact; see
  `gen-palette.mjs`). `probe-check.mjs` was rewritten to the faithful
  model and passes: cobble 0.580, cheek (cast shadow) 0.535,
  diagnostic 0.908.
- Owed: the definitive pixel re-read of the new cast-shadow pair
  rides the coordinator's staging ladder (expected ≈0.535 ± PCFSoft
  residual). The analytic gate and the live cobble pair say the model
  tracks pixels; the cheek pair's live read is the remaining receipt.
