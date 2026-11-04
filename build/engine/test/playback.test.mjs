// playback.test.mjs — schedule math, positionAt semantics, near-reach
// disclosure, catch-up rules. (The no-teleport invariant lives in
// no-teleport.test.mjs.) Run: node --test test/playback.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  planJourney,
  positionAt,
  catchUp,
  journeyRoute,
  TICK_SECONDS,
  MIN_SHOWN_SECONDS,
  SUMMARY_ABSENCE_TICKS,
} from '../playback.mjs';

const layout = JSON.parse(
  readFileSync(new URL('../../shared/ember-layout.json', import.meta.url), 'utf8'),
);
const demo = JSON.parse(
  readFileSync(new URL('../../fixtures/demo-journey.json', import.meta.url), 'utf8'),
);
const demoJourney = planJourney(demo);

test('planJourney: per-step schedule is cumulative, scalar and array forms agree', () => {
  assert.equal(demoJourney.startTick, 1000);
  assert.equal(demoJourney.endTick, 1004);
  assert.equal(demoJourney.totalWorldTicks, 4);
  assert.deepEqual(
    demoJourney.steps.map((s) => [s.from, s.to, s.startTick, s.endTick, s.worldTicks]),
    [
      ['LIBRARY_ANNEX', 'EMBER_PLAZA_OF_UNITY', 1000, 1002, 2],
      ['EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE', 1002, 1004, 2],
    ],
  );
  const scalar = planJourney({
    handle: 'x',
    path: ['A', 'B', 'C'],
    startTick: 10,
    ticksPerStep: 3,
  });
  assert.deepEqual(
    scalar.steps.map((s) => [s.startTick, s.endTick]),
    [
      [10, 13],
      [13, 16],
    ],
  );
  assert.throws(() => planJourney({ handle: 'x', path: [], startTick: 0, ticksPerStep: 1 }), TypeError);
  assert.throws(
    () => planJourney({ handle: 'x', path: ['A', 'B'], startTick: 0, ticksPerStep: [1, 2] }),
    TypeError,
  );
  assert.throws(
    () => planJourney({ handle: 'x', path: ['A', 'B'], startTick: 0, ticksPerStep: -1 }),
    TypeError,
  );
});

test('positionAt: endpoints, node arrival exactly on schedule, mid-step on one edge', () => {
  const plaza = layout.nodes.find((n) => n.code === 'EMBER_PLAZA_OF_UNITY');
  const library = layout.nodes.find((n) => n.code === 'LIBRARY_ANNEX');

  const before = positionAt(demoJourney, layout, 999.5);
  assert.deepEqual([before.code, before.x, before.y, before.between], [
    'LIBRARY_ANNEX',
    library.x,
    library.y,
    null,
  ]);

  // Halfway through step 1 (Library -> Plaza is a single direct edge):
  // f = 0.5, so the figure sits at the geometric midpoint, on that edge.
  const mid = positionAt(demoJourney, layout, 1001);
  assert.equal(mid.between.join('|'), 'LIBRARY_ANNEX|EMBER_PLAZA_OF_UNITY');
  assert.equal(mid.code, 'LIBRARY_ANNEX');
  assert.equal(mid.frac, 0.5);
  assert.equal(mid.x, (library.x + plaza.x) / 2);
  assert.equal(mid.y, (library.y + plaza.y) / 2);

  // Never at the Plaza before its scheduled tick; exactly at it, on it.
  const justBefore = positionAt(demoJourney, layout, 1001.999);
  assert.notEqual(justBefore.code === 'EMBER_PLAZA_OF_UNITY' && justBefore.between === null, true);
  const atPlaza = positionAt(demoJourney, layout, 1002);
  assert.deepEqual([atPlaza.code, atPlaza.x, atPlaza.y, atPlaza.between], [
    'EMBER_PLAZA_OF_UNITY',
    plaza.x,
    plaza.y,
    null,
  ]);

  const after = positionAt(demoJourney, layout, 5000);
  assert.equal(after.code, 'EMBER_COLLEGE');
  assert.equal(after.between, null);
});

