// journeys-cycle tests: the companion CLI that turns the archive into
// feed/journeys.json (M3.01). Fixture discipline mirrors
// episodes-cycle.test.mjs: a throwaway archive in the real shapes —
// fetch log, world-books registry, cadence-era voices snapshots — so
// the cycle's book scoping and coverage reading are exercised end to
// end, not mocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildJourneys, runJourneysCycle } from '../journeys-cycle.mjs';
import { JOURNEY_DISCLOSURE, JOURNEY_SCHEMA } from '../journeys.mjs';

const DAY = '2026-11-03';
const OPENED = '2026-11-03T00:00:00Z';

function voicesFile(places) {
  return JSON.stringify({
    generated_at: '2026-11-03T00:40:00.000Z',
    places: Object.entries(places).map(([code, rows]) => ({
      code,
      said: rows.map(([by, at, id]) => ({ by, at, id, said: 'words' })),
    })),
  });
}

// A fixture archive: fetches every 120 s from 00:00 to 00:40 (all
// status 200), an open book whose first snapshot is the 00:00 voices
// file, and two voices snapshots — the second carries the move.
function fixtureArchive({ moved = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'portal-journeys-cycle-'));
  const archiveDir = join(root, 'archive');
  mkdirSync(join(archiveDir, DAY), { recursive: true });

  const firstFile = `${DAY}/voices-20261103T000000Z.json`;
  const secondFile = `${DAY}/voices-20261103T004000Z.json`;
  writeFileSync(join(archiveDir, firstFile), voicesFile({
    EMBER_TOWNHALL: [['Test Person', '2026-11-03T00:10:00.000Z', 'u1'], ['Test Person', '2026-11-03T00:20:00.000Z', 'u2']],
  }));
  writeFileSync(join(archiveDir, secondFile), voicesFile(moved
    ? {
        EMBER_TOWNHALL: [['Test Person', '2026-11-03T00:20:00.000Z', 'u2']],
        EMBER_COLLEGE: [['Test Person', '2026-11-03T00:35:00.000Z', 'u3']],
      }
    : {
        EMBER_TOWNHALL: [['Test Person', '2026-11-03T00:20:00.000Z', 'u2'], ['Test Person', '2026-11-03T00:38:00.000Z', 'u9']],
      }));

  const log = [];
  for (let m = 0; m <= 40; m += 2) {
    const stamp = `2026-11-03T00:${String(m).padStart(2, '0')}:00.500Z`;
    const file = m === 0 ? firstFile : (m === 40 ? secondFile : firstFile);
    log.push(JSON.stringify({
      route: 'voices', utc: stamp, status: 200, bytes: 100,
      snapshotId: `snap_${m}`, file,
    }));
  }
  writeFileSync(join(archiveDir, 'fetch-log.jsonl'), log.join('\n') + '\n');
  writeFileSync(join(archiveDir, 'world-books.json'), JSON.stringify({
    schema: 'portal.world-books/v1',
    books: [{
      id: 'world-test', status: 'open', opened_at: OPENED,
      opened_with_file: `${DAY}/overview-20261103T000000Z.json`,
      first_snapshot: `${DAY}/overview-20261103T000000Z.json`,
      closed_at: null,
    }],
  }));
  return { root, archiveDir, feedDir: join(root, 'feed') };
}

test('cycle: the golden window reconstructs exactly one journey into feed/journeys.json', async () => {
  const { archiveDir, feedDir } = fixtureArchive();
  const { doc, target } = await runJourneysCycle({ archiveDir, feedDir });
  assert.equal(doc.schema, JOURNEY_SCHEMA);
  assert.equal(doc.bookId, 'world-test');
  assert.equal(doc.tickEpochUtc, OPENED);
  assert.equal(doc.ceiling.maxEvidenceGapMs, 240_000); // GAP_FACTOR 2 x voices 120 s, from cadence.json
  assert.equal(doc.journeys.length, 1);
  const j = doc.journeys[0];
  assert.equal(j.citizenKey, 'portal-key:test-person');
  assert.deepEqual(j.path, ['EMBER_TOWNHALL', 'EMBER_COLLEGE']);
  assert.equal(j.departureUtc, '2026-11-03T00:20:00.000Z');
  assert.equal(j.arrivalUtc, '2026-11-03T00:35:00.000Z');
  assert.equal(j.disclosure, JOURNEY_DISCLOSURE);
  assert.equal(j.evidence.departureSnapshotFile, `${DAY}/voices-20261103T000000Z.json`);
  assert.equal(j.evidence.arrivalSnapshotFile, `${DAY}/voices-20261103T004000Z.json`);
  const onDisk = JSON.parse(readFileSync(target, 'utf8'));
  assert.deepEqual(onDisk, doc);
});

test('cycle: the vanish window reconstructs no journey', async () => {
  const { archiveDir, feedDir } = fixtureArchive({ moved: false });
  const { doc } = await runJourneysCycle({ archiveDir, feedDir });
  assert.equal(doc.stats.candidateLegs, 0);
  assert.equal(doc.journeys.length, 0);
});

test('cycle: unchanged archive -> identical bytes on re-run; no temp files left', async () => {
  const { root, archiveDir } = fixtureArchive();
  const out1 = join(root, 'one', 'journeys.json');
  const out2 = join(root, 'two', 'journeys.json');
  await runJourneysCycle({ archiveDir, feedDir: join(root, 'one'), outFile: out1 });
  const first = readFileSync(out1);
  await runJourneysCycle({ archiveDir, feedDir: join(root, 'two'), outFile: out2 });
  assert.deepEqual(readFileSync(out2), first);
  await runJourneysCycle({ archiveDir, feedDir: join(root, 'one'), outFile: out1 });
  assert.deepEqual(readFileSync(out1), first);
  const a = await buildJourneys({ archiveDir });
  const b = await buildJourneys({ archiveDir });
  assert.equal(a.bytes, b.bytes);
  assert.equal(a.bytes, first.toString('utf8'));
  assert.ok(existsSync(out1));
  assert.deepEqual(readdirSync(join(root, 'one')).filter((f) => f.includes('.tmp-')), []);
});

test('cycle: a closed-book snapshot is never evidence (book scoping)', async () => {
  const { archiveDir, feedDir } = fixtureArchive();
  // A voices snapshot stamped BEFORE the book's first snapshot (a
  // closed book's file) carrying a destination utterance must not
  // create a journey.
  const oldDir = join(archiveDir, '2026-11-02');
  mkdirSync(oldDir, { recursive: true });
  writeFileSync(join(oldDir, 'voices-20261102T235900Z.json'), voicesFile({
    EMBER_COLLEGE: [['Test Person', '2026-11-02T23:59:00.000Z', 'u0']],
  }));
  const { doc } = await runJourneysCycle({ archiveDir, feedDir });
  assert.equal(doc.generatedFrom.voicesSnapshotCount, 2); // the two in-book snapshots only
  assert.equal(doc.journeys.length, 1); // still exactly the in-book golden journey
  assert.equal(doc.journeys[0].arrivalUtc, '2026-11-03T00:35:00.000Z');
});

test('cycle: no open world-book -> loud failure, nothing written', async () => {
  const { archiveDir, feedDir } = fixtureArchive();
  writeFileSync(join(archiveDir, 'world-books.json'), JSON.stringify({ schema: 'portal.world-books/v1', books: [] }));
  await assert.rejects(() => runJourneysCycle({ archiveDir, feedDir }), /no open world-book/);
  assert.equal(existsSync(join(feedDir, 'journeys.json')), false);
});
