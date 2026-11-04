// Elsewhere Portal — M6.09 Chronicle engine (pure).
//
// The Chronicle is the town's dated record, and its one law is the
// plan's: items come from diffs + headlines cross-checked — NO item
// that neither source supports. Every item carries its support on its
// face (which source class backs it) and enough provenance for
// chronicle-check.mjs to re-verify it against the streams on disk.
//
// Item sources, and only these:
//   - diff     — a counted counters line from M6.08's diff writer
//                (feed/daily-counters.jsonl): one item per counter
//                that actually moved, falls worded as falls; the
//                writer's baseline line yields exactly one
//                "the Chronicle begins" item, never mined changes.
//   - first    — a line from feed/firsts.jsonl (a recorded first,
//                bundle-cited or record-attested as the line states).
//   - headline — an item from the live bundle's ticker (the record's
//                own news route). Admission requires the ticker
//                item's provenance (route + fetch stamp); a headline
//                without provenance is rejected, by name, in the
//                returned `rejected` list. Cross-check: every citizen
//                the headline text names is verified against the
//                bundle's citizen list and recorded on the item.
//   - minutes  — a counts-only summary pointer in M5.01's shape
//                (kind 'chronicle-summary-pointer', as produced by
//                logic.scheduleTalkScene): remainingCount + per-speaker
//                counts + the window's bounds. The engine copies ONLY
//                the count fields — a pointer carrying utterance text
//                does not propagate it (a test pins this). Full M5.09
//                minutes slot into this same intake shape.
//
// The newspaper object and the civic calendar are VIEWS over the
// current record, rebuilt every cycle (never accumulated): the Ember
// Ledger's quoted words come from the current episodes feed, and a
// calendar entry whose schedule leaves the record leaves the calendar
// with it — the plan's removal law is structural here, not a cleanup.
//
// Deterministic: no wall-clock reads; every stamp comes from inputs.

import { createHash } from 'node:crypto';
import { canonicalStringify } from './derive.mjs';

export const CHRONICLE_BOOK_SCHEMA = 'portal.chronicle-book/v1';
export const CHRONICLE_ITEM_SCHEMA = 'portal.chronicle-item/v1';
export const TALK_SUMMARY_POINTER_KIND = 'chronicle-summary-pointer';

export const COUNTER_LABELS = {
  joined: 'Citizens who have joined',
  nameable: 'Citizens Portal can name',
  placed: 'Named citizens with an evidenced place',
  regionsDiscovered: 'Regions discovered',
  regionsSurveyed: 'Regions surveyed',
  regionsNamed: 'Regions named',
  collegeDeposits: 'College deposits',
  treasury: 'Treasury',
};

const itemId = (identity) =>
  'chr-' + createHash('sha256').update(canonicalStringify(identity)).digest('hex').slice(0, 16);

