// invariant.mjs — the no-teleport invariant checker (Plan B §7.3),
// extracted from engine/test/no-teleport.test.mjs at M3.05 so the corpus
// runner (build/data/corpus-invariants.mjs) and the synthetic suite run
// THE SAME checker — one implementation, two corpora. The synthetic
// suite remains the checker's own gate (its positive control included);
// this module is pure: journey + layout in, violation strings out.
//
// THE INVARIANT: for every figure, rendered positions must form a
// continuous path on the route graph: consecutive sampled positions are
// identical, at a node, or interpolated on one edge; route-distance is
// monotone; movement between samples never exceeds the fastest scheduled
// leg speed (plus the route length of any 0-tick near-reach legs
// completing inside the sample interval — §7.3: the invariant governs
// continuity, not duration); and every place-code arrival happens no
// earlier than its scheduled tick, in path order, with no place skipped.
//
// POSITIVE CONTROL (the project owner's doctrine — an unproven test is not a
// gate): `mutantPositionAt` deliberately TELEPORTS (origin until
// mid-journey, then the destination, instantly). Any harness running
// this checker over a corpus must also run the mutant over the same
// journeys and assert it is caught; a mutant that passes means the
// checker is broken and nothing ships on it.
//
// M3.05 CORPUS AMENDMENTS (2026-11-02, driven by the first full-corpus
// run — see build/data/corpus-invariants.mjs): the checker was written
// against simple synthetic paths and mishandled two shapes the real
// record contains. (1) RETRACED edges: matching now prefers the
// monotone-consistent segment (see checkContinuity). (2) REVISITED
// places + LONG steps: arrivals are tracked per step, and the
// early-arrival tolerance accounts for the engine's own 1e-6 leg-end
// snap plus one sample interval. Neither amendment weakens a
// detection: the synthetic suite's journeys and mutant, the
// reconstructed-journey suite, and a new retrace pair in
// no-teleport.test.mjs all pin that — the mutant is still caught on
// every timed journey, retraced or not.

import { journeyRoute } from './playback.mjs';
import { nodeByCode } from './astar.mjs';

const EPS = 1e-6;

