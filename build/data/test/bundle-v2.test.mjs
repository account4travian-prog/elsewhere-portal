// WorldData v2 builder + validator tests (M2 freeze prep;
// CONTRACT-V2-DRAFT.md incl. the Hark mini-audit amendments of
// 2026-11-02). Real-head tests run against the live archive; controls
// are synthetic mutations of a built bundle, labelled as such.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBundle, loadBookVoices, loadHead } from '../build-bundle.mjs';
import { buildBundleV2, loadFactsRef } from '../build-bundle-v2.mjs';
import { canonicalStringify, citizenKeySlug, deriveWorldData } from '../derive.mjs';
import { deriveOffices, deriveWorldDataV2, tickerDueUtc } from '../derive-v2.mjs';
import { ACTS_DISCLOSURE, DISCLOSURE } from '../episodes.mjs';
import { validateBundleV2, validateManifestV2 } from '../validate-v2.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARCHIVE = join(HERE, '..', 'archive');

const clone = (v) => JSON.parse(JSON.stringify(v));

let headCache = null;
async function realHead() {
  if (!headCache) {
    const { head } = await loadHead(ARCHIVE);
    const book = await loadBookVoices(ARCHIVE, head);
    headCache = { head, voicesSnapshots: book.voicesSnapshots };
  }
  return headCache;
}

async function buildRealV2() {
  const feedDir = await mkdtemp(join(tmpdir(), 'portal-v2-'));
  return buildBundleV2({ archiveDir: ARCHIVE, feedDir });
}

test('real head: v2 builds, validates, and matches the registry + world-books on disk', async () => {
  const { worldData, manifest } = await buildRealV2();
  assert.equal(worldData.schema, 'portal.world-data/v2');
  assert.deepEqual(validateBundleV2(worldData), { valid: true, errors: [], rejections: [] });
  assert.equal(validateManifestV2(manifest).valid, true);

  const books = JSON.parse(await readFile(join(ARCHIVE, 'world-books.json'), 'utf8'));
  const open = books.books.find((b) => b.status === 'open');
  assert.equal(worldData.world.bookId, open.id);

  const registry = JSON.parse(await readFile(join(ARCHIVE, 'identity-registry.json'), 'utf8'));
  for (const c of worldData.citizens) {
    const entry = registry.entries[c.citizenKey];
    if (entry?.state === 'verified') {
      assert.equal(c.citizenIdStatus, 'BOUND');
      assert.equal(c.citizenId, entry.citizenId);
    } else if (entry?.state === 'ambiguous') {
      assert.equal(c.citizenIdStatus, 'CONFLICT');
      assert.equal(c.citizenId, null);
    } else {
      assert.equal(c.citizenIdStatus, 'UNBOUND_NO_ROUTE');
      assert.equal(c.citizenId, null);
    }
    assert.ok(c.citizenKey.startsWith('portal-key:'));
  }

  // Facts citation: present as a key in bundle + manifest, identical,
  // and equal to whatever loadFactsRef finds (null while no stream exists).
  const factsRef = await loadFactsRef(ARCHIVE, join(HERE, '..', 'feed-v2-nonexistent'));
  assert.deepEqual(worldData.world.facts, factsRef);
  assert.deepEqual(manifest.facts, worldData.world.facts);

  for (const ep of worldData.episodes) assert.equal(ep.disclosure, DISCLOSURE);
  for (const s of worldData.actSequences) assert.equal(s.disclosure, ACTS_DISCLOSURE);
  assert.ok(!('scenes' in worldData), 'scenes[] is reserved and must not be emitted');
});

