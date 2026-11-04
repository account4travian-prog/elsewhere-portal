// Elsewhere Portal — staging auto-republish step (M4.02 follow-on).
//
// the project owner's decision, 2026-11-02 22:08 CST (DECISIONS.md): staging
// republishes AUTOMATICALLY as new bundles land. This module is the
// supervisor-cycle step that does it: the archiver supervisor runs it
// after the bundle step and after the episodes/facts/journeys steps
// that refresh the feed files the bundle cites, so staging tracks the
// same publications the local feed gets.
//
// Contract (binding):
//   - NEVER break the data cycle. The supervisor invokes this through
//     its generic run_step (a failure is logged, the cycle continues);
//     locally, publish() only READS build/ and writes the staging
//     bucket dir + staging state/log — the feed is never touched.
//   - publish.mjs's bundle-check and module-closure gates still
//     refuse every bad feed / unclosed snapshot before a single byte
//     moves (publish() throws; nothing uploads; the failure is
//     logged below and the previous publish keeps serving).
//   - Delta-only uploads. Objects are content-addressed and immutable;
//     .staging-publish-state.json records every object sha already in
//     the R2 bucket, and those are skipped with no API call. Only new
//     objects + the manifest pointer go up (pointer LAST, SE-5.2).
//     Missing/corrupt state ⇒ one full publish, state rebuilt.
//   - Throttle: fire only when the feed bundle hash (worlddataHash)
//     differs from the last staging publish AND ≥60 s have passed
//     since it. Skips (unchanged / throttled / paused) write NO log
//     lines — publish-log.jsonl records publishes and failures only.
//   - Kill switch: DEVELOPMENT-PAUSED at the project root ⇒ skip
//     silently. (The archiver itself is exempt by the project owner's design;
//     this step is not.)
//   - Every wrangler put carries --remote (deploy-day finding 1).
//     The deploy token is read from ~/.config/cf-api-token — the
//     existing token flow only; it is passed to wrangler's env and
//     never printed or logged.
//
// Usage (supervisor):  node staging-cycle.mjs
// Usage (manual/test): node staging-cycle.mjs [--build <dir>]
//                        [--bucket <dir>] [--state <file>]
//                        [--log <file>] [--project-root <dir>]
//                        [--r2-bucket <name>]
// Exit 0 = published or cleanly skipped; exit 1 = failed (logged).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestObjectKeys, publish } from './publish.mjs';

const STAGING_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(STAGING_DIR, '..');
const PROJECT_BUILD = join(PROJECT_ROOT, 'build');
const DEFAULT_BUCKET_DIR = join(STAGING_DIR, '.local-bucket');
const DEFAULT_STATE_FILE = join(STAGING_DIR, '.staging-publish-state.json');
const DEFAULT_LOG_FILE = join(STAGING_DIR, 'publish-log.jsonl');
const PAUSED_NAME = 'DEVELOPMENT-PAUSED';
const DEFAULT_R2_BUCKET = 'elsewhere-portal-staging';
const ACCOUNT_ID = '<CLOUDFLARE_ACCOUNT_ID>'; // owner's (wrangler.toml)
// Deploy home: the account whose ~/.config holds the deploy token and
// whose ~/.npm holds the wrangler npx cache is the account that owns
// this project tree — NOT necessarily the HOME of whatever process
// started the supervisor. Root cron runs with HOME=/root, and every
// supervisor instance the in-VM watchdog started failed this step with
// "ENOENT: no such file or directory, open '/root/.config/cf-api-token'"
// (first at 2026-11-03T05:15:05Z, every cycle thereafter) while
// agent-started instances (HOME=/home/user) published fine. Resolve
// deterministically: prefer the ambient homedir when the token is
// actually there, else derive the home from this file's place in the
// tree (<home>/workspace/elsewhere-portal/staging/).
function deployHome() {
  const fromTree = join(STAGING_DIR, '..', '..', '..');
  for (const candidate of [homedir(), fromTree]) {
    if (candidate && existsSync(join(candidate, '.config', 'cf-api-token'))) return candidate;
  }
  return homedir();
}
const DEPLOY_HOME = deployHome();
const TOKEN_FILE = join(DEPLOY_HOME, '.config', 'cf-api-token');
// Egress CA bundle: this VM's egress proxy presents its own TLS cert to
// Node's fetch, so wrangler verifies it against NODE_EXTRA_CA_CERTS —
// and the platform ROTATES that bundle in place (2026-11-03: profile
// rewritten 12:58:12Z, bundle regenerated 12:58:45Z). A long-lived
// supervisor's env is a snapshot from before the rotation: it carried
// no NODE_EXTRA_CA_CERTS at all, so every wrangler put from
// 13:06:58Z to the fix failed with ERR_TLS_CERT_ALTNAME_INVALID
// ("fetch failed") while the token, the proxy credential, and R2 were
// all healthy. The ambient env can therefore never be trusted for
// this value: re-read the platform's egress profile on every cycle
// (this process is fresh per cycle) and pass the bundle it names.
// Incident record: plan-to-complete/lane-staging-incident.md.
const EGRESS_PROFILE = '/etc/profile.d/hatch-egress.sh';
export function egressCaBundle() {
  try {
    const m = readFileSync(EGRESS_PROFILE, 'utf8')
      .match(/^\s*export\s+NODE_EXTRA_CA_CERTS=["']?([^"'\s]+)["']?\s*$/m);
    if (m && existsSync(m[1])) return m[1];
  } catch { /* no readable profile — fall through to the ambient value */ }
  return process.env.NODE_EXTRA_CA_CERTS || null;
}
const WORKER_DIR = join(STAGING_DIR, 'worker'); // wrangler.toml lives here
export const THROTTLE_MS = 60_000;
const PUT_TIMEOUT_MS = 120_000;

