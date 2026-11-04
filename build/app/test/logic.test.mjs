import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  badgeFor,
  integrityTier,
  selectBundle,
  isBundle,
  isEvidenced,
  citizenCaption,
  presenceWording,
  citizenColor,
  citizenKeyOf,
  citizenPositions,
  formatCount,
  worldDuration,
  planPresentation,
  summaryPanel,
  summaryStepLine,
} from '../logic.mjs';
// The app consumes the REAL engine (M2.03: the local stand-in is retired).
import { planJourney, positionAt, catchUp } from '../../engine/playback.mjs';

// ------------------------------------------------------------- badge

test('badge: fresh data (<=90s) is LIVE', () => {
  assert.equal(badgeFor({ dataAgeSeconds: 0 }).key, 'LIVE');
  assert.equal(badgeFor({ dataAgeSeconds: 90 }).key, 'LIVE');
});

test('badge: data older than 90s is STALE', () => {
  assert.equal(badgeFor({ dataAgeSeconds: 91 }).key, 'STALE');
  assert.equal(badgeFor({ dataAgeSeconds: 86400 }).key, 'STALE');
});

test('badge: fallback sample data is never LIVE', () => {
  assert.equal(badgeFor({ dataAgeSeconds: 5, isFallback: true }).key, 'STALE');
});

test('badge: replay takes precedence over LIVE and STALE', () => {
  assert.equal(badgeFor({ dataAgeSeconds: 5, replaying: true }).key, 'REPLAY');
  assert.equal(badgeFor({ dataAgeSeconds: 5000, replaying: true }).key, 'REPLAY');
});

test('badge: loading and missing age are not LIVE', () => {
  assert.equal(badgeFor({ loading: true }).key, 'LOADING');
  assert.equal(badgeFor({}).key, 'STALE');
  assert.equal(badgeFor({ dataAgeSeconds: null }).key, 'STALE');
});

// ------------------------------------------------------- integrity

test('integrity: band edges follow Plan B 4.3', () => {
  assert.equal(integrityTier(0).key, 'shabby');
  assert.equal(integrityTier(39).key, 'shabby');
  assert.equal(integrityTier(40).key, 'plain');
  assert.equal(integrityTier(69).key, 'plain');
  assert.equal(integrityTier(70).key, 'tidy');
  assert.equal(integrityTier(99).key, 'tidy');
  assert.equal(integrityTier(100).key, 'celebrated');
});

test('integrity: null shows no health (the honest tier)', () => {
  assert.equal(integrityTier(null).key, 'none');
  assert.equal(integrityTier(undefined).key, 'none');
});

test('integrity: out-of-range values clamp', () => {
  assert.equal(integrityTier(140).key, 'celebrated');
  assert.equal(integrityTier(-5).key, 'shabby');
});

// ------------------------------------------------------- selection

const good = { schema: 'portal.world-data/v1' };

test('selectBundle: primary wins and is not fallback', () => {
  const r = selectBundle([
    { ok: true, source: 'live', data: good },
    { ok: true, source: 'sample', data: good },
  ]);
  assert.equal(r.source, 'live');
  assert.equal(r.isFallback, false);
});

test('selectBundle: falls back in order when primary fails', () => {
  const r = selectBundle([
    { ok: false, source: 'live' },
    { ok: false, source: 'shared-sample' },
    { ok: true, source: 'app-sample', data: good },
  ]);
  assert.equal(r.source, 'app-sample');
  assert.equal(r.isFallback, true);
});

test('selectBundle: returns null when nothing loaded', () => {
  assert.equal(selectBundle([{ ok: false }, { ok: false }]), null);
});

test('isBundle: requires the contract schema string', () => {
  assert.equal(isBundle(good), true);
  assert.equal(isBundle({ schema: 'other' }), false);
  assert.equal(isBundle(null), false);
});

// -------------------------------------------------------- citizens

