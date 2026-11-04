// Elsewhere Portal — Arm A (Data): archive thinning (M1.09 / SE-1.4 /
// Plan B §2.2; WP-05 in plan-to-complete/04-coding.md).
//
// THE RETENTION POLICY (Owner ruling 2026-11-03, DECISIONS.md Item 4 —
// "Keep the recent window deep and thin the rest"; recorded in
// ARCH-LIVE.md's Retention policy section and in
// plan-to-complete/lane-archive-thinning.md):
//   THE DEEP WINDOW — every snapshot of every route captured within the
//   last 7 days is kept in full, at raw-snapshot level. One depth for
//   all routes, defended from the consumers: it is the deepest window
//   §2.2 already used (map); it covers the Chronicle's golden week
//   whole; it gives journey reconstruction and the corpus invariants a
//   week of continuous voices coverage to work over; it keeps a week
//   of verbatim replayable speech; and every live-surface provenance
//   trace (M6.06 — claims cite bundle-era snapshots) resolves to the
//   raw snapshot with days of margin.
//   Past the window, each route thins to its kept-resolution:
//   voices — body removed, replaced by speech-index rows in
//            derived/speech-index.jsonl: one row per utterance,
//            {placeCode, authorName, saidUtc, snapshotId, charCount} —
//            an index, not a copy of the speech. Utterances preserved
//            by the quotes registry (below) exempt their snapshot.
//   status — bodies dropped: fetch records (fetch-log.jsonl) and the
//            reset watch carry the transitions.
//   map    — only the LAST body of each day is kept. Namings/raisings
//            from removed bodies are preserved as dated facts in
//            derived/map-facts.jsonl.
//   overview, news, chats, debates, discussions, problems, concerts,
//   errata — and any future route — only the LAST body of each day is
//            kept; the day's other bodies are removed. These routes'
//            derived records live outside the snapshot store and never
//            thin (Growth counters/firsts are overview's diffs;
//            Chronicle items are news's headlines, admitted at derive
//            time), so a removed body still leaves: its chain record,
//            its thinning-manifest entry, a same-day surviving body,
//            and its derived facts. Past the window, a provenance trace
//            honestly resolves to that sealed record — chain hash +
//            manifest + world book — not to raw bytes.
//   AMENDMENTS to Plan B §2.2, both under the ruling: (1) the
//   voices/status depth goes 48 h → 7 days (the ruling's "deep");
//   (2) overview/news lose §2.2's never-thin status PAST the window —
//   "thin the rest" admits no unbounded raw route (news alone measured
//   ≈22 GB/yr unthinned on 2026-11-03); §2.2's intent for them (their
//   substance is their diffs) is preserved in the never-thin derived
//   layer named below.
//   NEVER THINS: the chain files (chain-<route>.jsonl — the proof the
//   removed bytes existed); fetch-log.jsonl (gap accounting, status
//   transitions); thinning-log.jsonl and thinning-manifests/; all of
//   derived/; quotes-registry.json; world-books.json; the newest
//   snapshot of every route; quotes-registry snapshots; golden
//   fixtures (exempt by path, WP-05 — nothing outside the archive is
//   ever touched anyway); every snapshot of a CLOSED world book
//   (§2.3: a closed book freezes read-only — sealed means sealed); and
//   every snapshot inside the current unjudged M1 window (next).
//   M1-WINDOW GUARD: a snapshot captured at or after the start of the
//   window currently under M1 judgement (health.json's a0 figure: the
//   end of the last unexplained gap) is never thinning-eligible,
//   whatever its route age — an exit read must judge the window
//   exactly as it ran. thinArchive resolves that floor from
//   health.json itself; an explicit protectFromUtc may extend the
//   protection, never shrink it. Thinning also cannot create or mask
//   a gap: gaps are computed from fetch-log records, which never thin.
//
// Safety invariant: thinning NEVER removes the newest snapshot of a
// route, so loadHead's inputs — and therefore the derived bundle — are
// unchanged by a thinning pass (this is what makes the WP-05 gate
// "re-derive over the thinned copy reproduces the bundle" pass by
// construction, and the gate is still run, below, as a check).
//
// AUTO-B11 PRECONDITIONS (expensive-reversal class — gates, not
// paperwork), enforced in code before any file is removed:
//   (a) A pre-thinning hash manifest of everything about to be thinned
//       is prepared, and every removal candidate is covered by the
//       snapshot hash chain: chain-<route>.jsonl must hold a record for
//       the file whose sha256 matches the file's actual bytes, AND
//       chain.mjs verify must pass over the whole archive with the
//       files present. Any gap aborts with nothing removed.
//   (b) The current bundle must be reproducible: it is rebuilt from the
//       pre-thinning archive into a temp feed and the citizens/world
//       sections are byte-compared against the live bundle (clock
//       fields bundleSeq and newestFetchUtc excluded — the established
//       purity approach: both are build-time stamps, not content).
//       A mismatch aborts with nothing removed.
//   (c) WP-05 gate: thinning is then applied to a COPY of the archive,
//       the bundle is rebuilt from the thinned copy, and the same
//       comparison must pass before the real archive is touched.
//
// Removed snapshots leave a record in archive/thinning-log.jsonl:
// one entry per (day, route): { utc, day, route, removed, removedFiles,
// keptFiles, manifest, manifestHash, chainHead, chainSeq }.
// The chain files themselves are NEVER thinned — they are the proof the
// removed bytes existed.
//
// CHAIN VERIFY AFTER THINNING — exact semantics: chain.mjs's verifyChain
// is the strict pre-thinning verifier and reports a thinned file as
// "snapshot file missing" (an error). Post-thinning verification is
// verifyWithThinning() below: seq/prev_hash linkage and captured_at are
// checked for every record as pure history; present files are byte- and
// edge-checked exactly as chain.mjs does; an ABSENT file is valid iff a
// thinning-log entry's manifest (whose own sha256 must match the log's
// manifestHash) lists that file with a sha256 equal to the chain
// record's. An absent file with no such coverage is an error, so an
// unrecorded deletion still fails verification.
//
// Quotes registry (REC-13): archive/quotes-registry.json,
// { version: 1, quotes: [{ snapshotId, ... }] }, created EMPTY by the
// first real run (and by ensureQuotesRegistry). M6.09's Chronicle is
// its only writer; a voices snapshot whose snapshotId is named in the
// registry is exempt from thinning.
//
// CLI:
//   node thinning.mjs plan   [--archive <dir>] [--now <iso>] [--protect-from <iso>]
//   node thinning.mjs run    [--archive <dir>] [--feed <dir>] [--now <iso>] [--protect-from <iso>]
//   node thinning.mjs verify [--archive <dir>] [--json]
// (--protect-from may extend the health-derived M1 floor, never shrink
// it; see resolveProtectFrom.)
//
// Node stdlib only. Companion to poller.mjs / chain.mjs / build-bundle.mjs.

