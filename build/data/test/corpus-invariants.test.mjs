// corpus-invariants.test.mjs — M3.05: the full-corpus invariant run,
// the stuck-actor check, and the health flag.
//
// The fixture is a miniature archive with a hand-computable record:
//   Mover Mae    speaks at the Plaza (00:30), the College (02:30),
//                the Townhall (06:00) -> two legs, both over-long.
//   Stayer Sam   speaks twice, always at the Plaza -> stayed-put,
//                explicitly NOT a stuck suspect.
//   Frontier Fran speaks at a frontier cell, then the Plaza -> one
//                leg, excluded off-graph (place not in the layout).
//   Quiet Quinn  is on the news roster and never speaks -> the one
//                stuck SUSPECT (a question, not an accusation).
// The fetch log gives the voices route unbroken 120 s coverage, so
// M3.01's coverage ceiling admits Mae's legs: the reconstructed set
// is exercised for real, not mocked.
//
// POSITIVE CONTROL at corpus scale: the report's own mutant control
// must catch the teleporting mutant on every applicable journey in
// BOTH sets; a second test runs the mutant directly over a
// fixture-built journey through the shared checker.
//
// Run: node --test test/corpus-invariants.test.mjs   (from build/data/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadEvidenceCorpus,
  evidenceJourneys,
  stuckActorCheck,
  buildCorpusReport,
  invariantsHealthSection,
} from '../corpus-invariants.mjs';
import { buildHealth } from '../health.mjs';
import { checkContinuity, mutantPositionAt } from '../../engine/invariant.mjs';

const layout = JSON.parse(
  await readFile(new URL('../../shared/ember-layout.json', import.meta.url), 'utf8'),
);
const cadencePath = new URL('../cadence.json', import.meta.url).pathname;

const said = (id, by, at) => ({ id, by, at, said: 'fixture words' });
const voicesSnap = (rows) => ({
  places: rows.map(([code, list]) => ({ code, cut: false, cell: null, said: list })),
});

async function fixtureArchive() {
  const root = await mkdtemp(join(tmpdir(), 'portal-corpus-'));
  const archive = join(root, 'archive');
  const day = join(archive, '2026-11-02');
  await mkdir(day, { recursive: true });

  const u1 = said('u1', 'Mover Mae', '2026-11-02T00:30:00Z');
  const u2 = said('u2', 'Stayer Sam', '2026-11-02T00:31:00Z');
  const u3 = said('u3', 'Stayer Sam', '2026-11-02T02:00:00Z');
  const u4 = said('u4', 'Mover Mae', '2026-11-02T02:30:00Z');
  const u5 = said('u5', 'Frontier Fran', '2026-11-02T02:45:00Z');
  const u6 = said('u6', 'Frontier Fran', '2026-11-02T02:50:00Z');
  const u7 = said('u7', 'Mover Mae', '2026-11-02T06:00:00Z');

  const snap1 = voicesSnap([
    ['EMBER_PLAZA_OF_UNITY', [u1, u2]],
    ['EMBER_COLLEGE', []],
  ]);
  const snap2 = voicesSnap([
    ['EMBER_PLAZA_OF_UNITY', [u1, u2, u3, u6]],
    ['EMBER_COLLEGE', [u4]],
    ['STELLAR_E00_S04', [u5]],
  ]);
  const snap3 = voicesSnap([
    ['EMBER_PLAZA_OF_UNITY', [u1, u2, u3, u6]],
    ['EMBER_COLLEGE', [u4]],
    ['STELLAR_E00_S04', [u5]],
    ['EMBER_TOWNHALL', [u7]],
  ]);
  await writeFile(join(day, 'voices-20261102T010000Z.json'), JSON.stringify(snap1));
  await writeFile(join(day, 'voices-20261102T030000Z.json'), JSON.stringify(snap2));
  await writeFile(join(day, 'voices-20261102T070000Z.json'), JSON.stringify(snap3));

  const news = {
    residents: [
      { handle: 'Quiet Quinn', latest: { at: '2026-11-01T20:00:00Z' }, events: [] },
      { handle: 'Stayer Sam', latest: { at: '2026-11-02T00:31:00Z' }, events: [] },
    ],
  };
  await writeFile(join(day, 'news-20261102T010000Z.json'), JSON.stringify(news));

  const books = {
    schema: 'portal.world-books/v1',
    books: [{
      id: 'world-fixture',
      status: 'open',
      opened_at: '2026-11-02T00:00:00Z',
      opened_with_file: '2026-11-02/overview-20261102T000000Z.json',
      first_snapshot: '2026-11-02/overview-20261102T000000Z.json',
      closed_at: null,
    }],
  };
  await writeFile(join(archive, 'world-books.json'), JSON.stringify(books));

  // Unbroken voices coverage at the 120 s cadence, 00:00 -> 07:00 —
  // M3.01's ceiling (no fetch silence > 240 s across an evidence
  // window) is honestly met, not arranged around.
  const lines = [];
  for (let s = 0; s <= 7 * 3600; s += 120) {
    const utc = new Date(Date.parse('2026-11-02T00:00:00Z') + s * 1000).toISOString();
    lines.push(JSON.stringify({ route: 'voices', utc, status: 200 }));
  }
  await writeFile(join(archive, 'fetch-log.jsonl'), lines.join('\n') + '\n');
  return archive;
}

