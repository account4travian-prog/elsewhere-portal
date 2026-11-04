// Tests for the M4.09 standee & portrait pipeline (scripts/build_standees.sh
// -> render_standee.py + finish_standees.py, gated by validate_sheet.py
// --profile lod2). Run from build/visual/factory/:
//   node --test test/standee.test.mjs
// The pipeline's products live in outputs-web/standees/ (sprites, masters,
// portraits, atlas, standees.json manifest). These tests pin: the manifest
// tells the truth about inputs and outputs, the gate passes what shipped
// and rejects what must not ship (positive control), and a rerun of the
// pipeline reproduces byte-identical sprites (determinism).
//
// RE-PIN (factory-contracts lane, 2026-11-03): this suite was written
// when the standee cast was the four persona-era stand-ins. M4.10 landed
// the real cast, and the manifest now covers the stand-ins PLUS the 14
// citizen kits (independently confirmed in build/VER-LOG.md shift 14:
// 70 citizen sprites, 14 kits x 5 poses, every one <= 8,192 B). The
// 8 KB sprite budget below is untouched; the cast is now derived from
// the kit records on disk (kits/citizens/ for citizens — cross-checked
// against the scene's figure-kits.json — and the non-building records
// in kits/ for the stand-ins), never a hard-coded list, so a future kit
// record without standees fails here instead of drifting silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FACTORY = path.join(HERE, '..');
const GATE = path.join(FACTORY, 'scripts', 'validate_sheet.py');
const BUILD = path.join(FACTORY, 'scripts', 'build_standees.sh');
const STANDEES = path.join(FACTORY, 'outputs-web', 'standees');
const POSES = ['idle', 'walk-frame', 'sit', 'work', 'talk'];
// The cast, derived from the kit records on disk: citizen records live
// in kits/citizens/, stand-in persona records in kits/ itself (the
// bld_* building records and the schema are not figures).
const citizenSlugs = readdirSync(path.join(FACTORY, 'kits', 'citizens'))
  .filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
const standinSlugs = readdirSync(path.join(FACTORY, 'kits'))
  .filter(f => f.endsWith('.json') && f !== 'kit.schema.json' && !f.startsWith('bld_'))
  .map(f => f.replace(/\.json$/, ''));
const KITS = [...citizenSlugs, ...standinSlugs].sort();
// Cross-check the derivation against the scene manifest: the citizens
// with standees are exactly the citizens M4.10 wired into the scene.
const sceneManifest = JSON.parse(readFileSync(
  path.join(FACTORY, '..', 'scene', 'figure-kits.json'), 'utf8'));
assert.deepEqual(citizenSlugs.sort(),
  Object.values(sceneManifest.kits).map(e => e.kit).sort(),
  'citizen kit records and the scene figure manifest disagree on the cast');

const sha256 = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const manifest = JSON.parse(readFileSync(path.join(STANDEES, 'standees.json'), 'utf8'));
const fragOf = kit => manifest.kits.find(k => k.persona === kit);

function gate(args) {
  return spawnSync('python3', [GATE, ...args], { cwd: FACTORY, encoding: 'utf8' });
}

test('manifest covers the whole recorded cast, five poses each, all PASS', () => {
  assert.deepEqual(manifest.kits.map(k => k.persona).sort(), KITS);
  for (const kit of KITS) {
    const frag = fragOf(kit);
    assert.deepEqual(Object.keys(frag.sprites).sort(), [...POSES].sort(), kit);
    for (const pose of POSES) {
      assert.equal(frag.sprites[pose].gate_verdict, 'PASS', `${kit}/${pose}`);
      assert.ok(frag.sprites[pose].bytes <= 8192, `${kit}/${pose}`);
    }
    assert.ok(frag.portrait, `${kit} portrait recorded`);
  }
});

