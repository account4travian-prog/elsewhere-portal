// Elsewhere Portal — freeze conformance (M4.17, SE-2.7 / SE-4.5).
//
// At a named bundle head, the 3D scene and the 2D fallback must
// present the SAME town: same WorldData, same schedule, same
// captions, same ticker, same roster, same inspector. This harness
// builds each surface's presentation model through that surface's
// OWN code path and diffs them field by field:
//
//   2D (build/app): citizens keyed by logic.citizenKeyOf; positions
//     from logic.citizenPositions; captions, ticker, roster and
//     inspector cards from the logic.mjs HTML builders app.js calls.
//   3D (build/visual/scene): citizens keyed by scene.mjs's own map
//     expression (citizenKey || handle || name); positions from
//     citizenPositions pushed through the scene's grid->world->grid
//     transform (stream-harness's round-trip); captions through the
//     call scene.mjs's picking makes; place labels from the scene's
//     effectiveLayout node set.
//
// The axes are genuinely independent where it matters — identity
// keying (M2.03's PORTAL-KEY discipline) and the 3D transform — so a
// divergence on either surface shows up here as a diff, and the
// positive control in the tests proves the harness reports a planted
// one. Output shape is the item's gate: { ok, diffs }.
//
// The talk axis (added by the SURFACE CONSUMPTION lane) diffs one
// recorded talk act presented through each surface's own consumption
// path — see the talk section below talkExtract.

import {
  citizenKeyOf, citizenPositions, citizenCaption, effectiveLayout,
  tickerListHtml, rosterListHtml, citizenCardHtml,
  scheduleTalkScene, talkActPresentation, talkPlaybackModel, fencedSpeech,
} from '../app/logic.mjs';
import { planJourney } from '../engine/playback.mjs';
import { gridToWorld, worldToGrid } from '../visual/scene/stream-harness.mjs';
import { buildTalkTimeline, sceneTalkAct } from '../visual/scene/talk-state.mjs';

const byKey = (entries) => Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : 1)));

function placeLabeler(layout, bundle) {
  const eff = effectiveLayout(layout, bundle);
  const labels = new Map(eff.nodes.map((n) => [n.code, n.label]));
  return (code) => labels.get(code) || code;
}

// The demo schedule both surfaces replay (build/fixtures/demo-journey.json
// shape): the plan is part of the conformance surface — same journey,
// same steps, same ticks.
export function scheduleModel(spec) {
  const j = planJourney({
    handle: spec.handle, path: spec.path, startTick: spec.startTick, ticksPerStep: spec.ticksPerStep,
  });
  return {
    handle: j.handle, path: j.path, startTick: j.startTick, endTick: j.endTick,
    steps: j.steps.map((s) => ({ from: s.from, to: s.to, worldTicks: s.worldTicks, startTick: s.startTick, endTick: s.endTick })),
  };
}

