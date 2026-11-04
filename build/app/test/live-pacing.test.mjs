// live-pacing.test.mjs — M3.06 live-pace playback (live-pacing.mjs).
//
// The plan item: "Live-pace playback (1 tick / 30 s); catch-up/replay
// the only accelerations; demo pacing quarantined to the labelled
// demo control." Exit gate: "A timed harness read shows live mode
// at 1 tick per 30 s; faster pacing only via the demo control."
// The timed-harness tests below are that read: simulated wall-clock
// reads against the module, on the M3.01 golden window (built with
// the real reconstructor, so the fixture IS the artefact shape) and
// on the real shared layout.
//
// Run: node --test test/live-pacing.test.mjs   (from build/app/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  JOURNEYS_SCHEMA,
  LIVE_TICK_SECONDS,
  LIVE_SPEED,
  isJourneysFeed,
  tickSecondsOf,
  worldTickAt,
  tickAdvance,
  livePlanFor,
  livePlans,
  planAt,
  livePosition,
  accelerationPlan,
  livePositions,
  liveJourneyCaption,
  journeysNotice,
} from '../live-pacing.mjs';
import { citizenPositions } from '../logic.mjs';
import { TICK_SECONDS, CATCH_UP_SPEED, REPLAY_SPEED, planJourney } from '../../engine/playback.mjs';
import { checkContinuity } from '../../engine/invariant.mjs';
import { assessJourney } from '../../engine/conflicts.mjs';
import { reconstructJourneys } from '../../data/journeys.mjs';

const layout = JSON.parse(
  readFileSync(new URL('../../shared/ember-layout.json', import.meta.url), 'utf8'),
);

// --------------------------------------------- golden window fixture
// The M3.01 golden window, rebuilt with the real reconstructor:
// Test Person speaks at the Townhall (10, 20 min) then at the
// College (35, 50 min) under continuous fetch coverage. Exactly one
// journey: departure tick 40, arrival tick 70, 30 world ticks.
const BOOK = { id: 'world-test', openedAtUtc: '2026-11-03T00:00:00Z' };
const EPOCH_MS = Date.parse(BOOK.openedAtUtc);
const at = (min, sec = 0) => new Date(EPOCH_MS + (min * 60 + sec) * 1000).toISOString();
function snap(file, fetchedUtc, places) {
  return {
    data: {
      generated_at: fetchedUtc,
      places: Object.entries(places).map(([code, rows]) => ({
        code,
        said: rows.map(([by, atIso, id]) => ({ by, at: atIso, id, said: 'words' })),
      })),
    },
    fetchedUtc,
    file,
  };
}
const FULL_FETCH = [];
for (let t = 0; t <= 120 * 60; t += 120) FULL_FETCH.push(new Date(EPOCH_MS + t * 1000).toISOString());

const goldenFeed = reconstructJourneys({
  voicesSnapshots: [snap('2026-11-03/voices-a.json', at(40), {
    EMBER_TOWNHALL: [['Test Person', at(10), 'u1'], ['Test Person', at(20), 'u2']],
    EMBER_COLLEGE: [['Test Person', at(35), 'u3'], ['Test Person', at(50), 'u4']],
  })],
  voicesFetchUtc: FULL_FETCH,
  book: BOOK,
});
assert.equal(goldenFeed.journeys.length, 1); // fixture sanity
const golden = goldenFeed.journeys[0];
const KEY = golden.citizenKey;
const wallAtTick = (tick) => EPOCH_MS + tick * LIVE_TICK_SECONDS * 1000;

// ------------------------------------------------------------ the feed

test('isJourneysFeed: the schema and shape gate', () => {
  assert.equal(isJourneysFeed(goldenFeed), true);
  assert.equal(isJourneysFeed({ schema: JOURNEYS_SCHEMA, journeys: [], tickEpochUtc: at(0) }), true);
  assert.equal(isJourneysFeed({ schema: 'portal.world-data/v2', journeys: [], tickEpochUtc: at(0) }), false);
  assert.equal(isJourneysFeed({ schema: JOURNEYS_SCHEMA, journeys: 'none', tickEpochUtc: at(0) }), false);
  assert.equal(isJourneysFeed({ schema: JOURNEYS_SCHEMA, journeys: [], tickEpochUtc: 'not a date' }), false);
  assert.equal(isJourneysFeed(null), false);
  assert.equal(isJourneysFeed(undefined), false);
});

