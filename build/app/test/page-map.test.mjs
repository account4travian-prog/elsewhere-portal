// Page + map lane (M6.05 → M6.11 → M6.14): the citizen page, the
// frontier fill-in map, and the rhythm header — at the pure-model
// level, against fixtures shaped like the real record. Live-bundle
// cold verification is a recorded run in
// plan-to-complete/lane-m6-page-map.md, not a suite dependency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  citizenPageModel, citizenPageHtml, recordedArrival, collegeStandingOf,
  citizenCardHtml, inspectorModel,
  frontierModel, frontierTapModel, frontierFollowNote, frontierLanding, frontierMapHtml,
  tickerListHtml,
  rhythmModel, rhythmHeaderHtml, skyWord,
  citizenKeyOf,
} from '../logic.mjs';

const labelFor = (code) => ({ EMBER_PLAZA_OF_UNITY: 'Plaza of Unity', EMBER_COLLEGE: 'The College', MARKET_HALL: 'Market Hall', FRONTIER_CAMP_9: 'a frontier camp' })[code] || String(code || '');

const LAYOUT = {
  version: 1,
  nodes: [
    { code: 'EMBER_PLAZA_OF_UNITY', label: 'Plaza of Unity', x: 4, y: 4, kind: 'room' },
    { code: 'EMBER_COLLEGE', label: 'The College', x: 6, y: 2, kind: 'room' },
    { code: 'MARKET_HALL', label: 'Market Hall', x: 1, y: 5, kind: 'room' },
  ],
  edges: [],
};

