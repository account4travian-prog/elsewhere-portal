/* Load test for WEB-PROFILE (meshopt-compressed) factory GLBs — Portal tool.
   The lifted load_test.mjs predates the web profile: its GLTFLoader has no
   MeshoptDecoder, so it refuses EXT_meshopt_compression files outright
   ("setMeshoptDecoder must be called before loading compressed files").
   This variant wires the decoder from the same vendored three package the
   lifted test resolves from, and prints the same JSON shape.
   Run: node load_test_web.mjs <file.glb> [...] */
import { readFileSync } from 'node:fs';
globalThis.self = globalThis; // three r186 expects the browser global in workers/web
const BASE = '/home/user/workspace/agent-office/spike/agent-office/node_modules/three/examples/jsm';
const { GLTFLoader } = await import(`${BASE}/loaders/GLTFLoader.js`);
const { MeshoptDecoder } = await import(`${BASE}/libs/meshopt_decoder.module.js`);

for (const path of process.argv.slice(2)) {
  const data = readFileSync(path);
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.parseAsync(ab, '');
    const anims = gltf.animations.map(a => a.name);
    let meshes = 0, bones = 0;
    gltf.scene.traverse(o => { if (o.isMesh || o.isSkinnedMesh) meshes++; if (o.isBone) bones++; });
    console.log(JSON.stringify({ file: path.split('/').pop(), ok: true, meshes, bones, animations: anims }));
  } catch (e) {
    console.log(JSON.stringify({ file: path.split('/').pop(), ok: false, error: String(e).slice(0, 300) }));
  }
}
