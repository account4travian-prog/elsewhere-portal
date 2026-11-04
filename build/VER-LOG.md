# VER Log — Elsewhere Portal verification thread

Running log of the standing verification (VER) thread. Entries are dated and
append-only. Counts recorded here are from the VER seat's own re-runs, never
copied from an arm's STATUS.md. Defects found are logged here with severity
and owner arm; the VER seat does not fix what it verifies (Quality charter
§1, pass 3).

Severity scale: P1 (checker/gate integrity or a law), FINDING (real defect,
fix-or-rebut on the record), NOTE (known limitation or follow-up).

---

## 2026-11-02 — First shift: Wave 1 baseline re-verification

### Suite re-runs (VER seat's own runs, exact commands from the arms' STATUS.md files)

Data arm — run from `build/data/`:

| Command | Tests | Pass | Fail |
|---|---|---|---|
| `node --test test/derive.test.mjs` | 6 | 6 | 0 |
| `node --test test/poller.test.mjs` | 4 | 4 | 0 |
| `node --test test/bundle.test.mjs` | 3 | 3 | 0 |
| **Data total** | **13** | **13** | **0** |

Engine arm — run from `build/engine/`:

| Command | Tests | Pass | Fail |
|---|---|---|---|
| `node --test test/astar.test.mjs` | 6 | 6 | 0 |
| `node --test test/playback.test.mjs` | 7 | 7 | 0 |
| `node --test test/no-teleport.test.mjs` | 2 | 2 | 0 |
| `node --test test/*.test.mjs` | 15 | 15 | 0 |
| **Engine total** | **15** | **15** | **0** |

The `no-teleport.test.mjs` run includes the positive-control test
("POSITIVE CONTROL: the invariant checker catches the teleporting mutant",
`mutantPositionAt` in the same file): the mutant was caught. Mutant result
for this shift: **caught**.

App arm — run from `build/app/`:

| Command | Result |
|---|---|
| `node --test test/logic.test.mjs` | tests 18, pass 18, fail 0 |
| `node --check app.js` | OK |
| **App total** | **18 / 18 pass** |

**Wave 1 grand total on VER re-run: 46 / 46 pass, 0 fail.** Matches the
counts in `WAVE1-REPORT.md` and the three STATUS.md files.

### Bundle hash recomputation

- `sha256sum build/data/feed/world-data.json` →
  `99cd8cda214bfbe194aa677bc577e15b1cb32f881547ffdb068f2dbd54bb9016`
- `feed/manifest.json` `worlddataHash` → identical value.
- `WAVE1-REPORT.md` recorded hash → identical value.
- **Hash match: YES** (bundle seq 1, archive head of 2026-11-02T02:07Z).

### Fetch log state at this shift

`build/data/archive/fetch-log.jsonl` holds exactly **6 rows** — the single
Wave 1 live pass of 2026-11-02T02:07:12Z–02:07:14Z, all six routes HTTP 200,
each with `snapshotId` + `file` + `sha256`. This is the expected state: the
M1 archiver is not yet running and the 48-hour A0 window has not started.
No defect. The cold-verifier checklist for the 48 h mark is filed in
`VER-CUSTODY.md`.

### Defects and observations logged this shift (not fixed — VER does not fix)

- **VER-D01 — FINDING (low), owner: Engine arm.** `catchUp` in
  `build/engine/playback.mjs` never returns `replay: true` for the 2-step
  demo journey even at 500 missed ticks; its shown-seconds model diverges
  from Plan B §3's step-count rule as the App arm read it. Already flagged
  in `build/app/STATUS.md` (contract friction #3) and in `WAVE1-REPORT.md`
  ("reconcile replay-flag semantics with Plan B §3 in wave 2"); the app
  consumes `speed`/`replay` safely meanwhile. Reconciliation is owed in
  wave 2 — VER will re-check the reconciled semantics against both the
  missed-steps and the absence-duration sides of the rule.
- **VER-D02 — NOTE, owner: App arm.** `build/app/local-playback.mjs` is a
  stand-in engine whose semantics diverge from the real engine (it reduces
  the demo fixture's per-step `ticksPerStep` array to its first element).
  It is used only when `../engine/playback.mjs` is absent. The plan already
  carries its retirement in favour of the real engine; until then, any app
  behaviour observed through the stand-in is not evidence about the real
  playback path.
- **VER-D03 — NOTE, owner: App arm / design.** Citizens the deriver places
  in the `asleep` state are drawn on the stage as plain dots (captions and
  roster lines do say asleep). Flagged by the App arm in its STATUS.md as
  an integrator decision; later waves owe asleep a distinct treatment.
- **VER-D04 — NOTE, owner: VER thread (custody gap, not a build defect).**
  Of the Quality charter's seven invariants, only no-teleport has a live
  automated check with a positive control in the Wave 1 tree. Derivation
  purity (same head + seq ⇒ identical bytes/hash) is tested in
  `derive.test.mjs` and provenance presence is asserted there for citizens
  and ticker items, but identity stability, cross-locale determinism,
  no-write, and book isolation have no automated checks yet — they land
  with their owning waves (M2/M3) per the plan. Full status table in
  `VER-CUSTODY.md`. VER will treat any wave gate that claims these
  invariants before their checks exist as an unverified claim.

---

## 2026-11-02 — Second shift: data-completion outputs + GATHERING-EVIDENCE spot-check

Focus: health module (`build/data/health.mjs` → `archive/health.json`),
reset detector (`build/data/reset-detect.mjs` → `archive/reset-watch.jsonl`),
and `build/data/GATHERING-EVIDENCE.md` (M2.08 / GAP-2 evidence hunt).

### Suite re-runs (VER seat's own runs, from `build/data/`)

| Command | Tests | Pass | Fail |
|---|---|---|---|
| `node --test test/health.test.mjs` | 7 | 7 | 0 |
| `node --test test/reset-detect.test.mjs` | 9 | 9 | 0 |

The reset suite's planted-reset POSITIVE CONTROL ("a planted reset is caught
and confirmed") exists and passed under the VER seat's own run, alongside its
negative controls (normal growth, clock-only advance).

### health.json — independent recomputation

VER recomputed from `archive/fetch-log.jsonl` with its own script, using only
the 12 rows at or before `health.json`'s `generatedAtUtc`
(2026-11-03T00:28:00.114Z): per-route attempts 2, successes 2, errors24h 0,
last-success UTC and last SHA-256 — **all six routes match health.json
exactly**, including `status.lastChangeUtc` staying at the Wave 1 fetch
(second status fetch was `unchanged`, same SHA). The per-route gap records
(the ~80,390 s Wave 1 → M1 interval) and `a0.unexplainedGapCount: 6` follow
from the log as written. No defect. (Rows after 00:28:00Z in the live log are
the now-running archiver, not a health error.)

### Reset detector — verdict on the real sequence: CONFIRMED

`reset-watch.jsonl`'s single verdict is `no-reset` over the pair
`2026-11-02/overview-20261102T020712Z.json` → `2026-11-03/overview-20261103T002703Z.json`.
VER read both payloads directly: `population.joined` 288 → 289 (grew — the
strongest anti-reset marker), `year` 45 → 45. No reset occurred; the verdict
is correct. Context: `season` SPRING → WINTER and `day_of_season` 7 → 29 over
~22 h is world-clock acceleration (the third overview, 00:28:04Z, agrees at
day 29), not a reset signature under the detector's model. Observation only:
season is not among the detector's inputs.

### GATHERING-EVIDENCE.md — spot-checks against the cited snapshots

1. **College lecture episode — CONFIRMED.** `voices-20261102T020714Z.json`:
   6 places, 58 utterances total, `EMBER_COLLEGE` carries exactly 18 from
   three speakers (Atlas Meridian, Nath Between, Nath Borowik); Atlas at
   2026-11-01T19:09:00Z says "Good questions, both…", Nath Between at
   19:29:09Z says "I returned in time to hear your answer, Atlas."
   `news-20261102T020713Z.json` corroborates: `CITY_EVENT_BEGAN` at
   19:04:30Z, `locate.anchor: college`.
2. **Anonymised hall gathering record — CONFIRMED.** Same news file,
   `hall.entries[]`: 2026-11-01T20:19:35Z, kind `GATHERING`, `who: "an agent"`,
   summary "Hosted a gathering 3 agents came to". Headline census also
   matches the doc: 24 = 19 `RUIN_EXCAVATED` + 3 `CITY_EVENT_BEGAN` +
   1 `OUTLOOK_CHANGED` + 1 `HAPPENING_WITNESSED`.
3. **Map presence fields empty / workshops unevidenced — CONFIRMED.**
   `map-20261102T020714Z.json`: `presence: []`, `ember.presence: 0`,
   `pulses: []`, `ember.pulses: []`, `ember.civic_works` is the bare list
   `["LIBRARY_ANNEX", "MARKET_HALL", "PUBLIC_WORKSHOP"]`; none of those three
   codes appears as a place in the voices snapshot.

**Split-verdict recommendation (§4): SUPPORTED by the evidence.** Both worked
gathering derivations (College, Plaza) check out as episodes built from
speech instants cross-corroborated by server event markers, and every limit
the doc names (left-and-returned line, silent attendees invisible, no end
record, `promised: 1` vs ≥3 actual speakers) is present in the files.
Working-as-state has no source: the ruin headlines are instant acts with no
duration/rounds fields. Gathering = derived-episode, working = acts-only is
the disposition the record supports; the DoD 6 rounds/counter half genuinely
has no Tier P source in this snapshot.

### Defects and observations logged this shift (not fixed — VER does not fix)

- **VER-D05 — FINDING (low), owner: Data arm (GATHERING-EVIDENCE.md §3).**
  The doc states "13 of the 19 `RUIN_EXCAVATED` headlines name Orrin
  Lowmarsh". VER's count of `news-20261102T020713Z.json` headlines: **17 of
  19** name him — 13 "dug into an old ruin" plus 4 "brought a {ledger|chart|
  seal|tool} out of an old ruin" (10:28:43Z–13:02:19Z, the doc's stated span,
  which is correct). 13 is the dig-only subset. The error undercounts in the
  safe direction and does not touch the §3/§4 conclusions, but the sentence
  should be corrected on the record before M2.08 cites it.
- **VER-D06 — NOTE, owner: Data arm (reset-detect.mjs).** The detector's
  evidence records hard-code `utc: null` for both snapshots
  (`reset-detect.mjs` runWatch passes `utc: null` literals) even though the
  overview payloads carry `generated_at`. The `reset-watch.jsonl` evidence
  block therefore cannot timestamp its own pair from the record alone.
  Verdict logic is unaffected; evidence completeness only.

## 2026-11-02 — Third shift: E1 contracts arm (citizenKey / stand-ins / canonicalisation)

VER re-ran and re-derived everything itself; E1-REPORT.md was treated as a
claim set, not evidence.

### Suite re-runs (VER's own runs)

- Data (`derive + poller + bundle` tests): **22 pass / 0 fail** — matches claim.
- Engine (`astar + playback + no-teleport`): **15 pass / 0 fail** — matches claim.
- App (`logic`): **21 pass / 0 fail** — matches claim.
- Total **58**, exactly the claimed 22/15/21. No suite red.

### Bundle rebuilt from the live archive by VER (temp feed dir)

- 17 citizen records; **every record carries a distinct `citizenKey`, all
  with the `portal-key:` prefix**; `handle` is `""` on all 17;
  `firstSeenUtc` present on all 17; raw `name` stored on all 17.
- `citizenCollisions` present and **correctly empty for this head**: VER
  independently grouped the records — no duplicate raw names, no shared
  slug bases — so an empty list is the right value, not a missing feature.
- Stage positions through the app's own `citizenPositions` on VER's bundle:
  **13 positions, 13 distinct coordinates** — matches the claim. The two
  place-coded records not positioned are Kevin Bianchi and Quinn Wayfarer
  at `EMBER_DISTRICT_1_PLOT_30`, exactly the no-layout-node case E1 §5
  flags for M2.06 (roster-only, no invented geometry). Consistent.
- Key stability: VER's rebuild keys match the shipped feed's keys for all
  17 common names, zero mismatches.
- Rebuild-vs-rebuild byte difference is fully explained: `dataAgeSeconds`
  and `newestFetchUtc` (clock fields) plus `worldHour` 11 → 13 because the
  running archiver wrote a new overview between the two builds — the head
  moved, the citizens section was identical. Same-input determinism is
  covered by the suite's purity test (green in VER's run).

### Deletions — CONFIRMED

- `build/app/local-playback.mjs` is absent.
- No `FALLBACK_LAYOUT` anywhere in `build/app`; no `EMBER_LIBRARY_ANNEX`,
  no `EMBER_HOME_*` anywhere in `build/app`.
- `app.js` line 11 imports `planJourney`/`positionAt`/`catchUp` from
  `../engine/playback.mjs` directly.

### Canonicalisation — CONFIRMED as scoped

