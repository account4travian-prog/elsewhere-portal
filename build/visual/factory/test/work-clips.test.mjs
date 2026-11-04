/* M4.08 — the work-clip library: contract clips present with honest
   sources, the frame-check report covers the whole cast and passes,
   and the coverage record states the carry gap instead of hiding it.
   Run per file: node --test test/work-clips.test.mjs
   (Re-run scripts/frame_check_work.mjs to regenerate the report this
   file verifies; the check itself is the gate, this is its pin.) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const LIB = new URL('../outputs-web/clips/work-clips.glb', import.meta.url);
const REPORT = new URL('../work-citizens/work-clips-framecheck.json', import.meta.url);
const COVERAGE = new URL('../work-citizens/work-clips-coverage.json', import.meta.url);

function glbJson(path) {
  const b = readFileSync(path);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString());
}

const EXPECTED = {
  'work-hammer': 'Hammering', 'work-dig': 'Digging', 'work-pickaxe': 'Pickaxing',
  'work-saw': 'Sawing', 'work-chop': 'Chopping', 'work-fish': 'Fishing_Idle',
  'work-fish-cast': 'Fishing_Cast', 'work-fish-reel': 'Fishing_Reeling',
  'work-pickup': 'PickUp', 'rest-lie': 'Lie_Idle', 'rest-lie-down': 'Lie_Down',
};

test('library carries exactly the contract clips, no meshes, sources in extras', () => {
  assert.ok(existsSync(LIB), 'outputs-web/clips/work-clips.glb exists (run scripts/retarget_work_clips.py)');
  const j = glbJson(LIB);
  assert.deepEqual((j.animations || []).map((a) => a.name).sort(), Object.keys(EXPECTED).sort());
  assert.ok(!(j.meshes || []).length, 'a clip library carries no meshes');
  const arm = j.nodes.find((n) => n.name === 'Rig_Medium') || j.nodes[0];
  const extras = (j.asset && j.asset.extras) || {};
  void arm; void extras;
  // clip_sources ride the armature node's extras:
  const withExtras = j.nodes.find((n) => n.extras && n.extras.clip_sources);
  assert.ok(withExtras, 'armature extras carry clip_sources');
  const sources = JSON.parse(withExtras.extras.clip_sources);
  for (const [contract, src] of Object.entries(EXPECTED)) {
    assert.equal(sources[contract].source_action, src, `${contract} must record its KayKit source action`);
    assert.equal(sources[contract].licence, 'CC0');
  }
});

test('frame-check report: every cast kit, every clip, all gates pass', () => {
  assert.ok(existsSync(REPORT), 'frame-check report exists (run scripts/frame_check_work.mjs)');
  const report = JSON.parse(readFileSync(REPORT, 'utf8'));
  assert.equal(report.totalFailed, 0);
  assert.ok(report.kits.length >= 14, `expected the whole cast, got ${report.kits.length} kits`);
  for (const k of report.kits) {
    assert.equal(k.results.length, Object.keys(EXPECTED).length, `${k.kit} clip count`);
    for (const r of k.results) assert.ok(r.pass, `${k.kit} ${r.clip} must pass (${JSON.stringify(r.checks)})`);
  }
});

test('coverage record: work families covered, carry gap stated as a gap', () => {
  const cov = JSON.parse(readFileSync(COVERAGE, 'utf8'));
  for (const fam of ['excavate', 'build-raise-install', 'repair-frontier', 'make-craft', 'harvest', 'pick-up']) {
    assert.equal(cov.families[fam].status, 'covered', fam);
    assert.ok(cov.families[fam].clips.length > 0, fam);
  }
  for (const fam of ['deliver-mend', 'haul']) {
    assert.match(cov.families[fam].status, /^GAP/, `${fam} must stay an honest gap`);
    assert.equal(cov.families[fam].clips.length, 0, `${fam} must not claim clips it does not have`);
  }
});
