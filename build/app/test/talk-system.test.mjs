// talk-system.test.mjs — the M5 talk lane over the ONE shared model
// (logic.mjs): M5.01 the scene scheduler (priority queues, interruption
// at nodes only, the ≥ 4 s floor and the 90 s cap), M5.02 the bubble
// kit (K1 header, verbatim words, marked truncation), M5.03
// conversation staging (facing, the lone-speaker rule, the town-
// altitude collapse) and M5.04 the set-piece templates (lecture /
// dinner / storytelling, attendees = speakers only). Fixtures are
// record-shaped; the byte-equality test runs against the LIVE
// episodes feed, the same source the panel plays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  utteranceDelayMs, TALK_MIN_UTTERANCE_MS, TALK_SCENE_CAP_MS,
  scheduleTalkScene, scheduleTalkScenes, talkInterruptPoint,
  bubbleKit, bubbleHeader, bubbleClockTime, READ_IN_FULL_MARKER, BUBBLE_STAGE_MAX_CHARS,
  conversationStaging, talkCaption, talkAtAltitude,
  classifySetPiece, setPiecePlan, stripRecordFence, plainDate,
} from '../logic.mjs';
import { itemFromSummaryPointer } from '../../data/chronicle.mjs';

const FENCE = (s) => `<<ELSEWHERE_UNTRUSTED_TEST>>${s}<</ELSEWHERE_UNTRUSTED_TEST>>`;
const ep = (place, rows, extra = {}) => ({
  place, firstUtc: rows[0][0], lastUtc: rows[rows.length - 1][0],
  participants: [...new Set(rows.map((r) => r[1]))],
  disclosure: 'd', utteranceCount: rows.length,
  utterances: rows.map(([at, by, said]) => ({ at, by, said: FENCE(said) })),
  ...extra,
});

// A four-utterance exchange, two speakers interleaved (recorded order).
const EP4 = ep('EMBER_PLAZA_OF_UNITY', [
  ['2026-11-02T10:00:00Z', 'Nia Okafor', 'Good morning.'],
  ['2026-11-02T10:01:00Z', 'Kavi Marlow', 'Morning, Nia.'],
  ['2026-11-02T10:02:00Z', 'Nia Okafor', 'The roads first, then the hall.'],
  ['2026-11-02T10:03:00Z', 'Kavi Marlow', 'Agreed.'],
]);

// ------------------------------------------------------------- M5.01

test('M5.01 pacing: the plan floor governs — every utterance holds at least 4 s', () => {
  assert.equal(TALK_MIN_UTTERANCE_MS, 4000);
  assert.equal(utteranceDelayMs({ text: 'Hi.' }), 4000);
  assert.equal(utteranceDelayMs(null), 4000);
  assert.ok(utteranceDelayMs({ text: 'x'.repeat(200) }) > 4000, 'reading time still grows with length');
  // No per-utterance ceiling any more: the cap lives at scene level,
  // and a single utterance is never cut short.
  assert.equal(utteranceDelayMs({ text: 'x'.repeat(5000) }), 1200 + 5000 * 26);
});

test('M5.01: a 4-utterance scene plays in recorded order, byte-equal, never coalesced', () => {
  const scene = scheduleTalkScene(EP4, { mode: 'recording' });
  assert.ok(scene);
  assert.equal(scene.capped, false);
  assert.equal(scene.events.length, 4, 'one bubble per utterance — nothing merged');
  scene.events.forEach((ev, i) => {
    assert.equal(ev.text, EP4.utterances[i].said, 'the recorded words, byte-for-byte');
    assert.equal(ev.speaker, EP4.utterances[i].by);
    assert.equal(ev.index, i);
    assert.ok(ev.delayMs >= 4000);
    if (i > 0) assert.equal(ev.startMs, scene.events[i - 1].endMs, 'back-to-back, in order');
  });
});

