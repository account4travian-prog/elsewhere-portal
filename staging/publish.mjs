// Elsewhere Portal — staging publisher (M4.02, SE-5.2).
//
// Content-addressed publishing with rollback by construction:
//   1. The snapshot's feed must pass bundle-check BEFORE anything is
//      written — a failing feed publishes nothing (exit 1).
//   1b. The snapshot's browser module graph must be CLOSED — every
//       module the two browser entry points reach must be in the
//       snapshot (see localImportClosure below). An import that lands
//       one edit before its publish-set entry is refused the same
//       way: nothing is written, and the caller (the staging cycle)
//       logs the step failed and keeps serving the previous publish
//       until the edit settles.
//   2. Every file is stored once as an immutable object,
//      objects/<sha256-of-bytes>; unchanged files are never re-stored.
//   3. The publish manifest (site path -> object + hash + type, plus
//      the feed's seq/hash/newestFetchUtc) is archived under
//      publishes/<publishId>.json, copied to publish-plan.json, and
//      written to the live pointer publish-manifest.json LAST —
//      atomically (temp file + rename). Until that write lands, the
//      previous publish keeps serving.
//   4. Rollback is one pointer write: copy an archived publish
//      manifest over publish-manifest.json (after verifying every
//      object it names still exists). No rebuild, no redeploy.
//
// Locally the "bucket" is a directory (.local-bucket/). On deploy day
// the same layout goes to R2: --emit-wrangler-script renders the
// ordered `wrangler r2 object put` commands for the current publish
// plan, manifest last (see README's deploy-day checklist).
//
// Usage:
//   node publish.mjs [--build <dir>] [--bucket <dir>] [--note <text>]
//   node publish.mjs --rollback <publishId> [--bucket <dir>]
//   node publish.mjs --list [--bucket <dir>]
//   node publish.mjs --emit-wrangler-script <file> [--bucket <dir>] [--r2-bucket <name>]

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFile, mkdir, readFile, readdir, rename, stat, writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const STAGING_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_BUILD = join(STAGING_DIR, '..', 'build');
// bundle-check is a validator of feed BYTES; it lives with the data
// layer and is run against whichever build tree is being published.
const BUNDLE_CHECK = join(PROJECT_BUILD, 'data', 'bundle-check.mjs');

