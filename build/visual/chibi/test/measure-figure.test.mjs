// Tests for the figure proportion gate. Every GLB here is a minimal but
// valid binary glTF built in code (JSON chunk + BIN chunk with real
// POSITION data and spec-required accessor min/max): a body box and a
// head box at a known ratio. No external assets, no npm installs.
// Run from build/visual/chibi/:  node --test test/measure-figure.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGlb, measureFigure, verdictFor } from '../measure-figure.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, '..', 'measure-figure.mjs');
const PARAMS = JSON.parse(
  readFileSync(path.join(HERE, '..', 'chibi-params.json'), 'utf8')
);

// ------------------------------------------------------- synthetic GLB

// A box's 8 corner vertices, y from y0 to y1, x/z from -w/2 to w/2.
function boxPositions(y0, y1, w = 0.5) {
  const h = w / 2;
  const verts = [];
  for (const y of [y0, y1]) {
    for (const z of [-h, h]) {
      for (const x of [-h, h]) verts.push(x, y, z);
    }
  }
  return verts;
}

// Builds a GLB: Figure root -> body node (box 0..bodyH), Neck node ->
// head node (box 0..headH, translated up by bodyH). Total height is
// bodyH + headH, so the head share is headH / (bodyH + headH) exactly.
function makeFigureGlb({ bodyH, headH, headName = 'Head', rootName = 'Figure' }) {
  const bodyVerts = boxPositions(0, bodyH);
  const headVerts = boxPositions(0, headH);
  const bin = Buffer.concat([
    Buffer.from(new Float32Array(bodyVerts).buffer),
    Buffer.from(new Float32Array(headVerts).buffer),
  ]);
  const minMax = (verts) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < verts.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], verts[i + a]);
        max[a] = Math.max(max[a], verts[i + a]);
      }
    }
    return { min, max };
  };
  const bodyMM = minMax(bodyVerts);
  const headMM = minMax(headVerts);
  const bodyBytes = bodyVerts.length * 4;
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: rootName, children: [1, 2] },
      { name: 'Body', mesh: 0 },
      { name: 'Neck', children: [3] },
      { name: headName, mesh: 1, translation: [0, bodyH, 0] },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 } }] },
      { primitives: [{ attributes: { POSITION: 1 } }] },
    ],
    accessors: [
      {
        bufferView: 0, componentType: 5126, count: 8, type: 'VEC3',
        min: bodyMM.min, max: bodyMM.max,
      },
      {
        bufferView: 1, componentType: 5126, count: 8, type: 'VEC3',
        min: headMM.min, max: headMM.max,
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: bodyBytes },
      { buffer: 0, byteOffset: bodyBytes, byteLength: bin.length - bodyBytes },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  const jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPadded = Buffer.concat([
    jsonBuf,
    Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20),
  ]);
  const binPadded = Buffer.concat([
    bin,
    Buffer.alloc((4 - (bin.length % 4)) % 4, 0x00),
  ]);
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded]);
}

function writeTemp(buffer, name = 'figure.glb') {
  const dir = mkdtempSync(path.join(tmpdir(), 'chibi-measure-'));
  const file = path.join(dir, name);
  writeFileSync(file, buffer);
  return file;
}

function runCli(file, extraArgs = []) {
  return spawnSync('node', [TOOL, file, ...extraArgs], { encoding: 'utf8' });
}

// Total height 1.8 units (the Bible's finished height) throughout, so
// headH / 1.8 is the head share: 0.738 -> 0.41, 0.54 -> 0.30, etc.
const TOTAL = 1.8;
const figureAt = (ratio, opts = {}) =>
  makeFigureGlb({ bodyH: TOTAL * (1 - ratio), headH: TOTAL * ratio, ...opts });

// ---------------------------------------------------------------- tests

test('0.41 head share PASSES all three §5 stations, CLI exit 0', () => {
  const gltf = parseGlb(figureAt(0.41));
  const m = measureFigure(gltf, 'head');
  assert.ok(Math.abs(m.totalHeight - TOTAL) < 1e-9);
  assert.ok(Math.abs(m.headRatio - 0.41) < 1e-9);
  assert.deepEqual(m.headNodeNames, ['Head']);
  const v = verdictFor(m, PARAMS);
  assert.equal(v.gatePass, true);
  for (const line of v.lines) {
    if (line.pass !== null) assert.equal(line.pass, true, line.text);
  }
  const cli = runCli(writeTemp(figureAt(0.41)));
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Verdict: PASS/);
  assert.match(cli.stdout, /head share 41\.0%/);
});

