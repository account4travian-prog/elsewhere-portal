// Episode / act-sequence derivation tests (M2.08 disposition:
// gatherings as derived episodes, working as acts-only).
//
// The real-snapshot tests run against the actual Wave 1 archive payloads
// (archive/2026-11-02/) — the same snapshots GATHERING-EVIDENCE.md
// analysed — and assert the doc's worked derivations. The synthetic
// tests are labelled synthetic and exist as negative controls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTS_DISCLOSURE,
  DISCLOSURE,
  EXCHANGE_GAP_MS,
  deriveActSequences,
  deriveEpisodes,
  extractActor,
} from '../episodes.mjs';

const voices = JSON.parse(
  readFileSync(new URL('../archive/2026-11-02/voices-20261102T020714Z.json', import.meta.url), 'utf8'),
);
const news = JSON.parse(
  readFileSync(new URL('../archive/2026-11-02/news-20261102T020713Z.json', import.meta.url), 'utf8'),
);

test('real snapshot: the College lecture derives as one corroborated episode', () => {
  const episodes = deriveEpisodes(voices, news);
  const college = episodes.filter((e) => e.place === 'EMBER_COLLEGE');
  assert.equal(college.length, 1);
  const ep = college[0];
  // Exactly the three citizens who SPOKE (GATHERING-EVIDENCE.md §2,
  // worked derivation 1): 18 utterances, 3 speakers.
  assert.equal(ep.utteranceCount, 18);
  assert.deepEqual(
    [...ep.participants].sort(),
    ['Atlas Meridian', 'Nath Between', 'Nath Borowik'],
  );
  assert.equal(ep.firstUtc, '2026-11-01T18:57:55.901144+00:00');
  assert.equal(ep.lastUtc, '2026-11-01T19:39:49.907684+00:00');
  // Corroborated by the CITY_EVENT_BEGAN headline anchored `college`
  // (Atlas Meridian's lecture began, 2026-11-01T19:04:30Z).
  assert.equal(ep.corroborated, true);
  assert.equal(ep.corroboratedBy.at, '2026-11-01T19:04:30.227266+00:00');
  assert.equal(ep.disclosure, DISCLOSURE);
  assert.match(ep.disclosure, /moments each of them spoke/);
  assert.match(ep.disclosure, /who stayed silent/);
});

test('real snapshot: silent attendees named in fenced thanks are NOT participants', () => {
  // The College host's closing utterance (19:39:49Z) thanks Orrin
  // Lowmarsh and Spark Archer, who never spoke at the College in the
  // window. Fenced text is testimony, never a roster: neither may appear.
  const ep = deriveEpisodes(voices, news).find((e) => e.place === 'EMBER_COLLEGE');
  assert.ok(!ep.participants.includes('Orrin Lowmarsh'));
  assert.ok(!ep.participants.includes('Spark Archer'));
});

test('real snapshot: single-speaker places never become episodes (negative control)', () => {
  const episodes = deriveEpisodes(voices, news);
  // EMBER_TOWNHALL: one utterance, one speaker (Atlas Meridian) — even
  // though a CITY_EVENT_BEGAN headline anchors townhall, there is no
  // episode: corroboration cannot manufacture an exchange.
  assert.ok(!episodes.some((e) => e.place === 'EMBER_TOWNHALL'));
  // STELLAR_E00_S04: one utterance, one speaker (Kevin Bianchi).
  assert.ok(!episodes.some((e) => e.place === 'STELLAR_E00_S04'));
});

test('real snapshot: the Plaza gathering derives, corroborated by the plaza headline', () => {
  const episodes = deriveEpisodes(voices, news);
  const plaza = episodes.filter((e) => e.place === 'EMBER_PLAZA_OF_UNITY');
  const evening = plaza.find((e) => e.firstUtc === '2026-11-01T22:56:57.135074+00:00');
  assert.ok(evening, 'expected the 22:56–23:12 Plaza episode');
  assert.equal(evening.utteranceCount, 9);
  assert.deepEqual(
    [...evening.participants].sort(),
    ['Arabela Protoser', 'Atlas Meridian', 'Kavi Marlow', 'Orrin Lowmarsh', 'Rocky Headlong'],
  );
  assert.equal(evening.corroborated, true);
  assert.equal(evening.corroboratedBy.at, '2026-11-01T22:58:46.858003+00:00');
});

test('real snapshot: no episode claims presence outside utterance instants', () => {
  // Every episode's span is exactly its first..last utterance stamps and
  // its participants are exactly its speakers — structurally there is no
  // interval-presence or roster field to overclaim with.
  for (const ep of deriveEpisodes(voices, news)) {
    assert.deepEqual(
      Object.keys(ep).sort(),
      ['corroborated', 'corroboratedBy', 'disclosure', 'firstUtc', 'lastUtc', 'participants', 'place', 'utteranceCount', 'where'],
    );
    assert.ok(Date.parse(ep.firstUtc) <= Date.parse(ep.lastUtc));
  }
});

