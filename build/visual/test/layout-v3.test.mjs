// M4.11 (layout v3) + M4.13 (roads & ground) — the geometry lane's
// proofs, run against the REAL shared layout and the REAL footprint
// specs. Run per file: node --test test/layout-v3.test.mjs
//
// What is proven here:
//   M4.11 — layout v3 is committed and current with its generator;
//     everything v1 carried (codes, positions, edges, seconds,
//     labels, provenance) is preserved verbatim, so the engine's
//     routes are identical on v1 and v3 (the law doesn't change);
//     the composed geometry matches the footprint specs it derives
//     from (footprints, door faces, sign anchors at 2.6, corner
//     entries exactly where the module rule admits them).
//   M4.13 — every edge carries a street path; each path starts at
//     one end's door (or gate / paving edge) and ends at the other's;
//     no path segment crosses any building's footprint; every pair
//     of doors the engine can route between is connected by street
//     paths along its route; the staged-fill plot (PLOT_30) gets the
//     same treatment at runtime from the fillGeometry template; the
//     geometry names no unrecorded feature; the staging disclosure
//     is present in the layout's own notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { findPath, findRoute } from '../../engine/astar.mjs';
import { effectiveLayout } from '../../app/logic.mjs';
import {
  streetPathFor,
  endForNode,
  fillNodeGeometry,
  segmentIntersectsRect,
  gridToWorld,
  FACE_NORMAL,
  STREET_WIDTH_UNITS,
} from '../scene/streets.mjs';

const layout = JSON.parse(readFileSync(new URL('../../shared/ember-layout.json', import.meta.url), 'utf8'));
const v1 = JSON.parse(readFileSync(new URL('./fixtures/ember-layout-v1.json', import.meta.url), 'utf8'));
const specsDoc = JSON.parse(readFileSync(new URL('../footprint-specs.json', import.meta.url), 'utf8'));
const specs = new Map(specsDoc.specs.map((s) => [s.code, s]));
const byCode = new Map(layout.nodes.map((n) => [n.code, n]));
const HUB = 'EMBER_PLAZA_OF_UNITY';

const near = (a, b, eps = 0.011) => Math.abs(a - b) <= eps;
const ptNear = (p, q, eps = 0.011) => near(p.x, q.x, eps) && near(p.z !== undefined ? p.z : p.y, q.z !== undefined ? q.z : q.y, eps);

// ------------------------------------------------------------- M4.11
test('v3 preservation: codes, positions, edges, seconds, labels, provenance identical to v1', () => {
  assert.equal(layout.version, 3);
  assert.equal(layout.nodes.length, v1.nodes.length);
  for (const n1 of v1.nodes) {
    const n3 = byCode.get(n1.code);
    assert.ok(n3, `${n1.code} missing in v3`);
    for (const k of ['codeStatus', 'kind', 'label', 'provenanceClass', 'x', 'y']) {
      assert.deepEqual(n3[k], n1[k], `${n1.code}.${k} changed in v3`);
    }
  }
  assert.equal(layout.edges.length, v1.edges.length);
  for (const e1 of v1.edges) {
    const e3 = layout.edges.find((e) => e.a === e1.a && e.b === e1.b);
    assert.ok(e3, `edge ${e1.a}-${e1.b} missing in v3`);
    assert.equal(e3.seconds, e1.seconds, `edge ${e1.a}-${e1.b} seconds changed`);
  }
});

test('v3 routes: A* returns identical paths and costs on v1 and v3 for every pair', () => {
  const codes = v1.nodes.map((n) => n.code);
  for (const a of codes) {
    for (const b of codes) {
      assert.deepEqual(findPath(layout, a, b), findPath(v1, a, b), `route ${a} -> ${b} changed`);
    }
  }
});

test('v3 currency: the committed layout is the generator\u2019s output', () => {
  const res = spawnSync(process.execPath, [new URL('../layout-v3-build.mjs', import.meta.url).pathname, '--check'], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr || res.stdout);
});

