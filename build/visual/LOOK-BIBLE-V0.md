# Elsewhere Portal — Look Bible v0

**Status: v0-DRAFT.** This file is the working palette and rig authority for
VW-1 onward. It freezes as **Look Bible v1.0 only at G-J4** (the project owner's v1 look
sign-off, per the Automation Package's AUTO-L07 form). Until then it changes
only through the delta path in `visual-plan/03-refinement.md` §1.5.

**Authority rule (VISUAL-PLAN REC-2):** the sampled anchors in §2 are the
conformance targets. The hand-picked constants in
`visual-plan/01-rendering-scene.md` §2.2 are implementation starting values —
where a constant and an anchor disagree, **the anchor arbitrates** and the
rendering loop tunes constants until *renders* land within tolerance
(L1 bar: ≥85% of anchor patches within ΔE00 ≤ 6, none beyond ΔE00 10).
G2 design tokens remain the one shipped colour source (REC-1); this Bible is
measurement, never imported by the renderer.

**Evidence:** `palette-anchors.json` (schema `portal.palette-anchors/v0`),
produced by `extract-palette.mjs` in this folder — patch-median sampling at
named anchor points + median-cut dominant clustering, per
`visual-plan/03-refinement.md` §1.1. Decoder: python3 + Pillow 10.2.0 raw-RGB
dump (the samples are `.webp`; Node stdlib has no WebP decoder). Rerunnable:

```
cd build/visual && node extract-palette.mjs
```

Deterministic: verified byte-identical across repeated runs
(`palette-anchors.json` sha256
`ed02045c3e6b06e7b2bd3462eb47ecabef5e69ed43bfed45b780ff19349999a6`;
supersedes `a0529346…12c91` — the 2026-11-03 grass amendment in §7
changed the `grass_sunlit` entry only).

**Sources (hash-pinned):**

| Sample | File | sha256 (first 16) | Size |
|---|---|---|---|
| Sample 1 — plaza (exterior) | `samples/media-generation-sample-1-plaza-wide-0-52f7b39c-….webp` | `12daa75ca744442d` | 1920×1280 |
| Sample 2 — College cutaway (interior) | `samples/media-generation-sample-2-college-cutaway-0-3ec118ff-….webp` | `862f6a7b31763973` | 1920×1280 |
| Sample 3 — street alt (2D register) | `samples/media-generation-sample-3-street-alt-style-0-ffb35b22-….webp` | `7f537b2b40934603` | 1920×1280 |

Patch placements were verified against annotated overlays of all three
samples and corrected over three passes where a patch straddled a
neighbouring surface (crates, figures, a dormer window, the page background,
a foreground rock). Per-patch hexes, pixel rects, and sample counts are in
the JSON; the tables below carry the pooled anchor values.

---

## 1. Value floor (all registers)

No scene surface darker than **`#694A3B`**, except 2D-register outlines and
recorded states (Refinement §1.1; REC-14). If a render needs a darker value
to read, the fix is a lighter neighbour, not a darker surface. Albedo working
band 0.55–0.85 value; the floor is the law, the band is the working range.

## 2. Palette anchors — the authority

### 2.1 Exterior register (Sample 1)

| Anchor | Hex | Patches (normalised centres) | Samples | Plan constant (§2.2) | ΔE00 |
|---|---|---|---|---|---|
| Sky, upper | `#EBE6E2` | (0.45, 0.045), (0.07, 0.05) | 3,362 | `#A8D4EC` sky zenith | 18.13 |
| Grass, sunlit | `#CDEAC0` † | (0.63, 0.72), (0.945, 0.83) | 3,362 | `#B7E2A0` grass base | 6.36 |
| Grass/foliage, shade | `#545931` | (0.055, 0.845), (0.30, 0.855) | 3,362 | — (see note a) | — |
| Paving, cobble lit | `#E2CFC1` | (0.42, 0.83), (0.415, 0.585) | 3,362 | `#E9E2D2` plaza cobble | 7.18 |
| Paving, shaded | `#DCC7B4` | (0.215, 0.625), (0.49, 0.955) | 3,362 | `#CFC4AC` grout/shadow step | 6.02 |
| Roof, lavender family (College) | `#8679A0` | (0.43, 0.125), (0.475, 0.155) | 3,362 | `#A78FD0` College purple | 11.12 |
| Roof, blush (Town Hall spire) | `#FDE5CF` | (0.755, 0.20) | 1,681 | `#F2B8C6` Town Hall pink | 20.89 |
| Timber, structural | `#99775B` | (0.107, 0.333), (0.316, 0.44) | 1,250 | `#8A6742` timber dark | 7.06 |
| Trim, pale | `#CFBE95` | (0.775, 0.415), (0.183, 0.825) | 3,362 | `#FBF3E2` cream plaster | 14.45 |
| Blossom pink | `#E3B5AA` | (0.885, 0.165), (0.038, 0.235) | 3,362 | `#F6C9D8` blossom pink | 11.43 |
| Awning/banner cream | `#FDCFAC` | (0.222, 0.434), (0.682, 0.464) | 1,250 + 672 | `#FFF6EA` awning stripe cream | 14.48 |
| Skin, base | `#B4A9A8` | (0.351, 0.573), (0.417, 0.578) | 450 | — (none) | — |
| Sign wood (face) | `#DDD595` | (0.501, 0.647) | 1,681 | — (see note b) | — |

### 2.2 Interior register (Sample 2)

Interior light is warmer and lower-contrast than exterior; the still is the
reference.

| Anchor | Hex | Patches | Samples | Plan constant | ΔE00 |
|---|---|---|---|---|---|
| Floor wood | `#F8CDA3` | (0.60, 0.865), (0.79, 0.775) | 3,362 | `#E8C39A` interior wood | 3.18 |
| Frame timber | `#D9BC8B` | (0.50, 0.166), (0.297, 0.42) | 1,586 | `#B98A5E` timber | 14.74 |
| Wall mint | `#9EAB9C` | (0.128, 0.52), (0.845, 0.30) | 3,362 | `#CFE3D2` interior wall mint | 14.09 |
| Chalkboard green | `#627962` | (0.40, 0.295), (0.333, 0.474) | 3,362 | `#5E7D6A` chalk green | 3.09 |
| Curtain/soft-goods cream | `#C3A088` | (0.648, 0.44), (0.838, 0.40) | 1,922 | — (none) | — |
| Window glow | `#F6D195` | (0.743, 0.415), (0.72, 0.33) | 1,922 | `#FFD9A0` warm lamp | 2.09 |

### 2.3 2D register (Sample 3)

A translation of the 3D palette, not a second palette; each 2D anchor names
its 3D counterpart class so fallback drift is detectable.

| Anchor | Hex | Basis | Samples | Plan constant | ΔE00 |
|---|---|---|---|---|---|
| Sky wash | `#FAE6E3` | patches (0.50, 0.055), (0.30, 0.045) | 3,362 | `#FBF7EE` 2D paper | 9.04 |
| Outline umber | `#3C2D22` | cluster-derived (note c) | 25,600 | `#8A6D5A` outline brown | 23.58 |
| Sage (canopy) | `#B1C3A2` | patches (0.28, 0.215), (0.68, 0.23) | 3,362 | `#8FD0A0` leaf green | 9.90 |
| Grass wash | `#CDD2B4` | patches (0.09, 0.86), (0.72, 0.90) | 3,362 | `#B7E2A0` grass base | 11.77 |
| Path blue-cream | `#CBC0B3` | patches (0.47, 0.855), (0.415, 0.775) | 3,362 | `#E9E2D2` plaza cobble | 8.30 |
| Window glow | `#E5D0BF` | patches (0.887, 0.583), (0.175, 0.393) | 1,250 | `#FFD9A0` warm lamp | 11.63 |
| Lantern warm | `#E1C799` | patch (0.263, 0.848) | 441 | `#FFD9A0` warm lamp | 5.92 |

**Notes on method-sensitive anchors**

- **(†) Grass, sunlit — amended by ruling, 2026-11-03.** The patches
  above sampled `#E5CE9D`, which reads as sand in the render. By
  the project owner's ruling (DECISIONS.md 2026-11-03, approving the §T1a
  touch-up in `plan-to-complete/lane-look-touchup-scope.md` — the
  Bible delta path, Refinement §1.5; entry in §7 below) the governing
  anchor is **`#CDEAC0`**, the app 2D stage's existing green, so the
  two surfaces and the plan token settle to one value (disagreement
  D-T02 resolved). The sampled hex stands in `palette-anchors.json`
  as `sampledHex` evidence; the amendment lives in
  `extract-palette.mjs` (`RULED_AMENDMENTS`), so a re-run reproduces
  it. L1 scores the rendered grass against `#CDEAC0` from this date.
