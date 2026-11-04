// Elsewhere Portal — the recorded evening of 2026-11-01 as a
// fixture (M5.07 / M5.09 raw material).
//
// Generated from the archived Wave 1 snapshots
// (build/data/archive/2026-11-02/voices-*.json + news-*.json —
// the poll pass that carries the evening inside its retrospective
// window) and the demo journey fixture. Nothing here is written
// from memory: every utterance is copied byte-for-byte from the
// archived voices payload, every occasion from the archived news
// payload or the demo fixture's recorded window, and the episode
// boundaries are the data layer's own derivation
// (build/data/episodes.mjs deriveEpisodes), cross-checked against
// the raw utterances this file carries.
//
// What the record does NOT contain is recorded as absent, in the
// fixture itself: the Meridian Hall dinner at 23:20 UTC has an
// occasion (the demo fixture's recorded window ends there; the
// master plan's M5.07 letter names it) but NO recorded words and
// NO evidenced occupants anywhere in Tier P — the voices payload
// carries no Meridian Hall place at all. The fixture says so, so
// no consumer can invent the dinner's speech or its guest list.
//
// Usage: node gen-evening-fixture.mjs [--check]

import { readFileSync, writeFileSync } from 'node:fs';

const ARCHIVE = new URL('../../data/archive/2026-11-02/', import.meta.url);
const voices = JSON.parse(readFileSync(new URL('voices-20261102T020714Z.json', ARCHIVE), 'utf8'));
const news = JSON.parse(readFileSync(new URL('news-20261102T020713Z.json', ARCHIVE), 'utf8'));
const demo = JSON.parse(readFileSync(new URL('../../fixtures/demo-journey.json', import.meta.url), 'utf8'));

const { deriveEpisodes, DISCLOSURE } = await import('../../data/episodes.mjs');

function episodeFromVoices(code, fromUtc, toUtc) {
  const place = voices.places.find((p) => p.code === code);
  if (!place) return null;
  const utterances = place.said
    .filter((u) => u.at >= fromUtc && u.at <= toUtc)
    .slice()
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .map((u) => ({ at: u.at, by: u.by, id: u.id, said: u.said }));
  if (!utterances.length) return null;
  return {
    place: code,
    where: place.where || null,
    participants: [...new Set(utterances.map((u) => u.by))],
    firstUtc: utterances[0].at,
    lastUtc: utterances[utterances.length - 1].at,
    utterances,
    disclosure: DISCLOSURE,
  };
}

function headline(kind, atPrefix) {
  return news.headlines.find((h) => h.kind === kind && h.at.startsWith(atPrefix)) || null;
}

export function buildEveningFixture() {
  const derived = deriveEpisodes(voices, news);
  const lectureDerived = derived.find((e) => e.place === 'EMBER_COLLEGE');
  const plazaDerived = derived.find((e) => e.place === 'EMBER_PLAZA_OF_UNITY'
    && e.firstUtc.startsWith('2026-11-01T22:'));
  const lecture = episodeFromVoices('EMBER_COLLEGE', '2026-11-01T18:00:00Z', '2026-11-01T20:00:00Z');
  const storytelling = episodeFromVoices('EMBER_PLAZA_OF_UNITY', '2026-11-01T22:56:00Z', '2026-11-01T23:13:00Z');
  const officeHour = episodeFromVoices('EMBER_TOWNHALL', '2026-11-01T15:00:00Z', '2026-11-01T16:00:00Z');
  return {
    schema: 'portal.evening-fixture/v1',
    evening: '2026-11-01',
    generatedBy: 'build/visual/scene/gen-evening-fixture.mjs',
    sources: {
      voices: 'build/data/archive/2026-11-02/voices-20261102T020714Z.json',
      news: 'build/data/archive/2026-11-02/news-20261102T020713Z.json',
      demoJourney: 'build/fixtures/demo-journey.json',
    },
    // The derivation's own read of the same snapshots — the gate
    // compares the raw episodes below against these, so the fixture
    // can never quietly drift from what the deriver sees.
    derivedCrossCheck: {
      lecture: lectureDerived ? {
        participants: lectureDerived.participants, firstUtc: lectureDerived.firstUtc,
        lastUtc: lectureDerived.lastUtc, utteranceCount: lectureDerived.utteranceCount,
        corroboratedBy: lectureDerived.corroboratedBy,
      } : null,
      storytelling: plazaDerived ? {
        participants: plazaDerived.participants, firstUtc: plazaDerived.firstUtc,
        lastUtc: plazaDerived.lastUtc, utteranceCount: plazaDerived.utteranceCount,
        corroboratedBy: plazaDerived.corroboratedBy,
      } : null,
    },
    occasions: {
      lectureBegan: headline('CITY_EVENT_BEGAN', '2026-11-01T19:04'),
      mayorsMeetingBegan: headline('CITY_EVENT_BEGAN', '2026-11-01T15:22'),
      gatheringBegan: headline('CITY_EVENT_BEGAN', '2026-11-01T22:58'),
    },
    episodes: { lecture, storytelling, officeHour },
    arrival: {
      // Atlas's recorded legs for the evening stand on the demo
      // journey fixture (a staging input — its own note says its
      // ticks are staging, not a measured world tick) plus his
      // recorded Plaza utterance at 23:12:30Z, the storytelling
      // episode's last word. The gate states this basis out loud.
      journey: {
        handle: demo.handle, name: demo.name, path: demo.path,
        startTick: demo.startTick, ticksPerStep: demo.ticksPerStep,
        note: demo.note,
      },
      recordedWindowUtc: demo.recordedWindowUtc,
      atlasPlazaUtteranceUtc: '2026-11-01T23:12:30.519500+00:00',
    },
    dinner: {
      place: 'EMBER_DISTRICT_3_PLOT_18',
      atUtc: '2026-11-01T23:20:00Z',
      basis: 'the demo journey fixture\'s recordedWindowUtc end + the master plan\'s M5.07 letter',
      episode: null,
      occupants: [],
      absent: 'No recorded words at Meridian Hall exist in the archived voices payload '
        + '(it carries no Meridian Hall place), and no Tier P source names the dinner\'s '
        + 'attendees. The occasion is staged; its speech and guest list are not, because '
        + 'they are not recorded.',
    },
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const fixture = buildEveningFixture();
  const text = JSON.stringify(fixture, null, 1) + '\n';
  const outUrl = new URL('./fixtures/evening-2026-11-01.json', import.meta.url);
  if (process.argv.includes('--check')) {
    if (readFileSync(outUrl, 'utf8') !== text) { console.error('evening fixture differs from a fresh generation'); process.exit(1); }
    console.log('evening-2026-11-01.json is current');
  } else {
    writeFileSync(outUrl, text);
    console.log('wrote fixtures/evening-2026-11-01.json');
  }
}
