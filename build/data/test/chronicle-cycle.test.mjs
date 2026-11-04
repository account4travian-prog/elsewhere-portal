// chronicle-cycle.test.mjs — the M6.09 production wrapper: pinned
// paths, pre-flight before bytes, id-dedupe with a stable countedAtSeq,
// the book rebuilt from the streams on disk. Runs in a temp feed dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChronicleCycle } from '../chronicle-cycle.mjs';

async function seedFeed(seq = 500) {
  const dir = await mkdtemp(join(tmpdir(), 'chronicle-cycle-'));
  const bundle = {
    bundleSeq: seq, citizens: [{ name: 'Orrin Lowmarsh' }, { name: 'Atlas Meridian' }],
    ticker: [{
      kind: 'RUIN_EXCAVATED', text: 'Orrin Lowmarsh dug into an old ruin.', utc: '2026-11-03T10:39:00Z',
      placeCode: null, provenance: { route: 'news', fetchedUtc: '2026-11-03T10:55:57Z' },
    }, {
      kind: 'UNSOURCED', text: 'A rumour with no provenance.', utc: '2026-11-03T10:40:00Z', provenance: {},
    }],
  };
  await writeFile(join(dir, 'world-data.json'), JSON.stringify(bundle));
  const counters = {
    schema: 'portal.daily-counters/v1', kind: 'baseline', bookId: 'world-001', bundleSeq: 497,
    date: '2026-11-03', atUtc: '2026-11-03T10:39:48.632Z', counters: { joined: 291 }, deltas: null,
    provenance: { basis: 'baseline-bundle' },
  };
  await writeFile(join(dir, 'daily-counters.jsonl'), JSON.stringify(counters) + '\n');
  const first = {
    schema: 'portal.firsts/v1', kind: 'first-mayor', bookId: 'world-001', date: '2026-10-31', atUtc: null,
    detail: 'Atlas Meridian became the first Mayor of Ember.', subject: { name: 'Atlas Meridian' },
    provenance: { basis: 'record-attested', route: null, source: 'Ledger', citedLine: 'Elected 2026-10-31' },
  };
  await writeFile(join(dir, 'firsts.jsonl'), JSON.stringify(first) + '\n');
  const episodes = {
    schema: 'portal.episodes/v1',
    episodes: [{
      firstUtc: '2026-11-02T09:12:57Z', lastUtc: '2026-11-02T09:49:39Z', place: 'EMBER_PLAZA_OF_UNITY',
      where: 'the Plaza of Unity', participants: ['Nath Borowik'],
      utterances: [{ by: 'Nath Borowik', at: '2026-11-02T09:12:57Z', said: 'Good morning.' }],
    }],
  };
  await writeFile(join(dir, 'episodes.json'), JSON.stringify(episodes));
  return dir;
}

test('first run: baseline + first + sourced headline land; the unsourced headline is rejected by name', async () => {
  const dir = await seedFeed();
  const r = await runChronicleCycle({ feedDir: dir });
  assert.equal(r.appended, 3);
  assert.equal(r.rejectedHeadlines.length, 1);
  assert.equal(r.rejectedHeadlines[0].reason, 'headline-without-provenance');
  const book = JSON.parse(await readFile(join(dir, 'chronicle-book.json'), 'utf8'));
  assert.equal(book.schema, 'portal.chronicle-book/v1');
  assert.equal(book.items.length, 3);
  const headline = book.items.find((i) => i.kind === 'headline');
  assert.equal(headline.countedAtSeq, 500); // stamped at first ingestion
  assert.equal(book.newspaper.quotes.length, 1);
  assert.equal(book.calendar.length, 1);
  assert.equal(book.collectingSince, '2026-11-03');
});

test('second run at a later seq appends nothing and never drifts countedAtSeq', async () => {
  const dir = await seedFeed();
  await runChronicleCycle({ feedDir: dir });
  const bundle = JSON.parse(await readFile(join(dir, 'world-data.json'), 'utf8'));
  bundle.bundleSeq = 505;
  await writeFile(join(dir, 'world-data.json'), JSON.stringify(bundle));
  const r2 = await runChronicleCycle({ feedDir: dir });
  assert.equal(r2.appended, 0);
  const book = JSON.parse(await readFile(join(dir, 'chronicle-book.json'), 'utf8'));
  assert.equal(book.items.find((i) => i.kind === 'headline').countedAtSeq, 500);
  assert.equal(book.throughSeq, 505);
});

test('minutes pointers land counts-only through the optional intake stream', async () => {
  const dir = await seedFeed();
  const row = {
    pointer: {
      kind: 'chronicle-summary-pointer', remainingCount: 3, bySpeaker: [{ name: 'Nath Borowik', count: 3 }],
      firstAt: '2026-11-02T09:30:00Z', lastAt: '2026-11-02T09:40:00Z', text: 'MUST NOT PROPAGATE',
    },
    episodeKey: 'ep-1', placeCode: 'EMBER_PLAZA_OF_UNITY', where: 'the Plaza of Unity',
  };
  await writeFile(join(dir, 'talk-summaries.jsonl'), JSON.stringify(row) + '\n');
  await runChronicleCycle({ feedDir: dir });
  const itemsText = await readFile(join(dir, 'chronicle-items.jsonl'), 'utf8');
  assert.ok(!itemsText.includes('MUST NOT PROPAGATE'));
  const book = JSON.parse(await readFile(join(dir, 'chronicle-book.json'), 'utf8'));
  assert.ok(book.items.some((i) => i.kind === 'minutes' && i.source.remainingCount === 3));
});

test('pre-flight: a malformed bundle throws before any byte is written', async () => {
  const dir = await seedFeed();
  await writeFile(join(dir, 'world-data.json'), '{"bundleSeq":"not-a-number"}');
  await assert.rejects(() => runChronicleCycle({ feedDir: dir }), /WorldData bundle shape/);
  await assert.rejects(() => readFile(join(dir, 'chronicle-book.json'), 'utf8'), /ENOENT/);
});
