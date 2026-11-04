// conflicts.test.mjs — M3.04 / SE-2.5: the §3.5 stuck-actor table as
// owned tests. The §7.4 adversarial set (interrupted journey, vanish,
// same-tick conflict) lives here and in the app placement tests; the
// gate is zero unscheduled position changes in the sampled stream.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createPlacementTracker,
  applyPlacement,
  trackerCitizen,
  tickIndexOf,
  watchdogDeadline,
  assessJourney,
  assessedPosition,
  ON_THE_WAY_CAPTION,
  CONFLICT_DISCLOSURE,
  EXIT_DISCLOSURE,
  ENTRY_DISCLOSURE,
  WATCHDOG_GRACE_TICKS,
} from '../conflicts.mjs';
import { planJourney, positionAt } from '../playback.mjs';

const layout = JSON.parse(
  readFileSync(new URL('../../shared/ember-layout.json', import.meta.url), 'utf8'),
);

// Evidence stamps: T0 and T0+10s share one 30 s tick window; T1 is a
// full minute later — a different window by two ticks.
const T0 = '2026-11-02T12:00:00.000Z';
const T0b = '2026-11-02T12:00:10.000Z';
const T1 = '2026-11-02T12:01:00.000Z';
const T2 = '2026-11-02T12:02:00.000Z';

const obs = (key, placeCode, evidenceUtc, bundleSeq) => ({ key, placeCode, evidenceUtc, bundleSeq });

// ------------------------------------------------------------ tick windows

test('tickIndexOf: one 30 s window per tick; the same window for stamps inside it', () => {
  assert.equal(tickIndexOf(T0), tickIndexOf(T0b));
  assert.notEqual(tickIndexOf(T0), tickIndexOf(T1));
  assert.equal(tickIndexOf(null), null);
  assert.equal(tickIndexOf('not a date'), null);
});

// ------------------------------------------------------------ tracker basics

test('tracker: first observation initialises silently — Portal starting to watch is not an entry', () => {
  const tr = createPlacementTracker();
  assert.deepEqual(applyPlacement(tr, obs('k1', 'EMBER_COLLEGE', T0, 1)), []);
  const c = trackerCitizen(tr, 'k1');
  assert.equal(c.presence, 'placed');
  assert.equal(c.shown.placeCode, 'EMBER_COLLEGE');
  assert.equal(c.conflict, null);
});

test('tracker: a later-window place change is a move; duplicates and stale claims are silent', () => {
  const tr = createPlacementTracker();
  applyPlacement(tr, obs('k1', 'EMBER_COLLEGE', T0, 1));
  assert.deepEqual(applyPlacement(tr, obs('k1', 'EMBER_COLLEGE', T1, 2)), []); // same place, later window
  const ev = applyPlacement(tr, obs('k1', 'MARKET_HALL', T2, 3));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'move');
  assert.equal(ev[0].fromPlace, 'EMBER_COLLEGE');
  assert.equal(ev[0].placeCode, 'MARKET_HALL');
  // A claim from an older window arriving late changes nothing.
  assert.deepEqual(applyPlacement(tr, obs('k1', 'EMBER_COLLEGE', T0, 4)), []);
  assert.equal(trackerCitizen(tr, 'k1').shown.placeCode, 'MARKET_HALL');
});

// ------------------------------------------------------------ the HOLD

test('HOLD: two places in one tick window set place-conflict; the figure stays at the last unconflicted place', () => {
  const tr = createPlacementTracker();
  applyPlacement(tr, obs('k1', 'EMBER_COLLEGE', '2026-11-02T11:00:00.000Z', 1)); // unconflicted, earlier
  applyPlacement(tr, obs('k1', 'MARKET_HALL', T0, 2)); // a move in a new window
  const ev = applyPlacement(tr, obs('k1', 'LIBRARY_ANNEX', T0b, 3)); // same window, other place
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'place-conflict');
  assert.equal(ev[0].hold, true);
  assert.equal(ev[0].staging, false);
  assert.equal(ev[0].disclosure, CONFLICT_DISCLOSURE);
  // Both claims are surfaced, with their evidence stamps.
  assert.deepEqual(ev[0].claims.map((cl) => cl.placeCode), ['MARKET_HALL', 'LIBRARY_ANNEX']);
  assert.deepEqual(ev[0].claims.map((cl) => cl.evidenceUtc), [T0, T0b]);
  // The figure did NOT walk to either claimed place: it is held at
  // the last place the record agreed on (the College).
  const c = trackerCitizen(tr, 'k1');
  assert.equal(c.shown.placeCode, 'EMBER_COLLEGE');
  assert.equal(ev[0].heldPlace, 'EMBER_COLLEGE');
  assert.equal(c.conflict.claims.length, 2);
});

