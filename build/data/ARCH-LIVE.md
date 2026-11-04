# ARCH-LIVE — the archive is live

The Tier P archive has run continuously since **2026-11-03T00:27:03Z** under
supervision. This file is the operator's one-page reference: what runs it,
how to check it, where the logs live, and where the A0 clock stands.

## Service

- **Name:** `elsewhere-portal-archiver`
- **What runs:** `node poller.mjs --watch` (the poller's native
  cadence-honouring loop; per-route cadences from `cadence.json`: overview
  and status 60 s, news and voices 120 s, map and chats 300 s), supervised
  by `archiver-supervisor.sh` in this directory with Restart=always
  semantics (a poller exit is logged and the poller restarts after 5 s),
  single-instance via `flock` on `.archiver-supervisor.lock`.
- **Route taken, and why not systemd:** a systemd *user* unit was the first
  choice and is genuinely unavailable on this guest — there is no
  `/run/user/0`, and `user@0.service` cannot start because
  `user-runtime-dir@0` fails with "Failed to connect to system bus: No such
  file or directory" (attempted and verified 2026-11-03T00:26Z). The
  supervisor script is the fallback the plan allows; the mechanism decision
  and its reversal path are logged in `../../AUTO-DECISIONS.md`
  (2026-11-02 18:34 CST entry, AUTO-B05/B08, OF-1).
- **Pids** (files in this directory): supervisor
  `elsewhere-portal-archiver.pid`, poller
  `elsewhere-portal-archiver.child.pid`, hook loop
  `elsewhere-portal-archiver.hooks.pid`.

## Check status

```sh
cd ~/workspace/elsewhere-portal/build/data
cat elsewhere-portal-archiver.pid elsewhere-portal-archiver.child.pid elsewhere-portal-archiver.hooks.pid
tail logs/supervisor.log          # starts, restarts, hook cycles, incidents
tail archive/fetch-log.jsonl      # one record per fetch attempt
cat archive/health.json           # per-route gap status + the A0 figure
node chain.mjs verify             # exit 0 = every snapshot chain intact
```

## Start / stop

```sh
# start (durable, from this directory): a transient systemd unit —
# parented to PID 1 in its own cgroup, so the teardown of whatever
# session ran the command (an ephemeral agent worker, a shell) cannot
# kill it, and it inherits none of the starter's fds.
systemd-run --unit=elsewhere-portal-archiver --collect \
  --working-directory="$PWD" --setenv=PATH="$PATH" \
  "$PWD/archiver-supervisor.sh"
# fallback if systemd-run is unavailable (detached):
setsid nohup ./archiver-supervisor.sh >/dev/null 2>&1 &

# stop
kill "$(cat elsewhere-portal-archiver.pid)" \
     "$(cat elsewhere-portal-archiver.child.pid)" \
     "$(cat elsewhere-portal-archiver.hooks.pid)"
```

Start-mechanism ruling (forensics, 2026-11-03): `setsid nohup` starts
from short-lived agent/cron-worker sessions are NOT durable — three
instances started that way (pids 6161, 2652, 7414) died silently
within minutes when their starter sessions ended (whole tree gone,
no log line, no cleanup trap, pid files left behind). Instances
started by OS cron or long-lived sessions survived until reboots.
The in-VM watchdog's `start_supervisor` uses the systemd-run form
above (setsid fallback with the watchdog lock fd closed — the old
start inherited that fd, so the watchdog SKIPped for the whole life
of any instance it started).

Restart quirk: a just-killed instance's lock can stay held for up to ~30 s
by a short-lived `sleep` that inherited the lock fd. If a start logs
"supervisor already running; not starting a second", wait ~30 s and start
again — check `fuser .archiver-supervisor.lock` to see when it clears.

## Per-cycle hooks (supervisor, in order)

After any poll cycle lands new fetch-log records (gated on a 5 s quiescent
fetch log, so no step ever reads a snapshot mid-write):

1. **poll** — the watch loop itself (continuous).
2. **chain build** — `node chain.mjs build`: extends the per-route snapshot
   hash chains (`archive/chain-<route>.jsonl`). Idempotent.
3. **reset watch** — `node reset-detect.mjs`: appends reset verdicts for
   new overview pairs to `archive/reset-watch.jsonl`. Observes only.
4. **world-books rebuild** — `node world-books.mjs`: rebuilds the derived
   registry `archive/world-books.json` (deterministic, idempotent).
5. **bundle** — `node build-bundle-v2.mjs` (WorldData **v2**,
   `../CONTRACT-V2.md`; the feed switched from v1 on 2026-11-03) into a
   temp feed dir seeded with the live manifest (so `bundleSeq`
   continues — including across the v1→v2 schema change: the sequence
   is schema-independent) and the live `facts-state.json` (read-only,
   so the bundle's `world.facts` citation names the stream's current
   seq), gated on the bundle-v2 tests
   (`node --test test/bundle-v2.test.mjs`) and `node bundle-check.mjs`
   (manifest hash matches the world-data bytes, seq agreement, schema
   exactly `portal.world-data/v2` — a v1 bundle FAILS — plus the frozen
   contract's structural rules delegated to `validate-v2.mjs`:
   `integritySource` exact, `citizenIdStatus` on every citizen,
   disclosures verbatim, `ember.plots` present), then published into
   `feed/` by rename: `world-data.json` first, `manifest.json` LAST, so
   no reader ever sees a manifest pointing at a half-written bundle. A
   failed build or check keeps the previous bundle and logs an incident
   (`logs/bundle.log`, `logs/incidents.log`). Wired 2026-11-03 (VER-D09
   gap: the cycle previously never rebuilt the bundle, so the live feed
   predated the plots deriver); switched to the v2 builder 2026-11-03
   (see the A0 note below).
6. **episodes** — `node episodes-cycle.mjs`: rebuilds
   `feed/episodes.json` (`portal.episodes/v1`: `generatedFrom`,
   `episodes`, `actSequences`) from the head voices + news snapshots.
   The write is atomic (temp file in the feed dir, then rename) and
   happens only after a full successful derivation, so a failed step
   writes nothing and the previous `episodes.json` stays in place.
   Wired 2026-11-03 (M4 talk surface; supervisor restarted for the
   hook — see the A0 note below).
7. **facts** — `node facts-cycle.mjs`: diffs the just-published bundle
   against the state's last-diffed bundle and appends `portal.facts/v1`
   facts to `feed/facts.jsonl` (state in `feed/facts-state.json`;
   stream-first/state-second ordering, canonical dedupe; a failed run
   writes nothing). Wired 2026-11-03.
8. **journeys** — `node journeys-cycle.mjs`: rebuilds
   `feed/journeys.json` (`portal.journeys/v1`, M3.01 reconstruction)
   from the open world-book's voices snapshots — the same book-scoped
   loading the bundle's plot existence uses. The write is atomic
   (temp file in the feed dir, then rename) and happens only after a
   full successful derivation, so a failed step keeps the previous
   `journeys.json`. Wired 2026-11-03.
