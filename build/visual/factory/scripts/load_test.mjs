/* three.js load test for factory GLBs. Run:
   node load_test.mjs <file.glb> [...]
   three is resolved from the locally vendored copy in the spike project. */
import { readFileSync } from 'node:fs';
globalThis.self = globalThis; // three r186 expects the browser global in workers/web
const { GLTFLoader } = await import('/home/user/workspace/agent-office/spike/agent-office/node_modules/three/examples/jsm/loaders/GLTFLoader.js');

for (const path of process.argv.slice(2)) {
  const data = readFileSync(path);
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  try {
    const gltf = await new GLTFLoader().parseAsync(ab, '');
    const anims = gltf.animations.map(a => a.name);
    let meshes = 0, bones = 0;
    gltf.scene.traverse(o => { if (o.isMesh || o.isSkinnedMesh) meshes++; if (o.isBone) bones++; });
    console.log(JSON.stringify({ file: path.split('/').pop(), ok: true, meshes, bones, animations: anims }));
  } catch (e) {
    console.log(JSON.stringify({ file: path.split('/').pop(), ok: false, error: String(e).slice(0, 300) }));
  }
}
