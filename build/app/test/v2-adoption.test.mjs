// V2 adoption tests (M2.11 follow-on): the app consumes the frozen
// WorldData v2 (build/CONTRACT-V2.md) alongside v1 — dual-schema
// acceptance, citizenIdStatus in plain words, episodes from the
// bundle with the sidecar feed as fallback/words source, and the
// integritySource pin (M2.07: a provenance note, never a value).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isBundle,
  isBundleV2,
  selectBundle,
  citizenBindingWording,
  workTier,
  isConversationsSource,
  conversationsSource,
  resolveTalkEpisode,
  episodeKeyOf,
  episodeListModel,
  actListModel,
  talkPlaybackModel,
} from '../logic.mjs';

const labelFor = (code) => code;

const v1Sample = JSON.parse(
  readFileSync(new URL('../fixtures/sample-world-data.json', import.meta.url), 'utf8'),
);

// ------------------------------------------------------- dual schema

test('isBundle: v1 and the frozen v2 are bundles; v3 and strangers are not', () => {
  assert.equal(isBundle({ schema: 'portal.world-data/v1' }), true);
  assert.equal(isBundle({ schema: 'portal.world-data/v2' }), true);
  assert.equal(isBundle({ schema: 'portal.world-data/v3' }), false);
  assert.equal(isBundle({ schema: 'other' }), false);
  assert.equal(isBundle({}), false);
  assert.equal(isBundle(null), false);
  assert.equal(isBundleV2({ schema: 'portal.world-data/v2' }), true);
  assert.equal(isBundleV2({ schema: 'portal.world-data/v1' }), false);
  // The shipped v1 sample still counts (fallback behaviour unchanged).
  assert.equal(isBundle(v1Sample), true);
});

test('selectBundle: a v2 primary wins exactly like a v1 primary', () => {
  const v2 = { schema: 'portal.world-data/v2' };
  const picked = selectBundle([
    { ok: true, source: 'live', data: v2 },
    { ok: true, source: 'sample', data: v1Sample },
  ]);
  assert.equal(picked.data, v2);
  assert.equal(picked.isFallback, false);
  // An unknown-schema primary is passed over for the v1 sample.
  const skipped = selectBundle([
    { ok: true, source: 'live', data: { schema: 'portal.world-data/v3' } },
    { ok: true, source: 'sample', data: v1Sample },
  ]);
  // selectBundle trusts the caller's ok flag; app.js sets ok via
  // isBundle, so the v3 attempt arrives ok:false there. Here we pin
  // the composition the page actually uses:
  const attempts = [
    { data: { schema: 'portal.world-data/v3' } },
    { data: v1Sample },
  ].map((a, i) => ({ ok: isBundle(a.data), source: `s${i}`, data: a.data }));
  assert.equal(selectBundle(attempts).data, v1Sample);
  assert.equal(skipped.data.schema, 'portal.world-data/v3'); // raw selectBundle alone does not validate
});

// ------------------------------------------------- citizenIdStatus

test('citizenBindingWording: the three statuses in plain words, never the raw enum', () => {
  const unbound = citizenBindingWording({ citizenId: null, citizenIdStatus: 'UNBOUND_NO_ROUTE' });
  assert.deepEqual(unbound, {
    kind: 'unbound',
    citizenId: null,
    text: 'Not yet linked to a public profile — no public route names them yet.',
  });
  const conflict = citizenBindingWording({ citizenId: null, citizenIdStatus: 'CONFLICT' });
  assert.deepEqual(conflict, {
    kind: 'conflict',
    citizenId: null,
    text: 'More than one citizen shares this record name; not linked.',
  });
  const bound = citizenBindingWording({ citizenId: 'agent-123', citizenIdStatus: 'BOUND' });
  assert.deepEqual(bound, { kind: 'bound', citizenId: 'agent-123', text: 'agent-123' });
  for (const w of [unbound, conflict, bound]) {
    assert.ok(!/UNBOUND_NO_ROUTE|CONFLICT|BOUND/.test(w.text) || w.kind === 'bound' && w.text === 'agent-123',
      'the raw enum never reaches the user');
  }
});

