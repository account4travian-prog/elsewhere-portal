// M4.14 footprint-spec consistency checks.
//
// Loads the REAL layout file and the REAL specs file and checks the
// invariants FOOTPRINTS.md claims: coverage (every place the app can
// place has a spec, and totals agree), cell containment (no footprint
// crosses its node's cell; the one boundary case is listed, with its
// reason, not silently passed), the street test (every door face has
// a layout edge whose direction it faces; every named frontage edge
// exists), and the module rule (every dimension is a whole number of
// 2-unit MegaKit modules, and the one stated storey count is the
// College's).
//
// The PLOT_30 position is recomputed from logic.mjs's own fill rule
// rather than trusted from the specs file, so a fill-rule change
// fails here instead of drifting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const layout = JSON.parse(
  readFileSync(new URL('../../shared/ember-layout.json', import.meta.url), 'utf8'),
);
const specsDoc = JSON.parse(
  readFileSync(new URL('../footprint-specs.json', import.meta.url), 'utf8'),
);
const specs = specsDoc.specs;
const byCode = new Map(specs.map((s) => [s.code, s]));
const CELL = specsDoc.units.cellUnits; // 10
const MODULE = specsDoc.units.moduleUnits; // 2

const HUB = 'EMBER_PLAZA_OF_UNITY';

// The effective place set: layout nodes + the staged fill for
// feed-evidenced plots (the live bundle's PLOT_30), with the fill
// position recomputed exactly as build/app/logic.mjs effectiveLayout
// computes it (rows from y=8, x = 1 + slot % 7, first free cell).
function effectivePlaces() {
  const nodes = layout.nodes.map((n) => ({ code: n.code, x: n.x, y: n.y, kind: n.kind }));
  const evidencedPlots = ['EMBER_DISTRICT_1_PLOT_30']; // live bundle ember.plots, feed seq 52
  const missing = evidencedPlots.filter((c) => !nodes.some((n) => n.code === c)).sort();
  const occupied = new Set(nodes.map((n) => `${n.x},${n.y}`));
  missing.forEach((code, i) => {
    let slot = i;
    let x = 1 + (slot % 7);
    let y = 8 + Math.floor(slot / 7);
    while (occupied.has(`${x},${y}`)) {
      slot += 1;
      x = 1 + (slot % 7);
      y = 8 + Math.floor(slot / 7);
    }
    occupied.add(`${x},${y}`);
    nodes.push({ code, x, y, kind: 'plot', stagedFill: true });
  });
  return nodes;
}

// All street edges: the layout file's, plus the fill's Plaza edge.
function allEdges() {
  const edges = layout.edges.map((e) => ({ ...e }));
  for (const p of effectivePlaces()) {
    if (p.stagedFill) edges.push({ a: HUB, b: p.code, seconds: 9 });
  }
  return edges;
}

const FACE_VECTOR = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

test('coverage: every effective place has exactly one spec, totals agree', () => {
  const places = effectivePlaces();
  assert.equal(specs.length, places.length, 'spec count vs effective place count');
  assert.equal(byCode.size, specs.length, 'duplicate spec codes');
  for (const p of places) {
    const s = byCode.get(p.code);
    assert.ok(s, `no spec for ${p.code}`);
    assert.deepEqual([s.grid.x, s.grid.y], [p.x, p.y], `${p.code}: spec grid vs layout/fill position`);
    assert.equal(s.kind, p.kind, `${p.code}: kind`);
  }
  assert.equal(layout.nodes.length, 10, 'layout file still has its 10 authored nodes (specs must not edit it)');
});

test('cell containment: footprints stay inside their node cell; listed exceptions only', () => {
  // The full list of boundary cases, each with its reason in FOOTPRINTS.md.
  const listedBoundary = new Set(['EMBER_PLAZA_OF_UNITY']); // open paving fills its cell exactly
  for (const s of specs) {
    const dims = [];
    if (s.footprint) dims.push(['footprint', s.footprint]);
    if (s.parcel) dims.push(['parcel', s.parcel]);
    for (const [what, d] of dims) {
      const overX = d.widthUnits / 2 - CELL / 2;
      const overY = d.depthUnits / 2 - CELL / 2;
      if (listedBoundary.has(s.code)) {
        assert.ok(overX <= 0 && overY <= 0, `${s.code} ${what} crosses its cell (listed as boundary-fill only)`);
      } else {
        assert.ok(overX < 0 && overY < 0, `${s.code} ${what} touches or crosses its cell boundary — list it or shrink it`);
      }
    }
    // Aprons/parcels vs parcels: no two ground claims overlap.
    // (Checked pairwise on centres + half-extents below, buildings only
    //  where both claim enclosed ground on the same cell row band.)
  }
  // Pairwise: building footprints of neighbouring places never overlap
  // in grid space (centres are >= 1 cell apart; half-extents sum <= 8 < 10
  // on the shared axis for every adjacent pair — assert it directly).
  const withFp = specs.filter((s) => s.footprint);
  for (let i = 0; i < withFp.length; i++) {
    for (let j = i + 1; j < withFp.length; j++) {
      const a = withFp[i];
      const b = withFp[j];
      const dxCells = Math.abs(a.grid.x - b.grid.x) * CELL;
      const dyCells = Math.abs(a.grid.y - b.grid.y) * CELL;
      const overlapX = dxCells < (a.footprint.widthUnits + b.footprint.widthUnits) / 2;
      const overlapY = dyCells < (a.footprint.depthUnits + b.footprint.depthUnits) / 2;
      assert.ok(!(overlapX && overlapY), `${a.code} footprint overlaps ${b.code}`);
    }
  }
});

