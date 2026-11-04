// Elsewhere Portal — scene work & gather choreography (M5.11,
// fixtures half). Renders M3.03's FROZEN action table
// (build/data/action-table.mjs) as staging plans: for each presented
// work/gather action, which clip plays (M4.08's work-clip library +
// kit-carried clips, via work-clips.mjs), how many cycles show, what
// counter the record carries, where the beat is performed (the act's
// evidenced cell, or the M4.14 footprint threshold of the place the
// record names), and the caption the table froze.
//
// This module is the choreography, not a claim. It consumes the
// frozen table's OUTPUT shapes (presented actions; coalesced
// work.delivered beats) and never re-derives acts, never parses
// speech, and never loosens the table's rules:
//
//   1. FIXTURES vs LIVE are different modes, stamped on every entry.
//      A fixture entry is a staging proof over synthetic record, in
//      the frozen shapes — it asserts nothing about the town.
//   2. LIVE work beats exist only as work.delivered beats, and a
//      delivered beat renders ONLY when it carries its deriver
//      citation: a non-empty facts list whose every fact is a
//      work.delivered fact emitted by deriveWorkDelivered. A beat
//      without facts, or with any foreign fact, is REFUSED (null) —
//      "no live figure shows a work beat without a deriver-cited
//      evidence route" (M5.11 exit gate) is a code path here, not a
//      promise. With DELIVERY_PATTERNS frozen empty, the deriver
//      cites none, so the live surface tonight is empty by rule
//      (GAP-2; the M2.08 hunt found no Tier P work-evidence source).
//   3. BATCHED rounds: one gather cycle per recorded round, capped
//      at 6 on screen, the record's full count on the counter
//      (plan/02 §3.6). INSTANT acts: exactly one beat, never looped.
//   4. deliver-mend + haul have NO carry locomotion clip in the CC0
//      spine. The gap is carried verbatim from the M4.08 coverage
//      record (clipCoverage()) and the readability lane's note —
//      never patched over with a stand-in clip.
//
// PURITY: no I/O, no wall-clock, no randomness. The footprint specs
// and clip library are data handed in by the caller.

import { FAMILY_CLIPS, clipCoverage } from './work-clips.mjs';

/** The work/gather scope of M5.11: exactly the families the M4.08
 *  coverage record speaks for. A family outside this list is not
 *  this item's choreography (travel is playback's, talk is M5.01's)
 *  and choreographAction returns null for it — never an invention. */
export const WORK_GATHER_FAMILIES = [
  'harvest', 'pick-up', 'excavate', 'deliver-mend', 'haul',
  'build-raise-install', 'make-craft', 'repair-frontier',
];

/** plan/02 §3.6 (BATCHED): "capped 6 on screen + `×N rounds`". */
export const MAX_CYCLES_ON_SCREEN = 6;

// The readability state each family stages as (M5.06's table,
// build/app/logic.mjs FAMILY_READABILITY — the scene test asserts
// this map agrees with that record family by family, so the two
// lanes cannot drift apart silently).
const FAMILY_STATE = {
  'harvest': 'gathering',
  'pick-up': 'working',
  'excavate': 'working',
  'deliver-mend': 'carrying',
  'haul': 'carrying',
  'build-raise-install': 'building-raised',
  'make-craft': 'working',
  'repair-frontier': 'working',
};

// The readability lane's gap notes for the two carry families,
// verbatim (build/app/logic.mjs FAMILY_READABILITY; the scene test
// asserts byte-equality against that record).
export const CARRY_GAP_NOTES = {
  'deliver-mend': 'GAP — no carry locomotion in the CC0 spine (SURFACE lane, M4.08). Icon + caption + counter carry the family; no clip is faked. Live beats additionally wait on delivery evidence (DELIVERY_PATTERNS is empty by rule).',
  'haul': 'GAP — no carry locomotion in the CC0 spine, the same gap as deliver-mend (SURFACE lane, M4.08), recorded the same way.',
};

// The primary clip per family. Sources: FAMILY_CLIPS (M4.08) for
// excavate / build-raise-install / repair-frontier / pick-up; the
// readability lane's ruling for harvest — the kit-carried `gather`
// clip is a KayKit Idle_B talk-POSE stand-in and is NOT counted, so
// the library's work-pickup performs the gather cycle (the lane's
// recorded clip for the family); make-craft performs on the
// kit-carried `type` (Working_A), as both records agree.
const PRIMARY_CLIP = {
  'excavate': 'work-dig',
  'build-raise-install': 'work-hammer',
  'repair-frontier': 'work-hammer',
  'make-craft': 'type',
  'harvest': 'work-pickup',
  'pick-up': 'work-pickup',
  'deliver-mend': null,
  'haul': null,
};

const bareClipName = (s) => String(s).replace(/ \(kit-carried\)$/, '');

/**
 * The per-family coverage record, resolved from the M4.08 record
 * (never copied): primary clip, alternates as the record lists
 * them, and — for the carry families — the gap, verbatim from both
 * lanes' records.
 */
export function familyTreatment(family) {
  if (!WORK_GATHER_FAMILIES.includes(family)) return null;
  const cov = clipCoverage();
  const covered = (cov.covered[family] || []).map(bareClipName);
  const primary = PRIMARY_CLIP[family];
  return {
    family,
    state: FAMILY_STATE[family],
    clip: primary,
    clipAlts: covered.filter((c) => c !== primary),
    libraryClip: FAMILY_CLIPS[family] ?? null,
    clipGap: cov.gaps[family] ?? null,
    gapNote: CARRY_GAP_NOTES[family] ?? null,
  };
}