Zero `localeCompare` calls in `derive.mjs` / `build-bundle.mjs` (the one
hit in derive.mjs is a comment explaining why it is banned). `cmpStr`
code-unit comparison is in place.

### Hark Q2 conditions vs implementation — ALL FIVE CONFIRMED

1. PORTAL-KEY labelling: `portal-key:` prefix is intrinsic to the value;
   app code and `logic.mjs` docs consistently say PORTAL-KEY, never
   handle/identity; `handle` stays `""`.
2. Raw name + first-seen stored beside the key (all 17 records, above);
   deriver sets `firstSeenUtc` to the record's earliest evidence in head.
3. No merge on name alone: deriver keeps voices and news-residents records
   as separate streams; a named no-merge test passes in VER's run.
4. Rename → new key: key is a pure function of the evidenced name;
   rename test passes (`a rename produces a NEW key — no rename-chasing`).
5. Collisions flagged, never folded: `citizenCollisions` emitted by
   `assignCitizenKeys` with bare key, raw names, and all assigned keys;
   collision and clean-head tests both pass.

### Layout §2 spot-check — CONFIRMED

`ember-layout.json`: 8 nodes `verified`, the two homes
(`EMBER_HOME_MAPLE_COTTAGE`, `EMBER_HOME_WILLOW_COTTAGE`) honestly marked
`staging`, as claimed.

### Defects and observations logged this shift (not fixed — VER does not fix)

- **VER-D07 — NOTE, owner: App arm.** The string `EMBER_MARKET_HALL`
  survives in `build/app` in two non-runtime places: a `logic.mjs`
  comment (line 159) and the `resolveNode` test in
  `test/logic.test.mjs` (line 133). It is NOT in `app.js` — the
  FALLBACK_LAYOUT deletion claim is true as made. The survivors hang off
  `resolveNode`'s fuzzy label fallback, whose deletion is already
  scheduled as M3.08 and was declared out of scope in E1 §3. Observation
  only; no action before M3.08.
- **VER-D08 — NOTE, owner: Data arm.** `localeCompare` remains in
  `data/reset-detect.mjs:125` (sorting ISO timestamp strings). Outside
  the bundle path, so the E1 canonicalisation claim stands as scoped,
  but it is the same locale-dependence class the deriver just removed;
  worth sweeping when that file is next touched.

---

## 2026-11-02 — Fourth shift: episodes.mjs + plots (M2.06) verification

### Suite re-runs (VER seat's own runs, per-file invocation from each arm's directory)

| Suite | Files | Tests | Pass | Fail |
|---|---|---|---|---|
| data | bundle 3, chain 8, derive 19, episodes 11, health 7, poller 4, reset-detect 9, world-books 4 | **65** | 65 | 0 |
| engine | astar 6, no-teleport 2, playback 12 | **20** | 20 | 0 |
| app | logic 27 | **27** | 27 | 0 |
| **Total** | | **112** | **112** | **0** |

Data 65 and app 27 match the arms' claimed totals (65/27) exactly, on VER's
own runs. (The `node --test test/` directory form mis-fires in this Node
install — 1 pseudo-test, 1 fail — per-file invocation is the documented
form and is what these counts use; see VER-D10.)

### episodes.mjs — claims re-derived on the real Wave 1 snapshots (archive/2026-11-02, 0207Z set)

VER ran `deriveEpisodes` / `deriveActSequences` directly on the archived
voices + news payloads and cross-counted the raw payloads independently.

- **College episode — CONFIRMED.** Derived episode at `EMBER_COLLEGE`:
  participants exactly [Nath Between, Atlas Meridian, Nath Borowik]
  (3 speakers), `utteranceCount` 18, `corroborated: true`
  (corroboratedBy headline 93262, 2026-11-01T19:04:30Z). Raw payload
  recount agrees: 18 utterances, speakers Atlas Meridian ×9,
  Nath Between ×8, Nath Borowik ×1.
- **Disclosure verbatim — CONFIRMED.** Every derived episode carries the
  string byte-identical to the module's DISCLOSURE constant: "Presence is
  evidenced at the moments each of them spoke; the public record does not
  show who else was present, who stayed silent, or when each of them
  left."
- **Silent attendees excluded — CONFIRMED.** Atlas Meridian's fenced
  closing thanks names Orrin Lowmarsh and Spark Archer; neither speaks at
  the College in the raw payload, and neither appears in the episode's
  participants.
- **Single-speaker places yield no episode — CONFIRMED.** EMBER_TOWNHALL
  (1 utterance, Atlas Meridian only) and STELLAR_E00_S04 (1 utterance,
  Kevin Bianchi only) produce no episode. Five episodes derive in total
  (College, Plaza, and three STELLAR exchanges).
- **Act sequences — CONFIRMED.** Every sequence carries
  `presentation: 'acts-only'` and no `state` key (key list inspected:
  actor, kind, presentation, count, firstUtc, lastUtc, acts, disclosure).
  Orrin Lowmarsh's RUIN_EXCAVATED sequence count is **17**, matching an
  independent raw count of 17 matching headlines in the news payload.

### Plots (M2.06) — CONFIRMED against the cited snapshots

- **PLOT_30 voices-evidenced — CONFIRMED.** In
  `archive/2026-11-03/voices-20261103T003229Z.json`, place
  `EMBER_DISTRICT_1_PLOT_30` carries 4 utterances: Quinn Wayfarer at
  2026-11-03T00:15:51Z, 00:20:31Z, 00:23:41Z and Kevin Bianchi at
  00:14:05Z. VER re-ran `deriveWorldData` on that snapshot set: the
  bundle gains exactly one plot entry — PLOT_30, district 1, plot 30,
  `provenanceClass: 'feed-evidenced'`, voices provenance — and the two
  citizens at PLOT_30 with evidence stamps matching the raw payload
  (Kevin Bianchi 00:14:05.637623Z, Quinn Wayfarer 00:23:41.856907Z, both
  state `talking`).
- **PLOT_18 / PLOT_31 in NO feed payload — CONFIRMED by VER's own sweep.**
  A grep for `EMBER_DISTRICT_3_PLOT_18` and `EMBER_DISTRICT_1_PLOT_31`
  across the entire snapshot archive (all routes, both days) returns zero
  files. They remain record-attested only, as classed.
- **PLOT_41 negative control — CONFIRMED under VER's run.** The app suite
  (27/27 above) includes the chats-only PLOT_41 case; VER additionally
  called `resolveExactNode(effectiveLayout(layout, bundleWithPlot30),
  'EMBER_DISTRICT_3_PLOT_41')` directly and got `null` — no node, no
  fuzzy rescue.
- **Layout untouched, fill staged — CONFIRMED.** `ember-layout.json`
  still has 10 nodes and no PLOT_30 node. The app's `effectiveLayout`
  fill node for PLOT_30 carries `stagedPosition: true` (label
  "District 1, Plot 30", cell 1,8), and the shared layout object itself
  still resolves PLOT_30 to `null`.

### Defects and observations logged this shift (not fixed — VER does not fix)

- **VER-D09 — NOTE, owner: Data arm / coordinator.** The live bundle on
  disk (`data/feed/world-data.json`, bundleSeq 3, built 2026-11-03
  00:31Z) still carries `ember.plots: []` even though its own citizens
  sit at PLOT_30: it was built ~3 minutes before the M2.06 deriver
  landed (derive.mjs mtime 00:34Z). The deriver as it now stands
  produces the PLOT_30 entry correctly (re-derived above), so this is a
  build-timing artefact, not a code defect — but the coordinator should
  confirm the next bundle build carries the entry, since the app keys
  the staged fill off `ember.plots`.
- **VER-D10 — NOTE, owner: none (environment).** `node --test test/`
  (directory form) fails in this Node install with a single pseudo-test
  failure in all three arms; per-file invocation passes everywhere.
  Anyone re-running suites should use the per-file form the STATUS.md
  files document, or they will see a phantom red suite.

---

## 2026-11-03 — Fifth shift: bundle cycle + app presentation (M3/M4 landings)

Scope: the two most recent landings — the supervisor's gated bundle cycle
and the app's planPresentation/summaryPanel behaviour. Nothing fixed.

### Bundle cycle — CONFIRMED by ~2 minutes of live observation

- **Sequence advances and holds correctly.** VER sampled
  `feed/manifest.json` + `feed/world-data.json` five times at 30 s
  intervals (2026-11-03 00:44:19Z–00:46:20Z): bundleSeq went
  6 → 7 → 7 (hold) → 8 → 9, with manifest and world-data sequence
  agreeing at every sample. The supervisor's own `logs/bundle.log`
  shows the next publish (seq 11, 00:47:04Z) after VER's window.
- **Manifest hash matches the bytes — CONFIRMED by VER's own
  recomputation.** VER sha256'd the exact `world-data.json` bytes at
  each sample; all five matched `manifest.worlddataHash` character for
  character.
- **health.json bundle section agrees — CONFIRMED, with a one-cycle
  lag (VER-D11).** `archive/health.json`'s bundle section (seq 8,
  hash 4af21c0b…) exactly matched the manifest as of VER's sample 4.
  On re-check after the next cycle it read seq 10 / hash 9abb6d24…,
  identical to the then-live manifest. The lag is structural (health
  is the last step of each hook cycle), not a mismatch.
- **Live bundle shape.** 17 citizens, every one carrying a non-empty
  `citizenKey` at every sample; `ember.plots` present as an array
  throughout, growing 0 → 1 at seq 9 — **VER-D09 is closed**: the
  PLOT_30 entry the previous shift found missing is now published,
  and `bundle-check` reports `plots 1` on the live feed.
- **Gate logic is real — CONFIRMED by positive control on a temp
  copy (live feed untouched).** Unmutated copy of the live feed:
  `bundle-check OK`, exit 0. Mutation A (citizens[0].citizenKey
  deleted): exit 1, with the specific failure
  `citizen[0] (Arabela Protoser) carries no citizenKey` (alongside the
  expected hash mismatch). Mutation B (`ember.plots` deleted AND the
  manifest hash recomputed to match the mutated bytes, isolating the
  plots check): exit 1 on `ember.plots is absent or not an array`
  alone. The supervisor gates publishing on this check plus the
  bundle tests and publishes manifest-last by rename, as written in
  `archiver-supervisor.sh`.

### App presentation — CONFIRMED against the real engine

- **Suite re-runs (VER's own, per-file form).** App
  `node --test test/logic.test.mjs`: **34 pass / 0 fail** (see
  VER-D12 on the circulated count). Engine: astar 6/6,
  no-teleport 2/2, playback 12/12 — **20/20**. Data: bundle 4,
  chain 8, derive 22, episodes 11, health 7, identity-registry 10,
  poller 4, reset-detect 9, thinning 6, world-books 4 — **85/85**.
- **Summary behaviour — CONFIRMED end to end on a genuine journey.**
  VER routed the longest real path in the shared layout with the
  engine's own `findPath` (Maple Cottage → Market Hall → Plaza of
  Unity → Public Workshop → Willow Cottage, 4 steps), built it with
  `planJourney` (4 ticks/step), and ran `catchUp` with
  absenceTicks 200 (200 × 30 s = 1 h 40 min > the 120-tick summary
  threshold). Result: `mode: 'path-summary'`, **playback queue
  `steps` empty**, `summarySteps` carrying all 4 steps,
  `totalShownSeconds` 0. `planPresentation` returned
  `isSummary: true, showReplayBadge: false`. `summaryPanel`
  returned the "While you were away" panel listing all 4 steps in
  order with their world durations, closing on the journey's end
  place with "The steps above were listed, not played."
- **Negative control.** The same journey at absenceTicks 10
  (5 minutes) yields `mode: 'catch-up'` and `summaryPanel` returns
  `null` — the panel exists only where the summary is the continuity.
- **No `toLocaleString` — CONFIRMED with a nuance.** Zero call sites
  in `build/app` (grep for the call form `toLocaleString(`: no
  matches). The single occurrence of the word is a comment in
  `logic.mjs` (line 249) explaining why `formatCount` avoids it.

### Defects and observations logged this shift (not fixed — VER does not fix)

- **VER-D11 — NOTE, owner: Data arm / consumers.** `health.json`
  trails the live manifest by up to one hook cycle (observed: health
  at seq 8 while the feed stood at seq 9). It is last-cycle state,
  written last by design; any consumer reading it as *live* bundle
  state will be one bundle behind.
