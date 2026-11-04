/* M4.08 — the scene's work-clip bind path: the shared library loads
   through the scene's figure loader, retargetClip re-bases position
   tracks onto each kit's own rest pose (the raw library measurably
   drags a Knight's segments — the re-base is load-bearing, and this
   file proves it on the worst case), scale tracks are dropped,
   rotations pass through, and the family coverage record is honest
   about the carry gap. Run per file: node --test test/work-clips.test.mjs

   Headless scope: loader + clip math + bindery. The full per-frame
   gate over the whole cast is the factory frame-check
   (build/visual/factory/scripts/frame_check_work.mjs); this file
   pins the scene-side function that check exercises. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

globalThis.self = globalThis; // three r186 expects the browser global
register('./three-vendor-hook.mjs', import.meta.url);

const THREE = await import('../vendor/three.module.js');
const { createFigureLoader, parseFigure } = await import('../figure-loader.mjs');
const { FAMILY_CLIPS, clipCoverage, restPositions, retargetClip } = await import('../work-clips.mjs');

async function loadLib() {
  const loader = createFigureLoader();
  const d = readFileSync(new URL('../../factory/outputs-web/clips/work-clips.glb', import.meta.url));
  return parseFigure(loader, d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
}
async function loadKit(slug) {
  const loader = createFigureLoader();
  const d = readFileSync(new URL(`../../factory/outputs-web/${slug}--lod0.glb`, import.meta.url));
  return parseFigure(loader, d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
}

test('family map names only clips that exist (library or kit-carried)', async () => {
  const lib = await loadLib();
  const libNames = new Set(lib.animations.map((a) => a.name));
  const kit = await loadKit('orrin-lowmarsh');
  const kitNames = new Set(kit.animations.map((a) => a.name));
  for (const [family, clip] of Object.entries(FAMILY_CLIPS)) {
    assert.ok(libNames.has(clip) || kitNames.has(clip), `${family} -> ${clip} must exist`);
  }
  for (const name of ['work-hammer', 'work-dig', 'work-pickaxe', 'work-saw', 'work-chop', 'work-fish', 'work-pickup', 'rest-lie']) {
    assert.ok(libNames.has(name), `library carries ${name}`);
  }
});

test('coverage record: carry families are gaps, not claims', () => {
  const cov = clipCoverage();
  assert.deepEqual(cov.covered['deliver-mend'], []);
  assert.deepEqual(cov.covered['haul'], []);
  assert.match(cov.gaps['deliver-mend'], /No carry locomotion clip/);
  assert.ok(cov.covered['excavate'].length >= 2);
});

function segmentError(root, clip, samples = 15) {
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip); action.play();
  const node = (n) => { let f = null; root.traverse((o) => { if (o.name === n) f = o; }); return f; };
  const pairs = [['armL', 'forearmL'], ['forearmL', 'handL'], ['legL', 'shinL'], ['shinL', 'extrafootL']];
  root.updateMatrixWorld(true);
  const bind = pairs.map(([a, b]) => node(a).getWorldPosition(new THREE.Vector3()).distanceTo(node(b).getWorldPosition(new THREE.Vector3())));
  let maxErr = 0;
  for (let s = 0; s < samples; s++) {
    mixer.setTime((clip.duration * s) / (samples - 1));
    root.updateMatrixWorld(true);
    pairs.forEach(([a, b], i) => {
      const d = node(a).getWorldPosition(new THREE.Vector3()).distanceTo(node(b).getWorldPosition(new THREE.Vector3()));
      maxErr = Math.max(maxErr, Math.abs(d - bind[i]));
    });
  }
  action.stop();
  return maxErr;
}

test('retargetClip: the Knight case — raw library drags segments, re-based does not', async () => {
  const lib = await loadLib();
  const donorRest = restPositions(lib.scene);
  const kit = await loadKit('sapphire-clarke'); // Knight base: worst measured rest-offset divergence
  const raw = lib.animations.find((a) => a.name === 'work-dig');
  const rawErr = segmentError(kit.scene, raw);
  assert.ok(rawErr > 0.015, `raw library should measurably drag the Knight's segments (got ${rawErr.toFixed(4)}) — if this fails, the re-base may already be baked in and this test's premise needs re-checking`);
  const fixed = retargetClip(THREE, raw, donorRest, kit.scene);
  const fixedErr = segmentError(kit.scene, fixed);
  assert.ok(fixedErr <= 0.01, `re-based clip must hold segments (got ${fixedErr.toFixed(4)})`);
  // The library clip itself is never mutated by the re-base:
  assert.equal(lib.animations.find((a) => a.name === 'work-dig'), raw);
});

test('retargetClip: scale tracks dropped, rotations and timing untouched', async () => {
  const lib = await loadLib();
  const donorRest = restPositions(lib.scene);
  const kit = await loadKit('orrin-lowmarsh');
  const src = lib.animations.find((a) => a.name === 'work-hammer');
  const out = retargetClip(THREE, src, donorRest, kit.scene);
  assert.ok(!out.tracks.some((t) => t.name.endsWith('.scale')), 'no scale tracks survive');
  const srcRot = src.tracks.filter((t) => t.name.endsWith('.quaternion'));
  const outRot = out.tracks.filter((t) => t.name.endsWith('.quaternion'));
  assert.equal(outRot.length, srcRot.length);
  assert.deepEqual([...outRot[0].values], [...srcRot[0].values], 'rotation values pass through byte-for-byte');
  assert.equal(out.duration, src.duration);
  assert.equal(out.name, src.name);
});
