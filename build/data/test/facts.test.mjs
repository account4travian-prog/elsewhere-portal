// portal.facts/v1 prototype tests. Fixtures are synthetic WorldData
// bundles in the live bundle's shape; the CLI cases run in temp dirs so
// the real feed and its accumulation state are never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringifyFacts, deriveDelta, diffBundles, FACTS_SCHEMA } from '../facts.mjs';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'facts.mjs');

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
  includeBookId = true,
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
    world: {
      sky: 'CLEAR',
      worldHour: 6,
      season,
      year,
      ...(includeBookId ? { bookId } : {}),
    },
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

function changingPair() {
  const prev = bundle({
    seq: 1,
    citizens: [
      citizen('portal-key:ada', 'EMBER_COLLEGE'),
      citizen('portal-key:bea', 'EMBER_PLAZA_OF_UNITY'),
    ],
    plots: [plot('EMBER_DISTRICT_1_PLOT_1', 1, 1)],
  });
  const next = bundle({
    seq: 2,
    at: '2026-11-02T00:05:00.000Z',
    season: 'SUMMER',
    population: 12,
    citizens: [
      citizen('portal-key:ada', 'EMBER_TOWNHALL'),
      citizen('portal-key:bea', 'EMBER_PLAZA_OF_UNITY'),
      citizen('portal-key:cyd', 'EMBER_PLAZA_OF_UNITY', { firstSeenUtc: '2026-11-02T00:04:00.000Z' }),
    ],
    plots: [
      plot('EMBER_DISTRICT_1_PLOT_1', 1, 1),
      plot('EMBER_DISTRICT_1_PLOT_2', 1, 2),
    ],
    works: [
      { code: 'LIBRARY_ANNEX', integrity: null },
      { code: 'MARKET_HALL', integrity: null },
    ],
  });
  return { prev, next };
}

function byType(facts) {
  const counts = {};
  for (const fact of facts) counts[fact.type] = (counts[fact.type] ?? 0) + 1;
  return counts;
}

test('one same-book pair emits every non-book fact type exactly once', () => {
  const { prev, next } = changingPair();
  const facts = diffBundles(prev, next);

  assert.deepEqual(byType(facts), {
    'citizen-first-seen': 1,
    'citizen-place-changed': 1,
    'place-first-evidenced': 1,
    'population-changed': 1,
    'season-changed': 1,
    'works-changed': 1,
  });
  assert.equal(facts.length, 6);
  for (const fact of facts) {
    assert.equal(fact.schema, FACTS_SCHEMA);
    assert.equal(fact.atUtc, next.newestFetchUtc);
    assert.deepEqual(fact.evidence, { fromSeq: 1, toSeq: 2 });
  }
  assert.equal(facts.find((f) => f.type === 'citizen-first-seen').subject, 'portal-key:cyd');
  assert.deepEqual(facts.find((f) => f.type === 'citizen-place-changed').detail, {
    citizenKey: 'portal-key:ada',
    name: 'ada',
    fromPlaceCode: 'EMBER_COLLEGE',
    toPlaceCode: 'EMBER_TOWNHALL',
  });
  assert.equal(facts.find((f) => f.type === 'place-first-evidenced').subject, 'EMBER_DISTRICT_1_PLOT_2');
  assert.deepEqual(facts.find((f) => f.type === 'population-changed').detail, { from: 10, to: 12, delta: 2 });
  assert.deepEqual(facts.find((f) => f.type === 'works-changed').detail, {
    added: ['MARKET_HALL'],
    removed: [],
    updated: [],
  });
});

test('deriveDelta is the same pure operation as diffBundles', () => {
  const { prev, next } = changingPair();
  assert.deepEqual(deriveDelta(prev, next), diffBundles(prev, next));
});

test('book boundary resets the baseline and emits only book-opened', () => {
  const { prev } = changingPair();
  const next = bundle({
    seq: 2,
    at: '2026-11-02T00:05:00.000Z',
    bookId: 'world-002',
    season: 'WINTER',
    year: 46,
    population: 99,
    citizens: [citizen('portal-key:new-person', 'EMBER_TOWNHALL')],
    plots: [plot('EMBER_DISTRICT_3_PLOT_9', 3, 9)],
    works: [{ code: 'PUBLIC_WORKSHOP', integrity: 0.25 }],
  });

  const facts = diffBundles(prev, next);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].type, 'book-opened');
  assert.equal(facts[0].subject, 'world');
  assert.deepEqual(facts[0].detail, { fromBookId: 'world-001', toBookId: 'world-002' });
});

