// Reset-detection tests. Synthetic snapshot pairs in the real shapes.
// The planted reset MUST be caught (positive control); normal population
// growth MUST NOT fire (negative control).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectPair, runWatch } from '../reset-detect.mjs';

const overview = ({ joined = 288, year = 45, day = 120 } = {}) => ({
  year, season: 'SPRING', day_of_season: day,
  population: { joined, connected: 'a few', active_this_week: 'scores' },
});
const status = ({ nextReset = null, testWorld = true } = {}) => ({ online: true, test_world: testWorld, next_reset: nextReset });
const pair = (p, n, ps = status(), ns = status()) => inspectPair(
  { overview: p, status: ps, file: 'prev.json' },
  { overview: n, status: ns, file: 'next.json' },
);

test('POSITIVE CONTROL: a planted reset is caught and confirmed', () => {
  // World wiped: joined collapses 288 → 3, year rolls back 45 → 1, and the
  // previously announced next_reset has been consumed.
  const r = pair(
    overview({ joined: 288, year: 45, day: 200 }), overview({ joined: 3, year: 1, day: 1 }),
    status({ nextReset: '2026-11-05T00:00:00Z' }), status({ nextReset: null }),
  );
  assert.equal(r.verdict, 'confirmed');
  const kinds = r.signals.map((s) => s.kind);
  assert.ok(kinds.includes('joined-collapse'), kinds.join(','));
  assert.ok(kinds.includes('clock-rollback'), kinds.join(','));
  assert.ok(kinds.includes('nextreset-consumed'), kinds.join(','));
});

test('NEGATIVE CONTROL: normal population growth does not fire', () => {
  const r = pair(overview({ joined: 288, day: 120 }), overview({ joined: 291, day: 121 }));
  assert.equal(r.verdict, 'no-reset');
  assert.equal(r.signals.length, 0);
});

test('a quiet pair with only the clock advancing does not fire', () => {
  const r = pair(overview({ joined: 288, day: 120 }), overview({ joined: 288, day: 121 }));
  assert.equal(r.verdict, 'no-reset');
});

test('joined collapse alone (no other signal) is suspected, not confirmed', () => {
  const r = pair(overview({ joined: 288, year: 45, day: 120 }), overview({ joined: 40, year: 45, day: 121 }));
  assert.equal(r.verdict, 'suspected');
});

test('one strong signal plus a consumed next_reset confirms', () => {
  const r = pair(
    overview({ joined: 288, year: 45, day: 120 }), overview({ joined: 288, year: 44, day: 300 }),
    status({ nextReset: '2026-11-05T00:00:00Z' }), status({ nextReset: null }),
  );
  assert.equal(r.verdict, 'confirmed');
});

test('a small joined decrease alone is suspected (joined never decreases normally)', () => {
  const r = pair(overview({ joined: 288, day: 120 }), overview({ joined: 285, day: 121 }));
  assert.equal(r.verdict, 'suspected');
  assert.equal(r.signals[0].kind, 'joined-decrease');
});

test('an announced reset is noted as info and does not change the verdict', () => {
  const r = pair(
    overview({ joined: 288, day: 120 }), overview({ joined: 290, day: 121 }),
    status({ nextReset: null }), status({ nextReset: '2026-12-01T00:00:00Z' }),
  );
  assert.equal(r.verdict, 'no-reset');
  assert.equal(r.signals[0].kind, 'nextreset-announced');
});

test('missing fields degrade to no-signal, never to a verdict', () => {
  const r = pair({}, {});
  assert.equal(r.verdict, 'no-reset');
  assert.equal(r.evidence.prev.joined, null);
});

test('runWatch writes findings once and pairs each overview with the status at or before it', async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), 'portal-reset-'));
  const day = join(archiveDir, '2026-11-02');
  await mkdir(day, { recursive: true });
  const put = (name, body) => writeFile(join(day, name), JSON.stringify(body), 'utf8');
  await put('overview-20261102T000000Z.json', overview({ joined: 288, day: 120 }));
  await put('status-20261102T000000Z.json', status({ nextReset: '2026-11-05T00:00:00Z' }));
  await put('overview-20261102T010000Z.json', overview({ joined: 2, year: 1, day: 1 }));
  await put('status-20261102T010000Z.json', status({ nextReset: null }));
  const watchFile = join(archiveDir, 'reset-watch.jsonl');
  const first = await runWatch({ archiveDir, watchFile });
  assert.equal(first.length, 1);
  assert.equal(first[0].verdict, 'confirmed');
  const lines = (await readFile(watchFile, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
  const second = await runWatch({ archiveDir, watchFile }); // idempotent
  assert.equal(second.length, 0);
});
