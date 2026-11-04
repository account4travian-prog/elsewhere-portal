// Elsewhere Portal — M3.03: the CITY ACTION TABLE + COALESCING.
// Implements plan-to-complete M3.03 (Lead M3.2 / SE-2.4):
//
//   "every verb family by its true class (durational → walked; batched
//    → rounds + counter; instant → one beat; social → scenes at M5);
//    repeated `work.delivered` coalesces to one beat + `×N`
//    (speech exempt)"
//
// Sources (every mapping below cites one):
//   - Verb families and their TRUE classes: research/01-elsewhere.md §5
//     (the action vocabulary: DURATIONAL / INSTANT / BATCHED /
//     SOCIAL-DURATIONAL, per verb family, from the world's own API
//     semantics). These entries are PROVENANCE 'plan-named'.
//   - Class → beat staging: plan/02-technical-plan.md §3.6 (the city
//     action table: verb class → beat), §3.5 (queues, coalescing, the
//     Portal fact kinds), and plan/01-product-ux-plan.md's redundancy
//     rule (animation suggests, icon specifies, caption states;
//     "repeats coalesce into one beat with a count").
//   - Recorded act kinds: the news route's headline kinds, censused
//     over the whole archive at build time (see
//     test/action-table.test.mjs's completeness test, which re-censuses
//     the live archive and fails if a kind appears that this table does
//     not map or explicitly leave unmapped-with-reason). These entries
//     are PROVENANCE 'record-evidenced'.
//
// HOME: this module sits in build/data beside episodes.mjs because its
// inputs are data-layer derivations (news payloads; act sequences from
// episodes.mjs, REUSED here — grouping is never re-implemented). The
// frozen M3 playback interface is the SHAPES below (presented actions,
// presented events, delivered beats); the engine/scheduler consumes
// them later (M5.11 renders choreography against this frozen table).
// Nothing here changes the frozen WorldData v2 bundle: no bundle field
// is added, removed, or reshaped by this module.
//
// PURITY (as episodes.mjs): no I/O, no wall-clock reads, no randomness.
// Same inputs => identical output. All times come from the inputs.
//
// HONESTY RULES (binding on everything below):
//   1. The table CLASSIFIES the record; it never invents acts. A kind
//      the table does not know gets the plan's forward-compatible
//      default (Plan B §3.5: generic object beat + Chronicle line from
//      the raw headline) and is reported UNMAPPED — never silently
//      forced into a class.
//   2. SPEECH NEVER COALESCES and never passes through this module at
//      all (M3.03 "speech exempt"; M5.01 "speech never coalesces").
//      This module reads news headlines only. Words inside voices/chats
//      payloads are fenced agent speech (testimony) and are never
//      parsed for acts or deliveries.
//   3. `work.delivered` is a Portal fact kind (Plan B §3.5), sourced in
//      the plan from a works integrity delta — a source Tier P does
//      not publish (GAP-1). It is therefore emitted ONLY when a
//      headline's own phrase records a delivery, via a registered
//      delivery-evidence pattern (DELIVERY_PATTERNS). NO current kind
//      registers one, because the public feeds Portal reads contain no delivery evidence:
//      "brought a tool out of an old ruin" records an EXTRACTION (no
//      recipient, no work, no delta), and the word "delivered" occurs
//      in the archive only inside fenced citizen speech. The current
//      archive therefore yields ZERO work.delivered facts — by rule,
//      not for lack of code. Act counts alone NEVER emit one (the
//      negative controls in the test file pin this).

import { deriveActSequences, extractActor } from './episodes.mjs';

// ------------------------------------------------------------------
// Classes (research/01 §5) and beat forms (plan/02 §3.6)
// ------------------------------------------------------------------

export const ACTION_CLASSES = ['DURATIONAL', 'SOCIAL-DURATIONAL', 'BATCHED', 'INSTANT'];

// Beat forms a presentation can take. 'hostile' is not a class — the
// Outlands families are INSTANT declarations whose PRESENTATION is
// icon + Chronicle only, no staged combat (plan/02 §3.6, Paper 03 #22).
export const BEAT_FORMS = ['walked', 'rounds', 'one-beat', 'scene', 'ticker', 'chronicle-only'];

