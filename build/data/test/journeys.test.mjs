// journeys.test.mjs — M3.01 journey reconstruction (journeys.mjs, pure).
//
// The evidence discipline under test (see the module header for the
// full statement): presence only at utterance instants; a leg is
// bounded by the LAST origin utterance and the FIRST destination
// utterance; a leg is drawn only when its window sat under continuous
// voices-fetch coverage (no silence > 2 x the voices cadence — the
// adopted ceiling, M1.10's spike note not existing); a vanish
// reconstructs nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOURNEY_DISCLOSURE,
  JOURNEY_SCHEMA,
  MAX_EVIDENCE_GAP_MS,
  reconstructJourneys,
  windowCovered,
} from '../journeys.mjs';

const BOOK = { id: 'world-test', openedAtUtc: '2026-11-03T00:00:00Z' };
const EPOCH_MS = Date.parse(BOOK.openedAtUtc);

// Synthetic voices snapshot in the real payload shape. `places` maps a
// place code to rows [by, at, id].
function snap(file, fetchedUtc, places) {
  return {
    data: {
      generated_at: fetchedUtc,
      places: Object.entries(places).map(([code, rows]) => ({
        code,
        said: rows.map(([by, at, id]) => ({ by, at, id, said: '<<ELSEWHERE_UNTRUSTED_X>>words<</ELSEWHERE_UNTRUSTED_X>>' })),
      })),
    },
    fetchedUtc,
    file,
  };
}

// Successful voices fetches every 120 s from `from` to `to` inclusive.
function fetches(fromMin, toMin, stepSec = 120) {
  const out = [];
  for (let t = fromMin * 60; t <= toMin * 60; t += stepSec) {
    out.push(new Date(EPOCH_MS + t * 1000).toISOString());
  }
  return out;
}
const FULL_FETCH = fetches(0, 120); // 00:00 -> 02:00 at cadence

const at = (min, sec = 0) => new Date(EPOCH_MS + (min * 60 + sec) * 1000).toISOString();

test('golden window: exactly one journey, bounded by last-origin and first-destination evidence', () => {
  const doc = reconstructJourneys({
    voicesSnapshots: [snap('2026-11-03/voices-a.json', at(40), {
      EMBER_TOWNHALL: [['Test Person', at(10), 'u1'], ['Test Person', at(20), 'u2']],
      EMBER_COLLEGE: [['Test Person', at(35), 'u3'], ['Test Person', at(50), 'u4']],
    })],
    voicesFetchUtc: FULL_FETCH,
    book: BOOK,
  });
  assert.equal(doc.schema, JOURNEY_SCHEMA);
  assert.equal(doc.bookId, 'world-test');
  assert.equal(doc.tickEpochUtc, BOOK.openedAtUtc);
  assert.equal(doc.stats.candidateLegs, 1);
  assert.equal(doc.stats.reconstructed, 1);
  assert.equal(doc.stats.rejectedDarkLegs, 0);
  assert.equal(doc.journeys.length, 1);
  const j = doc.journeys[0];
  assert.equal(j.citizenKey, 'portal-key:test-person');
  assert.equal(j.name, 'Test Person');
  assert.deepEqual(j.path, ['EMBER_TOWNHALL', 'EMBER_COLLEGE']);
  assert.equal(j.from, 'EMBER_TOWNHALL');
  assert.equal(j.to, 'EMBER_COLLEGE');
  assert.equal(j.reconstructed, true);
  assert.equal(j.disclosure, JOURNEY_DISCLOSURE);
  assert.equal(doc.disclosure, JOURNEY_DISCLOSURE);
  // Bounds: departure = LAST utterance at the origin (u2, not u1);
  // arrival = FIRST utterance at the destination (u3, not u4).
  assert.equal(j.departureUtc, at(20));
  assert.equal(j.arrivalUtc, at(35));
  assert.equal(j.evidence.departureUtteranceId, 'u2');
  assert.equal(j.evidence.arrivalUtteranceId, 'u3');
  // Schedule: ticks of the bounds under the book-epoch grid — arrival
  // lands exactly ON the first destination evidence, never earlier.
  assert.equal(j.departureTick, 40); // 20 min / 30 s
  assert.equal(j.arrivalTick, 70); // 35 min / 30 s
  assert.equal(j.worldTicks, 30);
  assert.equal(j.nearReach, false);
  assert.ok(j.arrivalTick * 30_000 + EPOCH_MS <= Date.parse(j.arrivalUtc));
  assert.ok((j.arrivalTick + 1) * 30_000 + EPOCH_MS > Date.parse(j.arrivalUtc) - 30_000);
});

