// Elsewhere Portal — rendered-stream invariant harness (M4.26,
// SE-8.2).
//
// The engine's invariant suite checks position FUNCTIONS. This
// harness checks position STREAMS: per-frame positions sampled from
// the running presentation of BOTH renderers —
//
//   scene3d: the 3D scene's own path — journeys driven through
//     playback-driver.mjs (the module scene.mjs consumes) and pushed
//     through the scene's grid->world->grid transform, so a transform
//     bug is inside the checked stream, not outside it.
//   app2d: the 2D app's presentation — app.js places its demo/live
//     figures with playback.positionAt(journey, layout, tick)
//     verbatim (build/app/app.js, currentPositions), so the harness
//     samples that exact call.
//
// …and verifies, per figure: every sample lies on the journey's route
// polyline; route distance is monotone; no inter-sample move exceeds
// the fastest scheduled leg rate for the elapsed ticks (plus 0-tick
// near-reach completions inside the interval); every step's
// destination is reached, in order, never early. A STEPPED variant
// (Calmer, M4.20) checks the stepped form of the same law: samples
// sit exactly on route vertices, and consecutive DISTINCT samples are
// neighbouring vertices — one edge, never a jump.
//
// Positive control: the engine's teleporting mutant, sampled the
// same way, must be caught by both checkers (asserted in the tests).

import { positionAt, journeyRoute } from '../../engine/playback.mjs';
import { nodeByCode } from '../../engine/astar.mjs';
import {
  polyline, routeDistance, matchOnSegment, maxLegRate, zeroTickLengthAt,
} from '../../engine/invariant.mjs';
import { createDriver } from './playback-driver.mjs';

const EPS = 1e-6;

// The scene's grid<->world transform (scene.mjs: CELL = 10, grid
// (4,4) at the origin, +y south = +z). The harness round-trips
// through it so the checked stream is the rendered stream.
export const CELL = 10;
export const gridToWorld = (gx, gy) => ({ x: (gx - 4) * CELL, z: (gy - 4) * CELL });
export const worldToGrid = (wx, wz) => ({ x: wx / CELL + 4, y: wz / CELL + 4 });

// Sample a position function over a journey's scheduled span (plus a
// half-tick margin each side, matching checkContinuity's window).
export function sampleStream(posFn, journey, layout, { dt = 0.05 } = {}) {
  const samples = [];
  const t0 = journey.startTick - 0.5;
  const t1 = journey.endTick + 0.5;
  for (let t = t0; t <= t1 + 1e-9; t += dt) {
    const p = posFn(journey, layout, t);
    samples.push({ t, x: p.x, y: p.y, code: p.code, between: p.between });
  }
  return samples;
}

// Polyline vertex index at which each step's destination sits.
function stepDestVertices(journey, layout, line) {
  const legsByStep = new Map();
  for (const leg of journeyRoute(journey, layout)) {
    legsByStep.set(leg.stepIndex, (legsByStep.get(leg.stepIndex) || 0) + 1);
  }
  const out = [];
  let v = 0;
  for (let k = 0; k < journey.steps.length; k++) {
    v += legsByStep.get(k) || 0;
    out.push(v); // vertex index (cum position) of step k's destination
  }
  void line;
  return out;
}

