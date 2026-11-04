// Elsewhere Portal — Arm A (Data): CORPUS INVARIANT RUN + STUCK-ACTOR
// CHECK (M3.05 / Lead M3.4). Supervisor-adjacent: the archiver hook
// (see INVARIANTS-HOOK-SPEC.md) runs this after the facts step; it is
// read-only over the archive and writes exactly one artefact,
// archive/invariants.json (temp + rename, only after a full successful
// build — a failed run keeps the previous report, and health.json shows
// that report's generatedAtUtc, so staleness is visible, never hidden).
// health.mjs surfaces a compact summary of this report as the
// `invariants` section of archive/health.json.
//
// THE CORPUS (explicit — this is the definition every count below uses):
// the open world-book in archive/world-books.json, and every voices +
// news snapshot the archiver captured inside it. From the voices
// snapshots: the union of utterances (by utterance id — the rolling
// window repeats them across snapshots; each recorded utterance counts
// once), each carrying its speaker, its place code, and its stamp.
// From the news snapshots: the resident roster names. Nothing else is
// in the corpus: no chats text, no bundle history (the feed retains
// none), no Tier A anything.
//
// TWO JOURNEY SETS are checked with THE SAME checker
// (build/engine/invariant.mjs — the §7.3 implementation the synthetic
// suite gates on; there is no second checker):
//
//   reconstructed — the M3.01 journeys (journeys-cycle.mjs's
//   buildJourneys over this same archive): one leg per coverage-gated
//   place change, scheduled inside its evidence window. This is the
//   set the plan names. Its count is whatever the record supports
//   under M3.01's adopted ceiling — today that is honestly small (the
//   ceiling requires continuous archiver coverage across the whole
//   evidence window, and continuous coverage began at A0).
//
//   evidencePaths — the fallback the M3.05 brief orders when the
//   reconstructed set cannot yet carry the run: every journey-like
//   path the record supports today. Per speaker, utterances merge into
//   place runs; consecutive distinct places form legs (departure bound
//   = last utterance at the origin, arrival bound = first utterance at
//   the destination — the episodes/M3.01 evidence rule). Legs are
//   scheduled back-to-back from the first leg's departure tick (dwell
//   between an arrival and the next departure evidence is absorbed
//   into the following leg's window — this set is a checker corpus,
//   not a presentation; M3.01's journeys are the presentation). A leg
//   the layout graph cannot walk (a place code the authored layout
//   does not carry — frontier cells, the staged-fill plot — or no
//   route between two carried places) is EXCLUDED, counted, and listed
//   with its reason: the invariant governs walks on the graph, and an
//   off-graph leg is reported, never silently dropped and never
//   force-walked. Maximal walkable runs become the journeys checked.
//
// TICKS: book-relative, tick = floor((ms - bookOpenedMs) / 30_000),
// matching journeys.mjs's convention (TICK_MS, tickEpochUtc = the
// book's opened_at) and the engine's TICK_SECONDS = 30.
//
// MUTANT CONTROL: every checked set is also run under the teleporting
// mutant (invariant.mjs). The mutant is applicable to a journey with
// totalWorldTicks > 0 (the synthetic suite's rule); the control passes
// only when the checker catches the mutant on EVERY applicable
// journey. A missed mutant means the checker is broken at corpus
// scale, and the report says so in the verdict.
//
// STUCK-ACTOR CHECK — a REPORT, never a state change. Definition (the
// plan names the check without defining it; this is the definition
// used, stated here so it can be argued with): a citizen on the corpus
// roster (voices speakers ∪ news residents, by record name — records
// are NOT merged; the name is used only to ask "did this name ever
// speak?", the conservative direction for a check whose failure mode
// is a false flag) is a stuck SUSPECT when, across the full corpus
// window, they have NO utterances at all — no speech, and therefore no
// evidenced place — while the world clock advanced across the window
// (first to last corpus snapshot). A suspect is a question for a
// human: a quiet citizen is legitimate (the voices window is not the
// whole world), and so is a resident the record knows only from the
// news roster. The check exists so that a derivation bug freezing
// someone's evidence would be NOTICED, not so that quiet citizens get
// relabelled. Speakers who spoke but never changed place are counted
// separately as stayed-put — explicitly NOT suspects.
//
// OVER-LONG BEATS (the plan's "waiting / catching up" flag): a leg
// whose scheduled window exceeds SUMMARY_ABSENCE_TICKS (120 ticks =
// 1 h — the §3.4 threshold past which playback stops replaying and
// summarises) is an over-long beat: at presentation it would raise
// "waiting / catching up", never a sped-up walk. Counted and listed.
//
// FOLLOW-UP (named, per the M3.05 brief): the M3.01 integration is
// WIRED (the reconstructed section above). The remaining follow-up is
// temporal, not structural: as the post-A0 corpus grows, the
// reconstructed set becomes the primary corpus and the evidence-paths
// set demotes to a cross-check; and this script's supervisor hook
// (INVARIANTS-HOOK-SPEC.md) is applied by the established restart
// discipline, separately from this build.
//
// Usage: node corpus-invariants.mjs [--archive <dir>] [--layout <file>]
//          [--out <file>] [--now <iso>]
// Defaults: the live archive, build/shared/ember-layout.json,
// <archive>/invariants.json. Node stdlib only (project modules aside).

