# App Arm (Arm C) — STATUS

Wave 1 viewer shell: static, vanilla ES modules, **no build step, no external
dependencies at all** (no CDN, no webfonts — system font stack only). It runs
offline from a local static server apart from the fetches it makes to its own
origin for the bundle/layout/engine files.

## Files

| File | What it is |
|---|---|
| `index.html` | Page: top bar (badge + permanent caption), Ember stage canvas, citizen card, ticker, Citizens roster, Growth counters, About with the staging disclosure |
| `app.js` | Loading chain, panels, canvas stage (isometric-style projection, view-fit + follow camera), Follow, demo journey playback, provenance on click |
| `logic.mjs` | Pure logic, shared by page and tests: badge derivation, integrity→tier (Plan B §4.3), bundle fallback selection, evidenced/captions/presence wording, node resolution, identity colours |
| `local-playback.mjs` | **DELETED at E1 (M2.03)** — the wave-1 stand-in for Arm B's engine. app.js imports `../engine/playback.mjs` directly now (see the E1 update below) |
| `fixtures/sample-world-data.json` | Contract-shaped sample bundle authored by this arm: 6 citizens (Atlas Meridian working at the Library Annex; two talking at the Plaza; one working at the Workshop; one asleep; one unknown), 5 ticker items with provenance, counters, 3 works at integrity 100 / 64 / 29 (three different tier bands) |
| `test/logic.test.mjs` | `node --test` suite for the pure logic (badge, tiers, fallback selection, captions, node resolution) + the stand-in engine's no-jump continuity and catch-up rules |
| `styles.css` | Bright pastel, rounded panels, plain-word labels; Fredoka/Nunito-*like* system stack (no downloads) |

## How to run