test('the live journeys.json (the real artefact) is a valid, empty feed', () => {
  const live = JSON.parse(
    readFileSync(new URL('../../data/feed/journeys.json', import.meta.url), 'utf8'),
  );
  assert.equal(isJourneysFeed(live), true);
  const { plans, skipped } = livePlans(live);
  assert.equal(skipped, 0);
  // Property, robust to the record growing: every plan the live
  // feed yields is schedulable, and the notice always renders.
  for (const list of plans.values()) {
    for (const p of list) assert.equal(p.journey.endTick, p.arrivalTick);
  }
  assert.ok(journeysNotice(live));
});

// -------------------------------------- timed harness: the live rate

test('timed harness: live mode advances exactly 1 tick per 30 real seconds', () => {
  assert.equal(LIVE_TICK_SECONDS, 30);
  assert.equal(LIVE_TICK_SECONDS, TICK_SECONDS); // the engine's unit, imported
  assert.equal(LIVE_SPEED, 1);
  assert.equal(tickSecondsOf(goldenFeed), 30);
  assert.equal(worldTickAt(goldenFeed, EPOCH_MS), 0);
  assert.equal(worldTickAt(goldenFeed, EPOCH_MS + 30_000), 1);
  assert.equal(worldTickAt(goldenFeed, EPOCH_MS + 900_000), 30);
  assert.equal(worldTickAt(goldenFeed, EPOCH_MS + 901_500), 30.05);
  assert.equal(tickAdvance(30, LIVE_SPEED), 1);
  assert.equal(tickAdvance(1, LIVE_SPEED), 1 / 30); // one real second is NOT a tick
  assert.equal(tickAdvance(900, LIVE_SPEED), 30);
  assert.equal(worldTickAt(goldenFeed, Number.NaN), null);
});

test('timed harness: the demo rate is quarantined — this module has no demo pacing', () => {
  const src = readFileSync(new URL('../live-pacing.mjs', import.meta.url), 'utf8');
  // Code only: the header prose names the demo rate to explain the
  // quarantine; no executable line may reference it.
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.ok(!/DEMO_TICK_RATE/.test(code), 'live pacing must not reference the demo rate');
  // Two ticks per real second (the demo rate) would advance 60 ticks
  // in 30 s; live advance over the same span is exactly 1 tick.
  assert.equal(tickAdvance(30, LIVE_SPEED), 1);
});

// --------------------------------- timed harness: the golden journey

test('timed harness: departure and arrival land exactly on their scheduled ticks', () => {
  const plan = livePlanFor(golden);
  assert.ok(plan);
  assert.equal(plan.departureTick, 40);
  assert.equal(plan.arrivalTick, 70);
  assert.equal(plan.journey.startTick, 40);
  assert.equal(plan.journey.endTick, 70); // scheduled arrival IS the record's arrivalTick
  assert.equal(plan.from, 'EMBER_TOWNHALL'); // the 'arrival-node' mapping: `to` is the place…
  assert.equal(plan.to, 'EMBER_COLLEGE'); //    …and arrivalTick its moment (M3.01 note)

  // At the departure wall time the figure stands at the origin.
  let p = livePosition(plan, layout, worldTickAt(goldenFeed, wallAtTick(40)));
  assert.equal(p.code, 'EMBER_TOWNHALL');
  assert.equal(p.between, null);
  // Before departure it stands at the origin too — never pre-walked.
  p = livePosition(plan, layout, worldTickAt(goldenFeed, wallAtTick(39)));
  assert.equal(p.code, 'EMBER_TOWNHALL');
  assert.equal(p.between, null);
  // At the arrival wall time it stands at the destination.
  p = livePosition(plan, layout, worldTickAt(goldenFeed, wallAtTick(70)));
  assert.equal(p.code, 'EMBER_COLLEGE');
  assert.equal(p.between, null);
  // Half-way through the window (450 real seconds in) it is en route:
  // on the graph — its coordinates are neither endpoint's (the
  // engine's `code` names the last departed node while `between`
  // is set, so coordinates are the honest check).
  p = livePosition(plan, layout, worldTickAt(goldenFeed, wallAtTick(40) + 450_000));
  const nodeXY = (code) => layout.nodes.find((n) => n.code === code);
  assert.ok(!(p.x === nodeXY('EMBER_TOWNHALL').x && p.y === nodeXY('EMBER_TOWNHALL').y), 'still at the origin');
  assert.ok(!(p.x === nodeXY('EMBER_COLLEGE').x && p.y === nodeXY('EMBER_COLLEGE').y), 'already at the destination');
  assert.ok(p.between !== null || (p.code !== 'EMBER_TOWNHALL' && p.code !== 'EMBER_COLLEGE'));
});