test('corpus load: the fixture record unions by utterance id', async () => {
  const archive = await fixtureArchive();
  const corpus = await loadEvidenceCorpus({ archiveDir: archive });
  assert.equal(corpus.book.id, 'world-fixture');
  assert.equal(corpus.voicesSnapshots.length, 3);
  assert.equal(corpus.newsSnapshots.length, 1);
  assert.equal(corpus.utterancesById.size, 7); // u1..u7, rolling repeats counted once
  assert.equal(corpus.streams.size, 3);
  assert.equal(corpus.roster.size, 4); // + Quiet Quinn from the news roster
});

test('evidence journeys: legs walked on-graph, frontier leg excluded with its reason', async () => {
  const archive = await fixtureArchive();
  const corpus = await loadEvidenceCorpus({ archiveDir: archive });
  const { journeys, exclusions, legsTotal } = evidenceJourneys(corpus, layout);
  assert.equal(legsTotal, 3); // Mae x2, Fran x1; Sam never moves
  assert.equal(journeys.length, 1);
  assert.equal(journeys[0].citizen, 'Mover Mae');
  assert.equal(journeys[0].legs, 2);
  assert.deepEqual(
    journeys[0].journey.path,
    ['EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE', 'EMBER_TOWNHALL'],
  );
  assert.deepEqual(exclusions, [
    { citizen: 'Frontier Fran', from: 'STELLAR_E00_S04', to: 'EMBER_PLAZA_OF_UNITY', reason: 'place-not-in-layout' },
  ]);
});

test('stuck-actor check: the silent roster name is a suspect; the stayer is not', async () => {
  const archive = await fixtureArchive();
  const corpus = await loadEvidenceCorpus({ archiveDir: archive });
  const stuck = stuckActorCheck(corpus);
  assert.deepEqual(stuck.suspects.map((s) => s.name), ['Quiet Quinn']);
  assert.match(stuck.suspects[0].basis, /question, not an accusation/);
  assert.deepEqual(stuck.stayedPutNames, ['Stayer Sam']);
  assert.ok(stuck.windowHours > 0);
});

test('corpus report: invariant green, mutant caught at corpus scale, counts exact', async () => {
  const archive = await fixtureArchive();
  const report = await buildCorpusReport({
    archiveDir: archive,
    layout,
    now: new Date('2026-11-02T08:00:00Z'),
  });
  assert.equal(report.schema, 'portal.invariants/v1');
  assert.equal(report.corpus.utterances, 7);
  assert.equal(report.corpus.citizensKnown, 4);
  // Evidence paths: the full checker over the fixture journeys.
  assert.equal(report.evidencePaths.checked, 1);
  assert.equal(report.evidencePaths.violations.count, 0);
  assert.equal(report.evidencePaths.mutantControl.applicable, 1);
  assert.equal(report.evidencePaths.mutantControl.caught, 1);
  // Reconstructed (M3.01 integration): Mae's covered legs reconstruct.
  assert.ok(report.reconstructed.journeysInArtefact >= 1, 'M3.01 reconstructed at least one fixture journey');
  assert.equal(report.reconstructed.violations.count, 0);
  assert.equal(
    report.reconstructed.mutantControl.caught,
    report.reconstructed.mutantControl.applicable,
  );
  // Over-long beats: both of Mae's legs exceed 120 ticks.
  assert.equal(report.overLongBeats.count, 2);
  assert.equal(report.overLongBeats.thresholdTicks, 120);
  // Stuck: exactly Quinn.
  assert.deepEqual(report.stuckActors.suspects.map((s) => s.name), ['Quiet Quinn']);
});

test('POSITIVE CONTROL: the mutant teleports on a fixture-built journey and is caught', async () => {
  const archive = await fixtureArchive();
  const corpus = await loadEvidenceCorpus({ archiveDir: archive });
  const { journeys } = evidenceJourneys(corpus, layout);
  const violations = checkContinuity(mutantPositionAt, journeys[0].journey, layout);
  assert.ok(violations.length > 0, 'mutant passed a corpus-built journey — the harness is broken');
});

test('health flag: the invariants section surfaces in health.json; absent report reads null', async () => {
  const archive = await fixtureArchive();
  const before = await buildHealth({ archiveDir: archive, cadencePath, feedDir: null, now: new Date('2026-11-02T08:00:00Z') });
  assert.equal(before.invariants, null);

  const report = await buildCorpusReport({
    archiveDir: archive,
    layout,
    now: new Date('2026-11-02T08:00:00Z'),
  });
  await writeFile(join(archive, 'invariants.json'), JSON.stringify(report, null, 2) + '\n');

  const after = await buildHealth({ archiveDir: archive, cadencePath, feedDir: null, now: new Date('2026-11-02T08:05:00Z') });
  const section = invariantsHealthSection(report);
  assert.deepEqual(after.invariants, section);
  assert.equal(after.invariants.violations, 0);
  assert.equal(after.invariants.stuckSuspects, 1);
  assert.equal(after.invariants.generatedAtUtc, '2026-11-02T08:00:00.000Z');
  assert.ok(after.invariants.journeysChecked >= 2); // Mae's evidence path + reconstructed
});
