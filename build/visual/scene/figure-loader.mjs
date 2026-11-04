// Elsewhere Portal — scene figure loader (M4.16).
//
// The one GLTF loading path for production figures in this scene. The
// factory's web profile (M4.05) emits meshopt-compressed GLBs
// (EXT_meshopt_compression, via gltfpack), and three's GLTFLoader
// refuses such files until a MeshoptDecoder is set on it — the lifted
// factory load_test.mjs fails them for exactly that reason, and the
// factory's load_test_web.mjs exists to wire the decoder the same way
// this module does. Every figure load in the scene goes through
// createFigureLoader() so the decoder wiring lives in exactly one
// place; test/figure-loader.test.mjs fails if it is removed.
//
// Decoder: the meshopt_decoder.module.js vendored in ./vendor — the
// three r186 addons build, byte-identical to the meshoptimizer 1.1.1
// package's own module (see ASSETS.md). Not hand-rolled.

import { GLTFLoader } from './vendor/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/meshopt_decoder.module.js';

// A GLTFLoader with the MeshoptDecoder wired in — the only loader
// constructor the scene uses for figure GLBs.
export function createFigureLoader() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

// Parse an in-memory GLB/GLTF through a figure loader (the harness and
// future in-scene fetches share this exact call).
export function parseFigure(loader, data, path = '') {
  return loader.parseAsync(data, path);
}

// Fetch + parse a figure GLB by URL through a figure loader.
export async function loadFigure(loader, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`figure fetch failed: ${res.status} ${url}`);
  return parseFigure(loader, await res.arrayBuffer(), url);
}
