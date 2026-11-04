// Derivation tests. Fixture payloads below are SYNTHETIC miniatures shaped
// like the real Tier P payloads (shapes live-verified 2026-11-02 and kept in
// ~/workspace/elsewhere-portal/fixtures/); they are labelled synthetic here
// and never presented as world data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalStringify, deriveWorldData, sha256hex } from '../derive.mjs';

const FETCHED = '2026-11-02T02:04:35.000Z';

function fixtureHead() {
  return {
    overview: {
      fetchedUtc: FETCHED,
      data: {
        sky: { over_ember: 'OVERCAST' },
        world_hour: 5,
        season: 'SPRING',
        year: 45,
        generated_at: '2026-11-02T02:04:05.000Z',
        frontier: { regions_discovered: 5821, regions_surveyed: 5104, regions_named: 5014 },
        college: { deposits: 616 },
        population: { joined: 288 },
        ember: {
          treasury_bennies: 809400,
          districts: [
            { n: 1, name: 'District 1', held: 34, vacant: 14, held_quarters: 82, vacant_quarters: 14, fixtures: { HALL: 1 }, towers: [[3, 8]] },
          ],
        },
      },
    },
    news: {
      fetchedUtc: FETCHED,
      data: {
        headlines: [
          { at: '2026-11-02T01:30:52.000Z', id: 2, kind: 'OUTLOOK_CHANGED', phrase: 'Weather law changed.' },
          { at: '2026-11-01T22:58:46.000Z', id: 1, kind: 'CITY_EVENT_BEGAN', phrase: 'A gathering began.', locate: { anchor: 'plaza' } },
        ],
        residents: [
          { handle: 'Quiet Resident', latest: { at: '2026-10-30T05:12:10.000Z', kind: 'GRAND_TITLE' }, events: [] },
          { handle: 'Fresh Speaker', latest: { at: '2026-11-02T01:00:00.000Z', kind: 'ARRIVED' }, events: [] },
        ],
      },
    },
    voices: {
      fetchedUtc: FETCHED,
      data: {
        generated_at: '2026-11-02T02:04:05.000Z',
        places: [
          {
            code: 'EMBER_PLAZA_OF_UNITY',
            said: [
              { by: 'Fresh Speaker', at: '2026-11-02T01:54:05.000Z', said: 'hello', id: 'a' },
              { by: 'Earlier Speaker', at: '2026-11-02T00:34:05.000Z', said: 'hi', id: 'b' },
              { by: 'Sleepy Speaker', at: '2026-11-01T20:00:00.000Z', said: 'zzz', id: 'c' },
            ],
          },
        ],
      },
    },
    map: {
      fetchedUtc: FETCHED,
      data: { generated_at: '2026-11-02T02:04:05.000Z', world_hour: 5, ember: { civic_works: ['MARKET_HALL', 'LIBRARY_ANNEX'], districts: [] } },
    },
    status: { fetchedUtc: FETCHED, data: { online: true, test_world: true, next_reset: null } },
    chats: null,
  };
}

test('derivation purity: same inputs -> identical canonical bytes and hash', () => {
  const a = deriveWorldData(fixtureHead(), { bundleSeq: 7 });
  const b = deriveWorldData(fixtureHead(), { bundleSeq: 7 });
  assert.equal(canonicalStringify(a), canonicalStringify(b));
  assert.equal(sha256hex(canonicalStringify(a)), sha256hex(canonicalStringify(b)));
});

test('world fields and counters map from the real overview shape', () => {
  const wd = deriveWorldData(fixtureHead(), { bundleSeq: 1 });
  assert.deepEqual(wd.world, { sky: 'OVERCAST', worldHour: 5, season: 'SPRING', year: 45 });
  assert.deepEqual(wd.counters, {
    regionsDiscovered: 5821, regionsSurveyed: 5104, regionsNamed: 5014,
    collegeDeposits: 616, treasury: 809400, populationKnown: 288,
  });
  assert.equal(wd.dataAgeSeconds, 30); // fetched 02:04:35 - generated 02:04:05
  assert.equal(wd.ember.districts.length, 1);
  assert.deepEqual(wd.ember.works, [
    { code: 'LIBRARY_ANNEX', integrity: null },
    { code: 'MARKET_HALL', integrity: null },
  ]);
  assert.deepEqual(wd.ember.plots, []); // no per-plot data in Tier P — honest empty
});