test('no-change pair is the negative control: zero facts', () => {
  const { prev } = changingPair();
  const sameWorldNewerBundle = structuredClone(prev);
  sameWorldNewerBundle.bundleSeq = 2;
  sameWorldNewerBundle.newestFetchUtc = '2026-11-02T00:05:00.000Z';
  assert.deepEqual(diffBundles(prev, sameWorldNewerBundle), []);
});

test('missing place evidence does not fabricate a place change', () => {
  const prev = bundle({
    citizens: [
      citizen('portal-key:ada', null),
      citizen('portal-key:bea', 'EMBER_COLLEGE'),
    ],
  });
  const next = bundle({
    seq: 2,
    at: '2026-11-02T00:05:00.000Z',
    citizens: [
      citizen('portal-key:ada', 'EMBER_COLLEGE'),
      citizen('portal-key:bea', null),
    ],
  });
  assert.deepEqual(diffBundles(prev, next), []);
});

test('v1-shaped bundles without bookId still diff within the live book', () => {
  const prev = bundle({ includeBookId: false, population: 10 });
  const next = bundle({ includeBookId: false, seq: 2, at: '2026-11-02T00:05:00.000Z', population: 11 });
  const facts = diffBundles(prev, next);
  assert.deepEqual(facts.map((f) => f.type), ['population-changed']);
});

test('determinism: input row order does not change output bytes', () => {
  const { prev, next } = changingPair();
  const shuffledPrev = structuredClone(prev);
  const shuffledNext = structuredClone(next);
  shuffledPrev.citizens.reverse();
  shuffledPrev.ember.plots.reverse();
  shuffledPrev.ember.works.reverse();
  shuffledNext.citizens.reverse();
  shuffledNext.ember.plots.reverse();
  shuffledNext.ember.works.reverse();

  const first = diffBundles(prev, next);
  const second = diffBundles(shuffledPrev, shuffledNext);
  assert.deepEqual(second, first);
  assert.equal(canonicalStringifyFacts(second), canonicalStringifyFacts(first));
  assert.equal(canonicalStringifyFacts(diffBundles(prev, next)), canonicalStringifyFacts(first));
});

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function runCli(args) {
  const { stdout } = await run('node', [CLI, ...args]);
  return JSON.parse(stdout);
}

test('CLI pair mode is idempotent and persists the next bundle as state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'portal-facts-pair-'));
  const { prev, next } = changingPair();
  const prevPath = join(root, 'prev.json');
  const nextPath = join(root, 'next.json');
  const outPath = join(root, 'facts.jsonl');
  const statePath = join(root, 'facts-state.json');
  await writeJson(prevPath, prev);
  await writeJson(nextPath, next);

  const first = await runCli(['--prev', prevPath, '--next', nextPath, '--out', outPath, '--state', statePath]);
  assert.equal(first.facts, 6);
  assert.equal(first.appended, 6);
  assert.equal(first.duplicates, 0);
  const bytesAfterFirst = await readFile(outPath, 'utf8');
  assert.equal(bytesAfterFirst.trim().split('\n').length, 6);

  const second = await runCli(['--prev', prevPath, '--next', nextPath, '--out', outPath, '--state', statePath]);
  assert.equal(second.facts, 6);
  assert.equal(second.appended, 0);
  assert.equal(second.duplicates, 6);
  assert.equal(await readFile(outPath, 'utf8'), bytesAfterFirst);

  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(state.schema, FACTS_SCHEMA);
  assert.equal(state.lastDiffedBundle.bundleSeq, 2);
  assert.equal(state.lastDiffedBundle.world.bookId, 'world-001');
});

test('CLI feed mode initializes a baseline, then accumulates without duplicates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'portal-facts-feed-'));
  const feedDir = join(root, 'feed');
  const outPath = join(root, 'facts.jsonl');
  const statePath = join(root, 'facts-state.json');
  await mkdir(feedDir, { recursive: true });
  const { prev, next } = changingPair();
  await writeJson(join(feedDir, 'world-data.json'), prev);

  const initialized = await runCli(['--feed', feedDir, '--out', outPath, '--state', statePath]);
  assert.equal(initialized.mode, 'feed-state');
  assert.equal(initialized.historyAvailable, false);
  assert.equal(initialized.initialized, true);
  assert.equal(initialized.facts, 0);
  await assert.rejects(access(outPath));

  await writeJson(join(feedDir, 'world-data.json'), next);
  const accumulated = await runCli(['--feed', feedDir, '--out', outPath, '--state', statePath]);
  assert.equal(accumulated.initialized, false);
  assert.equal(accumulated.fromSeq, 1);
  assert.equal(accumulated.toSeq, 2);
  assert.equal(accumulated.appended, 6);
  const bytes = await readFile(outPath, 'utf8');
  assert.equal(bytes.trim().split('\n').length, 6);

  const rerun = await runCli(['--feed', feedDir, '--out', outPath, '--state', statePath]);
  assert.equal(rerun.facts, 0);
  assert.equal(rerun.appended, 0);
  assert.equal(await readFile(outPath, 'utf8'), bytes);
});