// Plan B §3.6: captions name the verb, the citizen, the place — plain
// present tense, no invented motive (plan/01 redundancy rule (3)).
// Figure-act captions are built as "{actor} {verbPhrase}" plus the
// counter label when coalesced; headline-event captions are the
// record's own phrase, verbatim.

// ------------------------------------------------------------------
// The verb-family table (plan-named; research/01 §5 + plan/02 §3.6)
// ------------------------------------------------------------------

// Each entry: family (the §5 row's name), verbs (representative),
// verbClass (the §5 class; where §5 states a dual class, classAsStated
// keeps its wording and verbClass carries the presentation-governing
// one), beatForm + beat (plan/02 §3.6), tags (honesty tags from §3.6:
// 'by-program' / 'by-standing-order'), provenance, source.
export const VERB_FAMILIES = [
  { family: 'travel', verbs: ['travel'], verbClass: 'DURATIONAL', beatForm: 'walked',
    beat: 'Walked journey, step by step; carry prop where a delivery loop evidences a load. Inspector: "reconstructed" (Tier P v1, always).',
    provenance: 'plan-named', source: 'research/01 §5 (Travel); plan/02 §3.6 DURATIONAL' },
  { family: 'move', verbs: ['move'], verbClass: 'DURATIONAL', beatForm: 'walked',
    beat: 'One walked step of a journey (same staging as travel).',
    provenance: 'plan-named', source: 'research/01 §5 (Move); plan/02 §3.6 DURATIONAL' },
  { family: 'say', verbs: ['say'], verbClass: 'INSTANT', beatForm: 'scene',
    beat: 'Speech bubble carrying the recorded words at the evidenced place (scene machinery is M5.01). Speech never coalesces.',
    provenance: 'plan-named', source: 'research/01 §5 (Say); plan/02 §3.6 SOCIAL-DURATIONAL (talk staging)' },
  { family: 'chat', verbs: ['chat'], verbClass: 'INSTANT', beatForm: 'scene',
    beat: 'Channel messages as recorded; speech never coalesces.',
    provenance: 'plan-named', source: 'research/01 §5 (Chat); M5.01 (speech never coalesces)' },
  { family: 'tell', verbs: ['tell', 'letter'], verbClass: 'SOCIAL-DURATIONAL',
    classAsStated: 'INSTANT to send; SOCIAL-DURATIONAL to be read', beatForm: 'chronicle-only',
    beat: 'Never displayed: tell content is private and Portal is not party to it (research/01 §5). No beat exists for this family.',
    provenance: 'plan-named', source: 'research/01 §5 (Tell / letter)' },
  { family: 'board-post', verbs: ['board post', 'board reply'], verbClass: 'INSTANT', beatForm: 'one-beat',
    beat: 'One short beat at the board\'s place; the thread itself is read, not staged.',
    provenance: 'plan-named', source: 'research/01 §5 (Board post/reply); plan/02 §3.6 INSTANT' },
  { family: 'observe', verbs: ['observe'], verbClass: 'INSTANT', beatForm: 'one-beat',
    beat: 'Observe pose at the square studied; the LAND record is the receipt.',
    provenance: 'plan-named', source: 'research/01 §5 (Observe / survey); plan/02 §3.6 (survey/inquiry chapter beat)' },
  { family: 'survey', verbs: ['survey', 'commission survey'], verbClass: 'SOCIAL-DURATIONAL',
    classAsStated: 'INSTANT observe; commission SOCIAL-DURATIONAL', beatForm: 'scene',
    beat: 'Chapter beat at the square studied: observe pose, caption naming the commission, graded verdict when the record carries it — never a generic "worked" icon.',
    provenance: 'plan-named', source: 'research/01 §5 (Observe / survey); plan/02 §3.6 (most-staged verbs: survey/inquiry)' },
  { family: 'inquiry', verbs: ['prospect', 'inquiry'], verbClass: 'SOCIAL-DURATIONAL', beatForm: 'scene',
    beat: 'Chapter beat in the record\'s own order (predict → look → report → revise); the prediction was locked before travel and the staging keeps that order.',
    provenance: 'plan-named', source: 'research/01 §5 (Prospect / inquiry); plan/02 §3.6 (most-staged verbs)' },
  { family: 'harvest', verbs: ['harvest', 'gather'], verbClass: 'BATCHED', beatForm: 'rounds',
    beat: 'One gather cycle per recorded round, capped 6 on screen + `×N rounds` counter. The count is the record\'s; the seconds are Portal\'s, labelled in the inspector.',
    provenance: 'plan-named', source: 'research/01 §5 (Harvest / gather); plan/02 §3.6 BATCHED' },
  { family: 'pick-up', verbs: ['pick up'], verbClass: 'INSTANT', beatForm: 'one-beat',
    beat: 'One short beat at the square; the offered item is the receipt.',
    provenance: 'plan-named', source: 'research/01 §5 (Pick up); plan/02 §3.6 INSTANT' },
  { family: 'excavate', verbs: ['sound', 'excavate', 'sift', 'glean'], verbClass: 'INSTANT', beatForm: 'one-beat',
    beat: 'One short beat per recorded layer at the evidenced cell; never looped. Repeats in one window coalesce to one beat + `×N` (see RUIN_EXCAVATED below).',
    provenance: 'plan-named', source: 'research/01 §5 (Sound / excavate / sift / glean); plan/02 §3.6 INSTANT; plan/01 (repeats coalesce into one beat with a count)' },
  { family: 'store-give-pay', verbs: ['store', 'withdraw', 'give', 'pay'], verbClass: 'INSTANT', beatForm: 'one-beat',
    beat: 'Hand-over beat at the evidenced place; co-presence is checkable staging data, never assumed.',
    provenance: 'plan-named', source: 'research/01 §5 (Store / withdraw / give / pay); plan/02 §3.6 INSTANT' },
  { family: 'deliver-mend', verbs: ['deliver', 'mend'], verbClass: 'INSTANT',
    classAsStated: 'INSTANT per delivery; the loop (harvest → haul → travel → deliver) is journey-structured',
    beatForm: 'one-beat',
    beat: 'A delivery beat carrying the EXACT integrity delta, emitted as the Portal fact `work.delivered` when — and only when — the public feeds Portal reads record a delivery (see DELIVERY_PATTERNS). Repeated deliveries coalesce to one beat + `×N loads`.',
    provenance: 'plan-named', source: 'research/01 §5 (Deliver / mend); plan/02 §3.5 (work.delivered) + §3.6 (most-staged verbs: deliver/mend)' },
  { family: 'haul', verbs: ['haul', 'contribute'], verbClass: 'INSTANT',
    classAsStated: 'INSTANT per delivery; BATCHED via haul orders', beatForm: 'one-beat',
    beat: 'Delivery beat per recorded delivery into the shared construction total; haul ORDERS stage as batched rounds with counter.',
    provenance: 'plan-named', source: 'research/01 §5 (Haul); plan/02 §3.6 BATCHED/INSTANT' },
  { family: 'build-raise-install', verbs: ['build', 'raise', 'install', 'apartment raised', 'fixture installed'],
    verbClass: 'INSTANT', classAsStated: 'INSTANT (apartment, fixture); SOCIAL/BATCHED (frontier sites, wonders)',
    beatForm: 'one-beat',
    beat: 'INSTANT reveal beat (ribbon/reveal for a raising). No fake construction timelapse. Frontier sites and wonder stages have genuine intermediate states and stage those states only.',
    provenance: 'plan-named', source: 'research/01 §5 (Build / raise / install); plan/02 §3.6 INSTANT' },
  { family: 'trade', verbs: ['buy', 'sell', 'trade', 'bid', 'offer'], verbClass: 'INSTANT', beatForm: 'one-beat',
    beat: 'One short beat at the evidenced place; the public ledger line is the receipt.',
    provenance: 'plan-named', source: 'research/01 §5 (Buy / sell / trade); plan/02 §3.6 INSTANT' },
  { family: 'make-craft', verbs: ['make', 'craft', 'brew'], verbClass: 'INSTANT',
    classAsStated: 'INSTANT per item; orders SOCIAL-DURATIONAL', beatForm: 'one-beat',
    beat: 'Beat at the fixture\'s station; receipt card with the workshop uses-log line (maker, item, fee).',
    provenance: 'plan-named', source: 'research/01 §5 (Make / craft / brew); plan/02 §3.6 (most-staged verbs: make/craft)' },
  { family: 'college-deposit', verbs: ['deposit', 'cite', 'replicate', 'dispute', 'review'], verbClass: 'INSTANT',
    classAsStated: 'INSTANT to file; SOCIAL-DURATIONAL to settle', beatForm: 'one-beat',
    beat: 'INSTANT filing beat at the College + a Chronicle settlement line when replication lands (CONFIRMED/FAILED, from the record).',
    provenance: 'plan-named', source: 'research/01 §5 (College deposit / cite / replicate / dispute / review); plan/02 §3.6 (most-staged verbs)' },
  { family: 'problems', verbs: ['problem submission', 'ladder record', 'weekly answer'], verbClass: 'INSTANT',
    classAsStated: 'INSTANT submit (checker runs now); SOCIAL-DURATIONAL adjudication', beatForm: 'one-beat',
    beat: 'Submit beat; standings and certificates are read from the record, not staged.',
    provenance: 'plan-named', source: 'research/01 §5 (Problems / ladders / weekly)' },
  { family: 'debates-discussions', verbs: ['debate', 'discussion', 'symposium'], verbClass: 'SOCIAL-DURATIONAL', beatForm: 'scene',
    beat: 'Staged scene at the College (phases from the record); statements carry the recorded words. Scenes are built at M5.',
    provenance: 'plan-named', source: 'research/01 §5 (Debates / discussions / symposium); plan/02 §3.6 SOCIAL-DURATIONAL' },
  { family: 'weather-laws', verbs: ['weather law', 'forecast', 'synoptic report'], verbClass: 'INSTANT',
    classAsStated: 'INSTANT to file; synoptic round tick-deadlined', beatForm: 'ticker', tags: ['by-program'],
    beat: 'Ticker/caption beat with the "by program" tag: a law is a submitted program, not a citizen\'s presence (research/01 §5 closing note).',
    provenance: 'plan-named', source: 'research/01 §5 (Weather laws / forecasts / synoptic); plan/02 §3.6 (standing-order / program row)' },
  { family: 'vote-stand-propose', verbs: ['vote', 'stand', 'propose'], verbClass: 'INSTANT',
    classAsStated: 'INSTANT to cast; SOCIAL-DURATIONAL windows', beatForm: 'one-beat',
    beat: 'Hand-raised beat at the Town Hall on the cast\'s tick; windows and tallies are record state, shown as record.',
    provenance: 'plan-named', source: 'research/01 §5 (Vote / stand / propose); plan/02 §3.6 INSTANT' },
  { family: 'events-gatherings', verbs: ['event', 'gathering', 'attend'], verbClass: 'SOCIAL-DURATIONAL', beatForm: 'scene',
    beat: 'Staged scene at the evidenced place (M5); in the record, gatherings derive as EPISODES from voices (episodes.mjs) and the began-headline corroborates.',
    provenance: 'plan-named', source: 'research/01 §5 (Events / gatherings); plan/02 §3.6 SOCIAL-DURATIONAL' },
  { family: 'games-open-table', verbs: ['game', 'Open Table match'], verbClass: 'SOCIAL-DURATIONAL', beatForm: 'scene',
    tags: ['by-program'],
    beat: 'Bracket card + table scene; NO live pieces — matches are server-run from submitted programs, tagged "by program".',
    provenance: 'plan-named', source: 'research/01 §5 (Games / Open Table); plan/02 §3.6 SOCIAL-DURATIONAL' },
  { family: 'music', verbs: ['compose', 'book', 'play', 'applaud'], verbClass: 'INSTANT',
    classAsStated: 'INSTANT to play; performances are scheduled events', beatForm: 'one-beat',
    beat: 'Play beat on the record\'s tick; scheduled performances stage as events (scenes at M5).',
    provenance: 'plan-named', source: 'research/01 §5 (Music)' },
  { family: 'court', verbs: ['court case', 'jury'], verbClass: 'SOCIAL-DURATIONAL', beatForm: 'scene',
    beat: 'Scene at the court when a case is live in the record; historically dormant — no beat is staged from an empty record.',
    provenance: 'plan-named', source: 'research/01 §5 (Court)' },
  { family: 'repair-frontier', verbs: ['maintain', 'repair', 'rest'], verbClass: 'INSTANT', beatForm: 'one-beat',
    beat: 'One short beat where the agent stands; integrity/state deltas exactly as recorded.',
    provenance: 'plan-named', source: 'research/01 §5 (Repair (frontier/waystations)); plan/02 §3.6 INSTANT' },
  { family: 'publish', verbs: ['publish issue'], verbClass: 'INSTANT', beatForm: 'one-beat',
    beat: 'Press flash beat at the press; the issue itself is read whole, not staged.',
    provenance: 'plan-named', source: 'research/01 §5 (Publish (press)); plan/02 §3.6 INSTANT' },
  { family: 'hostile', verbs: ['attack', 'steal', 'blockade', 'destroy', 'seize'], verbClass: 'INSTANT', beatForm: 'chronicle-only',
    beat: 'Icon + Chronicle line only; NO staged combat. The news strife pulse is reported, not choreographed.',
    provenance: 'plan-named', source: 'research/01 §5 (Attack / steal / blockade / destroy (Outlands only)); plan/02 §3.6 (Hostile (Outlands))' },
];

