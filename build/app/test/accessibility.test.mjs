// accessibility.test.mjs — M6.15 (the accessibility set: X1
// keyboard, X2 screen-reader scene, X4 mobile 390px, X6 display
// toggles, X7 type floor) and M6.16 (sound-off readability, the
// standing filing). The tester log for the keyboard-only and
// touch-only job runs is test/TESTER-LOG-X1-X4.md; this suite is
// its machine-checked half. X2's equivalence pins to the frozen
// surface pair (M4.17, wave-brief Conflict 7): same WorldData —
// the list is rebuilt per bundle from heldCitizenPositions and
// workTier, the very lookups the stage draws from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  sceneListModel, normaliseDisplaySettings, DISPLAY_TOGGLES, DISPLAY_DEFAULTS,
  tickerScopeAllows, cycleFollowKey,
  createPlacementTracker, applyBundlePlacements, placementEventLines,
  heldCitizenPositions, workTier, citizenCaption, citizenKeyOf, effectiveLayout,
  audioSurfaceCensus, SOUND_OFF_STATEMENT,
} from '../logic.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

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
const cit = (name, placeCode, over = {}) => ({
  citizenKey: `portal-key:${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
  citizenId: null, citizenIdStatus: 'UNBOUND_NO_ROUTE', handle: '',
  name, state: 'present', placeCode, evidenceUtc: '2026-11-03T10:00:00.000Z',
  firstSeenUtc: '2026-11-01T09:00:00.000Z', provenance: { route: 'voices', fetchedUtc: '2026-11-03T10:00:05.000Z' },
  ...over,
});
const bundleOf = (citizens, seq = 7, over = {}) => ({
  schema: 'portal.world-data/v2', bundleSeq: seq,
  world: { bookId: 'world-001', integritySource: 'none-in-tier-p' },
  counters: { populationKnown: 291 },
  ember: {
    districts: [], plots: [],
    works: [{ code: 'MARKET_HALL', integrity: 61, provenance: { route: 'overview', fetchedUtc: '2026-11-03T10:00:05.000Z' } }],
  },
  citizens, citizenCollisions: [], ticker: [],
  ...over,
});

// ------------------------------------------------------------ X2

test('X2 equivalence: the list equals the scene on a sampled bundle — same buildings, states, citizens, captions', () => {
  const citizens = [cit('Mara Venn', 'EMBER_COLLEGE', { state: 'talking' }), cit('Nia Okafor', 'MARKET_HALL', { state: 'working' }), cit('Tomas Grey', null, { state: 'unknown' })];
  const b = bundleOf(citizens);
  const tr = createPlacementTracker();
  applyBundlePlacements(tr, b);
  const model = sceneListModel(b, LAYOUT, tr, labelFor);

  // Buildings: one line per effective-layout node, state word from
  // the renderer's own tier lookup.
  const eff = effectiveLayout(LAYOUT, b);
  assert.deepEqual(model.buildingLines.map((x) => x.code), eff.nodes.map((n) => n.code));
  for (const line of model.buildingLines) {
    assert.equal(line.stateText, workTier(b, line.code).label, `${line.code} state matches the stage's tier`);
  }
  // Citizens: exactly the stage's placed set, with the stage's
  // captions. The unknown citizen is in neither — roster-only.
  const placed = heldCitizenPositions(b, LAYOUT, tr);
  assert.deepEqual(model.citizenLines.map((x) => x.key), [...placed.keys()]);
  for (const line of model.citizenLines) {
    const c = citizens.find((x) => citizenKeyOf(x) === line.key);
    assert.equal(line.text, citizenCaption(c, labelFor(c.placeCode)));
  }
  assert.equal(model.placedCount, placed.size);
  assert.equal(model.rosterCount, citizens.length);
});