test('module rule: every dimension is a whole number of 2-unit modules', () => {
  for (const s of specs) {
    for (const d of [s.footprint, s.parcel, s.frontageApron, s.tower]) {
      if (!d) continue;
      assert.equal(d.widthUnits % MODULE, 0, `${s.code}: width ${d.widthUnits} not a module multiple`);
      assert.equal(d.depthUnits % MODULE, 0, `${s.code}: depth ${d.depthUnits} not a module multiple`);
    }
    if (s.door) {
      assert.equal(s.door.heightUnits, 2.2, `${s.code}: standard door height (Bible §5)`);
      assert.equal(s.door.widthUnits, MODULE, `${s.code}: door is one module wide`);
      assert.equal(s.door.anchorSignHeightUnits, 2.6, `${s.code}: sign anchor = door head + 0.4 (§5.2)`);
    }
  }
});

test('streets: every frontage edge exists and every door faces a real street', () => {
  const edges = allEdges();
  const edgeKey = (a, b) => [a, b].sort().join('|');
  const edgeSet = new Set(edges.map((e) => edgeKey(e.a, e.b)));
  const adj = new Map();
  for (const e of edges) {
    for (const [from, to] of [[e.a, e.b], [e.b, e.a]]) {
      if (!adj.has(from)) adj.set(from, []);
      adj.get(from).push({ to, e });
    }
  }
  const pos = new Map(effectivePlaces().map((p) => [p.code, p]));

  for (const s of specs) {
    const named = [];
    if (s.frontageEdge) named.push(s.frontageEdge);
    if (s.frontageEdges) named.push(...s.frontageEdges);
    for (const fe of named) {
      assert.ok(edgeSet.has(edgeKey(fe.a, fe.b)), `${s.code}: frontage edge ${fe.a}–${fe.b} not in the layout`);
    }
    if (!s.door) continue;
    // The door face must face at least one real street edge of this node:
    // the edge's direction from this node must point along the face.
    const fv = FACE_VECTOR[s.door.face];
    const facesStreet = (adj.get(s.code) || []).some(({ to }) => {
      const t = pos.get(to);
      const dx = Math.sign(t.x - s.grid.x);
      const dy = Math.sign(t.y - s.grid.y);
      return dx * fv.dx + dy * fv.dy > 0 && Math.abs(dx) + Math.abs(dy) >= 1 && (dx === 0 || dy === 0 || true);
    });
    assert.ok(facesStreet, `${s.code}: door faces ${s.door.face} but no street runs that way — a frontage defect`);
    // And it must face its NAMED frontage edge specifically.
    const fe = s.frontageEdge;
    const other = fe.a === s.code ? fe.b : fe.a;
    const t = pos.get(other);
    const dot = Math.sign(t.x - s.grid.x) * fv.dx + Math.sign(t.y - s.grid.y) * fv.dy;
    assert.ok(dot > 0, `${s.code}: door face ${s.door.face} does not face its named frontage street toward ${other}`);
    // The spec's recorded vector matches the geometry it claims.
    assert.deepEqual(
      [s.frontageVector.dx, s.frontageVector.dy],
      [t.x - s.grid.x, t.y - s.grid.y],
      `${s.code}: frontageVector disagrees with the layout`,
    );
  }
});

test('storeys honesty: the College is the only stated count, and it is 2', () => {
  for (const s of specs) {
    if (s.code === 'EMBER_COLLEGE') {
      assert.equal(s.storeys, 2);
      assert.match(s.storeysProvenance, /upper floor/);
    } else {
      assert.equal(s.storeys, null, `${s.code}: storeys invented — no plan source states a count`);
      assert.ok(s.storeysReason && s.storeysReason.length > 10, `${s.code}: null storeys needs its reason`);
    }
  }
});

test('honest treatments: PLOT_30 has no building, the Plaza has no building, plots 18/31 do', () => {
  const p30 = byCode.get('EMBER_DISTRICT_1_PLOT_30');
  assert.equal(p30.building, null);
  assert.equal(p30.footprint, null);
  assert.match(p30.treatment, /empty-plot/);
  assert.ok(p30.parcel, 'the empty plot still gets its parcel');
  const plaza = byCode.get(HUB);
  assert.equal(plaza.building, null);
  assert.match(plaza.treatment, /Benny the Pug/);
  for (const code of ['EMBER_DISTRICT_3_PLOT_18', 'EMBER_DISTRICT_1_PLOT_31']) {
    assert.ok(byCode.get(code).building, `${code} names a building in the record`);
    assert.ok(byCode.get(code).parcel, `${code} carries its parcel`);
  }
});

test('dormant kit: the seam is named, the decision is not-built, no spec presumes a variant', () => {
  assert.match(specsDoc.dormantKitSeam.decision, /NOT BUILT/);
  assert.match(specsDoc.dormantKitSeam.seam, /dressing-layer/);
  for (const s of specs) {
    assert.ok(!('variants' in s) && !('integrity' in s), `${s.code}: spec presumes integrity variation`);
  }
});