/** The whole coverage table for the eight scope families. */
export function choreographyCoverage() {
  const out = {};
  for (const f of WORK_GATHER_FAMILIES) out[f] = familyTreatment(f);
  return out;
}

/** Index M4.14's footprint specs by place code (specs doc -> Map).
 *  A beat anchored to a specced place performs at that place's
 *  threshold (door.anchorDoor); an open place (door null) performs
 *  on the place itself. An anchor the specs do not carry resolves
 *  to null — placement is never invented. */
export function footprintIndex(specsDoc) {
  const map = new Map();
  for (const s of specsDoc?.specs || []) {
    if (s && typeof s.code === 'string') map.set(s.code, s);
  }
  return map;
}

function placeOf(action, footprints) {
  const acts = Array.isArray(action?.acts) ? action.acts : [];
  for (const a of acts) {
    if (a && Array.isArray(a.cell)) return { kind: 'cell', cell: a.cell.slice() };
  }
  const anchor = typeof action?.anchor === 'string' ? action.anchor
    : acts.find((a) => a && typeof a.anchor === 'string')?.anchor ?? null;
  if (anchor && footprints && footprints.has(anchor)) {
    const spec = footprints.get(anchor);
    return {
      kind: 'place', code: anchor, label: spec.label ?? anchor,
      threshold: spec.door ? (spec.door.anchorDoor ?? null) : null,
      openPlace: spec.door == null,
    };
  }
  return null;
}

/**
 * Choreograph one presented action (the frozen M3.03 shape) into a
 * render-log entry, or null when the family is outside M5.11's
 * work/gather scope. `mode` is 'fixture' or 'live' and is stamped
 * on the entry; the two are never confusable downstream.
 */
export function choreographAction(action, { mode = 'fixture', footprints = null } = {}) {
  if (!action || typeof action.family !== 'string') return null;
  const t = familyTreatment(action.family);
  if (!t) return null;
  const count = Number.isInteger(action.count) && action.count > 0 ? action.count : 1;
  const batched = action.verbClass === 'BATCHED';
  const cyclesShown = batched ? Math.min(count, MAX_CYCLES_ON_SCREEN) : 1;
  return {
    kind: 'presented-action',
    mode,
    actor: action.actor ?? null,
    family: action.family,
    verbClass: action.verbClass ?? null,
    beatForm: action.beatForm ?? null,
    state: t.state,
    clip: t.clip,
    clipGap: t.clipGap,
    gapNote: t.gapNote,
    cyclesShown,
    // An INSTANT beat plays once and stops; a BATCHED entry cycles
    // only within its shown rounds. Nothing loops open-endedly.
    loops: batched,
    rounds: batched
      ? Array.from({ length: count }, (_, i) => ({ round: i + 1, shown: i < cyclesShown }))
      : null,
    count,
    counterLabel: action.counterLabel ?? null,
    caption: action.caption ?? null,
    place: placeOf(action, footprints),
    actsCited: Array.isArray(action.acts) ? action.acts.length : 0,
    evidenceRoute: mode === 'live'
      ? 'the record itself: the presented action\'s cited acts (frozen M3.03 derivation)'
      : 'fixture presented action in the frozen M3.03 shape — staging proof, not a claim about the town',
  };
}

/**
 * Choreograph one coalesced work.delivered beat (the frozen
 * coalesceDelivered shape) — the ONLY live work-beat form. Refuses
 * (null) unless the beat carries its deriver citation: a non-empty
 * facts array of nothing but work.delivered facts. The performance
 * is the carrying treatment: caption on the first fact's tick, the
 * beat itself anchored to the figure's arrival node (the frozen
 * interface), icon + caption + counter — and no clip, per the
 * recorded carry gap.
 */
export function choreographDeliveredBeat(beat, { mode = 'fixture' } = {}) {
  if (!beat || beat.kind !== 'work.delivered') return null;
  const facts = Array.isArray(beat.facts) ? beat.facts : [];
  if (facts.length === 0) return null;
  if (!facts.every((f) => f && f.kind === 'work.delivered')) return null;
  const t = familyTreatment('deliver-mend');
  const count = Number.isInteger(beat.count) && beat.count > 0 ? beat.count : facts.length;
  return {
    kind: 'work.delivered',
    mode,
    actor: beat.actor ?? null,
    work: beat.work ?? null,
    family: 'deliver-mend',
    state: t.state,
    clip: null,
    clipGap: t.clipGap,
    gapNote: t.gapNote,
    cyclesShown: 1,
    loops: false,
    rounds: null,
    count,
    counterLabel: beat.counterLabel ?? null,
    caption: beat.caption ?? null,
    captionAt: beat.captionAt ?? facts[0].at ?? null,
    performAnchor: beat.performAnchor ?? 'arrival-node',
    deltas: Array.isArray(beat.deltas) ? beat.deltas.slice() : facts.map((f) => f.delta ?? null),
    evidenceRoute: 'deriver-cited: work.delivered fact(s) emitted by deriveWorkDelivered from DELIVERY_PATTERNS-registered headline(s)',
    headlineIds: facts.map((f) => f.headlineId ?? null),
  };
}