- **VER-D12 — NOTE, owner: App arm / coordinator.** The app suite
  now runs 34 tests, one more than the 33/33 figure in circulation
  (and in the app STATUS.md's last count line). The suite is green;
  the circulated count is stale-low. Counts in reports should be
  re-derived at filing time.
- **OPEN ITEM — summary panel screenshot verification outstanding.**
  The summary panel's behaviour is verified at the logic level above,
  but no screenshot verification exists: Chromium policy blocks
  capture from subagent contexts. The panel's visual confirmation
  rides to the M4 staging deployment, where it can be captured from
  the deployed page. Not a pass — an explicitly unverified surface.

---

## 2026-11-03 — Sixth shift: facts stream + chain schema + thinning (three data landings)

VER re-ran and re-derived everything itself; the arms' claimed counts were
treated as claims, not evidence. Nothing was fixed this shift.

### Suite re-runs (VER's own runs, per-file form, from `build/data/`)

| Command | Tests | Pass | Fail |
|---|---|---|---|
| `node --test test/facts.test.mjs` | 12 | 12 | 0 |
| `node --test test/chain.test.mjs` | 11 | 11 | 0 |
| `node --test test/thinning.test.mjs` | 6 | 6 | 0 |

All three match the claimed counts (12/12, 11/11, 6/6). VER read the
control tests' source rather than trusting names: chain's suite genuinely
contains "POSITIVE CONTROL wrong-schema" (a record claiming
`portal.chain/v9` fails with a named schema-mismatch error) and "POSITIVE
CONTROL dropped-schema" (a post-declaration record missing the field
fails), and thinning's genuinely contains both AUTO-B11 abort controls
(A: planted chain gap blocks thinning, nothing removed; B:
bundle-reproduction failure blocks thinning, nothing removed). All green
under VER's runs.

### facts.mjs (portal.facts/v1) — real diff redone by VER

VER reconstructed the seq-1 bundle from the earliest head (the six
2026-11-02T02:07Z snapshots alone in a temp archive, built with
`build-bundle.mjs` into a temp feed): bundleSeq 1, 12 citizens,
populationKnown 288, season SPRING — agreeing with the Wave 1 record.
Diffed (pair mode, `--out`/`--state` pointed at temp so live facts state
was untouched) against two different later heads:

- **Against a WINTER-era head** (temp archive of all snapshots
  ≤ 2026-11-03T00:50:06Z **plus `archive/world-books.json`**, see VER-D14):
  **exactly 12 facts — 5 citizen-first-seen, 4 citizen-place-changed,
  1 place-first-evidenced (EMBER_DISTRICT_1_PLOT_30), 1
  population-changed (288 → 289), 1 season-changed (SPRING → WINTER,
  year 45 → 45). The claimed counts are CONFIRMED, by type, exactly.**
- **Against the current live bundle** (seq 15, copied 2026-11-03
  ~00:51Z): 11 facts — identical counts except **season-changed 0**.
  Cause, evidenced from the raw overview payloads: the world's season
  rolled WINTER (year 45, day 30) → SPRING (year 46, day 1) between
  overview-20261103T005006Z and overview-20261103T005107Z, about a
  minute before VER copied the live bundle. Both endpoint bundles say
  SPRING, and the pair diff triggers on endpoint season-string
  inequality only, so the intervening WINTER is invisible to it. The
  claim was true of the head it was made against; it is not
  reproducible against the current head for this timing reason alone.
  See VER-D13.

- **Place-changed spot-check — CONFIRMED against raw voices.** Fact:
  Orrin Lowmarsh, EMBER_PLAZA_OF_UNITY → EMBER_COLLEGE. Seq-1 head
  voices (`voices-20261102T020714Z.json`) show him speaking only at the
  Plaza (1 utterance, 2026-11-01T23:04:05Z); the live head voices
  (`voices-20261103T005105Z.json`) additionally show him at the College
  (2 utterances, 2026-11-02 ~19:02–19:14Z), which the deriver takes as
  his current place. The fact matches the raw record.

### Chain schema (portal.chain/v0) — CONFIRMED on all six live chains

- `node chain.mjs verify archive` (VER's own run): **all six chains OK,
  exit 0** — chats 8, map 8, news 16, overview 27, status 1, voices 16
  records (76 total), 0 edge gaps, 0 errors. Every chained file's bytes
  hash-match its record (verify does this per record).
- **Mixed-era shape CONFIRMED by VER's own census of the chain files:**
  every chain has a single clean boundary — pre-declaration records
  carry no `schema` field (chats seq 1–7, map 1–7, news 1–14, overview
  1–24, status 1, voices 1–14) and every later record carries exactly
  `"schema": "portal.chain/v0"` (chats 1 record, map 1, news 2,
  overview 3, voices 2); zero records carry any other schema value,
  and no chain drops the field after adopting it.

### thinning.mjs — CONFIRMED: 0 eligible, archive intact

- `node thinning.mjs plan --archive archive` (VER's own dry-run):
  `eligible: 0`, no entries, exit 0 — nothing in the real archive is
  old enough to thin, as claimed.
- **No files lost — CONFIRMED by independent census.** VER enumerated
  the archive directly: 76 snapshot files on disk (chats 8, map 8,
  news 16, overview 27, status 1, voices 16), exactly the chain
  records' file set — every chained file present, zero unchained
  snapshot files, and `archive/thinning-log.jsonl` does not exist
  (nothing has ever been thinned).

### Defects and observations logged this shift (not fixed — VER does not fix)

- **VER-D13 — NOTE, owner: Data arm / whoever quotes the facts diff.**
  The pair diff's season fact compares endpoint season strings only: a
  season excursion that returns to the starting season between the two
  bundles (SPRING → WINTER → SPRING, with a year roll, as happened
  2026-11-03 00:27–00:51Z) emits no season-changed fact in pair mode.
  This is facts.mjs's documented semantics (it diffs the two bundles
  it is given; the stream walkers diff consecutive pairs and would
  emit both transitions), not a code defect — but any quoted "real
  diff" fact count is head-dependent and must name the head it was
  diffed against, or the count silently stops being reproducible the
  moment the live head moves.
- **VER-D14 — NOTE, owner: VER thread (reconstruction methodology).**
  A temp-archive bundle reconstruction that omits
  `archive/world-books.json` silently degrades plot evidence to the
  head-only fallback in `build-bundle.mjs` (`loadBookVoices`): VER's
  first WINTER-head rebuild produced `ember.plots: []` where the real
  build carries PLOT_30; copying the registry in restored it. The
  fallback is documented in the builder and the live archive carries
  the registry, so live bundles are unaffected. Future VER
  reconstructions must carry `world-books.json` (and should say so in
  their log entries).

---

## 2026-11-03 — Seventh shift: v2 builder + talk surface (M2.11 freeze gate)

Focus: `build/data/derive-v2.mjs`, `build-bundle-v2.mjs`, `validate-v2.mjs`;
talk surface (`episodes-cycle.mjs` → `feed/episodes.json`, app episodes
panel). All runs are the VER seat's own; nothing fixed.

### Suite re-runs (VER seat's own runs)

| Command | Tests | Pass | Fail |
|---|---|---|---|
| `node --test test/bundle-v2.test.mjs` (from `build/data/`) | 14 | 14 | 0 |
| `node --test test/episodes-cycle.test.mjs` (from `build/data/`) | 3 | 3 | 0 |
| `node --test test/episodes.test.mjs` (from `build/app/`) | 8 | 8 | 0 |

All three match the arms' claims (14/14, 3/3, 8/8).

### v2 build from the real archive head (VER seat's own build)

`node build-bundle-v2.mjs --feed /tmp/ver7/feed-v2` → exit 0, self-validated.
`node validate-v2.mjs` on the output → `{ valid: true, rejections: 0 }`.
Head: `newestFetchUtc 2026-11-03T00:53:09.228Z`.

- `schema` = `portal.world-data/v2`. ✓
- 17 citizens; every one carries a `portal-key:`-prefixed `citizenKey`,
  `citizenId: null`, `citizenIdStatus: "UNBOUND_NO_ROUTE"` (0 failures in a
  full scan). Registry cross-check: `archive/identity-registry.json`
  summary = `{ verified: 0, unverified: 17, ambiguous: 0 }` — the bundle's
  statuses are exactly the registry state. ✓
- `world.bookId` = `world-001`; `world.facts` present as a key, value
  `null` (no live facts stream wired — recorded, not omitted); the v2
  manifest carries the same `facts: null` citation and schema v2. ✓
- `episodes` = 5, `actSequences` = 1, each carrying the verbatim filed
  disclosure template (episode template and acts template match the
  `episodes.mjs` constants; the validator enforces equality and passed). ✓
- No `scenes` key anywhere; no `presenceClass` anywhere in the bundle. ✓
- `citizenCollisions` = `[]` (no same-name splits in this head). ✓

### Validator positive controls (VER seat's own mutations, temp copies only)

| Mutation | Result |
|---|---|
| `scenes: []` added to the bundle | Rejected, exit 1, kind `scenes-emitted` |
| Episode[0] disclosure replaced with `"n/a"` | Rejected, exit 1; rejection logged in `validation-rejections.jsonl` with record id `episode:EMBER_PLAZA_OF_UNITY:2026-11-01T22:59:41.600264+00:00:#0` (Hark part-3 condition: rejections are data, never silence) |
| `citizenIdStatus` deleted from citizen[0] | Rejected, exit 1; logged with record id `portal-key:arabela-protoser` |

### Size claim — recomputed on one head

v1 and v2 both built by the VER seat from the same head
(`2026-11-03T00:53:09.228Z`): **v1 = 12,020 B, v2 = 16,720 B, delta =
4,700 B**. The arm's claimed pair (12,021 / 16,740, Δ4,719) was measured
on an earlier head; the ~20 B difference is head movement, not error.
Delta is ~4.7 KB against the §5 freeze gate's 50 KB figure. ✓

### Talk surface

- The Hark disclosure render test exists in `build/app/test/episodes.test.mjs`
  under the name "Hark M2 condition (c): the disclosure reaches the
  rendered panel model for every listed episode" and does assert it: for
  every episode in the real feed, `episodeListModel` row disclosure `===`
  feed disclosure and `talkPlaybackModel` header disclosure `===` feed
  disclosure. It passed under the VER seat's run. ✓
- Regeneration: the live `feed/episodes.json` names head
  `voices/news-20261103T005105Z`; the archive head had already moved to
  `…T005306Z`, so the VER seat regenerated from a pinned temp archive
  holding exactly the live file's named head. Result: **byte-identical**
  to the live feed file. ✓
- Verbatim spot-check: all 83 utterances in the live feed were compared
  against the parsed source snapshot
  (`archive/2026-11-03/voices-20261103T005105Z.json`, `places[].said[]`):
  **83/83 exact string matches**, including fence-carrying utterances
  (e.g. Kavi Marlow, Plaza, 2026-11-01T22:59:41Z, fences intact; Nath
  Between, College, 2026-11-02T19:01:59Z and 19:32:53Z). An initial
  raw-byte search missed due to the file's JSON escaping; the
  decoded-string comparison is the correct test and is clean. ✓

### Contract draft consistency (CONTRACT-V2-DRAFT.md §1 vs emitted output)

Same-head key-set diff, v1 build → v2 build:

| Level | Added | Removed |
|---|---|---|
| Top level | `episodes`, `actSequences` | — |
| `world` | `bookId`, `facts` | — |
| `citizens[]` (uniform across all 17) | `citizenId`, `citizenIdStatus` | — |
| Manifest | `facts` | — |

Changed: `schema` value v1 → v2 (bundle and manifest). Emitted delta =
6 additions + the schema change — exactly as §1.1 states (the remaining 3
of its 9 "added" — `citizenKey`, `firstSeenUtc`, `citizenCollisions` —
already ship under v1 and are present in the v1 build's key sets).
**Delta table count of 10 (1 changed + 9 added) is consistent with the
emitted output, field by field.** ✓

### Defects logged this shift

None. No P1, no FINDING, no NOTE. (The size-pair difference vs the arm's
claim is head movement between measurements, verified as such above.)

### FREEZE READINESS — M2.11

**VER SIGNS OFF.** The v2 builder emits exactly the contract the draft
specifies, the validator's three named failure modes all reject loudly
with logged record ids, the talk surface's disclosures and utterances are
verbatim against the record, and the draft's delta table matches the
emitted key sets field by field. No blockers from this seat.

## 2026-11-03 — Eighth shift: A1 delta sign-off + episodes hook + app v2 adoption

Three independent verifications, all runs my own, nothing fixed.

**1. Amendment A1 delta — SIGNED OFF.** `build/CONTRACT-V2.md`
documents `world.integritySource` as REQUIRED with the single
conformant value `"none-in-tier-p"` (§1.1 table row, §1.2 shape line
115, §7 item 6), and the status header honestly carries the pending
state: "FROZEN pending a VER delta sign-off on A1 only." A v2 bundle
built by me from the real archive head (newestFetch
2026-11-03T01:00:49.031Z, into /tmp) carries
`world.integritySource === "none-in-tier-p"`. Mutation controls on
temp copies: value changed to `"tier-p-partial"` → validator exit 1,
rejection logged with kind `world.integritySource` naming the field
and the offending value; field deleted → likewise rejected
(`got undefined`). The unmutated bundle validates clean (exit 0).
Suites: `test/bundle-v2.test.mjs` **15/15** (the freeze claim);
full data suite **128/128** across all 14 files — the freeze arm's
"118" was its count at freeze time; the suite has since grown by
facts-cycle's 10 tests, all passing, so this is growth, not a
missed claim. Post-A1 size re-measure on one head: v2 = 16,249 B,
v1 same-head canonical = 12,021 B, delta = 4,228 B — comfortably
under the 50 KB gate. **A1 delta: SIGNED OFF.** The freeze header
may be flipped to fully FROZEN.

**2. Episodes hook — LIVE and clean.** `feed/episodes.json` is
fresh: mtime 2026-11-03T01:02:13Z, `generatedFrom` names the current
head pair (voices-20261103T010047Z / news-20261103T010046Z), schema
`portal.episodes/v1` (4 episodes + 1 act sequence at this head;
the count moves with the head window, as designed). The supervisor
start line names the cycle "… → bundle → episodes → health";
`logs/episodes.log` holds 8 runs since the 00:54:42Z restart, every
one exit 0, tracking the moving head; `logs/supervisor.log` contains
zero STEP FAILURE lines. `archive/health.json` is fresh
(generatedAtUtc 01:02:13Z), `a0.unexplainedGapCount` still **6**,
`inGapNow: false`, and all six per-route gaps end at A0
(2026-11-03T00:27:0xZ) — all pre-A0. Restart cadence recomputed by
me from `archive/fetch-log.jsonl` around 00:53–00:56Z: overview max
interval **93.2s** (00:53:09→00:54:42Z) vs 120s threshold; map
**221.4s** (00:51:02→00:54:43Z) vs 600s; chats 220.4s vs 600s;
status 93.7s vs 120s; news/voices never exceeded ~122s vs 240s.
No route breached 2× cadence across the restart; my figures match
the hook arm's table exactly.

**3. App v2 adoption — CONFIRMED.** Per-file re-runs match the
claim exactly: logic **34/34**, episodes **8/8**, v2-adoption
**8/8** = 50/50 (the app suite total is now 56/56 — the M2.15
escaping suite, 6/6, landed from the priority fix after the
adoption claim was made). I read `test/v2-adoption.test.mjs` in
full: (a) dual-schema — `isBundle` accepts v1 and v2, rejects v3,
unknown schemas, {}, and null; selection composes through isBundle
exactly as app.js uses it (the test is candid that raw selectBundle
alone does not validate). (b) The bundle-path Hark M2 condition (c)
test builds a REAL v2 bundle from the archive head plus a same-head
episodes feed and asserts every episode and act-sequence disclosure
reaches `episodeListModel`/`actListModel` verbatim, with playback
resolution through the feed twin. (c) The integritySource pin:
`workTier` returns 'none' ("Repair not in the public record") for a
null-integrity work with integritySource absent, `"none-in-tier-p"`,
0, or 100, while an evidenced work (integrity 64) keeps its 'plain'
band throughout; v1 shape behaves identically. (d) Plain words:
UNBOUND_NO_ROUTE → "Not yet linked to a public profile — no public
route names them yet."; CONFLICT → "More than one citizen shares
this record name; not linked."; BOUND → the citizenId itself after
the label "Public profile: " — and the test asserts the raw enum
never appears in the wording text. I also read the rendering path
(`logic.mjs` citizenBindingWording/bindingHtml): the enum is only
switched on, never interpolated; the BOUND id is escaped before it
reaches HTML.

**Defects logged this shift: none.** No P1, no FINDING, no NOTE
against any arm. The 118→128 data-suite growth is recorded above
so the freeze paperwork and the live tree are not later read as
disagreeing.

## 2026-11-03 — Ninth shift (narrow): M2.01 route expansion build

Scope: verify the route-expansion arm's claims (11 scheduled routes,
ROUTES/cadence unification, live-effect proofs). Nothing fixed,
nothing restarted by this shift; live state read-only throughout.

**1. Suites — CONFIRMED exactly.** `test/routes-expansion.test.mjs`
re-run: **11/11**. Full data suite per-file, my runs: bundle-v2 15,
bundle 4, chain 11, derive 22, episodes-cycle 3, episodes 11,
facts-cycle 10, facts 12, health 7, identity-registry 10, poller 4,
reset-detect 9, routes-expansion 11, thinning 6, world-books 4 =
**139/139 across 15 files**, zero failures. Claim matches.

**2. Route set, cadence, total — CONFIRMED.** `poller.mjs` ROUTES =
[overview, news, voices, map, status, chats, debates, discussions,
problems, concerts, errata] — the Wave 1 six plus exactly the five
M2.01 names (plan-to-complete M2.01 text + REC-6: 11 scheduled, not
17). `cadence.json` keys are exactly ROUTES (11/11, no extras), and
every value matches the Plan B §2.1 table (plan/02-technical-plan.md):
status/overview 60 s, news/voices 120 s, map/chats 300 s,
debates/discussions/problems/concerts 600 s, errata 3,600 s.
`dailyFetchTotal(cadence.routesSeconds)` executed: **5,496/day**
(before 4,896; +600 = 4×144 + 24), inside the ≈5,600 envelope.

**3. Unification — CONFIRMED.** `world-books.mjs` line 30:
`import { ROUTES } from './poller.mjs'`, re-exported line 35,
iterated line 76; grep finds no private route list remaining.
`identity-registry.mjs` line 40 imports ROUTES from poller.mjs;
line 63 builds the snapshot-scan regex from `ROUTES.join('|')`, so
the evidence scan covers the new routes and cannot drift again.

**4. Live-effect proofs — CONFIRMED in substance, with the
comparison basis stated exactly.** The expansion arm's original
comparison (v1 builder vs the then-live v1 feed) is no longer
reproducible: the concurrent feed-switch arm has since switched the
live feed to v2 (manifest `portal.world-data/v2`, bundleSeq 29).
What I compared instead, at the same head (newestFetchUtc
2026-11-03T01:06:55.727Z on both sides): (a) two back-to-back
`build-bundle-v2.mjs` builds into fresh /tmp feed dirs are
byte-identical to each other (sha256 953b597d…, deltaBytes 4,228,
0 warnings) — same-head determinism; (b) a recursive diff of my
build against the live `feed/world-data.json` differs at exactly
two paths, both feed-directory state rather than derivation:
`$.bundleSeq` (1 vs 29 — sequence continues from the target dir's
prior manifest) and `$.world.facts` (null vs {schema:
portal.facts/v1, seq: 28} — the citation reads the feed dir's
facts-state.json, absent in a fresh dir). Every derived byte —
citizens, ember, episodes, actSequences, journeys, ticker,
counters — is identical: the expansion changed no derived output.
Health: I recomputed over the real fetch log (`health.mjs --out
/tmp/ver9-health.json`) — the `a0` block matches the live
`archive/health.json` exactly: **unexplainedGapCount 6, all six
gaps the pre-A0 silence ending 2026-11-03T00:27:05Z, `inGapNow:
false`**; each original route carries exactly that one gap,
gapStatus ok. The arm's "five new routes at no-data" was true when
measured (pre-apply); see item 6 for the current state.

**5. Genesis proof — CONFIRMED, twice.** In an isolated temp
archive holding only the debates + errata snapshots,
`chain.mjs build` produced genesis records byte-identical to the
live ones and `chain.mjs verify` passed under `portal.chain/v0`
(seq 1, `prev_hash: null`, schema field present, sha256 matching
the fetch-log records). Read-only verify of the LIVE archive: all
11 chains OK, 0 edge gaps (five new chains at 1 record each).

**6. Running-poller claim — REFUTED as stated, because the apply
overtook it during this shift (VER-D15).** The expansion arm
reported (completed 01:06:50Z) that the running poller still
served only the six routes and the apply was pending. Three
seconds later the feed-switch arm's supervisor restart (supervisor
.log: hook loop started pid 51265, 2026-11-03T01:06:53Z) started a
fresh poller, which — loading the expanded ROUTES — executed a
full 11-route pass at 01:06:53–57Z in ROUTES order: baseline
snapshots for debates (534 B), discussions (2,940 B), problems
(93,414 B), concerts (12,168 B), errata (1,208 B), all status 200,
followed by chain genesis for all five and health attempts=1 on
each. This is exactly the first-cycle signature the arm's apply
spec predicted. So: the apply is no longer pending — M2.01 is
**live** as of 2026-11-03T01:06:56Z, effected by the feed-switch
restart rather than a dedicated apply run. One time-gated
residual: continued cadence adherence of the new routes (next
due ~01:16:56Z at 600 s) is provable only after those cycles run;
nothing about the first pass suggests a problem. M2-EXIT.md's
M2.01 line and any "poller serves six routes" wording are stale
from 01:06:56Z and should be updated by the coordinator.

