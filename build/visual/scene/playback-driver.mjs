// Elsewhere Portal — scene playback driver (M4.16).
//
// The 3D scene's one path from the engine to figure transforms: given
// planned journeys (engine/playback.mjs planJourney), the driver
// answers "where is every driven figure at tick T" in GRID coords —
// the scene converts grid -> world with its own transform, the stream
// harness (M4.26) checks the same answers in grid space. The driver
// adds no motion of its own: every position it returns is
// playback.positionAt's, so the engine's law (continuous path on the
// route graph, arrival never early, catch-up compresses but never
// skips) is the scene's law by construction.

import { positionAt } from '../../engine/playback.mjs';

export function createDriver({ layout } = {}) {
  if (!layout) throw new TypeError('createDriver: layout is required');
  const journeys = new Map(); // key -> journey

  return {
    addJourney(key, journey) {
      if (journeys.has(key)) throw new Error(`driver: journey already added for ${key}`);
      journeys.set(key, journey);
    },
    removeJourney(key) { journeys.delete(key); },
    has(key) { return journeys.has(key); },
    keys() { return [...journeys.keys()]; },
    // One figure at one tick: playback.positionAt, verbatim shape
    // {code, x, y, between, frac}.
    positionAt(key, tickFloat) {
      const j = journeys.get(key);
      if (!j) throw new Error(`driver: no journey for ${key}`);
      return positionAt(j, layout, tickFloat);
    },
    // Every driven figure at one tick: Map<key, position>.
    frame(tickFloat) {
      const out = new Map();
      for (const [key, j] of journeys) out.set(key, positionAt(j, layout, tickFloat));
      return out;
    },
  };
}