- **(a) Grass, shade:** §2.2 has no shade-grass constant; its nearest class,
  leaf green `#8FD0A0`, is a *lit* foliage colour and is not a valid
  comparison (the script's raw pairing gives ΔE00 40.43 — a class mismatch,
  not a tuning target). The sampled shade anchor `#545931` is deep
  olive-green from two shaded hedges; against Refinement §1.1's earlier
  shade table value `#7C885D` it is the same family, darker.
- **(b) Sign wood:** the Ember Plaza sign face measures pale cream-yellow
  wood `#DDD595`. §2.2's timber constants are frame/beam colours; the raw
  pairing against `#B98A5E` (ΔE00 23.44) is a class mismatch. Sign faces are
  their own class from this extraction onward.
- **(c) Outline umber:** line-work is thinner than any honest patch, so
  this anchor is cluster-derived by a filed rule — the largest-share warm
  cluster (hue 10–50°) with L* < 45 in Sample 3's median-cut set: `#3C2D22`
  (hue 24.6°, L* 19.6, 3.13% subsample share), the line + deep-shadow
  family. It is darker than Refinement §1.1's eye-checked `#705E54`; the
  cluster median includes the deepest shadow strokes. The 2D register rule
  stands regardless: **never pure black, never grey**.
- **Skin, base** carries no ΔE band (Refinement §1.1 scores skin as
  per-figure variants ±1 step). The pooled read `#B4A9A8` mixes a
  shadow-side cheek with a lit cheek at 15 px patch scale; treat it as a
  centre of variation, not a paint value.
