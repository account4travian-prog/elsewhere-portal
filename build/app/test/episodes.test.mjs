// Episodes panel + talk playback tests (M4 talk surface, app half).
// Model and queue logic are pure (logic.mjs); the feed under test is
// the REAL generated feed/episodes.json from the data cycle — the
// same document the page fetches. Exception (VER rotation 1,
// 2026-11-03): the panel-model test is pinned to a committed fixture
// (test/fixtures/episodes-feed.fixture.json) because it asserts a
// live record value; the live state is reported by
// test/episodes-live.smoke.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isEpisodesFeed,
  episodeKeyOf,
  episodeListModel,
  talkPlaybackModel,
  talkQueue,
  utteranceDelayMs,
  actListModel,
} from '../logic.mjs';

const feed = JSON.parse(
  readFileSync(new URL('../../data/feed/episodes.json', import.meta.url), 'utf8'),
);

const labelFor = (code) => ({ EMBER_COLLEGE: 'The College', EMBER_PLAZA_OF_UNITY: 'Plaza of Unity' }[code] || code);

test('isEpisodesFeed: requires the episodes schema and both lists', () => {
  assert.equal(isEpisodesFeed(feed), true);
  assert.equal(isEpisodesFeed({ schema: 'portal.world-data/v1', episodes: [], actSequences: [] }), false);
  assert.equal(isEpisodesFeed({ schema: 'portal.episodes/v1' }), false);
  assert.equal(isEpisodesFeed(null), false);
  assert.equal(isEpisodesFeed(undefined), false);
});

test('graceful absence: no feed, no panel model, no error', () => {
  assert.equal(episodeListModel(null, labelFor), null);
  assert.equal(episodeListModel({ nope: true }, labelFor), null);
  assert.equal(actListModel(null), null);
  assert.deepEqual(talkQueue(null), []);
  assert.equal(talkPlaybackModel(null), null);
  assert.equal(talkPlaybackModel({ place: 'X', utterances: [] }), null);
});

test('panel model: rows carry place, speakers-only participants, span, count, marker', () => {
  // RE-PINNED TO A COMMITTED FIXTURE (VER rotation 1, 2026-11-03).
  // This test is FOR code behaviour: episodeListModel must carry each
  // episode's fields — above all the `corroborated` marker — through
  // to the panel row faithfully. Its original form read the LIVE
  // feed/episodes.json and asserted the live College episode's
  // corroborated flag was true; that value is a property of the
  // world's record (a matching CITY_EVENT_BEGAN headline), not of
  // this code, and it drifted when the feed's College episode changed
  // (2026-11-03: the live College episode reads corroborated:false).
  // The test now runs against test/fixtures/episodes-feed.fixture.json
  // at FULL strength — every original assertion stands, and the
  // fixture pins BOTH flag directions (College true, Plaza false),
  // which the live version never did. The live feed's current state
  // is reported, not asserted, by test/episodes-live.smoke.test.mjs.
  const fixture = JSON.parse(
    readFileSync(new URL('./fixtures/episodes-feed.fixture.json', import.meta.url), 'utf8'),
  );
  const model = episodeListModel(fixture, labelFor);
  assert.ok(model);
  assert.equal(model.episodes.length, fixture.episodes.length);
  assert.ok(model.episodes.length >= 1);
  for (let i = 0; i < model.episodes.length; i++) {
    const row = model.episodes[i];
    const src = fixture.episodes[i];
    assert.equal(row.key, episodeKeyOf(src));
    assert.equal(row.placeCode, src.place);
    assert.equal(row.placeLabel, labelFor(src.place));
    // Participants are exactly the recorded speakers, in recorded order.
    assert.deepEqual(row.participants, src.participants);
    assert.equal(row.firstUtc, src.firstUtc);
    assert.equal(row.lastUtc, src.lastUtc);
    assert.equal(row.utteranceCount, src.utteranceCount);
    assert.equal(row.corroborated, src.corroborated);
  }
  const college = model.episodes.find((e) => e.placeCode === 'EMBER_COLLEGE');
  assert.ok(college, 'the fixture lists a College episode');
  assert.equal(college.placeLabel, 'The College');
  assert.equal(college.corroborated, true);
  const plaza = model.episodes.find((e) => e.placeCode === 'EMBER_PLAZA_OF_UNITY');
  assert.ok(plaza, 'the fixture lists a Plaza episode');
  assert.equal(plaza.corroborated, false);
});