test('citizenBindingWording: v1 citizens and broken claims show nothing', () => {
  // v1 bundle citizens carry no citizenIdStatus — the UI doesn't appear.
  for (const c of v1Sample.citizens) assert.equal(citizenBindingWording(c), null);
  assert.equal(citizenBindingWording({ name: 'X' }), null);
  assert.equal(citizenBindingWording({ citizenIdStatus: 'SOMETHING_ELSE' }), null);
  // A BOUND claim with no id behind it is shown as nothing, not a bare claim.
  assert.equal(citizenBindingWording({ citizenId: null, citizenIdStatus: 'BOUND' }), null);
  assert.equal(citizenBindingWording({ citizenId: '', citizenIdStatus: 'BOUND' }), null);
  assert.equal(citizenBindingWording(null), null);
});

// ------------------------------------------- integritySource pin

test('workTier: world.integritySource is never read as integrity data', () => {
  const works = [
    { code: 'MARKET_HALL', integrity: null },
    { code: 'PUBLIC_WORKSHOP', integrity: 64 },
  ];
  const mk = (integritySource) => ({
    schema: 'portal.world-data/v2',
    world: integritySource === undefined ? {} : { integritySource },
    ember: { works },
  });
  // Absent, the honest string, and even NUMBERS in either direction:
  // the null work stays 'none' and the evidenced work keeps its band.
  for (const src of [undefined, 'none-in-tier-p', 0, 100]) {
    const b = mk(src);
    assert.equal(workTier(b, 'MARKET_HALL').key, 'none', `integritySource=${src}`);
    assert.equal(workTier(b, 'MARKET_HALL').label, 'Repair not in the public feeds Portal reads');
    assert.equal(workTier(b, 'PUBLIC_WORKSHOP').key, 'plain', `integritySource=${src}`);
    assert.equal(workTier(b, 'NOPE').key, 'none');
  }
  // v1 shape (no world key at all) behaves identically.
  assert.equal(workTier({ ember: { works } }, 'MARKET_HALL').key, 'none');
  assert.equal(workTier(null, 'MARKET_HALL').key, 'none');
});

// ------------------------------------------ conversations source

const feedEp = {
  place: 'EMBER_COLLEGE', where: null, participants: ['A One', 'B Two'],
  firstUtc: '2026-11-02T19:01:00Z', lastUtc: '2026-11-02T19:32:00Z',
  utteranceCount: 2, corroborated: true, corroboratedBy: { headlineId: 'h1', at: '2026-11-02T19:00:00Z' },
  disclosure: 'Presence is evidenced at the moments each of them spoke; the public feeds Portal reads do not show who else was present, who stayed silent, or when each of them left.',
  utterances: [
    { at: '2026-11-02T19:01:00Z', by: 'A One', said: 'Hello.' },
    { at: '2026-11-02T19:02:00Z', by: 'B Two', said: 'Hello back.' },
  ],
};
const bundleEp = { ...feedEp };
delete bundleEp.utterances; // the frozen §1.4 bundle shape: no words field
const acts = [{
  actor: 'A One', kind: 'RUIN_EXCAVATED', presentation: 'acts-only', count: 2,
  firstUtc: '2026-11-02T10:00:00Z', lastUtc: '2026-11-02T11:00:00Z',
  acts: [{ at: '2026-11-02T10:00:00Z', phrase: 'A One dug into an old ruin at the frontier.', cell: null }],
  disclosure: 'Recorded acts only. The public feeds Portal reads show acts, not ongoing work.',
}];
const sidecar = { schema: 'portal.episodes/v1', episodes: [feedEp], actSequences: acts };
const v2Bundle = { schema: 'portal.world-data/v2', episodes: [bundleEp], actSequences: acts, citizens: [], ember: { works: [] } };

test('conversationsSource: the v2 bundle wins; the feed is the fallback', () => {
  assert.equal(conversationsSource(v2Bundle, sidecar), v2Bundle);
  assert.equal(conversationsSource(v1Sample, sidecar), sidecar); // v1 bundle: no sections
  assert.equal(conversationsSource({ schema: 'portal.world-data/v2' }, sidecar), sidecar); // v2 without the lists
  assert.equal(conversationsSource(v1Sample, null), null);
  assert.equal(conversationsSource(null, null), null);
  assert.equal(isConversationsSource(v2Bundle), true);
  assert.equal(isConversationsSource({ episodes: [] }), false);
});

