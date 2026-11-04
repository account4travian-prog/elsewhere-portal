// OM15-C1 — the world-clock watch (my Hark's M3-exit condition 1).
// The badge's age rule measures Portal's fetching; Hark's case is an
// upstream serving frozen world state under fresh fetches, which that
// rule calls LIVE. These tests pin the second clock: the world's own
// (bundle world.worldHour/season/year — the world server's calendar,
// copied by the deriver from its overview payload), watched across
// successive LIVE bundle loads. The freeze rule is two-legged (>= 2
// successive live bundles with the same world clock AND that clock
// unchanged for longer than the 90 s LIVE window), so one bundle, or
// a quiet minute, can never trip it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  badgeFor,
  worldClockKeyOf,
  createWorldClockWatch,
  observeWorldClock,
  worldClockFrozen,
  worldFrozenSinceUtc,
  WORLD_CLOCK_FROZEN_MS,
  installClock,
  resetClock,
} from '../logic.mjs';

const T0 = Date.parse('2026-11-03T02:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

/** A minimal bundle carrying a world clock, as the frozen v2 shape does. */
const bundleAt = (worldHour, { season = 'SPRING', year = 46, bookId = 'world-001', fetchedMs = T0 } = {}) => ({
  schema: 'portal.world-data/v2',
  bundleSeq: 1,
  newestFetchUtc: iso(fetchedMs),
  dataAgeSeconds: 5,
  world: { bookId, facts: null, integritySource: 'none-in-tier-p', season, sky: 'OVERCAST', worldHour, year },
  citizens: [],
  ember: { works: [], plots: [] },
});

// ---------------------------------------------------------- clock key

test('worldClockKeyOf: reads the bundle world block (the world server calendar)', () => {
  assert.equal(typeof worldClockKeyOf(bundleAt(10)), 'string');
  assert.notEqual(worldClockKeyOf(bundleAt(10)), worldClockKeyOf(bundleAt(11)));
  assert.notEqual(worldClockKeyOf(bundleAt(10)), worldClockKeyOf(bundleAt(10, { season: 'WINTER' })));
  assert.notEqual(worldClockKeyOf(bundleAt(10)), worldClockKeyOf(bundleAt(10, { year: 47 })));
});

test('worldClockKeyOf: null when the bundle carries no readable world clock', () => {
  assert.equal(worldClockKeyOf(bundleAt(null)), null);
  assert.equal(worldClockKeyOf({ schema: 'portal.world-data/v1', citizens: [] }), null);
  assert.equal(worldClockKeyOf(null), null);
  // The shipped v1 sample fixture: its world block is all nulls.
  assert.equal(worldClockKeyOf({ world: { season: null, sky: null, worldHour: null, year: null } }), null);
});

// ------------------------------------------------------------- the watch

test('watch: a single bundle can never prove a frozen world', () => {
  let w = createWorldClockWatch();
  w = observeWorldClock(w, bundleAt(10), T0);
  assert.equal(w.loads, 1);
  assert.equal(worldClockFrozen(w, T0 + 3_600_000), false);
});

test('watch: two successive bundles, same clock, wall past the LIVE window => frozen', () => {
  let w = createWorldClockWatch();
  w = observeWorldClock(w, bundleAt(10), T0);
  w = observeWorldClock(w, bundleAt(10, { fetchedMs: T0 + 60_000 }), T0 + 60_000);
  assert.equal(w.loads, 2);
  assert.equal(worldClockFrozen(w, T0 + WORLD_CLOCK_FROZEN_MS), false); // boundary: not yet
  assert.equal(worldClockFrozen(w, T0 + WORLD_CLOCK_FROZEN_MS + 1), true);
  assert.equal(worldFrozenSinceUtc(w), iso(T0));
});

test('watch: a quiet minute does not false-positive (both legs are required)', () => {
  let w = createWorldClockWatch();
  w = observeWorldClock(w, bundleAt(10), T0);
  w = observeWorldClock(w, bundleAt(10), T0 + 20_000);
  // Two loads, same clock — but only 50 s of wall time has passed.
  assert.equal(worldClockFrozen(w, T0 + 50_000), false);
});

test('watch: an advancing world clock restarts the run and never freezes', () => {
  let w = createWorldClockWatch();
  w = observeWorldClock(w, bundleAt(10), T0);
  w = observeWorldClock(w, bundleAt(12), T0 + 60_000); // +2 world hours, the observed live rate
  assert.equal(w.loads, 1);
  assert.equal(w.firstSeenMs, T0 + 60_000);
  assert.equal(worldClockFrozen(w, T0 + 60_000 + WORLD_CLOCK_FROZEN_MS + 1), false);
});

test('watch: a new world book restarts the watch (not a frozen old world)', () => {
  let w = createWorldClockWatch();
  w = observeWorldClock(w, bundleAt(10), T0);
  w = observeWorldClock(w, bundleAt(10, { bookId: 'world-002' }), T0 + 60_000);
  assert.equal(w.loads, 1);
  assert.equal(worldClockFrozen(w, T0 + 60_000 + WORLD_CLOCK_FROZEN_MS + 1), false);
});

test('watch: bundles with no world clock are not observed at all', () => {
  let w = createWorldClockWatch();
  w = observeWorldClock(w, bundleAt(null), T0);
  w = observeWorldClock(w, { citizens: [] }, T0 + 60_000);
  assert.equal(w.loads, 0);
  assert.equal(worldClockFrozen(w, T0 + 3_600_000), false);
});

// ------------------------------------------------- badge composition

test('badge: frozen world + fresh fetch age is STALE, with its own wording', () => {
  installClock(() => T0 + 120_000);
  try {
    const b = badgeFor({ dataAgeSeconds: 5, worldFrozen: true, worldFrozenSinceUtc: iso(T0) });
    assert.equal(b.key, 'STALE');
    assert.match(b.detail, /world's clock has not moved/);
    assert.match(b.detail, /2 minutes ago/);
    assert.match(b.detail, /last state Portal received/);
    // Distinct from the other two STALE wordings — not merged.
    assert.doesNotMatch(b.detail, /stopped updating/);
    assert.notEqual(b.detail, 'Showing what Portal last knew.');
  } finally {
    resetClock();
  }
});

test('badge: frozen world without a since stamp still names the frozen clock', () => {
  const b = badgeFor({ dataAgeSeconds: 5, worldFrozen: true });
  assert.equal(b.key, 'STALE');
  assert.match(b.detail, /world's clock has not moved/);
});

test('badge: REPLAY outranks the frozen world; the stall outranks both', () => {
  assert.equal(badgeFor({ dataAgeSeconds: 5, worldFrozen: true, replaying: true }).key, 'REPLAY');
  const stalled = badgeFor({ dataAgeSeconds: 5, worldFrozen: true, stalled: true });
  assert.equal(stalled.key, 'STALE');
  assert.match(stalled.detail, /stopped updating/);
  assert.equal(badgeFor({ dataAgeSeconds: 5, worldFrozen: true, loading: true }).key, 'LOADING');
});

test('badge: fallback keeps its own STALE wording (the watch never sees recordings)', () => {
  const b = badgeFor({ dataAgeSeconds: 5, isFallback: true, worldFrozen: true, worldFrozenSinceUtc: iso(T0) });
  assert.equal(b.key, 'STALE');
  assert.equal(b.detail, 'Showing what Portal last knew.');
});

test('badge: no freeze, fresh age — LIVE as before (regression)', () => {
  assert.equal(badgeFor({ dataAgeSeconds: 5, worldFrozen: false }).key, 'LIVE');
  assert.equal(badgeFor({ dataAgeSeconds: 5 }).key, 'LIVE');
});

// --------------------------------------- Hark's fixture, end to end

test("Hark's fixture: fresh fetches of a frozen world badge STALE; an advancing world stays LIVE", () => {
  // Successive bundles arrive with FRESH fetch stamps (age 5 s) but
  // the SAME world clock — the cached-upstream case from the audit.
  let w = createWorldClockWatch();
  w = observeWorldClock(w, bundleAt(10, { fetchedMs: T0 }), T0);
  w = observeWorldClock(w, bundleAt(10, { fetchedMs: T0 + 55_000 }), T0 + 55_000);
  const frozen = worldClockFrozen(w, T0 + 100_000);
  assert.equal(frozen, true);
  assert.equal(badgeFor({ dataAgeSeconds: 5, worldFrozen: frozen }).key, 'STALE');

  // The same wall time with the world clock advancing between loads.
  let w2 = createWorldClockWatch();
  w2 = observeWorldClock(w2, bundleAt(10, { fetchedMs: T0 }), T0);
  w2 = observeWorldClock(w2, bundleAt(13, { fetchedMs: T0 + 55_000 }), T0 + 55_000);
  const frozen2 = worldClockFrozen(w2, T0 + 100_000);
  assert.equal(frozen2, false);
  assert.equal(badgeFor({ dataAgeSeconds: 5, worldFrozen: frozen2 }).key, 'LIVE');
});

// ------------------------------------------------------------ app wiring

test('app.js wiring: the watch is fed on live loads and read at badge time (source pin)', () => {
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(src, /observeWorldClock\(state\.worldWatch, picked\.data, nowMs\(\)\)/);
  assert.match(src, /worldClockFrozen\(state\.worldWatch, nowMs\(\)\)/);
});
