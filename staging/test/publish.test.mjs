// M4.02 — publisher tests: publish, rollback by repointing, refusal.
// The fixture's feed is a copy of the project's real feed pair
// (world-data.json + manifest.json), so bundle-check runs for real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFile, mkdir, mkdtemp, readFile, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  publish, rollback, listPublishes, collectSnapshot, sha256hex,
  wranglerScript, manifestObjectKeys, localImportClosure,
} from '../publish.mjs';
import { createHandler } from '../worker/worker.mjs';
import { createFsStore } from '../worker/store-fs.mjs';

const PROJECT_BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'build');
const TOKEN = 'test-token-0123456789abcdef';

async function fixtureBuild() {
  const dir = await mkdtemp(join(tmpdir(), 'portal-fixture-build-'));
  const files = {
    'app/index.html': '<!doctype html><title>fixture</title>',
    'app/app.js': 'console.log("A")',
    'app/logic.mjs': 'export const x = 1;',
    'app/live-pacing.mjs': 'export const y = 2;',
    'app/styles.css': 'body{}',
    'engine/astar.mjs': 'export const astar = 1;',
    'engine/conflicts.mjs': 'export const conflicts = 1;',
    'engine/playback.mjs': 'export const playback = 1;',
    'fixtures/sample-world-data.json': '{}',
    'shared/ember-layout.json': '{"nodes":[]}',
    'visual/scene/scene.html': '<!doctype html><title>scene</title>',
    'visual/scene/scene.mjs': 'console.log("scene")',
    'visual/scene/figure-loader.mjs': 'export const loadFigure = 1;',
    'visual/scene/vendor/three.module.js': '// three',
  };
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), text);
  }
  await mkdir(join(dir, 'data', 'feed'), { recursive: true });
  for (const name of ['world-data.json', 'manifest.json', 'episodes.json', 'journeys.json']) {
    await copyFile(join(PROJECT_BUILD, 'data', 'feed', name), join(dir, 'data', 'feed', name));
  }
  return dir;
}

const bucket = () => mkdtemp(join(tmpdir(), 'portal-bucket-'));

test('snapshot collection excludes state and non-runtime files', async () => {
  const paths = await collectSnapshot(await fixtureBuild());
  assert.ok(paths.includes('app/index.html'));
  assert.ok(paths.includes('visual/scene/vendor/three.module.js'));
  assert.ok(paths.includes('data/feed/world-data.json'));
  assert.ok(!paths.some((p) => p.includes('facts-state')));
  assert.ok(!paths.some((p) => p.endsWith('.md')));
});

// The staging hang of 2026-11-02: the app's and scene's published
// entry files were present and byte-perfect, but their static module
// graphs crossed into files the snapshot never collected — the
// engine subtree (app.js / live-pacing -> playback, logic ->
// conflicts -> astar) and the scene's figure-loader. A browser
// resolves the whole graph before executing any of it, so both pages
// sat on their loading text forever. Pin the exact files whose
// absence caused it…
test('snapshot collection includes the runtime modules the entry graphs need', async () => {
  const paths = await collectSnapshot(await fixtureBuild());
  for (const required of [
    'engine/astar.mjs',
    'engine/conflicts.mjs',
    'engine/playback.mjs',
    'visual/scene/figure-loader.mjs',
  ]) {
    assert.ok(paths.includes(required), `snapshot is missing ${required}`);
  }
});

// …and pin the property, not just today's list: walk the REAL
// build's static import graph from both browser entry modules and
// require every local module it reaches to be in the real snapshot.
// A future import added without a snapshot entry fails here instead
// of hanging the deployed page. The walk is publish.mjs's own
// localImportClosure — the same code the publisher's closure gate
// runs at publish time, so this test and the gate cannot drift.
test('the real build snapshot contains the full browser module closure', async () => {
  const paths = await collectSnapshot(PROJECT_BUILD);
  const closure = await localImportClosure(PROJECT_BUILD, ['app/app.js', 'visual/scene/scene.mjs']);
  assert.ok(closure.has('engine/playback.mjs'), 'closure walk did not reach the engine — the walk itself is broken');
  assert.ok(closure.has('visual/scene/figure-loader.mjs'), 'closure walk did not reach figure-loader — the walk itself is broken');
  const missing = [...closure].filter((p) => !paths.includes(p));
  assert.deepEqual(missing, [], 'snapshot omits modules the browser graph requires');
});