test('provenance present on every citizen and ticker item', () => {
  const wd = deriveWorldData(fixtureHead(), { bundleSeq: 1 });
  assert.ok(wd.citizens.length >= 3);
  assert.ok(wd.ticker.length === 2);
  for (const c of wd.citizens) {
    assert.ok(c.provenance && typeof c.provenance.route === 'string' && c.provenance.route.length > 0, `citizen ${c.name} missing provenance route`);
    assert.equal(c.provenance.fetchedUtc, FETCHED);
  }
  for (const t of wd.ticker) {
    assert.equal(t.provenance.route, 'news');
    assert.equal(t.provenance.fetchedUtc, FETCHED);
  }
});

test('citizen states follow speech-evidence age; unknown citizens have placeCode null', () => {
  const wd = deriveWorldData(fixtureHead(), { bundleSeq: 1 });
  const placed = Object.fromEntries(
    wd.citizens.filter((c) => c.provenance.route === 'voices').map((c) => [c.name, c]),
  );
  assert.equal(placed['Fresh Speaker'].state, 'talking'); // spoke 10 min before generated_at
  assert.equal(placed['Fresh Speaker'].placeCode, 'EMBER_PLAZA_OF_UNITY');
  assert.equal(placed['Earlier Speaker'].state, 'present'); // 1.5 h before
  assert.equal(placed['Sleepy Speaker'].state, 'asleep'); // > 2 h before
  const quiet = wd.citizens.find((c) => c.name === 'Quiet Resident'); // news.residents only
  assert.equal(quiet.state, 'unknown');
  assert.equal(quiet.placeCode, null);
  for (const c of wd.citizens) {
    if (c.state === 'unknown') assert.equal(c.placeCode, null);
  }
});

test('records are never merged on name alone: a residents row stands beside a voices record', () => {
  const wd = deriveWorldData(fixtureHead(), { bundleSeq: 1 });
  const fresh = wd.citizens.filter((c) => c.name === 'Fresh Speaker');
  assert.equal(fresh.length, 2); // voices record + news record, not folded
  assert.deepEqual(fresh.map((c) => c.provenance.route).sort(), ['news', 'voices']);
});

test('ticker maps locate anchors to place codes, newest first, cap respected', () => {
  const wd = deriveWorldData(fixtureHead(), { bundleSeq: 1 });
  assert.equal(wd.ticker[0].kind, 'OUTLOOK_CHANGED');
  assert.equal(wd.ticker[0].placeCode, null);
  assert.equal(wd.ticker[1].placeCode, 'EMBER_PLAZA_OF_UNITY');
});

// ------------------------------------------------------- PORTAL-KEY
// The PORTAL-KEY (citizenKey) is a Portal-side record label — never a
// handle, never an identity. Hark-audit conditions (1)-(5), see derive.mjs.

function namesakeHead() {
  const head = fixtureHead();
  head.voices.data.places = [
    {
      code: 'EMBER_COLLEGE',
      said: [
        { by: 'Nath Between', at: '2026-11-02T01:50:00.000Z', said: 'a', id: 'n1' },
        { by: 'Nath Borowik', at: '2026-11-02T01:51:00.000Z', said: 'b', id: 'n2' },
        { by: 'Sam Vale', at: '2026-11-02T01:40:00.000Z', said: 'first', id: 's1' },
        { by: 'Sam Vale', at: '2026-11-02T01:55:00.000Z', said: 'second', id: 's2' },
      ],
    },
    {
      code: 'EMBER_PLAZA_OF_UNITY',
      said: [
        { by: 'Sam Vale', at: '2026-11-02T01:45:00.000Z', said: 'elsewhere', id: 's3' },
      ],
    },
  ];
  head.news.data.residents = [
    { handle: 'sam vale', latest: { at: '2026-11-02T01:00:00.000Z', kind: 'ARRIVED' }, events: [] },
  ];
  return head;
}

test('PORTAL-KEY: every record carries a distinct key; handle stays empty', () => {
  const wd = deriveWorldData(fixtureHead(), { bundleSeq: 1 });
  assert.ok(wd.citizens.length >= 4);
  const keys = wd.citizens.map((c) => c.citizenKey);
  for (const c of wd.citizens) {
    assert.equal(c.handle, ''); // Tier P evidences no handle — never guessed
    assert.ok(typeof c.citizenKey === 'string' && c.citizenKey.startsWith('portal-key:'), `bad key ${c.citizenKey}`);
    assert.equal(typeof c.name, 'string'); // raw display name stored beside the key
  }
  assert.equal(new Set(keys).size, keys.length);
});

