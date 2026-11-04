/* M5 consumption — the 3D scene's talk state (talk-state.mjs):
   the recorded episodes schedule through the shared scheduler
   (record order; a shared figure serialises), the act at any
   playback instant resolves through the ONE consumption model
   (talkActPresentation — the same object the 2D surfaces render),
   town altitude collapses, treatment conflicts suppress in LIVE
   mode (the letter's positive control), and in RECORDING mode
   the record governs (VER-D22: a live-asleep speaker is staged
   speaking; held/overflow still suppress). Talk never moves a
   figure (positions are inputs, read for facing, and come out
   byte-identical). Every call names its mode — sceneTalkAct
   throws without one.
   Run per file: node --test test/talk-state.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTalkTimeline, talkEventAt, sceneTalkAct, talkPanelPlacement, recordedActPositions } from '../talk-state.mjs';
import { talkActPresentation, scheduleTalkScene, stripRecordFence } from '../../../app/logic.mjs';

const FENCE = (s) => `<<ELSEWHERE_UNTRUSTED_TEST>>${s}<</ELSEWHERE_UNTRUSTED_TEST>>`;
const ep = (place, rows) => ({
  place, firstUtc: rows[0][0], lastUtc: rows[rows.length - 1][0],
  participants: [...new Set(rows.map((r) => r[1]))],
  disclosure: 'd', utteranceCount: rows.length,
  utterances: rows.map(([at, by, said]) => ({ at, by, said: FENCE(said) })),
});
const A = ep('EMBER_COLLEGE', [
  ['2026-11-02T09:00:00Z', 'Atlas Meridian', 'We begin.'],
  ['2026-11-02T09:02:00Z', 'Nia Okafor', 'A question.'],
]);
const B = ep('EMBER_PLAZA_OF_UNITY', [
  ['2026-11-02T09:01:00Z', 'Atlas Meridian', 'Out here now.'],
  ['2026-11-02T09:03:00Z', 'Kavi Marlow', 'There you are.'],
]);
const POS = { 'Atlas Meridian': { x: 6, y: 2 }, 'Nia Okafor': { x: 5, y: 2 }, 'Kavi Marlow': { x: 4, y: 4 } };
const label = (code) => ({ EMBER_COLLEGE: 'the College', EMBER_PLAZA_OF_UNITY: 'the Plaza of Unity' })[code] || code;

test('the timeline schedules in record order and serialises a shared figure', () => {
  const tl = buildTalkTimeline([B, A]); // input order must not matter
  assert.equal(tl.scenes.length, 2);
  assert.equal(tl.scenes[0].placeCode, 'EMBER_COLLEGE', 'the earlier-recorded scene plays first');
  assert.ok(tl.scenes[1].startMs >= tl.scenes[0].endMs, 'Atlas is never speaking in two scenes at once');
  assert.equal(tl.endMs, tl.scenes[1].endMs);
  const wordless = { place: 'EMBER_COLLEGE', firstUtc: '2026-11-02T07:00:00Z', participants: [], utteranceCount: 0 };
  const tl2 = buildTalkTimeline([wordless, A]);
  assert.equal(tl2.scenes.length, 1);
  assert.deepEqual(tl2.skipped, ['EMBER_COLLEGE|2026-11-02T07:00:00Z'], 'wordless episodes schedule nothing and are named');
});

test('talkEventAt finds the act on stage, and the gaps stage nothing', () => {
  const tl = buildTalkTimeline([A]);
  const hit = talkEventAt(tl, 1);
  assert.equal(hit.event.speaker, 'Atlas Meridian');
  assert.equal(hit.episode, A, 'the words resolve back to the episode');
  assert.equal(talkEventAt(tl, tl.endMs + 1000), null, 'after the programme, no talk');
  assert.equal(talkEventAt(tl, -5), null);
  const two = buildTalkTimeline([A, B]);
  const gapAt = two.scenes[0].endMs + 1;
  if (gapAt < two.scenes[1].startMs) assert.equal(talkEventAt(two, gapAt), null, 'between scenes, no talk is staged');
});

test('sceneTalkAct is the consumption model\u2019s own object — identical to the 2D call', () => {
  const tl = buildTalkTimeline([A]);
  const ev = tl.scenes[0].events[1]; // Nia speaks, Atlas listens
  // The speaker is asleep in the live snapshot on BOTH paths:
  // recording mode (VER-D22) stages her per the record, and the
  // two paths must still agree field for field.
  const treatments = { 'Nia Okafor': 'asleep' };
  const viaScene = sceneTalkAct({ timeline: tl, elapsedMs: ev.startMs + 1, positionsByName: POS, placeLabel: label, treatments, mode: 'recording' });
  const viaModel = talkActPresentation({ episode: A, event: scheduleTalkScene(A, { mode: 'recording' }).events[1], positions: POS, placeLabel: label, treatments, mode: 'recording' });
  assert.equal(viaScene.speaker.name, 'Nia Okafor');
  assert.equal(viaScene.suppressed, false, 'recording mode stages the live-asleep speaker');
  assert.deepEqual(
    {
      speaker: viaScene.speaker, listeners: viaScene.listeners, bubble: viaScene.bubble,
      collapsed: viaScene.collapsed, conflicts: viaScene.conflicts, suppressed: viaScene.suppressed,
      recordOverrides: viaScene.recordOverrides, mode: viaScene.mode,
    },
    {
      speaker: viaModel.speaker, listeners: viaModel.listeners, bubble: viaModel.bubble,
      collapsed: viaModel.collapsed, conflicts: viaModel.conflicts, suppressed: viaModel.suppressed,
      recordOverrides: viaModel.recordOverrides, mode: viaModel.mode,
    },
    'the 3D path and the 2D path present the same act, field for field',
  );
  assert.equal(viaScene.speaker.clip, 'gesture-talk');
  assert.equal(viaScene.listeners[0].clip, 'gesture-listen');
  assert.equal(viaScene.disclosure, 'd', 'the scene carries the episode disclosure for its overlay');
});

test('town altitude through the scene path: icon + caption, no bubble', () => {
  const tl = buildTalkTimeline([A]);
  const pres = sceneTalkAct({ timeline: tl, elapsedMs: 1, positionsByName: POS, placeLabel: label, altitude: 'town', mode: 'recording' });
  assert.equal(pres.bubble, null);
  assert.equal(pres.collapsed.mode, 'icon-caption');
  assert.equal(pres.collapsed.caption, 'Atlas Meridian is talking at the College.');
});

test('conflicts through the scene path, LIVE mode: a sleeping speaker is not staged talking', () => {
  // The consumption model's letter, kept intact as the positive
  // control (VER-D22 changed recording playback only).
  const tl = buildTalkTimeline([A]);
  const pres = sceneTalkAct({
    timeline: tl, elapsedMs: 1, positionsByName: POS, placeLabel: label,
    treatments: { 'Atlas Meridian': 'asleep' }, mode: 'live',
  });
  assert.equal(pres.suppressed, true);
  assert.equal(pres.bubble, null);
  const rail = sceneTalkAct({
    timeline: tl, elapsedMs: 1, positionsByName: POS, placeLabel: label,
    treatments: { 'Atlas Meridian': 'overflow' }, mode: 'live',
  });
  assert.equal(rail.suppressed, true, 'a roster-rail figure is not embodied into talk');
});

test('VER-D22 regression through the scene path: recording mode stages a live-asleep speaker', () => {
  // The defect's exact shape (VER shift 15): every placed citizen
  // asleep in the live bundle — the speaker included — and the
  // recorded playback staged no speech at all. Under the project owner's
  // ruling the record governs: Atlas spoke, so Atlas is staged.
  const tl = buildTalkTimeline([A]);
  const pres = sceneTalkAct({
    timeline: tl, elapsedMs: 1, positionsByName: POS, placeLabel: label,
    treatments: { 'Atlas Meridian': 'asleep', 'Nia Okafor': 'asleep' }, mode: 'recording',
  });
  assert.equal(pres.suppressed, false);
  assert.equal(pres.speaker.name, 'Atlas Meridian');
  assert.equal(pres.speaker.clip, 'gesture-talk', 'the talk gesture plays');
  assert.ok(pres.bubble, 'the bubble renders in recording mode');
  // DELIBERATE RE-PIN (G-J1 round 3): the bubble's text is the
  // record's words with the transport fence stripped at
  // presentation — the model's events still carry the said
  // verbatim, markers included.
  assert.equal(pres.bubble.text, stripRecordFence(A.utterances[0].said), 'the recorded words, byte-equal inside the fence');
  assert.equal(pres.bubble.text, 'We begin.');
  assert.equal(pres.listeners[0].blocked, false, 'the live-asleep listener is staged listening too');
  assert.equal(pres.listeners[0].clip, 'gesture-listen');
  assert.equal(pres.recordOverrides.length, 2, 'both set-asides are reported');
  assert.deepEqual(pres.conflicts, []);
  const held = sceneTalkAct({
    timeline: tl, elapsedMs: 1, positionsByName: POS, placeLabel: label,
    treatments: { 'Atlas Meridian': 'held' }, mode: 'recording',
  });
  assert.equal(held.suppressed, true, 'a disputed place still suppresses a recording');
  assert.throws(
    () => sceneTalkAct({ timeline: tl, elapsedMs: 1, positionsByName: POS, placeLabel: label }),
    TypeError, 'sceneTalkAct names no default mode either',
  );
});

test('talk never moves a figure: positions come out byte-identical, at every instant', () => {
  const tl = buildTalkTimeline([A, B]);
  const before = JSON.stringify(POS);
  for (let t = 0; t <= tl.endMs; t += 250) {
    sceneTalkAct({ timeline: tl, elapsedMs: t, positionsByName: POS, placeLabel: label, mode: 'recording' });
  }
  assert.equal(JSON.stringify(POS), before);
  const pres = sceneTalkAct({ timeline: tl, elapsedMs: 1, positionsByName: POS, placeLabel: label, mode: 'recording' });
  assert.ok(!('position' in pres.speaker) && !('x' in pres.speaker), 'the act carries facing points, never a position to move to');
  assert.deepEqual(pres.speaker.facesPoint, { x: 5, y: 2 }, 'facing is a direction, in place');
});

test('G-J1 round 3: sleep suspension rides the scene path — participants named, live mode and non-participants untouched', () => {
  const tl = buildTalkTimeline([A]);
  // Both participants asleep in the live snapshot; Kavi Marlow is
  // asleep too but is not in this episode's act.
  const pres = sceneTalkAct({
    timeline: tl, elapsedMs: 1, positionsByName: POS, placeLabel: label,
    treatments: { 'Atlas Meridian': 'asleep', 'Nia Okafor': 'asleep', 'Kavi Marlow': 'asleep' }, mode: 'recording',
  });
  assert.deepEqual([...pres.suspendSleep].sort(), ['Atlas Meridian', 'Nia Okafor'],
    'speaker and listener are both named for suspension — and only them');
  const live = sceneTalkAct({
    timeline: tl, elapsedMs: 1, positionsByName: POS, placeLabel: label,
    treatments: { 'Nia Okafor': 'asleep' }, mode: 'live',
  });
  assert.deepEqual(live.suspendSleep, [], 'live mode: no suspension, treatments untouched');
  const heldListener = sceneTalkAct({
    timeline: tl, elapsedMs: 1, positionsByName: POS, placeLabel: label,
    treatments: { 'Atlas Meridian': 'asleep', 'Nia Okafor': 'held' }, mode: 'recording',
  });
  assert.deepEqual(heldListener.suspendSleep, ['Atlas Meridian'], 'a blocked listener is not staged and not suspended');
  const suppressed = sceneTalkAct({
    timeline: tl, elapsedMs: 1, positionsByName: POS, placeLabel: label,
    treatments: { 'Atlas Meridian': 'held', 'Nia Okafor': 'asleep' }, mode: 'recording',
  });
  assert.equal(suppressed.suppressed, true);
  assert.deepEqual(suppressed.suspendSleep, [], 'a suppressed act stages nothing and suspends nothing');
});

// ------------------------------------- G-J1 round 4 (Hark's R3 audit)
// The speech panel's figure-refusal: the panel never covers the
// speaker's projected rect. Round 3's talk frame evidenced nobody
// talking — the panel sat centred on the speaker's head anchor
// over the act. The placement rule is talk-state.mjs's
// talkPanelPlacement (pure); scene.mjs wires the DOM to it.

const panelOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const VP_TALK = { width: 1237, heightPx: 773 };

test('GJ1-R4 panel: the traditional above spot is kept when it covers nobody', () => {
  const speakerRect = { x: 600, y: 304, w: 36, h: 120 };
  const listeners = [{ x: 520, y: 304, w: 36, h: 120 }, { x: 700, y: 304, w: 36, h: 120 }];
  const p = talkPanelPlacement({
    anchor: { x: 618, y: 300 }, panel: { w: 300, h: 240 },
    speakerRect, listenerRects: listeners, viewport: VP_TALK,
  });
  assert.equal(p.rung, 'above');
  assert.deepEqual([p.x, p.y], [468, 60], 'bottom-centre on the anchor, as before');
  assert.equal(p.coversListener, false);
  assert.equal(p.fallback, false);
});

test('GJ1-R4 panel: a speaker whose rect reaches the anchor walks the ladder to below', () => {
  // A tall speaker rect whose top is ABOVE the head anchor (the
  // follow frame's geometry when the panel would sit on the
  // figure): every above/side rung covers the speaker; only
  // below is clear of him.
  const speakerRect = { x: 560, y: 180, w: 80, h: 220 };
  const p = talkPanelPlacement({
    anchor: { x: 600, y: 400 }, panel: { w: 300, h: 180 },
    speakerRect, listenerRects: [], viewport: VP_TALK,
  });
  assert.equal(p.rung, 'below');
  assert.ok(!panelOverlap({ x: p.x, y: p.y, w: 300, h: 180 }, speakerRect), 'the placed panel clears the speaker');
  assert.equal(p.y, 180 + 220 + 8, 'below sits under the speaker’s rect');
});

test('GJ1-R4 panel: listeners are covered only when no offset avoids it', () => {
  const speakerRect = { x: 585, y: 404, w: 30, h: 110 };
  const l1 = { x: 450, y: 220, w: 300, h: 180 }; // roofs the whole above band
  const l2 = { x: 450, y: 522, w: 300, h: 180 }; // and the below spot
  const p = talkPanelPlacement({
    anchor: { x: 600, y: 400 }, panel: { w: 300, h: 180 },
    speakerRect, listenerRects: [l1, l2], viewport: VP_TALK,
  });
  assert.equal(p.rung, 'above', 'the first speaker-clear rung wins, listener cover and all');
  assert.equal(p.coversListener, true, 'the listener cover is reported, not hidden');
  assert.ok(!panelOverlap({ x: p.x, y: p.y, w: 300, h: 180 }, speakerRect), 'the speaker is still never covered');
  // With only l1 present, a listener-clear rung exists (below)
  // and must be preferred over covering l1.
  const q = talkPanelPlacement({
    anchor: { x: 600, y: 400 }, panel: { w: 300, h: 180 },
    speakerRect, listenerRects: [l1], viewport: VP_TALK,
  });
  assert.equal(q.rung, 'below');
  assert.equal(q.coversListener, false);
});

test('GJ1-R5 panel: place labels and plates are refused like figures', () => {
  // Round 4's panel covered The College's label and Lenore's
  // plate (Hark R4, Part 3): labels join the refusal. The above
  // spot is clear of every figure but sits on a label — the
  // ladder must move, and pass 2 must still keep labels clear
  // while it may cover a listener.
  const speakerRect = { x: 585, y: 404, w: 30, h: 110 };
  const labelOnAbove = { x: 450, y: 220, w: 300, h: 180 }; // roofs the above band, like a building label
  const p = talkPanelPlacement({
    anchor: { x: 600, y: 400 }, panel: { w: 300, h: 180 },
    speakerRect, listenerRects: [], labelRects: [labelOnAbove], viewport: VP_TALK,
  });
  assert.equal(p.rung, 'below', 'the label roofs the above band; below is the first fully clear rung');
  assert.equal(p.coversLabel, false);
  assert.equal(p.coversListener, false);
  assert.ok(!panelOverlap({ x: p.x, y: p.y, w: 300, h: 180 }, labelOnAbove));
  // Pass 2: labels roof the above band and the below spot; the
  // right rung covers the speaker; a listener stands in the
  // left rung. The panel takes the left rung covering the
  // listener — labels stay clear, the listener cover reported.
  const q = talkPanelPlacement({
    anchor: { x: 600, y: 400 }, panel: { w: 300, h: 120 },
    speakerRect: { x: 596, y: 404, w: 28, h: 110 },
    listenerRects: [{ x: 350, y: 360, w: 36, h: 100 }],
    labelRects: [{ x: 450, y: 280, w: 300, h: 60 }, { x: 450, y: 522, w: 300, h: 60 }],
    viewport: VP_TALK,
  });
  assert.equal(q.rung, 'left');
  assert.equal(q.coversListener, true, 'the listener cover is reported');
  assert.equal(q.coversLabel, false, 'labels are never covered outside the flagged fallback');
});

test('GJ1-R5 panel: the fallback reports a label cover it cannot avoid', () => {
  const p = talkPanelPlacement({
    anchor: { x: 400, y: 300 }, panel: { w: 800, h: 700 },
    speakerRect: { x: 385, y: 300, w: 30, h: 100 },
    listenerRects: [], labelRects: [{ x: 0, y: 0, w: 800, h: 600 }], viewport: { width: 800, heightPx: 600 },
  });
  assert.equal(p.fallback, true);
  assert.equal(p.coversLabel, true, 'a fallback that covers a label says so');
});

// ------------------------------------- G-J1 round 5 (Hark's R4 audit)
// Recorded-act staging: during RECORDED playback the act's
// participants are staged at the episode's recorded place —
// round 4 staged the words on figures at their LIVE places, so
// one act visually happened in three places at once. The
// formation is talk-state.mjs's recordedActPositions; the model
// (facing, clips, suppression) is unchanged and consumes the
// staged positions like any others. Live mode never stages.

const PLACE_POINTS = { EMBER_COLLEGE: { x: 6, y: 2 }, EMBER_PLAZA_OF_UNITY: { x: 4, y: 4 } };
const pointFor = (code) => PLACE_POINTS[code] || null;

test('GJ1-R5 formation: the speaker stands at the place point, listeners fan south', () => {
  const f = recordedActPositions({ point: { x: 4, y: 1 }, speakerName: 'Nath Between', listenerNames: ['Brat Natha', 'Rocky Headlong', 'Atlas Meridian'] });
  assert.deepEqual(f['Nath Between'], { x: 4, y: 1 }, 'the speaker stands at the record’s place');
  assert.deepEqual(f['Brat Natha'], { x: 3.81, y: 1.22 });
  assert.deepEqual(f['Rocky Headlong'], { x: 4, y: 1.17 });
  assert.deepEqual(f['Atlas Meridian'], { x: 4.19, y: 1.22 });
  for (const n of ['Brat Natha', 'Rocky Headlong', 'Atlas Meridian']) {
    assert.ok(f[n].y > f['Nath Between'].y, 'listeners stand south of the speaker, toward the canonical camera');
  }
  assert.deepEqual(recordedActPositions({ point: { x: 4, y: 1 }, speakerName: 'Solo' }), { Solo: { x: 4, y: 1 } }, 'a lone speaker stands at the point alone');
  assert.equal(recordedActPositions({ point: null, speakerName: 'Solo' }), null);
  assert.deepEqual(
    recordedActPositions({ point: { x: 4, y: 1 }, speakerName: 'Nath Between', listenerNames: ['Brat Natha', 'Rocky Headlong', 'Atlas Meridian'] }),
    f, 'the formation is deterministic — same record, same staging, every run');
});

test('GJ1-R5 staging: a recording stages its participants at the act’s recorded place', () => {
  const tl = buildTalkTimeline([A]); // the College act: Atlas speaks first, Nia listens
  const pres = sceneTalkAct({
    timeline: tl, elapsedMs: 1, positionsByName: POS, placeLabel: label,
    treatments: {}, mode: 'recording', placePointFor: pointFor,
  });
  assert.equal(pres.stagedPlace.code, 'EMBER_COLLEGE');
  assert.equal(pres.placeCode, pres.stagedPlace.code, 'the act’s place and the staging’s place are the same code');
  assert.equal(pres.placeLabel, 'the College', 'the panel names the staging’s building');
  assert.deepEqual(pres.stagedPositions, {
    'Atlas Meridian': { x: 6, y: 2 },
    'Nia Okafor': { x: 6, y: 2.17 },
  }, 'speaker at the College point, the one listener fanned south of him');
  // The model’s facing is computed from the STAGED positions:
  // Atlas faces Nia’s staged spot (due south), not her live one.
  assert.deepEqual(pres.speaker.facesPoint, { x: 6, y: 2.17 });
  assert.deepEqual(pres.listeners[0].facesPoint, { x: 6, y: 2 }, 'the listener faces the speaker’s staged spot');
  // The caller’s live positions object is never mutated.
  assert.deepEqual(POS['Atlas Meridian'], { x: 6, y: 2 });
  assert.deepEqual(POS['Nia Okafor'], { x: 5, y: 2 });
});

test('GJ1-R5 staging: live mode, no resolver, and suppression all stage nothing', () => {
  const tl = buildTalkTimeline([A]);
  const live = sceneTalkAct({
    timeline: tl, elapsedMs: 1, positionsByName: POS, placeLabel: label,
    treatments: {}, mode: 'live', placePointFor: pointFor,
  });
  assert.equal(live.stagedPositions, null, 'live mode never stages — live figures stand where the live record puts them');
  assert.equal(live.stagedPlace, null);
  const noResolver = sceneTalkAct({
    timeline: tl, elapsedMs: 1, positionsByName: POS, placeLabel: label,
    treatments: {}, mode: 'recording',
  });
  assert.equal(noResolver.stagedPositions, null, 'without a place resolver the scene keeps the round-4 behaviour');
  assert.deepEqual(noResolver.speaker.facesPoint, { x: 5, y: 2 }, 'facing still reads the live positions');
  const suppressed = sceneTalkAct({
    timeline: tl, elapsedMs: 1, positionsByName: POS, placeLabel: label,
    treatments: { 'Atlas Meridian': 'held' }, mode: 'recording', placePointFor: pointFor,
  });
  assert.equal(suppressed.suppressed, true);
  assert.equal(suppressed.stagedPositions, null, 'a suppressed act stages nobody');
  const blockedListener = sceneTalkAct({
    timeline: tl, elapsedMs: 1, positionsByName: POS, placeLabel: label,
    treatments: { 'Nia Okafor': 'held' }, mode: 'recording', placePointFor: pointFor,
  });
  assert.deepEqual(Object.keys(blockedListener.stagedPositions), ['Atlas Meridian'],
    'a blocked listener is never staged; the speaker still is');
});

test('GJ1-R4 panel: the fallback is flagged when the panel cannot fit clear of the speaker', () => {
  const p = talkPanelPlacement({
    anchor: { x: 400, y: 300 }, panel: { w: 800, h: 700 },
    speakerRect: { x: 385, y: 300, w: 30, h: 100 },
    listenerRects: [], viewport: { width: 800, heightPx: 600 },
  });
  assert.equal(p.fallback, true, 'an oversized panel in a small frame admits its fallback');
  assert.ok(p.x >= 4 && p.y >= 4 && p.x + 800 <= 800 + 4, 'the fallback is still clamped to the frame’s margins as far as it fits');
});

test('GJ1-R5 panel check: scene.mjs carries the act’s staged place into lastPanelCheck', () => {
  // Regression pin for the round-5 Item 2 diagnosis (2026-11-03):
  // sceneTalkAct computed pres.stagedPlace and applyTalkAct staged
  // from it, but placeTalkOverlay built talk.lastPanelCheck WITHOUT
  // a stagedPlace field — so the capture's panel-place sub-condition
  // (panelCheck.stagedPlace.code === the act's place) could never
  // hold in the live page, and the street staged-act frame was
  // unmeetable no matter how long the poll waited (the diagnostic
  // trace: every other sub-condition held together from 382 ms into
  // playback; the key was simply absent). scene.mjs wiring is
  // source-pinned here, the house pattern (treatments.test.mjs);
  // the behavioural proof is the capture itself.
  const sceneSrc = readFileSync(new URL('../scene.mjs', import.meta.url), 'utf8');
  assert.ok(sceneSrc.includes('stagedPlace: pres.stagedPlace || null'),
    'applyTalkAct records the presentation’s staged place into talk.lastStaged');
  assert.ok(sceneSrc.includes('stagedPlace: talk.lastStaged?.stagedPlace ?? null'),
    'placeTalkOverlay carries the staged place into talk.lastPanelCheck');
});

test('GJ1-R5 panel: below-far clears a staged fan that fills the below spot', () => {
  // The seq-654 live geometry (Item 2's re-shoot): the staged
  // act's three listeners fan south of the speaker, so the below
  // spot sits on them; the above band is roofed by the speaker's
  // own plate and neighbouring labels; the side rungs meet the
  // speaker and the fan. The panel must still find a fully clear
  // rung — under the whole formation — rather than report a
  // listener cover. (Appending below-far after below leaves every
  // earlier pass-1 choice untouched; it only converts outcomes
  // that would otherwise fall to pass 2.)
  const speakerRect = { x: 595, y: 182, w: 15, h: 34 };
  const listeners = [
    { x: 566, y: 201, w: 15, h: 34 }, // Brat Natha, fanned west
    { x: 595, y: 197, w: 15, h: 34 }, // Rocky Headlong, centre
    { x: 625, y: 201, w: 15, h: 34 }, // Atlas Meridian, fanned east
  ];
  const labels = [
    { x: 552, y: 135, w: 103, h: 21 }, // the speaker's own plate, in the above band
    { x: 300, y: 110, w: 150, h: 30 }, // a building label roofing above-left
    { x: 700, y: 120, w: 120, h: 40 }, // a plate roofing above-right
  ];
  const p = talkPanelPlacement({
    anchor: { x: 603, y: 175 }, panel: { w: 258, h: 59 },
    speakerRect, listenerRects: listeners, labelRects: labels, viewport: VP_TALK,
  });
  assert.equal(p.rung, 'below-far');
  assert.equal(p.y, 235 + 8, 'below-far sits under the lowest participant rect (the fan’s feet)');
  assert.equal(p.coversListener, false);
  assert.equal(p.coversLabel, false);
  assert.equal(p.fallback, false);
  const box = { x: p.x, y: p.y, w: 258, h: 59 };
  assert.ok(!panelOverlap(box, speakerRect), 'the placed panel clears the speaker');
  for (const l of listeners) assert.ok(!panelOverlap(box, l), 'the placed panel clears every listener');
  for (const l of labels) assert.ok(!panelOverlap(box, l), 'the placed panel clears every label');
});