- **Sky, upper** reads near-white haze `#EBE6E2` at the top band of
  Sample 1 — the blue-green the eye remembers lives lower in the frame.
  The dome gradient stops in §4 are implementation means; L1 scores the
  *rendered* sky at this anchor's patch locations.

## 3. Where the plan's constants diverge from the anchors

Every §2.2 constant paired with its sampled anchor, largest divergence
first (ΔE00, computed by the extraction script). Reading rule (REC-2): a
divergent constant is a **tuning target for the render loop**, not yet a
failed anchor — albedo under a tone-mapped rig is not the rendered colour.
Constants that cannot be tuned into tolerance without breaking a
neighbouring anchor become a Bible-delta question, not a builder's choice.

| Class | Plan constant | Sampled anchor | ΔE00 | Reading |
|---|---|---|---|---|
| Roof, blush (spire) | `#F2B8C6` | `#FDE5CF` | 20.89 | Constant is pink; the sampled spire is blush-cream. Constant is wrong as a start value — retune toward cream. |
| Sky zenith | `#A8D4EC` | `#EBE6E2` (upper) | 18.13 | Constant is saturated blue; the sampled upper sky is near-white haze. Dome stops are means — the rendered sky at the anchor patches must land pale. |
| Grass base | `#B7E2A0` | `#CDEAC0` † | 6.36 | Amended by the project owner's ruling, 2026-11-03 (see §2.1 note † and §7): the sampled anchor was `#E5CE9D` (ΔE00 18.03 — warm sage-cream that read as sand); the governing anchor is now the 2D stage's green. (Vs grass light `#CDEBB4`: 3.18.) |
| Frame timber (interior) | `#B98A5E` | `#D9BC8B` | 14.74 | Sampled interior frame is paler, honey-toned. |
| Awning stripe cream | `#FFF6EA` | `#FDCFAC` | 14.48 | Sampled awning/banner cream carries more peach. |
| Cream plaster | `#FBF3E2` | `#CFBE95` | 14.45 | Sampled pale trim is deeper tan-cream (gable + cottage wall pool). |
| Interior wall mint | `#CFE3D2` | `#9EAB9C` | 14.09 | The second flagged case, confirmed: sampled mint is greyer and deeper (a named V-17 tuning target, REC-16). |
| Grass base (2D wash) | `#B7E2A0` | `#CDD2B4` | 11.77 | 2D wash is pale sage-cream, consistent with the 3D grass finding. |
| Window glow (2D) | `#FFD9A0` | `#E5D0BF` | 11.63 | Sampled 2D window glow is muted by the watercolor wash. |
| Blossom pink | `#F6C9D8` | `#E3B5AA` | 11.43 | Sampled blossom is dusty peach-pink, less candy. |
| College roof | `#A78FD0` | `#8679A0` | 11.12 | Sampled roof is muted grey-lavender, less saturated than the constant (and greyer than Refinement §1.1's `#AC8FAE` — the roof's lit slope measures grey-mauve; see JSON per-patch values). |
| Leaf green (2D sage) | `#8FD0A0` | `#B1C3A2` | 9.90 | 2D canopy is pale sage. |
| 2D paper (sky wash) | `#FBF7EE` | `#FAE6E3` | 9.04 | Wash carries a pink tint the paper constant lacks. |
| Plaza cobble (2D path) | `#E9E2D2` | `#CBC0B3` | 8.30 | 2D path is cooler, blue-grey-cream. |
| Plaza cobble | `#E9E2D2` | `#E2CFC1` | 7.18 | Close family; sampled cobble is warmer. |
| Timber dark | `#8A6742` | `#99775B` | 7.06 | Sampled structural timber is lighter mid-brown. (Vs timber `#B98A5E`: 9.06.) |
| Cobble grout/shadow | `#CFC4AC` | `#DCC7B4` | 6.02 | Near; sampled shade step is warmer. |
| Warm lamp (2D lantern) | `#FFD9A0` | `#E1C799` | 5.92 | Near family. |
| Interior wood | `#E8C39A` | `#F8CDA3` | 3.18 | **Agrees** (inside the ΔE00 ≤ 6 band). |
| Chalk green | `#5E7D6A` | `#627962` | 3.09 | **Agrees.** |
| Warm lamp (interior glow) | `#FFD9A0` | `#F6D195` | 2.09 | **Agrees.** |

