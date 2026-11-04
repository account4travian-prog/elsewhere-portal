// conflicts.mjs — Portal's stuck-actor semantics (Plan B §3.5's
// stuck-actor table; plan-to-complete SE-2.5 / M3.04). Pure ESM, no DOM,
// no dependencies beyond the playback core and the route finder.
//
// THREE mechanisms, each a refusal to invent:
//
// 1. THE PLACE-CONFLICT HOLD (§3.5 row 2, SE-2.5 verbatim):
//    "contradictory places in one tick window set the deriver's
//    `place-conflict` HOLD (figure stays at its last unconflicted
//    place, inspector shows the conflict, walking resumes only on an
//    unconflicted later place)".
//    A tick window is one world tick (30 s — playback.TICK_SECONDS).
//    Two placements of one citizen whose evidence falls in the same
//    window, naming different places, contradict each other: neither
//    is newer, so recency cannot pick one, and Portal does not guess.
//    The tracker below consumes a stream of placement observations
//    (in the shipped app: one per citizen per bundle, the bundle's
//    placeCode + evidenceUtc) and maintains, per citizen, the last
//    UNCONFLICTED placement — the only one the stage may show. While
//    a conflict stands, the shown placement does not move; a single
//    placement from a LATER window is unconflicted and lifts the
//    hold. The deriver-side flag the plan names is the same rule one
//    layer down; this tracker is its presentation-layer form, built
//    against bundle placements because the frozen v2 bundle carries
//    one placement per citizen (no multi-claim field exists in it).
//
// 2. THE JOURNEY WATCHDOG (§3.5 row 1, SE-2.5 verbatim):
//    "a watchdog pauses a journey with no arrival evidence within
//    2× its interval + 6 ticks (en-route idle; caption "on the way to
//    {B} — Portal has no newer word"); later origin evidence produces
//    a shown return walk or a path summary — never a snap".
//    assessJourney() is that watchdog as a pure assessment: it never
//    moves a figure itself. Paused means the CALLER freezes its
//    performance tick — assessedPosition() of a paused journey is
//    positionAt at the frozen tick, identical at any later nowTick,
//    so the position stream has zero unscheduled changes (§7.4).
//    Origin evidence builds a RETURN journey from the figure's
//    current route node back to the origin and lets catchUp's §3.4
//    absence axis choose walk vs path summary — the same rule that
//    governs every other return, applied here unchanged.
//
// 3. VANISH / REAPPEAR (§3.5 row 4, SE-2.5 verbatim):
//    "Vanish/reappear uses labelled staging exits/entries, flagged as
//    staging of an unwitnessed departure".
//    When the record stops placing a citizen (place known → unknown)
//    the tracker emits an `exit` event; when it places them again an
//    `entry`. Both carry `staging: true` and the disclosure text —
//    the flag is the honesty device (§7.3's harness asserts the flag,
//    not just the path). An exit means the record stopped placing
//    them; it is NOT a report that they left the town. A citizen's
//    FIRST observation in the stream initialises silently — Portal
//    starting to watch is not a town event, so it is neither an
//    entry nor an exit.

import { planJourney, positionAt, catchUp, TICK_SECONDS } from './playback.mjs';
import { findRoute } from './astar.mjs';

// ------------------------------------------------------------ wording

/** The watchdog caption, §3.5's decided copy verbatim with {B} filled
 *  by the destination (a place code here; the app re-renders it with
 *  the place's label through this same template). */
export const ON_THE_WAY_CAPTION = (place) => `on the way to ${place} — Portal has no newer word`;

/** The place-conflict disclosure (inspector copy): what a conflict is
 *  and what Portal does about it — shown, never silently resolved. */
export const CONFLICT_DISCLOSURE =
  'The public feeds Portal reads name two places for this citizen in the same tick. Portal will not guess which one is right: the figure stays at the last place the feeds agreed on, and walking resumes when a later feed names one place.';

/** The exit disclosure: an exit is the record stopping, not a leaving. */
export const EXIT_DISCLOSURE =
  'The public feeds Portal reads stopped placing this citizen. That is not the same as leaving the town — Portal has no newer place for them. The walk off the stage is Portal\u2019s staging of an unwitnessed departure.';

/** The entry disclosure: the mirror of the exit. */
export const ENTRY_DISCLOSURE =
  'The public feeds Portal reads name a place for this citizen again. The walk onto the stage is Portal\u2019s staging of an arrival nobody witnessed.';

// ------------------------------------------------------------ tick windows

/** The world-tick index an evidence instant falls in (one tick =
 *  TICK_SECONDS of evidence time), or null when the stamp is absent
 *  or unparseable. Two placements whose evidence shares an index are
 *  in ONE tick window — the §3.5 contradiction test. */
