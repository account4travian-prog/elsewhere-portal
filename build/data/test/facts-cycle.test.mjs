// facts-cycle tests: the production wrapper around facts.mjs feed
// mode. Fixtures are synthetic WorldData bundles in the live bundle's
// shape (same helpers as facts.test.mjs); every run happens in a temp
// feed dir so the real feed, its stream, and its state are never
// touched. The one exception is the v2-citation test, which builds a
// v2 bundle from the real archive into the temp feed dir — the same
// real-head precedent as bundle-v2.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringifyFacts, diffBundles, FACTS_SCHEMA } from '../facts.mjs';
import { runFactsCycle } from '../facts-cycle.mjs';
import { buildBundleV2 } from '../build-bundle-v2.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARCHIVE = join(HERE, '..', 'archive');

function citizen(citizenKey, placeCode, extra = {}) {
  return {
    citizenKey,
    citizenId: null,
    handle: '',
    name: citizenKey.replace('portal-key:', '').replaceAll('-', ' '),
    firstSeenUtc: '2026-11-02T00:00:00.000Z',
    placeCode,
    state: 'present',
    evidenceUtc: '2026-11-02T00:00:00.000Z',
    provenance: { route: 'voices', fetchedUtc: '2026-11-02T00:00:00.000Z' },
    ...extra,
  };
}

function plot(code, district = 1, plotNumber = 1) {
  return {
    code,
    district,
    plot: plotNumber,
    provenanceClass: 'feed-evidenced',
    firstEvidencedUtc: '2026-11-02T00:00:00.000Z',
    provenance: { route: 'voices', fetchedUtc: '2026-11-02T00:00:00.000Z' },
  };
}