test('M5.01: two scenes, one figure — the later scene queues behind the earlier', () => {
  const a = ep('EMBER_COLLEGE', [
    ['2026-11-02T09:00:00Z', 'Atlas Meridian', 'We begin.'],
    ['2026-11-02T09:02:00Z', 'Nia Okafor', 'A question.'],
    ['2026-11-02T09:04:00Z', 'Atlas Meridian', 'An answer.'],
  ]);
  const b = ep('EMBER_PLAZA_OF_UNITY', [
    ['2026-11-02T09:01:00Z', 'Atlas Meridian', 'Out here now.'],
    ['2026-11-02T09:03:00Z', 'Kavi Marlow', 'There you are.'],
  ]);
  const { scenes, skipped } = scheduleTalkScenes([b, a], { mode: 'recording' }); // input order must not matter
  assert.deepEqual(skipped, []);
  assert.equal(scenes.length, 2);
  const [first, second] = scenes;
  assert.equal(first.placeCode, 'EMBER_COLLEGE', 'priority is the record order (earlier opening stamp first)');
  assert.ok(second.startMs >= first.endMs, 'the shared figure is never in two scenes at once');
  const atlasEvents = scenes.flatMap((s) => s.events.filter((e) => e.speaker === 'Atlas Meridian'));
  for (let i = 1; i < atlasEvents.length; i++) {
    assert.ok(atlasEvents[i].startMs >= atlasEvents[i - 1].endMs, 'no overlap for the shared figure');
  }
});

test('M5.01 LIVE (positive control): the 90 s cap still summarises a live scene — pointer carries counts, never words', () => {
  const rows = Array.from({ length: 30 }, (_, i) => [
    `2026-11-02T11:${String(i).padStart(2, '0')}:00Z`, i % 2 ? 'Kavi Marlow' : 'Nia Okafor', `Remark ${i}.`,
  ]);
  const scene = scheduleTalkScene(ep('EMBER_TOWNHALL', rows), { mode: 'live' });
  assert.equal(scene.mode, 'live');
  assert.equal(scene.capped, true);
  // 22 minimal utterances fit (22 × 4000 = 88 000 ≤ 90 000); the 23rd
  // would cross the cap, so 8 remain.
  assert.equal(scene.events.length, 22);
  assert.ok(scene.endMs - scene.startMs <= TALK_SCENE_CAP_MS);
  assert.equal(scene.summary.remainingCount, 8);
  assert.equal(scene.summary.bySpeaker.reduce((s, x) => s + x.count, 0), 8);
  const pointer = JSON.stringify(scene.summary);
  for (const u of rows) assert.ok(!pointer.includes(u[2]), 'the summary never quotes or paraphrases the remaining words');
  assert.equal(scene.summary.kind, 'chronicle-summary-pointer');
  // The Chronicle intake (M6.09) still consumes the live pointer's
  // shape exactly as produced — the producer→consumer chain, at
  // fixture level.
  const item = itemFromSummaryPointer(scene.summary, { episodeKey: scene.key, placeCode: scene.placeCode, where: 'Town Hall' });
  assert.ok(item && item.kind === 'minutes', 'the intake turns the live pointer into a minutes item');
  assert.equal(item.source.remainingCount, 8);
  for (const u of rows) assert.ok(!item.text.includes(u[2]), 'the minutes item carries counts, never the summarised words');
});

test('M5.01: a first utterance longer than the cap still plays — a scene never silences itself', () => {
  const scene = scheduleTalkScene(ep('EMBER_COLLEGE', [
    ['2026-11-02T12:00:00Z', 'Atlas Meridian', 'x'.repeat(5000)],
    ['2026-11-02T12:05:00Z', 'Nia Okafor', 'Thank you.'],
  ]), { mode: 'live' });
  assert.equal(scene.events.length, 1, 'the long opening plays whole; the tail summarises');
  assert.equal(scene.capped, true);
  assert.equal(scene.summary.remainingCount, 1);
});

test('M5.07 ruling: the mode is required — an unnamed mode is a caller error', () => {
  assert.throws(() => scheduleTalkScene(EP4), TypeError);
  assert.throws(() => scheduleTalkScene(EP4, {}), TypeError);
  assert.throws(() => scheduleTalkScene(EP4, { mode: 'replay' }), TypeError);
  assert.throws(() => scheduleTalkScenes([EP4]), TypeError);
  assert.throws(() => scheduleTalkScenes([], { mode: 'both' }), TypeError,
    'the discipline holds even for an empty set — no silent inheritance');
});

test('M5.07 ruling: a RECORDING plays in full past the cap — no cap, no pointer', () => {
  const rows = Array.from({ length: 30 }, (_, i) => [
    `2026-11-02T11:${String(i).padStart(2, '0')}:00Z`, i % 2 ? 'Kavi Marlow' : 'Nia Okafor', `Remark ${i}.`,
  ]);
  const episode = ep('EMBER_TOWNHALL', rows);
  const scene = scheduleTalkScene(episode, { mode: 'recording' });
  assert.equal(scene.mode, 'recording');
  assert.equal(scene.events.length, 30, 'every utterance plays as a bubble, however long the scene runs');
  assert.equal(scene.capped, false);
  assert.equal(scene.summary, null, 'a recording produces no summary pointer');
  assert.ok(scene.endMs - scene.startMs > TALK_SCENE_CAP_MS, 'the scene runs past the live cap, at the same mandated pacing');
  scene.events.forEach((ev, i) => {
    assert.equal(ev.text, episode.utterances[i].said, 'the recorded words, byte-for-byte, all the way to the last');
    assert.ok(ev.delayMs >= TALK_MIN_UTTERANCE_MS, 'the pacing law is unchanged — only the cap\'s scope moved');
  });
});

