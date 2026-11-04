// Elsewhere Portal — PortalFact stream prototype (M5 prep).
//
// Schema: portal.facts/v1. This is deliberately separate from the
// WorldData bundle schema: bundles remain the state authority, while this
// module derives a stream of dated, evidenced changes by comparing two
// consecutive bundles. It never re-interprets raw snapshots.
//
// Book boundaries are hard. When both bundles carry a world.bookId and
// those ids differ, the newer bundle opens a new book: diffBundles emits
// only `book-opened` and no citizen, place, population, works, or season
// comparison crosses the boundary.
//
// CLI modes:
//   node facts.mjs --prev <bundle.json> --next <bundle.json>
//                  [--out <facts.jsonl>] [--state <facts-state.json>]
//   node facts.mjs --history <dir>
//                  [--out <facts.jsonl>] [--state <facts-state.json>]
//   node facts.mjs [--feed <feed-dir>]
//                  [--out <facts.jsonl>] [--state <facts-state.json>]
//
// Feed mode first looks for retained bundle history in <feed>/history or
// <feed>/bundles. The current feed does not retain history, so the normal
// feed path compares feed/world-data.json with the last-diffed bundle copy
// stored in facts-state.json. A first feed run with no state initializes
// that baseline and emits no facts: changes before the stream starts are
// not backfilled or invented. Facts are appended as canonical JSON lines;
// an already-present canonical fact is never appended again.
//
// The pure pair diff is baseline-relative. The CLI walkers additionally
// carry book-scoped sets of citizen keys and place codes already seen in
// the stream segment, so a citizen or plot that drops out of one bundle
// and returns later is not announced as first-seen a second time. A book
// boundary resets those sets along with the diff baseline.

import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FACTS_SCHEMA = 'portal.facts/v1';
export const FACT_SCHEMA = FACTS_SCHEMA;

const HERE = dirname(fileURLToPath(import.meta.url));

function cmpStr(a, b) {
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort(cmpStr)) out[key] = canonicalValue(value[key]);
  return out;
}

