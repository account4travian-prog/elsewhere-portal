// held-figure.test.mjs — OM15-C2: the held figure's on-stage
// treatment. My Hark's OM-15 condition 2: a citizen under a
// place-conflict HOLD stands at a place the record no longer
// supports, and a viewer reads the map before the card — so the
// figure itself must render visibly different (ghosted + dashed
// amber ring + a ≠ marker), decided in ONE pure model
// (logic.figureStyle) that both the 2D stage and the 3D scene
// consume. These tests drive a real M3.04 tracker to a genuine
// conflict rather than hand-shaping placement snapshots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createPlacementTracker,
  applyBundlePlacements,
  placementStates,
  figureStyle,
  HELD_RING_COLOR,
  HELD_MARKER_GLYPH,
  ASLEEP_OPACITY,
} from '../logic.mjs';

const nia = (placeCode, evidenceUtc, state = 'talking') => ({
  citizenKey: 'portal-key:nia-okafor', handle: '', name: 'Nia Okafor',
  state, placeCode, evidenceUtc,
});
const bundle = (citizen, seq) => ({
  schema: 'portal.world-data/v2', bundleSeq: seq,
  citizens: [citizen], ember: { plots: [], works: [] }, ticker: [],
});
const KEY = 'portal-key:nia-okafor';

// College (11:00) → Market Hall (12:00) → Library Annex (12:00:10,
// same tick — conflict, held at College) → Library Annex (12:01 —
// the record names one place again; the hold lifts).
const B1 = bundle(nia('EMBER_COLLEGE', '2026-11-02T11:00:00.000Z'), 1);
const B2 = bundle(nia('MARKET_HALL', '2026-11-02T12:00:00.000Z'), 2);
const B3 = bundle(nia('LIBRARY_ANNEX', '2026-11-02T12:00:10.000Z'), 3);
const B4 = bundle(nia('LIBRARY_ANNEX', '2026-11-02T12:01:00.000Z'), 4);

function trackerThrough(bundles) {
  const tr = createPlacementTracker();
  for (const b of bundles) applyBundlePlacements(tr, b);
  return tr;
}
const stateOf = (tr, b) => placementStates(tr, b).get(KEY);

// ------------------------------------------------------------ normal / asleep

test('figureStyle: an ordinary placed citizen is drawn plain', () => {
  const s = figureStyle(nia('EMBER_COLLEGE', '2026-11-02T11:00:00.000Z'), null);
  assert.equal(s.treatment, 'normal');
  assert.equal(s.opacity, 1);
  assert.equal(s.ring, null);
  assert.equal(s.marker, null);
});

test('figureStyle: asleep is faded only — no ring, no marker', () => {
  const s = figureStyle(nia('EMBER_COLLEGE', '2026-11-02T11:00:00.000Z', 'asleep'), null);
  assert.equal(s.treatment, 'asleep');
  assert.equal(s.opacity, ASLEEP_OPACITY);
  assert.equal(s.opacity, 0.55); // the 3D scaffold's long-standing value, now shared
  assert.equal(s.ring, null);
  assert.equal(s.marker, null);
});

test('figureStyle: a tracked placement WITHOUT a conflict does not hold the figure', () => {
  const tr = trackerThrough([B1]);
  const s = figureStyle(B1.citizens[0], stateOf(tr, B1));
  assert.equal(s.treatment, 'normal');
  // …and an asleep citizen with a clean placement stays asleep-treated.
  const trA = trackerThrough([bundle(nia('EMBER_COLLEGE', '2026-11-02T11:00:00.000Z', 'asleep'), 1)]);
  const bA = bundle(nia('EMBER_COLLEGE', '2026-11-02T11:00:00.000Z', 'asleep'), 1);
  assert.equal(figureStyle(bA.citizens[0], stateOf(trA, bA)).treatment, 'asleep');
});

// --------------------------------------------------------------------- held