9. **staging republish** — `node ../../staging/staging-cycle.mjs`:
   republishes the staging site to R2 as new bundles land (the project owner's
   decision 2026-11-02 22:08 CST). Runs after journeys so the
   published snapshot carries this cycle's bundle, episodes, facts,
   and journeys. Fires only when the feed bundle hash changed and
   ≥60 s have passed since the last staging publish; uploads are
   delta-only against `staging/.staging-publish-state.json` (pointer
   last, every put `--remote`, bundle-check gate inside
   `publish.mjs`). It only reads the feed and writes staging state —
   a failure is a logged step failure and never breaks the cycle.
   `DEVELOPMENT-PAUSED` skips this step silently (the archiver
   itself is exempt). Wired 2026-11-03 (see the A0 note below).
10. **invariants** — `node corpus-invariants.mjs`: full-corpus
   no-teleport invariant run + stuck-actor check over the open
   world-book (M3.05); writes `archive/invariants.json` (temp +
   rename, only after a fully successful build — a failed run keeps
   the previous report). Runs before health so each cycle's
   `health.json` embeds that cycle's report summary as its
   `invariants` section, with the report's own `generatedAtUtc` — a
   stale report reads as stale, never as current. Wired 2026-11-03.
11. **health** — `node health.mjs`: rewrites `archive/health.json`,
   including a `bundle` section (live `bundleSeq`, `worlddataHash`,
   `newestFetchUtc` from the feed manifest) and an `invariants`
   section (the corpus report's compact summary, when a report
   exists).

Plus, on a **900 s health cadence**: `node chain.mjs verify`. A nonzero
verify exit is an **integrity incident** — written to `logs/incidents.log`
and `logs/supervisor.log`. `EDGE GAP` lines in verify output are
**reports** (feed items scrolled off between polls — lost visibility), not
failures, and never fail the verify.

## Logs (all under `logs/` in this directory)

| File | Contents |
|---|---|
| `supervisor.log` | Supervisor starts, poller restarts, hook cycles, step failures, incidents |
| `archiver.log` | Poller watch-loop stdout (one line per fetch) |
| `chain.log` | Every `chain build` (per-cycle and startup) with its summary JSON |
| `chain-verify.log` | Every `chain verify` run with full output and exit code |
| `reset-detect.log` | Every reset-watch step (new pair verdicts) |
| `world-books.log` | Every registry rebuild |
| `bundle.log` | Every bundle build + gate results + publish line (seq/hash) |
| `episodes.log` | Every episodes step (head files used, episode/act-sequence counts, exit) |
| `facts.log` | Every facts step (pair diff summary: from/to seq, facts appended, duplicates, exit) |
| `journeys.log` | Every journeys step (book id, corpus stats: speakers/utterances/candidate legs/reconstructed, exit) |
| `staging-publish.log` | Every staging republish step (publish id, mode, objects uploaded/skipped, exit); skips are silent here too — republishes and failures also land in `staging/publish-log.jsonl` |
| `invariants.log` | Every invariants step (corpus size, journeys checked, violations, mutant control, stuck suspects, exit) |
| `health.log` | Every health step (per-route status lines + bundle seq/hash) |
| `incidents.log` | Integrity incidents only (chain verify failures) — empty at go-live |

## A0 clock

- **A0 start: 2026-11-03T00:27:05.066Z** — the moment the service first
  completed a full pass (the `chats` record closing the first six-route
  sweep; the supervisor started at 00:27:03Z). The 48 h gap-free acceptance
  window (Plan B §2.4, gaps > 2× cadence unexplained) runs from here; the
  live figure is `a0.hoursSinceLastUnexplainedGap` in
  `archive/health.json`.
- The wave-1 hand run (2026-11-02T02:07Z, six snapshots) predates the clock
  and does not count toward it; those snapshots are in the archive and the
  chains like any other.
- Supervisor restart 2026-11-03T00:53:56Z → 00:54:42Z (46 s) to wire the
  episodes hook (stop → edit → start; the running bash process reads its
  script incrementally, so no in-place edit). Widest fetch intervals
  spanning the restart: overview 93.2 s and status 93.7 s (threshold
  120 s), map 221.4 s and chats 220.4 s (threshold 600 s) — no route
  crossed 2× cadence, `health.json` recorded no new unexplained gap
  (count unchanged at 6, all pre-A0), and the clock was not disturbed.
- Supervisor restart 2026-11-03T01:03:19Z → 01:03:23Z (~4 s) to wire
  the facts hook (same stop → swap staged, syntax-checked script →
  start discipline; staged diff was exactly the `run_step "facts"`
  line plus the header-comment, run_cycle-comment, and start-line
  mentions). The new poller's first pass fetched every route
  immediately, so the widest fetch intervals spanning the restart were
  *shorter* than normal cadence on the fast routes: overview 33.2 s
  and status 33.5 s (threshold 120 s), news 37.0 s and voices 35.5 s
  (threshold 240 s), map 220.1 s and chats 220.1 s (threshold 600 s).
  No new unexplained gap (count unchanged at 6), clock not disturbed.
  The facts step's first run (01:03:25Z, in the supervisor-start
  cycle) initialised its baseline on the bundle that cycle had just
  published (seq 26) with zero facts appended, per spec.
- A further restart at 2026-11-03T01:06:53Z (supervisor pid 51259)
  belongs to the parallel WorldData v2 feed switch: the bundle step
  moved from `build-bundle.mjs` to `build-bundle-v2.mjs` (see the
  supervisor script's bundle section, `logs/bundle.log`, and the next
  entry, which also records the one gated-out bundle cycle in the
  changeover window).
  The facts hook was retained verbatim in that script revision, and
  the v2 bundle step seeds its temp build dir with the live
  `facts-state.json` so each v2 bundle cites the facts stream's
  current seq. The 01:15:01Z watchdog run logged HEALTHY on pid
  51259; the A0 clock was not disturbed by either restart.
- Supervisor restart 2026-11-03T01:06:32Z → 01:06:53Z (21 s) for the
  **v1→v2 feed switch** (staged, syntax-checked script swapped in while
  stopped; same discipline). First v2 bundle: seq 28 in the
  supervisor-start cycle — sequence continued 27 (v1) → 28 → 29 → 30
  (v2) with no reset, `bundle-check` green on each, health's bundle
  section in exact agreement with the manifest, episodes and facts
  steps green (the facts state advanced v1 seq 27 → v2 seq 29 with
  zero facts appended and no spurious `book-opened`: the pair diff
  across the schema change is clean by construction and was simulated
  pre-switch). One bundle cycle in the changeover window (01:05:45Z,
  old supervisor + already-swapped v2 `bundle-check.mjs`) was correctly
  gated out — a v1 bundle against the v2 check — with the previous
  bundle kept and the incident logged; that is the gate working, not a
  publication failure. Cadence audit over 01:02–01:11Z: widest
  intervals overview 62.1 s, status 61.5 s, news 120.7 s, voices
  121.0 s, map/chats 210.2 s — all inside normal cadence and far under
  the 2× thresholds; `health.json` recorded no new unexplained gap
  (count unchanged at 6, all pre-A0), and the clock was not disturbed.