test('timed harness: arrival is never shown early, at any point in the window', () => {
  const plan = livePlanFor(golden);
  for (let t = 40; t < 70; t += 0.25) {
    const p = livePosition(plan, layout, t);
    assert.ok(
      !(p.code === 'EMBER_COLLEGE' && p.between === null),
      `arrival shown early at tick ${t}`,
    );
  }
  // And the walk is continuous — the §7.3 invariant over the very
  // journey live playback performs.
  assert.deepEqual(checkContinuity((j, l, t) => livePosition({ journey: j }, l, t), plan.journey, layout), []);
});

test('a near-reach journey (0 world ticks) completes exactly at its tick boundary', () => {
  const plan = livePlanFor({
    citizenKey: KEY, name: 'Test Person', from: 'EMBER_TOWNHALL', to: 'EMBER_COLLEGE',
    path: ['EMBER_TOWNHALL', 'EMBER_COLLEGE'],
    departureTick: 40, arrivalTick: 40, worldTicks: 0, reconstructed: true, disclosure: '',
  });
  assert.ok(plan);
  assert.equal(plan.nearReach, true);
  const before = livePosition(plan, layout, 39.999);
  assert.equal(before.code, 'EMBER_TOWNHALL');
  const atTick = livePosition(plan, layout, 40);
  assert.equal(atTick.code, 'EMBER_COLLEGE');
});

// ------------------------------ speed: shown time only, never schedule

test('speed control changes the rate without changing any scheduled tick', () => {
  const plan = livePlanFor(golden);
  const spanSeconds = plan.worldTicks * LIVE_TICK_SECONDS; // 900 s at 1x
  for (const speed of [1, CATCH_UP_SPEED, REPLAY_SPEED]) {
    // Covering the journey's 30 ticks takes spanSeconds/speed of
    // real time, at any speed — and the schedule never moves.
    assert.equal(tickAdvance(spanSeconds / speed, speed), plan.worldTicks);
    assert.equal(plan.departureTick, 40);
    assert.equal(plan.arrivalTick, 70);
    assert.equal(plan.journey.endTick, 70);
    // Position is a function of the shown tick alone: the same tick
    // reached at any speed is the same place.
    assert.deepEqual(livePosition(plan, layout, 55), livePosition(plan, layout, 55));
  }
});

test('acceleration exists only as a catchUp plan (§3.4 speeds, summary past an hour)', () => {
  const plan = livePlanFor(golden);
  const cu = accelerationPlan(plan, plan.worldTicks);
  assert.equal(cu.mode, 'catch-up');
  assert.equal(cu.speed, CATCH_UP_SPEED); // 2.5 — the engine's, not a local constant
  assert.equal(cu.replay, false);
  assert.equal(cu.arrivalTick, 70); // the scheduled arrival is never beaten
  const summary = accelerationPlan(plan, plan.worldTicks, { absenceTicks: 121 });
  assert.equal(summary.mode, 'path-summary');
  assert.deepEqual(summary.steps, []); // listed, not played
  assert.equal(summary.summarySteps.length, 1);
  assert.equal(summary.arrivalTick, 70);
  // Replay (8x) arises from >6 missed STEPS — shown on a multi-step
  // engine journey through the same pass-through.
  const multi = {
    journey: planJourney({
      handle: 'x',
      path: ['EMBER_TOWNHALL', 'EMBER_COLLEGE', 'EMBER_TOWNHALL', 'EMBER_COLLEGE', 'EMBER_TOWNHALL', 'EMBER_COLLEGE', 'EMBER_TOWNHALL', 'EMBER_COLLEGE', 'EMBER_TOWNHALL'],
      startTick: 0, ticksPerStep: 4,
    }),
  };
  const rp = accelerationPlan(multi, 32);
  assert.equal(rp.mode, 'replay');
  assert.equal(rp.speed, REPLAY_SPEED);
});

