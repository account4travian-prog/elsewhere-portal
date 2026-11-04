#!/usr/bin/env node
// measure-figure.mjs — the Elsewhere Portal figure proportion gate.
//
// Loads a binary GLB, walks its node hierarchy, and measures the head's
// share of total height against chibi-params.json (stations from
// LOOK-BIBLE-V0.md §5). Dependency-free: it reads only the glTF JSON
// chunk and each POSITION accessor's min/max, which the glTF spec
// guarantees — it never decodes vertex buffers.
//
// The head is the subtree of any node whose name matches the head
// pattern (default /head/i, so Head, head, "Bip01 Head", "HeadTop_End"
// all match; override with --head-pattern). If no node matches, the tool
// FAILS LOUDLY with the full node list — it never guesses which node
// might be the head.
//
// Exit codes: 0 = gate PASS, 1 = gate FAIL (a gate-severity station out
// of band), 2 = measurement impossible (unreadable file, corrupt or
// truncated GLB, no head node, degenerate height).
//
// Severity semantics (from the Bible, encoded in chibi-params.json):
// 'gate' stations decide the exit code; 'score' stations (the look
// target) print PASS/FAIL but never fail the gate — a figure above the
// look target but inside production is look-dulling at most (Bible §5).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

function fail(message) {
  throw new Error(`measure-figure: ${message}`);
}

// ---------------------------------------------------------------- GLB in

export function parseGlb(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length < 12) {
    fail(`file is ${buffer.length} bytes — too short for a GLB header (truncated?)`);
  }
  const magic = buffer.readUInt32LE(0);
  if (magic !== GLB_MAGIC) {
    fail('not a GLB file (bad magic; a .gltf JSON file is not a binary GLB)');
  }
  const version = buffer.readUInt32LE(4);
  if (version !== 2) fail(`unsupported GLB version ${version} (expected 2)`);
  const declaredLength = buffer.readUInt32LE(8);
  if (declaredLength > buffer.length) {
    fail(
      `truncated GLB: header declares ${declaredLength} bytes, file has ${buffer.length}`
    );
  }
  if (declaredLength < 20) fail('corrupt GLB: declared length too small for one chunk');
  const body = buffer.subarray(0, declaredLength);
  const chunkLength = body.readUInt32LE(12);
  const chunkType = body.readUInt32LE(16);
  if (chunkType !== CHUNK_JSON) {
    fail('corrupt GLB: first chunk is not the JSON chunk');
  }
  if (20 + chunkLength > body.length) {
    fail('truncated GLB: JSON chunk overruns the file');
  }
  let gltf;
  try {
    gltf = JSON.parse(body.toString('utf8', 20, 20 + chunkLength));
  } catch (err) {
    fail(`corrupt GLB: JSON chunk does not parse (${err.message})`);
  }
  if (!gltf || !Array.isArray(gltf.nodes)) {
    fail('corrupt GLB: glTF JSON has no nodes array');
  }
  return gltf;
}

// ------------------------------------------------------- transform maths
// Column-major 4x4 matrices, glTF convention: world = parent * local.

function mat4Identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function mat4Multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function mat4FromNode(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    return node.matrix.slice();
  }
  const t = node.translation || [0, 0, 0];
  const q = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  // Rotation columns, each scaled by the matching scale component.
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function transformPoint(m, p) {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

// ------------------------------------------------------------ measuring

function meshLocalBounds(gltf, meshIndex) {
  const mesh = gltf.meshes && gltf.meshes[meshIndex];
  if (!mesh) fail(`node references missing mesh ${meshIndex}`);
  let min = null;
  let max = null;
  for (const primitive of mesh.primitives || []) {
    const accessorIndex = primitive.attributes && primitive.attributes.POSITION;
    const accessor = gltf.accessors && gltf.accessors[accessorIndex];
    if (!accessor || !Array.isArray(accessor.min) || !Array.isArray(accessor.max)) {
      fail(
        `mesh ${meshIndex} has a POSITION accessor without min/max ` +
          '(the glTF spec requires them; this tool does not decode buffers)'
      );
    }
    if (min === null) {
      min = accessor.min.slice();
      max = accessor.max.slice();
    } else {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], accessor.min[i]);
        max[i] = Math.max(max[i], accessor.max[i]);
      }
    }
  }
  return { min, max };
}

