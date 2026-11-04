# Elsewhere Portal — Engineering Wave 1 Contract

> **SUPERSEDED FOR LIVE USE (2026-11-03):** the live feed publishes
> `portal.world-data/v2` under `CONTRACT-V2.md` since the 2026-11-03
> feed switch (first v2 bundle seq 28; sequence continued from v1
> without a reset). This document remains the historical v1 contract —
> kept for the Wave 1 record and for any v1 bundle still in the
> archive's history. Do not build new live consumers against it.

Wave 1 = a thin end-to-end slice of plan phases P0 + P1 + P2-core + shell:
**live Tier P snapshots → pure WorldData → tick playback → a viewer page that
renders it.** Three arms build in parallel against this contract. The governing
documents are `../plan/02-technical-plan.md` (§§1–7, Appendix A) and
`../resources/RESOURCE-INVENTORY.md` (OSS-first: named donors, no new deps
without a licence note in the arm's STATUS.md).

## Tree

```
build/
  CONTRACT.md            (this file — single writer: Atlas)
  shared/                (schema + layout; owner: Engine arm creates, all read)
    ember-layout.json    staged Ember geometry over TRUE location codes
  data/                  (Arm A: poller, archiver, deriver, bundle CLI, tests)
    archive/             timestamped Tier P snapshots (real, from the live world)
    feed/                manifest.json + world-data.json (built bundles)
  engine/                (Arm B: playback core, pure ESM, browser+node compatible)
  app/                   (Arm C: static viewer shell, no build step in wave 1)
  fixtures/              (shared captured payloads + a demo journey)
```

## The bundle (Arm A produces, Arm C consumes)

`data/feed/manifest.json`:
```json
{ "bundleSeq": 1, "worlddataHash": "<sha256 of canonical world-data bytes>",
  "newestFetchUtc": "<ISO>", "schema": "portal.world-data/v1" }
```

`data/feed/world-data.json` — `portal.world-data/v1` (subset of Plan B §4.1):
```json
{ "schema": "portal.world-data/v1", "bundleSeq": 1,
  "newestFetchUtc": "<ISO>", "dataAgeSeconds": 0,
  "world": { "sky": null, "worldHour": null, "season": null, "year": null },
  "counters": { "regionsDiscovered": 0, "regionsSurveyed": 0, "regionsNamed": 0,
                "collegeDeposits": 0, "treasury": 0, "populationKnown": 0 },
  "ember": { "districts": [], "plots": [], "works": [] },
  "citizens": [ { "handle": "", "name": "", "placeCode": null,
                  "state": "unknown|present|travelling|talking|working|asleep",
                  "evidenceUtc": null, "provenance": {"route":"","fetchedUtc":""} } ],
  "ticker": [ { "utc": "", "kind": "", "text": "", "placeCode": null,
                "handles": [], "provenance": {"route":"","fetchedUtc":""} } ],
  "journeys": [] }
```
Derivation is PURE: same archive head ⇒ byte-identical canonical output
(Plan B §7.2). Every citizen/ticker item carries provenance (source route +
fetch time). Citizens with no evidence are roster rows with state `unknown` —
never diorama figures (Plan B §4.3).

## Layout (Arm B creates in shared/, Arms B+C consume)

`shared/ember-layout.json`: `{ "version": 1, "nodes": [ {"code": "<TRUE code>",
"label": "<plain words>", "x": 0, "y": 0, "kind": "room|plot|gate"} ],
"edges": [ {"a": "<code>", "b": "<code>", "seconds": 6} ] }` — grid coordinates
on a simple tile grid; must include at least: EMBER_PLAZA_OF_UNITY,
EMBER_COLLEGE, EMBER_TOWNHALL, Market Hall, Public Workshop, Library Annex,
EMBER_DISTRICT_3_PLOT_18 (Meridian Hall), EMBER_DISTRICT_1_PLOT_31 (Ledger
press), plus 2 generic homes. Staged geometry is disclosed as staging in the
app (About line) — never claimed as measured.

## Playback (Arm B, engine/playback.mjs — pure ESM, no DOM, no deps)

Exports at minimum:
- `planJourney({handle, path /*ordered place codes*/, startTick, ticksPerStep})`
  → a journey object with per-step tick schedule.
- `positionAt(journey, layout, tickFloat)` → `{code, x, y, between: [a,b]|null,
  frac}` — position is continuous along the layout route graph (A* over edges,
  deterministic tie-break N,E,S,W); NEVER a code change without traversing the
  connecting steps in order.
- `catchUp(journey, missedTicks)` → playback plan per Plan B §3: ≤6 missed steps
  walk at ≤2.5×; beyond → ordered replay ≤8× flagged `replay: true`; steps are
  compressed, never skipped or merged.
- The no-teleport invariant as an automated test (Plan B §7.3), INCLUDING a
  deliberately teleporting mutant implementation in the test file that the
  invariant check must CATCH (positive control — the suite fails if the mutant
  passes).

## App (Arm C, app/ — static, ES modules, no build step)

`index.html` loads `feed/world-data.json` (path configurable; falls back to
`../fixtures/sample-world-data.json`, a contract-shaped sample the App arm
authors) and renders:
- Top bar: badge derived from dataAgeSeconds (≤90 LIVE · else STALE · REPLAY
  while replaying) + the permanent caption "Elsewhere runs half a minute ahead
  of this page".
- Ember stage: canvas, isometric-style projection of the layout grid;
  evidenced citizens as labelled chibi dots (coloured circles + name chips are
  fine for wave 1 — art comes at P3); buildings as labelled blocks with
  integrity tier colouring (Plan B §4.3 bands).
- Ticker (from bundle ticker[]), Citizens roster (all rows; Follow button on
  evidenced citizens), citizen card (facts + provenance), Growth counters panel,
  About line disclosing staged streets.
- Follow + demo journey: a "Play demo journey" control runs the fixture journey
  (Atlas: Library Annex → Plaza → College) through engine/playback.mjs in the
  browser; the followed figure walks every step; camera keeps it in view.
- Every rendered claim shows provenance on click (route + fetchedUtc).

## Rules for all arms

- Node stdlib only for data/engine (no npm installs in wave 1); app is vanilla
  ES modules. Any exception: name it + its licence in your STATUS.md.
- Tests: `node --test` suites in your directory, all passing, and your STATUS.md
  records the exact commands + results (Atlas will re-run them — a suite that
  only passed on your say-so is not done).
- Tier P routes are exactly Paper 01 §9.2's public routes
  (`https://world.elsewhereagents.com/public/<route>.json` — overview, news,
  voices, map, status, chats as available). Never invent an endpoint; if a route
  errors, record it and continue with the rest.
- Write only inside your own directory (+ shared/ for Arm B's layout, +
  fixtures/ for captured payloads you trim and name clearly). Never edit
  CONTRACT.md, another arm's files, focus.md, or MEMORY.md.
- STATUS.md in your directory: what you built, file list, test commands/results,
  honest gaps, and anything the integrator must know.