export function canonicalStringifyFacts(value) {
  return JSON.stringify(canonicalValue(value));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bundleSeq(bundle) {
  return Number.isInteger(bundle?.bundleSeq) ? bundle.bundleSeq : null;
}

function bookIdOf(bundle) {
  return nonEmptyString(bundle?.world?.bookId);
}

function sortedRecordsBy(rows, keyOf, recordOf) {
  return (Array.isArray(rows) ? rows : [])
    .filter(isRecord)
    .map((row) => ({ key: keyOf(row), row: recordOf ? recordOf(row) : row }))
    .filter((entry) => nonEmptyString(entry.key))
    .sort((a, b) => cmpStr(a.key, b.key) || cmpStr(canonicalStringifyFacts(a.row), canonicalStringifyFacts(b.row)));
}

function mapByKey(rows, keyOf, recordOf) {
  const map = new Map();
  for (const entry of sortedRecordsBy(rows, keyOf, recordOf)) {
    // Bundle contracts make these keys unique. If a malformed bundle
    // repeats one, the canonically first record wins deterministically.
    if (!map.has(entry.key)) map.set(entry.key, entry.row);
  }
  return map;
}

function citizensByKey(bundle) {
  return mapByKey(bundle?.citizens, (citizen) => citizen.citizenKey);
}

function plotsByCode(bundle) {
  return mapByKey(bundle?.ember?.plots, (plot) => plot.code);
}

function worksByCode(bundle) {
  return mapByKey(
    bundle?.ember?.works,
    (work) => work.code,
    (work) => ({ code: work.code, integrity: work.integrity ?? null }),
  );
}

function makeFact(type, prev, next, subject, detail) {
  return {
    schema: FACTS_SCHEMA,
    type,
    atUtc: next?.newestFetchUtc ?? null,
    subject,
    detail,
    evidence: {
      fromSeq: bundleSeq(prev),
      toSeq: bundleSeq(next),
    },
  };
}

function compareFacts(a, b) {
  return cmpStr(a.type, b.type)
    || cmpStr(a.subject, b.subject)
    || cmpStr(canonicalStringifyFacts(a.detail), canonicalStringifyFacts(b.detail))
    || cmpStr(a.atUtc ?? '', b.atUtc ?? '');
}

/**
 * Purely derive portal.facts/v1 facts from two consecutive WorldData
 * bundles. Inputs are not mutated. Returned facts are sorted by type,
 * subject, and canonical detail bytes using code-unit string ordering.
 */
export function diffBundles(prev, next) {
  if (!isRecord(prev) || !isRecord(next)) {
    throw new TypeError('diffBundles requires two WorldData bundle objects');
  }

  const prevBookId = bookIdOf(prev);
  const nextBookId = bookIdOf(next);
  if (prevBookId && nextBookId && prevBookId !== nextBookId) {
    return [makeFact('book-opened', prev, next, 'world', {
      fromBookId: prevBookId,
      toBookId: nextBookId,
    })];
  }

  const facts = [];
  const prevCitizens = citizensByKey(prev);
  const nextCitizens = citizensByKey(next);

  for (const [citizenKey, citizen] of [...nextCitizens.entries()].sort(([a], [b]) => cmpStr(a, b))) {
    if (!prevCitizens.has(citizenKey)) {
      facts.push(makeFact('citizen-first-seen', prev, next, citizenKey, {
        citizenKey,
        name: citizen.name ?? null,
        placeCode: nonEmptyString(citizen.placeCode),
        firstSeenUtc: citizen.firstSeenUtc ?? null,
      }));
    }
  }

  for (const [citizenKey, nextCitizen] of [...nextCitizens.entries()].sort(([a], [b]) => cmpStr(a, b))) {
    const prevCitizen = prevCitizens.get(citizenKey);
    if (!prevCitizen) continue;
    const fromPlaceCode = nonEmptyString(prevCitizen.placeCode);
    const toPlaceCode = nonEmptyString(nextCitizen.placeCode);
    // A missing place is missing evidence, not a destination. Only a
    // change between two evidenced places is a place-changed fact.
    if (fromPlaceCode && toPlaceCode && fromPlaceCode !== toPlaceCode) {
      facts.push(makeFact('citizen-place-changed', prev, next, citizenKey, {
        citizenKey,
        name: nextCitizen.name ?? prevCitizen.name ?? null,
        fromPlaceCode,
        toPlaceCode,
      }));
    }
  }

  const prevPlots = plotsByCode(prev);
  const nextPlots = plotsByCode(next);
  for (const [code, plot] of [...nextPlots.entries()].sort(([a], [b]) => cmpStr(a, b))) {
    if (!prevPlots.has(code)) {
      facts.push(makeFact('place-first-evidenced', prev, next, code, {
        code,
        district: finiteNumber(plot.district),
        plot: finiteNumber(plot.plot),
        firstEvidencedUtc: plot.firstEvidencedUtc ?? null,
        provenanceClass: plot.provenanceClass ?? null,
      }));
    }
  }

  const prevPopulation = finiteNumber(prev?.counters?.populationKnown);
  const nextPopulation = finiteNumber(next?.counters?.populationKnown);
  if (prevPopulation !== null && nextPopulation !== null && prevPopulation !== nextPopulation) {
    facts.push(makeFact('population-changed', prev, next, 'world', {
      from: prevPopulation,
      to: nextPopulation,
      delta: nextPopulation - prevPopulation,
    }));
  }

  const prevWorks = worksByCode(prev);
  const nextWorks = worksByCode(next);
  const added = [...nextWorks.keys()].filter((code) => !prevWorks.has(code)).sort(cmpStr);
  const removed = [...prevWorks.keys()].filter((code) => !nextWorks.has(code)).sort(cmpStr);
  const updated = [...nextWorks.keys()]
    .filter((code) => prevWorks.has(code))
    .sort(cmpStr)
    .filter((code) => !Object.is(prevWorks.get(code).integrity, nextWorks.get(code).integrity))
    .map((code) => ({
      code,
      fromIntegrity: prevWorks.get(code).integrity,
      toIntegrity: nextWorks.get(code).integrity,
    }));
  if (added.length || removed.length || updated.length) {
    facts.push(makeFact('works-changed', prev, next, 'world', { added, removed, updated }));
  }

  const prevSeason = nonEmptyString(prev?.world?.season);
  const nextSeason = nonEmptyString(next?.world?.season);
  if (prevSeason && nextSeason && prevSeason !== nextSeason) {
    facts.push(makeFact('season-changed', prev, next, 'world', {
      from: prevSeason,
      to: nextSeason,
      fromYear: finiteNumber(prev?.world?.year),
      toYear: finiteNumber(next?.world?.year),
    }));
  }

  return facts.sort(compareFacts);
}

// CONTRACT-V2-DRAFT §3 names the pure operation deriveDelta. Keep that
// name as an exact alias of the task-level diffBundles API.
export function deriveDelta(prev, next) {
  return diffBundles(prev, next);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, canonicalStringifyFacts(value) + '\n', 'utf8');
  await rename(tmp, path);
}