// ------------------------------------------------------------- talk
// The talk axis (SURFACE CONSUMPTION lane): one recorded act,
// presented by each surface through its OWN consumption path —
//   2D: scheduleTalkScene + talkActPresentation, the exact calls
//     app.js's panel/stage make;
//   3D: buildTalkTimeline + sceneTalkAct, the exact calls scene.mjs
//     makes through talk-state.mjs.
// The staging positions are caller-supplied inputs (identical for
// both, as they are when both surfaces read the same bundle), so
// any diff here is a PRESENTATION divergence: state, icon, caption,
// clip, or the fenced words themselves. Both calls name mode
// 'recording', exactly as the surfaces' playback calls do since
// VER-D22 — the axis compares the playback the user actually gets.
const TALK_FIXTURE = {
  place: 'EMBER_PLAZA_OF_UNITY',
  firstUtc: '2026-11-02T10:00:00Z', lastUtc: '2026-11-02T10:03:00Z',
  participants: ['Nia Okafor', 'Kavi Marlow'],
  disclosure: 'Conformance fixture — recorded words, staged identically on both surfaces.',
  utteranceCount: 3,
  utterances: [
    { at: '2026-11-02T10:00:00Z', by: 'Nia Okafor', said: '<<ELSEWHERE_UNTRUSTED_CONF>>Good morning.<</ELSEWHERE_UNTRUSTED_CONF>>' },
    { at: '2026-11-02T10:01:00Z', by: 'Kavi Marlow', said: '<<ELSEWHERE_UNTRUSTED_CONF>>Morning, Nia — the roads first, then the hall.<</ELSEWHERE_UNTRUSTED_CONF>>' },
    { at: '2026-11-02T10:02:00Z', by: 'Nia Okafor', said: '<<ELSEWHERE_UNTRUSTED_CONF>>Agreed.<</ELSEWHERE_UNTRUSTED_CONF>>' },
  ],
};
const TALK_POSITIONS = { 'Nia Okafor': { x: 4, y: 4 }, 'Kavi Marlow': { x: 5, y: 4 } };
// The act compared: the fixture's second utterance (Kavi speaking,
// Nia the evidenced listener) — speaker AND listener channels are
// both inside the diff.
const TALK_EVENT_INDEX = 1;

function talkExtract(pres, panelText) {
  if (!pres) return null;
  const fig = (f) => (f ? {
    name: f.name, blocked: !!f.blocked, posture: f.posture || null, clip: f.clip,
    state: f.presentation ? f.presentation.state : null,
    icon: f.presentation ? f.presentation.icon : null,
    caption: f.presentation ? f.presentation.caption : null,
    iconAtMs: f.presentation ? f.presentation.iconAtMs : null,
  } : null);
  return {
    suppressed: pres.suppressed,
    speaker: fig(pres.speaker),
    listeners: pres.listeners.map(fig),
    words: pres.bubble ? {
      header: pres.bubble.header, text: pres.bubble.text,
      displayText: pres.bubble.displayText, marker: pres.bubble.marker,
      label: pres.bubble.label, quote: pres.bubble.quote,
    } : null,
    // The PANEL's words for the same act (G-J1 round 3): the
    // Conversations transcript renders fencedSpeech(step).text;
    // the axis carries that text beside the presented bubble so
    // the overlay-vs-panel byte equality is part of the compared
    // model, not an assumption — the tests assert
    // words.text === panelText on both surfaces, and a planted
    // panelText divergence diffs here like any other field.
    panelText,
    collapsed: pres.collapsed ? { mode: pres.collapsed.mode } : null,
    conflicts: pres.conflicts,
  };
}

// The panel transcript's words for the fixture act at `index`:
// talkPlaybackModel's step for that utterance, through
// fencedSpeech — the exact producer app.js's renderTalk consumes.
function panelWordsFor(index) {
  const model = talkPlaybackModel(TALK_FIXTURE);
  const step = model && model.steps[index];
  const fenced = step ? fencedSpeech(step) : null;
  return fenced ? fenced.text : null;
}

export function talkModel2D(layout, bundle) {
  const labelFor = placeLabeler(layout, bundle);
  const scene = scheduleTalkScene(TALK_FIXTURE, { mode: 'recording' });
  const event = scene.events[TALK_EVENT_INDEX];
  return talkExtract(talkActPresentation({
    episode: TALK_FIXTURE, event, positions: TALK_POSITIONS, placeLabel: labelFor,
    mode: 'recording',
  }), panelWordsFor(TALK_EVENT_INDEX));
}

export function talkModel3D(layout, bundle) {
  const labelFor = placeLabeler(layout, bundle);
  const timeline = buildTalkTimeline([TALK_FIXTURE]);
  const event = timeline.scenes[0].events[TALK_EVENT_INDEX];
  return talkExtract(sceneTalkAct({
    timeline, elapsedMs: event.startMs + 1, positionsByName: TALK_POSITIONS, placeLabel: labelFor,
    mode: 'recording',
  }), panelWordsFor(TALK_EVENT_INDEX));
}