test('near-reach 0-tick leg: disclosure fields and boundary behaviour', () => {
  const j = planJourney({
    handle: 'near',
    path: ['EMBER_TOWNHALL', 'EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE'],
    startTick: 50,
    ticksPerStep: [0, 2],
  });
  const leg = j.steps[0];
  assert.equal(leg.worldTicks, 0, 'world charges this leg no time');
  assert.equal(leg.nearReach, true);
  assert.equal(leg.shownSeconds, MIN_SHOWN_SECONDS, 'disclosed presentation minimum');
  assert.equal(MIN_SHOWN_SECONDS, 1);
  assert.equal(leg.startTick, 50);
  assert.equal(leg.endTick, 50, 'completes at a single tick boundary');
  const timed = j.steps[1];
  assert.equal(timed.shownSeconds, 2 * TICK_SECONDS);

  // Before the boundary: still at Town Hall. At the boundary the leg has
  // completed (the next step starts there), never mid-air between codes
  // without a leg: position is exactly the Plaza node.
  assert.equal(positionAt(j, layout, 49.9).code, 'EMBER_TOWNHALL');
  const atBoundary = positionAt(j, layout, 50);
  assert.equal(atBoundary.code, 'EMBER_PLAZA_OF_UNITY');
  assert.equal(atBoundary.between, null);
});

test('catchUp: ≤6 missed steps walk at 2.5×, no replay flag, nothing skipped', () => {
  const path = [];
  for (let i = 0; i < 9; i++) path.push(i % 2 ? 'EMBER_COLLEGE' : 'EMBER_PLAZA_OF_UNITY');
  const j = planJourney({ handle: 'c', path, startTick: 0, ticksPerStep: 1 });

  const plan = catchUp(j, 6);
  assert.equal(plan.mode, 'catch-up');
  assert.equal(plan.speed, 2.5);
  assert.equal(plan.replay, false);
  assert.deepEqual(plan.steps.map((s) => s.index), [0, 1, 2, 3, 4, 5]);
  assert.ok(plan.steps.every((s) => s.shownSeconds === TICK_SECONDS / 2.5));
  assert.equal(plan.arrivalTick, j.endTick, 'arrival tick is never beaten');
});

test('catchUp: >6 missed steps become ordered replay at 8×, flagged', () => {
  const path = [];
  for (let i = 0; i < 10; i++) path.push(i % 2 ? 'EMBER_COLLEGE' : 'EMBER_PLAZA_OF_UNITY');
  const j = planJourney({ handle: 'c', path, startTick: 0, ticksPerStep: 1 });

  const plan = catchUp(j, 8);
  assert.equal(plan.mode, 'replay');
  assert.equal(plan.speed, 8);
  assert.equal(plan.replay, true);
  // Every missed step, in order — compressed, never skipped or merged.
  assert.deepEqual(plan.steps.map((s) => s.index), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(plan.steps.every((s) => s.shownSeconds === TICK_SECONDS / 8));
  assert.equal(plan.arrivalTick, j.endTick);
});

test('catchUp: nothing missed, and near-reach floor holds under compression', () => {
  const j = planJourney({
    handle: 'c',
    path: ['EMBER_TOWNHALL', 'EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE'],
    startTick: 10,
    ticksPerStep: [0, 5],
  });
  const none = catchUp(j, 0);
  assert.equal(none.mode, 'none');
  assert.deepEqual(none.steps, []);

  // Miss the whole journey: the 0-tick leg keeps its disclosed 1 s floor
  // even in the plan; the timed leg compresses.
  const plan = catchUp(j, 5);
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].nearReach, true);
  assert.equal(plan.steps[0].worldTicks, 0);
  assert.equal(plan.steps[0].shownSeconds, MIN_SHOWN_SECONDS);
  assert.equal(plan.steps[1].shownSeconds, (5 * TICK_SECONDS) / plan.speed);
  assert.throws(() => catchUp(j, -1), TypeError);
});

