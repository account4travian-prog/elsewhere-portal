// Elsewhere Portal — Arm A (Data): pure WorldData v2 derivation.
//
// deriveWorldDataV2(head, opts) projects the same archive head the v1
// deriver consumes into a portal.world-data/v2 object, per
// build/CONTRACT-V2-DRAFT.md (incl. the Hark mini-audit amendments of
// 2026-11-02, audits/HARK-M2-MINIAUDIT-2026-11-02.md). It builds ON the
// v1 derivation — every v1 field keeps its name, type, and semantics —
// and adds exactly the v2 delta:
//
//   changed: schema -> "portal.world-data/v2"
//   added:   citizens[].citizenId + citizens[].citizenIdStatus (M2.04
//            registry, via archive/identity-registry.json),
//            citizens[].citizenKey / firstSeenUtc / citizenCollisions
//            (already shipped under v1 by E1/M2.03, ratified here),
//            world.bookId (open world-book, world-books registry),
//            world.facts (citation of the separate portal.facts/v1
//            stream by schema id + seq, or null when no stream exists —
//            Hark Q4 amendment: absence is recorded, never omitted),
//            world.integritySource (Amendment A1 at the freeze: the
//            constant "none-in-tier-p" — M2.07's contract field; Tier P
//            publishes no building integrity, and the constant says so
//            in-band; a future real source changes the CONTRACT, never
//            this constant — the validator requires exactly this value),
//            episodes + actSequences (episodes.mjs, M2.08 disposition),
//            offices + ticker[].dueUtc (Amendment A3 carriage, 2026-11-03:
//            optional projections of overview/headline evidence — see
//            deriveOffices / tickerDueUtc below).
//   NOT emitted: scenes[] (reserved — Q2; the v2 validator rejects any
//            bundle that emits it), citizens[].presenceClass (deferred —
//            Q3; no derivation rule exists).
//
// PURITY: identical discipline to derive.mjs — no I/O, no wall-clock
// reads, no randomness; same inputs => byte-identical canonical output;
// sorts are code-unit comparisons only. All registry/book/facts inputs
// are passed in as parsed values by the builder (build-bundle-v2.mjs).
//
// citizenIdStatus (Hark Q1 amendment): a bare null citizenId cannot
// distinguish "never looked" from "cannot be bound", so the registry
// state rides beside it, mapped as:
//   registry state verified   -> BOUND            (citizenId = the id)
//   registry state ambiguous  -> CONFLICT         (citizenId = null)
//   registry state unverified -> UNBOUND_NO_ROUTE (citizenId = null)
//   no registry entry         -> UNBOUND_NO_ROUTE (citizenId = null)
// Only a verified entry carries an id — CONFLICT never auto-binds
// (Automation Package AUTO-B10) and an unverified record has no binding
// adopted. citizenKey remains the evidence key; it is never promoted
// into an identity (K4).

import { deriveWorldData, isPlainObject, unfence } from './derive.mjs';
import { deriveActSequences, deriveEpisodes } from './episodes.mjs';

export const SCHEMA_V2 = 'portal.world-data/v2';
export const FACTS_SCHEMA = 'portal.facts/v1';

// Amendment A1 (M2.07): the only value world.integritySource may carry
// under this contract. Tier P publishes no building integrity; if a real
// source ever appears, the contract is amended — this constant is not
// repurposed.
export const INTEGRITY_SOURCE = 'none-in-tier-p';

export const CITIZEN_ID_STATUSES = ['UNBOUND_NO_ROUTE', 'BOUND', 'CONFLICT'];

// Map one identity-registry entry (or its absence) to the bundle's
// { citizenId, citizenIdStatus } pair. Pure.
export function identityFor(registry, citizenKey) {
  const entry = registry?.entries?.[citizenKey];
  if (entry?.state === 'verified' && typeof entry.citizenId === 'string' && entry.citizenId !== '') {
    return { citizenId: entry.citizenId, citizenIdStatus: 'BOUND' };
  }
  if (entry?.state === 'ambiguous') {
    return { citizenId: null, citizenIdStatus: 'CONFLICT' };
  }
  return { citizenId: null, citizenIdStatus: 'UNBOUND_NO_ROUTE' };
}

// Normalise a facts-stream citation: only a portal.facts/v1 reference
// with an integer seq is citable; anything else is "no stream" (null).
export function normaliseFactsRef(factsRef) {
  if (
    factsRef &&
    factsRef.schema === FACTS_SCHEMA &&
    Number.isInteger(factsRef.seq) &&
    factsRef.seq >= 0
  ) {
    return { schema: FACTS_SCHEMA, seq: factsRef.seq };
  }
  return null;
}