async function readExistingFactLines(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return new Set();
    throw err;
  }
  const lines = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    // Canonicalizing parsed facts makes deduplication independent of the
    // key order used by an earlier writer of the same fact.
    lines.add(canonicalStringifyFacts(JSON.parse(line)));
  }
  return lines;
}

async function appendUniqueFacts(outPath, facts) {
  const existing = await readExistingFactLines(outPath);
  const fresh = [];
  let duplicates = 0;
  for (const fact of facts) {
    const line = canonicalStringifyFacts(fact);
    if (existing.has(line)) {
      duplicates += 1;
    } else {
      existing.add(line);
      fresh.push(line);
    }
  }
  if (fresh.length) {
    await mkdir(dirname(outPath), { recursive: true });
    await appendFile(outPath, fresh.join('\n') + '\n', 'utf8');
  }
  return { appended: fresh.length, duplicates };
}

function citizenKeysOf(bundle) {
  return [...citizensByKey(bundle).keys()].sort(cmpStr);
}

function placeCodesOf(bundle) {
  return [...plotsByCode(bundle).keys()].sort(cmpStr);
}

function isBookBoundary(prev, next) {
  const prevBookId = bookIdOf(prev);
  const nextBookId = bookIdOf(next);
  return Boolean(prevBookId && nextBookId && prevBookId !== nextBookId);
}

function seenSetsForPair(prev, next) {
  if (isBookBoundary(prev, next)) {
    return {
      seenCitizenKeys: citizenKeysOf(next),
      seenPlaceCodes: placeCodesOf(next),
    };
  }
  return {
    seenCitizenKeys: [...new Set([...citizenKeysOf(prev), ...citizenKeysOf(next)])].sort(cmpStr),
    seenPlaceCodes: [...new Set([...placeCodesOf(prev), ...placeCodesOf(next)])].sort(cmpStr),
  };
}

// Apply a pair diff to an accumulating stream segment. First-seen facts
// already announced for this book are suppressed; all other facts pass
// through in pair order. The returned seen sets describe the newer
// bundle's book after this pair has been consumed.
function applyPairToStream(prev, next, seenCitizenKeys, seenPlaceCodes) {
  const pairFacts = diffBundles(prev, next);
  if (isBookBoundary(prev, next)) {
    return {
      facts: pairFacts,
      seenCitizenKeys: new Set(citizenKeysOf(next)),
      seenPlaceCodes: new Set(placeCodesOf(next)),
    };
  }
  const nextSeenCitizenKeys = new Set(seenCitizenKeys);
  const nextSeenPlaceCodes = new Set(seenPlaceCodes);
  const facts = pairFacts.filter((fact) => {
    if (fact.type === 'citizen-first-seen' && nextSeenCitizenKeys.has(fact.subject)) return false;
    if (fact.type === 'place-first-evidenced' && nextSeenPlaceCodes.has(fact.subject)) return false;
    return true;
  });
  for (const key of citizenKeysOf(next)) nextSeenCitizenKeys.add(key);
  for (const code of placeCodesOf(next)) nextSeenPlaceCodes.add(code);
  return { facts, seenCitizenKeys: nextSeenCitizenKeys, seenPlaceCodes: nextSeenPlaceCodes };
}

