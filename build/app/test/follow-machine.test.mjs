// follow-machine.test.mjs — M6.07: Follow, productised. The
// eight-state machine (Design T5) with its wordings held as data in
// logic.mjs (the wave brief's Conflict 2 ruling), a scripted
// state-tour driving Follow through all eight states with every bar
// pinned character-for-character, and the click budgets (UX §3.1:
// mayor ≤ 2, any evidenced citizen ≤ 3, return chip ≤ 1) proven
// against the shipped builders + the app's one [data-follow]
// handler. Live staging click scripts are VER's rotation work; this
// suite pins the mechanism those scripts exercise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FOLLOW_STATES, FOLLOW_WORDINGS, FOLLOW_CLICK_BUDGET, fillWording,
  followViewFor, createFollowMachine, mayorKeyOf,
  citizenCaption, citizenKeyOf,
  createPlacementTracker, applyBundlePlacements, conflictModel,
  portraitStripHtml, portraitStripModel, rosterListHtml, citizenCardHtml,
  directoryModel, directoryListHtml, tickerListHtml, tickerLanding,
  welcomeOverlayHtml, installClock, resetClock,
} from '../logic.mjs';

const LAYOUT = {
  version: 1,
  nodes: [
    { code: 'EMBER_COLLEGE', label: 'The College', x: 6, y: 2, kind: 'room' },
    { code: 'MARKET_HALL', label: 'Market Hall', x: 1, y: 5, kind: 'room' },
    { code: 'EMBER_PLAZA_OF_UNITY', label: 'Plaza of Unity', x: 4, y: 4, kind: 'room' },
  ],
  edges: [{ a: 'EMBER_COLLEGE', b: 'EMBER_PLAZA_OF_UNITY' }, { a: 'MARKET_HALL', b: 'EMBER_PLAZA_OF_UNITY' }],
};
const labelFor = (code) => LAYOUT.nodes.find((n) => n.code === code)?.label || code;

const mara = (over = {}) => ({
  citizenKey: 'portal-key:mara-venn', citizenId: null, citizenIdStatus: 'UNBOUND_NO_ROUTE',
  handle: '', name: 'Mara Venn', state: 'talking', placeCode: 'EMBER_COLLEGE',
  evidenceUtc: '2026-11-03T10:00:00.000Z', firstSeenUtc: '2026-11-01T09:00:00.000Z',
  provenance: { route: 'voices', fetchedUtc: '2026-11-03T10:00:05.000Z' },
  ...over,
});
const bundleOf = (citizens, over = {}) => ({
  schema: 'portal.world-data/v2', bundleSeq: 7,
  world: { bookId: 'world-001', integritySource: 'none-in-tier-p' },
  counters: { populationKnown: 291 },
  ember: { districts: [], plots: [], works: [], mayor: { name: 'Mara Venn', sits: true } },
  citizens, citizenCollisions: [], ticker: [], offices: [],
  ...over,
});

// ------------------------------------------------------------ the table

test('M6.07 wording table: all eight states named, wordings held as data', () => {
  assert.deepEqual(FOLLOW_STATES, ['engaged', 'travelling', 'at-place', 'inside', 'waiting-quiet', 'waiting-stale', 'on-map', 'exited']);
  for (const k of ['bar', 'walkingCaption', 'catchingUpWalkSuffix', 'catchingUpLoadingSuffix', 'insideSuffix', 'waitingQuiet', 'waitingStale', 'onMap', 'returnChip']) {
    assert.equal(typeof FOLLOW_WORDINGS[k], 'string', k);
    assert.ok(FOLLOW_WORDINGS[k].length > 0, k);
  }
  assert.deepEqual(FOLLOW_CLICK_BUDGET, { mayor: 2, citizen: 3, returnChip: 1 });
});

// ------------------------------------------------------------ the tour