Also recorded: the extraction's anchors differ from Refinement §1.1's
2026-11-01 eye-checked table in several places (sky `#D9E4E3` → `#EBE6E2`;
College roof `#AC8FAE` → `#8679A0`; interior mint `#9DB4A5` → `#9EAB9C`,
near-agreeing; floor `#FCCFA5` → `#F8CDA3`, agreeing). Where they differ,
**this file's values govern**: they come from the filed, rerunnable script
with per-patch evidence, which is the auditable method REC-2 names. The
earlier table stands as the eye-check it was.

## 4. Baseline rig card

From VISUAL-PLAN §4 (Rendering §1–§7 as reconciled). The one page a coder
implements from.

| Area | Spec |
|---|---|
| Renderer | Three.js, vendored Office build, pinned, no CDN; `outputColorSpace` sRGB; **`NeutralToneMapping`, exposure 1.15** (ACES rejected — it greys pastels); MSAA on; `setPixelRatio` min(dpr, 2) desktop |
| Materials | **`MeshToonMaterial` + one shared 4-texel gradient map** (`#8A8A8A / #B8B8B8 / #E2E2E2 / #FFFFFF`, NearestFilter) = 3 shadow bands + lit (4-step); smooth normals, `flatShading` off; one material instance per palette colour; Tier C fallback `MeshLambertMaterial`, same palette |
| Sun | `DirectionalLight #FFF1DC` @ **2.6**, from **NW** — position (−38, 52, −26) rel. town centre, elevation ≈52°; the only casting light |
| Fill | Hemisphere `#BFE3F2` sky / `#E8D9B0` ground @ **0.95**; SE fill `DirectionalLight #DCEBF5` @ **0.55** from (30, 18, 34), no shadow |
| Shadows | `PCFSoftShadowMap`, **2048²**; camera ±62 / +48 / −48, near 10 far 160; bias −0.0004, normalBias 0.6, radius 4; **gate: shadow/lit luminance ratio 0.50–0.65 at all three probe points** (cobble in sun, cobble in College shadow, figure's shadow-side cheek) |
| Grounding | Triple stack: instanced blob shadows (centre alpha 0.32, radius = footprint ×1.15 ≈ 0.55 units/citizen), baked AO in vertex colours (0.82 multiplier), real directional shadow. SSAO rejected. **No 3D outlines.** |
| Sky / fog | Inverted-sphere gradient dome (stops `#A8D4EC` / `#D9EDF7` / `#FDF3E3` — implementation stops; rendered sky is scored against the §2.1 sky anchor); 6–10 cloud billboards (white 0.55 alpha, drift 0.15 u/s only when recorded weather is fair/clear); **`Fog #EAF4F8`, near 180, far 620** (never hazes the town: max in-town camera distance ≈140) |
| Weather grades | From the record only, captioned: OVERCAST sun → 1.7, hemi sky → `#C9D8DE`, clouds 0.85 alpha / 60% cover, fog near → 140; RAIN sun → 1.4, sky → `#B9CBD6`, lamps on; SNOW ground variant set only (no falling particles — unrecorded motion is invention); resting grade sun 2.2, exposure 1.08 — dusk-toned, never labelled night |
| Camera — canonical | **Orthographic, elevation 35°**, fixed azimuth from south; Overview frustum height 34 units @16:9, zoom 10→60; pan clamped to core +15 units |
| Camera — follow | Perspective fov **28°**, elevation 35°, frustum height 13 units, lookahead 2.5 units, ease ≤6 u/s (F-1 default: the split; orthographic fallback pre-built, ratified or reverted at G-J1) |
| Figures | Citizen height **1.8 units**; walk speed 1.4 u/s; ≤8 walking at once; carried props 125% (book 150%); idle phase from citizenKey hash |
| Interiors | Cut set = roof + south/east walls; ≤3 `PointLight`s (`#FFD9A0`, intensity 6, distance 9, decay 2) per open room, one room open at a time; no bloom |
| Budgets | Draw calls ≤120 town view; triangles ≤450k town view; figure LOD0 ≤2,500 tris / ≤120 KB; standee ≤8 KB; ≥30 fps sustained on the golden gathering fixture |

## 5. Proportion bands

Stations per REC-4 — tightest first; each governs the station its own file
built it for:

| Station | Band |
|---|---|
| **Production acceptance** (V-05, script-measured on the rig) | **Head = 40–43% of height** (heads-tall 2.33–2.50 derived). A rig outside this is not decimated, not rendered. The chibi procedure's factors live in `chibi-params.json` (thigh/shin 0.78×, arms 0.82×, head mesh 1.30× about the neck pivot, clavicles +8%, hands 1.15×). |
| **Look target** (V-10, L2 scoring of acceptance captures) | Head ratio **0.38–0.42** |
| **Hard defect** (any acceptance capture) | Outside **0.36–0.44** is look-breaking regardless of the parameter file |
| Props | **125% ±10** of natural scale (lecturer's book 150%) |
| Silhouette | Inflated **115%** |
| Finished citizen height | **1.8 units** (REC-5); standard door 2.2 units (≈1.22×, as-built ratio, not a defect) |

A figure measuring 42–43% passes production and L2 tolerance but sits above
the Bible target — scored look-dulling at most, tuned at ladder rung 5.1.

## 6. Standing notes

- The named don't: the Office static view ("dooky") — flat light, no
  contact grounding, no motion life, dead staging, murky palette, diagram
  camera. Each cause carries a detector (L1/L4/L5/L6/L7) and an owner in
  Refinement §1.4.
- Median-cut cluster shares in the JSON are structural fractions of the
  split tree (25 / 12.5 / 6.25 …), a property of the algorithm, not exact
  colour-region populations. Cluster hexes are per-cluster medians.
- If a future sample replaces one of the three, re-run the script; the
  delta goes through the §1.5 delta path, never a silent edit of this file.

## 7. Amendments (the project owner-approved deltas, Refinement §1.5)

- **2026-11-03 — Grass, sunlit anchor amended: `#E5CE9D` → `#CDEAC0`.**
  Evidence: the G-J1 frames and the D-T02 disagreement — the sampled
  anchor rendered as sand, while the app 2D stage already shipped the
  green `#CDEAC0` and the plan token carried a third value
  (`#CDEBB4`); three grass greens for one surface. Ruling: the project owner,
  DECISIONS.md 2026-11-03 — "Build the touch-ups in that order",
  approving `plan-to-complete/lane-look-touchup-scope.md` §T1a, whose
  recommendation is the 2D stage's existing green. Applied through
  the palette pipeline only: `RULED_AMENDMENTS` in
  `extract-palette.mjs` (sampled hex retained as evidence in
  `palette-anchors.json`), tokens followed in the same change
  (`color.anchor.grass_sunlit`; `color.surface.grass` collapsed to
  the single value), `tokens.css` and the scene `palette.mjs`
  regenerated. Lane record:
  `plan-to-complete/lane-touchup-t1a.md`.

## 8. Measurement log (records only — anchors change only via §7)

- 2026-11-04 — L1 counted set re-measured at bundle seq 997
  after the touch-up wave's patch aims were re-aimed (audit
  close-out; full record: measure-l1-seq997.json in the
  regression shots + plan-to-complete/touchup-r1-evidence/;
  status line: GJ1-TOUCHUP-R1-PACK.md addendum 2026-11-04).
  grass_sunlit ΔE00 2.776 (PASS); cobble_lit 5.71 (PASS);
  roof_lavender_college 18.087 (FAIL — measured at ground
  level, the default viewer state, aim re-based to the dropped
  roof; built-form supplementary 18.036); awning_banner_cream
  14.549 (FAIL — aim crop-verified on the Market Hall frontage
  band); grass_wash_2d 8.75 (FAIL — stage-leg family median vs
  the 2D anchor, round-2 method); sky_upper NOT MEASURED (no
  gate framing contains sky: the 900×900 ground plane fills
  every framing and occludes the dome; the earlier 19.146
  figure was ground scored as sky and is retired). Counted
  set: 5/6 measured, 2 within ΔE00 ≤ 6 — the L1 bar is not met
  on numbers at this seq, and no wider claim is recorded.
  Value floor holds. the project owner's Item 1 ruling stands over these
  numbers (colours accepted as his vision, 2026-11-03); this
  log is the measurement record, not a reopening.
