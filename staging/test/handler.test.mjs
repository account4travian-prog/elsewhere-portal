// M4.02 — staging Worker handler tests (in-memory store).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createHandler, PUBLISH_MANIFEST_KEY,
  SCENE_IMPORTMAP_SHA256, SCENE_STYLE_SHA256,
} from '../worker/worker.mjs';
import { createFsStore } from '../worker/store-fs.mjs';

const PROJECT_BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'build');

const TOKEN = 'test-token-0123456789abcdef';
const sha = (s) => createHash('sha256').update(s).digest('hex');

function makeStore(sceneBytes = null) {
  const objects = new Map();
  const put = (key, text) => objects.set(key, new TextEncoder().encode(text));
  const indexBytes = '<!doctype html><title>Portal</title>';
  const bundleBytes = '{"schema":"portal.world-data/v2"}';
  const appBytes = 'console.log("app")';
  put('objects/' + sha(indexBytes), indexBytes);
  put('objects/' + sha(bundleBytes), bundleBytes);
  put('objects/' + sha(appBytes), appBytes);
  if (sceneBytes !== null) put('objects/' + sha(sceneBytes), sceneBytes);
  const manifest = {
    publishId: 'pub-1-test',
    bundleSeq: 7,
    feed: { schema: 'portal.world-data/v2', worlddataHash: sha(bundleBytes), newestFetchUtc: '2026-11-03T00:00:00.000Z' },
    files: {
      'app/index.html': { object: 'objects/' + sha(indexBytes), sha256: sha(indexBytes), size: indexBytes.length, contentType: 'text/html; charset=utf-8' },
      'app/app.js': { object: 'objects/' + sha(appBytes), sha256: sha(appBytes), size: appBytes.length, contentType: 'text/javascript; charset=utf-8' },
      'data/feed/world-data.json': { object: 'objects/' + sha(bundleBytes), sha256: sha(bundleBytes), size: bundleBytes.length, contentType: 'application/json; charset=utf-8' },
    },
  };
  if (sceneBytes !== null) {
    manifest.files['visual/scene/scene.html'] = {
      object: 'objects/' + sha(sceneBytes),
      sha256: sha(sceneBytes),
      size: new TextEncoder().encode(sceneBytes).byteLength,
      contentType: 'text/html; charset=utf-8',
    };
  }
  put(PUBLISH_MANIFEST_KEY, JSON.stringify(manifest));
  return { async get(key) { return objects.get(key) ?? null; } };
}

const handle = () => createHandler({ store: makeStore(), config: { pathToken: TOKEN } });
const req = (path, init) => new Request(`https://staging.example${path}`, init);

test('no/short token never degrades to open access: handler construction throws', () => {
  assert.throws(() => createHandler({ store: makeStore(), config: {} }), /pathToken/);
  assert.throws(() => createHandler({ store: makeStore(), config: { pathToken: 'short' } }), /pathToken/);
  assert.throws(() => createHandler({ config: { pathToken: TOKEN } }), /store/);
});

test('wrong token, missing token and bare root are all 404 — the site does not exist', async () => {
  const h = handle();
  for (const p of ['/', '/wrong-token-0123456789abcde/', `/${TOKEN}x/app/app.js`, '/app/index.html']) {
    const res = await h(req(p));
    assert.equal(res.status, 404, p);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  }
});