- Supervisor restart 2026-11-03T01:30:31Z → 01:30:40Z (9 s) to wire
  TWO hooks in one pass (same stop → swap staged, syntax-checked
  script → start discipline; the staged diff was exactly the two
  `run_step` lines plus the header-comment, run_cycle-comment, and
  start-line mentions): **journeys** (`journeys-cycle.mjs`, after
  facts — M3.01) and **invariants** (`corpus-invariants.mjs`, after
  journeys, before health — M3.05, per `INVARIANTS-HOOK-SPEC.md`, so
  each cycle's `health.json` carries that cycle's corpus result).
  The stop was timed just after the 01:30:01Z watchdog run logged
  HEALTHY on the old pid, and the 01:45:01Z run logged HEALTHY on
  the new supervisor pid 69438. First-cycle evidence: both new steps
  exit 0 (`logs/journeys.log`, `logs/invariants.log`; zero
  `STEP FAILURE` lines in the whole supervisor log); the poll cycle
  at 01:31:18Z ran invariants at 01:31:20Z and health at
  01:31:21.281Z embedded that same cycle's report
  (`generatedAtUtc` 01:31:20.505Z — 8 journeys checked, 0 violations,
  mutant caught on every applicable journey); `feed/journeys.json`
  regenerated with its ceiling accounting intact (27 candidate legs,
  0 reconstructed, 27 rejected dark legs — the honest M3.01 state).
  One bundle cycle in the start window was gated out: the
  supervisor-start cycle ran while the new poller's first pass was
  still landing snapshots, and the bundle gate's determinism test
  saw a news snapshot land between its two builds (heads differed,
  so the byte-identical assertion failed) — the gate kept the
  previous bundle, the test passed 15/15 on an immediate re-run
  against a stable head, and the next poll cycle published seq 53
  normally. The gate working during the known start-window race,
  not a publication failure. Cadence audit spanning the restart:
  widest intervals overview 60.7 s and status 61.2 s (threshold
  120 s), news 121.5 s and voices 121.4 s (240 s), map 221.0 s and
  chats 221.4 s (600 s), the four 600 s routes ≤ 225.6 s (1200 s),
  errata 1427 s (7200 s) — no route crossed 2× cadence,
  `health.json` recorded no new unexplained gap (count unchanged at
  6, all pre-A0), and the clock was not disturbed.
- **VM reboot 2026-11-03 ~02:57Z — the clock's first real break.**
  The guest rebooted (uptime at 04:09Z read 1:12); the supervisor,
  the poller, and OS cron all died with it, and the root crontab
  was gone on return — the documented VM-replacement case below.
  Last fetch 02:57:30Z. Recovery ran the documented path verbatim:
  `systemctl start cron` (package intact), the watchdog crontab
  line reinstalled, supervisor started 04:10:07Z (pid 29145); first
  post-recovery fetch 04:10:09Z. The silence 02:57:30Z → 04:10:09Z
  (4,359 s) recorded as new unexplained gaps on the routes whose
  2× thresholds it crossed: **count 6 → 16**, and
  `hoursSinceLastUnexplainedGap` reset to ~0. **The 48 h window
  therefore restarts from 04:10:09Z** — the earliest M1 exit read
  moves from ~2026-11-05T00:27Z to ~2026-11-05T04:10Z, assuming no
  further gaps. The watchdog logged HEALTHY again from 04:15:02Z.
- Supervisor restart 2026-11-03T04:13:37Z (pid 30736) to wire the
  **staging republish** hook (step 9 above; the project owner's cadence
  decision, 2026-11-02 22:08 CST). Stop→start inside ~15 s; the new
  poller's first pass fetched immediately, health recorded **no
  new unexplained gap** (count unchanged at 16), and the
  supervisor-start cycle fired the first automatic staging
  republish on its own (pub-147, bundleSeq 147 — evidence in
  `../../staging/STAGING-LIVE.md`). The watchdog logged HEALTHY on
  pid 30736 at 04:15:02Z.
- **VM reboot 2026-11-03 ~05:05Z — the clock's second break.**
  The guest rebooted again (uptime at 05:06:51Z read 1 min;
  supervisor pid 30736, the poller, OS cron, the root crontab,
  and the pid files all gone on return). The 23:05 CST watchdog
  run found the supervisor absent and ran the documented recovery
  verbatim, after waiting for the post-reboot OS package replay
  to release the dpkg lock: `systemctl start cron` (cron package
  verified already newest once the replay finished), the watchdog
  crontab line reinstalled (`crontab -l` verified), supervisor
  started 05:08:14Z (pid 6161). Last good fetch 05:05:26.521Z;
  first post-recovery fetch 05:08:14.454Z — silence of 167.9 s in
  the fetch log. Widest per-route intervals: overview 169.4 s and
  status 170.0 s (threshold 120 s), news 251.1 s and voices
  250.0 s (threshold 240 s) — four routes crossed 2× cadence, so
  new unexplained gaps were recorded: **count 16 → 20**, and
  `hoursSinceLastUnexplainedGap` reset to ~0. **The 48 h window
  therefore restarts from 05:08:14Z** — the earliest M1 exit read
  moves from ~2026-11-05T04:10Z to ~2026-11-05T05:08Z, assuming no
  further gaps. Recovery verified by effect: fetches resumed
  05:08:14Z and continued (overview/status 05:09:16Z, news
  05:10:16Z), and `health.json` refreshed at 05:08:18Z and
  05:09:44Z. One bundle cycle in the supervisor-start cycle was
  gated out (bundle tests failed — previous bundle kept), the
  same start-window gate behaviour recorded before.

## State at go-live write-up (2026-11-03T00:34Z)

Snapshots: **30** total (6 from wave 1 under `archive/2026-11-02/`, 24
under `archive/2026-11-03/`), fetch log 38 records, all routes HTTP 200,
zero errors, zero incidents. Chains: 30 records across the six route
chains, manual `chain.mjs verify` exit 0, 0 edge gaps. World-book
`world-001` open (opened 2026-11-02T02:07:12Z), reset-watch verdicts so
far all `no-reset`.

Per-route last fetch at write-up:

| Route | Last fetch (UTC) | Status | Result |
|---|---|---|---|
| overview | 2026-11-03T00:33:29.417Z | 200 | snapshot `2026-11-03/overview-20261103T003329Z.json` |
| news | 2026-11-03T00:32:29.011Z | 200 | snapshot `2026-11-03/news-20261103T003229Z.json` |
| voices | 2026-11-03T00:32:29.275Z | 200 | snapshot `2026-11-03/voices-20261103T003229Z.json` |
| map | 2026-11-03T00:32:29.506Z | 200 | snapshot `2026-11-03/map-20261103T003229Z.json` |
| status | 2026-11-03T00:33:31.047Z | 200 | unchanged (recorded, not re-snapshotted) |
| chats | 2026-11-03T00:32:30.075Z | 200 | snapshot `2026-11-03/chats-20261103T003230Z.json` |

Change detection is behaving as specified: the `status` body has been
byte-identical since wave 1, so it is recorded with `unchanged: true` on
every 60 s poll and has exactly one snapshot and one chain record.

## Watchdog (installed 2026-11-03)

The supervisor restarts a dead poller, but nothing restarted a dead
supervisor. `archiver-watchdog.sh` (this directory) is that safety net,
run by the VM's **OS cron** every 15 minutes (`*/15 * * * *`, root
crontab; the script also flock-guards itself against overlap).

