// Elsewhere Portal — M6.08 growth book engine (pure module).
//
// Schema family:
//   portal.daily-counters/v1 — one appended line per counted bundle diff
//   portal.firsts/v1         — one appended line per evidenced first
//   portal.growth-book/v1    — the app's book: series + firsts wall
//
// The bundle is the state authority (the facts.mjs discipline): this
// module never re-interprets raw snapshots. It compares two consecutive
// bundle summaries and derives (a) the counter deltas and (b) dated
// firsts. Every first carries its provenance — the bundle pair it was
// diffed from — and a first without provenance is never produced: the
// diff is the only source, and the pre-seed below is the only exception
// the plan names, cited to its record source.
//
// BASELINE LAW (mirrors facts.mjs feed mode): the first counted bundle
// initialises the seen sets and the baseline counters line. Citizens,
// placements, and plots already present in that bundle are NOT announced
// as firsts — changes from before the writer existed are never
// backfilled or invented.
//
// BOOK BOUNDARIES ARE HARD (mirrors facts.mjs): when the book id
// changes, no counter delta and no citizen/place comparison crosses the
// boundary. The new book's first counted bundle is a fresh baseline and
// the only first emitted for the pair is `book-opened`.
//
// DETERMINISM: no wall-clock reads anywhere. Dates come from the
// bundle's own newestFetchUtc. Canonical key order via derive.mjs's
// canonicalStringify. Same inputs => identical bytes.

import { canonicalStringify } from './derive.mjs';

export const COUNTERS_SCHEMA = 'portal.daily-counters/v1';
export const FIRSTS_SCHEMA = 'portal.firsts/v1';
export const GROWTH_BOOK_SCHEMA = 'portal.growth-book/v1';

// The wave's entry form, per the M6 entry gate: with under two weeks of
// archive, Growth launches as "collecting since <date>" plus the firsts
// wall. The date is the world book's opening day — world-001 opened
// 2026-11-02 (archive head snapshots 2026-11-02T02:07Z).
export const COLLECTING_SINCE = '2026-11-02';

// The tracked counters, in surface order. `joined`, the region figures,
// deposits, and treasury are the bundle's own counters (all derived by
// derive.mjs from the overview route). `nameable` and `placed` are
// counted from the bundle's citizen list (itself derived from the
// voices and news routes). The three population numbers are distinct
// measures and are never merged into one figure:
//   joined   — the record's own count of citizens who have joined
//   nameable — citizens Portal can name in this bundle
//   placed   — of those, the ones with an evidenced place right now
export const COUNTER_FIELDS = [
  'joined',
  'nameable',
  'placed',
  'regionsDiscovered',
  'regionsSurveyed',
  'regionsNamed',
  'collegeDeposits',
  'treasury',
];

