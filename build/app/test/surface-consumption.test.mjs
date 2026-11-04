// surface-consumption.test.mjs — the SURFACE CONSUMPTION lane's
// gates over logic.talkActPresentation, the ONE model the panel,
// the 2D stage and the 3D scene all render talk acts from.
//
// Proved here:
//   - the speaker/listener presentations ARE readabilityPresentation
//     outputs (no re-derivation anywhere: same call, same object);
//   - the pre-act lead rides the presentation (iconAtMs = start −
//     lead; scaled by rate, never below the floor);
//   - the bubble is bubbleKit's stage variant — fenced, byte-equal,
//     truncation marked beside the words;
//   - town altitude collapses to icon + caption and carries NO
//     bubble (M5.03);
//   - a lone speaker stages no listener (never an invented audience);
//   - conflict rules (LIVE mode — the letter, kept as the
//     positive control): an asleep/held speaker suppresses the
//     staged act; an asleep/held/overflow listener is not staged
//     as one; a sleeping figure does not talk;
//   - the mode (VER-D22): every call names 'live' or 'recording'
//     — omitting it throws. In recording mode the record governs:
//     a live-asleep speaker/listener is staged per the record
//     with the set-aside reported in recordOverrides, while held
//     and overflow still suppress;
//   - posture: the staging step's standing posture plays the
//     standing talk clip; an evidenced seated posture plays the
//     seated variant — both from GESTURE_CLIPS;
//   - the model mutates nothing it is handed (positions, event).
// Run per file: node --test test/surface-consumption.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleTalkScene, talkActPresentation, readabilityPresentation,
  conversationStaging, GESTURE_CLIPS, stripRecordFence,
} from '../logic.mjs';

const FENCE = (s) => `<<ELSEWHERE_UNTRUSTED_TEST>>${s}<</ELSEWHERE_UNTRUSTED_TEST>>`;
const EP4 = {
  place: 'EMBER_PLAZA_OF_UNITY', firstUtc: '2026-11-02T10:00:00Z', lastUtc: '2026-11-02T10:03:00Z',
  participants: ['Nia Okafor', 'Kavi Marlow'], disclosure: 'd', utteranceCount: 4,
  utterances: [
    { at: '2026-11-02T10:00:00Z', by: 'Nia Okafor', said: FENCE('Good morning.') },
    { at: '2026-11-02T10:01:00Z', by: 'Kavi Marlow', said: FENCE('Morning, Nia.') },
    { at: '2026-11-02T10:02:00Z', by: 'Nia Okafor', said: FENCE('The roads first, then the hall.') },
    { at: '2026-11-02T10:03:00Z', by: 'Kavi Marlow', said: FENCE('Agreed.') },
  ],
};
const POS = { 'Nia Okafor': { x: 4, y: 4 }, 'Kavi Marlow': { x: 5, y: 4 } };
const label = (code) => ({ EMBER_PLAZA_OF_UNITY: 'the Plaza of Unity' })[code] || code;
const ev1 = () => scheduleTalkScene(EP4, { mode: 'recording' }).events[1]; // Kavi speaks, Nia listens

test('speaker + listener presentations are the readability model\u2019s own outputs', () => {
  const ev = ev1();
  const pres = talkActPresentation({ episode: EP4, event: ev, positions: POS, placeLabel: label, mode: 'recording' });
  assert.ok(pres);
  assert.equal(pres.suppressed, false);
  assert.deepEqual(pres.speaker.presentation, readabilityPresentation({
    family: 'say', values: { name: 'Kavi Marlow', place: 'the Plaza of Unity' }, actStartMs: ev.startMs, rate: 1,
  }), 'the speaker presentation is readabilityPresentation, unmodified');
  assert.equal(pres.listeners.length, 1);
  assert.deepEqual(pres.listeners[0].presentation, readabilityPresentation({
    state: 'listening', values: { name: 'Nia Okafor', speaker: 'Kavi Marlow', place: 'the Plaza of Unity' }, actStartMs: ev.startMs, rate: 1,
  }), 'the listener presentation is readabilityPresentation, unmodified');
  assert.equal(pres.speaker.presentation.state, 'talking');
  assert.equal(pres.speaker.presentation.icon.id, 'speech-bubble');
  assert.equal(pres.speaker.presentation.icon.word, 'Talking');
  assert.equal(pres.speaker.presentation.caption, 'Kavi Marlow is talking at the Plaza of Unity.');
  assert.equal(pres.listeners[0].presentation.caption, 'Nia Okafor is listening to Kavi Marlow at the Plaza of Unity.');
});

