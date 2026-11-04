// City action table + coalescing tests (M3.03, Lead M3.2 / SE-2.4).
//
// The completeness test asserts the map-or-unmapped-with-reason
// property over the FROZEN Wave 1 census (the five kinds the record
// held at the M3.03 freeze). Its original form re-censused the LIVE
// archive on every run; that live census now lives in
// test/action-table-live.smoke.test.mjs, which reports drift as
// findings (VER rotation 1, 2026-11-03 — the live archive both gains
// kinds as the world moves and loses old snapshots to retention, so
// a live census can never be a deterministic gate). The real-snapshot
// tests run against the actual Wave 1 archive payload (archive/
// 2026-11-02/), the same payload GATHERING-EVIDENCE.md analysed.
// Synthetic tests are labelled synthetic and exist as negative
// controls — above all for work.delivered, which the current record
// must NEVER produce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTION_CLASSES,
  ACTION_TABLE,
  DELIVERY_PATTERNS,
  UNMAPPED_KINDS,
  VERB_FAMILIES,
  classifyKind,
  coalesceDelivered,
  derivePresentedActions,
  derivePresentedEvents,
  deriveWorkDelivered,
} from '../action-table.mjs';
import { ACTS_DISCLOSURE } from '../episodes.mjs';

const wave1News = JSON.parse(
  readFileSync(new URL('../archive/2026-11-02/news-20261102T020713Z.json', import.meta.url), 'utf8'),
);
const wave1Voices = JSON.parse(
  readFileSync(new URL('../archive/2026-11-02/voices-20261102T020714Z.json', import.meta.url), 'utf8'),
);

// ---------------------------------------------------------- families

test('verb families: every research/01 §5 family is present, plan-named, truly classed', () => {
  assert.equal(VERB_FAMILIES.length, 30);
  const byName = new Map(VERB_FAMILIES.map((f) => [f.family, f]));
  for (const f of VERB_FAMILIES) {
    assert.equal(f.provenance, 'plan-named', `${f.family} provenance`);
    assert.ok(ACTION_CLASSES.includes(f.verbClass), `${f.family} class ${f.verbClass} is a §5 class`);
    assert.ok(f.source.includes('research/01 §5'), `${f.family} cites §5`);
  }
  // The class exemplars the plan itself names:
  assert.equal(byName.get('travel').verbClass, 'DURATIONAL');
  assert.equal(byName.get('travel').beatForm, 'walked'); // durational → walked
  assert.equal(byName.get('harvest').verbClass, 'BATCHED');
  assert.equal(byName.get('harvest').beatForm, 'rounds'); // batched → rounds + counter
  assert.equal(byName.get('excavate').verbClass, 'INSTANT');
  assert.equal(byName.get('excavate').beatForm, 'one-beat'); // instant → one beat
  assert.equal(byName.get('debates-discussions').verbClass, 'SOCIAL-DURATIONAL');
  assert.equal(byName.get('debates-discussions').beatForm, 'scene'); // social → scenes at M5
  assert.equal(byName.get('hostile').beatForm, 'chronicle-only'); // no staged combat
  assert.deepEqual(byName.get('weather-laws').tags, ['by-program']);
  assert.equal(byName.get('tell').beatForm, 'chronicle-only'); // private — never displayed
});

// --------------------------------------- completeness (frozen census)

// The frozen Wave 1 census: the headline kinds the record held when
// the M3.03 table froze (the set the original live census found, and
// the set GATHERING-EVIDENCE.md analysed). Frozen as data because the
// live archive is not a stable census source in EITHER direction:
// the world adds kinds (PEOPLE_ALL_KINDS arrived 2026-11-03) and
// retention thins old snapshots (the 2026-11-02 day now survives as
// the single Wave 1 pass, whose 02:07Z news snapshot predates that
// day's STRUCTURE_COLLAPSED headline — the five-kind census is no
// longer reproducible from the surviving archive). The live census
// runs as a smoke in test/action-table-live.smoke.test.mjs and
// reports both directions of difference as findings.
const FROZEN_WAVE1_KINDS = [
  'CITY_EVENT_BEGAN', 'HAPPENING_WITNESSED', 'OUTLOOK_CHANGED', 'RUIN_EXCAVATED', 'STRUCTURE_COLLAPSED',
];

test('completeness (frozen Wave 1 census): every censused kind maps or is unmapped-with-reason', () => {
  const kinds = new Set(FROZEN_WAVE1_KINDS);
  assert.ok(kinds.size > 0, 'census found headline kinds');
  for (const kind of kinds) {
    const cls = classifyKind(kind);
    if (cls.mapped) continue;
    assert.equal(typeof UNMAPPED_KINDS[kind], 'string', `${kind} must map or carry an unmapped reason`);
    assert.ok(UNMAPPED_KINDS[kind].length > 0, `${kind} unmapped reason is non-empty`);
  }
  // The frozen record: exactly the five censused kinds, all mapped.
  assert.deepEqual([...kinds].sort(), [...FROZEN_WAVE1_KINDS].sort());
  for (const kind of kinds) {
    assert.equal(ACTION_TABLE[kind].provenance, 'record-evidenced', `${kind} is record-evidenced`);
  }
});