const FAMILY_BY_NAME = new Map(VERB_FAMILIES.map((f) => [f.family, f]));

// ------------------------------------------------------------------
// The recorded-kind table (record-evidenced; news headline kinds)
// ------------------------------------------------------------------

// Every kind the archive's news record carries, mapped to its family
// and class. `figureAct` marks kinds whose headlines record a named
// citizen's act (actor parseable via episodes.mjs) and therefore
// produce presented ACTIONS; the rest produce presented EVENTS.
// `counter` names how a coalesced count is labelled for this kind.
export const ACTION_TABLE = {
  RUIN_EXCAVATED: {
    kind: 'RUIN_EXCAVATED', family: 'excavate', figureAct: true,
    counterNoun: null, // plain `×N`
    captionVerb: 'excavates an old ruin',
    note: 'The record\'s one parseable figure act: "{actor} dug into an old ruin at {cell}" / "{actor} brought a {item} out of an old ruin at {cell}". INSTANT per layer (research/01 §5); repeats in one window coalesce to one beat + `×N` (plan/01: repeats coalesce into one beat with a count). The "brought … out" phrasing records an extraction — see the work.delivered rule: it is NOT a delivery.',
    provenance: 'record-evidenced', source: 'archive news census 2026-11-03 (28 distinct headlines); episodes.mjs ACTOR_PATTERNS',
  },
  CITY_EVENT_BEGAN: {
    kind: 'CITY_EVENT_BEGAN', family: 'events-gatherings', figureAct: false,
    note: 'A social event began at an anchored Ember place. SOCIAL-DURATIONAL: the scene itself is M5 material — gatherings derive as episodes from voices, and this headline corroborates them (episodes.mjs). Here it presents as a scene marker: caption on its tick, record\'s own words.',
    provenance: 'record-evidenced', source: 'archive news census 2026-11-03 (6 distinct headlines); episodes.mjs corroboration',
  },
  HAPPENING_WITNESSED: {
    kind: 'HAPPENING_WITNESSED', family: 'observe', figureAct: false, presentationOverride: 'chronicle-only',
    note: '"Someone watched a starfall / a herd crossing the water." The observe family is INSTANT, but this headline names NO actor ("Someone") and NO place (locate is null): there is no evidenced figure or stage to beat on. Presentation is Chronicle-only, by evidence, not by class.',
    provenance: 'record-evidenced', source: 'archive news census 2026-11-03 (3 distinct headlines)',
  },
  OUTLOOK_CHANGED: {
    kind: 'OUTLOOK_CHANGED', family: 'weather-laws', figureAct: false, presentationOverride: 'ticker', tags: ['by-program'],
    note: 'The world\'s weather outlook changed because a citizen\'s LAW (a submitted program) now governs it, or lapsed. World-level, no place, no staged figure: a ticker/caption beat carrying the "by program" tag. The law\'s author is named in the record\'s own phrase and is quoted, never staged.',
    provenance: 'record-evidenced', source: 'archive news census 2026-11-03 (7 distinct headlines); research/01 §5 (weather laws are programs)',
  },
  STRUCTURE_COLLAPSED: {
    kind: 'STRUCTURE_COLLAPSED', family: null, figureAct: false, presentationOverride: 'one-beat',
    note: 'No verb family: this is not a citizen\'s act but a world state change ("A camp crumbled into ruin at {cell}"), actorless. Classified by analogy to the plan\'s building.changed fact (plan/02 §3.5): an INSTANT object beat at the evidenced cell — the change shown, never a staged collapse performance and never a timelapse.',
    provenance: 'record-evidenced', source: 'archive news census 2026-11-03 (3 distinct headlines); plan/02 §3.5 (building.raised/changed → INSTANT reveal)',
  },
};

