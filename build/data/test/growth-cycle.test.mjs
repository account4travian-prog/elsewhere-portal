// growth-cycle tests: the production wrapper around growth.mjs.
// Every run happens in a temp feed dir so the real feed, its streams,
// and its state are never touched (the facts-cycle.test.mjs pattern).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGrowthCycle } from '../growth-cycle.mjs';

function citizen(citizenKey, placeCode) {
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
  };
}

function bundle({ seq = 1, at = '2026-11-03T00:00:00.000Z', bookId = 'world-001', counters = {}, citizens = [], plots = [] } = {}) {
  return {
    schema: 'portal.world-data/v2',
    bundleSeq: seq,
    newestFetchUtc: at,
    world: { bookId },
    counters: {
      populationKnown: 291, regionsDiscovered: 5821, regionsSurveyed: 5110,
      regionsNamed: 5015, collegeDeposits: 630, treasury: 804000, ...counters,
    },
    citizens,
    ember: { plots },
  };
}

async function makeFeed(b) {
  const dir = await mkdtemp(join(tmpdir(), 'portal-growth-'));
  await writeFile(join(dir, 'world-data.json'), JSON.stringify(b), 'utf8');
  return dir;
}

async function setBundle(dir, b) {
  await writeFile(join(dir, 'world-data.json'), JSON.stringify(b), 'utf8');
}