test('HOLD: a third place in the same window widens the conflict; the record going quiet does not lift it', () => {
  const tr = createPlacementTracker();
  applyPlacement(tr, obs('k1', 'EMBER_COLLEGE', T0, 1));
  applyPlacement(tr, obs('k1', 'MARKET_HALL', T0b, 2)); // conflict (window opened at College)
  const ev = applyPlacement(tr, obs('k1', 'LIBRARY_ANNEX', '2026-11-02T12:00:20.000Z', 3));
  assert.equal(ev[0].type, 'conflict-widened');
  assert.equal(trackerCitizen(tr, 'k1').conflict.claims.length, 3);
  assert.deepEqual(applyPlacement(tr, obs('k1', null, '2026-11-02T12:00:25.000Z', 4)), []);
  assert.ok(trackerCitizen(tr, 'k1').conflict); // still held
});

test('HOLD lifts only on an unconflicted later place — and walking resumes to it', () => {
  const tr = createPlacementTracker();
  applyPlacement(tr, obs('k1', 'EMBER_COLLEGE', '2026-11-02T11:00:00.000Z', 1));
  applyPlacement(tr, obs('k1', 'MARKET_HALL', T0, 2));
  applyPlacement(tr, obs('k1', 'LIBRARY_ANNEX', T0b, 3)); // conflict
  const ev = applyPlacement(tr, obs('k1', 'LIBRARY_ANNEX', T1, 4)); // later window, one place
  assert.deepEqual(ev.map((e) => e.type), ['conflict-resolved', 'move']);
  assert.equal(ev[0].resolvedPlace, 'LIBRARY_ANNEX');
  const c = trackerCitizen(tr, 'k1');
  assert.equal(c.conflict, null);
  assert.equal(c.shown.placeCode, 'LIBRARY_ANNEX'); // walking resumed
});

test('HOLD: a conflict in the very first window leaves the figure unplaced, not placed at a guess', () => {
  const tr = createPlacementTracker();
  applyPlacement(tr, obs('k1', 'EMBER_COLLEGE', T0, 1));
  applyPlacement(tr, obs('k1', 'MARKET_HALL', T0b, 2)); // same window → conflict
  const c = trackerCitizen(tr, 'k1');
  assert.equal(c.shown, null); // no unconflicted place exists yet
  assert.equal(c.presence, 'absent');
});

// ------------------------------------------------------------ vanish / reappear

test('exit/entry: place → unknown fires a staging-flagged exit; unknown → place an entry; steady state is silent', () => {
  const tr = createPlacementTracker();
  applyPlacement(tr, obs('k1', 'EMBER_COLLEGE', T0, 1));
  const exit = applyPlacement(tr, obs('k1', null, T1, 2));
  assert.equal(exit.length, 1);
  assert.equal(exit[0].type, 'exit');
  assert.equal(exit[0].staging, true); // §7.3: the FLAG is asserted, not just the path
  assert.equal(exit[0].disclosure, EXIT_DISCLOSURE);
  assert.equal(exit[0].fromPlace, 'EMBER_COLLEGE');
  assert.deepEqual(applyPlacement(tr, obs('k1', null, T2, 3)), []); // still absent: silent
  const entry = applyPlacement(tr, obs('k1', 'MARKET_HALL', '2026-11-02T12:03:00.000Z', 4));
  assert.equal(entry.length, 1);
  assert.equal(entry[0].type, 'entry');
  assert.equal(entry[0].staging, true);
  assert.equal(entry[0].disclosure, ENTRY_DISCLOSURE);
  assert.equal(entry[0].placeCode, 'MARKET_HALL');
  assert.deepEqual(applyPlacement(tr, obs('k1', 'MARKET_HALL', '2026-11-02T12:04:00.000Z', 5)), []);
});

// ------------------------------------------------------------ the adversarial stream

test('adversarial stream: shown place changes ONLY on scheduled events (zero unscheduled position changes)', () => {
  const tr = createPlacementTracker();
  const script = [
    obs('k1', 'EMBER_COLLEGE', '2026-11-02T11:00:00.000Z', 1), // initialise
    obs('k1', 'MARKET_HALL', T0, 2), // move
    obs('k1', 'LIBRARY_ANNEX', T0b, 3), // same tick → HOLD (shown reverts to College)
    obs('k1', 'MARKET_HALL', '2026-11-02T12:00:20.000Z', 4), // same window, a claimed place again: silent
    obs('k1', 'LIBRARY_ANNEX', T1, 5), // later single place → resolved + move
    obs('k1', null, T2, 6), // exit
    obs('k1', 'EMBER_COLLEGE', '2026-11-02T12:03:00.000Z', 7), // entry
  ];
  const scheduled = new Set(['move', 'entry', 'conflict-resolved']);
  // The first observation is the baseline (Portal starting to watch
  // is not an event — asserted silent by the tracker tests); the
  // invariant governs every change AFTER it.
  assert.deepEqual(applyPlacement(tr, script[0]), []);
  let prevShown = trackerCitizen(tr, 'k1').shown?.placeCode ?? null;
  for (const o of script.slice(1)) {
    const events = applyPlacement(tr, o);
    const now = trackerCitizen(tr, 'k1');
    const nowShown = now.presence === 'placed' ? now.shown?.placeCode ?? null : null;
    if (nowShown !== prevShown) {
      assert.ok(
        events.some((e) => scheduled.has(e.type) || e.type === 'place-conflict' || e.type === 'exit'),
        `shown changed ${prevShown} → ${nowShown} with no scheduled event (events: ${events.map((e) => e.type)})`,
      );
    }
    prevShown = nowShown;
  }
  assert.equal(prevShown, 'EMBER_COLLEGE');
});