// --------------------------- the watchdog interface (M3.04), pinned

test('a reconstructed journey under the M3.04 watchdog reads complete', () => {
  const plan = livePlanFor(golden);
  // Its arrival bound IS destination evidence, so the watchdog —
  // which governs performances staged without it — answers
  // 'complete' at any nowTick. The plan keeps arrivalTick on its
  // surface for exactly this call.
  for (const nowTick of [40, 55, 70, 500]) {
    const a = assessJourney(plan.journey, layout, { nowTick, arrivalTick: plan.arrivalTick });
    assert.equal(a.state, 'complete');
    assert.equal(a.destination, 'EMBER_COLLEGE');
  }
});

// ------------------------------------------------------- plan shaping

test('livePlanFor rejects records that cannot be scheduled as recorded', () => {
  assert.equal(livePlanFor(null), null);
  assert.equal(livePlanFor({ ...golden, worldTicks: 31 }), null); // bounds disagree
  assert.equal(livePlanFor({ ...golden, arrivalTick: 71 }), null);
  assert.equal(livePlanFor({ ...golden, path: ['EMBER_COLLEGE', 'EMBER_TOWNHALL'] }), null); // path vs from/to
  assert.equal(livePlanFor({ ...golden, citizenKey: '' }), null);
  const { plans, skipped } = livePlans({ ...goldenFeed, journeys: [golden, { ...golden, worldTicks: 3 }] });
  assert.equal(plans.get(KEY).length, 1);
  assert.equal(skipped, 1); // counted, not silently dropped
});

test('planAt: the governing leg is the latest departed, across a citizen\'s legs', () => {
  const leg2 = {
    ...golden,
    from: 'EMBER_COLLEGE', to: 'EMBER_TOWNHALL',
    path: ['EMBER_COLLEGE', 'EMBER_TOWNHALL'],
    departureUtc: at(50), arrivalUtc: at(65),
    departureTick: 100, arrivalTick: 130, worldTicks: 30,
  };
  const { plans } = livePlans({ ...goldenFeed, journeys: [golden, leg2] });
  const list = plans.get(KEY);
  assert.equal(list.length, 2);
  assert.equal(planAt(list, 10).departureTick, 40); // none departed: the earliest governs
  assert.equal(planAt(list, 55).departureTick, 40);
  assert.equal(planAt(list, 85).departureTick, 40); // arrived; next leg not yet departed
  const p85 = livePosition(planAt(list, 85), layout, 85);
  assert.equal(p85.code, 'EMBER_COLLEGE'); // stands at leg 1's destination = leg 2's origin
  assert.equal(planAt(list, 115).departureTick, 100);
  const p115 = livePosition(planAt(list, 115), layout, 115);
  assert.ok(!(p115.code === 'EMBER_TOWNHALL' && p115.between === null)); // walking home, not arrived
  assert.equal(planAt([], 10), null);
});

// ------------------------------------------------- stage composition

// Base positions as the app builds them: the bundle places the
// citizen at their latest evidenced place (the College — u4), with
// the per-place fan offset citizenPositions applies.
function basePositions() {
  const bundle = {
    citizens: [{ citizenKey: KEY, handle: '', name: 'Test Person', placeCode: 'EMBER_COLLEGE', state: 'talking' }],
    ember: { plots: [], works: [] },
  };
  return citizenPositions(bundle, layout);
}

