// readability.test.mjs — M5.05 (gesture clips + iconography) and
// M5.06 (the readability table fully implemented) over the ONE
// shared model (logic.mjs), judged against the frozen action table
// (build/data/action-table.mjs VERB_FAMILIES).
//
// Gates proved here:
//   M5.05 — every social state has >= 1 approved clip per family
//     with source + licence recorded in GESTURE_CLIPS / the state
//     table; the masked drill distinguishes talking from listening
//     (also proved on measured rig data by the factory frame-check;
//     here it is proved on the model's own channels).
//   M5.06 — the coverage matrix is complete against the frozen
//     table (a family without a row fails this file); every state
//     carries head icon + word, family colour token, staging and a
//     verbatim caption; the pre-act icon rule (>= 1 s, scaled never
//     skipped); the standing-order tag + suffix and the instant-act
//     suffix; the masked drill (colour stripped) recovers the drill
//     family at >= 90% across travel/work/gather/talk/civic/idle/
//     asleep; animation + icon + caption agree on 100% of sampled
//     acts; the carry gap (deliver-mend / haul) is recorded as a
//     gap, never faked, and readability for those families provably
//     does not depend on a clip existing.
// Run per file: node --test test/readability.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  READABILITY_STATES, FAMILY_READABILITY, GESTURE_CLIPS,
  headIconFor, readabilityForFamily, readabilityCaption,
  readabilityPresentation, preActIconLeadMs, preActIconAtMs,
  PRE_ACT_ICON_MS, INSTANT_ACT_SUFFIX, standingOrderSuffix, BY_PROGRAM_SUFFIX,
} from '../logic.mjs';
import { VERB_FAMILIES, derivePresentedActions } from '../../data/action-table.mjs';

const DRILL_FAMILIES = ['travel', 'work', 'gather', 'talk', 'civic', 'idle', 'asleep'];

// ---------------------------------------------------------- M5.06 matrix

test('coverage matrix: every frozen action-table family has a readability row', () => {
  assert.equal(VERB_FAMILIES.length, 30, 'the frozen table carries 30 families');
  for (const f of VERB_FAMILIES) {
    const row = readabilityForFamily(f.family);
    assert.ok(row, `family ${f.family} has a readability row`);
    if (row.state !== null) {
      assert.ok(READABILITY_STATES[row.state], `${f.family} -> state ${row.state} exists`);
    } else {
      assert.ok(['never', 'ticker', 'chronicle-only'].includes(row.presentation),
        `${f.family} with no state names its non-figure presentation`);
      assert.ok(typeof row.note === 'string' && row.note.length > 10,
        `${f.family} with no state records why`);
    }
  }
  // And no orphan rows: every matrix row names a real family.
  const names = new Set(VERB_FAMILIES.map((f) => f.family));
  for (const key of Object.keys(FAMILY_READABILITY)) {
    assert.ok(names.has(key), `matrix row ${key} names a frozen family`);
  }
});

test('every state carries icon + word, colour token, staging, caption template', () => {
  for (const [id, s] of Object.entries(READABILITY_STATES)) {
    assert.ok(s.icon && s.icon.id && s.icon.glyph && typeof s.icon.word === 'string' && s.icon.word.length > 0,
      `${id}: head icon ships WITH its word`);
    assert.ok(typeof s.staging === 'string' && s.staging.length > 5, `${id}: staging recorded`);
    assert.ok(typeof s.captionTemplate === 'string' && s.captionTemplate.length > 5, `${id}: caption template recorded`);
    assert.ok(typeof s.planColourName === 'string' && s.planColourName.length > 0, `${id}: plan colour name recorded`);
    if (id !== 'claimed') {
      assert.ok(typeof s.colourToken === 'string' && s.colourToken.startsWith('color.family.act.'),
        `${id}: family colour lives in the token artefact`);
    }
    assert.ok(DRILL_FAMILIES.includes(s.drillFamily) || s.drillFamily === null, `${id}: drill family is one of the seven or none`);
  }
});