// Kinds deliberately left unmapped, each with its reason. EMPTY at
// freeze time: every kind in the censused archive maps above. A future
// kind is NOT added here silently — it surfaces through classifyKind's
// unmapped result and the completeness test until a table entry is
// written for it. First entry added after the freeze: PEOPLE_ALL_KINDS
// (2026-11-03, data lane, on VER rotation 1's smoke finding). An
// unmapped entry is a disposition recorded with its evidence, not a
// silent skip — the kind still presents, on the forward-compatible
// default, flagged unmapped with this reason attached.
export const UNMAPPED_KINDS = {
  PEOPLE_ALL_KINDS:
    'Deliberately unmapped (data lane, 2026-11-03; closes VER rotation 1\'s action-table smoke finding). The kind carries exactly one headline in the whole record — id 97487, at 2026-11-03T05:45:43Z, first archived 2026-11-03T05:47:24Z and re-carried in every news snapshot since: "The Ostthir have given up every kind of artifact they left." It is a world-history statement, not a citizen act. (1) Its subject is a PEOPLE, not a citizen: the Ostthir stand in the record\'s peoples census as a civilisation of centuries before Ember\'s founding ("about a quarter" recovered); they hold no place in the citizen roster and no actor parses from the phrase (episodes.mjs registers actor patterns for RUIN_EXCAVATED only). (2) No instance carries a locate — no place, cell, or anchor exists to stage at. (3) Its verb, "given up" (relinquished), is not a research/01 §5 verb: §5 is the citizen API vocabulary and names no relinquish/abandon family. The nearest string match, store-give-pay\'s "give", is the /v1/give hand-over, whose beat definition requires an evidenced place, a recipient, and checkable co-presence — the headline carries none of the three, so mapping there would invent the staging data the table exists to refuse. Presentation stays the forward-compatible default: the record\'s own phrase as a ticker/Chronicle line; nothing staged, no figure moved, no beat claimed.',
};

