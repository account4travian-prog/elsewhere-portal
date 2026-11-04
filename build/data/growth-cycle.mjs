// Elsewhere Portal — M6.08 growth feed cycle (production wrapper around
// growth.mjs; companion step to facts-cycle.mjs, same invocation
// contract — see the supervisor's step list, where it runs AFTER the
// health step as the cycle's last step).
//
// growth.mjs owns the semantics: the pure pair diff (diffSummaries),
// the baseline law (the first counted bundle initialises the seen sets
// and is never mined for firsts), the hard book boundary, and the one
// plan-named pre-seed. This module reuses all of it — it reimplements
// NO diffing. What it adds is the production invocation contract:
//
//   - PINNED PATHS, resolved against this module's directory, so the
//     hook line carries no arguments and cannot drift:
//       bundle    feed/world-data.json        (input, published by run_bundle)
//       counters  feed/daily-counters.jsonl   (append-only portal.daily-counters/v1)
//       firsts    feed/firsts.jsonl           (append-only portal.firsts/v1)
//       state     feed/growth-state.json      (last-counted bundle summary + seen sets)
//       book      feed/growth-book.json       (portal.growth-book/v1, rebuilt per run)
//   - PRE-FLIGHT: the live bundle must exist, parse, and carry the
//     WorldData shape (bundleSeq, counters, citizens); an existing state
//     file must parse; existing stream lines must all parse. Any
//     pre-flight failure throws BEFORE a single byte is written, so a
//     failed cycle leaves the previous streams, state, and book
//     untouched.
//   - EXIT SEMANTICS for run_step: success (including baseline init and
//     no-change runs) exits 0; failure throws, the CLI exits nonzero,
//     and the supervisor logs STEP FAILURE — a growth failure never
//     breaks the data cycle (run_step semantics) and never reaches the
//     bundle, which was already published by an earlier step.
//   - APPEND RULE: a counters line is appended when the counted bundle
//     advanced AND (any counter moved, OR any first was evidenced, OR
//     the bundle's UTC date rolled past the last line's date — the
//     daily marker, so every day the writer runs has at least one line
//     and the day-close is always defined). Firsts are appended
//     whenever evidenced, counters line or not.
//   - WRITE ORDERING — streams first, state second, book last (the
//     facts-cycle order, kept deliberately): appends are canonically
//     deduped against what's already in the streams, so a crash between
//     append and state-save re-derives byte-identical lines on the next
//     run and the dedupe drops every one — at-least-once with an
//     idempotent sink. State and book are written temp+rename.
//
// FIRST RUN: with no state file, the cycle writes the plan's pre-seed
// first (first mayor, 2026-10-31, record-attested — growth.mjs's
// PRESEED_FIRSTS), appends the baseline counters line for the current
// live bundle (deltas null; nothing is diffed against a bundle the
// writer never counted), initialises the seen sets FROM that bundle,
// and builds the book. Changes from before the writer existed are
// never backfilled or invented.
//
// Usage: node growth-cycle.mjs [--feed <dir>]

import { appendFile, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringify } from './derive.mjs';
import {
  COUNTER_FIELDS,
  PRESEED_FIRSTS,
  buildGrowthBook,
  countersLine,
  diffSummaries,
  seenFromSummary,
  summaryOf,
  utcDateOf,
} from './growth.mjs';

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
    rows.push(JSON.parse(trimmed)); // a malformed line is a pre-flight failure
  }
  return rows;
}

async function writeAtomic(path, text) {
  const tmp = `${path}.new`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, path);
}

function seenToJson(seen) {
  return {
    citizenKeys: [...seen.citizenKeys].sort(),
    placedKeys: [...seen.placedKeys].sort(),
    placeCodes: [...seen.placeCodes].sort(),
  };
}

function seenFromJson(json) {
  return {
    citizenKeys: new Set(json?.citizenKeys || []),
    placedKeys: new Set(json?.placedKeys || []),
    placeCodes: new Set(json?.placeCodes || []),
  };
}

/** Append rows to a jsonl stream, canonically deduped against the rows
 *  already there (the facts.mjs sink discipline). Returns the count
 *  actually appended. */
async function appendDeduped(path, existing, rows) {
  if (!rows.length) return 0;
  const present = new Set(existing.map((r) => canonicalStringify(r)));
  const fresh = [];
  for (const row of rows) {
    const key = canonicalStringify(row);
    if (!present.has(key)) {
      present.add(key);
      fresh.push(row);
    }
  }
  if (fresh.length) {
    await appendFile(path, fresh.map((r) => canonicalStringify(r)).join('\n') + '\n', 'utf8');
  }
  return fresh.length;
}