Checks — any failure is an incident:

1. **Supervisor alive** — pid from `elsewhere-portal-archiver.pid` exists
   and its cmdline is `archiver-supervisor.sh`.
2. **Health fresh** — `archive/health.json`'s `generatedAtUtc` is within
   900 s (2× the slowest route cadence, 300 s, + 300 s margin).
3. **Fetch log growing** — the newest `archive/fetch-log.jsonl` record is
   within 600 s (10 min).

On failure the watchdog logs the incident to `logs/watchdog.log`, stops
the service via the pid files exactly as documented above, waits for the
supervisor lock to clear (up to 60 s), restarts via the documented start
path, and then verifies recovery: the fetch log must grow with a
post-restart record within 240 s. The log records `RECOVERY SUCCESS`
(with the new supervisor pid) or `RECOVERY FAILURE`. A healthy run logs
one `HEALTHY` line and touches nothing. Env overrides
(`WATCHDOG_HEALTH_FILE`, `WATCHDOG_DRY_RUN=1`, …) exist for dry-run
testing and never act on the live service; `logs/watchdog-cron.log`
collects any stray cron output.

Positive controls at install (2026-11-03T00:36Z): healthy run exited 0
and logged `HEALTHY` (supervisor pid unchanged); a dry run against a
health.json copy backdated 2 h exited 2, logged the `health-stale`
incident and the restart path it would take, and left the live
supervisor untouched.

Setup note: this guest shipped **without a cron package** — `cron` was
installed via apt and started via systemctl (`systemctl is-enabled cron`
= enabled) as part of this install. Root had no prior crontab; the
watchdog line is the only entry.

**Honest limit:** OS cron does not survive VM replacement either — the
crontab, the cron package, and the processes all live on the VM. After a
replacement, recovery is three steps: restore the project tree, then
re-run the supervisor start and the watchdog install:

```sh
apt-get install -y cron && systemctl start cron
{ echo '# Elsewhere Portal — ARCH watchdog'; echo '*/15 * * * * /home/user/workspace/elsewhere-portal/build/data/archiver-watchdog.sh >> /home/user/workspace/elsewhere-portal/build/data/logs/watchdog-cron.log 2>&1'; } | crontab -
cd ~/workspace/elsewhere-portal/build/data && setsid nohup ./archiver-supervisor.sh >/dev/null 2>&1 &
```

- **Incident 2026-11-03T07:35Z (supervisor died; watchdog run blocked; manual recovery by Atlas in the Portal chat):** the supervisor instance started 07:25:06Z (pids 2652/2663/2659) stopped at ~07:35:54Z (last hook activity; last fetch 07:35:16Z); cause not established. The 01:35 CST Muse-side watchdog run found it down but did NOT execute recovery — its read of this file triggered a safety block and the worker declined to run steps named in a flagged file. Atlas ran the documented supervisor start directly at ~07:39:54Z; supervisor (pids 7408/7414) + poller (7419) up, first post-recovery fetches 07:40:02Z. Silence ≈286 s; routes over 2× cadence will record new unexplained gaps and the 48 h window restarts from 07:40:02Z → earliest exit ~2026-11-05T07:40Z. The OS cron layer was still unrestored at this point (see the 02:15 CST one-shot finish job). Standing lesson: the watchdog job must not depend on reading this file to act — a self-contained body was proposed to the project owner 2026-11-02 23:36 CST and re-put after this incident.

- **Cron layer restored 2026-11-03T08:30Z (one-shot job `portal-cron-recovery-finish`, 02:15 CST run):** pre-check confirmed the supervisor healthy (pid 7408 alive, `archive/health.json` generated 08:13:37Z, fetches landing, latest 08:13:27Z). The apt lists lock was free (no holder; no other apt process). First `apt-get install -y cron` reported no installation candidate, so `apt-get update` ran first (45.0 MB fetched; one mirror's noble-security InRelease failed and was ignored, exit 0), then the documented step completed verbatim: `apt-get install -y cron && systemctl start cron` — cron 3.0pl1-184ubuntu2 installed, `systemctl is-active cron` = active, `is-enabled` = enabled. The watchdog crontab line was reinstalled exactly as in the recovery block above and verified with `crontab -l`. Verification by effect: at 2026-11-03T08:30:01Z OS cron fired the watchdog, which logged a fresh `HEALTHY supervisor pid=7408 alive, health age=53s, last fetch 22s ago` line in `logs/watchdog.log` (27 → 28 lines); `logs/watchdog-cron.log` remained 0 bytes (no stray cron output, as expected). The OS cron / in-VM watchdog layer left unrestored after the ~07:18Z reboot is now restored; the A0/M1 clock was not disturbed by this step (no supervisor restart).

- **VM reboot 2026-11-03 ~08:54Z — watchdog recovery (03:05 CST run).** The 03:05 CST watchdog run found the supervisor absent: pid files held the old pids 7408/7419/7414, none alive; OS cron inactive, root crontab gone; uptime at 09:06Z read 12 min, consistent with a reboot at ~08:54Z. Last good fetch 2026-11-03T08:54:00.831Z; health last generated 08:53:17Z. Recovery ran the documented path verbatim: `apt-get install -y cron && systemctl start cron` (cron already newest, then active/enabled), the watchdog crontab line reinstalled and verified with `crontab -l`, supervisor started 09:06:29Z (pid 7414, poller 7424, hooks 7420). First post-recovery fetch 09:06:30.056Z (overview); fetches continued (overview/status 09:07:31–33Z) and `health.json` refreshed at 09:06:54Z. Silence 08:54:00.831Z → 09:06:31.930Z = 751.1 s (health.json `lastGap`, route status); `hoursSinceLastUnexplainedGap` reset to ~0 and unexplained gap count read 38 after recovery. **The 48 h window therefore restarts from the recovery fetch — earliest M1 exit ~2026-11-05T09:06Z, assuming no further gaps.**

- **Forensics 2026-11-03 ~09:35Z — the non-reboot deaths and the staging failures, both convicted and fixed.** (a) *Session-teardown deaths:* the 09:06 instance (pid 7414) died ~09:08:34Z with the VM up — last fetch 09:08:34.552Z, its final hook cycle complete (health header 09:08:15Z), so it died idle between cycles. The in-VM watchdog's 09:15:01Z `supervisor-dead(pid=7414)` verdict was correct; it restarted the supervisor as pid 9026 (RECOVERY SUCCESS, fetch log 1647 → 1658). The same signature killed pid 6161 (started 05:08:14Z by the Muse-side watchdog run; last fetch ~05:10:18Z; dead by the in-VM watchdog's 05:15:01Z check, which restarted it as pid 8081) and pid 2652 (started 07:25:06Z; died mid-cycle ~07:35:54Z, journeys header the last trace). Common signature: instances started by ephemeral agent/cron-worker sessions via `setsid nohup` die minutes later, whole tree at once — zero `poller exited` lines exist in the entire supervisor log, the cleanup trap never ran (pid files left holding dead pids), no step is common to the deaths (mid-journeys, idle-after-cycle, between cycles), and `run_step` cannot exit the supervisor by construction (steps are child processes; the main bash only waits on the poller). Instances started by OS cron (8081, 9026) or long-lived sessions (7408) survived until reboots. dmesg shows no OOM kills. Ruling: the starter sessions' process-tree/cgroup teardown kills the tree despite setsid. Fix: durable start (see Start/stop above) — the watchdog's `start_supervisor` now uses `systemd-run` (mechanism proven live 09:30:58Z: a test unit ran the script, hit the flock, exited, collected; pid 9026 untouched), setsid fallback with fds closed. No supervisor restart was performed for this fix; it takes effect at the next start. (b) *Watchdog blind while its own instance lives:* the old watchdog start left a fragment (pid 9025, in `do_wait` on the supervisor) plus the whole supervisor tree holding the watchdog's flock fd 8 — proven live by `fuser` (holders 9025/9026/9035/9040) and by the cron watchdog's SKIP lines at 09:30:01Z (the same blindness ran 05:30–07:15Z under pid 8081). The fd is closed / never inherited under the new start; the CURRENT instance (pid 9026, old start) still holds it, so the in-VM watchdog will SKIP until pid 9026 exits — the Muse-side watchdog remains the net meanwhile. (c) *Staging STEP FAILURE (exit 1) — root cause:* `staging-publish.log` reads `ENOENT: no such file or directory, open '/root/.config/cf-api-token'` — `staging-cycle.mjs` resolved the deploy token (and the wrangler npx cache) via `os.homedir()`, and root cron's HOME is /root while the token lives in the project owner's home. It failed on EVERY cycle of every watchdog-started instance (first at 05:15:05Z under pid 8081 — not ~09:15Z as first briefed) and on NO cycle of any agent-started instance (pid 7414 published pub-420/421 at 09:06:34Z/09:08:04Z). Fix at the staging layer: `deployHome()` in `staging-cycle.mjs` resolves the token's home deterministically (ambient homedir if the token is there, else derived from the project tree), used for both the token file and the npx wrangler cache; staging suite 25/25 after the fix, and the fix takes effect on the running supervisor's next cycle (each cycle spawns the step fresh — no restart). Drive-by fix in the same pass: the publisher snapshot omitted `visual/scene/figure-kits.mjs` + `figure-kits.json` (M4.10 static import of scene.mjs; the closure test caught it) — added to `publish.mjs`'s scene set. Still open (flagged, not fixed): the kit GLBs the manifest names (`../factory/outputs-web/*.glb`, relative to visual/scene/) are not in the publisher snapshot at all, so staged kit loading will 404 best-effort until the publish set grows a factory entry. (d) *M1 state after the 09:08 death:* the gap 09:08:34.552Z → 09:15:05.475Z (390.9 s, status route) is the current `lastGap`; `unexplainedGapCount` 42; **the 48 h window restarts from 09:15:05Z — earliest M1 exit ~2026-11-05T09:15Z**, superseding the 09:06 figure above.