test('vanish window: a citizen evidenced at one place only reconstructs no journey', () => {
  const doc = reconstructJourneys({
    voicesSnapshots: [snap('f.json', at(40), {
      EMBER_TOWNHALL: [['Quiet One', at(10), 'u1'], ['Quiet One', at(20), 'u2']],
    })],
    voicesFetchUtc: FULL_FETCH,
    book: BOOK,
  });
  assert.equal(doc.stats.candidateLegs, 0);
  assert.equal(doc.journeys.length, 0);
});

test('dark window: a fetch silence longer than the ceiling across the window rejects the leg', () => {
  // Coverage 00:00-00:14, then a 46-minute silence, then 01:00-02:00:
  // the move (00:20 -> 00:35) sits inside the dark.
  const broken = [...fetches(0, 14), ...fetches(60, 120)];
  const doc = reconstructJourneys({
    voicesSnapshots: [snap('f.json', at(40), {
      EMBER_TOWNHALL: [['Test Person', at(20), 'u2']],
      EMBER_COLLEGE: [['Test Person', at(35), 'u3']],
    })],
    voicesFetchUtc: broken,
    book: BOOK,
  });
  assert.equal(doc.stats.candidateLegs, 1);
  assert.equal(doc.stats.reconstructed, 0);
  assert.equal(doc.stats.rejectedDarkLegs, 1);
  assert.equal(doc.journeys.length, 0);
});

test('era clause: evidence from before the first successful fetch is not coverage', () => {
  // Utterances at 00:10/00:35, but the archiver's first voices fetch
  // is 01:00 — retroactive rolling-window capture, rejected.
  const doc = reconstructJourneys({
    voicesSnapshots: [snap('f.json', at(70), {
      EMBER_TOWNHALL: [['Test Person', at(10), 'u1']],
      EMBER_COLLEGE: [['Test Person', at(35), 'u3']],
    })],
    voicesFetchUtc: fetches(60, 120),
    book: BOOK,
  });
  assert.equal(doc.stats.candidateLegs, 1);
  assert.equal(doc.stats.rejectedDarkLegs, 1);
  assert.equal(doc.journeys.length, 0);
});

test('a silence of exactly the ceiling length still covers (the rule is "longer than")', () => {
  // Fetches at 00:00 and 00:04 exactly (240 s apart), then cadence:
  // the gap equals MAX_EVIDENCE_GAP_MS and must NOT reject.
  const edge = [at(0), at(4), ...fetches(6, 120)];
  const doc = reconstructJourneys({
    voicesSnapshots: [snap('f.json', at(10), {
      EMBER_TOWNHALL: [['Test Person', at(1), 'u1']],
      EMBER_COLLEGE: [['Test Person', at(3), 'u2']],
    })],
    voicesFetchUtc: edge,
    book: BOOK,
  });
  assert.equal(doc.ceiling.maxEvidenceGapMs, MAX_EVIDENCE_GAP_MS);
  assert.equal(doc.journeys.length, 1);
});

test('chain: A -> B -> A reconstructs two legs with per-leg bounds', () => {
  const doc = reconstructJourneys({
    voicesSnapshots: [snap('f.json', at(50), {
      EMBER_TOWNHALL: [['Walker', at(10), 'u1'], ['Walker', at(40), 'u5']],
      EMBER_COLLEGE: [['Walker', at(20), 'u2'], ['Walker', at(25), 'u3']],
    })],
    voicesFetchUtc: FULL_FETCH,
    book: BOOK,
  });
  assert.equal(doc.journeys.length, 2);
  const [leg1, leg2] = doc.journeys;
  assert.deepEqual(leg1.path, ['EMBER_TOWNHALL', 'EMBER_COLLEGE']);
  assert.equal(leg1.departureUtc, at(10));
  assert.equal(leg1.arrivalUtc, at(20));
  assert.deepEqual(leg2.path, ['EMBER_COLLEGE', 'EMBER_TOWNHALL']);
  assert.equal(leg2.departureUtc, at(25)); // LAST utterance at the College
  assert.equal(leg2.arrivalUtc, at(40));
});

test('dedupe: an utterance carried by two snapshots counts once; the first snapshot is its evidence', () => {
  const s1 = snap('2026-11-03/voices-first.json', at(15), {
    EMBER_TOWNHALL: [['Test Person', at(10), 'u1']],
  });
  const s2 = snap('2026-11-03/voices-second.json', at(40), {
    EMBER_TOWNHALL: [['Test Person', at(10), 'u1']],
    EMBER_COLLEGE: [['Test Person', at(35), 'u3']],
  });
  const doc = reconstructJourneys({
    voicesSnapshots: [s2, s1], // input order must not matter
    voicesFetchUtc: FULL_FETCH,
    book: BOOK,
  });
  assert.equal(doc.stats.utterances, 2);
  assert.equal(doc.journeys.length, 1);
  assert.equal(doc.journeys[0].evidence.departureSnapshotFile, '2026-11-03/voices-first.json');
  assert.equal(doc.journeys[0].evidence.arrivalSnapshotFile, '2026-11-03/voices-second.json');
});

