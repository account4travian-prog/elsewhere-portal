/* M4.18 — camera + chips.
   Run per file: node --test test/camera.test.mjs

   Proven here:
   - every named-view chip lands on its named framing: target,
     frustum height, and the derived camera position are asserted
     against layout v3 geometry read independently from the layout
     file (footprint/parcel/paving rects + door anchors);
   - WORLD_BOUNDS is the layout's authored extents plus the margin,
     and an evidenced staged-fill plot expands the bounds rather
     than sitting outside them;
   - aggressive hand-pan and zoom inputs stay inside the bounds
     and the zoom limits, from any starting view;
   - Reset view recovers the exact Overview framing from the worst
     bounded position;
   - the F-1 split stands as built: Overview orthographic 35°,
     Follow perspective fov 28° (spec only — no ratification);
   - camera operations never mutate the layout (view-only: a
     camera move cannot touch a figure position, because it cannot
     touch the data figures are placed from);
   - chip labels are the token wording table's values, and the
     scene + staging publish set consume this module. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  CAMERA_CHIP_IDS, CAMERA_ELEVATION_DEG, CAMERA_HEIGHT_LIMITS, CAMERA_SURFACE,
  FOLLOW_CAMERA, PLACE_TOP_UNITS, RESET_VIEW_LABEL, WORLD_BOUNDS, WORLD_BOUNDS_MARGIN,
  applyCameraChip, cameraChipsForLayout, cameraPositionFor, clampCameraView,
  panCameraView, resetCameraView, sampleStreetFraming, viewForChip, viewWithinBounds,
  worldBoundsForLayout, zoomCameraView,
} = await import('../camera.mjs');
const { CAMERA_WORDINGS } = await import('../palette.mjs');
const { effectiveLayout } = await import('../../../app/logic.mjs');

const layout = JSON.parse(readFileSync(new URL('../../../shared/ember-layout.json', import.meta.url), 'utf8'));
const tokensDoc = JSON.parse(readFileSync(new URL('../../tokens/tokens.json', import.meta.url), 'utf8'));
const chips = cameraChipsForLayout(layout);
const byId = new Map(chips.map((c) => [c.id, c]));

const SIN = Math.sin((35 * Math.PI) / 180);
const COS = Math.cos((35 * Math.PI) / 180);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('chip set: the six named views, in bar order, labels from the wording table', () => {
  assert.deepEqual(chips.map((c) => c.id), [...CAMERA_CHIP_IDS]);
  const wordingTokens = new Map(
    tokensDoc.groups.wording.tokens.map((t) => [t.name.replace('wording.camera.', ''), t.value]),
  );
  const keyByChip = {
    overview: 'overview', plaza: 'plaza', 'college-corner': 'collegeCorner',
    'town-hall-corner': 'townHallCorner', 'ledger-block': 'ledgerBlock', 'sample-street': 'sampleStreet',
  };
  for (const c of chips) {
    assert.equal(c.label, wordingTokens.get(keyByChip[c.id]), `${c.id}: label is the token wording`);
    assert.equal(c.label, CAMERA_WORDINGS[keyByChip[c.id]], `${c.id}: label reaches the scene through the generated palette`);
    assert.equal(c.projection, 'orthographic');
    assert.equal(c.mode, 'overview');
  }
  assert.equal(RESET_VIEW_LABEL, wordingTokens.get('resetView'));
  assert.equal(RESET_VIEW_LABEL, 'Reset view');
});

test('every chip lands on its named framing (target, height, camera position)', () => {
  // Expected targets derived here from the layout file's own
  // geometry — independently of camera.mjs's arithmetic.
  const node = (code) => layout.nodes.find((n) => n.code === code);
  const rectC = (code, key = 'footprintRect') => {
    const r = node(code).geometry[key];
    return { x: r.cx, z: r.cz };
  };
  const expected = {
    overview: { target: { x: 0, y: 0, z: 3 }, height: 68 },
    plaza: { target: { ...rectC('EMBER_PLAZA_OF_UNITY', 'pavingRect'), y: 0 }, height: 28 },
    'college-corner': {
      target: {
        x: (rectC('EMBER_COLLEGE').x + node('EMBER_COLLEGE').geometry.door.anchor.x) / 2,
        y: 0,
        z: (rectC('EMBER_COLLEGE').z + node('EMBER_COLLEGE').geometry.door.anchor.z) / 2,
      },
      height: 28,
    },
    'town-hall-corner': {
      target: {
        x: (rectC('EMBER_TOWNHALL').x + rectC('EMBER_TOWNHALL', 'towerRect').x + node('EMBER_TOWNHALL').geometry.door.anchor.x) / 3,
        y: 0,
        z: (rectC('EMBER_TOWNHALL').z + rectC('EMBER_TOWNHALL', 'towerRect').z + node('EMBER_TOWNHALL').geometry.door.anchor.z) / 3,
      },
      height: 28,
    },
    'ledger-block': {
      target: {
        x: (rectC('EMBER_DISTRICT_1_PLOT_31').x + rectC('EMBER_DISTRICT_1_PLOT_31', 'parcelRect').x) / 2,
        y: 0,
        z: (rectC('EMBER_DISTRICT_1_PLOT_31').z + rectC('EMBER_DISTRICT_1_PLOT_31', 'parcelRect').z) / 2,
      },
      height: 30,
    },
    // G-J1 round 2: the street framing is derived, not hand-set —
    // the smallest centred frame holding its subjects (and, at the
    // fixed point, every place it touches) whole. Pinned to the
    // derivation's output on layout v3; the containment property
    // itself is asserted in full below.
    'sample-street': { target: { x: 1, y: 0, z: -10.21125824820612 }, height: 50 },
  };
  for (const [id, exp] of Object.entries(expected)) {
    const c = byId.get(id);
    assert.ok(c, `${id} chip exists`);
    assert.ok(near(c.target.x, exp.target.x), `${id} target.x ${c.target.x} != ${exp.target.x}`);
    assert.equal(c.target.y, 0, `${id} target stays on the ground plane`);
    assert.ok(near(c.target.z, exp.target.z), `${id} target.z ${c.target.z} != ${exp.target.z}`);
    assert.equal(c.height, exp.height, `${id} frustum height`);
    // The camera sits on the fixed axis: south of and above the
    // target, elevation 35°, at the canonical distance.
    assert.ok(near(c.position.x, exp.target.x), `${id} camera x`);
    assert.ok(near(c.position.y, SIN * 220, 1e-6), `${id} camera y`);
    assert.ok(near(c.position.z, exp.target.z + COS * 220, 1e-6), `${id} camera z`);
    assert.deepEqual(cameraPositionFor(c.target), { ...c.position });
  }
  // The sample street's framing holds its content whole (G-J1
  // round 2, replacing the round-1 bounding-box reach checks that
  // passed while the frame clipped Market Hall and cut its bottom
  // row): every place's full projected extent — rect corners at
  // ground and at the building's top, tag headroom included — is
  // either fully inside the street frame or wholly outside it, and
  // the three street subjects are fully inside.
  const s = byId.get('sample-street');
  const framing = sampleStreetFraming(layout);
  assert.deepEqual(
    { x: s.target.x, z: s.target.z, h: s.height },
    { x: framing.target.x, z: framing.target.z, h: framing.height },
    'the chip is the derived framing, not a second copy of it',
  );
  const halfW = (s.height * 1.6) / 2;
  const halfU = s.height / 2;
  const midU = -s.target.z * SIN;
  const extentOf = (node) => {
    const g = node.geometry || {};
    const rect = g.footprintRect || g.pavingRect || g.parcelRect;
    if (!rect) return null;
    const top = PLACE_TOP_UNITS[node.code] ?? (g.signAnchor ? g.signAnchor.y + 1 : 7.8);
    const xs = [];
    const us = [];
    const push = (x, y, z) => { xs.push(x); us.push(y * COS - z * SIN); };
    for (const x of [rect.cx - rect.w / 2 - 0.35, rect.cx + rect.w / 2 + 0.35]) {
      for (const z of [rect.cz - rect.d / 2 - 0.35, rect.cz + rect.d / 2 + 0.35]) {
        push(x, 0, z); push(x, top, z);
      }
    }
    push(rect.cx, top + 1.6, rect.cz);
    if (g.door?.anchor) push(g.door.anchor.x, 0, g.door.anchor.z);
    if (g.signAnchor) push(g.signAnchor.x, g.signAnchor.y + 1.2, g.signAnchor.z);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minU: Math.min(...us), maxU: Math.max(...us) };
  };
  for (const node of layout.nodes) {
    const e = extentOf(node);
    if (!e) continue;
    const contained = e.minX >= s.target.x - halfW && e.maxX <= s.target.x + halfW
      && e.minU >= midU - halfU && e.maxU <= midU + halfU;
    const intersects = e.minX < s.target.x + halfW && e.maxX > s.target.x - halfW
      && e.minU < midU + halfU && e.maxU > midU - halfU;
    assert.ok(contained || !intersects, `${node.code} is partially in the sample-street frame`);
    if (['EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE', 'EMBER_TOWNHALL'].includes(node.code)) {
      assert.ok(contained, `${node.code} (a street subject) is not fully in the sample-street frame`);
    }
  }
});

test('PLACE_TOP_UNITS mirrors scene.mjs BUILDING_FORM (h + roofH + spire allowance)', () => {
  const sceneSrc = readFileSync(new URL('../scene.mjs', import.meta.url), 'utf8');
  for (const [code, top] of Object.entries(PLACE_TOP_UNITS)) {
    if (code === 'EMBER_PLAZA_OF_UNITY') continue; // the centrepiece top, scene.mjs's plaza branch (3.2)
    const m = sceneSrc.match(new RegExp(`${code}: \\{[^}]*h: ([\\d.]+), roofH: ([\\d.]+)(, spire: true)?`));
    assert.ok(m, `BUILDING_FORM entry for ${code} not found in scene.mjs`);
    const expected = Number(m[1]) + Number(m[2]) + (m[3] ? 3.4 : 0);
    assert.ok(Math.abs(top - expected) < 1e-9, `${code}: PLACE_TOP_UNITS ${top} != BUILDING_FORM total ${expected}`);
  }
});

test('WORLD_BOUNDS: authored extents plus margin; staged fill expands, never escapes', () => {
  const b = worldBoundsForLayout(layout);
  assert.deepEqual(
    { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ },
    { minX: -40, maxX: 40, minZ: -38, maxZ: 38 },
  );
  assert.deepEqual(
    { minX: WORLD_BOUNDS.minX, maxX: WORLD_BOUNDS.maxX, minZ: WORLD_BOUNDS.minZ, maxZ: WORLD_BOUNDS.maxZ },
    { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ },
    'the exported WORLD_BOUNDS is the shipped layout\u2019s bounds',
  );
  assert.equal(WORLD_BOUNDS_MARGIN, 6);
  // An evidenced staged-fill plot (effectiveLayout's sorted fill,
  // row y=8) extends the town south: its parcel must be INSIDE the
  // bounds the scene computes from the effective layout.
  const eff = effectiveLayout(layout, { ember: { plots: [{ code: 'EMBER_DISTRICT_1_PLOT_30' }] } });
  const eb = worldBoundsForLayout(eff);
  assert.equal(eb.maxZ, 50, 'fill parcel (centre z=40, depth 8) plus margin');
  assert.ok(eb.minZ === b.minZ && eb.minX === b.minX && eb.maxX === b.maxX, 'only the south edge moved');
});

test('bounds: aggressive pan inputs clamp to the bounds, from any chip', () => {
  const bounds = worldBoundsForLayout(layout);
  const vp = { heightPx: 800 };
  for (const c of chips) {
    for (const [dx, dy] of [[1e6, 1e6], [-1e6, -1e6], [1e6, -1e6], [-1e6, 1e6], [0, 0]]) {
      const v = viewForChip(c);
      panCameraView(v, dx, dy, vp, bounds);
      assert.ok(viewWithinBounds(v, bounds), `${c.id} pan (${dx},${dy}) escaped: ${JSON.stringify(v.target)}`);
    }
  }
  const v = resetCameraView(chips);
  panCameraView(v, 1e6, 1e6, vp, bounds);
  assert.equal(v.target.x, bounds.minX);
  assert.equal(v.target.z, bounds.minZ);
  panCameraView(v, -2e6, -2e6, vp, bounds);
  assert.equal(v.target.x, bounds.maxX);
  assert.equal(v.target.z, bounds.maxZ);
  assert.equal(v.chipId, null, 'a hand-panned view is no longer a chip view');
});

test('bounds: aggressive zoom clamps to the zoom limits; clamp repairs a wild view', () => {
  const bounds = worldBoundsForLayout(layout);
  const v = resetCameraView(chips);
  zoomCameraView(v, 1e9, bounds);
  assert.equal(v.height, CAMERA_HEIGHT_LIMITS.max);
  zoomCameraView(v, -2e9, bounds);
  assert.equal(v.height, CAMERA_HEIGHT_LIMITS.min);
  const wild = { mode: 'overview', chipId: null, label: null, target: { x: 9999, y: 55, z: -9999 }, height: 5000 };
  clampCameraView(wild, bounds);
  assert.deepEqual(wild.target, { x: bounds.maxX, y: 0, z: bounds.minZ });
  assert.equal(wild.height, CAMERA_HEIGHT_LIMITS.max);
  assert.ok(viewWithinBounds(wild, bounds));
});

test('Reset view recovers the exact Overview framing from the worst bounded position', () => {
  const bounds = worldBoundsForLayout(layout);
  const v = viewForChip(byId.get('sample-street'));
  panCameraView(v, -1e6, -1e6, { heightPx: 800 }, bounds); // worst corner
  zoomCameraView(v, -1e9, bounds); // tightest zoom
  assert.equal(v.target.x, bounds.maxX);
  assert.equal(v.target.z, bounds.maxZ);
  const reset = resetCameraView(chips);
  applyCameraChip(v, byId.get('overview')); // Reset view applies the overview chip
  assert.deepEqual(v, reset);
  assert.deepEqual(v.target, { x: 0, y: 0, z: 3 });
  assert.equal(v.height, CAMERA_HEIGHT_LIMITS.max);
  assert.equal(v.chipId, 'overview');
});

test('F-1 as built: ortho 35° town camera; follow stays perspective 28° — neither expanded nor removed', () => {
  assert.equal(CAMERA_ELEVATION_DEG, 35);
  assert.equal(FOLLOW_CAMERA.projection, 'perspective');
  assert.equal(FOLLOW_CAMERA.fovDeg, 28);
  assert.equal(FOLLOW_CAMERA.elevationDeg, 35);
  assert.equal(FOLLOW_CAMERA.frameHeight, 13);
  assert.ok(near(FOLLOW_CAMERA.distanceForFrame, 13 / 2 / Math.tan((28 * Math.PI) / 360), 1e-9));
  assert.equal(CAMERA_SURFACE.follow.projection, 'perspective');
  assert.equal(CAMERA_SURFACE.overview.projection, 'orthographic');
  assert.equal(CAMERA_SURFACE.overview.freeOrbit, false);
  assert.deepEqual([...CAMERA_SURFACE.overview.chips], [...CAMERA_CHIP_IDS]);
  // The stable behaviours the interiors lane consumes are named.
  for (const need of ['lookahead', 'pan pause', 'door beat', 'map hand-off']) {
    assert.ok(CAMERA_SURFACE.follow.stableBehaviours.some((s) => s.includes(need)), `surface names ${need}`);
  }
});

test('view-only: camera operations never mutate the layout they read', () => {
  const before = JSON.stringify(layout);
  const bounds = worldBoundsForLayout(layout);
  const v = resetCameraView(chips);
  panCameraView(v, 500, -300, { heightPx: 800 }, bounds);
  zoomCameraView(v, 240, bounds);
  applyCameraChip(v, byId.get('ledger-block'));
  cameraPositionFor(v.target);
  assert.equal(JSON.stringify(layout), before, 'layout bytes unchanged — no figure position can have moved');
  assert.notEqual(v.target, byId.get('ledger-block').target, 'the view holds its own target object, not layout geometry');
});

test('scene + staging consume this module (closure census)', () => {
  const sceneSrc = readFileSync(new URL('../scene.mjs', import.meta.url), 'utf8');
  assert.match(sceneSrc, /from '\.\/camera\.mjs'/, 'scene.mjs imports the camera module');
  assert.match(sceneSrc, /cameraChipsForLayout/, 'scene builds its chips from the module');
  assert.match(sceneSrc, /panCameraView/, 'scene wires bounded hand-pan');
  assert.match(sceneSrc, /zoomCameraView/, 'scene wires bounded zoom');
  assert.match(sceneSrc, /resetCameraView|applyCameraChip/, 'scene wires Reset view');
  assert.match(sceneSrc, /data-camera-chip/, 'scene renders chip buttons');
  assert.match(sceneSrc, /FOLLOW_CAMERA|frameFollow/, 'follow framing remains in the scene');
  const publishSrc = readFileSync(new URL('../../../../staging/publish.mjs', import.meta.url), 'utf8');
  assert.match(publishSrc, /'camera\.mjs'/, 'camera.mjs is in the staging publish set');
});
