// Elsewhere Portal — M6.09 exit-gate checker (read-only).
//
// Runs the provenance-completeness check over the span that EXISTS
// and states the depth honestly. The plan's golden week is
// calendar-bound: the archive opened 2026-11-02 and the counters
// writer started 2026-11-03, so tonight this verifies completeness
// over ~2 days of record / 1 counted day — and says so, in those
// words, rather than dressing the span up as a week.
//
// Checks:
//   1. provenanceCheck (chronicle.mjs) over the book's items against
//      the counters + firsts streams on disk.
//   2. Headline spot-verification against an INDEPENDENT source: each
//      headline item's text is searched in the archived news-route
//      snapshots (build/data/archive/<date>/news-*.json) — the raw
//      record, not the bundle chain the items were derived from.
//   3. Calendar resolution: every gathering entry in the book resolves
//      to an episode in the current episodes feed (same opening stamp
//      + place), and its attendance equals that episode's recorded
//      speakers — nobody else.
//
// Usage: node chronicle-check.mjs [--feed <dir>] [--archive <dir>]

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provenanceCheck } from './chronicle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

async function readJsonl(path) {
  const text = await readFile(path, 'utf8');
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

export async function runChronicleCheck({ feedDir = join(HERE, 'feed'), archiveDir = join(HERE, 'archive') } = {}) {
  const book = JSON.parse(await readFile(join(feedDir, 'chronicle-book.json'), 'utf8'));
  const countersLines = await readJsonl(join(feedDir, 'daily-counters.jsonl'));
  const firstsLines = await readJsonl(join(feedDir, 'firsts.jsonl'));
  const episodesFeed = JSON.parse(await readFile(join(feedDir, 'episodes.json'), 'utf8'));

  const prov = provenanceCheck(book, { countersLines, firstsLines });
  const failures = [...prov.failures];

  // 2 — headline texts against the archived news snapshots.
  let newsFiles = [];
  try {
    for (const day of await readdir(archiveDir)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      for (const f of await readdir(join(archiveDir, day))) {
        if (f.startsWith('news-') && f.endsWith('.json')) newsFiles.push(join(archiveDir, day, f));
      }
    }
  } catch { /* no archive dir — reported as NOT RUN below */ }
  const headlines = (book.items || []).filter((i) => i.kind === 'headline');
  let headlinesVerified = 0;
  let headlineCheck = 'NOT RUN (no archived news snapshots found)';
  if (newsFiles.length) {
    const corpus = [];
    for (const f of newsFiles) corpus.push(await readFile(f, 'utf8'));
    const joined = corpus.join('\n');
    for (const h of headlines) {
      const needle = JSON.stringify(h.text).slice(1, -1);
      if (joined.includes(needle) || joined.includes(h.text)) headlinesVerified += 1;
      else failures.push({ id: h.id, reason: 'headline-not-in-archived-news' });
    }
    headlineCheck = `${headlinesVerified}/${headlines.length} headline items found verbatim in ${newsFiles.length} archived news snapshots`;
  }

  // 3 — calendar resolution against the current episodes feed.
  const episodes = episodesFeed.episodes || [];
  let calendarChecked = 0;
  for (const entry of book.calendar || []) {
    if (entry.kind !== 'gathering') continue;
    calendarChecked += 1;
    const ep = episodes.find((e) => e.firstUtc === entry.atUtc && (e.place || null) === entry.placeCode);
    if (!ep) { failures.push({ id: entry.atUtc, reason: 'calendar-entry-not-in-episodes' }); continue; }
    const same = JSON.stringify([...(ep.participants || [])].sort()) === JSON.stringify([...entry.attendance].sort());
    if (!same) failures.push({ id: entry.atUtc, reason: 'calendar-attendance-mismatch' });
  }

  return {
    ok: failures.length === 0,
    itemsChecked: prov.checked,
    span: prov.span,
    collectingSince: book.collectingSince,
    headlineCheck,
    calendarChecked,
    failures,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runChronicleCheck()
    .then((r) => {
      console.log(`chronicle-check: ${r.ok ? 'OK' : 'FAILED'}`);
      console.log(`  items provenance-checked: ${r.itemsChecked}`);
      console.log(`  counted span: ${r.span ? `${r.span.from} → ${r.span.to} (${r.span.countedDays} counted day(s))` : 'none'}`
        + ' — the archive opened 2026-11-02; the plan\u2019s golden week completes on the calendar, not tonight');
      console.log(`  headlines: ${r.headlineCheck}`);
      console.log(`  calendar entries resolved to episodes: ${r.calendarChecked}`);
      for (const f of r.failures) console.log(`  FAILURE ${f.id}: ${f.reason}`);
      if (!r.ok) process.exit(1);
    })
    .catch((err) => {
      console.error(`chronicle-check: FAILED — ${err.message}`);
      process.exit(1);
    });
}
