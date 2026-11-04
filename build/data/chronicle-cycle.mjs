// Elsewhere Portal — M6.09 Chronicle feed cycle (production wrapper
// around chronicle.mjs; same invocation contract as growth-cycle.mjs —
// see the supervisor's step list, where it runs AFTER the growth step).
//
// chronicle.mjs owns the semantics: the four admitted item sources,
// headline rejection by name, the counts-only minutes intake, the
// newspaper + calendar views, and the provenance checker. This module
// reimplements NONE of it. What it adds is the production contract:
//
//   - PINNED PATHS, resolved against this module's directory:
//       bundle     feed/world-data.json        (input; ticker + citizens)
//       counters   feed/daily-counters.jsonl   (input; M6.08's stream)
//       firsts     feed/firsts.jsonl           (input; M6.08's stream)
//       episodes   feed/episodes.json          (input; newspaper + calendar view)
//       pointers   feed/talk-summaries.jsonl   (OPTIONAL minutes intake —
//                    absent is normal until a producer writes it; each
//                    line is {pointer, episodeKey?, placeCode?, where?}
//                    wrapping an M5.01 chronicle-summary-pointer)
//       items      feed/chronicle-items.jsonl  (append-only, deduped by id)
//       state      feed/chronicle-state.json   (last counted bundleSeq)
//       book       feed/chronicle-book.json    (portal.chronicle-book/v1,
//                    rebuilt per run from the streams as they stand)
//   - PRE-FLIGHT: every input must exist (except the optional pointer
//     stream) and parse before a single byte is written.
//   - DEDUPE BY ITEM ID: candidates are re-derived from the full input
//     streams each run; a candidate whose id is already in the items
//     stream is kept as first written (its countedAtSeq — the bundle
//     the visit-window math reads — never drifts). Headline and
//     minutes items are stamped with the current bundleSeq at first
//     ingestion; diff items carry their counters line's own seq.
//   - WRITE ORDER: items stream first, state second, book last (the
//     facts/growth order). A failure logs STEP FAILURE in the
//     supervisor and never breaks the data cycle.
//
// Usage: node chronicle-cycle.mjs [--feed <dir>]

import { appendFile, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringify } from './derive.mjs';
import {
  buildCalendar,
  buildChronicleBook,
  buildNewspaper,
  itemFromFirst,
  itemFromHeadline,
  itemFromSummaryPointer,
  itemsFromCountersLine,
  withId,
} from './chronicle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function readJsonlIfExists(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const rows = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed));
  }
  return rows;
}

async function writeAtomic(path, text) {
  const tmp = `${path}.new`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, path);
}

export async function runChronicleCycle({ feedDir = join(HERE, 'feed') } = {}) {
  const bundlePath = join(feedDir, 'world-data.json');
  const countersPath = join(feedDir, 'daily-counters.jsonl');
  const firstsPath = join(feedDir, 'firsts.jsonl');
  const episodesPath = join(feedDir, 'episodes.json');
  const pointersPath = join(feedDir, 'talk-summaries.jsonl');
  const itemsPath = join(feedDir, 'chronicle-items.jsonl');
  const statePath = join(feedDir, 'chronicle-state.json');
  const bookPath = join(feedDir, 'chronicle-book.json');

  // ---- pre-flight: everything parses before anything is written ----
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
  if (!isRecord(bundle) || !Number.isInteger(bundle.bundleSeq) || !Array.isArray(bundle.citizens)) {
    throw new Error(`chronicle-cycle: ${bundlePath} does not carry the WorldData bundle shape`);
  }
  const countersRows = await readJsonlIfExists(countersPath);
  const firstsRows = await readJsonlIfExists(firstsPath);
  const episodesFeed = await readJsonIfExists(episodesPath);
  const pointerRows = await readJsonlIfExists(pointersPath);
  const existingItems = await readJsonlIfExists(itemsPath);
  const state = await readJsonIfExists(statePath);

  // ---- candidates from every admitted source ----
  const candidates = [];
  const rejected = [];
  for (const line of countersRows) candidates.push(...itemsFromCountersLine(line));
  for (const line of firstsRows) {
    const item = withId(itemFromFirst(line));
    if (item) candidates.push(item);
  }
  const knownNames = bundle.citizens.map((c) => c.name).filter(Boolean);
  for (const t of bundle.ticker || []) {
    const { item, rejected: rej } = itemFromHeadline(t, knownNames);
    if (item) candidates.push(item);
    else if (rej) rejected.push(rej);
  }
  for (const row of pointerRows) {
    const item = itemFromSummaryPointer(row?.pointer, {
      episodeKey: row?.episodeKey ?? null, placeCode: row?.placeCode ?? null, where: row?.where ?? null,
    });
    if (item) candidates.push(item);
  }

  // ---- dedupe by id; first-written row wins; stamp the visit seq ----
  const present = new Map(existingItems.map((r) => [r.id, r]));
  const fresh = [];
  for (const cand of candidates) {
    if (!cand?.id || present.has(cand.id)) continue;
    const stamped = cand.countedAtSeq == null ? { ...cand, countedAtSeq: bundle.bundleSeq } : cand;
    present.set(cand.id, stamped);
    fresh.push(stamped);
  }
  if (fresh.length) {
    await appendFile(itemsPath, fresh.map((r) => canonicalStringify(r)).join('\n') + '\n', 'utf8');
  }
  const allItems = [...present.values()];

  const dates = countersRows.map((l) => l.date).filter(Boolean).sort();
  const countersSpan = dates.length
    ? { firstDate: dates[0], lastDate: dates[dates.length - 1], countedDays: new Set(dates).size, lines: countersRows.length }
    : null;

  const book = buildChronicleBook({
    items: allItems,
    newspaper: buildNewspaper(episodesFeed),
    calendar: buildCalendar({ episodesFeed, ticker: bundle.ticker || [] }),
    countersSpan,
    throughSeq: bundle.bundleSeq,
  });

  await writeAtomic(statePath, canonicalStringify({
    kind: 'chronicle-state', lastCountedSeq: bundle.bundleSeq, itemCount: allItems.length,
    rejectedHeadlines: rejected.length,
  }) + '\n');
  await writeAtomic(bookPath, canonicalStringify(book) + '\n');

  return {
    appended: fresh.length, totalItems: allItems.length,
    rejectedHeadlines: rejected, throughSeq: bundle.bundleSeq,
    stateWasNull: state === null,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const feedIdx = args.indexOf('--feed');
  const feedDir = feedIdx >= 0 ? args[feedIdx + 1] : join(HERE, 'feed');
  runChronicleCycle({ feedDir })
    .then((r) => {
      console.log(`chronicle-cycle: appended ${r.appended}, total ${r.totalItems}, through seq ${r.throughSeq}`
        + (r.rejectedHeadlines.length ? `, rejected headlines: ${r.rejectedHeadlines.map((x) => x.reason).join(', ')}` : ''));
    })
    .catch((err) => {
      console.error(`chronicle-cycle: FAILED — ${err.message}`);
      process.exit(1);
    });
}