test('headIconFor returns icon + word, and null (never a guess) for unknown states', () => {
  for (const id of Object.keys(READABILITY_STATES)) {
    const icon = headIconFor(id);
    assert.ok(icon.word.length > 0 && icon.glyph.length > 0, `${id} icon carries its word`);
  }
  assert.equal(headIconFor('not-a-state'), null);
});

// ---------------------------------------------------------- M5.05 gestures

test('M5.05 coverage: talk x2 + listen/nod + point + present, each with source + licence + rung', () => {
  const talk = Object.values(GESTURE_CLIPS).filter((g) => g.gesture === 'talk');
  assert.equal(talk.length, 2, 'talk has exactly two variants (standing + seated)');
  assert.deepEqual(talk.map((g) => g.variant).sort(), ['seated', 'standing']);
  for (const g of talk) {
    assert.match(g.source, /Universal Animation Library 1/, 'talk comes off the UAL rung');
    assert.equal(g.licence, 'CC0 1.0');
    assert.equal(g.rung, 'UAL (CC0)');
  }
  for (const gesture of ['listen', 'point', 'present']) {
    const g = Object.values(GESTURE_CLIPS).find((x) => x.gesture === gesture);
    assert.ok(g, `${gesture} has a clip`);
    assert.ok(g.source.length > 10 && g.licence.length > 0 && g.rung.length > 0,
      `${gesture}: source + licence + rung recorded`);
    assert.equal(g.rung, 'CUSTOM', `${gesture} honestly sits on the CUSTOM rung (no CC0 clip exists)`);
  }
  // No clip anywhere in the table claims the conditioned rung.
  for (const g of Object.values(GESTURE_CLIPS)) assert.notEqual(g.rung, 'Mixamo (conditioned)');
});

test('M5.05 coverage: every social state has >= 1 approved clip, source + licence recorded', () => {
  for (const id of ['talking', 'listening']) {
    const s = READABILITY_STATES[id];
    assert.ok(s.clip && s.clip.name && s.clip.source && s.clip.licence, `${id} carries an approved clip`);
  }
  // The observe/survey/inquiry staging gestures (point) and the
  // hand-over gestures (present) resolve through the matrix.
  for (const fam of ['observe', 'survey', 'inquiry']) {
    assert.equal(FAMILY_READABILITY[fam].clip, 'gesture-point', `${fam} points`);
  }
  for (const fam of ['store-give-pay', 'trade']) {
    assert.equal(FAMILY_READABILITY[fam].clip, 'gesture-present', `${fam} presents (hand-over)`);
  }
});

// ---------------------------------------------------------- carry gap

test('carry gap: deliver-mend + haul have NO clip, recorded as a gap, and stay readable without one', () => {
  for (const fam of ['deliver-mend', 'haul']) {
    const row = FAMILY_READABILITY[fam];
    assert.equal(row.clip, null, `${fam}: no clip claimed`);
    assert.match(row.note, /no carry/i, `${fam}: the gap is recorded as the SURFACE lane found it`);
    const p = readabilityPresentation({ family: fam, caption: 'Orrin Lowmarsh delivered to the Workshop' });
    assert.ok(p, `${fam} still presents`);
    assert.equal(p.clip, null);
    assert.ok(p.clipGap && p.clipGap.length > 10, `${fam}: clipGap states the gap`);
    assert.ok(p.icon && p.icon.word === 'Carrying' && p.caption, `${fam}: icon + word + caption carry the act`);
  }
});

test('the tell family has no presentation at all — privacy, not a gap', () => {
  assert.equal(readabilityPresentation({ family: 'tell' }), null);
  assert.equal(FAMILY_READABILITY['tell'].presentation, 'never');
});

// ---------------------------------------------------------- pre-act rule

