// Elsewhere Portal — Arm A (Data): world-reset detection (plan M1.06, PB-08).
//
// Observes consecutive overview snapshots (each paired with the newest status
// snapshot at or before it) and emits a verdict per pair — no-reset /
// suspected / confirmed — with the evidence, appended to
// archive/reset-watch.jsonl. It OBSERVES AND REPORTS ONLY: closing the old
// world-book and opening a new one is a later item (M1.05/M1.06 deriver work);
// nothing here writes to the archive's snapshot dirs or the bundle.
//
// Signals (PB-08: nextReset behaviour, joined-count discontinuity, book
// markers):
//   - joined-collapse: population.joined is cumulative ("every registration
//     ever"), so any decrease is anomalous and a collapse (drop ≥ 50%, or to
//     ≤ 5% of the prior value) is strong evidence of a fresh world.
//   - joined-decrease: a smaller decrease — anomalous, weaker alone.
//   - clock-rollback: (year, day_of_season) moving backwards — strong when
//     the year drops, weaker for a within-year day rollback.
//   - nextreset-consumed: the earlier status announced a reset (next_reset
//     non-null) and the later status shows it null again — corroborating.
//   - nextreset-announced: a reset appears on the status heartbeat — noted,
//     never itself a reset verdict (an announcement is not an event).
//   - test-world-flip: status.test_world changed value between the pair.
// Verdict: confirmed = ≥ 2 strong signals, or 1 strong + nextreset-consumed;
// suspected = exactly 1 strong, ≥ 2 weak, or a lone joined-decrease (joined
// is cumulative, so any decrease is anomalous enough to watch on its own);
// otherwise no-reset. Normal growth (joined rising, clock advancing)
// produces no signals at all.
// Node stdlib only.

import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmpStr } from './derive.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// Defensive marker extraction: missing fields become null, never guesses.
export function overviewMarkers(overview) {
  if (!overview || typeof overview !== 'object') return { joined: null, year: null, dayOfSeason: null };
  return {
    joined: typeof overview.population?.joined === 'number' ? overview.population.joined : null,
    year: typeof overview.year === 'number' ? overview.year : null,
    dayOfSeason: typeof overview.day_of_season === 'number' ? overview.day_of_season : null,
  };
}

export function statusMarkers(status) {
  if (!status || typeof status !== 'object') return { nextReset: null, testWorld: null, present: false };
  return {
    nextReset: status.next_reset ?? null,
    testWorld: typeof status.test_world === 'boolean' ? status.test_world : null,
    present: true,
  };
}

// Pure: prev/next are { overview, status|null, utc?, file? } → verdict object.
export function inspectPair(prev, next) {
  const p = overviewMarkers(prev.overview);
  const n = overviewMarkers(next.overview);
  const ps = statusMarkers(prev.status);
  const ns = statusMarkers(next.status);
  const signals = [];
  const strong = () => signals.filter((s) => s.strength === 'strong').length;
  const weak = () => signals.filter((s) => s.strength === 'weak').length;

  if (p.joined !== null && n.joined !== null) {
    if (n.joined < p.joined) {
      const drop = p.joined - n.joined;
      const ratio = p.joined > 0 ? n.joined / p.joined : 0;
      if (drop / p.joined >= 0.5 || ratio <= 0.05) {
        signals.push({ kind: 'joined-collapse', strength: 'strong', detail: `joined ${p.joined} → ${n.joined} (drop ${drop}, ${(100 * (1 - ratio)).toFixed(1)}%)` });
      } else {
        signals.push({ kind: 'joined-decrease', strength: 'weak', detail: `joined ${p.joined} → ${n.joined} (drop ${drop}); joined is cumulative, any decrease is anomalous` });
      }
    }
  }
  if (p.year !== null && n.year !== null) {
    if (n.year < p.year) {
      signals.push({ kind: 'clock-rollback', strength: 'strong', detail: `year ${p.year} → ${n.year}` });
    } else if (n.year === p.year && p.dayOfSeason !== null && n.dayOfSeason !== null && n.dayOfSeason < p.dayOfSeason - 1) {
      signals.push({ kind: 'clock-rollback', strength: 'weak', detail: `day_of_season ${p.dayOfSeason} → ${n.dayOfSeason} within year ${p.year}` });
    }
  }
  if (ps.present && ns.present) {
    if (ps.nextReset !== null && ns.nextReset === null) {
      signals.push({ kind: 'nextreset-consumed', strength: 'weak', detail: `next_reset was ${JSON.stringify(ps.nextReset)}, now null` });
    } else if (ps.nextReset === null && ns.nextReset !== null) {
      signals.push({ kind: 'nextreset-announced', strength: 'info', detail: `next_reset now ${JSON.stringify(ns.nextReset)}; an announcement, not an event` });
    }
    if (ps.testWorld !== null && ns.testWorld !== null && ps.testWorld !== ns.testWorld) {
      signals.push({ kind: 'test-world-flip', strength: 'weak', detail: `test_world ${ps.testWorld} → ${ns.testWorld}` });
    }
  }

  const consumed = signals.some((s) => s.kind === 'nextreset-consumed');
  const joinedDecrease = signals.some((s) => s.kind === 'joined-decrease');
  const verdict = strong() >= 2 || (strong() >= 1 && consumed) ? 'confirmed'
    : strong() === 1 || weak() >= 2 || joinedDecrease ? 'suspected'
    : 'no-reset';
  return {
    verdict,
    signals,
    evidence: {
      prev: { file: prev.file ?? null, utc: prev.utc ?? null, ...p, nextReset: ps.nextReset, testWorld: ps.testWorld },
      next: { file: next.file ?? null, utc: next.utc ?? null, ...n, nextReset: ns.nextReset, testWorld: ns.testWorld },
    },
  };
}