// The journey's full walked polyline: vertices in traversal order.
export function polyline(journey, layout) {
  const legs = journeyRoute(journey, layout);
  const pts = [];
  if (legs.length === 0) {
    const n = nodeByCode(layout, journey.path[0]);
    pts.push({ x: n.x, y: n.y });
  }
  for (const leg of legs) {
    const a = nodeByCode(layout, leg.a);
    const b = nodeByCode(layout, leg.b);
    if (pts.length === 0) pts.push({ x: a.x, y: a.y });
    pts.push({ x: b.x, y: b.y });
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return { pts, cum, total: cum[cum.length - 1] };
}

// Match of a position against ONE polyline segment, or null.
export function matchOnSegment(pos, line, i) {
  const a = line.pts[i];
  const b = line.pts[i + 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return null;
  const t = ((pos.x - a.x) * dx + (pos.y - a.y) * dy) / len2;
  if (t < -1e-9 || t > 1 + 1e-9) return null;
  const px = a.x + dx * Math.min(1, Math.max(0, t));
  const py = a.y + dy * Math.min(1, Math.max(0, t));
  if (Math.hypot(pos.x - px, pos.y - py) <= 1e-6) {
    return { s: line.cum[i] + Math.hypot(px - a.x, py - a.y), seg: i };
  }
  return null;
}

// Route distance of a position, searching segments from `hint` onward
// (a position may only ever be found at or ahead of the last one).
export function routeDistance(pos, line, hint) {
  for (let i = Math.max(0, hint); i + 1 < line.pts.length; i++) {
    const m = matchOnSegment(pos, line, i);
    if (m) return m;
  }
  return null;
}

// Fastest any scheduled leg of this journey can be walked, in grid
// units per tick (leg time share ∝ leg seconds within its step).
export function maxLegRate(journey, layout) {
  let rate = 0;
  const legs = journeyRoute(journey, layout);
  const byStep = new Map();
  for (const leg of legs) {
    if (!byStep.has(leg.stepIndex)) byStep.set(leg.stepIndex, []);
    byStep.get(leg.stepIndex).push(leg);
  }
  for (const step of journey.steps) {
    if (step.worldTicks === 0) continue;
    const stepLegs = byStep.get(step.index) ?? [];
    const totalSeconds = stepLegs.reduce((sum, l) => sum + l.seconds, 0);
    for (const leg of stepLegs) {
      const legTicks = (step.worldTicks * leg.seconds) / totalSeconds;
      if (legTicks > 0) rate = Math.max(rate, leg.distance / legTicks);
    }
  }
  return rate;
}

// Route length of 0-tick steps completing at exactly tick `b`.
export function zeroTickLengthAt(journey, layout, b) {
  const legs = journeyRoute(journey, layout);
  let sum = 0;
  for (const step of journey.steps) {
    if (step.worldTicks === 0 && Math.abs(step.endTick - b) <= 1e-9) {
      sum += legs.filter((l) => l.stepIndex === step.index).reduce((s, l) => s + l.distance, 0);
    }
  }
  return sum;
}

/**
 * checkContinuity(posFn, journey, layout, {dt}) -> violation strings.
 * Samples posFn(journey, layout, t) at dt-tick intervals across the
 * journey's scheduled span (plus a half-tick margin either side) and
 * returns every invariant violation found; [] means the walk is
 * continuous, monotone, on-graph, and arrives nowhere early.
 */
export function checkContinuity(posFn, journey, layout, { dt = 0.02 } = {}) {
  const violations = [];
  const line = polyline(journey, layout);
  const rate = maxLegRate(journey, layout);
  const t0 = journey.startTick - 0.5;
  const t1 = journey.endTick + 0.5;

  let hint = 0;
  let prevS = null;
  let prevT = null;
  // First arrival per STEP (destination path[k+1] during step k's
  // window) — M3.05 corpus finding: the original per-PLACE tracking
  // flags every legal revisit as "early / out of order", because a
  // place's first arrival belongs to an earlier step than the revisit
  // being checked. Arrivals are a property of steps, not places.
  const stepArrival = new Array(journey.steps.length).fill(null);

  for (let t = t0; t <= t1 + EPS; t += dt) {
    const pos = posFn(journey, layout, t);
    // Monotone-consistent match — M3.05 corpus finding: on a RETRACED
    // edge (walk out, walk back along the same geometry) a position
    // matches two polyline segments; the first match from the hint is
    // the outbound segment and reads as "backwards" on every return
    // sample. Prefer the first match at/after the hint whose route
    // distance is not behind the previous sample's; fall back to the
    // plain first match when none qualifies (the backwards check below
    // then flags it, exactly as before). Teleports are still caught:
    // a jump ahead lands beyond the per-sample allowance, a jump back
    // has only behind-matches, a jump off-route has none.
    let found = null;
    if (prevS !== null) {
      for (let i = Math.max(0, hint); i + 1 < line.pts.length && !found; i++) {
        const m = matchOnSegment(pos, line, i);
        if (m && m.s >= prevS - EPS) found = m;
      }
    }
    if (!found) found = routeDistance(pos, line, hint);
    if (!found) {
      // Distinguish "jumped backwards/off the remaining route" in the report.
      const anywhere = routeDistance(pos, line, 0);
      violations.push(
        `t=${t.toFixed(2)}: position (${pos.x},${pos.y}) not on the route ahead` +
          (anywhere ? ' (found only behind — moved backwards or teleported)' : ' (not on the route at all)'),
      );
      continue;
    }
    hint = found.seg;
    if (prevS !== null) {
      if (found.s < prevS - EPS) {
        violations.push(`t=${t.toFixed(2)}: route distance went backwards ${prevS} -> ${found.s}`);
      }
      let allowance = rate * dt + EPS;
      for (let b = Math.floor(prevT) + 1; b <= Math.ceil(t); b++) {
        if (b > prevT && b <= t) allowance += zeroTickLengthAt(journey, layout, b);
      }
      if (found.s - prevS > allowance) {
        violations.push(
          `t=${t.toFixed(2)}: moved ${(found.s - prevS).toFixed(3)} grid units in ${dt} ticks ` +
            `(allowed ${allowance.toFixed(3)}) — discontinuity (teleport)`,
        );
      }
    }
    prevS = found.s;
    prevT = t;

    // Record first arrival per step: the first sample at or after the
    // step's start tick with the figure exactly at the step's
    // destination node. (A mid-route pass through that node cannot
    // predate the step's start — the guard is the window, and the
    // route to a step's destination ends there.)
    for (let k = 0; k < journey.steps.length; k++) {
      if (stepArrival[k] !== null) continue;
      const step = journey.steps[k];
      if (t < step.startTick - EPS) continue;
      const n = nodeByCode(layout, step.to);
      if (Math.hypot(pos.x - n.x, pos.y - n.y) <= 1e-6 && pos.between === null) {
        stepArrival[k] = t;
      }
    }
  }

  // Arrival discipline: every step's destination reached, in order,
  // never early. "Early" tolerance (M3.05 corpus finding): the engine
  // snaps to a node within legFrac 1e-6 of a leg's end
  // (playback.mjs positionInStep), so on a long step a sample can
  // register arrival up to ~1e-6 × the step's duration before its
  // endTick, plus one sample interval of grid slack. Anything earlier
  // than that is a real early arrival.
  let prevArrival = -Infinity;
  for (let k = 0; k < journey.steps.length; k++) {
    const step = journey.steps[k];
    const at = stepArrival[k];
    if (at === null) {
      violations.push(`place ${step.to} (step ${k}) was never reached — a step was skipped`);
      continue;
    }
    const earlyTol = dt + 1e-6 * Math.max(1, step.worldTicks);
    if (at < step.endTick - earlyTol) {
      violations.push(`arrived at ${step.to} at t=${at.toFixed(2)}, before its scheduled tick ${step.endTick}`);
    }
    if (at < prevArrival - 1e-9) {
      violations.push(`arrived at ${step.to} out of path order`);
    }
    prevArrival = Math.max(prevArrival, at);
  }
  return violations;
}

// --- the deliberately teleporting mutant (positive control) -----------------

export function mutantPositionAt(journey, layoutArg, t) {
  const mid = journey.startTick + journey.totalWorldTicks / 2;
  const code = t < mid ? journey.path[0] : journey.path[journey.path.length - 1];
  const n = nodeByCode(layoutArg, code);
  return { code, x: n.x, y: n.y, between: null, frac: 0 };
}