test('pre-act icon rule: >= 1 s before the act, scaled never skipped', () => {
  assert.equal(PRE_ACT_ICON_MS, 1000);
  assert.equal(preActIconLeadMs(1), 1000);
  assert.equal(preActIconLeadMs(2.5), 2500, 'catch-up scales the lead');
  assert.equal(preActIconLeadMs(0.5), 1000, 'never below the floor');
  assert.equal(preActIconAtMs(5000, 1), 4000);
  assert.equal(preActIconAtMs(5000, 2.5), 2500);
  const p = readabilityPresentation({ family: 'travel', values: { name: 'Atlas Meridian', place: 'the College' }, actStartMs: 10000, rate: 2.5 });
  assert.equal(p.iconLeadMs, 2500);
  assert.equal(p.iconAtMs, 7500);
});

// ---------------------------------------------------------- captions

test('captions are the §4.1 templates, verbatim in form', () => {
  assert.equal(readabilityCaption('travelling', { name: 'Atlas Meridian', place: 'the College' }),
    'Atlas Meridian is walking to the College.');
  assert.equal(readabilityCaption('near-reach', { name: 'Atlas Meridian', place: 'the Plaza of Unity' }),
    'Atlas Meridian steps over to the Plaza of Unity.');
  assert.equal(readabilityCaption('working', { name: 'Kavi Marlow', station: 'Workshop bench', act: 'mending a hinge' }),
    'Kavi Marlow is working at the Workshop bench: mending a hinge.');
  assert.equal(readabilityCaption('gathering', { name: 'Orrin Lowmarsh', thing: 'fallen branches', round: 2, rounds: 3 }),
    'Orrin Lowmarsh is gathering fallen branches — round 2 of 3.');
  assert.equal(readabilityCaption('carrying', { name: 'Orrin Lowmarsh', thing: 'a bundle of timber', place: 'the Workshop' }),
    'Orrin Lowmarsh is carrying a bundle of timber to the Workshop.');
  assert.equal(readabilityCaption('talking', { name: 'Atlas Meridian', place: 'the College' }),
    'Atlas Meridian is talking at the College.');
  assert.equal(readabilityCaption('listening', { name: 'Nath Between', speaker: 'Atlas Meridian', place: 'the College' }),
    'Nath Between is listening to Atlas Meridian at the College.');
  assert.equal(readabilityCaption('idle', { name: 'Kavi Marlow', place: 'the Market Hall' }),
    'Kavi Marlow is at the Market Hall. Nothing recorded happening right now.');
  assert.equal(readabilityCaption('asleep', { name: 'Kavi Marlow', time: '20 minutes ago' }),
    'Kavi Marlow is asleep / away. Last heard from 20 minutes ago.');
  assert.equal(readabilityCaption('unknown', { name: 'Kavi Marlow', time: '3 days ago' }),
    "We don't know where Kavi Marlow is right now. Last heard from 3 days ago.");
  assert.equal(readabilityCaption('catching-up', {}),
    'Portal is catching up — walking through what happened, in order.');
  assert.equal(readabilityCaption('not-a-state'), null);
});

test('instant-act suffix rides every instant state', () => {
  assert.equal(readabilityCaption('civic-act', { name: 'Atlas Meridian', election: 'the mayoral election' }),
    `Atlas Meridian voted in the mayoral election.${INSTANT_ACT_SUFFIX}`);
  assert.equal(readabilityCaption('paying', { name: 'Atlas Meridian', amount: '12 coins', purpose: 'a repaired hinge' }),
    `Atlas Meridian paid 12 coins for a repaired hinge.${INSTANT_ACT_SUFFIX}`);
  assert.equal(readabilityCaption('building-raised', { plot: 'District 1 Plot 30', name: 'the town' }),
    `A building was raised on District 1 Plot 30 by the town.${INSTANT_ACT_SUFFIX}`);
  // Non-instant states never carry it.
  assert.ok(!readabilityCaption('travelling', { name: 'A', place: 'B' }).includes('Instant in the world'));
});

