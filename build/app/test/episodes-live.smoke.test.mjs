// SMOKE — live episodes feed state (VER rotation 1, 2026-11-03).
//
// This file is NOT part of the deterministic suite and never gates
// it. It reads the REAL generated feed/episodes.json and REPORTS its
// current state as findings (test diagnostics). It exists because
// test/episodes.test.mjs's panel-model test originally asserted a
// live record value — the College episode's `corroborated` flag —
// and drifted when the world's record changed. That assertion is now
// fixture-pinned at full strength in episodes.test.mjs; the live
// state belongs here, stated honestly, whatever it currently is.
//
// Corroboration (data/episodes.mjs): an episode is corroborated when
// a CITY_EVENT_BEGAN headline in the news record matches it; the
// matching headline rides along as `corroboratedBy`.
//
// Run per file: node --test test/episodes-live.smoke.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isEpisodesFeed } from '../logic.mjs';

test('SMOKE (live, non-gating): current episodes feed state, reported as findings', (t) => {
  let feed = null;
  try {
    feed = JSON.parse(
      readFileSync(new URL('../../data/feed/episodes.json', import.meta.url), 'utf8'),
    );
  } catch (err) {
    t.diagnostic(`FINDING: live episodes feed unreadable: ${err.message}`);
    return;
  }
  t.diagnostic(`live feed schema valid (isEpisodesFeed): ${isEpisodesFeed(feed)}`);
  t.diagnostic(`live episodes listed: ${feed.episodes.length}`);
  for (const ep of feed.episodes) {
    t.diagnostic(
      `episode ${ep.place} ${ep.firstUtc}..${ep.lastUtc}: corroborated=${ep.corroborated}` +
      (ep.corroboratedBy ? ` by headline ${ep.corroboratedBy.headlineId} at ${ep.corroboratedBy.at}` : ' (no matching CITY_EVENT_BEGAN headline)'),
    );
  }
  const college = feed.episodes.find((e) => e.place === 'EMBER_COLLEGE');
  if (!college) {
    t.diagnostic('FINDING: the live feed currently lists NO College episode.');
  } else if (college.corroborated !== true) {
    t.diagnostic(
      'FINDING: the live College episode is currently NOT corroborated ' +
      '(no matching CITY_EVENT_BEGAN headline in the current record). ' +
      'This is a property of the live record, not a code failure — the ' +
      'panel model carries the flag faithfully (fixture-pinned in episodes.test.mjs).',
    );
  } else {
    t.diagnostic('live College episode is corroborated, as the original test expected.');
  }
  // Structural sanity only — drift above is reported, never failed.
  assert.ok(Array.isArray(feed.episodes));
});