test('manifest inputs and outputs match the files on disk', () => {
  for (const kit of KITS) {
    const frag = fragOf(kit);
    const src = path.join(FACTORY, frag.input.source_glb);
    assert.equal(frag.input.sha256, sha256(src), `${kit} input hash`);
    for (const pose of POSES) {
      const sp = path.join(FACTORY, frag.sprites[pose].file);
      assert.ok(existsSync(sp), sp);
      assert.equal(frag.sprites[pose].sha256, sha256(sp), `${kit}/${pose} hash`);
      assert.equal(frag.sprites[pose].bytes, readFileSync(sp).length, `${kit}/${pose} bytes`);
      assert.ok(existsSync(path.join(FACTORY, frag.sprites[pose].master)), `${kit}/${pose} master`);
    }
    const pp = path.join(FACTORY, frag.portrait.file);
    assert.equal(frag.portrait.sha256, sha256(pp), `${kit} portrait hash`);
  }
  assert.equal(manifest.atlas.sha256, sha256(path.join(FACTORY, manifest.atlas.file)));
  assert.equal(Object.keys(manifest.atlas.rects).length, KITS.length * POSES.length + 1);
});

test('the gate passes every shipped sprite under lod2', () => {
  for (const kit of KITS) {
    for (const pose of POSES) {
      const f = path.join(STANDEES, 'sprites', `${kit}--${pose}.webp`);
      const r = gate(['--profile', 'lod2', '--gate', f]);
      assert.equal(r.status, 0, `${kit}/${pose}: ${r.stderr}`);
      assert.equal(JSON.parse(r.stdout).within_budget, true);
    }
  }
});

test('positive control: the gate rejects an over-budget sheet file', () => {
  // The 512x512 master PNG of a pose is a real pipeline artefact that is
  // far over the 8 KB sprite budget — a gate that passes it is not a gate.
  const master = path.join(STANDEES, 'masters', 'atlas--idle.png');
  const size = readFileSync(master).length;
  assert.ok(size > 8192, `master unexpectedly small: ${size}`);
  const r = gate(['--profile', 'lod2', '--gate', master]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SIZE GATE FAIL/);
  assert.match(r.stderr, new RegExp(`bytes ${size} > 8192`));
  // Report mode names the overrun but never fails the build.
  const rep = gate(['--profile', 'lod2', master]);
  assert.equal(rep.status, 0);
  assert.equal(JSON.parse(rep.stdout).within_budget, false);
});

test('the sheet gate refuses figure profiles and unknown profiles (exit 2)', () => {
  const f = path.join(STANDEES, 'sprites', 'atlas--idle.webp');
  assert.equal(gate(['--profile', 'lod0', '--gate', f]).status, 2);
  assert.equal(gate(['--profile', 'desktop', '--gate', f]).status, 2);
  assert.equal(gate(['--profile', 'nope', '--gate', f]).status, 2);
});

test('gap honesty: carry and asleep are recorded as gaps, never faked', () => {
  for (const kit of KITS) {
    const gaps = fragOf(kit).render.gap_poses;
    assert.ok(gaps.carry && gaps.asleep, `${kit} gap record missing`);
    assert.match(gaps.carry, /no carry clip/);
    assert.match(gaps.asleep, /no asleep clip/);
    assert.ok(!existsSync(path.join(STANDEES, 'sprites', `${kit}--carry.webp`)));
    assert.ok(!existsSync(path.join(STANDEES, 'sprites', `${kit}--asleep.webp`)));
  }
});

// The determinism probe rebuilds ONE kit by design (a full-cast rebuild
// is the pipeline's own run, not a test); the probe kit stays atlas.
test('determinism: rebuilding one kit reproduces byte-identical outputs',
  { timeout: 600000 }, () => {
    const before = {};
    for (const pose of POSES) {
      before[pose] = sha256(path.join(STANDEES, 'sprites', `atlas--${pose}.webp`));
    }
    const beforePortrait = sha256(path.join(STANDEES, 'portraits', 'atlas--portrait.png'));
    const r = spawnSync('bash', [BUILD, 'atlas'],
      { cwd: FACTORY, encoding: 'utf8', timeout: 540000 });
    assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-2000));
    for (const pose of POSES) {
      assert.equal(sha256(path.join(STANDEES, 'sprites', `atlas--${pose}.webp`)),
        before[pose], `atlas/${pose} changed across a rerun`);
    }
    assert.equal(sha256(path.join(STANDEES, 'portraits', 'atlas--portrait.png')),
      beforePortrait, 'atlas portrait changed across a rerun');
  });