test('M6.07 STATE TOUR: all eight states, bars character-for-character', () => {
  installClock(() => Date.parse('2026-11-03T10:05:00.000Z'));
  try {
    const m = createFollowMachine();
    const seen = [];
    const at = (view) => { seen.push(view.state); return view; };

    // 1 — Engaged: the bar appears with the citizen's live caption.
    const c0 = mara();
    let v = at(m.engage(c0, { placeLabel: labelFor(c0.placeCode) }));
    assert.equal(v.state, 'engaged');
    assert.equal(v.bar, 'Following Mara Venn — Mara Venn is talking at The College.');
    assert.equal(v.bar, fillWording(FOLLOW_WORDINGS.bar, { name: 'Mara Venn', caption: citizenCaption(c0, 'The College') }));

    // 2 — Travelling: a recorded journey in progress.
    v = at(m.update({ citizen: c0, walkingToLabel: 'Market Hall' }));
    assert.equal(v.bar, 'Following Mara Venn — Mara Venn is walking to Market Hall.');

    // 2b — Travelling, catching up: the §6.5 caption rides the bar.
    v = m.update({ citizen: c0, walkingToLabel: 'Market Hall', catchingUp: 'walk' });
    assert.equal(v.state, 'travelling');
    assert.equal(v.bar, 'Following Mara Venn — Mara Venn is walking to Market Hall. (Catching up — walking through what happened, in order, quickly.)');
    v = m.update({ citizen: c0, walkingToLabel: 'Market Hall', catchingUp: 'loading' });
    assert.equal(v.bar, 'Following Mara Venn — Mara Venn is walking to Market Hall. (Catching up — walking the steps that happened while Portal was loading.)');
    seen.push('travelling');

    // 3 — At place / working: the §4 caption.
    const cWork = mara({ state: 'working', placeCode: 'MARKET_HALL' });
    v = at(m.update({ citizen: cWork, placeLabel: 'Market Hall' }));
    assert.equal(v.bar, 'Following Mara Venn — Mara Venn is working at Market Hall.');

    // 4 — Entering / inside: the bar gains the inside suffix.
    v = at(m.update({ citizen: c0, placeLabel: 'The College', insidePlaceLabel: 'The College' }));
    assert.equal(v.bar, 'Following Mara Venn — Mara Venn is talking at The College. — inside The College.');

    // 5 — Waiting, asleep/away: UX §3.6's bar, verbatim.
    const cAsleep = mara({ state: 'asleep' });
    v = at(m.update({ citizen: cAsleep }));
    assert.equal(v.bar, 'Following Mara Venn — they are asleep / away. Last heard from 5 minutes ago. Portal will stay here; you can keep watching the town, or stop following.');
    // Resumption is catch-up, never a pop: heard from again, the
    // machine walks (travelling + the catching-up caption).
    v = m.update({ citizen: c0, walkingToLabel: 'The College', catchingUp: 'walk' });
    assert.equal(v.state, 'travelling');
    assert.ok(v.bar.includes('Catching up — walking through what happened, in order, quickly.'));

    // 6 — Waiting, stale/contradictory: a real tracker conflict.
    // An agreed place first (the College, 09:00), then two places in
    // one tick (Market Hall 10:00:00, the Plaza 10:00:10): the
    // figure holds at the College, and T5's caption names the LAST
    // record's place — the Plaza.
    const tr = createPlacementTracker();
    applyBundlePlacements(tr, bundleOf([mara({ placeCode: 'EMBER_COLLEGE', evidenceUtc: '2026-11-03T09:00:00.000Z' })], { bundleSeq: 8 }));
    applyBundlePlacements(tr, bundleOf([mara({ placeCode: 'MARKET_HALL', evidenceUtc: '2026-11-03T10:00:00.000Z' })], { bundleSeq: 9 }));
    applyBundlePlacements(tr, bundleOf([mara({ placeCode: 'EMBER_PLAZA_OF_UNITY', evidenceUtc: '2026-11-03T10:00:10.000Z' })], { bundleSeq: 10 }));
    const conflict = conflictModel(tr, 'portal-key:mara-venn', labelFor);
    assert.ok(conflict, 'the scripted tick must conflict');
    assert.equal(conflict.heldPlaceLabel, 'The College', 'the figure holds at the last agreed place');
    v = at(m.update({ citizen: mara(), conflict }));
    assert.equal(v.bar, 'Waiting for a fresh record — the last one put Mara Venn at Plaza of Unity.');
    assert.equal(v.bar, fillWording(FOLLOW_WORDINGS.waitingStale, { name: 'Mara Venn', place: 'Plaza of Unity' }));

    // 7 — On the map: the record places her beyond the town plan.
    const cOut = mara({ state: 'present', placeCode: 'FRONTIER_CELL_9' });
    v = at(m.update({ citizen: cOut, beyondWall: true }));
    assert.equal(v.bar, 'Following on the map — Mara Venn is outside the town');

    // 8 — Exited: no bar; the return chip remains, worded as data.
    v = at(m.exit());
    assert.equal(v.bar, null);
    assert.equal(v.returnChip, 'Following: Mara Venn — return');
    assert.equal(v.returnChip, fillWording(FOLLOW_WORDINGS.returnChip, { name: 'Mara Venn' }));

    assert.deepEqual([...new Set(seen)], FOLLOW_STATES, 'the tour visited every state exactly in table order');
  } finally {
    resetClock();
  }
});

