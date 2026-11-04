// placement-hold.test.mjs — M3.04 / SE-2.5 at the presentation layer:
// the place-conflict HOLD on stage positions, the inspector's
// conflict section, labelled exits/entries in ticker + roster, and
// the §7.3 harness rule — the disclosure FLAG is asserted, not just
// the path. The tracker's semantics are engine-tested
// (engine/test/conflicts.test.mjs); here the models are driven by
// successive BUNDLES, the way the app consumes them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlacementTracker,
  applyBundlePlacements,
  placementStates,
  placementObservations,
  heldCitizenPositions,
  conflictModel,
  placementEventLines,
  exitStagingFor,
  watchdogLine,
  citizenCardHtml,
  tickerListHtml,
  rosterListHtml,
} from '../logic.mjs';
import {
  CONFLICT_DISCLOSURE,
  EXIT_DISCLOSURE,
  ENTRY_DISCLOSURE,
  assessJourney,
} from '../../engine/conflicts.mjs';
import { planJourney } from '../../engine/playback.mjs';

const layout = {
  version: 1,
  nodes: [
    { code: 'EMBER_COLLEGE', label: 'The College', x: 6, y: 2, kind: 'room' },
    { code: 'MARKET_HALL', label: 'Market Hall', x: 1, y: 5, kind: 'room' },
    { code: 'LIBRARY_ANNEX', label: 'Library Annex', x: 2, y: 2, kind: 'room' },
    { code: 'EMBER_PLAZA_OF_UNITY', label: 'Plaza of Unity', x: 4, y: 4, kind: 'room' },
    { code: 'EMBER_TOWNHALL', label: 'Town Hall', x: 5, y: 1, kind: 'room' },
    { code: 'ISOLATED_PLOT', label: 'Isolated Plot', x: 9, y: 9, kind: 'plot' },
  ],
  edges: [
    { a: 'EMBER_COLLEGE', b: 'EMBER_PLAZA_OF_UNITY', seconds: 8 },
    { a: 'EMBER_COLLEGE', b: 'EMBER_TOWNHALL', seconds: 7 },
    { a: 'MARKET_HALL', b: 'EMBER_PLAZA_OF_UNITY', seconds: 8 },
    { a: 'LIBRARY_ANNEX', b: 'EMBER_PLAZA_OF_UNITY', seconds: 8 },
  ],
};
const labelFor = (code) => layout.nodes.find((n) => n.code === code)?.label || code;

const nia = (placeCode, evidenceUtc, state = 'talking') => ({
  citizenKey: 'portal-key:nia-okafor', handle: '', name: 'Nia Okafor',
  state, placeCode, evidenceUtc,
});
const bundle = (citizen, seq) => ({
  schema: 'portal.world-data/v2', bundleSeq: seq,
  citizens: [citizen], ember: { plots: [], works: [] }, ticker: [],
});

// The script: College (11:00) → Market Hall (12:00) → Library Annex
// (12:00:10, same tick — conflict) → Library Annex (12:01 — resolves)
// → unknown (12:02 — exit) → College (12:03 — entry).
const B1 = bundle(nia('EMBER_COLLEGE', '2026-11-02T11:00:00.000Z'), 1);
const B2 = bundle(nia('MARKET_HALL', '2026-11-02T12:00:00.000Z'), 2);
const B3 = bundle(nia('LIBRARY_ANNEX', '2026-11-02T12:00:10.000Z'), 3);
const B4 = bundle(nia('LIBRARY_ANNEX', '2026-11-02T12:01:00.000Z'), 4);
const B5 = bundle(nia(null, '2026-11-02T12:02:00.000Z', 'unknown'), 5);
const B6 = bundle(nia('EMBER_COLLEGE', '2026-11-02T12:03:00.000Z'), 6);

function scriptedTracker() {
  const tr = createPlacementTracker();
  const all = [];
  for (const b of [B1, B2, B3, B4, B5, B6]) all.push(...applyBundlePlacements(tr, b));
  return { tr, all };
}

// ------------------------------------------------------------ observations

