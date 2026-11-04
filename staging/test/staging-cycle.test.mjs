// Staging auto-republish step tests (the project owner's decision 2026-11-02:
// staging republishes automatically as new bundles land).
//
// Everything runs against temp dirs and an injected uploader — the
// local dry-run machinery, never the live bucket. One test exercises
// the real wrangler uploader against a stub binary to pin the
// --remote rule (deploy-day finding 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPublishes, manifestObjectKeys, sha256hex } from '../publish.mjs';
import {
  THROTTLE_MS, makeWranglerUploader, runStagingCycle,
} from '../staging-cycle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_BUILD = join(HERE, '..', '..', 'build');
const CYCLE = join(HERE, '..', 'staging-cycle.mjs');
const T0 = 1_730_000_000_000;

async function fixtureBuild() {
  const dir = await mkdtemp(join(tmpdir(), 'portal-cycle-build-'));
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

// A new, still-valid bundle: dataAgeSeconds is only type-checked by
// the v2 validator, so bumping it changes the bundle bytes (and thus
// worlddataHash) without breaking bundle-check. Manifest hash is
// recomputed over the exact new bytes, as the real builder does.
async function nextBundle(buildDir, bump = 1) {
  const feed = join(buildDir, 'data', 'feed');
  const world = JSON.parse(await readFile(join(feed, 'world-data.json'), 'utf8'));
  world.dataAgeSeconds += bump;
  const bytes = Buffer.from(`${JSON.stringify(world, null, 2)}\n`);
  await writeFile(join(feed, 'world-data.json'), bytes);
  const manifest = JSON.parse(await readFile(join(feed, 'manifest.json'), 'utf8'));
  manifest.worlddataHash = sha256hex(bytes);
  await writeFile(join(feed, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest.worlddataHash;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'portal-cycle-'));
  return {
    buildDir: await fixtureBuild(),
    bucketDir: join(root, 'bucket'),
    stateFile: join(root, 'state.json'),
    logFile: join(root, 'publish-log.jsonl'),
    projectRoot: root,
    calls: [],
  };
}

const recorder = (fx) => (key, file) => { fx.calls.push({ key, file }); };
const run = (fx, over = {}) => runStagingCycle({
  buildDir: fx.buildDir, bucketDir: fx.bucketDir, stateFile: fx.stateFile,
  logFile: fx.logFile, projectRoot: fx.projectRoot, nowMs: T0,
  uploadObject: recorder(fx), ...over,
});
const logLines = async (fx) => (await readFile(fx.logFile, 'utf8').catch(() => ''))
  .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('delta-skip: full first publish, unchanged tree uploads nothing, changed bundle uploads only new objects + pointer', async () => {
  const fx = await fixture();
  const r1 = await run(fx);
  assert.equal(r1.status, 'published');
  assert.equal(r1.mode, 'full');
  const manifest1 = JSON.parse(await readFile(join(fx.bucketDir, 'publish-manifest.json'), 'utf8'));
  const needed1 = manifestObjectKeys(manifest1);
  assert.deepEqual(fx.calls.map((c) => c.key), [...needed1, 'publish-manifest.json']);
  assert.equal(fx.calls[fx.calls.length - 1].key, 'publish-manifest.json'); // pointer last

  // Unchanged tree: no publish, no upload, no log growth.
  fx.calls = [];
  const r2 = await run(fx, { nowMs: T0 + 10 * THROTTLE_MS });
  assert.equal(r2.status, 'unchanged');
  assert.equal(fx.calls.length, 0);
  assert.equal((await listPublishes({ bucketDir: fx.bucketDir })).ids.length, 1);
  assert.equal((await logLines(fx)).length, 1);

  // New bundle + one changed app file: only the genuinely new
  // objects go up — world-data, its manifest, and app.js.
  const hash2 = await nextBundle(fx.buildDir);
  await writeFile(join(fx.buildDir, 'app', 'app.js'), 'console.log("B")');
  fx.calls = [];
  const r3 = await run(fx, { nowMs: T0 + 20 * THROTTLE_MS });
  assert.equal(r3.status, 'published');
  assert.equal(r3.mode, 'delta');
  const uploadedKeys = fx.calls.map((c) => c.key);
  assert.equal(uploadedKeys[uploadedKeys.length - 1], 'publish-manifest.json');
  const objectKeys = uploadedKeys.slice(0, -1).sort();
  const expected = [
    `objects/${sha256hex(await readFile(join(fx.buildDir, 'data', 'feed', 'world-data.json')))}`,
    `objects/${sha256hex(await readFile(join(fx.buildDir, 'data', 'feed', 'manifest.json')))}`,
    `objects/${sha256hex(Buffer.from('console.log("B")'))}`,
  ].sort();
  assert.deepEqual(objectKeys, expected);
  assert.ok(r3.objectsSkipped > 0, 'unchanged objects were re-uploaded');
  for (const key of needed1) assert.ok(!objectKeys.includes(key), `re-uploaded ${key}`);
  const state = JSON.parse(await readFile(fx.stateFile, 'utf8'));
  assert.equal(state.lastPublish.worlddataHash, hash2);
  const lines = await logLines(fx);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].objectsUploaded, 3);
});