export async function runGrowthCycle({ feedDir = join(HERE, 'feed') } = {}) {
  const bundlePath = join(feedDir, 'world-data.json');
  const countersPath = join(feedDir, 'daily-counters.jsonl');
  const firstsPath = join(feedDir, 'firsts.jsonl');
  const statePath = join(feedDir, 'growth-state.json');
  const bookPath = join(feedDir, 'growth-book.json');

  // ---- pre-flight: everything parses before anything is written ----
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
  if (!isRecord(bundle) || !Number.isInteger(bundle.bundleSeq)
      || !isRecord(bundle.counters) || !Array.isArray(bundle.citizens)) {
    throw new Error(`growth-cycle: ${bundlePath} does not carry the WorldData bundle shape`);
  }
  const state = await readJsonIfExists(statePath);
  const countersRows = await readJsonlIfExists(countersPath);
  const firstsRows = await readJsonlIfExists(firstsPath);

  const summary = summaryOf(bundle);
  let appendedCounters = 0;
  let appendedFirsts = 0;
  let baseline = false;
  let nextState;

  if (!state) {
    // FIRST RUN — pre-seed, baseline, seen sets from the live bundle.
    baseline = true;
    appendedFirsts = await appendDeduped(firstsPath, firstsRows, PRESEED_FIRSTS);
    const line = countersLine('baseline', summary, null);
    appendedCounters = await appendDeduped(countersPath, countersRows, [line]);
    if (appendedCounters) countersRows.push(line);
    nextState = {
      kind: 'growth-state',
      lastCounted: summary,
      seen: seenToJson(seenFromSummary(summary)),
    };
  } else {
    const prev = state.lastCounted;
    if (!isRecord(prev) || !Number.isInteger(prev.bundleSeq)) {
      throw new Error('growth-cycle: growth-state.json does not carry a lastCounted summary');
    }
    if (summary.bundleSeq === prev.bundleSeq) {
      nextState = state; // nothing advanced; the book rebuild below is a no-op in bytes
    } else if (summary.bundleSeq < prev.bundleSeq) {
      throw new Error(`growth-cycle: bundleSeq went backwards (${prev.bundleSeq} -> ${summary.bundleSeq}); refusing to count`);
    } else {
      const seen = seenFromJson(state.seen);
      const { bookChanged, deltas, firsts, seen: seenNext } = diffSummaries(prev, summary, seen);
      appendedFirsts = await appendDeduped(firstsPath, firstsRows, firsts);
      if (appendedFirsts) firstsRows.push(...firsts);
      const lastLine = countersRows.length ? countersRows[countersRows.length - 1] : null;
      const countersMoved = deltas === null
        || COUNTER_FIELDS.some((f) => typeof deltas[f] === 'number' && deltas[f] !== 0);
      const dateRolled = !lastLine || lastLine.date !== utcDateOf(summary.atUtc);
      if (countersMoved || appendedFirsts > 0 || dateRolled) {
        // A book change opens the new book with a baseline line, not a
        // diff — nothing is compared across the boundary.
        const line = bookChanged ? countersLine('baseline', summary, null) : countersLine('counters', summary, deltas);
        appendedCounters = await appendDeduped(countersPath, countersRows, [line]);
        if (appendedCounters) countersRows.push(line);
      }
      nextState = {
        kind: 'growth-state',
        lastCounted: summary,
        seen: seenToJson(seenNext),
      };
    }
  }

  if (nextState !== state) {
    await writeAtomic(statePath, canonicalStringify(nextState) + '\n');
  }
  // The book is rebuilt from the streams AS THEY STAND ON DISK after
  // the appends — never from in-memory rows, which can miss a row a
  // deduped append skipped or a previous run wrote.
  const finalCounters = await readJsonlIfExists(countersPath);
  const finalFirsts = await readJsonlIfExists(firstsPath);
  const book = buildGrowthBook(finalCounters, finalFirsts);
  await writeAtomic(bookPath, canonicalStringify(book) + '\n');

  return {
    bundleSeq: summary.bundleSeq,
    baseline,
    appendedCounters,
    appendedFirsts,
    seriesLines: finalCounters.length,
    firstsTotal: finalFirsts.length,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  let feedDir;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--feed') feedDir = args[++i];
    else throw new Error(`growth-cycle: unknown argument ${args[i]}`);
  }
  try {
    const summary = await runGrowthCycle(feedDir ? { feedDir } : {});
    console.log(`growth-cycle: ${JSON.stringify(summary)}`);
  } catch (err) {
    console.error(`growth-cycle: ${err.message}`);
    process.exit(1);
  }
}
