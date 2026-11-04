// Elsewhere Portal — freeze-conformance runner (M4.17).
// Runs the conformance harness against the CURRENT live bundle head
// and writes conformance-report.json beside this file. Usage:
//   node run-conformance.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runConformance } from './conformance.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, '..');
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));

const [bundle, manifest, layout, demoSpec] = await Promise.all([
  read(join(BUILD, 'data', 'feed', 'world-data.json')),
  read(join(BUILD, 'data', 'feed', 'manifest.json')),
  read(join(BUILD, 'shared', 'ember-layout.json')),
  read(join(BUILD, 'fixtures', 'demo-journey.json')),
]);

const res = runConformance({
  bundle, layout, demoSpec,
  bundleHead: { bundleSeq: manifest.bundleSeq, worlddataHash: manifest.worlddataHash },
});
const report = {
  item: 'M4.17 freeze conformance',
  ranAtUtc: new Date().toISOString(),
  bundleHead: res.bundleHead,
  ok: res.ok,
  diffs: res.diffs,
};
await writeFile(join(HERE, 'conformance-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!res.ok) process.exit(1);
