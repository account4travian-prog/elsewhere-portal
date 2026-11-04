// Archive thinning tests (M1.09, policy amended by the project owner's ruling
// 2026-11-03: 7-day deep window, thin the rest): synthetic archives in
// temp dirs only — the destructive path never runs against the real
// archive here. Covers: the deep-window boundary per route class, the
// kept-resolution (speech index / last-of-day / dated facts), the
// quotes-registry exemption (REC-13), the M1-window protection guard
// (health floor; explicit floors may extend, never shrink), the
// sealed-closed-book exemption, both AUTO-B11 abort controls (planted
// chain gap; bundle-reproduction failure), and post-thinning chain
// verification under the thinning-aware semantics thinning.mjs
// documents — end to end over a thinned segment spanning every class.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildChains, sha256Hex, verifyChain } from '../chain.mjs';
import { buildBundle } from '../build-bundle.mjs';
import {
  planThinning, thinArchive, verifyWithThinning, bundlesMatch,
  snapshotIdFor, loadQuotesRegistry, judgementWindowStartUtc,
} from '../thinning.mjs';

const NOW = Date.parse('2026-11-03T00:00:00Z');

const overviewBody = { sky: { over_ember: 'CLEAR' }, season: 'Spring', year: 45, world_hour: 10, population: { joined: 12 }, ember: { districts: [], treasury_bennies: 5 }, generated_at: '2026-11-02T12:00:00Z' };
const overviewBodyOld = { ...overviewBody, generated_at: '2026-10-20T00:00:00Z' };
const overviewBodyOldLast = { ...overviewBody, generated_at: '2026-10-20T06:00:00Z' };
const newsBody = { headlines: [], generated_at: '2026-11-02T12:00:00Z' };
const newsBodyOld = { headlines: [], generated_at: '2026-10-20T00:00:00Z' };
const newsBodyOldLast = { headlines: [], generated_at: '2026-10-20T06:00:00Z' };
const chatsBody = { messages: [], channels: [], generated_at: '2026-11-02T12:00:00Z' };
const chatsBodyOld = { messages: [], channels: [], generated_at: '2026-10-20T00:00:00Z' };
const chatsBodyOldLast = { messages: [], channels: [], generated_at: '2026-10-20T06:00:00Z' };
const statusBody = { ok: true };
function voicesBody(texts) {
  return {
    places: [{
      code: 'EMBER_PLAZA', where: 'plaza', group: 'g',
      said: texts.map((said, i) => ({ at: '2026-10-31T00:01:00Z', by: 'Test Person', id: `u-${i}`, said })),
    }],
    generated_at: '2026-10-31T00:02:00Z',
  };
}
function mapBody(name) {
  return {
    ember: { districts: [], civic_works: [] }, world_hour: 10,
    names: [[1, 2, name, 'A Namer']],
    structures: [[3, 4, 'WATCHTOWER', 'S', null]],
    generated_at: '2026-10-26T08:00:00Z',
  };
}

async function snap(archive, day, name, body) {
  await mkdir(join(archive, day), { recursive: true });
  await writeFile(join(archive, day, name), JSON.stringify(body));
}

