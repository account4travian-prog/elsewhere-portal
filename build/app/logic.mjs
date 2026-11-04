// Elsewhere Portal — pure logic for the viewer shell.
// No DOM, no fetch: importable by the page (app.js) and by node tests.
// Sources: CONTRACT.md (badge rule, bundle shape), Plan A (UX) §6.1/§6.3
// (badge + presence wording), Plan B §4.3 (building integrity bands).
// The placement tracker and journey watchdog themselves live in the
// engine (../engine/conflicts.mjs, M3.04); this module holds their
// presentation models — the same split as playback vs planPresentation.

import {
  applyPlacement,
  trackerCitizen,
  ON_THE_WAY_CAPTION,
} from '../engine/conflicts.mjs';
import { ONBOARDING_SMALL_PRINT } from './disclosures.mjs';

export { createPlacementTracker } from '../engine/conflicts.mjs';

// ----------------------------------------------------------------- clock

/**
 * The app's explicit clock (M3.09, debt 04·D-12). Every "now" the render
 * path needs — badge age, relative times — comes from this ONE place.
 * The default is the wall clock, so the module behaves exactly as
 * before until someone says otherwise; app.js relies on the default,
 * and tests pin a fixed clock (installClock) so rendered ages are
 * deterministic. The point is that the choice lives here, visible and
 * overridable in one spot — never as bare Date.now() calls scattered
 * through the rendering code (a census test pins that app.js carries
 * none).
 */
let nowImpl = () => Date.now();

/** The current time in milliseconds, from the installed clock. */
export function nowMs() {
  return nowImpl();
}

/** Pin the clock to `fn` (a () => ms function). Tests only. */
export function installClock(fn) {
  nowImpl = typeof fn === 'function' ? fn : () => Date.now();
}

/** Restore the wall clock. */
export function resetClock() {
  nowImpl = () => Date.now();
}

// ---------------------------------------------------------------- badges

// The honesty cluster's wording home (M4.19, Design I4). This table is
// the SINGLE source for the cluster's words — badge labels and details,
// the "half a minute behind" line, the recording wording — and every
// surface draws from it: the 2D app here, and the 3D scene's frame
// burn-in via scene.mjs, which imports this module. A surface that
// re-words the cluster locally forks the honesty guarantee; the
// wording changes here, once, or nowhere.

/** The permanent behind-the-world line (Design I4, R8). */
export const BEHIND_LINE = 'Half a minute behind the world.';

/**
 * Derive the honesty badge.
 * Contract: LIVE when dataAgeSeconds <= 90; STALE otherwise; REPLAY while
 * replaying. Plan A §6.1 adds LOADING for first load and "never LIVE on
 * cached data" — so the sample/fallback bundle is always STALE.
 * M3.09 adds `stalled`: the frame loop has failed repeatedly (see the
 * frame guard below), so the stage is a frozen last picture — that is
 * STALE however fresh the underlying data is, and it outranks REPLAY
 * too: a recording that has stopped playing back is not playing back.
 * OM15-C1 adds `worldFrozen`: the world's OWN clock has stopped
 * advancing (see the world-clock watch below) — Portal's fetches are
 * fresh, but they are fresh copies of a world that has not moved, so
 * LIVE would lie about the world, not about the fetching. That is a
 * different STALE from `stalled` (our stage froze) and from plain age
 * (our copy is old), and it keeps its own wording. It ranks below
 * REPLAY: while a recording plays, the badge is about the recording.
 * M4.19 adds `replayRange`: while REPLAY shows, the badge carries the
 * recording's date range ({startUtc, endUtc} — see recordingRangeText)
 * when the recording declares one; a recording with no declared range
 * gets no invented one.
 * @returns {{key:string, label:string, detail:string}}
 */
export function badgeFor({ dataAgeSeconds = null, replaying = false, loading = false, isFallback = false, stalled = false, worldFrozen = false, worldFrozenSinceUtc = null, replayRange = null } = {}) {
  if (loading) {
    return { key: 'LOADING', label: '● LOADING…', detail: 'Reading the public feeds…' };
  }
  if (stalled) {
    return { key: 'STALE', label: '● STALE', detail: 'The stage has stopped updating — showing the last picture Portal could draw.' };
  }
  if (replaying) {
    const range = recordingRangeText(replayRange);
    return { key: 'REPLAY', label: '● REPLAY', detail: `Showing a recording, played back in order. Not live.${range ? ` Recorded ${range}.` : ''}` };
  }
  if (isFallback) {
    return { key: 'STALE', label: '● STALE', detail: 'Showing what Portal last knew.' };
  }
  if (worldFrozen) {
    const since = worldFrozenSinceUtc ? ` since ${relativeTime(worldFrozenSinceUtc)}` : '';
    return { key: 'STALE', label: '● STALE', detail: `The world's clock has not moved${since} — showing the last state Portal received.` };
  }
  if (dataAgeSeconds === null || dataAgeSeconds === undefined || dataAgeSeconds > 90) {
    return { key: 'STALE', label: '● STALE', detail: 'Showing what Portal last knew.' };
  }
  return { key: 'LIVE', label: '● LIVE', detail: BEHIND_LINE };
}

// ------------------------------------------------------- world clock

/**
 * The world-clock watch (OM15-C1, my Hark's M3-exit condition 1).
 * The badge's age rule measures Portal's fetching (newestFetchUtc is
 * OUR stamp on the newest snapshot we hold). Hark's frozen-world
 * case: an upstream serving cached world state under fresh fetches
 * keeps that age near zero while the world itself has stopped — and
 * LIVE would be a claim about the world, not about our fetching.
 * So the badge also watches the world's OWN clock: the bundle's
 * world block carries `worldHour`, `season` and `year`, copied by
 * the deriver from the overview payload the WORLD's server emits
 * (its own calendar — world_hour there advances about two hours per
 * real minute of polling, rolling through days, seasons and years;
 * measured over the archive 2026-11-02/03). No Portal timestamp is
 * an input.
 *
 * The watch is fed ONLY on live bundle loads (the M3.04 rule:
 * recordings manufacture nothing) and the freeze rule is
 * deliberately two-legged, so a quiet minute can never trip it:
 *  - at least TWO successive live bundles carried the SAME world
 *    clock (one bundle cannot prove a freeze — its clock might
 *    advance a second later), and
 *  - the wall time since that clock value was first seen exceeds
 *    WORLD_CLOCK_FROZEN_MS — the same 90 s as the LIVE window. A
 *    world hour is ~30 real seconds in the observed record, so 90 s
 *    is three of the world's own hour-steps missed.
 * A bundle with no readable world clock (worldHour absent — the v1
 * sample fixture's world is all nulls) is simply not observed: the
 * watch stands still and the age rule alone decides, as before.
 * The world book is part of the clock key, so a new book restarts
 * the watch rather than reading as a frozen old world.
 */
export const WORLD_CLOCK_FROZEN_MS = 90_000;

/** The bundle's world clock as one comparable key, or null when the
 *  bundle carries no readable world clock. */
export function worldClockKeyOf(bundle) {
  const w = bundle?.world;
  if (!w || typeof w.worldHour !== 'number' || !Number.isFinite(w.worldHour)) return null;
  return [w.bookId ?? '', w.year ?? '', w.season ?? '', w.worldHour].join('|');
}

/** A fresh world-clock watch: no clock seen yet. */
export function createWorldClockWatch() {
  return { key: null, firstSeenMs: null, loads: 0 };
}

/**
 * Observe one LIVE bundle's world clock at wall time `atMs` (the
 * app's explicit clock). Returns the next watch; the input is not
 * mutated. A changed clock (or a new world book) restarts the watch
 * at one load; the same clock again extends the run.
 */
export function observeWorldClock(watch, bundle, atMs) {
  const key = worldClockKeyOf(bundle);
  if (key === null) return watch || createWorldClockWatch();
  if (!watch || watch.key !== key) return { key, firstSeenMs: atMs, loads: 1 };
  return { key, firstSeenMs: watch.firstSeenMs, loads: (watch.loads || 0) + 1 };
}

/** True when the watch proves a frozen world at wall time `atMs`:
 *  the same world clock on at least two successive live bundles,
 *  unchanged for longer than the LIVE window. */
export function worldClockFrozen(watch, atMs) {
  return !!watch && watch.key !== null && (watch.loads || 0) >= 2
    && typeof watch.firstSeenMs === 'number'
    && (atMs - watch.firstSeenMs) > WORLD_CLOCK_FROZEN_MS;
}

/** When the currently watched world clock was first seen (ISO), for
 *  the badge's plain-words "has not moved since …". */
export function worldFrozenSinceUtc(watch) {
  return watch && typeof watch.firstSeenMs === 'number' ? new Date(watch.firstSeenMs).toISOString() : null;
}

// ------------------------------------------------------- building tiers

// Plan B §4.3 fixed integrity bands.
export const INTEGRITY_TIERS = [
  { key: 'celebrated', min: 100, max: 100, label: 'In excellent repair', color: '#f4a9c0', roof: '#e77fa2' },
  { key: 'tidy', min: 70, max: 99, label: 'In good repair', color: '#a8d8a8', roof: '#6fb56f' },
  { key: 'plain', min: 40, max: 69, label: 'In fair repair', color: '#f2dd9b', roof: '#d9b95c' },
  { key: 'shabby', min: 0, max: 39, label: 'In poor repair', color: '#d9b08c', roof: '#a9835f' },
];

/**
 * Map a building integrity value (0–100 or null) to its visual tier.
 * null => no health shown (Plan B §4.3: showing none is the honest tier).
 */
export function integrityTier(integrity) {
  if (integrity === null || integrity === undefined || Number.isNaN(Number(integrity))) {
    return { key: 'none', label: 'Repair not in the public feeds Portal reads', color: '#cfd8dc', roof: '#90a4ae' };
  }
  const v = Math.max(0, Math.min(100, Number(integrity)));
  return INTEGRITY_TIERS.find((t) => v >= t.min && v <= t.max);
}

// ---------------------------------------------------- bundle selection

/**
 * Fallback selection, pure: attempts is an ordered list of
 * { ok:boolean, source:string, data?:object }. Returns the first ok attempt
 * marked isFallback:false when it is the primary source, else the first ok
 * attempt marked isFallback:true. Returns null when nothing loaded.
 */
export function selectBundle(attempts) {
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    if (a && a.ok && a.data) {
      return { data: a.data, source: a.source, isFallback: i !== 0 };
    }
  }
  return null;
}

/** The WorldData schemas this viewer consumes: v1 and the frozen v2
 *  (build/CONTRACT-V2.md). Anything else — a future v3 included — is
 *  not a bundle to this app: an unknown schema is rejected, never
 *  half-read. */
export const BUNDLE_SCHEMAS = ['portal.world-data/v1', 'portal.world-data/v2'];

/** A loaded JSON object counts as a bundle only if it carries a known schema. */
export function isBundle(data) {
  return !!data && typeof data === 'object' && BUNDLE_SCHEMAS.includes(data.schema);
}

/** True only for the frozen v2 schema (the bundle-carried episodes and
 *  citizenIdStatus exist only there). */
export function isBundleV2(data) {
  return !!data && typeof data === 'object' && data.schema === 'portal.world-data/v2';
}

// -------------------------------------------------- manifest poll (M4.03)

/**
 * The 20-second manifest poll (M4.03, SE-5.3 / Design H4). The staging
 * site (and the local feed directory) publishes a small feed manifest
 * beside the bundle: { bundleSeq, worlddataHash, newestFetchUtc, … }.
 * An open page polls the MANIFEST only — a few hundred bytes — and
 * fetches the bundle itself only when the manifest's bundleSeq differs
 * from the bundle on stage. The fetched bytes are adopted only when
 * their SHA-256 equals the manifest's worlddataHash AND they parse as
 * a known-schema bundle whose own bundleSeq is the manifest's: a
 * mismatch is discarded WHOLE — nothing from it renders, the prior
 * bundle continues, and the badge ages it to STALE from its own
 * newestFetchUtc by the ordinary badge rule. The poll guards the LIVE
 * bundle only: the H4 fallback chain keeps its own behaviour exactly
 * (sample data under its banner is a recording, and a recording does
 * not get replaced mid-view by a poll).
 *
 * Pure core: the readers are injected, so this module still performs
 * no fetch of its own — app.js wires the real fetches, tests wire
 * fakes, and the discard-whole rule is exercised end to end here.
 */
export const POLL_INTERVAL_MS = 20_000;
export const FEED_MANIFEST_URL = '../data/feed/manifest.json';
export const LIVE_BUNDLE_URL = '../data/feed/world-data.json';

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The manifest's bundleSeq, or null when the manifest is unreadable. */
export function feedManifestSeq(manifest) {
  const seq = manifest?.bundleSeq;
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : null;
}

/** The manifest's expected world-data SHA-256 (lowercase hex), or null. */
export function feedManifestHash(manifest) {
  const hash = manifest?.worlddataHash;
  return typeof hash === 'string' && SHA256_HEX.test(hash) ? hash : null;
}

/**
 * The poll's decision, pure: fetch the bundle only on a sequence
 * change against a well-formed manifest. Anything else — an unreadable
 * manifest, a malformed hash, the same sequence — is a no-op, and the
 * current bundle simply ages under the badge rule.
 * @returns {{action:'fetch', seq:number, expectedHash:string} | {action:'none', reason:string}}
 */
export function pollPlan({ currentSeq = null, manifest = null } = {}) {
  const seq = feedManifestSeq(manifest);
  const expectedHash = feedManifestHash(manifest);
  if (seq === null || expectedHash === null) return { action: 'none', reason: 'manifest-invalid' };
  if (currentSeq !== null && seq === currentSeq) return { action: 'none', reason: 'unchanged' };
  return { action: 'fetch', seq, expectedHash };
}

/**
 * SHA-256 of bytes (or a string, encoded as UTF-8) as lowercase hex,
 * via the platform's WebCrypto — present in browsers on secure
 * contexts and in Node. Returns null when SubtleCrypto is unavailable:
 * an unverifiable bundle is never adopted, so the caller treats null
 * exactly like a mismatch.
 */
export async function sha256Hex(data) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True only when the bytes hash to exactly the expected value. */
export async function verifyBundleBytes(bytes, expectedHash) {
  if (!bytes || typeof expectedHash !== 'string' || !SHA256_HEX.test(expectedHash)) return false;
  const actual = await sha256Hex(bytes);
  return actual !== null && actual === expectedHash;
}

/**
 * Parse fetched bytes into a bundle, or null: the bytes must decode as
 * JSON AND carry a known schema (isBundle). A hash-verified body that
 * is not a bundle is still discarded whole — verification proves the
 * bytes are the publisher's, not that this viewer can read them.
 */