export const sha256hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function contentTypeFor(sitePath) {
  const dot = sitePath.lastIndexOf('.');
  const ext = dot >= 0 ? sitePath.slice(dot).toLowerCase() : '';
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

// The runtime file set, by subtree of build/. Anything not listed here
// is not published: no tests, no shots, no status docs, and never the
// facts cursor state (facts-state.json is the archiver's private
// bookkeeping, not a document).
const SNAPSHOT = [
  // fonts/ joined the app's runtime set with the F-2 serif intake
  // (2026-11-03): styles.css's @font-face pair serves Lora from
  // app/fonts/ (self-hosted, OFL 1.1; OFL.txt ships beside the woff2
  // files). Omitting this subtree leaves the quoted-words slot to
  // fall back silently to a system serif on staging — the same
  // closure class as the engine entry below.
  // disclosures.mjs joined the app's graph at M6.12 (2026-11-03):
  // logic.mjs imports its ONBOARDING_SMALL_PRINT for the first-visit
  // overlay — the same closure discipline as the entries below.
  { from: 'app', include: ['index.html', 'app.js', 'logic.mjs', 'live-pacing.mjs', 'styles.css', 'disclosures.mjs'], recursive: ['fixtures', 'fonts'] },
  // The app's browser module graph crosses into the engine subtree:
  // app.js and live-pacing import playback; logic imports conflicts;
  // both engine modules import astar. Omitting this subtree leaves the
  // published HTML/JS looking healthy while the module graph 404s and
  // the page never leaves its loading state (staging diagnosis,
  // 2026-11-02).
  // invariant.mjs joined the graph at M4.20: the scene's Calmer
  // player imports its polyline/match helpers.
  { from: 'engine', include: ['astar.mjs', 'conflicts.mjs', 'playback.mjs', 'invariant.mjs'] },
  { from: 'fixtures', recursive: ['.'] },
  { from: 'shared', recursive: ['.'] },
  { from: 'data/feed', include: ['world-data.json', 'manifest.json', 'episodes.json', 'journeys.json', 'facts.jsonl', 'growth-book.json', 'daily-counters.jsonl', 'firsts.jsonl', 'chronicle-book.json', 'chronicle-items.jsonl'] },
  // figure-loader.mjs is a static import of scene.mjs (the scene's one
  // GLTF path, M4.16); it belongs to the scene's runtime set just as
  // much as scene.mjs itself. figure-kits.mjs is likewise a static
  // import of scene.mjs (M4.10 kit placement) and figure-kits.json is
  // the manifest it fetches at runtime — both belong to the set
  // (closure-test failure caught 2026-11-03).
  // scene-system / playback-driver / calmer joined scene.mjs's static
  // imports at M4.16/M4.20 (chunks+LOD+budget, the demo driver, the
  // Calmer player) — same closure discipline as figure-loader.
  // labels/streets/palette/materials/work-clips/treatments joined the
  // graph with the visual-foundations lane (M4.07/M4.08/M4.11–M4.13/
  // M4.25) — the closure test named each as it landed.
  // buildings.mjs joined scene.mjs's static imports with the M4.14
  // building-set lane — the closure test named it on the VER rotation-1
  // shift (2026-11-03); added here the same documented way. Its
  // runtime manifest (building-kits.json) ships in the same include,
  // and the building GLBs it names ship via the outputs-buildings
  // entry below (the buildings lane's publish wiring, landed with
  // the set itself).
  // talk-state.mjs joined scene.mjs's static imports with the
  // SURFACE CONSUMPTION lane (the 3D talk state over the shared
  // consumption model) — same closure discipline as the rest.
  // camera.mjs joined scene.mjs's static imports with the M4.18
  // CAMERA lane (chips, bounds, bounded pan/zoom) — same discipline.
  { from: 'visual/scene', include: ['scene.html', 'scene.mjs', 'figure-loader.mjs', 'figure-kits.mjs', 'figure-kits.json', 'scene-system.mjs', 'playback-driver.mjs', 'calmer.mjs', 'labels.mjs', 'streets.mjs', 'palette.mjs', 'materials.mjs', 'work-clips.mjs', 'gesture-clips.mjs', 'treatments.mjs', 'buildings.mjs', 'building-kits.json', 'talk-state.mjs', 'interiors.mjs', 'interior-kits.json', 'follow-interior.mjs', 'camera.mjs'], recursive: ['vendor'] },
  // The building GLBs building-kits.json names (M4.14): the manifest's
  // paths are ../factory/outputs-buildings/*.glb relative to
  // visual/scene/, so the factory building outputs must ship at
  // visual/factory/outputs-buildings/ or every staged building load
  // 404s and the scene silently keeps its placeholder blocks.
  { from: 'visual/factory', recursive: ['outputs-buildings'] },
  // The building kit cards building-kits.json names (T3, look
  // touch-up): the scene fetches each entry's card at boot for its
  // `storeys` count — the floor-level classification's authority —
  // so the cards must ship at visual/factory/kits/bld_*.json or the
  // staged scene silently registers no building levels. Filtered to
  // the building cards: the citizen kit cards under kits/citizens/
  // are not fetched by the scene at runtime.
  {
    from: 'visual/factory',
    recursive: ['kits'],
    filter: (p) => /kits\/bld_[^/]+\.json$/.test(p),
  },
  // The kit GLBs figure-kits.json names (M4.16 staging gap, flagged by
  // the 2026-11-03 forensic arm): the manifest's paths are
  // ../factory/outputs-web/*.glb relative to visual/scene/, so the
  // factory web outputs must ship at visual/factory/outputs-web/ or
  // every staged kit load 404s and the scene silently keeps capsules.
  // Filtered to what the scene actually fetches: the kit GLBs, the
  // standee manifests, and the standee sprites (LOD 'standee' band).
  // The 15 MB of Blender master PNGs under standees/masters/ and the
  // ungated portraits are NOT shipped — nothing at runtime names them.
  {
    from: 'visual/factory',
    recursive: ['outputs-web'],
    filter: (p) => /\.glb$/.test(p)
      || /outputs-web\/standees\/[^/]+\.standee\.json$/.test(p)
      || /outputs-web\/standees\/sprites\/[^/]+\.webp$/.test(p),
  },
];

async function walk(dir, base, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, base, out);
    else if (e.isFile()) out.push(relative(base, full));
  }
  return out;
}

export async function collectSnapshot(buildDir) {
  const files = [];
  for (const part of SNAPSHOT) {
    const root = join(buildDir, part.from);
    for (const name of part.include || []) {
      const full = join(root, name);
      try {
        if ((await stat(full)).isFile()) files.push(join(part.from, name));
      } catch { /* absent optional file (e.g. facts.jsonl) — skip */ }
    }
    for (const sub of part.recursive || []) {
      const found = await walk(join(root, sub), buildDir, []);
      files.push(...(part.filter ? found.filter((p) => part.filter(p.split(sep).join('/'))) : found));
    }
  }
  return [...new Set(files)].sort();
}