export function measureFigure(gltf, headPattern) {
  const pattern =
    headPattern instanceof RegExp ? headPattern : new RegExp(headPattern, 'i');
  const allNodeNames = gltf.nodes.map((n, i) => n.name || `<unnamed #${i}>`);
  const roots = [];
  if (Array.isArray(gltf.scenes) && gltf.scenes.length > 0) {
    for (const scene of gltf.scenes) {
      for (const idx of scene.nodes || []) roots.push(idx);
    }
  } else {
    const childSet = new Set();
    for (const n of gltf.nodes) for (const c of n.children || []) childSet.add(c);
    gltf.nodes.forEach((_, i) => {
      if (!childSet.has(i)) roots.push(i);
    });
  }

  let totalMinY = Infinity;
  let totalMaxY = -Infinity;
  let headMinY = Infinity;
  let headMaxY = -Infinity;
  const headNodeNames = [];

  const visit = (index, parentMatrix, inHead) => {
    const node = gltf.nodes[index];
    if (!node) fail(`scene references missing node ${index}`);
    const world = mat4Multiply(parentMatrix, mat4FromNode(node));
    let inside = inHead;
    if (typeof node.name === 'string' && pattern.test(node.name)) {
      inside = true;
      if (!inHead) headNodeNames.push(node.name);
    }
    if (typeof node.mesh === 'number') {
      const { min, max } = meshLocalBounds(gltf, node.mesh);
      for (const cx of [min[0], max[0]]) {
        for (const cy of [min[1], max[1]]) {
          for (const cz of [min[2], max[2]]) {
            const p = transformPoint(world, [cx, cy, cz]);
            totalMinY = Math.min(totalMinY, p[1]);
            totalMaxY = Math.max(totalMaxY, p[1]);
            if (inside) {
              headMinY = Math.min(headMinY, p[1]);
              headMaxY = Math.max(headMaxY, p[1]);
            }
          }
        }
      }
    }
    for (const child of node.children || []) visit(child, world, inside);
  };
  for (const root of roots) visit(root, mat4Identity(), false);

  if (headNodeNames.length === 0) {
    fail(
      `no head node matched pattern ${pattern} — refusing to guess. ` +
        `Nodes in file: ${allNodeNames.join(' | ')}`
    );
  }
  if (!Number.isFinite(totalMinY) || !Number.isFinite(headMinY)) {
    fail('no mesh geometry found under the scene (or under the head node)');
  }
  const totalHeight = totalMaxY - totalMinY;
  const headHeight = headMaxY - headMinY;
  if (!(totalHeight > 0)) fail(`degenerate figure: total height ${totalHeight}`);
  return {
    totalHeight,
    headHeight,
    headRatio: headHeight / totalHeight,
    headNodeNames,
    allNodeNames,
    minY: totalMinY,
    maxY: totalMaxY,
  };
}

// -------------------------------------------------------------- verdict

function inBand(value, [lo, hi]) {
  return value >= lo && value <= hi;
}

export function verdictFor(measurement, params) {
  const lines = [];
  let gatePass = true;
  for (const station of params.stations || []) {
    if (station.quantity === 'headHeight / totalHeight' && station.passBand) {
      const pass = inBand(measurement.headRatio, station.passBand);
      if (!pass && station.severity === 'gate') gatePass = false;
      const tag =
        station.severity === 'score' && !pass
          ? 'FAIL (scoring only — does not fail the gate)'
          : pass
            ? 'PASS'
            : 'FAIL';
      lines.push({
        station: station.id,
        severity: station.severity,
        pass,
        text:
          `${station.id} [${station.passBand[0]}–${station.passBand[1]}] ` +
          `(${station.bible}): ${tag}`,
      });
    } else if (station.id === 'finished-citizen-height-units') {
      lines.push({
        station: station.id,
        severity: station.severity,
        pass: null,
        text:
          `${station.id}: measured ${measurement.totalHeight.toFixed(3)} units ` +
          `vs target ${station.target} (INFO — the Bible states no tolerance)`,
      });
    }
  }
  return { lines, gatePass };
}

// ------------------------------------------------------------------ CLI

function parseArgs(argv) {
  const args = { headPattern: 'head', params: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--head-pattern') args.headPattern = argv[++i];
    else if (arg === '--params') args.params = argv[++i];
    else if (arg.startsWith('--head-pattern=')) args.headPattern = arg.slice(15);
    else if (arg.startsWith('--params=')) args.params = arg.slice(9);
    else if (!arg.startsWith('--') && args.file === null) args.file = arg;
    else fail(`unrecognised argument: ${arg}`);
  }
  if (!args.file) {
    fail('usage: node measure-figure.mjs <figure.glb> [--head-pattern <regex>] [--params <path>]');
  }
  return args;
}

export function main(argv) {
  try {
    const args = parseArgs(argv);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const paramsPath = args.params || path.join(here, 'chibi-params.json');
    const params = JSON.parse(readFileSync(paramsPath, 'utf8'));
    let buffer;
    try {
      buffer = readFileSync(args.file);
    } catch (err) {
      fail(`cannot read ${args.file} (${err.code || err.message})`);
    }
    const gltf = parseGlb(buffer);
    const measurement = measureFigure(gltf, args.headPattern);
    const { lines, gatePass } = verdictFor(measurement, params);
    const pct = (measurement.headRatio * 100).toFixed(1);
    console.log(`Figure: ${args.file}`);
    console.log(
      `Total height: ${measurement.totalHeight.toFixed(3)} units ` +
        `(y ${measurement.minY.toFixed(3)} to ${measurement.maxY.toFixed(3)})`
    );
    console.log(`Head nodes: ${measurement.headNodeNames.join(', ')}`);
    console.log(
      `Head height: ${measurement.headHeight.toFixed(3)} units — head share ${pct}%`
    );
    for (const line of lines) console.log(`  ${line.text}`);
    console.log(`Verdict: ${gatePass ? 'PASS' : 'FAIL'}`);
    return gatePass ? 0 : 1;
  } catch (err) {
    console.error(err.message);
    return 2;
  }
}

const invokedAsScript =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  process.exitCode = main(process.argv.slice(2));
}