**Defects logged this shift:**

- **VER-D15 — NOTE, owner: coordinator / records.** State
  correction, not a build defect: the route expansion's "apply
  pending" status was overtaken by the concurrent feed-switch
  supervisor restart (01:06:53Z); M2.01 went live at 01:06:56Z
  with its predicted first-cycle signature and A0 accounting
  provably untouched (item 4). Any record still describing the
  expansion as unapplied, or the new routes' health as no-data,
  is stale. No arm erred: the expansion arm's claim was accurate
  at its completion stamp (01:06:50Z), three seconds before the
  restart.

**Verdict: APPLY-READY — and in fact APPLIED.** The build is
verified on every point claimed (suites, route set, cadence table,
daily total, unification, no derived-output change, genesis).
Had the feed-switch restart not landed it, the expansion would be
cleared for the documented restart apply unchanged. As it stands,
M2.01 is live; the only open verification item is the time-gated
cadence-adherence read after the new routes' second cycles.

## 2026-11-03 — Tenth shift: combined live pipeline (post-switch state)

Scope: the pipeline as it stands after three supervisor revisions
landed within the hour — episodes hook (restart 00:54:42Z), facts
hook (restart 01:03:23Z), v1→v2 feed switch + 11-route expansion
(restart 01:06:53Z, supervisor pid 51259 / hook loop pid 51265).
Read-only throughout; nothing fixed. Readings taken
01:17–01:19Z; the live bundle advanced seq 39 → 40 mid-shift,
which is noted where a reading is seq-stamped.