- **VM reboot 2026-11-03 10:57:01Z — Muse-side watchdog recovery (05:05 CST run), with a proxy-env correction to the first restart.** Uptime (`uptime -s` = 2026-11-03 04:57:01 CST) confirms a reboot at 10:57:01Z killed supervisor pid 9026; at the 11:06Z check there was no supervisor/poller process, the cron service was inactive, and the root crontab was gone. Last successful fetch 2026-11-03T10:57:34.348Z (overview); health last generated 10:55:42Z. Recovery: `apt-get install -y cron && systemctl start cron` (cron already newest; service then active), watchdog crontab line reinstalled exactly as documented and verified with `crontab -l`. On cron's start the in-VM watchdog fired (11:06:35Z) and started the supervisor via the durable systemd-run path (unit elsewhere-portal-archiver, pid 11108, 11:06:37Z) — but that unit inherited only PATH: with no proxy environment (no `NODE_USE_ENV_PROXY` / `*_proxy`, which live in `/etc/environment` and reach cron jobs via PAM), every fetch failed (`fetch failed`, SSL wrong-version on direct egress; verified by a controlled node fetch: stripped env fails, shell env returns 200). The watchdog's `RECOVERY SUCCESS` at 11:06:47Z counted error records as fetch-log growth — a verification blind spot: error records keep the fetch log "fresh" and health "young" while no route succeeds. The Muse-side run therefore took the documented step-3 direct branch: stopped the 11108 unit cleanly (pid files removed by its trap, lock free) and re-started it directly with `systemd-run --unit=elsewhere-portal-archiver --collect`, additionally passing `--setenv` for every variable in `/etc/environment` (proxy + NODE_* + cert bundles) — no Portal code changed. New supervisor pid 12342 (poller 12354) started 11:10:15Z; first successful fetch 2026-11-03T11:10:16.027Z (overview, 200; all 11 routes 200 in the first cycle). `health.json` refreshed 11:13:06Z: `inGapNow` false, `unexplainedGapCount` 48 (was 42), `lastGap` overview 10:57:34.348Z → 11:10:16.027Z = 761.679 s. **The 48 h M1 window restarts from 11:10:16Z — earliest M1 exit 2026-11-05T11:10:16Z**, superseding the 11:06:37Z figure in today's daily note (that entry's "first fetch" was an error record; pid 11108 was stopped deliberately for this env fix, it did not die). Cron service active, crontab line present, unit active at close of run. Open follow-up (not fixed by this job, recovery only): any future systemd-run start must carry the `/etc/environment` proxy variables or the poller cannot fetch at all — the watchdog script's `start_supervisor` currently sets only PATH.

- **VM reboot 2026-11-03 ~12:58Z — Muse-side watchdog recovery (07:05 CST run), proxy-env correction repeated.** `uptime -s` = 2026-11-03 06:58:04 CST confirms a reboot at ~12:58Z killed supervisor pid 12342; at the 13:06Z check there was no supervisor/poller process, the systemd unit was gone, cron was inactive, and the root crontab was gone. Last successful fetch 2026-11-03T12:58:22.229Z (status); health last generated 12:57:04Z. Recovery: `apt-get install -y cron && systemctl start cron` (cron already newest; service then active), watchdog crontab line reinstalled exactly as documented and verified with `crontab -l`. The in-VM watchdog then started the supervisor via systemd-run (pid 7163, 13:06:41Z) — but, exactly as in the 10:57Z incident, that unit carried only PATH and no proxy env, so every fetch failed (`fetch failed`; controlled checks: stripped-env node fetch fails with SSL wrong-version, shell-env fetch returns 200, source itself up). The watchdog's 13:06:51Z `RECOVERY SUCCESS` again counted error records as fetch-log growth. The Muse-side run took the documented step-3 direct branch: stopped the 7163 unit and restarted directly with `systemd-run --unit=elsewhere-portal-archiver --collect`, passing the proxy variables and `NODE_USE_ENV_PROXY` via `--setenv` (inherited from the caller env, values not written down) — no Portal code changed. New supervisor pid 9319 (poller 9331) started 13:12Z; first successful fetch 2026-11-03T13:12:14.899Z, all routes 200 in the first cycle, health refreshed 13:12:57Z: `inGapNow` false, `unexplainedGapCount` 58 (was 48), `lastGap` status 12:58:22.229Z → 13:12:14.899Z = 832.67 s. **The 48 h M1 window restarts from 13:12:14.899Z — earliest M1 exit 2026-11-05T13:12:15Z**, superseding the 11:10:16Z figure above. Cron active, crontab line present, unit active at close of run. Open follow-up unchanged: the watchdog script's `start_supervisor` still sets only PATH on its systemd-run start, so any in-VM-watchdog restart will again produce a poller that cannot fetch until a proxy-env start replaces it.

