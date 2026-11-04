// Find & watch (M6 lane F): the ticker completion (M6.01), the
// now-in-Ember line (M6.03), roster + card completion (M6.04), the
// provenance inspector (M6.06), and the locate routes + portrait
// strip (M6.02) — at the pure-model level, against fixtures shaped
// like the real record. Live-bundle cold verification is a recorded
// run in plan-to-complete/lane-m6-find.md, not a suite dependency:
// the live record moves, and this suite must not rot with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tickerChip, tickerDeadlineText, tickerLanding, movementLanding,
  tickerListHtml, tickerCardHtml, citizenCardHtml, rosterListHtml,
  nowLineModel, populationCounts,
  officesOf, citizenTitleLine, namesakeInfo, whereNowLine,
  inspectorModel, inspectorHtml, resetBannerModel, resetBannerHtml, bookClaimKey,
  directoryModel, directoryListHtml, portraitStripModel, portraitStripHtml,
  citizenKeyOf,
} from '../logic.mjs';

const labelFor = (code) => ({ EMBER_PLAZA_OF_UNITY: 'Plaza of Unity', EMBER_COLLEGE: 'The College', MARKET_HALL: 'Market Hall' })[code] || String(code || '');

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
  ...over,
});

// ------------------------------------------------------------ M6.01

test('M6.01 chip: every headline kind the archive carries maps to icon + plain word', () => {
  for (const kind of ['RUIN_EXCAVATED', 'STRUCTURE_COLLAPSED', 'CITY_EVENT_BEGAN', 'HAPPENING_WITNESSED', 'OUTLOOK_CHANGED', 'PEOPLE_ALL_KINDS']) {
    const chip = tickerChip(kind);
    assert.equal(chip.known, true, kind);
    assert.ok(chip.icon && chip.word, kind);
    assert.ok(!chip.word.includes('_'), 'the word is a word, not a spaced-out code');
  }
  const unknown = tickerChip('SOME_FUTURE_KIND');
  assert.deepEqual({ icon: unknown.icon, word: unknown.word }, { icon: '●', word: 'News' });
});

test('M6.01: raw feed kinds never render in the ticker list or the card — only in the inspector', () => {
  const b = bundleOf({
    citizens: [citizen('Orrin Lowmarsh')],
    ticker: [
      { kind: 'RUIN_EXCAVATED', text: 'Orrin Lowmarsh dug into an old ruin at -27, 15.', utc: '2026-11-03T10:34:54.000Z', placeCode: null, handles: [], provenance: { route: 'news', fetchedUtc: '2026-11-03T10:35:45.000Z' } },
      { kind: 'PEOPLE_ALL_KINDS', text: 'The Ostthir have given up every kind of artifact they left.', utc: '2026-11-03T10:30:00.000Z', placeCode: null, handles: [], provenance: { route: 'news', fetchedUtc: '2026-11-03T10:35:45.000Z' } },
    ],
  });
  const list = tickerListHtml(b, [], { layout: LAYOUT });
  assert.ok(!list.includes('RUIN_EXCAVATED') && !list.includes('PEOPLE_ALL_KINDS'), 'no raw kind in the list');
  assert.ok(list.includes('⚒ Ruin dug') && list.includes('☺ The peoples'), 'chips carry icon + word');
  const card = tickerCardHtml(b.ticker[0], b, labelFor);
  assert.ok(!card.includes('RUIN_EXCAVATED'), 'no raw kind on the card');
  assert.ok(card.includes('Ruin dug'));
  const insp = inspectorHtml(inspectorModel({ type: 'ticker', bundle: b, item: b.ticker[0] }));
  assert.ok(insp.includes('RUIN_EXCAVATED'), 'the inspector is the one surface that shows the raw kind');
});

