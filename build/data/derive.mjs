// Elsewhere Portal — Arm A (Data): pure WorldData derivation.
//
// deriveWorldData(head, { bundleSeq }) projects an archive head (the newest
// snapshot per Tier P route, with its fetch time) into a
// portal.world-data/v1 object exactly per build/CONTRACT.md.
//
// PURITY (Plan B §4.1, §7.2): no I/O, no wall-clock reads, no randomness.
// Same head + same bundleSeq => byte-identical canonical output. Age is
// derived only from timestamps inside the inputs (payload generated_at vs.
// its fetch time), never from Date.now().
//
// HONESTY: fields the real Tier P payloads do not carry are emitted as the
// contract's empty value (null / []) and the gap is documented in STATUS.md —
// never invented. Notable real-shape facts this mapping is built on
// (live-verified 2026-11-02):
//   - voices gives display NAMES (`by`), not handles; news.residents'
//     `handle` field likewise holds a display name. Tier P (these six
//     routes) evidences no true handle anywhere => citizens' handle is "".
//     Portal therefore keys citizens by the PORTAL-KEY (bundle field
//     `citizenKey`), a Portal-generated interim record label (M2.03 /
//     WP-02; the verified registry of M2.04 supersedes it at the M2
//     freeze). It is never called a handle or an identity. See
//     assignCitizenKeys below for the scheme and its audit conditions.
//   - No per-plot records (holder, quarters, fixtures) and no civic-works
//     integrity values exist in the six routes => works carry
//     integrity: null, and ember.plots carries ONLY what voices evidences:
//     plot place codes where citizens actually spoke (M2.06 / SE-1.10).
//     Plot EXISTENCE is world-book-scoped: a plot enters ember.plots
//     when any voices snapshot of the current world-book first
//     evidences it (entry field firstEvidencedUtc) and stays for the
//     life of the book — a plot does not stop existing because it went
//     quiet. Plot PRESENCE stays head-based: who is at a plot now is
//     read off the head-derived citizens' placeCode, so a quiet plot
//     has an entry and no current speakers. A plot entry attests
//     existence, nothing more; positions are app-side staging
//     (sorted-code fill, Plan B layout section), never derived here.
//     Plots no snapshot of the current book evidences are absent —
//     including the record-attested anchors (District 3 Plot 18,
//     District 1 Plot 31), which live in the layout classed
//     `record-attested`, never in this feed-derived list. Chats is
//     never plot evidence.
//   - chats is a side panel (Plan B §2.1), not stage evidence => it does
//     not move citizen presence.

import { createHash } from 'node:crypto';

export const SCHEMA = 'portal.world-data/v1';

// Canonical JSON: object keys sorted recursively, arrays in order, no
// whitespace. Exported so the bundle hash and the purity test share it.
export function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
}

export function sha256hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Code-unit string comparison. localeCompare is locale/ICU-dependent, so
// two environments could order the same head differently and break the
// byte-identical purity guarantee; code-unit order cannot.
export function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v, fallback = null) {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

// Citizen text arrives fenced as <<ELSEWHERE_UNTRUSTED_...>>...<</...>>.
// Portal treats it as quoted text only (Plan B §6.5); the deriver strips the
// fence markers for display fields and never interprets the content.
export function unfence(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/<<ELSEWHERE_UNTRUSTED_[A-Z0-9]+>>/g, '')
    .replace(/<<\/ELSEWHERE_UNTRUSTED_[A-Z0-9]+>>/g, '');
}

const ANCHOR_PLACES = {
  plaza: 'EMBER_PLAZA_OF_UNITY',
  townhall: 'EMBER_TOWNHALL',
  college: 'EMBER_COLLEGE',
};

function routeData(head, route) {
  const entry = head?.[route];
  if (!entry || !isPlainObject(entry.data)) return null;
  return entry;
}

function provenance(entry, route) {
  return { route, fetchedUtc: entry.fetchedUtc ?? null };
}

// Citizen presence from speech evidence (Plan B §4.3, rescaled per §6.3):
// the age of a citizen's latest utterance, measured against the voices
// payload's own generated_at (an input timestamp — purity preserved).
//   <= 30 min  -> talking   (speech is the current fact)
//   <= 2 h     -> present   (evidenced-recent; no fresh speech)
//   >  2 h     -> asleep    (silence >= 2 h reads as asleep/away)
export function citizenState(ageSeconds) {
  if (ageSeconds <= 30 * 60) return 'talking';
  if (ageSeconds <= 2 * 3600) return 'present';
  return 'asleep';
}