- **Watchdog start-path fix 2026-11-03 ~13:17–13:21Z (lane `plan-to-complete/lane-watchdog-env-fix.md`; supervisor pid 9319 untouched throughout):** the open follow-up from the 10:57Z and 12:58Z recoveries is closed in `archiver-watchdog.sh`. (a) `start_supervisor` now resolves the fetch environment at start time — process env first, then `/etc/environment` (the durable on-disk source, proven working by the 11:10:15Z restart: all routes 200) — for `http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY no_proxy NO_PROXY NODE_USE_ENV_PROXY` (the last defaulting to 1), exports the values, and passes them to the unit via `systemd-run --setenv`; nothing is hard-coded, and only variable names+sources are logged, never values. If no proxy variable is found in either source it logs a loud `RECOVERY WARNING … UNABLE TO FETCH` and still starts. (b) The recovery verification no longer counts fetch-log growth: `RECOVERY SUCCESS` now requires a post-restart fetch record with `"status":200`; error records can never satisfy it (timeout logs `RECOVERY FAILURE … error records do not count as recovery`, exit 3). Verified without touching pid 9319 (unit MainPID/active at both ends; health `generatedAtUtc` advanced 13:16:36Z → 13:20:55Z across the work): `bash -n` clean (no shellcheck on this VM); a stubbed dry-run harness ran the real script end to end — positive control with a scrubbed env (all nine variables sourced from `/etc/environment`, `--setenv` argv captured, success only on the HTTP 200 record), negative control with an errors-only fetch log (log grew, watchdog still exited 3 FAILURE), and a sentinel-env control (process-env values won and appeared verbatim in the argv). Not yet proven live: no genuine watchdog-started recovery has run under the fixed script — the first incident recovery is that proof. Adjacent blind spot recorded, not fixed (out of scope): checks (b)/(c) still judge freshness only, so a poller whose fetches all fail can still read HEALTHY between incidents.

- **Watchdog success-window fix 2026-11-03 ~13:26Z (lane `plan-to-complete/lane-watchdog-freshness-fix.md`; supervisor pid 9319 untouched throughout):** the adjacent blind spot recorded at the end of the start-path fix entry above is closed in `archiver-watchdog.sh`. New check (d): the newest fetch-log record with `"status":200` — read with the recovery verifier's own discipline (`grep -F '"status":200'`, utc via the same sed) — must be within `WATCHDOG_SUCCESS_WINDOW_SECONDS` (default 300 = one slowest-route cadence, the same 300 s quantum the existing 900/600 margins are built from), or the run is an incident (`no-successful-fetch(age=…,window=300s)`) and the documented recovery applies. Checks (a)/(b)/(c) and their thresholds are unchanged; successes on a healthy supervisor are far denser than the window (fast routes cycle at 60 s; the live log's newest 200 was 31 s old when read during the lane), so a mid-cycle supervisor inside the bounds is never falsely condemned. The HEALTHY line now also reports the last successful fetch age. Verified without touching pid 9319 (unit MainPID/active at both ends; health `generatedAtUtc` advanced 13:25:44Z → 13:27:03Z across the work): `bash -n` clean (no shellcheck on this VM); check (d)'s core pipeline run read-only against the live fetch log passes (age 31 s); a stubbed harness (sandbox data dirs, stub systemd-run/systemctl capturing argv, dummy supervisor processes) ran the real edited script end to end — positive control (fresh health, newest record a 200 ⇒ HEALTHY, no start attempted), boundary control (last 200 at 280 s with three fresher error records ⇒ HEALTHY), negative control (fresh health, newest record 10 s old, errors only for 900 s ⇒ check (d) the ONLY failure; recovery stopped the dummy, started via the stub with the proxy env carried in the captured `--setenv` argv, sentinel process-env values verbatim, and the feeder's post-restart 200 produced RECOVERY SUCCESS). The fix is live for the in-VM watchdog from its next OS-cron run (the crontab invokes the tree script directly). The matching rule text for the Muse-side watchdog job (`portal-archiver-watchdog`) is written in the lane record for the coordinator to apply via cron.view → cron.update; this lane edited no cron definition. Not yet proven live: no genuine all-fetches-failing incident has occurred under the fixed script — the first is that proof.

- **Supervisor death 2026-11-03 14:51Z — in-VM watchdog recovery, first genuine incident under the fixed scripts (both fixes proven live).** Supervisor pid 9319 (the 13:12Z proxy-env instance) went silent at the gap start: last fetch 2026-11-03T14:49:46Z (feed newestFetchUtc), last publish pub-644 at 14:50:52Z, last supervisor hook cycle 14:50:46Z. `health.json` records the gap on route voices 14:51:12.849Z → 15:17:58.416Z = 1605.6 s; `unexplainedGapCount` 68. `uptime -s` reads 2026-11-03 14:51:04Z, consistent with a VM reboot at the gap's start killing the supervisor and the OS cron layer together. Detection lag, stated honestly: the in-VM watchdog's last pre-incident line is 14:45:02Z `HEALTHY`; no 15:00Z run left a log line — with cron down after the reboot there was no run to log, but which actor restored the cron layer before detection is not recorded in the in-VM logs. Detection at 15:17:54Z: the in-VM watchdog's INCIDENT line names all four checks — `supervisor-dead(pid=none)`, `health-stale(age=1604s)`, `fetch-log-stalled(age=1602s)`, and the new check (d) `no-successful-fetch(age=1602s,window=300s)`. Recovery ran the documented path: fetch env resolved at start time (all nine variables, process-env source, names+sources logged only), supervisor started via `systemd-run` (unit elsewhere-portal-archiver, env via `--setenv`) at 15:17:56Z as pid 9699 (hooks 9708, poller following), and `RECOVERY SUCCESS` was verified on a real post-restart `"status":200` fetch record — first successful fetch 2026-11-03T15:17:57.097Z (fetch log 2868 → 2879) — not on log growth. This is the first genuine incident since the start-path fix (~13:17Z) and the success-window fix (~13:26Z), and both behaved as designed live: the env-resolved start fetched on its first cycle, and check (d) fired alongside the freshness checks. **The 48 h M1 window restarts from the first post-recovery fetch — earliest M1 exit 2026-11-05T15:17:57Z**, superseding the 13:12:15Z figure above. First post-recovery publish pub-645 at 15:18:04Z (bundleSeq 645); health refreshed 15:18:40Z with `inGapNow` false.

## Retention policy — the deep window and thinning (Owner ruling, 2026-11-03)

the project owner ruled Item 4 of the G-J1 pack: **"Keep the recent window deep and
thin the rest"** (DECISIONS.md). The archive keeps a deep recent window
fully traceable at raw-snapshot level; older material thins into the
sealed record. Implemented in `thinning.mjs` the same day (lane record:
`plan-to-complete/lane-archive-thinning.md`); this section is the
policy's operational home.