test('standing-order tag + suffix, named and unnamed; by-program tag + suffix', () => {
  const named = readabilityCaption('gathering', {
    name: 'Orrin Lowmarsh', thing: 'timber', round: 1, rounds: 2,
    tags: ['by-standing-order'], standingOrderName: 'Atlas Meridian',
  });
  assert.ok(named.endsWith(standingOrderSuffix('Atlas Meridian')));
  assert.ok(named.includes('done by a standing order Atlas Meridian left, not a live decision Portal can see.'));
  const unnamed = readabilityCaption('gathering', { name: 'O', thing: 'timber', round: 1, rounds: 2, tags: ['by-standing-order'] });
  assert.ok(unnamed.endsWith(standingOrderSuffix(null)));
  const prog = readabilityCaption('working', { name: 'W', station: 'press', act: 'printing', tags: ['by-program'] });
  assert.ok(prog.endsWith(BY_PROGRAM_SUFFIX));
  const p = readabilityPresentation({ family: 'harvest', values: { name: 'O', thing: 'timber', round: 1, rounds: 2, tags: ['by-standing-order'] } });
  assert.equal(p.tag, 'By standing order', 'the tag line rides under the icon');
});

// ---------------------------------------------------------- drills

// Sampled acts across every drill family, built through the same
// call surfaces render from.
function sampledActs() {
  const acts = [];
  const add = (drill, pres) => acts.push({ drill, pres });
  add('travel', readabilityPresentation({ family: 'travel', values: { name: 'Atlas Meridian', place: 'the College' } }));
  add('travel', readabilityPresentation({ family: 'move', values: { name: 'Nath Between', place: 'the Plaza of Unity' } }));
  add('work', readabilityPresentation({ family: 'make-craft', values: { name: 'Kavi Marlow', station: 'Workshop bench', act: 'crafting a latch' } }));
  add('work', readabilityPresentation({ family: 'repair-frontier', values: { name: 'Orrin Lowmarsh', station: 'waystation', act: 'repairing the pump' } }));
  // The record-evidenced figure act: caption from the frozen table itself.
  const presented = derivePresentedActions({ headlines: [
    { kind: 'RUIN_EXCAVATED', at: '2026-11-03T00:00:00Z', id: 'h1', phrase: 'Orrin Lowmarsh dug into an old ruin at [3,4]' },
  ] });
  assert.equal(presented.length, 1);
  add('work', readabilityPresentation({ family: presented[0].family, caption: presented[0].caption }));
  add('work', readabilityPresentation({ family: 'deliver-mend', caption: 'Orrin Lowmarsh delivered to the Workshop' }));
  add('gather', readabilityPresentation({ family: 'harvest', values: { name: 'Orrin Lowmarsh', thing: 'fallen branches', round: 1, rounds: 3 } }));
  add('talk', readabilityPresentation({ family: 'say', values: { name: 'Atlas Meridian', place: 'the College' } }));
  add('talk', readabilityPresentation({ family: 'events-gatherings', values: { name: 'Nath Between', place: 'the Plaza of Unity' } }));
  add('talk', readabilityPresentation({ state: 'listening', values: { name: 'Nath Between', speaker: 'Atlas Meridian', place: 'the College' } }));
  add('talk', readabilityPresentation({ family: 'debates-discussions', values: { name: 'Kavi Marlow', place: 'the College' } }));
  add('civic', readabilityPresentation({ family: 'vote-stand-propose', values: { name: 'Atlas Meridian', election: 'the mayoral election' } }));
  add('civic', readabilityPresentation({ family: 'trade', values: { name: 'Atlas Meridian', amount: '12 coins', purpose: 'a repaired hinge' } }));
  add('civic', readabilityPresentation({ family: 'build-raise-install', values: { plot: 'District 1 Plot 30', name: 'the town' } }));
  add('idle', readabilityPresentation({ state: 'idle', values: { name: 'Kavi Marlow', place: 'the Market Hall' } }));
  add('asleep', readabilityPresentation({ state: 'asleep', values: { name: 'Kavi Marlow', time: '20 minutes ago' } }));
  return acts;
}

