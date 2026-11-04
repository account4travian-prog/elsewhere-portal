// playback.mjs — Portal's tick playback core (Plan B §3).
// Pure ESM, no DOM, no dependencies, browser + Node compatible.
//
// THE LAW (Plan B §3.4, §7.3): a figure's position is a continuous path on
// the layout route graph. State advances only on world-tick boundaries;
// frames interpolate inside a step. Catch-up compresses steps — it never
// skips or merges them, and it never arrives a figure before its scheduled
// arrival tick. The Office's 10-second lag JUMP is deliberately not here.

import { findRoute, nodeByCode } from './astar.mjs';

export const TICK_SECONDS = 30; // Elsewhere's world tick (Paper 01 §6)
export const CATCH_UP_MAX_STEPS = 6; // Plan B §3.4: 1–6 missed steps…
export const CATCH_UP_SPEED = 2.5; // …walk at ≤ 2.5×
export const REPLAY_SPEED = 8; // beyond → ordered replay at ≤ 8×
export const SUMMARY_ABSENCE_TICKS = 120; // absence > 1 h (120 ticks × 30 s) → path summary (§3.4)
export const MIN_SHOWN_SECONDS = 1; // disclosed minimum for 0-tick legs

const EPS = 1e-9;

/**
 * planJourney({handle, path, startTick, ticksPerStep}) -> journey
 *
 * path: ordered place codes (length ≥ 1). ticksPerStep: a non-negative
 * integer applied to every step, or an array of length path.length - 1.
 * A step with 0 ticks is a NEAR-REACH leg (Paper 01 §6.2: the world charges
 * it no time); it is scheduled at a single tick boundary and disclosed via
 * `worldTicks: 0`, `nearReach: true`, and a `shownSeconds` presentation
 * minimum — Portal never manufactures world time the server waived, nor
 * hides the presentation second it added (Plan B §3.4).
 *
 * journey = { handle, path, startTick, endTick, totalWorldTicks,
 *             steps: [{index, from, to, worldTicks, nearReach,
 *                      startTick, endTick, shownSeconds}] }
 * shownSeconds = the step's duration at 1× playback (worldTicks × 30,
 * or MIN_SHOWN_SECONDS for a near-reach leg).
 */
export function planJourney({ handle, path, startTick, ticksPerStep }) {
  if (typeof handle !== 'string' || handle.length === 0) {
    throw new TypeError('planJourney: handle must be a non-empty string');
  }
  if (!Array.isArray(path) || path.length === 0 || !path.every((c) => typeof c === 'string')) {
    throw new TypeError('planJourney: path must be a non-empty array of place codes');
  }
  if (!Number.isFinite(startTick)) {
    throw new TypeError('planJourney: startTick must be a finite number');
  }
  const perStep = Array.isArray(ticksPerStep)
    ? ticksPerStep
    : Array.from({ length: path.length - 1 }, () => ticksPerStep);
  if (
    perStep.length !== path.length - 1 ||
    !perStep.every((t) => Number.isInteger(t) && t >= 0)
  ) {
    throw new TypeError(
      'planJourney: ticksPerStep must be a non-negative integer or an array of them, one per step',
    );
  }

  const steps = [];
  let tick = startTick;
  for (let i = 0; i < perStep.length; i++) {
    const worldTicks = perStep[i];
    const nearReach = worldTicks === 0;
    steps.push({
      index: i,
      from: path[i],
      to: path[i + 1],
      worldTicks,
      nearReach,
      startTick: tick,
      endTick: tick + worldTicks,
      shownSeconds: nearReach ? MIN_SHOWN_SECONDS : worldTicks * TICK_SECONDS,
    });
    tick += worldTicks;
  }
  return {
    handle,
    path: [...path],
    startTick,
    endTick: tick,
    totalWorldTicks: tick - startTick,
    steps,
  };
}

// Per-(journey, layout) route cache: for each step, the A* route between its
// place codes. WeakMap keyed by journey keeps this pure from the outside.
const routeCache = new WeakMap();

function stepRoutes(journey, layout) {
  let perLayout = routeCache.get(journey);
  if (!perLayout) {
    perLayout = new WeakMap();
    routeCache.set(journey, perLayout);
  }
  let routes = perLayout.get(layout);
  if (!routes) {
    routes = journey.steps.map((step) => {
      const route = findRoute(layout, step.from, step.to);
      if (!route) {
        throw new Error(`playback: no route in layout from ${step.from} to ${step.to}`);
      }
      return route;
    });
    perLayout.set(layout, routes);
  }
  return routes;
}