function diffBundleSequence(bundles) {
  let seenCitizenKeys = new Set(citizenKeysOf(bundles[0]));
  let seenPlaceCodes = new Set(placeCodesOf(bundles[0]));
  const facts = [];
  for (let i = 1; i < bundles.length; i += 1) {
    const applied = applyPairToStream(bundles[i - 1], bundles[i], seenCitizenKeys, seenPlaceCodes);
    facts.push(...applied.facts);
    seenCitizenKeys = applied.seenCitizenKeys;
    seenPlaceCodes = applied.seenPlaceCodes;
  }
  return {
    facts,
    seenCitizenKeys: [...seenCitizenKeys].sort(cmpStr),
    seenPlaceCodes: [...seenPlaceCodes].sort(cmpStr),
  };
}

function stateFor(bundle, mode, seen = {}) {
  return {
    schema: FACTS_SCHEMA,
    kind: 'facts-state',
    mode,
    lastDiffedBundle: bundle,
    seenCitizenKeys: [...(seen.seenCitizenKeys ?? citizenKeysOf(bundle))].sort(cmpStr),
    seenPlaceCodes: [...(seen.seenPlaceCodes ?? placeCodesOf(bundle))].sort(cmpStr),
  };
}

async function saveState(statePath, bundle, mode, seen) {
  if (statePath) await writeJsonAtomic(statePath, stateFor(bundle, mode, seen));
}

