// Elsewhere Portal — M2.04 (SE-1.8 / D8): the identity registry.
// Companion module: reads the current bundle + the archived Tier P
// snapshots, and writes archive/identity-registry.json. It edits no other
// module's state and is imported by nothing yet — M2.11 wires citizenId
// into the v2 deriver.
//
// THE VERIFICATION RULE IS LAW (CONTRACT-V2-DRAFT K4, plan M2.04):
// a citizenId binding exists ONLY when the public agent route for that
// citizen answers (HTTP 200) AND the display name it returns matches the
// record's raw name exactly, character for character (strict equality —
// no normalisation, no trimming, no case folding).
//
// Candidates come ONLY from evidenced sources: a route string carried as
// a whole field value (a link field) in an archived Tier P payload, or in
// one of the world's own indexes. Slugify-guessing a route from a name is
// BANNED as evidence: a guessed route that answers proves nothing and
// binds nothing, and this module contains no code path that can form
// one — there is no slug function here, and fetch is only ever called
// with routes the extractor returned. Likewise, dossier filenames in
// ~/workspace/elsewhere/dossiers are slug() transformations of record
// names and are never read by this module.
//
// A route appearing inside prose (an utterance, a headline) is testimony,
// not an index entry: extraction is anchored — the field value must BE
// the route (or a URL whose path is the route), never merely contain it.
//
// States: verified | unverified | ambiguous. Ambiguous (more than one
// distinct evidenced candidate for a name, one id claimed by a namesake
// set, or a name match with conflicting ids) is NEVER auto-bound
// (Automation Package AUTO-B10); those citizenKeys are listed in
// auditQueue for the Hark audit seat. Unverified with citizenId null is
// a valid final state.
//
// Node stdlib only (global fetch), per the Wave 1 data-arm contract.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringify, cmpStr } from './derive.mjs';
import { loadCadence, ROUTES } from './poller.mjs';

export const REGISTRY_SCHEMA = 'portal.identity-registry/v1';
export const REGISTRY_FILE = 'identity-registry.json';
export const AGENT_ROUTE_PREFIX = '/public/agents/';

const HERE = dirname(fileURLToPath(import.meta.url));

// Fields whose string value is a display name for tying a link field in
// the same record to a citizen. (news.residents[].handle carries a
// display name in Tier P, verified — see STATUS.md; it ties, it never
// identifies.)
const NAME_FIELDS = ['by', 'name', 'handle', 'who', 'author'];

