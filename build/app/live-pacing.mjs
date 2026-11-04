// live-pacing.mjs — live-pace playback of reconstructed journeys
// (M3.06; Plan B §3.4; plan-to-complete M3.06).
//
// THE PACING LAW (M3.06, verbatim shape): "Live-pace playback
// (1 tick / 30 s); catch-up/replay the only accelerations; demo
// pacing quarantined to the labelled demo control." This module is
// the live side of that law:
//
//  - LIVE RATE. One world tick per 30 real seconds at 1×. The rate
//    is the engine's own TICK_SECONDS (playback.mjs) — imported,
//    never re-typed — so live pace cannot drift from the engine's
//    time unit. The demo's DEMO_TICK_RATE (2 ticks/second, in
//    app.js) is a DEMO rate for the labelled recording control; it
//    appears nowhere here and drives nothing live.
//
//  - THE WORLD CLOCK. A reconstructed journey (data/journeys.mjs,
//    artefact feed/journeys.json, schema portal.journeys/v1) is
//    scheduled in absolute ticks on the artefact's own grid
//    (tickEpochUtc = the world-book's opened_at; tickSeconds
//    disclosed in the artefact). Live playback keeps no lag state:
//    the stage's shown tick IS the world tick,
//    worldTickAt(feed, now) = (now - epoch) / tickSeconds, and a
//    figure's position is the engine's positionAt at that tick —
//    a continuous function of world time. A citizen with a journey
//    therefore never jumps when a new bundle lands: between their
//    evidenced places they are on the graph, walking, at the
//    world's own pace.
//
//  - ACCELERATION. The only accelerations are the engine's §3.4
//    plans, via accelerationPlan() (a named pass-through to
//    catchUp): catch-up at 2.5×, replay at 8×, and past an hour's
//    absence a path summary that is listed, not played. There is
//    no speed multiplier anywhere in this module: a speed changes
//    how fast shown time advances, never a journey's scheduled
//    ticks — departureTick / arrivalTick are the record's, and
//    positionAt never shows an arrival before arrivalTick.
//
//  - ARRIVAL, AS DOCUMENTED (M3.01's interface note, honoured not
//    renamed). M3.03's beats anchor at 'arrival-node' — a PLACE.
//    A plan here carries that place as `to` and its moment as
//    `arrivalTick` (the engine's own word). A beat anchored
//    'arrival-node' against one of these journeys is performed at
//    node `to`, reached at tick `arrivalTick`.
//
//  - THE WATCHDOG BOUNDARY (M3.04, engine/conflicts.mjs).
//    assessJourney governs performances staged from a departure
//    observation whose arrival is not yet evidenced (paused /
//    return states). A RECONSTRUCTED journey is complete by
//    construction — its arrival bound IS the first destination
//    evidence — so the watchdog's answer for it is always
//    'complete' (pinned in the tests). If a future surface stages
//    performances from departure evidence alone, it must run them
//    under assessJourney; this module's plans keep arrivalTick on
//    the surface for exactly that call.
//
//  - COMPOSITION WITH THE HOLD (M3.04). livePositions() takes the
//    caller's heldKeys — citizens under a standing place-conflict
//    — and never walks them: a conflict is data, and movement
//    between contradictory claims is the one thing Portal does
//    not stage. It also only re-places citizens the stage already
//    shows (the base map): a citizen the record stopped placing
//    is not resurrected by a journey.
//
// Pure ESM, no DOM, no dependencies beyond the engine. All clock
// readings arrive as arguments (the app passes logic.nowMs(), the
// explicit clock, M3.09); this module reads no wall clock itself.

import {
  planJourney,
  positionAt,
  catchUp,
  TICK_SECONDS,
} from '../engine/playback.mjs';

export const JOURNEYS_SCHEMA = 'portal.journeys/v1';

/** The live rate: one world tick per this many real seconds at 1×.
 *  The engine's TICK_SECONDS, imported — the plan's "1 tick / 30 s". */
export const LIVE_TICK_SECONDS = TICK_SECONDS;

