// SMOKE — live fetch-log health (VER rotation 1, 2026-11-03).
//
// This file is NOT part of the deterministic suite and never gates
// it. It is the former closing test of test/health.test.mjs ("smoke:
// the real Wave 1 fetch log computes cleanly"), moved here because
// its assertions were live-record values: every route gapStatus 'ok',
// zero errors in the trailing 24 h, not currently in a gap. Tonight's
// archiver incidents (VM reboots, supervisor deaths — see
// build/data/ARCH-LIVE.md) legitimately falsified them; a live
// record doing what live records do is a FINDING, not a code
// failure. The deterministic behaviour of computeHealth /
// parseFetchLog is pinned by the synthetic tests in health.test.mjs.
//
// This smoke computes the same health view over the real log and
// reports every value as a finding (test diagnostics). Structural
// sanity is still asserted (the log parses, the six routes are
// present, the A0 accounting is internally consistent); drift is
// reported, never failed.
//
// Run per file: node --test test/health-live.smoke.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeHealth, parseFetchLog } from '../health.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = ['overview', 'news', 'voices', 'map', 'status', 'chats'];

test('SMOKE (live, non-gating): the real fetch log computes; its state is reported', async (t) => {
  const [logText, cadenceText] = await Promise.all([
    readFile(join(HERE, '..', 'archive', 'fetch-log.jsonl'), 'utf8'),
    readFile(join(HERE, '..', 'cadence.json'), 'utf8'),
  ]);
  const records = parseFetchLog(logText);
  assert.ok(records.length >= 6, 'fetch log parses to records');
  const lastUtc = records.map((r) => Date.parse(r.utc)).sort((a, b) => b - a)[0];
  // "Now" = one minute after the newest record, exactly as the
  // original smoke framed it. (Inter-pass silences in the real log
  // are genuine historical gaps, so no exact gap count is asserted.)
  const h = computeHealth(records, JSON.parse(cadenceText), new Date(lastUtc + 60_000));
  for (const route of ROUTES) {
    const r = h.routes[route];
    assert.ok(r, `route ${route} present in the health view`);
    t.diagnostic(
      `route ${route}: gapStatus=${r.gapStatus} errors24h=${r.errors24h} ` +
      `gaps=${r.gaps.length} lastChangeUtc=${r.lastChangeUtc}`,
    );
    if (r.errors24h > 0) {
      t.diagnostic(
        `FINDING: route ${route} has ${r.errors24h} error(s) in the trailing 24 h of the live log. ` +
        'Expected after archiver incidents; see ARCH-LIVE.md for the incident record.',
      );
    }
    if (r.gapStatus !== 'ok') {
      t.diagnostic(`FINDING: route ${route} gapStatus is '${r.gapStatus}' at the log's current head.`);
    }
    if (!r.lastChangeUtc) {
      t.diagnostic(`FINDING: route ${route} has never recorded a changed body in the live log.`);
    }
  }
  const perRoute = Object.values(h.routes).reduce((sum, r) => sum + r.gaps.length, 0);
  // Internal consistency of the A0 accounting — a code property, so
  // it stays an assertion even here.
  assert.equal(h.a0.unexplainedGapCount, perRoute);
  t.diagnostic(`a0: inGapNow=${h.a0.inGapNow} unexplainedGapCount=${h.a0.unexplainedGapCount}`);
  if (h.a0.inGapNow) {
    t.diagnostic('FINDING: the health view reports the archive as IN A GAP at the log head.');
  }
});
