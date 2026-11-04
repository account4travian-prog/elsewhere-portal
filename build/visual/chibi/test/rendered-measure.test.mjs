/* M4.06 closure — the rendered-frame measure record: at least one
   cast kit measures 2–2.5 heads tall in a rendered frame (the plate
   camera), the plate head share agrees with the accessor gate's own
   number for the same master, and the canonical street-view count
   is recorded too (lower by projection — on the record, not hidden).
   The renders are evidence files; this test pins the record so a
   future kit change that drifts the proportion fails here until the
   frames are re-rendered. Run per file:
   node --test test/rendered-measure.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const rec = JSON.parse(readFileSync(new URL('../rendered-measure.json', import.meta.url), 'utf8'));

test('record carries its method and the gate it answers', () => {
  assert.match(rec.method, /REST pose/);
  assert.match(rec.method, /alpha channel/);
  assert.match(rec.gate, /2-2\.5 heads/);
});

test('the sample-street figure (atlas-meridian, F1) measures in band in a rendered frame', () => {
  const f = rec.figures['atlas-meridian'];
  assert.ok(f, 'atlas-meridian measured');
  const plate = f.cameras.plate;
  assert.ok(plate.headsTall >= 2 && plate.headsTall <= 2.5, `exit gate 2-2.5: got ${plate.headsTall}`);
  assert.ok(plate.headsTall >= 2.33 && plate.headsTall <= 2.50, `Bible-derived band: got ${plate.headsTall}`);
  // The rendered plate share agrees with the accessor gate on the
  // same master (measure-figure: 0.412) — two instruments, one figure.
  assert.ok(Math.abs(plate.headShare - 0.412) <= 0.005, `rendered share ${plate.headShare} vs accessor 0.412`);
});

test('a second cast kit is measured too, and the canonical view is on record', () => {
  const o = rec.figures['orrin-lowmarsh'];
  assert.ok(o);
  assert.ok(o.cameras.plate.headsTall >= 2.33 && o.cameras.plate.headsTall <= 2.50, `orrin plate ${o.cameras.plate.headsTall}`);
  for (const slug of Object.keys(rec.figures)) {
    const c = rec.figures[slug].cameras.canonical;
    assert.ok(c.headsTall > 1 && c.headsTall < rec.figures[slug].cameras.plate.headsTall,
      `${slug}: canonical count recorded and below the plate count (projection)`);
    for (const cam of ['canonical', 'plate']) {
      for (const pass of ['full', 'head']) {
        const p = new URL(`../renders/${slug}--${cam}-${pass}.png`, import.meta.url);
        assert.ok(existsSync(p), `evidence render exists: ${slug} ${cam} ${pass}`);
      }
    }
  }
});

test('the parameter file stays a committed parameter file (not baked)', () => {
  const params = JSON.parse(readFileSync(new URL('../chibi-params.json', import.meta.url), 'utf8'));
  assert.equal(params.procedureFactors.factors.headMeshAboutNeckPivot, 1.3, 'procedure factors live in the file');
  assert.equal(params.procedureFactors.factors.thighShin, 0.78);
});