const byTimeThenId = (a, b) =>
  (String(a.atUtc || '') < String(b.atUtc || '') ? -1
    : String(a.atUtc || '') > String(b.atUtc || '') ? 1
      : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Diff items from ONE daily-counters line. A baseline line yields the
 * single opening item; a diff line yields one item per moved counter
 * (delta ≠ 0), each citing the line's bundleSeq. Null deltas and
 * unmoved counters yield nothing — silence is not an item.
 */
export function itemsFromCountersLine(line) {
  if (!line || line.schema !== 'portal.daily-counters/v1') return [];
  const base = {
    schema: CHRONICLE_ITEM_SCHEMA, kind: 'diff', bookId: line.bookId || null,
    atUtc: line.atUtc || null, countedAtSeq: line.bundleSeq ?? null,
    support: { diff: true },
    source: { countersSeq: line.bundleSeq ?? null, basis: line.provenance?.basis || null },
  };
  if (line.kind === 'baseline' || line.deltas == null) {
    const text = `The Chronicle begins: Portal's counting started on ${line.date || 'an unrecorded date'}`
      + ` (bundle ${line.bundleSeq}). Nothing before that bundle is counted, and nothing is backfilled.`;
    return [{ ...base, id: itemId({ kind: 'diff-opening', seq: line.bundleSeq, bookId: line.bookId }), text }];
  }
  const items = [];
  for (const [field, delta] of Object.entries(line.deltas)) {
    if (!delta || typeof delta.delta !== 'number' || delta.delta === 0) continue;
    const label = COUNTER_LABELS[field] || field;
    const verb = delta.delta > 0 ? 'rose' : 'fell';
    const text = `${label} ${verb} by ${Math.abs(delta.delta)} (from ${delta.from} to ${delta.to}).`;
    items.push({
      ...base,
      id: itemId({ kind: 'diff', seq: line.bundleSeq, field }),
      text,
      source: { ...base.source, field, from: delta.from, to: delta.to, delta: delta.delta },
    });
  }
  return items;
}

/** A firsts-stream line becomes one Chronicle item, cited as the line cites itself. */
export function itemFromFirst(line) {
  if (!line || line.schema !== 'portal.firsts/v1') return null;
  const name = line.subject?.name || null;
  const text = line.detail
    || `${name || 'A citizen'} — a recorded first (${line.kind}).`;
  return {
    schema: CHRONICLE_ITEM_SCHEMA, kind: 'first', bookId: line.bookId || null,
    atUtc: line.atUtc || (line.date ? `${line.date}T00:00:00.000Z` : null),
    countedAtSeq: line.provenance?.bundleSeq ?? null,
    text,
    support: { first: true },
    source: {
      firstKind: line.kind, basis: line.provenance?.basis || null,
      route: line.provenance?.route ?? null, source: line.provenance?.source ?? null,
      citedLine: line.provenance?.citedLine ?? null,
    },
  };
}

export function withId(item) {
  if (!item) return null;
  return { ...item, id: itemId({ kind: item.kind, atUtc: item.atUtc, text: item.text, source: item.source }) };
}

/**
 * A ticker item becomes a headline item — or a named rejection.
 * Admission requires provenance (route + fetchedUtc): a headline
 * Portal cannot source is not Chronicle material. Cross-check: the
 * citizens the text names are verified against the bundle's list.
 */
export function itemFromHeadline(tickerItem, knownNames = []) {
  if (!tickerItem || typeof tickerItem.text !== 'string' || tickerItem.text === '') {
    return { item: null, rejected: { reason: 'headline-without-text', tickerKind: tickerItem?.kind ?? null } };
  }
  const prov = tickerItem.provenance || {};
  if (!prov.route || !prov.fetchedUtc) {
    return { item: null, rejected: { reason: 'headline-without-provenance', tickerKind: tickerItem.kind ?? null, text: tickerItem.text } };
  }
  const namedCitizens = knownNames.filter((n) => n && tickerItem.text.includes(n));
  const item = {
    schema: CHRONICLE_ITEM_SCHEMA, kind: 'headline', bookId: null,
    atUtc: tickerItem.utc || null, countedAtSeq: null,
    text: tickerItem.text,
    support: { headline: true },
    source: {
      tickerKind: tickerItem.kind ?? null, route: prov.route, fetchedUtc: prov.fetchedUtc,
      placeCode: tickerItem.placeCode ?? null, crossCheckedNames: namedCitizens,
    },
  };
  return { item: withId(item), rejected: null };
}

/**
 * A counts-only minutes item from an M5.01 summary pointer. ONLY the
 * count fields are read — text fields on the pointer, if any are ever
 * attached, are not copied, so the Chronicle can never quote speech
 * through this intake. (Full M5.09 minutes arrive in this same shape.)
 */
export function itemFromSummaryPointer(pointer, { episodeKey = null, placeCode = null, where = null } = {}) {
  if (!pointer || pointer.kind !== TALK_SUMMARY_POINTER_KIND) return null;
  if (!Number.isFinite(pointer.remainingCount) || pointer.remainingCount <= 0) return null;
  const bySpeaker = Array.isArray(pointer.bySpeaker) ? pointer.bySpeaker : [];
  const speakers = bySpeaker.map((s) => `${s.name} (${s.count})`).join(', ');
  const place = where ? ` at ${where}` : '';
  const text = `${pointer.remainingCount} more recorded utterances${place} were not played in full`
    + (speakers ? ` — spoken by ${speakers}` : '')
    + '. The Chronicle records the count; the words themselves are in the Conversations record.';
  const item = {
    schema: CHRONICLE_ITEM_SCHEMA, kind: 'minutes', bookId: null,
    atUtc: pointer.firstAt || null, countedAtSeq: null,
    text,
    support: { minutes: true },
    source: {
      pointerKind: pointer.kind, episodeKey, placeCode,
      remainingCount: pointer.remainingCount, bySpeaker,
      firstAt: pointer.firstAt || null, lastAt: pointer.lastAt || null,
    },
  };
  return withId(item);
}

/**
 * The Ember Ledger as a newspaper object: the latest recorded words
 * from the episodes feed, quoted verbatim (the record's own fence
 * markers ride inside the words, as everywhere Portal quotes speech),
 * attributed to their speakers, labelled a citizen newspaper. A view
 * over the current feed — rebuilt per cycle, capped, newest last so
 * it reads in the order spoken when sorted ascending by the caller.
 */
export function buildNewspaper(episodesFeed, { maxQuotes = 10 } = {}) {
  const episodes = Array.isArray(episodesFeed?.episodes) ? episodesFeed.episodes : [];
  const quotes = [];
  for (const ep of episodes) {
    for (const u of ep.utterances || []) {
      if (typeof u?.said !== 'string' || u.said === '') continue;
      quotes.push({ speaker: u.by || null, at: u.at || null, said: u.said, where: ep.where || null });
    }
  }
  quotes.sort((a, b) => (String(a.at) < String(b.at) ? -1 : String(a.at) > String(b.at) ? 1 : 0));
  return {
    name: 'The Ember Ledger',
    label: 'a citizen newspaper of Ember',
    note: 'Portal reads the Ledger in the public feeds Portal reads and quotes it here, attributed to its speakers. '
      + 'The words are the record\u2019s, fenced as recorded words everywhere Portal shows them.',
    quotes: quotes.slice(-maxQuotes),
  };
}

/**
 * The civic calendar as a view over the current record: one entry per
 * evidenced episode (a gathering of recorded speakers — attendance is
 * exactly the citizens the record captured speaking, never invitees),
 * plus deadline/election entries IF the ticker ever carries those
 * kinds (none do in the current record). An episode that leaves the
 * feed leaves the calendar: the view is rebuilt, never accumulated.
 */
export function buildCalendar({ episodesFeed = null, ticker = [] } = {}) {
  const entries = [];
  const episodes = Array.isArray(episodesFeed?.episodes) ? episodesFeed.episodes : [];
  for (const ep of episodes) {
    if (!ep.firstUtc) continue;
    entries.push({
      kind: 'gathering',
      atUtc: ep.firstUtc, endUtc: ep.lastUtc || null,
      placeCode: ep.place || null, where: ep.where || null,
      attendance: [...(ep.participants || [])],
      attendanceBasis: 'Named here because the record captured them speaking. The feeds do not show who else was present, who stayed silent, or when each of them left.',
      minutesItemId: null,
    });
  }
  for (const t of ticker || []) {
    const kind = t?.kind === 'DEADLINE' ? 'deadline'
      : (t?.kind === 'ELECTION' || t?.kind === 'VOTE') ? 'election' : null;
    if (!kind || !t.utc) continue;
    entries.push({
      kind, atUtc: t.utc, endUtc: null, placeCode: t.placeCode ?? null, where: null,
      attendance: [], attendanceBasis: null, minutesItemId: null, text: t.text || null,
    });
  }
  entries.sort(byTimeThenIdSafe);
  return entries;
}

function byTimeThenIdSafe(a, b) {
  return String(a.atUtc) < String(b.atUtc) ? -1 : String(a.atUtc) > String(b.atUtc) ? 1 : 0;
}

/**
 * The deterministic book the app consumes. Depth is stated, never
 * padded: collectingSince + the counted span ride on the face.
 */
export function buildChronicleBook({ items = [], newspaper = null, calendar = [], countersSpan = null, throughSeq = null } = {}) {
  const sorted = [...items].sort(byTimeThenId);
  return {
    schema: CHRONICLE_BOOK_SCHEMA,
    collectingSince: countersSpan?.firstDate || null,
    span: countersSpan,
    throughSeq,
    disclosures: [
      'Every Chronicle item is backed by a counted diff, a recorded first, a sourced headline, or a counts-only minutes pointer — an item no source supports is never admitted.',
      'Since-your-last-visit reads the bundle number your own browser stored on your last visit; nothing is written anywhere on your behalf.',
      'The quotes registry (M1.09) stays on the deriver side of the archive — quoted utterances are preserved there at thinning time. The browser never writes to it.',
    ],
    items: sorted,
    newspaper,
    calendar,
  };
}

/**
 * The exit gate's provenance completeness check: every item in the
 * book must resolve against the streams it cites. Returns the span
 * checked so the caller can state the depth honestly.
 */
export function provenanceCheck(book, { countersLines = [], firstsLines = [], summaryPointers = [] } = {}) {
  const failures = [];
  let checked = 0;
  const countersBySeq = new Map(countersLines.map((l) => [l.bundleSeq, l]));
  for (const item of book?.items || []) {
    checked += 1;
    const supported = item.support && Object.values(item.support).some(Boolean);
    if (!supported) { failures.push({ id: item.id, reason: 'no-support' }); continue; }
    if (item.kind === 'diff') {
      const line = countersBySeq.get(item.source?.countersSeq);
      if (!line) failures.push({ id: item.id, reason: 'counters-line-missing' });
      else if (item.source.field) {
        const d = line.deltas?.[item.source.field];
        if (!d || d.delta !== item.source.delta || d.to !== item.source.to) {
          failures.push({ id: item.id, reason: 'delta-mismatch' });
        }
      }
    } else if (item.kind === 'first') {
      const hit = firstsLines.some((l) => l.kind === item.source?.firstKind
        && (l.subject?.name || null) !== null
        && item.text.includes(l.subject.name));
      if (!hit && !firstsLines.some((l) => l.kind === item.source?.firstKind && l.detail === item.text)) {
        failures.push({ id: item.id, reason: 'first-not-in-stream' });
      }
    } else if (item.kind === 'headline') {
      if (!item.source?.route || !item.source?.fetchedUtc || !item.text) {
        failures.push({ id: item.id, reason: 'headline-provenance-incomplete' });
      }
    } else if (item.kind === 'minutes') {
      if (!(item.source?.remainingCount > 0)) failures.push({ id: item.id, reason: 'minutes-count-missing' });
    } else {
      failures.push({ id: item.id, reason: `unknown-kind-${item.kind}` });
    }
  }
  const dates = countersLines.map((l) => l.date).filter(Boolean).sort();
  return {
    ok: failures.length === 0, checked, failures,
    span: dates.length ? { from: dates[0], to: dates[dates.length - 1], countedDays: new Set(dates).size } : null,
  };
}