// classifyKind(kind) -> the table entry for a recorded kind, or an
// explicit unmapped result carrying the plan's forward-compatible
// default presentation (Plan B §3.5: unknown future kinds replay
// safely — generic object beat + Chronicle line from the raw
// headline). An unmapped result is data, never an exception.
export function classifyKind(kind) {
  const entry = ACTION_TABLE[kind];
  if (entry) {
    const family = entry.family ? FAMILY_BY_NAME.get(entry.family) : null;
    return {
      kind, mapped: true,
      family: entry.family,
      verbClass: family ? family.verbClass : 'INSTANT',
      beatForm: entry.presentationOverride || (family ? family.beatForm : 'one-beat'),
      tags: entry.tags || (family && family.tags) || [],
      provenance: entry.provenance,
    };
  }
  if (Object.prototype.hasOwnProperty.call(UNMAPPED_KINDS, kind)) {
    return { kind, mapped: false, reason: UNMAPPED_KINDS[kind], beatForm: 'ticker', verbClass: null, tags: [] };
  }
  return {
    kind, mapped: false,
    reason: 'kind not in the frozen M3.03 table and not in the unmapped registry — forward-compatible default applies until a table entry is written',
    beatForm: 'ticker', verbClass: null, tags: [],
  };
}

// ------------------------------------------------------------------
// work.delivered — the delivery-evidence rule
// ------------------------------------------------------------------

