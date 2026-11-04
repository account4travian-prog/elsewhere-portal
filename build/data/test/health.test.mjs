// Health-surface tests: synthetic fetch logs only — deterministic,
// no network, no live archive reads. The smoke read of the real
// fetch log that used to live here moved to
// test/health-live.smoke.test.mjs (VER rotation 1, 2026-11-03): it
// asserted live-record values (zero errors in the trailing 24 h, no
// route in a gap) that tonight's archiver incidents legitimately
// falsified; the live state is now reported there as findings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHealth, parseFetchLog } from '../health.mjs';

const CADENCE = { routesSeconds: { overview: 60, status: 60 } };
const T0 = Date.parse('2026-11-02T00:00:00.000Z');
const at = (ms) => new Date(T0 + ms).toISOString();
const ok = (route, ms, snap = true) => ({ route, utc: at(ms), status: 200, sha256: 'x'.repeat(64), ...(snap ? { snapshotId: `snap_${route}_x` } : { unchanged: true }) });
const err = (route, ms) => ({ route, utc: at(ms), status: 'error', bytes: 0, sha256: null, error: 'fetch failed: boom' });

test('healthy route: fresh success, no gaps, A0 null (no gap ever)', () => {
  const records = [ok('overview', 0), ok('overview', 60_000, false), ok('overview', 120_000, false)];
  const h = computeHealth(records, CADENCE, new Date(T0 + 180_000));
  assert.equal(h.routes.overview.gapStatus, 'ok');
  assert.equal(h.routes.overview.lastChangeUtc, at(0)); // only the first was a change
  assert.equal(h.routes.overview.errors24h, 0);
  assert.equal(h.a0.unexplainedGapCount, 0);
  assert.equal(h.a0.inGapNow, false);
  assert.equal(h.a0.hoursSinceLastUnexplainedGap, null);
});

test('a silent stretch past 2x cadence is a gap; A0 counts from its end', () => {
  // successes at 0s and 60s, then silence until 600s, success at 600s, now 660s.
  const records = [ok('overview', 0), ok('overview', 60_000), ok('overview', 600_000)];
  const h = computeHealth(records, CADENCE, new Date(T0 + 660_000));
  assert.equal(h.routes.overview.gaps.length, 1);
  assert.equal(h.routes.overview.gaps[0].ongoing, false);
  assert.equal(h.a0.inGapNow, false);
  assert.equal(h.a0.hoursSinceLastUnexplainedGap, 0.017); // (660-600)s = 60s ≈ 0.017h
});

test('an ongoing silence is reported as IN GAP with A0 = 0', () => {
  const records = [ok('status', 0)];
  const h = computeHealth(records, CADENCE, new Date(T0 + 3600_000));
  assert.equal(h.routes.status.gapStatus, 'gap');
  assert.equal(h.a0.inGapNow, true);
  assert.equal(h.a0.hoursSinceLastUnexplainedGap, 0);
  assert.equal(h.a0.lastGap.ongoing, true);
});

test('errors24h counts only failures inside the trailing 24 h', () => {
  const now = T0 + 48 * 3600_000;
  const records = [err('overview', 0), err('overview', 30 * 3600_000), ok('overview', 47 * 3600_000)];
  const h = computeHealth(records, CADENCE, new Date(now));
  assert.equal(h.routes.overview.errors24h, 1);
  assert.equal(h.routes.overview.attempts, 3);
});

test('a route with attempts but no success is never-succeeded', () => {
  const h = computeHealth([err('overview', 0)], CADENCE, new Date(T0 + 1000));
  assert.equal(h.routes.overview.gapStatus, 'never-succeeded');
  assert.equal(h.routes.overview.lastSuccessUtc, null);
});

test('parseFetchLog skips blank and torn lines', () => {
  const recs = parseFetchLog('{"route":"a"}\n\n{"route":\n{"route":"b"}\n');
  assert.equal(recs.length, 2);
});

// The live-log smoke that closed this file moved to
// test/health-live.smoke.test.mjs (VER rotation 1, 2026-11-03) — see
// the header note. Its computation (parseFetchLog + computeHealth
// over the real log) still runs there on every smoke pass; only the
// gating assertions on live values became findings.
