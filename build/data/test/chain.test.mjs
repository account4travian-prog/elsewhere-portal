// Hash-chain tests: synthetic archives in temp dirs, no network.
// Includes the positive controls the verifier MUST fail:
//   - tampered snapshot byte
//   - reordered chain records
//   - dropped chain record
// plus window-edge recording and edge-gap detection on synthetic bodies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildChains, readChain, verifyChain, detectEdgeGaps, windowEdges, CHAIN_SCHEMA } from '../chain.mjs';

async function makeArchive() {
  const dir = await mkdtemp(join(tmpdir(), 'portal-chain-'));
  const archive = join(dir, 'archive');
  await mkdir(join(archive, '2026-11-02'), { recursive: true });
  await mkdir(join(archive, '2026-11-03'), { recursive: true });
  return archive;
}

async function snap(archive, day, name, body) {
  await writeFile(join(archive, day, name), typeof body === 'string' ? body : JSON.stringify(body));
}

function chatsBody(times) {
  return {
    messages: times.map((at, i) => ({ at, id: `m-${at}`, text: 'x', author: 'a', channel: 'EMBER' })),
    channels: [],
  };
}

test('build chains every snapshot per route, linked by prev_hash, and is idempotent', async () => {
  const archive = await makeArchive();
  await snap(archive, '2026-11-02', 'overview-20261102T020000Z.json', { a: 1 });
  await snap(archive, '2026-11-02', 'overview-20261102T030000Z.json', { a: 2 });
  await snap(archive, '2026-11-03', 'overview-20261103T020000Z.json', { a: 3 });
  await snap(archive, '2026-11-02', 'status-20261102T020000Z.json', { s: 1 });

  const first = await buildChains(archive);
  assert.equal(first.overview.total, 3);
  assert.equal(first.overview.added, 3);
  assert.equal(first.status.total, 1);

  const chainPath = join(archive, 'chain-overview.jsonl');
  const before = await readFile(chainPath, 'utf8');
  const records = await readChain(chainPath);
  assert.equal(records.length, 3);
  assert.equal(records[0].seq, 1);
  assert.equal(records[0].prev_hash, null);
  assert.equal(records[0].captured_at, '2026-11-02T02:00:00Z');
  assert.equal(records[0].file, '2026-11-02/overview-20261102T020000Z.json');
  assert.match(records[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(records[1].prev_hash, records[0].sha256);
  assert.equal(records[2].prev_hash, records[1].sha256);
  // every newly built record carries the chain schema id (portal.chain/v0)
  assert.equal(CHAIN_SCHEMA, 'portal.chain/v0');
  for (const rec of records) assert.equal(rec.schema, 'portal.chain/v0');
  // non-rolling routes carry no window edges
  assert.equal('window_oldest' in records[0], false);

  // Idempotent: a second build adds nothing and changes no bytes.
  const second = await buildChains(archive);
  assert.equal(second.overview.added, 0);
  assert.equal(await readFile(chainPath, 'utf8'), before);

  // Extension: a new snapshot appends exactly one record.
  await snap(archive, '2026-11-03', 'overview-20261103T030000Z.json', { a: 4 });
  const third = await buildChains(archive);
  assert.equal(third.overview.added, 1);
  const extended = await readChain(chainPath);
  assert.equal(extended.length, 4);
  assert.equal(extended[3].prev_hash, extended[2].sha256);
});

test('verifier passes an untampered chain', async () => {
  const archive = await makeArchive();
  await snap(archive, '2026-11-02', 'overview-20261102T020000Z.json', { a: 1 });
  await snap(archive, '2026-11-02', 'overview-20261102T030000Z.json', { a: 2 });
  await buildChains(archive);
  const r = await verifyChain(join(archive, 'chain-overview.jsonl'), archive);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.records, 2);
});

test('POSITIVE CONTROL tampered-byte: verifier fails when a snapshot byte is altered', async () => {
  const archive = await makeArchive();
  const target = join(archive, '2026-11-02', 'overview-20261102T020000Z.json');
  await snap(archive, '2026-11-02', 'overview-20261102T020000Z.json', { a: 1 });
  await snap(archive, '2026-11-02', 'overview-20261102T030000Z.json', { a: 2 });
  await buildChains(archive);
  const raw = await readFile(target, 'utf8');
  await writeFile(target, raw.replace('"a":1', '"a":9')); // one byte differs
  const r = await verifyChain(join(archive, 'chain-overview.jsonl'), archive);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('sha256 mismatch')), r.errors.join('; '));
});