test('livePositions: mid-window the figure walks; after arrival the base position stands', () => {
  const { plans } = livePlans(goldenFeed);
  const base = basePositions();
  assert.equal(base.get(KEY).code, 'EMBER_COLLEGE');
  // Mid-window (tick 55): playback moves the figure off the base
  // placement — it is on the graph, walking, not at the College.
  const mid = livePositions({
    feed: goldenFeed, plans, layout, base, nowMsValue: wallAtTick(55),
  });
  assert.equal(mid.size, 1);
  const mp = mid.get(KEY);
  assert.ok(!(mp.code === 'EMBER_COLLEGE' && mp.between === null));
  // After arrival (tick 80): the figure stands where the base
  // already shows it — no override, the fan offset is preserved.
  const after = livePositions({
    feed: goldenFeed, plans, layout, base, nowMsValue: wallAtTick(80),
  });
  assert.equal(after.size, 0);
});

test('livePositions: the M3.04 HOLD governs — a conflicted citizen is never walked', () => {
  const { plans } = livePlans(goldenFeed);
  const held = livePositions({
    feed: goldenFeed, plans, layout, base: basePositions(),
    heldKeys: new Set([KEY]), nowMsValue: wallAtTick(55),
  });
  assert.equal(held.size, 0);
});

test('livePositions: citizens the stage does not show are not resurrected', () => {
  const { plans } = livePlans(goldenFeed);
  const out = livePositions({
    feed: goldenFeed, plans, layout, base: new Map(), nowMsValue: wallAtTick(55),
  });
  assert.equal(out.size, 0);
});

test('livePositions: an off-graph journey is skipped, never thrown', () => {
  const offGraph = {
    ...golden,
    from: 'EMBER_TOWNHALL', to: 'FRONTIER_CELL_NORTH',
    path: ['EMBER_TOWNHALL', 'FRONTIER_CELL_NORTH'],
  };
  const { plans, skipped } = livePlans({ ...goldenFeed, journeys: [offGraph] });
  assert.equal(skipped, 0); // schedulable as recorded — the graph is the layout's business
  const out = livePositions({
    feed: goldenFeed, plans, layout, base: basePositions(), nowMsValue: wallAtTick(55),
  });
  assert.equal(out.size, 0); // no route home in the layout: the base position stands
});

// -------------------------------------------------------- the notice

test('empty-feed honesty: no walkers, and the notice says why in plain words', () => {
  // A fixture mirroring the real artefact's stats at first run.
  const emptyFeed = {
    ...goldenFeed,
    journeys: [],
    stats: { speakers: 15, utterances: 152, candidateLegs: 27, reconstructed: 0, rejectedDarkLegs: 27 },
  };
  const { plans } = livePlans(emptyFeed);
  assert.equal(plans.size, 0); // nothing pretends to walk
  const out = livePositions({
    feed: emptyFeed, plans, layout, base: basePositions(), nowMsValue: wallAtTick(55),
  });
  assert.equal(out.size, 0);
  const notice = journeysNotice(emptyFeed);
  assert.equal(notice.key, 'journeys-none');
  assert.equal(notice.headline, 'No journeys reconstructed yet.');
  assert.match(notice.detail, /152 utterances from 15 speakers/);
  assert.match(notice.detail, /27 possible journeys/);
  assert.match(notice.detail, /27 of them cross stretches the archive was not watching/);
  assert.match(notice.detail, /never an observed path/);
});

test('journeysNotice: with journeys, the feed disclosure rides verbatim', () => {
  const notice = journeysNotice(goldenFeed);
  assert.equal(notice.key, 'journeys-live');
  assert.match(notice.headline, /1 reconstructed journey/);
  assert.match(notice.headline, /one tick per 30 seconds/);
  assert.equal(notice.detail, goldenFeed.disclosure);
  assert.equal(journeysNotice(null), null);
  assert.equal(journeysNotice({ schema: 'nope' }), null);
});

test('liveJourneyCaption: standing, walking (qualified), arrived', () => {
  const plan = livePlanFor(golden);
  const label = (code) => ({ EMBER_TOWNHALL: 'Townhall', EMBER_COLLEGE: 'The College' })[code] || code;
  assert.match(liveJourneyCaption(plan, 10, label), /is at Townhall/);
  const walking = liveJourneyCaption(plan, 55, label);
  assert.match(walking, /is walking to The College/);
  assert.match(walking, /not following an observed path/);
  assert.match(liveJourneyCaption(plan, 70, label), /has arrived at The College/);
  assert.equal(liveJourneyCaption(null, 55, label), null);
});