import {
  appendFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshotName, readChain, sha256Hex, verifyAll, windowEdges, ROLLING_ROUTES } from './chain.mjs';
import { canonicalStringify, unfence } from './derive.mjs';
import { buildBundle } from './build-bundle.mjs';

// The deep window: one depth for every route (Owner ruling
// 2026-11-03). The per-class constants remain as names because the
// classes differ in kept-resolution, not in depth.
export const DEEP_WINDOW_MS = 7 * 24 * 3600 * 1000;
export const VOICES_WINDOW_MS = DEEP_WINDOW_MS;
export const STATUS_WINDOW_MS = DEEP_WINDOW_MS;
export const MAP_WINDOW_MS = DEEP_WINDOW_MS;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- archive scanning ----------

export async function listSnapshots(archiveDir) {
  const out = [];
  let days = [];
  try {
    days = (await readdir(archiveDir)).filter((d) => DAY_RE.test(d)).sort();
  } catch { return out; }
  for (const day of days) {
    let names = [];
    try {
      names = (await readdir(join(archiveDir, day))).sort();
    } catch { continue; }
    for (const name of names) {
      const parsed = parseSnapshotName(name);
      if (parsed) out.push({ rel: `${day}/${name}`, file: `${day}/${name}`, day, ...parsed });
    }
  }
  return out; // chronological per route by construction (day, then name)
}