test('M5.01: no recorded words, no bubbles — wordless episodes schedule nothing', () => {
  const wordless = { place: 'EMBER_COLLEGE', firstUtc: '2026-11-02T09:00:00Z', participants: [], utteranceCount: 0 };
  assert.equal(scheduleTalkScene(wordless, { mode: 'recording' }), null);
  assert.equal(scheduleTalkScene({ ...wordless, utterances: [] }, { mode: 'recording' }), null);
  const { scenes, skipped } = scheduleTalkScenes([wordless, EP4], { mode: 'recording' });
  assert.equal(scenes.length, 1);
  assert.deepEqual(skipped, ['EMBER_COLLEGE|2026-11-02T09:00:00Z']);
  // And every scheduled event anywhere traces to a recorded utterance.
  for (const ev of scenes[0].events) assert.ok(EP4.utterances.some((u) => u.said === ev.text));
});

test('M5.01: interruption lands at nodes only — utterance boundary, then leg arrival', () => {
  const scene = scheduleTalkScene(EP4, { mode: 'recording' }); // four 4 s events: [0,4k) [4k,8k) [8k,12k) [12k,16k)
  assert.deepEqual(talkInterruptPoint(scene, 4000), { atMs: 4000, deferred: false, reasons: [] });
  const mid = talkInterruptPoint(scene, 5000);
  assert.equal(mid.atMs, 8000, 'never mid-utterance: the words on display finish');
  assert.deepEqual(mid.reasons, ['utterance-boundary']);
  const leg = talkInterruptPoint(scene, 5000, [{ departMs: 6000, arriveMs: 9500 }]);
  assert.equal(leg.atMs, 12000, 'the boundary inside a leg waits for the arrival node, then the next boundary');
  assert.deepEqual(leg.reasons, ['utterance-boundary', 'leg-arrival', 'utterance-boundary']);
});

// ------------------------------------------------------------- M5.02

test('M5.02: the K1 header is "[Name], [date], [time] UTC:" from the recorded stamp (dated form: G-J1 round 3)', () => {
  assert.equal(bubbleClockTime('2026-11-01T23:12:30Z'), '23:12');
  assert.equal(bubbleClockTime('not a stamp'), null);
  // The bare "HH:MM" gained its zone and date (my Hark's round-2
  // nit) in the module's existing recording-range shape
  // (plainDate + bubbleClockTime) — the same header on every
  // surface, since the kit is the only header there is.
  assert.equal(bubbleHeader({ speaker: 'Atlas Meridian', at: '2026-11-01T23:12:30Z' }), 'Atlas Meridian, 1 Nov 2026, 23:12 UTC:');
  assert.equal(bubbleHeader({ speaker: 'Atlas Meridian' }), 'Atlas Meridian:', 'no stamp, no invented time');
});

test('M5.02: the panel kit never truncates; the stage kit cuts a marked prefix only', () => {
  const long = { speaker: 'Nia Okafor', at: '2026-11-02T10:00:00Z', text: FENCE(Array(60).fill('word').join(' ')) };
  // The kit's words are the record's words with the transport
  // fence stripped (G-J1 round 3): "the full words" below means
  // exactly stripRecordFence(step text).
  const words = stripRecordFence(long.text);
  const panel = bubbleKit(long, { variant: 'panel' });
  assert.equal(panel.truncated, false);
  assert.equal(panel.displayText, words);
  assert.equal(panel.marker, null);
  const stage = bubbleKit(long, { variant: 'stage' });
  assert.equal(stage.truncated, true);
  assert.equal(stage.marker, READ_IN_FULL_MARKER);
  assert.equal(stage.marker, 'Read in full');
  assert.ok(stage.displayText.length <= BUBBLE_STAGE_MAX_CHARS);
  assert.ok(words.startsWith(stage.displayText), 'the cut is a strict prefix of the recorded words');
  assert.ok(!stage.displayText.includes(READ_IN_FULL_MARKER), 'the marker rides beside the words, never inside them');
  assert.equal(stage.text, words, 'the kit always carries the full words');
  const short = bubbleKit({ speaker: 'Nia', at: '2026-11-02T10:00:00Z', text: 'Short.' }, { variant: 'stage' });
  assert.equal(short.truncated, false);
  assert.equal(bubbleKit({ speaker: 'Nia', text: '' }), null, 'no words, no bubble');
});