test('placementObservations: an unknown citizen is an unplaced claim; an asleep one keeps its place', () => {
  const [gone] = placementObservations(B5);
  assert.equal(gone.placeCode, null);
  assert.equal(gone.key, 'portal-key:nia-okafor');
  assert.equal(gone.bundleSeq, 5);
  const [asleep] = placementObservations(bundle(nia('EMBER_COLLEGE', '2026-11-02T11:00:00.000Z', 'asleep'), 1));
  assert.equal(asleep.placeCode, 'EMBER_COLLEGE');
});

// ------------------------------------------------------------ held positions

test('held positions: the figure follows unconflicted placements — and NOT a conflicted one', () => {
  const tr = createPlacementTracker();
  applyBundlePlacements(tr, B1);
  assert.equal(heldCitizenPositions(B1, layout, tr).get('portal-key:nia-okafor').code, 'EMBER_COLLEGE');
  applyBundlePlacements(tr, B2);
  assert.equal(heldCitizenPositions(B2, layout, tr).get('portal-key:nia-okafor').code, 'MARKET_HALL');
  applyBundlePlacements(tr, B3); // same-tick contradiction with B2's claim
  // The bundle says Library Annex; the stage keeps the figure at the
  // last place the record AGREED on — the College (the placement
  // before the contradicted window opened).
  assert.equal(heldCitizenPositions(B3, layout, tr).get('portal-key:nia-okafor').code, 'EMBER_COLLEGE');
  applyBundlePlacements(tr, B4); // a later, single claim resolves it
  assert.equal(heldCitizenPositions(B4, layout, tr).get('portal-key:nia-okafor').code, 'LIBRARY_ANNEX');
});

test('held positions: an exited citizen is not drawn; an entered one is, at the evidenced place', () => {
  const tr = createPlacementTracker();
  for (const b of [B1, B2, B3, B4]) applyBundlePlacements(tr, b);
  applyBundlePlacements(tr, B5);
  assert.equal(heldCitizenPositions(B5, layout, tr).has('portal-key:nia-okafor'), false);
  applyBundlePlacements(tr, B6);
  assert.equal(heldCitizenPositions(B6, layout, tr).get('portal-key:nia-okafor').code, 'EMBER_COLLEGE');
});

// ------------------------------------------------------------ inspector

test('conflict model + card: both claims surface with labels and evidence stamps, held place named', () => {
  const tr = createPlacementTracker();
  for (const b of [B1, B2, B3]) applyBundlePlacements(tr, b);
  const model = conflictModel(tr, 'portal-key:nia-okafor', labelFor);
  assert.ok(model);
  assert.deepEqual(model.claims.map((c) => c.placeLabel), ['Market Hall', 'Library Annex']);
  assert.deepEqual(model.claims.map((c) => c.evidenceUtc), ['2026-11-02T12:00:00.000Z', '2026-11-02T12:00:10.000Z']);
  assert.equal(model.heldPlaceLabel, 'The College');
  assert.equal(model.disclosure, CONFLICT_DISCLOSURE);

  const card = citizenCardHtml(B3.citizens[0], labelFor, model);
  assert.ok(card.includes('Place conflict — Portal is holding this figure.'));
  assert.ok(card.includes('Market Hall') && card.includes('Library Annex'));
  assert.ok(card.includes('2026-11-02T12:00:00.000Z') && card.includes('2026-11-02T12:00:10.000Z'));
  assert.ok(card.includes('Held at The College'));
  assert.ok(card.includes('Portal will not guess which one is right'));
  // And without a conflict, the card carries no conflict section.
  const plain = citizenCardHtml(B1.citizens[0], labelFor, null);
  assert.ok(!plain.includes('Place conflict'));
});

// ------------------------------------------------------------ ticker lines (§7.3: flags asserted)