// snap_<route>_<yyyymmddThhmmssZ>_<sha256[0:12]> (Plan B §2.2/§1.1 id
// shape). Prefers the fetch log's own record for the file.
export async function snapshotIdFor(archiveDir, rel, sha256) {
  try {
    const log = await readFile(join(archiveDir, 'fetch-log.jsonl'), 'utf8');
    for (const line of log.split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      if (r.file === rel && r.snapshotId) return r.snapshotId;
    }
  } catch { /* no fetch log — construct */ }
  const parsed = parseSnapshotName(rel);
  const stamp = parsed.capturedAt.replace(/[-:]/g, '');
  return `snap_${parsed.route}_${stamp}_${sha256.slice(0, 12)}`;
}

// ---------- quotes registry (REC-13) ----------

export function quotesRegistryPath(archiveDir) {
  return join(archiveDir, 'quotes-registry.json');
}

export async function loadQuotesRegistry(archiveDir) {
  try {
    const reg = JSON.parse(await readFile(quotesRegistryPath(archiveDir), 'utf8'));
    const ids = new Set();
    for (const q of Array.isArray(reg.quotes) ? reg.quotes : []) {
      if (typeof q === 'string') ids.add(q);
      else if (q && typeof q.snapshotId === 'string') ids.add(q.snapshotId);
    }
    return { exists: true, ids };
  } catch {
    return { exists: false, ids: new Set() };
  }
}

export async function ensureQuotesRegistry(archiveDir) {
  const { exists } = await loadQuotesRegistry(archiveDir);
  if (exists) return false;
  await writeFile(
    quotesRegistryPath(archiveDir),
    JSON.stringify({ version: 1, quotes: [] }, null, 2) + '\n',
    'utf8',
  );
  return true;
}

// ---------- protection floors (M1 window + sealed books) ----------