test('M5.02: sampled bubble text is byte-equal to the live voices record (inside its transport fence)', () => {
  const feed = JSON.parse(readFileSync(new URL('../../data/feed/episodes.json', import.meta.url), 'utf8'));
  assert.ok(feed.episodes.length > 0);
  let sampled = 0;
  for (const episode of feed.episodes) {
    for (const u of episode.utterances) {
      const kit = bubbleKit({ speaker: u.by, at: u.at, text: u.said });
      // Byte-equal to the record's words: the feed's `said` minus
      // its transport fence, which never renders (G-J1 round 3).
      assert.equal(kit.text, stripRecordFence(u.said));
      assert.equal(kit.header, `${u.by}, ${plainDate(u.at)}, ${bubbleClockTime(u.at)} UTC:`);
      sampled++;
    }
  }
  assert.ok(sampled >= 20, `sampled ${sampled} live utterances`);
});

// ------------------------------------------------------------- M5.03

test('M5.03: speakers face each other — speaker to the listeners, listeners to the speaker', () => {
  const staging = conversationStaging(EP4, { 'Nia Okafor': { x: 4, y: 4 }, 'Kavi Marlow': { x: 5, y: 4 } });
  assert.equal(staging.lone, false);
  assert.deepEqual(staging.speakers.map((s) => s.name), ['Nia Okafor', 'Kavi Marlow'], 'speakers only, first-speech order');
  const step0 = staging.steps[0];
  assert.equal(step0.speaker, 'Nia Okafor');
  assert.deepEqual(step0.listeners, ['Kavi Marlow']);
  assert.deepEqual(step0.speakerFacesPoint, { x: 5, y: 4 });
  assert.deepEqual(step0.listenersFacePoint, { x: 4, y: 4 });
  const step1 = staging.steps[1];
  assert.deepEqual(step1.speakerFacesPoint, { x: 4, y: 4 }, 'facing follows the timestamp order');
});

test('M5.03: no evidenced listener means a lone speaker — never an invented audience', () => {
  const solo = ep('EMBER_COLLEGE', [
    ['2026-11-02T08:00:00Z', 'Atlas Meridian', 'A note to the record.'],
    ['2026-11-02T08:02:00Z', 'Atlas Meridian', 'And a second.'],
  ]);
  const staging = conversationStaging(solo, { 'Atlas Meridian': { x: 6, y: 2 } });
  assert.equal(staging.lone, true);
  for (const step of staging.steps) {
    assert.deepEqual(step.listeners, []);
    assert.equal(step.speakerFacesPoint, null, 'nobody evidenced to face');
  }
  assert.equal(staging.speakers.length, 1);
});

test('M5.03: unknown positions yield null facing, never invented coordinates', () => {
  const staging = conversationStaging(EP4, { 'Nia Okafor': { x: 4, y: 4 } });
  assert.equal(staging.steps[0].speakerFacesPoint, null, 'the listener has no known position');
  assert.deepEqual(staging.steps[0].listenersFacePoint, { x: 4, y: 4 });
  assert.equal(staging.speakers.find((s) => s.name === 'Kavi Marlow').position, null);
});

test('M5.03: town altitude collapses talk to icon + caption', () => {
  const staging = conversationStaging(EP4, {});
  const label = (code) => ({ EMBER_PLAZA_OF_UNITY: 'the Plaza of Unity' })[code] || code;
  const town = talkAtAltitude(staging, 1, 'town', label);
  assert.equal(town.mode, 'icon-caption');
  assert.equal(town.icon, 'talk');
  assert.equal(town.caption, 'Kavi Marlow is talking at the Plaza of Unity.');
  assert.equal(talkCaption(staging, 0, label), 'Nia Okafor is talking at the Plaza of Unity.');
  assert.equal(talkAtAltitude(staging, 0, 'scene', label).mode, 'bubbles');
  assert.throws(() => talkAtAltitude(staging, 0, 'orbit', label), TypeError);
});

// ------------------------------------------------------------- M5.04