Serve the **build/** directory (not app/ alone — the app fetches
`../data/…`, `../shared/…`, `../engine/…` relative to build/):

```
python3 -m http.server 8000 --directory ~/workspace/elsewhere-portal/build
# open http://localhost:8000/app/
```

## Tests — commands and results (re-run by the integrator)

```
cd ~/workspace/elsewhere-portal/build/app
node --test test/logic.test.mjs     → 18 pass / 0 fail
node --check app.js                 → OK
```
Note: `node --test test/` (directory form) fails on this VM's Node v24 —
use the file path, same as the Office scene arm found.

HTTP smoke test (server on build/): `app/`, `app/app.js`, `app/logic.mjs`,
`app/local-playback.mjs`, `app/styles.css`, `app/fixtures/sample-world-data.json`
all 200.

## Integration — verified live during this build

The other arms landed while this arm was being written; the app was checked
against the **real** files, not just the contract:

- **Real bundle** (`../data/feed/world-data.json`, Arm A): loads as primary;
  badge derives **LIVE** (dataAgeSeconds was 37 at check time). Frontier-place
  citizens (e.g. placeCode `STELLAR_W10_S31`) correctly get roster rows but no
  Ember figure; unknown citizens likewise. Works in the real bundle carry
  `integrity: null` → tier "none" (no health shown — the honest tier, Plan B
  §4.3), and their codes match layout codes directly.
- **Real layout** (`../shared/ember-layout.json`, Arm B): node codes differ
  from this arm's guesses (`LIBRARY_ANNEX`, `MARKET_HALL`, `PUBLIC_WORKSHOP`
  vs my `EMBER_…` forms). The app resolves fixture/bundle codes against the
  loaded layout by exact code **then by label**, so both the real bundle and
  this arm's sample fixture place correctly against the real layout (verified
  in node: Atlas → Library Annex, works → their nodes). The view auto-fits to
  whatever grid the layout uses.
- **Real engine** (`../engine/playback.mjs`): exports the contract signatures;
  the app detects and uses it, stand-in unused. The shared demo fixture
  (`../fixtures/demo-journey.json`) was run through it in node with the real
  layout: Library Annex → Plaza → College, startTick 1000 → endTick 1004,
  positions continuous (max step 0.14 grid units per 0.1 tick — no jumps),
  settling exactly on the College node at endTick.
- **Demo journey in the app**: "Play demo journey" prefers
  `../fixtures/demo-journey.json`; otherwise a built-in copy (Library Annex →
  Plaza → College). The fixture's `ticksPerStep` is a per-step **array** —
  passed verbatim to the real engine; reduced to its first element for the
  stand-in. Playback starts at the journey's own `startTick`. During playback
  the figure walks every step, the camera follows, the follow bar captions
  ("Atlas Meridian is walking to the College."), the badge shows REPLAY while
  a catch-up plan with `replay: true` is active, and **when the demo ends the
  figure stays at its playback position** — it does not snap back to the
  bundle place (that would be a teleport).

## Stand-ins vs real

- **Citizen figures are wave-1 stand-ins**: coloured circles + name chips on
  canvas (contract explicitly allows; real chibi figures are the P3 art pass).
- **Buildings** are labelled pastel blocks; colour comes from the integrity
  tier of the matching work where the bundle carries one.
- **Demo speed**: playback advances 2 ticks/second so a journey is watchable;
  the world tick is 30 s — demo pacing is a presentation choice, disclosed
  here, and journey *routes/steps* are never altered.
- **Asleep citizens with a placeCode are drawn as dots** at that place (the
  deriver placed them); their captions/roster lines say asleep/away in plain
  words. If the integrator wants asleep figures hidden from the stage, that
  is a one-line change in `citizenPositions()` — flagged, not silently decided.
- Interiors (S2), frontier map (S5), Chronicle (S7), calendar (S8), portrait
  strip, and camera chips are **not** in wave 1's shell; the single stage +
  panels are the thin slice the contract asked for.

## Contract friction (reported, not silently deviated from)

1. CONTRACT.md says the app fallback is `../fixtures/sample-world-data.json`;
   this arm's brief specified the sample fixture **in the app directory**.
   The loader tries, in order: `../data/feed/world-data.json` →
   `../fixtures/sample-world-data.json` → `fixtures/sample-world-data.json`
   (app dir, the authored sample). Both contract and brief are satisfied.
2. The contract's layout section lists node codes with mixed forms
   (EMBER_PLAZA_OF_UNITY but "Market Hall"); Arm B's actual codes differ from
   both. Label-based resolution (above) absorbs it, but the integrator may
   want the contract's code list made exact for wave 2.
3. The real engine's `catchUp` returns `mode: 'catch-up'` and never flags
   `replay: true` for this 2-step journey even at 500 missed ticks (its
   shown-seconds model differs from Plan B §3's step-count rule as this arm
   read it). The app only consumes `speed`/`replay`, so behaviour is safe;
   flagged for Arm B / integrator reconciliation.

## E1 update — M2.03 keying + stand-in retirement, 2026-11-02

- **The app keys everything by the PORTAL-KEY** (`citizenKey`): stage
  positions (new pure `citizenPositions` in logic.mjs), roster, follow,
  cards, colours, click hits. Two records sharing `handle: ""` can no
  longer collapse — regression-tested in `test/logic.test.mjs`.
- **Deleted:** `local-playback.mjs` (the stand-in engine) and app.js's
  built-in `FALLBACK_LAYOUT` (invented codes `EMBER_LIBRARY_ANNEX`,
  `EMBER_HOME_1/2`, ...). app.js now imports `../engine/playback.mjs`
  directly and the shared layout is the only layout; if it cannot be
  read, the stage honestly shows no streets.
- The sample fixture now mirrors real deriver output: `handle: ""`,
  `citizenKey` PORTAL-KEYs, real place codes (`LIBRARY_ANNEX`,
  `PUBLIC_WORKSHOP`), `firstSeenUtc`, `citizenCollisions: []`; ticker
  citizen references carry PORTAL-KEYs.
- `node --test test/logic.test.mjs` → 21 pass / 0 fail (playback tests
  now run against the real engine, incl. its catch-up semantics);
  `node --check app.js` OK. Node-level smoke against the live bundle +
  shared layout: 13 evidenced citizens placed at 13 distinct positions
  (2 more evidenced citizens sit at `EMBER_DISTRICT_1_PLOT_30`, a real
  code with no layout node — placed since M2.06 by the sorted-code fill
  in `logic.effectiveLayout`, which derives a staging node from the
  bundle's evidenced plot entry, no layout edit); the demo journey
  walks Library Annex → Plaza → College through the real engine,
  max step 0.141 grid units per 0.1 tick (no jumps).

## Presentation follow-up — path summary + deterministic counts, 2026-11-02

- **Path-summary presentation (Plan B §3.4)**: when the followed demo
  journey's `catchUp` plan is `mode: 'path-summary'` (absence > 1 h),
  the app no longer animates any step of the summarised span. The frame
  loop places the figure at its evidenced place (`plan.arrivalTick` —
  the journey's end), stops playback, draws the journey's route
  (`journeyRoute`, dashed violet polyline) on the stage, and shows the
  **"While you were away"** panel (`#away-panel`): an intro stating the
  missed world time and that the journey is listed from the record
  instead of played back, an ordered list of the `summarySteps`
  (from/to place labels + each step's world-time span; a near-reach
  step discloses that the world charges it no time), and a closing
  line naming the place the record ends at. Pure model in logic.mjs:
  `summaryPanel` / `summaryStepLine` / `worldDuration` /
  `planPresentation`. Copy follows the §3.4 wording and the design
  plan's plain-words honesty classes.
- **Replay badge**: the frame loop now derives replay state through
  `planPresentation(plan).showReplayBadge` (mode 'replay' + the
  engine's `replay: true`); `badgeFor` shows REPLAY while it plays —
  tested at the logic level against a real 7-step replay plan.
  Catch-up and 'none' behaviour unchanged.
- **Determinism nit fixed**: the Growth panel used
  `v.toLocaleString('en-US')`, whose output depends on the host's
  locale/ICU data. It now uses logic.mjs `formatCount` — a fixed
  thousands-grouping formatter, identical on every runtime.
- **Tests**: `node --test test/logic.test.mjs` → **33 pass / 0 fail**
  (27 before; +6: formatCount values 0/999/1000/1234567 + signs,
  worldDuration, path-summary plan lists steps with an empty playback
  queue and the figure at the journey's end, summaryPanel null for
  playing plans, near-reach disclosure, replay badge state).
  `node --check app.js` / `logic.mjs` OK. Engine suite re-run: 20/20.
  Data suite re-run: 75/75.
- **Screenshot: NOT captured.** The serving + long-journey-fixture +
  CDP-driver route was built and the page served locally (all 200s),
  but this VM's Chromium (`/opt/meta-chromium/chrome`) refuses bare
  launches ("Hatch WebGL domain policy is required for browser
  startup") — it starts only under the runtime's browser broker,
  which a subagent cannot drive. Left for the coordinator's browser
  route; the summary state is covered by the logic tests above in the
  meantime.

## M3.08 — fuzzy resolveNode deleted (2026-11-02)

- `logic.mjs`: `resolveNode` (exact match, then label/keyword fuzzy
  fallback) is deleted outright. The only resolver is `resolveExactNode`
  — strict code equality. The stale doc comment that cited the invented
  `EMBER_MARKET_HALL` spelling as a tolerated input is gone with it, and
  the `citizenPositions` comment no longer references the dead fallback.
- Caller audit (every `resolveNode` use in `build/app`):
  - `app.js` `placeLabel` → `resolveExactNode`; an unresolvable code
    falls back to the code itself in plain words, never a guessed node.
  - `app.js` stage render (building→work match) → `works.get(node.code)`,
    exact code equality via the works map.
  - `app.js` click handler (building card) → `resolveExactNode` in the
    works find.
  - Import updated; no `resolveNode` reference remains in app code.
- Tests: the fuzzy-behaviour test is replaced by an exact-only test, and
  a negative control is added against the real shared layout: the
  near-miss `EMBER_MARKET_HAL` and the VER-D07 survivor string
  `EMBER_MARKET_HALL` both resolve to null (real code: `MARKET_HALL`),
  and citizens carrying either code get NO position (roster-only).
- Suites: app 34/34, engine 20/20, data 85/85.

## V2 adoption (2026-11-02, M2.11 follow-on)

- `logic.isBundle` accepts `portal.world-data/v1` and the frozen
  `portal.world-data/v2` (`BUNDLE_SCHEMAS`); a v3 or unknown schema is
  rejected, never half-read. v1 behaviour unchanged — the live feed
  still serves v1, so the later feed switch is a non-event.
- `citizenBindingWording`: citizenIdStatus in plain words on the
  roster and citizen card (v2 only; absent on v1, the line doesn't
  appear). BOUND shows the citizenId itself as the profile label —
  no evidenced URL exists, so it is never dressed up as a link.
- Conversations: `conversationsSource` prefers the v2 bundle's own
  episodes/actSequences; the sidecar feed is the fallback carrier and
  remains the words source — bundle episodes are §1.4 summaries with
  no utterances, so `resolveTalkEpisode` borrows the feed twin's
  recorded words (same place + opening stamp). A row promises
  playback only when the words resolve.
- `workTier(bundle, code)` is the single tier path for card + stage;
  its only input is the work's own integrity field.
  `world.integritySource` is never read as data — pinned by test
  with numeric values in both directions.
- Tests: app 50/50 (logic 34, episodes 8, new v2-adoption 8 — the
  last builds a real v2 bundle + same-head feed from the archive in
  temp dirs and asserts Hark M2 condition (c) from the bundle path).

## M2.15 escaping fix (2026-11-02)

- The SE-6.1 injection defect is closed: bundle text is untrusted
  public-feed data, and the five innerHTML sites that interpolated it
  (citizen card, building card, ticker card, ticker list, roster) now
  assign strings built in logic.mjs (citizenCardHtml /
  buildingCardHtml / tickerCardHtml / tickerListHtml /
  rosterListHtml), where every feed-derived interpolation — names,
  captions, news text, raw stamps, BOUND citizenIds, provenance
  route/fetchedUtc, and the data-follow key in attribute context —
  passes the single `escapeHtml` helper. The sixth site (Growth
  panel) interpolates only hardcoded keys and formatCount numbers
  and stays in app.js, documented as trusted-static.
- Recorded utterances are untouched by this: the talk path carries
  them verbatim in the model and renders via textContent, and
  escapeHtml is the identity on text without markup characters, so
  benign rendering is byte-for-byte as before (fence markers show as
  characters, exactly as recorded).
- Positive control: test/escaping.test.mjs (6 tests) — a citizen
  named `<img src=x onerror=alert(1)>` with an attribute-breaking
  key, a `<svg>` citizenId and a `<script>` provenance route, plus an
  utterance carrying `</div><script>alert(2)</script>`, all render as
  inert escaped text creating no element; a census pin asserts every
  innerHTML assignment in app.js is a logic builder or the growth
  rows. Suites: app 56/56 (logic 34, episodes 8, v2-adoption 8,
  escaping 6).

## M3.09 + M3.10 — app safety + demo-as-recording (2026-11-02)

- M3.09 frame-loop guard: frame() re-arms requestAnimationFrame
  BEFORE the body runs, so no throw can kill the loop; the body runs
  through logic.guardedFrameStep (tick/render phases — the render
  runs even when the tick threw, so the stage keeps its last good
  picture), which counts consecutive failures on a guard object. At
  3 in a row the frame is stalled and updateBadge passes
  badgeFor's `stalled` input: the badge reads STALE ("The stage has
  stopped updating — showing the last picture Portal could draw.")
  however fresh the data, outranking REPLAY too. Failures are logged
  to the console with their count; a clean frame resets the count
  and the badge recovers.
- M3.09 explicit clock (debt 04·D-12): logic.mjs holds the app's one
  clock — nowMs() with installClock/resetClock for tests. Badge age
  and relativeTime read it; app.js carries no Date.now at all, and
  logic.mjs's only Date.now mentions live inside the clock section
  (census-pinned).
- M3.10 demo honesty (Design H6): the button reads "▶ Play the demo
  journey (a recording)"; while a demo journey is on stage the badge
  reads REPLAY for its whole duration (previously only when a
  catchUp plan flagged replay mid-demo); and a dedicated caption
  element (#recording-note, under the stage) shows "● RECORDING —
  A recording from Portal's test data" for the demo, and "●
  RECORDING — Sample data — a recording from Portal's test data,
  not the live town" whenever sample data drives the stage — present
  iff a recording does, from logic.recordingNotice. The demo's
  ending still follows the catch-up rule (unchanged).
- Tests: test/app-safety.test.mjs (9 tests) — clock pinning
  (relativeTime follows the pinned clock), the guard against the
  REAL engine (positionAt throws on a not-yet-known place code:
  caught, render still runs, next frame recovers; persistent throws
  stall and badge STALE on age-0 data), render-throw counting,
  source censuses (re-arm order, Date.now, button label, caption
  wiring), and the recording notice's iff. Suites: app 65/65
  (logic 34, episodes 8, v2-adoption 8, escaping 6, app-safety 9).

## M3.07 — amended close: stand-in retired, fallback bannered (2026-11-02)

- The conflict: M3.07's letter makes the sample fixture tests-only,
  "never a page fallback"; M4.03 / Design H4 keeps the local-dev
  fallback chain alive under a persistent "SAMPLE DATA — not the
  live town" banner with a non-LIVE badge. The shipped app followed
  neither exactly (fallback live under a STALE badge, no banner).
  Coordinator ruling (AUTO-DECISIONS.md, reversible): H4 wins — the
  fallback survives, bannered; M3.07 closes in this amended form.
- Stand-in half (substance done at E1 / M2.03): the stand-in engine
  file is deleted and app.js imports ../engine/playback.mjs
  directly. The item's literal exit gate — a grep for the retired
  module's name over build/app — now passes over a DEFINED SOURCE
  SCOPE (test/sample-banner.test.mjs): every .js / .mjs / .html /
  .css / .json file under build/app (shell, logic, tests, markup,
  styles, fixtures). The last live-code hit, the app.js header
  comment, is reworded; the only remaining hits are this file's
  dated entries above. STATUS.md is deliberately out of scope: it
  is the historical record, and entries naming the deleted file are
  history, not references — rewriting them would falsify the record.
- Banner: a dedicated #sample-banner element sits above the stage
  canvas in the stage panel and shows Design H4's words — "SAMPLE
  DATA — not the live town" — the whole time a fallback bundle
  drives the app, from logic.sampleBanner (visible iff
  selectBundle's pick isFallback AND a bundle exists). Separate
  layers, all three honest at once: the badge (sample is STALE,
  never LIVE, as before), the M3.10 recording caption ("● RECORDING
  — Sample data — …"), and now the banner. Live data: none of the
  sample signals, ever; nothing loaded: no banner (the page shows
  its honest error instead).
- Banner-or-nothing pin: censuses in test/sample-banner.test.mjs —
  app.js touches #sample-banner in exactly one function
  (renderSampleBanner), consults the model exactly once, and
  updateBadge renders banner + notice together; loadAll calls
  updateBadge after the pick is stored, so every load outcome
  passes the banner decision with the pick in state. Composition
  tests cover all selectBundle outcomes, incl. demo-over-sample
  (demo caption AND banner) and demo-over-live (caption only).
- Tests: test/sample-banner.test.mjs (9 tests) — model iff, H4
  wording, composition, page placement/hidden census,
  banner-or-nothing census, scoped grep gate. Suites: app 74/74
  (logic 34, episodes 8, v2-adoption 8, escaping 6, app-safety 9,
  sample-banner 9).

## M3.04 — place-conflict HOLD + labelled exits/entries (2026-11-02)

Plan B §3.5's stuck-actor table (SE-2.5), presentation layer, built
against bundle citizen placements (the M3.01 journeys artefact had
not landed when this arm ran; no data-layer files were touched).

- The semantics live in the engine (`../engine/conflicts.mjs`): a
  placement tracker over successive live bundles. Two placements of
  one citizen in one tick window naming different places set the
  `place-conflict` HOLD — the figure stays at its last unconflicted
  place; walking resumes only on an unconflicted later place. The
  frozen v2 bundle carries one placement per citizen, so the flag
  is computed here from the bundle stream, not read from a field.
- App wiring (`logic.mjs` models + `app.js`): `currentPositions`
  now uses `heldCitizenPositions` (conflicted citizens held, absent
  citizens undrawn); the citizen card (inspector) shows the
  conflict in full — both claims with evidence stamps, the held
  place, the disclosure (`conflictModel`/`conflictHtml`); ticker
  gains Movement lines for exits/entries/conflicts above the news
  (`placementEventLines`, inside the existing `tickerListHtml`
  builder — the M2.15 census still counts exactly 6 pinned
  assignments); the roster labels exited citizens "Out of the
  record right now — the record stopped placing them. That is not
  the same as leaving the town." and conflicted ones as held.
  Exit/entry events carry `staging: true` + their disclosure —
  §7.3 asserts the flag, and the tests do. `exitStagingFor` answers
  walk-to-first-street vs fade for an isolated place.
- The tracker consumes live bundles only: sample/fallback data is
  a recording and is never fed to it.
- The journey watchdog (`assessJourney`) is engine-side, ready for
  M3.06's live playback: deadline = start + 2× interval + 6 ticks;
  paused = performance tick frozen (position identical at any later
  nowTick); origin evidence → return walk (short absence) or path
  summary (> 1 h), via catchUp's §3.4 axis unchanged; a contradicted
  performance cancels at its next node (Paper 02 §2.3). The app
  exposes its caption via `watchdogLine` (§3.5's copy with the
  place label).
- Tests: app/test/placement-hold.test.mjs (10) + engine
  test/conflicts.test.mjs (16). Suites at landing: app 84/84,
  engine 49/49 (engine total includes the M3.01 arm's concurrently
  landed reconstructed-journey tests).

## M3.06 — live-pace playback (2026-11-02)

- Live pacing lives in a new pure module, `app/live-pacing.mjs`
  (logic.mjs untouched): the world clock over the journeys
  artefact's own grid (tickEpochUtc, tickSeconds disclosed in the
  feed), 1 tick per 30 real seconds at 1× — the rate is the
  engine's TICK_SECONDS imported, never re-typed. A figure's
  position is positionAt at the world tick: continuous in world
  time, so a journeyed citizen never jumps when a bundle lands.
- Acceleration exists only as §3.4 catchUp plans (the named
  pass-through `accelerationPlan`: 2.5× catch-up, 8× replay,
  path-summary past an hour). No speed multiplier exists in live
  mode; the demo's DEMO_TICK_RATE stays quarantined in the demo
  handler (code-level pin in the tests). Speed changes shown time
  only — departureTick/arrivalTick are the record's, and arrival
  is never shown before arrivalTick (swept in the harness).
- Engine journeys are built exactly as the invariant suite builds
  them (one step across the evidence window), so the scheduled
  arrival IS the record's arrivalTick. M3.01's documented mapping
  is consumed as documented: a plan's `to` is the arrival node,
  `arrivalTick` its moment ('arrival-node' beats perform at `to`,
  reached at `arrivalTick`). M3.04 composition: citizens under a
  standing place-conflict are never walked (heldKeys), citizens
  the stage doesn't show are not resurrected, off-graph legs are
  skipped not thrown, and a figure standing at the node its base
  position already shows keeps the base's fan offset. The M3.04
  watchdog (assessJourney) reads every reconstructed journey
  'complete' — pinned; it governs departure-staged performances,
  not this surface.
- Empty-feed honesty: the live record still reconstructs 0
  journeys, so the stage walks nobody. The stage carries a
  journeys note (`#journeys-note`, under the now-line) from
  `journeysNotice`: with journeys, the count + the feed's
  disclosure verbatim; empty, "No journeys reconstructed yet."
  plus the why in plain words from the feed's own stats (152
  utterances / 15 speakers / 27 candidates, all crossing
  unwatched stretches at first run). Shown only beside a live
  bundle; sample data is a recording and is never driven by the
  live record's journeys. A followed journeyed citizen's caption
  is schedule-only wording that names the walk a reconstruction.
- Timed harness (the plan's exit-gate read): app/test/
  live-pacing.test.mjs, 19 tests — live rate exact, golden-window
  departure/arrival on their scheduled ticks, no early arrival,
  §7.3 continuity over the performed journey, near-reach boundary,
  speed/schedule separation, HOLD composition, watchdog pin.
  Suites at landing: app 103/103, engine 49/49.
- App wiring is additive only (one import block, two state
  fields, the journeys fetch beside the episodes fetch, one
  block in currentPositions, one caption branch in drawStage,
  renderJourneysNote, one element in index.html, one CSS rule);
  see the M3.06 arm report for the overlap flags.

## OM15-C2 — held figures render visibly held (2026-11-02)

- My Hark's OM-15 condition 2: a place-conflict HOLD was explained
  only in the citizen's card, while the figure stood on the stage
  looking like any placed citizen — and a viewer reads the map
  before the card. The treatment is now decided in one pure model,
  `logic.figureStyle(citizen, placement)`, consumed by both
  renderers: normal (opacity 1, nothing extra); asleep (opacity
  0.55 — the 3D scaffold's long-standing value, now one shared
  constant — faded only, no marks); held (opacity 0.5 + a dashed
  ring in the conflict amber #d9a441 + a ≠ marker overhead: the
  record's claims do not agree). Ring and marker are the meaning;
  opacity alone would be confusable with asleep, so held never
  relies on it. Precedence pinned: held beats asleep — the
  unsupported placement is the stronger signal; the asleep fact
  still stands in caption and card.
- 2D stage (app.js drawFigure): the figure body draws at the
  treatment's opacity; ring and marker draw at full opacity (a
  faded warning would defeat the marking); the followed ring
  steps out to r=20 when a held ring is present.
- 3D scene (visual/scene/scene.mjs): the same figureStyle behind a
  documented seam — buildWorld's { heldKeys } argument. Holds are
  a bundle-STREAM state (the M3.04 tracker compares successive
  bundles); the scaffold boots from one bundle, so no held set is
  derivable today and the seam is deliberately unpopulated. The
  treatment code (ghost opacity, dashed amber ground ring, ≠
  sprite) runs per citizen and simply never sees a hold yet; the
  boot line says so plainly.
- Tests: app/test/held-figure.test.mjs, 9 — the model against a
  real tracker driven to a genuine conflict (incl. an
  asleep-throughout stream that still conflicts), the
  cannot-be-confused-with-asleep pin, hold-lifts-with-resolution,
  and source censuses pinning both renderers to the shared model.
  Suites at landing: app 127/127 (the count includes OM15-C1's
  world-clock 15, landed concurrently), engine untouched.

## OM15-C4 — fenced speech (2026-11-02)

- My Hark's OM-15 condition 4: verbatim citizen words are untrusted
  record speech and must render fenced as such, as the world itself
  shows them — every recorded `said` arrives wrapped in the
  record's own fence markers (`<<ELSEWHERE_UNTRUSTED_…>>` …
  `<</ELSEWHERE_UNTRUSTED_…>>`), which the playback model already
  carried verbatim as characters. What was missing was the
  presentation fence: the words sat in a plain transcript bubble /
  a plain stage bubble, readable as Portal's own voice.
- Surface census (all of build/app): exactly TWO surfaces render
  verbatim utterances — (1) the Conversations panel transcript
  (`renderTalk`'s bubbles), (2) the stage canvas speech bubble
  (`drawSpeechBubble`, fed the current utterance in `drawStage`).
  No other utterance surface exists.
- One pure model, both surfaces (`logic.fencedSpeech`, the
  figureStyle split): returns the step's speaker and text
  byte-for-byte (fence markers, backticks, quotes — never inserted
  into, never stripped) plus the fence beside the text: label
  "Recorded words", quote glyph ❝, frame class `speech-fence`,
  colour `SPEECH_FENCE_COLOR` #e77fa2 (the stage bubble's
  long-standing stroke = styles.css `--accent`). Panel: bubble
  gains the frame (full accent border + heavy 8px left rail on a
  tinted ground) and a dashed "❝ Recorded words" tag beside the
  speaker's name; words still enter via textContent (M2.15
  untouched, no new HTML sink). Stage: the bubble gains a dashed
  outer frame in the fence colour and the same fence label above
  the speaker's name (bubble grows by the label line; word wrap,
  4-line canvas cap and elision unchanged). The fence composes
  with the episode disclosure header, which still heads the panel
  throughout playback — no disclosure string touched.
- Considered and NOT fenced, with reasons: news ticker text and
  ticker cards (the record's own chronicle lines, already labelled
  "Record" — not a citizen's quoted words) and recorded-act
  phrases (the deriver's act descriptions, under their own
  acts-only disclosure — acts, not speech).
- Tests: app/test/fenced-speech.test.mjs, 9 — the model (verbatim
  byte-for-byte incl. an utterance made entirely of fence-like
  characters, no-mutation, no-words-no-fence, shared constants)
  plus census pins (import pin; transcript slice must fence via
  the model with no direct `step.text` and no innerHTML; stage
  bubble slice must carry the dashed frame + label; exactly one
  utterance-text DOM sink in app.js; stylesheet carries the named
  frame). Positive controls run: reverting the transcript to
  `step.text` fails 2 census tests; deleting the stage's dashed
  frame fails 1; restored file hash-verified. Suites at landing:
  app 136/136 (127 before + 9 new), `node --check` OK on app.js
  and logic.mjs.

## 2026-11-02 (America/Chicago) — OM15-C3: record-scope wording (app + engine side)

The app/engine half of the C3 sweep (data half and contract Amendment
A2: see `build/data/STATUS.md`, same date; amendment text in
`build/CONTRACT-V2.md` §7 item 7). Scope phrase throughout: "the
public feeds Portal reads".

- **M3.04 conflict family:** `engine/conflicts.mjs` —
  CONFLICT_DISCLOSURE, EXIT_DISCLOSURE, ENTRY_DISCLOSURE reworded
  ("The public feeds Portal reads name two places…", "…stopped
  placing this citizen", "…name a place for this citizen again").
  App renderings of the same claims in `logic.mjs` (conflict card
  intro + claims line, roster conflict/absent lines, placement-event
  lines for exit/entry/conflict/resolved) and `app.js` (follow bar)
  reworded to match; placement-hold test pins updated to the new
  strings.
- **Integrity wording:** `logic.mjs` tier label "Repair not in the
  public record" → "Repair not in the public feeds Portal reads";
  building-card fallback "Its repair is not in the public record." →
  "…not in the public feeds Portal reads." (v2-adoption pin updated.)
- **Journeys note:** `live-pacing.mjs` journeysNotice — live headline
  and the empty-feed detail now scope to the public feeds Portal
  reads ("The public feeds Portal reads so far hold … utterances…",
  "Journeys will appear here as the public feeds Portal reads earn
  them…"). Stats fragments the tests pin are unchanged.
- **Remaining "public record" phrases:** badge LOADING detail and
  the index.html badge/now-line placeholders ("Reading the public
  feeds…"), presence wording ("from the public feeds Portal reads"),
  provenance line ("from the public feeds Portal reads (route …)"),
  growth note ("Counted from the public feeds Portal reads"), the
  load-failure line, and the nobody-present now line.
- **Suites:** app 136/136, engine 49/49, data 175/175 — all green
  after the sweep (baselines 136 / 49 / 174; the +1 is the new A2
  delta control in the data suite).
- **Deliberately left (bare "the record", Portal's own saved record —
  flagged for the VER re-check to rule on):** travelling caption
  "last place in the record", `relativeTime` and growth fallbacks
  "not in the record", path-summary "lists the journey from the
  record", "corroborated in the record", "No conversations in the
  record yet.", the "Conversations in the record" heading, and
  liveJourneyCaption "scheduled from the record". No literal "public
  record" remains anywhere in app/engine/data source (only the A2
  negative-control literals in the data tests and the historical
  GATHERING-EVIDENCE.md wording source).

---

## M4.03 + M4.19 (app half) — 2026-11-03, APP + BRIEFS lane

- **M4.03 manifest poll LANDED.** `logic.mjs` owns the whole decision
  core: `pollOnce` over injected readers (manifest → plan → bytes →
  SHA-256 verify → schema/seq cross-check), `pollPlan`,
  `verifyBundleBytes`, `parseVerifiedBundle`, `POLL_INTERVAL_MS =
  20_000`. app.js wires real fetches (`fetchBytes` for the pre-parse
  bytes) and applies an adopted bundle through the same placement /
  world-clock / derived-feed path as `loadAll`. The poll guards the
  LIVE bundle only — the H4 fallback chain is byte-for-byte as it was.
  A mismatch is discarded WHOLE (console warning, prior bundle
  continues, badge ages it to STALE from its own newestFetchUtc).
  Tests: `test/poll.test.mjs` 12/12, incl. the planted-mismatch
  positive control (stale-object + byte-flip variants) and the
  fetch-only-on-seq-change rule. Live convergence against the staging
  URL is exercised in the lane record
  (`plan-to-complete/lane-app-briefs.md`).
- **M4.19 app half LANDED; the 3D frame burn-in is the SCENE SYSTEMS
  lane's.** The honesty cluster's wording now has one named home —
  `logic.mjs`'s wording table (`BEHIND_LINE`, `badgeFor`,
  `recordingNotice`, `PLAY_RECORDING_LABEL`) — which scene.mjs
  already imports; the scene lane burns the same strings into the 3D
  frame from there. App-side changes: REPLAY carries its date range
  (`badgeFor` `replayRange`; `recordingNotice` `range`, purely
  additive — the M3.10 captions stand byte-for-byte without one);
  the demo fixture declares `recordedWindowUtc` (the 2026-11-01
  evening it replays, 22:56–23:20 UTC, per GATHERING-EVIDENCE +
  M5.07's letter); sample data's range derives from the bundle's own
  stamps (`recordingRangeOf`: earliest citizen evidence →
  newestFetchUtc). The play button now carries M4.19's wording
  "▶ Play the recording" (`PLAY_RECORDING_LABEL`); the app-safety
  recording census pin moved deliberately with the item. Tests:
  `test/honesty-cluster.test.mjs` 8/8, incl. the hand-off census
  (scene.mjs imports the wording home).
- **Suites after this landing:** app 155/156 — the one failure is the
  pre-existing `episodes.test.mjs` live-feed drift (the real College
  episode's `corroborated` flag moved with the live record; present
  at this lane's baseline read, untouched by this work). Staging
  25/25, scene 34/34, conformance 12/12 re-run per file, all green.

## Find & watch — M6 lane F front half (2026-11-03)

- **M6.01 ticker completed:** closed-set chip (icon + plain word)
  for every headline kind the archive carries; raw feed kinds render
  ONLY in the inspector. [Record] on every item (24/24 on the live
  bundle); [Take me there] resolves from structured fields only
  (placeCode / recorded citizen references) — 0/24 live items carry
  one tonight (all frontier/no-place items; names are never parsed
  out of prose). Deadline form "Answer due by [date]" built from a
  structured due stamp the frozen contract does not yet carry.
- **M6.03 now-line:** pure `nowLineModel`; placed citizens (asleep
  included) are the subject — the old inline form called a town of
  14 placed sleepers "nobody". Clause-verified against the live
  bundle (14 placed / 8 at the Plaza / all asleep, hand-counted).
  Population stays three numbers: joined 291 / nameable 16 /
  placed 14.
- **M6.04 roster + card:** office titles (words only, office-first)
  and namesake disambiguation (record N of M, from the published
  collisions) on rows and cards; `whereNowLine` never blank across
  every state × placement state; Watch on every roster row (follow
  or card); card gains [Record]. [Their page →] deliberately NOT
  rendered — it ships with M6.05; its absence is test-pinned.
  Offices are live-dark: the frozen v2 bundle carries no office
  field (the overview names the mayor; the carriage is a contract
  amendment, data-lane/DEC) — models consume either carriage shape
  and are fixture-proven, incl. the ambiguous-name no-bind rule.
- **M6.06 inspector:** dedicated "How Portal knows this" panel, one
  tap from every claim; source (route + read stamp), evidence class
  with BOTH values shown (neither marked, with the reason, where
  Tier P carries no integrity), staging notes, raw kind (inspector
  only), world book. D6 reset wording held ready as data + standing
  in the inspector; reset banner model fires on a live book change;
  claims are book-scoped (no name-merge). Simulated-reset suite
  test passes; 10/10 sampled live claims resolved to an archived
  route + time in the cold run.
- **M6.02 routes + strip:** find nav (Citizens / Buildings / Map /
  Faces); building directory (all 11 places, occupants, per-row
  Take me there); portrait strip (≤7, office-first then bundle
  order, 1-tap follow, honest shown/total). Sampled-hour hand-read
  on the live bundle matched exactly (strip order + all directory
  occupants); mayor-first and the staged mayor change are
  fixture-proven per the brief's Conflicts 5.
- **Tests:** test/find-watch.test.mjs 19/19. App suite 204/1 — the
  one failure is the pre-existing episodes live-drift, untouched.
  The M2.15 census pin moved deliberately: 6 → 10 innerHTML
  assignments, all logic builders. Staging converged via the
  auto-republish: pub-499 serves the current app files,
  hash-verified. Full per-item record:
  plan-to-complete/lane-m6-find.md.
