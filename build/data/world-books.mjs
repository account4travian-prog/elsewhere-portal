// Elsewhere Portal — Arm A (Data): world-book registry (plan M1.05, PB-08).
//
// Maps the snapshot archive into world-books. A world-book is the run of
// snapshots belonging to one continuous Elsewhere world: a book opens at
// the first snapshot after the previous world ended and closes only when
// reset detection CONFIRMS a reset (reset-detect.mjs verdicts, read from
// archive/reset-watch.jsonl). Suspected verdicts are recorded as
// annotations on the book they fall in — never as boundaries. No
// cross-book merges, ever (PB-08).
//
// The registry (archive/world-books.json) is a derived artefact: this
// module rebuilds it from the archive (snapshot files + chain-*.jsonl)
// and the reset-watch log. Rebuilds are deterministic and idempotent —
// the same inputs produce byte-identical output (no wall-clock fields).
//
// Companion module: derive/build-bundle/health/reset-detect/chain are
// untouched by it. Since M2.01 the route list is NOT kept here — it is
// imported from poller.mjs, the one canonical ROUTES (cadence.json
// carries the same set's cadences). Consumers (derive, M1.09 thinning)
// read the registry file; if a hook is wanted later, calling
// buildAndWriteRegistry after reset-detect's runWatch keeps the registry
// current with watch state.
//
// Node stdlib only.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROUTES } from './poller.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REGISTRY_SCHEMA = 'portal.world-books/v1';
export const REGISTRY_FILE = 'world-books.json';
export { ROUTES };
const SNAPSHOT_RE = /^([a-z]+)-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.json$/;

// "2026-11-02/overview-20261102T020712Z.json" -> "2026-11-02T02:07:12Z"
export function stampOfFile(relPath) {
  const base = String(relPath).split('/').pop();
  const m = SNAPSHOT_RE.exec(base);
  if (!m) return null;
  return `${m[2]}-${m[3]}-${m[4]}T${m[5]}:${m[6]}:${m[7]}Z`;
}

async function listSnapshots(archiveDir) {
  const out = [];
  let dayDirs = [];
  try {
    dayDirs = (await readdir(archiveDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch { return out; }
  for (const day of dayDirs) {
    const files = (await readdir(join(archiveDir, day))).sort();
    for (const f of files) {
      const m = SNAPSHOT_RE.exec(f);
      if (!m) continue;
      out.push({ route: m[1], file: `${day}/${f}`, stamp: stampOfFile(f) });
    }
  }
  out.sort((a, b) => (a.stamp < b.stamp ? -1 : a.stamp > b.stamp ? 1 : a.file < b.file ? -1 : 1));
  return out;
}

async function readJsonl(path) {
  try {
    const text = await readFile(path, 'utf8');
    return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch { return []; }
}

async function readChains(archiveDir) {
  const chains = {};
  for (const route of ROUTES) {
    const entries = await readJsonl(join(archiveDir, `chain-${route}.jsonl`));
    if (entries.length) chains[route] = entries;
  }
  return chains;
}

// Chain head for a book: last entry whose snapshot stamp is <= the book's
// final snapshot stamp (null bound = current tail, for the open book).
function chainHeads(chains, lastStamp) {
  const heads = {};
  for (const [route, entries] of Object.entries(chains)) {
    let head = null;
    for (const e of entries) {
      const s = stampOfFile(e.file) ?? e.captured_at ?? null;
      if (lastStamp === null || (s !== null && s <= lastStamp)) head = e;
    }
    if (head) heads[route] = { seq: head.seq, file: head.file, sha256: head.sha256 };
  }
  return heads;
}

export async function buildRegistry({ archiveDir }) {
  const [snapshots, watch, chains] = await Promise.all([
    listSnapshots(archiveDir),
    readJsonl(join(archiveDir, 'reset-watch.jsonl')),
    readChains(archiveDir),
  ]);

  // Confirmed resets become boundaries at the verdict's pair: the old book
  // ends with evidence.prev, the new book opens with evidence.next.
  const confirmed = watch
    .filter((w) => w.verdict === 'confirmed' && w.evidence?.prev?.file && w.evidence?.next?.file)
    .map((w) => ({
      prevFile: w.evidence.prev.file,
      nextFile: w.evidence.next.file,
      nextStamp: stampOfFile(w.evidence.next.file),
      inspectedAtUtc: w.inspectedAtUtc ?? null,
      signals: w.signals ?? [],
    }))
    .filter((b) => b.nextStamp !== null)
    .sort((a, b) => (a.nextStamp < b.nextStamp ? -1 : 1));

  const suspected = watch.filter((w) => w.verdict === 'suspected');

  // Segment snapshots: a snapshot belongs to the earliest book whose
  // opening stamp is <= its stamp; boundaries split at nextStamp.
  const bounds = [null, ...confirmed.map((b) => b.nextStamp)];
  const segments = bounds.map(() => []);
  for (const snap of snapshots) {
    let idx = 0;
    for (let i = 1; i < bounds.length; i++) if (snap.stamp >= bounds[i]) idx = i;
    segments[idx].push(snap);
  }

  const books = segments.map((seg, i) => {
    const isLast = i === segments.length - 1;
    const close = isLast ? null : confirmed[i];
    const first = seg[0] ?? null;
    const last = seg[seg.length - 1] ?? null;
    const book = {
      id: `world-${String(i + 1).padStart(3, '0')}`,
      status: isLast ? 'open' : 'closed',
      opened_at: first ? first.stamp : (close ? null : null),
      opened_with_file: first ? first.file : null,
      closed_at: close ? (last ? last.stamp : null) : null,
      closed_with_file: close ? close.prevFile : null,
      close_reason: close
        ? { kind: 'reset-confirmed', inspectedAtUtc: close.inspectedAtUtc, signals: close.signals, next_file: close.nextFile }
        : null,
      snapshot_count: seg.length,
      first_snapshot: first ? first.file : null,
      last_snapshot: last ? last.file : null,
      chain_heads: chainHeads(chains, isLast ? null : (last ? last.stamp : null)),
      annotations: [],
    };
    return book;
  });

  // Suspected verdicts annotate the book containing their pair's prev file.
  for (const w of suspected) {
    const prevStamp = w.evidence?.prev?.file ? stampOfFile(w.evidence.prev.file) : null;
    let idx = 0;
    if (prevStamp) for (let i = 1; i < bounds.length; i++) if (prevStamp >= bounds[i]) idx = i;
    books[idx]?.annotations.push({
      kind: 'suspected-reset',
      inspectedAtUtc: w.inspectedAtUtc ?? null,
      signals: w.signals ?? [],
      prev_file: w.evidence?.prev?.file ?? null,
      next_file: w.evidence?.next?.file ?? null,
    });
  }

  return { schema: REGISTRY_SCHEMA, books };
}

export async function buildAndWriteRegistry({ archiveDir, outFile }) {
  const registry = await buildRegistry({ archiveDir });
  const target = outFile ?? join(archiveDir, REGISTRY_FILE);
  await writeFile(target, JSON.stringify(registry, null, 2) + '\n');
  return registry;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const archiveDir = opt('--archive', join(HERE, 'archive'));
  const outFile = opt('--out', join(archiveDir, REGISTRY_FILE));
  const registry = await buildAndWriteRegistry({ archiveDir, outFile });
  for (const b of registry.books) {
    console.log(`${b.id} ${b.status} opened_at=${b.opened_at} snapshots=${b.snapshot_count} annotations=${b.annotations.length}`);
  }
  console.log(`wrote ${outFile}`);
}