test('facts citation: a facts-state.json seq is cited by schema id; absence stays null', async () => {
  const feedDir = await mkdtemp(join(tmpdir(), 'portal-v2-facts-'));
  await writeFile(join(feedDir, 'facts-state.json'), JSON.stringify({
    schema: 'portal.facts/v1', kind: 'facts-state', mode: 'feed-state',
    lastDiffedBundle: { schema: 'portal.world-data/v1', bundleSeq: 42 },
  }));
  assert.deepEqual(await loadFactsRef(ARCHIVE, feedDir), { schema: 'portal.facts/v1', seq: 42 });
  const { worldData, manifest } = await buildBundleV2({ archiveDir: ARCHIVE, feedDir });
  assert.deepEqual(worldData.world.facts, { schema: 'portal.facts/v1', seq: 42 });
  assert.deepEqual(manifest.facts, { schema: 'portal.facts/v1', seq: 42 });
  assert.equal(validateBundleV2(worldData).valid, true);
  // And with no facts artefacts anywhere, the citation is null, not omitted.
  const bareFeed = await mkdtemp(join(tmpdir(), 'portal-v2-nofacts-'));
  const bareArchive = await mkdtemp(join(tmpdir(), 'portal-v2-nofacts-arch-'));
  assert.equal(await loadFactsRef(bareArchive, bareFeed), null);
});

test('determinism: two v2 builds of the same head are byte-identical', async () => {
  const a = await buildRealV2();
  const b = await buildRealV2();
  assert.equal(canonicalStringify(a.worldData), canonicalStringify(b.worldData));
  assert.deepEqual(a.manifest, b.manifest);
});

test('registry mapping: verified -> BOUND, ambiguous -> CONFLICT, absent -> UNBOUND_NO_ROUTE', () => {
  const said = (by, at) => ({ by, at, said: 'x', id: at });
  const head = {
    voices: {
      data: {
        generated_at: '2026-11-02T12:00:00.000Z',
        places: [{
          code: 'EMBER_COLLEGE',
          said: [
            said('Mira Solace', '2026-11-02T11:59:00.000Z'),
            said('Tomas Reed', '2026-11-02T11:59:30.000Z'),
            said('Petra Vale', '2026-11-02T11:59:45.000Z'),
          ],
        }],
      },
      fetchedUtc: '2026-11-02T12:00:30.000Z',
    },
  };
  const key = (name) => 'portal-key:' + citizenKeySlug(name);
  const registry = {
    entries: {
      [key('Mira Solace')]: { state: 'verified', citizenId: 'msolace' },
      [key('Tomas Reed')]: { state: 'ambiguous', citizenId: null },
      // Petra Vale: no entry at all.
    },
  };
  const wd = deriveWorldDataV2(head, { bundleSeq: 1, identityRegistry: registry, bookId: 'world-001' });
  const byName = Object.fromEntries(wd.citizens.map((c) => [c.name, c]));
  assert.equal(byName['Mira Solace'].citizenIdStatus, 'BOUND');
  assert.equal(byName['Mira Solace'].citizenId, 'msolace');
  assert.equal(byName['Tomas Reed'].citizenIdStatus, 'CONFLICT');
  assert.equal(byName['Tomas Reed'].citizenId, null);
  assert.equal(byName['Petra Vale'].citizenIdStatus, 'UNBOUND_NO_ROUTE');
  assert.equal(byName['Petra Vale'].citizenId, null);
  assert.equal(validateBundleV2(wd).valid, true);
});

// The amended §1.1 delta table, as data: 1 changed + 9 added = 10.
// (citizenKey, firstSeenUtc, citizenCollisions shipped early under v1,
// so the emitted key-set delta is smaller — asserted separately below.)
const DELTA_CHANGED = [{ where: 'bundle', field: 'schema', from: 'portal.world-data/v1', to: 'portal.world-data/v2' }];
const DELTA_ADDED = [
  { where: 'citizens', field: 'citizenKey' },
  { where: 'citizens', field: 'firstSeenUtc' },
  { where: 'citizens', field: 'citizenId' },
  { where: 'citizens', field: 'citizenIdStatus' },
  { where: 'bundle', field: 'citizenCollisions' },
  { where: 'world', field: 'bookId' },
  { where: 'world', field: 'facts' },
  { where: 'world', field: 'integritySource' },
  { where: 'bundle', field: 'episodes' },
  { where: 'bundle', field: 'actSequences' },
];