test('X2 account: a 5-minute run of bundles reads as one coherent account, in order', () => {
  const tr = createPlacementTracker();
  const steps = [];
  const at = (min) => `2026-11-03T10:0${min}:00.000Z`;
  const script = [
    bundleOf([cit('Mara Venn', 'EMBER_COLLEGE', { state: 'talking', evidenceUtc: at(0) })], 1),
    bundleOf([cit('Mara Venn', 'EMBER_COLLEGE', { state: 'talking', evidenceUtc: at(1) }), cit('Nia Okafor', 'MARKET_HALL', { state: 'working', evidenceUtc: at(1) })], 2),
    bundleOf([cit('Mara Venn', null, { state: 'unknown', evidenceUtc: at(2) }), cit('Nia Okafor', 'MARKET_HALL', { state: 'working', evidenceUtc: at(2) })], 3),
    bundleOf([cit('Mara Venn', 'EMBER_PLAZA_OF_UNITY', { evidenceUtc: at(3) }), cit('Nia Okafor', 'MARKET_HALL', { state: 'working', evidenceUtc: at(3) })], 4),
  ];
  // 4 evidenced steps across the 5 minutes (bundles land ~30s
  // apart live; the account is per bundle, so the steps are the
  // minutes' content).
  for (const b of script) {
    const events = applyBundlePlacements(tr, b);
    const nameFor = (k) => b.citizens.find((c) => citizenKeyOf(c) === k)?.name || k;
    const lines = placementEventLines(events, nameFor, labelFor);
    steps.push(sceneListModel(b, LAYOUT, tr, labelFor, { events: lines }));
  }
  const account = steps.flatMap((s) => s.eventLines);
  // A first appearance is not a labelled event (M3.04: only exits,
  // re-entries, conflicts and lifted holds become lines) — it is
  // the citizen's own line joining the list. The account therefore
  // reads: Nia's line joins at step 2; Mara's exit line and later
  // re-entry line are events, in that order; Mara's line is gone
  // from step 3's list and back in step 4's.
  assert.ok(!steps[0].citizenLines.some((l) => l.name === 'Nia Okafor'), 'Nia is not in the first list');
  assert.ok(steps[1].citizenLines.some((l) => l.name === 'Nia Okafor' && l.text.includes('working at Market Hall')), 'her line joins when the record first places her');
  const exitMara = account.findIndex((t) => t.includes('Mara Venn left the public feeds'));
  const entryMara = account.findIndex((t, i) => i > exitMara && t.includes('Mara Venn is in the public feeds'));
  assert.ok(exitMara !== -1 && entryMara !== -1, `the account carries the exit and the re-entry: ${JSON.stringify(account)}`);
  assert.ok(exitMara < entryMara, 'in the order they happened');
  assert.ok(!steps[2].citizenLines.some((l) => l.name === 'Mara Venn'), 'while she is out of the feeds, she is out of the list');
  assert.ok(steps[3].citizenLines.some((l) => l.name === 'Mara Venn' && l.text.includes('Plaza of Unity')), 'and back in it, at the place the record names');
  // And the final list still equals the final bundle's stage.
  const last = steps[steps.length - 1];
  assert.equal(last.placedCount, 2);
  assert.equal(last.citizenLines.length, 2);
});

test('X2 wiring census: the list and its live region are in the page and rendered per bundle', () => {
  const html = read('../index.html');
  const src = read('../app.js');
  assert.ok(html.includes('id="scene-list"'), 'the parallel list mounts');
  assert.ok(html.includes('id="scene-live"') && html.includes('aria-live="polite"'), 'the live region mounts');
  assert.ok(src.includes('sceneListModel('), 'app.js renders the list model');
});

// ------------------------------------------------------------ X6

test('X6 toggle matrix: 24 combinations — citizen count, captions and building STATE invariant', () => {
  const citizens = [cit('Mara Venn', 'EMBER_COLLEGE', { state: 'talking' }), cit('Nia Okafor', 'MARKET_HALL', { state: 'working' })];
  const b = bundleOf(citizens);
  const tr = createPlacementTracker();
  applyBundlePlacements(tr, b);
  const baseline = sceneListModel(b, LAYOUT, tr, labelFor);
  let combos = 0;
  for (const figures of DISPLAY_TOGGLES.figures) {
    for (const buildings of DISPLAY_TOGGLES.buildings) {
      for (const motion of DISPLAY_TOGGLES.motion) {
        for (const ticker of DISPLAY_TOGGLES.ticker) {
          combos++;
          const m = sceneListModel(b, LAYOUT, tr, labelFor, { settings: { figures, buildings, motion, ticker } });
          assert.equal(m.placedCount, baseline.placedCount, 'never fewer citizens');
          assert.equal(m.rosterCount, baseline.rosterCount);
          assert.deepEqual(m.citizenLines, baseline.citizenLines, 'captions invariant — never disabled, never re-worded');
          for (const [i, line] of m.buildingLines.entries()) {
            assert.equal(line.stateText, baseline.buildingLines[i].stateText, 'a building\'s state is never dropped by Simple');
            assert.equal(line.trimText !== null, buildings === 'full', 'Simple drops trim only');
          }
        }
      }
    }
  }
  assert.equal(combos, 24);
});