// The cross-publish ordering race (2026-11-03, lane-gj1-fixes.md):
// a module can be imported and staged one publish before its
// publish-set entry lands — the test above pins the set as written,
// but only publish() itself sees the exact mid-edit tree a cycle is
// about to ship. Reproduce that shape: logic.mjs imports a helper
// that EXISTS on disk but is not in the snapshot's include list.
// publish() must refuse, name the module, and write nothing; the
// same tree with the import removed (the settled edit) publishes —
// the positive control.
test('publish refuses an unclosed browser module graph and writes nothing; the settled tree publishes', async () => {
  const buildDir = await fixtureBuild();
  const bucketDir = await bucket();
  await writeFile(join(buildDir, 'app', 'app.js'), 'import "./logic.mjs";\nconsole.log("A")');
  await writeFile(join(buildDir, 'app', 'logic.mjs'), 'import { z } from "./helper.mjs";\nexport const x = z;');
  await writeFile(join(buildDir, 'app', 'helper.mjs'), 'export const z = 1;');
  await assert.rejects(
    () => publish({ buildDir, bucketDir }),
    (err) => {
      assert.match(err.message, /module graph is not closed/);
      assert.match(err.message, /app\/helper\.mjs/);
      return true;
    },
  );
  // Nothing was published: no archived publish, no live pointer.
  assert.deepEqual((await listPublishes({ bucketDir })).ids, []);
  assert.equal((await listPublishes({ bucketDir })).current, null);

  // Positive control: the settled tree (import removed) publishes.
  await writeFile(join(buildDir, 'app', 'logic.mjs'), 'export const x = 1;');
  const { manifest } = await publish({ buildDir, bucketDir });
  assert.ok(manifest.files['app/logic.mjs']);
  assert.equal((await listPublishes({ bucketDir })).current, manifest.publishId);
});

// The kit-manifest closure (M4.16): the import-graph walk above
// cannot see figure-kits.json — the scene fetches the manifest at
// runtime and then fetches every GLB/standee path it names, resolved
// against visual/scene/. Every such path must be in the snapshot at
// the site path the browser will request, or the staged scene 404s
// its kits and silently keeps capsules (the gap the 2026-11-03
// forensic arm flagged).
test('the real build snapshot contains every path figure-kits.json names', async () => {
  const paths = await collectSnapshot(PROJECT_BUILD);
  const kits = JSON.parse(await readFile(join(PROJECT_BUILD, 'visual', 'scene', 'figure-kits.json'), 'utf8'));
  const resolveSite = (rel) => {
    const abs = resolve(join(PROJECT_BUILD, 'visual', 'scene'), rel);
    return relative(PROJECT_BUILD, abs).split(sep).join('/');
  };
  let checked = 0;
  for (const entry of Object.values(kits.kits)) {
    for (const field of ['lod0', 'lod1', 'standeeManifest']) {
      const site = resolveSite(entry[field]);
      assert.ok(paths.includes(site), `snapshot omits kit path ${site} (figure-kits.json ${field})`);
      checked++;
    }
    // The standee sprite the LOD 'standee' band renders (scene-system).
    const sm = entry.standeeManifest;
    const sprite = resolveSite(`${sm.slice(0, sm.lastIndexOf('/') + 1)}sprites/${entry.kit}--idle.webp`);
    assert.ok(paths.includes(sprite), `snapshot omits standee sprite ${sprite}`);
    checked++;
  }
  assert.ok(checked >= 20, `kit closure checked only ${checked} paths — the walk itself is suspect`);
  // And the masters stay home: no runtime path names them.
  assert.ok(!paths.some((p) => p.includes('standees/masters/')), 'standee masters must not ship');
  assert.ok(!paths.some((p) => p.includes('standees/portraits/')), 'portraits must not ship');
});

test('a staged kit GLB serves 200 with the publish manifest hash', async () => {
  const bucketDir = await bucket();
  const { manifest } = await publish({ buildDir: PROJECT_BUILD, bucketDir });
  const sitePath = 'visual/factory/outputs-web/atlas-meridian--lod1.glb';
  const entry = manifest.files[sitePath];
  assert.ok(entry, `publish manifest has no entry for ${sitePath}`);
  const handle = createHandler({ store: createFsStore(bucketDir), config: { pathToken: TOKEN } });
  const res = await handle(new Request(`https://x/${TOKEN}/${sitePath}`));
  assert.equal(res.status, 200);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  assert.equal(bytes.byteLength, entry.size);
});

test('publish writes objects content-addressed, manifest last, hashes honest', async () => {
  const buildDir = await fixtureBuild();
  const bucketDir = await bucket();
  const { manifest, uploads } = await publish({ buildDir, bucketDir });
  assert.equal(manifest.feed.schema, 'portal.world-data/v2');
  assert.ok(Object.keys(manifest.files).length >= 10);
  assert.ok(uploads.length > 0);
  // Live pointer == archived manifest, byte for byte.
  const pointer = await readFile(join(bucketDir, 'publish-manifest.json'));
  const archived = await readFile(join(bucketDir, 'publishes', `${manifest.publishId}.json`));
  assert.ok(pointer.equals(archived));
  // Every entry's object exists and hashes to the recorded sha256.
  for (const [sitePath, entry] of Object.entries(manifest.files)) {
    const bytes = await readFile(join(bucketDir, entry.object));
    assert.equal(sha256hex(bytes), entry.sha256, sitePath);
    assert.equal(bytes.byteLength, entry.size, sitePath);
  }
  // The feed bundle object IS the build's current bundle bytes.
  const liveWorld = await readFile(join(buildDir, 'data', 'feed', 'world-data.json'));
  assert.equal(manifest.feed.worlddataHash, sha256hex(liveWorld));
  const { ids, current } = await listPublishes({ bucketDir });
  assert.deepEqual(ids, [manifest.publishId]);
  assert.equal(current, manifest.publishId);
});