test('M6.01: every ticker item carries a Record action; Take me there only where a landing resolves', () => {
  const orrin = citizen('Orrin Lowmarsh');
  const b = bundleOf({
    citizens: [orrin],
    ticker: [
      { kind: 'CITY_EVENT_BEGAN', text: 'A lecture began at the College.', utc: '2026-11-03T10:00:00.000Z', placeCode: 'EMBER_COLLEGE', handles: [], provenance: { route: 'news', fetchedUtc: '2026-11-03T10:00:05.000Z' } },
      { kind: 'HAPPENING_WITNESSED', text: 'Orrin Lowmarsh was seen at the Plaza.', utc: '2026-11-03T10:01:00.000Z', placeCode: null, handles: [citizenKeyOf(orrin)], provenance: { route: 'news', fetchedUtc: '2026-11-03T10:01:05.000Z' } },
      { kind: 'RUIN_EXCAVATED', text: 'Orrin Lowmarsh dug into an old ruin at -27, 15.', utc: '2026-11-03T10:02:00.000Z', placeCode: null, handles: [], provenance: { route: 'news', fetchedUtc: '2026-11-03T10:02:05.000Z' } },
    ],
  });
  assert.deepEqual(tickerLanding(b.ticker[0], b, LAYOUT), { type: 'place', code: 'EMBER_COLLEGE', label: 'The College' });
  assert.deepEqual(tickerLanding(b.ticker[1], b, LAYOUT), { type: 'citizen', key: citizenKeyOf(orrin), name: 'Orrin Lowmarsh' });
  assert.equal(tickerLanding(b.ticker[2], b, LAYOUT), null, 'a frontier ruin has no stage landing — and no name is parsed out of the sentence to invent one');
  const html = tickerListHtml(b, [], { layout: LAYOUT });
  assert.equal((html.match(/data-record-item=/g) || []).length, 3, 'Record on every item');
  assert.equal((html.match(/data-there-item=/g) || []).length, 2, 'Take me there exactly where landings resolve');
});

test('M6.01 deadline: a structured due stamp reads "Answer due by [date]"; no stamp, no deadline', () => {
  const due = { kind: 'CITY_EVENT_BEGAN', text: 'Answers are called for.', utc: '2026-11-03T10:00:00.000Z', dueUtc: '2026-11-12T09:00:00.000Z', placeCode: null, handles: [], provenance: { route: 'news', fetchedUtc: '2026-11-03T10:00:05.000Z' } };
  assert.equal(tickerDeadlineText(due), 'Answer due by 12 Nov 2026');
  assert.equal(tickerDeadlineText({ ...due, dueUtc: undefined }), null);
  assert.equal(tickerDeadlineText({ ...due, dueUtc: 'not a date' }), null);
  const html = tickerListHtml(bundleOf({ ticker: [due] }), [], { layout: LAYOUT });
  assert.ok(html.includes('Answer due by 12 Nov 2026'));
});

test('M6.01 movement lines: chip + Record always; a landing only while the citizen is placed', () => {
  const nia = citizen('Nia Okafor');
  const b = bundleOf({ citizens: [nia] });
  const line = { kind: 'entry', key: citizenKeyOf(nia), utc: '2026-11-03T10:00:00.000Z', staging: true, hold: false, text: 'Nia Okafor is in the public feeds Portal reads again — at Plaza of Unity.', disclosure: 'd' };
  assert.deepEqual(movementLanding(line, b, null), { type: 'citizen', key: citizenKeyOf(nia) });
  const held = new Map([[citizenKeyOf(nia), { presence: 'placed', conflict: { claims: [] }, shown: { placeCode: 'EMBER_PLAZA_OF_UNITY' } }]]);
  assert.equal(movementLanding(line, b, held), null, 'a held citizen has no landing');
  const html = tickerListHtml(b, [line], { layout: LAYOUT });
  assert.ok(html.includes('→ Movement') && html.includes('data-record-move="0"'));
});

// ------------------------------------------------------------ M6.03

test('M6.03: the live-shaped hour — 14 placed, 8 at the Plaza, all asleep — clause by clause', () => {
  const at = (placeCode, n) => Array.from({ length: n }, (_, i) => citizen(`C${placeCode}${i}`, { placeCode, state: 'asleep' }));
  const b = bundleOf({ citizens: [...at('EMBER_PLAZA_OF_UNITY', 8), ...at('EMBER_COLLEGE', 4), ...at('EMBER_TOWNHALL', 2)] });
  const m = nowLineModel(b);
  assert.deepEqual(
    { placed: m.placed, awake: m.awake, asleep: m.asleep, atPlaza: m.atPlaza },
    { placed: 14, awake: 0, asleep: 14, atPlaza: 8 },
  );
  assert.equal(m.text, '14 citizens are in the public feeds Portal reads right now, 8 of them at the Plaza. All of them are asleep / away. Ember is quiet — that is a normal hour for this town.');
});