export function model2D(bundle, layout, demoSpec) {
  const labelFor = placeLabeler(layout, bundle);
  const positions = byKey([...citizenPositions(bundle, layout)].map(([k, p]) => [k, { x: p.x, y: p.y, code: p.code }]));
  const captions = {};
  const cards = {};
  for (const c of bundle.citizens || []) {
    const key = citizenKeyOf(c);
    captions[key] = citizenCaption(c, labelFor(c.placeCode));
    cards[key] = citizenCardHtml(c, labelFor(c.placeCode));
  }
  return {
    bundleSeq: bundle.bundleSeq,
    schema: bundle.schema,
    positions,
    captions,
    ticker: tickerListHtml(bundle),
    roster: rosterListHtml(bundle, labelFor),
    cards,
    schedule: scheduleModel(demoSpec),
    talk: talkModel2D(layout, bundle),
  };
}

export function model3D(bundle, layout, demoSpec) {
  const labelFor = placeLabeler(layout, bundle);
  // scene.mjs's own keying expression (buildWorld's citizensByKey).
  const citizensByKey = new Map((bundle.citizens || []).map((c) => [c.citizenKey || c.handle || c.name, c]));
  const positions = {};
  for (const [key, p] of citizenPositions(bundle, layout)) {
    if (!citizensByKey.has(key)) continue; // buildWorld skips keys it cannot resolve, exactly so here
    const w = gridToWorld(p.x, p.y);
    const g = worldToGrid(w.x, w.z);
    positions[key] = { x: g.x, y: g.y, code: p.code };
  }
  const captions = {};
  const cards = {};
  for (const [key, c] of citizensByKey) {
    captions[key] = citizenCaption(c, labelFor(c.placeCode));
    cards[key] = citizenCardHtml(c, labelFor(c.placeCode));
  }
  return {
    bundleSeq: bundle.bundleSeq,
    schema: bundle.schema,
    positions: byKey(Object.entries(positions)),
    captions,
    ticker: tickerListHtml(bundle),
    roster: rosterListHtml(bundle, labelFor),
    cards,
    schedule: scheduleModel(demoSpec),
    talk: talkModel3D(layout, bundle),
  };
}

// Numeric tolerance: positions pass through the scene's
// grid->world->grid float transform, whose round-trip is exact only
// to ~1e-15 grid units (found by this harness at its first run:
// 1.43 vs 1.4299999999999997). Diffs compare numbers at 1e-9 grid
// units — a million times tighter than a renderable difference, and
// the planted-diff controls (a full grid unit) still trip it.
const NUM_TOL = 1e-9;

function diffInto(diffs, path, a, b) {
  if (Object.is(a, b)) return;
  if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= NUM_TOL) return;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    diffs.push({ path, app2d: a, scene3d: b });
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!(k in a)) { diffs.push({ path: `${path}.${k}`, app2d: '<absent>', scene3d: b[k] }); continue; }
    if (!(k in b)) { diffs.push({ path: `${path}.${k}`, app2d: a[k], scene3d: '<absent>' }); continue; }
    diffInto(diffs, `${path}.${k}`, a[k], b[k]);
  }
}

// runConformance({ bundle, layout, demoSpec, bundleHead, mutate3D })
// -> { ok, diffs, bundleHead }
// bundleHead names the frozen head the run is against:
// { bundleSeq, worlddataHash }. mutate3D is the positive-control
// seam: a function applied to the 3D model before diffing (tests
// only — production runs never pass it).
export function runConformance({ bundle, layout, demoSpec, bundleHead, mutate3D = null }) {
  const m2 = model2D(bundle, layout, demoSpec);
  const m3 = model3D(bundle, layout, demoSpec);
  if (mutate3D) mutate3D(m3);
  const diffs = [];
  diffInto(diffs, 'surface', m2, m3);
  return { ok: diffs.length === 0, diffs, bundleHead };
}
