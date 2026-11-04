/* M4.10 — the scene's figure-kit manifest must cover the launch cast
   (the citizens the live bundle places), keyed by PORTAL-KEY, and every
   file it names must exist and load through the scene's own figure
   loader. The four M4.05 stand-in personas must NOT appear: the cast
   members they stood in for have real kits now, and no live citizen
   maps to a stand-in.
   Run per file: node --test test/figure-kits.test.mjs

   Headless scope: loader + manifest + file existence, the same scope
   as figure-loader.test.mjs. Rendered pixels belong to the staging
   screenshot ladder. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { register } from 'node:module';

globalThis.self = globalThis; // three r186 expects the browser global
register('./three-vendor-hook.mjs', import.meta.url);

const { createFigureLoader, parseFigure } = await import('../figure-loader.mjs');
const { kitLodUrl, attachFigureKits, kitlessCitizenKeys } = await import('../figure-kits.mjs');

const MANIFEST = new URL('../figure-kits.json', import.meta.url);
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const BUNDLE = JSON.parse(readFileSync(new URL('../../../data/feed/world-data.json', import.meta.url), 'utf8'));

const placedKeys = (BUNDLE.citizens || [])
  .filter((c) => c.placeCode)
  .map((c) => c.citizenKey)
  .sort();

test('manifest covers every citizen the live bundle places', () => {
  // The bundle advances under the archiver; the manifest records the
  // seq its cast was verified against. The durable assertion is the
  // protective direction: every PLACED citizen has a kit — a new
  // placed citizen must fail here until it has one.
  //
  // RE-PIN (2026-11-03, arabela-kit lane): this assertion used to be
  // exact set equality with the placed set. That direction broke on
  // record drift, not on any kit defect: Arabela Protoser — kit built
  // at M4.10, in this manifest since bundleSeq 193, placed as late as
  // seq 556 — fell silent after 2026-11-02T11:13:07Z and slid out of
  // the head voices window, so the bundle stopped placing her while
  // her kit correctly stays built and manifested. The factory
  // contracts pin the manifest to the built cast (kit records ==
  // manifest: factory standee.test.mjs; factory size-gate.test.mjs
  // classifies exports by the manifest), and the scene's consumer
  // (figure-kits.mjs attachFigureKits) iterates placed groups only,
  // so a manifested-but-quiet citizen is never rendered and can never
  // mask a missing kit. Exact equality with a sliding-window set is
  // therefore not the honesty invariant; coverage is. The reverse
  // inclusion is pinned below instead: every manifest entry must be
  // backed by a factory kit record (no phantom entries; test 3 then
  // verifies each entry's files against its record).
  assert.ok(Number.isInteger(manifest.bundleSeq) && manifest.bundleSeq <= BUNDLE.bundleSeq,
    'manifest must record a bundle seq its cast was taken from');
  const manifestKeys = Object.keys(manifest.kits).sort();
  assert.deepEqual(placedKeys.filter((k) => !manifestKeys.includes(k)), [],
    'every placed citizen must have a kit, keyed by PORTAL-KEY');
  const recordKeys = readdirSync(new URL('../../factory/kits/citizens/', import.meta.url))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(
      new URL(`../../factory/kits/citizens/${f}`, import.meta.url), 'utf8')).citizen_key)
    .sort();
  assert.deepEqual(manifestKeys.filter((k) => !recordKeys.includes(k)), [],
    'every manifest entry must be backed by a factory kit record');
});

test('no stand-in persona is wired as a citizen kit', () => {
  for (const entry of Object.values(manifest.kits)) {
    assert.ok(!['atlas', 'builder-1', 'verifier-1', 'alpha-lead'].includes(entry.kit),
      `stand-in ${entry.kit} must not be a citizen kit`);
  }
});

test('every manifest entry names real files and a matching kit record', () => {
  for (const [key, entry] of Object.entries(manifest.kits)) {
    assert.equal(entry.citizenKey, key);
    for (const rel of [entry.lod0, entry.lod1, entry.standeeManifest]) {
      assert.ok(existsSync(new URL(rel, MANIFEST)),
        `${key}: missing file ${rel}`);
    }
    const kit = JSON.parse(readFileSync(
      new URL(`../../factory/kits/citizens/${entry.kit}.json`, import.meta.url), 'utf8'));
    assert.equal(kit.citizen_key, key, `${entry.kit}: kit record key mismatch`);
    assert.equal(kit.identity_colour, entry.identityColour,
      `${entry.kit}: identity colour must match the kit record`);
  }
});

// -------------------------------- Kitless holdout (2026-11-03,
// G-J1 touch-up audit close-out): a placed citizen with no figure
// kit is NEVER rendered as a default human figure. The scene
// holds them out and names them on the roster rail instead
// (Pound Meridian is the forcing case: a cat, not an agent
// playing one). The partition rule + the attach contract are
// pinned here against synthetic fixtures; the scene's holdout
// consumption is pinned by the source contract below and by the
// staging effect check in the close-out record (rendered pixels
// belong to the screenshot ladder).

test('kitless partition: a planted kitless citizen is reported kitless and never attached', async () => {
  const manifestFx = { kits: { 'portal-key:kitted': { kit: 'kitted', lod1: 'x.glb' } } };
  assert.deepEqual(
    kitlessCitizenKeys(manifestFx, ['portal-key:kitted', 'portal-key:planted-cat']),
    ['portal-key:planted-cat'],
    'the planted citizen with no manifest entry is the kitless set');
  // Deliberate-failure control: give the planted citizen a kit
  // entry and the partition must come back empty — the check
  // discriminates instead of always firing.
  const covered = { kits: { ...manifestFx.kits, 'portal-key:planted-cat': { kit: 'cat', lod1: 'y.glb' } } };
  assert.deepEqual(
    kitlessCitizenKeys(covered, ['portal-key:kitted', 'portal-key:planted-cat']),
    [],
    'control: with a kit entry the planted citizen is not kitless');
  // Attach contract over fake groups: the kitless key is
  // reported, no load is attempted for it (there is no default
  // figure path to fall back to), and the kitted key attaches.
  const mkGroup = () => ({ children: [], add(c) { this.children.push(c); } });
  const groups = new Map([
    ['portal-key:kitted', mkGroup()],
    ['portal-key:planted-cat', mkGroup()],
  ]);
  const loaded = [];
  const load = async (url) => { loaded.push(url); return { scene: { name: '', traverse() {} }, animations: [] }; };
  const res = await attachFigureKits({ groups, manifest: manifestFx, load, THREE: null });
  assert.deepEqual(res.kitless, ['portal-key:planted-cat'], 'attachFigureKits reports the kitless key');
  assert.deepEqual(loaded, ['x.glb'], 'a kit load is attempted only for the kitted citizen');
  assert.deepEqual(res.attached, ['portal-key:kitted']);
  assert.deepEqual(res.failed, []);
  assert.equal(groups.get('portal-key:planted-cat').children.length, 0,
    'nothing is added to the kitless citizen’s group — no default figure');
});

test('kitless partition on the live bundle names exactly the coverage gap', () => {
  const kitless = kitlessCitizenKeys(manifest, placedKeys);
  const uncovered = placedKeys.filter((k) => !Object.keys(manifest.kits).includes(k));
  assert.deepEqual(kitless, uncovered,
    'the holdout set is exactly the placed-but-uncovered set — no more, no fewer');
  // The forcing cases, while the bundle places them (if either
  // leaves the bundle this skips; the partition law above is
  // the durable pin).
  for (const key of ['portal-key:pound-meridian', 'portal-key:aether-vane']) {
    if (placedKeys.includes(key)) {
      assert.ok(kitless.includes(key), `${key} must be held out while placed and kitless`);
    }
  }
});

test('the scene consumes the holdout (source contract)', () => {
  const src = readFileSync(new URL('../scene.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('res.kitless'), 'boot reads the kitless report from attachFigureKits');
  assert.ok(src.includes('__portalKitless'), 'boot exposes the held-out set for verification tooling');
  assert.ok(src.includes('not shown as a figure'), 'the roster rail names them present-not-shown, in those words');
  assert.ok(src.includes('labelChips.splice') && src.includes('citizenGroups.delete'),
    'boot removes the held-out citizen’s chip and citizen-map entry');
  // The rail write must fetch its own element: the budget
  // block's railEl is scoped to that block, and reusing the name
  // threw after the removals on the first staging effect check.
  const holdout = src.slice(src.indexOf('KITLESS HOLDOUT'));
  assert.ok(holdout.includes("document.getElementById('rail')"),
    'the holdout fetches the roster-rail element in its own scope');
});

test('every kit LOD1 loads through the scene figure loader with clips', async () => {
  const loader = createFigureLoader();
  for (const [key, entry] of Object.entries(manifest.kits)) {
    const url = new URL(kitLodUrl(entry), MANIFEST);
    const d = readFileSync(url);
    const gltf = await parseFigure(loader, d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
    let bones = 0;
    gltf.scene.traverse((o) => { if (o.isBone) bones++; });
    assert.equal(bones, 23, `${key}: Rig_Medium bone count`);
    assert.deepEqual(gltf.animations.map((a) => a.name).sort(), ['gather', 'idle', 'walk'],
      `${key}: LOD1 clip subset`);
    // Armature extras ride on the armature node (patch_extras restores them).
    let found = null;
    gltf.scene.traverse((o) => { if (o.name === 'Rig_Medium') found = o; });
    assert.ok(found, `${key}: armature node present`);
    assert.equal(found.userData.citizen_key, key, `${key}: armature extras carry the PORTAL-KEY`);
  }
});
