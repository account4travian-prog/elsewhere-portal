// Elsewhere Portal — Arm A (Data): Tier P poller / archiver.
//
// Fetches the public Tier P routes (Paper 01 §9.2) from
// https://world.elsewhereagents.com/public/<route>.json and archives real
// snapshots under archive/<YYYY-MM-DD>/<route>-<UTC stamp>.json, appending one
// fetch record per attempt to archive/fetch-log.jsonl.
//
// Discipline (Plan B §2.1): the poller knows bytes, not meaning. Change
// detection is body SHA-256 vs. the last stored body for that route — an
// unchanged body is recorded, not re-snapshotted. A route that errors
// (network, non-200, malformed JSON) is recorded and never stops the pass.
// Node stdlib only (global fetch). No Elsewhere key is read or sent, ever.
//
// M2.01 (2026-11-02): the scheduled set is the 11 routes of Plan B §2.1's
// table / SE-1.7 — the Wave 1 six plus debates, discussions, problems,
// concerts, errata. Tiles/features, per-agent pages and certificates
// stay on-demand only (D5, REC-6); no route beyond the 11 without a
// named consumer. ROUTES here is the single canonical list: cadence.json
// carries exactly these routes' cadences (a test pins the parity), and
// world-books.mjs / identity-registry.mjs import this list instead of
// keeping their own copies.

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROUTES = [
  'overview', 'news', 'voices', 'map', 'status', 'chats',
  'debates', 'discussions', 'problems', 'concerts', 'errata',
];

// Fetches/day a cadence table commits us to: Σ 86400 ÷ per-route seconds.
// Plan B §2.1's scheduled total is 5,496/day (its ≈5,600 headline adds
// the ≤78/day on-demand agent sweep, M2.05 — not a scheduled poll).
export function dailyFetchTotal(routesSeconds) {
  return Object.values(routesSeconds).reduce((sum, s) => sum + 86400 / s, 0);
}

// Watch-mode delay after a fetch attempt (Plan B §2.1 backoff: base 60 s,
// cap 30 min, doubling per consecutive error). A healthy route waits
// exactly its cadence; an erroring route waits at least its cadence and
// at most the 30 min cap, so one sick route never becomes a hot loop
// and never delays the others (each route's due time is its own).
export function nextDelaySeconds(cadenceSeconds, consecutiveErrors) {
  if (!consecutiveErrors || consecutiveErrors <= 0) return cadenceSeconds;
  const backoff = Math.min(60 * 2 ** (consecutiveErrors - 1), 1800);
  return Math.max(cadenceSeconds, backoff);
}

const HERE = dirname(fileURLToPath(import.meta.url));

export function sha256hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// "2026-11-02T02:04:35.123Z" -> { day: "2026-11-02", stamp: "20261102T020435Z" }
export function utcStamp(date) {
  const iso = date.toISOString();
  return {
    day: iso.slice(0, 10),
    stamp: iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'),
  };
}

export async function loadCadence(path = join(HERE, 'cadence.json')) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

async function appendFetchRecord(archiveDir, record) {
  await mkdir(archiveDir, { recursive: true });
  await appendFile(join(archiveDir, 'fetch-log.jsonl'), JSON.stringify(record) + '\n', 'utf8');
}

