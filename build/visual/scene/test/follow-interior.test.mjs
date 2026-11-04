/* M5.10 follow-through-interiors.
   Run per file: node --test test/follow-interior.test.mjs

   Proven here over a recorded-shape street→interior→street track
   built on the real layout's College geometry:
   - the camera plan runs street (with lookahead) → door beat →
     interior → door beat → street, in that order;
   - during the door beat the figure is rendered AT the door and
     is never visible inside; the shell opens only after the beat;
   - followNeverBreaks holds for the plan, and FAILS for a
     doctored plan with the beats stripped (positive control) and
     for a plan whose figure teleports;
   - the pan pause holds its target until "Re-centre";
   - an off-stage place hands the follow off to the map. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  followCameraPlan, createPanControl, followNeverBreaks,
  DOOR_BEAT_MS, RECENTRE_LABEL,
} = await import('../follow-interior.mjs');
const { densifyPath } = await import('../interiors.mjs');

const LAYOUT = JSON.parse(readFileSync(new URL('../../../shared/ember-layout.json', import.meta.url), 'utf8'));
const REGISTRY = JSON.parse(readFileSync(new URL('../interior-kits.json', import.meta.url), 'utf8'));
const { effectiveLayout } = await import('../../../app/logic.mjs');
const eff = effectiveLayout(LAYOUT, JSON.parse(readFileSync(new URL('../../../data/feed/world-data.json', import.meta.url), 'utf8')));
const college = eff.nodes.find((n) => n.code === 'EMBER_COLLEGE');
const plaza = eff.nodes.find((n) => n.code === 'EMBER_PLAZA_OF_UNITY');
const def = REGISTRY.interiors.EMBER_COLLEGE;

const rect = college.geometry.footprintRect;
const doorWorld = [college.geometry.door.anchor.x, college.geometry.door.anchor.z];
const lecternWorld = [rect.cx + def.stations[0].position[0], rect.cz + def.stations[0].position[2]];
const camWorld = [rect.cx + def.anchors.camInterior[0], rect.cz + def.anchors.camInterior[2]];
const plazaPos = [plaza.geometry.pavingRect.cx, plaza.geometry.pavingRect.cz];
const GEO = { EMBER_COLLEGE: { door: doorWorld, camAnchor: camWorld } };

// Build the track: plaza -> door (outside) -> through the door ->
// lectern, dwell, back out -> plaza. Samples every 400 ms along a
// densified walk; `inside` flips at the door vertex.
function buildTrack() {
  const out1 = [doorWorld[0], doorWorld[1] + 1.6]; // south face: outside is +z
  const pathOut = densifyPath([[plazaPos[0], 0, plazaPos[1]], [out1[0], 0, out1[1]], [doorWorld[0], 0, doorWorld[1]], [lecternWorld[0], 0, lecternWorld[1]]], 1.2)
    .map((p) => [p[0], p[2]]);
  const pathBack = [...pathOut].reverse();
  const full = [...pathOut, ...pathBack.slice(1)];
  const doorIdx = pathOut.findIndex((p) => p[0] === doorWorld[0] && p[1] === doorWorld[1]);
  return full.map((pos, i) => {
    const inOut = i <= pathOut.length - 1 ? i : full.length - 1 - i;
    return { t: i * 400, pos, inside: inOut > doorIdx ? 'EMBER_COLLEGE' : null, known: true };
  });
}

test('street → door beat → interior → door beat → street, in order', () => {
  const plan = followCameraPlan(buildTrack(), GEO);
  const modes = plan.map((d) => d.mode);
  const seq = modes.filter((m, i) => i === 0 || m !== modes[i - 1]);
  assert.deepEqual(seq, ['street', 'door-beat', 'interior', 'door-beat', 'street']);
  const beats = plan.filter((d) => d.mode === 'door-beat');
  assert.ok(beats.length >= 2, 'samples fall inside both beats');
  // Each maximal beat run spans at most the beat plus one sample.
  let runStart = null;
  for (const d of plan) {
    if (d.mode === 'door-beat' && runStart === null) runStart = d.t;
    if (d.mode !== 'door-beat' && runStart !== null) {
      assert.ok(d.t - runStart <= DOOR_BEAT_MS + 400, 'a beat run is one beat long, not a stall');
      runStart = null;
    }
  }
});

test('during the beat: figure at the door, never inside, shell closed; after: shell open at the cam anchor', () => {
  const plan = followCameraPlan(buildTrack(), GEO);
  for (const d of plan) {
    if (d.mode === 'door-beat') {
      assert.deepEqual(d.figurePos, doorWorld, 'the figure is rendered at the door anchor during the beat');
      assert.equal(d.figureInsideVisible, false);
      assert.equal(d.shellOpenFor, null, 'the shell stays closed through the beat');
    }
    if (d.mode === 'interior') {
      assert.equal(d.shellOpenFor, 'EMBER_COLLEGE');
      assert.deepEqual(d.target, camWorld, 'the interior camera sits at the GLB\'s own interior anchor');
      assert.equal(d.figureInsideVisible, true);
    }
  }
});

test('lookahead: the street target leads the figure, within the clamp', () => {
  const plan = followCameraPlan(buildTrack(), GEO);
  const track = buildTrack();
  let led = 0;
  for (let i = 1; i < plan.length; i++) {
    if (plan[i].mode !== 'street') continue;
    const lead = Math.hypot(plan[i].target[0] - track[i].pos[0], plan[i].target[1] - track[i].pos[1]);
    assert.ok(lead <= 3 + 1e-9, 'lead never exceeds the clamp');
    if (lead > 0.01) led++;
  }
  assert.ok(led > 0, 'a moving figure is actually led');
});

test('followNeverBreaks holds — and catches a beat-stripped plan and a teleport (positive controls)', () => {
  const track = buildTrack();
  const plan = followCameraPlan(track, GEO);
  assert.equal(followNeverBreaks(plan), true);
  const stripped = plan.map((d) => (d.mode === 'door-beat'
    ? { ...d, mode: 'interior', figureInsideVisible: true, shellOpenFor: 'EMBER_COLLEGE' }
    : d));
  assert.equal(followNeverBreaks(stripped), false, 'showing the figure inside without a beat breaks the follow');
  const jumped = plan.map((d, i) => (i === 3 ? { ...d, figurePos: [d.figurePos[0] + 30, d.figurePos[1]] } : d));
  assert.equal(followNeverBreaks(jumped), false, 'a 30-unit jump in the rendered figure breaks the follow');
});

test('pan pause holds the target until "Re-centre"', () => {
  const pan = createPanControl();
  assert.equal(pan.label, null);
  assert.deepEqual(pan.targetFor([1, 2]), [1, 2]);
  pan.pan([5, 6]);
  assert.equal(pan.state, 'paused');
  assert.equal(pan.label, RECENTRE_LABEL);
  assert.equal(RECENTRE_LABEL, 'Re-centre');
  assert.deepEqual(pan.targetFor([9, 9]), [5, 6], 'while paused the plan\'s target is not used');
  pan.recentre();
  assert.equal(pan.state, 'following');
  assert.deepEqual(pan.targetFor([9, 9]), [9, 9]);
});

test('an off-stage place hands off to the map', () => {
  const track = buildTrack();
  track.push({ t: track.length * 400, pos: [200, 200], inside: null, known: false });
  const plan = followCameraPlan(track, GEO);
  const last = plan[plan.length - 1];
  assert.equal(last.mode, 'handoff');
  assert.equal(last.target, null);
  assert.match(last.note, /hands off to the map/);
});
