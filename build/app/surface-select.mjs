// Elsewhere Portal — surface selection + the 2D fallback follow
// (M4.17, SE-4.5).
//
// The 3D scene is the primary surface; the 2D app is the FULL
// fallback — not a reduced page — for low-power devices, WebGL
// failure, and reduced motion. Selection is a pure decision so the
// headless gate can run it: WebGL unavailable (or a caller-declared
// low-power / reduced-motion preference) selects the 2D surface.
//
// runFallbackFollow is the fallback's proof of completeness: with
// the 3D surface off, a follow journey still completes — planned by
// the same engine, walked by the same positionAt app.js's frame loop
// calls, arriving at the scheduled place at the scheduled tick.

import { planJourney, positionAt } from '../engine/playback.mjs';

export function selectSurface({ webglAvailable = true, lowPower = false, reducedMotion = false } = {}) {
  if (!webglAvailable) return { surface: 'app2d', reason: 'WebGL unavailable — full 2D fallback' };
  if (lowPower) return { surface: 'app2d', reason: 'low-power device — full 2D fallback' };
  if (reducedMotion) return { surface: 'app2d', reason: 'reduced motion — 2D surface (Calmer steps the 3D one)' };
  return { surface: 'scene3d', reason: 'WebGL available — 3D scene' };
}

// Walk a follow journey on the 2D surface to completion.
// spec: the demo-journey shape {handle, path, startTick, ticksPerStep}.
// Returns { arrivedCode, arrivalTick, samples } — arrival exactly at
// the journey's endTick, at the journey's final place.
export function runFallbackFollow({ layout, spec, dt = 0.05 }) {
  const journey = planJourney({
    handle: spec.handle, path: spec.path, startTick: spec.startTick, ticksPerStep: spec.ticksPerStep,
  });
  let samples = 0;
  let last = null;
  for (let t = journey.startTick; t <= journey.endTick; t += dt) {
    last = positionAt(journey, layout, t);
    samples++;
  }
  const end = positionAt(journey, layout, journey.endTick);
  return {
    arrivedCode: end.code,
    arrivalTick: journey.endTick,
    finalPosition: { x: end.x, y: end.y, between: end.between },
    samples,
    lastBeforeEnd: last,
  };
}