// --- browser module-graph closure gate --------------------------------------
//
// The staged outage of 2026-11-03 (~11:42–11:45Z, lane-gj1-fixes.md):
// logic.mjs gained `import … from './disclosures.mjs'` and a staging
// cycle published the new logic.mjs one publish BEFORE disclosures.mjs
// entered the snapshot above — the staged app and scene could not
// boot until the include landed. The staging suite's closure test
// pins the set as WRITTEN at test time; it cannot see a tree that is
// mid-edit at publish time. So publish() refuses any snapshot whose
// browser module graph is not closed, checking the exact file set it
// is about to publish. The walk is exported and shared with the
// staging suite's closure test, so the gate and the test are one
// definition and cannot drift apart. Bare specifiers are skipped:
// the scene's import map resolves them (e.g. 'three'), and the
// vendor files it names enter the snapshot by their own entries.
export const BROWSER_ENTRY_MODULES = ['app/app.js', 'visual/scene/scene.mjs'];

export async function localImportClosure(buildDir, entries = BROWSER_ENTRY_MODULES) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!/\.(?:mjs|js)$/.test(rel)) continue;
    let text;
    try {
      text = await readFile(join(buildDir, ...rel.split('/')), 'utf8');
    } catch {
      // Reached but absent/unreadable on disk: it stays in the set,
      // so the gap check below names it as not carried.
      continue;
    }
    const re = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (!m[1].startsWith('.')) continue;
      const abs = resolve(dirname(join(buildDir, ...rel.split('/'))), m[1]);
      queue.push(relative(buildDir, abs).split(sep).join('/'));
    }
  }
  return seen;
}

// Every module the browser graph reaches that the snapshot does NOT
// carry — the publish decision fails iff this is non-empty.
export async function moduleClosureGaps(buildDir, sitePaths) {
  const closure = await localImportClosure(buildDir);
  const inSet = new Set(sitePaths);
  return [...closure].filter((p) => !inSet.has(p)).sort();
}

export function runBundleCheck(buildDir) {
  const feedDir = join(buildDir, 'data', 'feed');
  const res = spawnSync(process.execPath, [BUNDLE_CHECK, feedDir], { encoding: 'utf8' });
  return { ok: res.status === 0, stdout: res.stdout || '', stderr: res.stderr || '' };
}

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
}