test('POSITIVE CONTROL reordered-records: verifier fails when two chain records swap', async () => {
  const archive = await makeArchive();
  await snap(archive, '2026-11-02', 'overview-20261102T020000Z.json', { a: 1 });
  await snap(archive, '2026-11-02', 'overview-20261102T030000Z.json', { a: 2 });
  await snap(archive, '2026-11-02', 'overview-20261102T040000Z.json', { a: 3 });
  await buildChains(archive);
  const chainPath = join(archive, 'chain-overview.jsonl');
  const lines = (await readFile(chainPath, 'utf8')).trim().split('\n');
  [lines[0], lines[1]] = [lines[1], lines[0]];
  await writeFile(chainPath, lines.join('\n') + '\n');
  const r = await verifyChain(chainPath, archive);
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some((e) => e.includes('seq discontinuity') || e.includes('prev_hash break')),
    r.errors.join('; '),
  );
});

test('POSITIVE CONTROL dropped-record: verifier fails when a middle chain record is removed', async () => {
  const archive = await makeArchive();
  await snap(archive, '2026-11-02', 'overview-20261102T020000Z.json', { a: 1 });
  await snap(archive, '2026-11-02', 'overview-20261102T030000Z.json', { a: 2 });
  await snap(archive, '2026-11-02', 'overview-20261102T040000Z.json', { a: 3 });
  await buildChains(archive);
  const chainPath = join(archive, 'chain-overview.jsonl');
  const lines = (await readFile(chainPath, 'utf8')).trim().split('\n');
  lines.splice(1, 1); // drop seq 2
  await writeFile(chainPath, lines.join('\n') + '\n');
  const r = await verifyChain(chainPath, archive);
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some((e) => e.includes('seq discontinuity') || e.includes('prev_hash break')),
    r.errors.join('; '),
  );
});

test('rolling routes record window edges from the body', async () => {
  const archive = await makeArchive();
  await snap(archive, '2026-11-02', 'chats-20261102T020000Z.json',
    chatsBody(['2026-11-01T10:00:00Z', '2026-11-01T12:00:00Z', '2026-11-02T01:00:00Z']));
  await snap(archive, '2026-11-02', 'news-20261102T020000Z.json', {
    headlines: [
      { at: '2026-11-02T01:30:00Z', id: 'h2', kind: 'x' },
      { at: '2026-11-01T22:00:00Z', id: 'h1', kind: 'x' },
    ],
  });
  await buildChains(archive);
  const chats = await readChain(join(archive, 'chain-chats.jsonl'));
  assert.deepEqual(chats[0].window_oldest, { at: '2026-11-01T10:00:00Z', id: 'm-2026-11-01T10:00:00Z' });
  assert.deepEqual(chats[0].window_newest, { at: '2026-11-02T01:00:00Z', id: 'm-2026-11-02T01:00:00Z' });
  const news = await readChain(join(archive, 'chain-news.jsonl'));
  assert.deepEqual(news[0].window_oldest, { at: '2026-11-01T22:00:00Z', id: 'h1' });
  assert.deepEqual(news[0].window_newest, { at: '2026-11-02T01:30:00Z', id: 'h2' });
  // and the verifier agrees with the recorded edges
  const r = await verifyChain(join(archive, 'chain-chats.jsonl'), archive);
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('a rolling body without usable edges records null edges, not a crash', async () => {
  const edges = windowEdges('news', { hall: { entries: [] } });
  assert.equal(edges.oldest, null);
  assert.equal(edges.newest, null);
  const archive = await makeArchive();
  await snap(archive, '2026-11-02', 'news-20261102T020000Z.json', { hall: { entries: [] } });
  await buildChains(archive);
  const news = await readChain(join(archive, 'chain-news.jsonl'));
  assert.equal(news[0].window_oldest, null);
  assert.equal(news[0].window_newest, null);
});

test('edge gap is detected between synthetic polls whose windows do not overlap', async () => {
  const archive = await makeArchive();
  // Poll 1 window ends 2026-11-02T01:00Z; poll 2 window starts 2026-11-02T05:00Z:
  // anything posted 01:00-05:00 that scrolled off is provably unseen.
  await snap(archive, '2026-11-02', 'chats-20261102T020000Z.json',
    chatsBody(['2026-11-01T20:00:00Z', '2026-11-02T01:00:00Z']));
  await snap(archive, '2026-11-02', 'chats-20261102T060000Z.json',
    chatsBody(['2026-11-02T05:00:00Z', '2026-11-02T05:30:00Z']));
  // Poll 3 overlaps poll 2 (starts before poll 2's newest): no gap.
  await snap(archive, '2026-11-02', 'chats-20261102T070000Z.json',
    chatsBody(['2026-11-02T05:15:00Z', '2026-11-02T06:45:00Z']));
  await buildChains(archive);
  const records = await readChain(join(archive, 'chain-chats.jsonl'));
  const gaps = detectEdgeGaps(records);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].after_seq, 1);
  assert.equal(gaps[0].before_seq, 2);
  assert.equal(gaps[0].prev_window_newest.at, '2026-11-02T01:00:00Z');
  assert.equal(gaps[0].next_window_oldest.at, '2026-11-02T05:00:00Z');
  // verifyChain surfaces the same gap without failing integrity
  const r = await verifyChain(join(archive, 'chain-chats.jsonl'), archive);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.edge_gaps.length, 1);
});

