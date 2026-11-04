// Elsewhere Portal — Arm A (Data): WorldData v2 bundle builder CLI.
//
// The v2 counterpart of build-bundle.mjs, alongside it — v1 is NOT
// modified. This builder's default output is feed-v2/ (the safe
// ad-hoc default); since the 2026-11-03 feed switch the supervisor's
// bundle step invokes it with --feed <tempdir> and publishes the
// result into the live feed/ (CONTRACT-V2.md is the live contract).
//
// Inputs (all read from the archive, none invented):
//   - the archive head + the open world-book's voices snapshots
//     (loadHead / loadBookVoices, shared with the v1 builder);
//   - archive/identity-registry.json (M2.04) -> citizens' citizenId +
//     citizenIdStatus. A missing or unreadable registry is NOT an
//     error: every citizen ships UNBOUND_NO_ROUTE with citizenId null,
//     the honest unverified state;
//   - archive/world-books.json -> world.bookId (the open book's id).
//     If the file is absent, the registry is rebuilt in memory from the
//     archive via world-books.mjs so bookId stays REQUIRED-satisfiable;
//   - a facts-stream citation (portal.facts/v1): the first readable
//     facts manifest among the conventional locations yields
//     { schema, seq }; otherwise the citation is null — recorded as
//     null in the bundle and the manifest, never omitted (Hark Q4).
//
// The built bundle is validated by validate-v2.mjs before this builder
// reports success; an invalid bundle is a build failure and any
// rejections are appended to validation-rejections.jsonl in the output
// dir. The return value carries the v1 canonical size of the same head
// so the v1->v2 size delta is measured on every build.
//
// Usage: node build-bundle-v2.mjs [--archive <dir>] [--feed <dir>]
//        (default --feed is feed-v2/; the supervisor passes its temp
//        build dir and publishes into the live feed/ itself)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringify, deriveWorldData, sha256hex } from './derive.mjs';
import { loadBookVoices, loadHead } from './build-bundle.mjs';
import { buildRegistry } from './world-books.mjs';
import { FACTS_SCHEMA, deriveWorldDataV2 } from './derive-v2.mjs';
import { logRejections, validateBundleV2, validateManifestV2 } from './validate-v2.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function loadIdentityRegistry(archiveDir) {
  try {
    const parsed = JSON.parse(await readFile(join(archiveDir, 'identity-registry.json'), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadBookId(archiveDir) {
  try {
    const registry = JSON.parse(await readFile(join(archiveDir, 'world-books.json'), 'utf8'));
    const open = (Array.isArray(registry?.books) ? registry.books : []).find((b) => b?.status === 'open');
    if (open?.id) return open.id;
  } catch { /* fall through to an in-memory rebuild */ }
  try {
    const rebuilt = await buildRegistry({ archiveDir });
    const open = rebuilt.books.find((b) => b.status === 'open');
    return open?.id ?? null;
  } catch {
    return null;
  }
}

// The stream's current seq is the bundleSeq it has diffed up to. Two
// sources, checked in order:
//   1. a facts manifest (any JSON object carrying schema
//      "portal.facts/v1" and an integer sequence under a conventional
//      field name) in the feed or archive dir;
//   2. the facts arm's own state file (facts-state.json, written by
//      facts.mjs beside its stream): schema "portal.facts/v1" with the
//      last diffed bundle embedded — its bundleSeq is the stream seq.
// No readable source => null: no stream exists yet, and the citation is
// recorded as null rather than omitted (Hark Q4).
export async function loadFactsRef(archiveDir, feedDir) {
  const manifests = [
    join(feedDir, 'facts-manifest.json'),
    join(archiveDir, 'facts-manifest.json'),
    join(feedDir, 'facts.json'),
    join(archiveDir, 'facts.json'),
  ];
  for (const path of manifests) {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'));
      if (parsed?.schema !== FACTS_SCHEMA) continue;
      const seq = parsed.seq ?? parsed.factsSeq ?? parsed.bundleSeq ?? parsed.currentSeq;
      if (Number.isInteger(seq) && seq >= 0) return { schema: FACTS_SCHEMA, seq };
    } catch { /* not present / not parseable — keep looking */ }
  }
  const states = [join(feedDir, 'facts-state.json'), join(archiveDir, 'facts-state.json')];
  for (const path of states) {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'));
      if (parsed?.schema !== FACTS_SCHEMA) continue;
      const seq = parsed.lastDiffedBundle?.bundleSeq;
      if (Number.isInteger(seq) && seq >= 0) return { schema: FACTS_SCHEMA, seq };
    } catch { /* not present / not parseable — keep looking */ }
  }
  return null;
}

export async function buildBundleV2({ archiveDir, feedDir }) {
  const { head, warnings } = await loadHead(archiveDir);
  const book = await loadBookVoices(archiveDir, head);
  warnings.push(...book.warnings);
  const [identityRegistry, bookId, factsRef] = await Promise.all([
    loadIdentityRegistry(archiveDir),
    loadBookId(archiveDir),
    loadFactsRef(archiveDir, feedDir),
  ]);
  if (!identityRegistry) warnings.push('identity-registry.json absent/unreadable — all citizens UNBOUND_NO_ROUTE');
  if (!bookId) warnings.push('no open world-book id available — world.bookId will fail validation');

  await mkdir(feedDir, { recursive: true });

  // The publication sequence is schema-independent (build-bundle.mjs
  // reads it the same way): a v1 manifest seeds the count exactly like
  // a v2 one, so the v1->v2 feed switch continues the numbering
  // instead of restarting at 1.
  let prevSeq = 0;
  try {
    const prev = JSON.parse(await readFile(join(feedDir, 'manifest.json'), 'utf8'));
    if (Number.isInteger(prev.bundleSeq)) prevSeq = prev.bundleSeq;
  } catch { /* first bundle in this dir */ }
  const bundleSeq = prevSeq + 1;

  const deriveOpts = { bundleSeq, voicesSnapshots: book.voicesSnapshots };
  const worldData = deriveWorldDataV2(head, { ...deriveOpts, identityRegistry, bookId, factsRef });
  const bytes = canonicalStringify(worldData);
  const v1Bytes = canonicalStringify(deriveWorldData(head, deriveOpts));

  const check = validateBundleV2(worldData);
  if (!check.valid) {
    await logRejections(join(feedDir, 'validation-rejections.jsonl'), check.rejections);
    throw new Error(
      `v2 bundle failed validation (${check.errors.length} rejections logged): ` +
      check.errors.map((e) => `${e.recordId} [${e.kind}]`).join('; '),
    );
  }

  const worlddataHash = sha256hex(bytes);
  await writeFile(join(feedDir, 'world-data.json'), bytes, 'utf8');
  const manifest = {
    bundleSeq,
    worlddataHash,
    newestFetchUtc: worldData.newestFetchUtc,
    schema: worldData.schema,
    facts: worldData.world.facts,
  };
  const mCheck = validateManifestV2(manifest);
  if (!mCheck.valid) throw new Error('v2 manifest failed validation: ' + mCheck.errors.map((e) => e.detail).join('; '));
  await writeFile(join(feedDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return {
    manifest,
    warnings,
    worldData,
    sizeBytes: Buffer.byteLength(bytes, 'utf8'),
    v1SizeBytes: Buffer.byteLength(v1Bytes, 'utf8'),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const archiveDir = opt('--archive', join(HERE, 'archive'));
  const feedDir = opt('--feed', join(HERE, 'feed-v2'));
  const { manifest, warnings, sizeBytes, v1SizeBytes } = await buildBundleV2({ archiveDir, feedDir });
  for (const w of warnings) console.error('warning:', w);
  console.log(JSON.stringify(
    { ...manifest, sizeBytes, v1SizeBytes, deltaBytes: sizeBytes - v1SizeBytes, warnings: warnings.length },
    null, 2,
  ));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('build-bundle-v2 failed:', err);
    process.exitCode = 1;
  });
}