test('M6.03: mixed hour — asleep clause counts only the asleep; unknown citizens count nowhere', () => {
  const b = bundleOf({
    citizens: [
      citizen('A One', { placeCode: 'EMBER_PLAZA_OF_UNITY' }),
      citizen('B Two', { placeCode: 'EMBER_COLLEGE' }),
      citizen('C Three', { placeCode: 'EMBER_COLLEGE', state: 'asleep' }),
      citizen('D Four', { placeCode: null, state: 'unknown', evidenceUtc: null }),
    ],
  });
  const m = nowLineModel(b);
  assert.deepEqual({ placed: m.placed, awake: m.awake, asleep: m.asleep, atPlaza: m.atPlaza }, { placed: 3, awake: 2, asleep: 1, atPlaza: 1 });
  assert.equal(m.text, '3 citizens are in the public feeds Portal reads right now, 1 of them at the Plaza. 1 of them is asleep / away.');
});

test('M6.03: an all-unknown bundle yields the quiet wording, not a number', () => {
  const b = bundleOf({
    citizens: [citizen('X One', { placeCode: null, state: 'unknown', evidenceUtc: null }), citizen('Y Two', { placeCode: null, state: 'unknown', evidenceUtc: null })],
  });
  const m = nowLineModel(b);
  assert.equal(m.text, 'Nobody is in the public feeds Portal reads right now. Ember is quiet — that is a normal hour for this town.');
  assert.equal(m.quiet, true);
  const single = nowLineModel(bundleOf({ citizens: [citizen('Solo')] }));
  assert.ok(single.text.startsWith('1 citizen is in the public feeds'), 'singular grammar');
});

test('M6.03: population is three distinct numbers, never one bare number', () => {
  const b = bundleOf({
    counters: { populationKnown: 291 },
    citizens: [citizen('A'), citizen('B'), citizen('C', { placeCode: null, state: 'unknown', evidenceUtc: null })],
  });
  assert.deepEqual(populationCounts(b), { joined: 291, nameable: 3, placed: 2 });
  assert.equal(populationCounts(bundleOf({ counters: {} })).joined, null, 'an absent joined count stays absent, never zero-filled');
});

// ------------------------------------------------------------ M6.04

const namesakeBundle = () => {
  const sam1 = citizen('Sam Reed', { citizenKey: 'portal-key:sam-reed', firstSeenUtc: '2026-11-01T09:00:00.000Z' });
  const sam2 = citizen('Sam Reed', { citizenKey: 'portal-key:sam-reed#2', firstSeenUtc: '2026-11-02T09:00:00.000Z', placeCode: 'EMBER_COLLEGE' });
  return bundleOf({
    citizens: [sam1, sam2],
    citizenCollisions: [{ key: 'portal-key:sam-reed', names: ['Sam Reed', 'Sam Reed'], citizenKeys: ['portal-key:sam-reed', 'portal-key:sam-reed#2'] }],
  });
};

test('M6.04: a staged namesake pair renders two distinguishable rows and two distinguishable cards', () => {
  const b = namesakeBundle();
  const [sam1, sam2] = b.citizens;
  assert.deepEqual(namesakeInfo(b, sam1), { count: 2, ordinal: 1, firstSeenUtc: sam1.firstSeenUtc });
  assert.deepEqual(namesakeInfo(b, sam2), { count: 2, ordinal: 2, firstSeenUtc: sam2.firstSeenUtc });
  const rows = rosterListHtml(b, labelFor);
  assert.ok(rows.includes('record 1 of 2') && rows.includes('record 2 of 2'), 'rows are distinguishable at a glance');
  const card1 = citizenCardHtml(sam1, labelFor, null, { bundle: b });
  const card2 = citizenCardHtml(sam2, labelFor, null, { bundle: b });
  assert.notEqual(card1, card2);
  assert.ok(card1.includes('record 1 of 2') && card2.includes('record 2 of 2'));
  assert.ok(card1.includes('2 citizens in the record share this name'));
  assert.notEqual(citizenKeyOf(sam1), citizenKeyOf(sam2), 'the follow keys never merge');
});

