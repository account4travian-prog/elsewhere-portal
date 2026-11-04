// Elsewhere Portal — Arm A (Data): archive health surface (plan M1.07).
//
// Pure read over archive/fetch-log.jsonl + cadence.json → archive/health.json:
// per-route last success / last change / 24 h error counts / current gap status
// vs cadence, plus the overall A0 figure (hours since the last unexplained
// gap). A "gap" is any interval between consecutive successes on a route —
// or between the route's first attempt and its first success, or between its
// last success and now — longer than GAP_FACTOR × that route's cadence
// (M1.04's acceptance language: zero gaps > 2× cadence). No explanation
// mechanism exists yet, so every such gap is unexplained by construction;
// when one lands, it sets `explained` here rather than editing this module.
//
// The poller knows bytes, not meaning; this module knows the log, not the
// world. It never fetches. Node stdlib only.
//
// Two read-only companion sections ride along (both optional, both null
// until their producer first runs): `bundle` (the live feed manifest)
// and `invariants` (M3.05 — the corpus invariant run's summary from
// archive/invariants.json, authored by corpus-invariants.mjs: journeys
// checked, violation count, mutant-control verdict, stuck-actor
// suspects, over-long beats. A corpus violation is visible HERE, in
// the health surface, not only in a test log.)

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// M3.05: the invariants health section's shape is authored by the
// corpus runner itself. (Import cycle note: corpus-invariants.mjs
// reaches this module transitively via journeys-cycle.mjs; every
// cross-use on both sides is at call time, never module top level.)
import { invariantsHealthSection } from './corpus-invariants.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const GAP_FACTOR = 2;
const DAY_MS = 24 * 3600 * 1000;

export function parseFetchLog(text) {
  const records = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch { /* a torn final line is skipped, never fatal */ }
  }
  return records;
}

const isSuccess = (r) => r.status === 200;
const isChange = (r) => isSuccess(r) && typeof r.snapshotId === 'string' && r.snapshotId.length > 0;

// Gap intervals for one route's chronologically sorted records.
// Returns [{startUtc, endUtc|null, durationSeconds, ongoing}].
function gapIntervals(records, cadenceSeconds, nowMs) {
  const thresholdMs = GAP_FACTOR * cadenceSeconds * 1000;
  const gaps = [];
  let cursorMs = null; // start of the current "no success yet" stretch
  let seenAny = false;
  for (const r of records) {
    const t = Date.parse(r.utc);
    if (Number.isNaN(t)) continue;
    if (!seenAny) { cursorMs = t; seenAny = true; }
    if (isSuccess(r)) {
      if (cursorMs !== null && t - cursorMs > thresholdMs) {
        gaps.push({ startUtc: new Date(cursorMs).toISOString(), endUtc: r.utc, durationSeconds: (t - cursorMs) / 1000, ongoing: false });
      }
      cursorMs = t;
    }
  }
  if (seenAny && cursorMs !== null && nowMs - cursorMs > thresholdMs) {
    gaps.push({ startUtc: new Date(cursorMs).toISOString(), endUtc: null, durationSeconds: (nowMs - cursorMs) / 1000, ongoing: true });
  }
  return gaps;
}

// Pure: records + cadence ({routesSeconds}) + now (Date) → health object.
export function computeHealth(records, cadence, now = new Date()) {
  const nowMs = now.getTime();
  const routes = {};
  const allGaps = [];
  for (const route of Object.keys(cadence.routesSeconds ?? {})) {
    const cadenceSeconds = cadence.routesSeconds[route];
    const mine = records.filter((r) => r.route === route).sort((a, b) => Date.parse(a.utc) - Date.parse(b.utc));
    const successes = mine.filter(isSuccess);
    const changes = mine.filter(isChange);
    const errors24h = mine.filter((r) => !isSuccess(r) && nowMs - Date.parse(r.utc) <= DAY_MS && Date.parse(r.utc) <= nowMs).length;
    const lastSuccess = successes[successes.length - 1] ?? null;
    const lastChange = changes[changes.length - 1] ?? null;
    const gaps = gapIntervals(mine, cadenceSeconds, nowMs).map((g) => ({ route, ...g }));
    allGaps.push(...gaps);
    const secondsSinceLastSuccess = lastSuccess ? (nowMs - Date.parse(lastSuccess.utc)) / 1000 : null;
    routes[route] = {
      cadenceSeconds,
      gapThresholdSeconds: GAP_FACTOR * cadenceSeconds,
      attempts: mine.length,
      successes: successes.length,
      errors24h,
      lastAttemptUtc: mine[mine.length - 1]?.utc ?? null,
      lastSuccessUtc: lastSuccess?.utc ?? null,
      lastChangeUtc: lastChange?.utc ?? null,
      lastSha256: lastSuccess?.sha256 ?? null,
      secondsSinceLastSuccess,
      gapStatus: !lastSuccess ? (mine.length ? 'never-succeeded' : 'no-data')
        : secondsSinceLastSuccess > GAP_FACTOR * cadenceSeconds ? 'gap' : 'ok',
      gaps,
    };
  }
  allGaps.sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
  const ongoing = allGaps.filter((g) => g.ongoing);
  const lastEnded = [...allGaps].filter((g) => !g.ongoing).pop() ?? null;
  // A0: hours since the last unexplained gap ended; 0 while any gap is live.
  const hoursSince = ongoing.length ? 0 : lastEnded ? (nowMs - Date.parse(lastEnded.endUtc)) / 3600000 : null;
  return {
    generatedAtUtc: now.toISOString(),
    gapFactor: GAP_FACTOR,
    routes,
    a0: {
      hoursSinceLastUnexplainedGap: hoursSince === null ? null : Math.round(hoursSince * 1000) / 1000,
      inGapNow: ongoing.length > 0,
      unexplainedGapCount: allGaps.length,
      lastGap: allGaps[allGaps.length - 1] ?? null,
    },
  };
}

