/* M5.09 civic theatre stagings.
   Run per file: node --test test/stagings.test.mjs

   Proven here, against the recorded evening fixture:
   - the lecture staging seats exactly its speakers (the closing
     thanks' named-but-silent attendees are NOT occupants), the
     lecturer at the lectern by the headline's own naming, turns
     in recorded order through the shared scheduler;
   - the office-hour staging is a lone speaker — no audience;
   - the dinner staging performs the occasion only: zero bubbles,
     zero figures, the absence stated;
   - the votes staging is not performed, with its reason;
   - ticker lines come from structured headline fields only;
   - under the project owner's M5.07 ruling (2026-11-03) the stagings are
     recordings and play in full — the lecture no longer caps and
     yields NO minutes line (the pointer mechanism and its
     counts-only intake shape are pinned where they now live:
     the live-mode control in the app talk-system suite and the
     chronicle suite's literal-pointer tests). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { buildStagings, minutesLines, lecturerFromHeadline } = await import('../stagings.mjs');
const { itemFromSummaryPointer } = await import('../../../data/chronicle.mjs');

const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/evening-2026-11-01.json', import.meta.url), 'utf8'));
const REGISTRY = JSON.parse(readFileSync(new URL('../interior-kits.json', import.meta.url), 'utf8'));
const STAGINGS = buildStagings(FIXTURE, REGISTRY);
const byKind = new Map(STAGINGS.map((s) => [s.kind, s]));

test('lecture: occupants are the speakers exactly — silent named attendees excluded', () => {
  const lecture = byKind.get('lecture');
  assert.equal(lecture.performed, true);
  assert.deepEqual([...lecture.occupants].sort(),
    ['Atlas Meridian', 'Nath Between', 'Nath Borowik']);
  assert.ok(!lecture.occupants.includes('Orrin Lowmarsh'), 'named in the closing thanks, never spoke — not an occupant');
  assert.ok(!lecture.occupants.includes('Spark Archer'), 'named in the closing thanks, never spoke — not an occupant');
  const lecturer = lecture.placed.find((p) => p.name === 'Atlas Meridian');
  assert.equal(lecturer.at.id, 'station_lectern', 'the headline-named lecturer stands at the lectern');
  assert.equal(lecturerFromHeadline(FIXTURE.occasions.lectureBegan), 'Atlas Meridian');
});

test('lecture: the talk scene runs through the shared scheduler and plays in full (M5.07 ruling)', () => {
  const lecture = byKind.get('lecture');
  assert.equal(lecture.talkScene.total, 18, 'all 18 recorded utterances are the scene');
  // The staging performs a RECORDED occasion: recording mode —
  // no cap, however far past 90 s the lecture runs at the ≥4 s
  // floor, and no summary pointer (the project owner, 2026-11-03: the cap
  // governs live scenes only).
  assert.equal(lecture.talkScene.capped, false, 'a recording never caps');
  assert.equal(lecture.talkScene.events, 18, 'every utterance plays — none summarised away');
  assert.equal(lecture.minutesLine, null, 'a recording yields no minutes pointer');
});

test('office hour: a lone speaker, staged as one — no invented audience', () => {
  const office = byKind.get('office-hour');
  assert.equal(office.performed, true);
  assert.deepEqual(office.occupants, ['Atlas Meridian']);
  assert.equal(office.talkScene.total, 1);
  assert.deepEqual(office.tickerLines.map((t) => t.text),
    ['The mayor\'s meeting began at the Town Hall.'], 'ticker from the headline\'s structured fields');
});

test('dinner: occasion only — zero bubbles, zero figures, absence stated', () => {
  const dinner = byKind.get('dinner');
  assert.equal(dinner.performed, true);
  assert.equal(dinner.performanceForm, 'occasion-only');
  assert.equal(dinner.atUtc, '2026-11-01T23:20:00Z');
  assert.equal(dinner.bubbleCount, 0);
  assert.deepEqual(dinner.occupants, []);
  assert.equal(dinner.talkScene, null, 'no recorded words ⇒ no talk scene');
  assert.match(dinner.reason, /No recorded words at Meridian Hall/);
});

test('votes: not performed — no recorded instance exists', () => {
  const votes = byKind.get('votes');
  assert.equal(votes.performed, false);
  assert.match(votes.reason, /No recorded instance/);
  assert.deepEqual(votes.occupants, []);
});

test('minutes lines: recorded-occasion stagings yield none under the ruling — the intake shape stands ready', () => {
  const lines = minutesLines(STAGINGS);
  assert.deepEqual(lines, [], 'no staging tonight produces a pointer: recordings play in full (M5.07 ruling)');
  // The intake contract itself is unchanged — a pointer in the
  // M6.09 shape (as a genuinely live scene still produces one;
  // see the live control in the app talk-system suite) is still
  // consumed counts-only. Exercised here with a hand-built line
  // so this suite keeps pinning the seam's shape, not its old
  // producer.
  const line = {
    pointer: {
      kind: 'chronicle-summary-pointer', remainingCount: 2,
      bySpeaker: [{ name: 'Nath Between', count: 2 }],
      firstAt: '2026-11-01T19:00:00Z', lastAt: '2026-11-01T19:05:00Z',
    },
    episodeKey: 'EMBER_COLLEGE|2026-11-01T19:00:00Z', placeCode: 'EMBER_COLLEGE', where: 'The College',
  };
  assert.deepEqual(Object.keys(line).sort(), ['episodeKey', 'placeCode', 'pointer', 'where']);
  const item = itemFromSummaryPointer(line.pointer, line);
  assert.ok(item && item.kind === 'minutes', 'the M6.09 intake consumes the shape as before');
  const flat = JSON.stringify(line);
  for (const u of FIXTURE.episodes.lecture.utterances) {
    const words = u.said.replace(/<<[^>]*>>/g, '').trim().split(/\s+/).slice(0, 6).join(' ');
    assert.ok(!flat.includes(words), `a minutes line must not carry utterance text ("${words}…")`);
  }
  assert.equal(line.pointer.remainingCount,
    line.pointer.bySpeaker.reduce((a, s) => a + s.count, 0),
    'the pointer is counts, and its counts agree');
});