test('Hark M2 condition (c): the disclosure reaches the rendered panel model for every listed episode', () => {
  // Hark M2 audit condition (c): an episode's disclosure must not live
  // only in the data file — it must arrive, verbatim, in the model the
  // panel renders from, for EVERY listed episode, and head the talk
  // playback model too (the panel header throughout playback).
  const model = episodeListModel(feed, labelFor);
  assert.ok(model.episodes.length >= 1);
  for (let i = 0; i < model.episodes.length; i++) {
    const src = feed.episodes[i];
    assert.equal(typeof src.disclosure, 'string');
    assert.ok(src.disclosure.length > 0);
    assert.equal(model.episodes[i].disclosure, src.disclosure);
    const talk = talkPlaybackModel(src);
    assert.ok(talk, 'every listed episode is playable');
    assert.equal(talk.disclosure, src.disclosure);
  }
});

test('talk queue: recorded order, verbatim words, speakers only', () => {
  // The richest episode in the real feed stands in for the College
  // lecture shape: many utterances, several speakers.
  const richest = [...feed.episodes].sort((a, b) => b.utteranceCount - a.utteranceCount)[0];
  const queue = talkQueue(richest);
  assert.equal(queue.length, richest.utteranceCount);
  assert.equal(queue.length, richest.utterances.length);
  for (let i = 0; i < queue.length; i++) {
    // Verbatim: the step text IS the recorded `said`, fence and all —
    // no paraphrase, no completion, no stripping.
    assert.equal(queue[i].text, richest.utterances[i].said);
    assert.equal(queue[i].speaker, richest.utterances[i].by);
    assert.equal(queue[i].at, richest.utterances[i].at);
    // Every speaker is a listed participant (speakers only).
    assert.ok(richest.participants.includes(queue[i].speaker));
    if (i > 0) assert.ok(Date.parse(queue[i].at) >= Date.parse(queue[i - 1].at), 'recorded order is chronological');
  }
  const fenced = queue.find((s) => s.text.includes('<<ELSEWHERE_UNTRUSTED_'));
  assert.ok(fenced, 'the record carries fenced words and the queue keeps them as recorded');
});

test('talk playback model: College episode plays its disclosure and all its words', () => {
  const college = feed.episodes.find((e) => e.place === 'EMBER_COLLEGE');
  assert.ok(college);
  const model = talkPlaybackModel(college);
  assert.equal(model.placeCode, 'EMBER_COLLEGE');
  assert.equal(model.total, college.utteranceCount);
  assert.match(model.disclosure, /moments each of them spoke/);
  assert.match(model.disclosure, /who stayed silent/);
});

test('utteranceDelayMs: readable pacing under the M5.01 talk-system law (re-pinned 2026-11-03)', () => {
  // DELIBERATE RE-PIN (M5 wave brief, Conflicts 1; disposition in
  // plan-to-complete/lane-m5-talk.md): the plan's letter governs the
  // talk system — ≥ 4 s per utterance — in the ONE shared model, so
  // the M3-era panel clamp [1.6 s, 7 s] is superseded here: the
  // floor is 4 s on every surface, and the per-utterance ceiling is
  // gone (the 90 s scene cap in the scheduler is the queue's
  // protection now; a single utterance is never cut). The scheduler
  // arithmetic itself is pinned in test/talk-system.test.mjs.
  const short = utteranceDelayMs({ text: 'Hi.' });
  const long = utteranceDelayMs({ text: 'x'.repeat(200) });
  const huge = utteranceDelayMs({ text: 'x'.repeat(5000) });
  assert.equal(short, 4000); // the plan's floor
  assert.ok(long > short);
  assert.equal(huge, 1200 + 5000 * 26); // no ceiling: reading time, whole
  assert.equal(utteranceDelayMs({ text: 'same' }), utteranceDelayMs({ text: 'same' })); // deterministic
  assert.equal(utteranceDelayMs(null), 4000); // the floor, no crash
});

test('act list model: recorded acts under the acts-only disclosure, no state anywhere', () => {
  const model = actListModel(feed);
  assert.ok(model);
  assert.equal(model.sequences.length, feed.actSequences.length);
  for (let i = 0; i < model.sequences.length; i++) {
    const row = model.sequences[i];
    const src = feed.actSequences[i];
    assert.equal(row.actor, src.actor);
    assert.equal(row.count, src.count);
    assert.equal(row.disclosure, src.disclosure);
    assert.match(row.disclosure, /acts, not ongoing work/);
    assert.deepEqual(row.acts.map((a) => a.phrase), src.acts.map((a) => a.phrase));
    assert.ok(!('state' in row) && !('doing' in row));
  }
});