function bundle({
  seq = 1,
  at = '2026-11-02T00:00:00.000Z',
  bookId = 'world-001',
  season = 'SPRING',
  year = 45,
  population = 10,
  citizens = [],
  plots = [],
  works = [{ code: 'LIBRARY_ANNEX', integrity: null }],
} = {}) {
  return {
    schema: 'portal.world-data/v2',
    bundleSeq: seq,
    newestFetchUtc: at,
    dataAgeSeconds: 30,
    world: { sky: 'CLEAR', worldHour: 6, season, year, bookId },
    counters: {
      regionsDiscovered: 0,
      regionsSurveyed: 0,
      regionsNamed: 0,
      collegeDeposits: 0,
      treasury: 0,
      populationKnown: population,
    },
    ember: { districts: [], plots, works },
    citizens,
    citizenCollisions: [],
    ticker: [],
    episodes: [],
    actSequences: [],
    journeys: [],
  };
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function tempFeed(liveBundle) {
  const root = await mkdtemp(join(tmpdir(), 'portal-facts-cycle-'));
  const feedDir = join(root, 'feed');
  await mkdir(feedDir, { recursive: true });
  if (liveBundle) await writeJson(join(feedDir, 'world-data.json'), liveBundle);
  return {
    feedDir,
    bundlePath: join(feedDir, 'world-data.json'),
    outPath: join(feedDir, 'facts.jsonl'),
    statePath: join(feedDir, 'facts-state.json'),
  };
}

async function readState(statePath) {
  return JSON.parse(await readFile(statePath, 'utf8'));
}

async function streamLines(outPath) {
  const text = await readFile(outPath, 'utf8');
  return text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
}

test('baseline init: first run records the live bundle and appends zero facts', async () => {
  const live = bundle({
    citizens: [citizen('portal-key:ada', 'EMBER_COLLEGE')],
    plots: [plot('EMBER_DISTRICT_1_PLOT_1', 1, 1)],
  });
  const { feedDir, outPath, statePath } = await tempFeed(live);

  const summary = await runFactsCycle({ feedDir });
  assert.equal(summary.initialized, true);
  assert.equal(summary.facts, 0);
  assert.equal(summary.appended, 0);
  assert.equal(summary.toSeq, 1);
  // No backfill: the stream file is not even created.
  await assert.rejects(access(outPath));

  const state = await readState(statePath);
  assert.equal(state.schema, FACTS_SCHEMA);
  assert.equal(state.lastDiffedBundle.bundleSeq, 1);
  assert.deepEqual(state.seenCitizenKeys, ['portal-key:ada']);
  assert.deepEqual(state.seenPlaceCodes, ['EMBER_DISTRICT_1_PLOT_1']);
});

test('accumulation: a changed bundle appends its facts and advances the state', async () => {
  const first = bundle({
    citizens: [citizen('portal-key:ada', 'EMBER_COLLEGE'), citizen('portal-key:bea', 'EMBER_PLAZA_OF_UNITY')],
  });
  const second = bundle({
    seq: 2,
    at: '2026-11-02T00:05:00.000Z',
    population: 12,
    citizens: [
      citizen('portal-key:ada', 'EMBER_TOWNHALL'),
      citizen('portal-key:bea', 'EMBER_PLAZA_OF_UNITY'),
      citizen('portal-key:cyd', 'EMBER_PLAZA_OF_UNITY'),
    ],
  });
  const { feedDir, bundlePath, outPath, statePath } = await tempFeed(first);
  await runFactsCycle({ feedDir });

  await writeJson(bundlePath, second);
  const summary = await runFactsCycle({ feedDir });
  assert.equal(summary.initialized, false);
  assert.equal(summary.fromSeq, 1);
  assert.equal(summary.toSeq, 2);
  assert.equal(summary.appended, 3); // first-seen cyd, ada place-changed, population-changed

  const lines = await streamLines(outPath);
  assert.equal(lines.length, 3);
  for (const fact of lines) assert.equal(fact.schema, FACTS_SCHEMA);
  assert.deepEqual(
    lines.map((f) => f.type).sort(),
    ['citizen-first-seen', 'citizen-place-changed', 'population-changed'],
  );
  assert.equal((await readState(statePath)).lastDiffedBundle.bundleSeq, 2);
});

test('idempotency: re-running on an unchanged bundle appends nothing', async () => {
  const first = bundle({ citizens: [citizen('portal-key:ada', 'EMBER_COLLEGE')] });
  const second = bundle({
    seq: 2,
    at: '2026-11-02T00:05:00.000Z',
    citizens: [citizen('portal-key:ada', 'EMBER_TOWNHALL')],
  });
  const { feedDir, bundlePath, outPath } = await tempFeed(first);
  await runFactsCycle({ feedDir });
  await writeJson(bundlePath, second);
  await runFactsCycle({ feedDir });
  const bytes = await readFile(outPath, 'utf8');

  const rerun = await runFactsCycle({ feedDir });
  assert.equal(rerun.facts, 0);
  assert.equal(rerun.appended, 0);
  assert.equal(await readFile(outPath, 'utf8'), bytes);
});

test('no-change newer bundle: zero facts appended, state still advances', async () => {
  const first = bundle({ citizens: [citizen('portal-key:ada', 'EMBER_COLLEGE')] });
  const sameWorld = bundle({
    seq: 2,
    at: '2026-11-02T00:05:00.000Z',
    citizens: [citizen('portal-key:ada', 'EMBER_COLLEGE')],
  });
  const { feedDir, bundlePath, outPath, statePath } = await tempFeed(first);
  await runFactsCycle({ feedDir });
  await writeJson(bundlePath, sameWorld);

  const summary = await runFactsCycle({ feedDir });
  assert.equal(summary.facts, 0);
  assert.equal(summary.appended, 0);
  await assert.rejects(access(outPath));
  assert.equal((await readState(statePath)).lastDiffedBundle.bundleSeq, 2);
});

test('book-change reset: only book-opened is emitted and the seen sets reset to the new book', async () => {
  const oldBook = bundle({
    citizens: [citizen('portal-key:ada', 'EMBER_COLLEGE'), citizen('portal-key:bea', 'EMBER_PLAZA_OF_UNITY')],
    plots: [plot('EMBER_DISTRICT_1_PLOT_1', 1, 1)],
  });
  const newBook = bundle({
    seq: 2,
    at: '2026-11-02T00:05:00.000Z',
    bookId: 'world-002',
    season: 'WINTER',
    year: 46,
    population: 99,
    citizens: [citizen('portal-key:new-person', 'EMBER_TOWNHALL')],
    plots: [plot('EMBER_DISTRICT_3_PLOT_9', 3, 9)],
  });
  const { feedDir, bundlePath, outPath, statePath } = await tempFeed(oldBook);
  await runFactsCycle({ feedDir });
  await writeJson(bundlePath, newBook);

  const summary = await runFactsCycle({ feedDir });
  assert.equal(summary.appended, 1);
  const lines = await streamLines(outPath);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].type, 'book-opened');
  assert.deepEqual(lines[0].detail, { fromBookId: 'world-001', toBookId: 'world-002' });

  const state = await readState(statePath);
  assert.equal(state.lastDiffedBundle.world.bookId, 'world-002');
  assert.deepEqual(state.seenCitizenKeys, ['portal-key:new-person']);
  assert.deepEqual(state.seenPlaceCodes, ['EMBER_DISTRICT_3_PLOT_9']);
});