test("real snapshot: Orrin Lowmarsh's excavations derive as an acts-only sequence of 17", () => {
  // Corrected census (GATHERING-EVIDENCE.md §3, as amended): 17 of the
  // 19 RUIN_EXCAVATED headlines name Orrin Lowmarsh across BOTH
  // phrasings — 12 "dug into an old ruin" + 5 "brought a {ledger|seal|
  // chart|tool} out of an old ruin" — 10:28:43Z to 13:02:19Z.
  const sequences = deriveActSequences(news);
  const orrin = sequences.find((s) => s.actor === 'Orrin Lowmarsh' && s.kind === 'RUIN_EXCAVATED');
  assert.ok(orrin, 'expected an Orrin Lowmarsh RUIN_EXCAVATED sequence');
  assert.equal(orrin.count, 17);
  assert.equal(orrin.acts.length, 17);
  const digs = orrin.acts.filter((a) => / dug into an old ruin /.test(a.phrase)).length;
  const finds = orrin.acts.filter((a) => / brought an? .+ out of an old ruin /.test(a.phrase)).length;
  assert.equal(digs, 12);
  assert.equal(finds, 5);
  assert.equal(orrin.firstUtc, '2026-11-01T10:28:43.559800+00:00');
  assert.equal(orrin.lastUtc, '2026-11-01T13:02:19.866250+00:00');
  // Labelled acts, never a state: the sequence carries no state field
  // and presents itself as acts-only with the acts disclosure.
  assert.equal(orrin.presentation, 'acts-only');
  assert.equal(orrin.disclosure, ACTS_DISCLOSURE);
  assert.ok(!('state' in orrin));
  assert.ok(!('doing' in orrin));
  // The remaining 2 of 19 are Nath Borowik's, also a sequence of acts.
  const nath = sequences.find((s) => s.actor === 'Nath Borowik' && s.kind === 'RUIN_EXCAVATED');
  assert.ok(nath);
  assert.equal(nath.count, 2);
  assert.equal(sequences.length, 2);
});

test('extractActor parses both RUIN_EXCAVATED phrasings and refuses the rest', () => {
  assert.equal(
    extractActor('RUIN_EXCAVATED', 'Orrin Lowmarsh dug into an old ruin at 19, -11.'),
    'Orrin Lowmarsh',
  );
  assert.equal(
    extractActor('RUIN_EXCAVATED', 'Orrin Lowmarsh brought a ledger out of an old ruin at 19, -11.'),
    'Orrin Lowmarsh',
  );
  // Event markers carry no per-actor act phrasing: no actor, never guessed.
  assert.equal(extractActor('CITY_EVENT_BEGAN', "Atlas Meridian's lecture began at the College."), null);
  assert.equal(extractActor('RUIN_EXCAVATED', 'An old ruin was dug into.'), null);
});

// --- Synthetic controls (labelled synthetic; never world data) ---

function syntheticVoices(said) {
  return { places: [{ code: 'SYNTHETIC_PLACE', where: 'a synthetic place', said }] };
}
const T = (s) => `2026-11-01T12:${s}+00:00`;

test('synthetic: a citizen named in fenced thanks but never speaking is not a participant', () => {
  const v = syntheticVoices([
    { at: T('00:00.000000'), by: 'Host One', id: 's1', said: 'Welcome, all.' },
    { at: T('01:00.000000'), by: 'Guest Two', id: 's2', said: 'A question.' },
    { at: T('02:00.000000'), by: 'Host One', id: 's3', said: 'Thanks to Guest Two and to Silent Sam, who never spoke.' },
  ]);
  const episodes = deriveEpisodes(v, null);
  assert.equal(episodes.length, 1);
  assert.deepEqual(episodes[0].participants, ['Host One', 'Guest Two']);
  assert.ok(!episodes[0].participants.includes('Silent Sam'));
  assert.equal(episodes[0].corroborated, false);
  assert.equal(episodes[0].corroboratedBy, null);
});

test('synthetic: one speaker with a single interjection is not an exchange', () => {
  const v = syntheticVoices([
    { at: T('00:00.000000'), by: 'Solo Talker', id: 's1', said: 'First.' },
    { at: T('01:00.000000'), by: 'Solo Talker', id: 's2', said: 'Second.' },
    { at: T('02:00.000000'), by: 'Passer By', id: 's3', said: 'One remark.' },
  ]);
  assert.deepEqual(deriveEpisodes(v, null), []);
});

test('synthetic: the bounded window splits runs across a long silence', () => {
  const a = { at: T('00:00.000000'), by: 'A One', id: 's1', said: 'x' };
  const b = { at: T('01:00.000000'), by: 'B Two', id: 's2', said: 'y' };
  const a2 = { at: T('02:00.000000'), by: 'A One', id: 's3', said: 'z' };
  // The same exchange replayed well past the window: two runs, of
  // which only the first is asserted here as the single derived
  // episode's content (the replay is a second, identical episode).
  const later = [a, b, a2].map((u, i) => ({
    ...u,
    id: 't' + i,
    at: new Date(Date.parse(u.at) + EXCHANGE_GAP_MS + 5 * 60000).toISOString(),
  }));
  const episodes = deriveEpisodes(syntheticVoices([...[a, b, a2], ...later]), null);
  // Two separate episodes of 3 — never one merged episode of 6
  // spanning the silence.
  assert.equal(episodes.length, 2);
  assert.equal(episodes[0].utteranceCount, 3);
  assert.equal(episodes[1].utteranceCount, 3);
  assert.ok(Date.parse(episodes[1].firstUtc) - Date.parse(episodes[0].lastUtc) > EXCHANGE_GAP_MS);
});

test('derivation is pure: same inputs, identical output', () => {
  assert.deepEqual(deriveEpisodes(voices, news), deriveEpisodes(voices, news));
  assert.deepEqual(deriveActSequences(news), deriveActSequences(news));
});