// The PORTAL-KEY (M2.03 / WP-02; bundle field `citizenKey`) — a
// Portal-generated interim label for one citizen RECORD. It is not a
// handle and not an identity: Tier P evidences display names only, no
// handle is ever guessed from a name (banned, M2.04), and `handle` stays
// "" in the bundle. Conditions from my Hark's audit of this scheme,
// adopted as binding:
//   (1) The key is labelled PORTAL-KEY in docs and UI strings — the
//       `portal-key:` prefix makes the label intrinsic to the value.
//   (2) Each record stores the raw display name (`name`) and a
//       first-seen timestamp (`firstSeenUtc`: the earliest evidence for
//       the record within the current head) beside the key.
//   (3) Two records are never merged on name alone (see the assembly in
//       deriveWorldData: one record per evidence stream).
//   (4) A rename produces a NEW key. Nothing chases renames; records
//       link only when a server-side id evidences the link (M2.04).
//   (5) Same name, two records => the collision is flagged in the
//       bundle's `citizenCollisions` list, never silently folded.
//
// Scheme (a pure function of the head):
//   base      = "portal-key:" + slug, where the name is normalised
//               (NFKC, trim, collapse whitespace runs to one space,
//               lowercase) and the slug keeps [a-z0-9], maps spaces and
//               '-' to '-', and percent-encodes every other character's
//               UTF-8 bytes (%XX).
//   collision = two records whose normalised names slug identically:
//               exact namesakes, case/spacing variants, or space-vs-
//               hyphen pairs. The colliding group is ordered by a
//               deterministic evidence tuple — (raw name, state,
//               placeCode, evidenceUtc, provenance route, provenance
//               fetch time), code-unit order throughout — so the
//               strongest-evidence record (a placed state sorts before
//               `unknown`) keeps the bare key and the rest get "#2",
//               "#3", ... appended.
// The verified registry (M2.04) supersedes this interim scheme with
// citizenIds at the M2 freeze.
export function citizenKeySlug(name) {
  const norm = String(name ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  let slug = '';
  for (const ch of norm) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) slug += ch;
    else if (ch === ' ' || ch === '-') slug += '-';
    else {
      for (const byte of new TextEncoder().encode(ch)) {
        slug += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
      }
    }
  }
  return slug;
}

function keyEvidenceTuple(c) {
  return [
    c.name ?? '', c.state ?? '', c.placeCode ?? '', c.evidenceUtc ?? '',
    c.provenance?.route ?? '', c.provenance?.fetchedUtc ?? '',
  ];
}

// Assigns each record its PORTAL-KEY in place and returns the collision
// list for the bundle (audit condition 5): one entry per colliding slug,
// { key: <bare key>, names: [distinct raw names, sorted],
//   citizenKeys: [every key in the group, in assignment order] },
// the list itself sorted by bare key. Empty when no name collides.
export function assignCitizenKeys(citizens) {
  const groups = new Map();
  for (const c of citizens) {
    const slug = citizenKeySlug(c.name);
    if (!groups.has(slug)) groups.set(slug, []);
    groups.get(slug).push(c);
  }
  const collisions = [];
  for (const [slug, group] of groups) {
    const base = 'portal-key:' + slug;
    if (group.length === 1) {
      group[0].citizenKey = base;
      continue;
    }
    const ordered = [...group].sort((a, b) => {
      const ta = keyEvidenceTuple(a);
      const tb = keyEvidenceTuple(b);
      for (let i = 0; i < ta.length; i++) {
        const d = cmpStr(ta[i], tb[i]);
        if (d !== 0) return d;
      }
      return 0;
    });
    ordered.forEach((c, i) => {
      c.citizenKey = i === 0 ? base : `${base}#${i + 1}`;
    });
    collisions.push({
      key: base,
      names: [...new Set(group.map((c) => c.name))].sort(cmpStr),
      citizenKeys: ordered.map((c) => c.citizenKey),
    });
  }
  collisions.sort((a, b) => cmpStr(a.key, b.key));
  return collisions;
}