// --- Amendment A3 carriage (2026-11-03, CONTRACT-V2.md §7 item 8) ---
//
// Two OPTIONAL projections of evidence the record already carries but
// v2-as-frozen did not project into the bundle. Both are projections,
// never inferences: a value is carried only where an archived route
// states it, and absence stays absence.
//
// offices: the overview route names Ember's mayor
// (overview.ember.mayor = { name, sits }). It is the ONLY route that
// names an office holder — the last-election record names no winner
// ("an agent"), and institution/board fellow counts are counts, not
// holders — so the projection reads that one source and no other. An
// office asserted anywhere else (a headline phrase, an utterance, a
// fixture record with no overview behind it) is NOT carried. The
// holder's citizenKey is attached only when the evidenced name
// matches exactly ONE citizen record in the bundle; a shared name
// binds neither (PORTAL-KEY: ambiguity never binds), and the entry
// then carries citizenKey: null beside the evidenced name.
export function deriveOffices(head, citizens) {
  const overview = head?.overview;
  if (!overview || !isPlainObject(overview.data)) return [];
  const mayor = overview.data.ember?.mayor;
  if (!isPlainObject(mayor) || mayor.sits === false) return [];
  const name = typeof mayor.name === 'string' ? unfence(mayor.name) : '';
  if (name === '') return [];
  const matches = (citizens ?? []).filter((c) => c.name === name);
  return [{
    office: 'MAYOR',
    name,
    citizenKey: matches.length === 1 ? matches[0].citizenKey : null,
    provenance: { route: 'overview', fetchedUtc: overview.fetchedUtc ?? null },
  }];
}

// dueUtc: a ticker item carries a due stamp only when its own source
// headline record carries one. The headline family's stamp vocabulary
// in the record is a closing stamp (closes_at — the field discussions
// and stories use for exactly this) or an explicit due_at; no other
// field is a due stamp, and a stamp on some OTHER record (a
// discussion's closes_at, a story's closes_at) is never attached to a
// headline — no headline references such a record, so there is no
// evidenced join. Tonight no headline in the archive carries either
// field, so the live ticker gains no dueUtc; the projection lights up
// unchanged if a headline ever carries one.
export const TICKER_DUE_FIELDS = ['due_at', 'closes_at'];

export function tickerDueUtc(headline) {
  if (!isPlainObject(headline)) return null;
  for (const field of TICKER_DUE_FIELDS) {
    const v = headline[field];
    if (typeof v === 'string' && v !== '' && Number.isFinite(Date.parse(v))) return v;
  }
  return null;
}

// Map "utc|text" -> dueUtc for every head headline carrying a stamp.
export function deriveTickerDues(head) {
  const dues = new Map();
  const headlines = head?.news?.data?.headlines;
  if (!Array.isArray(headlines)) return dues;
  for (const h of headlines) {
    const due = tickerDueUtc(h);
    if (due === null || typeof h?.at !== 'string' || typeof h?.phrase !== 'string') continue;
    dues.set(`${h.at}|${unfence(h.phrase)}`, due);
  }
  return dues;
}

// head: the v1 archive head ({ route: { data, fetchedUtc } }).
// opts: { bundleSeq, voicesSnapshots, identityRegistry, bookId, factsRef }
//   identityRegistry: parsed archive/identity-registry.json (or null)
//   bookId: the world-books registry's open book id (or null)
//   factsRef: { schema: 'portal.facts/v1', seq } (or null)
export function deriveWorldDataV2(head, {
  bundleSeq = 1,
  voicesSnapshots = null,
  identityRegistry = null,
  bookId = null,
  factsRef = null,
} = {}) {
  const v1 = deriveWorldData(head, { bundleSeq, voicesSnapshots });

  const citizens = v1.citizens.map((c) => ({
    ...c,
    ...identityFor(identityRegistry, c.citizenKey),
  }));

  const voicesData = head?.voices?.data ?? null;
  const newsData = head?.news?.data ?? null;

  // Amendment A3 carriage: offices (always present, may be []) and
  // ticker dueUtc (present on an item only where evidenced).
  const offices = deriveOffices(head, citizens);
  const dues = deriveTickerDues(head);
  const ticker = dues.size
    ? v1.ticker.map((t) => {
        const due = dues.get(`${t.utc}|${t.text}`);
        return due ? { ...t, dueUtc: due } : t;
      })
    : v1.ticker;

  return {
    ...v1,
    schema: SCHEMA_V2,
    offices,
    ticker,
    world: {
      ...v1.world,
      bookId: bookId ?? null,
      facts: normaliseFactsRef(factsRef),
      integritySource: INTEGRITY_SOURCE,
    },
    citizens,
    episodes: deriveEpisodes(voicesData, newsData),
    actSequences: deriveActSequences(newsData),
    // Deliberately absent (reserved/deferred, Q2/Q3): scenes,
    // citizens[].presenceClass. The v2 validator rejects both.
  };
}