test('pre-act lead: the icon lands before the act, scaled by rate, never skipped', () => {
  const ev = ev1();
  const pres = talkActPresentation({ episode: EP4, event: ev, positions: POS, placeLabel: label, mode: 'recording' });
  assert.equal(pres.speaker.presentation.iconLeadMs, 1000);
  assert.equal(pres.speaker.presentation.iconAtMs, ev.startMs - 1000);
  assert.ok(pres.speaker.presentation.iconAtMs < ev.startMs, 'the icon is up BEFORE the act starts');
  const fast = talkActPresentation({ episode: EP4, event: ev, positions: POS, placeLabel: label, rate: 2.5, mode: 'recording' });
  assert.equal(fast.speaker.presentation.iconLeadMs, 2500, 'catch-up scales the lead');
  assert.equal(fast.speaker.presentation.iconAtMs, ev.startMs - 2500);
  assert.equal(fast.listeners[0].presentation.iconAtMs, ev.startMs - 2500, 'listeners share the lead');
});

test('the bubble is the kit\u2019s stage variant: fenced, byte-equal, marked cut', () => {
  const pres = talkActPresentation({ episode: EP4, event: ev1(), positions: POS, placeLabel: label, mode: 'recording' });
  // DELIBERATE RE-PIN (G-J1 round 3, 2026-11-03): byte-equal to the
  // record's WORDS — the said minus its transport fence, which
  // never renders (my Hark's round-2 blocker 1). The model layer
  // (schedule events, playback steps) still carries the said
  // verbatim, markers included; the strip is presentation-only.
  assert.equal(pres.bubble.text, 'Morning, Nia.', 'byte-equal to the record’s words');
  assert.equal(pres.bubble.text, stripRecordFence(EP4.utterances[1].said));
  assert.equal(pres.bubble.header, 'Kavi Marlow, 2 Nov 2026, 10:01 UTC:', 'the dated K1 header (G-J1 round 3)');
  assert.equal(pres.bubble.label, 'Recorded words');
  const long = {
    ...EP4,
    utterances: [{ at: '2026-11-02T10:00:00Z', by: 'Nia Okafor', said: FENCE(Array(60).fill('word').join(' ')) }],
    utteranceCount: 1,
  };
  const lp = talkActPresentation({ episode: long, event: scheduleTalkScene(long, { mode: 'recording' }).events[0], positions: POS, placeLabel: label, mode: 'recording' });
  assert.equal(lp.bubble.truncated, true);
  assert.equal(lp.bubble.marker, 'Read in full');
  assert.ok(lp.bubble.text.startsWith(lp.bubble.displayText), 'the cut is a prefix of the words');
  assert.ok(!lp.bubble.displayText.includes('Read in full'), 'the marker rides beside the words');
});

test('town altitude collapses to icon + caption, with no bubble and no gesture staging', () => {
  const pres = talkActPresentation({ episode: EP4, event: ev1(), positions: POS, placeLabel: label, altitude: 'town', mode: 'recording' });
  assert.equal(pres.bubble, null);
  assert.equal(pres.collapsed.mode, 'icon-caption');
  assert.equal(pres.collapsed.icon, 'talk');
  assert.equal(pres.collapsed.caption, 'Kavi Marlow is talking at the Plaza of Unity.');
  const scene = talkActPresentation({ episode: EP4, event: ev1(), positions: POS, placeLabel: label, altitude: 'scene', mode: 'recording' });
  assert.equal(scene.collapsed.mode, 'bubbles');
  assert.ok(scene.bubble, 'scene altitude keeps the bubble');
});

test('lone speaker: no listener is staged, and the speaker faces nobody', () => {
  const solo = {
    place: 'EMBER_PLAZA_OF_UNITY', firstUtc: '2026-11-02T08:00:00Z', lastUtc: '2026-11-02T08:02:00Z',
    participants: ['Nia Okafor'], disclosure: 'd', utteranceCount: 1,
    utterances: [{ at: '2026-11-02T08:00:00Z', by: 'Nia Okafor', said: FENCE('A note to the record.') }],
  };
  const pres = talkActPresentation({ episode: solo, event: scheduleTalkScene(solo, { mode: 'recording' }).events[0], positions: POS, placeLabel: label, mode: 'recording' });
  assert.equal(pres.lone, true);
  assert.deepEqual(pres.listeners, []);
  assert.equal(pres.speaker.facesPoint, null, 'no invented audience to face');
});

