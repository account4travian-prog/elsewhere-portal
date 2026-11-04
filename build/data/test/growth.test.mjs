// growth.test.mjs — the M6.08 pure diff engine: counter deltas (falls
// included), evidenced firsts with provenance, the baseline law, and
// the hard book boundary. Synthetic summaries throughout; no feed, no
// archive, no wall clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTERS_SCHEMA,
  COUNTER_FIELDS,
  FIRSTS_SCHEMA,
  GROWTH_BOOK_SCHEMA,
  PRESEED_FIRSTS,
  buildGrowthBook,
  countersLine,
  countersOf,
  diffSummaries,
  seenFromSummary,
  summaryOf,
  utcDateOf,
} from '../growth.mjs';

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

function bundle({ seq = 1, at = '2026-11-03T00:00:00.000Z', bookId = 'world-001', counters = {}, citizens = [], plots = [] } = {}) {
  return {
    schema: 'portal.world-data/v2',
    bundleSeq: seq,
    newestFetchUtc: at,
    world: { bookId },
    counters: {
      populationKnown: 291,
      regionsDiscovered: 5821,
      regionsSurveyed: 5110,
      regionsNamed: 5015,
      collegeDeposits: 630,
      treasury: 804000,
      ...counters,
    },
    citizens,
    ember: { plots },
  };
}

test('countersOf keeps the three population numbers distinct', () => {
  const b = bundle({ citizens: [citizen('portal-key:a-a', 'EMBER_PLAZA_OF_UNITY'), citizen('portal-key:b-b', null), citizen('portal-key:c-c', 'EMBER_COLLEGE')] });
  const c = countersOf(b);
  assert.equal(c.joined, 291); // the record's own count
  assert.equal(c.nameable, 3); // citizens Portal can name in this bundle
  assert.equal(c.placed, 2); // of those, with an evidenced place
  assert.deepEqual(Object.keys(c).sort(), [...COUNTER_FIELDS].sort());
});

test('countersOf never zero-fills a counter the bundle does not carry', () => {
  const c = countersOf({ counters: {}, citizens: [] });
  assert.equal(c.joined, null);
  assert.equal(c.treasury, null);
  assert.equal(c.nameable, 0); // the citizen list itself is the evidence
});

test('diffSummaries: deltas carry falls as honestly as rises', () => {
  const prev = summaryOf(bundle({ seq: 1, citizens: [citizen('portal-key:a-a', 'EMBER_PLAZA_OF_UNITY')] }));
  const next = summaryOf(bundle({
    seq: 2,
    at: '2026-11-03T01:00:00.000Z',
    counters: { treasury: 803500, regionsDiscovered: 5830 },
    citizens: [citizen('portal-key:a-a', 'EMBER_PLAZA_OF_UNITY')],
  }));
  const { deltas, firsts } = diffSummaries(prev, next, seenFromSummary(prev));
  assert.equal(deltas.treasury, -500);
  assert.equal(deltas.regionsDiscovered, 9);
  assert.equal(deltas.joined, 0);
  assert.equal(firsts.length, 0);
});

test('diffSummaries: a newly named citizen is a first, with provenance, once only', () => {
  const prev = summaryOf(bundle({ seq: 1, citizens: [] }));
  const next = summaryOf(bundle({ seq: 2, at: '2026-11-03T01:00:00.000Z', citizens: [citizen('portal-key:new-one', null)] }));
  const r1 = diffSummaries(prev, next, seenFromSummary(prev));
  const named = r1.firsts.filter((f) => f.kind === 'citizen-first-named');
  assert.equal(named.length, 1);
  assert.equal(named[0].schema, FIRSTS_SCHEMA);
  assert.equal(named[0].subject.citizenKey, 'portal-key:new-one');
  assert.equal(named[0].date, '2026-11-03');
  assert.equal(named[0].provenance.basis, 'bundle-diff');
  assert.equal(named[0].provenance.bundleSeq, 2);
  // The same citizen in the next pair is not announced again.
  const third = summaryOf(bundle({ seq: 3, at: '2026-11-03T02:00:00.000Z', citizens: [citizen('portal-key:new-one', null)] }));
  const r2 = diffSummaries(next, third, r1.seen);
  assert.equal(r2.firsts.filter((f) => f.kind === 'citizen-first-named').length, 0);
});