// The College lecture fixture mirrors the evidence file's worked
// derivation (GATHERING-EVIDENCE.md §2.1) — including its trap: the
// closing thanks NAMES two citizens who never spoke there.
const LECTURE = ep('EMBER_COLLEGE', [
  ['2026-11-01T18:57:55Z', 'Nath Between', 'I am here for the lecture and discussion.'],
  ['2026-11-01T19:06:14Z', 'Atlas Meridian', 'Welcome — we begin.'],
  ['2026-11-01T19:06:48Z', 'Nath Between', 'A question on the method.'],
  ['2026-11-01T19:09:00Z', 'Atlas Meridian', 'Good questions, both — and they are the same question.'],
  ['2026-11-01T19:39:49Z', 'Atlas Meridian', 'Thank you — Nath Between, Nath Borowik, Orrin Lowmarsh and Spark Archer.'],
], {});
LECTURE.utterances[2] = { at: '2026-11-01T19:06:57Z', by: 'Nath Borowik', said: FENCE('Greetings, Atlas.') };
LECTURE.participants = ['Nath Between', 'Atlas Meridian', 'Nath Borowik'];

test('M5.04 lecture: evidenced attendees only — names inside the words are not a roster', () => {
  const plan = setPiecePlan(LECTURE, { occasionText: "Atlas Meridian's lecture began at the College" });
  assert.equal(plan.shape, 'lecture');
  assert.equal(plan.lecturer, 'Atlas Meridian', 'the lecturer is the participant the headline names');
  assert.deepEqual(plan.attendees, ['Nath Between', 'Atlas Meridian', 'Nath Borowik']);
  assert.ok(!plan.attendees.includes('Orrin Lowmarsh'), 'named in the thanks, never spoke — not an attendee');
  assert.ok(!plan.attendees.includes('Spark Archer'), 'named in the thanks, never spoke — not an attendee');
  assert.equal(plan.turns.length, LECTURE.utterances.length);
  assert.deepEqual(plan.turns.map((t) => t.index), [0, 1, 2, 3, 4], 'every utterance, recorded order');
});

test('M5.04: place alone never promotes an episode — the occasion must be evidenced', () => {
  assert.equal(classifySetPiece(LECTURE), 'conversation');
  assert.equal(classifySetPiece(LECTURE, 'A gathering began at the Plaza of Unity.'), 'conversation', 'occasion must match the place');
  assert.equal(setPiecePlan(LECTURE).lecturer, null);
});

test('M5.04 dinner: timestamp turn order at Meridian Hall, speakers only', () => {
  const dinner = ep('EMBER_DISTRICT_3_PLOT_18', [
    ['2026-11-01T23:20:00Z', 'Atlas Meridian', 'Thank you all for coming.'],
    ['2026-11-01T23:24:00Z', 'Nath Between', 'The corridor figures are published.'],
    ['2026-11-01T23:31:00Z', 'Orrin Lowmarsh', 'Then phase two has its baseline.'],
  ]);
  const plan = setPiecePlan(dinner, { occasionText: 'A dinner at Meridian Hall, hosted by the mayor.' });
  assert.equal(plan.shape, 'dinner');
  assert.equal(plan.stagingMode, 'face-speaker');
  assert.deepEqual(plan.attendees, ['Atlas Meridian', 'Nath Between', 'Orrin Lowmarsh']);
  const stamps = plan.turns.map((t) => Date.parse(t.at));
  assert.deepEqual(stamps, [...stamps].sort((x, y) => x - y), 'turns run in timestamp order');
});

test('M5.04 storytelling: the Plaza ring seats every speaker, deterministically', () => {
  const plan = setPiecePlan(EP4, {
    occasionText: 'A gathering the Town Hall voted for began at the Plaza of Unity.',
    center: { x: 4, y: 4 },
  });
  assert.equal(plan.shape, 'storytelling');
  assert.equal(plan.stagingMode, 'ring');
  assert.equal(plan.ring.length, plan.attendees.length);
  const again = setPiecePlan(EP4, { occasionText: 'A gathering the Town Hall voted for began at the Plaza of Unity.', center: { x: 4, y: 4 } });
  assert.deepEqual(plan.ring, again.ring, 'the ring is deterministic');
  const pts = new Set(plan.ring.map((r) => `${r.x},${r.y}`));
  assert.equal(pts.size, plan.ring.length, 'one slot per speaker, no shared slots');
  for (const slot of plan.ring) {
    assert.ok(Math.abs(Math.hypot(slot.x - 4, slot.y - 4) - 0.8) < 0.002, 'every slot on the ring');
  }
});
