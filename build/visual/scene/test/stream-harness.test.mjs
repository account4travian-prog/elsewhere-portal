/* M4.26 — rendered-stream invariant harness: per-frame positions
   sampled from the RUNNING presentation of both renderers (the 3D
   scene's driver + transform round-trip; the 2D app's verbatim
   positionAt call), no-teleport verified over the fixture set.
   Positive controls: the engine's teleporting mutant, sampled the
   same way, must be caught in both checkers.
   Run per file: node --test test/stream-harness.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { planJourney } from '../../../engine/playback.mjs';
import { mutantPositionAt } from '../../../engine/invariant.mjs';
import {
  sampleStream, checkSampledStream, checkSteppedStream, runRendererStreams,
  gridToWorld, worldToGrid,
} from '../stream-harness.mjs';
import { createCalmerPlayer } from '../calmer.mjs';

const LAYOUT = JSON.parse(readFileSync(new URL('../../../shared/ember-layout.json', import.meta.url), 'utf8'));
const DEMO = JSON.parse(readFileSync(new URL('../../../fixtures/demo-journey.json', import.meta.url), 'utf8'));

// The fixture set: the demo journey (the golden replay), a cross-town
// journey, a journey with a 0-tick near-reach leg, and a retrace.
const FIXTURES = [
  { key: 'demo', journey: planJourney({ handle: DEMO.handle, path: DEMO.path, startTick: DEMO.startTick, ticksPerStep: DEMO.ticksPerStep }) },
  { key: 'cross-town', journey: planJourney({ handle: 'x', path: ['EMBER_TOWNHALL', 'EMBER_HOME_WILLOW_COTTAGE'], startTick: 0, ticksPerStep: 6 }) },
  { key: 'near-reach', journey: planJourney({ handle: 'x', path: ['EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE', 'EMBER_DISTRICT_3_PLOT_18'], startTick: 10, ticksPerStep: [0, 3] }) },
  { key: 'retrace', journey: planJourney({ handle: 'x', path: ['EMBER_COLLEGE', 'EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE'], startTick: 0, ticksPerStep: [3, 3] }) },
];

test('both renderers: no-teleport green over the fixture set', () => {
  const { scene3d, app2d } = runRendererStreams({ layout: LAYOUT, journeys: FIXTURES });
  for (const { key } of FIXTURES) {
    assert.deepEqual(scene3d[key], [], `scene3d stream violated the invariant for ${key}`);
    assert.deepEqual(app2d[key], [], `app2d stream violated the invariant for ${key}`);
  }
});

test('positive control: the teleporting mutant is caught by the sampled checker', () => {
  for (const { key, journey } of FIXTURES) {
    if (journey.totalWorldTicks === 0) continue;
    const samples = sampleStream(mutantPositionAt, journey, LAYOUT, { dt: 0.05 });
    const violations = checkSampledStream(journey, LAYOUT, samples);
    assert.ok(violations.length > 0, `mutant passed the sampled checker on ${key} — the checker is broken`);
  }
});

test('positive control: a stepped mutant (pose skips a vertex) is caught by the stepped checker', () => {
  const journey = FIXTURES[0].journey;
  const player = createCalmerPlayer(journey, LAYOUT, {});
  const good = sampleStream((j, l, t) => player.positionAt(t), journey, LAYOUT, { dt: 0.05 });
  assert.deepEqual(checkSteppedStream(journey, LAYOUT, good), []);
  // Mutant: drop every second distinct pose — the stream now jumps a vertex.
  const seen = [];
  const mutant = [];
  for (const s of good) {
    const k = `${s.x},${s.y}`;
    if (!seen.includes(k)) seen.push(k);
    if (seen.indexOf(k) % 2 === 0) mutant.push(s);
  }
  assert.ok(checkSteppedStream(journey, LAYOUT, mutant).length > 0, 'stepped mutant passed — the checker is broken');
});

test('the mutant is also caught after the 3D transform round-trip (the trip does not launder it)', () => {
  const journey = FIXTURES[0].journey;
  const samples = sampleStream((j, l, t) => {
    const p = mutantPositionAt(j, l, t);
    const w = gridToWorld(p.x, p.y);
    const g = worldToGrid(w.x, w.z);
    return { ...p, x: g.x, y: g.y };
  }, journey, LAYOUT, { dt: 0.05 });
  assert.ok(checkSampledStream(journey, LAYOUT, samples).length > 0);
});