test('conflict: a sleeping figure does not talk — an asleep speaker suppresses the staged act', () => {
  const pres = talkActPresentation({
    episode: EP4, event: ev1(), positions: POS, placeLabel: label,
    treatments: { 'Kavi Marlow': 'asleep' }, mode: 'live',
  });
  assert.equal(pres.suppressed, true);
  assert.equal(pres.speaker, null);
  assert.equal(pres.bubble, null, 'no bubble is staged over a sleeping figure');
  assert.equal(pres.suppressedBy.treatment, 'asleep');
  assert.match(pres.suppressedBy.resolution, /sleeping figure does not talk/);
  assert.equal(pres.conflicts.length, 1);
});

test('conflict: held and overflow speakers suppress; a blocked listener is not staged as one', () => {
  for (const treatment of ['held', 'overflow']) {
    const pres = talkActPresentation({
      episode: EP4, event: ev1(), positions: POS, placeLabel: label,
      treatments: { 'Kavi Marlow': treatment }, mode: 'live',
    });
    assert.equal(pres.suppressed, true, `${treatment} speaker suppresses the act`);
    assert.equal(pres.suppressedBy.treatment, treatment);
  }
  const pres = talkActPresentation({
    episode: EP4, event: ev1(), positions: POS, placeLabel: label,
    treatments: { 'Nia Okafor': 'asleep' }, mode: 'live',
  });
  assert.equal(pres.suppressed, false, 'the speaker still talks');
  assert.equal(pres.listeners[0].blocked, true);
  assert.equal(pres.listeners[0].presentation, null);
  assert.equal(pres.listeners[0].clip, null, 'no listening gesture is staged on a sleeping figure');
  assert.ok(pres.bubble, 'the bubble still renders — the words are the record\u2019s');
});

test('posture: standing by the staging model; an evidenced seated posture plays the seated clip', () => {
  const staging = conversationStaging(EP4, POS);
  assert.equal(staging.steps[1].posture, 'standing', 'a town node evidences no seat');
  const pres = talkActPresentation({ episode: EP4, event: ev1(), positions: POS, placeLabel: label, mode: 'recording' });
  assert.equal(pres.speaker.posture, 'standing');
  assert.equal(pres.speaker.clip, GESTURE_CLIPS['gesture-talk'].clip);
  const seated = talkActPresentation({ episode: EP4, event: ev1(), positions: POS, placeLabel: label, posture: 'seated', mode: 'recording' });
  assert.equal(seated.speaker.posture, 'seated');
  assert.equal(seated.speaker.clip, GESTURE_CLIPS['gesture-talk-seated'].clip);
  assert.equal(pres.listeners[0].clip, GESTURE_CLIPS['gesture-listen'].clip, 'the listener plays the nod');
});

test('VER-D22 regression: recording mode stages a speaker the live snapshot has asleep', () => {
  // The defect's exact shape: the recorded speaker is asleep in
  // the live bundle, so live treatments carry 'asleep' for them.
  // A recording is governed by the record — they spoke, so they
  // were awake at this act.
  const pres = talkActPresentation({
    episode: EP4, event: ev1(), positions: POS, placeLabel: label,
    treatments: { 'Kavi Marlow': 'asleep' }, mode: 'recording',
  });
  assert.equal(pres.suppressed, false, 'the recorded act is staged, not suppressed');
  assert.ok(pres.speaker, 'the speaker is staged speaking');
  assert.equal(pres.speaker.name, 'Kavi Marlow');
  assert.equal(pres.speaker.clip, GESTURE_CLIPS['gesture-talk'].clip, 'the talk gesture plays');
  assert.ok(pres.bubble, 'the bubble renders');
  assert.equal(pres.bubble.text, stripRecordFence(EP4.utterances[1].said), 'the recorded words, byte-equal (transport fence stripped at presentation — G-J1 round 3)');
  assert.deepEqual(pres.conflicts, [], 'nothing is in conflict — the record governs');
  assert.equal(pres.recordOverrides.length, 1, 'the set-aside is reported, never silent');
  assert.equal(pres.recordOverrides[0].name, 'Kavi Marlow');
  assert.equal(pres.recordOverrides[0].role, 'speaker');
  assert.equal(pres.recordOverrides[0].treatment, 'asleep');
  assert.match(pres.recordOverrides[0].resolution, /staged per the record/);
  assert.equal(pres.mode, 'recording');
});