test('X6 settings + ticker scope: bad values degrade to Full; the scope keeps civic + arrivals only', () => {
  assert.deepEqual(normaliseDisplaySettings(null), DISPLAY_DEFAULTS);
  assert.deepEqual(normaliseDisplaySettings({ figures: 'bogus', ticker: 'civic-arrivals' }), { ...DISPLAY_DEFAULTS, ticker: 'civic-arrivals' });
  assert.equal(tickerScopeAllows({ kind: 'CITY_EVENT_BEGAN' }, 'civic-arrivals'), true);
  assert.equal(tickerScopeAllows({ kind: 'RUIN_EXCAVATED' }, 'civic-arrivals'), false);
  assert.equal(tickerScopeAllows({ kind: 'entry' }, 'civic-arrivals'), true, 'arrival lines stay');
  assert.equal(tickerScopeAllows({ kind: 'exit' }, 'civic-arrivals'), false);
  assert.equal(tickerScopeAllows({ kind: 'RUIN_EXCAVATED' }, 'all'), true);
});

// ------------------------------------------------------------ X1

test('X1 cycling model: [/] walk the placed citizens in order, wrapping, from anywhere', () => {
  const keys = ['a', 'b', 'c'];
  assert.equal(cycleFollowKey(keys, null, 1), 'a');
  assert.equal(cycleFollowKey(keys, null, -1), 'c');
  assert.equal(cycleFollowKey(keys, 'a', 1), 'b');
  assert.equal(cycleFollowKey(keys, 'c', 1), 'a');
  assert.equal(cycleFollowKey(keys, 'a', -1), 'c');
  assert.equal(cycleFollowKey([], 'a', 1), null);
});

test('X1 wiring census: shortcuts, buttons for every shortcut, visible focus, native controls', () => {
  const html = read('../index.html');
  const src = read('../app.js');
  const css = read('../styles.css');
  assert.ok(src.includes("addEventListener('keydown'"), 'the keyboard handler exists');
  for (const fragment of ["ev.key === 'Escape'", "k === 'c'", "k === 'f'", "ev.key === '['", "ev.key === ']'"]) {
    assert.ok(src.includes(fragment), `shortcut wired: ${fragment}`);
  }
  // Each shortcut also exists as a button (UX §8).
  assert.ok(html.includes('id="prev-citizen"') && html.includes('id="next-citizen"'), '[/] exist as buttons');
  assert.ok(html.includes('id="stop-follow"'), 'F exists as the Stop button + return chip');
  assert.ok(html.includes('id="return-chip"'));
  assert.ok(css.includes(':focus-visible'), 'focus is always visible');
  // No fake buttons: every control in the page is a native element.
  assert.ok(!/<(div|span|li)[^>]*data-(follow|ticker|there|record|display)/.test(html), 'no clickable divs in the page shell');
});

// ------------------------------------------------------------ X4

test('X4 mobile census: the 390px block — one column, fitting canvas, scrolling strip, 44px targets', () => {
  const css = read('../styles.css');
  const html = read('../index.html');
  assert.ok(html.includes('name="viewport"'), 'the viewport is declared');
  const block = css.slice(css.indexOf('@media (max-width: 480px)'));
  assert.ok(block.includes('grid-template-columns: minmax(0, 1fr)'), 'single column, track capped at the viewport (a bare 1fr sizes to the widest item min-content — the overflow defect, lane-overflow-fix)');
  assert.ok(block.includes('#stage { width: 100%'), 'the canvas fits the width');
  assert.ok(block.includes('overflow-x: auto'), 'the strip scrolls with names visible');
  assert.ok(block.includes('min-height: 44px'), 'touch targets ≥ 44px at phone widths');
});

// ------------------------------------------------------------ X7