async function jsonl(dir, name) {
  try {
    const text = await readFile(join(dir, name), 'utf8');
    return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

test('first run: pre-seed once, baseline line, state, and book — no firsts mined from the baseline bundle', async (t) => {
  const dir = await makeFeed(bundle({ citizens: [citizen('portal-key:a-a', 'EMBER_PLAZA_OF_UNITY')] }));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const r = await runGrowthCycle({ feedDir: dir });
  assert.equal(r.baseline, true);
  assert.equal(r.appendedCounters, 1);
  assert.equal(r.appendedFirsts, 1); // the pre-seed, and only the pre-seed
  const lines = await jsonl(dir, 'daily-counters.jsonl');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, 'baseline');
  assert.equal(lines[0].deltas, null);
  assert.equal(lines[0].counters.nameable, 1);
  const firsts = await jsonl(dir, 'firsts.jsonl');
  assert.deepEqual(firsts.map((f) => f.kind), ['first-mayor']);
  const book = JSON.parse(await readFile(join(dir, 'growth-book.json'), 'utf8'));
  assert.equal(book.schema, 'portal.growth-book/v1');
  assert.equal(book.collectingSince, '2026-11-02');
  assert.equal(book.series.length, 1);
  // The wall in the built book carries the pre-seed — the book is built
  // from the streams on disk, not from in-memory rows.
  assert.deepEqual(book.firsts.map((f) => f.kind), ['first-mayor']);
});

test('second run on the same bundle appends nothing', async (t) => {
  const dir = await makeFeed(bundle({}));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await runGrowthCycle({ feedDir: dir });
  const r = await runGrowthCycle({ feedDir: dir });
  assert.equal(r.appendedCounters, 0);
  assert.equal(r.appendedFirsts, 0);
  assert.equal((await jsonl(dir, 'daily-counters.jsonl')).length, 1);
  assert.equal((await jsonl(dir, 'firsts.jsonl')).length, 1); // pre-seed not duplicated
});

test('advanced bundle: a fall and a new citizen land as one diff line plus the first', async (t) => {
  const dir = await makeFeed(bundle({ citizens: [] }));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await runGrowthCycle({ feedDir: dir });
  await setBundle(dir, bundle({
    seq: 2, at: '2026-11-03T02:00:00.000Z',
    counters: { treasury: 800000 },
    citizens: [citizen('portal-key:new-one', 'EMBER_COLLEGE')],
  }));
  const r = await runGrowthCycle({ feedDir: dir });
  assert.equal(r.appendedCounters, 1);
  assert.equal(r.appendedFirsts, 2); // first-named + first-placed
  const lines = await jsonl(dir, 'daily-counters.jsonl');
  assert.equal(lines.length, 2);
  assert.equal(lines[1].kind, 'counters');
  assert.equal(lines[1].deltas.treasury, -4000);
  assert.equal(lines[1].deltas.nameable, 1);
});

test('advanced bundle with no counter movement and no firsts appends no line — until the date rolls', async (t) => {
  const dir = await makeFeed(bundle({ citizens: [citizen('portal-key:a-a', null)] }));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await runGrowthCycle({ feedDir: dir });
  await setBundle(dir, bundle({ seq: 2, at: '2026-11-03T05:00:00.000Z', citizens: [citizen('portal-key:a-a', null)] }));
  const r1 = await runGrowthCycle({ feedDir: dir });
  assert.equal(r1.appendedCounters, 0); // same day, nothing moved
  await setBundle(dir, bundle({ seq: 3, at: '2026-11-04T00:30:00.000Z', citizens: [citizen('portal-key:a-a', null)] }));
  const r2 = await runGrowthCycle({ feedDir: dir });
  assert.equal(r2.appendedCounters, 1); // the daily marker
  const lines = await jsonl(dir, 'daily-counters.jsonl');
  assert.equal(lines[lines.length - 1].date, '2026-11-04');
  assert.equal(lines[lines.length - 1].deltas.joined, 0);
});

test('crash between append and state-save re-derives identical lines and the dedupe drops them', async (t) => {
  const dir = await makeFeed(bundle({ citizens: [] }));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await runGrowthCycle({ feedDir: dir });
  const stateAfterBaseline = await readFile(join(dir, 'growth-state.json'), 'utf8');
  await setBundle(dir, bundle({ seq: 2, at: '2026-11-03T02:00:00.000Z', citizens: [citizen('portal-key:new-one', null)] }));
  await runGrowthCycle({ feedDir: dir });
  const linesBefore = await jsonl(dir, 'daily-counters.jsonl');
  const firstsBefore = await jsonl(dir, 'firsts.jsonl');
  // Simulate the crash: state rewound to the baseline, streams kept.
  await writeFile(join(dir, 'growth-state.json'), stateAfterBaseline, 'utf8');
  const r = await runGrowthCycle({ feedDir: dir });
  assert.equal(r.appendedCounters, 0);
  assert.equal(r.appendedFirsts, 0);
  assert.deepEqual(await jsonl(dir, 'daily-counters.jsonl'), linesBefore);
  assert.deepEqual(await jsonl(dir, 'firsts.jsonl'), firstsBefore);
});

test('book change: the new book opens with a baseline line and a book-opened first, no cross-book deltas', async (t) => {
  const dir = await makeFeed(bundle({ citizens: [citizen('portal-key:a-a', 'EMBER_PLAZA_OF_UNITY')] }));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await runGrowthCycle({ feedDir: dir });
  await setBundle(dir, bundle({
    seq: 2, at: '2026-11-04T00:00:00.000Z', bookId: 'world-002',
    counters: { treasury: 10 }, citizens: [citizen('portal-key:a-a', 'EMBER_PLAZA_OF_UNITY')],
  }));
  const r = await runGrowthCycle({ feedDir: dir });
  assert.equal(r.appendedFirsts, 1);
  const lines = await jsonl(dir, 'daily-counters.jsonl');
  const last = lines[lines.length - 1];
  assert.equal(last.kind, 'baseline');
  assert.equal(last.bookId, 'world-002');
  assert.equal(last.deltas, null);
  const firsts = await jsonl(dir, 'firsts.jsonl');
  assert.equal(firsts[firsts.length - 1].kind, 'book-opened');
});

test('a malformed bundle fails pre-flight and writes nothing', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'portal-growth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'world-data.json'), '{"not":"a bundle"}', 'utf8');
  await assert.rejects(() => runGrowthCycle({ feedDir: dir }));
  assert.equal((await jsonl(dir, 'daily-counters.jsonl')).length, 0);
  assert.equal((await jsonl(dir, 'firsts.jsonl')).length, 0);
});

test('a bundleSeq going backwards is refused, never counted', async (t) => {
  const dir = await makeFeed(bundle({ seq: 5 }));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await runGrowthCycle({ feedDir: dir });
  await setBundle(dir, bundle({ seq: 4 }));
  await assert.rejects(() => runGrowthCycle({ feedDir: dir }), /backwards/);
});
