#!/usr/bin/env bash
# Elsewhere Portal archiver watchdog — ARCH resilience safety net.
#
# The archiver (archiver-supervisor.sh running `node poller.mjs --watch`)
# is the one Portal thread whose silent death loses unrecoverable history.
# This watchdog checks it from OS cron every 15 minutes and restarts it if
# it has stalled. It is deliberately dumb: three checks, one restart path,
# everything logged to logs/watchdog.log.
#
# Checks (any failure = incident):
#   (a) supervisor process alive (pid file + cmdline match)
#   (b) archive/health.json freshness: generatedAtUtc within
#       WATCHDOG_HEALTH_STALE_SECONDS (default 900 = 2x the slowest route
#       cadence, 300 s, + 300 s margin)
#   (c) fetch-log growth: newest record in archive/fetch-log.jsonl within
#       WATCHDOG_FETCH_WINDOW_SECONDS (default 600 = 10 min)
#   (d) fetch success: newest fetch-log record with "status":200 within
#       WATCHDOG_SUCCESS_WINDOW_SECONDS (default 300 = one slowest-route
#       cadence). Freshness alone is blind here (convicted 2026-11-03):
#       a poller that cannot fetch at all still appends
#       "status":"error" records and health.json still refreshes, so
#       (b)/(c) pass while nothing is archived. Successes are far
#       denser than this window on a healthy supervisor (fast routes
#       cycle at 60 s), so a mid-cycle supervisor inside the bounds is
#       never falsely condemned by (d).
#
# Recovery: stop via the pid files exactly as ARCH-LIVE.md documents, wait
# for the supervisor lock to clear (a just-killed instance's lock can stay
# held ~30 s by a short-lived sleep), start via the documented start path,
# then verify a poll cycle completes — a post-restart fetch record with
# "status":200 — before reporting RECOVERY SUCCESS. Error records grow
# the fetch log too and prove nothing (two false RECOVERY SUCCESS lines
# on 2026-11-03, 11:06:47Z and 13:06:51Z, while every route failed).
#
# Fetch environment: direct egress is blocked on this VM, so the poller
# can only fetch with the egress-proxy variables + NODE_USE_ENV_PROXY=1.
# start_supervisor resolves them at start time — process environment
# first, then /etc/environment (the durable on-disk source; OS cron's
# environment is minimal and cannot be relied on to carry them) — exports
# them, and passes them to the unit via systemd-run --setenv. Values are
# never hard-coded and never logged (they may carry credentials); only
# variable names and their source are logged.
#
# Config via environment (used by the dry-run positive control):
#   WATCHDOG_DATA_DIR            default: this script's directory
#   WATCHDOG_HEALTH_FILE         default: $DATA_DIR/archive/health.json
#   WATCHDOG_FETCH_LOG           default: $DATA_DIR/archive/fetch-log.jsonl
#   WATCHDOG_LOG                 default: $DATA_DIR/logs/watchdog.log
#   WATCHDOG_DRY_RUN=1           evaluate checks and log the restart path
#                                that WOULD be taken; never stop/start
#                                anything, never verify against the live
#                                fetch log. Exit code 2 if checks fail.
#
# Exit codes: 0 = healthy, or incident recovered and verified;
#             2 = dry-run detected a failure;
#             3 = incident, recovery attempted but not verified;
#             1 = watchdog internal error.
set -u

DATA_DIR="${WATCHDOG_DATA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
HEALTH_FILE="${WATCHDOG_HEALTH_FILE:-$DATA_DIR/archive/health.json}"
FETCH_LOG="${WATCHDOG_FETCH_LOG:-$DATA_DIR/archive/fetch-log.jsonl}"
WATCHDOG_LOG="${WATCHDOG_LOG:-$DATA_DIR/logs/watchdog.log}"
DRY_RUN="${WATCHDOG_DRY_RUN:-0}"
HEALTH_STALE_SECONDS="${WATCHDOG_HEALTH_STALE_SECONDS:-900}"
FETCH_WINDOW_SECONDS="${WATCHDOG_FETCH_WINDOW_SECONDS:-600}"
SUCCESS_WINDOW_SECONDS="${WATCHDOG_SUCCESS_WINDOW_SECONDS:-300}"
VERIFY_TIMEOUT_SECONDS="${WATCHDOG_VERIFY_TIMEOUT_SECONDS:-240}"

