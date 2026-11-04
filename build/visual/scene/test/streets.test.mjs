/* T2 — roads with character (kerbs + wear), look touch-up wave.
   Pins, per the lane task:
     (a) kerb strips exist per segment with the right count and
         placement rule, and inherit the street strips' y-stagger;
     (b) the wear texture's colours ALL derive from the cobble
         palette tokens (a census — no invented hex anywhere);
     (c) the wear tracks follow segment orientation (the texture
         varies only across the strip; each segment carries it in
         its own rotated frame, bends included);
     (d) a planted control: a synthetic new path segment added to a
         fixture layout gains kerbs + wear with no code change —
         the path-driven property the spatial spec will rely on.
   Run per file: node --test test/streets.test.mjs

   Headless scope: pure geometry + texture data + the scene's
   consumption wiring, read from source. Rendered pixels belong to
   the batch-1 Hark evidence round. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

globalThis.self = globalThis; // three r186 expects the browser global
register('./three-vendor-hook.mjs', import.meta.url);

const THREE = await import('../vendor/three.module.js');
const {
  STREET_WIDTH_UNITS, KERB_WIDTH_UNITS, KERB_CENTRE_OFFSET_UNITS, KERB_Y_LIFT,
  STREET_Y_BASE, STREET_Y_STAGGER, streetYForEdge, streetSegmentPieces, streetPiecesForPath,
} = await import('../streets.mjs');
const {
  shade, gradientBandRatios, rgbToHex, hexToRgb,
  streetWearPalette, streetWearZoneAt, streetWearColorAt, streetWearTextureData, streetMaterial,
  STREET_WEAR_ROWS, STREET_WEAR_PROFILE,
} = await import('../materials.mjs');
const { ANCHORS } = await import('../palette.mjs');

const layout = JSON.parse(readFileSync(new URL('../../../shared/ember-layout.json', import.meta.url), 'utf8'));
const authoredPaths = layout.edges
  .filter((e) => e.street?.path)
  .map((e) => e.street.path.map(([x, z]) => ({ x, z })));

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ------------------------------------------------------------ (a) kerbs
test('(a) real layout: exactly two kerbs per street segment, streets counted from the paths alone', () => {
  assert.equal(authoredPaths.length, 14, 'layout v3 carries 14 authored street paths');
  let segments = 0, streets = 0, kerbs = 0;
  authoredPaths.forEach((path, idx) => {
    const pieces = streetPiecesForPath(path, idx);
    segments += pieces.segments.length;
    streets += pieces.streets.length;
    kerbs += pieces.kerbs.length;
    assert.equal(pieces.streets.length, pieces.segments.length, `edge ${idx}: one street per segment`);
    assert.equal(pieces.kerbs.length, pieces.segments.length * 2, `edge ${idx}: two kerbs per segment`);
  });
  // The paths' own segment count, counted independently from the JSON.
  const expected = authoredPaths.reduce((n, p) => n + p.length - 1, 0);
  assert.equal(segments, expected);
  assert.equal(streets, expected);
  assert.equal(kerbs, expected * 2);
  assert.equal(expected, 59, 'the layout as filed: 59 segments, hence 59 streets and 118 kerbs');
});

test('(a) kerb placement rule: flush outer edge, symmetric offsets, same joint overlap and rotation as the street', () => {
  const pa = { x: 0, z: 0 }, pb = { x: 6, z: 8 }; // a 10-unit diagonal run
  const seg = streetSegmentPieces(pa, pb, streetYForEdge(0));
  assert.ok(seg);
  assert.equal(seg.street.width, STREET_WIDTH_UNITS);
  assert.ok(approx(seg.length, 10));
  // Joint discipline inherited: the kerb plane length is the street's
  // plane length, which is the run length + the strips' half-width overlap.
  for (const k of seg.kerbs) {
    assert.equal(k.planeLength, seg.street.planeLength);
    assert.ok(approx(k.planeLength, 10 + STREET_WIDTH_UNITS * 0.5));
    assert.equal(k.width, KERB_WIDTH_UNITS);
    assert.equal(k.rotationZ, seg.street.rotationZ, 'kerb runs parallel to its street');
    // Offset is purely across the path: the kerb centre's displacement
    // from the street centre is along perp, at the kerb centre offset.
    const dx = k.centre.x - seg.street.centre.x, dz = k.centre.z - seg.street.centre.z;
    assert.ok(approx(Math.hypot(dx, dz), KERB_CENTRE_OFFSET_UNITS));
    assert.ok(approx(dx * seg.dir.x + dz * seg.dir.z, 0), 'no along-path component in the kerb offset');
    assert.ok(approx(Math.sign(dx * seg.perp.x + dz * seg.perp.z), k.side));
  }
  assert.deepEqual(seg.kerbs.map((k) => k.side).sort(), [-1, 1], 'one kerb each side');
  // Flush outer edge: offset + half the kerb width = half the street width.
  assert.ok(approx(KERB_CENTRE_OFFSET_UNITS + KERB_WIDTH_UNITS / 2, STREET_WIDTH_UNITS / 2),
    'the kerb outer face is the street outer edge — no spill past the street');
  // Degenerate runs are skipped by the strips' own rule.
  assert.equal(streetSegmentPieces(pa, { x: 0.001, z: 0 }, 0), null);
});

test('(a) kerbs inherit the per-edge y-stagger, lifted clear of every stagger step', () => {
  // The stagger itself, as the scene has always laid the strips.
  for (let i = 0; i < 10; i++) {
    assert.ok(approx(streetYForEdge(i), STREET_Y_BASE + (i % 5) * STREET_Y_STAGGER), `edge ${i} stagger`);
  }
  const pieces = streetPiecesForPath([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }], 3);
  assert.ok(approx(pieces.y, streetYForEdge(3)));
  for (const s of pieces.streets) assert.ok(approx(s.y, streetYForEdge(3)), 'street at the edge stagger height');
  for (const k of pieces.kerbs) {
    assert.ok(approx(k.y - pieces.y, KERB_Y_LIFT), 'kerb rides at street height + the kerb lift');
    assert.ok(k.y > streetYForEdge(4), 'kerb clears even the highest staggered neighbouring street');
  }
  assert.ok(KERB_Y_LIFT > 4 * STREET_Y_STAGGER, 'the lift exceeds the whole stagger range by construction');
});

// ------------------------------------------------------------ (b) wear census
test('(b) wear texture census: every colour in the texture is a cobble palette derivation, and all three appear', () => {
  const palette = streetWearPalette();
  // The derivation set, built from first principles here — not by
  // calling the module's own palette back at itself:
  const bands = gradientBandRatios();
  const derived = new Map([
    [ANCHORS.paving_shaded.toUpperCase(), 'the paving_shaded anchor itself (street base)'],
    [shade(ANCHORS.paving_shaded, bands[1]).toUpperCase(), 'paving_shaded shaded by the rig low band ratio (wheel track)'],
    [ANCHORS.cobble_lit.toUpperCase(), 'the cobble_lit anchor itself (lighter centre)'],
  ]);
  assert.equal(palette.base.toUpperCase(), ANCHORS.paving_shaded.toUpperCase());
  assert.equal(palette.track, shade(ANCHORS.paving_shaded, bands[1]));
  assert.equal(palette.centre.toUpperCase(), ANCHORS.cobble_lit.toUpperCase());

  const { width, height, data } = streetWearTextureData();
  assert.equal(height, STREET_WEAR_ROWS);
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4) {
    assert.equal(data[i + 3], 255, 'wear texture is opaque');
    seen.add(rgbToHex([data[i], data[i + 1], data[i + 2]]).toUpperCase());
  }
  for (const hex of seen) {
    assert.ok(derived.has(hex), `texture colour ${hex} is not a palette derivation (${[...derived.keys()].join(', ')})`);
  }
  assert.deepEqual([...seen].sort(), [...derived.keys()].sort(),
    'the texture uses exactly the three derived colours — base, track, centre, nothing else');
  // The track really is darker and the centre really is lighter than the base.
  const lum = (hex) => { const [r, g, b] = hexToRgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  assert.ok(lum(palette.track) < lum(palette.base), 'wheel tracks are darker than the base cobble');
  assert.ok(lum(palette.centre) > lum(palette.base), 'the centre is lighter than the base cobble');
});

test('(b) no invented hex: materials.mjs and streets.mjs hold no colour literals; scene street colours come from the palette/materials', () => {
  for (const rel of ['../materials.mjs', '../streets.mjs']) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.ok(!/#[0-9A-Fa-f]{6}\b/.test(src), `${rel} must contain no #RRGGBB literal`);
    assert.ok(!/0x[0-9A-Fa-f]{6}\b/.test(src.replace(/0xffffff/g, '')), `${rel} must contain no colour literal besides the white material base`);
  }
  const scene = readFileSync(new URL('../scene.mjs', import.meta.url), 'utf8');
  assert.ok(!scene.includes('streetWearPalette') && !/#DCC7B4|#E2CFC1/.test(scene),
    'scene.mjs names no wear hex — the texture is materials.mjs’s, from the anchors');
});

// ------------------------------------------------------------ (c) orientation
test('(c) the wear profile lives across the strip only: constant along U, zoned across V', () => {
  const { width, data } = streetWearTextureData();
  assert.equal(width, 1, 'one texel along the street — the texture cannot vary along the path');
  const rowHex = (y) => rgbToHex([data[y * 4], data[y * 4 + 1], data[y * 4 + 2]]);
  const at = (t) => rowHex(Math.round(t * (STREET_WEAR_ROWS - 1)));
  const palette = streetWearPalette();
  assert.equal(at(0.02), palette.base, 'edge is base cobble');
  assert.equal(at(STREET_WEAR_PROFILE.trackCentres[0]), palette.track, 'first wheel track');
  assert.equal(at(0.5), palette.centre, 'lighter centre');
  assert.equal(at(STREET_WEAR_PROFILE.trackCentres[1]), palette.track, 'second wheel track');
  assert.equal(at(0.98), palette.base, 'far edge is base cobble');
  // Zones are symmetric, so a segment whose V axis points the other
  // way shows the same profile (tracks and centre unmoved).
  for (const t of [0.05, 0.2, 0.27, 0.4, 0.5]) {
    assert.equal(streetWearColorAt(t), streetWearColorAt(1 - t), `profile symmetric at t=${t}`);
    assert.equal(streetWearZoneAt(t), streetWearZoneAt(1 - t));
  }
});

test('(c) tracks follow segment orientation: each segment carries the texture in its own rotated frame, bends included', () => {
  // A bent path: east, then south. Two segments, two orientations.
  const pieces = streetPiecesForPath([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }], 0);
  assert.equal(pieces.segments.length, 2);
  const [east, south] = pieces.segments;
  assert.ok(approx(east.street.rotationZ, -Math.atan2(0, 10)), 'east run: rotation from its own direction');
  assert.ok(approx(south.street.rotationZ, -Math.atan2(10, 0)), 'south run: rotation turns with the bend');
  for (const seg of pieces.segments) {
    // The strip's local axes after rotation: length along dir, width
    // along perp (dir ⊥ perp). The texture's V axis is the width
    // axis, so the cross profile is measured along perp — i.e. the
    // tracks sit at fixed ACROSS offsets from the centreline of
    // THIS segment, whatever its heading.
    assert.ok(approx(seg.dir.x * seg.perp.x + seg.dir.z * seg.perp.z, 0), 'dir ⊥ perp');
    assert.equal(seg.street.materialRole, 'street-wear', 'street piece carries the wear role');
    assert.equal(seg.street.dir, seg.dir); assert.equal(seg.street.perp, seg.perp);
    // Track centres land inside the street, symmetric about the centreline:
    for (const tc of STREET_WEAR_PROFILE.trackCentres) {
      const across = (tc - 0.5) * STREET_WIDTH_UNITS;
      assert.ok(Math.abs(across) < STREET_WIDTH_UNITS / 2, 'track centre inside the street width');
      assert.ok(Math.abs(across) > 0, 'track is off the centreline');
    }
    const trackOffsets = STREET_WEAR_PROFILE.trackCentres.map((tc) => (tc - 0.5) * STREET_WIDTH_UNITS);
    assert.ok(approx(trackOffsets[0], -trackOffsets[1]), 'the two tracks are mirror images about the centreline');
  }
  // A diagonal segment's tracks rotate with it — its perp is diagonal too.
  const diag = streetSegmentPieces({ x: 0, z: 0 }, { x: 10, z: 10 }, 0);
  assert.ok(approx(diag.perp.x, -Math.SQRT1_2) && approx(diag.perp.z, Math.SQRT1_2), 'diagonal run: perp is the diagonal across-axis');
  assert.ok(approx(diag.street.rotationZ, -Math.PI / 4));
});

test('(c) the scene assigns the wear material to street pieces and the trim anchor to kerbs, inside the path loop', () => {
  const gm = new THREE.DataTexture(new Uint8Array([138, 138, 138, 255]), 1, 1);
  const mat = streetMaterial(THREE, gm);
  assert.ok(mat.map, 'street material carries a texture map');
  assert.equal(mat.map.image.width, 1); assert.equal(mat.map.image.height, STREET_WEAR_ROWS);
  assert.equal(mat.gradientMap, gm, 'the wear material is banded by the shared rig gradient map');
  // The top-level wiring, read from the scene source (the scene
  // itself needs a DOM; its loop shape is the contract here):
  const scene = readFileSync(new URL('../scene.mjs', import.meta.url), 'utf8');
  assert.ok(scene.includes('streetPiecesForPath(raw, edgeIdx++)'), 'scene lays pieces from the path data via streets.mjs');
  assert.ok(scene.includes('streetMaterial(THREE, gradientMap)'), 'scene builds the wear material once from materials.mjs');
  assert.ok(scene.includes('toonMat(PAL.trimPale)'), 'kerbs take the trim-pale anchor (a trim/paving tone)');
  const loopSlice = scene.split('streetPiecesForPath(raw, edgeIdx++)')[1].split('Buildings (or the plaza marker)')[0];
  assert.ok(!/centre.?line|dash|crossing/i.test(loopSlice),
    'no centre-line paint and no Plaza crossing bands in the street loop (descoped for this wave)');
});

// ------------------------------------------------------------ (d) planted control
test('(d) planted control: a synthetic new segment in a fixture layout gains kerbs + wear with no code change', () => {
  // A fixture layout in the real layout's shape, with ONE invented
  // edge whose path bends diagonally — a path no code has ever seen.
  const fixture = JSON.parse(JSON.stringify(layout));
  const before = fixture.edges.length;
  fixture.edges.push({
    a: 'EMBER_PLAZA_OF_UNITY', b: 'FIXTURE_NEW_PLACE',
    street: { widthUnits: STREET_WIDTH_UNITS, path: [[0, 0], [12, 4], [12, 16]] },
  });
  assert.equal(fixture.edges.length, before + 1);

  // The exact derivation the scene runs per edge, nothing else.
  const idx = fixture.edges.length - 1;
  const e = fixture.edges[idx];
  const raw = e.street.path.map(([x, z]) => ({ x, z }));
  const pieces = streetPiecesForPath(raw, idx);

  assert.equal(pieces.segments.length, 2, 'both planted segments are laid');
  assert.equal(pieces.streets.length, 2);
  assert.equal(pieces.kerbs.length, 4, 'each planted segment gains its two kerbs automatically');
  for (const s of pieces.streets) {
    assert.equal(s.materialRole, 'street-wear', 'each planted street gains the wear role (scene assigns the wear texture to the role)');
  }
  for (const k of pieces.kerbs) {
    assert.equal(k.materialRole, 'kerb-trim');
    assert.ok(approx(k.y, streetYForEdge(idx) + KERB_Y_LIFT), 'planted kerbs inherit the stagger + lift');
  }
  // And the planted path did not disturb the real edges' counts.
  const realTotal = authoredPaths.reduce((n, p) => n + streetPiecesForPath(p, 0).kerbs.length, 0);
  assert.equal(realTotal, 118);
});
