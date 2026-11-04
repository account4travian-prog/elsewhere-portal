/* M4.16 — the scene's figure loader must decode the factory web
   profile's meshopt-compressed GLBs, and the decoder wiring must be
   load-bearing: the same file through a bare GLTFLoader (no
   setMeshoptDecoder) refuses to load. If anyone removes the wiring
   from figure-loader.mjs or unwires it from scene.mjs, this file
   fails. Run per file: node --test test/figure-loader.test.mjs

   Headless scope, stated plainly: this exercises the scene's loader +
   decoder wiring and the decoded scene graph (mesh/bone/clip counts,
   triangle totals). It renders nothing — the rendered-pixel check
   belongs to the staging screenshot ladder, not here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

globalThis.self = globalThis; // three r186 expects the browser global (same shim as the factory load tests)
register('./three-vendor-hook.mjs', import.meta.url); // bare 'three' -> ../vendor/three.module.js

const { createFigureLoader, parseFigure } = await import('../figure-loader.mjs');
const { GLTFLoader } = await import('../vendor/GLTFLoader.js');

const ATLAS_LOD0 = new URL('../../factory/outputs-web/atlas--lod0.glb', import.meta.url);
function glbBuffer() {
  const d = readFileSync(ATLAS_LOD0);
  return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
}
function census(gltf) {
  let meshes = 0, bones = 0, tris = 0;
  gltf.scene.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      meshes++;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
    if (o.isBone) bones++;
  });
  return { meshes, bones, tris };
}

test('scene figure loader decodes the meshopt-compressed atlas LOD0 export', async () => {
  const gltf = await parseFigure(createFigureLoader(), glbBuffer());
  const { meshes, bones, tris } = census(gltf);
  // Factory-recorded for this exact file: 2,380 tris (factory STATUS,
  // M4.05 entry) and meshes 16 / bones 17 / 8 clips per the factory's
  // own decoder-equipped load test (scripts/load_test_web.mjs).
  assert.equal(tris, 2380);
  assert.equal(meshes, 16);
  assert.equal(bones, 17);
  assert.deepEqual(
    gltf.animations.map((a) => a.name).sort(),
    ['gather', 'idle', 'knock', 'sit', 'stand', 'type', 'wait', 'walk']);
});

test('positive control: the same GLB refuses to load without the decoder wiring', async () => {
  const bare = new GLTFLoader(); // vendored loader, deliberately no setMeshoptDecoder
  await assert.rejects(() => bare.parseAsync(glbBuffer(), ''), /MeshoptDecoder/);
});

test('the decoder wiring is present in the scene sources (removal fails here)', () => {
  const wiring = readFileSync(new URL('../figure-loader.mjs', import.meta.url), 'utf8');
  assert.match(wiring, /setMeshoptDecoder\(MeshoptDecoder\)/);
  assert.match(wiring, /from '\.\/vendor\/meshopt_decoder\.module\.js'/);
  const scene = readFileSync(new URL('../scene.mjs', import.meta.url), 'utf8');
  assert.match(scene, /from '\.\/figure-loader\.mjs'/);
  assert.match(scene, /createFigureLoader\(\)/);
});
