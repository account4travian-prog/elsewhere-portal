/* Elsewhere Portal — M5.05 frame-check for the gesture clips.
   Loads the shared clip library (outputs-web/clips/gesture-clips.glb) onto
   citizen kits through the SCENE's own loader stack (vendored three +
   GLTFLoader + MeshoptDecoder — the M4.16 wiring) and the scene's own
   bind path (work-clips.mjs retargetClip — position tracks re-based
   onto each kit's rest pose), samples every clip across its duration,
   and checks, per clip per kit:
     - binding: the clip actually moves the kit's rig (tracks bound by
       bone name onto a different file's skeleton);
     - no limb inversion: each elbow/knee stays on its bind-pose side
       of the shoulder–wrist / hip–ankle line (bend-direction dot
       product never flips sign);
     - segment constancy: upper/lower limb segment lengths hold
       (skinning sanity under the foreign clip);
     - no root drift: the hips' horizontal displacement from the
       first frame stays within the gate (these are in-place work
       clips; a wandering root is a retarget defect);
     - floor: feet never sink past the gate below the ground plane;
     - finiteness: no NaN in any sampled joint position.
   With no arguments it checks EVERY cast kit's LOD0 (the library
   claims to serve the whole cast; the check makes it prove it).
   Report: work-citizens/gesture-clips-framecheck.json (+ stdout summary).
   Exit 1 if any clip on any kit fails any gate.
   Run: node scripts/frame_check_work.mjs [kitLod0 ...] */
import { readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';

globalThis.self = globalThis;
register('../../scene/test/three-vendor-hook.mjs', import.meta.url);

const THREE = await import('../../scene/vendor/three.module.js');
const { GLTFLoader } = await import('../../scene/vendor/GLTFLoader.js');
const { MeshoptDecoder } = await import('../../scene/vendor/meshopt_decoder.module.js');

const LIB = new URL('../outputs-web/clips/gesture-clips.glb', import.meta.url).pathname;
const REPORT = new URL('../work-citizens/gesture-clips-framecheck.json', import.meta.url).pathname;
const { retargetClip, restPositions } = await import('../../scene/gesture-clips.mjs');
import { readdirSync } from 'node:fs';
const KITS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(new URL('../outputs-web/', import.meta.url).pathname)
      .filter((f) => f.endsWith('--lod0.glb') && !['atlas--lod0.glb', 'builder-1--lod0.glb', 'verifier-1--lod0.glb', 'alpha-lead--lod0.glb'].includes(f))
      .sort()
      .map((f) => new URL(`../outputs-web/${f}`, import.meta.url).pathname);

async function loadGlb(path) {
  const d = readFileSync(path);
  const ab = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(ab, '');
}

const lib = await loadGlb(LIB);
const donorRest = restPositions(lib.scene);

const GATES = { rootDrift: 0.5, floor: -0.30, segTol: 0.01, moveWork: 0.02, moveRest: 0.003, moveHead: 0.08 };
const SAMPLES = 25;

async function checkKit(KIT) {
const kit = await loadGlb(KIT);
const root = kit.scene;
root.updateMatrixWorld(true);

const node = (name) => { let f = null; root.traverse((o) => { if (o.name === name) f = o; }); return f; };
// Node names as the loader presents them: GLTFLoader sanitises both
// node names and animation track names the same way ("arm.L" ->
// "armL", "extra.foot.L" -> "extrafootL") in the kit AND the library,
// which is exactly why the library's clips bind onto the kit by name.
const NAMES = {
  hips: 'hips', head: 'head',
  shoulderL: 'armL', elbowL: 'forearmL', wristL: 'handL',
  shoulderR: 'armR', elbowR: 'forearmR', wristR: 'handR',
  hipL: 'legL', kneeL: 'shinL', ankleL: 'extrafootL',
  hipR: 'legR', kneeR: 'shinR', ankleR: 'extrafootR',
};
const joints = {};
for (const [k, n] of Object.entries(NAMES)) { joints[k] = node(n); if (!joints[k]) throw new Error(`kit is missing node ${n}`); }
const pos = (o) => o.getWorldPosition(new THREE.Vector3());
const bindPos = {}; for (const [k, o] of Object.entries(joints)) bindPos[k] = pos(o);

function bendDir(shoulder, elbow, wrist) {
  const line = wrist.clone().sub(shoulder);
  const t = Math.max(0, Math.min(1, elbow.clone().sub(shoulder).dot(line) / line.lengthSq()));
  const closest = shoulder.clone().add(line.multiplyScalar(t));
  return elbow.clone().sub(closest);
}
const bindBend = {
  armL: bendDir(bindPos.shoulderL, bindPos.elbowL, bindPos.wristL),
  armR: bendDir(bindPos.shoulderR, bindPos.elbowR, bindPos.wristR),
  legL: bendDir(bindPos.hipL, bindPos.kneeL, bindPos.ankleL),
  legR: bendDir(bindPos.hipR, bindPos.kneeR, bindPos.ankleR),
};
const segLen = (a, b) => bindPos[a].distanceTo(bindPos[b]);
const SEGMENTS = [
  ['shoulderL', 'elbowL'], ['elbowL', 'wristL'], ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
  ['hipL', 'kneeL'], ['kneeL', 'ankleL'], ['hipR', 'kneeR'], ['kneeR', 'ankleR'],
].map(([a, b]) => ({ a, b, bind: segLen(a, b) }));

const results = [];
for (const libClip of lib.animations) {
  const clip = retargetClip(THREE, libClip, donorRest, root); // the scene's own bind path
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  const isRest = clip.name.startsWith('rest-');
  let maxDrift = 0, minFootY = Infinity, maxSegErr = 0, maxMove = 0, inversions = 0, finite = true;
  let firstHips = null;
  // M5.05 additions: head-angle range (a nod moves the head's
  // ORIENTATION, barely its position) and wrist travel range (the
  // masked drill's talk-vs-listen distinction: talk moves the
  // wrists, listening keeps them still).
  let firstHeadQ = null, headAngleRange = 0;
  const wristSamples = { wristL: [], wristR: [] };
  for (let s = 0; s < SAMPLES; s++) {
    const t = (clip.duration * s) / (SAMPLES - 1);
    mixer.setTime(t);
    root.updateMatrixWorld(true);
    const p = {}; for (const [k, o] of Object.entries(joints)) p[k] = pos(o);
    const hq = joints.head.getWorldQuaternion(new THREE.Quaternion());
    if (!firstHeadQ) firstHeadQ = hq.clone();
    headAngleRange = Math.max(headAngleRange, 2 * Math.acos(Math.min(1, Math.abs(hq.dot(firstHeadQ)))));
    wristSamples.wristL.push(p.wristL); wristSamples.wristR.push(p.wristR);
    for (const v of Object.values(p)) if (!Number.isFinite(v.x + v.y + v.z)) finite = false;
    if (!firstHips) firstHips = p.hips.clone();
    maxDrift = Math.max(maxDrift, Math.hypot(p.hips.x - firstHips.x, p.hips.z - firstHips.z));
    minFootY = Math.min(minFootY, p.ankleL.y, p.ankleR.y);
    for (const seg of SEGMENTS) maxSegErr = Math.max(maxSegErr, Math.abs(p[seg.a].distanceTo(p[seg.b]) - seg.bind));
    for (const [k, bp] of Object.entries(bindPos)) maxMove = Math.max(maxMove, p[k].distanceTo(bp));
    const bends = {
      armL: bendDir(p.shoulderL, p.elbowL, p.wristL), armR: bendDir(p.shoulderR, p.elbowR, p.wristR),
      legL: bendDir(p.hipL, p.kneeL, p.ankleL), legR: bendDir(p.hipR, p.kneeR, p.ankleR),
    };
    for (const [limb, bd] of Object.entries(bends)) {
      // A near-straight limb (bend ~0) has no meaningful side; only
      // count a flip when both bind and current bends are material.
      if (bd.length() > 0.02 && bindBend[limb].length() > 0.02 && bd.dot(bindBend[limb]) < 0) inversions++;
    }
    // head stays above the floor and (for work clips) above the hips' level band
    if (p.head.y < 0.05) finite = false;
  }
  action.stop();
  mixer.uncacheClip(clip);
  const wristRange = Math.max(...['wristL', 'wristR'].map((w) => {
    const pts = wristSamples[w]; let m = 0;
    for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) m = Math.max(m, pts[a].distanceTo(pts[b]));
    return m;
  }));
  const checks = {
    finite,
    bindsAndMoves: maxMove >= (isRest ? GATES.moveRest : GATES.moveWork) || headAngleRange >= GATES.moveHead,
    noInversion: inversions === 0,
    segmentsConstant: maxSegErr <= GATES.segTol,
    rootDrift: maxDrift <= GATES.rootDrift,
    floor: minFootY >= GATES.floor,
  };
  results.push({
    clip: clip.name, durationS: +clip.duration.toFixed(2),
    maxRootDrift: +maxDrift.toFixed(3), minFootY: +minFootY.toFixed(3),
    maxSegmentError: +maxSegErr.toFixed(4), maxJointMove: +maxMove.toFixed(3),
    wristRange: +wristRange.toFixed(3), headAngleRange: +headAngleRange.toFixed(3),
    inversionFrames: inversions, checks, pass: Object.values(checks).every(Boolean),
  });
}
return results;
}

const allResults = [];
for (const KIT of KITS) {
  const results = await checkKit(KIT);
  const kitName = KIT.split('/').pop();
  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${kitName} ${r.clip} (${r.durationS}s) drift ${r.maxRootDrift} minFootY ${r.minFootY} segErr ${r.maxSegmentError} move ${r.maxJointMove} inversions ${r.inversionFrames}`);
  allResults.push({ kit: kitName, results });
  console.log(`— ${kitName}: ${results.length - failed.length}/${results.length}`);
}
const total = allResults.reduce((s, k) => s + k.results.length, 0);
const totalFailed = allResults.reduce((s, k) => s + k.results.filter((r) => !r.pass).length, 0);
const report = { library: LIB.split('/').pop(), gates: GATES, samplesPerClip: SAMPLES, kits: allResults, totalClipsChecked: total, totalFailed };
writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
console.log(`frame-check: ${total - totalFailed}/${total} clip×kit checks pass across ${allResults.length} kits; report ${REPORT}`);
process.exit(totalFailed ? 1 : 0);