export async function buildHealth({ archiveDir, cadencePath, feedDir = null, now = new Date() }) {
  const [logText, cadenceText] = await Promise.all([
    readFile(join(archiveDir, 'fetch-log.jsonl'), 'utf8').catch(() => ''),
    readFile(cadencePath, 'utf8'),
  ]);
  const health = computeHealth(parseFetchLog(logText), JSON.parse(cadenceText), now);
  // Bundle freshness: the live feed manifest the supervisor's bundle step
  // last published (seq + hash + the fetch time the bundle was built
  // from). Read-only and optional — no manifest yet means bundle: null,
  // never a health failure.
  health.bundle = null;
  if (feedDir) {
    try {
      const manifest = JSON.parse(await readFile(join(feedDir, 'manifest.json'), 'utf8'));
      health.bundle = {
        bundleSeq: manifest.bundleSeq ?? null,
        worlddataHash: manifest.worlddataHash ?? null,
        newestFetchUtc: manifest.newestFetchUtc ?? null,
      };
    } catch { /* no published bundle yet */ }
  }
  // Corpus invariants (M3.05): the latest corpus-invariants.mjs report
  // (archive/invariants.json), summarised by that module's own
  // invariantsHealthSection so the shape has exactly one author.
  // Read-only and optional, like the bundle section: no report yet
  // means invariants: null, never a health failure. A violation in the
  // report is VISIBLE here (violations > 0), not only in a test log;
  // the report's generatedAtUtc rides along so a stale report reads
  // as stale.
  health.invariants = null;
  try {
    const report = JSON.parse(await readFile(join(archiveDir, 'invariants.json'), 'utf8'));
    health.invariants = invariantsHealthSection(report);
  } catch { /* no corpus run yet */ }
  return health;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const archiveDir = opt('--archive') ?? join(HERE, 'archive');
  const cadencePath = opt('--cadence') ?? join(HERE, 'cadence.json');
  const feedDir = opt('--feed') ?? join(HERE, 'feed');
  const out = opt('--out') ?? join(archiveDir, 'health.json');
  const now = opt('--now') ? new Date(opt('--now')) : new Date();
  const health = await buildHealth({ archiveDir, cadencePath, feedDir, now });
  await writeFile(out, JSON.stringify(health, null, 2) + '\n', 'utf8');
  const a0 = health.a0;
  console.log(`health → ${out}`);
  console.log(health.bundle
    ? `bundle: seq ${health.bundle.bundleSeq} hash ${health.bundle.worlddataHash} newestFetch=${health.bundle.newestFetchUtc}`
    : 'bundle: none published');
  console.log(health.invariants
    ? `invariants: ${health.invariants.journeysChecked} journeys checked, ${health.invariants.violations} violations, mutant ${health.invariants.mutantControl}, stuck suspects ${health.invariants.stuckSuspects}, over-long beats ${health.invariants.overLongBeats} (report ${health.invariants.generatedAtUtc})`
    : 'invariants: no corpus run yet');
  console.log(`A0: ${a0.inGapNow ? 'IN GAP NOW' : a0.hoursSinceLastUnexplainedGap === null ? 'no gaps recorded' : a0.hoursSinceLastUnexplainedGap + ' h since last unexplained gap'} (${a0.unexplainedGapCount} unexplained gap${a0.unexplainedGapCount === 1 ? '' : 's'} total)`);
  for (const [route, r] of Object.entries(health.routes)) {
    console.log(`${route}: ${r.gapStatus} lastSuccess=${r.lastSuccessUtc ?? 'never'} errors24h=${r.errors24h}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('health failed:', err);
    process.exitCode = 1;
  });
}
