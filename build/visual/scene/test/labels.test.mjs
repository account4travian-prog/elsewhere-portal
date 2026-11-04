/* M4.12 — the label-placement system (Design L2).
   Run per file: node --test test/labels.test.mjs

   What is proven here:
   - The module's projectors agree with the scene's real vendored
     THREE cameras (ortho overview + perspective follow) to under a
     pixel, so the sweep below governs the rendered frame, not a
     model of it.
   - The acceptance sweep: the whole town's building labels plus the
     sample bundle's citizen chips, at 3 zooms × desktop/mobile
     viewports — zero clipped labels (a placed box never crosses the
     frame), zero overlapping label pairs, no label struck through
     another building's screen box, and every building whose sign
     anchor is in frame gets a placed label (signs never collapse
     while a rung fits).
   - Wave 1's three named collisions (visual-plan/03-refinement.md
     §L3) as permanent regression cases: "Town H…" clipped, the
     Meridian Hall label struck through by the College box, "Public
     Workshop" split by the citizen chip. The Wave 1 screenshot is
     the 2D app's isometric stage; each case below encodes the
     failure as the geometric class it names, with the naive
     placement (centred tags, no ladder, no frame rule — what Wave 1
     shipped) as the positive control that must reproduce the
     failure class, and the ladder as what must not.
   - The size floor: a label wider than the frame collapses to
     sign-only rather than clipping; chips yield to signs; the
     per-frame budget collapses chips, never signs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

globalThis.self = globalThis; // three r186 expects the browser global
register('./three-vendor-hook.mjs', import.meta.url);

const THREE = await import('../vendor/three.module.js');
const { projectOrtho, projectPersp, resolveLabels, labelBox, chipBox, shortName, textWidthPx, LABEL_FONT_PX, CHIP_FONT_PX, CHIP_PAD_X_PX, rectIntersectsViewport, stationLabelPlacement, MAX_DETACH_GAP_PX } =
  await import('../labels.mjs');
const { cameraChipsForLayout } = await import('../camera.mjs');
const { gridToWorld, fillNodeGeometry } = await import('../streets.mjs');
const { citizenPositions, citizenKeyOf, effectiveLayout } = await import('../../../app/logic.mjs');

const layout = JSON.parse(readFileSync(new URL('../../../shared/ember-layout.json', import.meta.url), 'utf8'));
const sampleBundle = JSON.parse(readFileSync(new URL('../../../app/fixtures/sample-world-data.json', import.meta.url), 'utf8'));
const HUB = 'EMBER_PLAZA_OF_UNITY';
const byCode = new Map(layout.nodes.map((n) => [n.code, n]));

// Building heights: scene.mjs BUILDING_STYLE (h + roofH), mirrored
// here and cross-checked against the scene source so a height change
// there fails this file instead of drifting silently.
const sceneSrc = readFileSync(new URL('../scene.mjs', import.meta.url), 'utf8');
const HEIGHTS = {};
for (const code of ['EMBER_TOWNHALL', 'EMBER_COLLEGE', 'MARKET_HALL', 'LIBRARY_ANNEX', 'PUBLIC_WORKSHOP',
  'EMBER_DISTRICT_3_PLOT_18', 'EMBER_DISTRICT_1_PLOT_31', 'EMBER_HOME_MAPLE_COTTAGE', 'EMBER_HOME_WILLOW_COTTAGE']) {
  const m = sceneSrc.match(new RegExp(`${code}: \\{[^}]*h: ([\\d.]+), roofH: ([\\d.]+)`));
  assert.ok(m, `BUILDING_STYLE entry for ${code} not found in scene.mjs`);
  HEIGHTS[code] = Number(m[1]) + Number(m[2]);
}
const PLAZA_TAG_Y = 3.2; // the centrepiece top in scene.mjs (pedestal 1.1 + orb centre 2.15 + r 0.95 ≈ 3.1)

// A world box projected to its screen AABB — the same construction
// scene.mjs's updateLabels performs for frameRect / figure rects.
function screenAabb(project, cx, cz, w, d, topY, y0 = 0) {
  const pts = [];
  for (const px of [cx - w / 2, cx + w / 2]) {
    for (const pz of [cz - d / 2, cz + d / 2]) {
      for (const py of [y0, topY]) pts.push(project({ x: px, y: py, z: pz }));
    }
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
function aabbWithPoints(rect, points) {
  const out = { ...rect };
  for (const p of points) {
    const x0 = Math.min(out.x, p.x), y0 = Math.min(out.y, p.y);
    out.w = Math.max(out.x + out.w, p.x) - x0;
    out.h = Math.max(out.y + out.h, p.y) - y0;
    out.x = x0; out.y = y0;
  }
  return out;
}

// ------------------------------------------------------------ town model
function buildingItemsAndObstacles(project, bundle) {
  const eff = effectiveLayout(layout, bundle);
  const items = [];
  const obstacles = [];
  const hubNode = byCode.get(HUB);
  for (const node of eff.nodes) {
    const g = node.geometry || fillNodeGeometry(node, layout, hubNode);
    if (!g) continue;
    let signWorld;
    let roofWorld;
    let frameRect = null;
    if (node.code === HUB) {
      signWorld = { x: g.centrepieceAnchor.x, y: PLAZA_TAG_Y, z: g.centrepieceAnchor.z };
      roofWorld = signWorld;
      const pv = g.pavingRect || { cx: g.centrepieceAnchor.x, cz: g.centrepieceAnchor.z, w: 10, d: 10 };
      frameRect = screenAabb(project, pv.cx, pv.cz, pv.w, pv.d, PLAZA_TAG_Y);
    } else if (g.signAnchor && g.footprintRect) {
      signWorld = { x: g.signAnchor.x, y: g.signAnchor.y, z: g.signAnchor.z };
      roofWorld = { x: g.footprintRect.cx, y: HEIGHTS[node.code] + 0.4, z: g.footprintRect.cz };
      // The building's screen box: AABB of its projected corners.
      const r = g.footprintRect;
      const h = HEIGHTS[node.code];
      const pts = [];
      for (const cx of [r.cx - r.w / 2, r.cx + r.w / 2]) {
        for (const cz of [r.cz - r.d / 2, r.cz + r.d / 2]) {
          for (const cy of [0, h]) pts.push(project({ x: cx, y: cy, z: cz }));
        }
      }
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      obstacles.push({ id: node.code, rect });
      frameRect = rect;
    } else if (g.signAnchor) {
      // Staged-fill plot: the plot sign at its gate; the tag anchor is
      // the parcel centre at ground level.
      signWorld = { x: g.signAnchor.x, y: g.signAnchor.y, z: g.signAnchor.z };
      roofWorld = { x: g.parcelRect.cx, y: 0, z: g.parcelRect.cz };
      frameRect = screenAabb(project, g.parcelRect.cx, g.parcelRect.cz, g.parcelRect.w, g.parcelRect.d, (g.signAnchor.y || 0) + 1);
    } else {
      continue;
    }
    const signP = project(signWorld);
    const roofP = project(roofWorld);
    if (frameRect) frameRect = aabbWithPoints(frameRect, [signP, roofP]);
    items.push({
      id: node.code,
      kind: 'building',
      text: node.label,
      signText: shortName(node.label),
      anchors: { sign: signP, roof: roofP },
      ownObstacle: node.code,
      frameRect,
    });
  }
  return { items, obstacles };
}

function chipItems(project, bundle) {
  const positions = citizenPositions(bundle, layout);
  const citizens = new Map((bundle.citizens || []).map((c) => [citizenKeyOf(c), c]));
  const items = [];
  for (const [key, p] of positions) {
    const c = citizens.get(key);
    if (!c) continue;
    const w = gridToWorld(p.x, p.y);
    items.push({
      id: `chip:${key}`,
      kind: 'chip',
      text: c.name,
      anchors: { head: project({ x: w.x, y: 2.0, z: w.z }) },
      figureId: `chip:${key}`,
    });
  }
  return items;
}

// Figure screen rects, the model scene.mjs's updateLabels builds:
// standing — a 1×1 ground box, 1.95 tall; reclined (the asleep
// treatment) — low (0.75) and long toward +z (0.2 behind the origin
// to 1.9 ahead of it). Keyed by the chip item's id. Since G-J1
// round 3 each entry also carries the figure's head anchor (the
// chip's head projection) for the resolver's ambiguity rule.
function figureRects(project, bundle) {
  const positions = citizenPositions(bundle, layout);
  const citizens = new Map((bundle.citizens || []).map((c) => [citizenKeyOf(c), c]));
  const figures = [];
  for (const [key, p] of positions) {
    const c = citizens.get(key);
    if (!c) continue;
    const w = gridToWorld(p.x, p.y);
    figures.push({
      id: `chip:${key}`,
      anchor: project({ x: w.x, y: 2.0, z: w.z }),
      rect: c.state === 'asleep'
        ? screenAabb(project, w.x, w.z + 0.85, 1.0, 2.1, 0.75)
        : screenAabb(project, w.x, w.z, 1.0, 1.0, 1.95),
    });
  }
  return figures;
}

// The sweep bundle: the app's sample bundle + the staged-fill plot,
// so the sweep covers all 11 places Portal can label.
const sweepBundle = {
  ...sampleBundle,
  ember: {
    ...sampleBundle.ember,
    plots: [...(sampleBundle.ember?.plots || []), { code: 'EMBER_DISTRICT_1_PLOT_30', district: 1, plot: 30, provenanceClass: 'feed-evidenced' }],
  },
};

const VIEWPORTS = [
  { name: 'desktop', width: 1280, heightPx: 800 },
  { name: 'mobile', width: 390, heightPx: 844 },
];
const ZOOMS = [68, 44, 28]; // ortho frustum heights: overview as-built, Bible overview, street zoom

function framing(vp, height) {
  const cam = { target: { x: 0, y: 0, z: 3 }, height, aspect: vp.width / vp.heightPx, width: vp.width, heightPx: vp.heightPx };
  return { cam, project: (p) => projectOrtho(p, cam), viewport: vp };
}

const boxOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inFrameBox = (box, vp) => box.x >= 0 && box.y >= 0 && box.x + box.w <= vp.width && box.y + box.h <= vp.heightPx;

// ------------------------------------------------------------- projectors
test('projectors agree with the scene\u2019s vendored THREE cameras', () => {
  const target = new THREE.Vector3(0, 0, 3);
  const ELEV = THREE.MathUtils.degToRad(35);
  const place = (cam, t, dist) => {
    cam.position.set(t.x, t.y + Math.sin(ELEV) * dist, t.z + Math.cos(ELEV) * dist);
    cam.lookAt(t.x, t.y, t.z);
    cam.updateMatrixWorld();
  };
  const ortho = new THREE.OrthographicCamera(-68 * 1.6 / 2, 68 * 1.6 / 2, 68 / 2, -68 / 2, 0.1, 3000);
  place(ortho, target, 220);
  ortho.updateProjectionMatrix();
  const perspTarget = new THREE.Vector3(20, 1.2, -20);
  const persp = new THREE.PerspectiveCamera(28, 1.6, 0.1, 3000);
  const dist = 6.5 / Math.tan(THREE.MathUtils.degToRad(14));
  place(persp, perspTarget, dist);
  persp.updateProjectionMatrix();

  const points = [
    ...layout.nodes.map((n) => n.geometry?.signAnchor).filter(Boolean).map((a) => ({ x: a.x, y: a.y, z: a.z })),
    { x: 0, y: 3.2, z: 0 },
    { x: -30, y: 0, z: 36 },
    { x: 19, y: 2.0, z: 20 },
  ];
  const v = new THREE.Vector3();
  for (const p of points) {
    v.set(p.x, p.y, p.z).project(ortho);
    const mine = projectOrtho(p, { target: { x: 0, y: 0, z: 3 }, height: 68, aspect: 1.6, width: 1280, heightPx: 800 });
    assert.ok(Math.abs(mine.x - (v.x * 0.5 + 0.5) * 1280) <= 0.6, `ortho x drift at ${JSON.stringify(p)}`);
    assert.ok(Math.abs(mine.y - (1 - (v.y * 0.5 + 0.5)) * 800) <= 0.6, `ortho y drift at ${JSON.stringify(p)}`);
    v.set(p.x, p.y, p.z).project(persp);
    if (v.z < 1) {
      const mineP = projectPersp(p, { target: { x: 20, y: 1.2, z: -20 }, fovDeg: 28, dist, aspect: 1.6, width: 1280, heightPx: 800 });
      assert.ok(Math.abs(mineP.x - (v.x * 0.5 + 0.5) * 1280) <= 0.6, `persp x drift at ${JSON.stringify(p)}`);
      assert.ok(Math.abs(mineP.y - (1 - (v.y * 0.5 + 0.5)) * 800) <= 0.6, `persp y drift at ${JSON.stringify(p)}`);
    }
  }
});

// ----------------------------------------------------------------- sweep
for (const vp of VIEWPORTS) {
  for (const height of ZOOMS) {
    test(`sweep ${vp.name} @ frustum ${height}: zero clipped, zero overlapping, signs placed`, () => {
      const { project, viewport } = framing(vp, height);
      const { items: buildings, obstacles } = buildingItemsAndObstacles(project, sweepBundle);
      const items = [...buildings, ...chipItems(project, sweepBundle)];
      const figures = figureRects(project, sweepBundle);
      const res = resolveLabels({ items, obstacles, figures, viewport });
      const placed = [...res.entries()].filter(([, r]) => r.box);
      // Zero clipped: every placed box is wholly in frame.
      for (const [id, r] of placed) assert.ok(inFrameBox(r.box, vp), `${id} clipped at ${vp.name}@${height}`);
      // Zero overlapping label pairs.
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          assert.ok(!boxOverlap(placed[i][1].box, placed[j][1].box), `${placed[i][0]} overlaps ${placed[j][0]} at ${vp.name}@${height}`);
        }
      }
      // Plate-vs-figure (G-J1 round 2): no placed chip covers any
      // figure — the dimension the round-1 sweep never measured and
      // my Hark's audit failed the street frame on.
      for (const [id, r] of placed) {
        if (!id.startsWith('chip:')) continue;
        for (const f of figures) {
          assert.ok(!boxOverlap(r.box, f.rect), `chip ${id} covers figure ${f.id} at ${vp.name}@${height}`);
        }
      }
      // Label-pinned-to-building (G-J1 round 2): a placed building
      // label exists only while its building's extent is in frame.
      for (const [id, r] of placed) {
        if (id.startsWith('chip:')) continue;
        const item = buildings.find((b) => b.id === id);
        assert.ok(item && rectIntersectsViewport(item.frameRect, vp), `${id} labelled though its building is out of frame at ${vp.name}@${height}`);
      }
      // No BUILDING label struck through another building's screen
      // box. (Chips are exempt by design: a citizen stands in front
      // of buildings, so a chip overlays walls — what a chip must
      // never cover is a placed sign, asserted separately below.)
      const obstacleById = new Map(obstacles.map((o) => [o.id, o.rect]));
      for (const [id, r] of placed) {
        if (id.startsWith('chip:')) continue;
        for (const [oid, rect] of obstacleById) {
          if (oid === id) continue;
          assert.ok(!boxOverlap(r.box, rect), `${id}'s label is struck through by ${oid}'s building at ${vp.name}@${height}`);
        }
      }
      // Every building whose sign anchor is in frame is placed.
      for (const item of buildings) {
        if (item.anchors.sign.visible) {
          const r = res.get(item.id);
          assert.ok(r.box, `${item.id} unplaced though its sign anchor is in frame at ${vp.name}@${height} (rung ${r.rung})`);
        }
      }
      // Chips yield: no chip box overlaps any building's placed box.
      const buildingBoxes = placed.filter(([id]) => !id.startsWith('chip:'));
      for (const [id, r] of placed) {
        if (!id.startsWith('chip:')) continue;
        for (const [bid, br] of buildingBoxes) assert.ok(!boxOverlap(r.box, br.box), `chip ${id} strikes sign ${bid}`);
      }
    });
  }
}

// ------------------------------------------------- the naive control
// What Wave 1 shipped: every label a centred tag over its node, chips
// over heads, no ladder, no frame rule. This placer MUST fail — it is
// the positive control that the sweep above can detect the failures.
function naivePlacements(vp, height) {
  const { project } = framing(vp, height);
  const { items: buildings, obstacles } = buildingItemsAndObstacles(project, sweepBundle);
  const items = [...buildings, ...chipItems(project, sweepBundle)];
  const boxes = new Map();
  for (const item of items) {
    const anchor = item.kind === 'building' ? item.anchors.roof : item.anchors.head;
    const size = labelBox(item.text);
    boxes.set(item.id, { x: anchor.x - size.w / 2, y: anchor.y - size.h - 2, w: size.w, h: size.h });
  }
  return { boxes, obstacles };
}

function naiveViolations(vp, height) {
  const { boxes, obstacles } = naivePlacements(vp, height);
  const violations = [];
  const entries = [...boxes.entries()];
  for (const [id, box] of entries) {
    const partial = (box.x < vp.width && box.x + box.w > 0 && box.y < vp.heightPx && box.y + box.h > 0) && !inFrameBox(box, vp);
    if (partial) violations.push(`${id} clipped`);
    for (const o of obstacles) {
      if (o.id !== id && boxOverlap(box, o.rect)) violations.push(`${id} struck by ${o.id}`);
    }
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (boxOverlap(entries[i][1], entries[j][1])) violations.push(`${entries[i][0]} overlaps ${entries[j][0]}`);
    }
  }
  return violations;
}

test('positive control: naive placement reproduces the Wave 1 failure classes across the sweep', () => {
  let total = 0;
  for (const vp of VIEWPORTS) for (const h of ZOOMS) total += naiveViolations(vp, h).length;
  assert.ok(total >= 3, `naive placement produced only ${total} violations — the harness cannot detect the failure class`);
});

// ------------------------------------------- Wave 1's three named cases
test('regression W1-1 "Town H\u2026 clipped": a top-edge label is placed whole or not at all', () => {
  // Real invariant: Town Hall's label is whole at every sweep framing
  // (the sweep asserts it globally; here it is named).
  for (const vp of VIEWPORTS) {
    for (const h of ZOOMS) {
      const { project, viewport } = framing(vp, h);
      const { items, obstacles } = buildingItemsAndObstacles(project, sweepBundle);
      const res = resolveLabels({ items, obstacles, viewport });
      const th = items.find((i) => i.id === 'EMBER_TOWNHALL');
      if (th.anchors.sign.visible) assert.ok(inFrameBox(res.get('EMBER_TOWNHALL').box, vp), 'Town Hall label not whole');
    }
  }
  // The failure class, reproduced: an anchor near the frame's top
  // edge (the Wave 1 stage drew the top row's labels across the edge).
  const vp = VIEWPORTS[1];
  const item = {
    id: 'EMBER_TOWNHALL', kind: 'building', text: 'Town Hall', signText: 'Town Hall',
    anchors: { sign: { x: 195, y: 14, visible: true }, roof: { x: 195, y: 4, visible: true } },
    ownObstacle: 'EMBER_TOWNHALL',
  };
  const size = labelBox('Town Hall');
  const naiveBox = { x: 195 - size.w / 2, y: 4 - size.h - 2, w: size.w, h: size.h };
  assert.ok(!inFrameBox(naiveBox, vp), 'control: the naive tag is not clipped — scenario does not reproduce the class');
  const res = resolveLabels({ items: [item], obstacles: [], viewport: vp });
  const r = res.get('EMBER_TOWNHALL');
  assert.ok(r.rung === 'collapsed' || inFrameBox(r.box, vp), `ladder left Town Hall clipped (rung ${r.rung})`);
});

test('regression W1-2: the Meridian Hall label is never struck through by the College box', () => {
  // The real invariant, at every sweep framing.
  for (const v of VIEWPORTS) {
    for (const h of ZOOMS) {
      const { project, viewport } = framing(v, h);
      const { items, obstacles: obs } = buildingItemsAndObstacles(project, sweepBundle);
      const res = resolveLabels({ items, obstacles: obs, viewport });
      const r = res.get('EMBER_DISTRICT_3_PLOT_18');
      if (r.box) assert.ok(!boxOverlap(r.box, obs.find((o) => o.id === 'EMBER_COLLEGE').rect), `Meridian label struck by College at ${v.name}@${h}`);
    }
  }
  // The failure class, reproduced synthetically. In the scene's own
  // projection the naive Meridian tag misses the College's box by
  // ~6 px at overview (measured) — the Wave 1 strike belonged to the
  // 2D stage's isometric geometry, where the College box sits lower
  // over the Meridian label's row. The scenario below keeps the real
  // College screen box (desktop overview) and the real Meridian
  // anchors, with the tag anchor raised to the 2D stage's relative
  // position: the naive tag strikes; the ladder's sign does not.
  const vp = VIEWPORTS[0];
  const { project } = framing(vp, 68);
  const { obstacles } = buildingItemsAndObstacles(project, sweepBundle);
  const college = obstacles.find((o) => o.id === 'EMBER_COLLEGE');
  const item = {
    id: 'EMBER_DISTRICT_3_PLOT_18', kind: 'building',
    text: 'Meridian Hall (District 3, Plot 18)', signText: 'Meridian Hall',
    anchors: { sign: { x: 946, y: 355, visible: true }, roof: { x: 993, y: 271, visible: true } },
    ownObstacle: 'EMBER_DISTRICT_3_PLOT_18',
  };
  const size = labelBox(item.text);
  const naiveBox = { x: 993 - size.w / 2, y: 271 - size.h - 2, w: size.w, h: size.h };
  assert.ok(boxOverlap(naiveBox, college.rect), 'control: the naive tag does not strike — scenario does not reproduce the class');
  const res = resolveLabels({ items: [item], obstacles, viewport: vp });
  const r = res.get('EMBER_DISTRICT_3_PLOT_18');
  assert.ok(r.box && !boxOverlap(r.box, college.rect), `ladder left the Meridian label on the College box (rung ${r.rung})`);
});

test('regression W1-3: "Public Workshop" is never split by the citizen chip', () => {
  // Real configuration: the sample bundle puts Maren Thistlewood at
  // the Public Workshop. At every framing the Workshop sign is placed
  // at its sign rung and the chip never overlaps it.
  for (const vp of VIEWPORTS) {
    for (const h of ZOOMS) {
      const { project, viewport } = framing(vp, h);
      const { items: buildings, obstacles } = buildingItemsAndObstacles(project, sweepBundle);
      const items = [...buildings, ...chipItems(project, sweepBundle)];
      const res = resolveLabels({ items, obstacles, viewport });
      const sign = res.get('PUBLIC_WORKSHOP');
      const chip = [...res.entries()].find(([id]) => id === 'chip:portal-key:maren-thistlewood');
      assert.ok(chip, 'the Workshop citizen chip exists in the sample bundle');
      if (sign.box && chip[1].box) assert.ok(!boxOverlap(sign.box, chip[1].box), `chip splits the Workshop sign at ${vp.name}@${h}`);
    }
  }
  // The failure class, reproduced in screen space as the record
  // describes it (a chip drawn across the sign's row): the naive chip
  // lands on the sign; the ladder keeps the sign at rung 1 and moves
  // the chip clear.
  const vp = VIEWPORTS[0];
  const signItem = {
    id: 'PUBLIC_WORKSHOP', kind: 'building', text: 'Public Workshop', signText: 'Public Workshop',
    anchors: { sign: { x: 640, y: 420, visible: true }, roof: { x: 640, y: 380, visible: true } },
    ownObstacle: 'PUBLIC_WORKSHOP',
  };
  const chipItem = {
    id: 'chip:test', kind: 'chip', text: 'Maren Thistlewood',
    anchors: { head: { x: 640, y: 408, visible: true } },
  };
  const naiveSign = (() => { const s = labelBox('Public Workshop'); return { x: 640 - s.w / 2, y: 420 - s.h - 2, w: s.w, h: s.h }; })();
  const naiveChip = (() => { const s = labelBox('Maren Thistlewood'); return { x: 640 - s.w / 2, y: 408 - s.h - 3, w: s.w, h: s.h }; })();
  assert.ok(boxOverlap(naiveSign, naiveChip), 'control: naive chip does not split the sign — scenario does not reproduce the class');
  const res = resolveLabels({ items: [signItem, chipItem], obstacles: [], viewport: vp });
  assert.equal(res.get('PUBLIC_WORKSHOP').rung, 'sign', 'the sign keeps its rung');
  const chipRes = res.get('chip:test');
  assert.ok(!chipRes.box || !boxOverlap(chipRes.box, res.get('PUBLIC_WORKSHOP').box), 'the chip yields');
});

// ------------------------------------------------------- floors & yields
test('size floor: a label wider than the frame collapses to sign-only, never clips', () => {
  const vp = VIEWPORTS[1]; // mobile, 390 wide
  const long = 'A Record Label Far Wider Than Any Street In Ember Could Ever Hold On One Sign Board';
  const item = {
    id: 'X', kind: 'building', text: long, signText: long,
    anchors: { sign: { x: 195, y: 400, visible: true }, roof: { x: 195, y: 360, visible: true } },
    ownObstacle: 'X',
  };
  const res = resolveLabels({ items: [item], obstacles: [], viewport: vp });
  assert.equal(res.get('X').rung, 'collapsed');
  assert.equal(res.get('X').box, null);
  assert.ok(textWidthPx(long) > vp.width, 'control: the label really is wider than the frame');
});

test('budget: the per-frame budget collapses chips, never signs', () => {
  const vp = VIEWPORTS[0];
  const { project, viewport } = framing(vp, 68);
  const { items: buildings, obstacles } = buildingItemsAndObstacles(project, sweepBundle);
  const chips = [];
  for (let i = 0; i < 30; i++) {
    chips.push({
      id: `chip:bulk-${String(i).padStart(2, '0')}`, kind: 'chip', text: `Bulk Citizen ${i}`,
      anchors: { head: project({ x: (i % 10) * 4 - 18, y: 2.0, z: Math.floor(i / 10) * 6 }) },
    });
  }
  const res = resolveLabels({ items: [...buildings, ...chips], obstacles, viewport, budget: 14 });
  const placedCount = [...res.values()].filter((r) => r.box).length;
  assert.ok(placedCount <= 14, `${placedCount} labels placed over a budget of 14`);
  for (const b of buildings) {
    if (b.anchors.sign.visible) assert.ok(res.get(b.id).box, `${b.id} lost its sign to the budget`);
  }
});

test('determinism + text model: same inputs, same placements; widths are sane', () => {
  const vp = VIEWPORTS[0];
  const { project, viewport } = framing(vp, 44);
  const { items: buildings, obstacles } = buildingItemsAndObstacles(project, sweepBundle);
  const items = [...buildings, ...chipItems(project, sweepBundle)];
  const a = resolveLabels({ items, obstacles, viewport });
  const b = resolveLabels({ items, obstacles, viewport });
  assert.deepEqual([...a.entries()], [...b.entries()]);
  assert.equal(shortName('Meridian Hall (District 3, Plot 18)'), 'Meridian Hall');
  assert.equal(shortName('Ember Ledger Press (District 1, Plot 31)'), 'Ember Ledger Press');
  assert.equal(shortName('Town Hall'), 'Town Hall');
  assert.ok(textWidthPx('WWWW') > textWidthPx('iiii'));
  assert.equal(labelBox('Town Hall').h, Math.round(LABEL_FONT_PX * 1.32) + 4);
});

// ------------------------------------- G-J1 round 2 (Hark's audit)
// The two blockers from audits/HARK-GJ1-AUDIT-2026-11-03.md, as
// permanent regressions: (1) nameplates burying their citizens —
// plate-vs-figure was never in the sweep's test space; (2) the
// frame not holding its own content — a place label rendered with
// its building off-frame (the Ledger Press label over empty
// ground), and content clipped at the frame edge.

function gateFraming(chipId, bundle) {
  const eff = effectiveLayout(layout, bundle);
  const chip = cameraChipsForLayout(eff).find((c) => c.id === chipId);
  assert.ok(chip, `chip ${chipId} exists`);
  const vp = { name: chipId, width: 1280, heightPx: 800 };
  const cam = { target: chip.target, height: chip.height, aspect: vp.width / vp.heightPx, width: vp.width, heightPx: vp.heightPx };
  return { chip, vp, project: (p) => projectOrtho(p, cam), viewport: vp };
}

for (const chipId of ['overview', 'sample-street']) {
  test(`gate frame ${chipId}: no plate covers a figure; labels only on in-frame buildings`, () => {
    const { project, viewport, vp } = gateFraming(chipId, sweepBundle);
    const { items: buildings, obstacles } = buildingItemsAndObstacles(project, sweepBundle);
    const items = [...buildings, ...chipItems(project, sweepBundle)];
    const figures = figureRects(project, sweepBundle);
    const res = resolveLabels({ items, obstacles, figures, viewport });
    for (const [id, r] of res) {
      if (!r.box) continue;
      assert.ok(inFrameBox(r.box, vp), `${id} clipped in the ${chipId} gate frame`);
      if (id.startsWith('chip:')) {
        for (const f of figures) {
          assert.ok(!boxOverlap(r.box, f.rect), `plate ${id} covers figure ${f.id} in the ${chipId} gate frame`);
        }
      } else {
        const item = buildings.find((b) => b.id === id);
        assert.ok(rectIntersectsViewport(item.frameRect, vp), `${id} labelled with its building out of the ${chipId} frame`);
      }
    }
    // The three frontages: buildings fully in frame, labels placed.
    for (const code of ['EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE', 'EMBER_TOWNHALL']) {
      const item = buildings.find((b) => b.id === code);
      assert.ok(inFrameBox(item.frameRect, vp), `${code}'s building is not fully in the ${chipId} frame`);
      assert.ok(res.get(code).box, `${code}'s label is unplaced in the ${chipId} frame (rung ${res.get(code).rung})`);
    }
  });
}

test('gate frame sample-street: no building is partially in frame (the frame holds its content whole)', () => {
  const { project, vp } = gateFraming('sample-street', sweepBundle);
  const { items: buildings } = buildingItemsAndObstacles(project, sweepBundle);
  for (const b of buildings) {
    const r = b.frameRect;
    const fullyIn = inFrameBox(r, vp);
    const touches = rectIntersectsViewport(r, vp);
    assert.ok(fullyIn || !touches, `${b.id} is partially in the sample-street frame (rect ${JSON.stringify(r)})`);
  }
});

test('regression GJ1-B1: a blocked above-rung must not drop the plate onto its figure (planted control)', () => {
  const vp = VIEWPORTS[0];
  // A sign directly over the chip's above-rung space; the figure
  // stands under the head anchor. Round 1's ladder fell through to
  // chip-below — over the figure's body.
  // DELIBERATE RE-PLANT (G-J1 round 3): the relocation ladder
  // (above-far / above-left / above-right / far side rungs) escapes
  // the original geometry without ever touching the figure, so the
  // control no longer reproduced the class. The figure is widened
  // and a second sign blocks the above-far space: with figure
  // rects withheld the ladder now lands chip-right-far ON the
  // figure's edge — the same defect class (a plate on a figure
  // when the refusal data is absent) — and with the rects present
  // every rung that touches the figure is refused.
  const signItem = {
    id: 'HALL', kind: 'building', text: 'Hall', signText: 'Hall',
    anchors: { sign: { x: 300, y: 330, visible: true }, roof: { x: 300, y: 300, visible: true } },
    ownObstacle: 'HALL',
  };
  const signItem2 = {
    id: 'HALL2', kind: 'building', text: 'Hall', signText: 'Hall',
    anchors: { sign: { x: 300, y: 302, visible: true }, roof: { x: 300, y: 300, visible: true } },
    ownObstacle: 'HALL2',
  };
  const chipItem = {
    id: 'chip:one', kind: 'chip', text: 'Test Citizen',
    anchors: { head: { x: 300, y: 330, visible: true } },
    figureId: 'chip:one',
  };
  const figure = { id: 'chip:one', rect: { x: 240, y: 333, w: 120, h: 60 } };
  // Control: without figure rects, the ladder DOES bury the figure —
  // the check below can detect the failure class.
  const legacy = resolveLabels({ items: [signItem, signItem2, chipItem], obstacles: [], viewport: vp });
  const legacyChip = legacy.get('chip:one');
  assert.ok(legacyChip.box && boxOverlap(legacyChip.box, figure.rect),
    `control: legacy placement does not bury the figure (rung ${legacyChip.rung}) — scenario does not reproduce the class`);
  // Fixed: with figure rects, no placed box touches the figure.
  const fixed = resolveLabels({ items: [signItem, signItem2, chipItem], obstacles: [], figures: [figure], viewport: vp });
  const fixedChip = fixed.get('chip:one');
  assert.ok(!fixedChip.box || !boxOverlap(fixedChip.box, figure.rect),
    `plate still covers its figure (rung ${fixedChip.rung})`);
});

test('regression GJ1-B2a: a building wholly out of frame gets no label, however near its anchor (the Ledger float)', () => {
  const vp = VIEWPORTS[0];
  // The round-1 street framing is where Hark caught it.
  const cam = { target: { x: 9.5, y: 0, z: -13.5 }, height: 42, aspect: vp.width / vp.heightPx, width: vp.width, heightPx: vp.heightPx };
  const project = (p) => projectOrtho(p, cam);
  const { items: buildings, obstacles } = buildingItemsAndObstacles(project, sweepBundle);
  const ledger = buildings.find((b) => b.id === 'EMBER_DISTRICT_1_PLOT_31');
  assert.ok(ledger, 'the Ledger Press is in the labelled set');
  assert.ok(!rectIntersectsViewport(ledger.frameRect, vp), 'control: the Ledger building should be wholly out of the round-1 street frame');
  const res = resolveLabels({ items: buildings, obstacles, viewport: vp });
  assert.equal(res.get('EMBER_DISTRICT_1_PLOT_31').rung, 'out-of-frame');
  assert.equal(res.get('EMBER_DISTRICT_1_PLOT_31').box, null);
  // Control: strip the frameRect (the round-1 input shape) and the
  // old ladder DOES float the label into the frame — the failure
  // class is reproducible and the fix is what removes it.
  const legacyItems = buildings.map((b) => (b.id === 'EMBER_DISTRICT_1_PLOT_31' ? { ...b, frameRect: undefined } : b));
  const legacy = resolveLabels({ items: legacyItems, obstacles, viewport: vp });
  assert.ok(legacy.get('EMBER_DISTRICT_1_PLOT_31').box,
    'control: the round-1 input shape does not float the Ledger label — scenario does not reproduce the class');
});

test('regression GJ1-B2b: a partially-in-frame building keeps its label, anchored to the visible part', () => {
  const vp = VIEWPORTS[0];
  // Left half of the building out of frame; both anchors beyond the
  // ±40 px tolerance (the legacy presence rule would drop it).
  const item = {
    id: 'PART', kind: 'building', text: 'Partial Hall', signText: 'Partial Hall',
    anchors: { sign: { x: -90, y: 320, visible: false }, roof: { x: -90, y: 280, visible: false } },
    ownObstacle: 'PART',
    frameRect: { x: -60, y: 300, w: 200, h: 120 },
  };
  const res = resolveLabels({ items: [item], obstacles: [], viewport: vp });
  const r = res.get('PART');
  assert.ok(r.box, `partially-in building lost its label (rung ${r.rung})`);
  assert.equal(r.rung, 'visible-tag');
  assert.ok(inFrameBox(r.box, vp), 'the visible tag is not wholly in frame');
  // Anchored to the visible part: the box centre sits over the
  // visible span [0, 140], and the box rides just above the
  // building's visible top (rect.y = 300).
  const cx = r.box.x + r.box.w / 2;
  assert.ok(cx >= 0 && cx <= 140, `tag centre ${cx} is not over the visible span [0, 140]`);
  assert.equal(r.box.y, 300 - r.box.h - 2);
});

test('regression GJ1-B2c: a chip whose figure is wholly out of frame does not poke in at the edge', () => {
  const vp = VIEWPORTS[0];
  // Head anchor 1 px above the frame's bottom edge (well inside
  // the ±40 tolerance); the figure stands wholly below the frame.
  // The legacy ladder's above-rung box lands inside the frame, so
  // the plate pokes in for a figure that is not there.
  const chipItem = {
    id: 'chip:edge', kind: 'chip', text: 'Edge Citizen',
    anchors: { head: { x: 640, y: 799, visible: false } },
    figureId: 'chip:edge',
  };
  const figure = { id: 'chip:edge', rect: { x: 622, y: 802, w: 36, h: 60 } };
  const legacy = resolveLabels({ items: [chipItem], obstacles: [], viewport: vp });
  assert.ok(legacy.get('chip:edge').box, 'control: the legacy presence rule does not float the edge chip — scenario does not reproduce the class');
  const fixed = resolveLabels({ items: [chipItem], obstacles: [], figures: [figure], viewport: vp });
  assert.equal(fixed.get('chip:edge').rung, 'out-of-frame');
  assert.equal(fixed.get('chip:edge').box, null);
});

// ------------------------------------- G-J1 round 3 (Hark's R2 audit)
// Round 3: place labels obey plate-vs-figure too; station labels
// get the same rule off-resolver; the chip ladder relocates before
// refusing; and a plate must sit nearer its own figure's head
// anchor than any other figure's (the ambiguity rule). Each rule
// carries a planted control: the legacy shape (no figures / no
// anchors) reproduces the defect, the fixed shape refuses it.

const overlapsLocal = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('GJ1-R3 place-vs-figure: a building label never sits across a figure (planted control)', () => {
  const vp = { width: 800, heightPx: 600 };
  const item = {
    id: 'EMBER_TOWNHALL', kind: 'building', text: 'Ember Townhall (District 1, Plot 32)', signText: 'Ember Townhall',
    anchors: { sign: { x: 200, y: 160 }, roof: { x: 200, y: 90 } },
    ownObstacle: 'EMBER_TOWNHALL',
    frameRect: { x: 100, y: 60, w: 200, h: 190 },
  };
  const legacy = resolveLabels({ items: [item], obstacles: [], viewport: vp });
  assert.equal(legacy.get('EMBER_TOWNHALL').rung, 'sign', 'control: without figure rects the sign rung places the label');
  const signBox = legacy.get('EMBER_TOWNHALL').box;
  const figure = { id: 'chip:someone', rect: { x: signBox.x + 5, y: signBox.y - 30, w: 30, h: 120 } };
  assert.ok(overlapsLocal(signBox, figure.rect), 'the planted figure really covers the sign placement');
  const fixed = resolveLabels({ items: [item], obstacles: [], figures: [figure], viewport: vp });
  const r = fixed.get('EMBER_TOWNHALL');
  assert.equal(r.rung, 'roof-tag', 'the sign rung is refused across a figure; the ladder falls through');
  assert.ok(r.box && !overlapsLocal(r.box, figure.rect), 'the placed label clears the figure');
});

test('GJ1-R3 station labels: the same plate-vs-figure rule off-resolver (planted control)', () => {
  const vp = { width: 800, heightPx: 600 };
  const anchor = { x: 200, y: 200 };
  const clear = stationLabelPlacement({ text: 'Notice Board', anchor, figures: [], viewport: vp });
  assert.ok(clear, 'control: no figures, the label places');
  assert.equal(clear.y + clear.h, 200, 'the box bottom sits on the anchor (the scene renders translate(-50%,-100%))');
  assert.equal(clear.x + clear.w / 2, 200, 'centred on the anchor');
  const figure = { id: 'chip:someone', rect: { x: 185, y: 150, w: 30, h: 120 } };
  assert.ok(overlapsLocal(clear, figure.rect), 'the planted figure really covers the label');
  assert.equal(stationLabelPlacement({ text: 'Notice Board', anchor, figures: [figure], viewport: vp }), null, 'a station label across a figure is refused');
  const beside = { id: 'chip:other', rect: { x: 400, y: 150, w: 30, h: 120 } };
  assert.ok(stationLabelPlacement({ text: 'Notice Board', anchor, figures: [beside], viewport: vp }), 'a figure clear of the label does not refuse it');
});

test('GJ1-R3 relocation: a second plate stacks above-far instead of collapsing', () => {
  const vp = { width: 800, heightPx: 600 };
  const head = { x: 300, y: 300 };
  const mk = (id, text) => ({ id, kind: 'chip', text, anchors: { head }, figureId: id });
  const figures = [
    { id: 'chip:a-first', anchor: head, rect: { x: 293, y: 302, w: 14, h: 80 } },
    { id: 'chip:b-second', anchor: head, rect: { x: 293, y: 302, w: 14, h: 80 } },
  ];
  const res = resolveLabels({ items: [mk('chip:b-second', 'Second Resident'), mk('chip:a-first', 'First Resident')], obstacles: [], figures, viewport: vp });
  const a = res.get('chip:a-first');
  const b = res.get('chip:b-second');
  assert.equal(a.rung, 'chip-above');
  assert.equal(b.rung, 'chip-above-far', 'the second plate relocates a storey up rather than collapsing (the round-2 ladder had no such rung)');
  assert.ok(!overlapsLocal(a.box, b.box), 'the relocated plate clears the first');
});

test('GJ1-R3 ambiguity: a plate nearer another figure’s head than its own is refused (planted control)', () => {
  const vp = { width: 800, heightPx: 600 };
  // The subject stands near the frame's top edge, so every above
  // rung is out of frame; the subject's right rung would centre
  // its plate on the NEIGHBOUR's head anchor (the neighbour's
  // body rect lies lower, like a reclined figure's — its head
  // point is what the plate would cover).
  // DELIBERATE RE-PLANT (G-J1 round 4): the original scenario
  // blocked the above rungs with a tall overhead figure rect.
  // Round 4's rect-proximity rule (a plate must sit nearer its
  // own figure's RECT than any other) refuses the side rungs in
  // that geometry in BOTH variants — the overhead body is
  // centre-nearer to them than the subject's own column — so the
  // control no longer isolated the anchor rule. The frame edge
  // now does the blocking, and the anchor rule is again the only
  // difference between the two variants.
  const self = { id: 'chip:self', anchor: { x: 300, y: 24 }, rect: { x: 293, y: 26, w: 14, h: 80 } };
  const neighbour = { id: 'chip:neighbour', anchor: { x: 322, y: 24 }, rect: { x: 315, y: 54, w: 14, h: 30 } };
  const item = { id: 'chip:self', kind: 'chip', text: 'F One', anchors: { head: { x: 300, y: 24 } }, figureId: 'chip:self' };
  const noAnchors = [{ id: self.id, rect: self.rect }, { id: neighbour.id, rect: neighbour.rect }];
  const legacy = resolveLabels({ items: [item], obstacles: [], figures: noAnchors, viewport: vp });
  assert.equal(legacy.get('chip:self').rung, 'chip-right', 'control: without anchors the ambiguous side plate places');
  const fixed = resolveLabels({ items: [item], obstacles: [], figures: [self, neighbour], viewport: vp });
  const r = fixed.get('chip:self');
  assert.equal(r.rung, 'chip-left', 'with anchors the ambiguous rung is refused and the ladder falls through');
  const d = (p, b) => { const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w)); const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h)); return Math.hypot(dx, dy); };
  assert.ok(d(self.anchor, r.box) <= d(neighbour.anchor, r.box), 'the placed plate is at least as near its own figure as any other');
});

// ------------------------------------- G-J1 round 4 (Hark's R3 audit)
// Round 4: the misname rule (rect-proximity) and the detachment
// bound. The seq-614 street geometry, measured from the bundle
// through the scene model, is planted below in screen space:
// Kevin Bianchi's plate sat 1.1 px above Kavi Marlow's reclined
// body and 17.1 px above his own, while winning the round-3
// anchor race 3.0 vs 3.6 — every round-3 rule passed and the
// plate still read as Kavi's (the overview plated the same
// figure "Kavi Marlow"). And Rocky Headlong's plate floated
// 44 px sideways from his body over open ground.

const rectGap = (a, b) => {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
  return Math.hypot(dx, dy);
};
const hGapOf = (a, b) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
// Which figure a plate READS as naming: the figure whose rect is
// nearest the plate box by edge distance (unique minimum, or
// null when two figures tie — a tie reads as nobody's).
function readsAs(box, figures) {
  let best = null;
  let bestD = Infinity;
  let tie = false;
  for (const f of figures) {
    const d = rectGap(box, f.rect);
    if (d < bestD - 1e-9) { best = f; bestD = d; tie = false; } else if (Math.abs(d - bestD) <= 1e-9) tie = true;
  }
  return tie ? null : best;
}

test('GJ1-R4 misname: a plate nearer a neighbour’s body than its own is refused (planted seq-614 control)', () => {
  const vp = { width: 1237, heightPx: 773 };
  // The seq-614 street figures, as measured (reclined sleepers on
  // a diagonal): Kavi Marlow at anchor (684.2, 505.8), Kevin
  // Bianchi at (738.3, 521.8); the bodies lie below the anchors.
  const kavi = { id: 'chip:portal-key:kavi-marlow', anchor: { x: 684.2, y: 505.8 }, rect: { x: 676.5, y: 519.9, w: 15.5, h: 28.1 } };
  const kevin = { id: 'chip:portal-key:kevin-bianchi', anchor: { x: 738.3, y: 521.8 }, rect: { x: 730.6, y: 535.8, w: 15.5, h: 28.1 } };
  const kevinChip = { id: kevin.id, kind: 'chip', text: 'Kevin Bianchi', anchors: { head: kevin.anchor }, figureId: kevin.id };
  // Control: with figure data withheld, the ladder places
  // chip-above — and that box sits 1.1 px over Kavi's body,
  // 17.1 px from Kevin's own: it reads as Kavi's. The round-3
  // anchor race scored this box 3.0 (own) vs 3.6 (Kavi) and
  // passed it; the defect is in what the rules measured.
  const legacy = resolveLabels({ items: [kevinChip], obstacles: [], viewport: vp });
  const legacyChip = legacy.get(kevin.id);
  assert.equal(legacyChip.rung, 'chip-above', 'control: the legacy ladder places the seq-614 plate');
  assert.ok(rectGap(legacyChip.box, kavi.rect) < rectGap(legacyChip.box, kevin.rect),
    `control: the legacy plate is not nearer the neighbour's body (${rectGap(legacyChip.box, kavi.rect)} vs ${rectGap(legacyChip.box, kevin.rect)}) — scenario does not reproduce the misname`);
  assert.equal(readsAs(legacyChip.box, [kavi, kevin]).id, kavi.id, 'control: the legacy plate reads as the neighbour’s');
  // Fixed: with figures present, chip-above (and above-far and
  // above-left, all nearer Kavi's body than Kevin's) are refused;
  // the plate lands where its own figure is the nearest body.
  const fixed = resolveLabels({ items: [kevinChip], obstacles: [], figures: [kavi, kevin], viewport: vp });
  const r = fixed.get(kevin.id);
  assert.equal(r.rung, 'chip-above-right', 'the fixed ladder relocates the plate onto its own figure’s side');
  assert.equal(readsAs(r.box, [kavi, kevin]).id, kevin.id, 'the fixed plate reads as its own figure’s');
});

test('GJ1-R4 detachment: a plate floating sideways off its figure’s column is refused (planted control)', () => {
  const vp = { width: 800, heightPx: 600 };
  // Modelled on Rocky Headlong at seq 614: a wide figure rect
  // (FB1) roofs the above rungs, a second (FB2) blocks the left
  // rung, and a placed sign blocks the right rung — so the legacy
  // ladder escapes to chip-right-far, 44 px sideways from the
  // subject's body, over open ground.
  const rocky = { id: 'chip:rocky', anchor: { x: 300, y: 300 }, rect: { x: 292, y: 314, w: 16, h: 60 } };
  const fb1 = { id: 'fig:fb1', rect: { x: 200, y: 250, w: 200, h: 39 } };
  // DELIBERATE RE-PLANT (Item 3, 2026-11-03): citizen plates
  // shrank (chipBox "Rocky Headlong" 114×21 → 95×18), so the
  // chip-left box's left edge moved 178 → 197 and cleared FB2's
  // right edge (190) — the legacy ladder placed chip-left and
  // the control no longer reproduced the float. FB2 is widened
  // (40 → 70, right edge 220) to block the left rung at the new
  // plate size; the defect class, the far-rung escape (44 px),
  // and every assertion below are unchanged.
  const fb2 = { id: 'fig:fb2', rect: { x: 150, y: 295, w: 70, h: 40 } };
  const hall = {
    id: 'HALL', kind: 'building', text: 'Hall', signText: 'Hall',
    anchors: { sign: { x: 327, y: 313, visible: true }, roof: { x: 327, y: 280, visible: true } },
    ownObstacle: 'HALL', frameRect: { x: 280, y: 240, w: 120, h: 120 },
  };
  const rockyChip = { id: rocky.id, kind: 'chip', text: 'Rocky Headlong', anchors: { head: rocky.anchor }, figureId: rocky.id };
  // Control: the subject's own rect withheld (the pre-round-4
  // input shape for this rule) — the ladder places the far side
  // rung, detached 44 px from the body it names.
  const legacy = resolveLabels({ items: [hall, rockyChip], obstacles: [], figures: [fb1, fb2], viewport: vp });
  const legacyChip = legacy.get(rocky.id);
  assert.equal(legacyChip.rung, 'chip-right-far', 'control: the legacy ladder escapes to the far side rung');
  assert.ok(hGapOf(legacyChip.box, rocky.rect) > MAX_DETACH_GAP_PX,
    `control: the legacy plate is not detached (${hGapOf(legacyChip.box, rocky.rect)} px) — scenario does not reproduce the float`);
  // Fixed: with the subject's rect present, the far rung is past
  // the detachment bound and every other rung is blocked — the
  // plate collapses rather than naming nothing.
  const fixed = resolveLabels({ items: [hall, rockyChip], obstacles: [], figures: [fb1, fb2, rocky], viewport: vp });
  assert.equal(fixed.get(rocky.id).rung, 'collapsed', 'the detached placement is refused, not placed');
  assert.equal(MAX_DETACH_GAP_PX, 8, 'the bound is the ladder’s own side offset (chip-right/left stand 8 px off the anchor)');
});

test('GJ1-R4 detachment solo: a fixture where detachment is the ONLY refusing rule (close-out recommendation)', () => {
  // Hark's close-out recommendation (audits/
  // HARK-TOUCHUP-R1-CLOSEOUT-2026-11-03.md, carried item on the
  // §5c control): on the Rocky geometry above, detachment has no
  // solo guard — disable it and rect-proximity still refuses the
  // escape rung, so the pair carries the guard jointly. This
  // fixture isolates detachment: the subject's head anchor floats
  // far to the side of its own body rect (the detachment defect
  // shape — a plate in the anchor's column, naming a body that is
  // not under it), and the one bystander stands far off, present
  // so the ambiguity and rect-proximity rules are exercised and
  // PASS. Every rung of the ladder is horizontally detached from
  // the subject's rect, so with detachment disabled the ladder
  // takes chip-above; with it enabled, nothing else can rescue
  // or share the refusal of that rung.
  const vp = { width: 900, heightPx: 400 };
  const solo = { id: 'chip:solo', anchor: { x: 280, y: 146 }, rect: { x: 100, y: 150, w: 16, h: 60 } };
  const bystander = { id: 'fig:bystander', anchor: { x: 838, y: 326 }, rect: { x: 830, y: 330, w: 16, h: 50 } };
  const soloChip = { id: solo.id, kind: 'chip', text: 'Solo Detached', anchors: { head: solo.anchor }, figureId: solo.id };
  const d = (p, b) => { const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w)); const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h)); return Math.hypot(dx, dy); };
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  // Control: with figure data withheld, the ladder places
  // chip-above — and that box floats 120.5 px sideways from the
  // body it names (measured, not asserted from the fixture's
  // intent).
  const legacy = resolveLabels({ items: [soloChip], obstacles: [], viewport: vp });
  const legacyChip = legacy.get(solo.id);
  assert.equal(legacyChip.rung, 'chip-above', 'control: the legacy ladder places the detached plate');
  assert.ok(hGapOf(legacyChip.box, solo.rect) > MAX_DETACH_GAP_PX,
    `control: the legacy plate is not detached (${hGapOf(legacyChip.box, solo.rect)} px) — scenario does not reproduce the float`);
  // The solo diagnosis, recomputed rule by rule for the operative
  // rung (chip-above — the rung the ladder would take): every
  // other refusal PASSES for this box; detachment alone refuses.
  const box = legacyChip.box;
  assert.ok(!overlaps(box, solo.rect) && !overlaps(box, bystander.rect),
    'solo: figure-overlap does not refuse chip-above');
  assert.ok(d(solo.anchor, box) < d(bystander.anchor, box),
    'solo: ambiguity does not refuse chip-above (own anchor is the nearest)');
  assert.ok(rectGap(box, solo.rect) < rectGap(box, bystander.rect)
    && d({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, solo.rect) < d({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, bystander.rect),
    'solo: rect-proximity does not refuse chip-above (own rect is the nearest by edge and by centre)');
  // Fixed: with figures present, the plate collapses — and by
  // the diagnosis above, detachment is the rule carrying it.
  const fixed = resolveLabels({ items: [soloChip], obstacles: [], figures: [solo, bystander], viewport: vp });
  assert.equal(fixed.get(solo.id).rung, 'collapsed', 'the detached placement is refused, not placed — by detachment alone');
  assert.equal(MAX_DETACH_GAP_PX, 8, 'the bound is the ladder’s own side offset (chip-right/left stand 8 px off the anchor)');
});

test('GJ1-R4 cross-view: at one bundle, two views never read the same figure under two names', () => {
  // The seq-614 pair in both gate views (screen geometry as
  // measured): the street put Kevin's name on Kavi's figure while
  // the overview put Kavi's — one figure, two names, one bundle.
  const street = {
    vp: { width: 1237, heightPx: 773 },
    figures: [
      { id: 'chip:portal-key:kavi-marlow', anchor: { x: 684.2, y: 505.8 }, rect: { x: 676.5, y: 519.9, w: 15.5, h: 28.1 } },
      { id: 'chip:portal-key:kevin-bianchi', anchor: { x: 738.3, y: 521.8 }, rect: { x: 730.6, y: 535.8, w: 15.5, h: 28.1 } },
    ],
  };
  const overview = {
    vp: { width: 1237, heightPx: 773 },
    figures: [
      { id: 'chip:portal-key:kavi-marlow', anchor: { x: 678.2, y: 349.0 }, rect: { x: 672.5, y: 359.3, w: 11.4, h: 20.7 } },
      { id: 'chip:portal-key:kevin-bianchi', anchor: { x: 718.0, y: 360.7 }, rect: { x: 712.3, y: 371.0, w: 11.4, h: 20.7 } },
    ],
  };
  const names = { 'chip:portal-key:kavi-marlow': 'Kavi Marlow', 'chip:portal-key:kevin-bianchi': 'Kevin Bianchi' };
  const readByFigure = new Map(); // figureId -> Map(view -> name read)
  for (const [viewName, view] of [['street', street], ['overview', overview]]) {
    const items = view.figures.map((f) => ({
      id: f.id, kind: 'chip', text: names[f.id], anchors: { head: f.anchor }, figureId: f.id,
    }));
    const res = resolveLabels({ items, obstacles: [], figures: view.figures, viewport: view.vp });
    for (const f of view.figures) {
      const r = res.get(f.id);
      if (!r.box) continue;
      const read = readsAs(r.box, view.figures);
      assert.ok(read, `${viewName}: ${names[f.id]}’s plate ties between two figures — it reads as nobody’s`);
      assert.equal(read.id, f.id, `${viewName}: ${names[f.id]}’s plate reads as ${names[read.id]}’s`);
      if (!readByFigure.has(read.id)) readByFigure.set(read.id, new Map());
      readByFigure.get(read.id).set(viewName, names[f.id]);
    }
  }
  // The cross-view law itself: a figure read as named in both
  // views carries the SAME name in each.
  for (const [figureId, byView] of readByFigure) {
    const distinct = new Set(byView.values());
    assert.equal(distinct.size, 1, `figure ${figureId} reads under two names across views: ${[...distinct].join(' / ')}`);
  }
});

// ------------------------------------- Item 3 (the project owner, 2026-11-03)
// "Smaller plates, and a plate shows when a person is manually
// selected." Citizen chips shrink (chipBox metrics); building
// labels do not. A selected citizen's chip resolves first among
// chips, at its best legal rung. As first built, selection
// overrode NO refusal; the project owner's exemption ruling (2026-11-03,
// DECISIONS.md — "Exempt overlap and proximity for selected
// plates") then waived the two cosmetic classes for the selected
// chip only: figure-overlap and detachment (proximity).
// Ambiguity and misname (rect-proximity) refusals, placed-box
// overlap, and the frame bound stay absolute for selected and
// unselected alike. The exemption tests follow the Item 3 tests.

test('Item 3 smaller plates: chip metrics shrink, building metrics do not move', () => {
  assert.equal(CHIP_FONT_PX, 10.5, 'the ruled smaller chip font (labels.mjs, Item 3 comment)');
  assert.ok(CHIP_FONT_PX < LABEL_FONT_PX, 'chips are smaller than place labels');
  assert.equal(CHIP_PAD_X_PX, 5, 'the narrower chip padding');
  // Pinned boxes, measured from the model: the same name as a
  // citizen plate and as a building label.
  assert.deepEqual(chipBox('Rocky Headlong'), { w: 95, h: 18 });
  assert.deepEqual(labelBox('Rocky Headlong'), { w: 114, h: 21 }, 'building label metrics unchanged by Item 3');
  assert.deepEqual(chipBox('Kevin Bianchi'), { w: 84, h: 18 });
  for (const name of ['A', 'Nath Borowik', 'Lenore Nevermore', 'Sapphire Clarke']) {
    const c = chipBox(name), l = labelBox(name);
    assert.ok(c.w < l.w && c.h < l.h, `${name}: chip ${c.w}x${c.h} is not smaller than label ${l.w}x${l.h}`);
  }
});

test('Item 3 select-to-show: a citizen collapsed at a dense cluster gains a plate when selected, at a legal rung', () => {
  const vp = { width: 800, heightPx: 600 };
  // Three citizens in a tight row; a sign roofs the middle
  // citizen's above-far rung. Plain ladder (id order): Alpha
  // takes chip-above, Bravo's every rung is refused (Alpha's
  // plate, the sign, Charlie's body, the misname rule against
  // Charlie's rect on the above-right rung), Charlie places.
  const mkFigure = (id, x) => ({ id, anchor: { x, y: 400 }, rect: { x: x - 7, y: 402, w: 14, h: 80 } });
  const figures = [mkFigure('chip:a-alpha', 200), mkFigure('chip:b-bravo', 260), mkFigure('chip:c-charlie', 320)];
  const mkChip = (f, text) => ({ id: f.id, kind: 'chip', text, anchors: { head: f.anchor }, figureId: f.id });
  const items = [
    { id: 'HALL', kind: 'building', text: 'Hall', signText: 'Hall', anchors: { sign: { x: 260, y: 375 }, roof: { x: 260, y: 340 } }, ownObstacle: 'HALL' },
    mkChip(figures[0], 'Alpha Resident'), mkChip(figures[1], 'Bravo Resident'), mkChip(figures[2], 'Charlie Resident'),
  ];
  const plain = resolveLabels({ items, obstacles: [], figures, viewport: vp });
  assert.ok(plain.get('chip:a-alpha').box, 'control: Alpha places in the plain ladder');
  assert.equal(plain.get('chip:b-bravo').rung, 'collapsed', 'control: Bravo collapses in the plain ladder at this cluster');
  assert.ok(plain.get('chip:c-charlie').box, 'control: Charlie places in the plain ladder');

  const sel = resolveLabels({ items, obstacles: [], figures, viewport: vp, selectedId: 'chip:b-bravo' });
  const b = sel.get('chip:b-bravo');
  assert.equal(b.rung, 'chip-above', 'the selected citizen takes its best rung, resolved before the other chips');
  assert.equal(b.selected, true, 'the selected entry is marked');
  assert.equal(b.exempted, undefined, 'the cluster gain is resolution order, not an exemption waiver');
  // The gained rung is legal, not bought: no figure covered, and
  // the plate reads as Bravo's own figure by the rect measure.
  for (const f of figures) assert.ok(!overlapsLocal(b.box, f.rect), `the selected plate covers figure ${f.id}`);
  assert.equal(readsAs(b.box, figures).id, 'chip:b-bravo', 'the selected plate reads as its own figure');
  assert.ok(sel.get('chip:a-alpha').box, 'priority is not erasure: the neighbour still places around it');
  // Deterministic, and a selectedId naming no chip changes nothing.
  const sel2 = resolveLabels({ items, obstacles: [], figures, viewport: vp, selectedId: 'chip:b-bravo' });
  assert.deepEqual([...sel.entries()], [...sel2.entries()]);
  const ignored = resolveLabels({ items, obstacles: [], figures, viewport: vp, selectedId: 'HALL' });
  assert.deepEqual([...ignored.entries()], [...plain.entries()], 'a selectedId naming a building is ignored');
});

test('Item 3 select-to-show: hard refusals still bind the selected chip (the Rocky detachment geometry, selected)', () => {
  const vp = { width: 800, heightPx: 600 };
  // The GJ1-R4 detachment control's geometry. Under the
  // 2026-11-03 exemption the cosmetic refusals on Rocky's
  // ladder are waived for him — but every rung ALSO carries a
  // hard refusal (a placed sign box on chip-above, the misname
  // rule on the far rungs), and those hold at full strength,
  // so even selected he collapses — the follow/info surface
  // names him instead (scene.mjs's pick handler; see
  // labels.mjs). (As first built this test pinned "selection
  // never overrides a refusal"; the exemption ruling changed
  // that for the cosmetic classes, so the pin moved to the
  // hard classes this geometry actually exercises. Every
  // assertion below is unchanged from the original test.)
  const rocky = { id: 'chip:rocky', anchor: { x: 300, y: 300 }, rect: { x: 292, y: 314, w: 16, h: 60 } };
  const fb1 = { id: 'fig:fb1', rect: { x: 200, y: 250, w: 200, h: 39 } };
  const fb2 = { id: 'fig:fb2', rect: { x: 150, y: 295, w: 70, h: 40 } };
  const hall = {
    id: 'HALL', kind: 'building', text: 'Hall', signText: 'Hall',
    anchors: { sign: { x: 327, y: 313, visible: true }, roof: { x: 327, y: 280, visible: true } },
    ownObstacle: 'HALL', frameRect: { x: 280, y: 240, w: 120, h: 120 },
  };
  const rockyChip = { id: rocky.id, kind: 'chip', text: 'Rocky Headlong', anchors: { head: rocky.anchor }, figureId: rocky.id };
  const sel = resolveLabels({ items: [hall, rockyChip], obstacles: [], figures: [fb1, fb2, rocky], viewport: vp, selectedId: rocky.id });
  const r = sel.get(rocky.id);
  assert.equal(r.rung, 'collapsed', 'selected but no legal rung: the plate stays collapsed');
  assert.equal(r.box, null);
  assert.equal(r.selected, true, 'the collapsed entry still records that this citizen was the selected one');
  assert.equal(MAX_DETACH_GAP_PX, 8, 'the detachment bound is unchanged by Item 3');
});

// ------------------------- Selected-plate exemption (the project owner's
// ruling, 2026-11-03 — DECISIONS.md: "Exempt overlap and
// proximity for selected plates"). For the selected chip only,
// figure-overlap and detachment refusals are waived; ambiguity,
// misname (rect-proximity), placed-box overlap and the frame
// bound are not. Each test below pins one side of that line,
// with the unselected run as its own control.

test('Exemption: a selected citizen refused only on figure-overlap plates; unselected, the same plate collapses', () => {
  const vp = { width: 800, heightPx: 600 };
  // The seq-997 street shape (Atlas Meridian / Kavi Marlow /
  // Kevin Bianchi at bundle seq 997): the citizen's chip-above
  // box is refused by figure-overlap against the citizen's own
  // figure rect, and every other rung is refused too (the side
  // rungs by flanking figure rects, the far rungs by the
  // detachment bound, the below rung by the same overlap).
  const subj = { id: 'chip:subj', anchor: { x: 400, y: 300 }, rect: { x: 392, y: 250, w: 16, h: 126 } };
  const flankR = { id: 'fig:fr', rect: { x: 500, y: 280, w: 30, h: 60 } };
  const flankL = { id: 'fig:fl', rect: { x: 270, y: 280, w: 20, h: 60 } };
  const chip = { id: subj.id, kind: 'chip', text: 'Selected Resident', anchors: { head: subj.anchor }, figureId: subj.id };
  const figures = [subj, flankR, flankL];
  // Control: unselected, the citizen collapses — figure-overlap
  // refuses at full strength, exactly as before the ruling.
  const un = resolveLabels({ items: [chip], obstacles: [], figures, viewport: vp });
  assert.equal(un.get(subj.id).rung, 'collapsed', 'control: unselected, figure-overlap still refuses');
  // Ruled: selected, the citizen plates at chip-above and the
  // entry records the waiver that bought it.
  const sel = resolveLabels({ items: [chip], obstacles: [], figures, viewport: vp, selectedId: subj.id });
  const r = sel.get(subj.id);
  assert.equal(r.rung, 'chip-above', 'the selected citizen plates at the overlap-refused rung');
  assert.deepEqual(r.exempted, ['figure-overlap'], 'the entry names the waived class');
  assert.equal(r.selected, true);
  // Scope: the waiver is the selected citizen's alone — an
  // unselected citizen at the same spot in the same world still
  // collapses (here the standing selected plate adds a
  // placed-box refusal of its own; no waiver reaches him).
  const twin = { id: 'chip:twin', anchor: { x: 400, y: 300 }, rect: { x: 392, y: 250, w: 16, h: 126 } };
  const twinChip = { id: twin.id, kind: 'chip', text: 'Selected Resident', anchors: { head: twin.anchor }, figureId: twin.id };
  const mix = resolveLabels({ items: [chip, twinChip], obstacles: [], figures: [subj, twin, flankR, flankL], viewport: vp, selectedId: subj.id });
  assert.equal(mix.get(twin.id).rung, 'collapsed', 'the unselected twin gains nothing from the other citizen’s selection');
  assert.equal(mix.get(twin.id).exempted, undefined);
});

test('Exemption: a selected citizen refused only on detachment (proximity) plates at the far rung', () => {
  const vp = { width: 800, heightPx: 600 };
  // The Rocky detachment geometry, re-planted so the far side
  // rung is refused ONLY by the detachment bound: FB1 is
  // shortened (w 200 -> 100) so its rect no longer reaches the
  // far rung's proximity race (in the R4 geometry the misname
  // rule also refuses that rung — see the hard-refusal test
  // above). The above rungs stay roofed by FB1 (figure-overlap
  // + misname), the left rung stays blocked by FB2 (misname),
  // the right rung by the placed Hall sign (placed-box).
  const rocky = { id: 'chip:rocky', anchor: { x: 300, y: 300 }, rect: { x: 292, y: 314, w: 16, h: 60 } };
  const fb1 = { id: 'fig:fb1', rect: { x: 200, y: 250, w: 100, h: 39 } };
  const fb2 = { id: 'fig:fb2', rect: { x: 150, y: 295, w: 70, h: 40 } };
  const hall = {
    id: 'HALL', kind: 'building', text: 'Hall', signText: 'Hall',
    anchors: { sign: { x: 327, y: 313, visible: true }, roof: { x: 327, y: 280, visible: true } },
    ownObstacle: 'HALL', frameRect: { x: 280, y: 240, w: 120, h: 120 },
  };
  const rockyChip = { id: rocky.id, kind: 'chip', text: 'Rocky Headlong', anchors: { head: rocky.anchor }, figureId: rocky.id };
  // Control 1 (the R4 control shape): with the subject's rect
  // withheld, the ladder escapes to the far rung, detached.
  const legacy = resolveLabels({ items: [hall, rockyChip], obstacles: [], figures: [fb1, fb2], viewport: vp });
  assert.equal(legacy.get(rocky.id).rung, 'chip-right-far', 'control: the legacy ladder escapes to the far side rung');
  assert.ok(hGapOf(legacy.get(rocky.id).box, rocky.rect) > MAX_DETACH_GAP_PX, 'control: the escape is past the detachment bound');
  // Control 2: unselected with figures present, he collapses —
  // the detachment bound refuses at full strength.
  const un = resolveLabels({ items: [hall, rockyChip], obstacles: [], figures: [fb1, fb2, rocky], viewport: vp });
  assert.equal(un.get(rocky.id).rung, 'collapsed', 'control: unselected, the detached placement is refused, not placed');
  // Ruled: selected, the far rung is his — the proximity
  // refusal is waived and the waiver is recorded. The bound
  // itself does not move; it simply no longer refuses HIM.
  const sel = resolveLabels({ items: [hall, rockyChip], obstacles: [], figures: [fb1, fb2, rocky], viewport: vp, selectedId: rocky.id });
  const r = sel.get(rocky.id);
  assert.equal(r.rung, 'chip-right-far', 'the selected citizen plates at the detachment-refused rung');
  assert.deepEqual(r.exempted, ['detachment'], 'the entry names the waived class');
  assert.ok(hGapOf(r.box, rocky.rect) > MAX_DETACH_GAP_PX, 'the placed plate is the detached one — bought by the waiver, not by a moved bound');
  assert.equal(MAX_DETACH_GAP_PX, 8, 'the detachment bound is unchanged by the exemption');
});

test('Exemption: misname refusals hold for selected plates (planted seq-614 geometry, selected)', () => {
  const vp = { width: 1237, heightPx: 773 };
  // The GJ1-R4 misname geometry: Kevin Bianchi's chip-above
  // sits nearer Kavi Marlow's body than his own. The exemption
  // does not reach the misname rule — selected, Kevin still
  // may not take that rung; he lands where the unselected
  // ladder lands him, with no waiver used.
  const kavi = { id: 'chip:portal-key:kavi-marlow', anchor: { x: 684.2, y: 505.8 }, rect: { x: 676.5, y: 519.9, w: 15.5, h: 28.1 } };
  const kevin = { id: 'chip:portal-key:kevin-bianchi', anchor: { x: 738.3, y: 521.8 }, rect: { x: 730.6, y: 535.8, w: 15.5, h: 28.1 } };
  const kevinChip = { id: kevin.id, kind: 'chip', text: 'Kevin Bianchi', anchors: { head: kevin.anchor }, figureId: kevin.id };
  const sel = resolveLabels({ items: [kevinChip], obstacles: [], figures: [kavi, kevin], viewport: vp, selectedId: kevin.id });
  const r = sel.get(kevin.id);
  assert.notEqual(r.rung, 'chip-above', 'the misname-refused rung stays refused for the selected citizen');
  assert.equal(r.rung, 'chip-above-right', 'he lands where his own figure is the nearest body, as unselected');
  assert.equal(readsAs(r.box, [kavi, kevin]).id, kevin.id, 'the selected plate reads as its own figure’s');
  assert.equal(r.exempted, undefined, 'no cosmetic waiver was used or needed on the legal rung');
});

test('Exemption: ambiguity refusals hold for selected plates', () => {
  const vp = { width: 800, heightPx: 600 };
  // A neighbour's head anchor sits nearer the subject's above
  // boxes than the subject's own anchor (the neighbour's body
  // is far away, so no other rule speaks): every above rung is
  // ambiguity-refused. Selected, the subject still may not
  // take one — he lands on the side rung that is legally his.
  const a = { id: 'chip:a', anchor: { x: 300, y: 300 }, rect: { x: 292, y: 314, w: 16, h: 60 } };
  const b = { id: 'chip:b', anchor: { x: 300, y: 285 }, rect: { x: 600, y: 500, w: 16, h: 60 } };
  const chipA = { id: a.id, kind: 'chip', text: 'Alpha Resident', anchors: { head: a.anchor }, figureId: a.id };
  const sel = resolveLabels({ items: [chipA], obstacles: [], figures: [a, b], viewport: vp, selectedId: a.id });
  const r = sel.get(a.id);
  assert.equal(r.rung, 'chip-right', 'the selected citizen takes the legal side rung, not an ambiguity-refused above rung');
  assert.equal(r.exempted, undefined, 'no waiver was used on the legal rung');
  const un = resolveLabels({ items: [chipA], obstacles: [], figures: [a, b], viewport: vp });
  assert.equal(un.get(a.id).rung, 'chip-right', 'control: the unselected ladder agrees — ambiguity refused the above rungs all along');
});
