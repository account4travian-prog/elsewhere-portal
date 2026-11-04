// Poller tests with a stubbed fetch: no network, temp archive dirs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchRoute } from '../poller.mjs';

const BASE = { baseUrl: 'https://example.invalid', userAgent: 'test', timeoutMs: 5000 };
const NOW = new Date('2026-11-02T02:04:35.000Z');

function stubFetch(body, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, text: async () => body });
}

async function fetchLog(archiveDir) {
  const raw = await readFile(join(archiveDir, 'fetch-log.jsonl'), 'utf8');
  return raw.trim().split('\n').map((l) => JSON.parse(l));
}

async function snapshotFiles(archiveDir) {
  const days = await readdir(archiveDir);
  const out = [];
  for (const d of days) {
    if (/^\d{4}-/.test(d)) out.push(...(await readdir(join(archiveDir, d))).map((f) => `${d}/${f}`));
  }
  return out;
}

test('a 200 JSON body is snapshotted and recorded with sha256', async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), 'portal-poller-'));
  const rec = await fetchRoute('overview', { ...BASE, archiveDir, fetchImpl: stubFetch('{"a":1}'), now: NOW });
  assert.equal(rec.status, 200);
  assert.ok(rec.snapshotId?.startsWith('snap_overview_20261102T020435Z_'));
  assert.equal(rec.bytes, 7);
  assert.match(rec.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(await snapshotFiles(archiveDir), ['2026-11-02/overview-20261102T020435Z.json']);
  const log = await fetchLog(archiveDir);
  assert.equal(log.length, 1);
  assert.equal(log[0].snapshotId, rec.snapshotId);
});

test('an unchanged body is recorded, not re-snapshotted', async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), 'portal-poller-'));
  const fetchImpl = stubFetch('{"a":1}');
  await fetchRoute('news', { ...BASE, archiveDir, fetchImpl, now: NOW });
  const rec2 = await fetchRoute('news', { ...BASE, archiveDir, fetchImpl, now: new Date('2026-11-02T02:06:35.000Z') });
  assert.equal(rec2.unchanged, true);
  assert.equal(rec2.snapshotId, null);
  assert.equal((await snapshotFiles(archiveDir)).length, 1);
  assert.equal((await fetchLog(archiveDir)).length, 2);
});

test('a malformed payload is rejected and recorded without crashing the pass', async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), 'portal-poller-'));
  const bad = await fetchRoute('voices', { ...BASE, archiveDir, fetchImpl: stubFetch('<html>not json</html>'), now: NOW });
  assert.match(bad.error, /malformed JSON/);
  assert.equal(bad.snapshotId, null);
  assert.equal((await snapshotFiles(archiveDir)).length, 0);
  // the pass continues: a later route still archives fine
  const good = await fetchRoute('status', { ...BASE, archiveDir, fetchImpl: stubFetch('{"online":true}'), now: NOW });
  assert.equal(good.status, 200);
  assert.ok(good.snapshotId);
  const log = await fetchLog(archiveDir);
  assert.equal(log.length, 2);
  assert.match(log[0].error, /malformed JSON/);
});

test('HTTP errors and network failures are recorded, never thrown', async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), 'portal-poller-'));
  const http = await fetchRoute('map', { ...BASE, archiveDir, fetchImpl: stubFetch('nope', { ok: false, status: 503 }), now: NOW });
  assert.equal(http.status, 503);
  assert.match(http.error, /HTTP 503/);
  const net = await fetchRoute('chats', {
    ...BASE, archiveDir, now: NOW,
    fetchImpl: async () => { throw new Error('socket hangup'); },
  });
  assert.equal(net.status, 'error');
  assert.match(net.error, /socket hangup/);
  assert.equal((await fetchLog(archiveDir)).length, 2);
});