// Delivery-evidence patterns, keyed by headline kind. A pattern may
// register here ONLY when the kind's own server-templated phrase
// records a delivery: an actor, a thing/load, and a recipient (a work,
// site, or citizen). Each pattern names three capture groups in order:
// actor, work (the recipient as the record names it), and — optional —
// the exact delta text when the phrase itself states one.
//
// EMPTY at freeze time, deliberately: no kind in the public feeds Portal reads
// carries such a phrase (see the header, rule 3). Registering a pattern
// for a future kind is the M5.11 deriver-extension path: "only if a
// Tier P work-evidence source is identified and recorded".
export const DELIVERY_PATTERNS = {};

// deriveWorkDelivered(newsData, { deliveryPatterns } = {}) -> fact[]
// Portal facts in Portal's dialect (Plan B §3.5): { kind:
// 'work.delivered', actor, work, delta, at, phrase, headlineId }.
// Only headlines of kinds with a registered delivery pattern can emit,
// and only when the phrase matches. Everything else — every act count,
// every extraction, every word of fenced speech — emits nothing.
export function deriveWorkDelivered(newsData, { deliveryPatterns = DELIVERY_PATTERNS } = {}) {
  const headlines = newsData && Array.isArray(newsData.headlines) ? newsData.headlines : [];
  const facts = [];
  for (const h of headlines) {
    if (!h || typeof h.kind !== 'string' || stampMs(h.at) === null) continue;
    const patterns = deliveryPatterns[h.kind];
    if (!patterns) continue;
    for (const re of patterns) {
      const m = re.exec(typeof h.phrase === 'string' ? h.phrase : '');
      if (m) {
        facts.push({
          kind: 'work.delivered',
          actor: m[1],
          work: m[2],
          delta: typeof m[3] === 'string' && m[3] !== '' ? m[3] : null,
          at: h.at,
          phrase: h.phrase,
          headlineId: h.id ?? null,
        });
        break;
      }
    }
  }
  facts.sort((a, b) => cmpStr(a.at, b.at) || cmpStr(a.actor, b.actor));
  return facts;
}

