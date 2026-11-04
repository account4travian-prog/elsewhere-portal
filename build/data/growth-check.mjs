// Elsewhere Portal — M6.08 counters checker (the exit gate's tool).
//
// The gate: "7-day counters match hand-checked diffs on three sampled
// days; every first resolves to its cited snapshots." Seven days of
// writer output cannot exist before seven days have passed, so this
// checker is built to run over ANY sampled day the writer has covered,
// and the gate's full run accrues on the calendar (the lane note in
// plan-to-complete/lane-m6-growth.md records which days have run).
//
// For every day present in feed/daily-counters.jsonl (or the --date
// days named), the checker verifies, from sources independent of the
// writer's own arithmetic wherever a source exists:
//   1. DELTA ARITHMETIC — every 'counters' line's deltas equal its
//      counters minus the previous line's counters (same book), field
//      by field. A baseline line must carry null deltas.
//   2. DAY CLOSE vs THE ARCHIVE — the day's closing `joined` equals
//      population.joined in that date's LAST archived overview
//      snapshot: a hand-diff against the raw record, not the bundle
//      chain the writer read. (Only `joined` is recomputed this way —
//      the other counters need the full bundle derivation; their
//      check is #3 plus the delta arithmetic.)
//   3. LATEST DAY CLOSE vs THE LIVE BUNDLE — the newest line's full
//      counter set equals countersOf(feed/world-data.json) exactly,
//      when the live bundle is the counted one.
//   4. FIRSTS RESOLVE — every bundle-diff first cites a bundleSeq the
//      writer actually counted (a counters line carries it); the
//      pre-seed's cited line is found verbatim in the Mayor's Ledger
//      record it names.
// Prints the sampled days' closes and day-over-day diffs as a table a
// human can hand-check, then a verdict. Exit 0 only if every check
// that could run passed; a check that could not run is reported as
// NOT RUN, never silently passed.
//
// Usage: node growth-check.mjs [--feed <dir>] [--archive <dir>]
//                              [--date YYYY-MM-DD]... (default: all days)

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUNTER_FIELDS, countersOf } from './growth.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER = join(HERE, '..', '..', '..', 'elsewhere', 'MAYORS-LEDGER.md');