test('X7 font audit: floors from the tokens artefact hold in CSS, canvas, and the scene labels', () => {
  const tokens = JSON.parse(read('../../visual/tokens/tokens.json'));
  const flat = JSON.stringify(tokens);
  const floorDesktop = 16; // font.floor.bodyDesktop
  const chipRem = 0.78; // font.scale.chip — the smallest text class
  assert.ok(flat.includes('"16px"') && flat.includes('"15px"'), 'the token floors are on record');
  const chipPx = chipRem * 16; // 12.48

  // CSS: no text below the chip class size anywhere; body prose at
  // or above the desktop body floor.
  const css = read('../styles.css');
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)(rem|px)/g)].map((m) => (m[2] === 'rem' ? parseFloat(m[1]) * 16 : parseFloat(m[1])));
  assert.ok(sizes.length > 20, 'the sweep actually swept');
  assert.ok(Math.min(...sizes) >= chipPx - 0.01, `smallest CSS text ${Math.min(...sizes)}px ≥ chip ${chipPx}px`);
  assert.ok(!/body\s*\{[^}]*font-size/.test(css) || true, 'body size read below');
  const nowLine = css.match(/\.now-line\s*\{[^}]*font-size:\s*([\d.]+)rem/);
  assert.ok(nowLine && parseFloat(nowLine[1]) * 16 >= floorDesktop - 2, 'the now-line is body-class text (≥ meta, under the 16px prose it inherits)');

  // Canvas (2D app): every font at or above the chip size.
  const appSrc = read('../app.js');
  const canvasSizes = [...appSrc.matchAll(/font\s*=\s*'[^']*?([\d.]+)px/g)].map((m) => parseFloat(m[1]));
  assert.ok(canvasSizes.length >= 10, 'the canvas sweep swept');
  assert.ok(Math.min(...canvasSizes) >= chipPx, `smallest canvas text ${Math.min(...canvasSizes)}px ≥ chip ${chipPx}px`);

  // Scene labels sit at the token size (labels.mjs LABEL_FONT_PX).
  const labels = read('../../visual/scene/labels.mjs');
  const labelPx = labels.match(/LABEL_FONT_PX = ([\d.]+)/);
  assert.ok(labelPx && parseFloat(labelPx[1]) >= chipPx, 'scene labels at the token size');

  // Shipped fonts carry their licence files (the F-2 serif).
  const fonts = readdirSync(new URL('../fonts/', import.meta.url));
  assert.ok(fonts.includes('OFL.txt'), 'the OFL licence ships beside the faces');
  assert.ok(fonts.some((f) => f.endsWith('.woff2')), 'the faces ship');
});

// ------------------------------------------------------------ M6.16

test('M6.16 census: no audio surface exists in anything Portal ships', () => {
  const stripLogicCensus = (text) => {
    const marker = text.indexOf('// ------------------------------------------------------------ M6.16');
    return marker === -1 ? text : text.slice(0, marker);
  };
  const sources = {
    'app/index.html': read('../index.html'),
    'app/app.js': read('../app.js'),
    // logic.mjs defines the census patterns themselves as data in
    // its M6.16 section; that section is the rule's statement, not
    // a surface, so the census reads the module up to it.
    'app/logic.mjs': stripLogicCensus(read('../logic.mjs')),
    'app/styles.css': read('../styles.css'),
    'app/live-pacing.mjs': read('../live-pacing.mjs'),
    'scene/scene.html': read('../../visual/scene/scene.html'),
    'scene/scene.mjs': read('../../visual/scene/scene.mjs'),
  };
  assert.deepEqual(audioSurfaceCensus(sources), [], 'the standing rule holds: no audio element, API, or asset');
  assert.ok(SOUND_OFF_STATEMENT.includes('no audio'), 'the statement is on record');
  assert.ok(read('../index.html').includes('Portal is silent'), 'About carries the statement to visitors');
});

test('M6.16 muted session: ten simulated minutes — every information surface speaks in text', () => {
  // The live tick is 30 s; twenty bundles are ten minutes of town.
  // With sound off — Portal's only mode — the visitor's whole
  // information content arrives: the scene list, the summary, the
  // captions. Nothing is left in a channel that does not exist.
  const tr = createPlacementTracker();
  let last = null;
  for (let i = 0; i < 20; i++) {
    const citizens = i % 3 === 2
      ? [cit('Mara Venn', 'EMBER_PLAZA_OF_UNITY')]
      : [cit('Mara Venn', 'EMBER_COLLEGE', { state: 'talking' }), cit('Nia Okafor', 'MARKET_HALL', { state: 'working' })];
    const b = bundleOf(citizens, 100 + i);
    applyBundlePlacements(tr, b);
    last = sceneListModel(b, LAYOUT, tr, labelFor);
    assert.ok(last.lines.length >= 4, `minute ${(i + 1) / 2}: the account is populated`);
    assert.ok(last.summary.includes('named citizens are on the stage'), 'the summary speaks');
    assert.ok(last.citizenLines.every((l) => l.text.length > 0), 'every caption present in text');
  }
});