test('v1-vs-v2 delta on the same head matches the amended §1 table exactly (11, incl. Amendment A1)', async () => {
  const { head, voicesSnapshots } = await realHead();
  const registry = JSON.parse(await readFile(join(ARCHIVE, 'identity-registry.json'), 'utf8'));
  const opts = { bundleSeq: 1, voicesSnapshots };
  const v1 = deriveWorldData(head, opts);
  const v2 = deriveWorldDataV2(head, { ...opts, identityRegistry: registry, bookId: 'world-001', factsRef: null });

  assert.equal(DELTA_CHANGED.length + DELTA_ADDED.length, 11, 'amended delta count: 1 changed + 10 added (9 + Amendment A1 integritySource)');
  for (const d of DELTA_CHANGED) {
    assert.equal(v1[d.field], d.from);
    assert.equal(v2[d.field], d.to);
  }
  const sample = (wd, where) => (where === 'bundle' ? wd : where === 'world' ? wd.world : wd.citizens[0]);
  for (const d of DELTA_ADDED) {
    assert.ok(sample(v2, d.where) && d.field in sample(v2, d.where), `v2 must carry ${d.where}.${d.field}`);
  }

  // Emitted key-set delta: nothing removed anywhere; additions are
  // exactly the not-yet-shipped fields.
  const addedKeys = (a, b) => Object.keys(b).filter((k) => !(k in a)).sort();
  const removedKeys = (a, b) => Object.keys(a).filter((k) => !(k in b)).sort();
  assert.deepEqual(addedKeys(v1, v2), ['actSequences', 'episodes', 'offices']);
  assert.deepEqual(addedKeys(v1.citizens[0], v2.citizens[0]), ['citizenId', 'citizenIdStatus']);
  assert.deepEqual(addedKeys(v1.world, v2.world), ['bookId', 'facts', 'integritySource']);
  assert.deepEqual(removedKeys(v1, v2), []);
  assert.deepEqual(removedKeys(v1.citizens[0], v2.citizens[0]), []);
  assert.deepEqual(removedKeys(v1.world, v2.world), []);
  // Already shipped under v1, ratified by v2 — present in both.
  for (const f of ['citizenKey', 'firstSeenUtc']) assert.ok(f in v1.citizens[0] && f in v2.citizens[0]);
  assert.ok('citizenCollisions' in v1 && 'citizenCollisions' in v2);
  // Reserved / deferred fields are absent from v2.
  assert.ok(!('scenes' in v2));
  assert.ok(v2.citizens.every((c) => !('presenceClass' in c)));
});

test('size: v2 vs v1 on the real head (freeze-gate figure: delta <= 50 KB)', async () => {
  const v1Dir = await mkdtemp(join(tmpdir(), 'portal-v1-'));
  const v2Dir = await mkdtemp(join(tmpdir(), 'portal-v2-'));
  await buildBundle({ archiveDir: ARCHIVE, feedDir: v1Dir });
  const { worldData } = await buildBundleV2({ archiveDir: ARCHIVE, feedDir: v2Dir });
  const v1Size = (await stat(join(v1Dir, 'world-data.json'))).size;
  const v2Size = (await stat(join(v2Dir, 'world-data.json'))).size;
  const delta = v2Size - v1Size;
  console.log(
    `v1=${v1Size}B v2=${v2Size}B delta=${delta}B ` +
    `(citizens=${worldData.citizens.length}, episodes=${worldData.episodes.length}, ` +
    `actSequences=${worldData.actSequences.length})`,
  );
  assert.ok(delta > 0, 'v2 carries strictly more than v1');
  assert.ok(delta <= 50_000, `delta ${delta}B exceeds the 50 KB freeze-gate figure`);
});

// --- Positive controls (synthetic mutations of a real built bundle) ---

async function builtBundle() {
  const { worldData } = await buildRealV2();
  return clone(worldData);
}

