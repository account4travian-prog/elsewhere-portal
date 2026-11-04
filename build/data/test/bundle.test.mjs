// Bundle-builder tests against hand-built temp archives (snapshot bodies are
// synthetic miniatures in the real Tier P shapes; see derive.test.mjs note).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'build-bundle.mjs');

async function tempArchive() {
  const root = await mkdtemp(join(tmpdir(), 'portal-bundle-'));
  const archiveDir = join(root, 'archive');
  const feedDir = join(root, 'feed');
  await mkdir(join(archiveDir, '2026-11-02'), { recursive: true });
  const overview = {
    sky: { over_ember: 'CLEAR' }, world_hour: 6, season: 'SPRING', year: 45,
    generated_at: '2026-11-02T02:04:05.000Z',
    frontier: { regions_discovered: 1, regions_surveyed: 2, regions_named: 3 },
    college: { deposits: 4 }, population: { joined: 5 },
    ember: { treasury_bennies: 6, districts: [] },
  };
  await writeFile(join(archiveDir, '2026-11-02', 'overview-20261102T020435Z.json'), JSON.stringify(overview));
  await writeFile(join(archiveDir, '2026-11-02', 'status-20261102T020435Z.json'), JSON.stringify({ online: true, test_world: true, next_reset: null }));
  return { archiveDir, feedDir };
}

test('manifest hash matches the written world-data file bytes', async () => {
  const { archiveDir, feedDir } = await tempArchive();
  const { stdout } = await run('node', [CLI, '--archive', archiveDir, '--feed', feedDir]);
  const manifest = JSON.parse(await readFile(join(feedDir, 'manifest.json'), 'utf8'));
  const bytes = await readFile(join(feedDir, 'world-data.json'));
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(manifest.worlddataHash, digest);
  assert.equal(manifest.schema, 'portal.world-data/v1');
  assert.equal(JSON.parse(stdout).worlddataHash, digest);
  const wd = JSON.parse(bytes.toString('utf8'));
  assert.equal(wd.counters.regionsDiscovered, 1);
  assert.equal(wd.bundleSeq, manifest.bundleSeq);
});

test('bundleSeq increments across builds (persisted via the manifest)', async () => {
  const { archiveDir, feedDir } = await tempArchive();
  await run('node', [CLI, '--archive', archiveDir, '--feed', feedDir]);
  const first = JSON.parse(await readFile(join(feedDir, 'manifest.json'), 'utf8'));
  await run('node', [CLI, '--archive', archiveDir, '--feed', feedDir]);
  const second = JSON.parse(await readFile(join(feedDir, 'manifest.json'), 'utf8'));
  assert.equal(second.bundleSeq, first.bundleSeq + 1);
});

test('plots accumulate within the open world-book only — a closed book plot never leaks', async () => {
  const { archiveDir, feedDir } = await tempArchive();
  const day = join(archiveDir, '2026-11-02');
  const voices = (places) => JSON.stringify({ generated_at: '2026-11-02T00:00:00.000Z', places });
  // Closed book (world-001): a plot evidenced there, before the reset.
  await writeFile(join(day, 'voices-20261102T010000Z.json'), voices([{
    code: 'EMBER_DISTRICT_2_PLOT_9',
    said: [{ by: 'Old World Speaker', at: '2026-11-02T00:59:00.000Z', said: 'before the reset', id: 'o1' }],
  }]));
  // Open book (world-002) opens at 02:00: its first snapshot evidences
  // a plot the head no longer shows (it went quiet)...
  await writeFile(join(day, 'voices-20261102T020000Z.json'), voices([{
    code: 'EMBER_DISTRICT_1_PLOT_7',
    said: [{ by: 'Early Speaker', at: '2026-11-02T01:59:00.000Z', said: 'earlier in this book', id: 'e1' }],
  }]));
  // ...and the head evidences a different plot.
  await writeFile(join(day, 'voices-20261102T030000Z.json'), voices([{
    code: 'EMBER_DISTRICT_1_PLOT_5',
    said: [{ by: 'Head Speaker', at: '2026-11-02T02:59:00.000Z', said: 'right now', id: 'h1' }],
  }]));
  await writeFile(join(archiveDir, 'world-books.json'), JSON.stringify({
    schema: 'portal.world-books/v1',
    books: [
      { id: 'world-001', status: 'closed', first_snapshot: '2026-11-02/voices-20261102T010000Z.json' },
      { id: 'world-002', status: 'open', first_snapshot: '2026-11-02/voices-20261102T020000Z.json' },
    ],
  }));
  await run('node', [CLI, '--archive', archiveDir, '--feed', feedDir]);
  const wd = JSON.parse(await readFile(join(feedDir, 'world-data.json'), 'utf8'));
  const byCode = Object.fromEntries(wd.ember.plots.map((p) => [p.code, p]));
  assert.ok(byCode['EMBER_DISTRICT_1_PLOT_5'], 'head-evidenced plot present');
  assert.equal(byCode['EMBER_DISTRICT_1_PLOT_5'].firstEvidencedUtc, '2026-11-02T03:00:00.000Z');
  assert.ok(byCode['EMBER_DISTRICT_1_PLOT_7'], 'plot evidenced earlier in the open book persists');
  assert.equal(byCode['EMBER_DISTRICT_1_PLOT_7'].firstEvidencedUtc, '2026-11-02T02:00:00.000Z');
  assert.ok(!byCode['EMBER_DISTRICT_2_PLOT_9'], 'closed-book plot must not leak into the new book');
  // Existence persisted; presence did not — the persisted plot has no
  // current speakers in the head-derived citizens.
  assert.ok(!wd.citizens.some((c) => c.placeCode === 'EMBER_DISTRICT_1_PLOT_7'));
});

test('a malformed newest snapshot is skipped for the next-newest valid one', async () => {
  const { archiveDir, feedDir } = await tempArchive();
  await writeFile(join(archiveDir, '2026-11-02', 'overview-20261102T030000Z.json'), '{broken json');
  const { stderr } = await run('node', [CLI, '--archive', archiveDir, '--feed', feedDir]);
  assert.match(stderr, /skipped malformed snapshot/);
  const wd = JSON.parse(await readFile(join(feedDir, 'world-data.json'), 'utf8'));
  assert.equal(wd.counters.regionsDiscovered, 1); // from the older valid snapshot
});
