// Elsewhere Portal — bundle sanity check (WorldData v2, post-switch).
//
// Validates a built feed directory BEFORE it may be published: the
// manifest's hash must match the exact world-data bytes beside it, the
// sequence numbers must agree, both schemas must be
// portal.world-data/v2 (a v1 bundle FAILS this check since the
// 2026-11-03 feed switch), and the bundle + manifest must satisfy the
// frozen v2 contract — world.integritySource exactly "none-in-tier-p"
// (Amendment A1), citizenIdStatus present and consistent on every
// citizen, episode/act-sequence disclosures verbatim, scenes[] never
// emitted. The structural rules are NOT duplicated here: they are
// validate-v2.mjs's validateBundleV2 / validateManifestV2, reused.
// Exit 0 = publishable; exit 1 = keep the previous bundle.
//
// Usage: node bundle-check.mjs <feedDir>

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256hex } from './derive.mjs';
import { SCHEMA_V2 } from './derive-v2.mjs';
import { validateBundleV2, validateManifestV2 } from './validate-v2.mjs';

export function checkBundle({ manifest, worldData, worldDataBytes }) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object') problems.push('manifest is not an object');
  if (!worldData || typeof worldData !== 'object') problems.push('world-data is not an object');
  if (problems.length) return problems;
  if (manifest.schema !== SCHEMA_V2) problems.push(`manifest schema ${JSON.stringify(manifest.schema)} != ${SCHEMA_V2}`);
  if (worldData.schema !== SCHEMA_V2) problems.push(`world-data schema ${JSON.stringify(worldData.schema)} != ${SCHEMA_V2}`);
  if (!Number.isInteger(manifest.bundleSeq)) problems.push('manifest bundleSeq is not an integer');
  if (manifest.bundleSeq !== worldData.bundleSeq) {
    problems.push(`bundleSeq mismatch: manifest ${manifest.bundleSeq} vs world-data ${worldData.bundleSeq}`);
  }
  const actualHash = sha256hex(worldDataBytes);
  if (manifest.worlddataHash !== actualHash) {
    problems.push(`worlddataHash mismatch: manifest ${manifest.worlddataHash} vs sha256(bytes) ${actualHash}`);
  }
  // The frozen contract's structural rules (citizenKey/PORTAL-KEY,
  // citizenIdStatus, integritySource, disclosures, K5 collisions,
  // facts citation shape) live in the validator — reuse, don't fork.
  for (const e of validateBundleV2(worldData).errors) {
    problems.push(`${e.recordId} [${e.kind}]: ${e.detail}`);
  }
  for (const e of validateManifestV2(manifest).errors) {
    problems.push(`manifest [${e.kind}]: ${e.detail}`);
  }
  return problems;
}

async function main() {
  const feedDir = process.argv[2];
  if (!feedDir) {
    console.error('usage: node bundle-check.mjs <feedDir>');
    process.exitCode = 1;
    return;
  }
  const worldDataBytes = await readFile(join(feedDir, 'world-data.json'), 'utf8');
  const manifest = JSON.parse(await readFile(join(feedDir, 'manifest.json'), 'utf8'));
  const worldData = JSON.parse(worldDataBytes);
  const problems = checkBundle({ manifest, worldData, worldDataBytes });
  if (problems.length) {
    for (const p of problems) console.error('bundle-check FAIL:', p);
    process.exitCode = 1;
    return;
  }
  console.log(`bundle-check OK: seq ${manifest.bundleSeq} hash ${manifest.worlddataHash} citizens ${worldData.citizens.length} plots ${worldData.ember.plots.length}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('bundle-check failed:', err);
    process.exitCode = 1;
  });
}
