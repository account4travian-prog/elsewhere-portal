// growth-book.test.mjs — the M6.08 surface builders in logic.mjs:
// collecting-since honesty, step-chart geometry, the value-list twin,
// the firsts wall with provenance, and M2.15 escaping of feed-derived
// text. Fixtures are synthetic portal.growth-book/v1 books in the
// shape build/data/growth.mjs writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growthBookHtml, growthChartSegments, isGrowthBook } from '../logic.mjs';

function line(seq, date, counters, deltas = null) {
  return {
    schema: 'portal.daily-counters/v1',
    kind: deltas ? 'counters' : 'baseline',
    bookId: 'world-001',
    date,
    atUtc: `${date}T00:00:00.000Z`,
    bundleSeq: seq,
    counters: {
      joined: 291, nameable: 16, placed: 14, regionsDiscovered: 5821,
      regionsSurveyed: 5110, regionsNamed: 5015, collegeDeposits: 630, treasury: 804000,
      ...counters,
    },
    deltas,
    provenance: { basis: deltas ? 'bundle-diff' : 'baseline-bundle', routes: ['overview', 'voices', 'news'] },
  };
}

function book(series, firsts = []) {
  return {
    schema: 'portal.growth-book/v1',
    collectingSince: '2026-11-02',
    throughUtc: '2026-11-03T10:39:48.632Z',
    counterFields: ['joined', 'nameable', 'placed', 'regionsDiscovered', 'regionsSurveyed', 'regionsNamed', 'collegeDeposits', 'treasury'],
    counterLabels: {
      joined: 'Citizens who have joined (the record’s own count)',
      nameable: 'Citizens Portal can name',
      placed: 'Named citizens with an evidenced place',
      regionsDiscovered: 'Regions discovered',
      regionsSurveyed: 'Regions surveyed',
      regionsNamed: 'Regions named',
      collegeDeposits: 'College deposits',
      treasury: 'Town treasury (Bennies)',
    },
    series,
    firsts,
    disclosures: {
      growth: 'Nothing is backfilled.',
      population: 'Three different counts, kept apart: they measure different things and are never added into one number.',
    },
  };
}

const MAYOR_FIRST = {
  schema: 'portal.firsts/v1',
  kind: 'first-mayor',
  date: '2026-10-31',
  atUtc: null,
  bookId: 'world-001',
  subject: { name: 'Atlas Meridian' },
  detail: 'Atlas Meridian became the first Mayor of Ember.',
  provenance: {
    basis: 'record-attested', preseed: true,
    source: 'The Mayor’s Ledger — Atlas Meridian, first term (the Elsewhere town record)',
    citedLine: 'Elected 2026-10-31: 8 of 8 weight, 5 voters',
    route: null,
  },
};

test('isGrowthBook accepts only the v1 book shape', () => {
  assert.ok(isGrowthBook(book([])));
  assert.ok(!isGrowthBook(null));
  assert.ok(!isGrowthBook({ schema: 'portal.world-data/v2', series: [], firsts: [] }));
});

test('absent book renders the honest not-begun wording, never an error', () => {
  const html = growthBookHtml(null);
  assert.ok(html.includes('has not begun yet'));
  assert.ok(html.includes('Nothing is backfilled'));
});

test('collecting-since form states the real depth — 2 counted bundles across 1 day', () => {
  const html = growthBookHtml(book([line(497, '2026-11-03', {}), line(512, '2026-11-03', { treasury: 803500 })]));
  assert.ok(html.includes('collecting since 2026-11-02'));
  assert.ok(html.includes('2 counted bundles across 1 day'));
  assert.ok(html.includes('never added into one number'));
});

test('the value-list twin carries every counted value as plain text, falls included', () => {
  const html = growthBookHtml(book([
    line(497, '2026-11-03', {}),
    line(512, '2026-11-03', { treasury: 803500, regionsDiscovered: 5830 }),
  ]));
  assert.ok(html.includes('804,000'));
  assert.ok(html.includes('803,500')); // the fall is in the list, not smoothed away
  assert.ok(html.includes('5,830'));
  assert.ok(html.includes('bundle 497') && html.includes('bundle 512'));
});

test('chart segments: a fall draws a step down; a constant series draws flat; nulls split segments', () => {
  const b = book([
    line(1, '2026-11-03', { treasury: 100 }),
    line(2, '2026-11-03', { treasury: 50 }),
    line(3, '2026-11-03', { treasury: null }),
    line(4, '2026-11-03', { treasury: 50 }),
  ]);
  const segments = growthChartSegments(b, 'treasury', 100, 40);
  assert.equal(segments.length, 2); // the null splits the line
  const ys = segments[0].split(' ').map((p) => Number(p.split(',')[1]));
  assert.ok(ys[ys.length - 1] > ys[0]); // value fell => y grew (screen coords)
  const flat = growthChartSegments(book([line(1, '2026-11-03', {}), line(2, '2026-11-03', {})]), 'joined', 100, 40);
  const flatYs = new Set(flat[0].split(' ').map((p) => p.split(',')[1]));
  assert.equal(flatYs.size, 1); // constant series: one height only
});

test('firsts wall: the pre-seed renders record-attested with its cited line quoted', () => {
  const html = growthBookHtml(book([line(497, '2026-11-03', {})], [MAYOR_FIRST]));
  assert.ok(html.includes('firsts wall') || html.includes('Firsts wall'));
  assert.ok(html.includes('2026-10-31'));
  assert.ok(html.includes('record-attested'));
  assert.ok(html.includes('Elected 2026-10-31: 8 of 8 weight, 5 voters'));
});

test('firsts wall: a counted first cites its bundle and read time', () => {
  const counted = {
    schema: 'portal.firsts/v1', kind: 'citizen-first-named', date: '2026-11-03',
    atUtc: '2026-11-03T12:00:00.000Z', bookId: 'world-001',
    subject: { citizenKey: 'portal-key:new-one', name: 'New One', route: 'voices' },
    detail: 'New One is named in the public feeds Portal reads for the first time since Portal began counting.',
    provenance: { basis: 'bundle-diff', bundleSeq: 640, route: 'voices' },
  };
  const html = growthBookHtml(book([line(640, '2026-11-03', {})], [counted]));
  assert.ok(html.includes('bundle 640'));
  assert.ok(html.includes('2026-11-03T12:00:00.000Z'));
});

test('feed-derived text is escaped: a hostile detail cannot become markup', () => {
  const hostile = { ...MAYOR_FIRST, detail: '<img src=x onerror=alert(1)>', provenance: { ...MAYOR_FIRST.provenance, citedLine: '<script>bad</script>' } };
  const html = growthBookHtml(book([line(1, '2026-11-03', {})], [hostile]));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>bad</script>'));
  assert.ok(html.includes('&lt;img src=x'));
});