test('isEvidenced: needs a real state and a place', () => {
  assert.equal(isEvidenced({ state: 'present', placeCode: 'EMBER_COLLEGE' }), true);
  assert.equal(isEvidenced({ state: 'unknown', placeCode: 'EMBER_COLLEGE' }), false);
  assert.equal(isEvidenced({ state: 'present', placeCode: null }), false);
});

test('captions are plain words with the citizen name first-class', () => {
  assert.match(citizenCaption({ name: 'Atlas Meridian', state: 'travelling' }, 'the College'), /Atlas Meridian is on the way/);
  assert.match(citizenCaption({ name: 'Kavi Marlow', state: 'unknown' }), /don't know where Kavi Marlow is/);
  assert.match(presenceWording({ state: 'asleep', evidenceUtc: '2026-11-01T22:56:00Z' }), /Asleep \/ away/);
});

test('citizenColor is deterministic', () => {
  assert.equal(citizenColor('atlas-meridian'), citizenColor('atlas-meridian'));
  assert.notEqual(citizenColor('atlas-meridian'), citizenColor('zzz-other-handle'));
});

// ---------------------------------------------------------- layout

const layout = {
  version: 1,
  nodes: [
    { code: 'EMBER_PLAZA_OF_UNITY', label: 'Plaza of Unity', x: 5, y: 4, kind: 'room' },
    { code: 'hall-1', label: 'Market Hall', x: 1, y: 5, kind: 'room' },
  ],
  edges: [],
};

test('resolution is exact-only: no label or keyword matching (M3.08)', () => {
  // resolveNode and its fuzzy label fallback are deleted: the only
  // resolver is resolveExactNode, a strict code equality. (Its import
  // sits with the plots section below; ESM bindings hoist.)
  assert.equal(resolveExactNode(layout, 'EMBER_PLAZA_OF_UNITY').label, 'Plaza of Unity');
  // A label is not a code: 'Market Hall' is hall-1's label, and the
  // EMBER_-prefixed spelling of it is not hall-1's code either — a
  // fuzzy rescue would invent a placement the record never made.
  assert.equal(resolveExactNode(layout, 'Market Hall'), null);
  assert.equal(resolveExactNode(layout, 'EMBER_MARKET_HALL'), null);
  assert.equal(resolveExactNode(layout, 'NOPE'), null);
});

// --------------------------------------- PORTAL-KEY keying

test('citizenKeyOf prefers the PORTAL-KEY over handle and name', () => {
  assert.equal(citizenKeyOf({ citizenKey: 'portal-key:x', handle: 'h', name: 'N' }), 'portal-key:x');
  assert.equal(citizenKeyOf({ handle: '', name: 'Nath Between' }), 'Nath Between'); // pre-M2.03 fallback
});

const keyLayout = {
  version: 1,
  nodes: [
    { code: 'EMBER_COLLEGE', label: 'The College', x: 6, y: 2, kind: 'room' },
    { code: 'EMBER_PLAZA_OF_UNITY', label: 'Plaza of Unity', x: 4, y: 4, kind: 'room' },
  ],
  edges: [],
};

test('citizenPositions: name-adjacent citizens at one place stand at distinct offsets', () => {
  const bundle = {
    citizens: [
      { citizenKey: 'portal-key:nath-between', handle: '', name: 'Nath Between', placeCode: 'EMBER_COLLEGE', state: 'asleep' },
      { citizenKey: 'portal-key:nath-borowik', handle: '', name: 'Nath Borowik', placeCode: 'EMBER_COLLEGE', state: 'present' },
      { citizenKey: 'portal-key:arabela-protoser', handle: '', name: 'Arabela Protoser', placeCode: 'EMBER_PLAZA_OF_UNITY', state: 'talking' },
      { citizenKey: 'portal-key:kessa-varn', handle: '', name: 'Kessa Varn', placeCode: null, state: 'unknown' },
    ],
  };
  const pos = citizenPositions(bundle, keyLayout);
  assert.equal(pos.size, 3); // the unknown citizen is not placed
  assert.ok(pos.has('portal-key:nath-between') && pos.has('portal-key:nath-borowik'));
  const pts = [...pos.values()].map((p) => `${p.x},${p.y}`);
  assert.equal(new Set(pts).size, 3); // all distinct, incl. the two at the College
});

test('citizenPositions: records sharing handle "" never collapse (the Wave-1 defect)', () => {
  const bundle = {
    citizens: [
      { citizenKey: 'portal-key:a-one', handle: '', name: 'A One', placeCode: 'EMBER_PLAZA_OF_UNITY', state: 'present' },
      { citizenKey: 'portal-key:b-two', handle: '', name: 'B Two', placeCode: 'EMBER_PLAZA_OF_UNITY', state: 'present' },
      { citizenKey: 'portal-key:c-three', handle: '', name: 'C Three', placeCode: 'EMBER_PLAZA_OF_UNITY', state: 'talking' },
    ],
  };
  const pos = citizenPositions(bundle, keyLayout);
  assert.equal(pos.size, 3); // keyed by PORTAL-KEY, not by the shared empty handle
});

// --------------------------------------- playback (real engine)

const jLayout = {
  version: 1,
  nodes: [
    { code: 'A', label: 'A', x: 0, y: 0, kind: 'room' },
    { code: 'B', label: 'B', x: 2, y: 0, kind: 'room' },
    { code: 'C', label: 'C', x: 2, y: 2, kind: 'room' },
  ],
  edges: [
    { a: 'A', b: 'B', seconds: 6 },
    { a: 'B', b: 'C', seconds: 6 },
  ],
};

test('playback (real engine): position walks the steps in order, never jumps', () => {
  const j = planJourney({ handle: 'x', path: ['A', 'B', 'C'], startTick: 0, ticksPerStep: 6 });
  const start = positionAt(j, jLayout, 0);
  assert.deepEqual([start.x, start.y], [0, 0]);
  const mid = positionAt(j, jLayout, 3);
  assert.deepEqual(mid.between, ['A', 'B']);
  assert.ok(mid.x > 0 && mid.x < 2 && mid.y === 0);
  const end = positionAt(j, jLayout, 12);
  assert.deepEqual([end.x, end.y], [2, 2]);
  // Path continuity: sampled positions never teleport (max step bounded).
  let prev = positionAt(j, jLayout, 0);
  for (let t = 0.25; t <= 12; t += 0.25) {
    const p = positionAt(j, jLayout, t);
    const d = Math.hypot(p.x - prev.x, p.y - prev.y);
    assert.ok(d <= 0.2, `jump of ${d} at tick ${t}`);
    prev = p;
  }
});

test('catchUp (real engine): <=6 missed steps catch up at 2.5x; beyond is replay', () => {
  const j = planJourney({ handle: 'x', path: ['A', 'B'], startTick: 0, ticksPerStep: 6 });
  assert.equal(catchUp(j, 0).mode, 'none');
  const c = catchUp(j, 3); // window from start covers the one step's start
  assert.equal(c.mode, 'catch-up');
  assert.equal(c.speed, 2.5);
  assert.equal(c.replay, false);
  const chain = planJourney({ handle: 'x', path: ['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B'], startTick: 0, ticksPerStep: 6 });
  const r = catchUp(chain, 100); // all 7 steps begin inside the window
  assert.equal(r.mode, 'replay');
  assert.equal(r.replay, true);
  assert.equal(r.speed, 8);
});

// ------------------------------------------------------------- plots (M2.06)

import { readFileSync } from 'node:fs';
import {
  effectiveLayout,
  parsePlotCode,
  plotCodeLabel,
  resolveExactNode,
} from '../logic.mjs';

const sharedLayout = JSON.parse(
  readFileSync(new URL('../../shared/ember-layout.json', import.meta.url), 'utf8'),
);

const plotBundle = (plots, citizens = []) => ({ ember: { plots, works: [] }, citizens });

test('parsePlotCode: parses true plot codes, rejects everything else', () => {
  assert.deepEqual(parsePlotCode('EMBER_DISTRICT_1_PLOT_30'), { district: 1, plot: 30 });
  assert.equal(parsePlotCode('EMBER_PLAZA_OF_UNITY'), null);
  assert.equal(parsePlotCode('EMBER_DISTRICT_1_PLOT_31_EXTRA'), null);
  assert.equal(parsePlotCode(null), null);
  assert.equal(plotCodeLabel('EMBER_DISTRICT_1_PLOT_30'), 'District 1, Plot 30');
});

test('layout: the anchor plots carry the record-attested class, not feed-evidenced', () => {
  for (const code of ['EMBER_DISTRICT_3_PLOT_18', 'EMBER_DISTRICT_1_PLOT_31']) {
    const node = resolveExactNode(sharedLayout, code);
    assert.ok(node, `${code} has a layout node`);
    assert.equal(node.kind, 'plot');
    assert.equal(node.provenanceClass, 'record-attested');
  }
});

test('effectiveLayout: an evidenced plot without a node is placed by sorted-code fill, no layout edit', () => {
  const bundle = plotBundle([{ code: 'EMBER_DISTRICT_1_PLOT_30', district: 1, plot: 30, provenanceClass: 'feed-evidenced' }]);
  const eff = effectiveLayout(sharedLayout, bundle);
  const node = resolveExactNode(eff, 'EMBER_DISTRICT_1_PLOT_30');
  assert.ok(node, 'PLOT_30 resolves on the effective layout');
  assert.equal(node.kind, 'plot');
  assert.equal(node.provenanceClass, 'feed-evidenced');
  assert.equal(node.stagedPosition, true);
  assert.equal(node.label, 'District 1, Plot 30'); // the code in plain words — no invented name
  // It joined the walk graph (an edge to the Plaza hub) and collides with no authored node.
  assert.ok((eff.edges || []).some((e) => (e.a === 'EMBER_PLAZA_OF_UNITY' && e.b === node.code) || (e.b === 'EMBER_PLAZA_OF_UNITY' && e.a === node.code)));
  assert.ok(!sharedLayout.nodes.some((n) => n.x === node.x && n.y === node.y));
  // The shared layout itself is untouched (the fill is derived, not an edit).
  assert.equal(resolveExactNode(sharedLayout, 'EMBER_DISTRICT_1_PLOT_30'), null);
});

test('effectiveLayout: fill is deterministic and order-independent', () => {
  const plots = [
    { code: 'EMBER_DISTRICT_2_PLOT_5', district: 2, plot: 5 },
    { code: 'EMBER_DISTRICT_1_PLOT_30', district: 1, plot: 30 },
    { code: 'EMBER_DISTRICT_1_PLOT_9', district: 1, plot: 9 },
  ];
  const a = effectiveLayout(sharedLayout, plotBundle(plots));
  const b = effectiveLayout(sharedLayout, plotBundle([...plots].reverse()));
  const fillA = a.nodes.filter((n) => n.stagedPosition).map((n) => [n.code, n.x, n.y]);
  const fillB = b.nodes.filter((n) => n.stagedPosition).map((n) => [n.code, n.x, n.y]);
  assert.deepEqual(fillA, fillB);
  // Sorted-code order: PLOT_9 (D1) before PLOT_30 (D1) before PLOT_5 (D2), distinct cells.
  assert.deepEqual(fillA.map((f) => f[0]), ['EMBER_DISTRICT_1_PLOT_30', 'EMBER_DISTRICT_1_PLOT_9', 'EMBER_DISTRICT_2_PLOT_5'].sort());
  assert.equal(new Set(fillA.map((f) => `${f[1]},${f[2]}`)).size, 3);
  // Nothing to fill => the layout is returned unchanged.
  assert.equal(effectiveLayout(sharedLayout, plotBundle([])), sharedLayout);
});

test('citizenPositions: citizens at the anchor plots and at PLOT_30 all stand', () => {
  const bundle = plotBundle(
    [{ code: 'EMBER_DISTRICT_1_PLOT_30', district: 1, plot: 30, provenanceClass: 'feed-evidenced' }],
    [
      { citizenKey: 'portal-key:at-press', handle: '', name: 'At Press', placeCode: 'EMBER_DISTRICT_1_PLOT_31', state: 'talking' },
      { citizenKey: 'portal-key:at-hall', handle: '', name: 'At Hall', placeCode: 'EMBER_DISTRICT_3_PLOT_18', state: 'present' },
      { citizenKey: 'portal-key:at-plot30', handle: '', name: 'At Plot30', placeCode: 'EMBER_DISTRICT_1_PLOT_30', state: 'talking' },
    ],
  );
  const pos = citizenPositions(bundle, sharedLayout);
  assert.equal(pos.size, 3);
  assert.equal(pos.get('portal-key:at-press').code, 'EMBER_DISTRICT_1_PLOT_31');
  assert.equal(pos.get('portal-key:at-hall').code, 'EMBER_DISTRICT_3_PLOT_18');
  assert.equal(pos.get('portal-key:at-plot30').code, 'EMBER_DISTRICT_1_PLOT_30');
});

test('citizenPositions: an unevidenced plot code gets NO position (negative control)', () => {
  // EMBER_DISTRICT_3_PLOT_41 is attested only in chats, which is never
  // evidence: it is in no layout node and in no bundle plots list, so a
  // citizen reported there must stay roster-only — no invented geometry,
  // and no fuzzy label rescue (PLOT_41's key resembles the PLOT_18 node).
  const bundle = plotBundle([], [
    { citizenKey: 'portal-key:ghost', handle: '', name: 'Ghost', placeCode: 'EMBER_DISTRICT_3_PLOT_41', state: 'talking' },
  ]);
  const pos = citizenPositions(bundle, sharedLayout);
  assert.equal(pos.has('portal-key:ghost'), false);
  assert.equal(resolveExactNode(effectiveLayout(sharedLayout, bundle), 'EMBER_DISTRICT_3_PLOT_41'), null);
});

test('negative control (M3.08): near-miss and survivor codes resolve to NOTHING', () => {
  // The shared layout's real code is MARKET_HALL. Two strings must NOT
  // resolve to it: EMBER_MARKET_HAL (a near-miss of the real code) and
  // EMBER_MARKET_HALL (the VER-D07 survivor string the deleted fuzzy
  // fallback used to rescue by label matching). Guessing either onto
  // the Market Hall node would place a citizen at a place the record
  // never named — so both resolve to null and their citizens stay
  // roster-only, with no position at all.
  assert.equal(resolveExactNode(sharedLayout, 'MARKET_HALL').label, 'Market Hall');
  assert.equal(resolveExactNode(sharedLayout, 'EMBER_MARKET_HAL'), null);
  assert.equal(resolveExactNode(sharedLayout, 'EMBER_MARKET_HALL'), null);
  const bundle = plotBundle([], [
    { citizenKey: 'portal-key:near-miss', handle: '', name: 'Near Miss', placeCode: 'EMBER_MARKET_HAL', state: 'present' },
    { citizenKey: 'portal-key:survivor', handle: '', name: 'Survivor', placeCode: 'EMBER_MARKET_HALL', state: 'present' },
  ]);
  const pos = citizenPositions(bundle, sharedLayout);
  assert.equal(pos.has('portal-key:near-miss'), false);
  assert.equal(pos.has('portal-key:survivor'), false);
  assert.equal(pos.size, 0);
});

// --------------------------------- deterministic counts

test('formatCount: fixed thousands grouping, identical on every runtime', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(999), '999');
  assert.equal(formatCount(1000), '1,000');
  assert.equal(formatCount(1234567), '1,234,567');
  assert.equal(formatCount(5821), '5,821'); // the frontier counters' shape
  assert.equal(formatCount(-1234), '-1,234');
});

