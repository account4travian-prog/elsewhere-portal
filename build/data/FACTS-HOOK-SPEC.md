# Facts hook spec — supervisor wiring for the portal.facts/v1 stream

**Status: PREPARED, NOT APPLIED.** Prepared 2026-11-02 (America/Chicago)
by the facts hook spec arm. The episodes hook was being applied to
`archiver-supervisor.sh` in parallel, so this spec was written against
a read of the supervisor as it stands WITH the episodes step in place.
Nothing in this document has been edited into the supervisor, and
`ARCH-LIVE.md` is untouched. The wrapper the hook calls —
`facts-cycle.mjs` — is built, tested, and verified (see Evidence).

## The hook line

Insert into `archiver-supervisor.sh`, inside `run_cycle`, immediately
AFTER the episodes step and immediately BEFORE the health step:

```bash
  run_step "facts" "$LOG_DIR/facts.log" node "$HERE/facts-cycle.mjs"
```

So `run_cycle` becomes:

```bash
  run_bundle "$why"
  run_step "episodes" "$LOG_DIR/episodes.log" node "$HERE/episodes-cycle.mjs"
  run_step "facts" "$LOG_DIR/facts.log" node "$HERE/facts-cycle.mjs"
  run_step "health" "$LOG_DIR/health.log" node "$HERE/health.mjs"
```

The line carries no path arguments on purpose: `facts-cycle.mjs` pins
its paths against its own directory (bundle in `feed/world-data.json`,
stream `feed/facts.jsonl`, state `feed/facts-state.json`), so the hook
cannot drift. `run_step` creates `logs/facts.log` on first use and
surfaces a nonzero exit as `STEP FAILURE facts` in supervisor.log,
exactly like the other steps.

### Ancillary edits for the applying arm (same pass, cosmetic)

- Header comment: add the facts step to the numbered pipeline list
  (after episodes, before health) — one short entry: stream appended
  from consecutive published bundles; a failed run writes nothing, so
  the stream and the v2 citation keep their last good state.
- `run_cycle`'s lead comment ("chain build → reset watch →
  world-books rebuild → bundle → episodes → health") gains "→ facts"
  before health; likewise the hook-loop start log line's cycle list.

## Why this position in the cycle

- **After `run_bundle` — a hard constraint.** Facts diff consecutive
  *published bundles*: the cycle reads `feed/world-data.json`, which
  `run_bundle` has just published for this cycle (world-data first,
  manifest last). Running facts before the bundle step would diff the
  previous cycle's bundle against the state and lag the stream a full
  cycle behind for no benefit.
- **After episodes — a grouping choice, not a constraint.** Episodes
  derive from archive *snapshots* and never read the bundle, so the
  two steps are independent. Placing facts after episodes keeps the
  cycle's derived-feed writers together as one block (episodes.json,
  then facts.jsonl + facts-state.json) between the bundle publish and
  health.
- **Before health — the point of health.** Health closes the cycle by
  reporting on the feed's state; it should see the facts artefacts the
  cycle just produced, not last cycle's.

## Failure semantics

- `run_step` failure handling applies unchanged: a nonzero facts exit
  logs `STEP FAILURE facts` to supervisor.log and the cycle continues
  to health. No other step consumes facts output, so a facts failure
  degrades exactly one thing: the freshness of the v2 facts citation.
- **A failed facts step leaves the previous state and stream
  untouched.** `facts-cycle.mjs` pre-flights before any write (live
  bundle present, parseable, WorldData-shaped; an existing state file
  parseable; every existing stream line parseable) and throws on any
  violation. `facts.mjs` itself also validates before appending.
- **Write ordering inside a run: stream first, state second.** The
  cycle appends the pair's facts to `facts.jsonl` (with canonical
  dedupe against what's already there), *then* saves
  `facts-state.json` atomically (temp + rename). A crash in the window
  between them leaves the state naming the older bundle; the next run
  re-derives byte-identical facts from the same pair and the dedupe
  drops them all as duplicates — nothing is lost and nothing is
  written twice. (The reverse order could strand facts permanently:
  state advanced, facts never appended, no run ever re-derives them.)
  A crash mid-state-save leaves the old or the new state, never a torn
  file. Both crash windows are pinned by tests (see Evidence).
