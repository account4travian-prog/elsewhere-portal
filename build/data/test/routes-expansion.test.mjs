// M2.01 route-expansion tests: the 11-route scheduled set (Plan B §2.1 /
// SE-1.7, REC-6), ROUTES/cadence.json unification, per-route fetch
// behaviour for the five new routes, pass-level failure isolation, the
// watch-mode backoff curve, and the identity scan's widened coverage.
// Stubbed fetch throughout: no network, temp archive dirs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ROUTES,
  dailyFetchTotal,
  fetchRoute,
  loadCadence,
  nextDelaySeconds,
  runPass,
} from '../poller.mjs';
import { ROUTES as WORLD_BOOK_ROUTES } from '../world-books.mjs';
import { scanArchiveForCandidates } from '../identity-registry.mjs';

const NEW_ROUTES = ['debates', 'discussions', 'problems', 'concerts', 'errata'];
const BASE = { baseUrl: 'https://example.invalid', userAgent: 'test', timeoutMs: 5000 };
const NOW = new Date('2026-11-03T01:10:00.000Z');

// Small synthetic bodies in the live payloads' shapes (2026-11-03 read).
const BODIES = {
  debates: '{"debates":[],"drawn_at":"2026-11-03T01:09:00Z","what_this_is":"college debates"}',
  discussions: '{"discussions":[{"number":1,"status":"open","question":"Why?","opened_at":"2026-11-02T00:00:00Z","replies":[]}],"generated_at":"2026-11-03T01:09:00Z"}',
  problems: '{"board":{"fellows":5},"problems":[{"code":"P1","title":"T","status":"open"}],"ladders":[],"drawn_at":"2026-11-03T01:09:00Z"}',
  concerts: '{"now":[],"coming":[],"performances":[{"id":"c1","kind":"recital"}],"generated_at":"2026-11-03T01:09:00Z"}',
  errata: '{"errata":[],"entries":0,"began":"2026-01-01T00:00:00Z"}',
};

async function snapshotFiles(archiveDir) {
  const out = [];
  for (const d of await readdir(archiveDir)) {
    if (/^\d{4}-/.test(d)) out.push(...(await readdir(join(archiveDir, d))).map((f) => `${d}/${f}`));
  }
  return out.sort();
}

// ------------------------------------------------------------ the set

test('M2.01: ROUTES is exactly the 11 scheduled routes, Wave 1 six first', () => {
  assert.deepEqual(ROUTES, [
    'overview', 'news', 'voices', 'map', 'status', 'chats',
    'debates', 'discussions', 'problems', 'concerts', 'errata',
  ]);
});

test('M2.01 unification: cadence.json carries exactly the ROUTES set', async () => {
  const cadence = await loadCadence();
  assert.deepEqual(Object.keys(cadence.routesSeconds).sort(), [...ROUTES].sort());
});

test('M2.01 cadences match Plan B §2.1 for every route', async () => {
  const { routesSeconds } = await loadCadence();
  assert.deepEqual(routesSeconds, {
    overview: 60, status: 60, news: 120, voices: 120, map: 300, chats: 300,
    debates: 600, discussions: 600, problems: 600, concerts: 600, errata: 3600,
  });
});

test('M2.01 budget: the scheduled total is 5,496 fetches/day (Plan B §2.1)', async () => {
  const { routesSeconds } = await loadCadence();
  assert.equal(dailyFetchTotal(routesSeconds), 5496);
  // The five new routes add exactly 600/day over the Wave 1 total.
  const wave1 = { overview: 60, status: 60, news: 120, voices: 120, map: 300, chats: 300 };
  assert.equal(dailyFetchTotal(wave1), 4896);
  assert.equal(dailyFetchTotal(routesSeconds) - dailyFetchTotal(wave1), 600);
});

test('M2.01 unification: world-books imports the same ROUTES list', () => {
  assert.equal(WORLD_BOOK_ROUTES, ROUTES);
});

// ------------------------------------------------- new-route fetching

test('M2.01: each new route snapshots a 200 JSON body under its own name', async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), 'portal-m201-'));
  for (const route of NEW_ROUTES) {
    const rec = await fetchRoute(route, {
      ...BASE, archiveDir, now: NOW,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => BODIES[route] }),
    });
    assert.equal(rec.status, 200, route);
    assert.ok(rec.snapshotId?.startsWith(`snap_${route}_20261103T011000Z_`), route);
  }
  assert.deepEqual(await snapshotFiles(archiveDir), [
    '2026-11-03/concerts-20261103T011000Z.json',
    '2026-11-03/debates-20261103T011000Z.json',
    '2026-11-03/discussions-20261103T011000Z.json',
    '2026-11-03/errata-20261103T011000Z.json',
    '2026-11-03/problems-20261103T011000Z.json',
  ]);
});