/**
 * journeyRoute(journey, layout) -> the concatenated route legs for the whole
 * journey: [{a, b, seconds, distance, stepIndex}] in traversal order.
 * (For the App arm: drawing the walked path.)
 */
export function journeyRoute(journey, layout) {
  const routes = stepRoutes(journey, layout);
  const legs = [];
  routes.forEach((route, stepIndex) => {
    for (const leg of route.legs) legs.push({ ...leg, stepIndex });
  });
  return legs;
}

function nodePosition(layout, code) {
  const n = nodeByCode(layout, code);
  if (!n) throw new Error(`playback: unknown place code ${code}`);
  return { code, x: n.x, y: n.y, between: null, frac: 0 };
}

// Position inside one step at local tick-fraction f ∈ [0, 1].
// Time inside the step is distributed across the route's legs in proportion
// to each leg's presentation seconds, so the figure is always exactly on
// one leg (or exactly at a node) — never off the graph.
function positionInStep(layout, route, f) {
  if (route.legs.length === 0) {
    return nodePosition(layout, route.codes[0]);
  }
  const target = f * route.totalSeconds;
  let acc = 0;
  for (let i = 0; i < route.legs.length; i++) {
    const leg = route.legs[i];
    const legEnd = acc + leg.seconds;
    if (target < legEnd - EPS || i === route.legs.length - 1) {
      const legFrac = leg.seconds === 0 ? 0 : Math.min(1, Math.max(0, (target - acc) / leg.seconds));
      const a = nodeByCode(layout, leg.a);
      const b = nodeByCode(layout, leg.b);
      if (legFrac <= EPS) return nodePosition(layout, leg.a);
      if (legFrac >= 1 - EPS) return nodePosition(layout, leg.b);
      return {
        code: leg.a,
        x: a.x + (b.x - a.x) * legFrac,
        y: a.y + (b.y - a.y) * legFrac,
        between: [leg.a, leg.b],
        frac: legFrac,
      };
    }
    acc = legEnd;
  }
  /* c8 ignore next */
  return nodePosition(layout, route.codes[route.codes.length - 1]);
}

/**
 * positionAt(journey, layout, tickFloat)
 * -> {code, x, y, between: [a, b] | null, frac}
 *
 * `code` is the node the figure is at, or the node it most recently departed
 * while `between` names the leg it is walking. Before startTick the figure
 * is at path[0]; at/after endTick it is at the final place. A step's
 * destination is only ever reached at its scheduled endTick — a 0-tick
 * near-reach leg completes exactly at its tick boundary.
 */
export function positionAt(journey, layout, tickFloat) {
  if (!Number.isFinite(tickFloat)) {
    throw new TypeError('positionAt: tickFloat must be a finite number');
  }
  const first = journey.path[0];
  const last = journey.path[journey.path.length - 1];
  if (tickFloat >= journey.endTick) return nodePosition(layout, last);
  if (tickFloat < journey.startTick) return nodePosition(layout, first);
  // tickFloat === startTick falls through to the scan on purpose: a journey
  // whose first leg is a 0-tick near-reach leg completes that leg AT its
  // start tick, and the scan lands on the next step's `from` — the leg's
  // destination. A timed first step gives f = 0, i.e. the origin. Both are
  // the scheduled truth at that instant.

  const routes = stepRoutes(journey, layout);
  for (let i = 0; i < journey.steps.length; i++) {
    const step = journey.steps[i];
    if (tickFloat < step.endTick) {
      // Only a timed step can contain tickFloat strictly inside it.
      const f = step.worldTicks === 0 ? 1 : (tickFloat - step.startTick) / step.worldTicks;
      return positionInStep(layout, routes[i], f);
    }
    // Otherwise this step is complete at tickFloat. A 0-tick near-reach leg
    // (or a chain of them) completes exactly at its boundary: scanning on
    // lands on the next step's start (f = 0 ⇒ its `from`, which is the last
    // completed leg's `to`), or on the journey-end fallback below.
  }
  return nodePosition(layout, last);
}