test('near-reach: bounds inside one tick schedule a disclosed 0-tick leg', () => {
  const doc = reconstructJourneys({
    voicesSnapshots: [snap('f.json', at(30), {
      EMBER_TOWNHALL: [['Test Person', at(20, 10), 'u1']],
      EMBER_COLLEGE: [['Test Person', at(20, 25), 'u2']],
    })],
    voicesFetchUtc: FULL_FETCH,
    book: BOOK,
  });
  assert.equal(doc.journeys.length, 1);
  assert.equal(doc.journeys[0].worldTicks, 0);
  assert.equal(doc.journeys[0].nearReach, true);
  assert.equal(doc.journeys[0].departureTick, doc.journeys[0].arrivalTick);
});

test('timelines never merge: interleaved speakers reconstruct independently', () => {
  const doc = reconstructJourneys({
    voicesSnapshots: [snap('f.json', at(50), {
      EMBER_TOWNHALL: [['Alice A', at(10), 'a1'], ['Bob B', at(12), 'b1']],
      EMBER_COLLEGE: [['Bob B', at(30), 'b2']],
      MARKET_HALL: [['Alice A', at(32), 'a2']],
    })],
    voicesFetchUtc: FULL_FETCH,
    book: BOOK,
  });
  assert.equal(doc.journeys.length, 2);
  const byKey = new Map(doc.journeys.map((j) => [j.citizenKey, j]));
  assert.deepEqual(byKey.get('portal-key:alice-a').path, ['EMBER_TOWNHALL', 'MARKET_HALL']);
  assert.deepEqual(byKey.get('portal-key:bob-b').path, ['EMBER_TOWNHALL', 'EMBER_COLLEGE']);
});

test('determinism: shuffled inputs produce an identical document', () => {
  const s1 = snap('a.json', at(15), { EMBER_TOWNHALL: [['Test Person', at(10), 'u1']] });
  const s2 = snap('b.json', at(40), { EMBER_COLLEGE: [['Test Person', at(35), 'u3']] });
  const a = reconstructJourneys({ voicesSnapshots: [s1, s2], voicesFetchUtc: FULL_FETCH, book: BOOK });
  const b = reconstructJourneys({ voicesSnapshots: [s2, s1], voicesFetchUtc: [...FULL_FETCH].reverse(), book: BOOK });
  assert.deepEqual(b, a);
});

test('PORTAL-KEY collisions among speakers split by suffix, never merged', () => {
  const doc = reconstructJourneys({
    voicesSnapshots: [snap('f.json', at(50), {
      EMBER_TOWNHALL: [['Ann Lee', at(10), 'a1'], ['Ann-Lee', at(11), 'b1']],
      EMBER_COLLEGE: [['Ann Lee', at(30), 'a2'], ['Ann-Lee', at(31), 'b2']],
    })],
    voicesFetchUtc: FULL_FETCH,
    book: BOOK,
  });
  assert.equal(doc.journeys.length, 2);
  const keys = doc.journeys.map((j) => j.citizenKey).sort();
  assert.deepEqual(keys, ['portal-key:ann-lee', 'portal-key:ann-lee#2']);
  for (const j of doc.journeys) {
    assert.equal(j.name === 'Ann Lee' || j.name === 'Ann-Lee', true);
    assert.deepEqual(j.path, ['EMBER_TOWNHALL', 'EMBER_COLLEGE']);
  }
});

test('windowCovered: boundary behaviour of the coverage rule itself', () => {
  const f = [0, 120_000, 240_000, 360_000];
  assert.equal(windowCovered(f, 10_000, 200_000, 240_000), true);
  assert.equal(windowCovered(f, -1, 200_000, 240_000), false); // before the era
  assert.equal(windowCovered(f, 10_000, 360_001, 240_000), false); // after the era
  assert.equal(windowCovered([], 0, 1, 240_000), false); // no coverage record at all
  const gapped = [0, 120_000, 600_000, 720_000]; // 480 s silence in the middle
  assert.equal(windowCovered(gapped, 200_000, 500_000, 240_000), false);
  assert.equal(windowCovered(gapped, 10_000, 100_000, 240_000), true); // window clears the dark
});