export async function publish({ buildDir = PROJECT_BUILD, bucketDir, note = '' } = {}) {
  if (!bucketDir) throw new Error('publish: bucketDir is required');
  const check = runBundleCheck(buildDir);
  if (!check.ok) {
    throw new Error(`publish refused: bundle-check failed for ${join(buildDir, 'data', 'feed')}\n${check.stdout}${check.stderr}`);
  }
  const feedManifest = JSON.parse(await readFile(join(buildDir, 'data', 'feed', 'manifest.json'), 'utf8'));

  const sitePaths = await collectSnapshot(buildDir);
  // Module-closure gate: refuse before a single byte moves, exactly
  // like the bundle-check gate above. A mid-edit tree (an import
  // landed, its publish-set entry not yet) does not publish.
  const gaps = await moduleClosureGaps(buildDir, sitePaths);
  if (gaps.length) {
    throw new Error(`publish refused: browser module graph is not closed — the graph imports ${gaps.join(', ')}, which the publish set does not carry (add the module(s) to the snapshot in staging/publish.mjs; nothing was published)`);
  }
  const files = {};
  const uploads = [];
  for (const sitePath of sitePaths) {
    const bytes = await readFile(join(buildDir, sitePath));
    const sha = sha256hex(bytes);
    const object = `objects/${sha}`;
    const objectPath = join(bucketDir, object);
    let exists = true;
    try { await stat(objectPath); } catch { exists = false; }
    if (!exists) {
      await mkdir(dirname(objectPath), { recursive: true });
      await writeFile(objectPath, bytes);
      uploads.push(object);
    }
    files[sitePath] = { object, sha256: sha, size: bytes.byteLength, contentType: contentTypeFor(sitePath) };
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  let publishId = `pub-${feedManifest.bundleSeq}-${stamp}`;
  for (let n = 2; ; n++) {
    try { await stat(join(bucketDir, 'publishes', `${publishId}.json`)); publishId = `pub-${feedManifest.bundleSeq}-${stamp}-${n}`; }
    catch { break; }
  }

  const manifest = {
    publishId,
    publishedAtUtc: new Date().toISOString(),
    note,
    bundleSeq: feedManifest.bundleSeq,
    feed: {
      schema: feedManifest.schema,
      worlddataHash: feedManifest.worlddataHash,
      newestFetchUtc: feedManifest.newestFetchUtc,
    },
    files,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  // Dependency order (SE-5.2): objects first (above), archived manifest
  // + plan next, the live pointer LAST.
  await writeAtomic(join(bucketDir, 'publishes', `${publishId}.json`), manifestBytes);
  const plan = { publishId, uploads, manifestKey: 'publish-manifest.json', archivedManifest: `publishes/${publishId}.json` };
  await writeAtomic(join(bucketDir, 'publish-plan.json'), Buffer.from(`${JSON.stringify(plan, null, 2)}\n`));
  await writeAtomic(join(bucketDir, 'publish-manifest.json'), manifestBytes);
  return { manifest, uploads };
}

export async function rollback({ bucketDir, publishId } = {}) {
  if (!bucketDir || !publishId) throw new Error('rollback: bucketDir and publishId are required');
  const archivedPath = join(bucketDir, 'publishes', `${publishId}.json`);
  const manifest = JSON.parse(await readFile(archivedPath, 'utf8'));
  const missing = [];
  for (const entry of Object.values(manifest.files)) {
    try { await stat(join(bucketDir, entry.object)); } catch { missing.push(entry.object); }
  }
  if (missing.length) {
    throw new Error(`rollback refused: ${missing.length} object(s) missing from the bucket: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}`);
  }
  await copyFile(archivedPath, join(bucketDir, 'publish-manifest.json.tmp-copy'));
  await rename(join(bucketDir, 'publish-manifest.json.tmp-copy'), join(bucketDir, 'publish-manifest.json'));
  return manifest;
}

export async function listPublishes({ bucketDir } = {}) {
  let ids = [];
  try {
    ids = (await readdir(join(bucketDir, 'publishes'))).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  } catch { /* no publishes yet */ }
  let current = null;
  try {
    current = JSON.parse(await readFile(join(bucketDir, 'publish-manifest.json'), 'utf8')).publishId;
  } catch { /* nothing published */ }
  return { ids, current };
}

// Every object key a manifest names, deduplicated, in manifest order.
// This — not the local bucket's new-objects list (plan.uploads) — is
// the R2 upload set: on a first publish R2 holds nothing, whatever the
// local bucket already had (deploy-day finding 2, STAGING-LIVE.md).
export function manifestObjectKeys(manifest) {
  return [...new Set(Object.values(manifest.files).map((entry) => entry.object))];
}

export function wranglerScript({ plan, manifest, bucketDir, r2Bucket }) {
  const lines = [
    '# Elsewhere Portal staging — R2 publish (generated by publish.mjs).',
    '# Order is load-bearing (SE-5.2): objects first, the manifest LAST.',
    `# Publish: ${plan.publishId}`,
    'set -euo pipefail',
  ];
  // --remote on EVERY put, pointer included: without it wrangler 4.x
  // writes to local miniflare state, the script "succeeds", and the
  // real bucket stays empty (deploy-day finding 1, STAGING-LIVE.md).
  for (const key of manifestObjectKeys(manifest)) {
    lines.push(`wrangler r2 object put ${r2Bucket}/${key} --file "${join(bucketDir, key)}" --remote`);
  }
  lines.push(`wrangler r2 object put ${r2Bucket}/publish-manifest.json --file "${join(bucketDir, plan.archivedManifest)}" --remote`);
  return `${lines.join('\n')}\n`;
}

// ---- CLI -----------------------------------------------------------------

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

async function main() {
  const bucketDir = arg('bucket', join(STAGING_DIR, '.local-bucket'));
  if (has('list')) {
    const { ids, current } = await listPublishes({ bucketDir });
    console.log(JSON.stringify({ current, publishes: ids }, null, 2));
    return;
  }
  if (has('rollback')) {
    const manifest = await rollback({ bucketDir, publishId: arg('rollback') });
    console.log(`rolled back: live pointer now at ${manifest.publishId} (bundleSeq ${manifest.bundleSeq})`);
    return;
  }
  if (has('emit-wrangler-script')) {
    const plan = JSON.parse(await readFile(join(bucketDir, 'publish-plan.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(join(bucketDir, plan.archivedManifest), 'utf8'));
    const out = arg('emit-wrangler-script');
    await writeFile(out, wranglerScript({ plan, manifest, bucketDir, r2Bucket: arg('r2-bucket', '<R2_BUCKET_NAME>') }));
    console.log(`wrangler publish script written to ${out} (${manifestObjectKeys(manifest).length} object upload(s), manifest last)`);
    return;
  }
  const { manifest, uploads } = await publish({
    buildDir: arg('build', PROJECT_BUILD),
    bucketDir,
    note: arg('note', ''),
  });
  console.log(`published ${manifest.publishId}: bundleSeq ${manifest.bundleSeq}, ${Object.keys(manifest.files).length} files, ${uploads.length} new object(s), worlddataHash ${manifest.feed.worlddataHash}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
