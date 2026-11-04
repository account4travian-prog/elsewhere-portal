/* M4.17 — freeze conformance: at a named bundle head the 3D scene
   and the 2D fallback present the same WorldData, schedule,
   captions, ticker, roster and inspector — {ok: true, diffs: []} —
   and the harness PROVES it can see a difference (positive control:
   a planted diff must be reported). Plus the WebGL-off gate: the 2D
   surface loads and completes a follow journey.
   Run per file: node --test test/conformance.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { runConformance, talkModel2D, talkModel3D } from '../conformance.mjs';
import { selectSurface, runFallbackFollow } from '../../app/surface-select.mjs';

const LAYOUT = JSON.parse(readFileSync(new URL('../../shared/ember-layout.json', import.meta.url), 'utf8'));
const BUNDLE = JSON.parse(readFileSync(new URL('../../data/feed/world-data.json', import.meta.url), 'utf8'));
const MANIFEST = JSON.parse(readFileSync(new URL('../../data/feed/manifest.json', import.meta.url), 'utf8'));
const DEMO = JSON.parse(readFileSync(new URL('../../fixtures/demo-journey.json', import.meta.url), 'utf8'));
const HEAD = { bundleSeq: MANIFEST.bundleSeq, worlddataHash: MANIFEST.worlddataHash };

test(`conformance at the named live bundle head (seq ${HEAD.bundleSeq})`, () => {
  const res = runConformance({ bundle: BUNDLE, layout: LAYOUT, demoSpec: DEMO, bundleHead: HEAD });
  assert.deepEqual(res.bundleHead, HEAD);
  assert.deepEqual(res.diffs, [], `surfaces diverge at seq ${HEAD.bundleSeq}`);
  assert.equal(res.ok, true);
});

test('positive control: a planted caption diff is caught and named', () => {
  const res = runConformance({
    bundle: BUNDLE, layout: LAYOUT, demoSpec: DEMO, bundleHead: HEAD,
    mutate3D: (m) => {
      const key = Object.keys(m.captions)[0];
      m.captions[key] = 'A planted lie about where this citizen is.';
    },
  });
  assert.equal(res.ok, false);
  assert.ok(res.diffs.some((d) => d.path.startsWith('surface.captions.')), JSON.stringify(res.diffs));
});

test('positive control: a planted position diff (a 3D transform slip) is caught', () => {
  const res = runConformance({
    bundle: BUNDLE, layout: LAYOUT, demoSpec: DEMO, bundleHead: HEAD,
    mutate3D: (m) => {
      const key = Object.keys(m.positions)[0];
      m.positions[key] = { ...m.positions[key], x: m.positions[key].x + 1 };
    },
  });
  assert.equal(res.ok, false);
  assert.ok(res.diffs.some((d) => d.path.startsWith('surface.positions.')));
});

test('talk axis: both surfaces present the same act identically (state, icon, caption, words)', () => {
  const res = runConformance({ bundle: BUNDLE, layout: LAYOUT, demoSpec: DEMO, bundleHead: HEAD });
  assert.equal(res.ok, true, JSON.stringify(res.diffs));
  // The axis is really populated — a null talk model on both sides
  // would "agree" vacuously, so pin the model's own contents too.
  const t2 = talkModel2D(LAYOUT, BUNDLE);
  const t3 = talkModel3D(LAYOUT, BUNDLE);
  assert.deepEqual(t3, t2);
  assert.equal(t2.suppressed, false);
  assert.equal(t2.speaker.name, 'Kavi Marlow');
  assert.equal(t2.speaker.state, 'talking');
  assert.equal(t2.speaker.icon.id, 'speech-bubble');
  assert.equal(t2.speaker.caption, 'Kavi Marlow is talking at Plaza of Unity.');
  assert.equal(t2.speaker.clip, 'gesture-talk');
  assert.equal(t2.listeners.length, 1);
  assert.equal(t2.listeners[0].state, 'listening');
  assert.equal(t2.listeners[0].clip, 'gesture-listen');
  assert.equal(t2.listeners[0].caption, 'Nia Okafor is listening to Kavi Marlow at Plaza of Unity.');
  assert.ok(t2.words.text.includes('the roads first, then the hall'), 'the recorded words ride the axis byte-equal');
  assert.equal(t2.words.header, 'Kavi Marlow, 2 Nov 2026, 10:01 UTC:', 'the dated K1 header (G-J1 round 3)');
  // G-J1 ROUND 3 (2026-11-03): the overlay's words are byte-equal
  // to the PANEL's words for the same act — the panel producer
  // (fencedSpeech over the playback step) rides the axis as
  // panelText, and the fixture's said carries the CONF transport
  // fence, so the equality also proves the strip on both paths:
  // panelText is the words with no fence pattern anywhere.
  assert.equal(t2.panelText, 'Morning, Nia — the roads first, then the hall.');
  assert.equal(t2.words.text, t2.panelText, '2D presented words are byte-equal to the panel’s');
  assert.equal(t3.words.text, t3.panelText, '3D overlay words are byte-equal to the panel’s');
  assert.ok(!/<<\/?ELSEWHERE_UNTRUSTED_/.test(t2.words.text), 'no fence pattern in the presented words');
  assert.ok(!/<<\/?ELSEWHERE_UNTRUSTED_/.test(t2.panelText), 'no fence pattern in the panel words');
});

test('positive control: a planted talk panel-words diff is caught and named (G-J1 round 3)', () => {
  const res = runConformance({
    bundle: BUNDLE, layout: LAYOUT, demoSpec: DEMO, bundleHead: HEAD,
    mutate3D: (m) => { m.talk.panelText = 'Planted panel words.'; },
  });
  assert.equal(res.ok, false);
  assert.ok(res.diffs.some((d) => d.path === 'surface.talk.panelText'), JSON.stringify(res.diffs));
});

test('positive control: a planted talk caption diff is caught and named', () => {
  const res = runConformance({
    bundle: BUNDLE, layout: LAYOUT, demoSpec: DEMO, bundleHead: HEAD,
    mutate3D: (m) => { m.talk.speaker.caption = 'A planted paraphrase of the act.'; },
  });
  assert.equal(res.ok, false);
  assert.ok(res.diffs.some((d) => d.path.startsWith('surface.talk.')), JSON.stringify(res.diffs));
});

test('positive control: a planted talk words diff is caught and named', () => {
  const res = runConformance({
    bundle: BUNDLE, layout: LAYOUT, demoSpec: DEMO, bundleHead: HEAD,
    mutate3D: (m) => { m.talk.words.text = 'Planted words the record never held.'; },
  });
  assert.equal(res.ok, false);
  assert.ok(res.diffs.some((d) => d.path === 'surface.talk.words.text'), JSON.stringify(res.diffs));
});

test('WebGL off: selection falls back to the full 2D surface', () => {
  assert.equal(selectSurface({ webglAvailable: false }).surface, 'app2d');
  assert.equal(selectSurface({ webglAvailable: true }).surface, 'scene3d');
  assert.equal(selectSurface({ webglAvailable: true, lowPower: true }).surface, 'app2d');
});

test('WebGL off: the 2D surface completes a follow journey, arriving on schedule', () => {
  const sel = selectSurface({ webglAvailable: false });
  assert.equal(sel.surface, 'app2d');
  const res = runFallbackFollow({ layout: LAYOUT, spec: DEMO });
  assert.equal(res.arrivedCode, 'EMBER_COLLEGE');
  assert.equal(res.finalPosition.between, null, 'arrival is AT the place, not between places');
  assert.ok(res.samples > 10, 'the journey was walked, not jumped');
});