test('v3 geometry vs specs: footprints, parcels, doors, sign anchors', () => {
  for (const node of layout.nodes) {
    const spec = specs.get(node.code);
    const g = node.geometry;
    assert.ok(g, `${node.code}: no geometry`);
    assert.equal(g.source, 'portal.footprint-specs/v1');
    const c = gridToWorld(node.x, node.y);
    if (!spec.door) {
      // The Plaza (the only authored node with no door): paving over
      // its whole cell + the centrepiece anchor.
      assert.equal(node.code, HUB);
      assert.deepEqual([g.pavingRect.w, g.pavingRect.d], [spec.footprint.widthUnits, spec.footprint.depthUnits]);
      assert.deepEqual([g.pavingRect.cx, g.pavingRect.cz], [c.x, c.z]);
      assert.deepEqual([g.centrepieceAnchor.x, g.centrepieceAnchor.z], [c.x, c.z]);
      assert.equal(g.door, null);
      continue;
    }
    // Footprint dims come from the spec, verbatim.
    assert.deepEqual([g.footprintRect.w, g.footprintRect.d], [spec.footprint.widthUnits, spec.footprint.depthUnits], `${node.code}: footprint dims`);
    if (spec.parcel) {
      assert.deepEqual([g.parcelRect.w, g.parcelRect.d], [spec.parcel.widthUnits, spec.parcel.depthUnits], `${node.code}: parcel dims`);
      assert.deepEqual([g.parcelRect.cx, g.parcelRect.cz], [c.x, c.z], `${node.code}: parcel centred on the node`);
    }
    // The façade plane sits on the composed line: 1 unit inside the
    // cell edge on the door side (4 units from the node centre), with
    // Market Hall's apron filling from its wall out to that line.
    const face = spec.door.face;
    const n = FACE_NORMAL[face];
    const r = g.footprintRect;
    const wallPlane = n.z !== 0 ? r.cz + n.z * (r.d / 2) : r.cx + n.x * (r.w / 2);
    const wallDist = n.z !== 0 ? (wallPlane - c.z) * n.z : (wallPlane - c.x) * n.x;
    const apronDepth = spec.frontageApron ? spec.frontageApron.depthUnits : 0;
    assert.ok(near(wallDist, 4 - apronDepth), `${node.code}: wall plane at ${wallDist}, expected ${4 - apronDepth}`);
    if (spec.frontageApron) {
      const a = g.apronRect;
      const outer = n.z !== 0 ? a.cz + n.z * (a.d / 2) : a.cx + n.x * (a.w / 2);
      const outerDist = n.z !== 0 ? (outer - c.z) * n.z : (outer - c.x) * n.x;
      assert.ok(near(outerDist, 4), `${node.code}: apron reaches the façade line`);
      assert.deepEqual([a.w, a.d], [spec.frontageApron.widthUnits, spec.frontageApron.depthUnits]);
    }
    // Door: the spec's face; the anchor lies ON the façade plane;
    // width/height are the spec's (2 × 2.2, sign anchor 2.6).
    assert.equal(g.door.face, face, `${node.code}: door face`);
    assert.equal(g.door.widthUnits, spec.door.widthUnits);
    assert.equal(g.door.heightUnits, spec.door.heightUnits);
    const doorPlane = n.z !== 0 ? g.door.anchor.z : g.door.anchor.x;
    assert.ok(near(doorPlane, wallPlane), `${node.code}: door anchor off its façade plane`);
    // Sign anchor: centred on the same face (same along-face position
    // as the building centre), on the façade plane, 2.6 up.
    assert.equal(g.signAnchor.y, spec.door.anchorSignHeightUnits, `${node.code}: sign anchor height`);
    assert.equal(g.signAnchor.y, 2.6);
    const signPlane = n.z !== 0 ? g.signAnchor.z : g.signAnchor.x;
    assert.ok(near(signPlane, wallPlane), `${node.code}: sign anchor off its façade plane`);
    const signAlong = n.z !== 0 ? g.signAnchor.x : g.signAnchor.z;
    const centreAlong = n.z !== 0 ? r.cx : r.cz;
    assert.ok(near(signAlong, centreAlong), `${node.code}: sign not centred on its face`);
    // The door stays wholly on its face.
    const doorAlong = n.z !== 0 ? g.door.anchor.x : g.door.anchor.z;
    const faceW = n.z !== 0 ? r.w : r.d;
    assert.ok(Math.abs(doorAlong - centreAlong) + spec.door.widthUnits / 2 <= faceW / 2 + 1e-9, `${node.code}: door overhangs its face`);
  }
});