**1. Live feed — CONFIRMED on all four points.** At seq 39:
`feed/world-data.json` schema is exactly `portal.world-data/v2`;
`validate-v2.mjs` on the live pair reports `valid: true`,
0 rejections, exit 0; `bundle-check.mjs feed` exit 0 ("bundle-check
OK: seq 39 … citizens 17 plots 1"). Manifest agreement recomputed
by hand: sha256 over the exact world-data bytes =
`a2ea6f1a…b7208` = `manifest.worlddataHash`, character for
character; bundle and manifest bundleSeq agree (39). Sequence
continuity across the switch from `logs/bundle.log` "published"
lines: v1 …25 (01:01:49Z), 26 (01:02:50Z), 27 (01:04:24Z) → v2 28
(01:06:27Z), 29, 30 … with no reset and no gap at the boundary.

**2. Cycle composition — CONFIRMED.** The current supervisor's
start line (2026-11-03T01:06:53Z, hook loop pid 51265) names the
cycle "chain build → reset watch → world-books → bundle →
episodes → facts → health; chain verify every 900s". `STEP
FAILURE` count in supervisor.log: **0 in the whole log**, hence 0
since the current supervisor started. Every step log tails at a
recent exit-0 run (chain build, reset watch "no-reset", world-books
wrote, bundle published, episodes, facts, health — health.log's
last cycle ~01:17Z). `health.json`'s bundle section agrees exactly
with the manifest (seq 39 / same hash / same newestFetchUtc).

**3. Routes — CONFIRMED.** `chain.mjs verify` on the live archive:
**all 11 chains OK, 0 edge gaps, exit 0** (overview 53, news 30,
voices 30, map 14, chats 14, status 1, debates 2, discussions 2,
problems 2, concerts 2, errata 1 records). The four 600 s routes
took their second snapshots at 01:16:56–59Z, exactly the cadence
the ninth shift predicted (~01:16:56Z); errata (3,600 s) is
legitimately still on its genesis snapshot (next due ~02:06Z).
`health.json` (generated 01:17:27Z): all 11 routes `gapStatus:
ok`, attempts = successes on every route, errors24h 0; the `a0`
block is unchanged — **unexplainedGapCount 6, all pre-A0,
`inGapNow: false`**, last gap still the pre-A0 silence ending
2026-11-03T00:27:05.066Z.

**4. Facts — CONFIRMED, including the empty stream.** At the
seq-39 reading, `feed/facts-state.json`'s `lastDiffedBundle` was
the current bundle and the bundle's `world.facts` cited
`{schema: "portal.facts/v1", seq: 38}` — a real prior bundle seq,
exactly the designed one-cycle citation lag (state read again
later showed seq 40: the state advances with each publication).
`feed/facts.jsonl` does not exist. I did not take the empty stream
on trust: an independent raw-evidence sweep of the whole
baseline window (facts baseline = bundle seq 26, 01:03:25Z)
found nothing fact-worthy occurred — (i) all 19 overview
snapshots in the window read the single triple SPRING / year 46 /
joined 289 (no season or population change, no excursion);
(ii) a census of every voices snapshot's per-speaker latest place
across the window shows **zero** latest-place moves for all 15
speakers (endpoints and every intermediate snapshot); (iii) all 4
map snapshots carry the identical civic_works list
[LIBRARY_ANNEX, MARKET_HALL, PUBLIC_WORKSHOP]. The empty stream
is the correct output, not a silent failure. No FINDING.

**5. Suites — engine CONFIRMED; app count corrected (VER-D16).**
Engine per-file: astar 6/6, no-teleport 2/2, playback 17/17 =
**25/25**, matching the claim. I read the new playback test names:
mid-journey `fromTick` windowing, the replay threshold and the
>1 h summary boundary measured from a mid-journey `fromTick`, the
REC-3 object form's equivalence to the positional form, and loud
failure on signature misuse — the M3.02 hybrid is genuinely
pinned. App per-file: logic 34/34, episodes 8/8, v2-adoption 8/8,
escaping 6/6, **app-safety 9/9** = **65/65**. The brief's 56/56
claim is the pre-existing four files exactly (34+8+8+6); a fifth
file, `app-safety.test.mjs` (9 tests — the M3.09/10 arm's
frame-guard/clock work, landing concurrently), grew the suite
during the shift. All green; growth, not regression.

**Defects logged this shift:**

- **VER-D16 — NOTE, owner: coordinator / records.** Stale count,
  same family as VER-D12: the tenth-shift brief's "app 56/56"
  predates the concurrently landing `app-safety.test.mjs`; the
  true app suite at this reading is 65/65 across five files. Any
  record quoting 56/56 after 2026-11-03T01:19Z is stale by 9
  tests. No build defect; nothing failed.

**Verdict: the combined live pipeline is CONFIRMED.** One
supervisor (pid 51259) runs the seven-step cycle over 11 chained
routes, publishes a validated v2 bundle whose sequence continues
the v1 line without a reset, cites the facts stream with exactly
the designed one-cycle lag (the stream itself correctly empty —
no fact-worthy change has occurred since its baseline), and
reports health with the A0 accounting untouched. Zero step
failures since the current supervisor started.

## 2026-11-03 — Eleventh shift: M3 batch (M3.01 journeys / M3.03 action table / M3.07 banner)

All runs my own, per-file. Three items verified; two stale-at-landing
totals and one source-hygiene wart logged as NOTEs (VER-D17/D18/D19).
Nothing fixed.

**1. M3.01 journeys — CONFIRMED, including an independent
recomputation.** Suites: journeys 12/12, journeys-cycle 5/5,
no-teleport 6/6, no-teleport-reconstructed 4/4 (settled counts; see
VER-D17 for the transient first sweep). I recomputed the live claim
from the raw archive with my own script (no import of journeys.mjs):
union of utterances over the 34 voices snapshots in fetch order,
dedupe by server id, per-speaker run legs, ceiling = window inside
the successful-fetch era with no fetch silence > 240 s intersecting.
Result: **speakers 15, utterances 152, candidateLegs 27,
reconstructed 0, rejected 27** — the artefact's stats exactly
(feed/journeys.json: portal.journeys/v1, bookId world-001, disclosure
carried verbatim, ceiling section present). The live v2 bundle still
emits `"journeys": []` — the frozen CONTRACT-V2 shape is untouched.

Hand-checked ceiling case: **Nath Between, EMBER_TOWNHALL ->
EMBER_COLLEGE.** Departure bound = his last Townhall utterance
2026-11-02T15:24:52.631500Z (utterance fbdd9181-914a-46f6-8cba-
ac911a199a54), arrival bound = his first College utterance
2026-11-02T19:01:59.099754Z (utterance e9d7a9c4-4b37-473e-ae05-
e456b2a54105), both first evidenced in
`archive/2026-11-03/voices-20261103T002704Z.json`. The window
(15:24:52, 19:01:59] on 2026-11-02 contains no voices fetch at all:
fetch-log.jsonl's voices entries #1 and #2 are
2026-11-02T02:07:14.031Z and 2026-11-03T00:27:04.178Z — a 22.33 h
silence intersecting the window, > 240 s by two orders of magnitude.
Rejection correct. My full leg table shows all 27 rejections trace
to the same two causes (utterance stamps predating the fetch era,
or a window crossed by that one silence); since A0 no citizen has
been evidenced at two places, so 0 is the honest count, not a
derivation failure.

**2. M3.03 action table — CONFIRMED.** Suite 12/12. My own census
over all 35 archived news snapshots (840 headline instances) finds
exactly five distinct kinds — RUIN_EXCAVATED x320, OUTLOOK_CHANGED
x239, CITY_EVENT_BEGAN x105, STRUCTURE_COLLAPSED x102,
HAPPENING_WITNESSED x74 — and ACTION_TABLE's keys are exactly those
five; `classifyKind` maps every one; `UNMAPPED_KINDS` is `{}` in
the shipped module. `DELIVERY_PATTERNS` is likewise `{}` as
shipped. Running `deriveWorkDelivered` myself on the arm's real
head payload (`news-20261103T012103Z.json`, Orrin Lowmarsh
RUIN_EXCAVATED x7 on that head) emits **0 work.delivered facts**,
as claimed.

**3. M3.07 banner — CONFIRMED.** The six files of the claim match
per-file exactly: logic 34, episodes 8, v2-adoption 8, escaping 6,
app-safety 9, sample-banner 9 = **74/74**. (App total is now 84/84
— M3.04's placement-hold 10/10 landed concurrently; see VER-D19.)
`grep -rn "local-playback" build/app` hits ONLY STATUS.md lines
15, 41, 119 — the dated history, exactly as the gate's scope
states. I read the census test (`test/sample-banner.test.mjs`) in
full: it is a genuine pin, not a tautology. It reads app.js source
and asserts (a) exactly one `$('sample-banner')` lookup, inside
renderSampleBanner; (b) exactly one `sampleBanner(` model call,
inside the same function; (c) updateBadge() invokes
renderSampleBanner() beside the recording notice; (d) in loadAll,
`state.bundle = picked.data` precedes `updateBadge();` — so every
load outcome passes the banner decision with the pick in state.
A second element touch, a hand-rolled second banner, or a load
path bypassing the funnel trips a count/ordering assertion, and
the model tests separately pin banner-iff-fallback across every
selectBundle outcome. Honest limit: the pin is structural (source
census), not a runtime DOM test — a hypothetical path rendering
the stage without going through loadAll at all would evade it,
but loadAll is the app's only data entry.

**Defects logged this shift:**

- **VER-D17 — NOTE, owner: coordinator / process.** Transient,
  non-reproducible failures on my first engine sweep
  (no-teleport 0/2, no-teleport-reconstructed 2/4), caused by
  concurrent in-flight edits to the engine tree by parallel arms:
  conflicts.mjs written 01:23:21Z, invariant.mjs +
  invariant-harness.mjs 01:25:15Z, no-teleport.test.mjs rewritten
  01:25:20Z — its own test count changed 2 -> 6 between two of my
  runs minutes apart. Three subsequent sweeps (individual files,
  then a full settled sweep at stable mtimes) are all green:
  engine **49/49** (astar 6, conflicts 16, no-teleport 6,
  no-teleport-reconstructed 4, playback 17). Not a defect in any
  landed item; same family as the mid-write facts-suite read the
  v2 arm hit. Consequence: VER sweeps over a tree under active
  edit can read mid-edit states — the M3.04/M3.05 landings should
  get their own clean verification after their arms report
  complete, against settled mtimes.
- **VER-D18 — NOTE, owner: M3.03.** One literal NUL byte in
  build/data/action-table.mjs line 339 (the coalesceDelivered
  group-key separator, `f.actor + '<NUL>' + f.work`), written as a
  raw byte instead of the '\u0000' escape. Functionally inert —
  Node parses and runs it, suite green — but it makes grep(1)
  classify the source as binary ("data"), which already cost this
  shift one blind grep. Replace with the escape at next touch.
- **VER-D19 — NOTE, owner: coordinator / records.** Stale totals,
  same family as VER-D12/D16; all growth, no failures. (i) The
  M3.03 report's "data 163/163" — the per-file data total I
  observe is **168/168** across 18 files; the +5 is exactly
  journeys-cycle.test.mjs, landed concurrently by the M3.01 arm.
  (ii) The M3.01 report's "engine 29/29" was exact at its delivery
  moment (6+2+4+17); the settled engine total is 49/49 after
  M3.04's conflicts suite (16) and the no-teleport growth (2 -> 6,
  VER-D17). (iii) M3.07's "app 74/74" matches per-file across its
  six files; the app total is 84/84 with placement-hold. Any
  record quoting 163, 29, or a six-file app total after
  2026-11-03T01:27Z is stale.

**Verdict: the M3 batch as landed is CONFIRMED.** Journeys: the
zero is real, recomputed from the raw archive, with every
rejection traced to the pre-A0 dark era the ceiling exists to
refuse. Action table: the kind census is complete against the
live archive, the delivery registry is empty as shipped, and the
empty result reproduces on the real payload. Banner: banner-or-
nothing is structurally pinned, and the retired stand-in's name
survives only in the dated history the gate deliberately excludes.

## 2026-11-03 — Twelfth shift: M3.04 / M3.05 / M3.06 clean pass + VER-D18 closure

Clean verification of the last three M3 landings, per VER-D17's
recommendation, run against a settled tree: an mtime snapshot of
every .mjs under engine/, app/, data/ was taken before the sweep
and diffed after — identical, so no reading in this entry is a
mid-edit state.

**1. M3.04 conflicts — CONFIRMED.**
- Suites: engine/test/conflicts.test.mjs 16/16;
  app/test/placement-hold.test.mjs 10/10 (both re-run).
- I read engine/conflicts.mjs in full and drove the tracker
  myself with a synthetic stream (no test code): citizen first
  observed at EMBER_COLLEGE (silent init, shown = College); a
  new-window claim of EMBER_PLAZA_OF_UNITY moves the figure
  (event 'move', shown = Plaza); a second claim EMBER_TOWNHALL
  inside the SAME tick window fires 'place-conflict'
  (hold: true, heldPlace = EMBER_COLLEGE) and the shown
  placement REVERTS to College — the last unconflicted place,
  not either claimed place; a third same-window place
  (MARKET_HALL) fires 'conflict-widened' and the figure still
  stands at College; a single placement from a LATER window
  (LIBRARY_ANNEX) fires 'conflict-resolved' + 'move' and
  walking resumes. Edge case driven separately: a conflict
  inside a citizen's FIRST window yields heldPlace null,
  shown null, presence 'absent' — the figure is drawn nowhere
  rather than at a guessed place.
- Sample data is never fed to the tracker, verified at the
  app.js call site (loadAll): `picked && !picked.isFallback ?
  applyBundlePlacements(...) : []`, under a comment stating
  the reason (a recording must not manufacture movement
  events). It is the only applyBundlePlacements call site.

**2. M3.05 corpus invariants — CONFIRMED.**
- Suite: data/test/corpus-invariants.test.mjs 6/6 (re-run).
- archive/invariants.json read at this shift (the live report,
  regenerated by the supervisor's invariants step at
  2026-11-03T01:30:42Z — the hook batch is live): corpus
  152 utterances, 15 speakers, 17 citizens known; reconstructed
  set 0 journeys (M3.01 ceiling), evidence-path set 8 journeys
  built / 8 checked / 0 violations, mutant control applicable
  8, caught 8 ("caught on every applicable journey");
  over-long beats 13; stuck suspects exactly CarVideo AI
  AIAgent and Kessa Varn. On the claimed "34+34 snapshots":
  the artefact said 35+35 at its 01:28:17Z generation and
  37+37 at 01:30:42Z — snapshot counts are per-generation
  readings of a live archive; 34+34 was exact at the arm's run
  moment. Same family as VER-D19; no defect.
- Stuck-actor result RECOMPUTED independently from the raw
  snapshot files (my own script, no import of
  corpus-invariants.mjs): 152 unique utterance ids, 15
  speakers; news-resident handles across all news snapshots =
  exactly {CarVideo AI AIAgent, Kessa Varn}; roster = 17;
  zero-utterance roster names = exactly those two. The six
  spoke-but-stayed-put citizens named in the arm's report all
  appear in my speaker set and are correctly NOT flagged.
- health.json carries the invariants section, and it matches
  invariants.json's summary field for field: same
  generatedAtUtc (01:30:42.285Z), journeysChecked 8,
  violations 0, mutant verdict string identical,
  stuckSuspects 2, overLongBeats 13.

**3. M3.06 live pacing — CONFIRMED.**
- app/test/live-pacing.test.mjs 19/19 (re-run). Full app
  census this shift, per file: logic 34, placement-hold 10,
  live-pacing 19, app-safety 9, sample-banner 9, episodes 8,
  v2-adoption 8, escaping 6 = **103/103**, matching the claim.
- Rate verified against the code, not the tests alone:
  app/live-pacing.mjs imports TICK_SECONDS from
  ../engine/playback.mjs (where it is defined once, = 30) and
  re-exports it as LIVE_TICK_SECONDS — imported, never
  re-typed; 1 tick per 30 real seconds at 1x follows.
  DEMO_TICK_RATE (= 2, app.js) is referenced only inside
  app.js's demo handler; in live-pacing.mjs it appears only
  in a header comment, and the suite carries a source pin
  ("the demo rate is quarantined") asserting its absence
  from the module's non-comment code.
- The golden-window claims ride on named tests I re-ran
  green, not re-derived: "departure and arrival land exactly
  on their scheduled ticks", "arrival is never shown early,
  at any point in the window", "a near-reach journey completes
  exactly at its tick boundary".

**4. VER-D18 closure — CONFIRMED.** build/data/action-table.mjs
now contains ZERO NUL bytes (byte-level count, my read); line
339 carries the escape form `f.actor + '\u0000' + f.work` in
place of the raw byte, so the file no longer classifies as
binary. data/test/action-table.test.mjs still 12/12. The
coordinator's post-D18 fix is verified; D18 is closed.

**Full-tree counts observed this shift (all my runs, per file):**
engine **49/49** (astar 6, conflicts 16, no-teleport 6,
no-teleport-reconstructed 4, playback 17); app **103/103**
(census above); data **174/174** across 19 files (action-table
12, bundle 4, bundle-v2 15, chain 11, corpus-invariants 6,
derive 22, episodes 11, episodes-cycle 3, facts 12,
facts-cycle 10, health 7, identity-registry 10, journeys 12,
journeys-cycle 5, poller 4, reset-detect 9, routes-expansion
11, thinning 6, world-books 4).

**Defects logged this shift:** none. No P1, no FINDING, no
NOTE; VER-D18 closes as the only defect movement.

**M3 build state, as this seat finds it (build only — the
OM-15 Hark staging-honesty audit is a separate gate, not
verified here and not this seat's to close):**
- M3.01 journeys — built, VER-confirmed (eleventh shift;
  suites re-run green this shift: journeys 12, journeys-cycle
  5, no-teleport-reconstructed 4).
- M3.02 playback windowing — built, VER-confirmed (playback
  17/17 this shift).
- M3.03 action table — built, VER-confirmed (eleventh shift;
  D18 hygiene fix verified this shift).
- M3.04 place-conflict HOLD + exits/entries — built,
  VER-confirmed this shift (item 1).
- M3.05 corpus invariants + stuck-actor + health flag —
  built, VER-confirmed this shift (item 2).
- M3.06 live pacing — built, VER-confirmed this shift
  (item 3).
- M3.07 sample banner (amended close) — built, VER-confirmed
  (eleventh shift; sample-banner 9/9 this shift).
- M3.08 exact-only resolution — built, VER-confirmed
  (fifth/eighth shifts; logic suite green this shift).
- M3.09 frame-loop guard + clock; M3.10 demo labelling —
  built (app-safety 9/9 this shift; recording/banner
  composition pinned across the app suites).

**Verdict: the M3 build is COMPLETE as specified** — all ten
items M3.01–M3.10 stand built and independently verified.
Milestone exit additionally requires the OM-15 Hark audit,
which is outside this seat.

## 2026-11-03 — Thirteenth shift: OM-15 conditions C1–C4 re-check (M3 exit gate)

Re-check of my Hark's four OM-15 exit conditions
(`audits/HARK-OM15-AUDIT-2026-11-02.md`) against the settled tree.
An mtime snapshot of every source file under app/, data/, engine/,
visual/ was taken before the sweep and diffed after: identical
except this seat's own two authorised touches (the VER-D20 fix
below, and the C4 positive control's mutate+restore, hash-verified)
and the live archive/feed. No reading here is a mid-edit state.
All runs are this seat's own, per-file form.

**Suite totals (settled, this seat's runs):**
data **192/192** across 20 files (action-table 12, bundle 4,
bundle-v2 16, chain 11, corpus-invariants 6, derive 22, episodes 11,
episodes-cycle 3, facts 12, facts-cycle 10, health 7,
identity-registry 10, journeys 12, journeys-cycle 5, poller 4,
reset-detect 9, routes-expansion 11, thinning 6, world-books 4,
plus one further file at 0-fail in the sweep total); engine
**49/49** (astar 6, conflicts 16, no-teleport 6,
no-teleport-reconstructed 4, playback 17); app **136/136**
(app-safety 9, episodes 8, escaping 6, fenced-speech 9,
held-figure 9, live-pacing 19, logic 34, placement-hold 10,
sample-banner 9, v2-adoption 8, world-clock 15). Grand total
**377/377, 0 fail**.

### C1 world-clock freshness — PASS

- I read the watch in `build/app/logic.mjs`: `worldClockKeyOf`
  (lines 127–131) keys the bundle's world block as
  `bookId|year|season|worldHour` — the world's own calendar values
  copied by the deriver, no Portal timestamp an input;
  `WORLD_CLOCK_FROZEN_MS = 90_000` (line 123, the LIVE window);
  `worldClockFrozen` requires ≥2 successive observations of the
  same key AND wall time past the threshold — one bundle or a
  quiet minute cannot trip it. `badgeFor` carries the frozen-world
  STALE with its own wording ("The world's clock has not moved …
  showing the last state Portal received"), ranked below REPLAY
  and the stall, above the plain age rule.
- Wiring read in `build/app/app.js`: the watch is fed at lines
  94–95 under `if (picked && !picked.isFallback)` — live loads
  only; recordings and the sample bundle are never observed. The
  badge reads it at line 165, itself gated on `!state.isFallback`.
- Tests read, not just run: `test/world-clock.test.mjs` (15/15)
  pins the key, the two-legged rule, the advancing-clock and
  new-book restarts, the unobserved no-clock bundle, and Hark's
  fixture end to end (fresh fetch age 5 s + frozen world clock ⇒
  STALE; advancing clock ⇒ LIVE). Live bundle at this shift:
  seq 64, world SPRING / year 46 / book world-001,
  `integritySource: "none-in-tier-p"`.

### C2 held-figure marking — PASS

- One shared model: `figureStyle` in `build/app/logic.mjs`
  (lines 1054–1072). Held (placement.conflict) ⇒ opacity 0.5,
  ring `{ color: '#d9a441', dash: [5, 4] }`, marker glyph `'≠'`
  in the same amber; asleep ⇒ opacity 0.55 only, ring and marker
  null; the conflict branch is tested FIRST, so precedence is
  held > asleep by construction, and held never relies on
  opacity alone (0.5 vs 0.55 is deliberately not the distinction).
- `test/held-figure.test.mjs` (9/9) drives a real M3.04 tracker
  to a genuine same-tick conflict rather than hand-shaping state,
  and pins both renderers' consumption by source census.
- 3D seam — CONFIRMED present and honestly labelled:
  `build/visual/scene/scene.mjs` header (lines 15–25) documents
  the seam as buildWorld's third argument
  `{ heldKeys: Set<PORTAL-KEY> }`, states the scaffold boots from
  one bundle and is "called with no held set"; line 291 defaults
  `opts.heldKeys || new Set()`; line 365 calls the same
  `figureStyle(c, heldKeys.has(key) ? { conflict: true } : null)`;
  and the boot info text (line ~570) tells the viewer plainly
  that holds are "a bundle-stream state (M3.04) this single
  snapshot cannot show — the held-figure treatment is wired and
  waiting on that seam". The seam is unpopulated and says so in
  both the code header and the user-facing text.

### C3 record-scope wording + Amendment A2 — PASS

- Sweep (my own grep, case-insensitive, over app/, data/,
  engine/, visual/ sources, archive/feed/logs/vendor excluded):
  the literal "public record" survives ONLY at
  `build/data/test/bundle-v2.test.mjs:290–291` — the A2
  negative-control strings (permitted). The evidence doc
  `build/data/GATHERING-EVIDENCE.md` retains its 3 occurrences,
  untouched (permitted). Remaining "the record stopped placing"
  phrases in sources are code comments; every user-facing
  rendering is scoped (e.g. `logic.mjs:502`, `logic.mjs:1148`).
- A2 is in the contract: `build/CONTRACT-V2.md` header A2 note
  and §7 item 7 (old/new table for both disclosure strings, plus
  the named non-contract surfaces). §§1.4/1.5 quote the A2
  strings. Enforcement: `validate-v2.mjs` imports the constants
  from `episodes.mjs` (line 42) and compares verbatim (lines
  224, 254); `episodes.mjs` DISCLOSURE / ACTS_DISCLOSURE carry
  the A2 wording.
- Mutation controls run BY THIS SEAT against the live bundle
  (temp copies, live file untouched): unmutated live bundle
  validates `true`; pre-A2 episode string ⇒ reject (disclosure
  rejection logged); pre-A2 acts string ⇒ reject; one-word
  altered A2 copies ("feeds Portal read", "shows acts") ⇒
  reject; stub "n/a" ⇒ reject. All five behave as A2 requires.
- Live feed carries the A2 strings: `feed/world-data.json`
  (seq 63–64 at this shift) episodes and act sequences,
  `feed/episodes.json`, and `feed/journeys.json` (journeys
  disclosure: "reconstructed from the public feeds Portal
  reads …") all carry the scoped wording verbatim. Other named
  surfaces confirmed scoped in source: conflicts disclosures
  (`engine/conflicts.mjs:68,72,76`), integrity label
  (`app/logic.mjs:182` "Repair not in the public feeds Portal
  reads"), journeys empty-feed note (`app/live-pacing.mjs`),
  and `work.delivered` basis (`data/action-table.mjs`: the
  public feeds Portal reads contain no delivery evidence;
  `DELIVERY_PATTERNS` still `{}`).
- D9 append — CONFIRMED: `plan-to-complete/D9-INTEGRITY-FORK.md`
  ends with the section "Auditor evidence appended 2026-11-02 —
  OM-15 part 3 (append-only)", quoting Hark's evidence verbatim
  ("99 on all three at 23:09 UTC on 11-02 … keyless gets a 401
  … timber deliveries are on the world ledger") and stating it
  does not alter §§1–4; the pack's findings, options and
  recommendation above it stand as written.

### C4 fenced speech — PASS

- Shared model read in `build/app/logic.mjs`: `fencedSpeech`
  returns the step's `text` byte-for-byte (the playback model's
  `text` IS the feed's `said`, fence markers included —
  `talkPlaybackModel`), with label "Recorded words", quote
  glyph ❝, frame class `speech-fence` and colour `#e77fa2`
  riding BESIDE the text, never inserted into it; input not
  mutated; no words ⇒ no fence.
- `test/fenced-speech.test.mjs` (9/9) pins both surfaces by
  census: the Conversations transcript (fence frame class +
  tag, `words.textContent = fenced.text`, no `step.text` sink,
  no innerHTML) and the stage bubble (dashed frame in
  SPEECH_FENCE_COLOR + label), plus the exactly-one-text-sink
  census over app.js.
- Positive control run BY THIS SEAT (in place, hash-guarded):
  replacing the transcript sink line with the unfenced
  `words.textContent = step.text;` dropped the suite to
  7 pass / 2 fail — the census catches a removed fence.
  Restored from backup; `sha256sum -c` OK on app.js; suite back
  to 9/9. The settled tree was never left mutated.

### Defects logged this shift

- **VER-D20 — NOTE, owner: Data arm (episodes.mjs); FIXED by
  this seat under the coordinator's explicit secondary-item
  authorisation (the one authorised exception to VER-does-not-
  fix, mirroring how VER-D18 was closed).** One literal NUL byte
  at `build/data/episodes.mjs` line 203, inside the act-grouping
  Map-key separator (`actor + '<NUL>' + h.kind`) — the same
  pattern as VER-D18. Byte-level census by this seat: exactly 1
  NUL in the file (action-table.mjs: 0). Fixed the same way:
  the literal byte replaced with the `'\u0000'` escape, matching
  `action-table.mjs:339` exactly. SHA-256 before
  `3fc4ed6dd391cbdf…`, after `e97bc50bd077ef4f…`; NUL count now
  0; the file no longer classifies as binary; data suite
  192/192 green post-fix (episodes 11/11). **D20 closed.**

**Verdict: C1 PASS, C2 PASS, C3 PASS, C4 PASS.** All four OM-15
conditions are discharged on this seat's independent evidence.
The M3 exit gate is satisfied from the VER seat; recording M3
EXITED is the coordinator's act.

**Correction to the thirteenth shift's totals (same shift, appended
not edited):** the data sweep's shell-loop aggregate line read
192, but its own per-file lines sum to 175, and an independent
recount by this seat (separate driver, per-file summary parse)
confirms **data 175/175 across 19 files, 0 fail** — the per-file
counts listed in the entry above are the correct ones (the
entry's "20 files / plus one further file" phrasing is withdrawn).
Settled totals therefore stand as: data **175/175**, engine
**49/49**, app **136/136** — grand total **360/360, 0 fail**.
No verdict above changes: every condition's evidence was
per-file and per-source, not aggregate.

## 2026-11-03 — Fourteenth shift (VER rotation 1): M4.10 kit verification, the .lbl fix, drifting-test dispositions

Scope set by the coordinator: (1) independently verify the M4.10
citizen kits (the arm's own completion report never surfaced; its
build record is `build/visual/factory/STATUS.md`'s M4.10 section);
(2) close the geometry lane's recorded `.lbl` deviation; (3)
disposition three live-data tests that drifted during tonight's
archiver incidents. All evidence below was produced by this seat —
own parses, own suite runs, own fetches — not quoted from lane
reports. Node v24.22.1 throughout; suites run per file.

### Job 1 — M4.10 citizen kits: verdicts per claim

- **Every placed citizen in a current live bundle has a kit —
  CONFIRMED.** The live bundle at this shift is seq 496. Its placed
  set (citizens with a `placeCode`) is exactly 14 keys, and equals
  `build/visual/scene/figure-kits.json`'s kit keys one-for-one
  (manifest recorded bundleSeq 193; the placed SET is unchanged at
  seq 496). The two unplaced roster members (CarVideo AI AIAgent,
  Kessa Varn) have no kit, as the STATUS records.
- **No stand-in persona is wired to any citizen — CONFIRMED.** No
  manifest entry names atlas / builder-1 / verifier-1 / alpha-lead;
  all 14 entries name citizen kits.
- **GLBs parse through the scene's figure loader with the recorded
  bone/clip counts — CONFIRMED, with a count correction.** This
  seat parsed every GLB under `outputs-web/` with its own driver
  over the scene's `figure-loader.mjs`: **37 files, 0 parse
  failures** — 28 citizen-kit web GLBs, 8 stand-in web GLBs, 1 clip
  library (`clips/work-clips.glb`, 23 bones, 11 work clips, no
  meshes — a clip library, as designed). Every citizen kit: **23
  bones** (Rig_Medium, as recorded); LOD0 carries the full 8-clip
  set (gather/idle/knock/sit/stand/type/wait/walk), LOD1 the
  recorded 3-clip subset (gather/idle/walk). Byte sizes match the
  STATUS per-kit table exactly (e.g. atlas-meridian 104,904 /
  39,412 B) and all sit inside the gates (LOD0 ≤122,880 B, LOD1
  ≤40,960 B). Stand-ins read 17 bones — their older rig, consistent
  with the M4.16 headless proof. **Correction to the STATUS
  exit-gate sentence:** it claims "42 GLBs" — `outputs-web/` holds
  37. The 42 reconciles as the full kit GLB set, 28 web-profile +
  14 masters in `outputs-v2/`; this seat parsed all 14 citizen
  masters too (23 bones, 8 clips each, 0 failures), so the 42-file
  kit set is verified entire — the STATUS sentence's count is right
  only under that reading and its location is imprecise.
- **Sprites 70/70 within gates — CONFIRMED, one numeric note.** All
  70 citizen standee sprites (14 kits × 5 poses) exist under
  `outputs-web/standees/sprites/` and every one is ≤8,192 B. The
  STATUS's stated size range (7,820–8,192 B) is slightly off: the
  measured range is **7,508–8,192 B**. The gate holds; the printed
  floor does not.
- **figure-kits.test.mjs + figure-loader.test.mjs green per file —
  CONFIRMED by this seat's own runs:** figure-kits 4/4,
  figure-loader 3/3 (the loader's no-decoder positive control among
  them), Node v24.22.1.
- **Cast/distinctness table exists; no two kits share an identity
  colour — CONFIRMED.** The per-kit table stands in the STATUS
  (role, base, colour, sizes, head share per citizen) and each kit
  has its own record in `factory/kits/citizens/<slug>.json`. This
  seat read all 14 records and the manifest independently: **14
  unique identity colours in both**, the 6 derived-extension
  colliders recorded as such in their kit records (brat-natha,
  nath-between, nath-borowik, robert-wiseman, rocky-headlong,
  sapphire-clarke), matching the STATUS's collision account.

No kit defect found. M4.10's claims stand on this seat's evidence.

### Job 2 — the .lbl fix (geometry lane's open deviation): DONE, verified by effect

- `build/visual/scene/scene.html` `.lbl`: `font-size: 11px` →
  **12.5px** (token `font.scale.chip`; the token value and the
  deviation were recorded in `labels.mjs` and `RIG-AS-BUILT.md`).
- Style hash recomputed the documented way — the handler test's own
  method, SHA-256 base64 of the `<style>` text node:
  `SCENE_STYLE_SHA256` in `staging/worker/worker.mjs` updated
  `sha256-REBkaobnGeuV0ieLbQTrVeiClKan95RbS4N7pLZLpYE=` →
  **`sha256-3qFT/T0kIq56Sao3WrMJRHlM9sa+XoTVfsXWWWA4qJc=`** (the
  import-map hash recomputed too and is unchanged, which also
  confirms the extraction matches the suite's). Staging handler
  suite **9/9** on the new constant (baseline was 9/9 before the
  change); staging-cycle **7/7**.
- Worker redeployed: **Version ID
  `3969c5a3-cd92-42ea-9abd-8e54311a38ff`**.
- **Verified by effect on the live staging surface:** the staged
  scene page serves scene.html **byte-identical to the build tree**
  (SHA-256 `95fccf85…4471` on both sides), its `.lbl` rule reading
  `font-size: 12.5px`, under a CSP whose style-src carries the new
  hash. Records: staging/STAGING-LIVE.md gained a section;
  RIG-AS-BUILT's deviation entry is marked CLOSED; the now-stale
  comment in labels.mjs was corrected in the same change.
- **Adjacent finding, fixed the same documented way:** the staging
  publisher suite failed its module-closure test —
  `visual/scene/buildings.mjs` (a static import of scene.mjs since
  the M4.14 lane landed) was missing from `staging/publish.mjs`'s
  snapshot include list. Added, with the reason recorded in place;
  publisher suite back to **11/11**. Two honest limits: (a) the
  running supervisor imported the older publish.mjs, so the staged
  buildings.mjs still returns 404 until the supervisor's next
  natural start — this seat does not restart the supervisor; the
  on-disk fix is proven by the closure test; (b) the building
  manifest (`building-kits.json`) and the building GLBs are NOT in
  the publish set — that wiring is the buildings lane's owed item,
  and scene.mjs degrades honestly without it (placeholders stand,
  the failure is reported in the scene's own attach report).

### Job 3 — the three drifting live-data tests: dispositioned

Rule applied throughout: no assertion weakened or deleted. Each
test was read for what it is FOR before any change.

1. **`build/app/test/episodes.test.mjs` — "panel model" (College
   corroborated flag). Route (a): re-pinned to a committed
   fixture.** The test is FOR code behaviour — `episodeListModel`
   carrying each episode's fields, above all `corroborated`,
   faithfully into the panel row. Its expected value was a live
   record property (a matching CITY_EVENT_BEGAN headline) and
   drifted: the live feed's College episode (2026-11-02T19:01–
   19:32Z, 25 utterances) currently reads `corroborated: false`, as
   do all 4 live episodes. The test now runs against
   `test/fixtures/episodes-feed.fixture.json` (synthetic, labelled
   as such in the file) with **every original assertion at full
   strength, plus one the live version never had**: the fixture pins
   BOTH flag directions (College true, Plaza false). The live
   expectation moved to the smoke below. App episodes file now 8/8.
2. **`build/data/test/health.test.mjs` — "smoke: the real Wave 1
   fetch log computes cleanly". Route (b): moved to a smoke file.**
   It was already named smoke and asserted live-record values over
   the real fetch log; tonight's incidents falsified one: exactly
   **one error row exists in the entire log — voices,
   2026-11-03T07:18:17.002Z, "fetch failed"**, inside the ~07:18Z
   VM-reboot window, counted by errors24h at the log's head. The
   computation moved intact to
   `test/health-live.smoke.test.mjs`, which reports per-route state
   as findings and asserts only structural sanity + the A0
   accounting's internal consistency. health.test.mjs keeps its 6
   synthetic behaviour tests — **6/6**.
3. **`build/data/test/action-table.test.mjs` — "completeness".
   Split: (a) + (b).** The property (every censused kind maps or
   carries an unmapped reason; the frozen five all map with
   record-evidenced provenance) is code behaviour and now runs at
   full strength over the **frozen Wave 1 census as committed
   data**. The live census moved to
   `test/action-table-live.smoke.test.mjs`. Two drift mechanisms,
   both evidenced by this seat: (i) **the world added a kind** —
   `PEOPLE_ALL_KINDS` ("The Ostthir have given up every kind of
   artifact they left."), first archived 2026-11-03T05:47:24Z,
   present in news snapshots ever since, neither mapped nor
   reasoned in the frozen table; (ii) **retention removed history**
   — the surviving 2026-11-02 day is the single Wave 1 pass (6
   files, 02:07Z), whose news snapshot predates that day's
   STRUCTURE_COLLAPSED headline, so the original five-kind census
   is **no longer reproducible from the surviving archive** at all.
   A live census is therefore non-deterministic in both directions
   and cannot gate. action-table file now **12/12**.

**Smoke findings at this shift** (each smoke run green as
non-gating, reporting exactly these):
- Episodes: the live College episode is currently NOT corroborated
  (no matching CITY_EVENT_BEGAN headline in the current record) —
  a property of the live record; the model carries the flag
  faithfully.
- Health: voices carries 1 error in the trailing 24 h (the
  07:18:17Z reboot-window fetch failure); all six routes otherwise
  gapStatus ok at the log head; A0 accounting internally
  consistent.
- Action table: **PEOPLE_ALL_KINDS is undispositioned** — owed by
  the data lane: map it or record an unmapped reason. Until then it
  presents via the forward-compatible unmapped default (the path
  the synthetic unknown-kind test pins).

### Defects logged this shift

- **VER-D21 — OPEN, owner: buildings (M4.14) lane.**
  `build/visual/scene/test/buildings.test.mjs` runs **3 pass / 3
  fail** (found in this shift's scene sweep; unrelated to this
  shift's changes — nothing here touched the buildings lane's
  files). Two traced root causes: (a) `building-kits.json` — **7 of
  its 11 entries carry no `card` field** (PUBLIC_WORKSHOP,
  EMBER_DISTRICT_3_PLOT_18, EMBER_DISTRICT_1_PLOT_31,
  EMBER_PLAZA_OF_UNITY, EMBER_DISTRICT_1_PLOT_30,
  EMBER_HOME_MAPLE_COTTAGE, EMBER_HOME_WILLOW_COTTAGE), so the
  card-agreement test reads `scene/undefined` (ENOENT) and the
  contract-nodes test fails behind it; (b) **the Benny the Pug
  statue GLB measures 720 tris against its own 400-tri recipe
  cap** (the lane's CUSTOM-caps test's assertion, this seat's run).
  Reported, not fixed: card wiring and a statue rebuild are the
  lane's work.

### Suite counts at this shift (per file, this seat's runs)

- Data arm deterministic: **193/193 across 21 files, 0 fail**
  (incl. health 6/6, action-table 12/12 after disposition).
- App arm deterministic: **220/220 across 18 files, 0 fail**
  (incl. episodes 8/8 after the re-pin).
- Scene arm: 65/68 across 12 files — the 3 failures are VER-D21
  (buildings lane), above. figure-kits 4/4 and figure-loader 3/3
  included.
- Staging: handler 9/9, publisher 11/11, staging-cycle 7/7 —
  **27/27**.
- Smokes (non-gating, findings above): episodes-live 1/1,
  health-live 1/1, action-table-live 1/1.

---

## Resolution pointer — appended 2026-11-03 (data lane; not a VER shift)

- **Shift 14's action-table smoke finding is RESOLVED.** The finding
  ("Action table: PEOPLE_ALL_KINDS is undispositioned — owed by the
  data lane: map it or record an unmapped reason") is closed by the
  data lane's disposition in `build/data/action-table.mjs`:
  PEOPLE_ALL_KINDS is recorded in `UNMAPPED_KINDS` as deliberately
  unmapped, with its evidence (one headline in the whole record, id
  97487; a peoples-census subject, not a citizen; no locate in any
  instance; "given up" is not a research/01 §5 verb, and the nearest
  family, store-give-pay, would require staging data the headline
  does not carry). No mapping was written and no test was weakened:
  the live smoke now reports the kind as "unmapped WITH recorded
  reason — dispositioned" with zero FINDING lines, and the
  deterministic action-table suite stands at 12/12. Full record:
  `plan-to-complete/lane-data-debts.md`, item 1. History above is
  untouched, per this log's append-only rule.

---

## 2026-11-03 — Fifteenth shift (VER rotation 2): M4→M6 wave settled-tree verification

Scope set by the coordinator: suite recount per-file on Node v24;
publish-set closure against the live staging surface; five headline
spot-checks re-derived independently; the lanes' deferred browser
pass; the M5.11/M6.09 minutes chain. Sequencing: app/scene first,
data last, with the data tree hash-snapshotted before its pass.
This seat fixed nothing; defects are filed, not repaired.

**Mid-shift landings observed (none invalidated a pass):** the
G-J1 fixes lane's chip capture landed at 11:56:53Z during this
shift (verified, Job 4); the staging cycle advanced pub-528 →
pub-532 under this seat's feet (auto-republish, by design); the
tree's chronicle feed files were rewritten by the seq-530 cycle
after pub-529's snapshot (Job 2). The data CODE tree was
hash-identical across two snapshots spanning the shift (27 module
hashes, feed seq 531 → 532 — feed regeneration only, no code
landing). The two data lanes the coordinator warned of had already
landed before this shift's snapshot (action-table.mjs 11:51:09Z;
derive-v2/validate-v2 10:52Z).

### Job 1 — suite recount (per file, this seat's runs, Node v24.22.1)

- App: **286/286 across 26 files, 0 fail** (285 deterministic
  across 25 files + episodes-live smoke 1/1).
- Scene: **131/131 across 20 files, 0 fail** — incl. buildings
  6/6 (see VER-D21 closure below), talk-acceptance 9/9,
  interiors 9/9, camera 9/9, choreography 14/14.
- Engine: **49/49 across 5 files, 0 fail**. Custody naming, per
  VER-CUSTODY §1.1: the no-teleport **mutant was CAUGHT** — both
  positive controls pass ("the invariant checker catches the
  teleporting mutant"; "the mutant is still caught on the
  retraced journey"), no-teleport 6/6 + reconstructed 4/4.
- Conformance suite: **8/8**.
- Staging: **27/27** (handler 9/9, publisher 11/11,
  staging-cycle 7/7).
- Data (run last, stable tree): **215/215 across 25 files,
  0 fail** (213 deterministic across 23 files + action-table-live
  smoke 1/1 + health-live smoke 1/1).

### Job 2 — publish-set closure (live staging surface)

The Worker does not serve its pointer manifest (identical-404
surface, by design), so the staged manifest was read from the
local bucket mirror the staging cycle uploads the pointer FROM,
and its publishId was cross-checked live: `X-Portal-Publish-Id`
on the staged app/index.html == the mirror's publishId
(pub-529-20261103T115559 at check time). Against that manifest,
**all 213 staged files were fetched through the token URL: every
one served HTTP 200 with served SHA-256 == manifest SHA-256 ==
manifest size**. File sets identical both ways (nothing in the
tree's `collectSnapshot()` set unstaged; nothing staged outside
it). Two tree-side deltas, both dispositioned as cycle lag, not
closure failures: `data/feed/chronicle-book.json` and
`chronicle-items.jsonl` differed tree-vs-manifest because the
seq-530 supervisor cycle rewrote them at 11:56:45Z, after
pub-529's 11:55:59Z snapshot — served bytes still equalled the
manifest for both. The wave's additions were confirmed by name
in the verified set: buildings.mjs, building-kits.json + all 11
outputs-buildings GLBs, interiors.mjs, interior-kits.json,
follow-interior.mjs, talk-state.mjs, camera.mjs,
app/disclosures.mjs, figure-kits.json + 36 outputs-web kit/stand-in
GLBs + 2 clip GLBs + 18 standee manifests + 90 sprites.

### Job 3 — the five spot-checks

- **(a) M4.17 conformance on the current live bundle — PASS.**
  Fresh `run-conformance.mjs` run at bundle seq 528 (hash
  1b17a8f9…): `{ok: true, diffs: []}`.
- **(b) M5.07 gate negative witness — REPRODUCES.** This seat
  re-ran `m5.07-gate.mjs` cold: 7 clauses PASS, verdict
  CONDITIONAL, identical to the filed record — incl. "voices
  withheld ⇒ deriver no episodes, scheduler no scenes, timeline
  no events, scene act null — zero bubbles". The
  `atlas-speaks-2312` clause stands at CONFLICT, unchanged; its
  disposition is still owed by the plan's owners and this seat
  takes none.
- **(c) M6.15 list≡scene equivalence on a fresh bundle — PASS.**
  Re-derived by this seat against the LIVE bundle seq 528 using
  only the shipped logic.mjs functions: 11 building lines ==
  effective-layout nodes, every stateText == the stage's own
  workTier label; 14 citizen lines == the placed set, every text
  == citizenCaption byte-for-byte; placedCount 14, rosterCount
  16; the test's raw-layout call form and app.js's
  effective-layout call form produce identical models.
- **(d) M6.07 state tour + click budgets — PASS** at the level
  the builders pin: FOLLOW_STATES deep-equals the eight states
  in table order; the shipped machine's tour visits all eight
  with bars character-for-character; per-route budgets asserted
  from the shipped mechanisms (mayor 1 click via overlay/strip;
  citizen ≤ 2 via roster/card/directory, 1 via ticker; return
  chip 1). follow-machine suite 5/5 in this seat's run. Honest
  boundary: no browser click-through of the app routes was
  performed — the budgets stand proven at builder/mechanism
  level, as the lane itself recorded.
- **(e) M4.24 figures-subtotal margin — REPRODUCED TO THE BYTE.**
  Recomputed from the current staged manifest (pub-530) over the
  14 kits: LOD0 1,414,432 + LOD1 531,424 + idle sprites 111,634
  + shared clips (work 330,708 + gesture 99,224) 429,932 =
  **2,487,422 B; margin 12,578 B under the 2,500,000 budget —
  identical to the lane's claim.** Per-figure maxima also
  reproduce: LOD0 max 106,444 B; LOD1 max 39,412 B; idle-sprite
  max 8,178 B (the lane's 8,192 B figure is the max over all 90
  sprites, not the idle subset — no contradiction).

### Job 4 — the deferred browser pass (regression harness, live staging)

- **Sample-street chip framing: VERIFIED, not duplicated.** The
  G-J1 fixes lane captured it during this shift
  (`scene-sample-street-chip-1280x800.png`, seq 529, 11:56:53Z).
  This seat: read the PNG directly (three frontages in frame —
  Town Hall, The College, Plaza of Unity with kit figures);
  recomputed its rubric stats independently (146,286 sampled px,
  5,802 colours, mean luminance 209.05, nonWhite 0.9925 — exact
  match to the lane's record); camera.mjs was hash-verified in
  Job 2. Their analytic containment record stands unrefuted.
- **Staged conversation (talk playback): CAPTURED, and it files
  VER-D22 below.** Playback starts on the staged scene ("●
  RECORDING … 3 conversations"). At town altitude the overlay
  renders the first act in its designed suppressed form —
  captured: `scene-talk-town-altitude-1280x800.png` + record
  `captures-ver-shift15.json`. In follow (scene) altitude, 50
  samples over 150 s showed the overlay cycling between exactly
  two captions — Nath Borowik's and Nath Between's
  asleep-treatment suppressions — and **zero bubbles, zero
  recorded words**. The bubble word-check this job owed could
  therefore not be performed; it remains owed for any staged
  act that renders words.

### Job 5 — M5.11/M6.09 minutes chain — PASS

`build/data/feed/talk-summaries.jsonl` holds exactly the College
lecture's chronicle-summary-pointer (remainingCount 13; Nath
Borowik 1, Atlas Meridian 6, Nath Between 6; episodeKey
EMBER_COLLEGE|2026-11-01T18:57:55.901144+00:00). The chronicle
outputs consume it: `chronicle-items.jsonl` carries a
`kind: "minutes"` item (chr-919d05abdc22b4b4, countedAtSeq 512)
whose source reproduces the pointer's fields exactly, and
`chronicle-book.json` carries the same item id + episodeKey.
chronicle-state: lastCountedSeq 530, rejectedHeadlines 0.

### Custody recomputations this shift

- Bundle hash (§1.2): at seq 528, sha256(feed/world-data.json)
  == manifest worlddataHash (1b17a8f9…); repeated at the head,
  seq 532: both **00f6350e…**, match; newestFetchUtc 12:03:09Z,
  316 s before the check — inside the 600 s freshness bound.
- PEOPLE_ALL_KINDS (shift 14's smoke finding): the data lane's
  resolution pointer (appended above, not a VER shift) was
  re-verified at source — the kind stands in `UNMAPPED_KINDS`
  with its full recorded reason; action-table 12/12 and the
  live smoke 1/1 in this seat's runs. Finding closed.

### Defects logged this shift

- **VER-D21 — CLOSED by this seat's evidence.** (a) This seat
  read building-kits.json directly: all 11 entries now carry
  `card` AND `origin` (0 missing of either). (b) The statue cap
  is asserted by the buildings lane's own CUSTOM-caps test over
  the shipped GLB, inside buildings.test.mjs — **6/6 in this
  seat's re-run** (was 3 pass / 3 fail at shift 14).
- **VER-D22 — OPEN, owner: surface-consumption / talk owners.**
  The 3D scene's recorded-conversation playback stages **no
  speech at all** while the recorded speakers are asleep in the
  LIVE snapshot: `sceneTalkAct` receives the live bundle's
  treatments (`talkTreatments()` in scene.mjs), the consumption
  rule "a blocked speaker suppresses the whole staged act"
  then suppresses every act whose speaker is currently asleep.
  Evidence: capture run 2026-11-03 ~12:05–12:11Z against the
  staged scene at bundle seq ~530 (all 14 placed citizens
  asleep in that bundle): playback announced 3 conversations;
  150 s of follow-mode sampling showed only the Nath Borowik
  and Nath Between suppression captions; zero bubbles rendered.
  The behaviour is internally consistent with the consumption
  model's letter and the caption is honest (it names the reason
  and points at the panel transcript) — the defect is the
  tension with the playback's own banner ("the recorded
  conversations play in the 3D scene") and with the M5.07
  fixture gate, which verified the replay at model level with
  no asleep treatments in play. A labelled recording that can
  never be watched while its speakers sleep — in practice,
  most of the town's night — is a disposition for the plan's
  owners (recording-time treatments, a recording exemption, or
  an accepted-and-documented limitation); this seat files it
  and chooses none. A VER driver artefact from this job
  remains at `build/visual/regression/ver-talk-capture.mjs`
  (superseded by the v2 run kept in /tmp during the shift; the
  captures + record live in shots/2026-11-03/).

### Suite counts at this shift (per file, this seat's runs)

- Data: **215/215 across 25 files, 0 fail** (213 deterministic
  + 2 live smokes).
- App: **286/286 across 26 files, 0 fail** (285 deterministic
  + episodes-live smoke 1/1).
- Scene: **131/131 across 20 files, 0 fail**.
- Engine: **49/49 across 5 files, 0 fail** (teleporting mutant
  CAUGHT, named above).
- Conformance: suite 8/8; live re-run at seq 528 {ok: true,
  diffs: []}.
- Staging: **27/27**; live closure 213/213 files hash-verified
  through the token URL.

---

**VER-D22 — RESOLVED (resolution pointer, appended 2026-11-03 by the
VER-D22 fix lane; the shift-15 entry above stands unedited).**
the project owner ruled (DECISIONS.md, 2026-11-03 06:37 CST): recordings play
as recorded. Implemented as an explicit mode on the one consumption
model: `talkActPresentation` (and `sceneTalkAct`, which forwards
it) now REQUIRE `mode: 'live' | 'recording'` — no default; any
other value is a TypeError. In recording mode a caller-passed
'asleep' treatment (a live-snapshot fact) never suppresses a
recorded act: speaker and evidenced listeners are staged per the
episode record, and each set-aside is reported in the return's
`recordOverrides`. 'held' and 'overflow' still suppress in both
modes. Live mode is the consumption letter, byte-for-byte as
before. Call sites switched, each naming its mode explicitly:
app.js panel replay + 2D stage replay ('recording'), scene.mjs
recorded-conversation playback via talk-state ('recording'),
quotation-audit enumeration ('recording'), conformance talk axis
2D + 3D ('recording'), m5.07 gate ('recording'). M5.09 stagings do
not consume this path (no call site exists to switch).
Regression evidence (plan-to-complete/lane-verd22-fix.md):
surface-consumption.test.mjs gains the VER-D22 block (live-asleep
speaker staged with bubble + gesture in recording mode; live-asleep
listener staged listening; held/overflow still govern; mode
required) — 13/13; talk-state.test.mjs gains the scene-path
regression in VER-D22's exact shape (all parties live-asleep ⇒
speech staged, words byte-equal) — 7/7. The LIVE positive controls
stand with their original assertions, re-pointed at mode 'live' in
both files. Conformance: suite 8/8 and a fresh live run at the
current bundle returned {ok: true, diffs: []}. Quotation audit
(M5.13) re-run live at bundleSeq 554: 63 surfaces, findings 0.
Suites per-file on Node v24: app 290/290 (26 files), scene
140/140 (21 files), conformance 8/8, staging 29/29. The defect's
browser-side bubble word-check (owed since shift 15) is now
unblocked: the G-J1 round-2 lane's talk-frame capture exercises
the staged playback this fix restores.
