// Snapshot hash chain (Hark Wave-1 audit Q1+Q3 conditions, adopted 2026-11-02).
//
// Per-route append-only chains over the archive's raw snapshot bytes:
//   archive/chain-<route>.jsonl, one record per snapshot:
//   { schema, seq, route, file, sha256, prev_hash, captured_at
//     [, window_oldest, window_newest] }   // rolling routes only
//
// Schema (Hark M2 mini-audit Q5 amendment, adopted 2026-11-02): the chain
// is the archive's integrity anchor, so its record shape is versioned as
// portal.chain/v0 — declared in archive/chain-SCHEMA.md. Records written
// before that declaration carry no `schema` field and are v0 BY
// DECLARATION; every record appended since carries
// "schema": "portal.chain/v0" inline. verify() accepts such mixed chains
// and fails any record whose schema value is anything else, and any
// record that drops the field after schema-bearing records have begun.
// The schema field is metadata about the record only: sha256 stays over
// the snapshot's raw bytes and prev_hash links snapshot hashes, so
// adding the field never disturbs existing links.
//
// sha256 is over the snapshot file's RAW BYTES (never a re-serialisation).
// prev_hash is the previous record's sha256 (null at genesis), so any
// altered, reordered, or dropped snapshot breaks the chain observably.
//
// Rolling routes (chats, news) also record their feed window edges
// (oldest/newest item evidenced in the body) so scroll-off between polls
// shows up as an edge gap between consecutive records.
//
// buildChains() is idempotent: it extends existing chains with only the
// snapshots not yet chained and never rewrites existing records.
//
// CLI:
//   node chain.mjs build   [archiveDir]            extend all chains
//   node chain.mjs verify  [archiveDir] [--json]   verify all chains (exit 1 on failure)
//   node chain.mjs verify-one <chainFile> [archiveDir]
//
// Node stdlib only. Companion to poller.mjs; the poller needs no changes —
// run `node chain.mjs build` after any poll (e.g. from the supervisor).

import { createHash } from 'node:crypto';
import { appendFile, readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROLLING_ROUTES = ['chats', 'news'];
export const CHAIN_SCHEMA = 'portal.chain/v0';
const SNAPSHOT_RE = /^([a-z_]+)-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.json$/;

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// "2026-11-03/chats-20261103T002705Z.json" -> { route, capturedAt }
export function parseSnapshotName(relFile) {
  const m = SNAPSHOT_RE.exec(basename(relFile));
  if (!m) return null;
  const [, route, y, mo, d, h, mi, s] = m;
  return { route, capturedAt: `${y}-${mo}-${d}T${h}:${mi}:${s}Z` };
}

// Window edges for a rolling route's parsed body.
// Returns { oldest: {at, id} | null, newest: {at, id} | null, source }.
// chats: messages[] (at, id). news: headlines[] (at, id).
// Any route/body without usable timestamped items yields null edges.
export function windowEdges(route, body) {
  let items = null;
  let source = null;
  if (route === 'chats' && Array.isArray(body?.messages)) {
    items = body.messages;
    source = 'messages';
  } else if (route === 'news' && Array.isArray(body?.headlines)) {
    items = body.headlines;
    source = 'headlines';
  }
  if (!items) return { oldest: null, newest: null, source: null };
  let oldest = null;
  let newest = null;
  for (const it of items) {
    if (!it || typeof it.at !== 'string') continue;
    const edge = { at: it.at, id: typeof it.id === 'string' ? it.id : null };
    if (!oldest || it.at < oldest.at) oldest = edge;
    if (!newest || it.at > newest.at) newest = edge;
  }
  return { oldest, newest, source };
}

// Edge gaps between consecutive records of a rolling route: the next
// window's oldest item is newer than the previous window's newest item,
// so items scrolled off between the two polls were never captured.
export function detectEdgeGaps(records) {
  const gaps = [];
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1];
    const next = records[i];
    if (!prev.window_newest || !next.window_oldest) continue;
    if (next.window_oldest.at > prev.window_newest.at) {
      gaps.push({
        after_seq: prev.seq,
        before_seq: next.seq,
        prev_window_newest: prev.window_newest,
        next_window_oldest: next.window_oldest,
      });
    }
  }
  return gaps;
}