function syntheticBundle() {
  // A minimal valid v2 bundle with one episode + one act sequence, so
  // disclosure controls do not depend on the live head containing any.
  return {
    schema: 'portal.world-data/v2',
    bundleSeq: 1,
    newestFetchUtc: '2026-11-02T12:00:30.000Z',
    dataAgeSeconds: 0,
    world: { sky: null, worldHour: null, season: null, year: null, bookId: 'world-001', facts: null, integritySource: 'none-in-tier-p' },
    counters: { regionsDiscovered: 0, regionsSurveyed: 0, regionsNamed: 0, collegeDeposits: 0, treasury: 0, populationKnown: 0 },
    ember: { districts: [], plots: [], works: [] },
    citizens: [{
      citizenKey: 'portal-key:mira-solace', citizenId: null, citizenIdStatus: 'UNBOUND_NO_ROUTE',
      handle: '', name: 'Mira Solace', firstSeenUtc: '2026-11-02T11:59:00.000Z',
      placeCode: 'EMBER_COLLEGE', state: 'talking', evidenceUtc: '2026-11-02T11:59:00.000Z',
      provenance: { route: 'voices', fetchedUtc: '2026-11-02T12:00:30.000Z' },
    }],
    citizenCollisions: [],
    ticker: [],
    episodes: [{
      place: 'EMBER_COLLEGE', where: null, participants: ['Mira Solace', 'Tomas Reed'],
      firstUtc: '2026-11-02T11:59:00.000Z', lastUtc: '2026-11-02T11:59:30.000Z',
      utteranceCount: 3, corroborated: false, corroboratedBy: null, disclosure: DISCLOSURE,
    }],
    actSequences: [{
      actor: 'Mira Solace', kind: 'RUIN_EXCAVATED', presentation: 'acts-only', count: 2,
      firstUtc: '2026-11-02T10:00:00.000Z', lastUtc: '2026-11-02T11:00:00.000Z',
      acts: [
        { at: '2026-11-02T10:00:00.000Z', phrase: 'Mira Solace dug into an old ruin at 1, 2.', cell: null },
        { at: '2026-11-02T11:00:00.000Z', phrase: 'Mira Solace dug into an old ruin at 3, 4.', cell: null },
      ],
      disclosure: ACTS_DISCLOSURE,
    }],
    journeys: [],
  };
}

test('control: the synthetic valid bundle passes (validator is not vacuous)', () => {
  assert.deepEqual(validateBundleV2(syntheticBundle()), { valid: true, errors: [], rejections: [] });
});

test('control: a disclosure-stripped episode FAILS, logged with its record id', () => {
  const b = syntheticBundle();
  delete b.episodes[0].disclosure;
  const r = validateBundleV2(b);
  assert.equal(r.valid, false);
  const rej = r.rejections.find((e) => e.kind === 'disclosure');
  assert.ok(rej, 'a disclosure rejection is recorded');
  assert.ok(rej.recordId.startsWith('episode:EMBER_COLLEGE:'), `rejection names the record: ${rej.recordId}`);
});

test('control: a disclosure-stripped act sequence FAILS, logged with its record id', () => {
  const b = syntheticBundle();
  delete b.actSequences[0].disclosure;
  const r = validateBundleV2(b);
  assert.equal(r.valid, false);
  assert.ok(r.rejections.some((e) => e.kind === 'disclosure' && e.recordId.startsWith('actSequence:Mira Solace:')));
});

test('control: a stub disclosure ("n/a") FAILS — minimum-content rule', () => {
  const ep = syntheticBundle();
  ep.episodes[0].disclosure = 'n/a';
  assert.equal(validateBundleV2(ep).valid, false);
  const seq = syntheticBundle();
  seq.actSequences[0].disclosure = 'n/a';
  assert.equal(validateBundleV2(seq).valid, false);
  const altered = syntheticBundle();
  altered.episodes[0].disclosure = DISCLOSURE.replace('spoke', 'talked');
  assert.equal(validateBundleV2(altered).valid, false, 'even a near-verbatim edit is not the filed template');
});

