// Elsewhere Portal — Arm A (Data): journeys feed cycle (companion to
// build-bundle.mjs; the episodes-cycle pattern applied to M3.01).
//
// Loads the CURRENT world-book's voices snapshots (book boundary from
// archive/world-books.json, the same scoping loadBookVoices applies to
// plot existence), the voices coverage record (every successful voices
// fetch in archive/fetch-log.jsonl), and the gap ceiling (GAP_FACTOR
// from health.mjs × the voices cadence from cadence.json), runs
// journeys.mjs's reconstructJourneys over them, and writes:
//
//   feed/journeys.json — portal.journeys/v1 (see journeys.mjs for the
//   reconstruction rule, the adopted ceiling, and why journeys are a
//   companion artefact rather than a bundle field: CONTRACT-V2 is
//   frozen at M2.11).
//
// DETERMINISM: no wall-clock reads anywhere in the output, canonical
// key order via derive.mjs's canonicalStringify. Same archive =>
// identical bytes. The write is atomic: temp file in the feed dir,
// then rename over journeys.json — a failed run keeps the previous
// journeys.json, exactly as the episodes hook does.
//
// SUPERVISOR HOOK (for the coordinator to apply, as the episodes hook
// was): after the bundle step in run_cycle, mirroring run_step's
// logging —
//   run_step "journeys" "$LOG_DIR/journeys.log" node "$HERE/journeys-cycle.mjs"
// Read-only over the archive; writes only feed/journeys.json.
//
// Usage: node journeys-cycle.mjs [--archive <dir>] [--feed <dir>]
//        node journeys-cycle.mjs --out <file>   (overrides feed dir)

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringify } from './derive.mjs';
import { JOURNEY_SCHEMA, reconstructJourneys } from './journeys.mjs';
import { snapshotCandidates, stampOfSnapshotFile } from './build-bundle.mjs';
import { GAP_FACTOR, parseFetchLog } from './health.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// The open world-book from the registry, or null when no usable
// registry exists. Journeys are book-scoped by definition (ceiling
// rule 1), so unlike the bundle's head fallback there is no honest
// bookless derivation — the caller fails loud instead.
export async function loadOpenBook(archiveDir) {
  try {
    const registry = JSON.parse(await readFile(join(archiveDir, 'world-books.json'), 'utf8'));
    const open = (Array.isArray(registry?.books) ? registry.books : []).find((b) => b?.status === 'open');
    if (open?.id && open?.opened_at && open?.first_snapshot) {
      return { id: open.id, openedAtUtc: open.opened_at, firstSnapshot: open.first_snapshot };
    }
  } catch { /* no registry — reported by the caller */ }
  return null;
}

// The open book's voices snapshots, oldest first, each with its
// archive-relative file name (evidence attribution). Snapshots of a
// closed book are never included; malformed snapshots are skipped
// with a warning, exactly as for the head.
export async function loadBookVoicesWithFiles(archiveDir, book) {
  const boundary = stampOfSnapshotFile(book.firstSnapshot);
  const warnings = [];
  const snaps = [];
  for (const cand of await snapshotCandidates(archiveDir, 'voices')) {
    const rel = relative(archiveDir, cand.abs).split(sep).join('/');
    const stamp = stampOfSnapshotFile(rel);
    if (!stamp || (boundary && stamp < boundary)) continue;
    try {
      const data = JSON.parse(await readFile(cand.abs, 'utf8'));
      snaps.push({ data, fetchedUtc: cand.utc ?? `${stamp.replace('Z', '.000Z')}`, file: rel });
    } catch (err) {
      warnings.push(`voices: skipped malformed snapshot ${cand.abs} (${err.message})`);
    }
  }
  snaps.sort((a, b) => (a.fetchedUtc < b.fetchedUtc ? -1 : a.fetchedUtc > b.fetchedUtc ? 1 : 0));
  return { voicesSnapshots: snaps, warnings };
}

// Every successful voices fetch stamp in the archive's fetch log —
// the coverage record the ceiling reads.
export async function loadVoicesFetchUtc(archiveDir) {
  try {
    const records = parseFetchLog(await readFile(join(archiveDir, 'fetch-log.jsonl'), 'utf8'));
    return records
      .filter((r) => r.route === 'voices' && r.status === 200 && typeof r.utc === 'string')
      .map((r) => r.utc);
  } catch {
    return [];
  }
}

// The ceiling threshold from the live cadence: GAP_FACTOR × voices
// cadence, the health surface's own gap definition.
export async function loadMaxEvidenceGapMs() {
  try {
    const cadence = JSON.parse(await readFile(join(HERE, 'cadence.json'), 'utf8'));
    const voicesSeconds = cadence?.routesSeconds?.voices;
    if (typeof voicesSeconds === 'number' && voicesSeconds > 0) {
      return GAP_FACTOR * voicesSeconds * 1000;
    }
  } catch { /* fall through to the journeys.mjs default */ }
  return undefined;
}

export async function buildJourneys({ archiveDir }) {
  const book = await loadOpenBook(archiveDir);
  if (!book) {
    throw new Error('journeys-cycle: no open world-book in archive/world-books.json — journeys are book-scoped and cannot be derived without one');
  }
  const { voicesSnapshots, warnings } = await loadBookVoicesWithFiles(archiveDir, book);
  if (!voicesSnapshots.length) throw new Error('journeys-cycle: no valid voices snapshots in the open world-book');
  const voicesFetchUtc = await loadVoicesFetchUtc(archiveDir);
  const maxEvidenceGapMs = await loadMaxEvidenceGapMs();
  const doc = reconstructJourneys({
    voicesSnapshots,
    voicesFetchUtc,
    book,
    ...(maxEvidenceGapMs !== undefined ? { maxEvidenceGapMs } : {}),
  });
  return { doc, bytes: canonicalStringify(doc), warnings };
}

export async function runJourneysCycle({ archiveDir, feedDir, outFile }) {
  const { doc, bytes, warnings } = await buildJourneys({ archiveDir });
  const target = outFile || join(feedDir, 'journeys.json');
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
  const { doc, warnings, target } = await runJourneysCycle({ archiveDir, feedDir, outFile });
  for (const w of warnings) console.error('warning:', w);
  console.log(JSON.stringify({
    schema: doc.schema,
    bookId: doc.bookId,
    stats: doc.stats,
    warnings: warnings.length,
    wrote: target,
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('journeys-cycle failed:', err);
    process.exitCode = 1;
  });
}

export { JOURNEY_SCHEMA };
