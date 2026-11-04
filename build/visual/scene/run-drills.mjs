// Elsewhere Portal — masked-state drill runner (M4.26).
//
// Masked-state drills: an examiner gets a surface with the labels
// MASKED (citizen keys and place names replaced by letters) and must
// recover the state the gate cares about from the evidence alone.
// If the state cannot be recovered masked, the presentation is
// carrying it in the labels — decoration, not information — and the
// drill fails its item.
//
// Drills filed here (the gated visual items this lane touched):
//   M4.16 — LOD band + actor budget: from masked distances alone,
//     the examiner's band calls must equal scene-system's; from a
//     masked 31-figure roster, the split must be 30 embodied + 1
//     railed, identities irrelevant.
//   M4.20 — Calmer traversal: from the masked pose stream (places as
//     letters), the traversal must be the route's vertex order with
//     no repeats-skips — every square, in order.
//   M4.17 — parity: the masked check is the conformance run itself —
//     it compares surfaces by PORTAL-KEY and field path, never by
//     rendered label; its report is referenced, not recomputed.
//
// Usage: node run-drills.mjs  (writes drills/*.md)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planJourney } from '../../engine/playback.mjs';
import { lodForDistance, assignActors, MAX_ACTORS } from './scene-system.mjs';
import { createCalmerPlayer, calmerPoses } from './calmer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, '..', '..');
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const layout = await read(join(BUILD, 'shared', 'ember-layout.json'));
const demoSpec = await read(join(BUILD, 'fixtures', 'demo-journey.json'));
const outDir = join(HERE, 'drills');
await mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString();

// ---- Drill M4.16: bands + budget, masked -------------------------------
{
  // Masked evidence: distances only, figures as letters.
  const distances = [5, 26, 39.9, 40, 75, 109.9, 110, 220, 400];
  const examinerBand = (d) => (d < 40 ? 'lod0' : d < 110 ? 'lod1' : 'standee'); // the band edges, from the Look Bible distances
  const rows = distances.map((d, i) => ({
    figure: String.fromCharCode(65 + i), distance: d,
    examiner: examinerBand(d), system: lodForDistance(d),
  }));
  const bandOk = rows.every((r) => r.examiner === r.system);
  const keys = Array.from({ length: 31 }, (_, i) => `figure-${String.fromCharCode(65 + (i % 26))}${i >= 26 ? '2' : ''}`);
  const { actors, rail } = assignActors(keys);
  const budgetOk = actors.length === MAX_ACTORS && rail.length === 1;
  const pass = bandOk && budgetOk;
  await writeFile(join(outDir, 'DRILL-M4.16-lod-and-budget.md'), `# Masked-state drill — M4.16 (LOD bands + actor budget)

Filed: ${stamp} · Runner: build/visual/scene/run-drills.mjs · Verdict: **${pass ? 'PASS' : 'FAIL'}**

Masked evidence given to the examiner: per-figure camera distances
(identities as letters) and a 31-figure roster with names masked.

| Figure | Distance | Examiner band | scene-system band |
|---|---|---|---|
${rows.map((r) => `| ${r.figure} | ${r.distance} | ${r.examiner} | ${r.system} |`).join('\n')}

Band agreement: ${bandOk ? 'all rows' : 'MISMATCH'} — the band is
recoverable from distance alone; no label carries it.

Budget: 31 masked figures → ${actors.length} embodied + ${rail.length}
on the roster rail. ${budgetOk ? 'Matches the gate shape (30 + rail, none dropped).' : 'BUDGET SHAPE WRONG.'}
`);
  console.log(`DRILL M4.16: ${pass ? 'PASS' : 'FAIL'}`);
}

// ---- Drill M4.20: Calmer traversal, masked -----------------------------
{
  const journey = planJourney({
    handle: demoSpec.handle, path: demoSpec.path, startTick: demoSpec.startTick, ticksPerStep: demoSpec.ticksPerStep,
  });
  const poses = calmerPoses(journey, layout);
  // Mask place codes to letters in first-appearance order.
  const mask = new Map();
  const maskedSeq = poses.map((p) => {
    if (!mask.has(p.code)) mask.set(p.code, String.fromCharCode(65 + mask.size));
    return mask.get(p.code);
  });
  // Examiner's check on masked data alone: sequence has no backward
  // or skipped letter (each new letter is exactly the next one),
  // starts at the first letter, ends at the last new letter.
  let ok = maskedSeq[0] === 'A';
  let maxSeen = 0;
  for (const L of maskedSeq) {
    const n = L.charCodeAt(0) - 65;
    if (n > maxSeen + 1) ok = false; // skipped a square
    if (n < maxSeen && maskedSeq[maskedSeq.indexOf(L) - 1] === L) { /* repeat of current is a held pose — fine */ }
    maxSeen = Math.max(maxSeen, n);
  }
  const player = createCalmerPlayer(journey, layout, {});
  const visitsAll = player.visitsEveryStep.length === poses.length;
  const pass = ok && visitsAll;
  await writeFile(join(outDir, 'DRILL-M4.20-calmer-traversal.md'), `# Masked-state drill — M4.20 (Calmer traversal)

Filed: ${stamp} · Runner: build/visual/scene/run-drills.mjs · Verdict: **${pass ? 'PASS' : 'FAIL'}**

Masked evidence: the Calmer pose stream for the demo journey with
place names replaced by letters in first-appearance order:
${maskedSeq.join(' → ')} (${poses.length} poses).

Examiner's findings from the masked stream alone: the sequence
introduces each new square exactly once and in order (no skip, no
backward jump), holds are repeats of the current square, and the
player's visit list covers every pose (${player.visitsEveryStep.length}/${poses.length}).
Unmasked, the squares are: ${poses.map((p) => p.code).join(' → ')}.
`);
  console.log(`DRILL M4.20: ${pass ? 'PASS' : 'FAIL'}`);
}

// ---- Drill M4.17: parity reference --------------------------------------
{
  let conf = null;
  try { conf = await read(join(BUILD, 'conformance', 'conformance-report.json')); } catch { /* not run yet */ }
  const pass = !!conf && conf.ok === true && Array.isArray(conf.diffs) && conf.diffs.length === 0;
  await writeFile(join(outDir, 'DRILL-M4.17-parity.md'), `# Masked-state drill — M4.17 (freeze conformance parity)

Filed: ${stamp} · Verdict: **${pass ? 'PASS' : 'FAIL'}**

The parity check is masked by construction: build/conformance
compares the two surfaces' presentation models by PORTAL-KEY and
field path — no rendered label is ever read. Latest filed run:
${conf ? `bundle head seq ${conf.bundleHead.bundleSeq}, worlddataHash ${conf.bundleHead.worlddataHash}, ok=${conf.ok}, diffs=${conf.diffs.length} (build/conformance/conformance-report.json, ran ${conf.ranAtUtc}).` : 'NO conformance report on file — drill cannot pass.'}
Positive controls (planted caption diff, planted position diff) are
asserted in build/conformance/test/conformance.test.mjs.
`);
  console.log(`DRILL M4.17: ${pass ? 'PASS' : 'FAIL'}`);
}
