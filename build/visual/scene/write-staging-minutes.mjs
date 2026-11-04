// Elsewhere Portal — M5.09 minutes producer.
//
// The producer half of the M5.09 → M6.09 seam: a civic theatre
// staging whose talk scene the scheduler capped yields a
// chronicle-summary pointer (counts only — the pointer shape
// carries no words by construction), and this writes such
// pointers, one JSON line each, to the stream the Chronicle
// cycle already consumes: build/data/feed/talk-summaries.jsonl,
// each line {pointer, episodeKey, placeCode, where}.
//
// Append-only and deduped by episodeKey against the lines already
// in the stream: re-running writes nothing twice.
//
// POST-RULING STATE (2026-11-03): the project owner's M5.07 ruling —
// recordings play in full; the 90 s cap governs live scenes
// only — means the stagings (recorded occasions, scheduled in
// recording mode) no longer produce a pointer at all. The one
// line this producer ever wrote, the recorded 2026-11-01
// lecture's, was written pre-ruling under the cap's old scope;
// it remains in the stream (append-only is append-only — its
// removal is a data-state decision above this script), and the
// Chronicle's minutes item from it stands. Running this script
// now yields zero lines: the producer stands wired, with zero
// live producers of its shape tonight, exactly as the Chronicle
// intake's minutes state stood before it (M6.09). Pointers now
// arise from genuinely live scenes only, when one is staged.
//
// Usage: node write-staging-minutes.mjs [--dry-run]

import { readFileSync, appendFileSync, existsSync } from 'node:fs';

const { buildStagings, minutesLines } = await import('./stagings.mjs');

const FEED = new URL('../../data/feed/talk-summaries.jsonl', import.meta.url);
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/evening-2026-11-01.json', import.meta.url), 'utf8'));
const REGISTRY = JSON.parse(readFileSync(new URL('./interior-kits.json', import.meta.url), 'utf8'));

const lines = minutesLines(buildStagings(FIXTURE, REGISTRY));
const existing = existsSync(FEED)
  ? readFileSync(FEED, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
  : [];
const have = new Set(existing.map((l) => l && l.episodeKey).filter(Boolean));
const fresh = lines.filter((l) => !have.has(l.episodeKey));

if (process.argv.includes('--dry-run')) {
  console.log(`dry run: ${lines.length} staging minutes line(s), ${fresh.length} new`);
} else {
  for (const line of fresh) appendFileSync(FEED, JSON.stringify(line) + '\n');
  console.log(`talk-summaries.jsonl: ${fresh.length} line(s) appended, ${lines.length - fresh.length} already present`);
}
for (const l of lines) {
  console.log(`  ${l.episodeKey} @ ${l.placeCode}: ${l.pointer.remainingCount} summarised utterances, `
    + l.pointer.bySpeaker.map((s) => `${s.name} (${s.count})`).join(', '));
}
