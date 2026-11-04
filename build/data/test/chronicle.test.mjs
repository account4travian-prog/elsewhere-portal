// chronicle.test.mjs — the M6.09 pure Chronicle engine: the four
// admitted sources and no fifth, headline rejection, the counts-only
// minutes law, falls worded as falls, the calendar removal law, and
// the provenance checker. Synthetic inputs throughout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCalendar,
  buildChronicleBook,
  buildNewspaper,
  itemFromFirst,
  itemFromHeadline,
  itemFromSummaryPointer,
  itemsFromCountersLine,
  provenanceCheck,
  withId,
} from '../chronicle.mjs';

const baselineLine = {
  schema: 'portal.daily-counters/v1', kind: 'baseline', bookId: 'world-001',
  bundleSeq: 497, date: '2026-11-03', atUtc: '2026-11-03T10:39:48.632Z',
  counters: { joined: 291 }, deltas: null, provenance: { basis: 'baseline-bundle' },
};
const diffLine = {
  schema: 'portal.daily-counters/v1', kind: 'counters', bookId: 'world-001',
  bundleSeq: 510, date: '2026-11-03', atUtc: '2026-11-03T12:00:00.000Z',
  counters: { joined: 290, collegeDeposits: 635 },
  deltas: {
    joined: { from: 291, to: 290, delta: -1 },
    collegeDeposits: { from: 630, to: 635, delta: 5 },
    treasury: { from: 804000, to: 804000, delta: 0 },
  },
  provenance: { basis: 'counted-bundle' },
};

test('baseline yields exactly the opening item, never mined changes', () => {
  const items = itemsFromCountersLine(baselineLine);
  assert.equal(items.length, 1);
  assert.match(items[0].text, /Chronicle begins/);
  assert.equal(items[0].countedAtSeq, 497);
  assert.equal(items[0].support.diff, true);
});

test('diff items: one per moved counter, falls worded as falls, zero deltas silent', () => {
  const items = itemsFromCountersLine(diffLine);
  assert.equal(items.length, 2);
  const joined = items.find((i) => i.source.field === 'joined');
  assert.match(joined.text, /fell by 1 \(from 291 to 290\)/);
  const dep = items.find((i) => i.source.field === 'collegeDeposits');
  assert.match(dep.text, /rose by 5/);
});

test('a foreign counters schema yields nothing', () => {
  assert.deepEqual(itemsFromCountersLine({ schema: 'nope' }), []);
  assert.deepEqual(itemsFromCountersLine(null), []);
});

const firstLine = {
  schema: 'portal.firsts/v1', kind: 'first-mayor', bookId: 'world-001', date: '2026-10-31',
  atUtc: null, detail: 'Atlas Meridian became the first Mayor of Ember.',
  subject: { name: 'Atlas Meridian' },
  provenance: { basis: 'record-attested', route: null, source: 'The Mayor\u2019s Ledger', citedLine: 'Elected 2026-10-31: 8 of 8 weight, 5 voters' },
};

test('firsts become items cited as the line cites itself', () => {
  const item = withId(itemFromFirst(firstLine));
  assert.equal(item.kind, 'first');
  assert.equal(item.support.first, true);
  assert.equal(item.source.basis, 'record-attested');
  assert.ok(item.id.startsWith('chr-'));
});

test('headline admission: provenance required, names cross-checked', () => {
  const good = itemFromHeadline(
    { kind: 'RUIN_EXCAVATED', text: 'Orrin Lowmarsh dug into an old ruin.', utc: '2026-11-03T10:39:00Z', placeCode: null, provenance: { route: 'news', fetchedUtc: '2026-11-03T10:55:57Z' } },
    ['Orrin Lowmarsh', 'Atlas Meridian'],
  );
  assert.ok(good.item);
  assert.deepEqual(good.item.source.crossCheckedNames, ['Orrin Lowmarsh']);
  const bad = itemFromHeadline({ kind: 'X', text: 'Something happened.', utc: '2026-11-03T00:00:00Z', provenance: {} }, []);
  assert.equal(bad.item, null);
  assert.equal(bad.rejected.reason, 'headline-without-provenance');
});