test('v3 corner entries: exactly the two module-admitted diagonal halls shift; every other door is centred', () => {
  const shifted = Object.fromEntries(
    layout.nodes.filter((n) => n.geometry?.door && n.geometry.door.offsetUnits !== 0).map((n) => [n.code, n.geometry.door.offsetUnits]),
  );
  assert.deepEqual(shifted, { MARKET_HALL: 2, EMBER_COLLEGE: -2 });
  for (const node of layout.nodes) {
    const d = node.geometry?.door;
    if (!d) continue;
    assert.equal(d.cornerEntry, d.offsetUnits !== 0, `${node.code}: cornerEntry flag`);
    assert.ok(d.offsetUnits % 2 === 0, `${node.code}: door shift is a whole number of 2-unit modules`);
  }
});

// ------------------------------------------------------------- M4.13
test('streets: every edge carries a baked path equal to the shared computation', () => {
  for (const e of layout.edges) {
    assert.ok(e.street, `edge ${e.a}-${e.b}: no street`);
    assert.equal(e.street.widthUnits, STREET_WIDTH_UNITS);
    assert.ok(e.street.path.length >= 2, `edge ${e.a}-${e.b}: path too short`);
    const a = byCode.get(e.a);
    const b = byCode.get(e.b);
    const obstacles = layout.nodes.map((n) => n.geometry.footprintRect).filter(Boolean);
    const recomputed = streetPathFor(endForNode(a, b), endForNode(b, a), obstacles).map((p) => [Math.round(p.x * 100) / 100, Math.round(p.z * 100) / 100]);
    assert.deepEqual(e.street.path, recomputed, `edge ${e.a}-${e.b}: baked path differs from streets.mjs`);
  }
});

test('streets: paths run door to door (or gate / paving edge)', () => {
  for (const e of layout.edges) {
    const a = byCode.get(e.a);
    const b = byCode.get(e.b);
    const [first, ...rest] = e.street.path;
    const last = rest[rest.length - 1];
    const endA = endForNode(a, b).point;
    const endB = endForNode(b, a).point;
    assert.ok(ptNear({ x: first[0], z: first[1] }, endA), `edge ${e.a}-${e.b}: path does not start at ${e.a}'s door/gate/paving point`);
    assert.ok(ptNear({ x: last[0], z: last[1] }, endB), `edge ${e.a}-${e.b}: path does not end at ${e.b}'s door/gate/paving point`);
    // The non-Plaza end is a real door anchor wherever the node has one.
    for (const [node, end] of [[a, endA], [b, endB]]) {
      if (node.geometry?.door) assert.ok(ptNear(end, node.geometry.door.anchor), `${node.code}: path end is not its door anchor`);
    }
  }
});

test('streets: no path segment crosses any building footprint', () => {
  const rects = layout.nodes.filter((n) => n.geometry?.footprintRect).map((n) => [n.code, n.geometry.footprintRect]);
  for (const e of layout.edges) {
    const pts = e.street.path.map(([x, z]) => ({ x, z }));
    for (let i = 0; i + 1 < pts.length; i++) {
      for (const [code, rect] of rects) {
        assert.ok(
          !segmentIntersectsRect(pts[i], pts[i + 1], rect, -0.001),
          `edge ${e.a}-${e.b} segment ${i} crosses ${code}'s footprint`,
        );
      }
    }
  }
});