// Anchored: the whole field value is the route, or a URL ending in it.
const ROUTE_VALUE_RE =
  /^\s*(?:https?:\/\/[^\s"'<>]+)?(\/public\/agents\/([A-Za-z0-9._~%-]+))\s*$/;

// Derived from the canonical ROUTES (M2.01 unification): the scan covers
// every scheduled route's snapshots, including the five added by M2.01 —
// citizen-text surfaces like discussions/concerts are exactly where an
// agent-route string could surface as binding evidence.
const SNAPSHOT_FILE_RE =
  new RegExp(`^(?:${ROUTES.join('|')})-.+\\.json$`);
const DAY_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- Candidate extraction (pure) --------------------------------------

// Walk a parsed payload; for every string that IS an agent route,
// record a candidate. `tiedNames` are the display names found in
// name-bearing fields of the nearest enclosing records (the object
// holding the string, then up to two ancestors) — a candidate tied to
// exactly one name belongs to that name; an untied candidate joins the
// shared pool (its page's own returned name is still the binding check).
export function extractCandidates(data, file) {
  const found = [];
  const walk = (value, path, ancestors) => {
    if (typeof value === 'string') {
      const m = ROUTE_VALUE_RE.exec(value);
      if (m) {
        const tied = new Set();
        for (const obj of ancestors) {
          for (const f of NAME_FIELDS) {
            if (typeof obj[f] === 'string' && obj[f] !== '') tied.add(obj[f]);
          }
        }
        found.push({
          handle: m[2],
          route: m[1],
          file,
          field: path,
          tiedNames: [...tied].sort(cmpStr),
        });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`, ancestors));
      return;
    }
    if (value && typeof value === 'object') {
      const next = [value, ...ancestors].slice(0, 3);
      for (const [k, v] of Object.entries(value)) {
        walk(v, path === '' ? `$.${k}` : `${path}.${k}`, next);
      }
    }
  };
  walk(data, '', []);
  return found;
}

// Merge candidates from many payloads into per-name candidate lists plus
// the untied pool. Deduped by (scope, handle); the first evidence
// pointer in scan order is cited, sightings counted.
export function collectCandidates(payloads) {
  const tied = new Map(); // name -> Map(handle -> candidate)
  const pool = new Map(); // handle -> candidate
  let sightings = 0;
  for (const { file, data } of payloads) {
    for (const cand of extractCandidates(data, file)) {
      sightings += 1;
      if (cand.tiedNames.length === 1) {
        const name = cand.tiedNames[0];
        if (!tied.has(name)) tied.set(name, new Map());
        const byHandle = tied.get(name);
        if (!byHandle.has(cand.handle)) byHandle.set(cand.handle, { ...cand, sightings: 1 });
        else byHandle.get(cand.handle).sightings += 1;
      } else if (cand.tiedNames.length === 0) {
        if (!pool.has(cand.handle)) pool.set(cand.handle, { ...cand, sightings: 1 });
        else pool.get(cand.handle).sightings += 1;
      }
      // Tied to 2+ names: the record itself is ambiguous about whose
      // route this is — unusable as evidence for anyone. Dropped here,
      // counted in the scan notes by the caller via sightings mismatch.
    }
  }
  return { tied, pool, sightings };
}

// --- Page reading (pure) ----------------------------------------------

// The display name a public agent page returns. Today the page shape is
// not evidenced in the archive, so this is deliberately narrow: a JSON
// body with a string `name` (or `displayName`). Anything else is
// unreadable — which means unverified, never a guess.
export function pageDisplayName(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (typeof parsed.name === 'string') return { name: parsed.name };
      if (typeof parsed.displayName === 'string') return { name: parsed.displayName };
    }
  } catch {
    /* not JSON */
  }
  return { name: null };
}

// Verify one candidate against one raw name. fetchPage(route) is
// injected and resolves { status, body } or throws.
// Outcomes: match | name-mismatch | route-not-200 | fetch-error |
// page-name-unreadable.
export async function verifyCandidate(candidate, rawName, fetchPage) {
  let res;
  try {
    res = await fetchPage(candidate.route);
  } catch {
    return { handle: candidate.handle, route: candidate.route, outcome: 'fetch-error', pageName: null };
  }
  if (!res || res.status !== 200) {
    return { handle: candidate.handle, route: candidate.route, outcome: 'route-not-200', pageName: null };
  }
  const { name } = pageDisplayName(res.body ?? '');
  if (name === null) {
    return { handle: candidate.handle, route: candidate.route, outcome: 'page-name-unreadable', pageName: null };
  }
  // Character-for-character. No normalisation of either side, ever.
  return {
    handle: candidate.handle,
    route: candidate.route,
    outcome: name === rawName ? 'match' : 'name-mismatch',
    pageName: name,
  };
}

// --- Registry build (pure given fetchPage + clock) ---------------------

// citizens: [{ citizenKey, name, firstSeenUtc }] from the bundle.
// candidates: the collectCandidates() result.
// fetchPage: injected (route) => Promise<{ status, body }>.
export async function buildRegistry({ citizens, candidates, fetchPage, checkedUtc }) {
  const sorted = [...citizens].sort((a, b) => cmpStr(a.citizenKey, b.citizenKey));

  // Group citizens by raw name: candidates tie to names, so a namesake
  // set shares its candidate pool and its fate (K3/K5 — never fold).
  const byName = new Map();
  for (const c of sorted) {
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  }

  const fetchCache = new Map(); // route -> Promise<{status, body}>
  const cachedFetch = (route) => {
    if (!fetchCache.has(route)) fetchCache.set(route, Promise.resolve().then(() => fetchPage(route)));
    return fetchCache.get(route);
  };

  const entries = {};
  const auditQueue = [];

  for (const c of sorted) {
    const namesakes = byName.get(c.name);
    const tiedMap = candidates.tied.get(c.name) ?? new Map();
    const candMap = new Map([...tiedMap, ...candidates.pool]);
    const cands = [...candMap.values()].sort((a, b) => cmpStr(a.handle, b.handle));

    const base = {
      citizenKey: c.citizenKey,
      name: c.name,
      firstSeenUtc: c.firstSeenUtc,
      citizenId: null,
      state: 'unverified',
      evidence: null,
      candidates: cands.map((k) => ({
        handle: k.handle,
        route: k.route,
        evidence: { file: k.file, field: k.field },
        outcome: null,
      })),
      reason: null,
      checkedUtc,
    };

    if (cands.length === 0) {
      base.reason = 'no-evidenced-route';
      entries[c.citizenKey] = base;
      continue;
    }

    // Attempt every candidate — the audit seat gets outcomes, not gaps.
    const results = [];
    for (const k of cands) {
      const r = await verifyCandidate(k, c.name, cachedFetch);
      results.push(r);
      base.candidates.find((x) => x.handle === k.handle).outcome = r.outcome;
    }
    const matches = results.filter((r) => r.outcome === 'match');

    if (cands.length > 1) {
      base.state = 'ambiguous';
      base.reason = 'multiple-evidenced-candidates';
    } else if (namesakes.length > 1) {
      // One name, several records: a single binding would fold them.
      base.state = 'ambiguous';
      base.reason = 'namesake-set-shares-candidate';
    } else if (matches.length === 1) {
      const k = cands[0];
      base.state = 'verified';
      base.citizenId = k.handle;
      base.evidence = {
        file: k.file,
        field: k.field,
        route: k.route,
        pageName: matches[0].pageName,
        checkedUtc,
      };
      base.reason = null;
    } else {
      base.reason = results[0].outcome; // route-not-200 | name-mismatch | …
    }

    if (base.state === 'ambiguous') auditQueue.push(c.citizenKey);
    entries[c.citizenKey] = base;
  }

  const counts = { verified: 0, unverified: 0, ambiguous: 0 };
  for (const e of Object.values(entries)) counts[e.state] += 1;

  return {
    schema: REGISTRY_SCHEMA,
    builtUtc: checkedUtc,
    rule:
      'A binding exists only when an evidenced public agent route returns 200 and its display name matches the record raw name exactly, character for character. Candidates are never derived from names.',
    citizens: sorted.length,
    evidencedRoutes: new Set(
      [...candidates.tied.values()].flatMap((m) => [...m.keys()]).concat([...candidates.pool.keys()]),
    ).size,
    summary: counts,
    auditQueue: auditQueue.sort(cmpStr),
    entries,
  };
}

// --- Archive scan (IO) --------------------------------------------------

export async function scanArchiveForCandidates(archiveDir) {
  const payloads = [];
  const notes = [];
  let days = [];
  try {
    days = (await readdir(archiveDir)).filter((d) => DAY_DIR_RE.test(d)).sort(cmpStr);
  } catch {
    return { candidates: collectCandidates([]), filesScanned: 0, notes: ['archive-dir-unreadable'] };
  }
  for (const day of days) {
    const files = (await readdir(join(archiveDir, day)))
      .filter((f) => SNAPSHOT_FILE_RE.test(f))
      .sort(cmpStr);
    for (const f of files) {
      const rel = `${day}/${f}`;
      try {
        const data = JSON.parse(await readFile(join(archiveDir, day, f), 'utf8'));
        payloads.push({ file: rel, data });
      } catch {
        notes.push(`unparseable-snapshot:${rel}`);
      }
    }
  }
  return { candidates: collectCandidates(payloads), filesScanned: payloads.length, notes };
}

// --- Live page fetch -----------------------------------------------------

export async function fetchPageLive(route, { baseUrl, userAgent, timeoutMs }) {
  const res = await fetch(`${baseUrl}${route}`, {
    headers: { 'user-agent': userAgent },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, body: await res.text() };
}

// --- CLI -----------------------------------------------------------------

export async function run({
  archiveDir = join(HERE, 'archive'),
  feedPath = join(HERE, 'feed', 'world-data.json'),
  outPath = join(HERE, 'archive', REGISTRY_FILE),
  now = new Date(),
} = {}) {
  const cadence = await loadCadence();
  const bundle = JSON.parse(await readFile(feedPath, 'utf8'));
  const citizens = (bundle.citizens ?? []).map((c) => ({
    citizenKey: c.citizenKey,
    name: c.name,
    firstSeenUtc: c.firstSeenUtc,
  }));
  const { candidates, filesScanned, notes } = await scanArchiveForCandidates(archiveDir);
  const registry = await buildRegistry({
    citizens,
    candidates,
    fetchPage: (route) =>
      fetchPageLive(route, {
        baseUrl: cadence.baseUrl,
        userAgent: cadence.userAgent,
        timeoutMs: cadence.timeoutMs,
      }),
    checkedUtc: now.toISOString(),
  });
  registry.scan = { filesScanned, notes };
  await writeFile(outPath, canonicalStringify(registry) + '\n', 'utf8');
  return registry;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const registry = await run();
  console.log(
    `identity-registry: ${registry.citizens} citizens, ` +
      `${registry.evidencedRoutes} evidenced routes, ` +
      `${registry.summary.verified} verified, ` +
      `${registry.summary.unverified} unverified, ` +
      `${registry.summary.ambiguous} ambiguous ` +
      `(scanned ${registry.scan.filesScanned} snapshots)`,
  );
}