export function tickIndexOf(evidenceUtc) {
  if (typeof evidenceUtc !== 'string' || evidenceUtc === '') return null;
  const ms = Date.parse(evidenceUtc);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / (TICK_SECONDS * 1000));
}

// ------------------------------------------------------------ placement tracker

/**
 * createPlacementTracker() -> tracker
 *
 * Feed it placement observations via applyPlacement, one per citizen
 * per bundle, in bundle order:
 *   { key, placeCode (string|null), evidenceUtc (string|null), bundleSeq }
 * placeCode null is the record not placing the citizen (the bundle's
 * unknown state). The tracker is a plain mutable state object; every
 * apply returns the events that observation caused (usually []).
 */
export function createPlacementTracker() {
  return { citizens: new Map() };
}

function blankCitizen(key) {
  return {
    key,
    initialised: false,
    // The last unconflicted placement — the only one the stage may
    // show: {placeCode, evidenceUtc} | null.
    shown: null,
    // The shown placement as it stood when the current tick window
    // opened; a conflict inside the window reverts to this.
    preWindowShown: null,
    // 'placed' while the record places the citizen, 'absent' once it
    // stops. Presence governs drawing; `shown` keeps the last place.
    presence: 'absent',
    lastPlace: null,
    // The current window's single claim so far:
    // {tick, evidenceUtc, placeCode} | null.
    window: null,
    // The standing conflict | null:
    // {tick, claims: [{placeCode, evidenceUtc}], sinceBundleSeq}.
    conflict: null,
  };
}

/** A read-only snapshot of one citizen's tracked state (or null). */
export function trackerCitizen(tracker, key) {
  const c = tracker?.citizens?.get(key);
  if (!c) return null;
  return {
    key: c.key,
    shown: c.shown ? { ...c.shown } : null,
    presence: c.presence,
    lastPlace: c.lastPlace,
    conflict: c.conflict
      ? {
          tick: c.conflict.tick,
          sinceBundleSeq: c.conflict.sinceBundleSeq,
          claims: c.conflict.claims.map((cl) => ({ ...cl })),
          disclosure: CONFLICT_DISCLOSURE,
        }
      : null,
  };
}

function conflictEvent(c, obs) {
  return {
    type: 'place-conflict',
    key: c.key,
    tick: c.conflict.tick,
    claims: c.conflict.claims.map((cl) => ({ ...cl })),
    heldPlace: c.shown?.placeCode ?? null,
    evidenceUtc: obs.evidenceUtc ?? null,
    bundleSeq: obs.bundleSeq ?? null,
    staging: false,
    hold: true,
    disclosure: CONFLICT_DISCLOSURE,
  };
}

/**
 * applyPlacement(tracker, obs) -> events[]
 *
 * Event types: 'move' (an unconflicted later place), 'exit',
 * 'entry', 'place-conflict', 'conflict-widened',
 * 'conflict-resolved'. Every event carries key, evidenceUtc,
 * bundleSeq, a boolean `staging` flag and a `disclosure` — §7.3
 * asserts the flag, and no consumer should have to re-derive it.
 * Uncontested duplicates and stale (older-window) claims are silent.
 */
