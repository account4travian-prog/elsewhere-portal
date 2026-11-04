/* T3 — two-storey rendering: bottom floor by default, level up by hand.
   Run per file: node --test test/levels.test.mjs

   Proven here (all against the real GLBs through the scene's own
   loader, classified from the real kit cards):
   - the College classifies from its card (storeys: 2) + wrapper
     heights: storey height 3.12, roof height 6.24, upper set =
     exactly the 26 pieces at wrapper y = 3.12; the state defaults
     to ground.
   - ground level: upper set hidden, cut_roof lowered by exactly
     one storey (builtY − 3.12, no floating roof), roof followers
     (the gable infills, which sit OUTSIDE cut_roof in the GLB)
     lowered with it.
   - level up/down round trip restores exact built positions, and
     repeating the cycle is idempotent (full-scene snapshot equal).
   - shell × level composition (interiors.mjs): opening an interior
     at ground level restores the built form and lifts from the
     built height; closing returns to the lowered roof; the cycle
     repeats idempotently; at upper level closing returns to the
     built height, not the lowered one.
   - negative control: a single-storey building (Library Annex —
     card storeys: null, yet its roof piece sits at y = 3.12) gains
     no upper set and no level control, and applying a level
     changes nothing.
   - the chip wording is the tokens.json wording token, reaching
     the scene through the generated palette, and scene.mjs
     consumes the level model (closure census). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

globalThis.self = globalThis;
register('./three-vendor-hook.mjs', import.meta.url);

const { createFigureLoader, parseFigure } = await import('../figure-loader.mjs');
const {
  classifyBuildingLevels, registerBuildingLevel, applyBuildingLevel,
  buildingLevelState, levelChipEnabled, LEVEL_GROUND, LEVEL_UPPER,
} = await import('../buildings.mjs');
const { interiorDef, shellPlan, applyShell, LEVEL_SET_ASIDE_LINE } = await import('../interiors.mjs');
const { CAMERA_WORDINGS } = await import('../palette.mjs');

const MANIFEST = JSON.parse(readFileSync(new URL('../building-kits.json', import.meta.url), 'utf8'));
const REGISTRY = JSON.parse(readFileSync(new URL('../interior-kits.json', import.meta.url), 'utf8'));
const TOKENS = JSON.parse(readFileSync(new URL('../../tokens/tokens.json', import.meta.url), 'utf8'));

async function loadBuilding(code) {
  const entry = MANIFEST.buildings[code];
  const url = new URL(entry.glb, new URL('../building-kits.json', import.meta.url));
  const d = readFileSync(url);
  const loader = createFigureLoader();
  const gltf = await parseFigure(loader, d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
  return gltf.scene;
}
function cardFor(code) {
  const entry = MANIFEST.buildings[code];
  return JSON.parse(readFileSync(new URL(entry.card, new URL('../building-kits.json', import.meta.url)), 'utf8'));
}
function findNamed(root, name) {
  let hit = null;
  root.traverse((o) => { if (o.name === name) hit = o; });
  return hit;
}
function snapshot(root) {
  const rows = [];
  root.traverse((o) => { rows.push([o.name || '', o.visible, o.position.y]); });
  return rows;
}
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;

test('classification: the College from its real card + GLB — 26 upper pieces at 3.12, default ground', async () => {
  const card = cardFor('EMBER_COLLEGE');
  assert.equal(card.storeys, 2, 'the kit card evidences two storeys');
  const root = await loadBuilding('EMBER_COLLEGE');
  const cls = classifyBuildingLevels(root, card);
  assert.equal(cls.hasUpper, true);
  assert.ok(near(cls.roofHeightUnits, 6.24), `roof height ${cls.roofHeightUnits}`);
  assert.ok(near(cls.storeyHeightUnits, 3.12), `storey height ${cls.storeyHeightUnits}`);
  assert.equal(cls.upperNames.length, 26, 'upper set membership = 26 pieces');
  for (const name of cls.upperNames) {
    assert.ok(near(findNamed(root, name).position.y, 3.12), `${name} sits at the upper-storey height`);
  }
  // The roof piece itself is not an upper piece, and no ground piece is.
  assert.ok(!cls.upperNames.some((n) => n.includes('Roof')), 'the roof is not in the upper set');
  // Card-driven, not name-driven: the same GLB with no evidenced
  // storey count classifies empty (positive control for the rule).
  assert.equal(classifyBuildingLevels(root, null).hasUpper, false);
  assert.deepEqual(classifyBuildingLevels(root, { storeys: 1 }).upperNames, []);

  const state = registerBuildingLevel(root, card);
  assert.equal(state.level, LEVEL_GROUND, 'default level is ground');
  assert.equal(buildingLevelState(root), state);
  assert.equal(levelChipEnabled(state), true);
  // Re-registering never re-captures built heights from a lowered roof.
  assert.equal(registerBuildingLevel(root, card), state);
});

test('ground level: upper hidden, roof at restY − 3.12 (no float), followers lowered with it', async () => {
  const root = await loadBuilding('EMBER_COLLEGE');
  const roof = findNamed(root, 'cut_roof');
  const builtY = roof.position.y;
  const state = registerBuildingLevel(root, cardFor('EMBER_COLLEGE'));
  for (const name of state.upperNames) {
    assert.equal(findNamed(root, name).visible, false, `${name} hidden at ground level`);
  }
  assert.ok(near(roof.position.y, builtY - 3.12), `roof ${roof.position.y} != built ${builtY} − 3.12`);
  assert.equal(roof.userData.restY, roof.position.y, 'the level owns the roof rest height');
  assert.equal(roof.userData.builtY, builtY);
  // Ground-storey pieces and the roof piece stay visible.
  assert.equal(findNamed(root, 'piece_Roof_RoundTiles_6x6').visible, true, 'the roof itself still renders');
  assert.equal(findNamed(root, 'piece_Wall_UnevenBrick_Straight').visible, true, 'ground walls still render');
  // Followers: the gable infills sit outside cut_roof in the GLB at
  // roof height — they move with the roof or they would float.
  assert.deepEqual(state.roofFollowerNames.sort(), ['gable_infill', 'gable_infill001'],
    'the two gable infills (loader-sanitised names), at roof height outside cut_roof');
  for (const name of state.roofFollowerNames) {
    assert.ok(near(findNamed(root, name).position.y, state.followerBuiltY[name] - 3.12),
      `${name} lowered with the roof`);
  }
});

test('level up/down round trip restores exact built positions; cycles are idempotent', async () => {
  const root = await loadBuilding('EMBER_COLLEGE');
  const built = snapshot(root);
  const state = registerBuildingLevel(root, cardFor('EMBER_COLLEGE'));
  const groundSnap = snapshot(root);
  const up = applyBuildingLevel(root, LEVEL_UPPER);
  assert.equal(up.deferred, false);
  assert.equal(state.level, LEVEL_UPPER);
  assert.deepEqual(snapshot(root), built, 'upper level = the exact built form');
  const down = applyBuildingLevel(root, LEVEL_GROUND);
  assert.equal(down.level, LEVEL_GROUND);
  assert.deepEqual(snapshot(root), groundSnap, 'back at ground = the first ground rendering, exactly');
  applyBuildingLevel(root, LEVEL_UPPER);
  applyBuildingLevel(root, LEVEL_GROUND);
  assert.deepEqual(snapshot(root), groundSnap, 'a second round trip changes nothing further');
  assert.throws(() => applyBuildingLevel(root, 'attic'), /level must be/, 'an unlisted level is refused');
});

test('shell × level: open at ground level restores built form; close returns to the lowered roof; repeat-cycle idempotent', async () => {
  const root = await loadBuilding('EMBER_COLLEGE');
  const def = interiorDef(REGISTRY, 'EMBER_COLLEGE');
  const state = registerBuildingLevel(root, cardFor('EMBER_COLLEGE'));
  const roof = findNamed(root, 'cut_roof');
  const builtY = state.roofBuiltY;
  const groundSnap = snapshot(root);

  for (let cycle = 0; cycle < 2; cycle++) {
    const opened = applyShell(root, shellPlan(def, true));
    assert.equal(opened.levelSetAside, LEVEL_GROUND, `cycle ${cycle}: the ground level was set aside`);
    assert.ok(near(roof.position.y, builtY + def.roofLiftUnits),
      `cycle ${cycle}: the roof lifts from the BUILT height, not the lowered rest`);
    for (const name of state.upperNames) {
      assert.equal(findNamed(root, name).visible, true, `cycle ${cycle}: built form — ${name} stands again`);
    }
    assert.equal(findNamed(root, 'cut_wall_front').visible, false, 'the shell still cuts its walls');
    applyShell(root, shellPlan(def, true)); // idempotent re-open under a set-aside level
    assert.ok(near(roof.position.y, builtY + def.roofLiftUnits));
    assert.equal(state.suspendedLevel, LEVEL_GROUND, 're-open does not overwrite the set-aside level');
    const closed = applyShell(root, shellPlan(def, false));
    assert.equal(closed.levelRestored, LEVEL_GROUND);
    assert.deepEqual(snapshot(root), groundSnap, `cycle ${cycle}: closing returns exactly to the ground-level rendering`);
    assert.equal(state.suspendedLevel, null);
  }
});

test('shell × level at upper level: close returns to the built height, and a level chosen while open is deferred to close', async () => {
  const root = await loadBuilding('EMBER_COLLEGE');
  const def = interiorDef(REGISTRY, 'EMBER_COLLEGE');
  const state = registerBuildingLevel(root, cardFor('EMBER_COLLEGE'));
  const roof = findNamed(root, 'cut_roof');
  applyBuildingLevel(root, LEVEL_UPPER);
  const upperSnap = snapshot(root);
  applyShell(root, shellPlan(def, true));
  assert.ok(near(roof.position.y, state.roofBuiltY + def.roofLiftUnits));
  // The viewer changes their mind while the room is open: the new
  // level is recorded, the built form on screen does not move.
  const rep = applyBuildingLevel(root, LEVEL_GROUND);
  assert.equal(rep.deferred, true, 'a level change while an interior is open defers');
  assert.ok(near(roof.position.y, state.roofBuiltY + def.roofLiftUnits), 'the open shell keeps the built form');
  const closed = applyShell(root, shellPlan(def, false));
  assert.equal(closed.levelRestored, LEVEL_GROUND, 'closing lands on the level the viewer chose while open');
  assert.ok(near(roof.position.y, state.roofBuiltY - 3.12));
  // And back: open at ground, close restores ground; then upper round trip is clean.
  applyBuildingLevel(root, LEVEL_UPPER);
  assert.deepEqual(snapshot(root), upperSnap);
});

test('negative control: a single-storey building gains no upper set and no level control', async () => {
  const card = cardFor('LIBRARY_ANNEX');
  assert.equal(card.storeys, null, 'the Annex card evidences no storey count');
  const root = await loadBuilding('LIBRARY_ANNEX');
  // Its roof piece DOES sit at y = 3.12 — the trap the card gate exists for.
  assert.equal(findNamed(root, 'piece_Roof_RoundTiles_4x6').position.y, 3.119999885559082);
  const cls = classifyBuildingLevels(root, card);
  assert.equal(cls.hasUpper, false);
  assert.deepEqual(cls.upperNames, []);
  const before = snapshot(root);
  const state = registerBuildingLevel(root, card);
  assert.equal(levelChipEnabled(state), false, 'no level control for a single-storey building');
  const rep = applyBuildingLevel(root, LEVEL_UPPER);
  assert.equal(rep.hasUpper, false);
  assert.equal(state.level, LEVEL_GROUND);
  assert.deepEqual(snapshot(root), before, 'registering + applying a level changed nothing at all');
});

test('the chip wording is the tokens.json token, through the generated palette; scene.mjs consumes the model', () => {
  const token = TOKENS.groups.wording.tokens.find((t) => t.name === 'wording.camera.upperFloor');
  assert.ok(token, 'tokens.json carries wording.camera.upperFloor');
  assert.equal(token.value, 'Upper floor');
  assert.equal(CAMERA_WORDINGS.upperFloor, 'Upper floor', 'the wording reaches the scene through the generated palette');
  assert.match(LEVEL_SET_ASIDE_LINE, /sets the floor level aside/, 'the interior wording names the set-aside');
  const sceneSrc = readFileSync(new URL('../scene.mjs', import.meta.url), 'utf8');
  assert.match(sceneSrc, /registerBuildingLevel/, 'scene registers building levels at boot');
  assert.match(sceneSrc, /applyBuildingLevel/, 'scene applies levels through the model');
  assert.match(sceneSrc, /data-level-chip|levelChip/, 'scene renders the level chip');
  assert.match(sceneSrc, /CAMERA_WORDINGS\.upperFloor|LEVEL_CHIP_LABEL/, 'the chip label comes from the wording token');
  const publishSrc = readFileSync(new URL('../../../../staging/publish.mjs', import.meta.url), 'utf8');
  assert.match(publishSrc, /'buildings\.mjs'/, 'buildings.mjs (the level model) is in the staging publish set');
  assert.match(publishSrc, /'interiors\.mjs'/, 'interiors.mjs (the composition rule) is in the staging publish set');
  assert.match(publishSrc, /recursive: \['kits'\]/, 'the kit cards (the classification authority) are in the staging publish set');
});