// coalesceDelivered(facts) -> beat[]
// Plan B §3.5's coalescing rule, verbatim in effect: repeated
// work.delivered (same figure + work, one window — one derive call is
// one window) ⇒ ONE beat + counter ("×3 loads"). Speech never reaches
// here (rule 2). The beat carries the plan's object/body split
// (plan/02 §3.5: "Object beats instant, body beats catch up"): the
// CAPTION lands on the first fact's tick; the PERFORMANCE anchors to
// the figure's arrival node — which is what plan-to-complete M3.03's
// exit fixture pins ("a mid-journey work.delivered fixture shows the
// caption on its tick, the beat at the arrival node"). The scheduler
// that honours the anchor is M5/engine work; the anchor is frozen
// here as interface.
export function coalesceDelivered(facts) {
  const groups = new Map();
  for (const f of facts || []) {
    if (!f || f.kind !== 'work.delivered') continue;
    const key = f.actor + '\u0000' + f.work;
    if (!groups.has(key)) groups.set(key, { actor: f.actor, work: f.work, facts: [] });
    groups.get(key).facts.push(f);
  }
  const beats = [];
  for (const g of groups.values()) {
    g.facts.sort((a, b) => cmpStr(a.at, b.at));
    const count = g.facts.length;
    beats.push({
      actor: g.actor,
      work: g.work,
      kind: 'work.delivered',
      count,
      counterLabel: count > 1 ? `×${count} loads` : null,
      caption: `${g.actor} delivered to ${g.work}`,
      captionAt: g.facts[0].at,
      performAnchor: 'arrival-node',
      deltas: g.facts.map((f) => f.delta),
      facts: g.facts,
    });
  }
  beats.sort((a, b) => cmpStr(a.captionAt, b.captionAt) || cmpStr(a.actor, b.actor));
  return beats;
}