test('PORTAL-KEY: name-adjacent citizens get distinct keys and no collision entry', () => {
  const wd = deriveWorldData(namesakeHead(), { bundleSeq: 1 });
  const naths = wd.citizens.filter((c) => c.name.startsWith('Nath '));
  assert.equal(naths.length, 2);
  assert.notEqual(naths[0].citizenKey, naths[1].citizenKey);
  assert.ok(!wd.citizenCollisions.some((col) => col.key.includes('nath')));
});

test('PORTAL-KEY: same name, two records -> two keys and a flagged collision', () => {
  const wd = deriveWorldData(namesakeHead(), { bundleSeq: 1 });
  const sams = wd.citizens.filter((c) => citizenKeySlugOf(c) === 'sam-vale');
  assert.equal(sams.length, 2); // the voices record + the news row — neither folded
  assert.equal(new Set(sams.map((c) => c.citizenKey)).size, 2);
  // strongest evidence holds the bare key: the talking voices record
  const bare = sams.find((c) => c.citizenKey === 'portal-key:sam-vale');
  assert.equal(bare.placeCode, 'EMBER_COLLEGE');
  assert.equal(bare.provenance.route, 'voices');
  const col = wd.citizenCollisions.find((x) => x.key === 'portal-key:sam-vale');
  assert.ok(col, 'collision must be flagged in the bundle');
  assert.deepEqual(col.names, ['Sam Vale', 'sam vale']);
  assert.equal(col.citizenKeys.length, 2);
  function citizenKeySlugOf(c) {
    return c.citizenKey.replace(/^portal-key:/, '').replace(/#\d+$/, '');
  }
});

test('one speaker\'s utterances across places are one record, at the latest place', () => {
  const wd = deriveWorldData(namesakeHead(), { bundleSeq: 1 });
  const sam = wd.citizens.find((c) => c.citizenKey === 'portal-key:sam-vale');
  // Sam spoke at the Plaza (01:45) and the College (01:40, 01:55): a single
  // voices record whose current evidence is the latest utterance.
  assert.equal(sam.placeCode, 'EMBER_COLLEGE');
  assert.equal(sam.evidenceUtc, '2026-11-02T01:55:00.000Z');
  assert.equal(sam.firstSeenUtc, '2026-11-02T01:40:00.000Z');
});

test('PORTAL-KEY: no collisions in a clean head -> empty citizenCollisions', () => {
  const head = fixtureHead();
  head.news.data.residents = head.news.data.residents.filter((r) => r.handle !== 'Fresh Speaker');
  const wd = deriveWorldData(head, { bundleSeq: 1 });
  assert.deepEqual(wd.citizenCollisions, []);
});

test('PORTAL-KEY: firstSeenUtc is the record\'s earliest evidence in the head', () => {
  const wd = deriveWorldData(namesakeHead(), { bundleSeq: 1 });
  const collegeSam = wd.citizens.find((c) => c.citizenKey === 'portal-key:sam-vale');
  assert.equal(collegeSam.firstSeenUtc, '2026-11-02T01:40:00.000Z'); // first utterance
  assert.equal(collegeSam.evidenceUtc, '2026-11-02T01:55:00.000Z'); // latest utterance
  const newsSam = wd.citizens.find((c) => c.name === 'sam vale');
  assert.equal(newsSam.firstSeenUtc, '2026-11-02T01:00:00.000Z');
});

test('PORTAL-KEY: a key is stable across heads while the name stands', () => {
  const a = deriveWorldData(fixtureHead(), { bundleSeq: 1 });
  const headB = fixtureHead();
  // Earlier Speaker speaks again, fresher, in head B — same name, new evidence
  headB.voices.data.places[0].said[1] = { by: 'Earlier Speaker', at: '2026-11-02T01:59:05.000Z', said: 'again', id: 'b2' };
  const b = deriveWorldData(headB, { bundleSeq: 2 });
  const keyOf = (wd) => wd.citizens.find((c) => c.name === 'Earlier Speaker' && c.provenance.route === 'voices').citizenKey;
  assert.equal(keyOf(a), 'portal-key:earlier-speaker');
  assert.equal(keyOf(b), keyOf(a));
});

test('PORTAL-KEY: a rename produces a NEW key — no rename-chasing', () => {
  const headA = fixtureHead();
  headA.voices.data.places[0].said = [{ by: 'Old Name', at: '2026-11-02T01:54:05.000Z', said: 'hi', id: 'r1' }];
  headA.news.data.residents = [];
  const headB = fixtureHead();
  headB.voices.data.places[0].said = [{ by: 'New Name', at: '2026-11-02T01:54:05.000Z', said: 'hi', id: 'r1' }];
  headB.news.data.residents = [];
  const a = deriveWorldData(headA, { bundleSeq: 1 });
  const b = deriveWorldData(headB, { bundleSeq: 2 });
  assert.equal(a.citizens[0].citizenKey, 'portal-key:old-name');
  assert.equal(b.citizens[0].citizenKey, 'portal-key:new-name');
  assert.notEqual(a.citizens[0].citizenKey, b.citizens[0].citizenKey);
});

test('malformed route payloads are treated as missing, never crash derivation', () => {
  const head = fixtureHead();
  head.voices = { fetchedUtc: FETCHED, data: 'not-an-object' };
  head.overview = { fetchedUtc: FETCHED, data: [1, 2, 3] };
  head.news = null;
  const wd = deriveWorldData(head, { bundleSeq: 1 });
  assert.deepEqual(wd.citizens, []);
  assert.deepEqual(wd.ticker, []);
  assert.deepEqual(wd.counters, {
    regionsDiscovered: 0, regionsSurveyed: 0, regionsNamed: 0,
    collegeDeposits: 0, treasury: 0, populationKnown: 0,
  });
  assert.equal(wd.world.sky, null);
  assert.equal(wd.schema, 'portal.world-data/v1');
});

// ------------------------------------------------------------- plots (M2.06)

test('plots: a voices-evidenced plot code derives a feed-evidenced plot entry', () => {
  const head = fixtureHead();
  head.voices.data.places.push({
    code: 'EMBER_DISTRICT_1_PLOT_30',
    said: [
      { by: 'Plot Speaker', at: '2026-11-02T01:40:00.000Z', said: 'from the plot', id: 'p1' },
      { by: 'Plot Speaker', at: '2026-11-02T01:45:00.000Z', said: 'still here', id: 'p2' },
    ],
  });
  const wd = deriveWorldData(head, { bundleSeq: 1 });
  // The entry claims existence only: parsed numbers, the first-evidence
  // stamp (here the head itself is the first evidencer), the voices
  // provenance, and no holder/quarters/geometry fields at all.
  assert.deepEqual(wd.ember.plots, [{
    code: 'EMBER_DISTRICT_1_PLOT_30',
    district: 1,
    plot: 30,
    provenanceClass: 'feed-evidenced',
    firstEvidencedUtc: FETCHED,
    provenance: { route: 'voices', fetchedUtc: FETCHED },
  }]);
  const speaker = wd.citizens.find((c) => c.name === 'Plot Speaker');
  assert.equal(speaker.placeCode, 'EMBER_DISTRICT_1_PLOT_30');
});

test('plots: a plot place with no utterance evidences nothing', () => {
  const head = fixtureHead();
  head.voices.data.places.push({ code: 'EMBER_DISTRICT_2_PLOT_7', said: [] });
  const wd = deriveWorldData(head, { bundleSeq: 1 });
  assert.deepEqual(wd.ember.plots, []);
});

test('plots: chats mentions are never plot evidence (negative control)', () => {
  const head = fixtureHead();
  // A chats payload shaped exactly like voices, carrying a plot code that
  // appears nowhere else: derivation must still emit no plot for it.
  head.chats = {
    fetchedUtc: FETCHED,
    data: {
      generated_at: '2026-11-02T02:04:05.000Z',
      places: [{
        code: 'EMBER_DISTRICT_3_PLOT_41',
        said: [{ by: 'Chat Only', at: '2026-11-02T01:00:00.000Z', said: 'panel only', id: 'c1' }],
      }],
    },
  };
  const wd = deriveWorldData(head, { bundleSeq: 1 });
  assert.deepEqual(wd.ember.plots, []);
  assert.ok(!wd.citizens.some((c) => c.placeCode === 'EMBER_DISTRICT_3_PLOT_41'));
});

test('plots: a plot evidenced earlier in the book persists after it goes quiet', () => {
  const EARLIER = '2026-11-02T01:00:00.000Z';
  const head = fixtureHead(); // head voices speak only at the plaza
  const earlier = {
    fetchedUtc: EARLIER,
    data: {
      generated_at: '2026-11-02T00:59:30.000Z',
      places: [{
        code: 'EMBER_DISTRICT_1_PLOT_30',
        said: [{ by: 'Gone Quiet', at: '2026-11-02T00:59:00.000Z', said: 'was here', id: 'q1' }],
      }],
    },
  };
  // Snapshots passed newest-first on purpose: first evidence is a
  // fetch-order fact, not a caller-order accident.
  const wd = deriveWorldData(head, { bundleSeq: 1, voicesSnapshots: [head.voices, earlier] });
  assert.deepEqual(wd.ember.plots, [{
    code: 'EMBER_DISTRICT_1_PLOT_30',
    district: 1,
    plot: 30,
    provenanceClass: 'feed-evidenced',
    firstEvidencedUtc: EARLIER,
    provenance: { route: 'voices', fetchedUtc: EARLIER },
  }]);
  // Presence stays head-based: the plot exists, and nobody is there
  // now — no citizen's placeCode points at it, and 'Gone Quiet' (not a
  // head speaker at all) gains no record from the historical snapshot.
  assert.ok(!wd.citizens.some((c) => c.placeCode === 'EMBER_DISTRICT_1_PLOT_30'));
  assert.ok(!wd.citizens.some((c) => c.name === 'Gone Quiet'));
});

test('plots: firstEvidencedUtc stays the earliest stamp when the head also evidences the plot', () => {
  const EARLIER = '2026-11-02T01:00:00.000Z';
  const head = fixtureHead();
  head.voices.data.places.push({
    code: 'EMBER_DISTRICT_1_PLOT_30',
    said: [{ by: 'Plot Speaker', at: '2026-11-02T01:40:00.000Z', said: 'from the plot', id: 'p1' }],
  });
  const earlier = {
    fetchedUtc: EARLIER,
    data: {
      generated_at: '2026-11-02T00:59:30.000Z',
      places: [{
        code: 'EMBER_DISTRICT_1_PLOT_30',
        said: [{ by: 'First Voice', at: '2026-11-02T00:59:00.000Z', said: 'first', id: 'q1' }],
      }],
    },
  };
  const wd = deriveWorldData(head, { bundleSeq: 1, voicesSnapshots: [earlier, head.voices] });
  assert.equal(wd.ember.plots.length, 1);
  assert.equal(wd.ember.plots[0].firstEvidencedUtc, EARLIER);
  // ...while current presence still comes from the head alone.
  const speaker = wd.citizens.find((c) => c.name === 'Plot Speaker');
  assert.equal(speaker.placeCode, 'EMBER_DISTRICT_1_PLOT_30');
});

test('plots: a quiet place in an early snapshot is not retro-evidenced by a later utterance elsewhere', () => {
  // A place listed with no utterance evidences nothing in that
  // snapshot; accumulation must not let a later snapshot's occupancy
  // rewrite that — the plot enters only from the snapshot whose
  // utterance actually evidences it.
  const EARLIER = '2026-11-02T01:00:00.000Z';
  const LATER = '2026-11-02T01:30:00.000Z';
  const head = fixtureHead();
  const empty = { fetchedUtc: EARLIER, data: { generated_at: EARLIER, places: [{ code: 'EMBER_DISTRICT_2_PLOT_7', said: [] }] } };
  const spoken = {
    fetchedUtc: LATER,
    data: {
      generated_at: LATER,
      places: [{
        code: 'EMBER_DISTRICT_2_PLOT_7',
        said: [{ by: 'Late Voice', at: '2026-11-02T01:29:00.000Z', said: 'now', id: 'l1' }],
      }],
    },
  };
  const wd = deriveWorldData(head, { bundleSeq: 1, voicesSnapshots: [empty, spoken] });
  assert.equal(wd.ember.plots.length, 1);
  assert.equal(wd.ember.plots[0].firstEvidencedUtc, LATER);
});

test('plots: the record-attested anchors are never feed-derived', () => {
  // District 3 Plot 18 / District 1 Plot 31 exist in the household record
  // and the layout (class record-attested) — no feed fixture here speaks
  // at them, so the bundle must not present them as feed-evidenced plots.
  const wd = deriveWorldData(fixtureHead(), { bundleSeq: 1 });
  assert.ok(!wd.ember.plots.some((p) => p.code === 'EMBER_DISTRICT_3_PLOT_18'));
  assert.ok(!wd.ember.plots.some((p) => p.code === 'EMBER_DISTRICT_1_PLOT_31'));
});