export function applyPlacement(tracker, obs) {
  if (!tracker || !(tracker.citizens instanceof Map)) {
    throw new TypeError('applyPlacement: tracker must come from createPlacementTracker()');
  }
  if (!obs || typeof obs.key !== 'string' || obs.key === '') {
    throw new TypeError('applyPlacement: obs.key must be a non-empty string');
  }
  const placeCode = typeof obs.placeCode === 'string' && obs.placeCode !== '' ? obs.placeCode : null;
  const evidenceUtc = typeof obs.evidenceUtc === 'string' && obs.evidenceUtc !== '' ? obs.evidenceUtc : null;
  const tick = tickIndexOf(evidenceUtc);
  let c = tracker.citizens.get(obs.key);
  if (!c) {
    c = blankCitizen(obs.key);
    tracker.citizens.set(obs.key, c);
  }
  const events = [];
  const base = { key: c.key, evidenceUtc, bundleSeq: obs.bundleSeq ?? null };

  // ---- a standing conflict governs everything in its window -------
  if (c.conflict) {
    if (tick !== null && tick <= c.conflict.tick) {
      // Same (or older) window: a further distinct place widens the
      // conflict; a repeat of a claimed place, or the record going
      // quiet inside the window, changes nothing.
      if (placeCode && !c.conflict.claims.some((cl) => cl.placeCode === placeCode)) {
        c.conflict.claims.push({ placeCode, evidenceUtc });
        events.push({ ...conflictEvent(c, obs), type: 'conflict-widened' });
      }
      return events;
    }
    // A claim from a LATER window (or one with no stamp at all) is a
    // single unconflicted claim: the hold lifts, and the claim is
    // then processed normally below.
    const resolved = { ...base, type: 'conflict-resolved', resolvedPlace: placeCode, staging: false, hold: false, disclosure: CONFLICT_DISCLOSURE };
    c.conflict = null;
    c.window = null;
    events.push(resolved);
  }

  // ---- first observation ever: initialise silently ----------------
  if (!c.initialised) {
    c.initialised = true;
    c.window = { tick, evidenceUtc, placeCode };
    c.preWindowShown = null;
    if (placeCode) {
      c.shown = { placeCode, evidenceUtc };
      c.lastPlace = placeCode;
      c.presence = 'placed';
    }
    return events;
  }

  // ---- stale claim: evidence never rewinds ------------------------
  if (tick !== null && c.window && c.window.tick !== null && tick < c.window.tick) {
    return events;
  }

  // ---- same tick window: a second, different place contradicts ----
  if (tick !== null && c.window && c.window.tick === tick && c.window.placeCode) {
    if (!placeCode || placeCode === c.window.placeCode) {
      return events; // quiet inside the window, or the same claim again
    }
    c.conflict = {
      tick,
      sinceBundleSeq: obs.bundleSeq ?? null,
      claims: [
        { placeCode: c.window.placeCode, evidenceUtc: c.window.evidenceUtc },
        { placeCode, evidenceUtc },
      ],
    };
    // The figure stays at its last UNCONFLICTED place: the placement
    // the stage showed before this window opened. It does not walk
    // to either claimed place while the record contradicts itself.
    c.shown = c.preWindowShown;
    c.presence = c.shown ? 'placed' : 'absent';
    events.push(conflictEvent(c, obs));
    return events;
  }

  // ---- a new window (or an unstamped claim): the claim stands -----
  c.preWindowShown = c.shown;
  c.window = { tick, evidenceUtc, placeCode };
  if (placeCode) {
    if (c.presence === 'absent') {
      events.push({
        ...base,
        type: 'entry',
        placeCode,
        fromPlace: c.lastPlace,
        staging: true,
        hold: false,
        disclosure: ENTRY_DISCLOSURE,
      });
    } else if (c.shown && c.shown.placeCode !== placeCode) {
      events.push({
        ...base,
        type: 'move',
        fromPlace: c.shown.placeCode,
        placeCode,
        staging: false,
        hold: false,
        disclosure: null,
      });
    }
    c.shown = { placeCode, evidenceUtc };
    c.lastPlace = placeCode;
    c.presence = 'placed';
  } else if (c.presence === 'placed') {
    events.push({
      ...base,
      type: 'exit',
      fromPlace: c.lastPlace,
      placeCode: null,
      staging: true,
      hold: false,
      disclosure: EXIT_DISCLOSURE,
    });
    c.presence = 'absent';
  }
  return events;
}

// ------------------------------------------------------------ journey watchdog

/** Grace ticks after the doubled interval (§3.5: "2× its interval
 *  + 6 ticks"). */
export const WATCHDOG_GRACE_TICKS = 6;

/** The tick by which arrival evidence is owed before the watchdog
 *  pauses the journey: startTick + 2 × the journey's interval + 6. */
export function watchdogDeadline(journey) {
  return journey.startTick + 2 * journey.totalWorldTicks + WATCHDOG_GRACE_TICKS;
}

/**
 * assessJourney(journey, layout, evidence) -> assessment
 *
 * evidence: {
 *   nowTick,                 // the tick being assessed (required)
 *   perfTick = null,         // the performance's current tick — the
 *                            // figure's scheduled position source
 *   arrivalTick = null,      // first evidence of the citizen AT the
 *                            // destination, in ticks, if any
 *   originTick = null,       // later evidence of the citizen back AT
 *                            // the origin, in ticks, if any
 * }
 *
 * States, in precedence order (§3.5's table):
 *  - 'complete'       arrival evidence exists; the journey is done.
 *  - 'return-walk'    origin evidence exists; a return journey from
 *                     the figure's current route node to the origin
 *                     is attached, with catchUp's plan — the absence
 *                     was short, so the return is shown as a walk.
 *  - 'return-summary' same, but the absence axis (> 1 h) puts the
 *                     return in §3.4's path summary: listed, not
 *                     walked; the figure stands at the origin, its
 *                     evidenced place.
 *  - 'returned'       origin evidence exists and the figure is
 *                     already at the origin: nothing to stage.
 *  - 'paused'         nowTick is past the watchdog deadline with no
 *                     arrival and no origin evidence: en-route idle,
 *                     the §3.5 caption, and `frozenTick` — the
 *                     performance tick the caller freezes at.
 *  - 'en-route'       none of the above; the walk proceeds.
 *
 * The assessment never carries a position of its own invention:
 * positions come from assessedPosition() over the frozen/scheduled
 * ticks only, so a paused figure's position is bit-identical at
 * every later nowTick — zero unscheduled position changes (§7.4).
 */