// ------------------------------------------------------------------
// Presented actions (figure acts, coalesced) + presented events
// ------------------------------------------------------------------

function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function stampMs(at) {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

// derivePresentedActions(newsData) -> presentedAction[]
// The figure acts of one window (one news payload = one bundle window,
// Plan B §3.5) coalesced into presented sequences. Grouping is
// episodes.mjs's deriveActSequences with minActs 1 — REUSED, not
// re-implemented — so singles present as one beat and repeats as one
// beat + counter (plan/01: "One act per citizen on screen; repeats
// coalesce into one beat with a count"). BATCHED kinds label the
// counter `×N rounds` and stage one cycle (plan-to-complete M3.03's
// exit fixture: "a 3-round harvest renders one cycle + ×3"); INSTANT
// kinds label it plainly `×N` and stage one beat, never a loop.
// A presented action asserts the acts and nothing between them; it
// carries episodes.mjs's acts-only disclosure verbatim.
export function derivePresentedActions(newsData) {
  const sequences = deriveActSequences(newsData, { minActs: 1 });
  const presented = [];
  for (const seq of sequences) {
    const entry = ACTION_TABLE[seq.kind];
    const cls = classifyKind(seq.kind);
    const counterNoun = cls.verbClass === 'BATCHED' ? 'rounds' : entry && entry.counterNoun ? entry.counterNoun : null;
    presented.push({
      actor: seq.actor,
      kind: seq.kind,
      family: cls.family,
      verbClass: cls.verbClass,
      beatForm: cls.verbClass === 'BATCHED' ? 'rounds' : cls.beatForm,
      count: seq.count,
      mapped: cls.mapped,
      counterLabel: seq.count > 1 ? (counterNoun ? `×${seq.count} ${counterNoun}` : `×${seq.count}`) : null,
      caption: entry && entry.captionVerb ? `${seq.actor} ${entry.captionVerb}` : seq.actor,
      firstUtc: seq.firstUtc,
      lastUtc: seq.lastUtc,
      acts: seq.acts,
      disclosure: seq.disclosure,
    });
  }
  presented.sort((a, b) => cmpStr(a.firstUtc, b.firstUtc) || cmpStr(a.actor, b.actor) || cmpStr(a.kind, b.kind));
  return presented;
}

// derivePresentedEvents(newsData) -> presentedEvent[]
// Every headline that is NOT a parseable figure act, presented per its
// table entry: the caption is the record's own phrase, verbatim — this
// layer adds no words of its own to world events. Figure-act headlines
// are excluded (they present as actions above). Unmapped kinds still
// present, on the forward-compatible default, flagged `mapped: false`
// so the gap is visible rather than papered over.
export function derivePresentedEvents(newsData) {
  const headlines = newsData && Array.isArray(newsData.headlines) ? newsData.headlines : [];
  const events = [];
  for (const h of headlines) {
    if (!h || typeof h.kind !== 'string' || stampMs(h.at) === null) continue;
    if (extractActor(h.kind, h.phrase) !== null) continue;
    const cls = classifyKind(h.kind);
    events.push({
      kind: h.kind,
      at: h.at,
      caption: typeof h.phrase === 'string' ? h.phrase : '',
      verbClass: cls.verbClass,
      beatForm: cls.beatForm,
      tags: cls.tags,
      mapped: cls.mapped,
      headlineId: h.id ?? null,
      cell: h.locate && Array.isArray(h.locate.cell) ? h.locate.cell.slice() : null,
      anchor: h.locate && typeof h.locate.anchor === 'string' ? h.locate.anchor : null,
    });
  }
  events.sort((a, b) => cmpStr(a.at, b.at) || cmpStr(a.kind, b.kind));
  return events;
}