// ------------------------------------------------------------ watchdog

const journey = planJourney({
  handle: 'k1',
  path: ['LIBRARY_ANNEX', 'EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE'],
  startTick: 100,
  ticksPerStep: 6,
}); // interval 12 ticks; deadline = 100 + 24 + 6 = 130

test('watchdog: deadline is start + 2× interval + 6 ticks (§3.5)', () => {
  assert.equal(WATCHDOG_GRACE_TICKS, 6);
  assert.equal(watchdogDeadline(journey), 130);
});

test('watchdog: en route before the deadline; arrival evidence completes at any tick', () => {
  assert.equal(assessJourney(journey, layout, { nowTick: 130 }).state, 'en-route');
  const done = assessJourney(journey, layout, { nowTick: 500, arrivalTick: 112 });
  assert.equal(done.state, 'complete');
  assert.deepEqual(
    assessedPosition(journey, layout, done),
    positionAt(journey, layout, journey.endTick),
  );
});

test('watchdog: past the deadline with no newer word — paused, with §3.5\u2019s caption verbatim', () => {
  const a = assessJourney(journey, layout, { nowTick: 131, perfTick: 106 });
  assert.equal(a.state, 'paused');
  assert.equal(a.caption, 'on the way to EMBER_COLLEGE — Portal has no newer word');
  assert.equal(ON_THE_WAY_CAPTION('the College'), 'on the way to the College — Portal has no newer word');
  assert.equal(a.frozenTick, 106);
});

test('watchdog: a paused figure\u2019s position is frozen — identical at any later nowTick (never a snap)', () => {
  const p1 = assessedPosition(journey, layout, assessJourney(journey, layout, { nowTick: 131, perfTick: 106 }), 106);
  const p2 = assessedPosition(journey, layout, assessJourney(journey, layout, { nowTick: 900, perfTick: 106 }), 106);
  assert.deepEqual(p1, p2);
  assert.deepEqual(p1, positionAt(journey, layout, 106)); // exactly where the performance froze
});

test('watchdog: origin evidence after a short absence — a shown return WALK from the next node home', () => {
  // The figure had performed to tick 103 — mid-leg Annex → Plaza —
  // when word comes at tick 120 that the citizen is back at the
  // Annex. A contradicted performance cancels at its NEXT node
  // (Paper 02 §2.3), so the return walk starts at the Plaza.
  // Assessed at tick 122: the absence is 2 ticks, so §3.4 walks it.
  const a = assessJourney(journey, layout, { nowTick: 122, perfTick: 103, originTick: 120 });
  assert.equal(a.state, 'return-walk');
  assert.equal(a.fromCode, 'EMBER_PLAZA_OF_UNITY');
  assert.deepEqual(a.returnJourney.path, ['EMBER_PLAZA_OF_UNITY', 'LIBRARY_ANNEX']);
  assert.equal(a.plan.mode, 'catch-up'); // short absence: the return is walked, per §3.4
  assert.ok(a.plan.steps.length >= 1);
});

test('watchdog: origin evidence, figure already home — returned, nothing staged', () => {
  const atOrigin = planJourney({ handle: 'k2', path: ['EMBER_COLLEGE', 'MARKET_HALL'], startTick: 200, ticksPerStep: 4 });
  const b = assessJourney(atOrigin, layout, { nowTick: 210, perfTick: 200, originTick: 205 });
  assert.equal(b.state, 'returned');
  assert.equal(assessedPosition(atOrigin, layout, b).code, 'EMBER_COLLEGE');
});

test('watchdog: origin evidence after an absence over an hour — the return is a path SUMMARY, never a walk or a snap', () => {
  // Origin evidence at tick 120; the page returns at tick 120 + 121
  // (absence over the 120-tick hour, §3.4's summary axis). The
  // performance had reached the College (the journey's scheduled end)
  // without any arrival evidence ever confirming it.
  const a = assessJourney(journey, layout, { nowTick: 241, perfTick: 118, originTick: 120 });
  assert.equal(a.state, 'return-summary');
  assert.equal(a.plan.mode, 'path-summary');
  assert.deepEqual(a.plan.steps, []); // listed, not played
  assert.ok(a.plan.summarySteps.length >= 1);
  // The figure stands at its evidenced place — the origin — and the
  // position does not depend on when during the absence we ask.
  const pos = assessedPosition(journey, layout, a, 241);
  assert.equal(pos.code, 'LIBRARY_ANNEX');
});