PID_FILE="$DATA_DIR/elsewhere-portal-archiver.pid"
CHILD_PID_FILE="$DATA_DIR/elsewhere-portal-archiver.child.pid"
HOOKS_PID_FILE="$DATA_DIR/elsewhere-portal-archiver.hooks.pid"
LOCK_FILE="$DATA_DIR/.archiver-supervisor.lock"

mkdir -p "$(dirname "$WATCHDOG_LOG")"

log() { echo "$(date -u +%FT%TZ) $*" >> "$WATCHDOG_LOG"; }

# Start the supervisor so that no starter can take it down later, and so
# it inherits nothing of this script. Two failure modes convicted on
# 2026-11-03 drive this:
#   (1) Whole-tree silent death of agent-started instances (pids 6161,
#       2652, 7414 — each started by an ephemeral agent/cron-worker
#       session via setsid nohup; each died minutes later with no log
#       line, no cleanup trap, pid files left behind: a SIGKILL-class
#       teardown of the starter session's process tree/cgroup, which
#       setsid does not escape). A transient systemd unit is parented
#       to PID 1 in its own cgroup — no starter session's teardown can
#       reach it.
#   (2) The old setsid start inherited this script's flock fd (fd 8):
#       the supervisor tree held .archiver-watchdog.lock for its whole
#       life, so every later watchdog run logged SKIP and the safety
#       net was blind (2026-11-03 05:30–07:15Z under pid 8081; again
#       under pid 9026 until it exits). A systemd unit inherits no
#       client fds; the fallback start closes fd 8 explicitly.
#   (3) A systemd-run start carrying only PATH leaves the poller unable
#       to fetch at all: direct egress is blocked on this VM and the
#       unit does not inherit the caller's environment, so the proxy
#       variables + NODE_USE_ENV_PROXY must be passed explicitly
#       (2026-11-03 11:06Z pid 11108 and 13:06Z pid 7163 both fetched
#       nothing until replaced by proxy-env starts). Values are
#       resolved at start time — process env first, /etc/environment
#       as the durable fallback — never hard-coded, never logged.

# Print the value of $1 from /etc/environment (plain KEY=VALUE lines,
# one optional pair of surrounding double quotes stripped), if present.
env_file_value() {
  local name="$1" line
  [ -r /etc/environment ] || return 1
  line="$(grep -E "^${name}=" /etc/environment 2>/dev/null | tail -1)"
  [ -n "$line" ] || return 1
  line="${line#*=}"
  line="${line#\"}"
  line="${line%\"}"
  [ -n "$line" ] || return 1
  printf '%s' "$line"
}

FETCH_SETENV=()
FETCH_ENV_NAMES=""

# Resolve the fetch environment once, export it (so the setsid fallback
# inherits it too), and build the systemd-run --setenv argument list.
resolve_fetch_env() {
  FETCH_SETENV=()
  FETCH_ENV_NAMES=""
  local name val src proxy_found="no"
  for name in http_proxy https_proxy HTTP_PROXY HTTPS_PROXY \
              all_proxy ALL_PROXY no_proxy NO_PROXY NODE_USE_ENV_PROXY; do
    val="${!name:-}"
    src="process-env"
    if [ -z "$val" ]; then
      val="$(env_file_value "$name" || true)"
      src="/etc/environment"
    fi
    if [ -z "$val" ] && [ "$name" = "NODE_USE_ENV_PROXY" ]; then
      val="1"
      src="default"
    fi
    [ -n "$val" ] || continue
    export "$name=$val"
    FETCH_SETENV+=("--setenv=$name=$val")
    FETCH_ENV_NAMES="$FETCH_ENV_NAMES $name($src)"
    case "$name" in
      http_proxy|https_proxy|HTTP_PROXY|HTTPS_PROXY|all_proxy|ALL_PROXY)
        proxy_found="yes" ;;
    esac
  done
  if [ "$proxy_found" = "yes" ]; then
    log "RECOVERY fetch env resolved for start (names+sources only, values never logged):$FETCH_ENV_NAMES"
  else
    log "RECOVERY WARNING no proxy variables found in the process environment or /etc/environment — the started supervisor will likely be UNABLE TO FETCH (direct egress is blocked on this VM)"
  fi
}