test('worldDuration: plain words from world ticks (1 tick = 30 s)', () => {
  assert.equal(worldDuration(1), '30 seconds');
  assert.equal(worldDuration(2), '1 minute');
  assert.equal(worldDuration(5), '2 minutes 30 seconds');
  assert.equal(worldDuration(120), '1 hour');
  assert.equal(worldDuration(0), 'no time');
});

// --------------------------------- path summary (Plan B §3.4)

test('path-summary plan: steps are listed, never queued for animation', () => {
  const j = planJourney({ handle: 'x', path: ['A', 'B', 'C'], startTick: 0, ticksPerStep: 6 });
  const plan = catchUp(j, 12, { absenceTicks: 121 }); // absence over an hour
  assert.equal(plan.mode, 'path-summary');
  assert.deepEqual(plan.steps, []); // the playback queue is empty — nothing to animate
  assert.equal(plan.totalShownSeconds, 0);
  assert.equal(plan.summarySteps.length, 2);
  // The figure's evidenced place is the journey's end.
  const end = positionAt(j, jLayout, plan.arrivalTick);
  assert.deepEqual([end.x, end.y], [2, 2]);
  // The panel model lists every summarised step: times + place labels.
  const labels = { A: 'Alpha', B: 'Beta', C: 'Gamma' };
  const panel = summaryPanel(plan, 'Test Person', (code) => labels[code] || code);
  assert.equal(panel.heading, 'While you were away');
  assert.match(panel.intro, /lists the journey from the record instead of playing it back/);
  assert.equal(panel.lines.length, 2);
  assert.match(panel.lines[0], /Alpha → Beta/);
  assert.match(panel.lines[0], /3 minutes of world time/);
  assert.match(panel.lines[1], /Beta → Gamma/);
  assert.match(panel.closing, /Gamma/);
  assert.match(panel.closing, /listed, not played/);
});

