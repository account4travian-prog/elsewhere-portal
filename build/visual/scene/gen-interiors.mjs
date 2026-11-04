// Elsewhere Portal — M5.08 interior registry generator.
//
// Reads the M4.14 building set as it stands — building-kits.json
// (the scene manifest), the factory kit cards it names, the GLBs
// themselves, and the footprint specs — and emits interior-kits.json:
// for each of the seven civic interiors, the named stations, the
// door / interior-camera / sign anchors, and the cutaway node set,
// all in building-local coordinates read out of the GLB node tree
// (transforms composed down the hierarchy, never hand-copied).
//
// A place becomes an interior here only when its GLB carries BOTH
// the cutaway contract (cut_roof + anchor_cam_interior, pinned by
// the M4.14 buildings test) AND at least one named station. The
// Plaza (open place) and Plot 30 (no building) fail the first test;
// the cottages fail the second — none of them is an interior, and
// none is quietly promoted into one.
//
// Usage: node gen-interiors.mjs [--check]
//   default: write interior-kits.json beside this module.
//   --check: exit non-zero when the file on disk differs (the
//   determinism pin the interiors test runs).

import { readFileSync, writeFileSync } from 'node:fs';

const HERE = new URL('./', import.meta.url);
const MANIFEST = JSON.parse(readFileSync(new URL('./building-kits.json', import.meta.url), 'utf8'));
const SPECS = JSON.parse(readFileSync(new URL('../footprint-specs.json', import.meta.url), 'utf8'));
const specByCode = new Map(SPECS.specs.map((s) => [s.code, s]));

// Station kinds: a FUNCTIONAL station names a role (the lectern is
// the lecturer's place; the press is the printer's). Only a staging
// with an evidenced role may put a figure there. A GENERAL station
// is a place anyone evidenced in the room may stand (a dinner seat,
// the shelves, the notice board).
const FUNCTIONAL_STATIONS = new Set(['lectern', 'press', 'workbench', 'counter', 'dinner_host']);

function stationLabel(suffix) {
  return suffix.split('_').map((w) => (w === 'dinner' || w === 'seat' || w === 'shelves' || w === 'host'
    ? w[0].toUpperCase() + w.slice(1)
    : /^\d+$/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
}

// --- minimal GLB read: JSON chunk + node world transforms --------
function glbJson(buf) {
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB');
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + len));
}
function quatToMat(q) {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0,
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0,
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
}
function compose(node) {
  // column-major 4x4 from TRS (matrix field wins when present)
  if (Array.isArray(node.matrix)) return node.matrix.slice();
  const t = node.translation || [0, 0, 0];
  const s = node.scale || [1, 1, 1];
  const r = quatToMat(node.rotation || [0, 0, 0, 1]);
  const m = r.slice();
  for (let c = 0; c < 3; c++) for (let row = 0; row < 3; row++) m[c * 4 + row] *= s[c];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  return m;
}
function mul(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += a[k * 4 + row] * b[c * 4 + k];
    out[c * 4 + row] = v;
  }
  return out;
}
function nodeWorldPositions(gltf) {
  const world = new Map(); // name -> [x,y,z] of the node's origin
  const visit = (idx, parentM) => {
    const node = gltf.nodes[idx];
    const m = mul(parentM, compose(node));
    if (node.name) world.set(node.name, [m[12], m[13], m[14]]);
    for (const c of node.children || []) visit(c, m);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const sceneDef of gltf.scenes || []) for (const idx of sceneDef.nodes || []) visit(idx, identity);
  return world;
}

const round3 = (v) => Math.round(v * 1000) / 1000;

export function buildInteriorRegistry() {
  const interiors = {};
  for (const [code, entry] of Object.entries(MANIFEST.buildings || {})) {
    if (entry.treatment !== 'building') continue;
    const glb = readFileSync(new URL(entry.glb, HERE));
    const world = nodeWorldPositions(glbJson(glb));
    const names = [...world.keys()];
    const stations = [];
    for (const name of names.filter((n) => n.startsWith('station_')).sort()) {
      const suffix = name.slice('station_'.length);
      const base = suffix.replace(/_\d+$/, '');
      stations.push({
        id: name,
        suffix,
        label: stationLabel(suffix),
        kind: FUNCTIONAL_STATIONS.has(base) ? 'functional' : 'general',
        position: world.get(name).map(round3),
      });
    }
    if (!names.includes('cut_roof') || !names.includes('anchor_cam_interior') || stations.length === 0) continue;
    const spec = specByCode.get(code);
    const card = JSON.parse(readFileSync(new URL(entry.card, HERE), 'utf8'));
    interiors[code] = {
      code,
      label: entry.label,
      slug: entry.slug,
      doorFace: card.door ? card.door.face : null,
      footprint: spec && spec.footprint
        ? { widthUnits: spec.footprint.widthUnits, depthUnits: spec.footprint.depthUnits }
        : null,
      stations,
      anchors: {
        door: world.has('anchor_door') ? world.get('anchor_door').map(round3) : null,
        camInterior: world.get('anchor_cam_interior').map(round3),
        sign: world.has('anchor_sign') ? world.get('anchor_sign').map(round3) : null,
      },
      cutNodes: ['cut_wall_front', 'cut_wall_side'].filter((n) => names.includes(n)),
      roofNode: 'cut_roof',
      roofLiftUnits: 3,
    };
  }
  return {
    schema: 'portal.interior-kits/v1',
    generatedBy: 'build/visual/scene/gen-interiors.mjs',
    source: 'building-kits.json + factory kit cards + outputs-buildings GLBs + footprint-specs.json',
    interiors,
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const registry = buildInteriorRegistry();
  const text = JSON.stringify(registry, null, 1) + '\n';
  const outUrl = new URL('./interior-kits.json', import.meta.url);
  if (process.argv.includes('--check')) {
    const onDisk = readFileSync(outUrl, 'utf8');
    if (onDisk !== text) { console.error('interior-kits.json differs from a fresh generation'); process.exit(1); }
    console.log('interior-kits.json is current');
  } else {
    writeFileSync(outUrl, text);
    console.log(`wrote interior-kits.json — ${Object.keys(registry.interiors).length} interiors`);
  }
}