start_supervisor() {
  resolve_fetch_env
  if command -v systemd-run >/dev/null 2>&1; then
    systemctl reset-failed elsewhere-portal-archiver >/dev/null 2>&1
    if systemd-run --unit=elsewhere-portal-archiver --collect \
        --working-directory="$DATA_DIR" \
        --setenv=PATH="$PATH" \
        "${FETCH_SETENV[@]}" \
        "$DATA_DIR/archiver-supervisor.sh" >/dev/null 2>&1; then
      log "RECOVERY start issued via systemd-run (unit elsewhere-portal-archiver, fetch env passed via --setenv)"
      return 0
    fi
    log "RECOVERY systemd-run start failed; falling back to setsid start"
  fi
  (cd "$DATA_DIR" && setsid nohup ./archiver-supervisor.sh >/dev/null 2>&1 8>&- < /dev/null &)
  log "RECOVERY start issued via documented start path (setsid nohup ./archiver-supervisor.sh, watchdog lock fd closed, fetch env exported)"
}

# Single-instance: a recovery can take minutes; never overlap ourselves.
exec 8>"$DATA_DIR/.archiver-watchdog.lock"
if ! flock -n 8; then
  log "SKIP another watchdog run is in progress"
  exit 0
fi

now_epoch() { date -u +%s; }
iso_to_epoch() { date -u -d "$1" +%s 2>/dev/null || echo ""; }

failures=""

# --- check (a): supervisor process alive -----------------------------------
sup_pid=""
[ -f "$PID_FILE" ] && sup_pid="$(cat "$PID_FILE" 2>/dev/null)"
sup_alive="no"
if [ -n "$sup_pid" ] && kill -0 "$sup_pid" 2>/dev/null; then
  if tr '\0' ' ' < "/proc/$sup_pid/cmdline" 2>/dev/null | grep -q 'archiver-supervisor\.sh'; then
    sup_alive="yes"
  fi
fi
[ "$sup_alive" = "yes" ] || failures="$failures supervisor-dead(pid=${sup_pid:-none})"

# --- check (b): health.json freshness --------------------------------------
health_age="unknown"
health_ok="no"
for attempt in 1 2; do
  gen="$(sed -n 's/.*"generatedAtUtc"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$HEALTH_FILE" 2>/dev/null | head -1)"
  gen_epoch="$(iso_to_epoch "$gen")"
  if [ -n "$gen_epoch" ]; then
    health_age=$(( $(now_epoch) - gen_epoch ))
    [ "$health_age" -le "$HEALTH_STALE_SECONDS" ] && health_ok="yes"
    break
  fi
  # A torn read mid-rewrite is possible; re-read once before judging.
  [ "$attempt" = "1" ] && sleep 5
done
[ "$health_ok" = "yes" ] || failures="$failures health-stale(age=${health_age}s,threshold=${HEALTH_STALE_SECONDS}s,file=$HEALTH_FILE)"

# --- check (c): fetch-log growth within the window -------------------------
fetch_age="unknown"
fetch_ok="no"
if [ -f "$FETCH_LOG" ]; then
  last_utc="$(tail -1 "$FETCH_LOG" 2>/dev/null | sed -n 's/.*"utc"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  last_epoch="$(iso_to_epoch "$last_utc")"
  if [ -n "$last_epoch" ]; then
    fetch_age=$(( $(now_epoch) - last_epoch ))
    [ "$fetch_age" -le "$FETCH_WINDOW_SECONDS" ] && fetch_ok="yes"
  fi
fi
[ "$fetch_ok" = "yes" ] || failures="$failures fetch-log-stalled(age=${fetch_age}s,window=${FETCH_WINDOW_SECONDS}s)"

# --- check (d): a successful fetch within the success window ----------------
# Same status reading the recovery verifier below established: a record
# counts only if it carries "status":200 (grep -F), and its utc is read
# with the same sed. Error records satisfy (c) forever and prove nothing.
success_age="unknown"
success_ok="no"
if [ -f "$FETCH_LOG" ]; then
  last_ok_utc="$(grep -F '"status":200' "$FETCH_LOG" 2>/dev/null | tail -1 | sed -n 's/.*"utc"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  last_ok_epoch="$(iso_to_epoch "$last_ok_utc")"
  if [ -n "$last_ok_epoch" ]; then
    success_age=$(( $(now_epoch) - last_ok_epoch ))
    [ "$success_age" -le "$SUCCESS_WINDOW_SECONDS" ] && success_ok="yes"
  fi
