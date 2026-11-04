// Elsewhere Portal — Arm A (Data): bundle builder CLI.
//
// Reads the newest valid snapshot per route from the archive (per
// fetch-log.jsonl, falling back to a filename scan), derives WorldData via
// derive.mjs, and writes:
//   feed/world-data.json  — canonical bytes of portal.world-data/v1
//   feed/manifest.json    — { bundleSeq, worlddataHash, newestFetchUtc,
//                             schema } where worlddataHash is the SHA-256
//                             of the exact world-data.json bytes written.
// bundleSeq increments from the previous manifest (persisted there).
// A malformed newest snapshot is skipped with a warning and the next-newest
// valid snapshot for that route is used — a bad body never reaches the
// deriver (Plan B §1.1) and never crashes the build.
//
// Usage: node build-bundle.mjs [--archive <dir>] [--feed <dir>]

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringify, deriveWorldData, sha256hex, SCHEMA } from './derive.mjs';
import { ROUTES } from './poller.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// Candidate snapshots for a route, newest first: the fetch-log's pointed
// file first, then every archived file by name order (names embed the UTC
// stamp, so name order is time order).
export async function snapshotCandidates(archiveDir, route) {
  const seen = new Set();
  const ordered = [];
  const push = (abs, utc) => {
    if (!seen.has(abs)) { seen.add(abs); ordered.push({ abs, utc }); }
  };
  try {
    const log = await readFile(join(archiveDir, 'fetch-log.jsonl'), 'utf8');
    const records = log.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i];
      if (r.route === route && r.snapshotId && r.file) push(join(archiveDir, r.file), r.utc);
    }
  } catch { /* no fetch log — scan only */ }
  let days = [];
  try {
    days = (await readdir(archiveDir)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  } catch { /* no archive yet */ }
  for (const day of days) {
    const files = (await readdir(join(archiveDir, day)))
      .filter((f) => f.startsWith(route + '-') && f.endsWith('.json'))
      .sort().reverse();
    for (const f of files) {
      const m = f.match(/-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
      const utc = m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null;
      push(join(archiveDir, day, f), utc);
    }
  }
  return ordered;
}

// Build the archive head: newest parseable snapshot per route.
// Returns { head, warnings } — routes with no valid snapshot are null.
export async function loadHead(archiveDir) {
  const head = {};
  const warnings = [];
  for (const route of ROUTES) {
    head[route] = null;
    for (const cand of await snapshotCandidates(archiveDir, route)) {
      try {
        const data = JSON.parse(await readFile(cand.abs, 'utf8'));
        head[route] = { data, fetchedUtc: cand.utc };
        break;
      } catch (err) {
        warnings.push(`${route}: skipped malformed snapshot ${cand.abs} (${err.message})`);
      }
    }
    if (!head[route]) warnings.push(`${route}: no valid snapshot in archive`);
  }
  return { head, warnings };
}

// Plain fetch stamp ("2026-11-03T00:27:04Z") from a snapshot's archive
// path — the same stamp grammar world-books.mjs uses for book
// boundaries, so stamps compare lexically.
export function stampOfSnapshotFile(relPath) {
  const base = String(relPath).split('/').pop();
  const m = /^([a-z]+)-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.json$/.exec(base);
  return m ? `${m[2]}-${m[3]}-${m[4]}T${m[5]}:${m[6]}:${m[7]}Z` : null;
}

// The current world-book's voices snapshots, oldest first — the plot
// accumulation input for the deriver (plot existence is book-scoped:
// a plot first evidenced by any of these stays in the bundle for the
// life of the book). The boundary is the open book's first snapshot in
// archive/world-books.json; snapshots of a closed book are never
// included. Malformed snapshots are skipped with a warning, exactly as
// for the head. When no usable registry exists, the input falls back
// to the head voices snapshot alone — head-only derivation, as before.
export async function loadBookVoices(archiveDir, head) {
  const fallback = () => (head?.voices ? [head.voices] : []);
  let boundary = null;
  try {
    const registry = JSON.parse(await readFile(join(archiveDir, 'world-books.json'), 'utf8'));
    const open = (Array.isArray(registry?.books) ? registry.books : []).find((b) => b?.status === 'open');
    if (open?.first_snapshot) boundary = stampOfSnapshotFile(open.first_snapshot);
  } catch { /* no registry — head-only */ }
  if (!boundary) return { voicesSnapshots: fallback(), warnings: [] };

  const warnings = [];
  const snaps = [];
  let days = [];
  try {
    days = (await readdir(archiveDir)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  } catch { /* no archive yet */ }
  for (const day of days) {
    const files = (await readdir(join(archiveDir, day)))
      .filter((f) => f.startsWith('voices-') && f.endsWith('.json'))
      .sort();
    for (const f of files) {
      const stamp = stampOfSnapshotFile(f);
      if (!stamp || stamp < boundary) continue;
      const abs = join(archiveDir, day, f);
      try {
        const data = JSON.parse(await readFile(abs, 'utf8'));
        snaps.push({ data, fetchedUtc: stamp.replace('Z', '.000Z') });
      } catch (err) {
        warnings.push(`voices: skipped malformed snapshot ${abs} (${err.message})`);
      }
    }
  }
  // The head snapshot is normally inside the scan; guarantee it is
  // present exactly once even if its file sits outside the day scan.
  if (head?.voices && !snaps.some((s) => s.fetchedUtc === head.voices.fetchedUtc)) {
    snaps.push(head.voices);
  }
  if (!snaps.length) return { voicesSnapshots: fallback(), warnings };
  snaps.sort((a, b) => (a.fetchedUtc < b.fetchedUtc ? -1 : a.fetchedUtc > b.fetchedUtc ? 1 : 0));
  return { voicesSnapshots: snaps, warnings };
}

export async function buildBundle({ archiveDir, feedDir }) {
  const { head, warnings } = await loadHead(archiveDir);
  const book = await loadBookVoices(archiveDir, head);
  warnings.push(...book.warnings);
  await mkdir(feedDir, { recursive: true });

  let prevSeq = 0;
  try {
    const prev = JSON.parse(await readFile(join(feedDir, 'manifest.json'), 'utf8'));
    if (Number.isInteger(prev.bundleSeq)) prevSeq = prev.bundleSeq;
  } catch { /* first bundle */ }
  const bundleSeq = prevSeq + 1;

  const worldData = deriveWorldData(head, { bundleSeq, voicesSnapshots: book.voicesSnapshots });
  const bytes = canonicalStringify(worldData);
  const worlddataHash = sha256hex(bytes);
  await writeFile(join(feedDir, 'world-data.json'), bytes, 'utf8');
  const manifest = { bundleSeq, worlddataHash, newestFetchUtc: worldData.newestFetchUtc, schema: SCHEMA };
  await writeFile(join(feedDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { manifest, warnings, worldData };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const archiveDir = opt('--archive', join(HERE, 'archive'));
  const feedDir = opt('--feed', join(HERE, 'feed'));
  const { manifest, warnings } = await buildBundle({ archiveDir, feedDir });
  for (const w of warnings) console.error('warning:', w);
  console.log(JSON.stringify({ ...manifest, warnings: warnings.length }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('build-bundle failed:', err);
    process.exitCode = 1;
  });
}
