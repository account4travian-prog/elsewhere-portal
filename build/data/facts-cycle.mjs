// Elsewhere Portal — facts feed cycle (production wrapper around
// facts.mjs's feed mode; companion step to episodes-cycle.mjs).
//
// facts.mjs owns the stream semantics: the pure pair diff (diffBundles),
// the book-scoped seen sets that keep a returning citizen from being
// re-announced as first-seen, the hard book boundary, and the canonical
// dedupe on append. This module reuses all of it — it reimplements NO
// diffing. What it adds is the production invocation contract the
// supervisor hook needs (see FACTS-HOOK-SPEC.md):
//
//   - PINNED PATHS, resolved against this module's directory, so the
//     hook line carries no arguments and cannot drift:
//       bundle  feed/world-data.json   (input, published by run_bundle)
//       stream  feed/facts.jsonl       (append-only portal.facts/v1)
//       state   feed/facts-state.json  (last-diffed bundle + seen sets)
//   - PRE-FLIGHT: the live bundle must exist, parse, and carry the
//     WorldData shape; an existing state file must parse; an existing
//     stream's lines must all parse. Any pre-flight failure throws
//     BEFORE a single byte is written, so a failed cycle leaves the
//     previous stream and state untouched (the v2 builder then keeps
//     citing the last good seq — see the hook spec).
//   - EXIT SEMANTICS for run_step: success (including baseline init and
//     no-change runs) returns the facts.mjs summary; failure throws,
//     the CLI exits nonzero, and the supervisor logs STEP FAILURE.
//
// WRITE ORDERING — stream first, state second (the order facts.mjs's
// feed mode implements, kept deliberately):
//   1. append the pair's new facts to facts.jsonl (canonical dedupe
//      against what's already there), THEN
//   2. save facts-state.json atomically (temp file + rename).
// A crash between the two leaves state naming the OLDER bundle while
// the stream already holds the pair's facts. The next run re-diffs the
// same pair, re-derives byte-identical canonical facts, and the dedupe
// drops every one as a duplicate — the stream gains nothing twice and
// the state then advances. The reverse order would be unrecoverable:
// state saved first + crash before append = the state claims a pair
// was diffed whose facts were never written, and no later run ever
// re-derives them. Stream-first is at-least-once with an idempotent
// sink; state-first is at-most-once with silent loss. The state file
// itself is written temp+rename, so a crash mid-save leaves the old or
// the new state, never a torn one. (Pinned by tests in
// test/facts-cycle.test.mjs.)
//
// FIRST RUN: with no state file, the cycle initialises the baseline
// from the current live bundle and appends ZERO facts — changes from
// before the stream existed are never backfilled or invented.
//
// Usage: node facts-cycle.mjs [--feed <dir>] [--out <facts.jsonl>]
//                             [--state <facts-state.json>]
//        (defaults pin the production feed/ paths above)

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACTS_SCHEMA, runFactsCli } from './facts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Shape check only (mirrors facts.mjs's internal bundle test, which is
// not exported): a WorldData schema string and an integer bundleSeq.
function isBundleShape(value) {
  return isRecord(value)
    && typeof value.schema === 'string'
    && value.schema.startsWith('portal.world-data/')
    && Number.isInteger(value.bundleSeq);
}

async function readIfPresent(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

// Fail before any write if the inputs are not in a state the stream
// can safely advance from. facts.mjs would also throw on each of
// these, but only after opening its bookkeeping; checking here keeps
// the failure atomic and the log message specific to the cycle.
async function preflight({ bundlePath, outPath, statePath }) {
  const bundleText = await readIfPresent(bundlePath);
  if (bundleText === null) {
    throw new Error(`facts-cycle: no live bundle at ${bundlePath} — stream and state left untouched`);
  }
  let bundle;
  try {
    bundle = JSON.parse(bundleText);
  } catch (err) {
    throw new Error(`facts-cycle: live bundle at ${bundlePath} does not parse (${err.message}) — stream and state left untouched`);
  }
  if (!isBundleShape(bundle)) {
    throw new Error(`facts-cycle: live bundle at ${bundlePath} is not a portal.world-data bundle — stream and state left untouched`);
  }

  const stateText = await readIfPresent(statePath);
  if (stateText !== null) {
    try {
      JSON.parse(stateText);
    } catch (err) {
      throw new Error(`facts-cycle: facts state at ${statePath} does not parse (${err.message}) — refusing to advance the stream from a corrupt cursor`);
    }
  }

  const streamText = await readIfPresent(outPath);
  if (streamText !== null) {
    for (const line of streamText.split('\n')) {
      if (!line.trim()) continue;
      try {
        JSON.parse(line);
      } catch (err) {
        throw new Error(`facts-cycle: facts stream at ${outPath} holds an unparseable line (${err.message}) — refusing to append to a corrupt stream`);
      }
    }
  }
  return bundle;
}

/**
 * Run one facts cycle against a feed dir: diff the live bundle against
 * the state's last-diffed bundle and append the new portal.facts/v1
 * facts. Returns the facts.mjs feed-mode summary ({ initialized,
 * fromSeq, toSeq, facts, appended, duplicates, ... }). Throws — with
 * stream and state untouched — on any pre-flight or diff failure.
 */
export async function runFactsCycle({ feedDir, outFile, stateFile } = {}) {
  const feed = feedDir ?? join(HERE, 'feed');
  const outPath = outFile ?? join(feed, 'facts.jsonl');
  const statePath = stateFile ?? join(feed, 'facts-state.json');
  const bundlePath = join(feed, 'world-data.json');

  await preflight({ bundlePath, outPath, statePath });

  // The diffing, seen-set bookkeeping, book-boundary reset, dedupe,
  // append-then-save ordering: all facts.mjs feed mode, reused as-is.
  // Note: feed mode first looks for feed/history or feed/bundles with
  // >= 2 bundles and would switch to a history walk; the production
  // feed holds neither subdir (nothing in the pipeline creates one),
  // so the state-cursor path is the one that runs. See the hook spec.
  return runFactsCli(['--feed', feed, '--out', outPath, '--state', statePath]);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const feedDir = opt('--feed', join(HERE, 'feed'));
  const outFile = opt('--out', null) ?? undefined;
  const stateFile = opt('--state', null) ?? undefined;
  // facts.mjs prints the run summary itself; nothing more to report.
  await runFactsCycle({ feedDir, outFile, stateFile });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('facts-cycle failed:', err);
    process.exitCode = 1;
  });
}

export { FACTS_SCHEMA };
