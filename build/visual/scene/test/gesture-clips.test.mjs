/* M5.05 — the scene's gesture-clip bind path: the shared gesture
   library loads through the scene's figure loader, every gesture
   the readability model names exists in the library with its
   source + licence recorded, the coverage record is honest about
   the ladder (UAL for talk, CUSTOM for nod/point/present, Mixamo
   unused), and the frame-check's measured talk-vs-listen
   separation is pinned against the filed report so a future
   library rebuild cannot silently blur the distinction the
   masked drill depends on.
   The full per-frame gate over the whole cast is the factory
   frame-check (build/visual/factory/scripts/frame_check_gesture.mjs).
   Run per file: node --test test/gesture-clips.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

globalThis.self = globalThis; // three r186 expects the browser global
register('./three-vendor-hook.mjs', import.meta.url);

const THREE = await import('../vendor/three.module.js');
const { createFigureLoader, parseFigure } = await import('../figure-loader.mjs');
const { GESTURE_CLIP_FOR, gestureCoverage, retargetClip, restPositions } = await import('../gesture-clips.mjs');
const { GESTURE_CLIPS } = await import('../../../app/logic.mjs');

async function loadLib() {
  const loader = createFigureLoader();
  const d = readFileSync(new URL('../../factory/outputs-web/clips/gesture-clips.glb', import.meta.url));
  return parseFigure(loader, d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
}

test('every gesture the model names exists in the library, and vice versa', async () => {
  const lib = await loadLib();
  const libNames = new Set(lib.animations.map((a) => a.name));
  assert.deepEqual([...libNames].sort(),
    ['gesture-listen', 'gesture-point', 'gesture-present', 'gesture-talk', 'gesture-talk-seated']);
  for (const [gesture, clip] of Object.entries(GESTURE_CLIP_FOR)) {
    assert.ok(libNames.has(clip), `${gesture} -> ${clip} exists in the library`);
    assert.ok(GESTURE_CLIPS[clip], `the shared model records ${clip} with source + licence`);
  }
  for (const name of libNames) assert.ok(GESTURE_CLIPS[name], `library clip ${name} is recorded in the model`);
});

test('coverage record: ladder rungs stated honestly — UAL talk, CUSTOM rest, Mixamo unused', () => {
  const cov = gestureCoverage();
  assert.equal(cov.covered.talk.length, 2, 'talk x2');
  for (const entry of cov.covered.talk) {
    assert.equal(entry.licence, 'CC0 1.0');
    assert.equal(entry.rung, 'UAL (CC0)');
    assert.match(entry.source, /Universal Animation Library 1/);
  }
  for (const gesture of ['listen', 'point', 'present']) {
    assert.equal(cov.covered[gesture].length, 1, `${gesture} covered`);
    assert.equal(cov.covered[gesture][0].rung, 'CUSTOM');
  }
  assert.match(cov.ladderNotes.mixamo, /not used/);
  assert.match(cov.ladderNotes['cc0-inventory'], /inventoried clip by clip/);
});

test('library extras carry per-clip sources (the publish-set proof)', async () => {
  const d = readFileSync(new URL('../../factory/outputs-web/clips/gesture-clips.glb', import.meta.url));
  const ln = new DataView(d.buffer, d.byteOffset).getUint32(12, true);
  const j = JSON.parse(d.subarray(20, 20 + ln).toString('utf8'));
  const armNode = j.nodes.find((n) => n.extras && n.extras.clip_sources);
  assert.ok(armNode, 'an armature node carries clip_sources');
  assert.equal(armNode.extras.clip_library, 'portal.gesture-clips/v1');
  const sources = JSON.parse(armNode.extras.clip_sources);
  assert.deepEqual(Object.keys(sources).sort(),
    ['gesture-listen', 'gesture-point', 'gesture-present', 'gesture-talk', 'gesture-talk-seated']);
  assert.equal(sources['gesture-talk'].licence, 'CC0 1.0');
  assert.equal(sources['gesture-listen'].rung, 'CUSTOM');
});

test('frame-check report: the talk/listen separation holds on every kit', () => {
  const report = JSON.parse(readFileSync(
    new URL('../../factory/work-citizens/gesture-clips-framecheck.json', import.meta.url), 'utf8'));
  assert.equal(report.totalFailed, 0, 'frame-check fully green');
  assert.equal(report.kits.length, 14, 'the whole cast');
  for (const kit of report.kits) {
    const by = Object.fromEntries(kit.results.map((r) => [r.clip, r]));
    assert.ok(by['gesture-talk'].maxJointMove >= 0.10, `${kit.kit}: talk moves the body`);
    assert.ok(by['gesture-talk'].headAngleRange <= 0.10, `${kit.kit}: talk is not a nod`);
    assert.ok(by['gesture-listen'].maxJointMove <= 0.05, `${kit.kit}: listening keeps the body still`);
    assert.ok(by['gesture-listen'].headAngleRange >= 0.15, `${kit.kit}: listening IS the nod`);
    assert.ok(by['gesture-point'].wristRange >= 0.3, `${kit.kit}: point travels the wrist`);
    assert.ok(by['gesture-present'].wristRange >= 0.3, `${kit.kit}: present travels both wrists`);
  }
});

test('retargetClip binds a gesture onto a kit without segment drag', async () => {
  const lib = await loadLib();
  const donorRest = restPositions(lib.scene);
  const loader = createFigureLoader();
  const d = readFileSync(new URL('../../factory/outputs-web/sapphire-clarke--lod0.glb', import.meta.url));
  const kit = await parseFigure(loader, d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
  const src = lib.animations.find((a) => a.name === 'gesture-talk');
  const out = retargetClip(THREE, src, donorRest, kit.scene);
  assert.equal(out.name, 'gesture-talk');
  assert.ok(!out.tracks.some((t) => t.name.endsWith('.scale')), 'no scale tracks survive');
});