// The standard synthetic archive, ages relative to NOW
// (2026-11-03T00:00:00Z; deep window = 7 days):
//   2026-10-20 (14 d) — last-of-day classes with two bodies each:
//     overview, news, chats (first body thins, last body survives);
//   2026-10-25 (9 d) — a voices + status pair past the window (thins);
//   2026-10-26 (8 d) — a map day with three bodies (last survives);
//   2026-10-27 (exactly 7 d) — a voices body ON the boundary (kept);
//   2026-10-31 (3 d) and 2026-11-01 (2 d) — inside the window (kept);
//   2026-11-02 — the fresh head day (kept).
async function makeArchive() {
  const dir = await mkdtemp(join(tmpdir(), 'portal-thin-'));
  const archive = join(dir, 'archive');
  const feed = join(dir, 'feed');
  await snap(archive, '2026-10-20', 'overview-20261020T000000Z.json', overviewBodyOld);
  await snap(archive, '2026-10-20', 'overview-20261020T060000Z.json', overviewBodyOldLast);
  await snap(archive, '2026-10-20', 'news-20261020T000000Z.json', newsBodyOld);
  await snap(archive, '2026-10-20', 'news-20261020T060000Z.json', newsBodyOldLast);
  await snap(archive, '2026-10-20', 'chats-20261020T000000Z.json', chatsBodyOld);
  await snap(archive, '2026-10-20', 'chats-20261020T060000Z.json', chatsBodyOldLast);
  await snap(archive, '2026-10-25', 'voices-20261025T000000Z.json', voicesBody(['hello world', 'a longer utterance here']));
  await snap(archive, '2026-10-25', 'status-20261025T000000Z.json', statusBody);
  await snap(archive, '2026-10-26', 'map-20261026T080000Z.json', mapBody('First Falls'));
  await snap(archive, '2026-10-26', 'map-20261026T120000Z.json', mapBody('Second Falls'));
  await snap(archive, '2026-10-26', 'map-20261026T180000Z.json', mapBody('Third Falls'));
  await snap(archive, '2026-10-27', 'voices-20261027T000000Z.json', voicesBody(['boundary']));
  await snap(archive, '2026-10-31', 'voices-20261031T000000Z.json', voicesBody(['three days old']));
  await snap(archive, '2026-10-31', 'status-20261031T000000Z.json', statusBody);
  await snap(archive, '2026-11-01', 'voices-20261101T000000Z.json', voicesBody(['two days old']));
  await snap(archive, '2026-11-02', 'overview-20261102T120000Z.json', overviewBody);
  await snap(archive, '2026-11-02', 'news-20261102T120000Z.json', newsBody);
  await snap(archive, '2026-11-02', 'chats-20261102T120000Z.json', chatsBody);
  await snap(archive, '2026-11-02', 'voices-20261102T120000Z.json', voicesBody(['fresh']));
  await snap(archive, '2026-11-02', 'map-20261102T120000Z.json', mapBody('Fresh Falls'));
  await snap(archive, '2026-11-02', 'status-20261102T120000Z.json', statusBody);
  return { dir, archive, feed };
}

const REMOVED = [
  '2026-10-20/overview-20261020T000000Z.json',
  '2026-10-20/news-20261020T000000Z.json',
  '2026-10-20/chats-20261020T000000Z.json',
  '2026-10-25/voices-20261025T000000Z.json',
  '2026-10-25/status-20261025T000000Z.json',
  '2026-10-26/map-20261026T080000Z.json',
  '2026-10-26/map-20261026T120000Z.json',
];
const KEPT = [
  '2026-10-20/overview-20261020T060000Z.json',
  '2026-10-20/news-20261020T060000Z.json',
  '2026-10-20/chats-20261020T060000Z.json',
  '2026-10-26/map-20261026T180000Z.json',
  '2026-10-27/voices-20261027T000000Z.json',
  '2026-10-31/voices-20261031T000000Z.json',
  '2026-10-31/status-20261031T000000Z.json',
  '2026-11-01/voices-20261101T000000Z.json',
  '2026-11-02/voices-20261102T120000Z.json',
  '2026-11-02/map-20261102T120000Z.json',
  '2026-11-02/status-20261102T120000Z.json',
];

