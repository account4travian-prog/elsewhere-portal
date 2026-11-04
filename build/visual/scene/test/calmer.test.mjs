/* M4.20 — Calmer (reduced motion): stepped still poses along the
   route, captions carrying the journey, EVERY square traversed in
   order; only the glide is removed. Gates: the pose sequence is the
   route itself; the stepped stream passes the M4.26 stepped checker;
   the gliding no-teleport suite stays green because Calmer samples
   the same journey (poses are playback positions snapped back to
   route nodes — positions playback itself reaches).
   Run per file: node --test test/calmer.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { planJourney, journeyRoute, positionAt } from '../../../engine/playback.mjs';
import { checkContinuity } from '../../../engine/invariant.mjs';
import { calmerPoses, createCalmerPlayer } from '../calmer.mjs';
import { sampleStream, checkSteppedStream } from '../stream-harness.mjs';

const LAYOUT = JSON.parse(readFileSync(new URL('../../../shared/ember-layout.json', import.meta.url), 'utf8'));
const DEMO = JSON.parse(readFileSync(new URL('../../../fixtures/demo-journey.json', import.meta.url), 'utf8'));
const demoJourney = planJourney({
  handle: DEMO.handle, path: DEMO.path, startTick: DEMO.startTick, ticksPerStep: DEMO.ticksPerStep,
});
const labelFor = (code) => (LAYOUT.nodes.find((n) => n.code === code) || {}).label || code;

test('poses are exactly the route squares, in order — every square traversed', () => {
  const poses = calmerPoses(demoJourney, LAYOUT, labelFor);
  const routeCodes = [];
  for (const leg of journeyRoute(demoJourney, LAYOUT)) {
    if (routeCodes.length === 0) routeCodes.push(leg.a);
    routeCodes.push(leg.b);
  }
  assert.deepEqual(poses.map((p) => p.code), routeCodes);
  assert.equal(poses[0].kind, 'depart');
  assert.equal(poses[poses.length - 1].kind, 'arrive');
  assert.equal(poses[poses.length - 1].code, 'EMBER_COLLEGE');
});

test('every pose carries a caption, and the captions tell the journey in order', () => {
  const poses = calmerPoses(demoJourney, LAYOUT, labelFor);
  for (const p of poses) assert.ok(p.caption.length > 0, `pose ${p.code} has no caption`);
  assert.match(poses[0].caption, /Setting out from Library Annex/);
  assert.match(poses[poses.length - 1].caption, /^Arrived at The College\.$/);
});

test('a Calmer demo replay visits every step (the exit gate)', () => {
  const player = createCalmerPlayer(demoJourney, LAYOUT, { dwellMs: 100, labelFor });
  const visited = [];
  for (let ms = 0; ms <= player.poses.length * 100; ms += 50) {
    const code = player.poseAt(ms).code;
    if (visited[visited.length - 1] !== code) visited.push(code);
  }
  assert.deepEqual(visited, player.visitsEveryStep);
  assert.equal(player.poseAt(10_000_000).code, 'EMBER_COLLEGE', 'the player holds the arrival pose');
});

test('the stepped stream passes the stepped no-teleport checker', () => {
  const player = createCalmerPlayer(demoJourney, LAYOUT, { labelFor });
  const samples = sampleStream((j, l, t) => player.positionAt(t), demoJourney, LAYOUT, { dt: 0.05 });
  assert.deepEqual(checkSteppedStream(demoJourney, LAYOUT, samples), []);
});

test('no-teleport suite green under Calmer: the journey gate is unchanged, and every pose is a reached position', () => {
  // The gliding suite over the same journey still passes — Calmer
  // changes presentation, never the journey.
  assert.deepEqual(checkContinuity(positionAt, demoJourney, LAYOUT), []);
  // And every Calmer pose is a position playback itself reaches at
  // some tick (poses invent no ground): scan the scheduled span.
  const reached = new Set();
  for (let t = demoJourney.startTick; t <= demoJourney.endTick; t += 0.01) {
    const p = positionAt(demoJourney, LAYOUT, t);
    if (p.between === null) reached.add(`${p.x},${p.y}`);
  }
  for (const pose of calmerPoses(demoJourney, LAYOUT, labelFor)) {
    assert.ok(reached.has(`${pose.x},${pose.y}`), `pose at ${pose.code} is never reached by playback`);
  }
});

test('a zero-step journey poses once, at its only place', () => {
  const still = planJourney({ handle: 'x', path: ['EMBER_PLAZA_OF_UNITY'], startTick: 0, ticksPerStep: [] });
  const poses = calmerPoses(still, LAYOUT, labelFor);
  assert.equal(poses.length, 1);
  assert.equal(poses[0].code, 'EMBER_PLAZA_OF_UNITY');
});
