/* M4.16 — scene system: chunks, LOD bands, the standee swap rule,
   and the actor budget. The budget test is the item's own exit-gate
   shape: a 31-figure bundle renders 30 + rail overflow, not 31.
   Run per file: node --test test/scene-system.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  chunkOfNode, chunkLayout, lodForDistance, representationFor,
  standeeSpriteUrl, assignActors, MAX_ACTORS,
  CHUNK_CIVIC_CORE, CHUNK_FRONTIER,
} from '../scene-system.mjs';

const LAYOUT = JSON.parse(readFileSync(new URL('../../../shared/ember-layout.json', import.meta.url), 'utf8'));

test('every layout node lands in exactly one town chunk; the frontier is never a town chunk', () => {
  const chunks = chunkLayout(LAYOUT);
  const all = [...chunks.values()].flat();
  assert.equal(all.length, LAYOUT.nodes.length);
  assert.ok(!chunks.has(CHUNK_FRONTIER), 'frontier must stay a separate map scene (D5)');
  for (const node of LAYOUT.nodes) assert.notEqual(chunkOfNode(node), CHUNK_FRONTIER);
});

test('the civic core is the plaza and its civic buildings', () => {
  for (const code of ['EMBER_PLAZA_OF_UNITY', 'EMBER_TOWNHALL', 'EMBER_COLLEGE', 'MARKET_HALL']) {
    assert.equal(chunkOfNode(LAYOUT.nodes.find((n) => n.code === code)), CHUNK_CIVIC_CORE, code);
  }
  assert.equal(chunkOfNode(LAYOUT.nodes.find((n) => n.code === 'EMBER_DISTRICT_3_PLOT_18')), 'district-3');
  assert.equal(chunkOfNode(LAYOUT.nodes.find((n) => n.code === 'EMBER_DISTRICT_1_PLOT_31')), 'district-1');
  assert.equal(chunkOfNode(LAYOUT.nodes.find((n) => n.code === 'LIBRARY_ANNEX')), 'south');
});

test('LOD bands: follow range is LOD0, neighbourhood LOD1, town altitude standee', () => {
  assert.equal(lodForDistance(0), 'lod0');
  assert.equal(lodForDistance(26), 'lod0'); // the follow camera's distance
  assert.equal(lodForDistance(60), 'lod1');
  assert.equal(lodForDistance(220), 'standee'); // the overview camera's distance
  assert.throws(() => lodForDistance(-1), TypeError);
});

test('the swap rule: no representation change mid-route (a standee never slides)', () => {
  // At a place, the band's choice applies.
  assert.equal(representationFor({ current: 'lod1', distance: 220, between: null }), 'standee');
  assert.equal(representationFor({ current: 'standee', distance: 20, between: null }), 'lod0');
  // Between places, the current representation holds whatever the band says.
  assert.equal(representationFor({ current: 'lod1', distance: 220, between: ['A', 'B'] }), 'lod1');
  assert.equal(representationFor({ current: 'lod0', distance: 220, between: ['A', 'B'] }), 'lod0');
});

test('standee sprite URL derives from the kit entry manifest', () => {
  const entry = { kit: 'atlas-meridian', standeeManifest: '../factory/outputs-web/standees/atlas-meridian.standee.json' };
  assert.equal(standeeSpriteUrl(entry), '../factory/outputs-web/standees/sprites/atlas-meridian--idle.webp');
  assert.equal(standeeSpriteUrl({ kit: 'x' }), null);
  assert.equal(standeeSpriteUrl(null), null);
});

test('actor budget: 31 figures render 30 + 1 rail overflow — none dropped, none faked', () => {
  const keys = Array.from({ length: 31 }, (_, i) => `portal-key:c${String(i).padStart(2, '0')}`);
  const { actors, rail } = assignActors(keys);
  assert.equal(MAX_ACTORS, 30);
  assert.equal(actors.length, 30);
  assert.deepEqual(rail, ['portal-key:c30']);
  assert.deepEqual([...actors, ...rail], keys, 'actors + rail is the whole cast, in order');
});

test('actor budget: under budget, the rail is empty; duplicates are refused', () => {
  const { actors, rail } = assignActors(['a', 'b']);
  assert.deepEqual(actors, ['a', 'b']);
  assert.deepEqual(rail, []);
  assert.throws(() => assignActors(['a', 'a']), /never embodied twice/);
});
