// Elsewhere Portal — Arm A (Data): gathering EPISODES and work ACT
// SEQUENCES, derived from Tier P snapshots. Implements the M2.08 split
// disposition (AUTO-DECISIONS.md, 2026-11-02 18:30 CST; source analysis
// build/data/GATHERING-EVIDENCE.md):
//
//   - Gathering ships as DERIVED EPISODES. Tier P evidences speech
//     instants, never continuous presence: an utterance is a server-stamped
//     proof that speaker S was at place P at instant T, and nothing about
//     S at T-1 or T+1. An episode claims presence ONLY at the utterance
//     instants of its speakers, carries the DISCLOSURE below verbatim, and
//     is never presented as a "gathering now" state.
//   - Working ships as ACTS-ONLY. Headlines record discrete acts (actor,
//     kind, place, instant) with no duration and no in-progress flag, so
//     same-actor same-kind headlines group into ACT SEQUENCES — labelled
//     acts, never a state, never "X is working".
//
// PURITY (as derive.mjs): no I/O, no wall-clock reads, no randomness. Same
// inputs => identical output. All times come from stamps inside the inputs.
//
// EPISODE DERIVATION RULE (the window, defined and documented here):
//   Within one place, utterances are sorted by stamp. A run is a maximal
//   chain in which consecutive utterances are at most EXCHANGE_GAP_MS
//   (15 minutes) apart. A run is an EPISODE when:
//     (a) it has 2+ distinct speakers, AND
//     (b) the speakers INTERLEAVE: some speaker speaks again after a
//         different speaker has spoken (an A...B...A pattern). This is the
//         computable proxy for the evidence doc's "the utterances form an
//         exchange (they answer/address each other)": in the College worked
//         derivation it is literally true on the record (Atlas Meridian's
//         19:09:00Z reply answers two different speakers at once), and it
//         excludes one citizen talking with a single interjection, or two
//         citizens' lone remarks landing in the same window.
//   Gap justification: 15 min is half the 30-minute `talking` speech band
//   derive.mjs already ships, and on the only archived snapshot it sits
//   between the largest in-exchange gap (622 s, the College closing gap)
//   and the smallest between-cluster gap (1,252 s, the Plaza), with
//   margin on both sides. It is a derivation parameter, disclosed as
//   such — not a fact about the world.
//
// CORROBORATION: an episode is `corroborated` when a CITY_EVENT_BEGAN
// headline's `locate.anchor` maps to the episode's place code
// (ANCHOR_TO_PLACE below; anchors are the news route's short names for
// the three Ember civic places). The matching headline's id and stamp
// ride along as `corroboratedBy` so the flag is auditable. Corroboration
// is a cross-check on the occasion, never attendance evidence.
//
// PARTICIPANTS ARE SPEAKERS ONLY. Names inside utterance text are fenced
// agent speech (testimony), never parsed: the College host's closing
// thanks names Orrin Lowmarsh and Spark Archer, who attended but never
// spoke there — they must NOT appear in `participants`, and the
// DISCLOSURE says why the roster is partial.

export const EPISODE_SCHEMA = 'portal.episodes/v1';

// The bounded exchange window; see the header for its justification.
export const EXCHANGE_GAP_MS = 15 * 60 * 1000;

// Verbatim in spirit from GATHERING-EVIDENCE.md §4(b) (the recommended
// derived-episode wording). Carried on every episode object.
export const DISCLOSURE =
  'Presence is evidenced at the moments each of them spoke; the public feeds ' +
  'Portal reads do not show who else was present, who stayed silent, or when ' +
  'each of them left.';

// Carried on every act sequence: the acts-only honesty label
// (GATHERING-EVIDENCE.md §4(c)).
export const ACTS_DISCLOSURE =
  'Recorded acts only. The public feeds Portal reads show acts, not ongoing work.';

// News `locate.anchor` values -> voices place codes, for the three Ember
// civic places the news route anchors by name. Anchors with no entry
// corroborate nothing.
export const ANCHOR_TO_PLACE = {
  college: 'EMBER_COLLEGE',
  plaza: 'EMBER_PLAZA_OF_UNITY',
  townhall: 'EMBER_TOWNHALL',
};

// Actor extraction for act sequences, per headline kind. Tier P phrases
// are server-templated; each pattern names the actor group explicitly.
// A headline whose phrase matches no pattern for its kind yields NO
// actor and is never grouped — an unparsed actor is never guessed.
const ACTOR_PATTERNS = {
  RUIN_EXCAVATED: [
    /^(.+?) dug into an old ruin at /,
    /^(.+?) brought an? .+ out of an old ruin at /,
  ],
};