import { readFile, writeFile, rename, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planJourney, positionAt, SUMMARY_ABSENCE_TICKS, TICK_SECONDS } from '../engine/playback.mjs';
import { checkContinuity, mutantPositionAt } from '../engine/invariant.mjs';
import { findRoute, nodeByCode } from '../engine/astar.mjs';
import { cmpStr, isPlainObject, unfence } from './derive.mjs';
import { buildJourneys, loadOpenBook } from './journeys-cycle.mjs';
import { stampOfSnapshotFile } from './build-bundle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const INVARIANTS_SCHEMA = 'portal.invariants/v1';
export const TICK_MS = TICK_SECONDS * 1000;
const EXAMPLE_CAP = 5;

// ---------------------------------------------------------------- corpus load

// Snapshot files for one route inside the book window, capture-ordered.
// Capture time comes from the filename stamp (the archiver's naming
// convention, shared with build-bundle.mjs's stampOfSnapshotFile).
async function loadRouteSnapshots(archiveDir, route, bookOpenedMs) {
  const out = [];
  const dateDirs = (await readdir(archiveDir, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort(cmpStr);
  for (const dir of dateDirs) {
    const names = (await readdir(join(archiveDir, dir)).catch(() => []))
      .filter((n) => n.startsWith(`${route}-`) && n.endsWith('.json'))
      .sort(cmpStr);
    for (const name of names) {
      const rel = `${dir}/${name}`;
      const stamp = stampOfSnapshotFile(rel);
      const capturedMs = stamp ? Date.parse(stamp) : NaN;
      if (!Number.isFinite(capturedMs) || capturedMs < bookOpenedMs) continue;
      try {
        const data = JSON.parse(await readFile(join(archiveDir, rel), 'utf8'));
        out.push({ file: rel, capturedMs, data });
      } catch { /* a torn snapshot is skipped, never fatal — the chain records it */ }
    }
  }
  out.sort((a, b) => a.capturedMs - b.capturedMs || cmpStr(a.file, b.file));
  return out;
}

/**
 * loadEvidenceCorpus({archiveDir}) -> the corpus as defined in the
 * header: book, snapshots, the utterance union, per-speaker streams,
 * the roster, and the window bounds (first/last corpus snapshot).
 */
export async function loadEvidenceCorpus({ archiveDir }) {
  const book = await loadOpenBook(archiveDir);
  if (!book) {
    throw new Error('corpus-invariants: no open world-book in archive/world-books.json — the corpus is book-scoped');
  }
  const bookOpenedMs = Date.parse(book.openedAtUtc);
  const voicesSnapshots = await loadRouteSnapshots(archiveDir, 'voices', bookOpenedMs);
  const newsSnapshots = await loadRouteSnapshots(archiveDir, 'news', bookOpenedMs);
  if (!voicesSnapshots.length) throw new Error('corpus-invariants: no voices snapshots in the open world-book');

  // The utterance union: by id, first capture wins (the record of an
  // utterance does not change between snapshots of the rolling window).
  const utterancesById = new Map();
  for (const snap of voicesSnapshots) {
    for (const place of Array.isArray(snap.data?.places) ? snap.data.places : []) {
      if (!isPlainObject(place) || typeof place.code !== 'string') continue;
      for (const said of Array.isArray(place.said) ? place.said : []) {
        if (!isPlainObject(said) || typeof said.id !== 'string') continue;
        if (typeof said.by !== 'string' || typeof said.at !== 'string') continue;
        if (utterancesById.has(said.id)) continue;
        const atMs = Date.parse(said.at);
        if (!Number.isFinite(atMs)) continue;
        utterancesById.set(said.id, {
          id: said.id,
          atUtc: said.at,
          atMs,
          name: unfence(said.by),
          placeCode: place.code,
        });
      }
    }
  }

  const streams = new Map(); // speaker name -> utterances, time-ordered
  for (const u of utterancesById.values()) {
    if (!streams.has(u.name)) streams.set(u.name, []);
    streams.get(u.name).push(u);
  }
  for (const list of streams.values()) {
    list.sort((a, b) => a.atMs - b.atMs || cmpStr(a.id, b.id));
  }

  const roster = new Set(streams.keys());
  for (const snap of newsSnapshots) {
    for (const r of Array.isArray(snap.data?.residents) ? snap.data.residents : []) {
      if (isPlainObject(r) && typeof r.handle === 'string') roster.add(unfence(r.handle));
    }
  }

  const allSnaps = [...voicesSnapshots, ...newsSnapshots];
  const windowStartMs = Math.min(...allSnaps.map((s) => s.capturedMs));
  const windowEndMs = Math.max(...allSnaps.map((s) => s.capturedMs));

  return {
    book,
    bookOpenedMs,
    voicesSnapshots,
    newsSnapshots,
    utterancesById,
    streams,
    roster,
    windowStartMs,
    windowEndMs,
  };
}

// ------------------------------------------------------- evidence-path journeys

const tickOf = (ms, epochMs) => Math.floor((ms - epochMs) / TICK_MS);

// One speaker's utterances -> place runs: maximal consecutive stretches
// at one place. A leg joins run i to run i+1 (departure bound = the
// run's last utterance, arrival bound = the next run's first).
function placeRuns(utterances) {
  const runs = [];
  for (const u of utterances) {
    const last = runs[runs.length - 1];
    if (last && last.placeCode === u.placeCode) {
      last.lastMs = u.atMs;
      last.lastUtc = u.atUtc;
      last.count += 1;
    } else {
      runs.push({
        placeCode: u.placeCode,
        firstMs: u.atMs,
        firstUtc: u.atUtc,
        lastMs: u.atMs,
        lastUtc: u.atUtc,
        count: 1,
      });
    }
  }
  return runs;
}

/**
 * evidenceJourneys(corpus, layout) -> per speaker, the maximal
 * walkable segments of their evidenced place sequence, as engine
 * journeys; plus every excluded leg with its reason. See the header
 * for the scheduling rule (dwell absorbed; checker corpus, not
 * presentation).
 */
export function evidenceJourneys(corpus, layout) {
  const journeys = [];
  const exclusions = [];
  let legsTotal = 0;

  const speakers = [...corpus.streams.entries()].sort((a, b) => cmpStr(a[0], b[0]));
  for (const [name, utterances] of speakers) {
    const runs = placeRuns(utterances);
    if (runs.length < 2) continue;

    // Legs between consecutive runs, each pre-validated against the graph.
    const legs = [];
    for (let i = 0; i + 1 < runs.length; i++) {
      const from = runs[i];
      const to = runs[i + 1];
      legsTotal += 1;
      const leg = {
        from: from.placeCode,
        to: to.placeCode,
        departTick: tickOf(from.lastMs, corpus.bookOpenedMs),
        arriveTick: tickOf(to.firstMs, corpus.bookOpenedMs),
      };
      leg.worldTicks = Math.max(0, leg.arriveTick - leg.departTick);
      if (!nodeByCode(layout, leg.from) || !nodeByCode(layout, leg.to)) {
        leg.excluded = 'place-not-in-layout';
      } else if (!findRoute(layout, leg.from, leg.to)) {
        leg.excluded = 'no-route';
      }
      legs.push(leg);
    }

    // Maximal walkable segments; an excluded leg splits the journey.
    let segment = [];
    const flush = () => {
      if (!segment.length) return;
      const path = [segment[0].from, ...segment.map((l) => l.to)];
      journeys.push({
        citizen: name,
        journey: planJourney({
          handle: name,
          path,
          startTick: segment[0].departTick,
          ticksPerStep: segment.map((l) => l.worldTicks),
        }),
        legs: segment.length,
      });
      segment = [];
    };
    for (const leg of legs) {
      if (leg.excluded) {
        exclusions.push({ citizen: name, from: leg.from, to: leg.to, reason: leg.excluded });
        flush();
      } else {
        segment.push(leg);
      }
    }
    flush();
  }
  return { journeys, exclusions, legsTotal };
}

// ------------------------------------------------------------------ check runs

// Run the real positionAt and the mutant over one journey set.
function checkSet(entries, layout) {
  let totalViolations = 0;
  const examples = [];
  let mutantApplicable = 0;
  let mutantCaught = 0;
  for (const { citizen, journey } of entries) {
    const violations = checkContinuity(positionAt, journey, layout);
    totalViolations += violations.length;
    for (const v of violations) {
      if (examples.length < EXAMPLE_CAP) examples.push(`${citizen}: ${v}`);
    }
    if (journey.totalWorldTicks > 0) {
      mutantApplicable += 1;
      if (checkContinuity(mutantPositionAt, journey, layout).length > 0) mutantCaught += 1;
    }
  }
  return {
    checked: entries.length,
    violations: { count: totalViolations, examples },
    mutantControl: {
      applicable: mutantApplicable,
      caught: mutantCaught,
      verdict:
        mutantApplicable === 0
          ? 'not-applicable (no timed journey in the set)'
          : mutantCaught === mutantApplicable
            ? 'caught on every applicable journey'
            : `MISSED on ${mutantApplicable - mutantCaught} of ${mutantApplicable} — the checker is broken at corpus scale`,
    },
  };
}

// ----------------------------------------------------------------- stuck check

/**
 * stuckActorCheck(corpus) — the definition in the header, applied.
 * Returns suspects (roster names with no utterances at all) and the
 * stayed-put speakers (spoke, never changed place — NOT suspects).
 */
export function stuckActorCheck(corpus) {
  const suspects = [];
  for (const name of [...corpus.roster].sort(cmpStr)) {
    if (!corpus.streams.has(name)) {
      suspects.push({
        name,
        basis:
          'on the corpus roster (news residents) with no utterances in the voices corpus — ' +
          'no speech and no evidenced place across the whole window. A question, not an ' +
          'accusation: a quiet citizen is legitimate.',
      });
    }
  }
  const stayedPut = [];
  for (const [name, utterances] of [...corpus.streams.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    if (new Set(utterances.map((u) => u.placeCode)).size === 1) stayedPut.push(name);
  }
  return {
    definition:
      'no utterances at all across the full corpus window (no speech, therefore no ' +
      'evidenced place) while the world clock advanced across the window; roster = ' +
      'voices speakers ∪ news resident names, records never merged — the name only ' +
      'asks whether it ever spoke.',
    windowHours: Math.round(((corpus.windowEndMs - corpus.windowStartMs) / 3600000) * 1000) / 1000,
    suspects,
    stayedPutCount: stayedPut.length,
    stayedPutNames: stayedPut,
  };
}

// ------------------------------------------------------------------ the report

/**
 * buildCorpusReport({archiveDir, layout, now}) -> the
 * portal.invariants/v1 report (see the header for every definition).
 */
export async function buildCorpusReport({ archiveDir, layout, now = new Date() }) {
  const corpus = await loadEvidenceCorpus({ archiveDir });

  // Reconstructed set (M3.01 integration — the plan's named corpus).
  // M3.01's ceiling is evidence-based, not graph-based: a journey can
  // reconstruct to a place the authored layout does not carry (a
  // frontier cell). The engine cannot walk such a journey, so it is
  // counted and listed as not-walkable — reported, never silently
  // dropped and never force-walked (the evidence-paths rule, applied
  // to the reconstructed set too).
  const { doc: journeysDoc } = await buildJourneys({ archiveDir });
  const reconstructedEntries = [];
  const reconstructedNotWalkable = [];
  for (const j of Array.isArray(journeysDoc?.journeys) ? journeysDoc.journeys : []) {
    const citizen = j.citizenKey ?? j.citizen ?? 'unknown';
    const walkable =
      Array.isArray(j.path) &&
      j.path.length >= 2 &&
      j.path.every((code) => nodeByCode(layout, code)) &&
      j.path.slice(0, -1).every((code, i) => findRoute(layout, code, j.path[i + 1]));
    if (!walkable) {
      reconstructedNotWalkable.push({ citizen, path: j.path ?? null, reason: 'place-not-in-layout or no-route' });
      continue;
    }
    reconstructedEntries.push({
      citizen,
      journey: planJourney({
        handle: j.citizenKey ?? 'journey',
        path: j.path,
        startTick: j.departureTick,
        ticksPerStep: j.worldTicks,
      }),
    });
  }
  const reconstructed = checkSet(reconstructedEntries, layout);

  // Evidence-path set (the fallback corpus — see header).
  const { journeys: evidenceEntries, exclusions, legsTotal } = evidenceJourneys(corpus, layout);
  const evidencePaths = checkSet(evidenceEntries, layout);

  // Over-long beats across the evidence paths (the presentation set
  // M3.01 produces has its own windows; the beats the record supports
  // today are these legs).
  const overLong = [];
  for (const { citizen, journey } of evidenceEntries) {
    for (const step of journey.steps) {
      if (step.worldTicks > SUMMARY_ABSENCE_TICKS) {
        overLong.push({ citizen, from: step.from, to: step.to, worldTicks: step.worldTicks });
      }
    }
  }
  overLong.sort((a, b) => cmpStr(a.citizen, b.citizen) || a.worldTicks - b.worldTicks);

  const stuck = stuckActorCheck(corpus);

  return {
    schema: INVARIANTS_SCHEMA,
    generatedAtUtc: now.toISOString(),
    corpus: {
      bookId: corpus.book.id,
      windowStartUtc: new Date(corpus.windowStartMs).toISOString(),
      windowEndUtc: new Date(corpus.windowEndMs).toISOString(),
      voicesSnapshots: corpus.voicesSnapshots.length,
      newsSnapshots: corpus.newsSnapshots.length,
      utterances: corpus.utterancesById.size,
      speakers: corpus.streams.size,
      citizensKnown: corpus.roster.size,
    },
    reconstructed: {
      source: 'journeys-cycle.mjs buildJourneys (M3.01, portal.journeys/v1)',
      journeysInArtefact: reconstructedEntries.length + reconstructedNotWalkable.length,
      journeysNotWalkable: reconstructedNotWalkable.length,
      notWalkableExamples: reconstructedNotWalkable.slice(0, EXAMPLE_CAP),
      ...reconstructed,
    },
    evidencePaths: {
      source: 'utterance union over the book\'s voices snapshots; legs between consecutive evidenced places',
      journeysBuilt: evidenceEntries.length,
      legsTotal,
      legsWalked: evidenceEntries.reduce((s, e) => s + e.legs, 0),
      legsExcludedOffGraph: exclusions.length,
      exclusionExamples: exclusions.slice(0, EXAMPLE_CAP),
      ...evidencePaths,
    },
    overLongBeats: {
      thresholdTicks: SUMMARY_ABSENCE_TICKS,
      count: overLong.length,
      examples: overLong.slice(0, EXAMPLE_CAP),
      note: 'a leg past the §3.4 path-summary threshold raises "waiting / catching up" at presentation, never a sped-up walk',
    },
    stuckActors: stuck,
    followUps: [
      'As the post-A0 corpus grows, the reconstructed set becomes the primary corpus and evidencePaths demotes to a cross-check (see the header).',
      'Supervisor hook: INVARIANTS-HOOK-SPEC.md (prepared, applied separately by the established restart discipline).',
    ],
  };
}

// Compact summary health.mjs embeds as health.json's `invariants`
// section. Kept here so the shape has exactly one author.
export function invariantsHealthSection(report) {
  if (!isPlainObject(report)) return null;
  const recon = report.reconstructed ?? {};
  const evid = report.evidencePaths ?? {};
  const violations =
    (recon.violations?.count ?? 0) + (evid.violations?.count ?? 0);
  const mutantMissed =
    (recon.mutantControl?.applicable ?? 0) - (recon.mutantControl?.caught ?? 0) +
    ((evid.mutantControl?.applicable ?? 0) - (evid.mutantControl?.caught ?? 0));
  return {
    schema: report.schema ?? null,
    generatedAtUtc: report.generatedAtUtc ?? null,
    journeysChecked: (recon.checked ?? 0) + (evid.checked ?? 0),
    violations,
    mutantControl:
      mutantMissed > 0 ? `MISSED on ${mutantMissed}` : 'caught on every applicable journey',
    stuckSuspects: report.stuckActors?.suspects?.length ?? 0,
    overLongBeats: report.overLongBeats?.count ?? 0,
  };
}

// ------------------------------------------------------------------------ CLI

async function main() {
  const args = process.argv.slice(2);
  const opt = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const archiveDir = opt('--archive') ?? join(HERE, 'archive');
  const layoutPath = opt('--layout') ?? join(HERE, '..', 'shared', 'ember-layout.json');
  const out = opt('--out') ?? join(archiveDir, 'invariants.json');
  const now = opt('--now') ? new Date(opt('--now')) : new Date();
  const layout = JSON.parse(await readFile(layoutPath, 'utf8'));
  const report = await buildCorpusReport({ archiveDir, layout, now });
  await mkdir(dirname(out), { recursive: true });
  const tmp = `${out}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(report, null, 2) + '\n', 'utf8');
  await rename(tmp, out);
  const s = invariantsHealthSection(report);
  console.log(`invariants → ${out}`);
  console.log(
    `corpus: book ${report.corpus.bookId}, ${report.corpus.voicesSnapshots} voices + ` +
      `${report.corpus.newsSnapshots} news snapshots, ${report.corpus.utterances} utterances, ` +
      `${report.corpus.speakers} speakers, ${report.corpus.citizensKnown} citizens known`,
  );
  console.log(
    `checked ${s.journeysChecked} journeys (reconstructed ${report.reconstructed.checked}, ` +
      `evidence paths ${report.evidencePaths.checked}), violations ${s.violations}, ` +
      `mutant: ${s.mutantControl}`,
  );
  console.log(
    `stuck suspects ${s.stuckSuspects} (questions, not accusations); ` +
      `over-long beats ${s.overLongBeats}; off-graph legs excluded ${report.evidencePaths.legsExcludedOffGraph}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('corpus-invariants failed:', err);
    process.exitCode = 1;
  });
}