/**
 * catchUp(journey, missedTicks, options?) -> playback plan for the missed
 * window, per Plan B §3.4. The REC-3 object form
 * catchUp(journey, { missedTicks, absenceSeconds, fromTick }) is accepted
 * verbatim as well — see the signature note below. The mode is decided by
 * BOTH axes of §3.4's table — the missed-step count AND the absence
 * duration:
 *
 *   0 missed steps                     -> { mode: 'none',         speed: 1,   replay: false }
 *   1–6 missed steps, absence ≤ 1 h    -> { mode: 'catch-up',     speed: 2.5, replay: false }
 *   >6 missed steps,  absence ≤ 1 h    -> { mode: 'replay',       speed: 8,   replay: true  }
 *   ≥1 missed step,   absence > 1 h    -> { mode: 'path-summary', speed: 1,   replay: false }
 *
 * THE WINDOW. `missedTicks` counts world ticks of this journey that
 * elapsed unplayed in the window [fromTick, fromTick + missedTicks).
 * `options.fromTick` is the viewer's return point — the tick from which
 * unplayed time is counted (M3.02). It defaults to journey.startTick, the
 * wave-1 calling convention (callers play journeys from their start);
 * with that default the window and every result are exactly the
 * pre-M3.02 behaviour. Every step that BEGINS inside the window is a
 * missed step: a step already begun before fromTick is not re-planned
 * (the figure is mid-step; live playback resumes from positionAt), and
 * a step beginning at or after the window's end has not been missed yet.
 * Catch-up and replay plans return ALL missed steps, in order — steps
 * are compressed, never skipped or merged — and the journey's scheduled
 * arrival tick is never beaten.
 *
 * `options.absenceTicks` is the visitor's absence in world ticks (§3.4's
 * lag axis: how long playback was away, whether the tab was closed, hidden,
 * or paused — §3.4 treats Portal-side outages identically). It defaults to
 * `missedTicks`: the unplayed window IS the absence under the default
 * calling convention. A caller that tracks the absence separately (a
 * journey can begin mid-absence, making its unplayed window shorter than
 * the absence) passes it explicitly. `options.absenceSeconds` is the same
 * quantity in seconds (REC-3's unit), converted at TICK_SECONDS per tick;
 * passing both absence forms is accepted only when they agree, so a unit
 * mix-up fails loudly instead of silently picking one.
 *
 * SIGNATURE — M3.02 / REC-3 RECONCILIATION. REC-3 (plan-to-complete,
 * SE-2.1) specifies catchUp(journey, { missedTicks, absenceSeconds,
 * fromTick }). The shipped Wave-1 form is positional:
 * catchUp(journey, missedTicks, { absenceTicks }). Adopting REC-3
 * wholesale would break every positional caller (the app frame loop, the
 * app and engine suites) and would flip the absence unit from ticks to
 * seconds at every call site — a standing unit-confusion hazard for no
 * semantic gain, since ticks are the engine's native time unit
 * (planJourney, positionAt and step boundaries are all ticks).
 * Resolution (HYBRID): one implementation accepts both forms. The
 * positional form is unchanged — existing callers and tests pass
 * unmodified — and the REC-3 object form is accepted verbatim, with
 * absenceSeconds converted and fromTick defaulting as above. The §3.4
 * mode semantics are identical either way; the forms differ only in how
 * the same quantities are passed. Recommendation: keep the hybrid. A
 * breaking rename should be reconsidered only if a second catchUp
 * consumer appears (plan risk R16) and argues for the object form as
 * the single canonical signature.
 *
 * Path summary (§3.4's TRAVELLED-PATH SUMMARY): after an absence over an
 * hour, steps are NOT replayed at any speed — above 8× a walk reads as a
 * slide, and an hour of walking is not a performance. The plan's `steps`
 * (the playback queue) is empty and `totalShownSeconds` is 0; the missed
 * steps are returned as `summarySteps` — their scheduled facts, for the
 * "while you were away: …" list — and the route polyline is
 * `journeyRoute(journey, layout)`. The figure starts at its evidenced
 * place (positionAt at/after endTick), and the summary IS the continuity.
 * A journey with no missed steps returns 'none' however long the absence:
 * there is nothing of this journey to summarise.
 *
 * Each plan step: {index, from, to, worldTicks, nearReach, startTick,
 * endTick, shownSeconds} where shownSeconds is the step's 1× duration
 * divided by the plan speed — except a near-reach leg, which keeps its
 * disclosed MIN_SHOWN_SECONDS floor even under compression (below 1 s it
 * would be invisible; the disclosure is the honesty device). Summary steps
 * carry their un-divided 1× shownSeconds: they are listed, not played.
 * Every plan echoes `missedTicks`, `absenceTicks`, `absenceSeconds` and
 * `fromTick` (the §3.4 "replaying the last N minutes" copy derives from
 * the absence echoes).
 */
