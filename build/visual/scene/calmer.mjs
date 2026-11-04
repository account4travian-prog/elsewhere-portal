// Elsewhere Portal — Calmer, the reduced-motion presentation (M4.20,
// Design X3).
//
// Calmer removes the GLIDE and nothing else: the figure is shown in
// stepped still poses along the very route the gliding presentation
// walks — every square (every node on the A* route) traversed in
// order, captions carrying the journey. A pose change is a cut between
// two ADJACENT route nodes, never a jump across the map: the pose
// sequence is the route itself, so the no-teleport invariant holds in
// its stepped form (consecutive poses are graph neighbours), and the
// engine suite runs green against Calmer unchanged (the poses are
// sampled from the same journey the invariant checks).
//
// Poses: one per route node, in traversal order, across all steps.
// A node where a step ends is the next step's start too; it appears
// once. Each pose carries its caption — under Calmer the caption IS
// the journey's narration.

import { findRoute, nodeByCode } from '../../engine/astar.mjs';
import { positionAt } from '../../engine/playback.mjs';
import { polyline, matchOnSegment } from '../../engine/invariant.mjs';

// calmerPoses(journey, layout, labelFor) ->
//   [{ index, code, x, y, stepIndex, kind, caption }]
// kind: 'depart' (the journey's first node), 'pass' (an intermediate
// route node), 'arrive' (a step's destination). The final pose is the
// journey's destination, kind 'arrive'.
export function calmerPoses(journey, layout, labelFor = (code) => code) {
  const poses = [];
  journey.steps.forEach((step, stepIndex) => {
    const route = findRoute(layout, step.from, step.to);
    if (!route) throw new Error(`calmer: no route in layout from ${step.from} to ${step.to}`);
    route.codes.forEach((code, i) => {
      const isLastOfRoute = i === route.codes.length - 1;
      if (stepIndex > 0 && i === 0) return; // step join: already posed as the previous step's arrival
      const n = nodeByCode(layout, code);
      const kind = poses.length === 0 ? 'depart' : isLastOfRoute ? 'arrive' : 'pass';
      poses.push({ index: poses.length, code, x: n.x, y: n.y, stepIndex, kind, caption: '' });
    });
  });
  if (poses.length === 0) {
    // A zero-step journey (path of one place): the single pose is the
    // place itself — the figure is simply there.
    const n = nodeByCode(layout, journey.path[0]);
    poses.push({ index: 0, code: journey.path[0], x: n.x, y: n.y, stepIndex: 0, kind: 'arrive', caption: '' });
  }
  for (const p of poses) p.caption = calmerCaption(journey, p, labelFor);
  return poses;
}

// The caption that carries the journey at one pose. Plain words, the
// figure's evidenced progress only — where it is, in route order.
export function calmerCaption(journey, pose, labelFor = (code) => code) {
  const dest = labelFor(journey.path[journey.path.length - 1]);
  if (pose.kind === 'depart') return `Setting out from ${labelFor(pose.code)} — bound for ${dest}.`;
  if (pose.kind === 'arrive' && pose.stepIndex === journey.steps.length - 1) {
    return `Arrived at ${labelFor(pose.code)}.`;
  }
  if (pose.kind === 'arrive') return `At ${labelFor(pose.code)} — continuing toward ${dest}.`;
  return `Passing ${labelFor(pose.code)} — on the way to ${dest}.`;
}

// createCalmerPlayer(journey, layout, { dwellMs, labelFor })
// A stepped player: poseAt(elapsedMs) advances one pose per dwellMs
// and holds the final pose. visitsEveryStep is the exit-gate shape:
// the ordered list of pose codes the player will show.
export function createCalmerPlayer(journey, layout, { dwellMs = 1200, labelFor } = {}) {
  if (!Number.isFinite(dwellMs) || dwellMs <= 0) {
    throw new TypeError('calmer player: dwellMs must be a positive number');
  }
  const poses = calmerPoses(journey, layout, labelFor);
  // Each pose's route distance along the journey polyline, in order —
  // the stepped position at any tick is the LAST pose whose route
  // distance playback's own continuous position has reached. Monotone
  // by construction: playback's route distance never decreases, so
  // the pose index never does either, and a pose change is always a
  // move to the NEXT route node — one graph edge, never a jump.
  const line = polyline(journey, layout);
  const poseDistances = [];
  {
    // Poses are the polyline's vertices in traversal order (route
    // codes, joins deduped exactly as the polyline builds them), so a
    // single forward scan matches each pose to its vertex; retraced
    // vertices repeat coordinates and the moving pointer keeps the
    // match monotone.
    let vi = 0;
    for (const pose of poses) {
      while (vi < line.pts.length
        && Math.hypot(line.pts[vi].x - pose.x, line.pts[vi].y - pose.y) > 1e-9) vi++;
      if (vi >= line.pts.length) throw new Error('calmer: pose fell off the journey polyline');
      poseDistances.push(line.cum[vi]);
      vi++;
    }
  }
  return {
    poses,
    dwellMs,
    visitsEveryStep: poses.map((p) => p.code),
    poseAt(elapsedMs) {
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        throw new TypeError('calmer player: elapsedMs must be a non-negative number');
      }
      const i = Math.min(poses.length - 1, Math.floor(elapsedMs / dwellMs));
      return poses[i];
    },
    // The stepped position function, in the engine's own position
    // shape. The M4.26 sampled-stream checker verifies it: on-route
    // at every sample, route distance monotone, and every change
    // exactly one graph edge.
    positionAt(tickFloat) {
      const p = positionAt(journey, layout, tickFloat);
      // Route distance of playback's position, matched monotonically:
      // poses only ever advance, so search from the last matched
      // segment onward is unnecessary here — poses are compared by
      // their precomputed distances against the position's distance
      // on the full polyline (first match wins; a retraced position
      // matching an earlier vertex still yields a pose no later than
      // the one playback has genuinely reached, because pose
      // distances are compared, not segment indices).
      let s = line.total;
      for (let i = 0; i + 1 < line.pts.length; i++) {
        const m = matchOnSegment(p, line, i);
        if (m) { s = m.s; break; }
      }
      let best = poses[0];
      for (let i = 0; i < poses.length; i++) {
        if (poseDistances[i] <= s + 1e-9) best = poses[i];
      }
      return { code: best.code, x: best.x, y: best.y, between: null, frac: 0 };
    },
  };
}