test('M6.04: office titles are words only, office-first — and an ambiguous name binds no office', () => {
  const mayor = citizen('Atlas Meridian', { placeCode: 'EMBER_COLLEGE' });
  const other = citizen('Orrin Lowmarsh');
  const b = bundleOf({ citizens: [mayor, other], offices: [{ office: 'MAYOR', citizenKey: citizenKeyOf(mayor) }] });
  assert.equal(citizenTitleLine(b, mayor), 'Mayor');
  assert.equal(citizenTitleLine(b, other), null);
  assert.ok(citizenCardHtml(mayor, labelFor, null, { bundle: b }).includes('<p class="title-line">Mayor</p>'));
  assert.ok(rosterListHtml(b, labelFor).includes('<span class="title-word">Mayor</span>'));
  // The overview shape carried verbatim (ember.mayor) resolves by name.
  const b2 = bundleOf({ citizens: [mayor, other], ember: { districts: [], plots: [], works: [], mayor: { name: 'Atlas Meridian', sits: true } } });
  assert.equal(citizenTitleLine(b2, mayor), 'Mayor');
  // A name two citizens share binds the office to NEITHER.
  const nb = namesakeBundle();
  nb.ember.mayor = { name: 'Sam Reed', sits: true };
  assert.equal(officesOf(nb)[0].key, null);
  assert.equal(citizenTitleLine(nb, nb.citizens[0]), null);
  assert.equal(citizenTitleLine(nb, nb.citizens[1]), null);
});

test('M6.04: Where now is never blank, for every state and placement state', () => {
  const states = ['present', 'talking', 'working', 'travelling', 'asleep', 'unknown'];
  const placements = [
    null,
    { presence: 'placed', conflict: null, shown: { placeCode: 'EMBER_PLAZA_OF_UNITY' } },
    { presence: 'placed', conflict: { claims: [] }, shown: { placeCode: 'EMBER_COLLEGE' } },
    { presence: 'absent', conflict: null, shown: null },
  ];
  for (const state of states) {
    for (const placement of placements) {
      const c = citizen('Test Person', { state, placeCode: state === 'unknown' ? null : 'EMBER_PLAZA_OF_UNITY', evidenceUtc: state === 'unknown' ? null : '2026-11-03T10:00:00.000Z' });
      const line = whereNowLine(c, labelFor, placement);
      assert.equal(typeof line, 'string');
      assert.ok(line.trim().length > 0, `${state} / ${placement ? placement.presence + (placement.conflict ? '+conflict' : '') : 'untracked'} produced a blank Where now`);
    }
  }
  const held = whereNowLine(citizen('Test Person'), labelFor, placements[2]);
  assert.ok(held.startsWith('Place conflict — held at The College'));
});

test('M6.04: card actions — Follow (evidenced only) + Record (always) + [Their page →] (shipped by M6.05)', () => {
  // Pin history: this test originally pinned the ABSENCE of
  // [Their page →] so the action could not ship as a dead button
  // before the citizen page existed. M6.05 (the page + map lane,
  // 2026-11-03) landed the page, so the pin flips deliberately,
  // here, with the item named: the action now ships on EVERY card
  // — evidenced or not, since a roster-only citizen's page is their
  // honest unknown state — wired by app.js to the page panel.
  const placed = citizen('Placed Person');
  const lost = citizen('Lost Person', { state: 'unknown', placeCode: null, evidenceUtc: null });
  const b = bundleOf({ citizens: [placed, lost] });
  const placedCard = citizenCardHtml(placed, labelFor, null, { bundle: b });
  assert.ok(placedCard.includes(`Follow Placed Person`) && placedCard.includes('data-record-card'));
  const lostCard = citizenCardHtml(lost, labelFor, null, { bundle: b });
  assert.ok(!lostCard.includes('data-follow'), 'no Follow for a citizen the record does not place');
  assert.ok(lostCard.includes('data-record-card'), 'Record still opens their (honest unknown) claim');
  assert.ok(placedCard.includes('Their page →') && placedCard.includes(`data-page="${citizenKeyOf(placed)}"`), 'M6.05: [Their page →] ships on the placed card, keyed by PORTAL-KEY');
  assert.ok(lostCard.includes('Their page →') && lostCard.includes(`data-page="${citizenKeyOf(lost)}"`), 'M6.05: [Their page →] ships on the unevidenced card too — their page is the honest unknown state');
  const rows = rosterListHtml(b, labelFor);
  assert.ok(rows.includes('Watch — follow Placed Person'));
  assert.ok(rows.includes("Watch — see Lost Person's card"), 'an unevidenced citizen’s Watch opens their card — the M6 exit gate’s roster-only pass');
  for (const html of [placedCard, lostCard, rows]) {
    assert.ok(!/favour|health|loyalty|lifespan/i.test(html), 'no favour/health/lifespan analogues, ever');
  }
});