export function catchUp(journey, missedTicks, ...rest) {
  // Signature normalisation (M3.02 hybrid, see the doc above): the REC-3
  // object form carries every quantity in the second argument; the
  // positional form carries missedTicks there and options third. Mixing
  // the two forms is a caller bug and fails loudly.
  let options = {};
  if (missedTicks !== null && typeof missedTicks === 'object') {
    if (rest.length > 0) {
      throw new TypeError(
        'catchUp: pass either the positional form or the REC-3 object form, not both',
      );
    }
    options = missedTicks;
    missedTicks = options.missedTicks;
  } else if (rest.length > 0) {
    options = rest[0] ?? {};
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('catchUp: options must be an object');
  }
  if (!Number.isFinite(missedTicks) || missedTicks < 0) {
    throw new TypeError('catchUp: missedTicks must be a non-negative number');
  }
  const fromTick = options.fromTick ?? journey.startTick;
  if (!Number.isFinite(fromTick)) {
    throw new TypeError('catchUp: options.fromTick must be a finite number');
  }
  const hasAbsenceTicks = options.absenceTicks != null;
  const hasAbsenceSeconds = options.absenceSeconds != null;
  if (
    hasAbsenceTicks &&
    (!Number.isFinite(options.absenceTicks) || options.absenceTicks < 0)
  ) {
    throw new TypeError('catchUp: options.absenceTicks must be a non-negative number');
  }
  if (
    hasAbsenceSeconds &&
    (!Number.isFinite(options.absenceSeconds) || options.absenceSeconds < 0)
  ) {
    throw new TypeError('catchUp: options.absenceSeconds must be a non-negative number');
  }
  let absenceTicks;
  if (hasAbsenceTicks && hasAbsenceSeconds) {
    if (Math.abs(options.absenceSeconds - options.absenceTicks * TICK_SECONDS) > 1e-6) {
      throw new TypeError('catchUp: options.absenceSeconds and options.absenceTicks disagree');
    }
    absenceTicks = options.absenceTicks;
  } else if (hasAbsenceSeconds) {
    absenceTicks = options.absenceSeconds / TICK_SECONDS;
  } else if (hasAbsenceTicks) {
    absenceTicks = options.absenceTicks;
  } else {
    absenceTicks = missedTicks;
  }
  const absenceSeconds = absenceTicks * TICK_SECONDS;
  const windowEnd = fromTick + missedTicks;
  const missed = journey.steps.filter(
    (s) =>
      missedTicks > 0 && s.startTick >= fromTick - EPS && s.startTick < windowEnd - EPS,
  );

  if (missed.length === 0) {
    return {
      mode: 'none',
      speed: 1,
      replay: false,
      missedTicks,
      absenceTicks,
      absenceSeconds,
      fromTick,
      steps: [],
      totalShownSeconds: 0,
      arrivalTick: journey.endTick,
    };
  }
  if (absenceTicks > SUMMARY_ABSENCE_TICKS) {
    return {
      mode: 'path-summary',
      speed: 1,
      replay: false,
      missedTicks,
      absenceTicks,
      absenceSeconds,
      fromTick,
      steps: [],
      summarySteps: missed.map((s) => ({
        index: s.index,
        from: s.from,
        to: s.to,
        worldTicks: s.worldTicks,
        nearReach: s.nearReach,
        startTick: s.startTick,
        endTick: s.endTick,
        shownSeconds: s.shownSeconds,
      })),
      totalShownSeconds: 0,
      arrivalTick: journey.endTick,
    };
  }
  const replay = missed.length > CATCH_UP_MAX_STEPS;
  const speed = replay ? REPLAY_SPEED : CATCH_UP_SPEED;
  const steps = missed.map((s) => ({
    index: s.index,
    from: s.from,
    to: s.to,
    worldTicks: s.worldTicks,
    nearReach: s.nearReach,
    startTick: s.startTick,
    endTick: s.endTick,
    shownSeconds: s.nearReach ? MIN_SHOWN_SECONDS : s.shownSeconds / speed,
  }));
  return {
    mode: replay ? 'replay' : 'catch-up',
    speed,
    replay,
    missedTicks,
    absenceTicks,
    absenceSeconds,
    fromTick,
    steps,
    totalShownSeconds: steps.reduce((sum, s) => sum + s.shownSeconds, 0),
    arrivalTick: journey.endTick,
  };
}