test('control: the pre-A2 disclosure strings FAIL (Amendment A2 delta check)', () => {
  // OM15-C3: the wording frozen before Amendment A2 claimed "the public
  // record"; Portal reads only the public Tier P feeds. The old strings
  // must now be rejected exactly like stubs, and a one-word-altered copy
  // of a NEW string must fail too — the validator enforces the A2
  // template family, not the old one and not a near miss.
  const OLD_EPISODE = 'Presence is evidenced at the moments each of them spoke; the public record does not show who else was present, who stayed silent, or when each of them left.';
  const OLD_ACTS = 'Recorded acts only. The public record shows acts, not ongoing work.';
  const ep = syntheticBundle();
  ep.episodes[0].disclosure = OLD_EPISODE;
  const epR = validateBundleV2(ep);
  assert.equal(epR.valid, false, 'the pre-A2 episode template is no longer the filed template');
  assert.ok(epR.rejections.some((e) => e.kind === 'disclosure'), 'the rejection is logged as a disclosure rejection');
  const seq = syntheticBundle();
  seq.actSequences[0].disclosure = OLD_ACTS;
  assert.equal(validateBundleV2(seq).valid, false, 'the pre-A2 acts template is no longer the filed template');
  const alteredActs = syntheticBundle();
  alteredActs.actSequences[0].disclosure = ACTS_DISCLOSURE.replace('show acts', 'shows acts');
  assert.equal(validateBundleV2(alteredActs).valid, false, 'a one-word-altered copy of the A2 acts template fails');
  const alteredEp = syntheticBundle();
  alteredEp.episodes[0].disclosure = DISCLOSURE.replace('feeds Portal reads', 'feeds Portal read');
  assert.equal(validateBundleV2(alteredEp).valid, false, 'a one-word-altered copy of the A2 episode template fails');
});

test('control: a citizenKey missing its portal-key: prefix FAILS', () => {
  const b = syntheticBundle();
  b.citizens[0].citizenKey = 'mira-solace';
  const r = validateBundleV2(b);
  assert.equal(r.valid, false);
  assert.ok(r.rejections.some((e) => e.kind === 'citizenKey-prefix'));
});

test('control: an emitted scenes[] section FAILS (Q2 — reserved means reserved)', () => {
  const b = syntheticBundle();
  b.scenes = [];
  const r = validateBundleV2(b);
  assert.equal(r.valid, false);
  assert.ok(r.rejections.some((e) => e.kind === 'scenes-emitted'));
});

test('control: world.integritySource with any value but the A1 constant FAILS', () => {
  const wrong = syntheticBundle();
  wrong.world.integritySource = 'overview';
  const r = validateBundleV2(wrong);
  assert.equal(r.valid, false);
  assert.ok(r.rejections.some((e) => e.kind === 'world.integritySource'), 'rejection names world.integritySource');
  const missing = syntheticBundle();
  delete missing.world.integritySource;
  assert.equal(validateBundleV2(missing).valid, false, 'the A1 field is required, not optional');
  const exact = syntheticBundle();
  assert.equal(exact.world.integritySource, 'none-in-tier-p');
  assert.equal(validateBundleV2(exact).valid, true);
});

test('control: citizenIdStatus inconsistent with citizenId FAILS', () => {
  const conflict = syntheticBundle();
  conflict.citizens[0].citizenIdStatus = 'CONFLICT';
  conflict.citizens[0].citizenId = 'msolace';
  assert.equal(validateBundleV2(conflict).valid, false);
  const bound = syntheticBundle();
  bound.citizens[0].citizenIdStatus = 'BOUND'; // citizenId still null
  assert.equal(validateBundleV2(bound).valid, false);
});

// --- Amendment A3 carriage (2026-11-03): offices + ticker dueUtc ---

test('A3 real head: the mayor the overview evidences is carried, with provenance', async () => {
  const { head, voicesSnapshots } = await realHead();
  const wd = deriveWorldDataV2(head, { bundleSeq: 1, voicesSnapshots, bookId: 'world-001' });
  const mayor = head.overview?.data?.ember?.mayor;
  assert.ok(mayor && typeof mayor.name === 'string' && mayor.sits !== false, 'fixture premise: the live overview names a sitting mayor');
  assert.equal(wd.offices.length, 1, 'the overview evidences exactly one office holder tonight');
  const [office] = wd.offices;
  assert.equal(office.office, 'MAYOR');
  assert.equal(office.name, mayor.name);
  assert.deepEqual(office.provenance, { route: 'overview', fetchedUtc: head.overview.fetchedUtc });
  const matches = wd.citizens.filter((c) => c.name === mayor.name);
  assert.equal(office.citizenKey, matches.length === 1 ? matches[0].citizenKey : null);
  assert.equal(validateBundleV2(wd).valid, true);
});

