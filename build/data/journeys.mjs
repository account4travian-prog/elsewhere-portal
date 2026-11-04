// Elsewhere Portal — Arm A (Data): JOURNEY RECONSTRUCTION (M3.01 /
// WP-09). Pure derivation, same discipline as derive.mjs / episodes.mjs:
// no I/O, no wall-clock reads, no randomness. Same inputs => identical
// output. All times come from stamps inside the inputs.
//
// WHAT THIS IS. Tier P evidences speech instants, never movement: an
// utterance is a server-stamped proof that speaker S was at place P at
// instant T (the episodes honesty rule). When one citizen's evidenced
// placements change — last evidenced at origin A, next evidenced at a
// different place B — the record supports exactly one movement claim:
// they were at A at the departure bound, and at B at the arrival bound,
// and travelled somewhere in between. This module turns consecutive
// evidenced placements into RECONSTRUCTED JOURNEYS: one leg per place
// change, scheduled inside its evidence window (departure tick = tick
// of the last origin evidence, arrival tick = tick of the first
// destination evidence, so playback never shows an arrival earlier
// than the record first evidenced the destination), labelled
// `reconstructed: true` and carrying JOURNEY_DISCLOSURE verbatim. The
// PATH walked between the endpoints is the layout graph's (the
// engine's job, verified by the no-teleport invariant); presence is
// claimed only at the evidenced endpoints. Between them the citizen's
// whereabouts are inference, and the disclosure says so.
//
// WHY THIS IS NOT IN THE BUNDLE. The WorldData v2 contract is FROZEN
// (build/CONTRACT-V2.md, M2.11): no new bundle fields until a v3.
// Journeys therefore ship as a companion artefact — feed/journeys.json,
// schema portal.journeys/v1 — exactly as episodes did before them
// (episodes-cycle.mjs). derive.mjs's bundle `journeys: []` stays as
// the frozen contract has it.
//
// THE CEILING — ADOPTED HERE, AN OPEN DECISION, SURFACED NOT BURIED.
// M3.01's plan text reads "Ceiling set by M1.10 (R7)". The M1.10
// travel-reply spike note DOES NOT EXIST anywhere in this tree (the
// M3 wave brief records the search; the spike itself is gated on
// the project owner's go and has not run). No ceiling paragraph exists to cite,
// and none is invented here. The ceiling adopted below is the
// conservative one the shipped record supports, built from parts the
// tree already defines:
//
//   A leg reconstructs ONLY when all of these hold:
//   (1) Same citizen, same world-book. The input snapshot set is one
//       book's voices snapshots (the cycle scopes it by the book
//       boundary in archive/world-books.json, exactly as plot
//       existence is book-scoped in derive.mjs). A leg never spans a
//       world reset.
//   (2) Both bounds are utterance evidence: the departure bound is the
//       citizen's LAST utterance at the origin before the change; the
//       arrival bound is their FIRST utterance at the destination.
//       A citizen who vanishes and is never evidenced again produces
//       no leg — there is no destination evidence to bound a journey
//       by (the plan's vanish window).
//   (3) COVERAGE: the archiver was actually watching throughout the
//       evidence window. Formally: the window (departureUtc,
//       arrivalUtc] lies inside the era [first, last] of successful
//       voices fetches, and no interval between consecutive successful
//       voices fetches longer than MAX_EVIDENCE_GAP_MS intersects it.
//       MAX_EVIDENCE_GAP_MS = GAP_FACTOR (2, health.mjs) × the voices
//       cadence (120 s, cadence.json) = 240 s — the same threshold
//       health.mjs already uses to call a stretch of the archive a
//       gap. Inside a longer silence, utterances the citizen spoke at
//       a THIRD place could have scrolled off the server's rolling
//       window before our next fetch; an A->B leg drawn across the
//       dark could really have been A->C->B, and the record we hold
//       could not tell. So the leg is not drawn. This rejects, among
//       others, every leg whose window touches the ~22.3 h
//       pre-scheduler silence (2026-11-02T02:07Z -> 2026-11-03T00:27Z)
//       and every leg evidenced only retroactively through the
//       rolling window before the archiver's first fetch: retroactive
//       capture is not coverage, because the window's depth is
//       nowhere stated in Tier P and the scrolled-off residue is
//       unauditable. (The rejected alternative — treating the rolling
//       window as coverage wherever utterances survive — would let a
//       fetch silence manufacture journeys out of evidence whose
//       completeness cannot be checked.)
//
//   OPEN DECISION (for the project owner / the M1.10 spike, when it runs): this
//   ceiling is Portal's conservative interim. If the spike produces
//   the cited one-paragraph ceiling, it supersedes this section and
//   the change is a ceiling change, not a rewrite: the rule lives in
//   `windowCovered` + MAX_EVIDENCE_GAP_MS and nowhere else.
//
// TICKS. Playback ticks are 30 s (engine/playback.mjs TICK_SECONDS).
// The tree has no measured world-tick epoch (the demo fixture's
// startTick is "an arbitrary staging origin, not a measured world
// tick"), so this artefact anchors its own: tickEpochUtc is the
// world-book's opened_at, named in every document it heads, and
// tick(t) = floor((t - epoch) / 30 s). The UTC bounds on each journey
// are the authority; ticks are the playback schedule derived from
// them. A leg whose bounds fall inside one tick is scheduled as a
// 0-tick near-reach leg — the engine's disclosed semantics for a leg
// the record charges no measurable time (Plan B §3.4).
//
// INTERFACE NOTE — "arrival" across M3.01 / M3.03 (coordination,
// 2026-11-02). The M3.03 action table's coalesced work.delivered
// beats carry `performAnchor: 'arrival-node'`: the beat's performance
// anchors to the figure's ARRIVAL NODE — a PLACE. This module's
// `arrival*` fields are the other axis — TIMES: `arrivalUtc` is the
// first destination-evidence stamp, `arrivalTick` its scheduled tick
// (the engine's own word: playback.mjs's catchUp returns the same
// `arrivalTick`). The spatial arrival in this shape is `to` (path[1]).
// Mapping for consumers (M3.04 / M3.06 / M5.11): a beat anchored
// 'arrival-node' against one of these journeys is performed at node
// `to`, reached at tick `arrivalTick`. Neither vocabulary renames:
// M3.03's anchor names the place, this module's fields name the time,
// and the engine already uses `arrivalTick` for the moment.
//
// CITIZEN KEYS. Journeys are keyed by the PORTAL-KEY (derive.mjs,
// M2.03): the key of the speaker's record, assigned by the same
// assignCitizenKeys over the speaker set. The live bundle's
// citizenCollisions is empty, so today these keys coincide with the
// bundle's voices-record keys. If a namesake collision ever splits
// suffixes differently in a bundle (its ordering spans news records
// too), the journey's `name` field is the disambiguating authority
// and the key remains a record label, never an identity — audit
// conditions (1)-(5) in derive.mjs apply unchanged.

