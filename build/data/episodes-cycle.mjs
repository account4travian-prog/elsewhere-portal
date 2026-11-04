// Elsewhere Portal — Arm A (Data): episodes feed cycle (companion to
// build-bundle.mjs).
//
// Loads the archive head snapshots for the voices and news routes — the
// same head-loading discipline as build-bundle.mjs (newest parseable
// snapshot per route via snapshotCandidates: fetch-log order first,
// filename scan fallback; a malformed newest snapshot is skipped with a
// warning, never fed to a deriver) — runs episodes.mjs's deriveEpisodes
// + deriveActSequences over them, and writes:
//
//   feed/episodes.json — { schema: 'portal.episodes/v1',
//                          generatedFrom: { voicesFile, newsFile },
//                          episodes, actSequences }
//
// EPISODES CARRY THEIR UTTERANCES. deriveEpisodes returns summaries
// (place, participants, span, count, corroboration, disclosure); talk
// playback needs the recorded words themselves, so each derived episode
// gains `utterances: [{ at, by, said }]` — the run's utterances in
// recorded order, `said` copied VERBATIM from the record (fence markers
// included, exactly as the record carries them). The runs are re-chained
// here with episodes.mjs's own rule (same utterance filter, same sort,
// same EXCHANGE_GAP_MS) and matched to the derived episodes by place +
// first/last stamp + count; a derived episode with no matching run is a
// hard error, never a silent empty attachment — the supervisor hook
// keeps the previous episodes.json on any failure (see the hook spec in
// the M4 talk-surface report).
//
// DETERMINISM: no wall-clock reads anywhere in the output (no
// generatedAt), canonical key order via derive.mjs's
// canonicalStringify, file names (not paths out of the archive) in
// generatedFrom. Same head => identical bytes. The write is atomic:
// temp file in the feed dir, then rename over episodes.json.
//
// Usage: node episodes-cycle.mjs [--archive <dir>] [--feed <dir>]
//        node episodes-cycle.mjs --out <file>   (overrides feed dir)

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringify } from './derive.mjs';
import { EPISODE_SCHEMA, EXCHANGE_GAP_MS, deriveEpisodes, deriveActSequences } from './episodes.mjs';
import { snapshotCandidates } from './build-bundle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// Newest parseable snapshot for one route, with its archive-relative
// file name. Mirrors loadHead's skip-malformed discipline.
export async function loadRouteHead(archiveDir, route) {
  const warnings = [];
  for (const cand of await snapshotCandidates(archiveDir, route)) {
    try {
      const data = JSON.parse(await readFile(cand.abs, 'utf8'));
      const file = relative(archiveDir, cand.abs).split(sep).join('/');
      return { head: { data, file }, warnings };
    } catch (err) {
      warnings.push(`${route}: skipped malformed snapshot ${cand.abs} (${err.message})`);
    }
  }
  warnings.push(`${route}: no valid snapshot in archive`);
  return { head: null, warnings };
}

function stampMs(at) {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Re-chain one place's utterances into runs exactly as episodes.mjs
// does (same filter, same sort, same gap rule), so a run can be matched
// to the episode deriveEpisodes derived from it.
function runsForPlace(place) {
  const utterances = (Array.isArray(place?.said) ? place.said : [])
    .filter((u) => u && typeof u.by === 'string' && u.by !== '' && stampMs(u.at) !== null)
    .slice()
    .sort((a, b) => (stampMs(a.at) - stampMs(b.at)) || cmpStr(String(a.id ?? ''), String(b.id ?? '')));
  const runs = [];
  let run = [];
  for (const u of utterances) {
    if (run.length > 0 && stampMs(u.at) - stampMs(run[run.length - 1].at) > EXCHANGE_GAP_MS) {
      runs.push(run);
      run = [];
    }
    run.push(u);
  }
  if (run.length) runs.push(run);
  return runs;
}

// Attach each derived episode's utterances, verbatim and in recorded
// order. Matching is exact: same place, same first/last stamps, same
// count. Anything else means the two derivations disagree — fail loud.
export function attachUtterances(episodes, voicesData) {
  const runsByPlace = new Map();
  const places = voicesData && Array.isArray(voicesData.places) ? voicesData.places : [];
  for (const place of places) {
    if (!place || typeof place.code !== 'string') continue;
    if (!runsByPlace.has(place.code)) runsByPlace.set(place.code, []);
    runsByPlace.get(place.code).push(...runsForPlace(place));
  }
  return episodes.map((ep) => {
    const runs = runsByPlace.get(ep.place) || [];
    const run = runs.find(
      (r) => r.length === ep.utteranceCount && r[0].at === ep.firstUtc && r[r.length - 1].at === ep.lastUtc,
    );
    if (!run) {
      throw new Error(
        `episodes-cycle: no utterance run matches derived episode at ${ep.place} ` +
        `${ep.firstUtc}..${ep.lastUtc} (${ep.utteranceCount} utterances) — refusing to publish an episode without its recorded words`,
      );
    }
    return {
      ...ep,
      utterances: run.map((u) => ({ at: u.at, by: u.by, said: u.said })),
    };
  });
}

export async function buildEpisodes({ archiveDir }) {
  const voicesRes = await loadRouteHead(archiveDir, 'voices');
  const newsRes = await loadRouteHead(archiveDir, 'news');
  const warnings = [...voicesRes.warnings, ...newsRes.warnings];
  if (!voicesRes.head) throw new Error('episodes-cycle: no valid voices snapshot in archive — episodes cannot be derived');
  const voicesData = voicesRes.head.data;
  const newsData = newsRes.head ? newsRes.head.data : null;
  if (!newsData) warnings.push('news: deriving without news — nothing corroborates, no act sequences');

  const episodes = attachUtterances(deriveEpisodes(voicesData, newsData), voicesData);
  const actSequences = deriveActSequences(newsData);
  const doc = {
    schema: EPISODE_SCHEMA,
    generatedFrom: {
      voicesFile: voicesRes.head.file,
      newsFile: newsRes.head ? newsRes.head.file : null,
    },
    episodes,
    actSequences,
  };
  return { doc, bytes: canonicalStringify(doc), warnings };
}

export async function runEpisodesCycle({ archiveDir, feedDir, outFile }) {
  const { doc, bytes, warnings } = await buildEpisodes({ archiveDir });
  const target = outFile || join(feedDir, 'episodes.json');
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  await writeFile(tmp, bytes, 'utf8');
  await rename(tmp, target);
  return { doc, warnings, target };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const archiveDir = opt('--archive', join(HERE, 'archive'));
  const feedDir = opt('--feed', join(HERE, 'feed'));
  const outFile = opt('--out', null);
  const { doc, warnings, target } = await runEpisodesCycle({ archiveDir, feedDir, outFile });
  for (const w of warnings) console.error('warning:', w);
  console.log(JSON.stringify({
    schema: doc.schema,
    generatedFrom: doc.generatedFrom,
    episodes: doc.episodes.length,
    actSequences: doc.actSequences.length,
    warnings: warnings.length,
    wrote: target,
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('episodes-cycle failed:', err);
    process.exitCode = 1;
  });
}