test('app index serves at its canonical path with CSP and brief static caching', async () => {
  const res = await handle()(req(`/${TOKEN}/app/index.html`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(await res.text(), '<!doctype html><title>Portal</title>');
});

// Round 2 of the 2026-11-02 staging hang: the app document was served
// AT the token root, but every reference in it is relative —
// styles.css, app.js, the module graph behind app.js, and the app's
// own data fetches all resolve against the document URL. At the root
// URL the app/ segment is missing, so the browser resolved the page's
// stylesheet and module script to /<token>/styles.css and
// /<token>/app.js — both 404 — and the app never executed (unstyled
// page, inert demo button) while every file census passed, because
// the censuses fetched files by their manifest paths, never by the
// URLs a browser derives from the served page. The root (and the
// bare app segment) therefore redirect to the canonical document
// URL; a wrong token must still 404, never redirect.
test('token root and bare app segment redirect to the canonical app document URL', async () => {
  const h = handle();
  for (const p of [`/${TOKEN}`, `/${TOKEN}/`, `/${TOKEN}/app`]) {
    const res = await h(req(p));
    assert.equal(res.status, 302, p);
    assert.equal(res.headers.get('location'), `/${TOKEN}/app/index.html`, p);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  }
  const head = await h(req(`/${TOKEN}/`, { method: 'HEAD' }));
  assert.equal(head.status, 302);
  assert.equal((await h(req('/wrong-token-0123456789abcde/'))).status, 404);
});

// The scene half of the 2026-11-02 staging hang: scene.html carries
// an inline import map and an inline <style> block, and its decoder
// instantiates WebAssembly. The strict site CSP blocks all three.
// The scene response — and only the scene response — must carry the
// exact-content hashes of the CURRENT scene.html inline blocks plus
// 'wasm-unsafe-eval'; this test recomputes the hashes from the real
// file, so editing either inline block without updating the Worker
// constants fails here rather than un-styling the deployed scene.
test('scene page CSP carries the exact hashes of its inline import map and style', async () => {
  const sceneText = await readFile(join(PROJECT_BUILD, 'visual', 'scene', 'scene.html'), 'utf8');
  const hashOf = (text) => `sha256-${createHash('sha256').update(text).digest('base64')}`;
  const importmapText = sceneText.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
  const styleText = sceneText.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert.ok(importmapText, 'scene.html no longer has an inline import map — revisit the scene CSP');
  assert.ok(styleText, 'scene.html no longer has an inline style block — revisit the scene CSP');
  assert.equal(SCENE_IMPORTMAP_SHA256, hashOf(importmapText), 'Worker import-map hash has drifted from scene.html');
  assert.equal(SCENE_STYLE_SHA256, hashOf(styleText), 'Worker style hash has drifted from scene.html');

  const h = createHandler({ store: makeStore(sceneText), config: { pathToken: TOKEN } });
  const res = await h(req(`/${TOKEN}/visual/scene/scene.html`));
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp.includes(`script-src 'self' '${SCENE_IMPORTMAP_SHA256}' 'wasm-unsafe-eval'`), csp);
  assert.ok(csp.includes(`style-src 'self' '${SCENE_STYLE_SHA256}'`), csp);
  assert.ok(!csp.includes("'unsafe-inline'"), csp);
  assert.ok(!csp.includes(" 'unsafe-eval'"), csp);

  // The app index keeps the strict policy: no hashes, no Wasm eval.
  const app = await h(req(`/${TOKEN}/app/index.html`));
  const appCsp = app.headers.get('content-security-policy');
  assert.ok(appCsp.includes("script-src 'self';"), appCsp);
  assert.ok(appCsp.includes("style-src 'self';"), appCsp);
  assert.ok(!appCsp.includes('wasm-unsafe-eval'), appCsp);
});

test('feed bundle: no-cache revalidation, strong ETag, SE-5.4 honesty stamps', async () => {
  const h = handle();
  const res = await h(req(`/${TOKEN}/data/feed/world-data.json`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  const etag = res.headers.get('etag');
  assert.ok(etag.startsWith('"') && etag.endsWith('"'));
  assert.equal(res.headers.get('x-portal-worlddata-hash'), sha('{"schema":"portal.world-data/v2"}'));
  assert.equal(res.headers.get('x-portal-newest-fetch'), '2026-11-03T00:00:00.000Z');
  assert.equal(res.headers.get('x-portal-bundle-seq'), '7');
  // Revalidation against the exact current bytes yields 304…
  const reval = await h(req(`/${TOKEN}/data/feed/world-data.json`, { headers: { 'if-none-match': etag } }));
  assert.equal(reval.status, 304);
  // …and a foreign ETag never does (no stale bundle served as fresh).
  const stale = await h(req(`/${TOKEN}/data/feed/world-data.json`, { headers: { 'if-none-match': '"deadbeef"' } }));
  assert.equal(stale.status, 200);
});

test('non-GET/HEAD is 405 with Allow (SE-5.4 negative witness)', async () => {
  const h = handle();
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = await h(req(`/${TOKEN}/data/feed/world-data.json`, { method }));
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'GET, HEAD');
  }
});

test('unknown paths and traversal attempts 404; HEAD returns headers without a body', async () => {
  const h = handle();
  assert.equal((await h(req(`/${TOKEN}/data/feed/`))).status, 404); // no listing
  assert.equal((await h(req(`/${TOKEN}/admin`))).status, 404);
  assert.equal((await h(req(`/${TOKEN}/../publish-manifest.json`))).status, 404);
  assert.equal((await h(req(`/${TOKEN}/objects/${sha('x')}`))).status, 404); // objects are never URL-addressed
  const head = await h(req(`/${TOKEN}/app/app.js`, { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String('console.log("app")'.length));
  assert.equal(await head.text(), '');
});

// The census round 1 never ran: start from the URL a visitor is
// actually given (the token root), follow what the handler does with
// it, and resolve every reference the served page makes the way a
// browser resolves it — against the document URL, through this
// handler — over the publisher's real local bucket. Round 1's graph
// closure walked the build tree on disk, where ../ resolves against
// the filesystem and this defect cannot exist; on the served site
// the same specifiers resolve against URLs, and the app/ segment
// the root mapping stripped was load-bearing.
test('served-page closure: from the root URL, every page reference resolves through the handler', async () => {
  const bucketDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.local-bucket');
  try {
    await readFile(join(bucketDir, PUBLISH_MANIFEST_KEY), 'utf8');
  } catch {
    throw new Error('staging/.local-bucket has no publish manifest — run `node staging/publish.mjs` before this suite');
  }
  const h = createHandler({ store: createFsStore(bucketDir), config: { pathToken: TOKEN } });
  const origin = 'https://staging.example';
  const cache = new Map();
  const fetchServed = async (url) => {
    if (!cache.has(url)) {
      const res = await h(new Request(url));
      cache.set(url, { status: res.status, type: res.headers.get('content-type'), text: await res.text() });
    }
    return cache.get(url);
  };

  const root = await h(new Request(`${origin}/${TOKEN}/`));
  assert.equal(root.status, 302, 'the token root must redirect to the canonical document URL');
  const docUrl = new URL(root.headers.get('location'), origin).href;
  const doc = await fetchServed(docUrl);
  assert.equal(doc.status, 200, `document ${docUrl} returned ${doc.status}`);

  const refs = [
    ...doc.text.matchAll(/<link[^>]+href="([^"]+)"/g),
    ...doc.text.matchAll(/<script[^>]+src="([^"]+)"/g),
  ].map((m) => m[1]);
  assert.ok(refs.length >= 2, 'index.html should reference a stylesheet and a module script');
  let appJsUrl = null;
  for (const ref of refs) {
    const u = new URL(ref, docUrl).href;
    const r = await fetchServed(u);
    assert.equal(r.status, 200, `page reference ${ref} resolved to ${u} returned ${r.status}`);
    if (u.endsWith('/app.js')) appJsUrl = u;
  }
  assert.ok(appJsUrl, 'the module script reference did not resolve to app.js');

  // Walk the static module graph from app.js, resolving each
  // specifier against its importer's served URL.
  const visited = new Set();
  const queue = [appJsUrl];
  while (queue.length) {
    const u = queue.shift();
    if (visited.has(u)) continue;
    visited.add(u);
    const r = await fetchServed(u);
    assert.equal(r.status, 200, `module ${u} returned ${r.status}`);
    assert.match(r.type ?? '', /^text\/javascript/, `module ${u} served as ${r.type}`);
    for (const m of r.text.matchAll(/(?:from\s+|import\s+)['"](\.[^'"]+)['"]/g)) {
      queue.push(new URL(m[1], u).href);
    }
  }
  for (const p of ['app/logic.mjs', 'app/live-pacing.mjs', 'engine/playback.mjs', 'engine/conflicts.mjs', 'engine/astar.mjs']) {
    assert.ok([...visited].some((u) => u.endsWith('/' + p)), `module graph never reached ${p}`);
  }

  // The app's primary data fetches, resolved against the document
  // URL. (The sample-data fallback probes later in the chain are
  // by-design 404-tolerant and deliberately not asserted here.)
  for (const rel of ['../data/feed/world-data.json', '../shared/ember-layout.json', '../fixtures/demo-journey.json']) {
    const u = new URL(rel, docUrl).href;
    const r = await fetchServed(u);
    assert.equal(r.status, 200, `fetch ${rel} resolved to ${u} returned ${r.status}`);
  }
});
