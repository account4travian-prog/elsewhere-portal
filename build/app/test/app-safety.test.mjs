import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  nowMs,
  installClock,
  resetClock,
  relativeTime,
  badgeFor,
  createFrameGuard,
  guardedFrameStep,
  frameStalled,
  FRAME_FAILURE_STALE_THRESHOLD,
  recordingNotice,
  DEMO_BUTTON_LABEL,
  DEMO_RECORDING_CAPTION,
} from '../logic.mjs';
// The real engine: its positionAt throw on an unknown place code is
// the exact failure M3.09 names.
import { planJourney, positionAt } from '../../engine/playback.mjs';

// ------------------------------------------------------------- clock

test('clock: the default clock is the wall clock', () => {
  resetClock();
  const before = Date.now();
  const v = nowMs();
  const after = Date.now();
  assert.ok(v >= before && v <= after, `nowMs ${v} within [${before}, ${after}]`);
});

test('clock: installClock pins nowMs and every default "now" (relativeTime)', () => {
  const fixed = Date.parse('2026-11-02T12:00:00Z');
  installClock(() => fixed);
  try {
    assert.equal(nowMs(), fixed);
    // relativeTime with no explicit now reads the pinned clock.
    assert.equal(relativeTime('2026-11-02T11:55:00Z'), '5 minutes ago');
    assert.equal(relativeTime('2026-11-02T11:59:30Z'), 'just now');
    // An explicit now still wins over the clock.
    assert.equal(relativeTime('2026-11-02T11:55:00Z', fixed + 3600_000), 'an hour ago');
  } finally {
    resetClock();
  }
  // After reset, the wall clock is back (within a generous tolerance).
  assert.ok(Math.abs(nowMs() - Date.now()) < 5000);
});

test('clock census: app.js carries no Date.now of its own (M3.09, debt 04·D-12)', () => {
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('Date.now'), 'app.js reads "now" only through logic.nowMs');
  const logic = readFileSync(new URL('../logic.mjs', import.meta.url), 'utf8');
  // logic.mjs's own Date.now mentions sit inside the clock section —
  // the section between the clock banner and the badges banner.
  const clockSection = logic.slice(logic.indexOf('---- clock'), logic.indexOf('---- badges'));
  const outside = logic.replace(clockSection, '');
  assert.ok(!outside.includes('Date.now'), 'no Date.now outside the clock section');
  assert.ok(clockSection.includes('Date.now'), 'the clock itself is the wall-clock default');
});

// -------------------------------------------------------- frame guard

const layoutWith = (codes) => ({
  nodes: codes.map((code, i) => ({ code, x: i * 2, y: 0 })),
  edges: codes.slice(1).map((code, i) => ({ a: codes[i], b: code, seconds: 6 })),
});

test('frame guard: a positionAt throw is caught, the render still runs, the next frame recovers', () => {
  // A journey through a place the layout does not know yet — the
  // engine throws, exactly the M3.09 failure. The layout "arrives"
  // (gains the node) before the next frame.
  const liveLayout = layoutWith(['A', 'B']);
  const journey = planJourney({ handle: 'x', path: ['A', 'B', 'C'], startTick: 0, ticksPerStep: 6 });
  const guard = createFrameGuard();
  let renders = 0;
  const step = () => guardedFrameStep(guard, {
    tick: () => { positionAt(journey, liveLayout, 3); },
    render: () => { renders += 1; },
  });

  const first = step();
  assert.equal(first.ok, false);
  assert.equal(first.failures, 1);
  assert.equal(first.stalled, false);
  assert.match(first.error.message, /unknown place code|no route/);
  assert.equal(renders, 1, 'the stage still drew its last good picture on the failed frame');

  liveLayout.nodes.push({ code: 'C', x: 4, y: 0 });
  liveLayout.edges.push({ a: 'B', b: 'C', seconds: 6 });
  const second = step();
  assert.equal(second.ok, true);
  assert.equal(second.failures, 0, 'a clean frame resets the failure count');
  assert.equal(second.stalled, false);
  assert.equal(renders, 2, 'the stage updates again on the next frame');
});