**The policy.**

- **Deep window: 7 days, every route.** Any snapshot captured within
  the last 7 days is kept in full. One depth for all routes — the
  deepest window Plan B §2.2 already used (map) — defended from the
  consumers: the Chronicle's golden week fits inside it whole; journey
  reconstruction and the corpus invariants get a week of continuous
  voices coverage; a week of speech stays verbatim-replayable; and
  every live-surface provenance trace (M6.06: claims cite bundle-era
  snapshots, at most days old) resolves to the raw snapshot with
  margin. Inside the window, "traceable" means the raw bytes.
- **Past the window, per class:** voices bodies are removed and
  replaced by speech-index rows (`derived/speech-index.jsonl` —
  place, author, time, snapshot id, character count; an index, not a
  copy), with quotes-registry snapshots exempt; status bodies are
  dropped (the fetch log and reset watch carry the transitions); map
  keeps only the last body of each day, with namings/raisings from
  removed bodies preserved as dated facts (`derived/map-facts.jsonl`);
  overview, news, chats, debates, discussions, problems, concerts,
  errata — and any future route — keep only the last body of each day.
  For those routes the derived substance lives outside the snapshot
  store (Growth counters/firsts from overview; Chronicle items from
  news), so past the window a trace honestly resolves to the sealed
  record: the chain hash, the thinning-manifest entry, the same-day
  surviving body, and the derived facts — not raw bytes.
- **Amendments to §2.2, both under the ruling:** the voices/status
  depth goes 48 h → 7 days; overview/news lose §2.2's never-thin
  status past the window ("thin the rest" admits no unbounded raw
  route — news alone measured ≈22 GB/yr unthinned). §2.2's intent for
  them is preserved in the never-thin derived layer.
- **Never thins:** `chain-<route>.jsonl` (the proof removed bytes
  existed); `fetch-log.jsonl`; `thinning-log.jsonl` +
  `thinning-manifests/`; all of `derived/`; `quotes-registry.json`;
  `world-books.json`; the newest snapshot of every route; golden
  fixtures by path; **every snapshot of a closed world book** (§2.3 —
  a closed book freezes read-only); and **every snapshot inside the
  current unjudged M1 window** (next bullet).
- **M1-window guard (structural, in the planner):** a snapshot
  captured at or after the start of the window currently under M1
  judgement — `health.json`'s `a0.lastGap.endUtc` — is never
  thinning-eligible, whatever its route age; an exit read judges the
  window exactly as it ran. `thinArchive` resolves the floor from
  health.json itself; an explicit `protectFromUtc` may extend
  protection to older material but can never shrink it. Thinning can
  neither create nor mask a gap: gaps are computed from fetch-log
  records, which never thin. Under the window in judgement at policy
  time (opened 2026-11-03T21:52:20Z), nothing in it may thin before
  the M1 exit read (~2026-11-05T21:52Z) — the guard makes that a
  property of the code, not of anyone's calendar.

**State at adoption (2026-11-03T23:00Z dry run):** 3,282 snapshots,
**0 eligible** — the archive opened 2026-11-02T02:07Z and its oldest
snapshot is ≈44.9 h old, inside even the pre-amendment 48 h voices
window. Kept by reason: 3,094 inside the deep window, 177 under the
M1 guard, 11 newest-of-route. First eligibility under the policy:
2026-11-09T02:07:14Z (the oldest snapshot crossing 7 days).
`node thinning.mjs verify` passes over the live archive (all 11
routes OK, 0 thinned).

**Projected steady state** (measured 2026-11-02T22:56Z →
2026-11-03T22:56Z from the fetch log): unthinned intake is
285.5 MB/day ≈ **104 GB/yr** (map 157, news 61, voices 23, chats 21,
problems 12.5, overview 8.7 MB/day). Under the policy the past-window
residue is ≈0.36 GB/yr (last-of-day bodies, map dominating) and the
never-thin proof layer accrues ≈0.7 GB/yr (fetch log ≈0.40, chains
≈0.27) — **total ≈1.1 GB/yr**, plus a bounded ≈2.0 GB held in the
7-day window itself. The residual floor is the proof layer: shrinking
it further would mean windowing the fetch log, which this policy
refuses (gap accounting lives there). Rates drift as the world grows;
re-measure at the weekly archive report.

**Invocation — deliberately NOT a supervisor step.** Thinning is an
AUTO-B11 expensive-reversal operation (hash manifest + chain verify +
bundle-reproduction + WP-05 copy gate before any byte is removed),
not an idempotent derived rebuild like the 12 cycle steps, so it runs
only when a coordinator invokes it: `node thinning.mjs run` from this
directory (dry runs: `node thinning.mjs plan`). **Preconditions for
the first real run:** (1) the M1 exit read has judged the then-current
window (the guard enforces this mechanically, but the first run is
not scheduled before it); (2) the supervisor's 900 s chain verify has
been switched from strict `chain.mjs verify` to the thinning-aware
`node thinning.mjs verify` semantics — after any real thinning the
strict verifier reports thinned files as missing and would log false
integrity incidents every 900 s; (3) a same-day dry run reviewed.
Cadence once live: weekly is ample — eligibility accrues daily and
nothing inside a 7-day window is time-critical.

## Incident — reboot #8, 2026-11-03 ~17:20Z (recovered 17:35:49Z)
- VM reboot at ~17:20Z killed supervisor pid 9699 AND the OS cron layer (package gone again on the new image). Silence from 2026-11-03T17:19:59.992Z (last successful fetch).
- The Muse-side watchdog run (scheduled 11:20 CST) detected DOWN (no supervisor, health stale, newest 200 >300 s old); its apt step stalled on apt-get update (proxy connection failures to the mirror) and the run hit its execution timeout mid-recovery — but its invocation of the in-VM watchdog script landed first: INCIDENT logged 17:35:47Z (all four checks firing), supervisor restarted via systemd-run with the fetch env resolved (pid 4652, poller 4666) at 17:35:49Z.
- First post-recovery successful fetch: 2026-11-03T17:35:49.819Z. Gap (health a0, status route): 17:19:59.992Z → 17:35:51.531Z = 951.5 s. unexplainedGapCount: 74.
- Cron layer completed by Atlas in the same incident window: apt-get update partially failed (3 mirror indexes unreachable through the proxy; old indexes used), apt-get install -y cron succeeded, systemctl start cron → active, watchdog crontab reinstalled verbatim and verified by crontab -l.
- M1 consequence: the 48-hour window restarts from 2026-11-03T17:35:51Z; earliest M1 exit ~2026-11-05T17:35:52Z (11:36 CST).