export function assessJourney(journey, layout, evidence = {}) {
  const { nowTick, perfTick = null, arrivalTick = null, originTick = null } = evidence;
  if (!Number.isFinite(nowTick)) {
    throw new TypeError('assessJourney: evidence.nowTick must be a finite number');
  }
  const deadlineTick = watchdogDeadline(journey);
  const origin = journey.path[0];
  const destination = journey.path[journey.path.length - 1];
  const base = { key: journey.handle, deadlineTick, origin, destination };

  if (arrivalTick !== null && arrivalTick !== undefined) {
    return { ...base, state: 'complete', arrivalTick };
  }

  if (originTick !== null && originTick !== undefined && originTick > journey.startTick) {
    // Where the figure stands when the origin evidence lands: its
    // performance position (perfTick), or its scheduled position at
    // the evidence tick when no performance clock is supplied. A
    // performance contradicted by newer evidence cancels AT ITS NEXT
    // NODE (the Office enforcement rule, Paper 02 §2.3): mid-leg, the
    // return starts from the node the figure was already walking to,
    // never from a snapped-back position.
    const atTick = perfTick ?? Math.min(originTick, journey.endTick);
    let currentCode = destination;
    if (layout) {
      const pos = positionAt(journey, layout, atTick);
      currentCode = pos.between ? pos.between[1] : pos.code;
    }
    if (currentCode === origin) {
      return { ...base, state: 'returned', originTick };
    }
    const absenceTicks = Math.max(0, nowTick - originTick);
    let returnJourney = null;
    let plan = null;
    if (layout) {
      const route = findRoute(layout, currentCode, origin);
      if (route) {
        const ticks = Math.max(1, Math.round(route.totalSeconds / TICK_SECONDS));
        returnJourney = planJourney({
          handle: journey.handle,
          path: [currentCode, origin],
          startTick: originTick,
          ticksPerStep: ticks,
        });
        plan = catchUp(returnJourney, absenceTicks, { absenceTicks });
      }
    }
    if (!returnJourney) {
      // No route home can be staged (no layout, or no path): the
      // return is told as a summary, never as a snap.
      return { ...base, state: 'return-summary', originTick, returnJourney: null, plan: null };
    }
    return {
      ...base,
      state: plan.mode === 'path-summary' ? 'return-summary' : 'return-walk',
      originTick,
      fromCode: currentCode,
      returnJourney,
      plan,
    };
  }

  if (nowTick > deadlineTick) {
    return {
      ...base,
      state: 'paused',
      frozenTick: perfTick ?? Math.min(nowTick, journey.endTick),
      caption: ON_THE_WAY_CAPTION(destination),
    };
  }
  return { ...base, state: 'en-route' };
}

/**
 * assessedPosition(journey, layout, assessment, perfTick) -> the
 * figure's position under an assessment, or null when the assessment
 * carries no position (no layout, or a route-less return summary —
 * the caller then keeps the figure wherever the record last put it).
 *
 * The paused case is the invariant: the position derives from the
 * assessment's frozenTick alone, so re-assessing at any later nowTick
 * yields the identical position.
 */
export function assessedPosition(journey, layout, assessment, perfTick = null) {
  if (!layout || !assessment) return null;
  switch (assessment.state) {
    case 'complete':
      return positionAt(journey, layout, journey.endTick);
    case 'paused':
      return positionAt(journey, layout, assessment.frozenTick);
    case 'en-route':
      return positionAt(journey, layout, perfTick ?? journey.startTick);
    case 'returned':
      return positionAt(journey, layout, journey.startTick);
    case 'return-walk': {
      const rj = assessment.returnJourney;
      if (!rj) return null;
      const t = Math.min(perfTick ?? rj.startTick, rj.endTick);
      return positionAt(rj, layout, t);
    }
    case 'return-summary': {
      const rj = assessment.returnJourney;
      if (!rj) return null;
      // The figure stands at its evidenced place: the origin.
      return positionAt(rj, layout, rj.endTick);
    }
    default:
      return null;
  }
}