test('figureStyle: a citizen under a place-conflict HOLD gets the held treatment', () => {
  const tr = trackerThrough([B1, B2, B3]);
  const placement = stateOf(tr, B3);
  assert.ok(placement?.conflict, 'the scripted stream really conflicts');
  const s = figureStyle(B3.citizens[0], placement);
  assert.equal(s.treatment, 'held');
  assert.ok(s.opacity < 1, 'ghosted, not solid');
  assert.deepEqual(s.ring.dash, [5, 4], 'the ring is dashed');
  assert.equal(s.ring.color, HELD_RING_COLOR);
  assert.equal(s.ring.color, '#d9a441', 'the conflict section amber (styles.css .conflict)');
  assert.equal(s.marker.glyph, HELD_MARKER_GLYPH);
  assert.equal(s.marker.glyph, '≠');
  assert.equal(s.marker.color, HELD_RING_COLOR);
});

test('figureStyle: held cannot be confused with asleep — the ring and marker carry it', () => {
  const tr = trackerThrough([B1, B2, B3]);
  const held = figureStyle(B3.citizens[0], stateOf(tr, B3));
  const asleep = figureStyle(nia('EMBER_COLLEGE', '2026-11-02T11:00:00.000Z', 'asleep'), null);
  // Both are faded; opacity is deliberately NOT the distinction.
  assert.ok(held.opacity < 1 && asleep.opacity < 1);
  assert.equal(asleep.ring, null);
  assert.equal(asleep.marker, null);
  assert.ok(held.ring && held.marker, 'held adds two marks asleep never has');
});

test('figureStyle: held beats asleep — a held citizen who is also asleep shows HELD', () => {
  // The same script, with Nia asleep throughout: her claims still
  // place her (placementObservations keeps an asleep citizen's
  // place), so the same-tick pair still conflicts.
  const a1 = bundle(nia('EMBER_COLLEGE', '2026-11-02T11:00:00.000Z', 'asleep'), 1);
  const a2 = bundle(nia('MARKET_HALL', '2026-11-02T12:00:00.000Z', 'asleep'), 2);
  const a3 = bundle(nia('LIBRARY_ANNEX', '2026-11-02T12:00:10.000Z', 'asleep'), 3);
  const tr = trackerThrough([a1, a2, a3]);
  const placement = stateOf(tr, a3);
  assert.ok(placement?.conflict, 'asleep claims conflict the same way');
  const s = figureStyle(a3.citizens[0], placement);
  assert.equal(s.treatment, 'held', 'the unsupported placement is the stronger signal');
  assert.ok(s.ring && s.marker);
});

test('figureStyle: when the record names one place again, the treatment lifts with the hold', () => {
  const tr = trackerThrough([B1, B2, B3, B4]);
  const placement = stateOf(tr, B4);
  assert.ok(!placement?.conflict, 'the scripted stream resolves');
  assert.equal(figureStyle(B4.citizens[0], placement).treatment, 'normal');
});

// ------------------------------------------------------------ wiring pins
// The model is only a pin if the renderers actually consume it.
// Source censuses in the sample-banner/escaping pattern: the 2D
// stage must ask figureStyle per citizen with the tracker's state,
// and the 3D scene must import the same function behind its
// documented heldKeys seam.

test('wiring: the 2D stage draws every bundle citizen through figureStyle with its placement state', () => {
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(src, /figureStyle\(c, placeStates\.get\(key\) \|\| null\)/);
  assert.match(src, /style\.ring/);
  assert.match(src, /style\.marker/);
});

test('wiring: the 3D scene consumes the same figureStyle behind the heldKeys seam', () => {
  const src = readFileSync(new URL('../../visual/scene/scene.mjs', import.meta.url), 'utf8');
  assert.match(src, /figureStyle/);
  assert.match(src, /heldKeys/);
  assert.match(src, /figureStyle\(c, heldKeys\.has\(key\)/);
});
