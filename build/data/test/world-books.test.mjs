// World-book registry tests (M1.05). Positive control: a synthetic archive
// with a planted CONFIRMED reset must split into two books at the pair
// boundary. Negative control: suspected-only verdicts must NOT split.
// Real-archive check: exactly one open book, chain heads equal to the
// actual tails of the real chain-*.jsonl files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegistry, buildAndWriteRegistry } from '../world-books.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_ARCHIVE = join(HERE, '..', 'archive');

const stampName = (route, iso) => `${route}-${iso.replace(/[-:]/g, '').replace('T', 'T')}.json`;
// iso "2026-11-02T02:07:12Z" -> filename stamp "20261102T020712Z"
const fileStamp = (iso) => iso.replace(/-/g, '').replace(/:/g, '');
const relFile = (route, iso) => `${iso.slice(0, 10)}/${route}-${fileStamp(iso)}.json`;

async function writeSnap(archiveDir, route, iso, body = {}) {
  const rel = relFile(route, iso);
  await mkdir(join(archiveDir, rel.split('/')[0]), { recursive: true });
  await writeFile(join(archiveDir, rel), JSON.stringify(body));
  return rel;
}

async function writeChain(archiveDir, route, snaps) {
  const lines = snaps.map((s, i) => JSON.stringify({
    seq: i + 1, route, file: s.rel, sha256: `hash${route}${i + 1}`,
    prev_hash: i === 0 ? null : `hash${route}${i}`, captured_at: s.iso,
  }));
  await writeFile(join(archiveDir, `chain-${route}.jsonl`), lines.join('\n') + '\n');
}

async function syntheticArchive() {
  const dir = await mkdtemp(join(tmpdir(), 'worldbooks-'));
  const t = ['2026-11-02T02:07:12Z', '2026-11-02T03:07:12Z', '2026-11-03T02:07:12Z', '2026-11-03T03:07:12Z'];
  const snaps = [];
  for (const iso of t) snaps.push({ rel: await writeSnap(dir, 'overview', iso, { population: { joined: 288 } }), iso });
  await writeChain(dir, 'overview', snaps);
  return { dir, snaps };
}

async function writeWatch(dir, entries) {
  await writeFile(join(dir, 'reset-watch.jsonl'),
    entries.map((w) => JSON.stringify(w)).join('\n') + '\n');
}

const verdict = (v, prev, next) => ({
  inspectedAtUtc: '2026-11-03T02:08:00.000Z', verdict: v,
  signals: v === 'confirmed' ? ['joined-collapse', 'clock-rollback'] : ['joined-decrease'],
  evidence: { prev: { file: prev }, next: { file: next } },
});

test('positive control: planted confirmed reset splits the archive into two books at the pair boundary', async () => {
  const { dir, snaps } = await syntheticArchive();
  await writeWatch(dir, [
    verdict('no-reset', snaps[0].rel, snaps[1].rel),
    verdict('confirmed', snaps[1].rel, snaps[2].rel),
  ]);
  const reg = await buildRegistry({ archiveDir: dir });
  assert.equal(reg.books.length, 2);
  const [b1, b2] = reg.books;
  assert.equal(b1.id, 'world-001');
  assert.equal(b1.status, 'closed');
  assert.equal(b1.opened_at, '2026-11-02T02:07:12Z');
  assert.equal(b1.closed_with_file, snaps[1].rel, 'old book ends at evidence.prev');
  assert.equal(b1.snapshot_count, 2);
  assert.equal(b1.chain_heads.overview.seq, 2, 'closed book head is the chain entry at the boundary');
  assert.equal(b1.close_reason.kind, 'reset-confirmed');
  assert.equal(b2.id, 'world-002');
  assert.equal(b2.status, 'open');
  assert.equal(b2.opened_at, '2026-11-03T02:07:12Z', 'new book opens at evidence.next');
  assert.equal(b2.opened_with_file, snaps[2].rel);
  assert.equal(b2.snapshot_count, 2);
  assert.equal(b2.chain_heads.overview.seq, 4);
});

test('negative control: suspected-only verdicts keep one book and land as annotations', async () => {
  const { dir, snaps } = await syntheticArchive();
  await writeWatch(dir, [verdict('suspected', snaps[1].rel, snaps[2].rel)]);
  const reg = await buildRegistry({ archiveDir: dir });
  assert.equal(reg.books.length, 1);
  assert.equal(reg.books[0].status, 'open');
  assert.equal(reg.books[0].snapshot_count, 4);
  assert.equal(reg.books[0].annotations.length, 1);
  assert.equal(reg.books[0].annotations[0].kind, 'suspected-reset');
});

test('idempotent: rebuilding and rewriting produces identical output', async () => {
  const { dir, snaps } = await syntheticArchive();
  await writeWatch(dir, [verdict('confirmed', snaps[1].rel, snaps[2].rel)]);
  const a = await buildAndWriteRegistry({ archiveDir: dir });
  const bytesA = await readFile(join(dir, 'world-books.json'), 'utf8');
  const b = await buildAndWriteRegistry({ archiveDir: dir });
  const bytesB = await readFile(join(dir, 'world-books.json'), 'utf8');
  assert.deepEqual(b, a);
  assert.equal(bytesB, bytesA);
});

test('real archive: exactly one open book; chain heads match the real chain tails', async () => {
  const reg = await buildRegistry({ archiveDir: REAL_ARCHIVE });
  assert.equal(reg.books.length, 1, 'no reset has occurred in the real sequence');
  const book = reg.books[0];
  assert.equal(book.id, 'world-001');
  assert.equal(book.status, 'open');
  assert.equal(book.opened_at, '2026-11-02T02:07:12Z', 'first real snapshot stamp');
  // Independently read each real chain file's tail and compare.
  for (const route of ['overview', 'news', 'voices', 'map', 'status', 'chats']) {
    const text = await readFile(join(REAL_ARCHIVE, `chain-${route}.jsonl`), 'utf8');
    const tail = JSON.parse(text.trim().split('\n').pop());
    assert.deepEqual(book.chain_heads[route],
      { seq: tail.seq, file: tail.file, sha256: tail.sha256 },
      `chain head mismatch on ${route}`);
  }
  assert.ok(book.snapshot_count >= 15, `expected the accumulated real snapshots, got ${book.snapshot_count}`);
});