test('diffSummaries: first placement and first evidenced place are separate firsts', () => {
  const prev = summaryOf(bundle({ seq: 1, citizens: [citizen('portal-key:a-a', null)] }));
  const next = summaryOf(bundle({
    seq: 2,
    citizens: [citizen('portal-key:a-a', 'EMBER_COLLEGE')],
    plots: [{ code: 'EMBER_DISTRICT_1_PLOT_30', provenance: { route: 'voices' } }],
  }));
  const { firsts } = diffSummaries(prev, next, seenFromSummary(prev));
  assert.deepEqual(firsts.map((f) => f.kind).sort(), ['citizen-first-placed', 'place-first-evidenced']);
});

test('baseline law: citizens already in the first counted bundle are seen, not firsts', () => {
  const base = summaryOf(bundle({ citizens: [citizen('portal-key:a-a', 'EMBER_PLAZA_OF_UNITY')] }));
  const seen = seenFromSummary(base);
  assert.ok(seen.citizenKeys.has('portal-key:a-a'));
  assert.ok(seen.placedKeys.has('portal-key:a-a'));
  const next = summaryOf(bundle({ seq: 2, citizens: [citizen('portal-key:a-a', 'EMBER_PLAZA_OF_UNITY')] }));
  assert.equal(diffSummaries(base, next, seen).firsts.length, 0);
});

test('book boundary: no deltas cross it, seen sets reset, one book-opened first', () => {
  const prev = summaryOf(bundle({ seq: 9, bookId: 'world-001', citizens: [citizen('portal-key:a-a', 'EMBER_PLAZA_OF_UNITY')] }));
  const next = summaryOf(bundle({ seq: 10, bookId: 'world-002', counters: { treasury: 5 }, citizens: [citizen('portal-key:a-a', 'EMBER_PLAZA_OF_UNITY')] }));
  const r = diffSummaries(prev, next, seenFromSummary(prev));
  assert.equal(r.bookChanged, true);
  assert.equal(r.deltas, null);
  assert.deepEqual(r.firsts.map((f) => f.kind), ['book-opened']);
  // The returning citizen belongs to the new book's baseline — not a first.
  const after = summaryOf(bundle({ seq: 11, bookId: 'world-002', citizens: [citizen('portal-key:a-a', 'EMBER_PLAZA_OF_UNITY')] }));
  assert.equal(diffSummaries(next, after, r.seen).firsts.length, 0);
});

test('countersLine: baseline carries null deltas; diff lines carry the pair basis', () => {
  const s = summaryOf(bundle({ seq: 7 }));
  const base = countersLine('baseline', s, null);
  assert.equal(base.schema, COUNTERS_SCHEMA);
  assert.equal(base.deltas, null);
  assert.equal(base.provenance.basis, 'baseline-bundle');
  const diff = countersLine('counters', s, { joined: 1 });
  assert.equal(diff.provenance.basis, 'bundle-diff');
});

test('the pre-seed is exactly the plan-named first mayor, record-attested and cited', () => {
  assert.equal(PRESEED_FIRSTS.length, 1);
  const seed = PRESEED_FIRSTS[0];
  assert.equal(seed.kind, 'first-mayor');
  assert.equal(seed.date, '2026-10-31');
  assert.equal(seed.subject.name, 'Atlas Meridian');
  assert.equal(seed.provenance.basis, 'record-attested');
  assert.equal(seed.provenance.preseed, true);
  assert.ok(seed.provenance.citedLine.includes('2026-10-31'));
  assert.ok(seed.provenance.source.length > 0);
});

test('buildGrowthBook: collecting-since form, series in seq order, no wall-clock fields', () => {
  const s1 = summaryOf(bundle({ seq: 1 }));
  const s2 = summaryOf(bundle({ seq: 2, at: '2026-11-03T03:00:00.000Z' }));
  const book = buildGrowthBook(
    [countersLine('counters', s2, { joined: 0 }), countersLine('baseline', s1, null)],
    [...PRESEED_FIRSTS],
  );
  assert.equal(book.schema, GROWTH_BOOK_SCHEMA);
  assert.equal(book.collectingSince, '2026-11-02');
  assert.deepEqual(book.series.map((l) => l.bundleSeq), [1, 2]);
  assert.equal(book.throughUtc, '2026-11-03T03:00:00.000Z');
  assert.equal(book.firsts.length, 1);
  assert.ok(!('generatedAt' in book) && !('generatedAtUtc' in book));
  assert.ok(book.disclosures.population.includes('never added into one number'));
});

test('utcDateOf takes the bundle stamp’s own date, nothing else', () => {
  assert.equal(utcDateOf('2026-11-03T23:59:59.999Z'), '2026-11-03');
  assert.equal(utcDateOf('2026-11-03T10:35:46.907+00:00'), '2026-11-03');
  assert.equal(utcDateOf(null), null);
  assert.equal(utcDateOf('not a date at all'), null);
});
