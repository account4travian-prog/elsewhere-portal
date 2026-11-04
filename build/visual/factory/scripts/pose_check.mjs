/* Posed-deformation sanity check for factory GLBs — Portal tool (M4.10).
   Loads a GLB with the scene's own stack (three GLTFLoader + MeshoptDecoder,
   the M4.16 wiring), applies clips through an AnimationMixer, and measures
   the posed point cloud per clip: whole-figure bounds plus the low-body
   region (bind height < 0.5 — where capes/skirts live). Comparing a web
   LOD against its master this way shows whether cloth-region vertices
   deform sanely in the loader the scene actually uses, independent of
   Blender's meshopt re-import (which degrades skinned files — M4.09).
   Run: node pose_check.mjs <file.glb> [...]
   Prints one JSON object per file. */
import { readFileSync } from 'node:fs';
globalThis.self = globalThis;
const BASE = '/home/user/workspace/agent-office/spike/agent-office/node_modules/three/examples/jsm';
const THREE = await import('/home/user/workspace/agent-office/spike/agent-office/node_modules/three/build/three.module.js');
const { GLTFLoader } = await import(`${BASE}/loaders/GLTFLoader.js`);
const { MeshoptDecoder } = await import(`${BASE}/libs/meshopt_decoder.module.js`);

const POSES = [['idle', 0], ['walk', 0.5], ['sit', 0.5], ['knock', 0.4], ['type', 0.5]];

for (const path of process.argv.slice(2)) {
  const data = readFileSync(path);
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(ab, '');
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  // Bind-pose vertex info per skinned mesh: world bind position + low flag.
  const meshes = [];
  scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
  const bindInfo = meshes.map(m => {
    const pos = m.geometry.attributes.position;
    const v = new THREE.Vector3();
    const low = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      low.push(v.y < 0.5);
    }
    return low;
  });
  const clips = Object.fromEntries(gltf.animations.map(a => [a.name, a]));
  const out = { file: path.split('/').pop(), poses: {} };
  const tmp = new THREE.Vector3();
  for (const [clipName, frac] of POSES) {
    const clip = clips[clipName];
    if (!clip) { out.poses[clipName] = null; continue; }
    const mixer = new THREE.AnimationMixer(scene);
    const action = mixer.clipAction(clip);
    action.play();
    mixer.setTime(clip.duration * frac);
    scene.updateMatrixWorld(true);
    // The WebGL renderer refreshes skeletons every frame; headless, do it
    // explicitly or boneMatrices lag the mixer.
    meshes.forEach(m => m.skeleton && m.skeleton.update());
    let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    const lowPts = [];
    meshes.forEach((m, mi) => {
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        // getVertexPosition returns LOCAL space (it undoes bindMatrix);
        // world = local x matrixWorld. For meshopt files the mesh node
        // carries the KHR_mesh_quantization dequant scale, so skipping
        // this step reads raw quantized integers (~7700x too large).
        m.getVertexPosition(i, tmp).applyMatrix4(m.matrixWorld);
        for (let k = 0; k < 3; k++) {
          if (tmp.getComponent(k) < min[k]) min[k] = tmp.getComponent(k);
          if (tmp.getComponent(k) > max[k]) max[k] = tmp.getComponent(k);
        }
        if (bindInfo[mi][i]) lowPts.push([tmp.x, tmp.y, tmp.z]);
      }
    });
    const cen = [0, 1, 2].map(k => lowPts.reduce((s, p) => s + p[k], 0) / Math.max(1, lowPts.length));
    const spread = Math.sqrt(lowPts.reduce((s, p) =>
      s + (p[0] - cen[0]) ** 2 + (p[1] - cen[1]) ** 2 + (p[2] - cen[2]) ** 2, 0) / Math.max(1, lowPts.length));
    out.poses[clipName] = {
      size: max.map((v, k) => +(v - min[k]).toFixed(3)),
      min: min.map(v => +v.toFixed(3)),
      lowCount: lowPts.length,
      lowCentroid: cen.map(v => +v.toFixed(3)),
      lowSpread: +spread.toFixed(3),
    };
    mixer.stopAllAction();
  }
  console.log(JSON.stringify(out));
}
