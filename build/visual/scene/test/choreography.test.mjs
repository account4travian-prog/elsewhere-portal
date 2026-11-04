/* M5.11 (fixtures half) — work & gather choreography conformance.
   The choreography (../choreography.mjs) renders M3.03's frozen
   action table against fixtures: BATCHED gather shows rounds with
   the record's counter, INSTANT work shows one beat and never
   loops, clips resolve to the M4.08 library / kit-carried names
   that actually exist in the shipped GLBs, placement comes from
   the act's evidenced cell or the M4.14 footprint threshold, and
   the deliver/haul carry gap is carried exactly as the surface and
   readability lanes recorded it.
   The deriver extension stays CLOSED: DELIVERY_PATTERNS is frozen
   empty, and the LIVE NEGATIVE PROOF at the bottom asserts over
   tonight's live bundle, facts stream, and surviving archive that
   zero work/gather beats are presented as live fact — because the
   deriver cites none.
   Run per file: node --test test/choreography.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'node:module';

globalThis.self = globalThis; // three r186 expects the browser global
register('./three-vendor-hook.mjs', import.meta.url);

const { createFigureLoader, parseFigure } = await import('../figure-loader.mjs');
const {
  WORK_GATHER_FAMILIES, MAX_CYCLES_ON_SCREEN, CARRY_GAP_NOTES,
  familyTreatment, choreographyCoverage, footprintIndex,
  choreographAction, choreographDeliveredBeat,
} = await import('../choreography.mjs');
const { clipCoverage } = await import('../work-clips.mjs');
const {
  DELIVERY_PATTERNS, derivePresentedActions, deriveWorkDelivered, coalesceDelivered,
} = await import('../../../data/action-table.mjs');
const { FAMILY_READABILITY } = await import('../../../app/logic.mjs');

const footprints = footprintIndex(JSON.parse(
  readFileSync(new URL('../../footprint-specs.json', import.meta.url), 'utf8'),
));

// A presented action in the frozen M3.03 shape (as
// derivePresentedActions emits), built directly where the frozen
// recorded-kind table has no kind for the family (harvest's rounds
// are plan-named BATCHED; no current headline kind records them).
const presented = (over) => ({
  actor: 'Nia Okafor', kind: null, family: null, verbClass: 'INSTANT',
  beatForm: 'one-beat', count: 1, counterLabel: null, caption: 'Nia Okafor works',
  firstUtc: '2026-11-01T10:00:00Z', lastUtc: '2026-11-01T10:00:00Z',
  acts: [], disclosure: 'fixture', ...over,
});

// ------------------------------------------------------------- scope

test('scope: exactly the eight families the M4.08 coverage record speaks for', () => {
  assert.deepEqual([...WORK_GATHER_FAMILIES].sort(),
    Object.keys(clipCoverage().covered).sort());
  for (const f of WORK_GATHER_FAMILIES) {
    assert.ok(familyTreatment(f), `${f} has a treatment`);
  }
  // Outside scope is refused, never invented into choreography.
  assert.equal(familyTreatment('travel'), null);
  assert.equal(choreographAction(presented({ family: 'travel', verbClass: 'DURATIONAL', beatForm: 'walked' })), null);
  assert.equal(choreographAction(presented({ family: 'no-such-family' })), null);
  assert.equal(choreographAction(null), null);
});

test('cross-lane agreement: clip + state match the readability record family by family', () => {
  for (const f of WORK_GATHER_FAMILIES) {
    const t = familyTreatment(f);
    const r = FAMILY_READABILITY[f];
    assert.ok(r, `readability record has ${f}`);
    assert.equal(t.clip, r.clip, `${f}: choreography clip == readability clip`);
    assert.equal(t.state, r.state, `${f}: choreography state == readability state`);
  }
});

test('coverage: every claimed clip is in the M4.08 coverage record; carry families claim none', () => {
  const cov = clipCoverage();
  const bare = (s) => s.replace(/ \(kit-carried\)$/, '');
  for (const f of WORK_GATHER_FAMILIES) {
    const t = familyTreatment(f);
    if (t.clip === null) {
      assert.deepEqual(cov.covered[f], [], `${f} covered list is empty in the M4.08 record`);
      assert.equal(t.clipGap, cov.gaps[f], `${f} gap is the M4.08 record's own words`);
      assert.equal(t.gapNote, CARRY_GAP_NOTES[f]);
      assert.equal(t.gapNote, FAMILY_READABILITY[f].note, `${f} gap note is the readability lane's, verbatim`);
    } else {
      assert.ok(cov.covered[f].map(bare).includes(t.clip), `${f}: primary clip ${t.clip} is in the coverage record`);
      for (const alt of t.clipAlts) assert.ok(cov.covered[f].map(bare).includes(alt), `${f}: alt ${alt} recorded`);
    }
  }
});

test('named clips exist in the shipped GLBs (work library or kit-carried)', async () => {
  const loader = createFigureLoader();
  const libBytes = readFileSync(new URL('../../factory/outputs-web/clips/work-clips.glb', import.meta.url));
  const lib = await parseFigure(loader, libBytes.buffer.slice(libBytes.byteOffset, libBytes.byteOffset + libBytes.byteLength));
  const kitBytes = readFileSync(new URL('../../factory/outputs-web/orrin-lowmarsh--lod0.glb', import.meta.url));
  const kit = await parseFigure(loader, kitBytes.buffer.slice(kitBytes.byteOffset, kitBytes.byteOffset + kitBytes.byteLength));
  const names = new Set([...lib.animations, ...kit.animations].map((a) => a.name));
  for (const f of WORK_GATHER_FAMILIES) {
    const t = familyTreatment(f);
    if (t.clip) assert.ok(names.has(t.clip), `${f}: clip ${t.clip} exists in the shipped files`);
    for (const alt of t.clipAlts) assert.ok(names.has(alt), `${f}: alt clip ${alt} exists`);
  }
});

// ---------------------------------------------------------- fixtures

test('fixture: harvest rounds — one cycle per recorded round, counter is the record\'s', () => {
  const e = choreographAction(presented({
    family: 'harvest', verbClass: 'BATCHED', beatForm: 'rounds', count: 3,
    counterLabel: '×3 rounds', caption: 'Nia Okafor gathers fallen grain',
    acts: [{ at: '2026-11-01T10:00:00Z', cell: [3, 4] }, { at: '2026-11-01T10:01:00Z', cell: [3, 4] }, { at: '2026-11-01T10:02:00Z', cell: [3, 4] }],
  }), { footprints });
  assert.equal(e.mode, 'fixture');
  assert.equal(e.state, 'gathering');
  assert.equal(e.clip, 'work-pickup'); // the readability ruling: kit `gather` is a talk-pose stand-in, not counted
  assert.equal(e.cyclesShown, 3);
  assert.equal(e.rounds.length, 3);
  assert.ok(e.rounds.every((r) => r.shown));
  assert.equal(e.counterLabel, '×3 rounds');
  assert.deepEqual(e.place, { kind: 'cell', cell: [3, 4] });
  assert.equal(e.actsCited, 3);
});

test('fixture: harvest rounds cap at 6 on screen; the counter still carries the record\'s count', () => {
  const e = choreographAction(presented({
    family: 'harvest', verbClass: 'BATCHED', beatForm: 'rounds', count: 9, counterLabel: '×9 rounds',
  }));
  assert.equal(MAX_CYCLES_ON_SCREEN, 6);
  assert.equal(e.cyclesShown, 6);
  assert.equal(e.rounds.length, 9);
  assert.equal(e.rounds.filter((r) => r.shown).length, 6);
  assert.equal(e.counterLabel, '×9 rounds');
  assert.equal(e.count, 9);
});

test('fixture: INSTANT work families — one beat, never a loop, the recorded clips', () => {
  const cases = [
    ['make-craft', 'type'],
    ['build-raise-install', 'work-hammer'],
    ['repair-frontier', 'work-hammer'],
    ['pick-up', 'work-pickup'],
  ];
  for (const [family, clip] of cases) {
    const e = choreographAction(presented({ family, count: 4, counterLabel: '×4' }));
    assert.equal(e.clip, clip, family);
    assert.equal(e.cyclesShown, 1, `${family}: one beat however many acts coalesced`);
    assert.equal(e.loops, false, `${family}: never looped`);
    assert.equal(e.rounds, null);
    assert.equal(e.counterLabel, '×4', `${family}: the coalesced counter survives`);
  }
});

test('fixture, end to end through the frozen deriver: excavate acts present as one beat + counter at the evidenced cell', () => {
  const headlines = [];
  for (let i = 0; i < 7; i++) {
    headlines.push({
      id: `x${i}`, kind: 'RUIN_EXCAVATED', at: `2026-11-01T0${i}:00:00Z`,
      phrase: i % 2 ? 'Orrin Lowmarsh brought a ledger out of an old ruin at -13, -35.'
        : 'Orrin Lowmarsh dug into an old ruin at -4, -30.',
      locate: { cell: i % 2 ? [-13, -35] : [-4, -30], anchor: null },
    });
  }
  const actions = derivePresentedActions({ headlines });
  assert.equal(actions.length, 1);
  const e = choreographAction(actions[0], { footprints });
  assert.equal(e.family, 'excavate');
  assert.equal(e.clip, 'work-dig');
  assert.equal(e.count, 7);
  assert.equal(e.counterLabel, '×7');
  assert.equal(e.cyclesShown, 1);
  assert.equal(e.loops, false);
  assert.equal(e.caption, 'Orrin Lowmarsh excavates an old ruin');
  assert.deepEqual(e.place, { kind: 'cell', cell: [-4, -30] });
});

test('fixture: placement at a named place resolves through the M4.14 footprints — threshold, or honestly null', () => {
  const e = choreographAction(presented({
    family: 'make-craft', anchor: 'PUBLIC_WORKSHOP', caption: 'Nia Okafor makes a hinge at the Workshop',
  }), { footprints });
  assert.equal(e.place.kind, 'place');
  assert.equal(e.place.code, 'PUBLIC_WORKSHOP');
  assert.match(e.place.threshold, /threshold centre/);
  const unplaced = choreographAction(presented({ family: 'make-craft', anchor: 'NO_SUCH_PLACE' }), { footprints });
  assert.equal(unplaced.place, null, 'an unspecced anchor places nothing — never invented');
});

// ------------------------------------------- delivered beats (the seam)

const SEAM_PATTERNS = {
  WORK_DELIVERED_RECORDED: [/^(.+?) delivered (?:\d+ \w+ to|the load to) (.+?)(?: \(integrity (\+\d+)\))?\.$/],
};
const seamNews = (n) => ({
  headlines: Array.from({ length: n }, (_, i) => ({
    id: `d${i}`, kind: 'WORK_DELIVERED_RECORDED', at: `2026-11-01T${String(9 + i).padStart(2, '0')}:00:00Z`,
    phrase: 'Orrin Lowmarsh delivered 10 stone to the Library Annex (integrity +10).', locate: null,
  })),
});

test('fixture: a deriver-cited delivery renders the carrying treatment — caption + counter, arrival anchor, NO clip', () => {
  const facts = deriveWorkDelivered(seamNews(3), { deliveryPatterns: SEAM_PATTERNS });
  const beats = coalesceDelivered(facts);
  assert.equal(beats.length, 1);
  const e = choreographDeliveredBeat(beats[0], { mode: 'fixture' });
  assert.equal(e.family, 'deliver-mend');
  assert.equal(e.state, 'carrying');
  assert.equal(e.clip, null);
  assert.equal(e.clipGap, clipCoverage().gaps['deliver-mend']);
  assert.equal(e.gapNote, CARRY_GAP_NOTES['deliver-mend']);
  assert.equal(e.count, 3);
  assert.equal(e.counterLabel, '×3 loads');
  assert.equal(e.caption, 'Orrin Lowmarsh delivered to the Library Annex');
  assert.equal(e.captionAt, '2026-11-01T09:00:00Z');
  assert.equal(e.performAnchor, 'arrival-node');
  assert.deepEqual(e.deltas, ['+10', '+10', '+10']);
  assert.deepEqual(e.headlineIds, ['d0', 'd1', 'd2']);
  assert.match(e.evidenceRoute, /deriver-cited/);
});

test('negative controls: an uncited or foreign beat is refused, at any count', () => {
  // A beat shape with no facts at all.
  assert.equal(choreographDeliveredBeat({ kind: 'work.delivered', actor: 'X', work: 'Y', count: 5, facts: [] }), null);
  assert.equal(choreographDeliveredBeat({ kind: 'work.delivered', actor: 'X', work: 'Y', count: 5 }), null);
  // Facts of any other kind are not a delivery citation.
  assert.equal(choreographDeliveredBeat({
    kind: 'work.delivered', actor: 'X', work: 'Y',
    facts: [{ kind: 'population-changed', at: '2026-11-01T00:00:00Z' }],
  }), null);
  // One foreign fact among real ones still refuses the beat.
  const facts = deriveWorkDelivered(seamNews(1), { deliveryPatterns: SEAM_PATTERNS });
  const mixed = coalesceDelivered(facts)[0];
  mixed.facts = [...mixed.facts, { kind: 'season-changed', at: '2026-11-01T10:00:00Z' }];
  assert.equal(choreographDeliveredBeat(mixed), null);
  // A beat of any other kind is not this surface at all.
  assert.equal(choreographDeliveredBeat({ kind: 'population-changed', facts }), null);
});

test('negative controls: extractions and the word "delivered" in speech-shaped data emit nothing', () => {
  const news = {
    headlines: [
      { id: 'e1', kind: 'RUIN_EXCAVATED', at: '2026-11-01T08:00:00Z', phrase: 'Orrin Lowmarsh brought a ledger out of an old ruin at -13, -35.', locate: null },
      { id: 'e2', kind: 'RUIN_EXCAVATED', at: '2026-11-01T08:05:00Z', phrase: 'Orrin Lowmarsh delivered himself of a long speech at the ruin.', locate: null },
    ],
  };
  assert.deepEqual(deriveWorkDelivered(news), [], 'frozen patterns: no emission');
  assert.deepEqual(deriveWorkDelivered({ utterances: [{ said: 'I delivered the planks yesterday.' }] }), [],
    'speech is never parsed for deliveries');
});

// ------------------------------------------------- the live negative

test('LIVE NEGATIVE PROOF: the frozen deriver cites none — zero live work beats tonight', (t) => {
  // The structural reason, pinned: the shipped pattern register is
  // empty, so deriveWorkDelivered can emit for NO headline kind.
  assert.deepEqual(DELIVERY_PATTERNS, {}, 'DELIVERY_PATTERNS stays frozen empty (GAP-2)');

  // (1) The live facts stream carries no work.delivered fact.
  const factsLines = readFileSync(new URL('../../../data/feed/facts.jsonl', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(factsLines.filter((f) => f.type === 'work.delivered').length, 0,
    'facts.jsonl: zero work.delivered facts');

  // (2) The live bundle carries no work.delivered anything, on any
  // surface, and none of its act sequences belongs to a carry
  // family (the only families whose beats are delivery beats).
  const bundleRaw = readFileSync(new URL('../../../data/feed/world-data.json', import.meta.url), 'utf8');
  assert.ok(!bundleRaw.includes('work.delivered'), 'live bundle: the string work.delivered appears nowhere');
  const bundle = JSON.parse(bundleRaw);
  for (const seq of bundle.actSequences || []) {
    assert.ok(!('work' in seq) || seq.work == null, 'act sequences carry no delivery claim');
  }
  t.diagnostic(`live bundle seq ${bundle.bundleSeq}: actSequences=${(bundle.actSequences || []).length}, facts=${factsLines.length}`);

  // (3) The whole surviving archive, run through the frozen
  // deriver: zero facts, zero beats, zero live choreography
  // entries. (Read-only census — the archive is never written.)
  const archiveDir = new URL('../../../data/archive/', import.meta.url).pathname;
  let snapshots = 0, facts = 0, entries = 0;
  for (const day of readdirSync(archiveDir)) {
    const dayPath = join(archiveDir, day);
    if (!statSync(dayPath).isDirectory()) continue;
    for (const f of readdirSync(dayPath)) {
      if (!f.startsWith('news-')) continue;
      snapshots++;
      const payload = JSON.parse(readFileSync(join(dayPath, f), 'utf8'));
      const derived = deriveWorkDelivered(payload);
      facts += derived.length;
      entries += coalesceDelivered(derived)
        .map((b) => choreographDeliveredBeat(b, { mode: 'live' }))
        .filter(Boolean).length;
    }
  }
  assert.ok(snapshots > 0, 'the census read surviving news snapshots');
  assert.equal(facts, 0, 'archive-wide: the frozen deriver emits zero work.delivered facts');
  assert.equal(entries, 0, 'zero live work beats are presented as live fact');
  t.diagnostic(`archive census: ${snapshots} news snapshots, ${facts} work.delivered facts, ${entries} live beats`);
});

test('coverage record for the lane file: all eight families, gaps stated', (t) => {
  const cov = choreographyCoverage();
  assert.deepEqual(Object.keys(cov).sort(), [...WORK_GATHER_FAMILIES].sort());
  for (const [f, row] of Object.entries(cov)) {
    t.diagnostic(`${f}: clip=${row.clip ?? 'NONE (gap)'} state=${row.state} alts=[${row.clipAlts.join(', ')}]`);
  }
});