/** Live speed: 1×. Acceleration exists only as catchUp plans. */
export const LIVE_SPEED = 1;

/** A journeys artefact counts only under its own schema, with a
 *  parseable tick epoch and a journeys array — anything else is
 *  not a journeys feed to this app (the episodes discipline). */
export function isJourneysFeed(data) {
  return (
    !!data &&
    typeof data === 'object' &&
    data.schema === JOURNEYS_SCHEMA &&
    Array.isArray(data.journeys) &&
    Number.isFinite(Date.parse(data.tickEpochUtc))
  );
}

/** The artefact's disclosed tick length, governing its own grid;
 *  the engine constant when the field is absent or unusable. */
export function tickSecondsOf(feed) {
  const t = feed?.tickSeconds;
  return Number.isFinite(t) && t > 0 ? t : LIVE_TICK_SECONDS;
}

/** The artefact's tick epoch in ms, or null when unusable. */
export function journeysEpochMs(feed) {
  const ms = Date.parse(feed?.tickEpochUtc);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * worldTickAt(feed, nowMsValue) -> float world tick at `nowMsValue`
 * on the artefact's grid, at the live rate (1 tick per tickSeconds
 * of real time). Fractional: frames interpolate inside a tick's
 * step exactly as the engine's positionAt defines. Null when the
 * feed's epoch is unusable.
 */
export function worldTickAt(feed, nowMsValue) {
  const epochMs = journeysEpochMs(feed);
  if (epochMs === null || !Number.isFinite(nowMsValue)) return null;
  return (nowMsValue - epochMs) / (tickSecondsOf(feed) * 1000);
}

/**
 * tickAdvance(elapsedRealSeconds, speed, tickSeconds) -> how many
 * ticks of shown time elapse over `elapsedRealSeconds` of real time
 * at `speed`. At LIVE_SPEED this is elapsed / 30 — the timed-harness
 * quantity. `speed` here is only ever 1 or a catchUp plan's speed
 * (2.5 / 8): it scales shown time, never scheduled ticks.
 */
export function tickAdvance(elapsedRealSeconds, speed = LIVE_SPEED, tickSeconds = LIVE_TICK_SECONDS) {
  if (!Number.isFinite(elapsedRealSeconds) || !Number.isFinite(speed)) {
    throw new TypeError('tickAdvance: elapsedRealSeconds and speed must be finite numbers');
  }
  return (elapsedRealSeconds / tickSeconds) * speed;
}

/**
 * livePlanFor(record) -> a live playback plan for one reconstructed
 * journey record, or null when the record cannot be scheduled as
 * recorded (bad shape, inconsistent bounds). The engine journey is
 * built exactly as the invariant suite builds it (M3.01/M3.05):
 * one step across the evidence window, startTick = departureTick,
 * ticksPerStep = worldTicks — so the scheduled arrival is the
 * record's arrivalTick by construction.
 *
 * plan = { citizenKey, name, from, to, path, departureTick,
 *          arrivalTick, worldTicks, nearReach, reconstructed,
 *          disclosure, journey }
 * `to` is the arrival NODE and `arrivalTick` its moment — the
 * M3.01/M3.03 documented mapping, consumed as documented.
 */
export function livePlanFor(record) {
  if (!record || typeof record !== 'object') return null;
  const {
    citizenKey, name, from, to, path,
    departureTick, arrivalTick, worldTicks,
  } = record;
  if (
    typeof citizenKey !== 'string' || citizenKey.length === 0 ||
    !Array.isArray(path) || path.length < 2 ||
    !path.every((c) => typeof c === 'string') ||
    path[0] !== from || path[path.length - 1] !== to ||
    !Number.isFinite(departureTick) || !Number.isFinite(arrivalTick) ||
    !Number.isFinite(worldTicks) || worldTicks < 0 ||
    arrivalTick - departureTick !== worldTicks
  ) {
    return null;
  }
  let journey;
  try {
    journey = planJourney({
      handle: citizenKey,
      path,
      startTick: departureTick,
      ticksPerStep: worldTicks,
    });
  } catch {
    return null;
  }
  return {
    citizenKey,
    name: typeof name === 'string' ? name : '',
    from,
    to,
    path: [...path],
    departureTick,
    arrivalTick,
    worldTicks,
    nearReach: worldTicks === 0,
    reconstructed: record.reconstructed === true,
    disclosure: typeof record.disclosure === 'string' ? record.disclosure : '',
    journey,
  };
}

