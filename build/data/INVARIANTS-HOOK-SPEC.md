# Invariants hook spec — supervisor wiring for the M3.05 corpus run

**Status: PREPARED, NOT APPLIED.** Prepared 2026-11-02 (America/Chicago)
by the M3.05 completion arm. Nothing in this document has been edited
into `archiver-supervisor.sh`, and `ARCH-LIVE.md` is untouched. The
script the hook calls — `corpus-invariants.mjs` — is built, tested
(`test/corpus-invariants.test.mjs`, 6/6), and verified against the
live archive (see Evidence). The apply follows the established
restart discipline (stop → staged, syntax-checked script → documented
start), separately, exactly as the episodes and facts hooks were
applied.

## The hook line

Insert into `archiver-supervisor.sh`, inside `run_cycle`, immediately
AFTER the facts step and immediately BEFORE the health step:

```bash
  run_step "invariants" "$LOG_DIR/invariants.log" node "$HERE/corpus-invariants.mjs"
```

So `run_cycle` becomes:

```bash
  run_bundle "$why"
  run_step "episodes" "$LOG_DIR/episodes.log" node "$HERE/episodes-cycle.mjs"
  run_step "facts" "$LOG_DIR/facts.log" node "$HERE/facts-cycle.mjs"
  run_step "invariants" "$LOG_DIR/invariants.log" node "$HERE/corpus-invariants.mjs"
  run_step "health" "$LOG_DIR/health.log" node "$HERE/health.mjs"
```

**Why before health, not after:** `health.mjs` reads
`archive/invariants.json` (when present) and embeds its compact
summary as health.json's `invariants` section. Running the corpus
step before the health step means each cycle's health.json carries
THAT cycle's corpus result. (The facts stream's one-cycle citation
lag is the accepted pattern where a lag is forced; here nothing
forces one, so there is none.)

The line carries no path arguments on purpose: `corpus-invariants.mjs`
pins its paths against its own directory (archive in `archive/`,
layout in `../shared/ember-layout.json`, report to
`archive/invariants.json`), so the hook cannot drift. `run_step`
creates `logs/invariants.log` on first use and surfaces a nonzero
exit as `STEP FAILURE invariants` in supervisor.log, exactly like
the other steps.

### Ancillary edits for the applying arm (same pass, cosmetic)

- Header comment: add the invariants step to the numbered pipeline
  list (after facts, before health) — one short entry: full-corpus
  no-teleport invariant run + stuck-actor check over the open
  world-book; writes `archive/invariants.json`; a failed run keeps
  the previous report.
- Hook-loop start line: extend the cycle description to
  "… → facts → invariants → health".
- `ARCH-LIVE.md`: pipeline description + logs table gain the
  invariants step/`invariants.log`, and the restart is recorded in
  the A0 section with its cadence figures, as for the prior hooks.

## Failure semantics

- `corpus-invariants.mjs` builds the whole report in memory and
  writes it by temp-file + rename only after a fully successful
  build. A failure (no open world-book, unreadable snapshot set,
  checker error) exits nonzero having written NOTHING: the previous
  `archive/invariants.json` stays in place.
- Consequently health.json's `invariants` section keeps showing the
  last good report — **with its `generatedAtUtc`**, so a stale corpus
  result reads as stale, never as current. The supervisor log's
  `STEP FAILURE invariants` line is the loud signal; the health
  section's timestamp is the visible one.
- The step is read-only over the archive's snapshots and the feed:
  it cannot disturb the bundle, episodes, facts, or chains.

## Cost

Measured on the live archive at preparation time (152 utterances,
8 checked journeys, ~23 h book window): **~1–2 s per run**, once per
supervisor cycle. The cost grows with corpus span (the checker
samples each journey's full tick span); if a future corpus makes the
per-cycle cost material, the honest lever is a staleness guard in
the script (skip when the newest voices snapshot is unchanged since
the last report), NOT a quieter cadence — that guard is a follow-up
decision, not part of this spec.

## Evidence (preparation-time, live archive)

- `node corpus-invariants.mjs` on the live archive: corpus book
  world-001, 34 voices + 34 news snapshots, 152 utterances,
  15 speakers, 17 citizens known; 8 evidence-path journeys checked,
  **0 violations**; teleporting mutant caught on all 8 applicable
  journeys; 2 stuck suspects (roster names with no speech in the
  window — questions, not accusations); 13 over-long beats;
  14 off-graph legs excluded with reasons. Full numbers live in
  `archive/invariants.json` once the applying arm (or the prep run)
  writes it.
- `archive/health.json` gains the `invariants` section on the first
  health build after a report exists (verified against a temp copy
  at preparation time; the section is null until then).
- The checker amendments the corpus run required (retraced edges,
  per-step arrivals, engine-snap tolerance) are in
  `build/engine/invariant.mjs` with their rationale, pinned by four
  new tests in `build/engine/test/no-teleport.test.mjs`; the
  synthetic suite, the reconstructed-journey suite, and the mutant
  controls all stay green.