test('catchUp: exactly 7 missed steps is the replay boundary (6 is not)', () => {
  const path = [];
  for (let i = 0; i < 10; i++) path.push(i % 2 ? 'EMBER_COLLEGE' : 'EMBER_PLAZA_OF_UNITY');
  const j = planJourney({ handle: 'c', path, startTick: 0, ticksPerStep: 1 });

  const six = catchUp(j, 6);
  assert.equal(six.mode, 'catch-up');
  assert.equal(six.replay, false);
  assert.equal(six.steps.length, 6);

  const seven = catchUp(j, 7);
  assert.equal(seven.mode, 'replay');
  assert.equal(seven.speed, 8);
  assert.equal(seven.replay, true, 'the REPLAY badge flag is set');
  // No-teleport under replay: every missed step is present, in order.
  assert.deepEqual(seven.steps.map((s) => s.index), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(seven.steps.every((s) => s.shownSeconds <= TICK_SECONDS / 8 + 1e-9 || s.nearReach));
});

test('catchUp: extreme missed ticks on a short journey escalate past catch-up (VER-D01)', () => {
  // The VER-D01 repro: the 2-step demo journey at 500 missed ticks used to
  // return 'catch-up' — the mode saturated at the step count and the
  // absence axis of Plan B §3.4 was missing entirely.
  const plan = catchUp(demoJourney, 500);
  assert.equal(plan.mode, 'path-summary');
  assert.equal(plan.replay, false);
  assert.equal(plan.absenceTicks, 500, 'absence defaults to the unplayed window');
  assert.deepEqual(plan.steps, [], 'path summary replays no steps');
  assert.deepEqual(plan.summarySteps.map((s) => s.index), [0, 1], 'every missed step is accounted for');
  assert.equal(plan.totalShownSeconds, 0);
  assert.equal(plan.arrivalTick, demoJourney.endTick, 'arrival tick is never beaten');
});

test('catchUp: absence boundary — exactly 1 h still replays, 1 tick more summarises', () => {
  assert.equal(SUMMARY_ABSENCE_TICKS * TICK_SECONDS, 3600, 'the threshold is one hour');
  const path = [];
  for (let i = 0; i < 10; i++) path.push(i % 2 ? 'EMBER_COLLEGE' : 'EMBER_PLAZA_OF_UNITY');
  const j = planJourney({ handle: 'c', path, startTick: 0, ticksPerStep: 1 });

  // 8 missed steps, absence exactly 120 ticks (= 1 h, §3.4 "absence ≤ 1 h").
  const atHour = catchUp(j, 8, { absenceTicks: SUMMARY_ABSENCE_TICKS });
  assert.equal(atHour.mode, 'replay');
  assert.equal(atHour.replay, true);
  assert.equal(atHour.steps.length, 8);

  const pastHour = catchUp(j, 8, { absenceTicks: SUMMARY_ABSENCE_TICKS + 1 });
  assert.equal(pastHour.mode, 'path-summary');
  assert.equal(pastHour.replay, false);
  assert.deepEqual(pastHour.steps, []);
  assert.equal(pastHour.summarySteps.length, 8, 'the summary accounts for all 8 missed steps');

  // The step axis still rules below the absence threshold: 2 missed steps
  // at exactly 1 h of absence is a catch-up walk, not a replay.
  const small = catchUp(demoJourney, 4, { absenceTicks: SUMMARY_ABSENCE_TICKS });
  assert.equal(small.mode, 'catch-up');
  assert.equal(small.steps.length, 2);
});

test('catchUp: explicit absence longer than the journey window summarises the journey', () => {
  // A journey that began mid-absence: only its own window elapsed unplayed,
  // but the visitor was away over an hour (§3.4 keys the summary on absence).
  const plan = catchUp(demoJourney, 4, { absenceTicks: 200 });
  assert.equal(plan.mode, 'path-summary');
  assert.equal(plan.missedTicks, 4);
  assert.equal(plan.absenceTicks, 200);
  assert.deepEqual(plan.summarySteps.map((s) => [s.from, s.to, s.startTick, s.endTick]), [
    ['LIBRARY_ANNEX', 'EMBER_PLAZA_OF_UNITY', 1000, 1002],
    ['EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE', 1002, 1004],
  ]);
  // Summary steps carry their 1× shown seconds — listed, never compressed.
  assert.ok(plan.summarySteps.every((s) => s.shownSeconds === 2 * TICK_SECONDS));
});

test('catchUp: no missed steps stays none however long the absence; absence is validated', () => {
  const none = catchUp(demoJourney, 0, { absenceTicks: 500 });
  assert.equal(none.mode, 'none');
  assert.deepEqual(none.steps, []);
  assert.equal(none.summarySteps, undefined, 'nothing missed, nothing to summarise');
  assert.throws(() => catchUp(demoJourney, 1, { absenceTicks: -1 }), TypeError);
  assert.throws(() => catchUp(demoJourney, 1, { absenceTicks: NaN }), TypeError);
});

test('journeyRoute: concatenated legs carry their step index', () => {
  const legs = journeyRoute(demoJourney, layout);
  assert.ok(legs.length >= 2);
  assert.equal(legs[0].stepIndex, 0);
  assert.equal(legs[legs.length - 1].stepIndex, 1);
  for (let i = 0; i + 1 < legs.length; i++) assert.equal(legs[i].b, legs[i + 1].a);
});

// ------------------------------------------------------- M3.02: fromTick

// A 10-step journey, steps beginning at ticks 100, 102, …, 118 (2 ticks
// each), arrival at 120.
const windowJourney = (() => {
  const path = [];
  for (let i = 0; i < 11; i++) path.push(i % 2 ? 'EMBER_COLLEGE' : 'EMBER_PLAZA_OF_UNITY');
  return planJourney({ handle: 'w', path, startTick: 100, ticksPerStep: 2 });
})();

test('catchUp: mid-journey fromTick windows exact — catch-up counts steps beginning in the window', () => {
  // Window [106, 112): steps beginning at 106, 108, 110 — indices 3, 4, 5.
  const plan = catchUp(windowJourney, 6, { fromTick: 106 });
  assert.equal(plan.mode, 'catch-up');
  assert.equal(plan.speed, 2.5);
  assert.equal(plan.replay, false);
  assert.deepEqual(plan.steps.map((s) => s.index), [3, 4, 5]);
  assert.equal(plan.fromTick, 106);
  assert.equal(plan.arrivalTick, windowJourney.endTick, 'arrival tick is never beaten');

  // A step already begun before fromTick is NOT re-planned, even though it
  // ends inside the window: fromTick 105 falls mid-step-2 (104–106), and
  // the window [105, 111) still yields exactly steps 3, 4, 5.
  const midStep = catchUp(windowJourney, 6, { fromTick: 105 });
  assert.deepEqual(midStep.steps.map((s) => s.index), [3, 4, 5]);

  // fromTick defaults to journey.startTick: the explicit default and the
  // omitted option produce identical plans (pre-M3.02 behaviour preserved).
  assert.deepEqual(catchUp(windowJourney, 6), catchUp(windowJourney, 6, { fromTick: 100 }));

  // A window that ends exactly at the journey's start misses nothing of
  // the journey; a window opening before the start counts steps from the
  // journey's first step (step 1 begins at 102, the window's end — not
  // yet missed).
  assert.equal(catchUp(windowJourney, 4, { fromTick: 96 }).mode, 'none');
  assert.deepEqual(
    catchUp(windowJourney, 6, { fromTick: 96 }).steps.map((s) => s.index),
    [0],
  );

  // A window entirely past the journey's end misses nothing.
  assert.equal(catchUp(windowJourney, 5, { fromTick: 500 }).mode, 'none');
});

test('catchUp: replay threshold is measured from a mid-journey fromTick', () => {
  const path = [];
  for (let i = 0; i < 21; i++) path.push(i % 2 ? 'EMBER_COLLEGE' : 'EMBER_PLAZA_OF_UNITY');
  const j = planJourney({ handle: 'long', path, startTick: 0, ticksPerStep: 1 });

  // Window [10, 17): 7 steps begin inside it — over the catch-up ceiling.
  const seven = catchUp(j, 7, { fromTick: 10 });
  assert.equal(seven.mode, 'replay');
  assert.equal(seven.speed, 8);
  assert.equal(seven.replay, true);
  assert.deepEqual(seven.steps.map((s) => s.index), [10, 11, 12, 13, 14, 15, 16]);
  assert.equal(seven.arrivalTick, j.endTick);

  // Window [10, 16): exactly 6 — still a catch-up walk, from mid-journey.
  const six = catchUp(j, 6, { fromTick: 10 });
  assert.equal(six.mode, 'catch-up');
  assert.equal(six.replay, false);
  assert.deepEqual(six.steps.map((s) => s.index), [10, 11, 12, 13, 14, 15]);
});

test('catchUp: the >1 h summary boundary applies from a mid-journey fromTick', () => {
  // Window [106, 110): steps 3 and 4. Absence of exactly 1 h (given in
  // REC-3 seconds) is NOT over the boundary — the steps walk.
  const atHour = catchUp(windowJourney, 4, { fromTick: 106, absenceSeconds: 3600 });
  assert.equal(atHour.mode, 'catch-up');
  assert.equal(atHour.absenceTicks, SUMMARY_ABSENCE_TICKS);
  assert.deepEqual(atHour.steps.map((s) => s.index), [3, 4]);

  // 3630 s = 121 ticks: over the hour — only the window's steps are
  // summarised; steps before fromTick are not this plan's business.
  const pastHour = catchUp(windowJourney, 4, { fromTick: 106, absenceSeconds: 3630 });
  assert.equal(pastHour.mode, 'path-summary');
  assert.equal(pastHour.absenceTicks, SUMMARY_ABSENCE_TICKS + 1);
  assert.equal(pastHour.absenceSeconds, 3630);
  assert.deepEqual(pastHour.steps, []);
  assert.deepEqual(pastHour.summarySteps.map((s) => s.index), [3, 4]);
  assert.equal(pastHour.arrivalTick, windowJourney.endTick);

  // The ticks form of the same absence, same window, same summary.
  const ticksForm = catchUp(windowJourney, 4, {
    fromTick: 106,
    absenceTicks: SUMMARY_ABSENCE_TICKS + 1,
  });
  assert.equal(ticksForm.mode, 'path-summary');
  assert.deepEqual(ticksForm.summarySteps.map((s) => s.index), [3, 4]);
});

test('catchUp: the REC-3 object form is equivalent to the positional form', () => {
  assert.deepEqual(
    catchUp(windowJourney, { missedTicks: 4, fromTick: 106, absenceSeconds: 3630 }),
    catchUp(windowJourney, 4, { fromTick: 106, absenceTicks: 121 }),
  );
  assert.deepEqual(
    catchUp(windowJourney, { missedTicks: 6 }),
    catchUp(windowJourney, 6),
  );
  // Agreeing dual absence forms are accepted and echo both units.
  const both = catchUp(windowJourney, 4, { absenceTicks: 10, absenceSeconds: 300 });
  assert.equal(both.absenceTicks, 10);
  assert.equal(both.absenceSeconds, 300);
});

test('catchUp: signature misuse fails loudly (mixed forms, unit disagreement, bad fromTick)', () => {
  assert.throws(() => catchUp(windowJourney, { missedTicks: 1 }, {}), TypeError);
  assert.throws(() => catchUp(windowJourney, {}), TypeError);
  assert.throws(
    () => catchUp(windowJourney, 4, { absenceTicks: 10, absenceSeconds: 999 }),
    TypeError,
  );
  assert.throws(() => catchUp(windowJourney, 4, { absenceSeconds: -5 }), TypeError);
  assert.throws(() => catchUp(windowJourney, 4, { absenceSeconds: NaN }), TypeError);
  assert.throws(() => catchUp(windowJourney, 4, { fromTick: NaN }), TypeError);
  assert.throws(() => catchUp(windowJourney, 4, { fromTick: Infinity }), TypeError);
});