// The start of the window currently under M1 judgement, per health.mjs's
// A0 figure: the end of the last unexplained gap. Null when health.json
// is absent/unreadable or no gap has been recorded — in the live
// archive a lastGap exists, so the floor binds.
export async function judgementWindowStartUtc(archiveDir) {
  try {
    const health = JSON.parse(await readFile(join(archiveDir, 'health.json'), 'utf8'));
    const end = health?.a0?.lastGap?.endUtc;
    const ms = typeof end === 'string' ? Date.parse(end) : NaN;
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

// Closed world books as [from, to] capture ranges (world-books.json).
// §2.3: a closed book freezes read-only; its snapshots never thin.
export async function closedBookRanges(archiveDir) {
  try {
    const wb = JSON.parse(await readFile(join(archiveDir, 'world-books.json'), 'utf8'));
    return (Array.isArray(wb?.books) ? wb.books : [])
      .filter((b) => b && b.status === 'closed' && typeof b.opened_at === 'string' && typeof b.closed_at === 'string')
      .map((b) => ({ id: b.id, from: Date.parse(b.opened_at), to: Date.parse(b.closed_at) }))
      .filter((r) => Number.isFinite(r.from) && Number.isFinite(r.to));
  } catch {
    return [];
  }
}

function toMs(value) {
  if (value === null || value === undefined) return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// The effective protection floor: the EARLIER of the health-derived
// M1 floor and any explicit floor. The health floor always binds —
// an explicit protectFromUtc may extend protection to older material,
// but can never shrink it (a later explicit instant is ignored in
// favour of the health floor, so nothing inside the current unjudged
// window can be made eligible by passing a floor).
export async function resolveProtectFrom(archiveDir, explicit = null) {
  const floor = await judgementWindowStartUtc(archiveDir);
  const exp = toMs(explicit);
  const both = [floor, exp].filter((v) => v !== null);
  return both.length ? Math.min(...both) : null;
}

// ---------- the plan (pure retention math; no writes) ----------

// Returns { now, entries: [{file, route, day, capturedAt, reason}],
//           kept: [{file, route, day, capturedAt, reason}] }.
export async function planThinning(archiveDir, { now = Date.now(), exemptPaths = [], protectFromUtc = null } = {}) {
  const snapshots = await listSnapshots(archiveDir);
  const exempt = new Set(exemptPaths);
  const { ids: quotedIds } = await loadQuotesRegistry(archiveDir);
  const protectFromMs = toMs(protectFromUtc);
  const closedBooks = await closedBookRanges(archiveDir);

  const newestByRoute = new Map();
  for (const s of snapshots) newestByRoute.set(s.route, s.rel); // list is chronological

  const entries = [];
  const kept = [];
  const keep = (s, reason) => kept.push({ ...s, reason });
  const drop = (s, reason) => entries.push({ ...s, reason });

  // Last-of-day classes (every route except the voices/status drop
  // classes): per (route, day), the day's last body survives once that
  // body is itself past the deep window.
  const lastOfDayKeep = new Set();
  {
    const byRouteDay = new Map();
    for (const s of snapshots) {
      if (s.route === 'voices' || s.route === 'status') continue;
      const key = `${s.route}|${s.day}`;
      if (!byRouteDay.has(key)) byRouteDay.set(key, []);
      byRouteDay.get(key).push(s);
    }
    for (const snaps of byRouteDay.values()) {
      const last = snaps[snaps.length - 1];
      if (now - Date.parse(last.capturedAt) > DEEP_WINDOW_MS) lastOfDayKeep.add(last.rel);
    }
  }

  for (const s of snapshots) {
    const capturedMs = Date.parse(s.capturedAt);
    const age = now - capturedMs;
    if (exempt.has(s.rel)) { keep(s, 'exempt by path (golden fixture)'); continue; }
    if (newestByRoute.get(s.route) === s.rel) { keep(s, 'newest snapshot of route'); continue; }
    if (protectFromMs !== null && capturedMs >= protectFromMs) {
      keep(s, 'inside unjudged M1 window (protected)');
      continue;
    }
    const book = closedBooks.find((r) => capturedMs >= r.from && capturedMs <= r.to);
    if (book) { keep(s, `sealed world book ${book.id} (closed books never thin)`); continue; }
    if (age <= DEEP_WINDOW_MS) { keep(s, 'inside 7-day deep window'); continue; }
    if (s.route === 'voices') {
      const sha = sha256Hex(await readFile(join(archiveDir, s.rel)));
      const id = await snapshotIdFor(archiveDir, s.rel, sha);
      if (quotedIds.has(id)) { keep(s, 'quoted utterance preserved (quotes registry)'); continue; }
      drop(s, 'voices body past deep window -> speech index');
    } else if (s.route === 'status') {
      drop(s, 'status body past deep window (fetch records carry transitions)');
    } else if (lastOfDayKeep.has(s.rel)) {
      keep(s, `last ${s.route} body of its day`);
    } else if (s.route === 'map') {
      drop(s, 'map body past deep window, not last of day -> dated facts');
    } else {
      drop(s, `${s.route} body past deep window, not last of day (sealed book: chain + manifest)`);
    }
  }
  return { now: new Date(now).toISOString(), entries, kept };
}

// ---------- derived replacements ----------

// One speech-index row per utterance in a voices body (SE-1.4 shape).
export function speechIndexRows(body, snapshotId) {
  const rows = [];
  for (const place of Array.isArray(body?.places) ? body.places : []) {
    for (const said of Array.isArray(place?.said) ? place.said : []) {
      if (!said || typeof said.said !== 'string') continue;
      rows.push({
        placeCode: typeof place.code === 'string' ? place.code : null,
        authorName: typeof said.by === 'string' ? said.by : null,
        saidUtc: typeof said.at === 'string' ? said.at : null,
        snapshotId,
        charCount: said.said.length,
      });
    }
  }
  return rows;
}

// Namings/raisings from a map body, as dated facts (Plan B §2.2: kept in
// derived/). Names arrive fenced as untrusted data; unfence() strips the
// markers for the record, exactly as the deriver presents them.
export function mapFactRows(body, snapshotId, capturedAt) {
  const rows = [];
  for (const n of Array.isArray(body?.names) ? body.names : []) {
    if (!Array.isArray(n) || typeof n[2] !== 'string') continue;
    rows.push({
      kind: 'naming', snapshotId, capturedAt,
      cell: [n[0], n[1]], name: unfence(n[2]),
      creditedTo: typeof n[3] === 'string' ? unfence(n[3]) : null,
    });
  }
  for (const st of Array.isArray(body?.structures) ? body.structures : []) {
    if (!Array.isArray(st) || typeof st[2] !== 'string') continue;
    rows.push({
      kind: 'structure', snapshotId, capturedAt,
      cell: [st[0], st[1]], code: st[2],
    });
  }
  return rows;
}

// ---------- bundle reproduction (AUTO-B11 precondition (b)) ----------

// Clock fields excluded per the established purity approach.
export function stripClockFields(worldData) {
  const { bundleSeq, newestFetchUtc, ...rest } = worldData;
  return rest;
}

export function bundlesMatch(rebuilt, live) {
  const a = stripClockFields(rebuilt);
  const b = stripClockFields(live);
  return {
    citizens: canonicalStringify(a.citizens ?? null) === canonicalStringify(b.citizens ?? null),
    world: canonicalStringify(a.world ?? null) === canonicalStringify(b.world ?? null),
    full: canonicalStringify(a) === canonicalStringify(b),
  };
}

async function rebuildAndCompare(archiveDir, liveWorldData) {
  const tmp = await mkdtemp(join(tmpdir(), 'portal-thin-repro-'));
  try {
    const { worldData } = await buildBundle({ archiveDir, feedDir: tmp });
    return bundlesMatch(worldData, liveWorldData);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// ---------- the run ----------

function abort(reason, extra = {}) {
  return { ok: false, aborted: true, reason, removed: 0, ...extra };
}

// Full thinning pass. dryRun returns the plan only and writes nothing.
// On abort: nothing is removed, no log/manifest/derived writes persist
// (precondition checks all complete before the first mutation).
export async function thinArchive(archiveDir, { feedDir, now = Date.now(), dryRun = false, exemptPaths = [], protectFromUtc = null } = {}) {
  // The M1-window guard is structural, not caller discipline: the floor
  // is resolved here from health.json and can only be extended by the
  // caller's explicit protectFromUtc, never shrunk (resolveProtectFrom).
  const protectMs = await resolveProtectFrom(archiveDir, protectFromUtc);
  const protectIso = protectMs === null ? null : new Date(protectMs).toISOString();
  const plan = await planThinning(archiveDir, { now, exemptPaths, protectFromUtc: protectMs });
  if (dryRun) return { ok: true, dryRun: true, protectFromUtc: protectIso, plan };
  if (plan.entries.length === 0) {
    await ensureQuotesRegistry(archiveDir);
    return { ok: true, removed: 0, protectFromUtc: protectIso, plan, note: 'nothing eligible for thinning' };
  }

  // Hash every candidate from its actual bytes.
  for (const e of plan.entries) {
    const raw = await readFile(join(archiveDir, e.file));
    e.sha256 = sha256Hex(raw);
    e.bytes = raw.length;
    e.snapshotId = await snapshotIdFor(archiveDir, e.file, e.sha256);
  }

  // Precondition (a): chain coverage + full chain verify, files present.
  const chainsByRoute = new Map();
  for (const e of plan.entries) {
    if (!chainsByRoute.has(e.route)) {
      chainsByRoute.set(e.route, await readChain(join(archiveDir, `chain-${e.route}.jsonl`)));
    }
    const rec = chainsByRoute.get(e.route).find((r) => r.file === e.file);
    if (!rec) return abort(`AUTO-B11(a): no chain record covers ${e.file}; thinning aborted, nothing removed`);
    if (rec.sha256 !== e.sha256) {
      return abort(`AUTO-B11(a): chain sha256 for ${e.file} (${rec.sha256}) != file bytes (${e.sha256}); thinning aborted, nothing removed`);
    }
    e.chainSeq = rec.seq;
  }
  const verifyResults = await verifyAll(archiveDir);
  const bad = verifyResults.filter((r) => !r.ok);
  if (bad.length) {
    return abort(`AUTO-B11(a): chain verify fails with files present (${bad.map((r) => `${r.route}: ${r.errors[0]}`).join('; ')}); thinning aborted, nothing removed`);
  }

  // Live bundle (required for precondition (b)).
  let liveWorldData;
  try {
    liveWorldData = JSON.parse(await readFile(join(feedDir, 'world-data.json'), 'utf8'));
  } catch (err) {
    return abort(`AUTO-B11(b): live bundle unreadable at ${feedDir} (${err.message}); thinning aborted, nothing removed`);
  }

  // Precondition (b): rebuild from the pre-thinning archive.
  const pre = await rebuildAndCompare(archiveDir, liveWorldData);
  if (!pre.citizens || !pre.world || !pre.full) {
    return abort(`AUTO-B11(b): bundle rebuilt from pre-thinning archive does not reproduce the live bundle (citizens=${pre.citizens} world=${pre.world} full=${pre.full}); thinning aborted, nothing removed`);
  }

  // Gate (c): apply removals to a copy; the thinned copy must still
  // reproduce the live bundle before the real archive is touched.
  const copyDir = await mkdtemp(join(tmpdir(), 'portal-thin-copy-'));
  const copyArchive = join(copyDir, 'archive');
  try {
    await cp(archiveDir, copyArchive, { recursive: true });
    for (const e of plan.entries) await rm(join(copyArchive, e.file));
    const post = await rebuildAndCompare(copyArchive, liveWorldData);
    if (!post.citizens || !post.world || !post.full) {
      return abort(`WP-05 gate: bundle rebuilt from the thinned copy does not reproduce the live bundle (citizens=${post.citizens} world=${post.world} full=${post.full}); thinning aborted, nothing removed`);
    }
  } finally {
    await rm(copyDir, { recursive: true, force: true });
  }

  // All preconditions passed. Build the derived replacements from the
  // real bodies BEFORE deleting anything.
  const speechRows = [];
  const factRows = [];
  for (const e of plan.entries) {
    const body = JSON.parse(await readFile(join(archiveDir, e.file), 'utf8'));
    if (e.route === 'voices') speechRows.push(...speechIndexRows(body, e.snapshotId));
    if (e.route === 'map') factRows.push(...mapFactRows(body, e.snapshotId, e.capturedAt));
  }

  await ensureQuotesRegistry(archiveDir);
  const derivedDir = join(archiveDir, 'derived');
  await mkdir(derivedDir, { recursive: true });
  if (speechRows.length) {
    await appendFile(join(derivedDir, 'speech-index.jsonl'), speechRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  if (factRows.length) {
    await appendFile(join(derivedDir, 'map-facts.jsonl'), factRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }

  // Persist the pre-thinning hash manifest, then the thinning log, then
  // remove the files (log before removal: a crash mid-removal still
  // leaves the record that explains every absent file).
  const runId = `thin-${new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
  const manifest = {
    runId,
    createdUtc: new Date(now).toISOString(),
    rule: 'Owner ruling 2026-11-03 (deep window 7 d; thin the rest) / Plan B §2.2 classes as amended / AUTO-B11',
    protectFromUtc: protectIso,
    entries: plan.entries.map((e) => ({
      file: e.file, route: e.route, day: e.day, capturedAt: e.capturedAt,
      sha256: e.sha256, bytes: e.bytes, chainSeq: e.chainSeq,
      snapshotId: e.snapshotId, reason: e.reason,
    })),
    speechIndexRows: speechRows.length,
    mapFactRows: factRows.length,
  };
  const manifestRel = `thinning-manifests/${runId}.json`;
  await mkdir(join(archiveDir, 'thinning-manifests'), { recursive: true });
  const manifestBytes = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(join(archiveDir, manifestRel), manifestBytes, 'utf8');
  const manifestHash = sha256Hex(Buffer.from(manifestBytes, 'utf8'));

  const chainHeadByRoute = new Map();
  for (const [route, records] of chainsByRoute) {
    const last = records[records.length - 1];
    chainHeadByRoute.set(route, { seq: last.seq, sha256: last.sha256 });
  }
  const removedSet = new Set(plan.entries.map((e) => e.file));
  const groups = new Map();
  for (const e of plan.entries) {
    const key = `${e.day}|${e.route}`;
    if (!groups.has(key)) groups.set(key, { day: e.day, route: e.route, files: [] });
    groups.get(key).files.push(e.file);
  }
  const logEntries = [];
  for (const g of [...groups.values()].sort((a, b) => (a.day + a.route).localeCompare(b.day + b.route))) {
    const keptFiles = (await listSnapshots(archiveDir))
      .filter((s) => s.day === g.day && s.route === g.route && !removedSet.has(s.rel))
      .map((s) => s.rel);
    const head = chainHeadByRoute.get(g.route);
    logEntries.push({
      utc: new Date(now).toISOString(),
      day: g.day,
      route: g.route,
      removed: g.files.length,
      removedFiles: g.files,
      keptFiles,
      manifest: manifestRel,
      manifestHash,
      chainHead: head.sha256,
      chainSeq: head.seq,
    });
  }
  await appendFile(
    join(archiveDir, 'thinning-log.jsonl'),
    logEntries.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );

  for (const e of plan.entries) await rm(join(archiveDir, e.file));

  return {
    ok: true,
    removed: plan.entries.length,
    protectFromUtc: protectIso,
    bytesReclaimed: plan.entries.reduce((n, e) => n + e.bytes, 0),
    speechIndexRows: speechRows.length,
    mapFactRows: factRows.length,
    manifest: manifestRel,
    manifestHash,
    logEntries,
    plan,
  };
}

// ---------- thinning-aware chain verification ----------

// Coverage: file -> { sha256, manifestHash } from thinning-log entries
// whose manifests are present and hash to the logged manifestHash.
export async function thinningCoverage(archiveDir) {
  const coverage = new Map();
  const problems = [];
  let log = [];
  try {
    const raw = await readFile(join(archiveDir, 'thinning-log.jsonl'), 'utf8');
    log = raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch { /* no thinning yet — empty coverage */ }
  const manifests = new Map();
  for (const entry of log) {
    if (!manifests.has(entry.manifest)) {
      try {
        const bytes = await readFile(join(archiveDir, entry.manifest));
        const actual = sha256Hex(bytes);
        if (actual !== entry.manifestHash) {
          problems.push(`manifest ${entry.manifest} hashes to ${actual}, log says ${entry.manifestHash}`);
          manifests.set(entry.manifest, null);
        } else {
          manifests.set(entry.manifest, JSON.parse(bytes.toString('utf8')));
        }
      } catch {
        problems.push(`manifest ${entry.manifest} named in thinning log is missing`);
        manifests.set(entry.manifest, null);
      }
    }
    const manifest = manifests.get(entry.manifest);
    if (!manifest) continue;
    for (const me of manifest.entries ?? []) {
      coverage.set(me.file, { sha256: me.sha256, manifestHash: entry.manifestHash });
    }
  }
  return { coverage, problems };
}

// verifyChain's semantics, extended for a thinned archive (see header).
export async function verifyWithThinning(archiveDir) {
  const { coverage, problems } = await thinningCoverage(archiveDir);
  const names = (await readdir(archiveDir)).filter((n) => /^chain-.+\.jsonl$/.test(n)).sort();
  const results = [];
  for (const name of names) {
    const chainPath = join(archiveDir, name);
    const route = name.replace(/^chain-/, '').replace(/\.jsonl$/, '');
    const records = await readChain(chainPath);
    const errors = [...problems.filter((p) => p.includes(route))];
    let prevHash = null;
    let thinned = 0;
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const where = `seq ${rec.seq ?? i + 1}`;
      if (rec.seq !== i + 1) errors.push(`${where}: seq discontinuity (expected ${i + 1}, found ${rec.seq})`);
      if (rec.route !== route) errors.push(`${where}: route mismatch (${rec.route} != ${route})`);
      if (rec.prev_hash !== prevHash) errors.push(`${where}: prev_hash break (expected ${prevHash}, found ${rec.prev_hash})`);
      const parsed = parseSnapshotName(rec.file ?? '');
      if (!parsed) {
        errors.push(`${where}: unparseable snapshot filename ${rec.file}`);
        prevHash = rec.sha256;
        continue;
      }
      if (parsed.capturedAt !== rec.captured_at) {
        errors.push(`${where}: captured_at ${rec.captured_at} != filename stamp ${parsed.capturedAt}`);
      }
      let raw = null;
      try {
        raw = await readFile(join(archiveDir, rec.file));
      } catch { raw = null; }
      if (raw === null) {
        const cov = coverage.get(rec.file);
        if (!cov) {
          errors.push(`${where}: snapshot file missing and NOT covered by any thinning record: ${rec.file}`);
        } else if (cov.sha256 !== rec.sha256) {
          errors.push(`${where}: thinning manifest sha256 ${cov.sha256} != chain sha256 ${rec.sha256} for ${rec.file}`);
        } else {
          thinned++;
        }
        prevHash = rec.sha256;
        continue;
      }
      const actual = sha256Hex(raw);
      if (actual !== rec.sha256) errors.push(`${where}: sha256 mismatch for ${rec.file} (chain ${rec.sha256}, actual ${actual})`);
      if (ROLLING_ROUTES.includes(route)) {
        let body = null;
        try { body = JSON.parse(raw.toString('utf8')); } catch { body = null; }
        const edges = body ? windowEdges(route, body) : { oldest: null, newest: null };
        if (JSON.stringify(edges.oldest) !== JSON.stringify(rec.window_oldest ?? null)) {
          errors.push(`${where}: window_oldest mismatch for ${rec.file}`);
        }
        if (JSON.stringify(edges.newest) !== JSON.stringify(rec.window_newest ?? null)) {
          errors.push(`${where}: window_newest mismatch for ${rec.file}`);
        }
      }
      prevHash = rec.sha256;
    }
    // Manifest entries must correspond to real chain records (no phantom
    // thinning): every covered file for this route must be in the chain.
    const chainedFiles = new Set(records.map((r) => r.file));
    for (const [file] of coverage) {
      const parsed = parseSnapshotName(file);
      if (parsed?.route === route && !chainedFiles.has(file)) {
        errors.push(`thinning manifest covers ${file}, which has no chain record`);
      }
    }
    results.push({ ok: errors.length === 0, route, records: records.length, thinned, errors });
  }
  return results;
}

// ---------- CLI ----------

async function main(argv) {
  const [cmd, ...rest] = argv;
  const here = dirname(fileURLToPath(import.meta.url));
  const opt = (flag, fallback) => {
    const i = rest.indexOf(flag);
    return i >= 0 ? rest[i + 1] : fallback;
  };
  const archiveDir = opt('--archive', join(here, 'archive'));
  const nowArg = opt('--now', null);
  const now = nowArg ? Date.parse(nowArg) : Date.now();
  const protectFromUtc = opt('--protect-from', null);
  if (cmd === 'plan') {
    const protectMs = await resolveProtectFrom(archiveDir, protectFromUtc);
    const plan = await planThinning(archiveDir, { now, protectFromUtc: protectMs });
    const byRoute = {};
    for (const e of plan.entries) byRoute[e.route] = (byRoute[e.route] ?? 0) + 1;
    console.log(JSON.stringify({
      dryRun: true, now: plan.now,
      protectFromUtc: protectMs === null ? null : new Date(protectMs).toISOString(),
      eligible: plan.entries.length, byRoute,
      entries: plan.entries.map((e) => ({ file: e.file, reason: e.reason })),
    }, null, 2));
    return 0;
  }
  if (cmd === 'run') {
    const feedDir = opt('--feed', join(here, 'feed'));
    const result = await thinArchive(archiveDir, { feedDir, now, protectFromUtc });
    console.log(JSON.stringify({ ...result, plan: undefined }, null, 2));
    return result.ok ? 0 : 1;
  }
  if (cmd === 'verify') {
    const results = await verifyWithThinning(archiveDir);
    if (rest.includes('--json')) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      for (const r of results) {
        console.log(`${r.route}: ${r.ok ? 'OK' : 'FAIL'} (${r.records} records, ${r.thinned} thinned)`);
        for (const e of r.errors) console.log(`  ERROR ${e}`);
      }
    }
    return results.every((r) => r.ok) ? 0 : 1;
  }
  console.error('usage: node thinning.mjs plan|run|verify [--archive <dir>] [--feed <dir>] [--now <iso>]');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