test('plan: deep-window boundary per route class, nothing written in dry-run', async () => {
  const { archive, feed } = await makeArchive();
  const result = await thinArchive(archive, { feedDir: feed, now: NOW, dryRun: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.entries.map((e) => e.file).sort(), [...REMOVED].sort());
  const boundary = result.plan.kept.find((k) => k.file.includes('20261027'));
  assert.match(boundary.reason, /inside 7-day deep window/);
  const inside48h = result.plan.kept.find((k) => k.file.includes('20261031T000000'));
  assert.match(inside48h.reason, /inside 7-day deep window/);
  const lastMap = result.plan.kept.find((k) => k.file.includes('20261026T180000'));
  assert.match(lastMap.reason, /last map body of its day/);
  const lastOverview = result.plan.kept.find((k) => k.file.includes('overview-20261020T060000'));
  assert.match(lastOverview.reason, /last overview body of its day/);
  // No health.json in the fixture: no M1 floor resolves.
  assert.equal(result.protectFromUtc, null);
  // Dry run writes nothing at all.
  assert.equal(existsSync(join(archive, 'thinning-log.jsonl')), false);
  assert.equal(existsSync(join(archive, 'derived')), false);
  assert.equal(existsSync(join(archive, 'thinning-manifests')), false);
  assert.equal(existsSync(join(archive, 'quotes-registry.json')), false);
  for (const f of [...REMOVED, ...KEPT]) assert.equal(existsSync(join(archive, f)), true, f);
});

test('run: thins to kept-resolution, writes manifest + log + derived, bundle reproduces', async () => {
  const { archive, feed } = await makeArchive();
  await buildChains(archive);
  const { worldData: liveWorldData } = await buildBundle({ archiveDir: archive, feedDir: feed });
  const preHashes = {};
  for (const f of REMOVED) preHashes[f] = sha256Hex(await readFile(join(archive, f)));

  const result = await thinArchive(archive, { feedDir: feed, now: NOW });
  assert.equal(result.ok, true, result.reason ?? '');
  assert.equal(result.removed, 7);
  for (const f of REMOVED) assert.equal(existsSync(join(archive, f)), false, f);
  for (const f of KEPT) assert.equal(existsSync(join(archive, f)), true, f);

  // Speech index: one row per utterance of the removed voices body.
  const speech = (await readFile(join(archive, 'derived', 'speech-index.jsonl'), 'utf8'))
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(speech.length, 2);
  assert.equal(speech[0].placeCode, 'EMBER_PLAZA');
  assert.equal(speech[0].authorName, 'Test Person');
  assert.equal(speech[0].charCount, 'hello world'.length);
  assert.match(speech[0].snapshotId, /^snap_voices_20261025T000000Z_[0-9a-f]{12}$/);

  // Map dated facts: naming + structure per removed map body.
  const facts = (await readFile(join(archive, 'derived', 'map-facts.jsonl'), 'utf8'))
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(facts.length, 4);
  assert.deepEqual(facts.filter((r) => r.kind === 'naming').map((r) => r.name).sort(), ['First Falls', 'Second Falls']);
  assert.equal(facts[0].capturedAt, '2026-10-26T08:00:00Z');

  // Manifest: every removed file with its pre-thinning hash, the
  // ruling named as the rule, and the protection floor recorded.
  const manifestBytes = await readFile(join(archive, result.manifest));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.entries.length, 7);
  for (const e of manifest.entries) assert.equal(e.sha256, preHashes[e.file], e.file);
  assert.equal(result.manifestHash, sha256Hex(manifestBytes));
  assert.match(manifest.rule, /Owner ruling 2026-11-03/);

  // Thinning log: one entry per (day, route), kept files named.
  const log = (await readFile(join(archive, 'thinning-log.jsonl'), 'utf8'))
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(log.length, 6);
  const mapLog = log.find((e) => e.route === 'map');
  assert.equal(mapLog.removed, 2);
  assert.deepEqual(mapLog.keptFiles, ['2026-10-26/map-20261026T180000Z.json']);
  assert.equal(mapLog.manifestHash, result.manifestHash);
  assert.equal(typeof mapLog.chainHead, 'string');

  // Quotes registry created empty (REC-13).
  const reg = await loadQuotesRegistry(archive);
  assert.equal(reg.exists, true);
  assert.equal(reg.ids.size, 0);

  // Bundle rebuilt from the THINNED archive reproduces the live bundle.
  const tmpFeed = join(archive, '..', 'feed-after');
  const { worldData: after } = await buildBundle({ archiveDir: archive, feedDir: tmpFeed });
  const m = bundlesMatch(after, liveWorldData);
  assert.deepEqual(m, { citizens: true, world: true, full: true });
});