test('A3 dueUtc: no live headline carries a due stamp, so no live ticker item gains one', async () => {
  const { head, voicesSnapshots } = await realHead();
  const wd = deriveWorldDataV2(head, { bundleSeq: 1, voicesSnapshots, bookId: 'world-001' });
  // Premise, read off the head itself: the headline family's records
  // carry no due_at/closes_at tonight (discussions carry closes_at,
  // but no headline references a discussion — there is no join).
  for (const h of head.news?.data?.headlines ?? []) assert.equal(tickerDueUtc(h), null);
  assert.ok(wd.ticker.every((t) => !('dueUtc' in t)), 'absent-when-not-evidenced, on the real head');
});

function carriageHead({ mayor = undefined, headlines = [], extraCitizens = [] } = {}) {
  const said = (by, at) => ({ by, at, said: 'x', id: at });
  return {
    overview: {
      data: { ember: { mayor, districts: [], treasury_bennies: 0 }, population: { joined: 3 }, frontier: {}, college: {} },
      fetchedUtc: '2026-11-02T12:00:10.000Z',
    },
    voices: {
      data: {
        generated_at: '2026-11-02T12:00:00.000Z',
        places: [{
          code: 'EMBER_COLLEGE',
          said: [said('Mira Solace', '2026-11-02T11:59:00.000Z'), ...extraCitizens],
        }],
      },
      fetchedUtc: '2026-11-02T12:00:30.000Z',
    },
    news: {
      data: { generated_at: '2026-11-02T12:00:00.000Z', headlines, residents: [] },
      fetchedUtc: '2026-11-02T12:00:20.000Z',
    },
  };
}

test('A3 offices: present-when-evidenced, absent-when-not, unbound when the name is shared', () => {
  const withMayor = deriveWorldDataV2(
    carriageHead({ mayor: { name: 'Mira Solace', sits: true } }),
    { bundleSeq: 1, bookId: 'world-001' },
  );
  assert.equal(withMayor.offices.length, 1);
  assert.equal(withMayor.offices[0].citizenKey, 'portal-key:mira-solace');
  assert.deepEqual(withMayor.offices[0].provenance, { route: 'overview', fetchedUtc: '2026-11-02T12:00:10.000Z' });
  assert.equal(validateBundleV2(withMayor).valid, true);

  const noMayor = deriveWorldDataV2(carriageHead({}), { bundleSeq: 1, bookId: 'world-001' });
  assert.deepEqual(noMayor.offices, [], 'no overview mayor => no offices, and the key is present as []');
  const notSitting = deriveWorldDataV2(
    carriageHead({ mayor: { name: 'Mira Solace', sits: false } }),
    { bundleSeq: 1, bookId: 'world-001' },
  );
  assert.deepEqual(notSitting.offices, [], 'sits: false is not a sitting holder');

  // A name two citizen records share binds NEITHER (ambiguity never binds):
  // a second Mira Solace record arrives via news.residents.
  const shared = carriageHead({ mayor: { name: 'Mira Solace', sits: true } });
  shared.news.data.residents = [{ handle: 'Mira Solace', latest: { at: '2026-11-02T11:58:00.000Z' }, events: [] }];
  const ambiguous = deriveWorldDataV2(shared, { bundleSeq: 1, bookId: 'world-001' });
  assert.equal(ambiguous.offices.length, 1, 'the office itself is still evidenced');
  assert.equal(ambiguous.offices[0].citizenKey, null, 'but it binds no citizenKey');
  assert.equal(validateBundleV2(ambiguous).valid, true);
});

test('A3 negative control: an office fabricated outside the overview is NOT carried', () => {
  // A headline and an utterance both assert an office for Tomas Reed;
  // the overview names no mayor. Assertion in prose is not evidence —
  // the deriver reads the overview's mayor field and nothing else.
  const head = carriageHead({
    headlines: [{ at: '2026-11-02T11:00:00.000Z', id: 1, kind: 'CITY_EVENT_BEGAN', family: 'civic', phrase: 'Tomas Reed was named Mayor of Ember.' }],
  });
  head.voices.data.places[0].said.push({ by: 'Tomas Reed', at: '2026-11-02T11:59:30.000Z', said: 'As mayor, I say this.', id: 'x2' });
  const wd = deriveWorldDataV2(head, { bundleSeq: 1, bookId: 'world-001' });
  assert.deepEqual(wd.offices, []);
  assert.deepEqual(deriveOffices(head, wd.citizens), []);
});

