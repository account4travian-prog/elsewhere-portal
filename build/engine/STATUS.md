# Engine Arm (Arm B) — STATUS

Wave 1 deliverables: the staged Ember layout, a deterministic A*, and the
tick playback core (planJourney / positionAt / catchUp) with the Plan B
§7.3 no-teleport invariant as an automated test **including its positive
control**. All tests pass on the coordinator's Node (v24.22.1).

## Files

| File | What |
|---|---|
| `../shared/ember-layout.json` | Staged Ember street graph over TRUE place codes (10 nodes, 14 edges) |
| `astar.mjs` | Deterministic A* over the layout (compass tie-break N,E,S,W) |
| `playback.mjs` | planJourney / positionAt / catchUp / journeyRoute + constants |
| `test/astar.test.mjs` | 6 tests: layout sanity/connectivity, route validity, known route, determinism, trivial path, null cases |
| `test/playback.test.mjs` | 12 tests: schedule math, positionAt semantics, near-reach disclosure, catch-up thresholds/flags/floor, §3.4 absence axis + path-summary mode (VER-D01 fix, 2026-11-02) |
| `test/no-teleport.test.mjs` | 2 tests: the §7.3 invariant over 5 journeys + the positive-control mutant |
| `../fixtures/demo-journey.json` | Atlas: LIBRARY_ANNEX → EMBER_PLAZA_OF_UNITY → EMBER_COLLEGE, startTick 1000, ticksPerStep [2, 2] |
| `STATUS.md` | This file |

No dependencies. Pure ESM; `astar.mjs`/`playback.mjs` import nothing except
each other (no `node:` imports — browser-compatible as contracted).

## Tests — exact commands and results

Run from `build/engine/`:

```
node --test test/astar.test.mjs        → tests 6,  pass 6,  fail 0
node --test test/playback.test.mjs     → tests 12, pass 12, fail 0
node --test test/no-teleport.test.mjs  → tests 2,  pass 2,  fail 0
node --test test/*.test.mjs            → tests 20, pass 20, fail 0
```

VER-D01 fix (2026-11-02): engine suite 20/20 as above; the App suite
(`build/app`: `node --test test/*.test.mjs`) also re-run against the
changed engine — tests 21, pass 21, fail 0, unmodified.

⚠️ `node --test test/` (directory form) fails on this VM's Node v24
("Cannot find module …/test") — use the file glob or per-file form above.

Positive control: `no-teleport.test.mjs` contains `mutantPositionAt`, which
teleports (origin until mid-journey, then the destination instantly). The
suite asserts `checkContinuity` rejects it on every timed journey (it flags
the route-distance discontinuity, the early arrival, and the skipped
intermediate place). If the mutant ever passes, the suite fails — the gate
is proven, not asserted.

## Exported signatures (as actually exported)

`astar.mjs`:
- `nodeByCode(layout, code)` → node object | `undefined`
- `findPath(layout, fromCode, toCode)` → `{path: [code…], cost}` |
  `{path: [fromCode], cost: 0}` (same place) | `null` (unknown code / no route)
- `findRoute(layout, fromCode, toCode)` → `{codes, legs: [{a, b, seconds,
  distance}], totalSeconds, totalDistance}` | `null`

`playback.mjs`:
- Constants: `TICK_SECONDS = 30`, `CATCH_UP_MAX_STEPS = 6`,
  `CATCH_UP_SPEED = 2.5`, `REPLAY_SPEED = 8`,
  `SUMMARY_ABSENCE_TICKS = 120` (1 h), `MIN_SHOWN_SECONDS = 1`
- `planJourney({handle, path, startTick, ticksPerStep})` → journey
  `{handle, path, startTick, endTick, totalWorldTicks, steps}`; each step
  `{index, from, to, worldTicks, nearReach, startTick, endTick,
  shownSeconds}`. `ticksPerStep` is a non-negative integer or an array with
  one entry per step; invalid input throws `TypeError`.
- `positionAt(journey, layout, tickFloat)` → `{code, x, y,
  between: [a, b] | null, frac}`. While walking, `code` is the node most
  recently departed and `between`/`frac` give the leg and progress along
  it; at a node, `between` is `null` and `frac` is 0. A step's destination
  is reached only at its scheduled `endTick`; a 0-tick leg completes
  exactly at its boundary tick.
- `catchUp(journey, missedTicks, options?)` → `{mode:
  'none'|'catch-up'|'replay'|'path-summary', speed, replay, missedTicks,
  absenceTicks, steps, totalShownSeconds, arrivalTick}` (path-summary
  plans additionally carry `summarySteps`). Implements Plan B §3.4 on
  BOTH of its axes (VER-D01 fix, 2026-11-02):
  - *Missed-step axis:* `missedTicks` counts world ticks of this journey
    that elapsed unplayed, measured from `journey.startTick`; every step
    beginning inside that window is a missed step. 1–6 missed steps ⇒
    `mode: 'catch-up'`, speed 2.5; >6 ⇒ `mode: 'replay'`, `replay: true`,
    speed 8. Catch-up/replay plans return every missed step, in order —
    compressed, never skipped or merged. Near-reach steps keep
    `shownSeconds = MIN_SHOWN_SECONDS` even under compression.
  - *Absence axis:* `options.absenceTicks` is the visitor's absence in
    world ticks; it defaults to `missedTicks` (the unplayed window is the
    absence under the wave-1 calling convention — existing 2-arg callers
    are unaffected). Absence > `SUMMARY_ABSENCE_TICKS` (120 ticks = 1 h)
    with ≥1 missed step ⇒ `mode: 'path-summary'`: `steps` is empty,
    `totalShownSeconds` 0, nothing is replayed at any speed; the missed
    steps' scheduled facts are returned as `summarySteps` (1×
    `shownSeconds`, listed not played) for the "while you were away" list,
    and the polyline is `journeyRoute(journey, layout)`. Exactly 120
    ticks is still ≤ 1 h (replay/catch-up per the step axis). No missed
    steps ⇒ `'none'` however long the absence.
  `arrivalTick` is always the journey's scheduled `endTick` (never beaten).