// ------------------------------------------------------------ M6.06

test('M6.06: a citizen claim shows its source (route + time) and both evidence classes, the right one marked', () => {
  const c = citizen('Nia Okafor');
  const b = bundleOf({ citizens: [c] });
  const model = inspectorModel({ type: 'citizen', bundle: b, citizen: c, placeLabel: labelFor });
  assert.equal(model.evidenceClass, 'feed-evidenced');
  assert.equal(model.claimKey, 'world-001:portal-key:nia-okafor');
  const html = inspectorHtml(model);
  assert.ok(html.includes('Read from the voices feed, at 2026-11-03T10:00:05.000Z.'));
  assert.ok(html.includes('Feed-evidenced') && html.includes('Record-attested'), 'both values shown');
  assert.ok(html.includes('<li class="marked"><strong>Feed-evidenced</strong> — this claim'));
  assert.ok(html.includes('World book: world-001'));
  assert.ok(html.includes('nobody is carried across by name'), 'the D6 reset wording is held ready on the surface');
});

test('M6.06: a building claim with no integrity marks NEITHER class and says why', () => {
  const b = bundleOf({ ember: { districts: [], plots: [], works: [{ code: 'MARKET_HALL', integrity: null, provenance: { route: 'map', fetchedUtc: '2026-11-03T10:00:05.000Z' } }] } });
  const node = { code: 'MARKET_HALL', label: 'Market Hall' };
  const model = inspectorModel({ type: 'building', bundle: b, node, work: b.ember.works[0] });
  assert.equal(model.evidenceClass, null);
  const html = inspectorHtml(model);
  assert.ok(html.includes('Feed-evidenced') && html.includes('Record-attested'), 'both values still shown');
  assert.ok(!html.includes('— this claim'), 'neither is marked');
  assert.ok(html.includes('Neither class is marked'));
});

test('M6.06 simulated reset: banner on a book change, old book readable, nobody merged by name', () => {
  const sam1 = citizen('Sam Reed', { citizenKey: 'portal-key:sam-reed' });
  const book1 = bundleOf({ citizens: [sam1] });
  const book2 = bundleOf({ citizens: [citizen('Sam Reed', { citizenKey: 'portal-key:sam-reed' })] });
  book2.world = { bookId: 'world-002', integritySource: 'none-in-tier-p' };
  assert.equal(resetBannerModel(null, book1), null, 'the first book a page sees is not a reset');
  assert.equal(resetBannerModel('world-001', book1), null, 'the same book is not a reset');
  const banner = resetBannerModel('world-001', book2);
  assert.ok(banner && banner.oldBook === 'world-001' && banner.newBook === 'world-002');
  const bannerHtml = resetBannerHtml(banner);
  assert.ok(bannerHtml.includes('A new world book') && bannerHtml.includes('world-002') && bannerHtml.includes('world-001'));
  assert.ok(bannerHtml.includes('nobody is carried across by name'));
  // No name-merge: the same name + same key in two books is two claims.
  const claim1 = inspectorModel({ type: 'citizen', bundle: book1, citizen: book1.citizens[0], placeLabel: labelFor });
  const claim2 = inspectorModel({ type: 'citizen', bundle: book2, citizen: book2.citizens[0], placeLabel: labelFor });
  assert.notEqual(claim1.claimKey, claim2.claimKey);
  assert.equal(claim1.claimKey, 'world-001:portal-key:sam-reed');
  assert.equal(claim2.claimKey, 'world-002:portal-key:sam-reed');
  assert.equal(bookClaimKey('world-001', 'portal-key:sam-reed'), claim1.claimKey);
  // The old book stays readable: its claims still build after the reset.
  const oldHtml = inspectorHtml(claim1);
  assert.ok(oldHtml.includes('Sam Reed') && oldHtml.includes('World book: world-001'));
});