test('state-file loss falls back to one full publish and rebuilds state', async () => {
  const fx = await fixture();
  await run(fx);
  await rm(fx.stateFile);
  await nextBundle(fx.buildDir);
  fx.calls = [];
  const r = await run(fx, { nowMs: T0 + 10 * THROTTLE_MS });
  assert.equal(r.status, 'published');
  assert.equal(r.mode, 'full');
  const manifest = JSON.parse(await readFile(join(fx.bucketDir, 'publish-manifest.json'), 'utf8'));
  assert.deepEqual(fx.calls.map((c) => c.key), [...manifestObjectKeys(manifest), 'publish-manifest.json']);
  const state = JSON.parse(await readFile(fx.stateFile, 'utf8'));
  assert.equal(state.uploadedObjects.length, manifestObjectKeys(manifest).length);
});

test('throttle: a changed bundle inside 60 s is skipped; at 60 s it fires', async () => {
  const fx = await fixture();
  await run(fx);
  await nextBundle(fx.buildDir);
  fx.calls = [];
  const early = await run(fx, { nowMs: T0 + THROTTLE_MS - 1 });
  assert.equal(early.status, 'throttled');
  assert.equal(fx.calls.length, 0);
  assert.equal((await listPublishes({ bucketDir: fx.bucketDir })).ids.length, 1);
  const onTime = await run(fx, { nowMs: T0 + THROTTLE_MS });
  assert.equal(onTime.status, 'published');
  assert.ok(fx.calls.length > 0);
});

test('kill switch: DEVELOPMENT-PAUSED skips silently — no publish, no uploads, no log', async () => {
  const fx = await fixture();
  await writeFile(join(fx.projectRoot, 'DEVELOPMENT-PAUSED'), 'paused\n');
  const r = await run(fx);
  assert.equal(r.status, 'paused');
  assert.equal(fx.calls.length, 0);
  await assert.rejects(() => stat(fx.logFile), /ENOENT/);
  await assert.rejects(() => stat(fx.stateFile), /ENOENT/);
  assert.deepEqual((await listPublishes({ bucketDir: fx.bucketDir })).ids, []);
});

test('never breaks the cycle: a mid-upload failure leaves the feed untouched, state unadvanced, failure logged, and a retry completes the delta', async () => {
  const fx = await fixture();
  const r1 = await run(fx);
  const feedBefore = {
    world: await readFile(join(fx.buildDir, 'data', 'feed', 'world-data.json')),
    manifest: await readFile(join(fx.buildDir, 'data', 'feed', 'manifest.json')),
  };
  await nextBundle(fx.buildDir);
  const feedAfterBundle = {
    world: await readFile(join(fx.buildDir, 'data', 'feed', 'world-data.json')),
    manifest: await readFile(join(fx.buildDir, 'data', 'feed', 'manifest.json')),
  };

  let n = 0;
  const flaky = (key, file) => {
    n += 1;
    fx.calls.push({ key, file });
    if (n === 2) throw new Error('simulated R2 failure');
  };
  fx.calls = [];
  await assert.rejects(
    () => run(fx, { nowMs: T0 + 10 * THROTTLE_MS, uploadObject: flaky }),
    /simulated R2 failure/,
  );
  const landedKey = fx.calls[0].key; // first object went up before the failure
  const failedKey = fx.calls[1].key; // second object is the one that threw

  // The step never touches the feed: bytes are exactly what the
  // bundle step (here, nextBundle) left — the locally published
  // bundle survives the staging failure intact.
  assert.ok((await readFile(join(fx.buildDir, 'data', 'feed', 'world-data.json'))).equals(feedAfterBundle.world));
  assert.ok((await readFile(join(fx.buildDir, 'data', 'feed', 'manifest.json'))).equals(feedAfterBundle.manifest));
  assert.ok(!feedBefore.world.equals(feedAfterBundle.world)); // the bundle step's own change, not ours

  // Failure is in the publish log with its error text; lastPublish
  // did NOT advance; the one object that landed is remembered.
  const lines = await logLines(fx);
  const failure = lines[lines.length - 1];
  assert.equal(failure.status, 'failed');
  assert.match(failure.error, /simulated R2 failure/);
  const state = JSON.parse(await readFile(fx.stateFile, 'utf8'));
  assert.equal(state.lastPublish.publishId, r1.publishId);
  assert.equal(state.uploadedObjects.length, manifestObjectKeys(JSON.parse(await readFile(join(fx.bucketDir, 'publishes', `${r1.publishId}.json`), 'utf8'))).length + 1);

  // Retry with a healthy uploader completes, skipping what landed
  // and re-sending what failed.
  fx.calls = [];
  const r2 = await run(fx, { nowMs: T0 + 20 * THROTTLE_MS });
  assert.equal(r2.status, 'published');
  const retriedKeys = fx.calls.map((c) => c.key);
  assert.ok(!retriedKeys.includes(landedKey), `retry re-uploaded ${landedKey}`);
  assert.ok(retriedKeys.includes(failedKey), `retry skipped the failed ${failedKey}`);
  assert.equal(retriedKeys[retriedKeys.length - 1], 'publish-manifest.json');
});