// "overview-20261102T020712Z.json" → comparable stamp string; null if foreign.
function stampOf(name) {
  const m = name.match(/-(\d{8}T\d{6}Z)(?:-[0-9a-f]+)?\.json$/);
  return m ? m[1] : null;
}

async function listSnapshots(archiveDir, route) {
  const out = [];
  let days = [];
  try {
    days = (await readdir(archiveDir)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  } catch { return out; }
  for (const day of days) {
    const files = (await readdir(join(archiveDir, day))).filter((f) => f.startsWith(route + '-') && stampOf(f)).sort();
    for (const f of files) out.push({ file: `${day}/${f}`, stamp: stampOf(f), path: join(archiveDir, day, f) });
  }
  // Code-unit order via cmpStr (derive.mjs): localeCompare is locale/ICU-
  // dependent, so snapshot ordering must not vary by machine.
  return out.sort((a, b) => cmpStr(a.stamp, b.stamp));
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

// Scan the archive, inspect every consecutive overview pair not already in
// the watch file, append verdicts. Returns the newly written findings.
export async function runWatch({ archiveDir, watchFile }) {
  const overviews = await listSnapshots(archiveDir, 'overview');
  const statuses = await listSnapshots(archiveDir, 'status');
  const statusBodies = new Map();
  for (const s of statuses) statusBodies.set(s.file, await readJson(s.path));
  const statusFor = (stamp) => {
    let best = null;
    for (const s of statuses) if (s.stamp <= stamp) best = s; else break;
    return best ? statusBodies.get(best.file) : null;
  };

  const seen = new Set();
  try {
    for (const line of (await readFile(watchFile, 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      try {
        const f = JSON.parse(line);
        if (f.evidence?.prev?.file && f.evidence?.next?.file) seen.add(`${f.evidence.prev.file}→${f.evidence.next.file}`);
      } catch { /* torn line ignored */ }
    }
  } catch { /* no watch file yet */ }

  const findings = [];
  for (let i = 1; i < overviews.length; i++) {
    const prev = overviews[i - 1];
    const next = overviews[i];
    const key = `${prev.file}→${next.file}`;
    if (seen.has(key)) continue;
    const [prevBody, nextBody] = await Promise.all([readJson(prev.path), readJson(next.path)]);
    if (!prevBody || !nextBody) continue;
    const finding = {
      inspectedAtUtc: new Date().toISOString(),
      ...inspectPair(
        { overview: prevBody, status: statusFor(prev.stamp), file: prev.file, utc: typeof prevBody.generated_at === 'string' ? prevBody.generated_at : null },
        { overview: nextBody, status: statusFor(next.stamp), file: next.file, utc: typeof nextBody.generated_at === 'string' ? nextBody.generated_at : null },
      ),
    };
    findings.push(finding);
  }
  if (findings.length) {
    await mkdir(dirname(watchFile), { recursive: true });
    await appendFile(watchFile, findings.map((f) => JSON.stringify(f)).join('\n') + '\n', 'utf8');
  }
  return findings;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const archiveDir = opt('--archive') ?? join(HERE, 'archive');
  const watchFile = opt('--watch-file') ?? join(archiveDir, 'reset-watch.jsonl');
  const findings = await runWatch({ archiveDir, watchFile });
  if (!findings.length) console.log('reset-watch: no new snapshot pairs to inspect');
  for (const f of findings) {
    console.log(`${f.evidence.prev.file} → ${f.evidence.next.file}: ${f.verdict}${f.signals.length ? ' [' + f.signals.map((s) => s.kind).join(', ') + ']' : ''}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('reset-detect failed:', err);
    process.exitCode = 1;
  });
}