import { assignCitizenKeys, cmpStr, isPlainObject, unfence } from './derive.mjs';

export const JOURNEY_SCHEMA = 'portal.journeys/v1';

// The reconstruction honesty label. Carried on the document and on
// every journey object, verbatim (the episodes pattern).
export const JOURNEY_DISCLOSURE =
  'This journey is reconstructed from the public feeds Portal reads: the citizen was ' +
  'evidenced at the origin when they last spoke there, and at the ' +
  'destination when they first spoke there. The walk between is Portal ' +
  'scheduling that evidence window, not an observed path; the public feeds ' +
  'Portal reads do not show when they left, which way they went, or whether they stopped ' +
  'along the way.';

// Playback tick length, matching engine/playback.mjs TICK_SECONDS.
export const TICK_MS = 30 * 1000;

// The ceiling's gap threshold under the default cadence: GAP_FACTOR 2
// (health.mjs) × voices cadence 120 s (cadence.json). The cycle passes
// the value it derives from the live cadence.json; this constant is
// the fallback and the test pin.
export const MAX_EVIDENCE_GAP_MS = 2 * 120 * 1000;

function stampMs(at) {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

// True when the evidence window (depMs, arrMs] was under continuous
// archiver coverage: inside the successful-fetch era and crossed by
// no fetch silence longer than maxGapMs. See the ceiling, rule (3).
export function windowCovered(fetchMs, depMs, arrMs, maxGapMs = MAX_EVIDENCE_GAP_MS) {
  if (!Array.isArray(fetchMs) || fetchMs.length === 0) return false;
  if (depMs < fetchMs[0] || arrMs > fetchMs[fetchMs.length - 1]) return false;
  for (let i = 0; i + 1 < fetchMs.length; i++) {
    const a = fetchMs[i];
    const b = fetchMs[i + 1];
    if (b - a > maxGapMs && a < arrMs && b > depMs) return false;
  }
  return true;
}

/**
 * reconstructJourneys({ voicesSnapshots, voicesFetchUtc, book,
 *                       maxEvidenceGapMs }) -> portal.journeys/v1 doc
 *
 * voicesSnapshots: one world-book's voices snapshots, any order:
 *   [{ data, fetchedUtc, file }] — `file` is the archive-relative name
 *   used for evidence attribution (may be null).
 * voicesFetchUtc: every successful voices fetch stamp (ISO strings),
 *   any order — the coverage record (the cycle reads fetch-log.jsonl).
 * book: { id, openedAtUtc } — the book the snapshots belong to;
 *   openedAtUtc anchors the tick epoch.
 */
export function reconstructJourneys({
  voicesSnapshots = [],
  voicesFetchUtc = [],
  book = { id: null, openedAtUtc: null },
  maxEvidenceGapMs = MAX_EVIDENCE_GAP_MS,
} = {}) {
  const epochMs = stampMs(book?.openedAtUtc);
  const fetchMs = (Array.isArray(voicesFetchUtc) ? voicesFetchUtc : [])
    .map(stampMs)
    .filter((ms) => ms !== null)
    .sort((a, b) => a - b);

  // Utterance union over the book's snapshots, deduplicated by the
  // server utterance id (falling back to speaker|stamp|place where a
  // payload carries no id). The FIRST snapshot in fetch order that
  // contains an utterance is recorded as its evidencing snapshot.
  const orderedSnapshots = [...voicesSnapshots]
    .filter((s) => s && isPlainObject(s.data))
    .sort((a, b) => cmpStr(a.fetchedUtc ?? '', b.fetchedUtc ?? ''));
  const utterances = new Map(); // dedupe key -> utterance record
  for (const snap of orderedSnapshots) {
    for (const place of Array.isArray(snap.data.places) ? snap.data.places : []) {
      if (!isPlainObject(place) || typeof place.code !== 'string') continue;
      for (const said of Array.isArray(place.said) ? place.said : []) {
        if (!isPlainObject(said) || typeof said.by !== 'string' || typeof said.at !== 'string') continue;
        const ms = stampMs(said.at);
        if (ms === null) continue;
        const key = typeof said.id === 'string' && said.id.length > 0
          ? `id:${said.id}`
          : `raw:${said.by}|${said.at}|${place.code}`;
        if (utterances.has(key)) continue;
        utterances.set(key, {
          name: unfence(said.by),
          placeCode: place.code,
          atUtc: said.at,
          ms,
          id: typeof said.id === 'string' && said.id.length > 0 ? said.id : null,
          snapshotFile: snap.file ?? null,
        });
      }
    }
  }

  // One timeline per speaker, in stamp order (id as the tiebreak, the
  // episodes sort discipline).
  const timelines = new Map();
  for (const u of utterances.values()) {
    if (!timelines.has(u.name)) timelines.set(u.name, []);
    timelines.get(u.name).push(u);
  }
  for (const tl of timelines.values()) {
    tl.sort((a, b) => (a.ms - b.ms) || cmpStr(a.id ?? '', b.id ?? ''));
  }

  // PORTAL-KEYs over the speaker set, by the bundle's own scheme.
  const speakerRecords = [...timelines.entries()].map(([name, tl]) => {
    const last = tl[tl.length - 1];
    return {
      name,
      state: '',
      placeCode: last.placeCode,
      evidenceUtc: last.atUtc,
      provenance: { route: 'voices', fetchedUtc: last.snapshotFile },
    };
  });
  speakerRecords.sort((a, b) => cmpStr(a.name, b.name));
  assignCitizenKeys(speakerRecords);
  const keyByName = new Map(speakerRecords.map((r) => [r.name, r.citizenKey]));

  // Legs: walk each timeline in runs of one place. A place change
  // closes a leg — departure bound = the run's LAST utterance,
  // arrival bound = the next run's FIRST utterance — and the ceiling
  // decides whether the leg may be drawn.
  const journeys = [];
  let candidateLegs = 0;
  let rejectedDarkLegs = 0;
  for (const [name, tl] of timelines) {
    let runPlace = tl[0].placeCode;
    let runLast = tl[0];
    for (let i = 1; i < tl.length; i++) {
      const u = tl[i];
      if (u.placeCode === runPlace) {
        runLast = u;
        continue;
      }
      candidateLegs++;
      const dep = runLast;
      const arr = u;
      if (windowCovered(fetchMs, dep.ms, arr.ms, maxEvidenceGapMs)) {
        const departureTick = epochMs === null ? null : Math.floor((dep.ms - epochMs) / TICK_MS);
        const arrivalTick = epochMs === null ? null : Math.floor((arr.ms - epochMs) / TICK_MS);
        const worldTicks = departureTick === null ? null : arrivalTick - departureTick;
        journeys.push({
          citizenKey: keyByName.get(name),
          name,
          from: dep.placeCode,
          to: arr.placeCode,
          path: [dep.placeCode, arr.placeCode],
          reconstructed: true,
          disclosure: JOURNEY_DISCLOSURE,
          departureUtc: dep.atUtc,
          arrivalUtc: arr.atUtc,
          departureTick,
          arrivalTick,
          worldTicks,
          nearReach: worldTicks === 0,
          evidence: {
            departureUtteranceId: dep.id,
            arrivalUtteranceId: arr.id,
            departureSnapshotFile: dep.snapshotFile,
            arrivalSnapshotFile: arr.snapshotFile,
          },
        });
      } else {
        rejectedDarkLegs++;
      }
      runPlace = u.placeCode;
      runLast = u;
    }
  }
  journeys.sort((a, b) =>
    cmpStr(a.citizenKey, b.citizenKey) ||
    cmpStr(a.departureUtc, b.departureUtc) ||
    cmpStr(a.to, b.to));

  const snapshotFiles = orderedSnapshots.map((s) => s.file ?? null).filter(Boolean);
  return {
    schema: JOURNEY_SCHEMA,
    bookId: book?.id ?? null,
    tickEpochUtc: book?.openedAtUtc ?? null,
    tickSeconds: TICK_MS / 1000,
    ceiling: {
      maxEvidenceGapMs,
      rule: 'same citizen, same world-book; both bounds utterance-evidenced; ' +
        'the evidence window under continuous voices-fetch coverage (no ' +
        'silence longer than maxEvidenceGapMs = 2 x the voices cadence)',
    },
    disclosure: JOURNEY_DISCLOSURE,
    generatedFrom: {
      voicesSnapshotCount: orderedSnapshots.length,
      firstVoicesSnapshotFile: snapshotFiles.length ? snapshotFiles[0] : null,
      lastVoicesSnapshotFile: snapshotFiles.length ? snapshotFiles[snapshotFiles.length - 1] : null,
      voicesFetchCount: fetchMs.length,
    },
    stats: {
      speakers: timelines.size,
      utterances: utterances.size,
      candidateLegs,
      reconstructed: journeys.length,
      rejectedDarkLegs,
    },
    journeys,
  };
}