- **What the v2 builder then does:** `build-bundle-v2.mjs`'s
  `loadFactsRef` reads `feed/facts-state.json` and cites
  `{ schema: "portal.facts/v1", seq: <lastDiffedBundle.bundleSeq> }`.
  While the facts step has never succeeded, no state file exists and
  the citation stays `null` (present as a key, per Hark Q4). After a
  failure, the citation keeps citing the last successfully diffed seq
  — stale by exactly the failed interval, never wrong.

## What changes once this runs

- **First cycle:** creates `feed/facts-state.json` holding the
  then-current live bundle as the diff baseline, with its citizen and
  place seen-sets. **Zero facts are appended** — the stream starts at
  that bundle; earlier changes are never backfilled or invented.
  `feed/facts.jsonl` is not created until the first real change.
- **Every later cycle:** diffs the newly published bundle against the
  state's last-diffed bundle and appends any new facts (citizen
  first-seen / place-changed, place first-evidenced, population,
  works, season — and only `book-opened`, with seen-sets reset, across
  a world-book boundary). An unchanged world appends nothing; the
  state still advances to the newest bundle.
- **The v2 citation becomes real:** from the first successful cycle
  on, `build-bundle-v2.mjs` emits `world.facts =
  { schema: "portal.facts/v1", seq: <last diffed bundleSeq> }` and the
  same value in the v2 manifest, instead of `null`. Observed in
  verification (below): `{ "schema": "portal.facts/v1", "seq": 25 }`.
- **The live v1 feed is unaffected.** `world-data.json` and
  `manifest.json` keep their v1 shape; the facts artefacts are
  siblings in `feed/`, and `run_bundle`'s publish swap (world-data,
  then manifest) never touches them.

## Preconditions and notes for the applying arm

- **No `history/` or `bundles/` subdir may exist in `feed/`.**
  facts.mjs feed mode first looks for retained bundle history there
  and, finding ≥ 2 bundles, switches to a history walk. Nothing in the
  pipeline creates those subdirs; keep it that way.
- **Serial execution is assumed.** `run_cycle` runs its steps
  serially, and the wrapper takes no lock. A manual `facts-cycle.mjs`
  run overlapping a supervisor cycle is still safe in outcome — the
  canonical dedupe makes a doubled diff append nothing twice — but
  don't make a habit of it.
- **v1 bundles carry no `world.bookId`,** so until the feed switches
  to v2 the book-boundary branch simply never fires; pair diffs run
  within the live book. When the v2 switch happens, the same state
  file carries forward — the first v2 bundle's bookId is compared
  against the v1 baseline's (absent) bookId, which facts.mjs treats as
  no boundary, and from then on both sides carry ids.

## Evidence (2026-11-02, this arm)

- `facts-cycle.mjs` + `test/facts-cycle.test.mjs`: **10/10 pass** —
  baseline init (0 facts, no stream file), accumulation, idempotency,
  no-change state advance, book-change reset (only `book-opened`,
  seen sets reset), crash consistency for both windows (pre-appended
  stream + stale state → 0 appended, all duplicates, state advances;
  state lost + stream kept → re-init, stream byte-identical), failure
  atomicity (corrupt and missing live bundle leave state + stream
  untouched), and the v2-citation test (real-archive v2 build into a
  temp feed cites `{ schema: "portal.facts/v1", seq: 42 }` after
  synthetic cycle runs to seq 42).
- Full data suite after adding the wrapper: **128/128** across all 14
  test files (facts 12/12 and bundle-v2 15/15 included; nothing else
  changed).
- Live-shape run in `/tmp/facts-verify/` against a copy of the real
  feed (the production feed was never written): cycle 1 initialised
  the baseline on the real bundle at seq 24, appending 0 facts; a
  fabricated seq-25 successor (one citizen moved Plaza → Townhall,
  population 289 → 290) appended exactly 2 facts
  (`citizen-place-changed`, `population-changed`, evidence
  `{ fromSeq: 24, toSeq: 25 }`); a third run appended 0; and
  `build-bundle-v2.mjs --feed /tmp/facts-verify/feed` produced a
  manifest citing `"facts": { "schema": "portal.facts/v1",
  "seq": 25 }` (previously `null`). The production `feed/` still holds
  only `episodes.json`, `manifest.json`, `world-data.json`.