/**
 * livePlans(feed) -> { plans, skipped }
 * plans: Map of PORTAL-KEY -> the citizen's live plans, in
 * departure order (a citizen may hold several legs over time).
 * skipped: records that could not be scheduled as recorded —
 * counted, never silently dropped or repaired.
 */
export function livePlans(feed) {
  const plans = new Map();
  let skipped = 0;
  if (!isJourneysFeed(feed)) return { plans, skipped };
  for (const record of feed.journeys) {
    const plan = livePlanFor(record);
    if (!plan) {
      skipped++;
      continue;
    }
    if (!plans.has(plan.citizenKey)) plans.set(plan.citizenKey, []);
    plans.get(plan.citizenKey).push(plan);
  }
  for (const list of plans.values()) {
    list.sort((a, b) => a.departureTick - b.departureTick);
  }
  return { plans, skipped };
}

/**
 * planAt(planList, tickFloat) -> the plan whose performance governs
 * `tickFloat`: the latest plan that has departed by then, or the
 * earliest when none has (its positionAt reads as the origin —
 * the figure stands at its first evidenced place until the record
 * moves it). Null for an empty list.
 */
export function planAt(planList, tickFloat) {
  if (!Array.isArray(planList) || planList.length === 0) return null;
  let chosen = planList[0];
  for (const plan of planList) {
    if (plan.departureTick <= tickFloat) chosen = plan;
    else break;
  }
  return chosen;
}

/** The engine position of a plan's figure at a world tick. May
 *  throw when a leg has no route in the layout (an off-graph
 *  place) — callers composing positions catch it (livePositions
 *  does); the throw is the engine refusing to invent a path. */
export function livePosition(plan, layout, tickFloat) {
  return positionAt(plan.journey, layout, tickFloat);
}

/**
 * accelerationPlan(plan, missedTicks, options?) -> the engine's
 * §3.4 plan for this journey's missed window: mode 'none' |
 * 'catch-up' (2.5×) | 'replay' (8×) | 'path-summary' (listed, not
 * played). This is the ONLY acceleration live playback has — a
 * named pass-through to catchUp so no other speed can creep in.
 */
export function accelerationPlan(plan, missedTicks, options) {
  return catchUp(plan.journey, missedTicks, options);
}

/**
 * livePositions({ feed, plans, layout, base, heldKeys, nowMsValue })
 * -> Map of PORTAL-KEY -> {x, y, between, code} OVERRIDES to lay
 * over the caller's base positions (the M3.04 held positions) for
 * this frame.
 *
 *  - Only citizens already in `base` are re-placed (see header).
 *  - Citizens in `heldKeys` (standing place-conflict) are never
 *    walked — the HOLD governs.
 *  - A figure standing exactly at the node its base position
 *    already shows keeps the base position, so the per-place fan
 *    offsets the base applied are preserved; the override speaks
 *    only when playback actually moves the figure (mid-walk, or
 *    at a different node than the base shows).
 *  - A journey whose leg has no route in the layout is skipped,
 *    not thrown: the figure keeps its base position.
 */
export function livePositions({ feed, plans, layout, base, heldKeys = new Set(), nowMsValue } = {}) {
  const overrides = new Map();
  if (!feed || !plans || !layout || !(base instanceof Map)) return overrides;
  const tick = worldTickAt(feed, nowMsValue);
  if (tick === null) return overrides;
  for (const [key, list] of plans) {
    if (heldKeys.has(key) || !base.has(key)) continue;
    const plan = planAt(list, tick);
    if (!plan) continue;
    let p;
    try {
      p = positionAt(plan.journey, layout, tick);
    } catch {
      continue; // off-graph leg: no honest walk exists; base stands
    }
    const basePos = base.get(key);
    if (p.between === null && basePos && basePos.code === p.code) continue;
    overrides.set(key, { x: p.x, y: p.y, between: p.between, code: p.code });
  }
  return overrides;
}