// Continuity over SAMPLES (gliding form). Same checks as
// invariant.checkContinuity, fed from a recorded stream instead of a
// live function — the stream is the evidence, so the checker must
// not be able to re-ask the function for a better answer.
export function checkSampledStream(journey, layout, samples) {
  const violations = [];
  const line = polyline(journey, layout);
  const rate = maxLegRate(journey, layout);
  const destVertices = stepDestVertices(journey, layout, line);
  let hint = 0;
  let prevS = null;
  let prevT = null;
  const stepArrival = new Array(journey.steps.length).fill(null);

  for (const smp of samples) {
    let found = null;
    if (prevS !== null) {
      for (let i = Math.max(0, hint); i + 1 < line.pts.length && !found; i++) {
        const m = matchOnSegment(smp, line, i);
        if (m && m.s >= prevS - EPS) found = m;
      }
    }
    if (!found) found = routeDistance(smp, line, hint);
    if (!found) {
      violations.push(`t=${smp.t.toFixed(2)}: position (${smp.x},${smp.y}) not on the route ahead`);
      continue;
    }
    hint = found.seg;
    if (prevS !== null) {
      if (found.s < prevS - EPS) {
        violations.push(`t=${smp.t.toFixed(2)}: route distance went backwards ${prevS} -> ${found.s}`);
      }
      const dt = smp.t - prevT;
      let allowance = rate * dt + EPS;
      for (let b = Math.floor(prevT) + 1; b <= Math.ceil(smp.t); b++) {
        if (b > prevT && b <= smp.t) allowance += zeroTickLengthAt(journey, layout, b);
      }
      if (found.s - prevS > allowance) {
        violations.push(
          `t=${smp.t.toFixed(2)}: moved ${(found.s - prevS).toFixed(3)} grid units in ${dt.toFixed(2)} ticks ` +
          `(allowed ${allowance.toFixed(3)}) — discontinuity (teleport)`,
        );
      }
    }
    prevS = found.s;
    prevT = smp.t;
    for (let k = 0; k < journey.steps.length; k++) {
      if (stepArrival[k] !== null) continue;
      const step = journey.steps[k];
      if (smp.t < step.startTick - EPS) continue;
      const dest = line.pts[destVertices[k]];
      if (dest && Math.hypot(smp.x - dest.x, smp.y - dest.y) <= 1e-6 && smp.between === null) {
        stepArrival[k] = smp.t;
      }
    }
  }
  let prevArrival = -Infinity;
  for (let k = 0; k < journey.steps.length; k++) {
    const step = journey.steps[k];
    const at = stepArrival[k];
    if (at === null) {
      violations.push(`place ${step.to} (step ${k}) was never reached — a step was skipped`);
      continue;
    }
    const earlyTol = 0.05 + 1e-6 * Math.max(1, step.worldTicks);
    if (at < step.endTick - earlyTol) {
      violations.push(`arrived at ${step.to} at t=${at.toFixed(2)}, before its scheduled tick ${step.endTick}`);
    }
    if (at < prevArrival - 1e-9) violations.push(`arrived at ${step.to} out of path order`);
    prevArrival = Math.max(prevArrival, at);
  }
  return violations;
}

// Stepped continuity (Calmer's form): every sample exactly at a
// route vertex; consecutive distinct samples are NEIGHBOURING
// vertices (index differs by exactly 1, forward only); the final
// sample is the journey's destination vertex.
export function checkSteppedStream(journey, layout, samples) {
  const violations = [];
  const line = polyline(journey, layout);
  let prevIdx = null;
  let vi = 0;
  for (const smp of samples) {
    let idx = null;
    for (let i = vi; i < line.pts.length; i++) {
      if (Math.hypot(line.pts[i].x - smp.x, line.pts[i].y - smp.y) <= 1e-6) { idx = i; break; }
    }
    if (idx === null) {
      violations.push(`t=${smp.t.toFixed(2)}: stepped position (${smp.x},${smp.y}) is not a route vertex ahead`);
      continue;
    }
    if (prevIdx !== null && idx !== prevIdx && idx !== prevIdx + 1) {
      violations.push(
        `t=${smp.t.toFixed(2)}: pose jumped from vertex ${prevIdx} to vertex ${idx} — not one graph edge (teleport in stepped form)`,
      );
    }
    prevIdx = idx;
    vi = idx;
  }
  if (prevIdx !== line.pts.length - 1) {
    violations.push(`stepped stream ended at vertex ${prevIdx}, not the destination vertex ${line.pts.length - 1}`);
  }
  return violations;
}

// ------------------------------------------------------------ the runs
// Run both renderers' streams over a fixture set of journeys.
//   journeys: [{ key, journey }]
// Returns { scene3d: {key: violations}, app2d: {key: violations} }.
export function runRendererStreams({ layout, journeys, dt = 0.05 }) {
  const driver = createDriver({ layout });
  for (const { key, journey } of journeys) driver.addJourney(key, journey);

  const scene3d = {};
  const app2d = {};
  for (const { key, journey } of journeys) {
    // 3D: driver positions, round-tripped through the scene transform.
    const s3 = sampleStream((j, l, t) => {
      const p = driver.positionAt(key, t);
      const w = gridToWorld(p.x, p.y);
      const g = worldToGrid(w.x, w.z);
      return { ...p, x: g.x, y: g.y };
    }, journey, layout, { dt });
    scene3d[key] = checkSampledStream(journey, layout, s3);
    // 2D: the app's verbatim call.
    const s2 = sampleStream((j, l, t) => positionAt(j, l, t), journey, layout, { dt });
    app2d[key] = checkSampledStream(journey, layout, s2);
  }
  return { scene3d, app2d };
}

// Re-exported for the drill reports: the node lookup the masked
// drills use to name vertices without naming citizens.
export { nodeByCode };