test('placement lines: exit/entry carry staging === true and their disclosures (§7.3 asserts the FLAG)', () => {
  const { all } = scriptedTracker();
  const lines = placementEventLines(all, () => 'Nia Okafor', labelFor);
  const byKind = new Map(lines.map((l) => [l.kind, l]));

  const exit = byKind.get('exit');
  assert.ok(exit, 'an exit line exists');
  assert.equal(exit.staging, true);
  assert.equal(exit.disclosure, EXIT_DISCLOSURE);
  assert.ok(exit.text.includes('the feeds stopped placing them'));
  assert.ok(exit.text.includes('That is not the same as leaving the town.'));
  assert.ok(exit.text.includes('Library Annex')); // last place in the record

  const entry = byKind.get('entry');
  assert.ok(entry, 'an entry line exists');
  assert.equal(entry.staging, true);
  assert.equal(entry.disclosure, ENTRY_DISCLOSURE);
  assert.ok(entry.text.includes('is in the public feeds Portal reads again'));
  assert.ok(entry.text.includes('The College'));

  const conflict = byKind.get('place-conflict');
  assert.ok(conflict, 'a conflict line exists');
  assert.equal(conflict.hold, true);
  assert.equal(conflict.staging, false);
  assert.equal(conflict.disclosure, CONFLICT_DISCLOSURE);
  assert.ok(conflict.text.includes('Market Hall and Library Annex'));

  const resolved = byKind.get('conflict-resolved');
  assert.ok(resolved && resolved.text.includes('the place-conflict hold is lifted'));

  // Ordinary moves are journeys' business, not ticker lines.
  assert.ok(!lines.some((l) => l.kind === 'move'));
});

test('ticker HTML: movement lines ride above the news, flagged as staging; no lines = byte-identical list', () => {
  const { all } = scriptedTracker();
  const lines = placementEventLines(all, () => 'Nia Okafor', labelFor);
  const withNews = { ...B6, ticker: [{ kind: 'News', text: 'A bell rang.', utc: '2026-11-02T12:03:00.000Z' }] };
  const html = tickerListHtml(withNews, lines);
  assert.ok(html.indexOf('class="movement"') !== -1 && html.indexOf('class="movement"') < html.indexOf('A bell rang.'));
  assert.ok(html.includes('Staging — not witnessed')); // exit/entry marker
  assert.ok(html.includes('· Hold')); // conflict marker
  assert.equal(tickerListHtml(withNews), tickerListHtml(withNews, []));
  assert.ok(!tickerListHtml(withNews).includes('movement'));
});

// ------------------------------------------------------------ roster labels

test('roster: an exited citizen is labelled out of the public feeds — not vanished, not "left"', () => {
  const tr = createPlacementTracker();
  for (const b of [B1, B2, B3, B4, B5]) applyBundlePlacements(tr, b);
  const html = rosterListHtml(B5, labelFor, placementStates(tr, B5));
  assert.ok(html.includes('Out of the public feeds Portal reads right now — the feeds stopped placing them.'));
  assert.ok(html.includes('That is not the same as leaving the town.'));
});

test('roster: a conflicted citizen is labelled held, with the held place', () => {
  const tr = createPlacementTracker();
  for (const b of [B1, B2, B3]) applyBundlePlacements(tr, b);
  const html = rosterListHtml(B3, labelFor, placementStates(tr, B3));
  assert.ok(html.includes('Place conflict — held at The College'));
});

// ------------------------------------------------------------ staging geometry

test('exitStagingFor: a connected place exits by a walk to its first street; an isolated place fades', () => {
  // The College's streets by code order: Plaza before Town Hall.
  assert.deepEqual(exitStagingFor(layout, 'EMBER_COLLEGE'), { kind: 'walk', from: 'EMBER_COLLEGE', to: 'EMBER_PLAZA_OF_UNITY' });
  assert.deepEqual(exitStagingFor(layout, 'ISOLATED_PLOT'), { kind: 'fade', from: 'ISOLATED_PLOT', to: null });
});

// ------------------------------------------------------------ watchdog line

test('watchdogLine: the paused caption is §3.5\u2019s copy with the place LABEL', () => {
  const journey = planJourney({
    handle: 'portal-key:nia-okafor',
    path: ['LIBRARY_ANNEX', 'EMBER_COLLEGE'],
    startTick: 100,
    ticksPerStep: 6,
  });
  const paused = assessJourney(journey, layout, { nowTick: 100 + 12 + 6 + 1, perfTick: 103 });
  assert.equal(paused.state, 'paused');
  assert.equal(watchdogLine(paused, labelFor), 'on the way to The College — Portal has no newer word');
  assert.equal(watchdogLine({ state: 'en-route' }, labelFor), null);
  assert.equal(watchdogLine(null, labelFor), null);
});