/**
 * liveJourneyCaption(plan, tickFloat, labelFor) -> a plain-words
 * line for a followed citizen's live journey, from the schedule
 * alone: standing at the origin before departure, walking (with
 * the reconstruction qualifier) inside the window, arrived at or
 * after arrivalTick. Null without a plan.
 */
export function liveJourneyCaption(plan, tickFloat, labelFor) {
  if (!plan) return null;
  const label = typeof labelFor === 'function' ? labelFor : (code) => code;
  if (tickFloat < plan.departureTick) {
    return `is at ${label(plan.from)} — the record next evidences them at ${label(plan.to)}.`;
  }
  if (tickFloat >= plan.arrivalTick) {
    return `has arrived at ${label(plan.to)} (a reconstructed journey, scheduled from the record).`;
  }
  return `is walking to ${label(plan.to)} — a reconstructed journey: Portal is scheduling the window between two pieces of evidence, not following an observed path.`;
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

/**
 * journeysNotice(feed) -> { key, headline, detail } | null
 *
 * The stage note for the journeys feed: what Portal has, and —
 * when the feed is empty — why, in plain words, from the feed's
 * own stats. Null when there is no usable feed (absence is
 * graceful, the episodes discipline: no feed, no note). With
 * journeys present, `detail` is the feed's disclosure verbatim —
 * the reconstruction honesty label rides with the feature.
 */
export function journeysNotice(feed) {
  if (!isJourneysFeed(feed)) return null;
  const n = feed.journeys.length;
  if (n > 0) {
    return {
      key: 'journeys-live',
      headline:
        `${n} reconstructed ${plural(n, 'journey', 'journeys')} in the public feeds Portal reads. ` +
        'Portal walks them at the world\'s own pace — one tick per 30 seconds — ' +
        'and labels them as reconstructions.',
      detail: typeof feed.disclosure === 'string' ? feed.disclosure : '',
    };
  }
  const s = feed.stats && typeof feed.stats === 'object' ? feed.stats : {};
  const parts = [
    'Portal draws a journey only when the public feeds Portal reads ' +
      'evidence one citizen speaking at two different places, with the ' +
      'archive watching the whole time in between.',
  ];
  if (
    Number.isFinite(s.utterances) && Number.isFinite(s.speakers) &&
    Number.isFinite(s.candidateLegs) && Number.isFinite(s.rejectedDarkLegs)
  ) {
    if (s.candidateLegs === 0) {
      parts.push(
        `The public feeds Portal reads so far hold ${s.utterances} ${plural(s.utterances, 'utterance', 'utterances')} ` +
          `from ${s.speakers} ${plural(s.speakers, 'speaker', 'speakers')}, and nobody has yet been ` +
          'evidenced speaking at two different places — so there is nothing to draw yet.',
      );
    } else {
      parts.push(
        `The public feeds Portal reads so far hold ${s.utterances} ${plural(s.utterances, 'utterance', 'utterances')} ` +
          `from ${s.speakers} ${plural(s.speakers, 'speaker', 'speakers')}, with ` +
          `${s.candidateLegs} possible ${plural(s.candidateLegs, 'journey', 'journeys')} — and ` +
          `${s.rejectedDarkLegs} of them cross stretches the archive was not watching, ` +
          'so drawing them would be a guess.',
      );
    }
  }
  parts.push(
    'Journeys will appear here as the public feeds Portal reads earn ' +
      'them, each labelled a reconstruction, never an observed path.',
  );
  return { key: 'journeys-none', headline: 'No journeys reconstructed yet.', detail: parts.join(' ') };
}
