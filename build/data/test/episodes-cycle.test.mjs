// Episodes-cycle tests: the companion CLI that turns the archive head
// into feed/episodes.json (M4 talk surface, data half).
//
// Fixture discipline: a throwaway archive holding copies of the real
// Wave 1 snapshots (2026-11-02) — the same payloads episodes.test.mjs
// asserts against — so the head the cycle sees is the real record,
// including the original College lecture (18 utterances, 3 speakers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEpisodes, runEpisodesCycle } from '../episodes-cycle.mjs';
import { ACTS_DISCLOSURE, DISCLOSURE } from '../episodes.mjs';

const SRC_DAY = new URL('../archive/2026-11-02/', import.meta.url);
const VOICES_FILE = 'voices-20261102T020714Z.json';
const NEWS_FILE = 'news-20261102T020713Z.json';

function fixtureArchive() {
  const root = mkdtempSync(join(tmpdir(), 'portal-episodes-cycle-'));
  const archiveDir = join(root, 'archive');
  mkdirSync(join(archiveDir, '2026-11-02'), { recursive: true });
  copyFileSync(new URL(VOICES_FILE, SRC_DAY), join(archiveDir, '2026-11-02', VOICES_FILE));
  copyFileSync(new URL(NEWS_FILE, SRC_DAY), join(archiveDir, '2026-11-02', NEWS_FILE));
  return { root, archiveDir, feedDir: join(root, 'feed') };
}

const sourceVoices = JSON.parse(readFileSync(new URL(VOICES_FILE, SRC_DAY), 'utf8'));

test('real head: the cycle produces the College episode with its disclosure and recorded words', async () => {
  const { archiveDir, feedDir } = fixtureArchive();
  const { doc, target } = await runEpisodesCycle({ archiveDir, feedDir });
  assert.equal(doc.schema, 'portal.episodes/v1');
  assert.deepEqual(doc.generatedFrom, {
    voicesFile: `2026-11-02/${VOICES_FILE}`,
    newsFile: `2026-11-02/${NEWS_FILE}`,
  });
  const onDisk = JSON.parse(readFileSync(target, 'utf8'));
  assert.deepEqual(onDisk, doc);

  const college = doc.episodes.find((e) => e.place === 'EMBER_COLLEGE');
  assert.ok(college, 'expected the College episode');
  assert.equal(college.disclosure, DISCLOSURE);
  assert.equal(college.corroborated, true);
  assert.deepEqual(
    [...college.participants].sort(),
    ['Atlas Meridian', 'Nath Between', 'Nath Borowik'],
  );
  // The episode carries its utterances for talk playback: all 18, in
  // recorded order, words VERBATIM (fence markers as the record
  // carries them).
  assert.equal(college.utterances.length, 18);
  assert.equal(college.utterances.length, college.utteranceCount);
  const sourceSaid = sourceVoices.places
    .find((p) => p.code === 'EMBER_COLLEGE').said
    .slice()
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  assert.deepEqual(college.utterances.map((u) => u.said), sourceSaid.map((u) => u.said));
  assert.deepEqual(college.utterances.map((u) => u.by), sourceSaid.map((u) => u.by));
  assert.deepEqual(college.utterances.map((u) => u.at), sourceSaid.map((u) => u.at));
  const closing = college.utterances[college.utterances.length - 1];
  assert.match(closing.said, /^<<ELSEWHERE_UNTRUSTED_/); // fence carried, not stripped
  // Every episode in the feed carries the disclosure and its words.
  for (const ep of doc.episodes) {
    assert.equal(ep.disclosure, DISCLOSURE);
    assert.equal(ep.utterances.length, ep.utteranceCount);
  }
  // Act sequences ride along, acts-only.
  const orrin = doc.actSequences.find((s) => s.actor === 'Orrin Lowmarsh');
  assert.ok(orrin);
  assert.equal(orrin.count, 17);
  assert.equal(orrin.disclosure, ACTS_DISCLOSURE);
});

test('unchanged head: a second run writes identical bytes (idempotent, deterministic)', async () => {
  const { root, archiveDir } = fixtureArchive();
  const out1 = join(root, 'one', 'episodes.json');
  const out2 = join(root, 'two', 'episodes.json');
  await runEpisodesCycle({ archiveDir, feedDir: join(root, 'one'), outFile: out1 });
  const first = readFileSync(out1);
  await runEpisodesCycle({ archiveDir, feedDir: join(root, 'two'), outFile: out2 });
  assert.deepEqual(readFileSync(out2), first);
  // Re-running over the same target also leaves identical bytes.
  await runEpisodesCycle({ archiveDir, feedDir: join(root, 'one'), outFile: out1 });
  assert.deepEqual(readFileSync(out1), first);
  // And the pure builder agrees with itself.
  const a = await buildEpisodes({ archiveDir });
  const b = await buildEpisodes({ archiveDir });
  assert.equal(a.bytes, b.bytes);
  assert.equal(a.bytes, first.toString('utf8'));
});

test('atomic write: no temp files are left in the feed dir', async () => {
  const { archiveDir, feedDir } = fixtureArchive();
  await runEpisodesCycle({ archiveDir, feedDir });
  assert.ok(existsSync(join(feedDir, 'episodes.json')));
  assert.deepEqual(readdirSync(feedDir).filter((f) => f.includes('.tmp-')), []);
});