- `journeyRoute(journey, layout)` → concatenated legs
  `[{a, b, seconds, distance, stepIndex}]` in traversal order (for drawing
  the walked path).

## Integrator notes (App arm)

- Load the layout once from `../shared/ember-layout.json`; pass the parsed
  object to `positionAt` / `journeyRoute` every frame — routes are cached
  per (journey, layout) pair, so keep both object identities stable.
- The demo fixture is a ready `planJourney` input: pass its
  `handle`/`path`/`startTick`/`ticksPerStep` fields verbatim.
- Playback clock: advance `tickFloat` at 1 tick per 30 s of wall time for
  1× (interpolate freely *inside* a tick — `positionAt` is continuous).
  For catch-up/replay, use `catchUp`'s per-step `shownSeconds` as the
  wall-clock budget per step; set the REPLAY badge from its `replay` flag.
  **New (VER-D01 fix): branch on `mode: 'path-summary'`** — present the
  travelled-path summary (`journeyRoute` polyline + the plan's
  `summarySteps` as the "while you were away" list) and place the figure
  at its evidenced place; do NOT step-replay. The wave-1 demo caller does
  not branch yet: it reads only `speed`/`replay`, so a summary plan reads
  as speed 1 / no badge — safe, but the summary presentation itself is
  App-arm work. Callers that track visitor absence separately from a
  journey's unplayed window should pass `{absenceTicks}` explicitly.
- `positionAt` throws on an unknown place code or a step with no route in
  the layout — feed it only journeys whose codes are layout nodes.

## Layout code provenance

- `EMBER_COLLEGE` — in `~/workspace/elsewhere/reference/openapi.json`.
- `MARKET_HALL`, `PUBLIC_WORKSHOP`, `LIBRARY_ANNEX` — the openapi `Work`
  enum (civic works), also the place codes used throughout the household's
  observed Elsewhere record.
- `EMBER_PLAZA_OF_UNITY`, `EMBER_TOWNHALL`, `EMBER_DISTRICT_3_PLOT_18`
  (Meridian Hall), `EMBER_DISTRICT_1_PLOT_31` (Ember Ledger Press) —
  attested in the household's observed record (`~/workspace/elsewhere/*.md`).
- The two homes (`EMBER_HOME_MAPLE_COTTAGE`, `EMBER_HOME_WILLOW_COTTAGE`)
  have **no verified true code**; they carry `"codeStatus": "staging"` in
  the layout (all other nodes carry `"verified"`). Grid positions and edge
  seconds are Portal staging throughout, disclosed in the layout's `note`.

## Contract deviations

None against CONTRACT.md. Semantics the contract left open, decided and
documented in code: (1) `catchUp`'s missed window is measured from
`journey.startTick` (wave-1 callers play journeys from their start);
(2) within a step, time is distributed across route legs in proportion to
each leg's presentation `seconds`, so a position is always exactly on one
leg or at a node; (3) VER-D01 reconciliation (2026-11-02): §3.4's mode
table is two-axis — the App arm had read the 500-missed-tick demo case as
owed `replay: true`, the engine had implemented the step axis only. As
implemented, 500 ticks is an absence over 1 h, so §3.4's own text gives
the path summary there, not a replay; `replay: true` is owed (and now
returned) on the step axis — >6 missed steps at absence ≤ 1 h. VER-D01's
substance (the mode saturated at 'catch-up'; the absence axis and the
summary mode were missing) is fixed; the one-word expectation in the
App arm's friction #3 is superseded by §3.4's table. `absenceTicks`
defaults to `missedTicks`, and a journey with no missed steps returns
'none' at any absence (nothing of it to summarise).

## M3.04 — conflicts.mjs: place-conflict HOLD, watchdog, exits/entries (2026-11-02)

`conflicts.mjs` implements Plan B §3.5's stuck-actor table (SE-2.5)
as pure engine semantics; the App arm holds the presentation models.

- `createPlacementTracker` / `applyPlacement` / `trackerCitizen`:
  a stream machine over placement observations {key, placeCode,
  evidenceUtc, bundleSeq}. Same-tick-window (30 s) contradictory
  places set the `place-conflict` HOLD: `shown` reverts to the last
  unconflicted placement, the conflict (both claims + stamps) is
  surfaced, and only a single placement from a later window lifts
  it. Place → unknown emits a staging-flagged `exit`, unknown →
  place an `entry`; a citizen's first observation initialises
  silently. Every event carries `staging` + `disclosure` (§7.3
  asserts the flag).
- `assessJourney` / `assessedPosition` / `watchdogDeadline`: the
  §3.5 watchdog. Deadline = startTick + 2 × totalWorldTicks + 6.
  Arrival evidence completes; origin evidence builds a return
  journey from the figure's next node (Paper 02 §2.3 cancellation)
  and lets catchUp's absence axis choose return-walk vs
  return-summary; past deadline with no newer word → `paused` with
  caption "on the way to {B} — Portal has no newer word" and a
  frozenTick — `assessedPosition` of a paused journey is identical
  at any later nowTick (never a snap).
- Tests: test/conflicts.test.mjs (16) — HOLD set/widen/lift,
  exit/entry flags, the §7.4 adversarial stream (shown place
  changes only on scheduled events), watchdog deadline/caption/
  frozen position/return walk/return summary. Suite at landing:
  engine 49/49 (incl. the M3.01 arm's concurrently landed
  no-teleport-reconstructed tests).
