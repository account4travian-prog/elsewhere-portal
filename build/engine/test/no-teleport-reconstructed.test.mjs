// no-teleport-reconstructed.test.mjs — M3.01 / M3.05: the §7.3
// invariant (invariant-harness.mjs, the SAME checker as
// no-teleport.test.mjs) run over RECONSTRUCTED journeys — the legs
// journeys.mjs derives from place-change evidence. A reconstructed
// journey's playback must walk the layout graph path between its
// evidenced endpoints, never jump: reconstruction licenses the
// endpoints and the schedule, never a shortcut.
//
// POSITIVE CONTROL: the teleporting mutant is run over the same
// reconstructed journeys and must be caught on every one with a timed
// span (the original suite's rule).
//
// The live-corpus test runs the real archive through journeys-cycle
// and checks every reconstructed journey the record currently
// supports. It is a property run, robust to archive growth: however
// many journeys reconstruct, all of them must satisfy the invariant.
// (At first run the honest count is ZERO — since continuous coverage
// began at A0 no citizen has yet been evidenced at two places; the
// test asserts the derivation ran and its stats agree, and the
// invariant binds from the first journey the record ever yields.)
//
// Run: node --test test/no-teleport-reconstructed.test.mjs   (from build/engine/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { planJourney, positionAt } from '../playback.mjs';
import { nodeByCode } from '../astar.mjs';
import { checkContinuity, mutantPositionAt } from './invariant-harness.mjs';
import { reconstructJourneys } from '../../data/journeys.mjs';
import { buildJourneys } from '../../data/journeys-cycle.mjs';

const layout = JSON.parse(
  readFileSync(new URL('../../shared/ember-layout.json', import.meta.url), 'utf8'),
);

// A reconstructed journey -> the engine journey that plays it: the
// walk is scheduled across its evidence window (departure tick to
// arrival tick), one step, endpoints only.
function toEngineJourney(j) {
  return planJourney({
    handle: j.citizenKey,
    path: j.path,
    startTick: j.departureTick,
    ticksPerStep: j.worldTicks,
  });
}

function assertInvariantOver(journeys, label) {
  let checked = 0;
  let mutantChecked = 0;
  for (const j of journeys) {
    const engine = toEngineJourney(j);
    const violations = checkContinuity(positionAt, engine, layout);
    assert.deepEqual(violations, [], `${label} ${j.citizenKey} ${j.from}->${j.to}: ${violations.join(' ; ')}`);
    checked++;
    if (engine.totalWorldTicks > 0) {
      const mutantViolations = checkContinuity(mutantPositionAt, engine, layout);
      assert.ok(
        mutantViolations.length > 0,
        `${label}: mutant PASSED the invariant on reconstructed ${j.citizenKey} — the checker is broken`,
      );
      mutantChecked++;
    }
  }
  return { checked, mutantChecked };
}

// --- fixtures (the plan's M3.01 exit-gate windows, in miniature) ------

const BOOK = { id: 'world-test', openedAtUtc: '2026-11-03T00:00:00Z' };
const EPOCH_MS = Date.parse(BOOK.openedAtUtc);
const at = (min, sec = 0) => new Date(EPOCH_MS + (min * 60 + sec) * 1000).toISOString();
const FULL_FETCH = [];
for (let t = 0; t <= 120 * 60; t += 120) FULL_FETCH.push(new Date(EPOCH_MS + t * 1000).toISOString());

function snap(places) {
  return {
    data: {
      places: Object.entries(places).map(([code, rows]) => ({
        code,
        said: rows.map(([by, stamp, id]) => ({ by, at: stamp, id, said: 'words' })),
      })),
    },
    fetchedUtc: at(40),
    file: 'fixture.json',
  };
}