test('VER-D22: recording mode stages a live-asleep listener listening; live mode does not', () => {
  const rec = talkActPresentation({
    episode: EP4, event: ev1(), positions: POS, placeLabel: label,
    treatments: { 'Nia Okafor': 'asleep' }, mode: 'recording',
  });
  assert.equal(rec.listeners[0].blocked, false, 'the evidenced listener is staged listening');
  assert.ok(rec.listeners[0].presentation, 'the listening presentation is present');
  assert.equal(rec.listeners[0].clip, GESTURE_CLIPS['gesture-listen'].clip);
  assert.equal(rec.recordOverrides.length, 1);
  assert.equal(rec.recordOverrides[0].role, 'listener');
  const live = talkActPresentation({
    episode: EP4, event: ev1(), positions: POS, placeLabel: label,
    treatments: { 'Nia Okafor': 'asleep' }, mode: 'live',
  });
  assert.equal(live.listeners[0].blocked, true, 'live staging keeps the letter');
  assert.deepEqual(live.recordOverrides, [], 'live mode overrides nothing');
});

test('VER-D22: held and overflow still govern in recording mode — the record\u2019s own facts', () => {
  for (const treatment of ['held', 'overflow']) {
    const pres = talkActPresentation({
      episode: EP4, event: ev1(), positions: POS, placeLabel: label,
      treatments: { 'Kavi Marlow': treatment }, mode: 'recording',
    });
    assert.equal(pres.suppressed, true, `${treatment} suppresses a recording too`);
    assert.equal(pres.suppressedBy.treatment, treatment);
    assert.equal(pres.bubble, null);
  }
  const listener = talkActPresentation({
    episode: EP4, event: ev1(), positions: POS, placeLabel: label,
    treatments: { 'Nia Okafor': 'overflow' }, mode: 'recording',
  });
  assert.equal(listener.listeners[0].blocked, true, 'a rail listener is not embodied into a recording');
});

test('the mode must be named: omitting it, or naming anything else, is a caller error', () => {
  assert.throws(
    () => talkActPresentation({ episode: EP4, event: ev1(), positions: POS, placeLabel: label }),
    TypeError, 'no silent default — a live surface must not inherit recording behaviour',
  );
  assert.throws(
    () => talkActPresentation({ episode: EP4, event: ev1(), positions: POS, placeLabel: label, mode: 'replay' }),
    TypeError,
  );
});

test('a mismatched event is refused, and the model mutates nothing it is handed', () => {
  const ev = ev1();
  const wrong = { ...ev, speaker: 'Nia Okafor' }; // event 1 is Kavi's step
  assert.equal(talkActPresentation({ episode: EP4, event: wrong, positions: POS, placeLabel: label, mode: 'recording' }), null,
    'words are never presented under the wrong speaker');
  const posBefore = JSON.parse(JSON.stringify(POS));
  const evBefore = { ...ev };
  talkActPresentation({ episode: EP4, event: ev, positions: POS, placeLabel: label, treatments: { 'Nia Okafor': 'held' }, mode: 'recording' });
  assert.deepEqual(POS, posBefore, 'positions are read for facing, never written — talk does not move figures');
  assert.deepEqual(ev, evBefore, 'the event is not mutated');
});

test('G-J1 round 3: suspendSleep names exactly the staged participants the record overrode from asleep', () => {
  const both = talkActPresentation({
    episode: EP4, event: ev1(), positions: POS, placeLabel: label,
    treatments: { 'Kavi Marlow': 'asleep', 'Nia Okafor': 'asleep' }, mode: 'recording',
  });
  assert.deepEqual([...both.suspendSleep].sort(), ['Kavi Marlow', 'Nia Okafor'],
    'the live-asleep speaker and listener are both suspended for the act');
  const awake = talkActPresentation({ episode: EP4, event: ev1(), positions: POS, placeLabel: label, mode: 'recording' });
  assert.deepEqual(awake.suspendSleep, [], 'no asleep treatments, no suspension');
  const live = talkActPresentation({
    episode: EP4, event: ev1(), positions: POS, placeLabel: label,
    treatments: { 'Kavi Marlow': 'asleep' }, mode: 'live',
  });
  assert.deepEqual(live.suspendSleep, [], 'live mode never suspends (and the act is suppressed there anyway)');
});