// The masked drill's classifier: colour channels REMOVED (hex,
// colour token, plan colour name all stripped — the greyscale
// condition). Identification may use only icon, clip and caption.
function classifyMasked(pres) {
  const icon = pres.icon ? pres.icon.id : null;
  const caption = pres.caption || '';
  if (icon === 'speech-bubble') return 'talk';
  if (icon === 'open-book') return 'talk';
  if (/is asleep \/ away/.test(caption)) return 'asleep';
  if (/Nothing recorded happening right now/.test(caption)) return 'idle';
  if (/is gathering .* — round \d+ of \d+/.test(caption)) return 'gather';
  if (/is walking to|steps over to/.test(caption)) return 'travel';
  if (/voted in|paid .* for|building was raised/.test(caption)) return 'civic';
  if (icon === 'bundle') return 'work';
  if (icon === 'hammer-wrench') return 'work';
  if (/excavates an old ruin/.test(caption)) return 'work';
  return null;
}

test('masked drill (colour stripped): >= 90% across travel/work/gather/talk/civic/idle/asleep', () => {
  const acts = sampledActs();
  let right = 0;
  const misses = [];
  for (const { drill, pres } of acts) {
    assert.ok(pres, 'every sampled act presents');
    const masked = { ...pres, hex: null, colourToken: null, planColourName: null };
    const got = classifyMasked(masked);
    if (got === drill) right++;
    else misses.push(`${drill} -> ${got} (${pres.state}/${pres.family})`);
  }
  const score = right / acts.length;
  assert.ok(score >= 0.9, `masked drill ${(score * 100).toFixed(1)}% (${right}/${acts.length}); misses: ${misses.join('; ')}`);
});

test('masked drill distinguishes talking from listening on icon + clip + caption alone', () => {
  const talking = readabilityPresentation({ family: 'say', values: { name: 'Atlas Meridian', place: 'the College' } });
  const listening = readabilityPresentation({ state: 'listening', values: { name: 'Nath Between', speaker: 'Atlas Meridian', place: 'the College' } });
  assert.notEqual(talking.icon.id, listening.icon.id, 'different head icons (speech bubble vs open book)');
  assert.notEqual(talking.clip, listening.clip, 'different gestures (gesture-talk vs gesture-listen)');
  assert.notEqual(talking.caption, listening.caption, 'different captions (is talking at / is listening to)');
  assert.equal(classifyMasked({ ...talking, hex: null }), 'talk');
  assert.equal(classifyMasked({ ...listening, hex: null }), 'talk', 'same drill family, distinct state — the distinction is state-level, proved above');
  assert.equal(talking.state, 'talking');
  assert.equal(listening.state, 'listening');
});

test('agreement: animation + icon + caption agree on 100% of sampled acts', () => {
  const acts = sampledActs();
  let disagreements = 0;
  for (const { pres } of acts) {
    const s = READABILITY_STATES[pres.state];
    if (!s) { disagreements++; continue; }
    if (pres.icon.id !== s.icon.id || pres.icon.word !== s.icon.word) disagreements++;
    if (pres.colourToken !== s.colourToken) disagreements++;
    const row = pres.family ? FAMILY_READABILITY[pres.family] : null;
    const expectedClip = row && row.clip !== undefined ? row.clip : (s.clip ? s.clip.name : null);
    if (pres.clip !== expectedClip) disagreements++;
    if (/\{\w+\}/.test(pres.caption || '')) disagreements++; // an unfilled slot is a disagreement with the record
    if (s.instant && !(pres.caption || '').includes('Instant in the world')) disagreements++;
  }
  assert.equal(disagreements, 0, `0 disagreements across ${acts.length} sampled acts`);
});

test('no sampled caption paraphrases speech: talk captions state the act, never the words', () => {
  const p = readabilityPresentation({ family: 'say', values: { name: 'Atlas Meridian', place: 'the College' } });
  assert.equal(p.caption, 'Atlas Meridian is talking at the College.');
  assert.ok(!/["“”❝]/.test(p.caption), 'no quotation styling outside the fenced bubble kit');
});