// ------------------------------------------------- presented actions

test('real snapshot: Orrin Lowmarsh coalesces to one presented action, ×17, one beat', () => {
  const actions = derivePresentedActions(wave1News);
  const orrin = actions.find((a) => a.actor === 'Orrin Lowmarsh');
  assert.ok(orrin, 'Orrin presents');
  assert.equal(orrin.kind, 'RUIN_EXCAVATED');
  assert.equal(orrin.family, 'excavate');
  assert.equal(orrin.verbClass, 'INSTANT');
  assert.equal(orrin.beatForm, 'one-beat'); // instant → one beat, never a loop
  assert.equal(orrin.count, 17); // GATHERING-EVIDENCE.md's worked count
  assert.equal(orrin.counterLabel, '×17');
  assert.equal(orrin.caption, 'Orrin Lowmarsh excavates an old ruin');
  assert.equal(orrin.acts.length, 17);
  assert.equal(orrin.disclosure, ACTS_DISCLOSURE); // acts-only honesty, verbatim
  const nath = actions.find((a) => a.actor === 'Nath Borowik');
  assert.equal(nath.count, 2);
  assert.equal(nath.counterLabel, '×2');
});

test('real snapshot: a single act presents with NO counter (no invented ×1)', () => {
  const one = {
    headlines: [
      { id: 'x1', kind: 'RUIN_EXCAVATED', at: '2026-11-01T10:00:00Z', phrase: 'Quinn Wayfarer brought a seal out of an old ruin at 5, 1.', locate: { cell: [5, 1] } },
    ],
  };
  const actions = derivePresentedActions(one);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].count, 1);
  assert.equal(actions[0].counterLabel, null);
});

test('coalescing window edges: one payload is one window; nothing merges across windows, actors, or kinds', () => {
  const mk = (id, at, phrase) => ({ id, kind: 'RUIN_EXCAVATED', at, phrase, locate: { cell: [0, 0] } });
  const windowA = {
    headlines: [
      mk('a1', '2026-11-01T00:00:00Z', 'Orrin Lowmarsh dug into an old ruin at 0, 0.'),
      mk('a2', '2026-11-01T23:59:59Z', 'Orrin Lowmarsh dug into an old ruin at 0, 0.'), // window's last instant
      mk('a3', '2026-11-01T12:00:00Z', 'Nath Borowik dug into an old ruin at 0, 0.'), // different actor
    ],
  };
  const windowB = {
    headlines: [mk('b1', '2026-11-02T00:00:01Z', 'Orrin Lowmarsh dug into an old ruin at 0, 0.')],
  };
  const a = derivePresentedActions(windowA);
  // Window-spanning repeats by one actor+kind coalesce; the other actor does not join.
  assert.equal(a.find((x) => x.actor === 'Orrin Lowmarsh').count, 2);
  assert.equal(a.find((x) => x.actor === 'Nath Borowik').count, 1);
  // A second window is a second presentation: counts never merge across windows.
  const b = derivePresentedActions(windowB);
  assert.equal(b.length, 1);
  assert.equal(b[0].count, 1);
  assert.equal(b[0].counterLabel, null);
});

test('speech exempt (negative control): voices payloads produce no actions, no events, no deliveries', () => {
  // Speech is handled by episodes/M5.01 and NEVER coalesces — and this
  // module never even reads it: a voices payload has no headlines.
  assert.deepEqual(derivePresentedActions(wave1Voices), []);
  assert.deepEqual(derivePresentedEvents(wave1Voices), []);
  assert.deepEqual(deriveWorkDelivered(wave1Voices), []);
});

// ------------------------------------------------- presented events

test('real snapshot: non-figure headlines present as events with the record\'s own words', () => {
  const events = derivePresentedEvents(wave1News);
  const byKind = new Map();
  for (const e of events) byKind.set(e.kind, [...(byKind.get(e.kind) || []), e]);
  assert.equal(byKind.get('CITY_EVENT_BEGAN').length, 3);
  assert.equal(byKind.get('CITY_EVENT_BEGAN')[0].beatForm, 'scene'); // social → scenes at M5
  assert.equal(byKind.get('CITY_EVENT_BEGAN')[0].verbClass, 'SOCIAL-DURATIONAL');
  assert.equal(byKind.get('OUTLOOK_CHANGED').length, 1);
  assert.deepEqual(byKind.get('OUTLOOK_CHANGED')[0].tags, ['by-program']);
  assert.equal(byKind.get('HAPPENING_WITNESSED')[0].beatForm, 'chronicle-only'); // no actor, no place
  // Captions are the record's phrases verbatim — this layer adds no words.
  for (const e of events) {
    assert.ok(wave1News.headlines.some((h) => h.phrase === e.caption), `caption is a record phrase: ${e.caption}`);
  }
  // Figure acts never double-present as events.
  assert.ok(!events.some((e) => e.kind === 'RUIN_EXCAVATED'));
});