// Rewrite a chain file with each record passed through fn (parsed JSON in,
// object or null out; null drops the line). Used to simulate pre-declaration
// records and schema tampering without touching snapshot bytes or hashes —
// the schema field is record metadata, never a hash input.
async function rewriteChain(chainPath, fn) {
  const lines = (await readFile(chainPath, 'utf8')).trim().split('\n');
  const out = [];
  for (const line of lines) {
    const rec = fn(JSON.parse(line));
    if (rec) out.push(JSON.stringify(rec));
  }
  await writeFile(chainPath, out.join('\n') + '\n');
}

test('mixed chain verifies: pre-declaration records without schema, later records carrying it', async () => {
  const archive = await makeArchive();
  await snap(archive, '2026-11-02', 'overview-20261102T020000Z.json', { a: 1 });
  await snap(archive, '2026-11-02', 'overview-20261102T030000Z.json', { a: 2 });
  await buildChains(archive);
  const chainPath = join(archive, 'chain-overview.jsonl');
  // Simulate the pre-declaration era: strip the schema field from the
  // records that already exist (exactly how the real chains look).
  await rewriteChain(chainPath, (rec) => {
    delete rec.schema;
    return rec;
  });
  let records = await readChain(chainPath);
  assert.equal(records.length, 2);
  assert.equal('schema' in records[0], false);
  assert.equal('schema' in records[1], false);
  // A new snapshot extends the chain; only the new record carries the field.
  await snap(archive, '2026-11-03', 'overview-20261103T020000Z.json', { a: 3 });
  const ext = await buildChains(archive);
  assert.equal(ext.overview.added, 1);
  records = await readChain(chainPath);
  assert.equal(records.length, 3);
  assert.equal('schema' in records[0], false);
  assert.equal('schema' in records[1], false);
  assert.equal(records[2].schema, 'portal.chain/v0');
  const r = await verifyChain(chainPath, archive);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.records, 3);
});

test('POSITIVE CONTROL wrong-schema: verifier fails a record claiming portal.chain/v9, by name', async () => {
  const archive = await makeArchive();
  await snap(archive, '2026-11-02', 'overview-20261102T020000Z.json', { a: 1 });
  await snap(archive, '2026-11-02', 'overview-20261102T030000Z.json', { a: 2 });
  await buildChains(archive);
  const chainPath = join(archive, 'chain-overview.jsonl');
  await rewriteChain(chainPath, (rec) => (rec.seq === 2 ? { ...rec, schema: 'portal.chain/v9' } : rec));
  const r = await verifyChain(chainPath, archive);
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some((e) => e.includes('schema mismatch') && e.includes('portal.chain/v9')),
    r.errors.join('; '),
  );
});

test('POSITIVE CONTROL dropped-schema: verifier fails when a post-declaration record drops the field', async () => {
  const archive = await makeArchive();
  await snap(archive, '2026-11-02', 'overview-20261102T020000Z.json', { a: 1 });
  await snap(archive, '2026-11-02', 'overview-20261102T030000Z.json', { a: 2 });
  await snap(archive, '2026-11-02', 'overview-20261102T040000Z.json', { a: 3 });
  await buildChains(archive);
  const chainPath = join(archive, 'chain-overview.jsonl');
  // Records 1-2 keep the field; record 3 (post-declaration) loses it.
  await rewriteChain(chainPath, (rec) => {
    if (rec.seq === 3) delete rec.schema;
    return rec;
  });
  const r = await verifyChain(chainPath, archive);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('schema missing')), r.errors.join('; '));
});