// ------------------------------------------------------------ M6.02

test('M6.02 strip: mayor first BY OFFICE, and a staged mayor change moves the first face', () => {
  const a = citizen('Arabela Protoser');
  const mayorB = citizen('Brat Natha', { placeCode: 'EMBER_COLLEGE' });
  const c = citizen('Carmen Vale', { placeCode: 'MARKET_HALL' });
  const before = bundleOf({ citizens: [a, mayorB, c], offices: [{ office: 'MAYOR', citizenKey: citizenKeyOf(mayorB) }] });
  const strip1 = portraitStripModel(before, LAYOUT);
  assert.equal(strip1.entries[0].name, 'Brat Natha', 'the office holder leads, not the first-listed citizen');
  assert.equal(strip1.entries[0].office, 'Mayor');
  const after = bundleOf({ citizens: [a, mayorB, c], offices: [{ office: 'MAYOR', citizenKey: citizenKeyOf(c) }] });
  const strip2 = portraitStripModel(after, LAYOUT);
  assert.equal(strip2.entries[0].name, 'Carmen Vale', 'after the staged change, the new mayor leads');
  assert.equal(strip2.entries[0].office, 'Mayor');
  assert.equal(strip2.entries[1].name, 'Arabela Protoser', 'the rest keep bundle order');
});

test('M6.02 strip: at most seven faces, placed citizens only, the count stated honestly', () => {
  const nine = Array.from({ length: 9 }, (_, i) => citizen(`Person ${i}`, { placeCode: i % 2 ? 'EMBER_COLLEGE' : 'EMBER_PLAZA_OF_UNITY' }));
  const lost = citizen('Lost Person', { state: 'unknown', placeCode: null, evidenceUtc: null });
  const b = bundleOf({ citizens: [...nine, lost] });
  const strip = portraitStripModel(b, LAYOUT);
  assert.equal(strip.entries.length, 7);
  assert.equal(strip.placedTotal, 9);
  assert.ok(!strip.entries.some((e) => e.name === 'Lost Person'));
  const html = portraitStripHtml(strip);
  assert.ok(html.includes('Showing 7 of 9 placed citizens'));
  assert.equal((html.match(/data-follow=/g) || []).length, 7, 'one tap per face to a following camera');
});

test('M6.02 directory: every place listed with its occupants; empty places say so', () => {
  const b = bundleOf({
    citizens: [
      citizen('A One', { placeCode: 'EMBER_COLLEGE' }),
      citizen('B Two', { placeCode: 'EMBER_COLLEGE', state: 'asleep' }),
      citizen('C Three', { placeCode: null, state: 'unknown', evidenceUtc: null }),
    ],
    ember: { districts: [], plots: [], works: [{ code: 'MARKET_HALL', integrity: 85, provenance: { route: 'map', fetchedUtc: '2026-11-03T10:00:05.000Z' } }] },
  });
  const rows = directoryModel(b, LAYOUT);
  assert.equal(rows.length, 3);
  const college = rows.find((r) => r.code === 'EMBER_COLLEGE');
  assert.deepEqual(college.occupants.map((o) => o.name), ['A One', 'B Two'], 'asleep occupants are occupants — the record places them there');
  const html = directoryListHtml(rows);
  assert.ok(html.includes('Nobody is placed here in the public feeds Portal reads right now.'));
  assert.ok(html.includes('In good repair'), 'the repair word rides the row where a work carries one');
  assert.equal((html.match(/data-there-place=/g) || []).length, 3, 'every row can take you there');
});