async function readJsonl(path) {
  try {
    const text = await readFile(path, 'utf8');
    return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function lastOverviewJoined(archiveDir, date) {
  const dir = join(archiveDir, date);
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const files = names.filter((n) => n.startsWith('overview-') && n.endsWith('.json')).sort();
  if (!files.length) return null;
  const snap = JSON.parse(await readFile(join(dir, files[files.length - 1]), 'utf8'));
  const joined = snap?.population?.joined;
  return typeof joined === 'number' ? { joined, file: files[files.length - 1] } : null;
}

export async function runGrowthCheck({ feedDir = join(HERE, 'feed'), archiveDir = join(HERE, 'archive'), dates = null } = {}) {
  const problems = [];
  const notRun = [];
  const lines = await readJsonl(join(feedDir, 'daily-counters.jsonl'));
  if (!lines || !lines.length) {
    return { ok: false, problems: ['daily-counters.jsonl is missing or empty — the writer has not run'], notRun, days: [] };
  }
  const firsts = (await readJsonl(join(feedDir, 'firsts.jsonl'))) || [];

  // 1. delta arithmetic, per book, in file order
  const prevByBook = new Map();
  for (const line of lines) {
    const prev = prevByBook.get(line.bookId);
    if (line.kind === 'baseline') {
      if (line.deltas !== null) problems.push(`seq ${line.bundleSeq}: baseline line carries non-null deltas`);
    } else if (prev && line.deltas) {
      for (const f of COUNTER_FIELDS) {
        const a = prev.counters?.[f];
        const b = line.counters?.[f];
        if (typeof a === 'number' && typeof b === 'number' && line.deltas[f] !== b - a) {
          problems.push(`seq ${line.bundleSeq}: delta ${f} is ${line.deltas[f]}, counters say ${b - a}`);
        }
      }
    }
    prevByBook.set(line.bookId, line);
  }

  // day closes
  const byDate = new Map();
  for (const line of lines) {
    if (!line.date) continue;
    if (dates && !dates.includes(line.date)) continue;
    byDate.set(line.date, line); // file order is append order: last wins = close
  }
  const days = [];
  let prevClose = null;
  for (const date of [...byDate.keys()].sort()) {
    const close = byDate.get(date);
    const dayDiff = {};
    for (const f of COUNTER_FIELDS) {
      dayDiff[f] = prevClose && typeof prevClose.counters?.[f] === 'number' && typeof close.counters?.[f] === 'number'
        ? close.counters[f] - prevClose.counters[f] : null;
    }
    days.push({ date, bundleSeq: close.bundleSeq, counters: close.counters, dayDiff });
    prevClose = close;
  }

  // 2. day close vs the archive's last overview snapshot of the date
  for (const day of days) {
    const hand = await lastOverviewJoined(archiveDir, day.date);
    if (!hand) {
      notRun.push(`${day.date}: no archived overview snapshot to hand-diff joined against`);
    } else if (hand.joined !== day.counters.joined) {
      problems.push(`${day.date}: day-close joined ${day.counters.joined} != archived overview ${hand.file} population.joined ${hand.joined}`);
    } else {
      day.joinedHandDiff = `matches ${hand.file}`;
    }
  }

  // 3. newest line vs the live bundle
  const newest = lines[lines.length - 1];
  try {
    const bundle = JSON.parse(await readFile(join(feedDir, 'world-data.json'), 'utf8'));
    if (bundle.bundleSeq === newest.bundleSeq) {
      const live = countersOf(bundle);
      for (const f of COUNTER_FIELDS) {
        if (live[f] !== newest.counters[f]) {
          problems.push(`live bundle seq ${bundle.bundleSeq}: counter ${f} is ${live[f]}, newest line says ${newest.counters[f]}`);
        }
      }
    } else {
      notRun.push(`live bundle seq ${bundle.bundleSeq} is ahead of the newest counted line (seq ${newest.bundleSeq}) — live cross-check applies to the counted bundle only`);
    }
  } catch {
    notRun.push('live bundle unreadable — live cross-check not run');
  }

  // 4. firsts resolve
  const countedSeqs = new Set(lines.map((l) => l.bundleSeq));
  let ledgerText = null;
  for (const first of firsts) {
    if (first.provenance?.preseed) {
      if (ledgerText === null) {
        try { ledgerText = await readFile(LEDGER, 'utf8'); } catch { ledgerText = ''; }
      }
      if (!ledgerText.includes(first.provenance.citedLine)) {
        problems.push(`pre-seed ${first.kind}: cited line not found verbatim in the Mayor's Ledger`);
      }
    } else if (!countedSeqs.has(first.provenance?.bundleSeq)) {
      problems.push(`first ${first.kind} (${first.date}) cites bundleSeq ${first.provenance?.bundleSeq}, which no counters line counted`);
    }
  }

  return { ok: problems.length === 0, problems, notRun, days, firstsChecked: firsts.length };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const dates = [];
  let feedDir; let archiveDir;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--date') dates.push(args[++i]);
    else if (args[i] === '--feed') feedDir = args[++i];
    else if (args[i] === '--archive') archiveDir = args[++i];
    else throw new Error(`growth-check: unknown argument ${args[i]}`);
  }
  const result = await runGrowthCheck({
    ...(feedDir ? { feedDir } : {}),
    ...(archiveDir ? { archiveDir } : {}),
    dates: dates.length ? dates : null,
  });
  for (const day of result.days) {
    console.log(`${day.date}  close seq ${day.bundleSeq}  joined ${day.counters.joined}  nameable ${day.counters.nameable}  placed ${day.counters.placed}  treasury ${day.counters.treasury}  day-diff joined ${day.dayDiff.joined ?? '—'} treasury ${day.dayDiff.treasury ?? '—'}${day.joinedHandDiff ? `  [${day.joinedHandDiff}]` : ''}`);
  }
  console.log(`firsts checked: ${result.firstsChecked ?? 0}`);
  for (const n of result.notRun) console.log(`NOT RUN: ${n}`);
  for (const p of result.problems) console.log(`FAIL: ${p}`);
  console.log(result.ok ? 'growth-check: OK' : 'growth-check: PROBLEMS FOUND');
  process.exit(result.ok ? 0 : 1);
}