test('CLI feed state does not re-announce a returning citizen as first seen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'portal-facts-returning-'));
  const feedDir = join(root, 'feed');
  const outPath = join(root, 'facts.jsonl');
  const statePath = join(root, 'facts-state.json');
  await mkdir(feedDir, { recursive: true });
  const both = bundle({
    citizens: [citizen('portal-key:ada', 'EMBER_COLLEGE'), citizen('portal-key:bea', 'EMBER_PLAZA_OF_UNITY')],
  });
  const withoutAda = bundle({
    seq: 2,
    at: '2026-11-02T00:05:00.000Z',
    citizens: [citizen('portal-key:bea', 'EMBER_PLAZA_OF_UNITY')],
  });
  const adaReturns = bundle({
    seq: 3,
    at: '2026-11-02T00:10:00.000Z',
    citizens: [citizen('portal-key:ada', 'EMBER_COLLEGE'), citizen('portal-key:bea', 'EMBER_PLAZA_OF_UNITY')],
  });

  await writeJson(join(feedDir, 'world-data.json'), both);
  await runCli(['--feed', feedDir, '--out', outPath, '--state', statePath]);
  await writeJson(join(feedDir, 'world-data.json'), withoutAda);
  const dropped = await runCli(['--feed', feedDir, '--out', outPath, '--state', statePath]);
  assert.equal(dropped.facts, 0);
  await writeJson(join(feedDir, 'world-data.json'), adaReturns);
  const returned = await runCli(['--feed', feedDir, '--out', outPath, '--state', statePath]);
  assert.equal(returned.facts, 0);
  assert.equal(returned.appended, 0);
  await assert.rejects(access(outPath));
});

test('CLI history mode walks consecutive bundles and honors the book reset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'portal-facts-history-'));
  const historyDir = join(root, 'history');
  const outPath = join(root, 'facts.jsonl');
  const statePath = join(root, 'facts-state.json');
  await mkdir(historyDir, { recursive: true });
  const { prev, next } = changingPair();
  const newBook = bundle({
    seq: 3,
    at: '2026-11-02T00:10:00.000Z',
    bookId: 'world-002',
    season: 'WINTER',
    population: 1,
    citizens: [citizen('portal-key:other', 'EMBER_TOWNHALL')],
    plots: [],
    works: [],
  });
  await writeJson(join(historyDir, 'bundle-001.json'), prev);
  await writeJson(join(historyDir, 'bundle-002.json'), next);
  await writeJson(join(historyDir, 'bundle-003.json'), newBook);

  const first = await runCli(['--history', historyDir, '--out', outPath, '--state', statePath]);
  assert.equal(first.mode, 'history');
  assert.equal(first.bundles, 3);
  assert.equal(first.facts, 7); // six same-book changes + book-opened only
  assert.equal(first.appended, 7);
  const lines = (await readFile(outPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.filter((fact) => fact.type === 'book-opened').length, 1);
  assert.equal(lines.filter((fact) => fact.evidence.fromSeq === 2 && fact.type !== 'book-opened').length, 0);

  const second = await runCli(['--history', historyDir, '--out', outPath, '--state', statePath]);
  assert.equal(second.appended, 0);
  assert.equal(second.duplicates, 7);
});

test('CLI history suppresses first-seen for a citizen carried by an earlier bundle in the same book', async () => {
  const root = await mkdtemp(join(tmpdir(), 'portal-facts-history-returning-'));
  const historyDir = join(root, 'history');
  const outPath = join(root, 'facts.jsonl');
  const statePath = join(root, 'facts-state.json');
  await mkdir(historyDir, { recursive: true });
  const both = (seq, at) => bundle({
    seq,
    at,
    citizens: [citizen('portal-key:ada', 'EMBER_COLLEGE'), citizen('portal-key:bea', 'EMBER_PLAZA_OF_UNITY')],
  });
  await writeJson(join(historyDir, 'bundle-001.json'), both(1, '2026-11-02T00:00:00.000Z'));
  await writeJson(join(historyDir, 'bundle-002.json'), bundle({
    seq: 2,
    at: '2026-11-02T00:05:00.000Z',
    citizens: [citizen('portal-key:bea', 'EMBER_PLAZA_OF_UNITY')],
  }));
  await writeJson(join(historyDir, 'bundle-003.json'), both(3, '2026-11-02T00:10:00.000Z'));

  const result = await runCli(['--history', historyDir, '--out', outPath, '--state', statePath]);
  assert.equal(result.facts, 0);
  assert.equal(result.appended, 0);
  await assert.rejects(access(outPath));
});
