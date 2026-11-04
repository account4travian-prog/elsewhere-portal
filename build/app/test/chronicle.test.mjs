// chronicle.test.mjs — M6.09/M6.10/M6.13 app surfaces: the Chronicle
// book render, since-your-last-visit exactness (seq N → N+3 shows
// exactly items N+1…N+3; a no-change absence renders the honest line
// only), the civic calendar's honest attendance + dual times, and
// the quiet page's pinned forbiddens (no ambient citizens, no
// figures, no countdowns; population as three distinct numbers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarHtml,
  chronicleBookHtml,
  isChronicleBook,
  quietPageHtml,
  quietState,
  sinceLastVisit,
} from '../logic.mjs';

const item = (seq, text) => ({
  id: `chr-${seq}`, kind: 'diff', text, atUtc: '2026-11-03T12:00:00.000Z',
  countedAtSeq: seq, support: { diff: true }, source: { countersSeq: seq },
});
const book = {
  schema: 'portal.chronicle-book/v1',
  collectingSince: '2026-11-03',
  span: { firstDate: '2026-11-03', lastDate: '2026-11-03', countedDays: 1, lines: 1 },
  throughSeq: 503,
  disclosures: ['Every Chronicle item is backed.'],
  items: [item(501, 'One.'), item(502, 'Two.'), item(503, 'Three.'), item(504, 'Four.')],
  newspaper: {
    name: 'The Ember Ledger', label: 'a citizen newspaper of Ember', note: 'Quoted from the record.',
    quotes: [{ speaker: 'Nath Borowik', at: '2026-11-02T09:12:57Z', said: 'Good morning, <script>alert(1)</script>', where: 'the Plaza of Unity' }],
  },
  calendar: [{
    kind: 'gathering', atUtc: '2026-11-02T09:12:57Z', endUtc: '2026-11-02T09:49:39Z',
    placeCode: 'EMBER_PLAZA_OF_UNITY', where: 'the Plaza of Unity',
    attendance: ['Nath Borowik', 'Arabela Protoser'],
    attendanceBasis: 'Named here because the record captured them speaking.',
    minutesItemId: null,
  }],
};

test('isChronicleBook gates on the schema', () => {
  assert.equal(isChronicleBook(book), true);
  assert.equal(isChronicleBook({ schema: 'nope', items: [] }), false);
  assert.equal(isChronicleBook(null), false);
});

test('since-visit: seq N → N+3 shows exactly items N+1…N+3', () => {
  const r = sinceLastVisit(book, 500, 503);
  assert.equal(r.state, 'changed');
  assert.deepEqual(r.items.map((i) => i.countedAtSeq), [501, 502, 503]);
});

test('since-visit: no-change renders the honest line only', () => {
  const r = sinceLastVisit(book, 503, 503);
  assert.equal(r.state, 'no-change');
  const html = chronicleBookHtml(book, { storedSeq: 503, currentSeq: 503 });
  assert.ok(html.includes('Nothing new is in the record since your last visit.'));
  const sinceBlock = html.split('Since your last visit')[1].split('The Chronicle')[0];
  assert.ok(!sinceBlock.includes('<li'), 'the honest line only — no items dressed as new');
});

test('since-visit: first visit stores nothing anywhere but the browser', () => {
  const r = sinceLastVisit(book, null, 503);
  assert.equal(r.state, 'first-visit');
  const html = chronicleBookHtml(book, { storedSeq: null, currentSeq: 503 });
  assert.ok(html.includes('first visit Portal can tell about'));
});

test('chronicle render: depth stated, items listed, feed text escaped', () => {
  const html = chronicleBookHtml(book, { storedSeq: null, currentSeq: 503 });
  assert.ok(html.includes('1 counted day'));
  assert.ok(html.includes('Two.'));
  assert.ok(html.includes('From the counted diffs'));
});

test('the Ledger: citizen-newspaper label, fenced recorded words, escaped verbatim', () => {
  const html = chronicleBookHtml(book, {});
  assert.ok(html.includes('The Ember Ledger — a citizen newspaper of Ember'));
  assert.ok(html.includes('Recorded words'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('ledger-words'));
});

test('calendar: honest attendance, dual times, no invented upcoming', () => {
  const html = calendarHtml(book, { nowUtc: '2026-11-03T12:00:00.000Z' });
  assert.ok(html.includes('Gathering'));
  assert.ok(html.includes('the Plaza of Unity'));
  assert.ok(html.includes('Nath Borowik, Arabela Protoser'));
  assert.ok(html.includes('record captured them speaking'));
  assert.ok(html.includes('UTC'));
  assert.ok(html.includes('Kansas'));
  assert.ok(html.includes('Nothing coming up is evidenced'));
});

test('calendar: an entry in the future renders under Coming up', () => {
  const future = { ...book, calendar: [{ ...book.calendar[0], atUtc: '2026-12-01T09:00:00Z' }] };
  const html = calendarHtml(future, { nowUtc: '2026-11-03T12:00:00.000Z' });
  assert.ok(html.includes('Coming up'));
});

// ---------------------------------------------------------------- quiet

const quietBundle = {
  bundleSeq: 503, newestFetchUtc: '2026-11-03T12:00:00.000Z',
  counters: { populationKnown: 291 },
  citizens: [{ name: 'Secretname Unplaced', citizenKey: 'portal-key:x', state: 'awake' }],
  world: { bookId: 'world-001' },
};

test('quiet state: nobody evidenced awake → quiet; one awake placed citizen → not quiet', () => {
  assert.equal(quietState(quietBundle).quiet, true);
  const busy = {
    ...quietBundle,
    citizens: [{ name: 'Placed Person', citizenKey: 'portal-key:y', state: 'awake', placeCode: 'EMBER_PLAZA_OF_UNITY' }],
  };
  assert.equal(quietState(busy).quiet, false);
  const allAsleep = {
    ...quietBundle,
    citizens: [{ name: 'Sleeping Person', citizenKey: 'portal-key:z', state: 'asleep', placeCode: 'EMBER_PLAZA_OF_UNITY' }],
  };
  assert.equal(quietState(allAsleep).quiet, true);
});

test('quiet page: heading, named window, three offers, three distinct numbers', () => {
  const html = quietPageHtml(quietBundle);
  assert.ok(html.includes('Ember is quiet right now'));
  assert.ok(html.includes('2026-11-03 12:00 UTC'));
  assert.ok(html.includes('Play the recording'));
  assert.ok(html.includes('#chronicle-panel'));
  assert.ok(html.includes('#calendar-panel'));
  assert.ok(html.includes('291'));
  assert.ok(html.includes('citizens Portal can name'));
  assert.ok(html.includes('evidenced place right now'));
});

test('quiet page FORBIDDEN: no citizen names, no figures, no countdowns, no looping work', () => {
  const html = quietPageHtml(quietBundle);
  assert.ok(!html.includes('Secretname'), 'no ambient or named citizens on the quiet page');
  assert.ok(!/<canvas|<img|figure/i.test(html), 'zero figures of any kind');
  assert.ok(!/countdown|in \d+ (minute|second|hour)s? (it|the town)|any moment now/i.test(html), 'no fake countdowns');
  assert.ok(!/animation|@keyframes/.test(html), 'no looping animation hooks');
});