const shaOfKey = (key) => key.slice('objects/'.length);

// --- wrangler resolution ---------------------------------------------------
// The deploy-day wrangler (4.148.0) is not on PATH on this VM; it runs
// from the npx cache. Resolution order: explicit env override (tests
// point this at a stub), PATH, the npx cache, then an npx fallback.
export function resolveWrangler(env = process.env) {
  if (env.PORTAL_STAGING_WRANGLER_BIN) return { cmd: env.PORTAL_STAGING_WRANGLER_BIN, prefix: [] };
  const onPath = spawnSync('which', ['wrangler'], { encoding: 'utf8' });
  if (onPath.status === 0 && onPath.stdout.trim()) return { cmd: onPath.stdout.trim(), prefix: [] };
  // The npx cache lives under the deploy home (see deployHome) — under
  // a starter whose HOME differs (root cron), homedir() alone misses it.
  for (const home of new Set([DEPLOY_HOME, homedir()])) {
    try {
      for (const entry of readdirSync(join(home, '.npm', '_npx'))) {
        const bin = join(home, '.npm', '_npx', entry, 'node_modules', '.bin', 'wrangler');
        if (existsSync(bin)) return { cmd: bin, prefix: [] };
      }
    } catch { /* no npx cache under this home — try the next */ }
  }
  return { cmd: 'npx', prefix: ['--yes', 'wrangler@4.148.0'] };
}

// Default uploader: one `wrangler r2 object put --remote` per key.
export function makeWranglerUploader({ r2Bucket, wrangler, tokenFile = TOKEN_FILE }) {
  let token = null;
  return function uploadObject(key, localFile) {
    if (token === null) {
      token = readFileSync(tokenFile, 'utf8').trim();
      if (!token) throw new Error(`staging-cycle: deploy token file ${tokenFile} is empty`);
    }
    const res = spawnSync(
      wrangler.cmd,
      [...wrangler.prefix, 'r2', 'object', 'put', `${r2Bucket}/${key}`, '--file', localFile, '--remote'],
      {
        cwd: WORKER_DIR,
        encoding: 'utf8',
        timeout: PUT_TIMEOUT_MS,
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: token,
          CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
          // After ...process.env on purpose: overrides a stale or
          // missing inherited value with the profile's current one.
          ...(egressCaBundle() ? { NODE_EXTRA_CA_CERTS: egressCaBundle() } : {}),
        },
      },
    );
    if (res.error) throw new Error(`staging-cycle: wrangler put ${key} could not run: ${res.error.message}`);
    if (res.status !== 0) {
      const detail = (res.stderr || res.stdout || '').trim().split('\n').slice(-3).join(' ');
      throw new Error(`staging-cycle: wrangler put ${key} failed (exit ${res.status}): ${detail}`);
    }
  };
}

// --- state -------------------------------------------------------------------

async function loadState(stateFile, r2Bucket) {
  try {
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    if (!state || state.version !== 1 || state.r2Bucket !== r2Bucket
      || !Array.isArray(state.uploadedObjects)) return null;
    return state;
  } catch {
    return null; // missing or corrupt ⇒ full publish fallback
  }
}

async function saveState(stateFile, state) {
  await mkdir(dirname(stateFile), { recursive: true });
  const tmp = `${stateFile}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`);
  await rename(tmp, stateFile);
}

async function appendLog(logFile, entry) {
  await mkdir(dirname(logFile), { recursive: true });
  await appendFile(logFile, `${JSON.stringify(entry)}\n`);
}

// --- the cycle -----------------------------------------------------------------