test('streets: every routed door pair is connected — A* legs all carry street paths', () => {
  const doorCodes = layout.nodes.filter((n) => n.geometry?.door).map((n) => n.code);
  const streetEdges = new Set(layout.edges.map((e) => [e.a, e.b].sort().join('|')));
  for (const a of doorCodes) {
    for (const b of doorCodes) {
      if (a === b) continue;
      const route = findRoute(layout, a, b);
      assert.ok(route, `no route ${a} -> ${b}`);
      for (const leg of route.legs) {
        assert.ok(streetEdges.has([leg.a, leg.b].sort().join('|')), `route ${a} -> ${b} leg ${leg.a}-${leg.b} has no street path`);
      }
    }
  }
});

test('streets: the staged-fill plot gets its path at runtime from fillGeometry (PLOT_30)', () => {
  const bundle = { ember: { plots: [{ code: 'EMBER_DISTRICT_1_PLOT_30', district: 1, plot: 30, provenanceClass: 'feed-evidenced' }], works: [] }, citizens: [] };
  const eff = effectiveLayout(layout, bundle);
  const plot = eff.nodes.find((n) => n.code === 'EMBER_DISTRICT_1_PLOT_30');
  assert.ok(plot && plot.stagedPosition, 'PLOT_30 placed by fill');
  const hub = byCode.get(HUB);
  const g = fillNodeGeometry(plot, layout, hub);
  const spec = specs.get('EMBER_DISTRICT_1_PLOT_30');
  assert.deepEqual([g.parcelRect.w, g.parcelRect.d], [spec.parcel.widthUnits, spec.parcel.depthUnits], 'fill parcel matches the PLOT_30 spec');
  assert.equal(g.footprintRect, null, 'fill plot has no building');
  assert.equal(g.door, null, 'fill plot has no door');
  assert.equal(g.gate.face, spec.gateFace, 'fill gate faces the spec\u2019s gate side');
  const plotWithGeom = { ...plot, geometry: g };
  const obstacles = layout.nodes.map((n) => n.geometry.footprintRect).filter(Boolean);
  const path = streetPathFor(endForNode(plotWithGeom, hub), endForNode(hub, plotWithGeom), obstacles);
  assert.ok(path.length >= 2);
  assert.ok(ptNear(path[0], g.gate.anchor), 'fill path starts at the gate');
  // …and crosses no building on its way to the Plaza.
  const rects = layout.nodes.filter((n) => n.geometry?.footprintRect).map((n) => n.geometry.footprintRect);
  for (let i = 0; i + 1 < path.length; i++) {
    for (const rect of rects) assert.ok(!segmentIntersectsRect(path[i], path[i + 1], rect, -0.001), 'fill path crosses a building');
  }
});

test('ground honesty: the geometry names no unrecorded feature, and the disclosure is present', () => {
  const allowedNodeKeys = new Set(['source', 'footprintRect', 'parcelRect', 'apronRect', 'towerRect', 'pavingRect', 'centrepieceAnchor', 'door', 'signAnchor', 'gate']);
  for (const n of layout.nodes) {
    for (const k of Object.keys(n.geometry)) assert.ok(allowedNodeKeys.has(k), `${n.code}: unexpected geometry key ${k}`);
  }
  for (const e of layout.edges) assert.deepEqual(Object.keys(e.street).sort(), ['path', 'widthUnits']);
  // No place label names an unrecorded feature (the notes' prose
  // names rivers only to deny them — the denial is the disclosure).
  for (const n of layout.nodes) assert.ok(!/river|pond|lake|stream/i.test(n.label), `${n.code}: label invents a feature`);
  assert.match(layout.geometryNote, /staging/i);
  assert.match(layout.geometryNote, /never measured/i);
  assert.match(layout.note, /Portal presentation \(staging\)/);
});