export function deriveWorldData(head, { bundleSeq = 1, voicesSnapshots = null } = {}) {
  const overview = routeData(head, 'overview');
  const news = routeData(head, 'news');
  const voices = routeData(head, 'voices');
  const map = routeData(head, 'map');

  // newestFetchUtc = latest fetch time among the routes we actually used.
  const fetchTimes = [overview, news, voices, map, routeData(head, 'status'), routeData(head, 'chats')]
    .filter(Boolean)
    .map((e) => e.fetchedUtc)
    .filter((t) => typeof t === 'string');
  const newestFetchUtc = fetchTimes.length ? fetchTimes.sort().at(-1) : null;

  // dataAgeSeconds: the freshest evidence of Tier P's built-in delay — the
  // largest (fetchedUtc - payload generated_at) across routes that carry a
  // generated_at. Pure: both timestamps come from the inputs.
  let dataAgeSeconds = 0;
  for (const entry of [overview, news, voices, map, routeData(head, 'chats')]) {
    if (!entry) continue;
    const gen = entry.data.generated_at;
    if (typeof gen === 'string' && typeof entry.fetchedUtc === 'string') {
      const age = Math.round((Date.parse(entry.fetchedUtc) - Date.parse(gen)) / 1000);
      if (Number.isFinite(age) && age > dataAgeSeconds) dataAgeSeconds = age;
    }
  }

  const ov = overview?.data ?? {};
  const world = {
    sky: str(ov.sky?.over_ember),
    worldHour: typeof ov.world_hour === 'number' ? ov.world_hour : (typeof map?.data?.world_hour === 'number' ? map.data.world_hour : null),
    season: str(ov.season),
    year: typeof ov.year === 'number' ? ov.year : null,
  };

  const counters = {
    regionsDiscovered: num(ov.frontier?.regions_discovered),
    regionsSurveyed: num(ov.frontier?.regions_surveyed),
    regionsNamed: num(ov.frontier?.regions_named),
    collegeDeposits: num(ov.college?.deposits),
    treasury: num(ov.ember?.treasury_bennies),
    populationKnown: num(ov.population?.joined),
  };

  // Ember districts: aggregates are all Tier P carries (held/vacant plots,
  // quarters, fixture counts, tower [floors, owned] pairs). Source of truth
  // is overview; map.ember.districts is the same table and is the fallback.
  const districtRows = Array.isArray(ov.ember?.districts) ? ov.ember.districts
    : (Array.isArray(map?.data?.ember?.districts) ? map.data.ember.districts : []);
  const districts = districtRows
    .filter(isPlainObject)
    .map((d) => ({
      n: num(d.n),
      name: str(d.name, ''),
      held: num(d.held),
      vacant: num(d.vacant),
      heldQuarters: num(d.held_quarters),
      vacantQuarters: num(d.vacant_quarters),
      fixtures: isPlainObject(d.fixtures) ? d.fixtures : {},
      towers: Array.isArray(d.towers) ? d.towers : [],
    }))
    .sort((a, b) => a.n - b.n);

  // Civic works: map.ember.civic_works lists the works' codes. No integrity
  // value exists in these routes => integrity stays null (no health shown
  // is the honest tier, Plan B §4.3); the code list itself is evidenced.
  const works = (Array.isArray(map?.data?.ember?.civic_works) ? map.data.ember.civic_works : [])
    .filter((c) => typeof c === 'string')
    .sort()
    .map((code) => ({ code, integrity: null }));

  // Evidenced plots (M2.06 / SE-1.10; book-scoped persistence,
  // 2026-11-03): a plot place code in voices, with at least one
  // utterance spoken there, evidences that the plot exists. Existence
  // accumulates across the current world-book: the entry is created by
  // the FIRST snapshot (in fetch order) that evidences the plot, and
  // carries that snapshot's fetch stamp as firstEvidencedUtc plus its
  // provenance. Nothing else accumulates — no holder, no quarters, no
  // geometry (no route carries per-plot records), and current occupancy
  // is NOT part of the entry: it stays head-based, read off the
  // citizens' placeCode below. `voicesSnapshots` is the book's voices
  // snapshots supplied by build-bundle (book boundary from
  // archive/world-books.json; snapshots of a closed book are never
  // passed in). Absent that input, only the head voices snapshot
  // counts, exactly as before. Codes are parsed, never guessed: only
  // EMBER_DISTRICT_<n>_PLOT_<m> qualifies.
  const plotEvidence = Array.isArray(voicesSnapshots) && voicesSnapshots.length
    ? voicesSnapshots
    : (voices ? [voices] : []);
  const plotsByCode = new Map();
  const orderedEvidence = [...plotEvidence]
    .filter((e) => e && isPlainObject(e.data))
    .sort((a, b) => cmpStr(a.fetchedUtc ?? '', b.fetchedUtc ?? ''));
  for (const snap of orderedEvidence) {
    for (const place of Array.isArray(snap.data.places) ? snap.data.places : []) {
      if (!isPlainObject(place) || typeof place.code !== 'string' || plotsByCode.has(place.code)) continue;
      const m = /^EMBER_DISTRICT_(\d+)_PLOT_(\d+)$/.exec(place.code);
      if (!m) continue;
      const said = Array.isArray(place.said) ? place.said : [];
      if (!said.some((s) => isPlainObject(s) && typeof s.by === 'string' && typeof s.at === 'string')) continue;
      plotsByCode.set(place.code, {
        code: place.code,
        district: Number(m[1]),
        plot: Number(m[2]),
        provenanceClass: 'feed-evidenced',
        firstEvidencedUtc: snap.fetchedUtc ?? null,
        provenance: provenance(snap, 'voices'),
      });
    }
  }
  const plots = [...plotsByCode.values()].sort((a, b) => cmpStr(a.code, b.code));

  const ember = { districts, plots, works };

  // Citizen RECORDS. Audit condition (3): records are never merged on
  // name alone — Tier P carries no identifier that could link two
  // records, so each source record stands on its own:
  //   - voices: one record per speaker. The payload's utterances by one
  //     speaker are that record's own evidence stream (not separate
  //     records): the latest utterance sets place/state/evidenceUtc,
  //     the earliest sets firstSeenUtc.
  //   - news.residents: one record per resident row. Activity is
  //     evidenced; presence is not (no place) => state unknown,
  //     placeCode null (contract invariant). A residents row is NOT
  //     folded into a voices record of the same name.
  // Same-name records are disambiguated by the PORTAL-KEY collision rule
  // and flagged in citizenCollisions (condition 5).
  const records = [];
  if (voices) {
    const refUtc = str(voices.data.generated_at) ?? voices.fetchedUtc;
    const refMs = Date.parse(refUtc);
    const streams = new Map(); // display name -> the speaker's stream aggregate
    for (const place of Array.isArray(voices.data.places) ? voices.data.places : []) {
      if (!isPlainObject(place) || typeof place.code !== 'string') continue;
      for (const said of Array.isArray(place.said) ? place.said : []) {
        if (!isPlainObject(said) || typeof said.by !== 'string' || typeof said.at !== 'string') continue;
        const name = unfence(said.by);
        const agg = streams.get(name);
        if (!agg) {
          streams.set(name, { name, placeCode: place.code, latestAt: said.at, firstSeenUtc: said.at });
        } else {
          if (said.at > agg.latestAt) { agg.latestAt = said.at; agg.placeCode = place.code; }
          if (said.at < agg.firstSeenUtc) agg.firstSeenUtc = said.at;
        }
      }
    }
    for (const agg of streams.values()) {
      const ageSec = Number.isFinite(refMs) ? Math.max(0, (refMs - Date.parse(agg.latestAt)) / 1000) : 0;
      records.push({
        handle: '',
        name: agg.name,
        placeCode: agg.placeCode,
        state: citizenState(ageSec),
        evidenceUtc: agg.latestAt,
        firstSeenUtc: agg.firstSeenUtc,
        provenance: provenance(voices, 'voices'),
      });
    }
  }
  if (news) {
    for (const r of Array.isArray(news.data.residents) ? news.data.residents : []) {
      if (!isPlainObject(r) || typeof r.handle !== 'string') continue;
      const times = [str(r.latest?.at), ...(Array.isArray(r.events) ? r.events.map((e) => str(e?.at)) : [])]
        .filter((t) => typeof t === 'string')
        .sort(cmpStr);
      records.push({
        handle: '',
        name: unfence(r.handle),
        placeCode: null,
        state: 'unknown',
        evidenceUtc: str(r.latest?.at),
        firstSeenUtc: times.length ? times[0] : null,
        provenance: provenance(news, 'news'),
      });
    }
  }
  records.sort((a, b) =>
    cmpStr(a.name, b.name) ||
    cmpStr(a.placeCode ?? '', b.placeCode ?? '') ||
    cmpStr(a.provenance.route, b.provenance.route) ||
    cmpStr(a.evidenceUtc ?? '', b.evidenceUtc ?? ''));
  const citizenCollisions = assignCitizenKeys(records);
  const citizens = records;

  // Ticker: the herald headlines, newest first, capped at the contract's
  // tickerSeed size (Plan B §4.1: <= 50).
  let ticker = [];
  if (news) {
    ticker = (Array.isArray(news.data.headlines) ? news.data.headlines : [])
      .filter((h) => isPlainObject(h) && typeof h.at === 'string' && typeof h.phrase === 'string')
      .map((h) => ({
        utc: h.at,
        kind: str(h.kind, ''),
        text: unfence(h.phrase),
        placeCode: ANCHOR_PLACES[h.locate?.anchor] ?? null,
        handles: [],
        provenance: provenance(news, 'news'),
      }))
      .sort((a, b) => cmpStr(b.utc, a.utc) || cmpStr(b.text, a.text))
      .slice(0, 50);
  }

  return {
    schema: SCHEMA,
    bundleSeq,
    newestFetchUtc,
    dataAgeSeconds,
    world,
    counters,
    ember,
    citizens,
    citizenCollisions,
    ticker,
    journeys: [],
  };
}
