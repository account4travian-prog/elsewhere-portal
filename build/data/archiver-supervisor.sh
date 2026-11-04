#!/usr/bin/env bash
# Elsewhere Portal archiver supervisor — service name: elsewhere-portal-archiver.
#
# Fallback supervisor for the poller watch loop. A systemd *user* unit was the
# first choice, but user-systemd is unavailable on this guest: there is no
# /run/user/0, and user@0.service cannot start because user-runtime-dir@0
# fails with "Failed to connect to system bus: No such file or directory"
# (verified 2026-11-03). This script provides the same contract instead:
# Restart=always semantics for `node poller.mjs --watch`, single-instance via
# flock, logs in the project tree.
#
# Per-cycle hook pipeline, run after poll cycles land new snapshots, in this
# order (each step idempotent, append-only or derived, none touches the
# poller):
#   1. chain build    — node chain.mjs build (snapshot hash chains)
#   2. reset watch    — node reset-detect.mjs (appends to reset-watch.jsonl)
#   3. world-books    — node world-books.mjs (rebuilds world-books.json)
#   4. bundle         — build-bundle-v2.mjs (WorldData v2, CONTRACT-V2.md;
#                       the feed switched from v1 on 2026-11-03) into a temp
#                       feed dir seeded with the live manifest (bundleSeq
#                       continues across the schema change) and the facts
#                       state (so the bundle cites the facts stream),
#                       gated on the bundle-v2 tests + bundle-check.mjs
#                       (v2 contract validation via validate-v2.mjs), then
#                       published into feed/ with the manifest written LAST
#                       (rename swap: world-data first, manifest last, so no
#                       reader ever sees a manifest pointing at a
#                       half-written bundle). A failed build or check keeps
#                       the previous bundle and logs an incident.
#   5. episodes       — node episodes-cycle.mjs (rebuilds
#                       feed/episodes.json from the head voices + news
#                       snapshots, atomically; a failed run writes
#                       nothing, so the previous episodes.json stays).
#   6. facts          — node facts-cycle.mjs (appends portal.facts/v1
#                       facts to feed/facts.jsonl, diffed from
#                       consecutive published bundles; state in
#                       feed/facts-state.json; a failed run writes
#                       nothing, so the stream and the v2 citation keep
#                       their last good state).
#   7. journeys       — node journeys-cycle.mjs (rebuilds
#                       feed/journeys.json, portal.journeys/v1, from the
#                       open world-book's voices snapshots; atomic
#                       write, so a failed run keeps the previous
#                       journeys.json).
#   8. staging        — node ../../staging/staging-cycle.mjs (republishes
#                       the staging site to R2 as new bundles land —
#                       the project owner's decision 2026-11-02; delta-only uploads
#                       from a publish-state file, 60 s throttle,
#                       DEVELOPMENT-PAUSED skips it silently. It only
#                       reads the feed and writes staging state: a
#                       failure is logged like any step's and NEVER
#                       breaks the data cycle.)
#   9. invariants     — node corpus-invariants.mjs (full-corpus
#                       no-teleport invariant run + stuck-actor check
#                       over the open world-book; writes
#                       archive/invariants.json; a failed run keeps the
#                       previous report, which health embeds with its
#                       own timestamp, so a stale report reads as stale).
#  10. health         — node health.mjs (rewrites health.json,
#                       embedding the invariants report's summary)
#  11. growth         — node growth-cycle.mjs (M6.08 diff writer: diffs
#                       the just-published bundle against the last
#                       counted one and appends portal.daily-counters/v1
#                       lines + portal.firsts/v1 firsts to the feed
#                       streams, then rebuilds feed/growth-book.json.
#                       Baseline law: the first counted bundle initialises
#                       the seen sets and is never mined for firsts —
#                       nothing is backfilled. A failed run writes
#                       nothing, so the previous streams and book stay.
#                       Added 2026-11-03 (M6 wave); NOTE: a supervisor
#                       already running has its cycle parsed in memory —
#                       this step takes effect from that supervisor's
#                       next start, never mid-flight.)
#  12. chronicle      — node chronicle-cycle.mjs (M6.09: derives the
#                       Chronicle items from the growth streams + the
#                       bundle's ticker, deduped by item id into
#                       feed/chronicle-items.jsonl, then rebuilds
#                       feed/chronicle-book.json with the Ledger and
#                       civic-calendar views. Same next-start note as
#                       the growth step applies.)
# Plus `node chain.mjs verify` on a 900 s health cadence: a nonzero verify
# exit is an integrity INCIDENT (logs/incidents.log); EDGE GAP lines in
# verify output are reports (lost feed visibility), not failures.
#
# Start (detached):  setsid nohup ./archiver-supervisor.sh >/dev/null 2>&1 &
# Status:            cat elsewhere-portal-archiver.pid; tail logs/supervisor.log
# Stop:              kill "$(cat elsewhere-portal-archiver.pid)" \
#                         "$(cat elsewhere-portal-archiver.child.pid)" \
#                         "$(cat elsewhere-portal-archiver.hooks.pid)"
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE_DIR="$HERE/archive"
FETCH_LOG="$ARCHIVE_DIR/fetch-log.jsonl"
LOG_DIR="$HERE/logs"
PID_FILE="$HERE/elsewhere-portal-archiver.pid"
CHILD_PID_FILE="$HERE/elsewhere-portal-archiver.child.pid"
HOOKS_PID_FILE="$HERE/elsewhere-portal-archiver.hooks.pid"
VERIFY_EVERY_SECONDS=900
STAGING_CYCLE="$HERE/../../staging/staging-cycle.mjs"
mkdir -p "$LOG_DIR"