test('unknown future kind (synthetic): unmapped, forward-compatible default, never forced into a class', () => {
  const cls = classifyKind('SOMETHING_NEW');
  assert.equal(cls.mapped, false);
  assert.match(cls.reason, /not in the frozen M3.03 table/);
  assert.equal(cls.verbClass, null);
  const events = derivePresentedEvents({
    headlines: [{ id: 'n1', kind: 'SOMETHING_NEW', at: '2026-11-03T00:00:00Z', phrase: 'Something new happened.', locate: null }],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].mapped, false);
  assert.equal(events[0].beatForm, 'ticker'); // generic object beat + Chronicle line (Plan B §3.5)
});

// --------------------------------------------------- work.delivered

test('work.delivered (negative control): the real record emits ZERO, however many acts it holds', () => {
  // The shipped registry is empty by design: no kind's phrase records
  // a delivery. Orrin's 17 acts — including 5 "brought a {item} out of
  // an old ruin" extractions — are the strongest act-count pattern in
  // the record, and counts/extraction are not delivery.
  assert.deepEqual(DELIVERY_PATTERNS, {});
  assert.deepEqual(deriveWorkDelivered(wave1News), []);
});

test('work.delivered (negative control, synthetic): act counts alone never emit, at any count', () => {
  const headlines = [];
  for (let i = 0; i < 30; i++) {
    headlines.push({
      id: `s${i}`, kind: 'RUIN_EXCAVATED', at: `2026-11-01T10:${String(i).padStart(2, '0')}:00Z`,
      phrase: i % 2 ? 'Orrin Lowmarsh brought a tool out of an old ruin at 1, 1.' : 'Orrin Lowmarsh dug into an old ruin at 1, 1.',
      locate: { cell: [1, 1] },
    });
  }
  assert.deepEqual(deriveWorkDelivered({ headlines }), []);
  assert.deepEqual(coalesceDelivered(deriveWorkDelivered({ headlines })), []);
});

test('work.delivered (synthetic positive path): a registered delivery phrase emits, then coalesces to one beat + ×N loads', () => {
  // Proves the emission + coalescing path works WHEN evidence exists:
  // a test-registered kind whose own phrase records actor, load, and
  // recipient. This pattern is NOT in the shipped table — no current
  // kind carries such a phrase.
  const deliveryPatterns = {
    WORK_DELIVERED_RECORDED: [/^(.+?) delivered (?:\d+ \w+ to|the load to) (.+?)(?: \(integrity (\+\d+)\))?\.$/],
  };
  const news = {
    headlines: [
      { id: 'd1', kind: 'WORK_DELIVERED_RECORDED', at: '2026-11-01T09:00:00Z', phrase: 'Orrin Lowmarsh delivered 10 stone to the Library Annex (integrity +10).', locate: null },
      { id: 'd2', kind: 'WORK_DELIVERED_RECORDED', at: '2026-11-01T11:00:00Z', phrase: 'Orrin Lowmarsh delivered 10 stone to the Library Annex (integrity +10).', locate: null },
      { id: 'd3', kind: 'WORK_DELIVERED_RECORDED', at: '2026-11-01T13:00:00Z', phrase: 'Orrin Lowmarsh delivered 10 stone to the Library Annex (integrity +10).', locate: null },
    ],
  };
  const facts = deriveWorkDelivered(news, { deliveryPatterns });
  assert.equal(facts.length, 3);
  assert.equal(facts[0].kind, 'work.delivered');
  assert.equal(facts[0].actor, 'Orrin Lowmarsh');
  assert.equal(facts[0].work, 'the Library Annex');
  assert.equal(facts[0].delta, '+10'); // the exact delta, from the record's own words
  const beats = coalesceDelivered(facts);
  assert.equal(beats.length, 1); // repeated work.delivered ⇒ ONE beat (M3.03)
  assert.equal(beats[0].count, 3);
  assert.equal(beats[0].counterLabel, '×3 loads'); // Plan B §3.5's counter
  // The M3.03 exit fixture's shape: caption on the first fact's tick,
  // performance anchored at the arrival node (object beats instant,
  // body beats catch up).
  assert.equal(beats[0].captionAt, '2026-11-01T09:00:00Z');
  assert.equal(beats[0].performAnchor, 'arrival-node');
  assert.deepEqual(beats[0].deltas, ['+10', '+10', '+10']);
});

// ------------------------------------------------------ determinism

test('determinism: same inputs => identical outputs', () => {
  assert.deepEqual(derivePresentedActions(wave1News), derivePresentedActions(wave1News));
  assert.deepEqual(derivePresentedEvents(wave1News), derivePresentedEvents(wave1News));
  assert.deepEqual(deriveWorkDelivered(wave1News), deriveWorkDelivered(wave1News));
});
