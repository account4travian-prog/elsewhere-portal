/* M4.25 — asleep/away treatment, cross-surface agreement on ONE
   staged bundle: the same fixture citizen must read asleep on the
   roster (dimmed chip + words), the card (presence wording), the 2D
   stage placement (citizenPositions + figureStyle), and the 3D
   scene's treatment plan (rest pose + Zzz badge + dimmed chip) — and
   the treatment must be driven by the presence class (state), never
   by placeCode: an awake citizen at the same place is untreated, and
   an asleep citizen with no evidenced place stays on the roster
   rail, unplaced on every stage. Run per file:
   node --test test/treatments.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

globalThis.self = globalThis;
register('./three-vendor-hook.mjs', import.meta.url);

const {
  citizenPositions, figureStyle, rosterListHtml, citizenCardHtml, citizenCaption, ASLEEP_OPACITY,
} = await import('../../../app/logic.mjs');
const { treatmentPlan, ASLEEP_CLIP, ASLEEP_BADGE_GLYPH } = await import('../treatments.mjs');
const { loadWorkLibrary } = await import('../work-clips.mjs');
const { createFigureLoader, parseFigure } = await import('../figure-loader.mjs');

const layout = JSON.parse(readFileSync(new URL('../../../shared/ember-layout.json', import.meta.url), 'utf8'));
const labelFor = (code) => (layout.nodes.find((n) => n.code === code) || {}).label || code;
const T = '2026-11-01T23:20:00.000Z';

// The staged bundle: one asleep-at-place, one awake at the SAME
// place, one asleep with NO evidenced place (the rail case).
const bundle = {
  bundleSeq: 999999,
  citizens: [
    { citizenKey: 'portal-key:sleeper-at-college', name: 'Sleeper Atcollege', state: 'asleep', placeCode: 'EMBER_COLLEGE', evidenceUtc: T },
    { citizenKey: 'portal-key:awake-at-college', name: 'Awake Atcollege', state: 'present', placeCode: 'EMBER_COLLEGE', evidenceUtc: T },
    { citizenKey: 'portal-key:sleeper-nowhere', name: 'Sleeper Nowhere', state: 'asleep', placeCode: null, evidenceUtc: T },
  ],
};
const [sleeper, awake] = bundle.citizens;

test('placement: asleep-at-place is placed; asleep-without-place stays on the rail', () => {
  const pos = citizenPositions(bundle, layout);
  assert.ok(pos.has('portal-key:sleeper-at-college'), 'evidenced place => placed, asleep or not');
  assert.ok(pos.has('portal-key:awake-at-college'));
  assert.ok(!pos.has('portal-key:sleeper-nowhere'), 'no evidenced place => roster rail, never placed');
});

test('the treatment is driven by presence class, never by placeCode', () => {
  assert.equal(figureStyle(sleeper).treatment, 'asleep');
  assert.equal(figureStyle(awake).treatment, 'normal', 'same place, awake: no treatment');
  const moved = { ...sleeper, placeCode: 'EMBER_TOWNHALL' };
  assert.equal(figureStyle(moved).treatment, 'asleep', 'a different placeCode changes nothing');
  const woken = { ...sleeper, state: 'present' };
  assert.equal(figureStyle(woken).treatment, 'normal', 'the state alone flips the treatment');
});

test('roster surface: dimmed chip class + the record words', () => {
  const html = rosterListHtml(bundle, labelFor);
  const rows = html.split('<li').slice(1);
  const sRow = rows.find((r) => r.includes('Sleeper Atcollege'));
  const aRow = rows.find((r) => r.includes('Awake Atcollege'));
  assert.match(sRow, /^ class="asleep"/, 'asleep row carries the dimmed-chip class');
  assert.ok(!/^ class="asleep"/.test(aRow), 'awake row is not dimmed');
  assert.ok(sRow.includes('is asleep / away.'), 'roster caption carries the record wording');
  assert.ok(sRow.includes('Asleep / away — citizens act in visits, then go quiet.'), 'presence wording verbatim');
  // The dim itself: styles.css dims dot+name at the shared opacity.
  const css = readFileSync(new URL('../../../app/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.roster li\.asleep \.dot, \.roster li\.asleep \.who \{ opacity: 0\.55; \}/);
  assert.equal(ASLEEP_OPACITY, 0.55, 'one opacity value across surfaces');
});

test('card surface: presence wording agrees', () => {
  const card = citizenCardHtml(sleeper, labelFor);
  assert.ok(card.includes('Asleep / away — citizens act in visits, then go quiet.'));
  assert.equal(citizenCaption(sleeper, labelFor('EMBER_COLLEGE')), 'Sleeper Atcollege is asleep / away.');
});

test('3D scene plan: rest pose + Zzz badge + dimmed chip, from the same figureStyle call', () => {
  const plan = treatmentPlan(figureStyle(sleeper));
  assert.deepEqual(
    { opacity: plan.opacity, zzz: plan.zzz, restPose: plan.restPose, dimmedChip: plan.dimmedChip },
    { opacity: ASLEEP_OPACITY, zzz: true, restPose: true, dimmedChip: true });
  const awakePlan = treatmentPlan(figureStyle(awake));
  assert.deepEqual(
    { opacity: awakePlan.opacity, zzz: awakePlan.zzz, restPose: awakePlan.restPose, dimmedChip: awakePlan.dimmedChip },
    { opacity: 1, zzz: false, restPose: false, dimmedChip: false });
  assert.equal(ASLEEP_BADGE_GLYPH, 'Zzz');
});

test('the rest pose is a real library clip, and the scene wires the plan in', async () => {
  const loader = createFigureLoader();
  const lib = await loadWorkLibrary(async (url) => {
    const d = readFileSync(new URL(url, new URL('../', import.meta.url)));
    return parseFigure(loader, d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
  });
  assert.ok(lib, 'work library loads through the scene loader');
  assert.ok(lib.clips.has(ASLEEP_CLIP), `library carries the rest clip (${ASLEEP_CLIP})`);
  const sceneSrc = readFileSync(new URL('../scene.mjs', import.meta.url), 'utf8');
  assert.ok(sceneSrc.includes('reclineCapsuleMeshes'), 'capsule figures recline in buildWorld');
  assert.ok(sceneSrc.includes('zzzSprite'), 'capsule figures get the badge in buildWorld');
  const kitsSrc = readFileSync(new URL('../figure-kits.mjs', import.meta.url), 'utf8');
  assert.ok(kitsSrc.includes('ASLEEP_CLIP') && kitsSrc.includes('sleepKeys'), 'kit figures take the rest clip + badge via sleepKeys');
});