test('0.30 head share FAILS the hard-defect bound (0.36–0.44), CLI exit 1', () => {
  const gltf = parseGlb(figureAt(0.30));
  const m = measureFigure(gltf, 'head');
  assert.ok(Math.abs(m.headRatio - 0.3) < 1e-9);
  const v = verdictFor(m, PARAMS);
  assert.equal(v.gatePass, false);
  const byId = Object.fromEntries(v.lines.map((l) => [l.station, l]));
  assert.equal(byId['production-head-share'].pass, false);
  assert.equal(byId['hard-defect-head-share'].pass, false);
  const cli = runCli(writeTemp(figureAt(0.30)));
  assert.equal(cli.status, 1, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /Verdict: FAIL/);
});

test('0.425 passes production, misses the look target only — gate still passes', () => {
  // Bible §5: 42–43% passes production, is above the 0.38–0.42 look
  // target, and is 'look-dulling at most' — a scoring miss, not a defect.
  const m = measureFigure(parseGlb(figureAt(0.425)), 'head');
  const v = verdictFor(m, PARAMS);
  const byId = Object.fromEntries(v.lines.map((l) => [l.station, l]));
  assert.equal(byId['production-head-share'].pass, true);
  assert.equal(byId['look-target-head-share'].pass, false);
  assert.equal(byId['hard-defect-head-share'].pass, true);
  assert.equal(v.gatePass, true);
  const cli = runCli(writeTemp(figureAt(0.425)));
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
});

test('no head-named node FAILS LOUDLY with the node list, never a guess', () => {
  const buffer = figureAt(0.41, { headName: 'Skull' });
  const gltf = parseGlb(buffer);
  assert.throws(
    () => measureFigure(gltf, 'head'),
    (err) => {
      assert.match(err.message, /no head node matched/);
      assert.match(err.message, /refusing to guess/);
      // The full node list is in the message so a human can pick the name.
      for (const name of ['Figure', 'Body', 'Neck', 'Skull']) {
        assert.ok(err.message.includes(name), `node list missing ${name}`);
      }
      return true;
    }
  );
  const cli = runCli(writeTemp(buffer));
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /no head node matched/);
  assert.match(cli.stderr, /Skull/);
});

test('--head-pattern rescues an unusually named head (Skull)', () => {
  const file = writeTemp(figureAt(0.41, { headName: 'Skull' }));
  const cli = runCli(file, ['--head-pattern', 'skull']);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Head nodes: Skull/);
  assert.match(cli.stdout, /Verdict: PASS/);
});

test('default pattern covers Bip01-style naming (Bip01 Head)', () => {
  const m = measureFigure(parseGlb(figureAt(0.41, { headName: 'Bip01 Head' })), 'head');
  assert.deepEqual(m.headNodeNames, ['Bip01 Head']);
  assert.ok(Math.abs(m.headRatio - 0.41) < 1e-9);
});

test('truncated GLB errors cleanly (no stack, exit 2)', () => {
  const whole = figureAt(0.41);
  const truncated = whole.subarray(0, Math.floor(whole.length / 2));
  assert.throws(() => parseGlb(truncated), /truncated GLB/);
  const cli = runCli(writeTemp(truncated));
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /^measure-figure: truncated GLB/);
  assert.ok(!cli.stderr.includes('\n    at '), 'error must not be a stack trace');
});

test('corrupt files error cleanly: garbage bytes and a JSON .gltf', () => {
  assert.throws(() => parseGlb(Buffer.from('this is not a glb at all')), /not a GLB/);
  const jsonOnly = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, nodes: [] }));
  assert.throws(() => parseGlb(jsonOnly), /not a GLB/);
  const cli = runCli(writeTemp(Buffer.from('garbage garbage garbage')));
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /^measure-figure: /);
});

test('head share is measured through nested hierarchy, not node-local boxes', () => {
  // The head node is a grandchild (Figure -> Neck -> Head) carrying a
  // translation; a local-only read would report the head box height at
  // the wrong span and a wrong total. Exact ratio proves the walk.
  const m = measureFigure(parseGlb(figureAt(0.4)), 'head');
  assert.ok(Math.abs(m.headRatio - 0.4) < 1e-9);
  assert.ok(Math.abs(m.minY - 0) < 1e-9);
  assert.ok(Math.abs(m.maxY - TOTAL) < 1e-9);
});