export async function runStagingCycle({
  buildDir = PROJECT_BUILD,
  bucketDir = DEFAULT_BUCKET_DIR,
  stateFile = DEFAULT_STATE_FILE,
  logFile = DEFAULT_LOG_FILE,
  projectRoot = PROJECT_ROOT,
  r2Bucket = DEFAULT_R2_BUCKET,
  nowMs = Date.now(),
  throttleMs = THROTTLE_MS,
  uploadObject = null,
  note = 'auto: archiver supervisor cycle',
} = {}) {
  // Kill switch first, and silently: no publish, no log line.
  if (existsSync(join(projectRoot, PAUSED_NAME))) return { status: 'paused' };

  const feedManifest = JSON.parse(await readFile(join(buildDir, 'data', 'feed', 'manifest.json'), 'utf8'));
  const bundleHash = feedManifest.worlddataHash;

  const state = await loadState(stateFile, r2Bucket);
  if (state?.lastPublish?.worlddataHash === bundleHash) {
    return { status: 'unchanged', bundleSeq: feedManifest.bundleSeq };
  }
  if (state?.lastPublish && nowMs - state.lastPublish.atMs < throttleMs) {
    return { status: 'throttled', bundleSeq: feedManifest.bundleSeq, retryAfterMs: throttleMs - (nowMs - state.lastPublish.atMs) };
  }

  const mode = state ? 'delta' : 'full';
  const uploadedSet = new Set(state?.uploadedObjects ?? []);
  let manifest = null;
  let uploadedThisRun = 0;
  try {
    // Local publish first: bundle-check gate, content-addressed
    // objects, pointer last — all inside publish(). Reads build/,
    // writes only bucketDir; the feed is never touched.
    ({ manifest } = await publish({ buildDir, bucketDir, note }));

    const upload = uploadObject ?? makeWranglerUploader({ r2Bucket, wrangler: resolveWrangler() });
    const needed = manifestObjectKeys(manifest);
    const toUpload = needed.filter((key) => !uploadedSet.has(shaOfKey(key)));
    for (const key of toUpload) {
      upload(key, join(bucketDir, key));
      uploadedSet.add(shaOfKey(key));
      uploadedThisRun += 1;
    }
    // Pointer LAST (SE-5.2): R2 serves the new publish only once
    // every object it names is already there.
    upload('publish-manifest.json', join(bucketDir, 'publishes', `${manifest.publishId}.json`));

    const done = {
      version: 1,
      r2Bucket,
      uploadedObjects: [...uploadedSet].sort(),
      lastPublish: {
        publishId: manifest.publishId,
        bundleSeq: manifest.bundleSeq,
        worlddataHash: bundleHash,
        atMs: nowMs,
      },
      updatedAtUtc: new Date(nowMs).toISOString(),
    };
    await saveState(stateFile, done);
    await appendLog(logFile, {
      atUtc: new Date(nowMs).toISOString(),
      status: 'published',
      mode,
      publishId: manifest.publishId,
      bundleSeq: manifest.bundleSeq,
      worlddataHash: bundleHash,
      objectsUploaded: uploadedThisRun,
      objectsSkipped: needed.length - toUpload.length,
      puts: uploadedThisRun + 1, // objects + pointer
    });
    return {
      status: 'published', mode, publishId: manifest.publishId,
      bundleSeq: manifest.bundleSeq, objectsUploaded: uploadedThisRun,
      objectsSkipped: needed.length - toUpload.length,
    };
  } catch (err) {
    // Failure: keep the objects that DID land recorded (they are
    // immutable and idempotent to skip next time) but never advance
    // lastPublish — staging keeps serving the previous publish, and
    // the next cycle retries. The feed and the local data cycle are
    // untouched either way.
    if (manifest) {
      await saveState(stateFile, {
        version: 1,
        r2Bucket,
        uploadedObjects: [...uploadedSet].sort(),
        lastPublish: state?.lastPublish ?? null,
        updatedAtUtc: new Date(nowMs).toISOString(),
      }).catch(() => {});
    }
    await appendLog(logFile, {
      atUtc: new Date(nowMs).toISOString(),
      status: 'failed',
      mode,
      publishId: manifest?.publishId ?? null,
      bundleSeq: feedManifest.bundleSeq,
      objectsUploaded: uploadedThisRun,
      error: err.message,
    }).catch(() => {});
    throw err;
  }
}

// ---- CLI -----------------------------------------------------------------

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const result = await runStagingCycle({
    buildDir: arg('build', PROJECT_BUILD),
    bucketDir: arg('bucket', DEFAULT_BUCKET_DIR),
    stateFile: arg('state', DEFAULT_STATE_FILE),
    logFile: arg('log', DEFAULT_LOG_FILE),
    projectRoot: arg('project-root', PROJECT_ROOT),
    r2Bucket: arg('r2-bucket', DEFAULT_R2_BUCKET),
  });
  if (result.status === 'published') {
    console.log(`staging republished: ${result.publishId} (bundleSeq ${result.bundleSeq}, ${result.mode}, ${result.objectsUploaded} object(s) uploaded, ${result.objectsSkipped} skipped, pointer last)`);
  } else {
    console.log(`staging republish skipped: ${result.status}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
