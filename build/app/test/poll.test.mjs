// Manifest poll tests (M4.03, SE-5.3 / Design H4).
// The poll's decision core is pure (logic.mjs): readers are injected,
// so every exit-gate scenario runs here end to end — seq bump adopts,
// mismatch discards WHOLE, feed death changes nothing on stage. The
// hash expectations are computed with node:crypto, an independent
// implementation from the WebCrypto path under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  POLL_INTERVAL_MS,
  feedManifestSeq,
  feedManifestHash,
  pollPlan,
  sha256Hex,
  verifyBundleBytes,
  parseVerifiedBundle,
  pollOnce,
} from '../logic.mjs';

const nodeSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const enc = (s) => new TextEncoder().encode(s);
const bundleBytes = (seq, extra = {}) => enc(JSON.stringify({ schema: 'portal.world-data/v2', bundleSeq: seq, citizens: [], ...extra }));
const manifestFor = (bytes, seq) => ({ bundleSeq: seq, worlddataHash: nodeSha256(bytes), newestFetchUtc: '2026-11-03T00:00:00Z', schema: 'portal.world-data/v2' });

test('the poll cadence is the plan\u2019s 20 seconds', () => {
  assert.equal(POLL_INTERVAL_MS, 20_000);
});

test('manifest readers: seq and hash are read strictly', () => {
  const m = manifestFor(bundleBytes(7), 7);
  assert.equal(feedManifestSeq(m), 7);
  assert.equal(feedManifestHash(m), m.worlddataHash);
  assert.equal(feedManifestSeq({ bundleSeq: '7' }), null);
  assert.equal(feedManifestSeq(null), null);
  assert.equal(feedManifestHash({ worlddataHash: 'XYZ' }), null);
  assert.equal(feedManifestHash({ worlddataHash: 'A'.repeat(64) }), null, 'uppercase hex is not the publisher\u2019s form');
  assert.equal(feedManifestHash({}), null);
});

test('pollPlan: fetch only on a sequence change against a well-formed manifest', () => {
  const bytes = bundleBytes(8);
  const m = manifestFor(bytes, 8);
  assert.deepEqual(pollPlan({ currentSeq: 8, manifest: m }), { action: 'none', reason: 'unchanged' });
  const plan = pollPlan({ currentSeq: 7, manifest: m });
  assert.equal(plan.action, 'fetch');
  assert.equal(plan.seq, 8);
  assert.equal(plan.expectedHash, m.worlddataHash);
  assert.equal(pollPlan({ currentSeq: 7, manifest: null }).action, 'none');
  assert.equal(pollPlan({ currentSeq: 7, manifest: { bundleSeq: 9 } }).reason, 'manifest-invalid');
  assert.equal(pollPlan({ currentSeq: null, manifest: m }).action, 'fetch', 'no current bundle: adopt whatever verifies');
});

test('sha256Hex matches the independent node:crypto implementation', async () => {
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const bytes = bundleBytes(42, { note: 'cross-check me' });
  assert.equal(await sha256Hex(bytes), nodeSha256(bytes));
});

test('verifyBundleBytes: exact hash or nothing', async () => {
  const bytes = bundleBytes(3);
  assert.equal(await verifyBundleBytes(bytes, nodeSha256(bytes)), true);
  assert.equal(await verifyBundleBytes(bytes, nodeSha256(bundleBytes(4))), false);
  assert.equal(await verifyBundleBytes(bytes, 'not-a-hash'), false);
  assert.equal(await verifyBundleBytes(null, nodeSha256(bytes)), false);
});

test('parseVerifiedBundle: a known schema or nothing', () => {
  assert.equal(parseVerifiedBundle(bundleBytes(5)).bundleSeq, 5);
  assert.equal(parseVerifiedBundle(enc(JSON.stringify({ schema: 'portal.world-data/v9', bundleSeq: 5 }))), null, 'a future schema is rejected, never half-read');
  assert.equal(parseVerifiedBundle(enc('not json at all')), null);
  assert.equal(parseVerifiedBundle(null), null);
});

