// Elsewhere Portal — civic theatre stagings (M5.09).
//
// Four stagings the plan names — office hour, lecture, dinner,
// votes — each built ONLY from its recorded instance in the
// 2026-11-01 evening fixture (which is itself generated from the
// archived record; see gen-evening-fixture.mjs). A staging whose
// record does not exist is NOT performed: it is registered here
// with performed: false and the reason, in plain words. That is
// the plan working as designed, not a gap to route around.
//
// For a performed staging this module produces, deterministically:
//   - occupants: the episode's speakers exactly (never the names
//     a speech merely mentions — the College trap: the closing
//     thanks names two attendees who never spoke, and they are
//     NOT occupants), placed at stations by interiors.mjs with
//     evidenced roles honoured (the lecturer at the lectern);
//   - the talk scene: the shared scheduler's read of the episode
//     (logic.scheduleTalkScene) — the staging performs through the
//     ONE talk model, never a second one;
//   - ticker lines: from structured record fields only (the news
//     headline's own phrase + stamp) — never from speech;
//   - the Chronicle minutes pointer, in the M6.09 intake shape
//     ({pointer, episodeKey, placeCode, where}) — counts only,
//     utterance text never enters a pointer — WHEN the scheduler
//     produces one. Under the project owner's M5.07 ruling (2026-11-03) it
//     does not: these stagings perform RECORDED occasions, so
//     they schedule in recording mode and play in full; the 90 s
//     cap and its pointer govern live scenes only. The minutes
//     mechanism below stands wired exactly as built — it simply
//     has no capped scene to carry from a recorded occasion.

import { scheduleTalkScene, episodeKeyOf } from '../../app/logic.mjs';
import { interiorDef, assignStations } from './interiors.mjs';

export const STAGING_KINDS = ['office-hour', 'lecture', 'dinner', 'votes'];

function tickerLine(headline) {
  if (!headline) return null;
  return { atUtc: headline.at, text: headline.phrase, kind: headline.kind };
}

function stagingFromEpisode({ kind, episode, headline, roles = new Map(), registry }) {
  // A staging of a RECORDED occasion — recording mode (M5.07
  // ruling): the scene plays in full and yields no summary
  // pointer, so minutesLine below is null for every staging
  // tonight by the ruling's own arithmetic, not by absence.
  const scene = scheduleTalkScene(episode, { mode: 'recording' });
  const occupants = (episode.participants || []).map((name) => ({ name, citizenKey: name }));
  const def = interiorDef(registry, episode.place);
  const placed = def ? assignStations(def, occupants, roles) : [];
  return {
    kind,
    placeCode: episode.place,
    where: episode.where || null,
    atUtc: episode.firstUtc,
    performed: true,
    reason: null,
    occupants: occupants.map((o) => o.name),
    placed: placed.map((p) => ({
      name: p.citizen.name,
      at: p.at,
      position: p.position,
    })),
    tickerLines: [tickerLine(headline)].filter(Boolean),
    talkScene: scene ? {
      key: scene.key, total: scene.total, events: scene.events.length,
      capped: scene.capped, summary: scene.summary,
    } : null,
    minutesLine: scene && scene.summary ? {
      pointer: scene.summary,
      episodeKey: scene.key,
      placeCode: episode.place,
      where: episode.where || null,
    } : null,
  };
}

/** The lecturer's name, from the headline's own words — the
 *  structured record naming the role ("Atlas Meridian's lecture
 *  began at the College"), never inferred from who spoke most. */
export function lecturerFromHeadline(headline) {
  const m = headline && typeof headline.phrase === 'string'
    ? headline.phrase.match(/^(.+?)'s lecture began/)
    : null;
  return m ? m[1] : null;
}

/**
 * Build all four stagings from the evening fixture + the interior
 * registry. Deterministic; performs no I/O.
 */
export function buildStagings(fixture, registry) {
  const out = [];

  // -- office hour (Town Hall): the mayor's meeting headline +
  //    Atlas's one recorded utterance — a lone speaker, staged as
  //    one. No audience is invented for him.
  const office = fixture.episodes.officeHour;
  out.push(stagingFromEpisode({
    kind: 'office-hour', episode: office,
    headline: fixture.occasions.mayorsMeetingBegan, registry,
  }));

  // -- lecture (the College): the full recorded episode, the
  //    lecturer at the lectern by the headline's own naming.
  const lecturer = lecturerFromHeadline(fixture.occasions.lectureBegan);
  const roles = new Map();
  if (lecturer) roles.set(lecturer, 'lectern');
  out.push(stagingFromEpisode({
    kind: 'lecture', episode: fixture.episodes.lecture,
    headline: fixture.occasions.lectureBegan, roles, registry,
  }));

  // -- dinner (Meridian Hall, 23:20): the occasion is recorded;
  //    its words and guest list are not. Performed as an occasion
  //    only: the room, the hour, zero bubbles, zero figures.
  out.push({
    kind: 'dinner',
    placeCode: fixture.dinner.place,
    where: 'Meridian Hall',
    atUtc: fixture.dinner.atUtc,
    performed: true,
    performanceForm: 'occasion-only',
    reason: fixture.dinner.absent,
    occupants: [],
    placed: [],
    tickerLines: [],
    talkScene: null,
    minutesLine: null,
    bubbleCount: 0,
  });

  // -- votes: the record names a vote only inside another event's
  //    headline phrase ("A gathering the Town Hall voted for") —
  //    no instance with a place, a time, and a roster exists to
  //    replay. Not performed.
  out.push({
    kind: 'votes',
    placeCode: null,
    where: null,
    atUtc: null,
    performed: false,
    reason: 'No recorded instance: the public record names a vote only inside the Plaza '
      + 'gathering\'s headline ("A gathering the Town Hall voted for"). No source gives the '
      + 'vote a place, a time, or a roster, so there is nothing honest to stage.',
    occupants: [],
    placed: [],
    tickerLines: [],
    talkScene: null,
    minutesLine: null,
  });

  return out;
}

/** The minutes lines a set of stagings yields, in the M6.09 intake
 *  shape — one per capped talk scene, counts only. */
export function minutesLines(stagings) {
  return stagings.filter((s) => s.minutesLine).map((s) => s.minutesLine);
}