async function listSnapshots(archiveDir) {
  const out = [];
  let days;
  try {
    days = await readdir(archiveDir);
  } catch {
    return out;
  }
  for (const day of days.sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const dayPath = join(archiveDir, day);
    if (!(await stat(dayPath)).isDirectory()) continue;
    for (const name of (await readdir(dayPath)).sort()) {
      const parsed = parseSnapshotName(name);
      if (parsed) out.push({ rel: `${day}/${name}`, ...parsed });
    }
  }
  return out; // sorted by day then filename == chronological per route
}

export async function readChain(chainPath) {
  let raw;
  try {
    raw = await readFile(chainPath, 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

function makeRecord(route, snap, rawBytes, seq, prevHash) {
  const rec = {
    schema: CHAIN_SCHEMA,
    seq,
    route,
    file: snap.rel,
    sha256: sha256Hex(rawBytes),
    prev_hash: prevHash,
    captured_at: snap.capturedAt,
  };
  if (ROLLING_ROUTES.includes(route)) {
    let body = null;
    try {
      body = JSON.parse(rawBytes.toString('utf8'));
    } catch {
      body = null;
    }
    const edges = body ? windowEdges(route, body) : { oldest: null, newest: null };
    rec.window_oldest = edges.oldest;
    rec.window_newest = edges.newest;
  }
  return rec;
}

// Extend every route chain with snapshots not yet chained.
// Returns { route: { added, total } }.
export async function buildChains(archiveDir) {
  const snapshots = await listSnapshots(archiveDir);
  const byRoute = new Map();
  for (const s of snapshots) {
    if (!byRoute.has(s.route)) byRoute.set(s.route, []);
    byRoute.get(s.route).push(s);
  }
  const summary = {};
  for (const [route, snaps] of [...byRoute.entries()].sort()) {
    const chainPath = join(archiveDir, `chain-${route}.jsonl`);
    const existing = await readChain(chainPath);
    const chained = new Set(existing.map((r) => r.file));
    let seq = existing.length;
    let prevHash = existing.length ? existing[existing.length - 1].sha256 : null;
    let added = 0;
    for (const snap of snaps) {
      if (chained.has(snap.rel)) continue;
      const raw = await readFile(join(archiveDir, snap.rel));
      const rec = makeRecord(route, snap, raw, ++seq, prevHash);
      await appendFile(chainPath, JSON.stringify(rec) + '\n');
      prevHash = rec.sha256;
      added++;
    }
    summary[route] = { added, total: seq };
  }
  return summary;
}

// Verify one chain against the snapshot files. Returns
// { ok, route, records, errors: [...], edge_gaps: [...] }.
// Edge gaps are REPORTED, not failures: they are lost-feed visibility,
// not tampering.
export async function verifyChain(chainPath, archiveDir) {
  const errors = [];
  const records = await readChain(chainPath);
  const route = basename(chainPath).replace(/^chain-/, '').replace(/\.jsonl$/, '');
  let prevHash = null;
  let schemaSeen = false;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const where = `seq ${rec.seq ?? i + 1}`;
    if (rec.seq !== i + 1) errors.push(`${where}: seq discontinuity (expected ${i + 1}, found ${rec.seq})`);
    if (rec.route !== route) errors.push(`${where}: route mismatch (${rec.route} != ${route})`);
    // Schema versioning (portal.chain/v0, archive/chain-SCHEMA.md):
    // records predating the declaration carry no field and are v0 by
    // declaration; once a schema-bearing record appears, every later
    // record must carry exactly CHAIN_SCHEMA.
    if ('schema' in rec) {
      if (rec.schema !== CHAIN_SCHEMA) {
        errors.push(`${where}: schema mismatch (expected ${CHAIN_SCHEMA}, found ${JSON.stringify(rec.schema)})`);
      }
      schemaSeen = true;
    } else if (schemaSeen) {
      errors.push(`${where}: schema missing on post-declaration record (expected ${CHAIN_SCHEMA})`);
    }
    if (rec.prev_hash !== prevHash) {
      errors.push(`${where}: prev_hash break (expected ${prevHash}, found ${rec.prev_hash})`);
    }
    const parsed = parseSnapshotName(rec.file ?? '');
    if (!parsed) {
      errors.push(`${where}: unparseable snapshot filename ${rec.file}`);
      prevHash = rec.sha256;
      continue;
    }
    if (parsed.capturedAt !== rec.captured_at) {
      errors.push(`${where}: captured_at ${rec.captured_at} != filename stamp ${parsed.capturedAt}`);
    }
    let raw;
    try {
      raw = await readFile(join(archiveDir, rec.file));
    } catch {
      errors.push(`${where}: snapshot file missing: ${rec.file}`);
      prevHash = rec.sha256;
      continue;
    }
    const actual = sha256Hex(raw);
    if (actual !== rec.sha256) {
      errors.push(`${where}: sha256 mismatch for ${rec.file} (chain ${rec.sha256}, actual ${actual})`);
    }
    if (ROLLING_ROUTES.includes(route)) {
      let body = null;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        body = null;
      }
      const edges = body ? windowEdges(route, body) : { oldest: null, newest: null };
      if (JSON.stringify(edges.oldest) !== JSON.stringify(rec.window_oldest ?? null)) {
        errors.push(`${where}: window_oldest mismatch (chain ${JSON.stringify(rec.window_oldest)}, body ${JSON.stringify(edges.oldest)})`);
      }
      if (JSON.stringify(edges.newest) !== JSON.stringify(rec.window_newest ?? null)) {
        errors.push(`${where}: window_newest mismatch (chain ${JSON.stringify(rec.window_newest)}, body ${JSON.stringify(edges.newest)})`);
      }
    }
    prevHash = rec.sha256;
  }
  return {
    ok: errors.length === 0,
    route,
    records: records.length,
    errors,
    edge_gaps: ROLLING_ROUTES.includes(route) ? detectEdgeGaps(records) : [],
  };
}

export async function verifyAll(archiveDir) {
  const names = (await readdir(archiveDir)).filter((n) => /^chain-.+\.jsonl$/.test(n)).sort();
  const results = [];
  for (const n of names) results.push(await verifyChain(join(archiveDir, n), archiveDir));
  return results;
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const json = rest.includes('--json');
  const positional = rest.filter((a) => !a.startsWith('--'));
  const here = fileURLToPath(new URL('.', import.meta.url));
  if (cmd === 'build') {
    const archiveDir = positional[0] ?? join(here, 'archive');
    const summary = await buildChains(archiveDir);
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }
  if (cmd === 'verify') {
    const archiveDir = positional[0] ?? join(here, 'archive');
    const results = await verifyAll(archiveDir);
    if (json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      for (const r of results) {
        console.log(`${r.route}: ${r.ok ? 'OK' : 'FAIL'} (${r.records} records, ${r.edge_gaps.length} edge gaps)`);
        for (const e of r.errors) console.log(`  ERROR ${e}`);
        for (const g of r.edge_gaps) {
          console.log(`  EDGE GAP between seq ${g.after_seq} and ${g.before_seq}: window jumped ${g.prev_window_newest.at} -> ${g.next_window_oldest.at}`);
        }
      }
    }
    return results.every((r) => r.ok) ? 0 : 1;
  }
  if (cmd === 'verify-one') {
    const chainPath = positional[0];
    const archiveDir = positional[1] ?? join(here, 'archive');
    if (!chainPath) {
      console.error('usage: node chain.mjs verify-one <chainFile> [archiveDir]');
      return 2;
    }
    const r = await verifyChain(chainPath, archiveDir);
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }
  console.error('usage: node chain.mjs build|verify [archiveDir] [--json] | verify-one <chainFile> [archiveDir]');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