test('pollOnce: unchanged sequence never fetches the bundle', async () => {
  const bytes = bundleBytes(11);
  let bundleReads = 0;
  const res = await pollOnce({
    currentSeq: 11,
    readManifest: async () => manifestFor(bytes, 11),
    readBundleBytes: async () => { bundleReads += 1; return bytes; },
  });
  assert.deepEqual(res, { adopted: null, reason: 'unchanged' });
  assert.equal(bundleReads, 0, 'the manifest is the only fetch on an unchanged cycle');
});

test('pollOnce: a sequence bump adopts the verified bundle', async () => {
  const bytes = bundleBytes(12);
  const res = await pollOnce({
    currentSeq: 11,
    readManifest: async () => manifestFor(bytes, 12),
    readBundleBytes: async () => bytes,
  });
  assert.equal(res.reason, 'adopted');
  assert.equal(res.adopted.bundleSeq, 12);
});

test('pollOnce POSITIVE CONTROL: a planted mismatch is discarded whole', async () => {
  // The manifest announces seq 13 with the hash of the REAL seq-13
  // bytes; the bundle endpoint serves the PREVIOUS bundle's bytes
  // (the classic stale-object / wrong-object plant). Nothing may be
  // adopted — not the old bundle re-stamped, not a partial read.
  const real13 = bundleBytes(13);
  const stale12 = bundleBytes(12);
  const res = await pollOnce({
    currentSeq: 12,
    readManifest: async () => manifestFor(real13, 13),
    readBundleBytes: async () => stale12,
  });
  assert.deepEqual(res, { adopted: null, reason: 'hash-mismatch' });
  // And a byte-flipped corruption of the right object fares no better.
  const corrupted = Uint8Array.from(real13);
  corrupted[20] = corrupted[20] ^ 0xff;
  const res2 = await pollOnce({
    currentSeq: 12,
    readManifest: async () => manifestFor(real13, 13),
    readBundleBytes: async () => corrupted,
  });
  assert.deepEqual(res2, { adopted: null, reason: 'hash-mismatch' });
});

test('pollOnce: verified bytes that are not a readable bundle are still discarded', async () => {
  const alien = enc(JSON.stringify({ schema: 'portal.world-data/v9', bundleSeq: 14 }));
  const res = await pollOnce({
    currentSeq: 13,
    readManifest: async () => manifestFor(alien, 14),
    readBundleBytes: async () => alien,
  });
  assert.deepEqual(res, { adopted: null, reason: 'bundle-invalid' });
  const wrongSeq = bundleBytes(99);
  const res2 = await pollOnce({
    currentSeq: 13,
    readManifest: async () => manifestFor(wrongSeq, 14),
    readBundleBytes: async () => wrongSeq,
  });
  assert.deepEqual(res2, { adopted: null, reason: 'seq-mismatch' }, 'bytes that verify but are not the manifest\u2019s bundle are not adopted');
});

test('pollOnce: feed failures leave the current bundle untouched', async () => {
  const dead = async () => null;
  assert.deepEqual(await pollOnce({ currentSeq: 3, readManifest: dead, readBundleBytes: dead }), { adopted: null, reason: 'manifest-unavailable' });
  const bytes = bundleBytes(4);
  assert.deepEqual(
    await pollOnce({ currentSeq: 3, readManifest: async () => manifestFor(bytes, 4), readBundleBytes: dead }),
    { adopted: null, reason: 'bundle-unavailable' },
  );
});

test('poll census: app.js wires the poll at the plan cadence, logic owns the decision', () => {
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(src.includes('pollOnce('), 'app.js runs the logic poll');
  assert.ok(src.includes('setInterval(pollTick, POLL_INTERVAL_MS)'), 'the poll runs on the shared cadence constant');
  assert.ok(src.includes('FEED_MANIFEST_URL'), 'the poll reads the feed manifest, not the bundle, each cycle');
  assert.ok(!src.includes('crypto.subtle'), 'hashing lives in logic.mjs, not in the shell');
});
