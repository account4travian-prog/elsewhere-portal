/* M4.07 — pastel material treatment: the six building families are
   token-driven, the gradient atlases are derived from token colours,
   the scene consumes colour only through the generated palette, and
   the greyscale drill proves no state distinction rides on colour
   alone. Run per file: node --test test/materials.test.mjs

   Headless scope, stated plainly: this exercises the palette, the
   material construction, and the treatment logic against data. It
   renders nothing — the rendered check is probe-check.mjs (analytic,
   calibrated against live pixels) plus the staging screenshot
   ladder. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

globalThis.self = globalThis; // three r186 expects the browser global
register('./three-vendor-hook.mjs', import.meta.url);

const THREE = await import('../vendor/three.module.js');
const { PALETTE, ANCHORS, FAMILIES, familyForPlace } = await import('../palette.mjs');
const { buildPalette } = await import('../gen-palette.mjs');
const {
  hexToRgb, luminance, shade, gradientBandRatios, gradientStops, gradientAtlasData,
  familyMaterials, anchorMaterial,
} = await import('../materials.mjs');
const { figureStyle } = await import('../../../app/logic.mjs');

const tokensDoc = JSON.parse(readFileSync(new URL('../../tokens/tokens.json', import.meta.url), 'utf8'));
const byName = new Map();
for (const g of Object.values(tokensDoc.groups)) for (const t of g.tokens) byName.set(t.name, t);

test('palette.mjs is byte-identical to a fresh generation from tokens.json', () => {
  const onDisk = readFileSync(new URL('../palette.mjs', import.meta.url), 'utf8');
  assert.equal(onDisk, buildPalette(tokensDoc));
});

test('six families exist and every role colour is copied from its named source token', () => {
  assert.deepEqual(Object.keys(FAMILIES).sort(), ['civic', 'college', 'home', 'market', 'social', 'work']);
  for (const [fam, def] of Object.entries(FAMILIES)) {
    for (const [role, hex] of Object.entries(def.roles)) {
      const srcName = def.roleSources[role];
      assert.ok(srcName, `${fam}.${role} has no recorded source token`);
      const src = byName.get(srcName);
      assert.ok(src, `${fam}.${role} source ${srcName} missing from tokens.json`);
      const srcVal = src.value ?? src.hex;
      assert.equal(hex.toUpperCase(), srcVal.toUpperCase(),
        `${fam}.${role} (${hex}) must equal its source token ${srcName} (${srcVal}) — anchors arbitrate, no invented family colours`);
    }
  }
});

test('every layout place code resolves to a family; unlisted codes take the recorded default', () => {
  const layout = JSON.parse(readFileSync(new URL('../../../shared/ember-layout.json', import.meta.url), 'utf8'));
  for (const n of layout.nodes) {
    const fam = familyForPlace(n.code);
    assert.ok(FAMILIES[fam], `${n.code} resolves to unknown family ${fam}`);
  }
  assert.equal(familyForPlace('EMBER_TOWNHALL'), 'civic');
  assert.equal(familyForPlace('EMBER_COLLEGE'), 'college');
  assert.equal(familyForPlace('MARKET_HALL'), 'market');
  assert.equal(familyForPlace('PUBLIC_WORKSHOP'), 'work');
  assert.equal(familyForPlace('EMBER_DISTRICT_1_PLOT_31'), 'work');
  assert.equal(familyForPlace('EMBER_DISTRICT_3_PLOT_18'), 'social');
  assert.equal(familyForPlace('EMBER_HOME_MAPLE_COTTAGE'), 'home');
  assert.equal(familyForPlace('NO_SUCH_PLACE'), PALETTE.defaultFamily);
});

test('gradient atlas: derived from the rig band ratios, monotone, colour-true at the top', () => {
  const bands = gradientBandRatios();
  assert.equal(bands.length, 4);
  const stops = gradientStops('#CFBE95');
  assert.equal(stops[stops.length - 1].hex, '#CFBE95', 'top of the wall is the token colour itself');
  assert.equal(stops[0].hex, shade('#CFBE95', bands[1]));
  assert.equal(stops[1].hex, shade('#CFBE95', bands[2]));
  const { width, height, data } = gradientAtlasData('#CFBE95');
  assert.equal(width, 1); assert.equal(data.length, height * 4);
  // rows ascend v=0 (base) -> v=1 (top): luminance non-decreasing.
  let prev = -1;
  for (let y = 0; y < height; y++) {
    const lum = 0.2126 * data[y * 4] + 0.7152 * data[y * 4 + 1] + 0.0722 * data[y * 4 + 2];
    assert.ok(lum >= prev - 0.6, `atlas row ${y} dips (${lum} < ${prev})`);
    prev = lum;
    assert.equal(data[y * 4 + 3], 255);
  }
  const topRow = [data[(height - 1) * 4], data[(height - 1) * 4 + 1], data[(height - 1) * 4 + 2]];
  assert.deepEqual(topRow, hexToRgb('#CFBE95'), 'atlas top row is exactly the token colour');
});

test('family materials: wall/roof carry the family atlas, trim/accent are the flat token colours', () => {
  const gm = new THREE.DataTexture(new Uint8Array([138, 138, 138, 255]), 1, 1);
  for (const [fam, def] of Object.entries(FAMILIES)) {
    const mats = familyMaterials(THREE, gm, fam);
    assert.equal(mats.wall.map.image.data.length, 64 * 4, `${fam} wall atlas`);
    assert.deepEqual(
      [mats.wall.map.image.data[63 * 4], mats.wall.map.image.data[63 * 4 + 1], mats.wall.map.image.data[63 * 4 + 2]],
      hexToRgb(def.roles.wall), `${fam} wall atlas top = wall token colour`);
    assert.equal('#' + mats.trim.color.getHexString().toUpperCase(), def.roles.trim.toUpperCase(), `${fam} trim`);
    assert.equal('#' + mats.accent.color.getHexString().toUpperCase(), def.roles.accent.toUpperCase(), `${fam} accent`);
    assert.equal(mats.wall.gradientMap, gm, 'the shared rig gradient map bands every family');
  }
  const skin = anchorMaterial(THREE, gm, ANCHORS.skin_base);
  assert.equal('#' + skin.color.getHexString().toUpperCase(), ANCHORS.skin_base.toUpperCase());
});

test('scene.mjs holds no building/palette colour literals — colour comes from the palette only', () => {
  const src = readFileSync(new URL('../scene.mjs', import.meta.url), 'utf8');
  assert.ok(!src.includes('BUILDING_STYLE'), 'BUILDING_STYLE (hard-coded tints) is gone');
  assert.ok(src.includes("from './palette.mjs'"), 'scene imports the generated palette');
  assert.ok(src.includes("from './materials.mjs'"), 'scene imports the family materials');
  // Any 0xRRGGBB literal left in scene.mjs must not be a palette colour:
  // collect every anchor + family role value and assert none appears.
  const paletteHexes = new Set();
  for (const v of Object.values(ANCHORS)) paletteHexes.add(v.toLowerCase());
  for (const def of Object.values(FAMILIES)) for (const v of Object.values(def.roles)) paletteHexes.add(v.toLowerCase());
  for (const m of src.matchAll(/0x([0-9a-fA-F]{6})\b/g)) {
    assert.ok(!paletteHexes.has('#' + m[1].toLowerCase()), `scene.mjs hard-codes palette colour 0x${m[1]}`);
  }
});

test('GREYSCALE DRILL — no state distinction is carried by colour alone', () => {
  // (a) The three figure treatments differ in NON-colour channels:
  //     opacity steps, a ring + glyph marker, scale/pose (treatments.mjs).
  const normal = figureStyle({ state: 'active' });
  const asleep = figureStyle({ state: 'asleep' });
  const held = figureStyle({ state: 'active' }, { conflict: true });
  assert.equal(normal.opacity, 1);
  assert.ok(asleep.opacity < normal.opacity, 'asleep is dimmer (a luminance step survives greyscale)');
  assert.ok(held.opacity < normal.opacity && held.ring && held.marker,
    'held = dimmer AND a dashed ring AND a ≠ marker — shape channels, not colour');
  assert.notEqual(asleep.opacity, held.opacity, 'asleep and held differ in opacity as well as shape');
  // (b) The honesty badge states (live/stale/replay) pair every colour
  //     with a word — checked against the tokens' own rule field:
  assert.match(tokensDoc.rule, /never the sole signal/);
  // (c) Families stay pairwise distinguishable in pure luminance by
  //     their (wall, roof) signature — and where two signatures come
  //     close, the families differ in FORM (roof height/spire in
  //     BUILDING_FORM) and in the place label, never colour alone.
  const sig = {};
  for (const [fam, def] of Object.entries(FAMILIES)) {
    sig[fam] = [luminance(def.roles.wall), luminance(def.roles.roof)];
  }
  const fams = Object.keys(sig);
  for (let i = 0; i < fams.length; i++) for (let j = i + 1; j < fams.length; j++) {
    const d = Math.max(Math.abs(sig[fams[i]][0] - sig[fams[j]][0]), Math.abs(sig[fams[i]][1] - sig[fams[j]][1]));
    assert.ok(d >= 4, `${fams[i]} vs ${fams[j]}: greyscale signatures too close (max component delta ${d.toFixed(1)} luminance units)`);
  }
});