async function loadState(statePath) {
  try {
    const state = await readJson(statePath);
    return isRecord(state) ? state : null;
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

function isBundle(value) {
  return isRecord(value)
    && typeof value.schema === 'string'
    && value.schema.startsWith('portal.world-data/')
    && Number.isInteger(value.bundleSeq);
}

async function loadHistoryBundles(historyDir) {
  const names = (await readdir(historyDir)).filter((name) => name.endsWith('.json')).sort(cmpStr);
  const bundles = [];
  for (const name of names) {
    const value = await readJson(join(historyDir, name));
    if (!isBundle(value)) continue;
    bundles.push({ path: join(historyDir, name), bundle: value });
  }
  bundles.sort((a, b) => (a.bundle.bundleSeq - b.bundle.bundleSeq)
    || cmpStr(a.bundle.newestFetchUtc ?? '', b.bundle.newestFetchUtc ?? '')
    || cmpStr(a.path, b.path));

  const deduped = [];
  const seenSeq = new Map();
  for (const entry of bundles) {
    const canonical = canonicalStringifyFacts(entry.bundle);
    if (seenSeq.has(entry.bundle.bundleSeq)) {
      if (seenSeq.get(entry.bundle.bundleSeq) !== canonical) {
        throw new Error(`history contains two different bundles with bundleSeq ${entry.bundle.bundleSeq}`);
      }
      continue;
    }
    seenSeq.set(entry.bundle.bundleSeq, canonical);
    deduped.push(entry.bundle);
  }
  return deduped;
}

async function findFeedHistory(feedDir) {
  for (const subdir of ['history', 'bundles']) {
    const dir = join(feedDir, subdir);
    try {
      const bundles = await loadHistoryBundles(dir);
      if (bundles.length >= 2) return bundles;
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }
  return null;
}

function optionValue(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  if (index + 1 >= args.length) throw new Error(`${flag} requires a value`);
  return args[index + 1];
}

function printSummary(summary) {
  console.log(JSON.stringify(summary, null, 2));
}

export async function runFactsCli(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: node facts.mjs [--prev <bundle> --next <bundle> | --history <dir> | --feed <dir>] [--out <facts.jsonl>] [--state <facts-state.json>]');
    return { mode: 'help', facts: 0, appended: 0, duplicates: 0 };
  }

  const prevPath = optionValue(argv, '--prev');
  const nextPath = optionValue(argv, '--next');
  const historyDir = optionValue(argv, '--history');
  const feedDir = optionValue(argv, '--feed') ?? join(HERE, 'feed');
  const modes = [Boolean(prevPath || nextPath), Boolean(historyDir), argv.includes('--feed')].filter(Boolean).length;
  if (modes > 1) throw new Error('choose only one mode: pair, --history, or --feed');
  if ((prevPath && !nextPath) || (!prevPath && nextPath)) throw new Error('--prev and --next must be supplied together');

  const outPath = optionValue(argv, '--out') ?? join(feedDir, 'facts.jsonl');
  const statePath = optionValue(argv, '--state') ?? join(feedDir, 'facts-state.json');

  if (prevPath && nextPath) {
    const prev = await readJson(prevPath);
    const next = await readJson(nextPath);
    if (!isBundle(prev) || !isBundle(next)) throw new Error('pair mode requires two portal.world-data bundles');
    const facts = diffBundles(prev, next);
    const result = await appendUniqueFacts(outPath, facts);
    await saveState(statePath, next, 'pair', seenSetsForPair(prev, next));
    const summary = {
      schema: FACTS_SCHEMA,
      mode: 'pair',
      historyAvailable: null,
      fromSeq: bundleSeq(prev),
      toSeq: bundleSeq(next),
      facts: facts.length,
      ...result,
      out: outPath,
      state: statePath,
    };
    printSummary(summary);
    return summary;
  }

  if (historyDir) {
    const bundles = await loadHistoryBundles(historyDir);
    if (!bundles.length) throw new Error(`no portal.world-data bundles found in ${historyDir}`);
    const sequence = diffBundleSequence(bundles);
    const facts = sequence.facts;
    const result = await appendUniqueFacts(outPath, facts);
    await saveState(statePath, bundles.at(-1), 'history', sequence);
    const summary = {
      schema: FACTS_SCHEMA,
      mode: 'history',
      historyAvailable: true,
      bundles: bundles.length,
      fromSeq: bundleSeq(bundles[0]),
      toSeq: bundleSeq(bundles.at(-1)),
      facts: facts.length,
      ...result,
      out: outPath,
      state: statePath,
    };
    printSummary(summary);
    return summary;
  }

  // Default / explicit feed mode.
  const history = await findFeedHistory(feedDir);
  if (history) {
    const sequence = diffBundleSequence(history);
    const facts = sequence.facts;
    const result = await appendUniqueFacts(outPath, facts);
    await saveState(statePath, history.at(-1), 'feed-history', sequence);
    const summary = {
      schema: FACTS_SCHEMA,
      mode: 'feed-history',
      historyAvailable: true,
      bundles: history.length,
      fromSeq: bundleSeq(history[0]),
      toSeq: bundleSeq(history.at(-1)),
      facts: facts.length,
      ...result,
      out: outPath,
      state: statePath,
    };
    printSummary(summary);
    return summary;
  }

  const live = await readJson(join(feedDir, basename('world-data.json')));
  if (!isBundle(live)) throw new Error(`feed bundle at ${feedDir} is not a portal.world-data bundle`);
  const state = await loadState(statePath);
  const previous = isRecord(state?.lastDiffedBundle) ? state.lastDiffedBundle : null;
  if (!previous) {
    await saveState(statePath, live, 'feed-state');
    const summary = {
      schema: FACTS_SCHEMA,
      mode: 'feed-state',
      historyAvailable: false,
      initialized: true,
      fromSeq: null,
      toSeq: bundleSeq(live),
      facts: 0,
      appended: 0,
      duplicates: 0,
      out: outPath,
      state: statePath,
    };
    printSummary(summary);
    return summary;
  }
  if (!isBundle(previous)) throw new Error(`facts state at ${statePath} does not contain a WorldData bundle`);
  if (bundleSeq(live) < bundleSeq(previous)) {
    throw new Error(`live bundleSeq ${bundleSeq(live)} is behind facts state ${bundleSeq(previous)}; refusing to rewind the fact stream`);
  }
  const priorSeenCitizenKeys = new Set(
    Array.isArray(state?.seenCitizenKeys) ? state.seenCitizenKeys : citizenKeysOf(previous),
  );
  const priorSeenPlaceCodes = new Set(
    Array.isArray(state?.seenPlaceCodes) ? state.seenPlaceCodes : placeCodesOf(previous),
  );
  const applied = applyPairToStream(previous, live, priorSeenCitizenKeys, priorSeenPlaceCodes);
  const facts = applied.facts;
  const result = await appendUniqueFacts(outPath, facts);
  await saveState(statePath, live, 'feed-state', applied);
  const summary = {
    schema: FACTS_SCHEMA,
    mode: 'feed-state',
    historyAvailable: false,
    initialized: false,
    fromSeq: bundleSeq(previous),
    toSeq: bundleSeq(live),
    facts: facts.length,
    ...result,
    out: outPath,
    state: statePath,
  };
  printSummary(summary);
  return summary;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runFactsCli().catch((err) => {
    console.error('facts failed:', err);
    process.exitCode = 1;
  });
}