## Incident — reboot #9, 2026-11-03 ~19:56Z (recovered 20:09:11Z)
- VM reboot at ~19:56Z (`uptime -s` = 2026-11-03 13:56:14 CST) killed supervisor pid 4652 AND the OS cron layer (cron package gone again on the new image, root crontab gone, pid files gone). Silence from 2026-11-03T19:56:23.766Z (last successful fetch, chats).
- The Muse-side watchdog run (scheduled 14:05 CST) detected DOWN at 20:06Z: no supervisor/poller process, no elsewhere-portal-archiver unit, health.json 680 s old, newest "status":200 fetch 626 s old. Recovery ran the documented path verbatim: first `apt-get install -y cron` reported no installation candidate, so `apt-get update` ran (70.5 MB fetched, exit 0), then `apt-get install -y cron` (cron 3.0pl1-184ubuntu2) and `systemctl start cron` → active/enabled; the watchdog crontab line was reinstalled exactly as documented and verified with `crontab -l`.
- Supervisor restarted by running the in-VM watchdog script once: INCIDENT logged 20:09:09Z (`supervisor-dead(pid=none) fetch-log-stalled(age=766s) no-successful-fetch(age=766s,window=300s)`), fetch env resolved from process-env and passed via --setenv, start issued via systemd-run at 20:09:11Z as pid 4579 (poller 4593), and RECOVERY SUCCESS verified on a real post-restart "status":200 record — first post-recovery successful fetch 2026-11-03T20:09:11.640Z (overview).
- Gap (health a0, chats route): 19:56:23.766Z → 20:09:13.747Z = 769.981 s. unexplainedGapCount: 74 → 80. Independent verification at 20:09:55Z: supervisor/poller alive, unit active, cron active, crontab present, health.json refreshed 20:09:45Z with `inGapNow` false.
- M1 consequence: the 48-hour window restarts from 2026-11-03T20:09:11Z; earliest M1 exit ~2026-11-05T20:09:12Z (14:09 CST).

## Incident — reboot #10, 2026-11-03 ~21:43Z (recovered 21:52:20Z)
- VM reboot at ~21:43Z (`uptime -s` = 2026-11-03 15:43:17 CST) killed supervisor pid 4579 AND the OS cron layer (cron service inactive, root crontab gone). Silence from 2026-11-03T21:42:46.423Z (last successful fetch, status).
- The Muse-side watchdog run (scheduled 15:50 CST) detected DOWN at 21:51Z: no supervisor/poller process, health.json 487s old, newest "status":200 fetch ~501s old.
- Recovery ran the documented path: `apt-get install -y cron` (already newest) and `systemctl start cron` → active; the watchdog crontab line was reinstalled exactly as documented and verified with `crontab -l`; supervisor restarted by running the in-VM watchdog script once — INCIDENT logged 21:52:18Z (`supervisor-dead(pid=none) no-successful-fetch(age=572s,window=300s)`), fetch env resolved from process-env and passed via --setenv, start issued via systemd-run at 21:52:20Z as pid 7084 (poller 7098), RECOVERY SUCCESS verified on a real post-restart "status":200 record — first post-recovery successful fetch 2026-11-03T21:52:20.303Z (overview).
- Gap (health a0, status route): 21:42:46.423Z → 21:52:22.181Z = 575.758 s. unexplainedGapCount: 82 → 88. Health refreshed 21:53:02Z with `inGapNow` false; fetches continued (overview/status 21:53:21–23Z).
- M1 consequence: the 48-hour window restarts from 2026-11-03T21:52:20Z; earliest M1 exit ~2026-11-05T21:52:20Z (15:52 CST), superseding the 20:09:12Z figure above.
## Incident — reboot #11, 2026-11-04 ~00:08Z (recovered 00:22:15Z)
- VM reboot at ~00:08Z (`uptime -s` = 2026-11-03 18:08:14 CST) killed supervisor pid 7084 AND the OS cron layer (cron service inactive, root crontab gone). Silence from 2026-11-04T00:08:14.000Z (last successful fetch, status).
- The Muse-side watchdog run (scheduled 18:20 CST) detected DOWN at 00:21Z: no supervisor/poller process, no elsewhere-portal-archiver unit, health.json generated 00:06:16Z (957s old at in-VM incident log), newest "status":200 fetch 839s old at incident log.
- Recovery ran the documented path: `apt-get install -y cron` (already newest, 3.0pl1-184ubuntu2) and `systemctl start cron` → active; the watchdog crontab line was reinstalled exactly as documented and verified with `crontab -l`; supervisor restarted by running the in-VM watchdog script once — INCIDENT logged 00:22:13Z (`supervisor-dead(pid=none) health-stale(age=957s) fetch-log-stalled(age=839s,window=600s) no-successful-fetch(age=839s,window=300s)`), fetch env resolved from process-env and passed via --setenv, start issued via systemd-run at 00:22:15Z as pid 8133 (poller 8147), RECOVERY SUCCESS verified on a real post-restart "status":200 record — first post-recovery successful fetch 2026-11-04T00:22:15.492Z (overview).
- Gap (health a0, status route): 00:08:14.000Z → 00:22:17.485Z = 843.485 s. unexplainedGapCount: 88 → 94. Health refreshed 00:24:04Z with `inGapNow` false; fetches continued (overview/status/voices 00:24:20–21Z).
- M1 consequence: the 48-hour window restarts from 2026-11-04T00:22:15Z; earliest M1 exit ~2026-11-06T00:22:15Z (2026-11-05 18:22 CST), superseding the 21:52:20Z figure above.

## Incident — reboot #12, 2026-11-04 ~02:07Z (recovered 02:30:54Z)
- VM reboot at ~02:07Z (`uptime -s` = 2026-11-03 20:07:08 CST) killed supervisor pid 8133 AND the OS cron layer (cron service inactive, crontab command missing, root crontab gone). Silence from 2026-11-04T02:07:16.653Z (last successful fetch, voices).
- The Muse-side watchdog run (scheduled 20:20 CST) detected DOWN at 02:21Z: no supervisor/poller process, health.json generated 02:06:30Z (~876 s old), newest "status":200 fetch ~830 s old.
- Recovery ran the documented path: first `apt-get install -y cron` reported no installation candidate, so `apt-get update` was attempted — the apt lists lock was held by a system replay `apt-get update` (pid 771), which was waited on for ~360 s in short sleeps and never killed. After it released, `apt-get update` succeeded (36.1 MB fetched; one noble-security mirror InRelease failed through the proxy, other indexes used), `apt-get install -y cron` succeeded (cron 3.0pl1-184ubuntu2 + cron-daemon-common), and `systemctl start cron` → active. The watchdog crontab line was reinstalled exactly as documented and verified with `crontab -l`.
- Supervisor restarted by running the in-VM watchdog script once: INCIDENT logged 02:30:52Z (`supervisor-dead(pid=none) health-stale(age=1461s) fetch-log-stalled(age=1415s,window=600s) no-successful-fetch(age=1416s,window=300s)`), fetch env resolved from process-env and passed via --setenv, start issued via systemd-run at 02:30:54Z as pid 6393 (poller 6406), RECOVERY SUCCESS verified on a real post-restart "status":200 record — first post-recovery successful fetch 2026-11-04T02:30:54.428Z.
- Gap (health a0, voices route): 02:07:16.653Z → 02:30:55.702Z = 1,419.049 s. unexplainedGapCount: 94 → 104. Health refreshed 02:31:54Z with `inGapNow` false; fetches continued after recovery.
- M1 consequence: the 48-hour window restarts from 2026-11-04T02:30:54Z; earliest M1 exit ~2026-11-06T02:30:54Z (2026-11-05 20:30 CST), superseding the 00:22:15Z figure above.