function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function stampMs(at) {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

// True when some speaker speaks again after a different speaker has
// spoken (A...B...A, not necessarily adjacent).
function interleaved(speakers) {
  const lastSeenAt = new Map();
  for (let i = 0; i < speakers.length; i++) {
    const s = speakers[i];
    if (lastSeenAt.has(s)) {
      for (let j = lastSeenAt.get(s) + 1; j < i; j++) {
        if (speakers[j] !== s) return true;
      }
    }
    lastSeenAt.set(s, i);
  }
  return false;
}

function episodeFromRun(place, run, beganByPlace) {
  const participants = [];
  for (const u of run) {
    if (!participants.includes(u.by)) participants.push(u.by);
  }
  const began = beganByPlace.get(place.code) || null;
  return {
    place: place.code,
    where: typeof place.where === 'string' ? place.where : null,
    participants,
    firstUtc: run[0].at,
    lastUtc: run[run.length - 1].at,
    utteranceCount: run.length,
    corroborated: began !== null,
    corroboratedBy: began ? { headlineId: began.id ?? null, at: began.at } : null,
    disclosure: DISCLOSURE,
  };
}

// deriveEpisodes(voicesData, newsData) -> episode[]
// voicesData: a voices payload ({ places: [{ code, where, said: [{at, by, said}] }] }).
// newsData: a news payload ({ headlines: [...] }) or null (nothing corroborates).
// Episodes are sorted by firstUtc, then place code (code-unit order).
export function deriveEpisodes(voicesData, newsData) {
  const beganByPlace = new Map();
  const headlines = newsData && Array.isArray(newsData.headlines) ? newsData.headlines : [];
  for (const h of headlines) {
    if (!h || h.kind !== 'CITY_EVENT_BEGAN') continue;
    const code = h.locate && ANCHOR_TO_PLACE[h.locate.anchor];
    if (code && !beganByPlace.has(code)) beganByPlace.set(code, h);
  }

  const episodes = [];
  const places = voicesData && Array.isArray(voicesData.places) ? voicesData.places : [];
  for (const place of places) {
    if (!place || typeof place.code !== 'string' || !Array.isArray(place.said)) continue;
    const utterances = place.said
      .filter((u) => u && typeof u.by === 'string' && u.by !== '' && stampMs(u.at) !== null)
      .slice()
      .sort((a, b) => (stampMs(a.at) - stampMs(b.at)) || cmpStr(String(a.id ?? ''), String(b.id ?? '')));

    // Chain into runs on the bounded gap, then keep only runs that are
    // exchanges: 2+ distinct speakers, interleaved.
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        const speakers = run.map((u) => u.by);
        if (new Set(speakers).size >= 2 && interleaved(speakers)) {
          episodes.push(episodeFromRun(place, run, beganByPlace));
        }
      }
      run = [];
    };
    for (const u of utterances) {
      if (run.length > 0 && stampMs(u.at) - stampMs(run[run.length - 1].at) > EXCHANGE_GAP_MS) flush();
      run.push(u);
    }
    flush();
  }

  episodes.sort((a, b) => cmpStr(a.firstUtc, b.firstUtc) || cmpStr(a.place, b.place));
  return episodes;
}

export function extractActor(kind, phrase) {
  const patterns = ACTOR_PATTERNS[kind];
  if (!patterns || typeof phrase !== 'string') return null;
  for (const re of patterns) {
    const m = re.exec(phrase);
    if (m) return m[1];
  }
  return null;
}

// deriveActSequences(newsData, { minActs = 2 } = {}) -> sequence[]
// Groups headlines by (actor, kind) where an actor parses. A sequence is
// { actor, kind, presentation: 'acts-only', count, firstUtc, lastUtc,
//   acts: [{ at, phrase, cell }], disclosure } — a list of recorded acts
// at their own instants. It asserts nothing between acts: no state, no
// duration, no "currently doing". Groups below minActs stay individual
// acts upstream and are not emitted. Sorted by firstUtc, actor, kind.
export function deriveActSequences(newsData, { minActs = 2 } = {}) {
  const headlines = newsData && Array.isArray(newsData.headlines) ? newsData.headlines : [];
  const groups = new Map();
  for (const h of headlines) {
    if (!h || typeof h.kind !== 'string' || stampMs(h.at) === null) continue;
    const actor = extractActor(h.kind, h.phrase);
    if (actor === null) continue;
    const key = actor + '\u0000' + h.kind;
    if (!groups.has(key)) groups.set(key, { actor, kind: h.kind, acts: [] });
    groups.get(key).acts.push({
      at: h.at,
      phrase: h.phrase,
      cell: h.locate && Array.isArray(h.locate.cell) ? h.locate.cell.slice() : null,
    });
  }

  const sequences = [];
  for (const g of groups.values()) {
    if (g.acts.length < minActs) continue;
    g.acts.sort((a, b) => cmpStr(a.at, b.at) || cmpStr(a.phrase, b.phrase));
    sequences.push({
      actor: g.actor,
      kind: g.kind,
      presentation: 'acts-only',
      count: g.acts.length,
      firstUtc: g.acts[0].at,
      lastUtc: g.acts[g.acts.length - 1].at,
      acts: g.acts,
      disclosure: ACTS_DISCLOSURE,
    });
  }
  sequences.sort((a, b) => cmpStr(a.firstUtc, b.firstUtc) || cmpStr(a.actor, b.actor) || cmpStr(a.kind, b.kind));
  return sequences;
}