test('rollback = one pointer write: publish A, publish B, roll back to A, served bytes are A', async () => {
  const buildDir = await fixtureBuild();
  const bucketDir = await bucket();
  const a = await publish({ buildDir, bucketDir, note: 'A' });
  await writeFile(join(buildDir, 'app', 'app.js'), 'console.log("B")');
  const b = await publish({ buildDir, bucketDir, note: 'B' });
  assert.notEqual(a.manifest.publishId, b.manifest.publishId);

  const handle = createHandler({ store: createFsStore(bucketDir), config: { pathToken: TOKEN } });
  const get = async (p) => (await handle(new Request(`https://x${p}`))).text();
  assert.match(await get(`/${TOKEN}/app/app.js`), /"B"/);

  await rollback({ bucketDir, publishId: a.manifest.publishId });
  assert.match(await get(`/${TOKEN}/app/app.js`), /"A"/);
  // The bundle served after rollback still hashes to the manifest stamp.
  const res = await handle(new Request(`https://x/${TOKEN}/data/feed/world-data.json`));
  const served = Buffer.from(await res.arrayBuffer());
  assert.equal(createHash('sha256').update(served).digest('hex'), res.headers.get('x-portal-worlddata-hash'));
});

test('a feed that fails bundle-check publishes nothing', async () => {
  const buildDir = await fixtureBuild();
  const bucketDir = await bucket();
  await writeFile(join(buildDir, 'data', 'feed', 'world-data.json'), '{"schema":"portal.world-data/v2","tampered":true}');
  await assert.rejects(() => publish({ buildDir, bucketDir }), /bundle-check failed/);
  const { ids, current } = await listPublishes({ bucketDir });
  assert.deepEqual(ids, []);
  assert.equal(current, null);
});

const putLines = (script) => script.trimEnd().split('\n')
  .filter((l) => l.startsWith('wrangler r2 object put'));
const putKey = (line) => line.match(/^wrangler r2 object put rb\/(.+?) --file /)[1];

test('wrangler script: --remote on every put, pointer last (deploy-day finding 1)', async () => {
  const buildDir = await fixtureBuild();
  const bucketDir = await bucket();
  const { manifest } = await publish({ buildDir, bucketDir });
  const plan = JSON.parse(await readFile(join(bucketDir, 'publish-plan.json'), 'utf8'));
  const puts = putLines(wranglerScript({ plan, manifest, bucketDir, r2Bucket: 'rb' }));
  assert.ok(puts.length > 1);
  // A single emitted put line without --remote fails this suite: on
  // wrangler 4.x it would write to local miniflare state instead of R2.
  for (const line of puts) assert.ok(line.includes(' --remote'), line);
  // The live pointer goes up LAST (SE-5.2).
  assert.ok(putKey(puts[puts.length - 1]) === 'publish-manifest.json', puts[puts.length - 1]);
});

test('wrangler script: full manifest object set, not just locally-new objects (finding 2)', async () => {
  const buildDir = await fixtureBuild();
  const bucketDir = await bucket();
  const a = await publish({ buildDir, bucketDir, note: 'A' });
  const planA = JSON.parse(await readFile(join(bucketDir, 'publish-plan.json'), 'utf8'));
  // Fresh LOCAL bucket: the emitted set is the manifest's full list.
  assert.deepEqual(
    putLines(wranglerScript({ plan: planA, manifest: a.manifest, bucketDir, r2Bucket: 'rb' }))
      .slice(0, -1).map(putKey),
    manifestObjectKeys(a.manifest),
  );
  // Warm local bucket, fresh R2: only one object is new locally, but
  // the script must still name every object the new manifest names —
  // R2's contents are not the script's correctness condition.
  await writeFile(join(buildDir, 'app', 'app.js'), 'console.log("B")');
  const b = await publish({ buildDir, bucketDir, note: 'B' });
  assert.equal(b.uploads.length, 1);
  const planB = JSON.parse(await readFile(join(bucketDir, 'publish-plan.json'), 'utf8'));
  const puts = putLines(wranglerScript({ plan: planB, manifest: b.manifest, bucketDir, r2Bucket: 'rb' }));
  assert.deepEqual(puts.slice(0, -1).map(putKey), manifestObjectKeys(b.manifest));
  assert.equal(puts.length, manifestObjectKeys(b.manifest).length + 1); // + pointer
});

test('rollback refuses when an object it names is missing', async () => {
  const buildDir = await fixtureBuild();
  const bucketDir = await bucket();
  const { manifest } = await publish({ buildDir, bucketDir });
  const { rm } = await import('node:fs/promises');
  await rm(join(bucketDir, manifest.files['app/app.js'].object));
  await assert.rejects(() => rollback({ bucketDir, publishId: manifest.publishId }), /missing/);
});