test('golden window: the one reconstructed journey walks its graph path; the mutant is caught on it', () => {
  const doc = reconstructJourneys({
    voicesSnapshots: [snap({
      EMBER_TOWNHALL: [['Test Person', at(10), 'u1'], ['Test Person', at(20), 'u2']],
      EMBER_COLLEGE: [['Test Person', at(35), 'u3']],
    })],
    voicesFetchUtc: FULL_FETCH,
    book: BOOK,
  });
  assert.equal(doc.journeys.length, 1);
  const j = doc.journeys[0];
  // Exit-gate form: arrival is scheduled no earlier than the first
  // destination evidence — here exactly on it.
  assert.equal(j.arrivalUtc, at(35));
  const { checked, mutantChecked } = assertInvariantOver(doc.journeys, 'golden');
  assert.equal(checked, 1);
  assert.equal(mutantChecked, 1);
});

test('near-reach reconstructed journey: continuity holds across the 0-tick completion', () => {
  const doc = reconstructJourneys({
    voicesSnapshots: [snap({
      EMBER_TOWNHALL: [['Test Person', at(20, 10), 'u1']],
      EMBER_COLLEGE: [['Test Person', at(20, 25), 'u2']],
    })],
    voicesFetchUtc: FULL_FETCH,
    book: BOOK,
  });
  assert.equal(doc.journeys.length, 1);
  assert.equal(doc.journeys[0].worldTicks, 0);
  const { checked, mutantChecked } = assertInvariantOver(doc.journeys, 'near-reach');
  assert.equal(checked, 1);
  assert.equal(mutantChecked, 0); // no timed span for the mutant to teleport across
});

test('vanish + dark windows: nothing reconstructs, so there is nothing to play', () => {
  const vanish = reconstructJourneys({
    voicesSnapshots: [snap({ EMBER_TOWNHALL: [['Quiet One', at(10), 'u1']] })],
    voicesFetchUtc: FULL_FETCH,
    book: BOOK,
  });
  assert.equal(vanish.journeys.length, 0);
  const dark = reconstructJourneys({
    voicesSnapshots: [snap({
      EMBER_TOWNHALL: [['Test Person', at(20), 'u2']],
      EMBER_COLLEGE: [['Test Person', at(35), 'u3']],
    })],
    voicesFetchUtc: FULL_FETCH.filter((f) => f < at(14) || f > at(60)), // 46-minute silence
    book: BOOK,
  });
  assert.equal(dark.stats.candidateLegs, 1);
  assert.equal(dark.journeys.length, 0);
});

// --- the live corpus --------------------------------------------------------

const LIVE_ARCHIVE = new URL('../../data/archive/', import.meta.url);

test('live corpus: every journey the real archive supports satisfies the invariant', async (t) => {
  if (!existsSync(new URL('world-books.json', LIVE_ARCHIVE))) {
    t.skip('no live archive in this checkout');
    return;
  }
  const { doc } = await buildJourneys({ archiveDir: LIVE_ARCHIVE.pathname });
  assert.equal(doc.stats.reconstructed, doc.journeys.length);
  assert.equal(doc.stats.candidateLegs, doc.stats.reconstructed + doc.stats.rejectedDarkLegs);
  // Playback needs both endpoints on the Ember stage graph. Legs
  // touching places the layout does not carry (frontier cells) are
  // recorded in the artefact but have no stage geometry to walk —
  // counted, never silently dropped.
  const playable = [];
  let offGraph = 0;
  for (const j of doc.journeys) {
    if (nodeByCode(layout, j.from) && nodeByCode(layout, j.to)) playable.push(j);
    else offGraph++;
  }
  const { checked } = assertInvariantOver(playable, 'live');
  assert.equal(checked + offGraph, doc.journeys.length);
  t.diagnostic(
    `live corpus: ${doc.stats.candidateLegs} candidate legs, ${doc.journeys.length} reconstructed, ` +
    `${checked} invariant-checked, ${offGraph} off-graph, ${doc.stats.rejectedDarkLegs} rejected by the ceiling`,
  );
});
