// Tests for the M4.05 web-profile size gate (validate_glb.py --gate) and
// the profile pipeline's honesty steps. Run from build/visual/factory/:
//   node --test test/size-gate.test.mjs
// The gate's positive control is the factory's own desktop output: a gate
// that does not reject a ~1 MB / ~10k-tri figure under the LOD0 budget is
// not a gate. The exports under outputs-web/ are the pipeline's products
// (scripts/build_web.sh); these tests pin that they stay in budget and
// keep the factory's records (bones, clips, props, Armature extras).
//
// RE-PIN (factory-contracts lane, 2026-11-03): this suite was written in
// the persona era, when outputs-web/ held only the four stand-in kits
// (17-bone UAL rig, persona_id extras, >= 1 prop each, 2-3 LOD0 texture
// images each). M4.10 landed the real cast alongside them: citizen kits
// on the 23-bone Rig_Medium, citizen_id/citizen_key extras, props exactly
// as each kit record specifies (most citizens specify none — a recorded
// design choice, see the M4.10 STATUS entry: record-claiming gear
// withheld), and a single LOD0 texture image for prop-less citizens.
// All of that was independently confirmed in build/VER-LOG.md shift 14
// (VER's own parse of every GLB: citizens 23 bones, LOD0 the full
// 8-clip set, LOD1 the 3-clip subset gather/idle/walk, all inside the
// byte/triangle budgets). The budget NUMBERS below are untouched; the
// cast is now derived from the landed manifests and kit records on disk
// (scene figure-kits.json + kits/), never a hard-coded list, and the
// structural expectations are stated per population (citizen vs
// stand-in) at the values VER confirmed. Where a kit record specifies
// the expectation (props), the test now pins exact equality against the
// record — stronger than the persona-era ">= 1" it replaces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FACTORY = path.join(HERE, '..');
const VALIDATE = path.join(FACTORY, 'scripts', 'validate_glb.py');
const DESKTOP_ATLAS = path.join(FACTORY, 'outputs-v2', 'atlas.glb');
const WEB_DIR = path.join(FACTORY, 'outputs-web');