test('resolveTalkEpisode: bundle summaries borrow their words from the feed twin', () => {
  const key = episodeKeyOf(bundleEp);
  // From the bundle source: wordless on its own, resolved via the twin.
  const resolved = resolveTalkEpisode(v2Bundle, sidecar, key);
  assert.equal(resolved, feedEp);
  const model = talkPlaybackModel(resolved);
  assert.equal(model.disclosure, bundleEp.disclosure); // same filed string heads playback
  assert.equal(model.total, 2);
  // From the feed source: its own episode, no twin needed.
  assert.equal(resolveTalkEpisode(sidecar, sidecar, key), feedEp);
  assert.equal(resolveTalkEpisode(sidecar, null, key), feedEp);
  // No words anywhere: null — playback does not start, nothing is invented.
  assert.equal(resolveTalkEpisode(v2Bundle, null, key), null);
  assert.equal(resolveTalkEpisode(v2Bundle, { schema: 'portal.episodes/v1', episodes: [], actSequences: [] }, key), null);
  assert.equal(resolveTalkEpisode(null, null, key), null);
});

// --------------------------- real head: the bundle path end to end

test('real v2 bundle from the archive head: panel models carry every disclosure verbatim (Hark M2 condition (c), bundle path)', () => {
  const dataDir = new URL('../../data/', import.meta.url).pathname;
  const tmp = mkdtempSync(join(tmpdir(), 'portal-v2-adopt-'));
  try {
    execFileSync(process.execPath,
      [join(dataDir, 'build-bundle-v2.mjs'), '--archive', join(dataDir, 'archive'), '--feed', tmp],
      { stdio: 'pipe' });
    const bundle = JSON.parse(readFileSync(join(tmp, 'world-data.json'), 'utf8'));
    assert.equal(isBundle(bundle), true);
    assert.equal(bundle.schema, 'portal.world-data/v2');
    // Every citizen carries a status, and every status words plainly.
    assert.ok(bundle.citizens.length >= 1);
    for (const c of bundle.citizens) {
      assert.ok(['UNBOUND_NO_ROUTE', 'BOUND', 'CONFLICT'].includes(c.citizenIdStatus), `status for ${c.citizenKey}`);
      assert.notEqual(citizenBindingWording(c), null, `plain wording for ${c.citizenKey}`);
    }
    // Hark M2 condition (c) from the BUNDLE path: every episode's
    // disclosure reaches the panel model verbatim, and the acts
    // disclosures likewise.
    const list = episodeListModel(bundle, labelFor);
    assert.ok(list, 'the bundle itself is a conversations source');
    assert.equal(list.episodes.length, bundle.episodes.length);
    assert.ok(list.episodes.length >= 1, 'the real head carries episodes');
    for (let i = 0; i < list.episodes.length; i++) {
      assert.equal(typeof bundle.episodes[i].disclosure, 'string');
      assert.ok(bundle.episodes[i].disclosure.length > 0);
      assert.equal(list.episodes[i].disclosure, bundle.episodes[i].disclosure);
      assert.ok(!('utterances' in bundle.episodes[i]), 'bundle episodes are summaries (§1.4)');
    }
    const actModel = actListModel(bundle);
    assert.equal(actModel.sequences.length, bundle.actSequences.length);
    for (let i = 0; i < actModel.sequences.length; i++) {
      assert.equal(actModel.sequences[i].disclosure, bundle.actSequences[i].disclosure);
    }
    // The bundle wins over a feed, and its episodes borrow words from
    // a same-head feed built by the episodes cycle.
    const sidecarFile = join(tmp, 'episodes.json');
    execFileSync(process.execPath,
      [join(dataDir, 'episodes-cycle.mjs'), '--archive', join(dataDir, 'archive'), '--out', sidecarFile],
      { stdio: 'pipe' });
    const feed = JSON.parse(readFileSync(sidecarFile, 'utf8'));
    assert.equal(conversationsSource(bundle, feed), bundle);
    let twins = 0;
    for (const ep of bundle.episodes) {
      const twin = feed.episodes.find((f) => episodeKeyOf(f) === episodeKeyOf(ep));
      if (!twin) continue;
      twins += 1;
      const resolved = resolveTalkEpisode(bundle, feed, episodeKeyOf(ep));
      assert.equal(resolved, twin);
      assert.equal(talkPlaybackModel(resolved).disclosure, ep.disclosure);
    }
    assert.ok(twins >= 1, 'at least one bundle episode has a same-head feed twin');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