exec 9>"$HERE/.archiver-supervisor.lock"
if ! flock -n 9; then
  echo "$(date -u +%FT%TZ) supervisor already running; not starting a second" >> "$LOG_DIR/supervisor.log"
  exit 0
fi

echo $$ > "$PID_FILE"
echo "$(date -u +%FT%TZ) supervisor started (pid $$)" >> "$LOG_DIR/supervisor.log"
cleanup() {
  for f in "$CHILD_PID_FILE" "$HOOKS_PID_FILE" "$HERE/elsewhere-portal-archiver.chain.pid"; do
    [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null
  done
  rm -f "$PID_FILE" "$CHILD_PID_FILE" "$HOOKS_PID_FILE" "$HERE/elsewhere-portal-archiver.chain.pid"
}
trap cleanup EXIT

fetch_log_lines() { wc -l < "$FETCH_LOG" 2>/dev/null || echo 0; }

# Generic cycle step: timestamped header + output + exit code to its own log;
# a nonzero exit is also surfaced in supervisor.log.
run_step() {
  local name="$1" log="$2"
  shift 2
  local rc
  {
    echo "=== $(date -u +%FT%TZ) $name"
    "$@"
    rc=$?
    echo "--- exit: $rc"
  } >> "$log" 2>&1
  if [ "$rc" -ne 0 ]; then
    echo "$(date -u +%FT%TZ) STEP FAILURE $name (exit $rc) — see $log" >> "$LOG_DIR/supervisor.log"
  fi
}

run_chain_build() {
  local why="$1"
  {
    echo "=== $(date -u +%FT%TZ) chain build ($why)"
    node "$HERE/chain.mjs" build
    echo "--- build exit: $?"
  } >> "$LOG_DIR/chain.log" 2>&1
}

run_chain_verify() {
  local out rc
  out="$(node "$HERE/chain.mjs" verify 2>&1)"
  rc=$?
  {
    echo "=== $(date -u +%FT%TZ) chain verify (exit $rc)"
    echo "$out"
  } >> "$LOG_DIR/chain-verify.log"
  if [ "$rc" -ne 0 ]; then
    echo "$(date -u +%FT%TZ) INCIDENT chain verify failed (exit $rc) — see logs/chain-verify.log" >> "$LOG_DIR/incidents.log"
    echo "$(date -u +%FT%TZ) INCIDENT chain verify failed (exit $rc)" >> "$LOG_DIR/supervisor.log"
  fi
}

# Bundle step: build into a temp feed dir (seeded with the live manifest
# so bundleSeq continues from the published sequence — build-bundle-v2
# increments from the manifest in its target dir, across schema changes;
# also seeded with the live facts state, read-only, so the v2 bundle's
# facts citation names the stream's current seq), gate on the bundle-v2
# tests and the v2 contract check, and only then publish. Publishing is
# two renames inside feed/: world-data.json first, manifest.json LAST, so
# the manifest never points at a half-written bundle. Any failure keeps
# the previous bundle untouched and is logged as an incident.
run_bundle() {
  local why="$1"
  local log="$LOG_DIR/bundle.log"
  local feed="$HERE/feed"
  local tmp fail=""
  mkdir -p "$feed"
  tmp="$(mktemp -d "$HERE/.feed-build.XXXXXX")" || {
    echo "$(date -u +%FT%TZ) INCIDENT bundle step could not create a temp feed dir" >> "$LOG_DIR/incidents.log"
    return
  }
  {
    echo "=== $(date -u +%FT%TZ) bundle build ($why)"
    [ -f "$feed/manifest.json" ] && cp "$feed/manifest.json" "$tmp/manifest.json"
    [ -f "$feed/facts-state.json" ] && cp "$feed/facts-state.json" "$tmp/facts-state.json"
    if ! node "$HERE/build-bundle-v2.mjs" --feed "$tmp"; then fail="build"; fi
    if [ -z "$fail" ] && ! node --test "$HERE/test/bundle-v2.test.mjs"; then fail="bundle tests"; fi
    if [ -z "$fail" ] && ! node "$HERE/bundle-check.mjs" "$tmp"; then fail="schema check"; fi
    if [ -n "$fail" ]; then
      echo "--- bundle $fail FAILED; previous bundle kept"
    else
      cp "$tmp/world-data.json" "$feed/.world-data.json.new" && mv "$feed/.world-data.json.new" "$feed/world-data.json"
      cp "$tmp/manifest.json" "$feed/.manifest.json.new" && mv "$feed/.manifest.json.new" "$feed/manifest.json"
      echo "--- published: $(cat "$feed/manifest.json" | tr -d '\n ')"
    fi
  } >> "$log" 2>&1
  if [ -n "$fail" ]; then
    echo "$(date -u +%FT%TZ) INCIDENT bundle $fail failed — previous bundle kept; see logs/bundle.log" >> "$LOG_DIR/incidents.log"
    echo "$(date -u +%FT%TZ) INCIDENT bundle $fail failed — previous bundle kept" >> "$LOG_DIR/supervisor.log"
  fi
  rm -rf "$tmp"
}

# One hook cycle, in the mandated order: chain build → reset watch →
# world-books rebuild → bundle → episodes → facts → journeys →
# staging republish → invariants → health → growth → chronicle.
run_cycle() {
  local why="$1"
  echo "$(date -u +%FT%TZ) hook cycle ($why)" >> "$LOG_DIR/supervisor.log"
  run_chain_build "$why"
  run_step "reset-detect" "$LOG_DIR/reset-detect.log" node "$HERE/reset-detect.mjs"
  run_step "world-books" "$LOG_DIR/world-books.log" node "$HERE/world-books.mjs"
  run_bundle "$why"
  run_step "episodes" "$LOG_DIR/episodes.log" node "$HERE/episodes-cycle.mjs"
  run_step "facts" "$LOG_DIR/facts.log" node "$HERE/facts-cycle.mjs"
  run_step "journeys" "$LOG_DIR/journeys.log" node "$HERE/journeys-cycle.mjs"
  run_step "staging-publish" "$LOG_DIR/staging-publish.log" node "$STAGING_CYCLE"
  run_step "invariants" "$LOG_DIR/invariants.log" node "$HERE/corpus-invariants.mjs"
  run_step "health" "$LOG_DIR/health.log" node "$HERE/health.mjs"
  run_step "growth" "$LOG_DIR/growth.log" node "$HERE/growth-cycle.mjs"
  run_step "chronicle" "$LOG_DIR/chronicle.log" node "$HERE/chronicle-cycle.mjs"
}

# Hook loop: a cycle runs whenever the fetch log has grown (a poll cycle
# landed), gated on a 5 s quiescent log so no step ever reads a snapshot
# file mid-write — the poller finishes writing a snapshot before appending
# its fetch-log record. Verify runs on the health cadence.
hook_loop() {
  run_cycle "supervisor-start"
  run_chain_verify
  local last_verify last_built a b now_s
  last_verify=$(date +%s)
  last_built=$(fetch_log_lines)
  while true; do
    sleep 30
    if [ "$(fetch_log_lines)" != "$last_built" ]; then
      a=$(fetch_log_lines)
      sleep 5
      b=$(fetch_log_lines)
      if [ "$a" = "$b" ]; then
        run_cycle "poll-cycle"
        last_built=$b
      fi
    fi
    now_s=$(date +%s)
    if [ $((now_s - last_verify)) -ge $VERIFY_EVERY_SECONDS ]; then
      run_chain_verify
      last_verify=$now_s
    fi
  done
}

hook_loop &
echo $! > "$HOOKS_PID_FILE"
echo "$(date -u +%FT%TZ) hook loop started (pid $!, cycle: chain build → reset watch → world-books → bundle → episodes → facts → journeys → staging republish → invariants → health → growth → chronicle; chain verify every ${VERIFY_EVERY_SECONDS}s)" >> "$LOG_DIR/supervisor.log"

while true; do
  echo "$(date -u +%FT%TZ) starting poller --watch" >> "$LOG_DIR/supervisor.log"
  node "$HERE/poller.mjs" --watch >> "$LOG_DIR/archiver.log" 2>&1 &
  child=$!
  echo "$child" > "$CHILD_PID_FILE"
  wait "$child"
  rc=$?
  echo "$(date -u +%FT%TZ) poller exited rc=$rc; restarting in 5s" >> "$LOG_DIR/supervisor.log"
  sleep 5
done