test('minutes intake is counts-only: pointer text never propagates', () => {
  const pointer = {
    kind: 'chronicle-summary-pointer', remainingCount: 7,
    bySpeaker: [{ name: 'Nath Between', count: 4 }, { name: 'Atlas Meridian', count: 3 }],
    firstAt: '2026-11-02T15:10:38Z', lastAt: '2026-11-02T15:24:52Z',
    text: 'SECRET UTTERANCE TEXT', utterances: [{ said: 'ALSO SECRET' }],
  };
  const item = itemFromSummaryPointer(pointer, { where: 'the Plaza of Unity' });
  assert.ok(item);
  assert.match(item.text, /7 more recorded utterances/);
  assert.ok(!item.text.includes('SECRET'));
  assert.ok(!JSON.stringify(item).includes('SECRET'));
  assert.equal(itemFromSummaryPointer({ kind: 'other' }), null);
  assert.equal(itemFromSummaryPointer({ kind: 'chronicle-summary-pointer', remainingCount: 0 }), null);
});

const episodesFeed = {
  schema: 'portal.episodes/v1',
  episodes: [{
    firstUtc: '2026-11-02T09:12:57Z', lastUtc: '2026-11-02T09:49:39Z',
    place: 'EMBER_PLAZA_OF_UNITY', where: 'the Plaza of Unity',
    participants: ['Nath Borowik', 'Arabela Protoser'],
    utterances: [{ by: 'Nath Borowik', at: '2026-11-02T09:12:57Z', said: 'Good morning.' }],
  }],
};

test('newspaper quotes verbatim, attributed, labelled a citizen newspaper', () => {
  const paper = buildNewspaper(episodesFeed);
  assert.equal(paper.name, 'The Ember Ledger');
  assert.match(paper.label, /citizen newspaper/);
  assert.equal(paper.quotes.length, 1);
  assert.equal(paper.quotes[0].said, 'Good morning.');
  assert.equal(paper.quotes[0].speaker, 'Nath Borowik');
});

test('calendar: attendance is exactly the recorded speakers; removal is structural', () => {
  const cal = buildCalendar({ episodesFeed, ticker: [] });
  assert.equal(cal.length, 1);
  assert.equal(cal[0].kind, 'gathering');
  assert.deepEqual(cal[0].attendance, ['Nath Borowik', 'Arabela Protoser']);
  // The schedule leaves the record → the entry leaves the calendar.
  assert.equal(buildCalendar({ episodesFeed: { episodes: [] }, ticker: [] }).length, 0);
  // No deadline/election kinds in the ticker → none invented.
  const cal2 = buildCalendar({ episodesFeed: { episodes: [] }, ticker: [{ kind: 'RUIN_EXCAVATED', utc: '2026-11-03T00:00:00Z', text: 'x' }] });
  assert.equal(cal2.length, 0);
});

test('provenanceCheck: supported items pass; an unsupported item fails by name', () => {
  const items = [
    ...itemsFromCountersLine(baselineLine),
    ...itemsFromCountersLine(diffLine),
    withId(itemFromFirst(firstLine)),
  ];
  const book = buildChronicleBook({ items, countersSpan: { firstDate: '2026-11-03', lastDate: '2026-11-03', countedDays: 1, lines: 2 } });
  const ok = provenanceCheck(book, { countersLines: [baselineLine, diffLine], firstsLines: [firstLine] });
  assert.equal(ok.ok, true);
  assert.equal(ok.checked, 4);
  assert.equal(ok.span.countedDays, 1);
  const poisoned = buildChronicleBook({
    items: [...items, { id: 'chr-fake', kind: 'diff', atUtc: '2026-11-03T00:00:00Z', text: 'Invented.', support: {}, source: {} }],
  });
  const bad = provenanceCheck(poisoned, { countersLines: [baselineLine, diffLine], firstsLines: [firstLine] });
  assert.equal(bad.ok, false);
  assert.ok(bad.failures.some((f) => f.id === 'chr-fake' && f.reason === 'no-support'));
});

test('provenanceCheck: a diff item citing a missing counters line fails', () => {
  const items = itemsFromCountersLine(diffLine);
  const book = buildChronicleBook({ items });
  const res = provenanceCheck(book, { countersLines: [baselineLine], firstsLines: [] });
  assert.equal(res.ok, false);
  assert.ok(res.failures.every((f) => f.reason === 'counters-line-missing'));
});