export function parseVerifiedBundle(bytes) {
  if (!bytes) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    return isBundle(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * One poll cycle, end to end, over injected readers:
 *   readManifest()    → the parsed feed manifest, or null on failure
 *   readBundleBytes() → the bundle's raw bytes, or null on failure
 * Returns { adopted, reason }: `adopted` is the verified bundle object
 * on 'adopted' and null otherwise. Reasons: manifest-unavailable,
 * manifest-invalid, unchanged, bundle-unavailable, hash-mismatch,
 * bundle-invalid, seq-mismatch. On every non-adopted outcome the
 * caller's current bundle continues untouched — discard-whole is the
 * shape of this function, not a branch the caller must remember.
 */
export async function pollOnce({ currentSeq = null, readManifest, readBundleBytes } = {}) {
  const manifest = typeof readManifest === 'function' ? await readManifest() : null;
  if (!manifest) return { adopted: null, reason: 'manifest-unavailable' };
  const plan = pollPlan({ currentSeq, manifest });
  if (plan.action !== 'fetch') return { adopted: null, reason: plan.reason };
  const bytes = typeof readBundleBytes === 'function' ? await readBundleBytes() : null;
  if (!bytes) return { adopted: null, reason: 'bundle-unavailable' };
  if (!(await verifyBundleBytes(bytes, plan.expectedHash))) return { adopted: null, reason: 'hash-mismatch' };
  const data = parseVerifiedBundle(bytes);
  if (!data) return { adopted: null, reason: 'bundle-invalid' };
  if (data.bundleSeq !== plan.seq) return { adopted: null, reason: 'seq-mismatch' };
  return { adopted: data, reason: 'adopted' };
}

// ------------------------------------------------------------- citizens

/** Evidenced = has a state other than unknown AND a place to stand. */
export function isEvidenced(citizen) {
  return !!citizen && citizen.state && citizen.state !== 'unknown' && !!citizen.placeCode;
}

/**
 * The record's PORTAL-KEY (bundle field citizenKey): the Portal-side
 * record label the deriver assigns (M2.03) — not a handle, not an
 * identity. Positions, the roster, follow, and cards all key by it.
 * The handle/name fallback exists only so a pre-M2.03 bundle still
 * renders; such bundles keyed everyone by handle "" — the collapse the
 * PORTAL-KEY exists to end.
 */
export function citizenKeyOf(citizen) {
  return citizen?.citizenKey || citizen?.handle || citizen?.name || '';
}

/**
 * Stage positions for evidenced citizens: a Map of PORTAL-KEY ->
 * {x, y, code}. Citizens sharing a place fan out by a per-place index
 * in bundle order (the bundle's citizen order is deterministic), so
 * every evidenced citizen stands at their own offset — two records
 * sharing handle "" can never collapse onto one spot.
 * Placement is EXACT-only, over the effective layout (see
 * effectiveLayout): a code with no exact node and no evidenced plot
 * entry places nobody — the citizen stays roster-only. There is no
 * fuzzy or label-based resolution anywhere in this module (M3.08
 * deleted it): a label-guessed position would be an invented datum
 * (REC-17).
 */
export function citizenPositions(bundle, layout) {
  const eff = effectiveLayout(layout, bundle);
  const pos = new Map();
  const byPlace = new Map();
  for (const c of bundle?.citizens || []) {
    if (!isEvidenced(c)) continue;
    const node = resolveExactNode(eff, c.placeCode);
    if (!node) continue;
    const idx = byPlace.get(node.code) || 0;
    byPlace.set(node.code, idx + 1);
    pos.set(citizenKeyOf(c), {
      x: node.x + (idx - 0.5) * 0.35,
      y: node.y + 0.25 + idx * 0.18,
      code: node.code,
    });
  }
  return pos;
}

const STATE_WORDS = {
  present: (name, place) => `${name} is at ${place}.`,
  talking: (name, place) => `${name} is talking at ${place}.`,
  working: (name, place) => `${name} is working at ${place}.`,
  travelling: (name, place) => `${name} is on the way — last place in the record: ${place}.`,
  asleep: (name) => `${name} is asleep / away.`,
  unknown: (name) => `We don't know where ${name} is right now.`,
};

/** Plain-word caption for a citizen, Plan A §3.5/§4 style. */
export function citizenCaption(citizen, placeLabel) {
  const name = citizen?.name || citizen?.handle || 'A citizen';
  const fn = STATE_WORDS[citizen?.state] || STATE_WORDS.unknown;
  return fn(name, placeLabel || 'a place in Ember');
}

/** Presence wording, Plan A §6.3. */
export function presenceWording(citizen) {
  if (!citizen || citizen.state === 'unknown' || !citizen.evidenceUtc) {
    return 'Unknown — we don\'t know where they are right now.';
  }
  if (citizen.state === 'asleep') {
    return 'Asleep / away — citizens act in visits, then go quiet.';
  }
  return 'Evidenced — this is from the public feeds Portal reads.';
}

/**
 * The building tier for one work, looked up by exact code — the single
 * path by which any renderer (card, stage) derives a tier. Its ONLY
 * input is the work's own `integrity` field. In particular a bundle's
 * `world.integritySource` (M2.07: a provenance note about where
 * integrity would come from, e.g. "none-in-tier-p") is never read
 * here: it is not a value, and even a numeric one changes nothing —
 * a test pins that.
 */
export function workTier(bundle, code) {
  const work = (bundle?.ember?.works || []).find((w) => w && w.code === code) || null;
  return integrityTier(work?.integrity);
}

/**
 * Plain-words wording for a citizen's identity binding (v2 bundles
 * only, CONTRACT-V2 §1.1, Hark Q1 amendment). Returns null when there
 * is nothing honest to show — a v1 citizen (no citizenIdStatus field:
 * the whole UI simply doesn't appear), an unrecognised status, or a
 * BOUND claim with no id behind it. The raw enum is never shown.
 * BOUND's `text` IS the citizenId — the profile link label; Portal
 * holds no evidenced URL for it, so it is presented as a labelled
 * identifier, never dressed up as a link it cannot back.
 */
export function citizenBindingWording(citizen) {
  const status = citizen?.citizenIdStatus;
  if (status === 'UNBOUND_NO_ROUTE') {
    return { kind: 'unbound', citizenId: null, text: 'Not yet linked to a public profile — no public route names them yet.' };
  }
  if (status === 'CONFLICT') {
    return { kind: 'conflict', citizenId: null, text: 'More than one citizen shares this record name; not linked.' };
  }
  if (status === 'BOUND') {
    const id = citizen?.citizenId;
    if (typeof id === 'string' && id !== '') return { kind: 'bound', citizenId: id, text: id };
    return null;
  }
  return null;
}

/** "3 minutes ago" style relative time; plain words, no jargon.
 *  The "now" is the explicit clock (M3.09) unless a caller passes one. */
export function relativeTime(isoUtc, nowOverrideMs) {
  if (!isoUtc) return 'not in the record';
  const then = Date.parse(isoUtc);
  if (Number.isNaN(then)) return 'not in the record';
  const nowValue = typeof nowOverrideMs === 'number' ? nowOverrideMs : nowMs();
  const secs = Math.max(0, Math.round((nowValue - then) / 1000));
  if (secs < 45) return 'just now';
  if (secs < 90) return 'a minute ago';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs === 1 ? 'an hour ago' : `${hrs} hours ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'a day ago' : `${days} days ago`;
}

// ------------------------------------------------------------ safe HTML

// M2.15 (the SE-6.1 injection defect): bundle text — citizen names,
// news text, handles, provenance fields, place codes — comes from a
// public feed any agent can write to, so it is UNTRUSTED. It reaches
// the page only two ways: as text (textContent / canvas fillText,
// used by the talk and episodes rendering), or through the builders
// below, which escape every feed-derived interpolation before it is
// assigned to innerHTML. Escaping changes nothing the reader sees:
// the browser decodes the entities back to the exact characters, so
// recorded words display verbatim — fence markers included — they
// just can never become elements. The one innerHTML site that does
// NOT go through a builder is the Growth panel in app.js, whose
// template interpolates only hardcoded keys and formatCount numbers
// (census in test/escaping.test.mjs).

/**
 * Escape a value for HTML text and double-quoted attribute contexts.
 * Identity on text with no markup characters, so benign data renders
 * byte-for-byte as before.
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The provenance footnote under a card. `prov` is feed data: its
 *  route and fetch stamp are escaped. `what` is Portal's own wording. */
export function provenanceHtml(prov, what) {
  if (!prov) return `<div class="prov"><strong>How Portal knows this:</strong> the record for ${what} does not carry its source in this bundle, so Portal says so rather than guessing.</div>`;
  return `<div class="prov"><strong>How Portal knows this:</strong> from the public feeds Portal reads
    (route <code>${escapeHtml(prov.route || 'not recorded')}</code>), read by Portal at ${escapeHtml(prov.fetchedUtc || 'an unrecorded time')}.</div>`;
}

// Identity binding line for a card/roster row (citizenBindingWording
// holds the wording rule). A BOUND citizenId is feed data — escaped;
// the unbound/conflict texts are Portal's own static strings.
export function bindingHtml(citizen) {
  const b = citizenBindingWording(citizen);
  if (!b) return '';
  return b.kind === 'bound' ? `Public profile: <span class="profile-id">${escapeHtml(b.text)}</span>` : b.text;
}

const labelOrSelf = (labelFor) => (typeof labelFor === 'function' ? labelFor : (code) => String(code || ''));

/** The citizen card's HTML. Every feed-derived value is escaped,
 *  including the PORTAL-KEY inside the data-follow attribute (the
 *  browser decodes the entities when the attribute is read back, so
 *  follow wiring sees the raw key exactly as before).
 *  The optional third argument is the citizen's place-conflict model
 *  (conflictModel, M3.04): when the record contradicts itself about
 *  this citizen's place, the inspector SHOWS the conflict — both
 *  claims with their evidence stamps, the place the figure is held
 *  at, and the disclosure — instead of silently picking one. */
export function citizenCardHtml(citizen, placeLabel, conflict = null, opts = {}) {
  const label = labelOrSelf(placeLabel);
  const key = citizenKeyOf(citizen);
  const bundle = opts?.bundle || null;
  const title = bundle ? citizenTitleLine(bundle, citizen) : null;
  const namesake = bundle ? namesakeInfo(bundle, citizen) : null;
  return `
    <h3><span class="dot" style="background:${citizenColor(key)}"></span>${escapeHtml(citizen.name)}${namesake ? ` <span class="namesake-tag">record ${namesake.ordinal} of ${namesake.count}</span>` : ''}</h3>
    ${title ? `<p class="title-line">${escapeHtml(title)}</p>` : ''}
    <p>${escapeHtml(citizenCaption(citizen, label(citizen.placeCode)))}</p>
    <p>${escapeHtml(presenceWording(citizen))}${citizen.evidenceUtc ? ` Heard from ${escapeHtml(relativeTime(citizen.evidenceUtc))}.` : ''}</p>
    ${namesake ? `<p class="namesake-line">${namesake.count} citizens in the record share this name. Portal keeps their records separate — this is record ${namesake.ordinal} of ${namesake.count}, first seen ${escapeHtml(plainDate(namesake.firstSeenUtc) || 'at an unrecorded time')}.</p>` : ''}
    ${conflict ? conflictHtml(conflict, label) : ''}
    ${citizenBindingWording(citizen) ? `<p class="binding-line">${bindingHtml(citizen)}</p>` : ''}
    <p>${isEvidenced(citizen) ? `<button type="button" class="follow-small" data-follow="${escapeHtml(key)}">Follow ${escapeHtml(citizen.name)}</button> ` : ''}<button type="button" class="follow-small" data-page="${escapeHtml(key)}">Their page →</button> <button type="button" class="follow-small" data-record-card="">Record</button></p>
    ${provenanceHtml(citizen.provenance, 'this citizen')}`;
}

/** The place-conflict section of the citizen card (the inspector,
 *  §3.5: "inspector shows the conflict"). Claim places and evidence
 *  stamps are record data — escaped like everything else feed-born. */
export function conflictHtml(conflict, placeLabel) {
  const label = labelOrSelf(placeLabel);
  const claims = (conflict.claims || []).map((cl) =>
    `<li>${escapeHtml(label(cl.placeCode))} — evidence ${escapeHtml(relativeTime(cl.evidenceUtc))} (${escapeHtml(cl.evidenceUtc || 'no stamp in the feeds')})</li>`).join('');
  return `<div class="conflict"><strong>Place conflict — Portal is holding this figure.</strong>
    <p>The public feeds Portal reads name ${conflict.claims?.length || 0} places in the same tick:</p>
    <ul>${claims}</ul>
    <p>${escapeHtml(conflict.disclosure)}</p>
    <p>Held at ${escapeHtml(conflict.heldPlaceCode ? label(conflict.heldPlaceCode) : 'no agreed place — the figure is not on the stage')}.</p></div>`;
}

/** The building card's HTML. The tier comes only from the work's own
 *  integrity field, via workTier — world.integritySource is never an
 *  input. The label and provenance are escaped on the same rule. */
export function buildingCardHtml(bundle, node, work) {
  const tier = workTier(bundle, node.code);
  return `
    <h3>${escapeHtml(node.label)}</h3>
    <p>${work ? `Repair: ${tier.label}${typeof work.integrity === 'number' ? ` (${work.integrity} out of 100)` : ''}.` : 'This place is part of Ember’s stage. Its repair is not in the public feeds Portal reads.'}</p>
    <p><button type="button" class="follow-small" data-record-card="">Record</button></p>
    ${provenanceHtml(work?.provenance, 'this building')}`;
}

/** The news-item card's HTML: text, stamp, place and citizen names
 *  are all feed data and all escaped. The kind renders as the M6.01
 *  chip (icon + plain word) — the RAW feed kind renders only inside
 *  the provenance inspector (inspectorHtml), never on a card or a
 *  list. The card carries the item's [Record] action (data-record-card;
 *  app.js binds it to this item's inspector claim). */
export function tickerCardHtml(item, bundle, placeLabel) {
  const label = labelOrSelf(placeLabel);
  const chip = tickerChip(item?.kind);
  const deadline = tickerDeadlineText(item);
  const who = (item.handles || []).map((h) => bundle?.citizens.find((c) => citizenKeyOf(c) === h || c.handle === h)?.name || h);
  return `
    <h3><span class="kind">${chip.icon} ${escapeHtml(chip.word)}</span></h3>
    <p>${escapeHtml(item.text)}</p>
    ${deadline ? `<p class="deadline">${escapeHtml(deadline)}</p>` : ''}
    <p>${item.utc ? `Happened ${escapeHtml(relativeTime(item.utc))} (${escapeHtml(item.utc)}).` : ''} ${item.placeCode ? `Place: ${escapeHtml(label(item.placeCode))}.` : ''} ${who.length ? `Citizens: ${escapeHtml(who.join(', '))}.` : ''}</p>
    <p><button type="button" class="follow-small" data-record-card="">Record</button></p>
    ${provenanceHtml(item.provenance, 'this news item')}`;
}

/** The news list's HTML (M6.01 completion). Every item — a placement
 *  line or a record news item — renders as: the closed-set chip (icon
 *  + plain word; raw feed kinds NEVER render here — the inspector is
 *  their only surface), the plain sentence (the record's own words,
 *  full names as recorded), the when line, a deadline line when the
 *  item carries a structured due stamp, and its actions: [Take me
 *  there] only when a landing resolves from the item's STRUCTURED
 *  fields (a place code on the stage plan, or a named citizen the
 *  record places — names are never parsed out of the sentence to
 *  invent a landing), and [Record] always, opening the item's claim
 *  in the provenance inspector (M6.06). All feed-born text is escaped.
 *  The optional second argument is placement-event lines
 *  (placementEventLines, M3.04), rendered ABOVE the record's own
 *  news; they carry no data-ticker index — they are not bundle news
 *  items and open no news card. `opts` ({layout, placements}) feeds
 *  the landing resolution; without it, landings resolve from the
 *  bundle alone. `opts.frontier` (M6.11) additionally gives frontier
 *  items — no stage landing, frontier by their structured fields —
 *  the frontier-map form of the button (data-there-frontier). */
export function tickerListHtml(bundle, movementLines = [], opts = {}) {
  const layout = opts?.layout || null;
  const placements = opts?.placements || null;
  const movement = (movementLines || []).map((l, i) => {
    const landing = movementLanding(l, bundle, placements);
    return `
    <li class="movement">
      <span class="kind">${MOVEMENT_CHIP.icon} ${MOVEMENT_CHIP.word}</span>${escapeHtml(l.text)}
      <div class="when">${l.utc ? escapeHtml(relativeTime(l.utc)) : ''} · ${l.staging ? 'Staging — not witnessed' : 'Record'}${l.hold ? ' · Hold' : ''}</div>
      <div class="tk-actions">${landing ? `<button type="button" class="follow-small" data-there-move="${i}">Take me there</button>` : ''}<button type="button" class="follow-small" data-record-move="${i}">Record</button></div>
    </li>`;
  }).join('');
  const news = (bundle?.ticker || []).map((item, i) => {
    // X6 ticker scope (M6.15): display only — a scoped-out item
    // renders nothing, and its index stays the bundle's own, so the
    // caller's per-index wiring never shifts under the filter.
    if (opts?.tickerScope && !tickerScopeAllows(item, opts.tickerScope)) return '';
    const chip = tickerChip(item?.kind);
    const deadline = tickerDeadlineText(item);
    const landing = tickerLanding(item, bundle, layout);
    // M6.11: a frontier item has no stage landing — its "there" is
    // the frontier map. Only when the caller opts in (opts.frontier)
    // and the item is a frontier item by its structured fields does
    // it carry the frontier form of the button.
    const frontier = !landing && opts?.frontier ? frontierLanding(item, bundle, layout) : null;
    return `
    <li data-ticker="${i}" tabindex="0">
      <span class="kind">${chip.icon} ${escapeHtml(chip.word)}</span>${escapeHtml(item.text)}
      <div class="when">${item.utc ? escapeHtml(relativeTime(item.utc)) : ''} · Record</div>
      ${deadline ? `<div class="deadline">${escapeHtml(deadline)}</div>` : ''}
      <div class="tk-actions">${landing ? `<button type="button" class="follow-small" data-there-item="${i}">Take me there</button>` : ''}${frontier ? `<button type="button" class="follow-small" data-there-frontier="${i}">Take me there — the frontier map</button>` : ''}<button type="button" class="follow-small" data-record-item="${i}">Record</button></div>
    </li>`;
  }).join('');
  return movement + news || '<li>No news in this bundle.</li>';
}

/** The roster list's HTML: names, captions, binding ids and follow
 *  keys are feed data and all escaped. The optional third argument is
 *  a Map of placement states (placementStates, M3.04): a citizen the
 *  record has stopped placing is labelled out of the record — with
 *  the honesty wording that this is not a leaving — and a conflicted
 *  citizen is labelled held, instead of either silently vanishing
 *  from, or jumping around, the list. */
export function rosterListHtml(bundle, placeLabel, placements = null) {
  const label = labelOrSelf(placeLabel);
  return (bundle?.citizens || []).map((c) => {
    const key = citizenKeyOf(c);
    const tracked = placements?.get(key) || null;
    const stateLine = !tracked ? ''
      : tracked.conflict ? `<div class="when">Place conflict — held at ${escapeHtml(tracked.shown ? label(tracked.shown.placeCode) : 'no agreed place')}; the public feeds Portal reads name two places in the same tick. Their card shows both.</div>`
      : tracked.presence === 'absent' ? `<div class="when">Out of the public feeds Portal reads right now — the feeds stopped placing them. That is not the same as leaving the town.</div>`
      : '';
    // M6.04: the office title (words only) rides FIRST, beside the
    // name, before any other line on the row; a namesake's row is
    // distinguishable at a glance by its record tag.
    const title = citizenTitleLine(bundle, c);
    const namesake = namesakeInfo(bundle, c);
    return `
    <li${c.state === 'asleep' ? ' class="asleep"' : ''}>
      <span class="dot" style="background:${citizenColor(key)}"></span><span class="who">${escapeHtml(c.name)}</span>${title ? ` <span class="title-word">${escapeHtml(title)}</span>` : ''}${namesake ? ` <span class="namesake-tag">record ${namesake.ordinal} of ${namesake.count}</span>` : ''}
      <div>${escapeHtml(citizenCaption(c, label(c.placeCode)))}</div>
      <div class="when">${escapeHtml(presenceWording(c))}</div>
      ${stateLine}
      ${citizenBindingWording(c) ? `<div class="when">${bindingHtml(c)}</div>` : ''}
      ${isEvidenced(c) ? `<button type="button" class="follow-small" data-follow="${escapeHtml(key)}">Watch — follow ${escapeHtml(c.name)}</button>` : `<button type="button" class="follow-small" data-watch-card="${escapeHtml(key)}">Watch — see ${escapeHtml(c.name)}'s card</button>`}
    </li>`;
  }).join('');
}

// Deterministic identity colour from a soft pastel palette (Synthesis §8:
// colour-coded identity; the Office factory's identity-colour pattern).
const PALETTE = ['#ef8fb5', '#7fb8e8', '#8fd0a0', '#f2b879', '#b39de0', '#7fd1c8', '#e88f8f', '#a9c46f'];

export function citizenColor(handleOrName) {
  const s = String(handleOrName || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// -------------------------------------------------------------- layout

/** Exact-code resolution only. Returns null for anything else — an
 *  unresolvable code degrades to roster-only, never a guessed position. */
export function resolveExactNode(layout, code) {
  if (!layout || !code) return null;
  return (layout.nodes || []).find((n) => n.code === code) || null;
}

// --------------------------------------------------------------- plots

// Plot place codes are parsed, never guessed: EMBER_DISTRICT_<n>_PLOT_<m>.
export const PLOT_CODE_PATTERN = /^EMBER_DISTRICT_(\d+)_PLOT_(\d+)$/;

export function parsePlotCode(code) {
  if (typeof code !== 'string') return null;
  const m = PLOT_CODE_PATTERN.exec(code);
  return m ? { district: Number(m[1]), plot: Number(m[2]) } : null;
}

/** Plain-words label built from the code itself ("District 1, Plot 30").
 *  No name is invented for a plot the record does not name. */
export function plotCodeLabel(code) {
  const p = parsePlotCode(code);
  return p ? `District ${p.district}, Plot ${p.plot}` : String(code || '');
}

const cmpCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The effective layout: the shared layout plus deterministic staging
 * nodes for plot codes the BUNDLE evidences (ember.plots, derived from
 * voices by Arm A) that have no layout node — Plan B's sorted-code fill:
 * "a new plot appears sensibly on its first snapshot, never crashes the
 * scene; the layout only assigns positions." Fill order is the codes'
 * code-unit sort; slots run along a staging row south of the authored
 * grid (y = 8, 9, ...; x = 1..7), skipping any cell an authored node
 * already occupies, and each fill node links to the Plaza hub with the
 * same staging seconds as the authored anchor plots. Every position in
 * the layout is Portal staging (disclosed in the layout note); the fill
 * invents no fact — the plot's existence is feed-evidenced, its label
 * is its own code in plain words, and a plot with NO evidence (not in
 * the layout, not in ember.plots) gets no node here either.
 * Pure: same (layout, bundle) => same result; returns the layout
 * unchanged when nothing needs filling.
 */
export function effectiveLayout(layout, bundle) {
  if (!layout || !Array.isArray(layout.nodes)) return layout;
  const evidenced = new Set();
  for (const p of bundle?.ember?.plots || []) {
    if (p && typeof p.code === 'string' && parsePlotCode(p.code)) evidenced.add(p.code);
  }
  const missing = [...evidenced].filter((code) => !resolveExactNode(layout, code)).sort(cmpCodeUnit);
  if (!missing.length) return layout;
  const nodes = [...layout.nodes];
  const edges = [...(layout.edges || [])];
  const occupied = new Set(nodes.map((n) => `${n.x},${n.y}`));
  const hub = resolveExactNode(layout, 'EMBER_PLAZA_OF_UNITY') || nodes[0];
  missing.forEach((code, i) => {
    let slot = i;
    let x = 1 + (slot % 7);
    let y = 8 + Math.floor(slot / 7);
    while (occupied.has(`${x},${y}`)) {
      slot += 1;
      x = 1 + (slot % 7);
      y = 8 + Math.floor(slot / 7);
    }
    occupied.add(`${x},${y}`);
    nodes.push({
      code,
      codeStatus: 'feed-evidenced',
      provenanceClass: 'feed-evidenced',
      kind: 'plot',
      label: plotCodeLabel(code),
      x,
      y,
      stagedPosition: true,
    });
    if (hub && hub.code !== code) edges.push({ a: hub.code, b: code, seconds: 9 });
  });
  return { ...layout, nodes, edges };
}

// ------------------------------------------------------- numbers

/**
 * Fixed thousands grouping for counters. Deterministic on every
 * runtime — `toLocaleString` output depends on the host's locale and
 * ICU data, so the Growth panel never uses it.
 */
export function formatCount(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  const neg = v < 0;
  const [int, frac] = String(Math.abs(v)).split('.');
  if (!/^\d+$/.test(int)) return String(v); // e.g. 1e21 — leave as-is
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + grouped + (frac ? `.${frac}` : '');
}

/** Plain-words duration for a span of world ticks (1 tick = 30 s). */
export function worldDuration(ticks) {
  const secs = Math.round(ticks * 30);
  if (secs <= 0) return 'no time';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ');
}

// ------------------------------------------------- catch-up plans

/**
 * How the app presents an engine catchUp plan (Plan B §3.4):
 * - 'replay' plans show the REPLAY badge while they play;
 * - 'path-summary' plans are never played at all — their steps are
 *   listed (summaryPanel below) and the figure stands at its
 *   evidenced place;
 * - 'catch-up' and 'none' keep ordinary playback.
 */
export function planPresentation(plan) {
  if (!plan) return { mode: 'none', showReplayBadge: false, isSummary: false };
  return {
    mode: plan.mode,
    showReplayBadge: plan.mode === 'replay' && plan.replay === true,
    isSummary: plan.mode === 'path-summary',
  };
}

/** One listed step of a travelled-path summary, plain words. A
 *  near-reach step discloses that the world charges it no time. */
export function summaryStepLine(step, labelFor) {
  const from = labelFor(step.from);
  const to = labelFor(step.to);
  if (step.nearReach) return `${from} → ${to} — the world charges this step no time.`;
  return `${from} → ${to} — ${worldDuration(step.worldTicks)} of world time.`;
}

/**
 * The "while you were away" panel model for a path-summary plan
 * (Plan B §3.4): the missed steps' scheduled facts, listed not
 * played. Returns null for any plan that plays (or no plan) — the
 * panel exists only where the summary IS the continuity.
 */
export function summaryPanel(plan, name, labelFor) {
  if (!plan || plan.mode !== 'path-summary') return null;
  if (!Array.isArray(plan.summarySteps) || plan.summarySteps.length === 0) return null;
  const who = name || 'This citizen';
  const last = plan.summarySteps[plan.summarySteps.length - 1];
  return {
    heading: 'While you were away',
    intro: `${who} travelled while this page was away — ${worldDuration(plan.absenceTicks)} of world time passed. After more than an hour away, Portal lists the journey from the record instead of playing it back. These are the steps, in the order they happened:`,
    lines: plan.summarySteps.map((s) => summaryStepLine(s, labelFor)),
    closing: `${who} stands at ${labelFor(last.to)} — the place this journey's record ends. The steps above were listed, not played.`,
  };
}

// ------------------------------------------------- frame guard

/**
 * The frame guard (M3.09, WP-12 remainder; debt 04·D-4's second half).
 * The frame loop's body reaches the engine's positionAt, which throws
 * on an unknown place code — and before this guard, one throw before
 * the loop re-armed itself froze the page permanently under whatever
 * badge was already up, LIVE included. The guard is the pure half of
 * the fix (app.js holds the other half: it re-arms
 * requestAnimationFrame BEFORE the body runs, so the loop cannot die
 * at all). One guarded step:
 *  - runs `tick` (playback advance — catchUp/plan calls live here),
 *    catching any throw;
 *  - runs `render` EVEN IF the tick threw, so the stage keeps showing
 *    its last good picture instead of freezing mid-frame;
 *  - counts consecutive failed steps on the guard object (either phase
 *    throwing counts); a clean step resets the count to zero;
 *  - reports `stalled` once the count reaches
 *    FRAME_FAILURE_STALE_THRESHOLD — the caller then presents the data
 *    as STALE (badgeFor's `stalled` input), never fake-LIVE.
 * Throws nothing; the caught error rides back on the result for the
 * caller to log.
 */
export const FRAME_FAILURE_STALE_THRESHOLD = 3;

/** A fresh frame guard: pass the same object to every step. */
export function createFrameGuard() {
  return { failures: 0 };
}

/** True when the guard's consecutive-failure count means "stalled". */
export function frameStalled(guard) {
  return !!guard && (guard.failures || 0) >= FRAME_FAILURE_STALE_THRESHOLD;
}

export function guardedFrameStep(guard, { tick, render } = {}) {
  let error = null;
  try { if (typeof tick === 'function') tick(); } catch (e) { error = e; }
  try { if (typeof render === 'function') render(); } catch (e) { error = error || e; }
  const failed = error !== null;
  guard.failures = failed ? (guard.failures || 0) + 1 : 0;
  return { ok: !failed, failures: guard.failures, stalled: frameStalled(guard), error };
}

// --------------------------------------------- recording honesty

/**
 * The recording notice (M3.10, Design H6): whenever the stage is being
 * driven by a recording instead of the live record, the page says so
 * in a caption of its own, for the whole time. Two drivers count:
 *  - the demo journey — a recording by construction, Portal walking
 *    its own test path on the real engine;
 *  - sample data — Portal's built-in test bundle standing in because
 *    the live bundle is not there.
 * The notice is NOT the badge and does not replace it: the badge keeps
 * its own rules alongside (during the demo it reads REPLAY throughout;
 * sample data is STALE, never LIVE). The caption is what names the
 * thing a recording, in the plan's own words. Returns null when the
 * live record drives the stage — the caption exists iff a recording
 * does.
 */
export const RECORDING_LABEL = '● RECORDING';
export const DEMO_RECORDING_CAPTION = "A recording from Portal's test data";
export const SAMPLE_RECORDING_CAPTION = "Sample data — a recording from Portal's test data, not the live town";
/**
 * The recording's play wording (M4.19, Design I4: REPLAY carries
 * "Play the recording"). Design H6 renamed the button once already so
 * it says the journey is a recording; M4.19 names the cluster's exact
 * wording, and this constant is that wording's single home — the
 * button in index.html carries it verbatim (census-pinned).
 */
export const PLAY_RECORDING_LABEL = '▶ Play the recording';
/** The demo button's label — the play-the-recording wording above. */
export const DEMO_BUTTON_LABEL = PLAY_RECORDING_LABEL;

const RANGE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A recording's date range as words (M4.19): "1 Nov 2026, 22:56–23:20
 * UTC" when both stamps fall on one UTC day, "1 Nov 2026 22:56 UTC –
 * 2 Nov 2026 00:55 UTC" across days. Pure and deterministic (UTC
 * throughout — the record's own clock). Returns null when either
 * stamp is missing or unreadable: a range is shown only when the
 * recording declares one, never reconstructed from vibes.
 */
export function recordingRangeText(range) {
  const start = Date.parse(range?.startUtc || '');
  const end = Date.parse(range?.endUtc || '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const s = new Date(start), e = new Date(end);
  const day = (d) => `${d.getUTCDate()} ${RANGE_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const hm = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth() && s.getUTCDate() === e.getUTCDate()
    ? `${day(s)}, ${hm(s)}–${hm(e)} UTC`
    : `${day(s)} ${hm(s)} UTC – ${day(e)} ${hm(e)} UTC`;
}

/**
 * The date range a bundle's own record declares: the earliest citizen
 * evidence stamp through the bundle's newestFetchUtc. Derived from the
 * bundle itself, so a recording that IS a bundle (the sample data)
 * carries its range from its own contents; returns null when the
 * bundle declares neither bound.
 */
export function recordingRangeOf(bundle) {
  if (!bundle || typeof bundle !== 'object') return null;
  const stamps = (bundle.citizens || []).map((c) => c?.evidenceUtc).filter((t) => typeof t === 'string' && Number.isFinite(Date.parse(t)));
  const startUtc = stamps.length ? stamps.reduce((a, b) => (a <= b ? a : b)) : null;
  const endUtc = typeof bundle.newestFetchUtc === 'string' && Number.isFinite(Date.parse(bundle.newestFetchUtc)) ? bundle.newestFetchUtc : null;
  if (!startUtc || !endUtc) return null;
  return { startUtc, endUtc };
}

export function recordingNotice({ demoActive = false, isFallback = false, range = null } = {}) {
  // The range is purely additive (M4.19): with no declared range the
  // captions are byte-identical to the M3.10 forms the suite pins.
  const rangeText = recordingRangeText(range);
  const suffix = rangeText ? ` Recorded ${rangeText}.` : '';
  if (demoActive) return { key: 'demo', label: RECORDING_LABEL, caption: `${DEMO_RECORDING_CAPTION}${suffix}` };
  if (isFallback) return { key: 'sample', label: RECORDING_LABEL, caption: `${SAMPLE_RECORDING_CAPTION}${suffix}` };
  return null;
}

// --------------------------------------------------- sample banner

/**
 * The SAMPLE DATA banner (M3.07 amended close; Design H4 via M4.03).
 * M3.07's letter retired the sample fixture to tests-only, "never a
 * page fallback"; Design H4 instead keeps the local-dev fallback
 * chain alive under a persistent banner. Coordinator ruling (ledgered
 * in AUTO-DECISIONS.md, reversible): H4 wins — the fallback survives,
 * bannered, and M3.07 closes in this amended form.
 * The banner is its own honesty layer, distinct from the other two:
 * the badge (sample data is STALE, never LIVE) and the M3.10
 * recording caption (sample data is a recording). Sample data shows
 * banner AND caption; live data shows neither, ever. The model is
 * total over the load outcomes: a banner exists iff a fallback
 * bundle actually drives the app — no bundle, nothing rendered, no
 * banner; a live bundle, no banner. Banner-or-nothing: app.js
 * renders this model from the one badge funnel, so there is no code
 * path where sample data renders unbannered (census-pinned).
 */
export const SAMPLE_BANNER_TEXT = 'SAMPLE DATA — not the live town';

export function sampleBanner({ isFallback = false, hasBundle = false } = {}) {
  if (isFallback && hasBundle) return { key: 'sample', text: SAMPLE_BANNER_TEXT };
  return null;
}

// ------------------------------------------------- episodes / talk

// Talk-from-record (M4; episodes.mjs, M2.08 disposition). Two carriers
// hold the same portal.episodes/v1 section shape: the episodes feed —
// feed/episodes.json, a SEPARATE document fetched alongside the bundle,
// whose episodes also carry their utterances (the recorded words) —
// and, since the frozen v2 contract, the bundle itself, whose episodes
// are summaries WITHOUT utterances (§1.4's object has no words field:
// the words live in the feed). conversationsSource() picks the
// carrier: the v2 bundle when it carries the lists, else the feed.
// Playback resolves an episode's words from whichever carrier has them
// (resolveTalkEpisode). Absence is graceful throughout: no source, no
// panel, no error. Conversations are shown from the recorded words
// only: utterances verbatim, in recorded order, participants =
// speakers only, and every episode carries its disclosure, which the
// panel model passes through untouched so the disclosure reaches the
// rendered panel for EVERY listed episode — from either carrier
// (Hark M2 audit condition (c)).

export const EPISODES_SCHEMA = 'portal.episodes/v1';

/** A loaded JSON object counts as an episodes feed only on schema. */
export function isEpisodesFeed(data) {
  return !!data && typeof data === 'object' && data.schema === EPISODES_SCHEMA
    && Array.isArray(data.episodes) && Array.isArray(data.actSequences);
}

/** Structural check for anything carrying the episodes section (the
 *  feed document, or a v2 bundle's top level). */
export function isConversationsSource(data) {
  return !!data && typeof data === 'object'
    && Array.isArray(data.episodes) && Array.isArray(data.actSequences);
}

/**
 * Which document the Conversations panel reads: a v2 bundle carrying
 * its episodes/actSequences wins (they are the frozen contract's own
 * sections); otherwise the sidecar feed, when it is a valid episodes
 * feed; otherwise null (panel hidden).
 */
export function conversationsSource(bundle, feed) {
  if (isBundleV2(bundle) && isConversationsSource(bundle)) return bundle;
  if (isEpisodesFeed(feed)) return feed;
  return null;
}

/**
 * The episode to PLAY for a list key: the source's own episode when it
 * carries recorded words (the feed's do); else the feed's twin episode
 * (same place + opening stamp) when the panel's source was the bundle,
 * whose episodes are wordless summaries. Returns null when no carrier
 * holds the words — playback then simply doesn't start, and the panel
 * says the words are not in this bundle rather than playing nothing.
 */
export function resolveTalkEpisode(source, feed, key) {
  const own = (source?.episodes || []).find((ep) => episodeKeyOf(ep) === key) || null;
  if (own && Array.isArray(own.utterances) && own.utterances.length > 0) return own;
  if (feed && feed !== source && isEpisodesFeed(feed)) {
    const twin = feed.episodes.find((ep) => episodeKeyOf(ep) === key) || null;
    if (twin && Array.isArray(twin.utterances) && twin.utterances.length > 0) return twin;
  }
  return null;
}

/** Stable selection key for an episode: place + opening stamp. */
export function episodeKeyOf(episode) {
  return `${episode?.place || ''}|${episode?.firstUtc || ''}`;
}

/**
 * The Episodes panel model: one row per episode with everything the
 * list shows — place label, participants (speakers only, as recorded),
 * time span, utterance count, the corroborated marker, and the
 * episode's disclosure VERBATIM from the source (feed or v2 bundle).
 * Returns null when there is no usable source (the panel stays hidden).
 */
export function episodeListModel(feed, labelFor) {
  if (!isConversationsSource(feed)) return null;
  const label = typeof labelFor === 'function' ? labelFor : (code) => String(code || '');
  return {
    episodes: feed.episodes.map((ep) => ({
      key: episodeKeyOf(ep),
      placeCode: ep.place,
      placeLabel: label(ep.place),
      where: typeof ep.where === 'string' ? ep.where : null,
      participants: Array.isArray(ep.participants) ? [...ep.participants] : [],
      firstUtc: ep.firstUtc,
      lastUtc: ep.lastUtc,
      utteranceCount: ep.utteranceCount,
      corroborated: ep.corroborated === true,
      disclosure: ep.disclosure,
    })),
  };
}

/**
 * The talk playback model for one episode: the disclosure (shown as
 * the panel header throughout playback) plus the playback queue —
 * the episode's utterances in recorded order, each step carrying the
 * speaker's name and the recorded words VERBATIM (`text` is the feed's
 * `said`, fence markers included, never paraphrased or completed).
 * The markers are the record's transport fence: the model carries
 * them, and PRESENTATION strips them (fencedSpeech / THE STRIP) —
 * no surface renders them.
 * Returns null for an episode with no recorded words to play.
 */
export function talkPlaybackModel(episode) {
  if (!episode || !Array.isArray(episode.utterances) || episode.utterances.length === 0) return null;
  return {
    key: episodeKeyOf(episode),
    placeCode: episode.place,
    disclosure: episode.disclosure,
    total: episode.utterances.length,
    steps: episode.utterances.map((u) => ({ at: u.at, speaker: u.by, text: u.said })),
  };
}

/** The playback queue on its own: the ordered steps of talkPlaybackModel. */
export function talkQueue(episode) {
  const model = talkPlaybackModel(episode);
  return model ? model.steps : [];
}

// ------------------------------------------------ fenced speech (OM15-C4)

// Verbatim citizen words are UNTRUSTED record speech (my Hark's
// OM-15 condition 4): they are things the record captured, not
// Portal's own voice, and they must never sit on the page dressed
// as Portal's narration. The world itself fences them — every
// recorded `said` arrives wrapped in the record's own fence
// markers (<<ELSEWHERE_UNTRUSTED_…>> … <</ELSEWHERE_UNTRUSTED_…>>),
// which the playback model carries verbatim as characters.
//
// The fence HERE is the presentation twin of that: a visible frame
// around the words on every surface that renders them, so a
// reader sees "quoted record speech" at a glance, before reading
// a word.
//
// THE STRIP (G-J1 round 3, 2026-11-03 — my Hark's round-2
// audit, blocker 1): the record's fence markers are its TRANSPORT
// wrapper, not its words. Rendering them puts the token on the
// page in the same serif as the speech — a viewer reads it as
// spoken, and it exposes the guard. So presentation strips the
// markers (stripRecordFence — the same rule the deriver's
// unfence() applies to names and phrases) and keeps Portal's own
// fence as the only visible fence: the frame + the "Recorded
// words" label. What remains inside is the record's words
// byte-for-byte — backticks, quotes, everything that is actually
// speech. (Rounds 1–2 of the gate rendered the markers verbatim
// under the older reading of this condition; the auditor's
// round-2 read governs now, and the census pins the strip.)
//
// fencedSpeech is the ONE model every utterance surface consumes —
// the Conversations panel's transcript bubbles, the stage's canvas
// speech bubble (both app.js) and the 3D scene's talk overlay
// (through bubbleKit) — the same one-model-two-renderers split as
// figureStyle (OM15-C2). It is presentation only: the input step
// is not mutated, and the label, quote glyph and frame class ride
// BESIDE the text and are never inserted into it. A census test
// (test/fenced-speech.test.mjs) pins every utterance-rendering
// site to this model and asserts no bubble text from any of the
// three paths can contain the fence pattern.

/** The record's transport-fence markers, open and close — the
 *  pattern stripRecordFence removes at presentation. Mirrors
 *  build/data/derive.mjs's unfence() exactly (the world's own
 *  rule for the same markers). */
export const RECORD_FENCE_PATTERN = /<<\/?ELSEWHERE_UNTRUSTED_[A-Z0-9]+>>/g;

/** Remove the record's transport-fence markers from a text,
 *  leaving the words inside them byte-for-byte. Non-strings pass
 *  through untouched. Presentation only — the record itself, the
 *  playback model and the archive keep the markers; surfaces
 *  never render them. */
export function stripRecordFence(text) {
  return typeof text === 'string' ? text.replace(RECORD_FENCE_PATTERN, '') : text;
}

/** The fence's plain-words label: these are recorded words, quoted. */
export const SPEECH_FENCE_LABEL = 'Recorded words';
/** The fence's quote glyph, drawn beside the label — presentation only. */
export const SPEECH_FENCE_QUOTE = '❝';
/** The CSS class carrying the panel's fence frame. */
export const SPEECH_FENCE_CLASS = 'speech-fence';
/** The fence frame's colour — the stage bubble's long-standing
 *  stroke, and styles.css's --accent, so both surfaces frame the
 *  words in the same pink. */
export const SPEECH_FENCE_COLOR = '#e77fa2';

/**
 * The fenced presentation of one playback step: the speaker and
 * the recorded words with the record's transport fence stripped
 * (see THE STRIP above), plus Portal's fence that frames them.
 * Returns null for a step with no recorded words to frame.
 */
export function fencedSpeech(step) {
  if (!step || typeof step.text !== 'string' || step.text === '') return null;
  return {
    speaker: step.speaker,
    text: stripRecordFence(step.text),
    label: SPEECH_FENCE_LABEL,
    quote: SPEECH_FENCE_QUOTE,
    frameClass: SPEECH_FENCE_CLASS,
  };
}

/**
 * Readable pacing for one utterance: a base beat plus reading time for
 * the words. Pure and deterministic.
 *
 * PACING DISPOSITION (M5.01; M5 wave brief, Conflicts 1 — recorded in
 * plan-to-complete/lane-m5-talk.md): the plan's letter governs the
 * TALK SYSTEM — at least 4 s per utterance, and a 90 s cap per scene
 * after which the scene summarises instead of playing on. The M3-era
 * panel clamp [1.6 s, 7 s] is superseded in this shared model, so the
 * panel and the scene change together (there is one model; the brief's
 * Conflict 5 forbids forking it). Two consequences, by design:
 *   - the floor is now TALK_MIN_UTTERANCE_MS for every utterance on
 *     every surface — a short recorded remark holds for a full 4 s;
 *   - there is NO per-utterance ceiling any more. The old 7 s cap
 *     existed so "a long speech never stalls the queue"; under the
 *     plan that protection lives at scene level (the scheduler's
 *     90 s cap), and a single utterance is never cut short — cutting
 *     one would truncate recorded words mid-display.
 * Arithmetic the cap test stands on: at the 4 s floor a scene fits at
 * most 22 minimal utterances under the cap (22 × 4000 = 88 000 ms;
 * 23 × 4000 = 92 000 ms > 90 000 ms), so any scene of 23+ utterances
 * summarises its tail no matter how short the words are; reading time
 * (1200 + 26 ms/char, so a 200-char utterance holds 6 400 ms) only
 * brings the cap closer.
 *
 * Scope note (2026-11-03, M5.07 ruling — the project owner: "Acceptance replays
 * play in full — the 90-second cap governs live scenes only"): the
 * scene-level cap this disposition relies on binds LIVE staging;
 * a recording plays every utterance in full. The floor and the
 * reading-time rate above are unchanged in both modes — only the
 * cap's scope moved. See THE CAP'S SCOPE at the scheduler.
 */
export const TALK_MIN_UTTERANCE_MS = 4000;
/** The talk system's scene cap in LIVE staging: a live scene
 *  plays at most this long before its remaining utterances are
 *  summarised, not played. Recordings are exempt — the cap
 *  governs live scenes only (M5.07 ruling, 2026-11-03; see
 *  THE CAP'S SCOPE at the scheduler below). */
export const TALK_SCENE_CAP_MS = 90 * 1000;

export function utteranceDelayMs(step) {
  const len = typeof step?.text === 'string' ? step.text.length : 0;
  return Math.max(TALK_MIN_UTTERANCE_MS, 1200 + len * 26);
}

// ------------------------------------------------ talk system (M5.01)
//
// The scene scheduler over the playback model above. It decides WHEN
// recorded utterances appear as bubbles — it never touches WHAT they
// say: every scheduled event carries one utterance's words verbatim
// (the step's own text reference), speech is never coalesced (two
// utterances never merge into one bubble) and never cut (an utterance
// always displays for its full pacing delay).
//
// Priority queues: scenes are processed in the RECORD's order — a
// scene's priority is its recorded opening stamp, never an editorial
// ranking — and a scene cannot start until every one of its speakers
// is free. Two scenes that share a figure therefore serialise: the
// earlier-recorded scene plays first and the later one queues behind
// it, whole. Within a scene, utterances play in recorded order.
//
// The 90 s cap (LIVE scenes — see THE CAP'S SCOPE below): when the
// next utterance would carry a scene past TALK_SCENE_CAP_MS, the
// scene stops scheduling bubbles and returns a summary POINTER
// instead — counts per speaker and the remaining span, never the
// remaining words (a summary that quoted or paraphrased speech
// would break M5.13's quotation discipline; the Chronicle renders
// the summary from this pointer at M6.09). The one exception: a
// scene's FIRST utterance always plays, even if its own pacing
// alone exceeds the cap — a scene never summarises itself into
// silence, and an utterance is never cut. A RECORDING never reaches
// this paragraph: it plays in full and produces no pointer.
//
// No recorded words ⇒ no scene: a wordless episode (a bundle summary
// whose words live in the feed, or an empty record) schedules to null
// and is reported in `skipped` by scheduleTalkScenes — no bubble ever
// lacks a recorded thread behind it.

// ------------------------------------------------------
// THE CAP'S SCOPE (M5.07 — the project owner's ruling, 2026-11-03:
// "Acceptance replays play in full — the 90-second cap governs
// live scenes only"): the scheduler names the same mode the
// consumption model does (THE MODE at talkActPresentation) —
// REQUIRED at every call, no default, any other value a
// TypeError — and the modes differ in exactly one rule: whether
// the 90 s scene cap applies.
//   live      — the cap applies, exactly as M5.01's letter set
//               it: past the cap the tail is summarised into
//               the counts-only chronicle-summary-pointer, and
//               the pointer arises from live scenes only.
//   recording — no cap and no pointer: every utterance in the
//               scene plays as a bubble at the mandated pacing,
//               however long the scene runs. The record is the
//               authority for how long its own scenes are; a
//               pointer produced from a recording would misstate
//               the record as a live abbreviation.
// The pacing law itself does not move: utteranceDelayMs, the
// 4 s floor and the reading-time rate are identical in both
// modes — only the cap's scope changed hands. The ruling arose
// from the M5.07 gate's conflict clause: the storytelling
// scene's nine utterances run ≈137 s at the mandated pacing,
// and the cap summarised the last three (Atlas's 23:12 words
// among them) instead of rendering them as bubbles.

/**
 * Schedule ONE episode as a talk scene starting at startMs (an
 * abstract offset; callers map it to their own clock). Returns null
 * for an episode with no recorded words to play.
 *   mode: REQUIRED — 'live' or 'recording' (see THE CAP'S SCOPE
 *         above). No default: a caller that cannot say whether
 *         it is staging the live moment or presenting the record
 *         has a bug, and gets a TypeError.
 */
export function scheduleTalkScene(episode, { startMs = 0, mode } = {}) {
  if (mode !== 'live' && mode !== 'recording') {
    throw new TypeError(`scheduleTalkScene: mode must be named explicitly — 'live' or 'recording' (got ${String(mode)})`);
  }
  const model = talkPlaybackModel(episode);
  if (!model) return null;
  const events = [];
  let t = startMs;
  let remaining = [];
  for (let i = 0; i < model.steps.length; i++) {
    const step = model.steps[i];
    const delay = utteranceDelayMs(step);
    if (mode === 'live' && events.length > 0 && (t - startMs) + delay > TALK_SCENE_CAP_MS) {
      remaining = model.steps.slice(i);
      break;
    }
    events.push({
      index: i, at: step.at, speaker: step.speaker, text: step.text,
      startMs: t, endMs: t + delay, delayMs: delay,
    });
    t += delay;
  }
  let summary = null;
  if (remaining.length > 0) {
    const bySpeaker = [];
    const slot = new Map();
    for (const s of remaining) {
      if (!slot.has(s.speaker)) { slot.set(s.speaker, bySpeaker.length); bySpeaker.push({ name: s.speaker, count: 0 }); }
      bySpeaker[slot.get(s.speaker)].count += 1;
    }
    summary = {
      kind: 'chronicle-summary-pointer',
      remainingCount: remaining.length,
      bySpeaker,
      firstAt: remaining[0].at,
      lastAt: remaining[remaining.length - 1].at,
    };
  }
  return {
    key: model.key, placeCode: model.placeCode, disclosure: model.disclosure,
    total: model.total, events, capped: remaining.length > 0, summary,
    mode,
    startMs, endMs: t,
  };
}

/**
 * Schedule a set of episodes as talk scenes on one timeline. Scenes
 * are prioritised by recorded opening stamp; a scene starts only
 * when all its speakers are free, so a figure is never speaking in
 * two scenes at once. Wordless episodes schedule nothing and are
 * named in `skipped`. Pure and deterministic (stamp ties break on
 * the episode key).
 *   mode: REQUIRED — 'live' or 'recording', forwarded to every
 *         scene (see THE CAP'S SCOPE above). One timeline, one
 *         mode: a caller mixing the live moment with the record
 *         on a single timeline has two timelines, not one.
 */
export function scheduleTalkScenes(episodes, { startMs = 0, mode } = {}) {
  if (mode !== 'live' && mode !== 'recording') {
    throw new TypeError(`scheduleTalkScenes: mode must be named explicitly — 'live' or 'recording' (got ${String(mode)})`);
  }
  const queue = [];
  const skipped = [];
  for (const ep of episodes || []) {
    if (talkPlaybackModel(ep)) queue.push(ep);
    else skipped.push(episodeKeyOf(ep));
  }
  const stamp = (ep) => Date.parse(ep.utterances[0].at) || 0;
  queue.sort((a, b) => (stamp(a) - stamp(b))
    || (episodeKeyOf(a) < episodeKeyOf(b) ? -1 : episodeKeyOf(a) > episodeKeyOf(b) ? 1 : 0));
  const freeAt = new Map();
  const scenes = [];
  for (const ep of queue) {
    const speakers = [...new Set(ep.utterances.map((u) => u.by))];
    let start = startMs;
    for (const name of speakers) start = Math.max(start, freeAt.get(name) ?? startMs);
    const scene = scheduleTalkScene(ep, { startMs: start, mode });
    for (const name of speakers) freeAt.set(name, scene.endMs);
    scenes.push(scene);
  }
  return { scenes, skipped };
}

/**
 * The earliest moment an interruption of a scheduled scene may take
 * effect: interruptions land at NODES only — never mid-utterance
 * (the utterance on display always finishes; speech is not cut) and
 * never mid-leg (a travelling figure is between places; the
 * interruption waits for the arrival node). `legs` are the involved
 * figures' travel windows on the same clock: {departMs, arriveMs}.
 * Returns {atMs, deferred, reasons} with reasons drawn from
 * 'utterance-boundary' and 'leg-arrival', in the order applied.
 */
export function talkInterruptPoint(schedule, atMs, legs = []) {
  if (!schedule || !Number.isFinite(atMs)) {
    throw new TypeError('talkInterruptPoint: a schedule and a finite atMs are required');
  }
  let candidate = Math.max(atMs, schedule.startMs);
  const reasons = [];
  // Each deferral strictly advances the candidate (an event's end or
  // a leg's arrival is ahead of any point inside it), so this loop
  // terminates; the bound is a belt-and-braces guard only.
  for (let guard = 0; guard < 1000; guard++) {
    const ev = schedule.events.find((e) => e.startMs < candidate && candidate < e.endMs);
    if (ev) { candidate = ev.endMs; reasons.push('utterance-boundary'); continue; }
    const leg = (legs || []).find((l) => l && l.departMs < candidate && candidate < l.arriveMs);
    if (leg) { candidate = leg.arriveMs; reasons.push('leg-arrival'); continue; }
    break;
  }
  return { atMs: candidate, deferred: candidate > atMs, reasons };
}

// -------------------------------------------------- bubble kit (M5.02)
//
// The K1 bubble form, as one model both surfaces consume (the panel
// transcript and the stage canvas bubble today; the 3D scene's
// overlay bubbles consume the same kit when they land):
//   - header "[Name], [date], [time] UTC:" — the speaker's name
//     and the utterance's own recorded stamp with its zone and
//     date (from its stamp; never invented: a step without a
//     parseable stamp gets the name alone). G-J1 round 3
//     (2026-11-03, my Hark's round-2 nit: the bare "11:00"
//     carried no zone or date): the panel's own bubble header IS
//     this kit header — no separate panel form exists (the
//     panel's episode rows tell their times relatively) — so the
//     kit header itself gains the dated form, in the single-stamp
//     shape of the module's existing recording-range form
//     (recordingRangeText: "1 Nov 2026, 22:56 UTC"), built from
//     plainDate + bubbleClockTime. One header, every surface.
//   - the recorded words, fenced (fencedSpeech) and verbatim — the
//     kit's `text` is ALWAYS the full recorded words;
//   - truncation exists only in the 'stage' variant, is a strict
//     word-boundary PREFIX of the words, and is marked by the words
//     "Read in full" carried BESIDE the text (kit.marker), never
//     woven into it — so any quoted string a surface renders is
//     either the whole recorded utterance or a visibly-marked cut,
//     and the panel (which never truncates) is the marker's referent:
//     the full words are always one surface away.
// Quoted words are set in the design system's quoted-words font
// (tokens: font.family.quoted — the F-2 serif slot; Lora cleared OFL
// intake on 2026-11-03 and fills the slot — see the token's
// provenance and assets-src/ASSETS.md, Fonts section).

/** The truncation marker's exact words (Design K1). */
export const READ_IN_FULL_MARKER = 'Read in full';
/** Stage bubbles are space-capped; the kit cuts stage display text
 *  to this many characters (a prefix of the recorded words). Tuned
 *  to the stage bubble's box: ~4 lines at its measure width. */
export const BUBBLE_STAGE_MAX_CHARS = 150;

/** The recorded clock time of a stamp, 'HH:MM' UTC — or null when
 *  the stamp does not parse (the header then omits the time rather
 *  than inventing one). */
export function bubbleClockTime(at) {
  if (typeof at !== 'string') return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** The K1 header for one step: "[Name], [date], [time] UTC:" —
 *  the date is plainDate's "2 Nov 2026" and the time is
 *  bubbleClockTime's HH:MM, both from the step's own stamp (see
 *  the kit's header note above). */
export function bubbleHeader(step) {
  const name = typeof step?.speaker === 'string' && step.speaker !== '' ? step.speaker : 'A citizen';
  const time = bubbleClockTime(step?.at);
  const day = time ? plainDate(step?.at) : null;
  return time && day ? `${name}, ${day}, ${time} UTC:` : `${name}:`;
}

/**
 * The bubble kit for one playback step. Returns null for a step with
 * no recorded words (fencedSpeech's rule — no words, no bubble).
 * variant 'panel' never truncates; variant 'stage' caps the DISPLAY
 * text and marks the cut. `text` is the full recorded words in both.
 */
export function bubbleKit(step, { variant = 'panel', maxChars = BUBBLE_STAGE_MAX_CHARS } = {}) {
  const fenced = fencedSpeech(step);
  if (!fenced) return null;
  let displayText = fenced.text;
  let truncated = false;
  if (variant === 'stage' && fenced.text.length > maxChars) {
    let cut = fenced.text.lastIndexOf(' ', maxChars);
    if (cut <= 0) cut = maxChars;
    displayText = fenced.text.slice(0, cut);
    truncated = true;
  }
  return {
    ...fenced,
    at: typeof step?.at === 'string' ? step.at : null,
    header: bubbleHeader(step),
    variant,
    displayText,
    truncated,
    marker: truncated ? READ_IN_FULL_MARKER : null,
  };
}

// ------------------------------------------- conversation staging (M5.03)
//
// How a scheduled conversation is STAGED: who speaks, who listens,
// and whom each figure faces — decided here so every renderer (the
// 2D stage today, the 3D scene through the same import) stages the
// same conversation the same way. The honesty rules are the item's
// own: participants are the episode's speakers ONLY (the derivation
// never lists a silent attendee, and staging never adds one); a
// one-speaker episode is a LONE speaker — no facing target, no
// implied audience; facing is computed only from positions the
// caller actually has (a figure with no known position gets null
// facing, never an invented coordinate). Steps follow the recorded
// timestamp order — the playback model's own order.
//
// At TOWN altitude talk collapses: no bubbles, no facing — one icon
// plus one caption ("[Name] is talking at [place].", the shared
// citizen-caption wording), via talkAtAltitude.

/** The head icon for collapsed talk at town altitude (M5.03). */
export const TALK_ICON = 'talk';

const centroidOf = (pts) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

/**
 * The staging of one episode. `positions` maps speaker name ->
 * {x, y} in the caller's coordinate space (grid coords on both
 * Portal surfaces); speakers missing from it keep a null position.
 * Returns null for an episode with no recorded words.
 */
export function conversationStaging(episode, positions = {}) {
  const model = talkPlaybackModel(episode);
  if (!model) return null;
  const names = [];
  for (const step of model.steps) if (!names.includes(step.speaker)) names.push(step.speaker);
  const speakers = names.map((name) => ({
    name,
    position: positions?.[name] ?? null,
    utteranceCount: model.steps.filter((s) => s.speaker === name).length,
  }));
  const lone = names.length === 1;
  const steps = model.steps.map((step, index) => {
    const listeners = names.filter((n) => n !== step.speaker);
    const listenerPts = listeners.map((n) => positions?.[n]).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    const speakerPos = positions?.[step.speaker];
    return {
      index,
      speaker: step.speaker,
      listeners,
      // Posture: a town-node conversation stands — no seat is
      // evidenced at a place node, so no seated posture is claimed
      // here. A caller staging an interior scene may pass its own
      // evidenced posture to talkActPresentation; this model never
      // invents one.
      posture: 'standing',
      // The speaker faces the listeners (their centroid); each
      // listener faces the speaker. Null wherever a position the
      // facing would need is not evidenced to the caller.
      speakerFacesPoint: !lone && listenerPts.length > 0 ? centroidOf(listenerPts) : null,
      listenersFacePoint: speakerPos && Number.isFinite(speakerPos.x) && Number.isFinite(speakerPos.y)
        ? { x: speakerPos.x, y: speakerPos.y } : null,
      lone,
    };
  });
  return {
    key: model.key, placeCode: model.placeCode, disclosure: model.disclosure,
    lone, speakers, steps,
  };
}

/** The collapsed-talk caption for one staging step — the shared
 *  "talking" caption wording, built from the step's speaker only. */
export function talkCaption(staging, stepIndex, placeLabel) {
  const step = staging?.steps?.[stepIndex];
  if (!step) return null;
  const label = typeof placeLabel === 'function' ? placeLabel(staging.placeCode) : String(staging.placeCode || '');
  return `${step.speaker} is talking at ${label}.`;
}

/**
 * Talk at a viewing altitude: 'scene' keeps the staged bubbles;
 * 'town' collapses the step to icon + caption. Any other altitude
 * is a caller error, not a silent default.
 */
export function talkAtAltitude(staging, stepIndex, altitude, placeLabel) {
  if (altitude === 'scene') return { mode: 'bubbles', staging, stepIndex };
  if (altitude === 'town') {
    return { mode: 'icon-caption', icon: TALK_ICON, caption: talkCaption(staging, stepIndex, placeLabel) };
  }
  throw new TypeError(`talkAtAltitude: unknown altitude ${String(altitude)} (expected 'scene' or 'town')`);
}

// --------------------------------- talk surface consumption (M5 lane)
//
// talkActPresentation is the ONE consumption model for a scheduled
// talk act: every surface that stages talk (the Conversations panel,
// the 2D stage, the 3D scene) renders from its return and from
// nothing else. It composes the lane models without re-deriving any
// of them: the speaker's and listeners' readability presentations
// come from readabilityPresentation (M5.06 — icon + word, the pre-act
// lead, the caption, the clip), the bubble from bubbleKit (M5.02 —
// fenced, verbatim, marked truncation), the facing from
// conversationStaging (M5.03), and the town-altitude collapse from
// talkAtAltitude (M5.03). A surface that builds its own icon, caption
// or clip choice for a talk act is the fork the talk lane's
// Conflict 5 rule forbids.
//
// CONFLICT RULES (treatments vs talk state — recorded here, applied
// here, so no surface improvises its own): a figure's current
// treatment outranks a talk gesture for THAT figure.
//   asleep   — a sleeping figure does not talk, and is not staged
//              listening: it keeps the M4.25 asleep treatment. The
//              recorded words are not deleted — they stay in the
//              panel transcript, which is the record, not a figure
//              performance.
//   held     — a place-conflict HOLD means the figure's place is
//              disputed; no talk is staged at a disputed place.
//   overflow — a figure beyond the scene's actor budget (M4.16) is
//              not embodied, so no gesture or bubble is staged for
//              it on that surface; it stays named on the roster rail.
// A blocked SPEAKER suppresses the whole staged act (nothing in it
// is performed); a blocked listener is simply not staged as a
// listener — never replaced, never invented. Scenes themselves
// never overlap a figure (the M5.01 scheduler serialises them), so
// recorded order is the only ordering rule left: earlier scenes
// stage first, exactly as scheduled.
// Talk NEVER moves a figure: this model reads positions (for facing)
// and writes none; gestures are in place, always.
//
// THE MODE (VER-D22 — the project owner's ruling, 2026-11-03: "recordings play
// as recorded"): every call names its mode — 'live' or 'recording'
// — explicitly. There is no default; any other value is a caller
// error, because a surface that cannot say which it is must not be
// allowed to inherit either behaviour silently. The modes differ in
// exactly one rule: whose present state governs a figure.
//   live      — the letter above, unchanged. The treatments the
//               caller passes are the figures' current treatments,
//               and an asleep figure does not talk or listen.
//   recording — the act being staged is a RECORD, and the episode
//               is the authority for who was awake at it: the
//               speaker spoke, and an evidenced listener was there
//               to listen. A caller-passed 'asleep' treatment is a
//               fact about the LIVE snapshot, so it never
//               suppresses a recorded act; each set-aside is
//               reported in the return's recordOverrides, never
//               silently dropped. 'held' and 'overflow' still
//               suppress in recording mode: they are facts about
//               the record and the surface (a disputed place; a
//               figure this surface does not embody), not about
//               the live moment.
// A recording never alters a figure's live treatment: when
// playback stops, the surfaces restore it exactly as it was.

const TALK_TREATMENT_RESOLUTIONS = {
  asleep: 'keeps the asleep treatment — a sleeping figure does not talk or listen on stage; the recorded words stay in the panel transcript',
  held: 'keeps the held treatment — no talk is staged at a disputed place; the recorded words stay in the panel transcript',
  overflow: 'stays on the roster rail — not embodied on this surface, so no gesture or bubble is staged for it',
};

const TALK_RECORDING_ASLEEP_RESOLUTION = 'staged per the record — this act is a recording, and the record is the authority for it: the figure was awake at this act when it happened; the asleep treatment the live snapshot carries resumes when playback stops';

/**
 * The full staged presentation of one scheduled talk event.
 *   episode:    the recorded episode (words live here)
 *   event:      one scheduleTalkScene event (index/speaker/text/at/
 *               startMs/endMs — the event and the staging step must
 *               agree on the speaker, or nothing is presented: a
 *               mismatched pair is a caller bug, and misattributing
 *               recorded words is worse than silence)
 *   positions:  speaker name -> {x, y} the caller actually has
 *   placeLabel: label fn (or string) for the episode's place
 *   altitude:   'scene' (bubbles + gestures + facing) or 'town'
 *               (icon + caption only, per talkAtAltitude)
 *   rate:       playback rate for the pre-act icon lead
 *   treatments: speaker/listener name -> treatment ('asleep' /
 *               'held' / 'overflow', or a figureStyle result)
 *   posture:    an evidenced posture override for the speaker
 *               ('standing' | 'seated'); default is the staging
 *               step's own posture.
 *   mode:       REQUIRED — 'live' or 'recording' (see THE MODE
 *               above). No default: a caller that cannot say which
 *               it is has a bug, and gets a TypeError.
 * Returns null when the episode has no recorded words or the event
 * does not belong to it.
 */
export function talkActPresentation({ episode, event, positions = {}, placeLabel = null, altitude = 'scene', rate = 1, treatments = {}, posture = null, mode } = {}) {
  if (mode !== 'live' && mode !== 'recording') {
    throw new TypeError(`talkActPresentation: mode must be named explicitly — 'live' or 'recording' (got ${String(mode)})`);
  }
  const staging = conversationStaging(episode, positions);
  if (!staging || !event || !Number.isInteger(event.index)) return null;
  const step = staging.steps[event.index];
  if (!step || step.speaker !== event.speaker) return null;
  const label = typeof placeLabel === 'function' ? placeLabel(staging.placeCode)
    : (typeof placeLabel === 'string' ? placeLabel : String(staging.placeCode || ''));
  const treatmentOf = (name) => {
    const t = treatments ? treatments[name] : null;
    if (!t) return null;
    return typeof t === 'string' ? t : (typeof t.treatment === 'string' ? t.treatment : null);
  };
  const conflicts = [];
  const recordOverrides = [];
  const blockedBy = (name, role) => {
    const treatment = treatmentOf(name);
    if (treatment === 'held' || treatment === 'overflow') {
      // Facts about the record and the surface — they govern in
      // both modes (VER-D22: see THE MODE above).
      conflicts.push({ name, role, treatment, resolution: TALK_TREATMENT_RESOLUTIONS[treatment] });
      return treatment;
    }
    if (treatment === 'asleep') {
      if (mode === 'recording') {
        // The live snapshot says asleep; the record says this
        // figure was awake at this act. A recording is governed
        // by the record — the act is staged, and the set-aside
        // is reported, never silent.
        recordOverrides.push({ name, role, treatment, resolution: TALK_RECORDING_ASLEEP_RESOLUTION });
        return null;
      }
      conflicts.push({ name, role, treatment, resolution: TALK_TREATMENT_RESOLUTIONS[treatment] });
      return treatment;
    }
    return null;
  };

  const speakerTreatment = blockedBy(step.speaker, 'speaker');
  let speaker = null;
  if (!speakerTreatment) {
    const presentation = readabilityPresentation({
      family: 'say',
      values: { name: step.speaker, place: label },
      actStartMs: typeof event.startMs === 'number' ? event.startMs : null,
      rate,
    });
    const postureUsed = posture || step.posture || 'standing';
    speaker = {
      name: step.speaker,
      treatment: treatmentOf(step.speaker),
      posture: postureUsed,
      // The model's gesture for the act: the standing talk clip, or
      // the seated variant when an evidenced posture says seated —
      // both are GESTURE_CLIPS entries, chosen here, not per surface.
      clip: postureUsed === 'seated' ? GESTURE_CLIPS['gesture-talk-seated'].clip : presentation.clip,
      presentation,
      facesPoint: step.speakerFacesPoint,
    };
  }
  const listeners = step.listeners.map((name) => {
    const treatment = blockedBy(name, 'listener');
    if (treatment) {
      return { name, treatment, blocked: true, presentation: null, clip: null, facesPoint: step.listenersFacePoint };
    }
    const presentation = readabilityPresentation({
      state: 'listening',
      values: { name, speaker: step.speaker, place: label },
      actStartMs: typeof event.startMs === 'number' ? event.startMs : null,
      rate,
    });
    return { name, treatment: treatmentOf(name), blocked: false, presentation, clip: presentation.clip, facesPoint: step.listenersFacePoint };
  });

  // Sleep suspension (G-J1 round 3 — the recordings ruling's
  // presentation consequence; my Hark's round-2 audit, blocker 2):
  // in recording mode, a figure the live snapshot has asleep but
  // the record stages in this act (a recordOverride) must not
  // CARRY the sleep presentation while their act plays — no Zzz
  // badge, no asleep treatment on a speaker or listener mid-act.
  // The model names them here; the scene applies it for the act's
  // duration and restores it when the act ends. Always empty in
  // live mode (live surfaces keep their treatments untouched),
  // empty for a suppressed act (nothing is staged, so nothing
  // suspends), and a figure the act does not stage — a blocked
  // listener — is never named: non-participants keep their sleep.
  const suspendSleep = [];
  if (mode === 'recording' && speaker) {
    const staged = new Set([speaker.name]);
    for (const l of listeners) if (!l.blocked) staged.add(l.name);
    for (const o of recordOverrides) {
      if (o.treatment === 'asleep' && staged.has(o.name) && !suspendSleep.includes(o.name)) suspendSleep.push(o.name);
    }
  }

  return {
    key: staging.key,
    placeCode: staging.placeCode,
    placeLabel: label,
    index: step.index,
    at: typeof event.at === 'string' ? event.at : null,
    startMs: typeof event.startMs === 'number' ? event.startMs : null,
    endMs: typeof event.endMs === 'number' ? event.endMs : null,
    lone: staging.lone,
    mode,
    speaker,
    listeners,
    suspendSleep,
    // The stage-variant bubble (scene altitude only, and only when
    // the speaker is staged): fenced words, byte-equal, truncation
    // marked beside the text. At town altitude there is no bubble.
    bubble: altitude === 'scene' && speaker ? bubbleKit(event, { variant: 'stage' }) : null,
    collapsed: talkAtAltitude(staging, step.index, altitude, () => label),
    conflicts,
    recordOverrides,
    suppressed: speaker === null,
    suppressedBy: speaker === null ? conflicts.find((c) => c.role === 'speaker') || null : null,
  };
}

// --------------------------------------------- set-piece templates (M5.04)
//
// The three set-piece shapes — lecture, dinner, storytelling — as
// replay plans over recorded episodes. A shape is claimed ONLY from
// record evidence: the episode's place AND the occasion headline's
// own words (the corroborating news item, passed in as
// `occasionText` — a structured record field, never fenced speech).
// Place alone never promotes an episode: a College conversation with
// no lecture headline in the record stays a conversation. Attendees
// are the episode's speakers, exactly — names mentioned INSIDE an
// utterance are testimony, never a roster (the College lecture's
// closing thanks names two citizens who never spoke there; they are
// not attendees, and a test pins that). Turns are the utterances in
// recorded (timestamp) order — for dinner that order IS the template:
// timestamp turn order, nobody re-seated by Portal.

/** Meridian Hall's place code (the dinner template's room). */
export const MERIDIAN_HALL_CODE = 'EMBER_DISTRICT_3_PLOT_18';

const SET_PIECE_RULES = [
  { shape: 'lecture', place: 'EMBER_COLLEGE', occasion: /lecture/i },
  { shape: 'dinner', place: MERIDIAN_HALL_CODE, occasion: /dinner/i },
  { shape: 'storytelling', place: 'EMBER_PLAZA_OF_UNITY', occasion: /gathering|storytelling/i },
];

/** The set-piece shape an episode + its occasion headline evidence,
 *  or 'conversation' when the record does not name a set piece. */
export function classifySetPiece(episode, occasionText = null) {
  if (!episode || typeof episode.place !== 'string') return 'conversation';
  const occ = typeof occasionText === 'string' ? occasionText : '';
  for (const rule of SET_PIECE_RULES) {
    if (episode.place === rule.place && rule.occasion.test(occ)) return rule.shape;
  }
  return 'conversation';
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * The replay plan for one episode under its evidenced shape:
 * attendees (speakers only), turns in recorded order, the staging
 * mode the template uses, the lecturer where the occasion headline
 * names one (a participant named in the headline's own words —
 * otherwise null, never guessed), and, for storytelling with a
 * known centre, the Plaza ring: one slot per speaker, in
 * first-speech order, evenly around the centre. Returns null for
 * an episode with no recorded words.
 */
export function setPiecePlan(episode, { occasionText = null, center = null, ringRadius = 0.8 } = {}) {
  const model = talkPlaybackModel(episode);
  if (!model) return null;
  const shape = classifySetPiece(episode, occasionText);
  const attendees = [];
  for (const step of model.steps) if (!attendees.includes(step.speaker)) attendees.push(step.speaker);
  const turns = model.steps.map((step, index) => ({ index, at: step.at, speaker: step.speaker }));
  let lecturer = null;
  if (shape === 'lecture' && typeof occasionText === 'string') {
    lecturer = attendees.find((name) => occasionText.includes(name)) ?? null;
  }
  let ring = null;
  if (shape === 'storytelling' && center && Number.isFinite(center.x) && Number.isFinite(center.y)) {
    ring = attendees.map((name, i) => {
      const a = (i * 2 * Math.PI) / attendees.length - Math.PI / 2;
      return { name, x: round3(center.x + ringRadius * Math.cos(a)), y: round3(center.y + ringRadius * Math.sin(a)) };
    });
  }
  return {
    shape,
    placeCode: model.placeCode,
    attendees,
    turns,
    lecturer,
    stagingMode: shape === 'lecture' ? 'face-lecturer' : shape === 'storytelling' ? 'ring' : 'face-speaker',
    ring,
  };
}

// ------------------------------------------- place conflicts, exits (M3.04)

// Presentation models for the engine's stuck-actor semantics
// (../engine/conflicts.mjs; Plan B §3.5's table, SE-2.5). The tracker
// consumes one placement observation per citizen per LIVE bundle —
// sample/fallback data is a recording and is never fed to it, so a
// recording cannot manufacture movement events. Apply a bundle's
// observations BEFORE rendering from it: held positions, conflict
// models and roster states all read the tracker's post-apply state.

/** The placement observation one bundle makes about one citizen:
 *  its placeCode (the deriver already nulls it for the unknown
 *  state) and the evidence stamp behind it. */
export function placementObservations(bundle) {
  return (bundle?.citizens || []).map((c) => ({
    key: citizenKeyOf(c),
    placeCode: c.state === 'unknown' ? null : (typeof c.placeCode === 'string' && c.placeCode !== '' ? c.placeCode : null),
    evidenceUtc: typeof c.evidenceUtc === 'string' && c.evidenceUtc !== '' ? c.evidenceUtc : null,
    bundleSeq: typeof bundle?.bundleSeq === 'number' ? bundle.bundleSeq : null,
  }));
}

/** Feed one bundle's observations to the tracker, in bundle order.
 *  Returns the placement events the bundle caused. */
export function applyBundlePlacements(tracker, bundle) {
  const events = [];
  for (const obs of placementObservations(bundle)) {
    events.push(...applyPlacement(tracker, obs));
  }
  return events;
}

/** Placement states for a bundle's citizens: Map key -> the
 *  tracker's snapshot (trackerCitizen) for citizens it tracks. */
export function placementStates(tracker, bundle) {
  const states = new Map();
  for (const c of bundle?.citizens || []) {
    const key = citizenKeyOf(c);
    const s = trackerCitizen(tracker, key);
    if (s) states.set(key, s);
  }
  return states;
}

// ------------------------------------------------- figure treatment (OM15-C2)

// How a stage figure is DRAWN, decided here so every renderer (the
// 2D canvas today, the 3D scene through the same import) makes the
// identical call from the identical inputs. OM-15 condition 2 (my
// Hark's staging-honesty audit): a citizen under a place-conflict
// HOLD stands at a place the record no longer supports, and a
// viewer reads the map before the card — so the held figure itself
// must look different, not only be explained in its card.
//
// Treatments:
//  - normal: full opacity, nothing extra.
//  - asleep: faded only (opacity 0.55 — the same value the 3D
//    scene's scaffold has always used), no ring, no marker. A
//    passive state: the placement itself is not in question.
//  - held: faded AND a dashed ring in the conflict amber AND a ≠
//    marker above the figure (≠: the record's two claims do not
//    agree). The ring and marker are the meaning — opacity alone
//    would be confusable with asleep, so held never relies on it.
//
// Precedence: held beats asleep. A held citizen who is also asleep
// shows HELD: the conflict says the figure's very placement is
// unsupported, which is the misreading the audit flagged; the
// asleep fact still stands in the caption and the card. Ring and
// marker colours are the conflict section's amber (styles.css
// .conflict) — amber, factual, never alarming.

/** The conflict amber, shared by the card's conflict section and
 *  the held figure's ring/marker. */
export const HELD_RING_COLOR = '#d9a441';
/** The held figure's marker glyph: the record's claims do not agree. */
export const HELD_MARKER_GLYPH = '≠';
/** The asleep figure's opacity — one value, both renderers. */
export const ASLEEP_OPACITY = 0.55;

/**
 * The stage treatment for one citizen: { treatment, opacity, ring,
 * marker }. `placement` is the tracker's snapshot for the citizen
 * (placementStates) or null when untracked. Only drawn figures are
 * decided here — unknown citizens are never placed, so they never
 * reach a renderer.
 */
export function figureStyle(citizen, placement = null) {
  if (placement && placement.conflict) {
    return {
      treatment: 'held',
      opacity: 0.5,
      ring: { color: HELD_RING_COLOR, width: 2.5, dash: [5, 4] },
      marker: { glyph: HELD_MARKER_GLYPH, color: HELD_RING_COLOR },
    };
  }
  if (citizen?.state === 'asleep') {
    return { treatment: 'asleep', opacity: ASLEEP_OPACITY, ring: null, marker: null };
  }
  return { treatment: 'normal', opacity: 1, ring: null, marker: null };
}

/**
 * Stage positions under the HOLD: like citizenPositions, but the
 * place a citizen stands at is the tracker's last UNCONFLICTED
 * placement — a citizen whose newest bundle placement is part of a
 * standing conflict stays at the place the record agreed on, an
 * absent citizen (the record stopped placing them) is not drawn,
 * and a citizen the tracker has never seen falls back to the
 * bundle's own placement rule. Placement stays EXACT-only over the
 * effective layout, with the same deterministic fan-out.
 */
export function heldCitizenPositions(bundle, layout, tracker) {
  const eff = effectiveLayout(layout, bundle);
  const pos = new Map();
  const byPlace = new Map();
  for (const c of bundle?.citizens || []) {
    const key = citizenKeyOf(c);
    const tracked = tracker ? trackerCitizen(tracker, key) : null;
    let placeCode;
    if (tracked) {
      if (tracked.presence !== 'placed') continue;
      placeCode = tracked.shown?.placeCode ?? null;
      if (!placeCode) continue;
    } else {
      if (!isEvidenced(c)) continue;
      placeCode = c.placeCode;
    }
    const node = resolveExactNode(eff, placeCode);
    if (!node) continue;
    const idx = byPlace.get(node.code) || 0;
    byPlace.set(node.code, idx + 1);
    pos.set(key, {
      x: node.x + (idx - 0.5) * 0.35,
      y: node.y + 0.25 + idx * 0.18,
      code: node.code,
    });
  }
  return pos;
}

/** The citizen card's conflict model: both (or all) claims with
 *  their place codes, the place the figure is held at, and the
 *  disclosure — or null when the citizen is not in a conflict. */
export function conflictModel(tracker, key, placeLabel) {
  const s = trackerCitizen(tracker, key);
  if (!s?.conflict) return null;
  const label = labelOrSelf(placeLabel);
  return {
    key,
    claims: s.conflict.claims.map((cl) => ({
      placeCode: cl.placeCode,
      placeLabel: label(cl.placeCode),
      evidenceUtc: cl.evidenceUtc,
    })),
    heldPlaceCode: s.shown?.placeCode ?? null,
    heldPlaceLabel: s.shown ? label(s.shown.placeCode) : null,
    disclosure: s.conflict.disclosure,
  };
}

/**
 * Ticker lines for placement events. Only the LABELLED kinds become
 * lines — exits, entries, conflicts, lifted holds; ordinary moves
 * are journeys' business (M3.01/M3.06) and would flood the ticker.
 * Each line carries the event's `staging` and `hold` flags and its
 * disclosure verbatim: §7.3's harness asserts the disclosure FLAG,
 * not just the path, so the flags ride the model, not the prose.
 * Wording rule for exits: the public feeds stopped placing them — never
 * that they left the town.
 */
export function placementEventLines(events, nameFor, placeLabel) {
  const name = typeof nameFor === 'function' ? nameFor : (key) => key;
  const label = labelOrSelf(placeLabel);
  const lines = [];
  for (const ev of events || []) {
    const who = name(ev.key);
    if (ev.type === 'exit') {
      lines.push({
        kind: 'exit', key: ev.key, utc: ev.evidenceUtc, staging: ev.staging === true, hold: false,
        disclosure: ev.disclosure,
        text: `${who} left the public feeds Portal reads — the feeds stopped placing them, last at ${label(ev.fromPlace)}. That is not the same as leaving the town.`,
      });
    } else if (ev.type === 'entry') {
      lines.push({
        kind: 'entry', key: ev.key, utc: ev.evidenceUtc, staging: ev.staging === true, hold: false,
        disclosure: ev.disclosure,
        text: `${who} is in the public feeds Portal reads again — at ${label(ev.placeCode)}.`,
      });
    } else if (ev.type === 'place-conflict' || ev.type === 'conflict-widened') {
      const places = ev.claims.map((cl) => label(cl.placeCode)).join(' and ');
      lines.push({
        kind: 'place-conflict', key: ev.key, utc: ev.evidenceUtc, staging: false, hold: true,
        disclosure: ev.disclosure,
        text: `${who} — place conflict: the public feeds Portal reads name ${places} in the same tick. Portal is holding ${who} at ${ev.heldPlace ? label(ev.heldPlace) : 'no agreed place'} until a later feed names one place.`,
      });
    } else if (ev.type === 'conflict-resolved') {
      lines.push({
        kind: 'conflict-resolved', key: ev.key, utc: ev.evidenceUtc, staging: false, hold: false,
        disclosure: ev.disclosure,
        text: ev.resolvedPlace
          ? `${who} — the public feeds Portal reads name one place again (${label(ev.resolvedPlace)}); the place-conflict hold is lifted.`
          : `${who} — the place-conflict hold is lifted; the public feeds Portal reads name no place for them now.`,
      });
    }
  }
  return lines;
}

/**
 * The staging geometry of an exit (§3.5's vanish row): a short walk
 * to a door/edge where the layout offers one — the neighbour is the
 * place's first street by code order, deterministic — or a fade
 * where no honest exit exists (an isolated place). The walk is
 * staging of an unwitnessed departure and is labelled as such by
 * the exit event; this helper only answers walk-or-fade, and to
 * where. Entries reverse the same answer.
 */
export function exitStagingFor(layout, placeCode) {
  const neighbours = new Set();
  for (const e of layout?.edges || []) {
    if (e.a === placeCode) neighbours.add(e.b);
    if (e.b === placeCode) neighbours.add(e.a);
  }
  const sorted = [...neighbours].sort(cmpCodeUnit);
  if (!sorted.length) return { kind: 'fade', from: placeCode, to: null };
  return { kind: 'walk', from: placeCode, to: sorted[0] };
}

/** The follow-bar line for a journey assessment (engine
 *  assessJourney): the paused state's caption is §3.5's decided
 *  copy, rendered here with the place's LABEL through the engine's
 *  own template so the two can never drift apart. */
export function watchdogLine(assessment, placeLabel) {
  if (!assessment) return null;
  const label = labelOrSelf(placeLabel);
  switch (assessment.state) {
    case 'paused':
      return ON_THE_WAY_CAPTION(label(assessment.destination));
    case 'return-walk':
      return `The record puts them back at ${label(assessment.origin)} — Portal shows the walk back.`;
    case 'return-summary':
      return `The record puts them back at ${label(assessment.origin)} — the walk back is listed, not shown.`;
    case 'returned':
      return `The record puts them back at ${label(assessment.origin)}.`;
    default:
      return null;
  }
}

/**
// ------------------------------------------------- find & watch (M6)
//
// The spectator loop's front half: notice (M6.01 ticker) → locate
// (M6.02 routes + strip) → follow (M6.07's lane) → read, with the
// provenance inspector (M6.06) one tap from every claim and the
// now-in-Ember line (M6.03) verified clause by clause. Every model
// here is pure and draws ONLY on the bundle (and the layout /
// placement snapshots the caller passes): where the record is
// silent, the model says so in plain words — it never invents a
// title, a whereabouts, a landing, or a binding.

/** A stamp as a plain UTC date — "3 Nov 2026" — or null when the
 *  stamp is missing or unreadable (callers then omit the clause
 *  rather than inventing a date). */
export function plainDate(isoUtc) {
  if (typeof isoUtc !== 'string') return null;
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${RANGE_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// --- M6.01: the herald ticker's closed-set chip ---------------------
//
// The record's headline kinds are machine codes (RUIN_EXCAVATED,
// PEOPLE_ALL_KINDS, …). A reader never sees them: each kind in the
// closed set maps to a chip of icon + plain word, and a kind outside
// the set falls back to the plain News chip — the raw code itself
// renders ONLY inside the provenance inspector (inspectorHtml),
// which is the one surface whose job is showing the record as-is.
// The set is the vocabulary the archived headlines actually carry
// (both archive days scanned 2026-11-03) plus the sample fixture's
// Portal-authored kinds. Icons are text glyphs in the app's existing
// register (● ❝ ≠ ▶) and always ride WITH their word — an unlabelled
// icon fails M4.23's standing rule by construction here.

export const TICKER_KIND_CHIPS = {
  RUIN_EXCAVATED: { icon: '⚒', word: 'Ruin dug' },
  STRUCTURE_COLLAPSED: { icon: '▼', word: 'Structure fell' },
  CITY_EVENT_BEGAN: { icon: '⚑', word: 'City event' },
  HAPPENING_WITNESSED: { icon: '✦', word: 'Witnessed' },
  OUTLOOK_CHANGED: { icon: '☀', word: 'Outlook' },
  PEOPLE_ALL_KINDS: { icon: '☺', word: 'The peoples' },
  Gathering: { icon: '☺', word: 'Gathering' },
  College: { icon: '✎', word: 'College' },
  Repair: { icon: '⚙', word: 'Repair' },
  Newspaper: { icon: '▤', word: 'Newspaper' },
  Building: { icon: '⌂', word: 'Building' },
};

/** The chip for a kind outside the closed set: a plain News chip.
 *  The kind is never echoed — not even capitalised or spaced out. */
export const TICKER_CHIP_FALLBACK = { icon: '●', word: 'News' };

/** The chip for placement (tracker) lines — Portal's own lines, not
 *  record kinds, with their own chip in the same closed set. */
export const MOVEMENT_CHIP = { icon: '→', word: 'Movement' };

/** The chip model for one headline kind: {icon, word, known}. */
export function tickerChip(kind) {
  const hit = typeof kind === 'string' ? TICKER_KIND_CHIPS[kind] : undefined;
  return hit ? { ...hit, known: true } : { ...TICKER_CHIP_FALLBACK, known: false };
}

/**
 * The deadline form (Design T1/T2): an item carrying a structured
 * due stamp reads "Answer due by [date]". The frozen v2 ticker
 * carries no due field, so on live bundles this returns null for
 * every item and no deadline renders — the date is never mined out
 * of the item's sentence, which would be inventing structure the
 * record did not state.
 */
export function tickerDeadlineText(item) {
  const date = plainDate(item?.dueUtc);
  return date ? `Answer due by ${date}` : null;
}

/**
 * Where a ticker item's [Take me there] lands, resolved from its
 * STRUCTURED fields only: its place code, when that code resolves
 * exactly to a node on the effective layout; else the first of its
 * recorded citizen references (handles carry PORTAL-KEYs) that the
 * record currently places on the stage plan. Returns null when
 * neither resolves — the item then carries no such button (an
 * absent action, never a dead one): a ruin dug at a frontier cell
 * has its "there" on the frontier map (M6.11), not on this stage.
 */
export function tickerLanding(item, bundle, layout) {
  if (!item) return null;
  const eff = layout ? effectiveLayout(layout, bundle) : null;
  if (item.placeCode && eff) {
    const node = resolveExactNode(eff, item.placeCode);
    if (node) return { type: 'place', code: node.code, label: node.label };
  }
  for (const h of item.handles || []) {
    const c = (bundle?.citizens || []).find((x) => citizenKeyOf(x) === h || x.handle === h);
    if (c && isEvidenced(c) && eff && resolveExactNode(eff, c.placeCode)) {
      return { type: 'citizen', key: citizenKeyOf(c), name: c.name };
    }
  }
  return null;
}

/** Where a placement (tracker) line's [Take me there] lands: its
 *  citizen, when the tracker currently places them (or, without a
 *  tracker snapshot, when the bundle evidences them). A held or
 *  absent citizen has no landing — the line says where they are
 *  held, or that the feeds stopped placing them, instead. */
export function movementLanding(line, bundle, placements = null) {
  if (!line?.key) return null;
  const tracked = placements?.get(line.key) || null;
  if (tracked) {
    return tracked.presence === 'placed' && !tracked.conflict && tracked.shown
      ? { type: 'citizen', key: line.key }
      : null;
  }
  const c = (bundle?.citizens || []).find((x) => citizenKeyOf(x) === line.key);
  return c && isEvidenced(c) ? { type: 'citizen', key: line.key } : null;
}

// --- M6.03: the now-in-Ember line -----------------------------------
//
// One sentence, evidenced clauses only. The old inline form counted
// only AWAKE placed citizens and fell back to "Nobody is in the
// public feeds…" when all of them were asleep — a false clause
// against the live bundle of 2026-11-03 (14 citizens placed, every
// one asleep). The model's subject is therefore everyone the record
// PLACES right now (asleep included — the record places them, and
// the stage draws them); the asleep fact is its own clause, present
// only when true, and the quiet wording appears only when nobody is
// placed at all, or after the placed count when everyone placed is
// asleep. `clauses` exposes each count so a verifier can check the
// sentence clause by clause against the bundle it came from.

export const NOW_LINE_QUIET = 'Ember is quiet — that is a normal hour for this town.';

export function nowLineModel(bundle) {
  const citizens = bundle?.citizens || [];
  const placedList = citizens.filter((c) => isEvidenced(c));
  const placed = placedList.length;
  const asleep = placedList.filter((c) => c.state === 'asleep').length;
  const awake = placed - asleep;
  const atPlaza = placedList.filter((c) => c.placeCode === 'EMBER_PLAZA_OF_UNITY').length;
  if (placed === 0) {
    return {
      text: `Nobody is in the public feeds Portal reads right now. ${NOW_LINE_QUIET}`,
      placed, awake, asleep, atPlaza, quiet: true,
    };
  }
  let text = `${placed} citizen${placed === 1 ? ' is' : 's are'} in the public feeds Portal reads right now`;
  if (atPlaza > 0) text += `, ${atPlaza} of them at the Plaza`;
  text += '.';
  if (asleep === placed) text += ` All of them are asleep / away. ${NOW_LINE_QUIET}`;
  else if (asleep > 0) text += ` ${asleep} of them ${asleep === 1 ? 'is' : 'are'} asleep / away.`;
  return { text, placed, awake, asleep, atPlaza, quiet: awake === 0 };
}

/**
 * The population as three distinct numbers — never one bare number:
 * joined (the world's own count, counters.populationKnown — the
 * deriver takes it from the overview's population.joined), nameable
 * (the citizens this bundle carries records for), and placed (those
 * with a place in the feeds right now). Any of them may be absent
 * from a bundle; absent stays absent (null), never zero-filled.
 */
export function populationCounts(bundle) {
  const joined = bundle?.counters?.populationKnown;
  return {
    joined: typeof joined === 'number' && Number.isFinite(joined) ? joined : null,
    nameable: (bundle?.citizens || []).length,
    placed: (bundle?.citizens || []).filter((c) => isEvidenced(c)).length,
  };
}

// --- M6.04: offices, titles, namesakes, where-now -------------------
//
// Office evidence: the world's overview names its office holders
// (ember.mayor today), but the FROZEN v2 bundle carries no office
// field — so on live bundles officesOf finds nothing, no title
// renders, and the strip orders by placement alone. The models below
// consume office evidence in either of the two shapes a contract
// amendment could carry it in (a bundle.offices list, or the
// overview's ember.mayor object verbatim) and light up unchanged
// when it lands; the staged exercises in the test suite prove the
// ordering against fixtures, per the M6 brief's Conflicts 5. An
// office attaches to a citizen by citizenKey, or by the record's
// own name where the name matches exactly ONE citizen — a name two
// citizens share binds the office to NEITHER (PORTAL-KEY: ambiguity
// never binds). Titles are words only, office first.

/** Office precedence for ordering: the mayor's office first; any
 *  further offices follow in the order the record lists them. */
export const OFFICE_PRECEDENCE = ['MAYOR'];

/** An office code as a plain word: MAYOR → "Mayor"; an unlisted
 *  office's underscores become spaces and its words capitalise —
 *  the record's word, in words, never the raw code. */
export function officeWord(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  if (raw === 'MAYOR') return 'Mayor';
  return raw.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * The bundle's office evidence, normalised: [{office (raw), word,
 * key (PORTAL-KEY or null), name}]. key is null when the named
 * holder matches no citizen, or more than one — the office then
 * orders nothing and titles nobody until the record disambiguates.
 */
export function officesOf(bundle) {
  const raw = [];
  if (Array.isArray(bundle?.offices)) {
    for (const o of bundle.offices) {
      if (o && typeof o.office === 'string') raw.push({ office: o.office, citizenKey: o.citizenKey || null, name: o.name || null });
    }
  }
  const mayor = bundle?.ember?.mayor;
  if (mayor && typeof mayor.name === 'string' && mayor.name !== '' && mayor.sits !== false) {
    raw.push({ office: 'MAYOR', citizenKey: null, name: mayor.name });
  }
  const citizens = bundle?.citizens || [];
  return raw.map((o) => {
    let key = null;
    if (o.citizenKey && citizens.some((c) => citizenKeyOf(c) === o.citizenKey)) key = o.citizenKey;
    else if (o.name) {
      const matches = citizens.filter((c) => c.name === o.name);
      if (matches.length === 1) key = citizenKeyOf(matches[0]);
    }
    const holder = key ? citizens.find((c) => citizenKeyOf(c) === key) : null;
    return { office: o.office, word: officeWord(o.office), key, name: holder?.name || o.name || null };
  });
}

/** Offices sorted for presentation: precedence first, then the
 *  record's own order. */
export function officesInOrder(bundle) {
  const list = officesOf(bundle);
  return list
    .map((o, i) => ({ o, i, rank: OFFICE_PRECEDENCE.indexOf(o.office) }))
    .sort((a, b) => ((a.rank === -1 ? 99 : a.rank) - (b.rank === -1 ? 99 : b.rank)) || (a.i - b.i))
    .map(({ o }) => o);
}

/** The office words one citizen holds, office-first, words only. */
export function citizenOffices(bundle, citizen) {
  const key = citizenKeyOf(citizen || {});
  if (!key) return [];
  return officesInOrder(bundle).filter((o) => o.key === key).map((o) => o.word).filter(Boolean);
}

/** The citizen's title line — their office word(s), or null when
 *  the record names them to no office. Never an invented honour. */
export function citizenTitleLine(bundle, citizen) {
  const words = citizenOffices(bundle, citizen);
  return words.length ? words.join(', ') : null;
}

/**
 * Namesake disambiguation from the bundle's published collisions
 * (citizenCollisions, PORTAL-KEY condition 5): for a citizen whose
 * key sits in a collision group, {count, ordinal, firstSeenUtc} —
 * ordinal from the group's own citizenKeys order. null for everyone
 * else: a citizen with no namesake carries no tag.
 */
export function namesakeInfo(bundle, citizen) {
  const key = citizenKeyOf(citizen || {});
  for (const group of bundle?.citizenCollisions || []) {
    const keys = Array.isArray(group?.citizenKeys) ? group.citizenKeys : [];
    const idx = keys.indexOf(key);
    if (idx !== -1) {
      return { count: keys.length, ordinal: idx + 1, firstSeenUtc: citizen?.firstSeenUtc || null };
    }
  }
  return null;
}

/**
 * The "Where now" line — never blank, for every state the record
 * can put a citizen in: placed (the caption), held (the conflict
 * wording), absent (the out-of-the-feeds wording), asleep without a
 * place, and unknown (the don't-know wording). One model for card
 * and roster, so the two surfaces can never disagree about where
 * somebody is.
 */
export function whereNowLine(citizen, placeLabel, placement = null) {
  const label = labelOrSelf(placeLabel);
  const name = citizen?.name || 'This citizen';
  if (placement?.conflict) {
    return `Place conflict — held at ${placement.shown ? label(placement.shown.placeCode) : 'no agreed place'}; the public feeds Portal reads name two places in the same tick.`;
  }
  if (placement?.presence === 'absent') {
    return 'Out of the public feeds Portal reads right now — the feeds stopped placing them. That is not the same as leaving the town.';
  }
  if (isEvidenced(citizen)) return citizenCaption(citizen, label(citizen.placeCode));
  if (citizen?.state === 'asleep') return `${name} is asleep / away — where they are is not in the public feeds Portal reads right now.`;
  return citizenCaption(citizen, label(citizen?.placeCode));
}

// --- M6.06: the provenance inspector --------------------------------
//
// "How Portal knows this": one surface every claim can open — the
// citizen card's, the ticker's, and the directory's [Record]
// actions all land here. A claim renders as: the claim itself in
// plain words; its source (the route Portal read, and when); its
// evidence class with BOTH class values shown and the applicable
// one marked (where neither applies — Tier P carries no building
// integrity — the panel says so instead of marking one); its
// staging notes wherever Portal's stage, not the record, supplies
// part of the picture; the raw record kind for ticker claims (the
// ONE surface raw codes may render on); and the world book the
// claim belongs to. Claims are keyed by book (bookClaimKey): a new
// book never inherits, merges, or overwrites an old book's claims.

/** The evidence-class pair, both values, in display order. */
export const EVIDENCE_CLASSES = [
  { key: 'feed-evidenced', word: 'Feed-evidenced', detail: 'the public feeds Portal reads carried this, at the stamp shown.' },
  { key: 'record-attested', word: 'Record-attested', detail: 'Portal\'s own saved record attests this; the live feeds are not carrying it now.' },
];

/** The D6 reset wording, held ready as data: when a new world book
 *  opens, this is what the banner says — and the inspector carries
 *  the standing form of it at all times, so the promise is on the
 *  page before it is ever needed. */
export const RESET_WORDING = {
  heading: 'A new world book',
  standing: 'If the world begins again, Portal starts a new book: the old book stays readable in Portal\'s archive, and nobody is carried across by name — a citizen in the new book is a new record, even when the name matches.',
  banner: (oldBook, newBook) => `The public feeds Portal reads now belong to a new book (${newBook}). The old book (${oldBook}) stays readable in Portal's archive; nobody is carried across by name — a citizen in the new book is a new record, even when the name matches.`,
};

/** The reset banner model: non-null exactly when a live bundle's
 *  book differs from the book the page was reading. The first book
 *  a page sees is not a reset. */
export function resetBannerModel(previousBookId, bundle) {
  const bookId = bundle?.world?.bookId;
  if (!previousBookId || !bookId || bookId === previousBookId) return null;
  return { oldBook: previousBookId, newBook: bookId, heading: RESET_WORDING.heading, text: RESET_WORDING.banner(previousBookId, bookId) };
}

/** A claim's key, scoped to its world book: the no-merge rule in
 *  model form. The same citizen key in two books is two claims. */
export function bookClaimKey(bookId, key) {
  return `${bookId || 'no-book'}:${key}`;
}

const STAGING_NOTE_POSITION = 'The exact spot where the figure stands is Portal\'s staging — the record names the place, not a spot on the pavement.';
const STAGING_NOTE_PLACE = 'The place\'s position and shape on the stage are Portal\'s staging — the world records places, not street distances.';

/**
 * The inspector model for one claim. Claim shapes:
 *   {type:'citizen', bundle, citizen, placement?, placeLabel?}
 *   {type:'ticker', bundle, item}
 *   {type:'building', bundle, node, work}
 *   {type:'movement', bundle, line}
 * Every field the HTML renders is decided here; the HTML builder
 * only escapes and assembles.
 */
export function inspectorModel(claim) {
  const bundle = claim?.bundle || null;
  const bookId = bundle?.world?.bookId || null;
  const base = { bookId, classes: EVIDENCE_CLASSES, resetStanding: RESET_WORDING.standing };
  if (!claim) return { ...base, title: 'Nothing inspected', claimText: 'No claim was handed to the inspector.', sourceText: null, evidenceClass: null, stagingNotes: [], rawKind: null };
  if (claim.type === 'citizen') {
    const c = claim.citizen;
    const notes = [STAGING_NOTE_POSITION];
    if (claim.placement?.conflict) notes.push('This figure is HELD: the record names two places in the same tick, and the figure stands at the last place the record agreed on.');
    return {
      ...base,
      title: c?.name || 'A citizen',
      claimText: whereNowLine(c, claim.placeLabel, claim.placement || null),
      sourceText: c?.provenance ? `Read from the ${c.provenance.route || 'not recorded'} feed, at ${c.provenance.fetchedUtc || 'an unrecorded time'}.` : 'This claim carries no source in the bundle, so Portal says so rather than guessing.',
      evidenceClass: c?.provenance ? 'feed-evidenced' : null,
      stagingNotes: notes,
      rawKind: null,
      claimKey: bookClaimKey(bookId, citizenKeyOf(c || {})),
    };
  }
  if (claim.type === 'ticker') {
    const item = claim.item;
    const notes = [];
    if (item?.placeCode) notes.push(STAGING_NOTE_PLACE);
    return {
      ...base,
      title: 'A news item',
      claimText: item?.text || '',
      sourceText: item?.provenance ? `Read from the ${item.provenance.route || 'not recorded'} feed, at ${item.provenance.fetchedUtc || 'an unrecorded time'}.` : 'This claim carries no source in the bundle, so Portal says so rather than guessing.',
      evidenceClass: item?.provenance ? 'feed-evidenced' : null,
      stagingNotes: notes,
      rawKind: typeof item?.kind === 'string' && item.kind !== '' ? item.kind : null,
      claimKey: bookClaimKey(bookId, `ticker:${item?.utc || ''}:${item?.text || ''}`),
    };
  }
  if (claim.type === 'building') {
    const node = claim.node;
    const work = claim.work || null;
    const tier = workTier(bundle, node?.code);
    const hasIntegrity = typeof work?.integrity === 'number';
    return {
      ...base,
      title: node?.label || 'A place',
      claimText: hasIntegrity
        ? `Repair: ${tier.label} (${work.integrity} out of 100).`
        : 'This place is part of Ember\'s stage. Its repair is not in the public feeds Portal reads.',
      sourceText: work?.provenance ? `Read from the ${work.provenance.route || 'not recorded'} feed, at ${work.provenance.fetchedUtc || 'an unrecorded time'}.` : 'The stage plan attests this place; no feed source rides in this bundle for it.',
      evidenceClass: hasIntegrity ? 'feed-evidenced' : null,
      evidenceNote: hasIntegrity ? null : 'Neither class is marked for the repair claim: the public feeds Portal reads carry no building integrity in Tier P (the bundle states it as world.integritySource: "none-in-tier-p"), so Portal shows no repair state rather than borrowing one.',
      stagingNotes: [STAGING_NOTE_PLACE],
      rawKind: null,
      claimKey: bookClaimKey(bookId, `place:${node?.code || ''}`),
    };
  }
  // -- M6.05 citizen-page claims: every story entry on a citizen's
  // page opens here, so the page's sampled claims resolve to the
  // record they were built from — a snapshot pair, a journey's
  // evidence bounds, a first's cited line, or the citizen record's
  // own source stamp.
  if (claim.type === 'page-first-seen') {
    const c = claim.citizen;
    return {
      ...base,
      title: c?.name || 'A citizen',
      claimText: `${c?.name || 'This citizen'} first appears in the public feeds Portal reads at ${c?.firstSeenUtc || 'an unrecorded time'}.`,
      sourceText: c?.provenance ? `The citizen record itself, read from the ${c.provenance.route || 'not recorded'} feed, at ${c.provenance.fetchedUtc || 'an unrecorded time'}; the record carries the first-seen stamp ${c.firstSeenUtc || 'unrecorded'}.` : 'This claim carries no source in the bundle, so Portal says so rather than guessing.',
      evidenceClass: c?.provenance ? 'feed-evidenced' : null,
      stagingNotes: [],
      rawKind: null,
      claimKey: bookClaimKey(bookId, `${citizenKeyOf(c || {})}:first-seen`),
    };
  }
  if (claim.type === 'page-episode') {
    const ep = claim.episode;
    const gf = claim.source?.generatedFrom || null;
    return {
      ...base,
      title: 'A recorded conversation',
      claimText: `${claim.citizen?.name || 'This citizen'} is recorded speaking at ${ep?.place || 'a place'} from ${ep?.firstUtc || 'an unrecorded time'} to ${ep?.lastUtc || 'an unrecorded time'} (${ep?.utteranceCount ?? 0} recorded utterances). ${ep?.disclosure || ''}`,
      sourceText: gf
        ? `Portal's episodes record, derived from the public feeds Portal reads — generated from the voices snapshot ${gf.voicesFile || 'unrecorded'} and the news snapshot ${gf.newsFile || 'unrecorded'} in Portal's archive.`
        : `Carried in the bundle Portal read at ${bundle?.newestFetchUtc || 'an unrecorded time'}; the episode is a summary there and its recorded words live in Portal's episodes record.`,
      evidenceClass: 'feed-evidenced',
      stagingNotes: [],
      rawKind: null,
      claimKey: bookClaimKey(bookId, `${citizenKeyOf(claim.citizen || {})}:episode:${ep?.place || ''}:${ep?.firstUtc || ''}`),
    };
  }
  if (claim.type === 'page-journey') {
    const j = claim.journey;
    const gf = claim.feed?.generatedFrom || null;
    return {
      ...base,
      title: 'A reconstructed journey',
      claimText: `${j?.name || claim.citizen?.name || 'This citizen'} travelled from ${j?.from || 'a place'} to ${j?.to || 'a place'} — last evidenced at the origin ${j?.departureUtc || 'at an unrecorded time'}, first evidenced at the destination ${j?.arrivalUtc || 'at an unrecorded time'}. ${j?.disclosure || claim.feed?.disclosure || ''}`,
      sourceText: gf
        ? `Portal's journeys record, reconstructed from ${gf.voicesSnapshotCount ?? 'an unrecorded number of'} voices snapshots in Portal's archive (${gf.firstVoicesSnapshotFile || 'unrecorded'} to ${gf.lastVoicesSnapshotFile || 'unrecorded'}); the leg's bounds are the departure utterance ${j?.evidence?.departureUtteranceId || 'unrecorded'} and the arrival utterance ${j?.evidence?.arrivalUtteranceId || 'unrecorded'}.`
        : 'Portal\'s journeys record carries this leg; its evidence bounds are the citizen\'s last utterance at the origin and first utterance at the destination.',
      evidenceClass: 'feed-evidenced',
      stagingNotes: ['The walk between the two bounds is Portal scheduling the evidence window — the record does not show when they left, which way they went, or whether they stopped.'],
      rawKind: null,
      claimKey: bookClaimKey(bookId, `${citizenKeyOf(claim.citizen || {})}:journey:${j?.from || ''}:${j?.to || ''}:${j?.departureUtc || ''}`),
    };
  }
  if (claim.type === 'page-arrival') {
    const j = claim.journey;
    const gf = claim.feed?.generatedFrom || null;
    return {
      ...base,
      title: 'A recorded arrival',
      claimText: `${j?.name || claim.citizen?.name || 'This citizen'} arrived at ${j?.to || 'their current place'} — first evidenced there ${j?.arrivalUtc || 'at an unrecorded time'}, the arrival bound of a reconstructed journey from ${j?.from || 'a place'} (last evidenced there ${j?.departureUtc || 'at an unrecorded time'}).`,
      sourceText: gf
        ? `Portal's journeys record, reconstructed from ${gf.voicesSnapshotCount ?? 'an unrecorded number of'} voices snapshots in Portal's archive (${gf.firstVoicesSnapshotFile || 'unrecorded'} to ${gf.lastVoicesSnapshotFile || 'unrecorded'}); the arrival bound is the arrival utterance ${j?.evidence?.arrivalUtteranceId || 'unrecorded'} in ${j?.evidence?.arrivalSnapshotFile || 'an unrecorded snapshot'}.`
        : 'Portal\'s journeys record carries this leg; its arrival bound is the citizen\'s first utterance at the destination.',
      evidenceClass: 'feed-evidenced',
      stagingNotes: ['The arrival wording appears only because this bound exists — without a journey record ending at the citizen\'s current place, the page shows no arrival line.'],
      rawKind: null,
      claimKey: bookClaimKey(bookId, `${citizenKeyOf(claim.citizen || {})}:arrival:${j?.to || ''}:${j?.arrivalUtc || ''}`),
    };
  }
  if (claim.type === 'page-first') {
    const f = claim.first;
    const p = f?.provenance || {};
    return {
      ...base,
      title: 'A first on the wall',
      claimText: f?.detail || '',
      sourceText: p.preseed
        ? `Older than Portal's own archive: the town record — ${p.source || 'the town record'} — which reads: “${p.citedLine || ''}”.`
        : `Portal's counting compared the public feeds Portal reads bundle to bundle and this appeared for the first time in bundle ${f?.bundleSeq ?? p.bundleSeq ?? 'unrecorded'}, read at ${f?.atUtc || 'an unrecorded time'}${p.route ? ` (route ${p.route})` : ''}.`,
      evidenceClass: p.preseed ? 'record-attested' : 'feed-evidenced',
      stagingNotes: [],
      rawKind: null,
      claimKey: bookClaimKey(bookId, `${citizenKeyOf(claim.citizen || {})}:first:${f?.kind || ''}:${f?.date || ''}`),
    };
  }
  if (claim.type === 'movement') {
    const line = claim.line;
    return {
      ...base,
      title: 'A movement line',
      claimText: line?.text || '',
      sourceText: 'Portal\'s placement tracker derived this line by comparing successive live bundles — it is Portal\'s reading of the feeds, labelled as staging where the change itself was not witnessed.',
      evidenceClass: 'feed-evidenced',
      stagingNotes: line?.disclosure ? [line.disclosure] : [],
      rawKind: null,
      claimKey: bookClaimKey(bookId, `movement:${line?.key || ''}:${line?.utc || ''}`),
    };
  }
  return { ...base, title: 'Nothing inspected', claimText: 'No claim was handed to the inspector.', sourceText: null, evidenceClass: null, stagingNotes: [], rawKind: null };
}

/** The inspector's HTML: the claim, its source, the evidence-class
 *  pair with the applicable value marked, staging notes, the raw
 *  record kind when the claim carries one (this panel is the one
 *  surface raw codes may render on), the world book, and the
 *  standing reset wording. All feed-born values escaped. */
export function inspectorHtml(model) {
  if (!model) return '';
  const classes = (model.classes || []).map((cl) => `
      <li${model.evidenceClass === cl.key ? ' class="marked"' : ''}><strong>${escapeHtml(cl.word)}</strong>${model.evidenceClass === cl.key ? ' — this claim' : ''}: ${escapeHtml(cl.detail)}</li>`).join('');
  return `
    <h3>${escapeHtml(model.title || 'How Portal knows this')}</h3>
    <p class="insp-claim">${escapeHtml(model.claimText || '')}</p>
    ${model.sourceText ? `<p><strong>Source:</strong> ${escapeHtml(model.sourceText)}</p>` : ''}
    <p><strong>Evidence class</strong> — both values, the applicable one marked:</p>
    <ul class="insp-classes">${classes}
    </ul>
    ${model.evidenceNote ? `<p class="soft">${escapeHtml(model.evidenceNote)}</p>` : ''}
    ${model.rawKind ? `<p><strong>Record kind:</strong> <code>${escapeHtml(model.rawKind)}</code> — the record's own code for this kind of item. It is shown here, in the inspector, and nowhere else on the page.</p>` : ''}
    ${(model.stagingNotes || []).length ? `<p><strong>Staging notes:</strong></p><ul>${model.stagingNotes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
    ${model.bookId ? `<p class="soft">World book: ${escapeHtml(model.bookId)}. Claims belong to their book; a new book starts new claims.</p>` : ''}
    <p class="soft">${escapeHtml(model.resetStanding || '')}</p>`;
}

/** The reset banner's HTML ('' when there is no reset to show). */
export function resetBannerHtml(model) {
  if (!model) return '';
  return `<strong>${escapeHtml(model.heading)}.</strong> ${escapeHtml(model.text)}`;
}

// --- M6.02: the building directory + the portrait strip -------------
//
// Two of the four locate routes (the roster is M6.04's surface; the
// map-with-live-dots is the stage itself, reached by the find nav).
// The directory lists every place on the effective layout — the
// stage plan's places plus bundle-evidenced plots — with who the
// record places there now. The strip shows at most seven faces in a
// FIXED order: office holders first, by office (the mayor's office
// before any other), then the remaining placed citizens in the
// bundle's own deterministic order. Only placed citizens appear —
// a face that cannot take you to a figure is not a locate route.

export const PORTRAIT_STRIP_LIMIT = 7;

/** The directory model: one row per effective-layout node, sorted
 *  by label (code-unit), with the citizens the record places there
 *  and the place's repair word where a work carries one. */
export function directoryModel(bundle, layout) {
  const eff = effectiveLayout(layout, bundle);
  const occupantsOf = (code) => (bundle?.citizens || [])
    .filter((c) => c.state !== 'unknown' && c.placeCode === code)
    .map((c) => ({ key: citizenKeyOf(c), name: c.name, evidenced: isEvidenced(c) }));
  return [...(eff?.nodes || [])]
    .sort((a, b) => cmpCodeUnit(String(a.label || ''), String(b.label || '')) || cmpCodeUnit(String(a.code || ''), String(b.code || '')))
    .map((node) => {
      const work = (bundle?.ember?.works || []).find((w) => w && w.code === node.code) || null;
      return {
        code: node.code,
        label: node.label,
        kind: node.kind || 'place',
        occupants: occupantsOf(node.code),
        repair: work ? workTier(bundle, node.code).label : null,
      };
    });
}

/** The directory list's HTML. Occupant names are follow buttons for
 *  evidenced citizens (the directory → citizen landing); every row
 *  carries its [Take me there]. All feed-born values escaped. */
export function directoryListHtml(rows) {
  if (!rows?.length) return '<li>No places on the stage plan yet.</li>';
  return rows.map((row) => `
    <li>
      <div class="dir-head"><span class="dir-label">${escapeHtml(row.label)}</span><button type="button" class="follow-small" data-there-place="${escapeHtml(row.code)}">Take me there</button></div>
      <div class="when">${row.occupants.length
        ? `Here now: ${row.occupants.map((o) => o.evidenced
          ? `<button type="button" class="follow-small" data-follow="${escapeHtml(o.key)}">${escapeHtml(o.name)}</button>`
          : escapeHtml(o.name)).join(' ')}`
        : 'Nobody is placed here in the public feeds Portal reads right now.'}${row.repair ? ` Repair: ${escapeHtml(row.repair)}.` : ''}</div>
    </li>`).join('');
}

/**
 * The portrait strip model: placed citizens (a stage position under
 * exact-only placement), ordered office-first then in bundle order,
 * capped at the limit. `placedTotal` counts everyone placed, so the
 * strip can say "7 of 14" instead of silently truncating.
 */
export function portraitStripModel(bundle, layout, { limit = PORTRAIT_STRIP_LIMIT } = {}) {
  const positions = citizenPositions(bundle, layout);
  const placed = (bundle?.citizens || []).filter((c) => positions.has(citizenKeyOf(c)));
  const officeRank = new Map();
  officesInOrder(bundle).forEach((o, i) => { if (o.key && !officeRank.has(o.key)) officeRank.set(o.key, i); });
  const ordered = placed
    .map((c, i) => ({ c, i, rank: officeRank.has(citizenKeyOf(c)) ? officeRank.get(citizenKeyOf(c)) : null }))
    .sort((a, b) => {
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank || a.i - b.i;
      if (a.rank !== null) return -1;
      if (b.rank !== null) return 1;
      return a.i - b.i;
    })
    .map(({ c }) => c);
  return {
    entries: ordered.slice(0, limit).map((c) => ({
      key: citizenKeyOf(c),
      name: c.name,
      color: citizenColor(citizenKeyOf(c)),
      office: citizenOffices(bundle, c)[0] || null,
      asleep: c.state === 'asleep',
    })),
    placedTotal: placed.length,
    shown: Math.min(limit, placed.length),
    limit,
  };
}

/** The portrait strip's HTML: one follow button per face (the
 *  strip → follow landing is a single tap), the office word under
 *  an office holder's name, and the honest count line. */
export function portraitStripHtml(model) {
  if (!model?.entries?.length) {
    return '<p class="soft">No citizen is placed in the public feeds Portal reads right now, so there are no faces to show.</p>';
  }
  const faces = model.entries.map((e) => `
    <button type="button" class="portrait${e.asleep ? ' asleep' : ''}" data-follow="${escapeHtml(e.key)}">
      <span class="portrait-dot" style="background:${e.color}">${escapeHtml((e.name || '?').split(' ')[0])}</span>
      <span class="portrait-name">${escapeHtml(e.name)}</span>
      ${e.office ? `<span class="portrait-office">${escapeHtml(e.office)}</span>` : ''}
    </button>`).join('');
  return `${faces}<p class="soft strip-count">Showing ${model.shown} of ${model.placedTotal} placed citizen${model.placedTotal === 1 ? '' : 's'} — office holders first, then the order the record lists them in. The roster lists everyone.</p>`;
}

/**
 * The act-sequence list model: recorded acts only, each sequence with
 * its acts-only disclosure passed through verbatim. Sequences assert
 * nothing between acts — the model carries no state field. Returns
 * null when there is no usable source.
 */
export function actListModel(feed) {
  if (!isConversationsSource(feed)) return null;
  return {
    sequences: feed.actSequences.map((s) => ({
      key: `${s.actor}|${s.kind}|${s.firstUtc}`,
      actor: s.actor,
      kind: s.kind,
      count: s.count,
      firstUtc: s.firstUtc,
      lastUtc: s.lastUtc,
      disclosure: s.disclosure,
      acts: (Array.isArray(s.acts) ? s.acts : []).map((a) => ({ at: a.at, phrase: a.phrase })),
    })),
  };
}

// ------------------------------------------------------- growth book (M6.08)

/**
 * The growth book feed (portal.growth-book/v1), written by the data
 * layer's diff writer (build/data/growth-cycle.mjs): the counted
 * bundle-to-bundle counter series plus the firsts wall, in the
 * "collecting since" form while the archive is young. Absence is
 * graceful — no book, an honest not-begun line, never an error.
 */
export function isGrowthBook(data) {
  return !!data && data.schema === 'portal.growth-book/v1'
    && Array.isArray(data.series) && Array.isArray(data.firsts);
}

/**
 * Chart geometry for one counter field over the book's series: a step
 * polyline (counters change at counted bundles and hold between them —
 * never smoothed, never interpolated). Points are scaled to the
 * field's own min/max with padding; a constant series renders flat at
 * mid-height; a single point renders as a dot. Null counters are
 * skipped — a gap in the record is a gap in the line, drawn as
 * separate segments. Pure and deterministic: same book, same points.
 */
export function growthChartSegments(book, field, width = 260, height = 56) {
  if (!isGrowthBook(book)) return [];
  const values = book.series.map((l) => (typeof l?.counters?.[field] === 'number' ? l.counters[field] : null));
  const present = values.filter((v) => v !== null);
  if (!present.length) return [];
  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min;
  const pad = span > 0 ? span * 0.15 : 1;
  const lo = min - pad;
  const hi = max + pad;
  const x = (i) => (values.length === 1 ? width / 2 : (i / (values.length - 1)) * width);
  const y = (v) => height - ((v - lo) / (hi - lo)) * height;
  const segments = [];
  let current = null;
  values.forEach((v, i) => {
    if (v === null) { current = null; return; }
    if (!current) { current = []; segments.push(current); }
    if (current.length) {
      const prev = current[current.length - 1];
      current.push(`${x(i).toFixed(1)},${prev.split(',')[1]}`); // step: across first
    }
    current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  return segments.map((pts) => pts.join(' '));
}

function growthFirstProvenanceHtml(first) {
  const p = first?.provenance || {};
  if (p.preseed) {
    return `<div class="prov"><strong>How Portal knows this:</strong> this first is older than Portal's own archive, so it rests on the town record — ${escapeHtml(p.source || 'the town record')} — which reads: “${escapeHtml(p.citedLine || '')}”. Portal marks it record-attested, a different class from its feed-counted firsts.</div>`;
  }
  return `<div class="prov"><strong>How Portal knows this:</strong> Portal's counting compared the public feeds Portal reads bundle to bundle and this appeared for the first time in bundle ${escapeHtml(first?.bundleSeq ?? p.bundleSeq ?? 'unrecorded')}, read at ${escapeHtml(first?.atUtc || 'an unrecorded time')}${p.route ? ` (route <code>${escapeHtml(p.route)}</code>)` : ''}.</div>`;
}

/**
 * The Growth book surface: collecting-since wording (the archive's
 * shallowness stated, never padded over), one step chart per counter
 * with a value-list twin that carries every counted value as plain
 * text, and the firsts wall with per-first provenance. Falls appear
 * exactly as rises do — the twin marks a negative day count with its
 * minus sign and the "fall" class, nothing is smoothed away. All
 * feed-derived text is escaped (M2.15).
 */
export function growthBookHtml(book) {
  if (!isGrowthBook(book)) {
    return `<div class="growth-book"><p class="soft">Portal's growth counting has not begun yet — no counting record has reached this page. When it does, the counted series and the firsts wall will stand here, from the first counted bundle onward. Nothing is backfilled.</p></div>`;
  }
  const fields = Array.isArray(book.counterFields) && book.counterFields.length ? book.counterFields : [];
  const labels = book.counterLabels || {};
  const lines = book.series;
  const days = new Set(lines.map((l) => l.date).filter(Boolean)).size;
  const charts = fields.map((field) => {
    const segments = growthChartSegments(book, field);
    const present = lines.map((l) => l?.counters?.[field]).filter((v) => typeof v === 'number');
    const latest = present.length ? present[present.length - 1] : null;
    const svg = segments.length
      ? `<svg class="growth-chart" viewBox="0 0 260 56" role="img" aria-label="${escapeHtml(labels[field] || field)} over time">${segments.map((pts) => `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6"/>`).join('')}</svg>`
      : '<p class="soft">Not in the record yet.</p>';
    return `<figure class="growth-fig"><figcaption>${escapeHtml(labels[field] || field)} — now ${latest === null ? 'not in the record' : formatCount(latest)}</figcaption>${svg}</figure>`;
  }).join('');
  const twinHead = fields.map((f) => `<th scope="col">${escapeHtml(labels[f] || f)}</th>`).join('');
  const twinRows = lines.map((l) => {
    const cells = fields.map((f) => {
      const v = l?.counters?.[f];
      return `<td>${typeof v === 'number' ? formatCount(v) : '—'}</td>`;
    }).join('');
    return `<tr><th scope="row">${escapeHtml(l.date || '')} · bundle ${escapeHtml(l.bundleSeq ?? '')}</th>${cells}</tr>`;
  }).join('');
  const firsts = book.firsts.map((f) => `<li class="first">
      <span class="first-date">${escapeHtml(f.date || 'date not recorded')}</span>
      <span class="first-detail">${escapeHtml(f.detail || '')}</span>
      ${growthFirstProvenanceHtml(f)}
    </li>`).join('');
  return `<div class="growth-book">
    <h3>The growth book — collecting since ${escapeHtml(book.collectingSince || '')}</h3>
    <p class="soft">Portal began counting on ${escapeHtml(book.collectingSince || 'an unrecorded date')} and counts bundle to bundle from there. The record so far is ${lines.length} counted bundle${lines.length === 1 ? '' : 's'} across ${days} day${days === 1 ? '' : 's'} — young, and shown at its real depth. ${escapeHtml(book.disclosures?.growth || '')}</p>
    <p class="soft">${escapeHtml(book.disclosures?.population || '')}</p>
    <div class="growth-charts">${charts}</div>
    <h4>The same figures as a list</h4>
    <div class="growth-twin-wrap"><table class="growth-twin"><thead><tr><th scope="col">Counted bundle</th>${twinHead}</tr></thead><tbody>${twinRows || '<tr><td>No bundles counted yet.</td></tr>'}</tbody></table></div>
    <h4>Firsts wall</h4>
    ${book.firsts.length ? `<ul class="firsts-wall">${firsts}</ul>` : '<p class="soft">No firsts counted yet beyond the wall’s pre-seed — the wall fills as the record evidences them, and only then.</p>'}
    <div class="prov"><strong>How Portal knows this:</strong> the diff writer in Portal's archive compares each published bundle with the last counted one (the bundle counters come from the overview route; the nameable and placed counts from the citizen list the voices and news routes evidence) and appends what changed to a counting record. This page reads that record${book.throughUtc ? ` through the bundle read at ${escapeHtml(book.throughUtc)}` : ''}.</div>
  </div>`;
}

// ------------------------------------------- chronicle + calendar (M6.09/M6.10)
//
// The Chronicle book (portal.chronicle-book/v1) is written by the
// data layer (build/data/chronicle-cycle.mjs) from the four admitted
// sources only — counted diffs, recorded firsts, sourced headlines,
// counts-only minutes pointers. The builders below render it as
// written; nothing here adds an item, a name, or a number.

export const CHRONICLE_BOOK_SCHEMA = 'portal.chronicle-book/v1';

/** The browser-local key holding the bundleSeq of the last visit.
 *  It lives only in the visitor's own browser — since-your-last-visit
 *  reads it, and nothing is written anywhere on the visitor's behalf
 *  (M6 wave brief, Conflict 4: no browser write path exists). */
export const LAST_SEQ_KEY = 'portal.lastBundleSeq';

export function isChronicleBook(data) {
  return !!data && data.schema === CHRONICLE_BOOK_SCHEMA && Array.isArray(data.items);
}

/** One stamp, both clocks the plan names: UTC, and local time in
 *  Kansas (America/Chicago). */
export function dualTime(isoUtc) {
  if (!isoUtc || Number.isNaN(Date.parse(isoUtc))) return 'an unrecorded time';
  const d = new Date(isoUtc);
  const utc = `${isoUtc.slice(0, 10)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
  let local = '';
  try {
    local = ` · ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(d)} in Kansas`;
  } catch { local = ''; }
  return utc + local;
}

const SUPPORT_WORDS = {
  diff: 'From the counted diffs',
  first: 'A recorded first',
  headline: 'From the record’s headlines',
  minutes: 'Counted speech (minutes pointer)',
};

export function chronicleItemHtml(item) {
  const kind = Object.keys(SUPPORT_WORDS).find((k) => item?.support?.[k]) || null;
  const support = kind ? SUPPORT_WORDS[kind] : 'Unbacked';
  return `<li class="chronicle-item">
    <p class="chronicle-text">${escapeHtml(item?.text || '')}</p>
    <p class="soft chronicle-meta">${escapeHtml(support)} · ${escapeHtml(dualTime(item?.atUtc))}${item?.countedAtSeq != null ? ` · counted at bundle ${escapeHtml(item.countedAtSeq)}` : ''}</p>
  </li>`;
}

/**
 * Since-your-last-visit, from the browser's stored bundleSeq alone:
 * the items first counted in (storedSeq, currentSeq]. A simulated
 * absence is exact by construction — seq N → N+3 shows the items
 * counted at N+1…N+3 and no others. No stored seq is a first visit;
 * a stored seq equal to the current one renders the honest line only.
 */
export function sinceLastVisit(book, storedSeq, currentSeq) {
  if (!isChronicleBook(book)) return { state: 'no-book', items: [] };
  if (storedSeq == null || !Number.isFinite(storedSeq)) return { state: 'first-visit', items: [] };
  if (!Number.isFinite(currentSeq) || currentSeq <= storedSeq) return { state: 'no-change', items: [] };
  const items = book.items.filter(
    (i) => Number.isFinite(i.countedAtSeq) && i.countedAtSeq > storedSeq && i.countedAtSeq <= currentSeq,
  );
  return { state: items.length ? 'changed' : 'no-change', items };
}

export function sinceLastVisitHtml(book, storedSeq, currentSeq) {
  const r = sinceLastVisit(book, storedSeq, currentSeq);
  if (r.state === 'no-book') return '';
  if (r.state === 'first-visit') {
    return '<div class="since-visit"><h4>Since your last visit</h4><p class="soft">This is your first visit Portal can tell about — your browser now holds this bundle’s number, and your next visit will list exactly what the record counted in between. Nothing was written anywhere but your own browser.</p></div>';
  }
  if (r.state === 'no-change') {
    return '<div class="since-visit"><h4>Since your last visit</h4><p>Nothing new is in the record since your last visit.</p></div>';
  }
  return `<div class="since-visit"><h4>Since your last visit</h4><ul class="chronicle-items">${r.items.map(chronicleItemHtml).join('')}</ul></div>`;
}

/** The Ember Ledger, readable at its press: quoted, attributed,
 *  labelled a citizen newspaper, in the quoted-words register (the
 *  F-2 token slot — styles.css --portal-font-family-quoted, filled
 *  since 2026-11-03 by Lora, the OFL-cleared serif of the F-2
 *  intake; the @font-face pair at the top of styles.css serves it
 *  self-hosted from fonts/). */
export function ledgerHtml(book) {
  const paper = book?.newspaper;
  if (!paper) return '';
  const quotes = (paper.quotes || []).map((q) => {
    const fenced = fencedSpeech({ speaker: q.speaker, text: q.said });
    if (!fenced) return '';
    return `<blockquote class="${fenced.frameClass} ledger-quote">
      <p class="ledger-words"><span aria-hidden="true">${fenced.quote} </span>${escapeHtml(fenced.text)}</p>
      <footer class="soft">${escapeHtml(fenced.label)} — ${escapeHtml(q.speaker || 'an unnamed speaker')}, ${escapeHtml(dualTime(q.at))}${q.where ? `, ${escapeHtml(q.where)}` : ''}</footer>
    </blockquote>`;
  }).join('');
  return `<div class="ledger">
    <h4>${escapeHtml(paper.name)} — ${escapeHtml(paper.label)}</h4>
    <p class="soft">${escapeHtml(paper.note || '')}</p>
    ${quotes || '<p class="soft">The Ledger has no recorded words in the current record.</p>'}
  </div>`;
}

/**
 * The Chronicle panel: the depth stated first (the record is young
 * and says so), then since-your-last-visit, the items, and the Ledger.
 */
export function chronicleBookHtml(book, { storedSeq = null, currentSeq = null } = {}) {
  if (!isChronicleBook(book)) {
    return '<p class="soft">The Chronicle has not begun — Portal’s counting started with the growth book, and the Chronicle opens with its first counted item.</p>';
  }
  const span = book.span;
  const depth = span
    ? `The Chronicle’s counting runs from ${escapeHtml(span.firstDate)} — ${escapeHtml(span.countedDays)} counted day${span.countedDays === 1 ? '' : 's'} so far. Where the record is shallow, the Chronicle is shallow; it does not pad backwards.`
    : 'The Chronicle’s counting has not produced a dated span yet.';
  const items = book.items.length
    ? `<ul class="chronicle-items">${book.items.map(chronicleItemHtml).join('')}</ul>`
    : '<p class="soft">No items counted yet.</p>';
  const disclosures = (book.disclosures || []).map((d) => `<p class="soft">${escapeHtml(d)}</p>`).join('');
  return `<div class="chronicle-book">
    <p class="soft">${depth}</p>
    ${sinceLastVisitHtml(book, storedSeq, currentSeq)}
    <h4>The Chronicle</h4>
    ${items}
    ${ledgerHtml(book)}
    ${disclosures}
  </div>`;
}

/**
 * The civic calendar (M6.10): evidenced schedules only. Past entries
 * carry their honest attendance — the citizens the record captured
 * speaking, with the basis stated on the entry. Upcoming entries
 * exist only when the record evidences a future schedule; tonight's
 * record evidences none, and the section says so rather than
 * inventing one. Where minutes exist for an entry, it links to them.
 */
export function calendarHtml(book, { nowUtc = null } = {}) {
  if (!isChronicleBook(book)) {
    return '<p class="soft">No calendar yet — the Chronicle has not begun, and the calendar is built from its record.</p>';
  }
  const entries = Array.isArray(book.calendar) ? book.calendar : [];
  const nowMs = nowUtc ? Date.parse(nowUtc) : null;
  const past = entries.filter((e) => nowMs == null || Date.parse(e.atUtc) <= nowMs);
  const upcoming = entries.filter((e) => nowMs != null && Date.parse(e.atUtc) > nowMs);
  const row = (e) => `<li class="calendar-entry">
      <p><strong>${escapeHtml(e.kind === 'gathering' ? 'Gathering' : e.kind)}</strong>${e.where ? ` at ${escapeHtml(e.where)}` : ''} — ${escapeHtml(dualTime(e.atUtc))}${e.endUtc ? ` to ${escapeHtml(dualTime(e.endUtc))}` : ''}</p>
      ${e.text ? `<p class="soft">${escapeHtml(e.text)}</p>` : ''}
      ${e.attendance?.length ? `<p class="soft">There, in the record: ${e.attendance.map(escapeHtml).join(', ')}. ${escapeHtml(e.attendanceBasis || '')}</p>` : ''}
      ${e.minutesItemId ? `<p><a href="#chronicle-panel">Minutes in the Chronicle</a></p>` : ''}
    </li>`;
  return `<div class="calendar">
    ${upcoming.length ? `<h4>Coming up</h4><ul class="calendar-entries">${upcoming.map(row).join('')}</ul>` : '<p class="soft">Nothing coming up is evidenced in the record right now — Portal lists a scheduled event only when the record announces one.</p>'}
    <h4>On the record</h4>
    ${past.length ? `<ul class="calendar-entries">${past.map(row).join('')}</ul>` : '<p class="soft">No past gatherings are in the record yet.</p>'}
  </div>`;
}

// ---------------------------------------------------- quiet page (M6.13)
//
// The designed quiet state: shown when nobody awake is evidenced in
// the feeds. It names its window, states the normalcy plainly, makes
// three honest offers, and gives the population as three distinct
// numbers. It contains NO citizen names, NO figure of any kind, and
// NO countdown — the quiet-hour drill pins all three absences.

export const QUIET_HEADING = 'Ember is quiet right now';

export function quietState(bundle) {
  if (!bundle) return { quiet: false, counts: null };
  const model = nowLineModel(bundle);
  return { quiet: model.quiet === true, counts: populationCounts(bundle) };
}

export function quietPageHtml(bundle) {
  const { counts } = quietState(bundle);
  const num = (v, label) => `<li><strong>${v == null ? 'not in the record' : escapeHtml(formatCount(v))}</strong> ${label}</li>`;
  return `<div class="quiet-page">
    <h3>${QUIET_HEADING}</h3>
    <p>The latest record covers Ember up to ${escapeHtml(dualTime(bundle?.newestFetchUtc))}, and in it nobody awake is in the public feeds Portal reads.</p>
    <p>That is normal for Ember. Most of its citizens are away or asleep at any given hour, and the feeds show only citizens who are active — Portal draws nobody the record does not show.</p>
    <p>While it is quiet, you can:</p>
    <ul class="quiet-offers">
      <li><a href="#stage-panel">▶ Play the recording</a> — a recording from Portal’s test data, labelled as one.</li>
      <li><a href="#chronicle-panel">Read the Chronicle</a> — what the record has counted so far.</li>
      <li><a href="#calendar-panel">See what’s scheduled</a> — the civic calendar, from evidenced schedules only.</li>
    </ul>
    <p>Ember’s population, as three distinct numbers — never one bare number:</p>
    <ul class="quiet-population">
      ${num(counts?.joined, 'citizens have joined (the record’s own count)')}
      ${num(counts?.nameable, 'citizens Portal can name')}
      ${num(counts?.placed, 'named citizens with an evidenced place right now')}
    </ul>
  </div>`;
}

// ------------------------------------------------- readability (M5.05/M5.06)
//
// The readability table, implemented as data + builders in the ONE
// shared model (plan/01 §4; Design K4/K5/K6). Every act Portal stages
// reads three ways at once — animation suggests, icon specifies,
// caption states (the redundancy rule) — and any one channel alone
// still carries the act: colour is a family signal, NEVER the sole
// signal, and every head icon ships WITH its word (§5.4; the ticker
// chips above set the register: a text glyph, always labelled).
//
// M5.05's half: the gesture vocabulary (talk ×2, listen/nod, point,
// present) with each clip's source + licence recorded in
// GESTURE_CLIPS, and the work vocabulary carried over from M4.08's
// coverage record (build/visual/scene/work-clips.mjs clipCoverage(),
// factory/work-citizens/work-clips-coverage.json). The sourcing
// ladder is UAL/KayKit (CC0) first, Mixamo only as baked output under
// the project owner's condition, CUSTOM bespoke last — and the table records
// which rung each clip actually came from. The carry gap the SURFACE
// lane proved (deliver-mend + haul have no carry locomotion in the
// CC0 spine) is recorded here exactly as found: those families keep
// icon + caption + staging, and NO clip is faked for them.
//
// M5.06's half: READABILITY_STATES (the §4.1 state table as data),
// FAMILY_READABILITY (every frozen action-table family mapped to a
// state, a clip or an honest gap, and a caption source), the pre-act
// icon rule (≥ 1 s before the act, scaled never skipped — the token
// motion.preActionIconMin in build/visual/tokens), the caption
// builder with the standing-order tag/suffix and the instant-act
// suffix, and readabilityPresentation(), the one call a surface
// makes per act. The masked drill and the agreement checks live in
// test/readability.test.mjs; the coverage matrix is data here and
// the test proves it complete against the frozen table.

/** The pre-action icon lead, token motion.preActionIconMin
 *  (build/visual/tokens): a head icon appears at least this many
 *  milliseconds of PLAYBACK before its act starts. */
export const PRE_ACT_ICON_MS = 1000;

/** The icon lead on the playback timeline at a catch-up rate:
 *  scaled by the rate, never skipped and never below the token
 *  floor — at 2.5× catch-up the icon leads by 2 500 timeline ms so
 *  it is still on screen for a full second of playback. */
export function preActIconLeadMs(rate = 1) {
  const r = Number.isFinite(rate) && rate > 1 ? rate : 1;
  return PRE_ACT_ICON_MS * r;
}

/** When the head icon for an act starting at actStartMs (playback
 *  timeline) must appear. */
export function preActIconAtMs(actStartMs, rate = 1) {
  return actStartMs - preActIconLeadMs(rate);
}

/** The instant-act suffix (§4.1, civic + building rows verbatim;
 *  the roadmap's honesty test samples it on instant acts generally):
 *  an instant act is shown as a moment, and the caption says so. */
export const INSTANT_ACT_SUFFIX = ' (Instant in the world — shown as a moment.)';

/** The standing-order caption suffix (§4.1 verbatim form): "— done
 *  by a standing order [Name] left, not a live decision Portal can
 *  see." The name is the order's author as the record names them;
 *  without one the sentence drops the name rather than inventing
 *  it. */
export function standingOrderSuffix(orderName = null) {
  return orderName
    ? ` — done by a standing order ${orderName} left, not a live decision Portal can see.`
    : ' — done by a standing order, not a live decision Portal can see.';
}

/** The by-program caption suffix: plan/02 §3.6 names the "by
 *  program" tag in the same row as "by standing order"; the suffix
 *  mirrors the standing-order sentence's form for program acts
 *  (weather laws, Open Table programs). */
export const BY_PROGRAM_SUFFIX = ' — done by a program, not a live decision Portal can see.';

/** The tags an act can carry, and the tag line shown under its head
 *  icon (§4.1: "a tag under the icon"). */
export const ACT_TAGS = {
  'by-standing-order': 'By standing order',
  'by-program': 'By program',
};

// --- M5.05: the gesture vocabulary ---------------------------------
//
// Clip names are the gesture library's contract names
// (build/visual/factory/outputs-web/clips/gesture-clips.glb, built
// by factory/scripts/retarget_gesture_clips.py; scene binding in
// build/visual/scene/gesture-clips.mjs; coverage record in
// factory/work-citizens/gesture-clips-coverage.json). Sources:
//   gesture-talk / gesture-talk-seated — Quaternius Universal
//     Animation Library 1 (CC0): Idle_Talking_Loop /
//     Sitting_Talking_Loop, baked onto the citizen rig. (The kits'
//     own `gather` clip is a KayKit Idle_B talk-POSE stand-in,
//     recorded as such in every citizen kit — it is not a talking
//     clip and is never counted as one here.)
//   gesture-listen / gesture-point / gesture-present — CUSTOM
//     bespoke, authored procedurally on the citizen rig in the
//     factory's own knock precedent. The ladder reached the CUSTOM
//     rung for these three because the CC0 spine was inventoried
//     clip by clip and carries none of them: UAL1's 43 clips and
//     KayKit Character Animations 1.1's Rig_Medium sets (119 clips)
//     contain no nod, no point, and no present gesture (the
//     inventories are cited in the coverage record). No Mixamo clip
//     was used anywhere in this lane, so the conditioned rung was
//     never reached.
export const GESTURE_CLIPS = {
  'gesture-talk': {
    clip: 'gesture-talk', gesture: 'talk', variant: 'standing',
    source: 'Quaternius Universal Animation Library 1 — Idle_Talking_Loop',
    licence: 'CC0 1.0', rung: 'UAL (CC0)',
  },
  'gesture-talk-seated': {
    clip: 'gesture-talk-seated', gesture: 'talk', variant: 'seated',
    source: 'Quaternius Universal Animation Library 1 — Sitting_Talking_Loop',
    licence: 'CC0 1.0', rung: 'UAL (CC0)',
  },
  'gesture-listen': {
    clip: 'gesture-listen', gesture: 'listen', variant: 'nod',
    source: 'CUSTOM bespoke — procedural nod authored on the citizen rig (factory knock precedent); no nod clip exists in the CC0 spine',
    licence: 'Portal-authored (no third-party rights)', rung: 'CUSTOM',
  },
  'gesture-point': {
    clip: 'gesture-point', gesture: 'point', variant: 'point',
    source: 'CUSTOM bespoke — procedural point authored on the citizen rig; no point clip exists in the CC0 spine',
    licence: 'Portal-authored (no third-party rights)', rung: 'CUSTOM',
  },
  'gesture-present': {
    clip: 'gesture-present', gesture: 'present', variant: 'present',
    source: 'CUSTOM bespoke — procedural present authored on the citizen rig; no present clip exists in the CC0 spine',
    licence: 'Portal-authored (no third-party rights)', rung: 'CUSTOM',
  },
};

// --- M5.06: the state table (§4.1 as data) --------------------------
//
// colourToken names the token artefact's family token
// (build/visual/tokens/tokens.json, color.family.*). A token whose
// hex is not yet pinned carries hex: null + the plan's colour NAME —
// pinning a hex is an AUTO-L decision, never an inference here; the
// state's readability never depends on the hex, by design (icon +
// word + caption + pose carry it). `clip` names the state's primary
// performance clip where one honestly exists.
export const READABILITY_STATES = {
  'travelling': {
    state: 'travelling', drillFamily: 'travel',
    icon: { id: 'footprints', glyph: '➜', word: 'Travelling' },
    colourToken: 'color.family.act.travel', planColourName: 'Sky blue', hex: '#A8D4F0',
    staging: 'Walk the recorded square sequence.',
    captionTemplate: '{name} is walking to {place}.',
    clip: { name: 'walk', source: 'KayKit Character Animations 1.1 — Walking_A (kit-carried)', licence: 'CC0 1.0' },
  },
  'near-reach': {
    state: 'near-reach', drillFamily: 'travel',
    icon: { id: 'footprints-small', glyph: '→', word: 'Stepping over' },
    colourToken: 'color.family.act.travel', planColourName: 'Sky blue', hex: '#A8D4F0',
    staging: 'One brief step, ~1 s (world time 0).',
    captionTemplate: '{name} steps over to {place}.',
    clip: { name: 'walk', source: 'KayKit Character Animations 1.1 — Walking_A (kit-carried)', licence: 'CC0 1.0' },
  },
  'working': {
    state: 'working', drillFamily: 'work',
    icon: { id: 'hammer-wrench', glyph: '⚒', word: 'Working' },
    colourToken: 'color.family.act.work', planColourName: 'Warm orange', hex: null,
    staging: 'Labelled station, tool prop, one beat per act; output moves by the exact recorded amount.',
    captionTemplate: '{name} is working at the {station}: {act}.',
    clip: null, clipNote: 'Per-family work clips: see FAMILY_READABILITY (M4.08 library + kit-carried type).',
  },
  'gathering': {
    state: 'gathering', drillFamily: 'gather',
    icon: { id: 'leaf-basket', glyph: '❧', word: 'Gathering' },
    colourToken: 'color.family.act.gather', planColourName: 'Leaf green', hex: null,
    staging: 'Collect→carry→set-down cycles; counter "×[rounds recorded]".',
    captionTemplate: '{name} is gathering {thing} — round {round} of {rounds}.',
    clip: { name: 'work-pickup', source: 'KayKit Character Animations 1.1 — PickUp (work-clips library); the kit-carried gather clip is a talk-pose stand-in and is not counted', licence: 'CC0 1.0' },
  },
  'carrying': {
    state: 'carrying', drillFamily: 'work',
    icon: { id: 'bundle', glyph: '▣', word: 'Carrying' },
    colourToken: 'color.family.act.work', planColourName: 'Warm orange', hex: null,
    staging: 'Oversized bundle; empties at delivery.',
    captionTemplate: '{name} is carrying {thing} to {place}.',
    clip: null,
    clipNote: 'GAP — no carry locomotion clip exists in the CC0 spine (KayKit Holding_* are static holds, not a walk-with-load), exactly as the SURFACE lane found it. The family keeps icon + caption + staging; no carry cycle is faked.',
  },
  'talking': {
    state: 'talking', drillFamily: 'talk',
    icon: { id: 'speech-bubble', glyph: '❝', word: 'Talking' },
    colourToken: 'color.family.act.social', planColourName: 'Lilac', hex: '#D9CCF5',
    staging: 'Face each other; bubbles carry real words in order.',
    captionTemplate: '{name} is talking at {place}.',
    clip: { name: 'gesture-talk', source: GESTURE_CLIPS['gesture-talk'].source, licence: 'CC0 1.0' },
  },
  'listening': {
    state: 'listening', drillFamily: 'talk',
    icon: { id: 'open-book', glyph: '📖', word: 'Listening' },
    colourToken: 'color.family.act.social', planColourName: 'Lilac', hex: '#D9CCF5',
    staging: 'Facing the speaker.',
    captionTemplate: '{name} is listening to {speaker} at {place}.',
    clip: { name: 'gesture-listen', source: GESTURE_CLIPS['gesture-listen'].source, licence: 'Portal-authored (no third-party rights)' },
  },
  'civic-act': {
    state: 'civic-act', drillFamily: 'civic', instant: true,
    icon: { id: 'raised-hand', glyph: '✋', word: 'Civic' },
    colourToken: 'color.family.act.civic', planColourName: 'Gold', hex: '#F2C14E',
    staging: 'Short beat at Town Hall: hand raised, paper stamped.',
    captionTemplate: '{name} voted in {election}.',
    clip: null, clipNote: 'The hand-raised beat is a held pose + icon + caption; no CC0 clip in the spine performs it and none is claimed.',
  },
  'paying': {
    state: 'paying', drillFamily: 'civic', instant: true,
    icon: { id: 'coin', glyph: '◉', word: 'Paying' },
    colourToken: 'color.family.act.civic', planColourName: 'Gold', hex: '#F2C14E',
    staging: 'One beat at counter/stall; receipt flash, amount where public.',
    captionTemplate: '{name} paid {amount} for {purpose}.',
    clip: { name: 'gesture-present', source: GESTURE_CLIPS['gesture-present'].source, licence: 'Portal-authored (no third-party rights)' },
  },
  'building-raised': {
    state: 'building-raised', drillFamily: 'civic', instant: true,
    icon: { id: 'ribbon-flag', glyph: '⚑', word: 'New building' },
    colourToken: 'color.family.act.civic', planColourName: 'Gold', hex: '#F2C14E',
    staging: 'One reveal beat. No timelapse.',
    captionTemplate: 'A building was raised on {plot} by {name}.',
    clip: null, clipNote: 'A reveal beat, not a performance: no clip, by the plan\'s no-timelapse rule.',
  },
  'idle': {
    state: 'idle', drillFamily: 'idle',
    icon: { id: 'dot', glyph: '●', word: 'Here' },
    colourToken: 'color.family.act.idle', planColourName: 'Soft grey', hex: null,
    staging: 'Breathing sway only; no wandering.',
    captionTemplate: '{name} is at {place}. Nothing recorded happening right now.',
    clip: { name: 'idle', source: 'KayKit Character Animations 1.1 — Idle_A (kit-carried)', licence: 'CC0 1.0' },
  },
  'asleep': {
    state: 'asleep', drillFamily: 'asleep',
    icon: { id: 'zzz', glyph: 'Zzz', word: 'Asleep' },
    colourToken: 'color.family.act.asleep', planColourName: 'Muted blue-grey', hex: null,
    staging: 'Evidenced place: rest pose, dimmed chip.',
    captionTemplate: '{name} is asleep / away. Last heard from {time}.',
    clip: { name: 'rest-lie', source: 'KayKit Character Animations 1.1 — Lie_Idle (work-clips library; M4.25 treatment)', licence: 'CC0 1.0' },
  },
  'claimed': {
    state: 'claimed', drillFamily: null,
    icon: { id: 'hatched-badge', glyph: '◍', word: 'Reported' },
    colourToken: null, planColourName: 'Family, hatched', hex: null,
    staging: 'Hatch-shell figure; no work loop on a claim. The icon carries the act family\'s icon on a hatched badge.',
    captionTemplate: '{name} is reported {doing} — Portal has a report, not a record, for this.',
    clip: null, clipNote: 'No clip ever plays on a claim — a performance would assert what the record does not.',
  },
  'unknown': {
    state: 'unknown', drillFamily: null,
    icon: { id: 'question-mark', glyph: '?', word: 'Not known' },
    colourToken: 'color.family.act.unknown', planColourName: 'Grey', hex: null,
    staging: 'Still silhouette at last evidenced place, or off-scene rail.',
    captionTemplate: 'We don\'t know where {name} is right now. Last heard from {time}.',
    clip: null, clipNote: 'Stillness is the treatment; no clip.',
  },
  'catching-up': {
    state: 'catching-up', drillFamily: null,
    icon: { id: 'hourglass', glyph: '⌛', word: 'Catching up' },
    colourToken: 'color.family.act.idle', planColourName: 'Soft grey', hex: null,
    staging: 'Citizen pauses, looks around.',
    captionTemplate: 'Portal is catching up — walking through what happened, in order.',
    clip: { name: 'wait', source: 'KayKit Character Animations 1.1 — Idle_A at stride 2 (kit-carried, derived)', licence: 'CC0 1.0' },
  },
};

/** The head icon for a state, WITH its word — an icon is never
 *  shipped without the word it specifies (§5.4). Returns null for an
 *  unknown state id rather than an unlabelled guess. */
export function headIconFor(state) {
  const s = READABILITY_STATES[state];
  return s ? { ...s.icon } : null;
}

// --- M5.06: family coverage matrix ----------------------------------
//
// Every family of the frozen action table (build/data/action-table.mjs
// VERB_FAMILIES, 30 families) mapped to its readability treatment.
// `presentation` is 'figure' (a staged figure act), 'ticker'
// (world-level, no staged figure), 'chronicle-only' (icon + word in
// the Chronicle line only), or 'never' (no beat exists — the tell
// family: private content Portal is not party to). `captionSource`
// is 'template' (§4.1), 'action-table' (the frozen table's own
// caption for record-evidenced figure acts), or 'record' (the
// record's own phrase, verbatim). The test suite proves this matrix
// complete against VERB_FAMILIES itself — a family added to the
// frozen table without a row here fails the suite, loudly.
export const FAMILY_READABILITY = {
  'travel': { state: 'travelling', presentation: 'figure', captionSource: 'template', clip: 'walk' },
  'move': { state: 'travelling', presentation: 'figure', captionSource: 'template', clip: 'walk' },
  'say': { state: 'talking', presentation: 'figure', captionSource: 'template', clip: 'gesture-talk' },
  'chat': { state: 'talking', presentation: 'figure', captionSource: 'template', clip: 'gesture-talk' },
  'tell': { state: null, presentation: 'never', captionSource: null, clip: null,
    note: 'Tell/letter content is private and Portal is not party to it — no beat, no icon, no caption exists for this family.' },
  'board-post': { state: 'working', presentation: 'figure', captionSource: 'template', clip: 'type' },
  'observe': { state: 'listening', presentation: 'figure', captionSource: 'template', clip: 'gesture-point',
    note: 'Attending to the land: the point gesture directs at the square studied; the LAND record is the receipt.' },
  'survey': { state: 'listening', presentation: 'figure', captionSource: 'template', clip: 'gesture-point',
    note: 'Chapter beat at the square studied: observe pose + point, caption naming the commission.' },
  'inquiry': { state: 'listening', presentation: 'figure', captionSource: 'template', clip: 'gesture-point',
    note: 'The chapter beat keeps the record\'s order (predict → look → report → revise); the point marks the look.' },
  'harvest': { state: 'gathering', presentation: 'figure', captionSource: 'template', clip: 'work-pickup' },
  'pick-up': { state: 'working', presentation: 'figure', captionSource: 'template', clip: 'work-pickup' },
  'excavate': { state: 'working', presentation: 'figure', captionSource: 'action-table', clip: 'work-dig' },
  'store-give-pay': { state: 'paying', presentation: 'figure', captionSource: 'template', clip: 'gesture-present',
    note: 'The hand-over is the present gesture; a payment with a public amount uses the paying caption.' },
  'deliver-mend': { state: 'carrying', presentation: 'figure', captionSource: 'action-table', clip: null,
    note: 'GAP — no carry locomotion in the CC0 spine (SURFACE lane, M4.08). Icon + caption + counter carry the family; no clip is faked. Live beats additionally wait on delivery evidence (DELIVERY_PATTERNS is empty by rule).' },
  'haul': { state: 'carrying', presentation: 'figure', captionSource: 'action-table', clip: null,
    note: 'GAP — no carry locomotion in the CC0 spine, the same gap as deliver-mend (SURFACE lane, M4.08), recorded the same way.' },
  'build-raise-install': { state: 'building-raised', presentation: 'figure', captionSource: 'template', clip: 'work-hammer',
    note: 'The raising itself is the reveal beat (no clip, no timelapse); work-hammer serves the build/install acts at the station.' },
  'trade': { state: 'paying', presentation: 'figure', captionSource: 'template', clip: 'gesture-present' },
  'make-craft': { state: 'working', presentation: 'figure', captionSource: 'template', clip: 'type' },
  'college-deposit': { state: 'working', presentation: 'figure', captionSource: 'template', clip: 'type' },
  'problems': { state: 'working', presentation: 'figure', captionSource: 'template', clip: 'type' },
  'debates-discussions': { state: 'talking', presentation: 'figure', captionSource: 'template', clip: 'gesture-talk-seated' },
  'weather-laws': { state: null, presentation: 'ticker', captionSource: 'record', clip: null,
    note: 'A law is a submitted program, not a citizen\'s presence: ticker/caption beat with the by-program tag; the author is quoted, never staged.' },
  'vote-stand-propose': { state: 'civic-act', presentation: 'figure', captionSource: 'template', clip: null,
    note: 'Hand-raised held pose + icon + caption; no CC0 clip performs it and none is claimed.' },
  'events-gatherings': { state: 'talking', presentation: 'figure', captionSource: 'template', clip: 'gesture-talk' },
  'games-open-table': { state: 'listening', presentation: 'figure', captionSource: 'template', clip: 'gesture-talk-seated',
    note: 'Table scene with the by-program tag: matches are server-run from submitted programs; NO live pieces are staged.' },
  'music': { state: 'working', presentation: 'figure', captionSource: 'template', clip: null,
    note: 'Play beat on the record\'s tick at the performance place; no instrument clip exists in the CC0 spine and none is claimed. Scheduled performances stage as events (talking/listening scene).' },
  'court': { state: 'talking', presentation: 'figure', captionSource: 'template', clip: 'gesture-talk-seated',
    note: 'Historically dormant: no beat is staged from an empty record.' },
  'repair-frontier': { state: 'working', presentation: 'figure', captionSource: 'template', clip: 'work-hammer' },
  'publish': { state: 'working', presentation: 'figure', captionSource: 'template', clip: 'type',
    note: 'Press flash beat at the press; the issue itself is read whole, not staged.' },
  'hostile': { state: null, presentation: 'chronicle-only', captionSource: 'record', clip: null,
    note: 'Icon + Chronicle line only; NO staged combat, ever (plan/02 §3.6).' },
};

/** The readability row for an action-table family, or null. */
export function readabilityForFamily(family) {
  const row = FAMILY_READABILITY[family];
  return row ? { family, ...row } : null;
}

// --- M5.06: captions + the one presentation call --------------------

/** Fill a §4.1 caption template's slots. A slot with no value is
 *  left visible as its {slot} marker in the output ONLY when the
 *  caller asked for the raw template; builders below always pass
 *  the values their template needs — a caption with an unfilled
 *  slot is a bug the drill catches, never a shipped string. */
function fillTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (values[k] != null && values[k] !== '' ? String(values[k]) : m));
}

/** Build the verbatim caption for a state from its §4.1 template,
 *  then apply the honesty suffixes: instant-act suffix for instant
 *  states, standing-order / by-program suffix when the act carries
 *  the tag. Values are the record's own (names, places, amounts);
 *  this builder adds no motive and no paraphrase. Speech is never
 *  captioned here — recorded words live only inside the fenced
 *  bubble kit. */
export function readabilityCaption(state, values = {}) {
  const s = READABILITY_STATES[state];
  if (!s) return null;
  let caption = fillTemplate(s.captionTemplate, values);
  if (s.instant) caption += INSTANT_ACT_SUFFIX;
  const tags = Array.isArray(values.tags) ? values.tags : [];
  if (tags.includes('by-standing-order')) caption += standingOrderSuffix(values.standingOrderName ?? null);
  if (tags.includes('by-program')) caption += BY_PROGRAM_SUFFIX;
  return caption;
}

/** The full readability presentation for one act: head icon (with
 *  its word) shown ≥ 1 s of playback before the act, the tag line
 *  under the icon where the act carries one, the family colour
 *  token (never the sole signal), the staging note, the clip (or
 *  the recorded gap), and the caption. Surfaces render from this
 *  and only this — a second readability implementation anywhere is
 *  the fork the talk lane's Conflict 5 rule forbids.
 *
 *  Input: { family } for an action-table family act, or { state }
 *  for a direct state (idle / asleep / unknown / catching-up —
 *  presence states no verb family names). `caption` may be supplied
 *  by the caller when the family's captionSource is the frozen
 *  table's own caption ('action-table') or the record's phrase
 *  ('record'); template families build theirs here from `values`.
 *  Returns null when the family/state has no presentation at all
 *  (the tell family) — the absence is the honest answer. */
export function readabilityPresentation({ family = null, state = null, values = {}, caption = null, rate = 1, actStartMs = null } = {}) {
  let row = null;
  let stateId = state;
  if (family) {
    row = FAMILY_READABILITY[family] || null;
    if (!row) return null;
    if (row.presentation === 'never') return null;
    stateId = row.state;
  }
  const s = stateId ? READABILITY_STATES[stateId] : null;
  const tags = Array.isArray(values.tags) ? values.tags : [];
  const tagLine = tags.length && ACT_TAGS[tags[0]] ? ACT_TAGS[tags[0]] : null;
  let clipName = null;
  let clipGap = null;
  if (row && row.clip !== undefined) {
    clipName = row.clip;
    if (clipName === null) clipGap = row.note || (s && s.clipNote) || null;
  } else if (s) {
    clipName = s.clip ? s.clip.name : null;
    if (clipName === null) clipGap = s.clipNote || null;
  }
  return {
    family: family || null,
    state: stateId,
    presentation: row ? row.presentation : 'figure',
    icon: s ? { ...s.icon } : (row && row.presentation === 'ticker' ? { id: 'program', glyph: '⚙', word: 'By program' } : null),
    tag: tagLine,
    colourToken: s ? s.colourToken : null,
    planColourName: s ? s.planColourName : null,
    hex: s ? s.hex : null,
    staging: s ? s.staging : null,
    clip: clipName,
    clipGap,
    caption: caption != null ? caption : (s ? readabilityCaption(stateId, values) : null),
    iconLeadMs: preActIconLeadMs(rate),
    iconAtMs: actStartMs != null ? preActIconAtMs(actStartMs, rate) : null,
  };
}

// ------------------------------------------------ citizen page (M6.05)
//
// The deepest per-citizen surface: the card's [Their page →] action
// lands here. Every claim on the page is assembled from the record
// and carries the claim that lets it open in the provenance
// inspector (M6.06) — the page's exit gate samples claims and traces
// them there, and any claim that does not resolve is a release
// failure. The rules, item by item:
//
//  - Titles render as BADGES: the citizen's evidenced office words
//    (citizenOffices — office-first, words only), and nothing else.
//    No office evidence, no badges; a title is never invented.
//  - The Now panel's ARRIVAL wording appears only where an arrival
//    is recorded: a reconstructed journey (portal.journeys/v1) whose
//    destination is the citizen's current place. The journey record
//    bounds the arrival by its arrival utterance's stamp; without
//    such a bound there is no arrival line, only the where-now line.
//  - Fast facts only where real. First seen / last heard come from
//    the citizen record's own stamps; counts come from the feeds the
//    page actually read (episodes, journeys, firsts). College
//    standing renders ONLY as a per-department list, and only when a
//    carriage carries one (citizen.collegeStanding as an array of
//    {department, standing}); a lone scalar is never rendered as
//    "the score" — the plan forbids one score, recorded or not.
//    On live bundles no carriage exists, so no College fact renders.
//  - Their story is the record, cited: their first-seen entry, the
//    conversations they are recorded speaking in (episodes), their
//    reconstructed journeys, and the firsts that name them — each
//    entry dated, each carrying its inspector claim. Episodes and
//    firsts attribute by NAME (that is all those records carry), so
//    they bind only on an exact single match; for a namesake the
//    entry is shown with its caveat, never silently assigned
//    (PORTAL-KEY: ambiguity never binds). Journeys carry the
//    PORTAL-KEY itself and bind exactly.
//  - The private-life line is standing wording, on every page: what
//    Portal cannot see, said plainly.

/** The private-life line's standing wording (name interpolated). */
export const CITIZEN_PAGE_PRIVATE_LIFE = (name) => `Portal sees only what the public feeds publish about ${name}: the places they were when they spoke, and the words they said in public. It does not see their home, their private messages, their thoughts, or anything they do between appearances — and it does not guess at them.`;

/** The caveat carried by name-attributed story entries for a
 *  namesake: the record names speakers by name, and two citizens
 *  share this one. */
export const CITIZEN_PAGE_NAME_CAVEAT = 'The record names speakers by name, and more than one citizen in the record shares this name — Portal cannot say which of them this entry belongs to, so it is shown under the shared name, not assigned.';

/**
 * The citizen's recorded arrival at the place they are evidenced at
 * now, or null. A journey bounds an arrival only when its `to` is
 * the citizen's current placeCode and the citizen is evidenced
 * there now; the latest such bound wins.
 */
export function recordedArrival(citizen, journeysFeed) {
  if (!isEvidenced(citizen)) return null;
  const key = citizenKeyOf(citizen);
  const journeys = (journeysFeed?.journeys || []).filter((j) => j && j.citizenKey === key && j.to === citizen.placeCode && typeof j.arrivalUtc === 'string');
  if (!journeys.length) return null;
  journeys.sort((a, b) => cmpCodeUnit(a.arrivalUtc, b.arrivalUtc));
  const j = journeys[journeys.length - 1];
  return { journey: j, arrivalUtc: j.arrivalUtc, fromCode: j.from || null, departureUtc: j.departureUtc || null };
}

/** Per-department College standing, or null. Only an array of
 *  {department, standing} entries counts; anything else (a lone
 *  score, a string) renders nothing — see the section head. */
export function collegeStandingOf(citizen) {
  const raw = citizen?.collegeStanding;
  if (!Array.isArray(raw)) return null;
  const rows = raw
    .filter((r) => r && typeof r.department === 'string' && r.department !== '' && (typeof r.standing === 'string' || typeof r.standing === 'number'))
    .map((r) => ({ department: r.department, standing: String(r.standing) }));
  return rows.length ? rows : null;
}

/**
 * The citizen page model. Inputs: the bundle, the citizen, and the
 * derived feeds the app read alongside the bundle (journeysFeed,
 * episodesFeed — the episodes SOURCE the panel uses is passed as
 * `episodesSource`: the bundle when it carries episodes, else the
 * feed — and growthBook for firsts). opts: {placeLabel, placement}.
 * Every story entry and fast fact carries `claim`, an inspectorModel
 * input, so each one is traceable to its record by construction.
 */
export function citizenPageModel(bundle, citizen, feeds = {}, opts = {}) {
  const label = labelOrSelf(opts.placeLabel);
  const key = citizenKeyOf(citizen || {});
  const name = citizen?.name || 'This citizen';
  const namesake = bundle ? namesakeInfo(bundle, citizen) : null;
  const nameShared = !!namesake;
  const nameCount = (n) => (bundle?.citizens || []).filter((c) => c.name === n).length;
  const journeysFeed = feeds.journeysFeed || null;
  const episodesSource = feeds.episodesSource || feeds.episodesFeed || null;
  const growthBook = isGrowthBook(feeds.growthBook) ? feeds.growthBook : null;

  // -- story material, gathered with its attribution rule ---------
  const myJourneys = (journeysFeed?.journeys || [])
    .filter((j) => j && j.citizenKey === key)
    .sort((a, b) => cmpCodeUnit(a.departureUtc || '', b.departureUtc || ''));
  const myEpisodes = (episodesSource?.episodes || [])
    .filter((ep) => Array.isArray(ep?.participants) && ep.participants.includes(name) && nameCount(name) >= 1)
    .sort((a, b) => cmpCodeUnit(a.firstUtc || '', b.firstUtc || ''));
  const myFirsts = (growthBook?.firsts || [])
    .filter((f) => f?.subject?.name === name)
    .sort((a, b) => cmpCodeUnit(a.date || '', b.date || ''));

  const story = [];
  if (citizen?.firstSeenUtc) {
    story.push({
      kind: 'first-seen', whenUtc: citizen.firstSeenUtc,
      text: `${name} first appears in the public feeds Portal reads ${relativeTime(citizen.firstSeenUtc)} (${citizen.firstSeenUtc}).`,
      caveat: null,
      claim: { type: 'page-first-seen', bundle, citizen },
    });
  }
  for (const ep of myEpisodes) {
    const others = (ep.participants || []).filter((p) => p !== name);
    story.push({
      kind: 'episode', whenUtc: ep.firstUtc,
      text: `${name} is recorded speaking at ${label(ep.place)} ${relativeTime(ep.firstUtc)} — ${ep.utteranceCount ?? 0} recorded utterance${ep.utteranceCount === 1 ? '' : 's'} in the conversation${others.length ? `, with ${others.join(', ')}` : ''}.`,
      caveat: nameShared ? CITIZEN_PAGE_NAME_CAVEAT : null,
      claim: { type: 'page-episode', bundle, citizen, episode: ep, source: episodesSource },
    });
  }
  for (const j of myJourneys) {
    story.push({
      kind: 'journey', whenUtc: j.arrivalUtc || j.departureUtc || null,
      text: `${name} travelled from ${label(j.from)} to ${label(j.to)} — last evidenced at ${label(j.from)} ${relativeTime(j.departureUtc)}, first evidenced at ${label(j.to)} ${relativeTime(j.arrivalUtc)}. The walk between is Portal scheduling that evidence window, not an observed path.`,
      caveat: null,
      claim: { type: 'page-journey', bundle, citizen, journey: j, feed: journeysFeed },
    });
  }
  for (const f of myFirsts) {
    story.push({
      kind: 'first', whenUtc: f.atUtc || (f.date ? `${f.date}T00:00:00.000Z` : null),
      text: f.detail || '',
      caveat: nameShared ? CITIZEN_PAGE_NAME_CAVEAT : null,
      claim: { type: 'page-first', bundle, citizen, first: f },
    });
  }
  // Newest first — the page reads the story back from now.
  story.sort((a, b) => cmpCodeUnit(b.whenUtc || '', a.whenUtc || ''));

  // -- fast facts: only where real --------------------------------
  const facts = [];
  if (citizen?.firstSeenUtc) facts.push({ label: 'First seen in the record', value: `${plainDate(citizen.firstSeenUtc) || citizen.firstSeenUtc} (${relativeTime(citizen.firstSeenUtc)})` });
  if (citizen?.evidenceUtc) facts.push({ label: 'Last heard from', value: `${relativeTime(citizen.evidenceUtc)} (${citizen.evidenceUtc})` });
  if (myEpisodes.length) facts.push({ label: 'Conversations recorded speaking in', value: String(myEpisodes.length) });
  if (myJourneys.length) facts.push({ label: 'Journeys reconstructed', value: String(myJourneys.length) });
  if (myFirsts.length) facts.push({ label: 'Firsts on the wall that name them', value: String(myFirsts.length) });
  const standing = collegeStandingOf(citizen);
  if (standing) facts.push({ label: 'College standing, by department', value: standing.map((r) => `${r.department}: ${r.standing}`).join(' · '), departments: standing });

  const arrival = recordedArrival(citizen, journeysFeed);
  return {
    key, name,
    badges: bundle ? citizenOffices(bundle, citizen) : [],
    titleLine: bundle ? citizenTitleLine(bundle, citizen) : null,
    namesake,
    whereNow: whereNowLine(citizen, label, opts.placement || null),
    arrival: arrival ? {
      text: `Arrived at ${label(citizen.placeCode)} — first evidenced there ${relativeTime(arrival.arrivalUtc)} (${arrival.arrivalUtc}), on a journey the record bounds${arrival.fromCode ? ` from ${label(arrival.fromCode)}` : ''}.`,
      arrivalUtc: arrival.arrivalUtc,
      // Its own claim type, distinct from the story's journey entry
      // for the same leg: the Now panel claims the ARRIVAL bound,
      // the story entry claims the leg — two on-page claims, two
      // book-scoped keys, one shared record underneath.
      claim: { type: 'page-arrival', bundle, citizen, journey: arrival.journey, feed: journeysFeed },
    } : null,
    facts,
    story,
    binding: citizenBindingWording(citizen),
    privateLife: CITIZEN_PAGE_PRIVATE_LIFE(name),
    provenance: citizen?.provenance || null,
  };
}

/** The citizen page's HTML: badges, the Now panel (where-now, plus
 *  the arrival line ONLY when the model carries a recorded bound),
 *  fast facts, Their story (every entry dated, caveated where the
 *  attribution is by shared name, and carrying its [Record] action
 *  into the inspector), the private-life line, and the page's own
 *  [Follow] / [Record] actions. All feed-born text escaped. */
export function citizenPageHtml(model) {
  if (!model) return '';
  const badges = (model.badges || []).length
    ? `<p class="page-badges">${model.badges.map((w) => `<span class="badge-word">${escapeHtml(w)}</span>`).join(' ')}</p>` : '';
  const facts = (model.facts || []).length
    ? `<h4>Fast facts — only what the record carries</h4><dl class="page-facts">${model.facts.map((f) => `<dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd>`).join('')}</dl>`
    : '<p class="soft">No fast facts — the record carries nothing further about them yet.</p>';
  const story = (model.story || []).length
    ? `<h4>Their story, from the record</h4><ul class="page-story">${model.story.map((s, i) => `<li>
        <div>${escapeHtml(s.text)}</div>
        ${s.caveat ? `<div class="soft">${escapeHtml(s.caveat)}</div>` : ''}
        <div class="tk-actions"><button type="button" class="follow-small" data-record-story="${i}">Record</button></div>
      </li>`).join('')}</ul>`
    : '<p class="soft">Their story is empty so far — nothing in the record speaks of them beyond being named. Portal does not narrate a life into existence to fill the space.</p>';
  return `
    <h3><span class="dot" style="background:${citizenColor(model.key)}"></span>${escapeHtml(model.name)}${model.namesake ? ` <span class="namesake-tag">record ${model.namesake.ordinal} of ${model.namesake.count}</span>` : ''}</h3>
    ${badges}
    <h4>Now</h4>
    <p>${escapeHtml(model.whereNow)}</p>
    ${model.arrival ? `<p class="arrival-line">${escapeHtml(model.arrival.text)}</p>` : ''}
    ${facts}
    ${story}
    <h4>What Portal cannot see</h4>
    <p class="soft">${escapeHtml(model.privateLife)}</p>
    ${model.binding ? `<p class="binding-line">${model.binding.kind === 'bound' ? `Public profile: <span class="profile-id">${escapeHtml(model.binding.text)}</span>` : escapeHtml(model.binding.text)}</p>` : ''}
    ${provenanceHtml(model.provenance, 'this citizen')}`;
}

// -------------------------------------- frontier fill-in map (M6.11)
//
// The frontier stays a MAP (D5): a fill-in parchment whose earned
// ground fills in as the record counts it. The record carries the
// frontier ONLY as counters (the overview's frontier block, carried
// into the bundle as counters.regionsDiscovered / regionsSurveyed /
// regionsNamed) — there is no per-region list, no region name, no
// namer, and no geography anywhere in Tier P. So the map is honest
// about its two layers:
//
//  - WHAT is known: the three counters and the class counts derived
//    from them by subtraction (named; surveyed but not named; found
//    — discovered — but not surveyed). A grid of squares stands for
//    the FOUND ground in exactly those proportions (largest-
//    remainder rounding, deterministic order): each square's class
//    is its record class, and no square renders detail beyond its
//    class — a named square is a filled patch, a surveyed square an
//    outline with hatch, a found square a bare outline. Beyond the
//    found ground the parchment stays BLANK: unknown, never empty
//    land, and the legend says so in a sentence.
//  - WHERE things sit: Portal's arrangement, disclosed as staging
//    on the map itself. The record counts the ground; it does not
//    map it.
//
// Names and namers (Design §2.5's "earned names with the namer on
// tap") consume an optional carriage — bundle.frontierRegions, an
// array of {name, namedBy, class} — that no Tier P route carries
// today. When it is absent, a tap on any square answers with its
// class sentence and the plain statement that the record does not
// name this patch or say who named it. When a carriage lands, the
// named squares carry their names and the tap shows name + namer,
// with no other change.
//
// Recorded journeys render as ROUTE SEQUENCES: each citizen's
// reconstructed legs in departure order, waypoints in sequence —
// a sequence claims order, never map geometry, so no leg is drawn
// as a line across ground the record did not survey. Follow hands
// off at the wall: a followed citizen the record places at a code
// the town layout does not carry is beyond the wall, and the map is
// where their record continues (frontierFollowNote).

/** The frontier grid's square count: each square stands for about
 *  discovered/FRONTIER_GRID_CELLS regions of found ground. */
export const FRONTIER_GRID_CELLS = 100;

/** The fill classes, in earning order, with their legend sentences.
 *  The parchment class is the absence state — drawn blank, worded
 *  as unknown. */
export const FRONTIER_CLASSES = {
  named: { word: 'Named', sentence: 'Named — a citizen has given this ground a name, and the record keeps it. Drawn as a full pastel fill.' },
  surveyed: { word: 'Surveyed', sentence: 'Surveyed — walked and measured, but not yet named. Drawn as an outline with hatch.' },
  found: { word: 'Found', sentence: 'Found — reached and counted, but not yet surveyed. Drawn as a bare outline.' },
  unknown: { word: 'Not in the record', sentence: 'Not in the record — the parchment is blank because Portal does not know what is there. Unknown is not empty land.' },
};

/**
 * The frontier model: class counts from the bundle's counters at
 * the bundle's own seq, the deterministic grid (class per square,
 * in earning order — arrangement is staging, disclosed), the
 * sentence legend, the recorded route sequences from the journeys
 * feed, and any carried region names. Absent counters stay absent
 * (null counts, no grid) — the map then says the record is not
 * carrying the frontier counts, rather than drawing empty ground.
 */
export function frontierModel(bundle, journeysFeed = null) {
  const c = bundle?.counters || {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const discovered = num(c.regionsDiscovered);
  const surveyed = num(c.regionsSurveyed);
  const named = num(c.regionsNamed);
  const counters = { discovered, surveyed, named };
  let classes = null;
  let grid = [];
  let perCell = null;
  let countersClamped = false;
  if (discovered !== null && discovered > 0) {
    const namedN = Math.min(named ?? 0, discovered);
    const surveyedN = Math.min(Math.max(surveyed ?? 0, namedN), discovered);
    if ((named ?? 0) !== namedN || (surveyed ?? 0) !== surveyedN) countersClamped = true;
    classes = {
      named: namedN,
      surveyed: surveyedN - namedN,
      found: discovered - surveyedN,
    };
    // Largest-remainder apportionment of the grid over the classes.
    const total = discovered;
    const exact = [classes.named / total, classes.surveyed / total, classes.found / total].map((s) => s * FRONTIER_GRID_CELLS);
    const cells = exact.map((v) => Math.floor(v));
    let left = FRONTIER_GRID_CELLS - cells.reduce((a, b) => a + b, 0);
    const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (const { i } of order) { if (left <= 0) break; cells[i] += 1; left -= 1; }
    const keys = ['named', 'surveyed', 'found'];
    grid = keys.flatMap((k, i) => Array.from({ length: cells[i] }, () => k));
    perCell = Math.round(total / FRONTIER_GRID_CELLS);
  }
  // Route sequences: journeys grouped by citizen, legs in departure
  // order — the sequence is the record's order, nothing more.
  const byCitizen = new Map();
  for (const j of journeysFeed?.journeys || []) {
    if (!j || !j.citizenKey) continue;
    if (!byCitizen.has(j.citizenKey)) byCitizen.set(j.citizenKey, { key: j.citizenKey, name: j.name || '', legs: [] });
    byCitizen.get(j.citizenKey).legs.push(j);
  }
  const routes = [...byCitizen.values()].map((r) => ({
    ...r,
    legs: r.legs.sort((a, b) => cmpCodeUnit(a.departureUtc || '', b.departureUtc || '')),
  })).sort((a, b) => cmpCodeUnit(a.name, b.name));
  // Carried region names, when a carriage ever lands one.
  const regions = Array.isArray(bundle?.frontierRegions)
    ? bundle.frontierRegions.filter((r) => r && typeof r.name === 'string').map((r) => ({
      name: r.name, namedBy: typeof r.namedBy === 'string' ? r.namedBy : null,
      cls: FRONTIER_CLASSES[r.class] ? r.class : 'named',
      cell: typeof r.cell === 'number' ? r.cell : null,
    }))
    : [];
  return {
    bundleSeq: bundle?.bundleSeq ?? null,
    counters, classes, grid, perCell, countersClamped,
    legend: ['named', 'surveyed', 'found', 'unknown'].map((k) => ({ key: k, ...FRONTIER_CLASSES[k] })),
    stagingNote: 'Where each patch sits on this map is Portal\'s arrangement — the record counts the ground; it does not map it.',
    routes, regions,
    journeysDisclosure: journeysFeed?.disclosure || null,
  };
}

/** What a tap on one square says: its class sentence, and the name
 *  situation — a carried name + namer when the record carries one
 *  for this square, else the plain statement that it does not. */
export function frontierTapModel(model, index) {
  if (!model || !Array.isArray(model.grid) || index < 0 || index >= model.grid.length) {
    return { text: FRONTIER_CLASSES.unknown.sentence };
  }
  const cls = model.grid[index];
  // A carried name binds to THIS square only when the carriage
  // itself says which square (a numeric `cell`); binding by list
  // position would invent geography the record does not carry.
  const carried = (model.regions || []).find((r) => r.cell === index) || null;
  if (carried) {
    return { cls, text: `${carried.name}${carried.namedBy ? ` — named by ${carried.namedBy}` : ''}. ${FRONTIER_CLASSES[carried.cls].sentence}` };
  }
  return { cls, text: `${FRONTIER_CLASSES[cls].sentence} The record does not name this patch, or say who named the ground it stands for — names and namers are not in the public feeds Portal reads.` };
}

/**
 * The frontier hand-off for Follow: non-null when the followed
 * citizen is evidenced at a placeCode the effective town layout
 * does not carry — beyond Ember's wall. The stage cannot place
 * them; this map is where their record continues.
 */
export function frontierFollowNote(bundle, layout, key) {
  const c = (bundle?.citizens || []).find((x) => citizenKeyOf(x) === key);
  if (!c || !isEvidenced(c)) return null;
  const eff = effectiveLayout(layout, bundle);
  if (resolveExactNode(eff, c.placeCode)) return null;
  return {
    key, name: c.name, placeCode: c.placeCode,
    text: `Following ${c.name} — the record places them beyond Ember's wall, at a place the town plan does not carry. Portal cannot show their walk out there; the frontier map is where their record continues.`,
  };
}

/**
 * Where a ticker item's [Take me there] lands when it has NO stage
 * landing: the frontier map, when the item is a frontier item by its
 * STRUCTURED fields — a place code the town layout does not carry,
 * or a kind that only happens out there (a ruin dug). Returns null
 * otherwise: a town item with no landing stays landing-less rather
 * than being sent to the wrong map.
 */
export const FRONTIER_TICKER_KINDS = new Set(['RUIN_EXCAVATED']);
export function frontierLanding(item, bundle, layout) {
  if (!item) return null;
  if (tickerLanding(item, bundle, layout)) return null;
  if (item.placeCode && layout && !resolveExactNode(effectiveLayout(layout, bundle), item.placeCode)) return { type: 'frontier' };
  if (FRONTIER_TICKER_KINDS.has(item.kind)) return { type: 'frontier' };
  return null;
}

/** The frontier map's HTML: the counters line (equal to the
 *  bundle's counters at the bundle's seq — the gate's own words),
 *  the canvas the squares draw on, the SENTENCE legend, the staging
 *  note, the carried-names list when a carriage exists, the tap
 *  detail line, and the recorded route sequences with the journeys
 *  disclosure. All feed-born text escaped. */
export function frontierMapHtml(model) {
  if (!model) return '';
  const cc = model.counters;
  const countersLine = model.classes
    ? `The record counts ${formatCount(cc.discovered)} regions found, ${formatCount(cc.surveyed)} of them surveyed, ${formatCount(cc.named)} of them named${model.bundleSeq !== null ? ` — as of bundle ${escapeHtml(model.bundleSeq)}` : ''}. Each square on the parchment stands for about ${formatCount(model.perCell || 0)} regions of found ground.`
    : 'The record is not carrying the frontier counts in this bundle, so the parchment stays blank — Portal does not draw ground it cannot count.';
  const legend = model.legend.map((l) => `<li><strong>${escapeHtml(l.word)}.</strong> ${escapeHtml(l.sentence)}</li>`).join('');
  const names = (model.regions || []).length
    ? `<h4>Names the record carries</h4><ul class="frontier-names">${model.regions.map((r) => `<li>${escapeHtml(r.name)}${r.namedBy ? ` — named by ${escapeHtml(r.namedBy)}` : ''}</li>`).join('')}</ul>`
    : '';
  const routes = (model.routes || []).length
    ? `<h4>Recorded journeys — route sequences</h4>
       ${model.journeysDisclosure ? `<p class="soft">${escapeHtml(model.journeysDisclosure)}</p>` : ''}
       <ul class="frontier-routes">${model.routes.map((r) => `<li><strong>${escapeHtml(r.name)}</strong>: ${r.legs.map((j) => `${escapeHtml(j.from || '')} → ${escapeHtml(j.to || '')}`).join(' · then ')}</li>`).join('')}</ul>
       <p class="soft">A sequence claims order only — the record evidences the waypoints in turn; it does not draw the ground between them, and neither does Portal.</p>`
    : '<p class="soft">No journeys are reconstructed in the record yet, so no route sequences cross the frontier. Portal draws a route only when the record evidences the whole leg.</p>';
  return `
    <p class="frontier-counters">${countersLine}</p>
    ${model.countersClamped ? '<p class="soft">The record\'s counts do not nest (named ≤ surveyed ≤ found) in this bundle; the map shows them clamped into order rather than drawing more named ground than was found.</p>' : ''}
    <canvas id="frontier-canvas" width="520" height="340" aria-label="Frontier fill-in map"></canvas>
    <p id="frontier-detail" class="frontier-detail">Tap a square to hear what the record says about that patch of ground.</p>
    <ul class="frontier-legend">${legend}</ul>
    <p class="soft">${escapeHtml(model.stagingNote)}</p>
    ${names}
    ${routes}`;
}

// -------------------------------- rhythm header + weather (M6.14)
//
// The header names ONE state of the town, WITH ITS BASIS — the
// counts the state was read from, in the same breath, so the claim
// and its evidence travel together. The three states (Design R1):
//
//  - busy: at least RHYTHM_BUSY_AWAKE citizens awake among those
//    the record places;
//  - resting: nobody awake among those placed — the frame is
//    dusk-TONED, and the state is named "resting", never "night":
//    the world's own clock is data here, and Portal does not dress
//    a clock reading up as a day-part label;
//  - normal quiet: everything between — the town's ordinary state,
//    named as normal so quiet never reads as wrong.
//
// The recorded weather (Design R2) renders ONLY from a record: the
// bundle's world.sky, which the deriver carries from the overview
// route's sky.over_ember — the world's own outlook. It renders
// captioned AS recorded weather, with the read stamp. No sky in the
// bundle, no weather on the page — Portal does not look out of a
// window it does not have.

/** Awake-among-placed at or above this count reads as busy. A
 *  stated rule, not a mood: the drill pins the boundary. */
export const RHYTHM_BUSY_AWAKE = 6;

/** The record's sky values as plain words. The closed set is the
 *  vocabulary the archived overviews actually carry (both archive
 *  days scanned 2026-11-03: OVERCAST, RAIN, STORM, BLIZZARD over
 *  Ember; CLEAR over the frontier). An unlisted value renders as
 *  the record's own words, de-cased and spaced — the same word,
 *  never a paraphrase and never the raw code. */
export const SKY_WORDS = {
  OVERCAST: 'overcast',
  RAIN: 'rain',
  STORM: 'storm',
  BLIZZARD: 'blizzard',
  CLEAR: 'clear',
  SUNNY: 'sunny',
  CLOUDY: 'cloudy',
  SNOW: 'snow',
  FOG: 'fog',
};

/** A recorded sky value as a plain word (see SKY_WORDS). */
export function skyWord(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  return SKY_WORDS[raw] || raw.toLowerCase().replace(/_/g, ' ');
}

/**
 * The rhythm model for one bundle: the state, its wording, its
 * basis (the counts it was read from), the frame tone ('dusk' only
 * for resting), the world's clock/season read as data, and the
 * recorded weather — or null weather when the bundle carries no
 * sky. The word "night" appears nowhere in this model's output, in
 * any state.
 */
export function rhythmModel(bundle) {
  const counts = nowLineModel(bundle || {});
  const placed = counts.placed;
  const awake = counts.awake;
  const asleep = counts.asleep;
  let state; let stateText; let basisText; let tone = 'day';
  if (placed > 0 && awake === 0) {
    state = 'resting';
    stateText = 'Ember is resting';
    basisText = `All ${placed} citizen${placed === 1 ? '' : 's'} the record places are asleep / away — a resting hour, and a normal one for this town.`;
    tone = 'dusk';
  } else if (awake >= RHYTHM_BUSY_AWAKE) {
    state = 'busy';
    stateText = 'Ember is busy';
    basisText = `${awake} of the ${placed} citizens the record places are awake and about — speaking, working, or on the way somewhere in the public feeds Portal reads.`;
  } else if (placed === 0) {
    state = 'normal quiet';
    stateText = 'Ember is quiet, in the normal way';
    basisText = 'Nobody is in the public feeds Portal reads right now — that is a normal hour for this town, not a broken one.';
  } else {
    state = 'normal quiet';
    stateText = 'Ember is quiet, in the normal way';
    basisText = `${awake} of the ${placed} citizens the record places ${awake === 1 ? 'is' : 'are'} awake${asleep > 0 ? `; ${asleep} ${asleep === 1 ? 'is' : 'are'} asleep / away` : ''}. A normal, quiet hour for this town.`;
  }
  const world = bundle?.world || {};
  const word = skyWord(world.sky);
  const weather = word ? {
    word,
    raw: world.sky,
    caption: `Recorded weather over Ember: ${word}. That is the world's own outlook, as the public feeds Portal reads reported it${bundle?.newestFetchUtc ? ` — read at ${bundle.newestFetchUtc}` : ''}. Portal has no weather of its own to add.`,
  } : null;
  return {
    state, stateText, basisText, tone,
    placed, awake, asleep,
    worldHour: typeof world.worldHour === 'number' ? world.worldHour : null,
    season: typeof world.season === 'string' && world.season !== '' ? world.season : null,
    year: typeof world.year === 'number' ? world.year : null,
    weather,
  };
}

/** The rhythm header's HTML: the state with its basis, the world's
 *  clock and season read as plain data, and the recorded weather
 *  captioned as such — or no weather at all when the bundle carries
 *  none. The resting frame carries the dusk tone class; no state is
 *  ever labelled with a day-part word. All feed-born text escaped. */
export function rhythmHeaderHtml(model) {
  if (!model) return '';
  const seasonPart = model.season
    ? `, in ${escapeHtml(model.season.toLowerCase())}${model.year !== null ? ` of year ${model.year}` : ''}`
    : '';
  const clock = model.worldHour !== null
    ? `<span class="rhythm-clock">The world's own clock reads hour ${model.worldHour}${seasonPart}.</span>`
    : '';
  return `<span class="rhythm-state">${escapeHtml(model.stateText)}</span> <span class="rhythm-basis">${escapeHtml(model.basisText)}</span> ${clock}${model.weather ? `<span class="rhythm-weather">${escapeHtml(model.weather.caption)}</span>` : ''}`;
}

// ------------------------------------------------- M6 final lane
//
// The M6 wave's last lane: Follow productised (M6.07), the
// first-visit overlay + About completion (M6.12), the accessibility
// set's models (M6.15), and the sound-off standing rule (M6.16).
// Everything here is pure model, like the rest of this module: app.js
// wires it to the page, the suites pin it per file, and no wording
// below is paraphrased anywhere else — a surface that re-words one
// of these strings forks the guarantee it carries.

// ------------------------------------------------------------ M6.07
//
// Follow, productised (Lead M6.4 / Design T5 / WP-19). Design T5's
// table names eight states, each "a state with exact wording, not an
// error": Engaged · Travelling · At place / working · Entering /
// inside · Waiting — asleep/away · Waiting — stale/contradictory ·
// On the map · Exited. The wordings live HERE, as data — the M6 wave
// brief's Conflict 2 ruling: the M4.21 artefact as built is the
// tokens slice, so the Follow wording table's home is this module's
// wording table (the same home M4.19 formalised for the honesty
// cluster), importable by the app and the scene alike. The
// state-tour test pins every bar character-for-character against
// this table; if the G1 design artefact is ever built, the table
// moves there whole, by a recorded change, not by drift.
//
// Sources for the words themselves: UX §3.6 (the waiting bar, the
// on-map line, the catching-up-while-loading sentence), UX §6.5
// (the catching-up caption), UX §3.1 (the return chip), Design T5's
// table (the stale/contradictory caption). The travelling caption
// without a caller-supplied one is §4.1's "[Name] is walking to
// [place]." A caller whose walk is a reconstruction (M3.06) passes
// its own caption — the scheduling disclosure rides in it — and the
// machine keeps the state, not the template.

/** The eight Follow states, in Design T5's table order. */
export const FOLLOW_STATES = [
  'engaged', 'travelling', 'at-place', 'inside',
  'waiting-quiet', 'waiting-stale', 'on-map', 'exited',
];

/** The Follow wording table — data, not scattered strings. Slots:
 *  {name} the citizen's full name, {place} a place label, {time} a
 *  relative time, {caption} a live caption from the §4 table. */
export const FOLLOW_WORDINGS = {
  bar: 'Following {name} — {caption}',
  walkingCaption: '{name} is walking to {place}.',
  catchingUpWalkSuffix: ' (Catching up — walking through what happened, in order, quickly.)',
  catchingUpLoadingSuffix: ' (Catching up — walking the steps that happened while Portal was loading.)',
  insideSuffix: ' — inside {place}.',
  waitingQuiet: 'Following {name} — they are asleep / away. Last heard from {time}. Portal will stay here; you can keep watching the town, or stop following.',
  waitingStale: 'Waiting for a fresh record — the last one put {name} at {place}.',
  onMap: 'Following on the map — {name} is outside the town',
  returnChip: 'Following: {name} — return',
};

/** Fill a wording template's {slots} from `values`; a slot with no
 *  value is left standing, visibly unfilled, never silently dropped. */
export function fillWording(template, values = {}) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (
    values[k] !== undefined && values[k] !== null ? String(values[k]) : m
  ));
}

/**
 * The Follow view for one moment: which of the eight states the
 * machine is in, and the bar's exact words for it. Pure — app.js
 * feeds it the bundle citizen, the placement tracker's conflict
 * model, the frontier hand-off test, and whatever the playback layer
 * currently knows (a walk in progress, a catch-up, an interior).
 * Priority is the design's: a contradiction outranks everything (the
 * figure is HELD, and the bar says why); the map hand-off outranks
 * quiet (the record places them, just not in town); quiet outranks
 * the street states (a citizen the record has stopped evidencing is
 * waited for, not performed).
 */
export function followViewFor({
  name = 'A citizen', citizen = null, caption = null, placeLabel = null,
  conflict = null, beyondWall = false,
  walkingToLabel = null, catchingUp = null, insidePlaceLabel = null,
} = {}) {
  if (conflict) {
    // T5's sentence names the LAST record's place ("the last one
    // put [Name] at [place]") — the newest claim, not the held
    // place: the figure stands at the held place (the stage shows
    // it; the inspector shows both records), and this caption says
    // what the freshest, contradictory record claimed.
    const place = conflict.claims?.[conflict.claims.length - 1]?.placeLabel
      || conflict.heldPlaceLabel
      || 'no agreed place';
    return { state: 'waiting-stale', bar: fillWording(FOLLOW_WORDINGS.waitingStale, { name, place }) };
  }
  if (beyondWall) {
    return { state: 'on-map', bar: fillWording(FOLLOW_WORDINGS.onMap, { name }) };
  }
  if (!citizen || citizen.state === 'asleep' || !isEvidenced(citizen)) {
    const time = citizen?.evidenceUtc ? relativeTime(citizen.evidenceUtc) : 'not in the record';
    return { state: 'waiting-quiet', bar: fillWording(FOLLOW_WORDINGS.waitingQuiet, { name, time }) };
  }
  const cap = caption ?? citizenCaption(citizen, placeLabel);
  if (insidePlaceLabel) {
    return {
      state: 'inside',
      bar: fillWording(FOLLOW_WORDINGS.bar, { name, caption: cap })
        + fillWording(FOLLOW_WORDINGS.insideSuffix, { place: insidePlaceLabel }),
    };
  }
  if (walkingToLabel) {
    const walkCap = caption ?? fillWording(FOLLOW_WORDINGS.walkingCaption, { name, place: walkingToLabel });
    let bar = fillWording(FOLLOW_WORDINGS.bar, { name, caption: walkCap });
    if (catchingUp === 'walk') bar += FOLLOW_WORDINGS.catchingUpWalkSuffix;
    else if (catchingUp === 'loading') bar += FOLLOW_WORDINGS.catchingUpLoadingSuffix;
    return { state: 'travelling', bar };
  }
  return { state: 'at-place', bar: fillWording(FOLLOW_WORDINGS.bar, { name, caption: cap }) };
}

/**
 * The Follow machine: one followed citizen at a time, the eight
 * states as its only outputs. engage() is the Engaged state (the bar
 * appears with the citizen's current view); update() re-derives the
 * state from the latest record — resumption after quiet is the
 * caller's catch-up playback (M3.02) surfacing through update()'s
 * catchingUp flag, never a pop of the figure; exit() is the Exited
 * state and leaves the return chip behind (UX §3.1: re-engage in
 * ≤ 1 click). Following someone else is an engage() — the bar's new
 * words are the announcement.
 */
export function createFollowMachine() {
  let current = null; // {key, name}
  let lastExited = null; // {key, name} — the return chip's target
  const chip = () => (lastExited
    ? fillWording(FOLLOW_WORDINGS.returnChip, { name: lastExited.name })
    : null);
  return {
    get key() { return current?.key ?? null; },
    get lastExited() { return lastExited; },
    engage(citizen, ctx = {}) {
      const key = citizen ? citizenKeyOf(citizen) : (ctx.key ?? null);
      if (!key) return { state: 'exited', bar: null, returnChip: chip() };
      current = { key, name: citizen?.name || ctx.name || 'A citizen' };
      lastExited = null;
      const view = followViewFor({ ...ctx, name: current.name, citizen });
      return { state: 'engaged', bar: view.bar, viewState: view.state };
    },
    update(input = {}) {
      if (!current) return { state: 'exited', bar: null, returnChip: chip() };
      return followViewFor({ ...input, name: input.name || current.name });
    },
    exit() {
      if (current) { lastExited = current; current = null; }
      return { state: 'exited', bar: null, returnChip: chip() };
    },
    resume(citizen, ctx = {}) { return this.engage(citizen, ctx); },
  };
}

/** The mayor's PORTAL-KEY, by office (never by name alone): the
 *  first MAYOR entry in the record's office order, or null when the
 *  record seats no mayor. The overlay's [Follow the Mayor] and the
 *  click budgets both key off this. */
export function mayorKeyOf(bundle) {
  const mayor = officesInOrder(bundle).find((o) => o.office === 'MAYOR');
  return mayor?.key ?? null;
}

/** The click budgets (UX §3.1, binding per WP-19): the mayor in
 *  ≤ 2 clicks from load (the overlay's button is click 1), any
 *  evidenced citizen in ≤ 3, the return chip in ≤ 1. */
export const FOLLOW_CLICK_BUDGET = { mayor: 2, citizen: 3, returnChip: 1 };

// ------------------------------------------------------------ M6.12
//
// First-visit overlay + About (Lead M6.7 / Design T13 / UX §7.1).
// One card over the LIVE DIMMED diorama — the town keeps moving
// behind it; it is not a wizard and never a gate on the data. Once
// per browser: the flag is browser-local storage and nothing else
// (Portal has no accounts and no server state to keep it in). The
// three facts are UX §7.1's, verbatim; the small print is M5.12's
// onboarding wording, consumed from disclosures.mjs — the one
// wording source — never re-drafted here.

export const WELCOME_STORAGE_KEY = 'portal.welcomeSeen.v1';
export const WELCOME_HEADING = 'Welcome to Ember.';
export const WELCOME_FACTS = [
  'These are real citizens. Ember is a town where AI citizens live, work, and govern themselves. Nobody is acting a part for you, and Portal invents nobody.',
  'You are half a minute behind. Portal shows the town\'s public record, about 30 seconds behind the real town.',
  'Tap anyone to follow them. A citizen, a building, or a news item — or start here:',
];
export const WELCOME_MAYOR_BUTTON = 'Follow the Mayor';
export const WELCOME_AWAKE_BUTTON = 'See who is awake';
/** The one-time text hint by the strip after dismissal (UX §7.1). */
export const WELCOME_DISMISS_HINT = 'Start with a face: tap a portrait to see what they are doing.';

/** Has this browser seen the welcome card? A storage that throws or
 *  is absent answers "not seen" — the card is a courtesy, and a
 *  browser that cannot remember it simply offers it again. */
export function welcomeSeen(storage) {
  try { return !!storage?.getItem(WELCOME_STORAGE_KEY); } catch { return false; }
}

/** Record that this browser has seen the welcome card. Storage
 *  failures are swallowed by design (see welcomeSeen). */
export function markWelcomeSeen(storage) {
  try { storage?.setItem(WELCOME_STORAGE_KEY, '1'); } catch { /* no memory, no harm */ }
}

/** The welcome card's HTML: the three facts, the two working
 *  buttons (each counts in the §3.1 budgets), a plain Close, and
 *  M5.12's small print. The mayor's button names the office, not a
 *  person — who holds it is the record's business. */
export function welcomeOverlayHtml() {
  const facts = WELCOME_FACTS.map((f) => `<li>${escapeHtml(f)}</li>`).join('');
  return `<div class="welcome-card">
    <h2>${escapeHtml(WELCOME_HEADING)}</h2>
    <ol class="welcome-facts">${facts}</ol>
    <p class="welcome-actions">
      <button type="button" data-welcome-mayor>${escapeHtml(WELCOME_MAYOR_BUTTON)}</button>
      <button type="button" data-welcome-awake>${escapeHtml(WELCOME_AWAKE_BUTTON)}</button>
      <button type="button" data-welcome-close>Close</button>
    </p>
    <p class="welcome-small">${escapeHtml(ONBOARDING_SMALL_PRINT)}</p>
  </div>`;
}

/**
 * The About attribution roll (M6.12): every outside work Portal's
 * surfaces are built from, with its licence — the ASSETS.md roll in
 * one data table. game-icons.net is the project's one attribution
 * OBLIGATION (CC BY 3.0, per the resource inventory); the CC0 packs
 * need no credit and get it anyway, because the roll is also the
 * provenance record. A surface that ships an asset not in this table
 * is a defect the font/asset audits exist to catch.
 */
export const ATTRIBUTIONS = [
  { what: 'Citizen bodies, outfits and animations', credit: 'Quaternius — Universal Base Characters, Modular Character Outfits (Fantasy), Universal Animation Library 1 & 2', licence: 'CC0 1.0 Universal' },
  { what: 'Buildings and village pieces', credit: 'Quaternius — Medieval Village MegaKit', licence: 'CC0 1.0 Universal' },
  { what: 'Citizen figures and work animations', credit: 'KayKit, by Kay Lousberg — Adventurers and Character Animations', licence: 'CC0 1.0 Universal' },
  { what: 'Nature, road and furniture pieces', credit: 'Kenney — Nature Kit, City Kit Roads, Furniture Kit', licence: 'CC0 1.0 Universal' },
  { what: 'Icons', credit: 'game-icons.net', licence: 'CC BY 3.0 — attribution required, and given here' },
  { what: 'The quoted-words typeface', credit: 'Lora, by Cyreal — self-hosted from this page\'s own files, with its licence kept beside them', licence: 'SIL Open Font License 1.1' },
  { what: 'The 3D stage renderer', credit: 'Three.js, by the Three.js Authors', licence: 'MIT License' },
  { what: 'Animation compression on the 3D stage', credit: 'meshoptimizer, by Arseny Kapoulkine', licence: 'MIT License' },
];

/** The attribution roll as About HTML: what, whose, under what
 *  licence — all three, every row, escaped. */
export function attributionsHtml() {
  const rows = ATTRIBUTIONS.map((a) => `
      <li><strong>${escapeHtml(a.what)}:</strong> ${escapeHtml(a.credit)} — ${escapeHtml(a.licence)}.</li>`).join('');
  return `<h3>Built with other people's work — the credit roll</h3>
    <ul class="attributions">${rows}
    </ul>
    <p class="soft">Portal's own drawings, words and code are Portal's. Nothing above was taken from anywhere but its creator's own page, and each licence was read from inside its own download before use.</p>`;
}

// ------------------------------------------------------------ M6.15
//
// The accessibility set (Design X1 / X2 / X4 / X6 / X7). The models
// live here; app.js and styles.css carry the wiring, and the tester
// log (test/TESTER-LOG-X1-X4.md) records the keyboard-only and
// 390 px touch-only job runs against them.

// ---- X6 — display toggles (UX §8). Four toggles, display only:
// figures' richness, buildings' trim, motion, ticker scope. The
// standing invariants, machine-checked over the whole matrix in the
// suite: NEVER fewer citizens, NEVER disabled captions, and a
// building's STATE is information — Simple drops trim only, so the
// state line survives in both buildings modes (under D-9b the app
// shows repair state only where the record carries it; what it
// shows, it shows in both modes).

/** The toggle sets, in panel order. */
export const DISPLAY_TOGGLES = {
  figures: ['full', 'simple', 'portraits'],
  buildings: ['full', 'simple'],
  motion: ['full', 'calmer'],
  ticker: ['all', 'civic-arrivals'],
};
export const DISPLAY_DEFAULTS = { figures: 'full', buildings: 'full', motion: 'full', ticker: 'all' };
export const DISPLAY_TOGGLE_LABELS = {
  figures: 'Figures', buildings: 'Buildings', motion: 'Motion', ticker: 'News scope',
};
export const DISPLAY_OPTION_LABELS = {
  full: 'Full', simple: 'Simple', portraits: 'Portraits only',
  calmer: 'Calmer', all: 'All news', 'civic-arrivals': 'Civic & arrivals',
};

/** Settings in, settings out: any value outside its toggle set
 *  falls back to the default — a corrupt stored setting degrades to
 *  the full display, never to a reduced one. */
export function normaliseDisplaySettings(input) {
  const out = {};
  for (const [k, options] of Object.entries(DISPLAY_TOGGLES)) {
    out[k] = options.includes(input?.[k]) ? input[k] : DISPLAY_DEFAULTS[k];
  }
  return out;
}

/** The civic-&-arrivals ticker scope's kinds: civic events from the
 *  record's own kinds; arrivals arrive as placement entry lines
 *  (kind 'entry'), which the caller filters on the same rule. */
export const TICKER_CIVIC_KINDS = new Set(['CITY_EVENT_BEGAN']);
export function tickerScopeAllows(item, scope) {
  if (scope !== 'civic-arrivals') return true;
  if (!item) return false;
  if (item.kind === 'entry') return true; // a placement arrival line
  return TICKER_CIVIC_KINDS.has(item.kind);
}

// ---- X2 — the screen-reader scene. A parallel LIST over the same
// WorldData the stage draws: same buildings with the same state
// words (workTier, the renderer's own lookup), same placed citizens
// with the same captions (citizenCaption / the conflict line), same
// placement events. Equivalence is bundle-granular — the list is
// rebuilt per bundle, as the frozen surface pair M4.17 certifies
// (same WorldData, schedule, captions, ticker, roster, inspector);
// the stage's between-bundle walk is playback, and the list's
// "Just now" lines carry its evidenced steps. Nobody the stage
// places is missing from the list; nobody the list names is placed
// by invention — both read heldCitizenPositions and nothing else.

/**
 * The scene in words. `events` are placementEventLines for the
 * latest bundle, rendered last as "Just now:" lines — over a run of
 * bundles they are the coherent account of the minutes between.
 * `settings` (X6) may drop building TRIM text; it can never drop a
 * building's state line, a citizen, or a caption — the matrix test
 * proves that over every toggle combination.
 */
export function sceneListModel(bundle, layout, tracker, placeLabel, { settings = null, events = null } = {}) {
  const s = normaliseDisplaySettings(settings);
  const eff = effectiveLayout(layout, bundle);
  const label = labelOrSelf(placeLabel);
  const positions = heldCitizenPositions(bundle, layout, tracker);
  const byCode = new Map();
  for (const c of bundle?.citizens || []) {
    const key = citizenKeyOf(c);
    const p = positions.get(key);
    if (!p) continue;
    if (!byCode.has(p.code)) byCode.set(p.code, []);
    byCode.get(p.code).push(c);
  }
  const buildingLines = eff.nodes.map((node) => {
    const tier = workTier(bundle, node.code);
    const occupants = (byCode.get(node.code) || []).map((c) => c.name);
    const name = node.label || label(node.code);
    return {
      code: node.code, label: name,
      stateText: tier.label,
      trimText: s.buildings === 'full' ? 'drawn with its roof and trim' : null,
      occupants,
      text: `${name} — building state: ${tier.label}.${occupants.length ? ` Here: ${occupants.join(', ')}.` : ' Nobody is recorded here right now.'}`,
    };
  });
  const citizenLines = [];
  for (const c of bundle?.citizens || []) {
    const key = citizenKeyOf(c);
    if (!positions.has(key)) continue;
    const conflict = tracker ? conflictModel(tracker, key, placeLabel) : null;
    citizenLines.push({
      key, name: c.name,
      text: conflict
        ? `${c.name} — the public feeds Portal reads name two places for them; Portal holds them at ${conflict.heldPlaceLabel || 'no agreed place'} and will not guess.`
        : citizenCaption(c, label(c.placeCode)),
    });
  }
  const placedCount = citizenLines.length;
  const rosterCount = (bundle?.citizens || []).length;
  const eventLines = (events || []).map((l) => l?.text).filter(Boolean);
  const summary = `${placedCount} of ${rosterCount} named citizens are on the stage right now. The rest are in the roster without a figure, because Portal does not place people it has no evidence for.`;
  const lines = [
    summary,
    ...buildingLines.map((b) => b.text),
    ...citizenLines.map((c) => c.text),
    ...eventLines.map((t) => `Just now: ${t}`),
  ];
  return { lines, buildingLines, citizenLines, eventLines, placedCount, rosterCount, summary };
}

/** The scene list as HTML: one <li> per line, every line escaped —
 *  the lines carry feed-born names and places. */
export function sceneListHtml(model) {
  if (!model) return '';
  return model.lines.map((t) => `<li>${escapeHtml(t)}</li>`).join('');
}

/** The Display panel's HTML (X6): the four toggles as labelled
 *  native selects, options and labels from the toggle tables —
 *  Portal's own words, escaped like everything else. */
export function displayPanelHtml(settings) {
  const s = normaliseDisplaySettings(settings);
  return Object.keys(DISPLAY_TOGGLES).map((k) => `
    <label class="display-toggle">${escapeHtml(DISPLAY_TOGGLE_LABELS[k])}
      <select data-display="${k}">
        ${DISPLAY_TOGGLES[k].map((o) => `<option value="${o}"${s[k] === o ? ' selected' : ''}>${escapeHtml(DISPLAY_OPTION_LABELS[o])}</option>`).join('')}
      </select>
    </label>`).join('');
}

// ---- X1 — keyboard. The [/] citizen cycling the keyboard handler
// and the Previous/Next buttons share: evidenced, placed citizens
// in bundle order (the same order the stage draws them).

/** The next key in `keys` from `currentKey`, wrapping; from no
 *  current key, the first (or last, going backwards). */
export function cycleFollowKey(keys, currentKey, dir = 1) {
  if (!Array.isArray(keys) || !keys.length) return null;
  const i = keys.indexOf(currentKey);
  if (i === -1) return dir >= 0 ? keys[0] : keys[keys.length - 1];
  return keys[(i + dir + keys.length) % keys.length];
}

// ------------------------------------------------------------ M6.16
//
// Sound-off readability (Design X5), the standing rule: v1 is
// silent by default, and no information ever moves into an audio
// channel. The rule holds by construction — Portal ships no audio
// at all — and this census is the tripwire that keeps it holding:
// any audio element, audio API, or sound asset entering a shipped
// surface fails the suite, and the muted-test filing (the suite's
// simulated muted session + plan-to-complete/lane-m6-final.md)
// re-runs at every milestone that adds a scene behaviour (M7
// re-files it).

export const SOUND_OFF_STATEMENT = 'Portal is silent: it ships no audio element, no sound file, and no audio API use, so nothing a visitor can learn here is ever carried by sound. A muted visit loses nothing.';

/** Patterns that would put information (or anything) into an audio
 *  channel. Matched against shipped surface sources by the suite. */
export const AUDIO_SURFACE_PATTERNS = [
  /<audio\b/i,
  /\bAudioContext\b/,
  /\bwebkitAudioContext\b/,
  /new\s+Audio\s*\(/,
  /\bspeechSynthesis\b/,
  /\.(mp3|wav|ogg|oga|m4a|flac|opus)\b/i,
];

/** Census a set of named sources for audio surfaces. Returns the
 *  violations (empty when the standing rule holds). */
export function audioSurfaceCensus(sources) {
  const violations = [];
  for (const [name, text] of Object.entries(sources || {})) {
    const lines = String(text).split('\n');
    lines.forEach((line, i) => {
      for (const pattern of AUDIO_SURFACE_PATTERNS) {
        if (pattern.test(line)) violations.push({ source: name, line: i + 1, pattern: String(pattern) });
      }
    });
  }
  return violations;
}