test('verify: thinned archive passes verifyWithThinning end to end, every class covered', async () => {
  const { archive, feed } = await makeArchive();
  await buildChains(archive);
  await buildBundle({ archiveDir: archive, feedDir: feed });
  const result = await thinArchive(archive, { feedDir: feed, now: NOW });
  assert.equal(result.ok, true, result.reason ?? '');

  const results = await verifyWithThinning(archive);
  for (const r of results) assert.equal(r.ok, true, `${r.route}: ${r.errors.join('; ')}`);
  // The synthetic old segment thinned across every class.
  assert.equal(results.find((r) => r.route === 'voices').thinned, 1);
  assert.equal(results.find((r) => r.route === 'status').thinned, 1);
  assert.equal(results.find((r) => r.route === 'map').thinned, 2);
  assert.equal(results.find((r) => r.route === 'overview').thinned, 1);
  assert.equal(results.find((r) => r.route === 'news').thinned, 1);
  assert.equal(results.find((r) => r.route === 'chats').thinned, 1);

  // chain.mjs verifyChain is the strict pre-thinning verifier: a thinned
  // file is a "missing" error there. verifyWithThinning is the
  // post-thinning verifier. This pins the documented split.
  const strict = await verifyChain(join(archive, 'chain-voices.jsonl'), archive);
  assert.equal(strict.ok, false);
  assert.ok(strict.errors.some((e) => e.includes('snapshot file missing')));

  // An UNRECORDED deletion still fails the thinning-aware verify.
  await rm(join(archive, '2026-11-02', 'voices-20261102T120000Z.json'));
  const after = await verifyWithThinning(archive);
  const voices = after.find((r) => r.route === 'voices');
  assert.equal(voices.ok, false);
  assert.ok(voices.errors.some((e) => e.includes('NOT covered by any thinning record')));
});

test('guard: protection floor keeps post-floor snapshots whatever their age', async () => {
  const { archive } = await makeArchive();
  // Floor at 2026-10-24: the 10-25 voices/status pair and the 10-26 map
  // day are all past the deep window by age, yet all were captured
  // inside the protected span and must be kept; the 10-20 files
  // (captured before the floor) still thin.
  const plan = await planThinning(archive, { now: NOW, protectFromUtc: '2026-10-24T00:00:00Z' });
  assert.deepEqual(
    plan.entries.map((e) => e.file).sort(),
    [
      '2026-10-20/chats-20261020T000000Z.json',
      '2026-10-20/news-20261020T000000Z.json',
      '2026-10-20/overview-20261020T000000Z.json',
    ].sort(),
  );
  const guarded = plan.kept.find((k) => k.file.includes('20261025T000000'));
  assert.match(guarded.reason, /unjudged M1 window/);
});

test('guard: thinArchive resolves the floor from health.json; a later explicit floor cannot shrink it', async () => {
  const { archive, feed } = await makeArchive();
  await writeFile(join(archive, 'health.json'), JSON.stringify({
    generatedAtUtc: '2026-11-03T00:00:00Z',
    a0: { lastGap: { route: 'status', startUtc: '2026-10-23T23:00:00Z', endUtc: '2026-10-24T00:00:00Z', ongoing: false } },
  }));
  assert.equal(await judgementWindowStartUtc(archive), Date.parse('2026-10-24T00:00:00Z'));

  const fromHealth = await thinArchive(archive, { feedDir: feed, now: NOW, dryRun: true });
  assert.equal(fromHealth.protectFromUtc, '2026-10-24T00:00:00.000Z');
  assert.equal(fromHealth.plan.entries.length, 3);

  // Explicit floor LATER than the health floor: protection must NOT
  // shrink — the health floor wins, the unjudged window stays whole.
  const shrunk = await thinArchive(archive, { feedDir: feed, now: NOW, dryRun: true, protectFromUtc: '2026-10-26T00:00:00Z' });
  assert.equal(shrunk.protectFromUtc, '2026-10-24T00:00:00.000Z');
  assert.equal(shrunk.plan.entries.length, 3);

  // Explicit floor EARLIER than the health floor: protection extends
  // to the older material (here: everything thinnable predates the
  // health floor but postdates 2026-10-19, so nothing remains eligible).
  const extended = await thinArchive(archive, { feedDir: feed, now: NOW, dryRun: true, protectFromUtc: '2026-10-19T00:00:00Z' });
  assert.equal(extended.protectFromUtc, '2026-10-19T00:00:00.000Z');
  assert.equal(extended.plan.entries.length, 0);
  assert.equal(extended.plan.kept.some((k) => /unjudged M1 window/.test(k.reason) && k.file.includes('map-20261026')), true);
});

