// Honesty cluster tests (M4.19, Design I4) — the app surface.
// The cluster: badge (LIVE/STALE/REPLAY/LOADING) + the permanent
// "half a minute behind" line + REPLAY carrying its date range and
// the "Play the recording" wording. Its wording has ONE home —
// logic.mjs's wording table — and both surfaces draw from it: the
// app here, the 3D scene's frame burn-in via scene.mjs's import of
// the same module (the hand-off is pinned at the end of this file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  badgeFor,
  BEHIND_LINE,
  PLAY_RECORDING_LABEL,
  DEMO_BUTTON_LABEL,
  recordingNotice,
  recordingRangeText,
  recordingRangeOf,
} from '../logic.mjs';

const EVENING = { startUtc: '2026-11-01T22:56:00Z', endUtc: '2026-11-01T23:20:00Z' };

test('the behind line is one constant, and the LIVE badge speaks it', () => {
  assert.equal(BEHIND_LINE, 'Half a minute behind the world.');
  assert.equal(badgeFor({ dataAgeSeconds: 0 }).detail, BEHIND_LINE);
});

test('the play wording is the M4.19 wording, one constant deep', () => {
  assert.equal(PLAY_RECORDING_LABEL, '▶ Play the recording');
  assert.equal(DEMO_BUTTON_LABEL, PLAY_RECORDING_LABEL);
});

test('recordingRangeText: same-day, cross-day, and honest nulls', () => {
  assert.equal(recordingRangeText(EVENING), '1 Nov 2026, 22:56–23:20 UTC');
  assert.equal(
    recordingRangeText({ startUtc: '2026-11-01T22:56:00Z', endUtc: '2026-11-02T00:55:00Z' }),
    '1 Nov 2026 22:56 UTC – 2 Nov 2026 00:55 UTC',
  );
  assert.equal(recordingRangeText(null), null);
  assert.equal(recordingRangeText({}), null);
  assert.equal(recordingRangeText({ startUtc: '2026-11-01T23:20:00Z', endUtc: '2026-11-01T22:56:00Z' }), null, 'a reversed range is no range');
  assert.equal(recordingRangeText({ startUtc: 'soon', endUtc: 'later' }), null);
});

test('REPLAY carries its date range when the recording declares one', () => {
  const bare = badgeFor({ replaying: true });
  assert.equal(bare.key, 'REPLAY');
  assert.equal(bare.detail, 'Showing a recording, played back in order. Not live.', 'no declared range, no invented one — the M3.10 detail stands');
  const ranged = badgeFor({ replaying: true, replayRange: EVENING });
  assert.equal(ranged.detail, 'Showing a recording, played back in order. Not live. Recorded 1 Nov 2026, 22:56–23:20 UTC.');
});

test('the recording caption carries the range, additively', () => {
  const demo = recordingNotice({ demoActive: true, range: EVENING });
  assert.equal(demo.caption, "A recording from Portal's test data Recorded 1 Nov 2026, 22:56–23:20 UTC.");
  const sample = recordingNotice({ isFallback: true, range: { startUtc: '2026-11-01T22:56:00Z', endUtc: '2026-11-02T00:55:00Z' } });
  assert.equal(sample.caption, "Sample data — a recording from Portal's test data, not the live town Recorded 1 Nov 2026 22:56 UTC – 2 Nov 2026 00:55 UTC.");
  // Without a range the M3.10 captions stand byte-for-byte.
  assert.equal(recordingNotice({ demoActive: true }).caption, "A recording from Portal's test data");
});

test('recordingRangeOf: the sample bundle declares its own range', () => {
  const sample = JSON.parse(readFileSync(new URL('../fixtures/sample-world-data.json', import.meta.url), 'utf8'));
  assert.deepEqual(recordingRangeOf(sample), { startUtc: '2026-11-01T22:56:00Z', endUtc: '2026-11-02T00:55:00Z' });
  assert.equal(recordingRangeOf(null), null);
  assert.equal(recordingRangeOf({ citizens: [] }), null);
  assert.equal(recordingRangeOf({ citizens: [{ evidenceUtc: '2026-11-01T00:00:00Z' }] }), null, 'one bound is no range');
});

test('the demo fixture declares the recorded evening it replays', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../fixtures/demo-journey.json', import.meta.url), 'utf8'));
  assert.deepEqual(fixture.recordedWindowUtc, { startUtc: '2026-11-01T22:56:00Z', endUtc: '2026-11-01T23:20:00Z' });
  assert.equal(recordingRangeText(fixture.recordedWindowUtc), '1 Nov 2026, 22:56–23:20 UTC');
});

test('hand-off census: the scene draws the cluster from the same home', () => {
  // The 3D frame burn-in is the SCENE SYSTEMS lane's build; this pin
  // proves the shared path exists — scene.mjs already imports the
  // app logic module that owns the cluster's wording.
  const scene = readFileSync(new URL('../../visual/scene/scene.mjs', import.meta.url), 'utf8');
  assert.ok(scene.includes("from '../../app/logic.mjs'"), 'scene.mjs imports the wording home');
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('replayRange:'), 'app.js passes the recording range into the shared badge model');
  assert.ok(app.includes('recordingRangeOf('), 'app.js derives the sample recording\u2019s range from the bundle itself');
});
