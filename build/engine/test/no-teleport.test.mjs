// no-teleport.test.mjs — Plan B §7.3, the centrepiece invariant.
//
// For every figure, rendered positions must form a continuous path on the
// route graph: consecutive sampled positions are identical, at a node, or
// interpolated on one edge; route-distance is monotone; movement between
// samples never exceeds the fastest scheduled leg speed (plus the route
// length of any 0-tick near-reach legs completing inside the sample
// interval — §7.3: the invariant governs continuity, not duration); and
// every place-code arrival happens no earlier than its scheduled tick,
// in path order, with no place skipped.
//
// The checker itself lives in ../invariant.mjs (extracted at M3.05) so
// the full-corpus runner (build/data/corpus-invariants.mjs) and this
// synthetic suite run THE SAME implementation. This suite remains the
// checker's own gate.
//
// POSITIVE CONTROL (the project owner's doctrine — an unproven test is not a gate):
// `mutantPositionAt` (in invariant.mjs) deliberately TELEPORTS (origin
// until mid-journey, then the destination, instantly). The suite asserts
// the checker REJECTS it. If the mutant ever passes, this suite fails —
// the check itself is broken and nothing ships on it.
//
// Run: node --test test/no-teleport.test.mjs   (from build/engine/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planJourney, positionAt } from '../playback.mjs';
import { checkContinuity, mutantPositionAt } from '../invariant.mjs';

const layout = JSON.parse(
  readFileSync(new URL('../../shared/ember-layout.json', import.meta.url), 'utf8'),
);
const demo = JSON.parse(
  readFileSync(new URL('../../fixtures/demo-journey.json', import.meta.url), 'utf8'),
);

// --- journeys under test -----------------------------------------------------

const journeys = {
  demo: planJourney(demo),
  nearReachFirstLeg: planJourney({
    handle: 'nr',
    path: ['EMBER_TOWNHALL', 'EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE'],
    startTick: 50,
    ticksPerStep: [0, 2],
  }),
  longWayHome: planJourney({
    handle: 'long',
    path: [
      'EMBER_HOME_MAPLE_COTTAGE',
      'MARKET_HALL',
      'EMBER_PLAZA_OF_UNITY',
      'PUBLIC_WORKSHOP',
      'EMBER_HOME_WILLOW_COTTAGE',
    ],
    startTick: 7,
    ticksPerStep: 1,
  }),
  singleStep: planJourney({
    handle: 'one',
    path: ['EMBER_COLLEGE', 'EMBER_DISTRICT_3_PLOT_18'],
    startTick: 0,
    ticksPerStep: 3,
  }),
  pureNearReach: planJourney({
    handle: 'pnr',
    path: ['EMBER_TOWNHALL', 'EMBER_PLAZA_OF_UNITY'],
    startTick: 20,
    ticksPerStep: [0],
  }),
};

test('invariant holds for the real positionAt across all test journeys', () => {
  for (const [name, journey] of Object.entries(journeys)) {
    const violations = checkContinuity(positionAt, journey, layout);
    assert.deepEqual(violations, [], `${name}: ${violations.join(' ; ')}`);
  }
});

test('POSITIVE CONTROL: the invariant checker catches the teleporting mutant', () => {
  for (const [name, journey] of Object.entries(journeys)) {
    if (journey.totalWorldTicks === 0) continue; // mutant needs a timed span to teleport across
    const violations = checkContinuity(mutantPositionAt, journey, layout);
    assert.ok(
      violations.length > 0,
      `mutant PASSED the invariant on ${name} — the checker is broken and must not ship`,
    );
  }
});

// --- M3.05 corpus shapes: retraced edges, revisited places, long steps ------
// The first full-corpus run (build/data/corpus-invariants.mjs) produced
// three checker false-positive classes on legal walks; these tests pin
// the amended checker against each, with the mutant still caught.

const retraced = planJourney({
  handle: 'retrace',
  path: ['EMBER_COLLEGE', 'EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE'],
  startTick: 0,
  ticksPerStep: [40, 40],
});

test('M3.05: a retraced edge (out and back along the same geometry) is continuous', () => {
  assert.deepEqual(checkContinuity(positionAt, retraced, layout), []);
});

test('M3.05 POSITIVE CONTROL: the mutant is still caught on the retraced journey', () => {
  const violations = checkContinuity(mutantPositionAt, retraced, layout);
  assert.ok(violations.length > 0, 'mutant passed on a retraced journey — the amendment masked it');
});

test('M3.05: a long step (2000 ticks) registers no early arrival from the engine snap', () => {
  const longStep = planJourney({
    handle: 'longstep',
    path: ['EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE'],
    startTick: 0,
    ticksPerStep: [2000],
  });
  assert.deepEqual(checkContinuity(positionAt, longStep, layout), []);
});

test('M3.05: a revisited place arriving on schedule is not early or out of order', () => {
  const revisit = planJourney({
    handle: 'revisit',
    path: ['EMBER_TOWNHALL', 'EMBER_COLLEGE', 'EMBER_TOWNHALL'],
    startTick: 10,
    ticksPerStep: [30, 30],
  });
  assert.deepEqual(checkContinuity(positionAt, revisit, layout), []);
});