fi
[ "$success_ok" = "yes" ] || failures="$failures no-successful-fetch(age=${success_age}s,window=${SUCCESS_WINDOW_SECONDS}s)"

# --- verdict ----------------------------------------------------------------
if [ -z "$failures" ]; then
  log "HEALTHY supervisor pid=$sup_pid alive, health age=${health_age}s, last fetch ${fetch_age}s ago, last successful fetch ${success_age}s ago"
  exit 0
fi

log "INCIDENT checks failed:$failures (dry_run=$DRY_RUN)"

if [ "$DRY_RUN" = "1" ]; then
  log "DRY-RUN would restart supervisor: stop via pid files (supervisor/child/hooks), wait for lock release, then start via start_supervisor (systemd-run unit elsewhere-portal-archiver with the fetch env resolved and passed via --setenv; fallback setsid nohup with the watchdog lock fd closed) and verify a post-restart HTTP 200 fetch record — none of this executed"
  exit 2
fi

# --- recovery: documented stop, wait for lock, documented start ------------
lines_before="$(wc -l < "$FETCH_LOG" 2>/dev/null || echo 0)"
restart_epoch="$(now_epoch)"

for f in "$PID_FILE" "$CHILD_PID_FILE" "$HOOKS_PID_FILE"; do
  if [ -f "$f" ]; then
    p="$(cat "$f" 2>/dev/null)"
    if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
      kill "$p" 2>/dev/null && log "RECOVERY stopped pid $p (from $f)"
    fi
  fi
done

# The supervisor's cleanup trap kills its children and removes pid files;
# a short-lived sleep can hold the flock for up to ~30 s after a kill.
for i in $(seq 1 12); do
  holder="$(fuser "$LOCK_FILE" 2>/dev/null)"
  [ -z "$holder" ] && break
  sleep 5
done
holder="$(fuser "$LOCK_FILE" 2>/dev/null)"
if [ -n "$holder" ]; then
  log "RECOVERY FAILURE supervisor lock still held by pid(s) $holder after 60 s; not forcing a start"
  exit 3
fi
sleep 2

start_supervisor

# --- verify: a poll cycle completes (a post-restart SUCCESS record) ---------
# Growth alone proved nothing on 2026-11-03: a start without the proxy
# environment appends "status":"error" records on every route, the log
# grows, and the old check reported RECOVERY SUCCESS twice (11:06:47Z,
# 13:06:51Z) while no route had ever succeeded. Success now requires a
# post-restart record with "status":200.
deadline=$(( restart_epoch + VERIFY_TIMEOUT_SECONDS ))
while [ "$(now_epoch)" -lt "$deadline" ]; do
  sleep 10
  lines_now="$(wc -l < "$FETCH_LOG" 2>/dev/null || echo 0)"
  if [ "$lines_now" -gt "$lines_before" ]; then
    ok_line="$(tail -n +"$((lines_before + 1))" "$FETCH_LOG" 2>/dev/null | grep -F '"status":200' | head -1)"
    if [ -n "$ok_line" ]; then
      new_utc="$(printf '%s' "$ok_line" | sed -n 's/.*"utc"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
      new_epoch="$(iso_to_epoch "$new_utc")"
      if [ -n "$new_epoch" ] && [ "$new_epoch" -ge "$restart_epoch" ]; then
        new_sup="$(cat "$PID_FILE" 2>/dev/null)"
        log "RECOVERY SUCCESS first post-restart successful fetch (HTTP 200) at $new_utc (fetch log $lines_before -> $lines_now), supervisor pid=${new_sup:-unknown}"
        exit 0
      fi
    fi
  fi
done

log "RECOVERY FAILURE no successful (HTTP 200) fetch record within ${VERIFY_TIMEOUT_SECONDS}s of the restart (fetch log lines before=$lines_before; error records do not count as recovery)"
exit 3