test('frame guard: persistent throws stall — and a stalled stage badges STALE, never LIVE', () => {
  const guard = createFrameGuard();
  const boom = () => { throw new Error('playback: unknown place code NOPE'); };
  let last = null;
  for (let i = 0; i < FRAME_FAILURE_STALE_THRESHOLD; i++) {
    last = guardedFrameStep(guard, { tick: boom, render: () => {} });
  }
  assert.equal(last.ok, false);
  assert.equal(last.failures, FRAME_FAILURE_STALE_THRESHOLD);
  assert.equal(last.stalled, true);
  assert.equal(frameStalled(guard), true);
  // The badge composition app.js performs once stalled: even with
  // perfectly fresh data (age 0) the badge is STALE…
  assert.equal(badgeFor({ dataAgeSeconds: 0, stalled: true }).key, 'STALE');
  assert.match(badgeFor({ dataAgeSeconds: 0, stalled: true }).detail, /stopped updating/);
  // …and even mid-recording: a frozen playback is not playing back.
  assert.equal(badgeFor({ dataAgeSeconds: 0, replaying: true, stalled: true }).key, 'STALE');
  // Before any data exists, LOADING still wins (nothing to be stale about).
  assert.equal(badgeFor({ loading: true, stalled: true }).key, 'LOADING');
  // And a single failure short of the threshold is not a stall.
  const guard2 = createFrameGuard();
  guardedFrameStep(guard2, { tick: boom, render: () => {} });
  assert.equal(frameStalled(guard2), false);
  assert.equal(badgeFor({ dataAgeSeconds: 0, stalled: frameStalled(guard2) }).key, 'LIVE');
});

test('frame guard: a render throw counts too, and the loop-facing step never throws', () => {
  const guard = createFrameGuard();
  let ticked = 0;
  const res = guardedFrameStep(guard, {
    tick: () => { ticked += 1; },
    render: () => { throw new Error('canvas gone'); },
  });
  assert.equal(ticked, 1);
  assert.equal(res.ok, false);
  assert.equal(res.failures, 1);
  assert.equal(res.error.message, 'canvas gone');
  // A step with neither phase is a clean no-op.
  assert.equal(guardedFrameStep(createFrameGuard(), {}).ok, true);
});

test('frame loop census: app.js re-arms requestAnimationFrame BEFORE the guarded body', () => {
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const frameFn = src.slice(src.indexOf('function frame(ts)'), src.indexOf('function advanceDemo'));
  const rearm = frameFn.indexOf('requestAnimationFrame(frame)');
  const body = frameFn.indexOf('guardedFrameStep(frameGuard');
  assert.ok(rearm !== -1 && body !== -1, 'frame() re-arms and runs the guarded step');
  assert.ok(rearm < body, 'the re-arm comes first, so no body throw can kill the loop');
  assert.ok(src.includes('frameStalled(frameGuard)'), 'updateBadge reads the guard for the STALE drop');
});

// ------------------------------------------------- recording (M3.10)

test('recording notice: present iff a recording drives the stage', () => {
  // Live record, no demo: no caption.
  assert.equal(recordingNotice({ demoActive: false, isFallback: false }), null);
  assert.equal(recordingNotice({}), null);
  // The demo: the plan's own caption, under a RECORDING label that is
  // the caption's own — not the badge.
  const demo = recordingNotice({ demoActive: true, isFallback: false });
  assert.equal(demo.label, '● RECORDING');
  assert.equal(demo.caption, "A recording from Portal's test data");
  assert.equal(DEMO_RECORDING_CAPTION, "A recording from Portal's test data");
  // Sample data standing in for the live bundle: also a recording,
  // and the caption says it is not the live town.
  const sample = recordingNotice({ demoActive: false, isFallback: true });
  assert.equal(sample.label, '● RECORDING');
  assert.match(sample.caption, /not the live town/);
  // Both at once (demo over a sample bundle): the demo wording wins.
  assert.equal(recordingNotice({ demoActive: true, isFallback: true }).key, 'demo');
});

test('recording census: the button says the journey is a recording; the caption element exists', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // M4.19 (Design I4) names the cluster's play wording — "Play the
  // recording" — superseding the H6 label this census pinned before;
  // the pin moves deliberately, with the item that moved it.
  assert.equal(DEMO_BUTTON_LABEL, '▶ Play the recording');
  assert.ok(html.includes(`id="play-demo" type="button">${DEMO_BUTTON_LABEL}<`), 'the shipped button carries the renamed label');
  assert.ok(!html.includes('Atlas walks to the College'), 'the old unlabelled button text is gone');
  assert.ok(html.includes('id="recording-note"'), 'the stage carries the recording caption element');
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(src.includes('recordingNotice('), 'app.js renders the notice from the logic model');
});