test('summaryPanel: null for plans that play (catch-up / none) and for no plan', () => {
  const j = planJourney({ handle: 'x', path: ['A', 'B', 'C'], startTick: 0, ticksPerStep: 6 });
  assert.equal(summaryPanel(catchUp(j, 3), 'X', (c) => c), null);
  assert.equal(summaryPanel(catchUp(j, 0), 'X', (c) => c), null);
  assert.equal(summaryPanel(null, 'X', (c) => c), null);
});

test('summaryStepLine: a near-reach step discloses its zero world time', () => {
  const j = planJourney({ handle: 'x', path: ['A', 'B', 'C'], startTick: 0, ticksPerStep: [0, 6] });
  const plan = catchUp(j, 12, { absenceTicks: 200 });
  assert.equal(plan.mode, 'path-summary');
  assert.equal(plan.summarySteps[0].nearReach, true);
  assert.match(summaryStepLine(plan.summarySteps[0], (c) => c), /charges this step no time/);
});

// --------------------------------- replay badge state

test('replay plan: the presentation exposes the REPLAY badge state', () => {
  const chain = planJourney({ handle: 'x', path: ['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B'], startTick: 0, ticksPerStep: 6 });
  const plan = catchUp(chain, 100); // 7 missed steps, absence within the hour
  assert.equal(plan.mode, 'replay');
  const pres = planPresentation(plan);
  assert.equal(pres.showReplayBadge, true);
  assert.equal(pres.isSummary, false);
  assert.equal(badgeFor({ replaying: pres.showReplayBadge }).key, 'REPLAY');
  // Catch-up and summary plans never raise the badge.
  const c = catchUp(planJourney({ handle: 'x', path: ['A', 'B'], startTick: 0, ticksPerStep: 6 }), 3);
  assert.equal(planPresentation(c).showReplayBadge, false);
  const s = catchUp(chain, 100, { absenceTicks: 121 });
  assert.equal(planPresentation(s).isSummary, true);
  assert.equal(planPresentation(s).showReplayBadge, false);
  assert.equal(planPresentation(null).showReplayBadge, false);
});
