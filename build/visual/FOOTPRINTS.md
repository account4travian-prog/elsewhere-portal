# FOOTPRINTS.md — M4.14 footprint specs

The machine-readable specs live in [footprint-specs.json](footprint-specs.json)
(schema `portal.footprint-specs/v1`); the consistency checks live in
[test/footprint-specs.test.mjs](test/footprint-specs.test.mjs) and run with
`node --test test/footprint-specs.test.mjs`. This file is the human record:
where every number came from, what the checks found, and where the scene
scaffold disagrees (the kit-build worklist).

**Scope.** Every place the Portal can put a building today: the 10 authored
nodes of `build/shared/ember-layout.json` (v1, untouched by this work) plus
`EMBER_DISTRICT_1_PLOT_30`, which the live bundle evidences and
`build/app/logic.mjs`'s `effectiveLayout` places by staged fill at grid
(1,8). **Totals: 10 layout nodes + 1 staged-fill place = 11 places, 11
specs.** These specs are the first deliverable M4.11 (layout v3) consumes;
they change no geometry themselves.

## Units and the scale note

Specs are in the build's world units — the system the Look Bible rig and
the scene scaffold both use (citizen 1.8 units, standard door 2.2). One v1
layout cell = 10 units (the scene scaffold's stated convention). One
recorded divergence, flagged for M4.11 and **not** resolved here:
`visual-plan/01-rendering-scene.md` §0 says "1 unit = 1 grid cell" of the
*Office FloorData grid* and sizes layout v3's staged core at ≈ 96 × 72
units — a finer grid than the v1 place grid (whose extent in build units
is 60 × 70, plus the fill row). When v3 composes its geometry it must say
which grid its units count; these specs stay in build units throughout so
the conversion is one multiplication, never a reinterpretation.

## Derivation rules (every number traces to one of these)

1. **Module rule (footprints).** MegaKit's native grid is 2 units —
   "the physical constraint" on building composition (VISUAL-PLAN REC-5,
   citing Production §0). Every footprint dimension is a whole number of
   2-unit modules, counted by the scale word in the building's recipe
   (`visual-plan/02-asset-production.md` §5.1): grand/large civic and
   hall class 4 × 3 modules; small hall and workshop-scale 3 × 2; homes
   2 × 2. *No plan source states a per-building footprint number* — this
   rule is a stated derivation for M4.11/M4.05 to ratify at build, and
   it is labelled derived wherever it is used.
2. **Parcel rule (district plots).** Parcel = 8 × 8 units: the 10-unit
   cell minus a 1-unit street margin on each side (derived from layout
   geometry).
3. **Doors.** Height 2.2 units (Look Bible §5; REC-5 — stated). Width
   2 units = one module opening (derived from rule 1). Face = the
   dominant axis of the primary-street vector (below), ties broken
   south-first — the canonical camera sits to the south (Look Bible §4)
   — then by the sign of dx. `anchor_door` is the threshold centre of
   that face; `anchor_sign` is centred on the same face 0.4 units above
   the door head = 2.6 units (`visual-plan/02` §5.2 — stated).
4. **Frontage.** The primary street is the node's layout edge on the
   shortest path to the Plaza of Unity (the hub holds 7 of the layout's
   14 authored edges). Each spec names that edge verbatim from the
   layout's edge list; PLOT_30 uses the staged fill's Plaza edge.
5. **Storeys.** Stated only where a plan source states it. The College
   recipe names "stone walls + timber upper floor" → **2**. Everything
   else is `storeys: null` with its reason recorded — the Town Hall's
   bell tower is recorded as an element, not counted as a storey, and
   D-9c's apartment storeys are not read across to the cottages.

## Per-place summary

| Place | Design | Footprint (units) | Storeys | Door face | Frontage street |
|---|---|---|---|---|---|
| Plaza of Unity (4,4) | B1 | 10 × 10 paving (its whole cell) | — open place | none | all 7 Plaza edges + fill edge |
| Town Hall (4,1) | B3 | 8 × 6 body + 2 × 2 bell tower | null (unstated; tower ≠ storey) | south | Plaza, due south |
| Market Hall (2,2) | B4 | 8 × 6 + 8 × 2 stall apron S | null (unstated) | south | Plaza, diagonal SE |
| The College (6,2) | B2 | 8 × 6 | **2 (stated)** | south | Plaza, diagonal SW |
| Library Annex (2,6) | B6 | 6 × 4 | null (unstated) | east | Plaza, diagonal NE |
| Public Workshop (6,6) | B5 | 6 × 4 | null (unstated) | west | Plaza, diagonal NW |
| Meridian Hall, Plot 18 (7,4) | B7 | 8 × 6 in an 8 × 8 parcel | null (unstated) | west | Plaza, due west |
| Ledger Press, Plot 31 (1,4) | B8 | 6 × 4 in an 8 × 8 parcel | null (unstated) | east | Plaza, due east |
| Maple Cottage (1,1) | B9 | 4 × 4 | null (unstated) | south | Market Hall, diagonal SE (only street) |
| Willow Cottage (7,7) | B9 | 4 × 4 | null (unstated) | west | Workshop, diagonal NW (only street) |
| District 1 Plot 30 (1,8, staged fill) | — none named | **no building** — 8 × 8 parcel, honest empty-plot treatment | — | none (gate faces north) | Plaza via the fill edge, diagonal NNE |

## Consistency checks — results (7/7 pass)

- **Coverage:** 11 specs for 11 effective places; grid positions in the
  specs match the layout file (and, for PLOT_30, the fill position the
  test recomputes from `effectiveLayout`'s rule rather than trusting the
  specs file). The layout file still has exactly its 10 authored nodes.
- **Cell containment:** every footprint and parcel sits strictly inside
  its node's cell. One listed boundary case: the Plaza's paving fills its
  cell exactly (10 × 10) — an open place has no walls, so touching the
  boundary overlaps nothing. Pairwise, no two footprints overlap: the
  closest pair of places (Maple Cottage ↔ Market Hall) stands √2 cells
  (≈ 14.1 units) apart centre-to-centre against a summed half-diagonal
  of ≈ 7.8 units.
- **Module rule:** every width/depth (footprints, parcels, the stall
  apron, the tower) is a multiple of 2 units; every door is 2.2 high,
  one module wide, sign anchor at 2.6.
- **Streets:** every named frontage edge exists in the layout's edge
  list (PLOT_30's is the fill edge, marked as such); **every spec door
  faces a real street** — the door's face direction has a layout edge
  running that way, and specifically faces its named frontage street.
  No door/frontage defect exists in the specs against the current layout.
- **Storeys honesty:** the College's 2 is the only stated count in the
  set; the other ten specs carry `null` plus their reason (test-pinned).
- **Dormant kit:** the seam is named (below); no spec carries a variant
  or integrity field.

## Findings on the current layout (for M4.11/M4.13, not fixed here)

- **D-2 · Diagonal frontage is the norm.** 7 of 11 places' primary
  streets approach on a diagonal (Market Hall, College, Library Annex,
  Workshop, both cottages, PLOT_30). The specs assign each door to the
  street vector's dominant axis and record both the vector and the face,
  so the choice is visible — but v3 must decide whether it composes
  corner entries for diagonal streets or keeps dominant-axis doors.
  That is a composition decision for M4.11/M4.13; the specs deliberately
  do not pre-empt it.
- **Street clearance: checked, clean.** No two nodes share a cell edge;
  the minimum centre separation is √2 cells, so no pair of spec
  footprints can crowd a shared street. (The scaffold draws street
  strips centre-to-centre *through* node centres — a rendering-order
  fact about the scaffold, not a layout defect.)

## The D9 seam (named only — nothing built)

The dormant-kit decision stands: **not built** (D-9b ships; the D9 pack
recommends against producing D-9a). These specs fix base buildings only
and presume no integrity-driven variation. If the project owner ever approves
D-9a, variants attach exactly where `visual-plan/02` §5.4 puts them: as
separate dressing-layer GLBs (`bld_<name>_var_<state>.glb`) over the
shared base building — in spec terms, a layer dressing the base spec's
footprint and storeys, so the attach point is the whole base spec. The
five states the plan names are recorded in the JSON's
`dormantKitSeam`. Nothing else about the kit is specified here.

## Scaffold cross-check — the kit-build worklist

`build/visual/scene/scene.mjs` draws every non-plaza node as the same
6.4 × 6.4 box with a 1.5-wide door on its south face, over a radius-4.9
ground disc. Against these specs it disagrees as follows (expected —
the scaffold is placeholder geometry; nothing here edits it):

1. **Uniform footprint.** Every scaffold building is 6.4 × 6.4; specs
   call for 8 × 6 (Town Hall, Market Hall, College, Meridian Hall),
   6 × 4 (Library Annex, Workshop, Ledger Press), and 4 × 4 (both
   cottages). All nine buildings differ from their spec in plan.
2. **Door faces.** The scaffold puts every door on the south face.
   That agrees with spec for Town Hall, Market Hall, College, and Maple
   Cottage — and disagrees for **Library Annex (spec: east — the
   scaffold's south door faces no street at all), Public Workshop
   (west), Meridian Hall (west), Ledger Press (east), and Willow
   Cottage (west)**.
3. **PLOT_30 gets a building.** The scaffold builds its default labelled
   box on PLOT_30; the spec is an honest empty plot — no building. This
   is M4.14's exit gate ("a building or an honest empty-plot treatment;
   zero labelled boxes") in miniature.
4. **Plaza disc overflow.** The scaffold's plaza disc has radius 8.4
   (⌀ 16.8 units) against the spec's 10 × 10 cell of paving — it spills
   into every neighbouring cell. Its centrepiece is a pedestal + orb
   placeholder where the spec names Benny the Pug (CUSTOM, on a plinth).
5. **Door width.** Scaffold 1.5 units; spec 2.0 (one module). Door
   height agrees (2.2).
6. **Missing spec elements.** No stall apron at Market Hall, no parcels
   at Plots 18/31/30 (the radius-4.9 discs are ground blobs, not parcel
   geometry), no bell-tower element at Town Hall beyond the generic
   spire cone, and no sign anchors anywhere (M4.12's inputs).
7. **Heights are ungoverned, not contradicted.** The specs set no wall
   heights — no plan source states any — so the scaffold's per-building
   heights (7.5 Town Hall down to 3.6 cottages) neither agree nor
   disagree; they are placeholder numbers the kit build (M4.05/M4.14)
   will replace from the recipes. The one storey count the specs do
   state (College, 2) is not expressed by the scaffold's single box.