test('sealed book: snapshots of a closed world book never thin', async () => {
  const { archive } = await makeArchive();
  await writeFile(join(archive, 'world-books.json'), JSON.stringify({
    schema: 'portal.world-books/v1',
    books: [{
      id: 'world-000', status: 'closed',
      opened_at: '2026-10-19T00:00:00Z', closed_at: '2026-10-28T00:00:00Z',
      opened_with_file: null, closed_with_file: null, close_reason: 'test reset',
    }],
  }));
  const plan = await planThinning(archive, { now: NOW });
  // Every past-window candidate sits inside the closed book's span.
  assert.equal(plan.entries.length, 0);
  const sealed = plan.kept.find((k) => k.file.includes('20261025T000000'));
  assert.match(sealed.reason, /sealed world book world-000/);
});

test('abort control A: planted chain gap blocks thinning, nothing removed', async () => {
  const { archive, feed } = await makeArchive();
  await buildChains(archive);
  await buildBundle({ archiveDir: archive, feedDir: feed });
  // Eligible (past the deep window, not newest) but deliberately never chained.
  await snap(archive, '2026-10-24', 'voices-20261024T000000Z.json', voicesBody(['unchained']));

  const result = await thinArchive(archive, { feedDir: feed, now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.reason, /AUTO-B11\(a\)/);
  assert.match(result.reason, /no chain record covers/);
  for (const f of [...REMOVED, ...KEPT, '2026-10-24/voices-20261024T000000Z.json']) {
    assert.equal(existsSync(join(archive, f)), true, f);
  }
  assert.equal(existsSync(join(archive, 'thinning-log.jsonl')), false);
  assert.equal(existsSync(join(archive, 'thinning-manifests')), false);
});

test('abort control B: bundle-reproduction failure blocks thinning, nothing removed', async () => {
  const { archive, feed } = await makeArchive();
  await buildChains(archive);
  const { worldData } = await buildBundle({ archiveDir: archive, feedDir: feed });
  // Corrupt the live bundle so the archive no longer reproduces it.
  const corrupted = { ...worldData, world: { ...worldData.world, sky: 'NOT THE ARCHIVED SKY' } };
  await writeFile(join(feed, 'world-data.json'), JSON.stringify(corrupted));

  const result = await thinArchive(archive, { feedDir: feed, now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.reason, /AUTO-B11\(b\)/);
  for (const f of [...REMOVED, ...KEPT]) assert.equal(existsSync(join(archive, f)), true, f);
  assert.equal(existsSync(join(archive, 'thinning-log.jsonl')), false);
});

test('quotes registry exempts a named voices snapshot from thinning', async () => {
  const { archive } = await makeArchive();
  const rel = '2026-10-25/voices-20261025T000000Z.json';
  const sha = sha256Hex(await readFile(join(archive, rel)));
  const id = await snapshotIdFor(archive, rel, sha);
  await writeFile(join(archive, 'quotes-registry.json'),
    JSON.stringify({ version: 1, quotes: [{ snapshotId: id, chronicleItem: 'test' }] }) + '\n');
  const plan = await planThinning(archive, { now: NOW });
  assert.equal(plan.entries.some((e) => e.file === rel), false);
  const keptEntry = plan.kept.find((k) => k.file === rel);
  assert.match(keptEntry.reason, /quotes registry/);
  // The other classes still thin.
  assert.equal(plan.entries.length, 6);
});