test('crash consistency A: stream appended but state not saved — re-run dedupes and advances', async () => {
  // The chosen order is stream-first, state-second. Simulate the crash
  // window: the pair's facts are already in the stream (canonical
  // lines, exactly as appendUniqueFacts would have written them) but
  // the state still names the older bundle.
  const first = bundle({ citizens: [citizen('portal-key:ada', 'EMBER_COLLEGE')] });
  const second = bundle({
    seq: 2,
    at: '2026-11-02T00:05:00.000Z',
    population: 11,
    citizens: [citizen('portal-key:ada', 'EMBER_TOWNHALL')],
  });
  const { feedDir, bundlePath, outPath, statePath } = await tempFeed(first);
  await runFactsCycle({ feedDir }); // baseline at seq 1

  const expected = diffBundles(first, second);
  assert.ok(expected.length > 0);
  const crashedStreamBytes = expected.map((fact) => canonicalStringifyFacts(fact)).join('\n') + '\n';
  await appendFile(outPath, crashedStreamBytes, 'utf8');
  await writeJson(bundlePath, second);

  const summary = await runFactsCycle({ feedDir });
  assert.equal(summary.appended, 0);
  assert.equal(summary.duplicates, expected.length);
  // Every fact present exactly once; stream bytes unchanged.
  assert.equal(await readFile(outPath, 'utf8'), crashedStreamBytes);
  // And the state recovered forward to the newer bundle.
  assert.equal((await readState(statePath)).lastDiffedBundle.bundleSeq, 2);
});

test('crash consistency B: state lost, stream kept — re-init never duplicates or rewrites the stream', async () => {
  const first = bundle({ citizens: [citizen('portal-key:ada', 'EMBER_COLLEGE')] });
  const second = bundle({
    seq: 2,
    at: '2026-11-02T00:05:00.000Z',
    citizens: [citizen('portal-key:ada', 'EMBER_TOWNHALL')],
  });
  const { feedDir, bundlePath, outPath, statePath } = await tempFeed(first);
  await runFactsCycle({ feedDir });
  await writeJson(bundlePath, second);
  await runFactsCycle({ feedDir });
  const streamBytes = await readFile(outPath, 'utf8');
  assert.ok(streamBytes.length > 0);

  // Lose the cursor entirely (deleted state file). The stream is the
  // durable record; the cycle re-baselines at the current bundle,
  // appends nothing, and leaves the stream byte-identical. The cost of
  // a lost cursor is the un-diffed interval, never corruption.
  await rm(statePath);
  const summary = await runFactsCycle({ feedDir });
  assert.equal(summary.initialized, true);
  assert.equal(summary.facts, 0);
  assert.equal(summary.appended, 0);
  assert.equal(await readFile(outPath, 'utf8'), streamBytes);
  assert.equal((await readState(statePath)).lastDiffedBundle.bundleSeq, 2);
});

test('failure leaves stream and state untouched: corrupt live bundle', async () => {
  const first = bundle({ citizens: [citizen('portal-key:ada', 'EMBER_COLLEGE')] });
  const second = bundle({
    seq: 2,
    at: '2026-11-02T00:05:00.000Z',
    citizens: [citizen('portal-key:ada', 'EMBER_TOWNHALL')],
  });
  const { feedDir, bundlePath, outPath, statePath } = await tempFeed(first);
  await runFactsCycle({ feedDir });
  await writeJson(bundlePath, second);
  await runFactsCycle({ feedDir });
  const streamBytes = await readFile(outPath, 'utf8');
  const stateBytes = await readFile(statePath, 'utf8');

  await writeFile(bundlePath, '{ not json', 'utf8');
  await assert.rejects(runFactsCycle({ feedDir }), /does not parse/);
  assert.equal(await readFile(outPath, 'utf8'), streamBytes);
  assert.equal(await readFile(statePath, 'utf8'), stateBytes);
});

test('failure leaves stream and state untouched: missing live bundle', async () => {
  const first = bundle({ citizens: [citizen('portal-key:ada', 'EMBER_COLLEGE')] });
  const { feedDir, bundlePath, statePath } = await tempFeed(first);
  await runFactsCycle({ feedDir });
  const stateBytes = await readFile(statePath, 'utf8');

  await rm(bundlePath);
  await assert.rejects(runFactsCycle({ feedDir }), /no live bundle/);
  assert.equal(await readFile(statePath, 'utf8'), stateBytes);
});

test('v2 citation: after the cycle runs, a v2 build cites the stream by schema id and seq', async () => {
  const first = bundle({ seq: 41, citizens: [citizen('portal-key:ada', 'EMBER_COLLEGE')] });
  const second = bundle({
    seq: 42,
    at: '2026-11-02T00:05:00.000Z',
    population: 11,
    citizens: [citizen('portal-key:ada', 'EMBER_COLLEGE')],
  });
  const { feedDir, bundlePath } = await tempFeed(first);
  await runFactsCycle({ feedDir });
  await writeJson(bundlePath, second);
  const accumulated = await runFactsCycle({ feedDir });
  assert.equal(accumulated.appended, 1); // population-changed only

  const { worldData, manifest } = await buildBundleV2({ archiveDir: ARCHIVE, feedDir });
  assert.deepEqual(worldData.world.facts, { schema: FACTS_SCHEMA, seq: 42 });
  assert.deepEqual(manifest.facts, { schema: FACTS_SCHEMA, seq: 42 });
});