const citizen = (name, over = {}) => ({
  citizenKey: `portal-key:${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
  citizenId: null, citizenIdStatus: 'UNBOUND_NO_ROUTE', handle: '',
  name, placeCode: 'EMBER_PLAZA_OF_UNITY', state: 'present',
  evidenceUtc: '2026-11-03T10:00:00.000Z', firstSeenUtc: '2026-11-01T09:00:00.000Z',
  provenance: { route: 'voices', fetchedUtc: '2026-11-03T10:00:05.000Z' },
  ...over,
});

const bundleOf = (over = {}) => ({
  schema: 'portal.world-data/v2', bundleSeq: 7,
  world: { bookId: 'world-001', integritySource: 'none-in-tier-p' },
  counters: { populationKnown: 291 },
  ember: { districts: [], plots: [], works: [] },
  citizens: [], citizenCollisions: [], ticker: [],
  newestFetchUtc: '2026-11-03T10:00:05.000Z',
  ...over,
});

const journey = (c, from, to, dep, arr) => ({
  citizenKey: citizenKeyOf(c), name: c.name, from, to, path: [from, to],
  departureUtc: dep, arrivalUtc: arr, reconstructed: true,
  disclosure: 'This journey is reconstructed from the public feeds Portal reads.',
  evidence: { departureUtteranceId: 'u-dep', arrivalUtteranceId: 'u-arr', departureSnapshotFile: 'voices-a.json', arrivalSnapshotFile: 'voices-b.json' },
});
const journeysFeedOf = (journeys) => ({
  schema: 'portal.journeys/v1', bookId: 'world-001',
  disclosure: 'Journeys are reconstructed from utterance evidence.',
  generatedFrom: { voicesSnapshotCount: 12, firstVoicesSnapshotFile: '2026-11-02/voices-a.json', lastVoicesSnapshotFile: '2026-11-03/voices-b.json', voicesFetchCount: 12 },
  journeys,
});

const episode = (place, participants, firstUtc, count = 3) => ({
  place, participants, firstUtc, lastUtc: firstUtc, utteranceCount: count, corroborated: false,
  disclosure: 'Presence is evidenced at the moments each of them spoke.',
});
const episodesOf = (episodes) => ({
  episodes, actSequences: [],
  generatedFrom: { voicesFile: '2026-11-03/voices-b.json', newsFile: '2026-11-03/news-b.json' },
});

const growthOf = (firsts) => ({
  schema: 'portal.growth-book/v1', collectingSince: '2026-11-02',
  series: [], firsts, counterFields: [], counterLabels: {}, disclosures: {},
});

// ------------------------------------------------------------ M6.05

test('M6.05 badges: evidenced titles only, office words, office-first — no office, no badge', () => {
  const mayor = citizen('Atlas Meridian');
  const plain = citizen('Nia Okafor');
  const b = bundleOf({
    citizens: [mayor, plain],
    ember: { districts: [], plots: [], works: [], mayor: { name: 'Atlas Meridian', sits: true } },
  });
  const pageMayor = citizenPageModel(b, mayor, {}, { placeLabel: labelFor });
  assert.deepEqual(pageMayor.badges, ['Mayor']);
  const html = citizenPageHtml(pageMayor);
  assert.ok(html.includes('<span class="badge-word">Mayor</span>'));
  const pagePlain = citizenPageModel(b, plain, {}, { placeLabel: labelFor });
  assert.deepEqual(pagePlain.badges, []);
  assert.ok(!citizenPageHtml(pagePlain).includes('badge-word'), 'no badge is invented for a citizen the record names to no office');
});

test('M6.05 Now panel: arrival wording ONLY where a journey record bounds an arrival at the current place', () => {
  const nia = citizen('Nia Okafor'); // placed at the Plaza
  const feed = journeysFeedOf([
    journey(nia, 'EMBER_COLLEGE', 'EMBER_PLAZA_OF_UNITY', '2026-11-03T09:00:00.000Z', '2026-11-03T09:20:00.000Z'),
  ]);
  const page = citizenPageModel(bundleOf({ citizens: [nia] }), nia, { journeysFeed: feed }, { placeLabel: labelFor });
  assert.ok(page.arrival, 'a bound arrival at the current place produces the arrival line');
  assert.ok(page.arrival.text.startsWith('Arrived at Plaza of Unity'));
  // A journey whose destination is NOT the current place bounds no arrival here.
  const feed2 = journeysFeedOf([
    journey(nia, 'EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE', '2026-11-03T08:00:00.000Z', '2026-11-03T08:20:00.000Z'),
  ]);
  const page2 = citizenPageModel(bundleOf({ citizens: [nia] }), nia, { journeysFeed: feed2 }, { placeLabel: labelFor });
  assert.equal(page2.arrival, null);
  assert.ok(!citizenPageHtml(page2).includes('Arrived at'), 'no arrival wording without a recorded bound');
  // No journeys feed at all: no arrival.
  const page3 = citizenPageModel(bundleOf({ citizens: [nia] }), nia, {}, { placeLabel: labelFor });
  assert.equal(page3.arrival, null);
  // A citizen the record does not place cannot have arrived anywhere.
  assert.equal(recordedArrival(citizen('Ghost', { state: 'unknown', placeCode: null }), feed), null);
});

test('M6.05 fast facts: real record facts only; College standing by department, never one score', () => {
  const prof = citizen('Prof Elm', {
    collegeStanding: [{ department: 'History', standing: 'Senior reader' }, { department: 'Letters', standing: 'Contributor' }],
  });
  const page = citizenPageModel(bundleOf({ citizens: [prof] }), prof, {}, { placeLabel: labelFor });
  const labels = page.facts.map((f) => f.label);
  assert.ok(labels.includes('First seen in the record') && labels.includes('Last heard from'));
  const college = page.facts.find((f) => f.label.startsWith('College standing'));
  assert.ok(college, 'a carried per-department standing renders');
  assert.ok(college.value.includes('History: Senior reader') && college.value.includes('Letters: Contributor'), 'departments listed, not collapsed');
  // A lone scalar standing renders NOTHING — the plan forbids one score.
  const solo = citizen('Solo Score', { collegeStanding: 87 });
  assert.equal(collegeStandingOf(solo), null);
  const soloPage = citizenPageModel(bundleOf({ citizens: [solo] }), solo, {}, { placeLabel: labelFor });
  assert.ok(!soloPage.facts.some((f) => f.label.startsWith('College')), 'no one-score fact');
  assert.ok(!citizenPageHtml(soloPage).includes('87'), 'the scalar never reaches the page');
});

test('M6.05 story: entries are cited from the record; namesake episode attribution carries its caveat', () => {
  const nathA = citizen('Nath B', { citizenKey: 'portal-key:nath-b' });
  const nathB = citizen('Nath B', { citizenKey: 'portal-key:nath-b-2', placeCode: 'EMBER_COLLEGE' });
  const solo = citizen('Nia Okafor');
  const b = bundleOf({
    citizens: [nathA, nathB, solo],
    citizenCollisions: [{ citizenKeys: ['portal-key:nath-b', 'portal-key:nath-b-2'] }],
  });
  const eps = episodesOf([
    episode('EMBER_PLAZA_OF_UNITY', ['Nath B', 'Nia Okafor'], '2026-11-02T20:00:00.000Z', 5),
    episode('EMBER_COLLEGE', ['Nia Okafor'], '2026-11-02T21:00:00.000Z', 2),
  ]);
  const soloPage = citizenPageModel(b, solo, { episodesSource: eps }, { placeLabel: labelFor });
  const soloEps = soloPage.story.filter((s) => s.kind === 'episode');
  assert.equal(soloEps.length, 2);
  assert.ok(soloEps.every((s) => s.caveat === null), 'an unambiguous name attributes cleanly');
  const nathPage = citizenPageModel(b, nathA, { episodesSource: eps }, { placeLabel: labelFor });
  const nathEps = nathPage.story.filter((s) => s.kind === 'episode');
  assert.equal(nathEps.length, 1);
  assert.ok(nathEps[0].caveat && nathEps[0].caveat.includes('more than one citizen'), 'a shared name is flagged, never silently assigned');
  assert.ok(nathPage.story.every((s) => s.claim && typeof s.claim === 'object'), 'every story entry carries its inspector claim');
});

test('M6.05 private-life line: on the model and the page, in plain words', () => {
  const c = citizen('Nia Okafor');
  const page = citizenPageModel(bundleOf({ citizens: [c] }), c, {}, { placeLabel: labelFor });
  assert.ok(page.privateLife.includes('Portal sees only what the public feeds publish'));
  assert.ok(page.privateLife.includes('does not guess at them'));
  assert.ok(citizenPageHtml(page).includes('What Portal cannot see'));
});

test('M6.05 exit gate: 10 sampled claims from built pages trace through the inspector to their records', () => {
  const atlas = citizen('Atlas Meridian');
  const nia = citizen('Nia Okafor', { placeCode: 'EMBER_COLLEGE' });
  const orrin = citizen('Orrin Lowmarsh', { placeCode: 'MARKET_HALL' });
  const b = bundleOf({
    citizens: [atlas, nia, orrin],
    ember: { districts: [], plots: [], works: [], mayor: { name: 'Atlas Meridian', sits: true } },
  });
  const eps = episodesOf([
    episode('EMBER_PLAZA_OF_UNITY', ['Atlas Meridian', 'Nia Okafor'], '2026-11-02T20:00:00.000Z', 5),
    episode('EMBER_COLLEGE', ['Nia Okafor', 'Orrin Lowmarsh'], '2026-11-02T21:00:00.000Z', 4),
    episode('MARKET_HALL', ['Orrin Lowmarsh'], '2026-11-02T22:00:00.000Z', 2),
  ]);
  const jf = journeysFeedOf([
    journey(atlas, 'EMBER_COLLEGE', 'EMBER_PLAZA_OF_UNITY', '2026-11-03T08:00:00.000Z', '2026-11-03T08:30:00.000Z'),
    journey(nia, 'EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE', '2026-11-03T08:10:00.000Z', '2026-11-03T08:40:00.000Z'),
    journey(orrin, 'EMBER_COLLEGE', 'MARKET_HALL', '2026-11-03T08:20:00.000Z', '2026-11-03T08:50:00.000Z'),
  ]);
  const gb = growthOf([
    { date: '2026-10-31', atUtc: null, kind: 'first-mayor', detail: 'Atlas Meridian became the first Mayor of Ember.', subject: { name: 'Atlas Meridian' }, provenance: { preseed: true, source: 'The Mayor’s Ledger', citedLine: 'Elected 2026-10-31: 8 of 8 weight, 5 voters' } },
    { date: '2026-11-03', atUtc: '2026-11-03T07:00:00.000Z', kind: 'first-journey', detail: 'Nia Okafor was the first citizen whose journey Portal reconstructed.', subject: { name: 'Nia Okafor' }, bundleSeq: 480, provenance: { route: 'overview' } },
  ]);
  const claims = [];
  for (const c of [atlas, nia, orrin]) {
    const page = citizenPageModel(b, c, { journeysFeed: jf, episodesSource: eps, growthBook: gb }, { placeLabel: labelFor });
    for (const s of page.story) claims.push(s.claim);
    if (page.arrival) claims.push(page.arrival.claim);
  }
  assert.ok(claims.length >= 10, `the fixture pages carry ${claims.length} claims (need ≥ 10 to sample)`);
  // Deterministic "random" sample: a fixed-seed LCG stride, so the
  // sample is stable run to run but not hand-picked.
  let seed = 20261103;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pool = [...claims];
  const sample = [];
  while (sample.length < 10 && pool.length) sample.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  assert.equal(sample.length, 10);
  const keys = new Set();
  for (const claim of sample) {
    const model = inspectorModel(claim);
    assert.ok(model.claimText && model.claimText.length > 0, `claim text present (${claim.type})`);
    assert.ok(model.sourceText && model.sourceText.length > 40, `claim resolves to a named source (${claim.type}): ${model.sourceText}`);
    assert.ok(/2026|town record|voices|bundle/.test(model.sourceText), `the source is concrete (${claim.type})`);
    assert.ok(model.evidenceClass === 'feed-evidenced' || model.evidenceClass === 'record-attested', `evidence class marked (${claim.type})`);
    assert.ok(!keys.has(model.claimKey), 'claim keys are book-scoped and distinct');
    keys.add(model.claimKey);
  }
});

test('M6.05 page HTML escapes feed-born text (M2.15 holds on the new surface)', () => {
  const evil = citizen('<img src=x onerror=alert(1)>', { citizenKey: 'portal-key:evil' });
  const page = citizenPageModel(bundleOf({ citizens: [evil] }), evil, {}, { placeLabel: labelFor });
  const html = citizenPageHtml(page);
  assert.ok(!html.includes('<img src=x'), 'no raw markup from a name reaches the page');
  assert.ok(html.includes('&lt;img'), 'the name renders as text');
});

// ------------------------------------------------------------ M6.11

const frontierBundle = (counters, over = {}) => bundleOf({ counters: { populationKnown: 291, ...counters }, ...over });

test('M6.11 fill states: class counts derive from the counters by subtraction; the grid matches in proportion', () => {
  const m = frontierModel(frontierBundle({ regionsDiscovered: 1000, regionsSurveyed: 600, regionsNamed: 250 }));
  assert.deepEqual(m.classes, { named: 250, surveyed: 350, found: 400 });
  assert.equal(m.grid.length, 100);
  const count = (k) => m.grid.filter((c) => c === k).length;
  assert.equal(count('named'), 25);
  assert.equal(count('surveyed'), 35);
  assert.equal(count('found'), 40);
  // Deterministic: same bundle, same grid, byte for byte.
  assert.deepEqual(frontierModel(frontierBundle({ regionsDiscovered: 1000, regionsSurveyed: 600, regionsNamed: 250 })).grid, m.grid);
  // No square renders beyond its class: the grid carries classes only.
  assert.ok(m.grid.every((c) => ['named', 'surveyed', 'found'].includes(c)));
});

test('M6.11: absent counters draw nothing and say so; non-nesting counters clamp, never go negative', () => {
  const m = frontierModel(bundleOf({ counters: { populationKnown: 291 } }));
  assert.equal(m.classes, null);
  assert.deepEqual(m.grid, []);
  assert.ok(frontierMapHtml(m).includes('not carrying the frontier counts'));
  const bad = frontierModel(frontierBundle({ regionsDiscovered: 100, regionsSurveyed: 40, regionsNamed: 90 }));
  assert.equal(bad.countersClamped, true);
  assert.ok(bad.classes.named <= 100 && bad.classes.surveyed >= 0 && bad.classes.found >= 0);
  assert.equal(bad.classes.named + bad.classes.surveyed + bad.classes.found, 100);
});

test('M6.11 legend: sentences, with unsurveyed as blank parchment — unknown, never empty land', () => {
  const m = frontierModel(frontierBundle({ regionsDiscovered: 1000, regionsSurveyed: 600, regionsNamed: 250 }));
  const html = frontierMapHtml(m);
  for (const l of m.legend) assert.ok(html.includes(l.sentence), `legend sentence for ${l.key}`);
  const unknown = m.legend.find((l) => l.key === 'unknown');
  assert.ok(unknown.sentence.includes('Unknown is not empty land'));
  assert.ok(html.includes('1,000 regions found') && html.includes('600 of them surveyed') && html.includes('250 of them named'), 'counters equal the bundle’s at its seq');
  assert.ok(html.includes('bundle 7'), 'the seq rides the counters line');
  assert.ok(html.includes('record counts the ground; it does not map it'), 'the arrangement is disclosed as staging');
});

test('M6.11 tap: a square answers with its class and the name situation; parchment answers unknown', () => {
  const m = frontierModel(frontierBundle({ regionsDiscovered: 1000, regionsSurveyed: 600, regionsNamed: 250 }));
  const namedTap = frontierTapModel(m, 0);
  assert.equal(namedTap.cls, 'named');
  assert.ok(namedTap.text.includes('does not name this patch'), 'no name or namer is invented for a square');
  const off = frontierTapModel(m, -1);
  assert.ok(off.text.includes('Unknown is not empty land'), 'off the found ground, the answer is the parchment sentence');
  // A carriage that names a square: the tap gives the name + namer.
  const carried = frontierModel(frontierBundle(
    { regionsDiscovered: 1000, regionsSurveyed: 600, regionsNamed: 250 },
    { frontierRegions: [{ name: 'Kestrel Reach', namedBy: 'Orrin Lowmarsh', class: 'named', cell: 0 }] },
  ));
  const tap = frontierTapModel(carried, 0);
  assert.ok(tap.text.includes('Kestrel Reach') && tap.text.includes('named by Orrin Lowmarsh'));
  assert.ok(frontierMapHtml(carried).includes('Kestrel Reach — named by Orrin Lowmarsh'), 'carried names list with their namers');
});

test('M6.11 routes: recorded journeys as sequences in the record’s order, with the disclosure', () => {
  const c = citizen('Nia Okafor');
  const jf = journeysFeedOf([
    journey(c, 'EMBER_COLLEGE', 'MARKET_HALL', '2026-11-03T09:00:00.000Z', '2026-11-03T09:30:00.000Z'),
    journey(c, 'EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE', '2026-11-03T08:00:00.000Z', '2026-11-03T08:30:00.000Z'),
  ]);
  const m = frontierModel(frontierBundle({ regionsDiscovered: 10, regionsSurveyed: 5, regionsNamed: 2 }), jf);
  assert.equal(m.routes.length, 1);
  assert.deepEqual(m.routes[0].legs.map((j) => j.from), ['EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE'], 'legs in departure order, not feed order');
  const html = frontierMapHtml(m);
  assert.ok(html.includes('claims order only'), 'a sequence claims order, never map geometry');
  const empty = frontierModel(frontierBundle({ regionsDiscovered: 10, regionsSurveyed: 5, regionsNamed: 2 }), journeysFeedOf([]));
  assert.deepEqual(empty.routes, []);
  assert.ok(frontierMapHtml(empty).includes('No journeys are reconstructed'));
});

test('M6.11 frontier landings: frontier items land on this map; town items and landing-less town news do not', () => {
  const b = frontierBundle({ regionsDiscovered: 10, regionsSurveyed: 5, regionsNamed: 2 }, {
    citizens: [citizen('Orrin Lowmarsh')],
  });
  const ruin = { kind: 'RUIN_EXCAVATED', text: 'Orrin Lowmarsh dug into an old ruin at -27, 17.', placeCode: null, handles: [] };
  assert.deepEqual(frontierLanding(ruin, b, LAYOUT), { type: 'frontier' });
  const offMap = { kind: 'CITY_EVENT_BEGAN', text: 'Something began at a camp.', placeCode: 'FRONTIER_CAMP_9', handles: [] };
  assert.deepEqual(frontierLanding(offMap, b, LAYOUT), { type: 'frontier' }, 'a place code the town plan does not carry is beyond the wall');
  const town = { kind: 'CITY_EVENT_BEGAN', text: 'A lecture began at the College.', placeCode: 'EMBER_COLLEGE', handles: [] };
  assert.equal(frontierLanding(town, b, LAYOUT), null, 'a stage landing exists — the frontier is not its there');
  const peoples = { kind: 'PEOPLE_ALL_KINDS', text: 'The Ostthir have given up every kind of artifact they left.', placeCode: null, handles: [] };
  assert.equal(frontierLanding(peoples, b, LAYOUT), null, 'no structured frontier signal, no landing is invented');
  // The ticker list wires the frontier button only under the opt-in.
  const withOpt = tickerListHtml(bundleOf({ ticker: [ruin], citizens: b.citizens }), [], { layout: LAYOUT, frontier: true });
  assert.ok(withOpt.includes('data-there-frontier="0"'));
  const without = tickerListHtml(bundleOf({ ticker: [ruin], citizens: b.citizens }), [], { layout: LAYOUT });
  assert.ok(!without.includes('data-there-frontier'), 'the opt-in keeps other callers’ lists unchanged');
});

test('M6.11 Follow hands off at the wall: an evidenced citizen beyond the town plan continues here', () => {
  const out = citizen('Far Walker', { placeCode: 'FRONTIER_CAMP_9' });
  const inTown = citizen('Nia Okafor');
  const lost = citizen('Lost Person', { state: 'unknown', placeCode: null });
  const b = bundleOf({ citizens: [out, inTown, lost] });
  const note = frontierFollowNote(b, LAYOUT, citizenKeyOf(out));
  assert.ok(note && note.text.includes('beyond Ember\'s wall'));
  assert.equal(frontierFollowNote(b, LAYOUT, citizenKeyOf(inTown)), null, 'a town place needs no hand-off');
  assert.equal(frontierFollowNote(b, LAYOUT, citizenKeyOf(lost)), null, 'an unevidenced citizen is not placed anywhere, wall or no wall');
});

// ------------------------------------------------------------ M6.14

const rhythmBundle = (citizens, world = {}) => bundleOf({
  citizens,
  world: { bookId: 'world-001', integritySource: 'none-in-tier-p', worldHour: 14, season: 'SUMMER', year: 46, sky: 'OVERCAST', ...world },
});
const placed = (n, awake) => Array.from({ length: n }, (_, i) => citizen(`Citizen ${i}`, { citizenKey: `portal-key:citizen-${i}`, state: i < awake ? 'present' : 'asleep' }));

test('M6.14 three staged bundles render the exact state wording, each with its basis', () => {
  const busy = rhythmModel(rhythmBundle(placed(10, 8)));
  assert.equal(busy.state, 'busy');
  assert.equal(busy.stateText, 'Ember is busy');
  assert.ok(busy.basisText.includes('8 of the 10 citizens'), 'the basis is the counts the state was read from');
  const quiet = rhythmModel(rhythmBundle(placed(5, 2)));
  assert.equal(quiet.state, 'normal quiet');
  assert.equal(quiet.stateText, 'Ember is quiet, in the normal way');
  assert.ok(quiet.basisText.includes('2 of the 5 citizens'));
  const resting = rhythmModel(rhythmBundle(placed(6, 0)));
  assert.equal(resting.state, 'resting');
  assert.equal(resting.stateText, 'Ember is resting');
  assert.equal(resting.tone, 'dusk');
  assert.ok(resting.basisText.includes('All 6 citizens'));
  const empty = rhythmModel(rhythmBundle([]));
  assert.equal(empty.state, 'normal quiet');
  assert.ok(empty.basisText.includes('Nobody is in the public feeds'));
});

test('M6.14 drill: the resting frame is never called "night" — in any state, model or HTML', () => {
  const bundles = [rhythmBundle(placed(10, 8)), rhythmBundle(placed(5, 2)), rhythmBundle(placed(6, 0)), rhythmBundle([], { worldHour: 23 })];
  for (const b of bundles) {
    const model = rhythmModel(b);
    const rendered = `${JSON.stringify(model)} ${rhythmHeaderHtml(model)}`.toLowerCase();
    assert.ok(!rendered.includes('night'), `no day-part label (state: ${model.state}, worldHour: ${model.worldHour})`);
  }
  // The world's own clock is still shown as data — hour 23 included.
  const late = rhythmModel(rhythmBundle(placed(6, 0), { worldHour: 23 }));
  assert.ok(rhythmHeaderHtml(late).includes('world\'s own clock reads hour 23'));
});

test('M6.14 recorded weather: renders only from a record, captioned as recorded weather', () => {
  const withSky = rhythmModel(rhythmBundle(placed(3, 1)));
  assert.equal(withSky.weather.word, 'overcast');
  assert.ok(withSky.weather.caption.startsWith('Recorded weather over Ember: overcast.'));
  assert.ok(withSky.weather.caption.includes('the world\'s own outlook'));
  assert.ok(rhythmHeaderHtml(withSky).includes('Recorded weather over Ember: overcast.'));
  const noSky = rhythmModel(rhythmBundle(placed(3, 1), { sky: undefined }));
  assert.equal(noSky.weather, null, 'no sky in the record, no weather on the page');
  assert.ok(!rhythmHeaderHtml(noSky).includes('Recorded weather'));
  // The record's vocabulary, de-coded — never the raw code.
  assert.equal(skyWord('BLIZZARD'), 'blizzard');
  assert.equal(skyWord('PARTLY_CLOUDY'), 'partly cloudy');
  assert.equal(skyWord(''), null);
  assert.equal(skyWord(undefined), null);
});
