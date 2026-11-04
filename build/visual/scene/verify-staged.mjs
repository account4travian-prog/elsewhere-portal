/* Poll the staged scene modules until their served SHA-256 equals
   the local build's (proof the supervisor cycle carried the
   round-2 label/camera/scene changes). Prints hashes + status
   only — never the staging base URL (read from STAGING-LIVE.md). */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const live = readFileSync(new URL('../../../staging/STAGING-LIVE.md', import.meta.url), 'utf8');
const base = live.match(/https:\/\/[^\s)]+/)[0].replace(/\/$/, '');
const FILES = ['labels.mjs', 'camera.mjs', 'scene.mjs'];
const localHash = {};
for (const f of FILES) {
  localHash[f] = createHash('sha256')
    .update(readFileSync(new URL(`./${f}`, import.meta.url))).digest('hex');
}
const deadline = Date.now() + 14 * 60 * 1000;
for (;;) {
  let all = true;
  const line = [];
  for (const f of FILES) {
    const r = await fetch(`${base}/visual/scene/${f}`, { cache: 'no-store' });
    if (!r.ok) { line.push(`${f}: HTTP ${r.status}`); all = false; continue; }
    const h = createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');
    const ok = h === localHash[f];
    line.push(`${f}: ${ok ? 'MATCH' : 'stale'} (${h.slice(0, 12)})`);
    if (!ok) all = false;
  }
  console.log(new Date().toISOString(), line.join(' · '));
  if (all) { console.log('STAGED: all three modules match the local build'); break; }
  if (Date.now() > deadline) { console.log('TIMEOUT: staged modules still differ'); process.exit(2); }
  await new Promise((res) => setTimeout(res, 45000));
}
