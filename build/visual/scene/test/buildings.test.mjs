/* M4.14 / M4.15 (D-9b) — the Ember building set.
   Run per file: node --test test/buildings.test.mjs

   What is proven here:
   - building-kits.json covers exactly the effective layout's places
     for the LIVE bundle (the 10 composed nodes + the staged-fill
     empty plot) — the exit gate's "zero labelled placeholder boxes"
     is judged on that coverage.
   - Every GLB exists, loads through the scene's own figure loader,
     and carries the contract nodes its kit card promises: cutaway
     holders, stations, and — for every place with a door in the
     footprint specs — anchor_door + anchor_sign.
   - The two CUSTOM builds hold their recipe caps (Benny the Pug
     statue ≤ 400 tris; the Ledger printing press ≤ 600 tris with a
     press_platen pivot).
   - M4.15's live sweep: the shipped bundle carries no integrity
     figure for any work, workTier therefore reads the
     not-in-the-public-record line for every place, no kit card
     carries a condition variant, no *_var_* variant GLB exists, and
     no integrity-tier colour (the four tiers' color/roof hexes from
     the app logic) appears in any building GLB's materials — zero
     condition cues anywhere in the set. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { register } from 'node:module';

globalThis.self = globalThis; // three r186 expects the browser global
register('./three-vendor-hook.mjs', import.meta.url);

const { createFigureLoader, parseFigure } = await import('../figure-loader.mjs');
const { attachBuildings, buildingConditionLine } = await import('../buildings.mjs');
const { effectiveLayout, workTier, INTEGRITY_TIERS, integrityTier } = await import('../../../app/logic.mjs');

const MANIFEST_URL = new URL('../building-kits.json', import.meta.url);
const manifest = JSON.parse(readFileSync(MANIFEST_URL, 'utf8'));
const LAYOUT = JSON.parse(readFileSync(new URL('../../../shared/ember-layout.json', import.meta.url), 'utf8'));
const BUNDLE = JSON.parse(readFileSync(new URL('../../../data/feed/world-data.json', import.meta.url), 'utf8'));
const SPECS = JSON.parse(readFileSync(new URL('../../footprint-specs.json', import.meta.url), 'utf8'));
const OUT_DIR = new URL('../../factory/outputs-buildings/', import.meta.url);

const eff = effectiveLayout(LAYOUT, BUNDLE);
const effCodes = eff.nodes.map((n) => n.code).sort();

function trisOf(root) {
  let tris = 0;
  root.traverse((o) => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return tris;
}
function findNode(root, name) {
  let hit = null;
  root.traverse((o) => { if (o.name === name) hit = o; });
  return hit;
}
function nodeNames(root) {
  const names = new Set();
  root.traverse((o) => { if (o.name) names.add(o.name); });
  return names;
}
async function loadEntry(entry) {
  const url = new URL(entry.glb, MANIFEST_URL);
  const d = readFileSync(url);
  const loader = createFigureLoader();
  return parseFigure(loader, d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
}

test('manifest covers exactly the effective layout places (live bundle)', () => {
  assert.ok(Number.isInteger(manifest.bundleSeq) && manifest.bundleSeq <= BUNDLE.bundleSeq,
    'manifest records the bundle seq its place set was verified against');
  assert.deepEqual(Object.keys(manifest.buildings).sort(), effCodes,
    'one building-kit entry per effective place, no extras');
});

test('every entry names a real GLB and a kit card that agrees', () => {
  for (const [code, entry] of Object.entries(manifest.buildings)) {
    assert.ok(existsSync(new URL(entry.glb, MANIFEST_URL)), `${code}: missing GLB ${entry.glb}`);
    const card = JSON.parse(readFileSync(new URL(entry.card, MANIFEST_URL), 'utf8'));
    assert.equal(card.code, code, `${code}: kit card code mismatch`);
    assert.equal(card.condition, null, `${code}: D-9b — kit card carries no condition variant`);
    assert.ok(Array.isArray(card.pieces) && card.pieces.length > 0,
      `${code}: kit card records the pieces the build placed`);
  }
});

test('every GLB loads and carries its contract nodes', async () => {
  const specByCode = new Map(SPECS.specs.map((p) => [p.code, p]));
  for (const [code, entry] of Object.entries(manifest.buildings)) {
    const gltf = await loadEntry(entry);
    const names = nodeNames(gltf.scene);
    // The cut/anchor contract binds building volumes. The two honest
    // treatments carry only what they have: the Plaza an interior
    // camera anchor (open place, nothing to cut), Plot 30 its gate
    // sign anchor (no building at all).
    if (entry.treatment === 'building') {
      for (const req of ['cut_roof', 'cut_wall_front', 'cut_wall_side', 'anchor_cam_interior']) {
        assert.ok(names.has(req), `${code}: missing ${req}`);
      }
    } else if (code === 'EMBER_PLAZA_OF_UNITY') {
      assert.ok(names.has('anchor_cam_interior'), `${code}: plaza carries its camera anchor`);
    } else {
      assert.ok(names.has('anchor_sign'), `${code}: empty plot carries its sign anchor`);
    }
    const spec = specByCode.get(code);
    if (spec && spec.door) {
      assert.ok(names.has('anchor_door'), `${code}: spec gives a door — GLB must carry anchor_door`);
      assert.ok(names.has('anchor_sign'), `${code}: spec gives a door — GLB must carry anchor_sign`);
    }
    assert.ok(trisOf(gltf.scene) > 0, `${code}: GLB has geometry`);
  }
});

test('CUSTOM caps: Benny statue ≤ 400 tris; Ledger press ≤ 600 with a platen pivot', async () => {
  const plaza = await loadEntry(manifest.buildings.EMBER_PLAZA_OF_UNITY);
  const statue = findNode(plaza.scene, 'benny_statue');
  assert.ok(statue, 'plaza GLB carries the benny_statue group');
  assert.ok(trisOf(statue) <= 400, `statue is ${trisOf(statue)} tris (recipe cap 400)`);

  const press = await loadEntry(manifest.buildings.EMBER_DISTRICT_1_PLOT_31);
  const pressNode = findNode(press.scene, 'printing_press');
  assert.ok(pressNode, 'press GLB carries the printing_press group');
  assert.ok(trisOf(pressNode) <= 600, `press is ${trisOf(pressNode)} tris (recipe cap 600)`);
  assert.ok(findNode(pressNode, 'press_platen'), 'press carries the press_platen pivot sub-node');
});

test('attachBuildings hides placeholders, registers picks, reports missing honestly', async () => {
  // Positive control with stub groups: the seam scene.mjs boots through.
  const THREE = await import('../vendor/three.module.js');
  const groups = new Map();
  const nodes = new Map();
  for (const n of eff.nodes) {
    const g = new THREE.Group();
    const ph = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    ph.userData.placeholder = true;
    g.add(ph);
    const keep = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5));
    g.add(keep);
    groups.set(n.code, g);
    nodes.set(n.code, n);
  }
  const loader = createFigureLoader();
  const load = async (rel) => {
    const url = new URL(rel, MANIFEST_URL);
    const d = readFileSync(url);
    return parseFigure(loader, d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
  };
  const pickables = [];
  const res = await attachBuildings({ groups, nodes, manifest, load, pickables });
  assert.deepEqual(res.failed, [], 'no attach failures against the shipped manifest');
  assert.deepEqual(res.missing, [], 'no place missing from the manifest');
  assert.deepEqual(res.attached.sort(), effCodes, 'every place attached');
  for (const [code, g] of groups) {
    const ph = g.children.find((c) => c.userData && c.userData.placeholder === true);
    assert.equal(ph.visible, false, `${code}: placeholder hidden once the kit lands`);
    const keep = g.children.find((c) => c.geometry && c.geometry.parameters && c.geometry.parameters.width === 0.5);
    assert.equal(keep.visible, true, `${code}: non-placeholder children untouched`);
  }
  assert.ok(pickables.length > 0, 'building meshes registered as pickables');
  assert.ok(pickables.every((m) => m.userData.pick && m.userData.pick.type === 'building'),
    'every registered pick is a building pick');
});

test('M4.15 live sweep: zero condition cues anywhere in the set', async () => {
  // The bundle itself: no work carries an integrity figure.
  for (const w of (BUNDLE.world && BUNDLE.world.works) || BUNDLE.works || []) {
    assert.equal(w.integrity, null, `work ${w.code || w.placeCode} carries an integrity figure`);
  }
  if (BUNDLE.ember && BUNDLE.ember.works) {
    for (const w of BUNDLE.ember.works) assert.equal(w.integrity, null, 'ember.works integrity must be null');
  }
  // The card line for every place is the not-in-the-public-record one.
  const noneLabel = integrityTier(null).label;
  for (const code of effCodes) {
    assert.equal(workTier(BUNDLE, code).key, 'none', `${code}: workTier must read the none tier`);
    assert.equal(buildingConditionLine(workTier, BUNDLE, code), `Repair: ${noneLabel}.`,
      `${code}: scene card line comes from the app wording source`);
  }
  // No variant GLBs on disk.
  const varFiles = readdirSync(OUT_DIR).filter((f) => f.includes('_var_'));
  assert.deepEqual(varFiles, [], 'no condition-variant GLBs in outputs-buildings');
  // No integrity-tier colour in any building GLB's materials.
  const tierHexes = new Set();
  for (const t of INTEGRITY_TIERS) { tierHexes.add(t.color.toLowerCase()); tierHexes.add(t.roof.toLowerCase()); }
  for (const [code, entry] of Object.entries(manifest.buildings)) {
    const gltf = await loadEntry(entry);
    const seen = new Set();
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.material && o.material.color) seen.add('#' + o.material.color.getHexString());
    });
    for (const hex of seen) {
      assert.ok(!tierHexes.has(hex.toLowerCase()), `${code}: material colour ${hex} is an integrity-tier colour`);
    }
  }
});