test('CLI contract: a failing wrangler exits 1, logs the failure, and the feed is byte-untouched', async () => {
  const fx = await fixture();
  const root = await mkdtemp(join(tmpdir(), 'portal-cycle-cli-'));
  const stub = join(root, 'wrangler-stub.sh');
  await writeFile(stub, '#!/bin/sh\necho "stub wrangler: boom" >&2\nexit 1\n', { mode: 0o755 });
  const feedWorld = await readFile(join(fx.buildDir, 'data', 'feed', 'world-data.json'));
  const feedManifest = await readFile(join(fx.buildDir, 'data', 'feed', 'manifest.json'));
  const res = spawnSync(process.execPath, [
    CYCLE, '--build', fx.buildDir, '--bucket', fx.bucketDir,
    '--state', fx.stateFile, '--log', fx.logFile, '--project-root', fx.projectRoot,
  ], { encoding: 'utf8', env: { ...process.env, PORTAL_STAGING_WRANGLER_BIN: stub } });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stderr, /wrangler put .* failed \(exit 1\)/);
  assert.ok((await readFile(join(fx.buildDir, 'data', 'feed', 'world-data.json'))).equals(feedWorld));
  assert.ok((await readFile(join(fx.buildDir, 'data', 'feed', 'manifest.json'))).equals(feedManifest));
  const lines = await logLines(fx);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].status, 'failed');
});

test('closure race: an imported module outside the publish set fails the cycle decision — nothing uploads, failure logged, state unadvanced; the settled tree publishes', async () => {
  const fx = await fixture();
  // The 2026-11-03 race shape (lane-gj1-fixes.md): the import lands
  // in logic.mjs (reached from the app.js entry) and the helper
  // EXISTS on disk, but the publish set does not carry it yet.
  await writeFile(join(fx.buildDir, 'app', 'app.js'), 'import "./logic.mjs";\nconsole.log("A")');
  await writeFile(join(fx.buildDir, 'app', 'logic.mjs'), 'import { z } from "./helper.mjs";\nexport const x = z;');
  await writeFile(join(fx.buildDir, 'app', 'helper.mjs'), 'export const z = 1;');

  await assert.rejects(
    () => run(fx),
    (err) => {
      assert.match(err.message, /module graph is not closed/);
      assert.match(err.message, /app\/helper\.mjs/);
      return true;
    },
  );
  // The publish decision failed BEFORE anything moved: no uploads,
  // no local publish, no state file, and the failure is in the log
  // naming the missing module (the cycle's STEP FAILURE semantics —
  // the supervisor logs it and the data cycle continues).
  assert.equal(fx.calls.length, 0);
  assert.deepEqual((await listPublishes({ bucketDir: fx.bucketDir })).ids, []);
  await assert.rejects(() => stat(fx.stateFile), /ENOENT/);
  const lines = await logLines(fx);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].status, 'failed');
  assert.match(lines[0].error, /app\/helper\.mjs/);

  // Positive control: once the edit settles (import removed), the
  // very next cycle publishes normally — pointer last.
  await writeFile(join(fx.buildDir, 'app', 'logic.mjs'), 'export const x = 1;');
  fx.calls = [];
  const r = await run(fx, { nowMs: T0 + THROTTLE_MS });
  assert.equal(r.status, 'published');
  assert.ok(fx.calls.length > 0);
  assert.equal(fx.calls[fx.calls.length - 1].key, 'publish-manifest.json');
  const lines2 = await logLines(fx);
  assert.equal(lines2.length, 2);
  assert.equal(lines2[1].status, 'published');
});

test('wrangler uploader: every put carries --remote and the bucket/key path (deploy-day finding 1)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'portal-cycle-uploader-'));
  const capture = join(root, 'args.txt');
  const stub = join(root, 'wrangler-stub.sh');
  await writeFile(stub, `#!/bin/sh\necho "$@" >> ${capture}\nexit 0\n`, { mode: 0o755 });
  const tokenFile = join(root, 'token');
  await writeFile(tokenFile, 'test-token-value\n');
  const upload = makeWranglerUploader({
    r2Bucket: 'elsewhere-portal-staging',
    wrangler: { cmd: stub, prefix: [] },
    tokenFile,
  });
  upload('objects/abc123', '/tmp/some-file');
  const args = (await readFile(capture, 'utf8')).trim();
  assert.match(args, /^r2 object put elsewhere-portal-staging\/objects\/abc123 --file \/tmp\/some-file --remote$/);
});