function validate(args) {
  const r = spawnSync('python3', [VALIDATE, ...args],
    { cwd: FACTORY, encoding: 'utf8' });
  return r;
}
function validateJson(args) {
  const r = validate(args);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
function glbJson(file) {
  const d = readFileSync(file);
  const jlen = d.readUInt32LE(12);
  return JSON.parse(d.subarray(20, 20 + jlen).toString('utf8'));
}
const webExports = readdirSync(WEB_DIR).filter(f => f.endsWith('.glb')).sort();
const profileOf = f => (f.includes('--lod0') ? 'lod0' : 'lod1');
const slugOf = f => f.replace(/--lod[01]\.glb$/, '').replace(/\.glb$/, '');

// The cast, derived from the landed records — never a hard-coded list:
// citizens are the kits the scene manifest (M4.10) wires to placed
// citizens; every other export must resolve to a stand-in kit record.
const sceneManifest = JSON.parse(readFileSync(
  path.join(FACTORY, '..', 'scene', 'figure-kits.json'), 'utf8'));
const citizenKeys = new Map(
  Object.values(sceneManifest.kits).map(e => [e.kit, e.citizenKey]));
const CITIZENS = new Set(citizenKeys.keys());
const isCitizen = f => CITIZENS.has(slugOf(f));
// VER-LOG shift 14, confirmed by VER's own GLB parses: citizen kits are
// built on Rig_Medium (23 bones); the stand-ins keep their 17-bone rig.
const expectedBones = f => (isCitizen(f) ? 23 : 17);
function kitRecord(slug) {
  const rel = CITIZENS.has(slug)
    ? path.join('kits', 'citizens', `${slug}.json`)
    : path.join('kits', `${slug}.json`);
  return JSON.parse(readFileSync(path.join(FACTORY, rel), 'utf8'));
}
// Props the kit record itself specifies, as GLB node names. Citizens
// record them under build.props, stand-ins under props; both name them
// the same way. Most citizen records specify [] — by design.
function expectedProps(slug) {
  const rec = kitRecord(slug);
  const list = CITIZENS.has(slug) ? (rec.build?.props ?? []) : (rec.props ?? []);
  return list.map(p => `prop.${p.name}`).sort();
}

test('positive control: the gate rejects the desktop figure under lod0', () => {
  const r = validate(['--profile', 'lod0', '--gate', DESKTOP_ATLAS]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SIZE GATE FAIL/);
  assert.match(r.stderr, /bytes 1027952 > 122880/);
  assert.match(r.stderr, /triangles 10004 > 2500/);
});

test('the gate passes every web export under its own profile', () => {
  assert.ok(webExports.length >= 8, `expected >= 8 exports, got ${webExports.length}`);
  for (const f of webExports) {
    const r = validate(['--profile', profileOf(f), '--gate', path.join(WEB_DIR, f)]);
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
    const rep = JSON.parse(r.stdout);
    assert.equal(rep.within_budget, true, f);
  }
});

test('report mode never fails the build; default mode is unchanged', () => {
  const rep = validateJson(['--profile', 'lod0', DESKTOP_ATLAS]);
  assert.equal(rep.within_budget, false);
  const plain = validateJson([DESKTOP_ATLAS]);
  assert.equal(plain.bytes, 1027952);
  assert.equal(plain.profile, undefined); // no profile keys leak into default output
});

test('a budget-less or unknown profile cannot gate (exit 2, loud)', () => {
  assert.equal(validate(['--profile', 'desktop', '--gate', DESKTOP_ATLAS]).status, 2);
  assert.equal(validate(['--profile', 'nope', '--gate', DESKTOP_ATLAS]).status, 2);
});

test('the web exports cover the cast the records name', () => {
  // Every citizen the scene manifest wires must have both LOD exports
  // on disk, and every export on disk must resolve to a kit record —
  // an export with no record, or a recorded citizen with no export,
  // fails here rather than drifting silently.
  for (const slug of CITIZENS) {
    assert.ok(webExports.includes(`${slug}--lod0.glb`), `${slug}: lod0 export missing`);
    assert.ok(webExports.includes(`${slug}--lod1.glb`), `${slug}: lod1 export missing`);
  }
  for (const f of webExports) {
    assert.ok(kitRecord(slugOf(f)), `${f}: no kit record on disk`);
  }
});

test('web exports keep the factory contract: bones, props, clip sets', () => {
  for (const f of webExports) {
    const rep = validateJson([path.join(WEB_DIR, f)]);
    assert.deepEqual(rep.missing_bones, [], f);
    assert.equal(rep.bones, expectedBones(f), f);
    // Props pinned exactly to the kit record (see header): a citizen
    // whose record specifies no prop must ship none, and the two whose
    // records specify one (book, ledger) must ship exactly that.
    assert.deepEqual(rep.props, expectedProps(slugOf(f)), f);
    if (profileOf(f) === 'lod0') assert.deepEqual(rep.missing_clips, [], f);
    else assert.deepEqual([...rep.clip_names].sort(), ['gather', 'idle', 'walk'], f);
  }
});

test('Armature extras (the clip-source record) survive the pipeline', () => {
  for (const f of webExports) {
    const rep = validateJson([path.join(WEB_DIR, f)]);
    assert.ok(rep.armature_extras.clip_sources, `${f} lost its clip_sources`);
    if (isCitizen(f)) {
      // Citizen kits identify by citizen, not persona: the extras must
      // carry the slug and the PORTAL-KEY the scene manifest records.
      assert.equal(rep.armature_extras.citizen_id, slugOf(f),
        `${f} lost its citizen_id`);
      assert.equal(rep.armature_extras.citizen_key, citizenKeys.get(slugOf(f)),
        `${f} citizen_key disagrees with the scene manifest`);
    } else {
      assert.ok(rep.armature_extras.persona_id, `${f} lost its persona_id`);
    }
  }
});

test('lod0 textures are JPEG; lod1 ships flat (no images)', () => {
  for (const f of webExports) {
    const g = glbJson(path.join(WEB_DIR, f));
    const mimes = (g.images || []).map(i => i.mimeType);
    if (profileOf(f) === 'lod0') {
      // Stand-in LOD0s carry 2-3 texture images; citizen LOD0s carry
      // their single painted atlas (2 for the two prop-carrying kits).
      // The floor is per population; the JPEG rule below is unchanged.
      assert.ok(mimes.length >= (isCitizen(f) ? 1 : 2), f);
      // The transcoder's rule: images over its 4 KB threshold are JPEG;
      // a tiny card (the 2.3 KB ledger page) stays PNG by design.
      for (const im of g.images) {
        const len = g.bufferViews[im.bufferView].byteLength;
        if (len > 4096) assert.equal(im.mimeType, 'image/jpeg', `${f}: ${len} B image not JPEG`);
      }
    } else {
      assert.equal(mimes.length, 0, f);
    }
  }
});

test('every web export loads under the decoder-equipped load test', () => {
  const files = webExports.map(f => path.join(WEB_DIR, f));
  const r = spawnSync('node', [path.join(FACTORY, 'scripts', 'load_test_web.mjs'), ...files],
    { cwd: FACTORY, encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n').filter(l => l.startsWith('{'));
  assert.equal(lines.length, files.length, r.stdout + r.stderr);
  for (const l of lines) {
    const res = JSON.parse(l);
    assert.equal(res.ok, true, l);
    assert.equal(res.bones, expectedBones(res.file), l);
  }
});