test('M2.01: an unchanged new-route body is recorded, not re-snapshotted', async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), 'portal-m201-'));
  for (const route of NEW_ROUTES) {
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => BODIES[route] });
    await fetchRoute(route, { ...BASE, archiveDir, fetchImpl, now: NOW });
    const rec2 = await fetchRoute(route, {
      ...BASE, archiveDir, fetchImpl, now: new Date('2026-11-03T01:20:00.000Z'),
    });
    assert.equal(rec2.unchanged, true, route);
    assert.equal(rec2.snapshotId, null, route);
  }
  assert.equal((await snapshotFiles(archiveDir)).length, 5);
  const log = (await readFile(join(archiveDir, 'fetch-log.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(log.length, 10);
});

test('M2.01: a malformed new-route body is rejected and recorded, never snapshotted', async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), 'portal-m201-'));
  for (const route of NEW_ROUTES) {
    const rec = await fetchRoute(route, {
      ...BASE, archiveDir, now: NOW,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>oops</html>' }),
    });
    assert.match(rec.error, /malformed JSON/, route);
    assert.equal(rec.snapshotId, null, route);
  }
  assert.equal((await snapshotFiles(archiveDir)).length, 0);
});

test('M2.01: a full pass covers all 11 routes; two failing new routes delay nothing', async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), 'portal-m201-'));
  const fetchImpl = async (url) => {
    const route = /\/public\/([a-z]+)\.json$/.exec(url)[1];
    if (route === 'concerts') return { ok: false, status: 503, text: async () => 'down' };
    if (route === 'errata') throw new Error('socket hangup');
    return { ok: true, status: 200, text: async () => BODIES[route] ?? '{"ok":true}' };
  };
  const records = await runPass({ ...BASE, archiveDir, fetchImpl, now: NOW });
  assert.deepEqual(records.map((r) => r.route), ROUTES);
  const byRoute = new Map(records.map((r) => [r.route, r]));
  assert.equal(byRoute.get('concerts').status, 503);
  assert.match(byRoute.get('concerts').error, /HTTP 503/);
  assert.equal(byRoute.get('errata').status, 'error');
  assert.match(byRoute.get('errata').error, /socket hangup/);
  for (const route of ROUTES) {
    if (route === 'concerts' || route === 'errata') continue;
    assert.ok(byRoute.get(route).snapshotId, `${route} still snapshotted`);
  }
  assert.equal((await snapshotFiles(archiveDir)).length, 9);
});

// ------------------------------------------------------------- backoff

test('M2.01 backoff: healthy routes wait their cadence; errors double to the 30 min cap', () => {
  assert.equal(nextDelaySeconds(60, 0), 60);
  assert.equal(nextDelaySeconds(120, 0), 120);
  assert.equal(nextDelaySeconds(60, 1), 60);    // base 60 s
  assert.equal(nextDelaySeconds(60, 2), 120);
  assert.equal(nextDelaySeconds(60, 3), 240);
  assert.equal(nextDelaySeconds(60, 5), 960);
  assert.equal(nextDelaySeconds(60, 6), 1800);  // capped, not 1,920
  assert.equal(nextDelaySeconds(60, 20), 1800); // never a hot loop, never unbounded
  assert.equal(nextDelaySeconds(300, 4), 480);  // backoff above cadence wins
  assert.equal(nextDelaySeconds(3600, 3), 3600); // never faster than cadence (errata)
});

// ------------------------------------------------- identity scan reach

test('M2.01: the identity scan covers new-route snapshots, and only route snapshots', async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), 'portal-m201-scan-'));
  const day = join(archiveDir, '2026-11-03');
  await mkdir(day, { recursive: true });
  await writeFile(join(day, 'concerts-20261103T011000Z.json'),
    '{"performances":[{"by":"Ada Quill","page":"/public/agents/ada-quill"}]}');
  await writeFile(join(day, 'discussions-20261103T011000Z.json'),
    '{"discussions":[{"question":"plain text, no routes"}]}');
  // Not a scheduled route: must be ignored even though it names a route.
  await writeFile(join(day, 'tiles-20261103T011000Z.json'),
    '{"features":[{"by":"Bob Vale","page":"/public/agents/bob-vale"}]}');
  const { candidates, filesScanned } = await scanArchiveForCandidates(archiveDir);
  assert.equal(filesScanned, 2);
  assert.equal(candidates.sightings, 1);
  assert.ok(candidates.tied.get('Ada Quill')?.has('ada-quill'));
  assert.equal(candidates.tied.has('Bob Vale'), false);
});