// Newest stored snapshot body hash for a route, scanning day directories.
// Returns { sha256, file } or null. Used only for change detection.
export async function lastSnapshot(archiveDir, route) {
  let days;
  try {
    days = (await readdir(archiveDir)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  } catch {
    return null;
  }
  for (let i = days.length - 1; i >= 0; i--) {
    const dir = join(archiveDir, days[i]);
    const files = (await readdir(dir)).filter((f) => f.startsWith(route + '-') && f.endsWith('.json')).sort();
    if (files.length) {
      const file = join(dir, files[files.length - 1]);
      const body = await readFile(file, 'utf8');
      return { sha256: sha256hex(body), file };
    }
  }
  return null;
}

// Fetch one route, archive on change, append the fetch record. Never throws
// for fetch/parse problems — they become records with `error` set.
export async function fetchRoute(route, opts) {
  const {
    baseUrl,
    archiveDir,
    userAgent = 'ElsewherePortal/0.1 (+archiver)',
    timeoutMs = 30000,
    fetchImpl = fetch,
    now = new Date(),
  } = opts;
  const fetchedUtc = now.toISOString();
  const url = `${baseUrl}/public/${route}.json`;
  const base = { route, utc: fetchedUtc, snapshotId: null, file: null };

  let res;
  try {
    res = await fetchImpl(url, {
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const record = { ...base, status: 'error', bytes: 0, sha256: null, error: `fetch failed: ${err.message}` };
    await appendFetchRecord(archiveDir, record);
    return record;
  }

  const body = await res.text();
  const bytes = Buffer.byteLength(body, 'utf8');
  const digest = sha256hex(body);

  if (!res.ok) {
    const record = { ...base, status: res.status, bytes, sha256: digest, error: `HTTP ${res.status}` };
    await appendFetchRecord(archiveDir, record);
    return record;
  }

  try {
    JSON.parse(body);
  } catch (err) {
    const record = { ...base, status: res.status, bytes, sha256: digest, error: `malformed JSON: ${err.message}` };
    await appendFetchRecord(archiveDir, record);
    return record;
  }

  const prev = await lastSnapshot(archiveDir, route);
  if (prev && prev.sha256 === digest) {
    const record = { ...base, status: res.status, bytes, sha256: digest, unchanged: true };
    await appendFetchRecord(archiveDir, record);
    return record;
  }

  const { day, stamp } = utcStamp(now);
  const dir = join(archiveDir, day);
  await mkdir(dir, { recursive: true });
  let name = `${route}-${stamp}.json`;
  let file = join(dir, name);
  try {
    await readFile(file, 'utf8');
    name = `${route}-${stamp}-${digest.slice(0, 8)}.json`;
    file = join(dir, name);
  } catch { /* no collision */ }
  await writeFile(file, body, 'utf8');
  const snapshotId = `snap_${route}_${stamp}_${digest.slice(0, 12)}`;
  const record = { ...base, status: res.status, bytes, sha256: digest, snapshotId, file: `${day}/${name}` };
  await appendFetchRecord(archiveDir, record);
  return record;
}

// One full pass over all routes (sequential — the world is a neighbour, not
// a load test). Returns the fetch records.
export async function runPass(opts) {
  const records = [];
  for (const route of ROUTES) {
    records.push(await fetchRoute(route, opts));
  }
  return records;
}

async function main() {
  const args = process.argv.slice(2);
  const cadence = await loadCadence();
  const opt = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const archiveDir = opt('--archive') ?? join(HERE, 'archive');
  const baseUrl = opt('--base-url') ?? cadence.baseUrl;
  const common = { baseUrl, archiveDir, userAgent: cadence.userAgent, timeoutMs: cadence.timeoutMs };

  if (!args.includes('--watch')) {
    const records = await runPass(common);
    for (const r of records) {
      console.log(`${r.route}: status=${r.status} bytes=${r.bytes} snapshot=${r.snapshotId ?? (r.unchanged ? 'unchanged' : 'none')}${r.error ? ' error=' + r.error : ''}`);
    }
    return;
  }

  // Bonus: cadence-honouring watch loop. Every route is due immediately on
  // start, then per cadence.json routesSeconds — stretched by the error
  // backoff (nextDelaySeconds) while a route keeps failing.
  console.log('poller watch mode — Ctrl-C to stop');
  const due = new Map(ROUTES.map((r) => [r, 0]));
  const errorStreak = new Map(ROUTES.map((r) => [r, 0]));
  for (;;) {
    const nowMs = Date.now();
    for (const route of ROUTES) {
      if (due.get(route) <= nowMs) {
        const rec = await fetchRoute(route, common);
        console.log(`${rec.utc} ${route}: status=${rec.status}${rec.error ? ' error=' + rec.error : ''}`);
        const streak = rec.status === 200 ? 0 : errorStreak.get(route) + 1;
        errorStreak.set(route, streak);
        const cadenceSeconds = cadence.routesSeconds[route] ?? 300;
        due.set(route, Date.now() + nextDelaySeconds(cadenceSeconds, streak) * 1000);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('poller failed:', err);
    process.exitCode = 1;
  });
}
