/* M5.12 — staging disclosure where the mistake forms.
   Run per file: node --test test/disclosures.test.mjs

   The exit gate is the disclosure present in all three surfaces:
   - About: the app page carries the staging paragraph (pinned
     verbatim against index.html);
   - onboarding: the small print exists as the one wording source
     the M6.12 overlay will consume (the overlay itself is M6.12's
     surface — the words are this item's);
   - every interior: the standing line rides all seven render
     models, word-identical;
   plus the inspector half: a journey claim's notes carry its
   route/timing basis. The data-level shot set rendering all of
   it lives at ../shots/interiors.html. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const { INTERIOR_CODES, STANDING_LINE, interiorRenderModel } = await import('../interiors.mjs');
const { ONBOARDING_SMALL_PRINT } = await import('../../../app/disclosures.mjs');
const { inspectorModel } = await import('../../../app/logic.mjs');

const REGISTRY = JSON.parse(readFileSync(new URL('../interior-kits.json', import.meta.url), 'utf8'));
const BUNDLE = JSON.parse(readFileSync(new URL('../../../data/feed/world-data.json', import.meta.url), 'utf8'));
const INDEX_HTML = readFileSync(new URL('../../../app/index.html', import.meta.url), 'utf8');

test('About surface: the staging paragraph is on the app page', () => {
  assert.ok(INDEX_HTML.includes(
    'Ember\'s streets and room layouts are Portal\'s stage, drawn so you can follow what happens.'),
  'the About staging disclosure, verbatim');
});

test('onboarding small print: one wording source, staging + record both named', () => {
  assert.match(ONBOARDING_SMALL_PRINT, /Portal is a stage built over the public record/);
  assert.match(ONBOARDING_SMALL_PRINT, /nothing is invented/);
  assert.ok(ONBOARDING_SMALL_PRINT.length < 400, 'small print stays small');
});

test('every interior carries the standing line, word-identical', () => {
  for (const code of INTERIOR_CODES) {
    const model = interiorRenderModel(REGISTRY, BUNDLE, code);
    assert.equal(model.standingLine, STANDING_LINE, code);
  }
  assert.match(STANDING_LINE, /nobody added, nobody left out/);
});

test('inspector journey notes carry the route/timing basis', () => {
  const model = inspectorModel({
    type: 'page-journey',
    bundle: BUNDLE,
    citizen: { name: 'Atlas Meridian' },
    journey: {
      name: 'Atlas Meridian', from: 'the College', to: 'the Plaza of Unity',
      departureUtc: '2026-11-01T19:39:49Z', arrivalUtc: '2026-11-01T23:12:30Z',
      evidence: { departureUtteranceId: 'u1', arrivalUtteranceId: 'u2' },
    },
    feed: { generatedFrom: { voicesSnapshotCount: 1, firstVoicesSnapshotFile: 'a', lastVoicesSnapshotFile: 'b' } },
  });
  assert.match(model.claimText, /last evidenced at the origin/, 'the claim states both timing bounds');
  assert.match(model.claimText, /first evidenced at the destination/);
  assert.ok(model.stagingNotes.some((n) => /Portal scheduling the evidence window/.test(n)),
    'the note names the walk between the bounds as Portal\'s scheduling — the route basis, not a witnessed path');
});

test('the data-level shot set exists and names all three surfaces', () => {
  const url = new URL('../shots/interiors.html', import.meta.url);
  assert.ok(existsSync(url), 'shots/interiors.html present');
  const html = readFileSync(url, 'utf8');
  for (const marker of ['About', 'Onboarding small print', 'Standing line']) {
    assert.ok(html.includes(marker), `shot set names the ${marker} surface`);
  }
});