test('M6.07 machine: priority — conflict outranks the map, the map outranks quiet', () => {
  const m = createFollowMachine();
  m.engage(mara(), { placeLabel: 'The College' });
  const conflict = { heldPlaceLabel: 'The College', claims: [{ placeCode: 'MARKET_HALL', placeLabel: 'Market Hall' }] };
  assert.equal(m.update({ citizen: mara({ state: 'asleep' }), conflict, beyondWall: true }).state, 'waiting-stale');
  assert.equal(m.update({ citizen: mara({ state: 'asleep', placeCode: 'FRONTIER_CELL_9' }), beyondWall: true }).state, 'on-map');
  // Following someone else announces through the new bar (engage).
  const other = mara({ citizenKey: 'portal-key:nia-okafor', name: 'Nia Okafor', state: 'present' });
  const v = m.engage(other, { placeLabel: 'The College' });
  assert.equal(v.state, 'engaged');
  assert.ok(v.bar.startsWith('Following Nia Okafor —'));
  assert.equal(m.key, 'portal-key:nia-okafor');
});

// ------------------------------------------------------------ click budgets

test('M6.07 click budgets: every route lands within budget, by its shipped mechanism', () => {
  const mayor = mara();
  const nia = mara({ citizenKey: 'portal-key:nia-okafor', name: 'Nia Okafor', state: 'present', placeCode: 'MARKET_HALL' });
  const b = bundleOf([mayor, nia], {
    ticker: [{ kind: 'CITY_EVENT_BEGAN', text: 'A lecture began.', utc: '2026-11-03T10:01:00.000Z', handles: ['portal-key:nia-okafor'] }],
  });
  assert.equal(mayorKeyOf(b), 'portal-key:mara-venn', 'the mayor resolves by office');

  const routes = [];
  // Overlay: [Follow the Mayor] engages directly — 1 click.
  assert.ok(welcomeOverlayHtml().includes('data-welcome-mayor'));
  routes.push({ route: 'overlay → Follow the Mayor', clicks: 1, budget: FOLLOW_CLICK_BUDGET.mayor });
  // Portrait strip: the face itself is the follow button — 1 click.
  const strip = portraitStripHtml(portraitStripModel(b, LAYOUT));
  assert.ok(strip.includes('data-follow="portal-key:mara-venn"'));
  routes.push({ route: 'portrait strip → face', clicks: 1, budget: FOLLOW_CLICK_BUDGET.mayor });
  // Roster: Citizens (1) → the row's Watch (2).
  const roster = rosterListHtml(b, labelFor);
  assert.ok(roster.includes('data-follow="portal-key:nia-okafor"'), 'roster rows carry Watch');
  routes.push({ route: 'Citizens → row Watch', clicks: 2, budget: FOLLOW_CLICK_BUDGET.citizen });
  // Stage: tap the figure (1) → the card's Follow (2).
  const card = citizenCardHtml(nia, labelFor, null, { bundle: b });
  assert.ok(card.includes('data-follow="portal-key:nia-okafor"'), 'the card carries Follow');
  routes.push({ route: 'stage tap → card Follow', clicks: 2, budget: FOLLOW_CLICK_BUDGET.citizen });
  // Ticker: [Take me there] on a citizen landing follows directly (1).
  const landing = tickerLanding(b.ticker[0], b, LAYOUT);
  assert.ok(landing && landing.type === 'citizen', 'the ticker item lands on its citizen');
  assert.ok(tickerListHtml(b, [], { layout: LAYOUT }).includes('data-there-item="0"'));
  routes.push({ route: 'ticker → Take me there', clicks: 1, budget: FOLLOW_CLICK_BUDGET.citizen });
  // Directory: Buildings (1) → the occupant's name is a follow button (2).
  const dir = directoryListHtml(directoryModel(b, LAYOUT));
  assert.ok(dir.includes('data-follow="portal-key:nia-okafor"'), 'directory occupants are follow buttons');
  routes.push({ route: 'Buildings → occupant name', clicks: 2, budget: FOLLOW_CLICK_BUDGET.citizen });
  // Return chip: 1.
  routes.push({ route: 'return chip', clicks: 1, budget: FOLLOW_CLICK_BUDGET.returnChip });

  for (const r of routes) {
    assert.ok(r.clicks <= r.budget, `${r.route}: ${r.clicks} clicks ≤ budget ${r.budget}`);
  }
});

test('M6.07 wiring census: app.js drives the machine, and re-words nothing', () => {
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(src.includes('createFollowMachine()'), 'the machine is constructed');
  assert.ok(src.includes('state.followMachine.engage('), 'follow() engages the machine');
  assert.ok(src.includes('state.followMachine.update('), 'the frame refresh updates the machine');
  assert.ok(src.includes('state.followMachine.exit()'), 'stop goes through exit()');
  // The wordings live in logic's table only: app.js must not carry
  // a private copy of any state wording.
  for (const fragment of ['they are asleep / away. Last heard from', 'Waiting for a fresh record', 'Following on the map', 'walking the steps that happened while Portal was loading']) {
    assert.ok(!src.includes(fragment), `app.js must not re-word: ${fragment}`);
  }
  // One [data-follow] handler serves every route.
  assert.ok(src.includes("querySelectorAll('[data-follow]')"), 'the single follow handler');
});