export const COUNTER_LABELS = {
  joined: 'Citizens who have joined (the record’s own count)',
  nameable: 'Citizens Portal can name',
  placed: 'Named citizens with an evidenced place',
  regionsDiscovered: 'Regions discovered',
  regionsSurveyed: 'Regions surveyed',
  regionsNamed: 'Regions named',
  collegeDeposits: 'College deposits',
  treasury: 'Town treasury (Bennies)',
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The counters of one bundle, in COUNTER_FIELDS terms. A counter the
 *  bundle does not carry is null — never zero-filled, never guessed. */
export function countersOf(bundle) {
  const c = isRecord(bundle?.counters) ? bundle.counters : {};
  const citizens = Array.isArray(bundle?.citizens) ? bundle.citizens : [];
  return {
    joined: finiteNumber(c.populationKnown),
    nameable: citizens.length,
    placed: citizens.filter((x) => nonEmptyString(x?.placeCode)).length,
    regionsDiscovered: finiteNumber(c.regionsDiscovered),
    regionsSurveyed: finiteNumber(c.regionsSurveyed),
    regionsNamed: finiteNumber(c.regionsNamed),
    collegeDeposits: finiteNumber(c.collegeDeposits),
    treasury: finiteNumber(c.treasury),
  };
}

/** The diff-relevant summary of one bundle: everything the writer needs
 *  to compare this bundle with the next, and nothing else. Stored in
 *  the writer's state file in place of the whole bundle. */
export function summaryOf(bundle) {
  const citizens = (Array.isArray(bundle?.citizens) ? bundle.citizens : [])
    .filter((x) => nonEmptyString(x?.citizenKey))
    .map((x) => ({
      citizenKey: x.citizenKey,
      name: nonEmptyString(x.name) || x.citizenKey,
      placeCode: nonEmptyString(x.placeCode),
      route: nonEmptyString(x.provenance?.route),
    }))
    .sort((a, b) => (a.citizenKey < b.citizenKey ? -1 : a.citizenKey > b.citizenKey ? 1 : 0));
  const plots = (Array.isArray(bundle?.ember?.plots) ? bundle.ember.plots : [])
    .filter((x) => nonEmptyString(x?.code))
    .map((x) => ({ code: x.code, route: nonEmptyString(x.provenance?.route) }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return {
    bundleSeq: Number.isInteger(bundle?.bundleSeq) ? bundle.bundleSeq : null,
    bookId: nonEmptyString(bundle?.world?.bookId),
    atUtc: nonEmptyString(bundle?.newestFetchUtc),
    counters: countersOf(bundle),
    citizens,
    plots,
  };
}

/** UTC date (YYYY-MM-DD) of an ISO stamp, or null. Dates in the growth
 *  book are the bundle's own fetch dates — never the writer's clock. */
export function utcDateOf(iso) {
  if (typeof iso !== 'string' || iso.length < 10) return null;
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** Fresh seen sets, seeded from a summary (the baseline law: what the
 *  first counted bundle already holds is seen, not first). */
export function seenFromSummary(summary) {
  return {
    citizenKeys: new Set((summary?.citizens || []).map((x) => x.citizenKey)),
    placedKeys: new Set((summary?.citizens || []).filter((x) => x.placeCode).map((x) => x.citizenKey)),
    placeCodes: new Set((summary?.plots || []).map((x) => x.code)),
  };
}

function firstRecord(kind, summary, subject, detail) {
  return {
    schema: FIRSTS_SCHEMA,
    kind,
    date: utcDateOf(summary.atUtc),
    atUtc: summary.atUtc,
    bookId: summary.bookId,
    subject,
    detail,
    provenance: {
      basis: 'bundle-diff',
      bundleSeq: summary.bundleSeq,
      route: subject.route || null,
    },
  };
}

/**
 * The pure pair diff. `prev` and `next` are summaryOf() summaries;
 * `seen` is the book-scoped seen state BEFORE this pair. Returns the
 * counter deltas (null where either side is unknown), the firsts this
 * pair evidences (each citing the next bundle), and the seen state
 * AFTER this pair. On a book change the pair yields no deltas and a
 * single `book-opened` first, and the seen state resets to the new
 * book's baseline.
 */
export function diffSummaries(prev, next, seen) {
  if (!prev || !next) throw new Error('diffSummaries needs both summaries');
  if (prev.bookId !== next.bookId) {
    return {
      bookChanged: true,
      deltas: null,
      firsts: [{
        schema: FIRSTS_SCHEMA,
        kind: 'book-opened',
        date: utcDateOf(next.atUtc),
        atUtc: next.atUtc,
        bookId: next.bookId,
        subject: { bookId: next.bookId },
        detail: `A new world book opened (${next.bookId}). Portal does not compare counters or citizens across a book boundary.`,
        provenance: { basis: 'bundle-diff', bundleSeq: next.bundleSeq, route: null },
      }],
      seen: seenFromSummary(next),
    };
  }
  const deltas = {};
  for (const field of COUNTER_FIELDS) {
    const a = prev.counters?.[field];
    const b = next.counters?.[field];
    deltas[field] = (typeof a === 'number' && typeof b === 'number') ? b - a : null;
  }
  const firsts = [];
  const seenNext = {
    citizenKeys: new Set(seen.citizenKeys),
    placedKeys: new Set(seen.placedKeys),
    placeCodes: new Set(seen.placeCodes),
  };
  for (const citizen of next.citizens) {
    if (!seenNext.citizenKeys.has(citizen.citizenKey)) {
      firsts.push(firstRecord('citizen-first-named', next,
        { citizenKey: citizen.citizenKey, name: citizen.name, route: citizen.route },
        `${citizen.name} is named in the public feeds Portal reads for the first time since Portal began counting.`));
      seenNext.citizenKeys.add(citizen.citizenKey);
    }
    if (citizen.placeCode && !seenNext.placedKeys.has(citizen.citizenKey)) {
      firsts.push(firstRecord('citizen-first-placed', next,
        { citizenKey: citizen.citizenKey, name: citizen.name, placeCode: citizen.placeCode, route: citizen.route },
        `${citizen.name} has an evidenced place in the public feeds Portal reads for the first time since Portal began counting.`));
      seenNext.placedKeys.add(citizen.citizenKey);
    }
  }
  for (const plot of next.plots) {
    if (!seenNext.placeCodes.has(plot.code)) {
      firsts.push(firstRecord('place-first-evidenced', next,
        { code: plot.code, route: plot.route },
        `A place is evidenced in the public feeds Portal reads for the first time since Portal began counting: ${plot.code}.`));
      seenNext.placeCodes.add(plot.code);
    }
  }
  return { bookChanged: false, deltas, firsts, seen: seenNext };
}

/** A counters line for the stream. `kind` is 'baseline' for a book's
 *  first counted bundle (deltas null — there is nothing honest to diff
 *  against) and 'counters' for a diffed pair. */
export function countersLine(kind, summary, deltas) {
  return {
    schema: COUNTERS_SCHEMA,
    kind,
    bookId: summary.bookId,
    date: utcDateOf(summary.atUtc),
    atUtc: summary.atUtc,
    bundleSeq: summary.bundleSeq,
    counters: summary.counters,
    deltas: deltas ?? null,
    provenance: {
      basis: kind === 'baseline' ? 'baseline-bundle' : 'bundle-diff',
      routes: ['overview', 'voices', 'news'],
    },
  };
}

// The one pre-seed the plan names (M6.08: "pre-seed: first mayor
// 2026-10-31"). It predates Portal's archive (world-001 opened
// 2026-11-02), so its provenance class is record-attested — the same
// two-class discipline the bundle uses for plots — and it cites the
// record it rests on, word for word. Nothing else is pre-seeded.
export const PRESEED_FIRSTS = [{
  schema: FIRSTS_SCHEMA,
  kind: 'first-mayor',
  date: '2026-10-31',
  atUtc: null,
  bookId: 'world-001',
  subject: { name: 'Atlas Meridian' },
  detail: 'Atlas Meridian became the first Mayor of Ember — the first election in Ember’s history to meet its quorum.',
  provenance: {
    basis: 'record-attested',
    preseed: true,
    source: 'The Mayor’s Ledger — Atlas Meridian, first term (the Elsewhere town record)',
    citedLine: 'Elected 2026-10-31: 8 of 8 weight, 5 voters',
    route: null,
  },
}];

export const GROWTH_DISCLOSURE = 'Portal counts from the public feeds Portal reads, starting when its counting began. '
  + 'A fall is shown exactly as a rise is: both are the record’s numbers, compared bundle to bundle. '
  + 'Nothing is backfilled — days before counting began are not reconstructed.';
export const POPULATION_DISCLOSURE = 'Three different counts, kept apart: citizens who have joined (the record’s own count), '
  + 'citizens Portal can name in the current bundle, and named citizens with an evidenced place right now. '
  + 'They measure different things and are never added into one number.';

/**
 * The app's book, rebuilt deterministically from the two streams.
 * `throughUtc` is the newest counted bundle's own stamp — the book
 * carries no wall-clock time of its own.
 */
export function buildGrowthBook(countersLines, firsts) {
  const lines = [...countersLines].sort((a, b) => (a.bundleSeq ?? 0) - (b.bundleSeq ?? 0));
  const wall = [...firsts].sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    if (da !== db) return da < db ? -1 : 1;
    return canonicalStringify(a) < canonicalStringify(b) ? -1 : 1;
  });
  return {
    schema: GROWTH_BOOK_SCHEMA,
    collectingSince: COLLECTING_SINCE,
    throughUtc: lines.length ? lines[lines.length - 1].atUtc : null,
    counterFields: COUNTER_FIELDS,
    counterLabels: COUNTER_LABELS,
    series: lines,
    firsts: wall,
    disclosures: { growth: GROWTH_DISCLOSURE, population: POPULATION_DISCLOSURE },
  };
}