test('A3 dueUtc: a headline carrying a due stamp projects it verbatim; others stay bare', () => {
  const head = carriageHead({
    headlines: [
      { at: '2026-11-02T11:00:00.000Z', id: 1, kind: 'CITY_EVENT_BEGAN', family: 'civic', phrase: 'Answers are called for at the College.', closes_at: '2026-11-12T09:00:00.000Z' },
      { at: '2026-11-02T11:05:00.000Z', id: 2, kind: 'RUIN_EXCAVATED', family: 'ruin', phrase: 'Mira Solace dug into an old ruin at 1, 2.' },
      { at: '2026-11-02T11:10:00.000Z', id: 3, kind: 'CITY_EVENT_BEGAN', family: 'civic', phrase: 'A broken stamp is not a stamp.', closes_at: 'whenever' },
    ],
  });
  const wd = deriveWorldDataV2(head, { bundleSeq: 1, bookId: 'world-001' });
  const byText = Object.fromEntries(wd.ticker.map((t) => [t.text, t]));
  assert.equal(byText['Answers are called for at the College.'].dueUtc, '2026-11-12T09:00:00.000Z');
  assert.equal(byText['Answers are called for at the College.'].provenance.route, 'news', 'the item keeps its own provenance');
  assert.ok(!('dueUtc' in byText['Mira Solace dug into an old ruin at 1, 2.']), 'no stamp on the record => no dueUtc key');
  assert.ok(!('dueUtc' in byText['A broken stamp is not a stamp.']), 'an unparseable stamp is not carried');
  assert.equal(validateBundleV2(wd).valid, true);
});

test('A3 validator controls: sourceless office and prose dueUtc FAIL; pre-A3 bundle stays valid', () => {
  const sourceless = syntheticBundle();
  sourceless.offices = [{ office: 'MAYOR', name: 'Mira Solace', citizenKey: 'portal-key:mira-solace' }];
  const r1 = validateBundleV2(sourceless);
  assert.equal(r1.valid, false, 'an office with no provenance route is a claim, not a carriage');
  assert.ok(r1.rejections.some((e) => e.kind === 'office-provenance'));

  const ghost = syntheticBundle();
  ghost.offices = [{ office: 'MAYOR', name: 'Mira Solace', citizenKey: 'portal-key:nobody-real', provenance: { route: 'overview', fetchedUtc: '2026-11-02T12:00:10.000Z' } }];
  const r2 = validateBundleV2(ghost);
  assert.equal(r2.valid, false);
  assert.ok(r2.rejections.some((e) => e.kind === 'office-citizenKey'), 'an office may not cite a citizen the bundle does not carry');

  const prose = syntheticBundle();
  prose.ticker = [{ utc: '2026-11-02T11:00:00.000Z', kind: 'CITY_EVENT_BEGAN', text: 'Answers due soon.', placeCode: null, handles: [], provenance: { route: 'news', fetchedUtc: '2026-11-02T12:00:20.000Z' }, dueUtc: 'soon' }];
  assert.equal(validateBundleV2(prose).valid, false, 'dueUtc must be a date stamp, never prose');

  const preA3 = syntheticBundle();
  assert.ok(!('offices' in preA3));
  assert.equal(validateBundleV2(preA3).valid, true, 'optional means a pre-A3 bundle (no offices key) still validates');
});

test('real head bundle is a valid base for controls (built episodes also reject when stripped)', async () => {
  const b = await builtBundle();
  assert.equal(validateBundleV2(b).valid, true);
  if (b.episodes.length) {
    delete b.episodes[0].disclosure;
    const r = validateBundleV2(b);
    assert.equal(r.valid, false);
    assert.ok(r.rejections.some((e) => e.kind === 'disclosure'));
  }
});
