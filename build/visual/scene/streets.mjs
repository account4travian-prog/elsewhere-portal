// streets.mjs — Portal's composed street geometry (M4.11/M4.13).
//
// Pure geometry, no dependencies, browser + Node compatible. One
// implementation serves both writers of street paths:
//   - build/visual/layout-v3-build.mjs bakes each authored edge's path
//     into build/shared/ember-layout.json (layout v3), and
//   - scene.mjs computes paths at runtime for edges the effective
//     layout's staged fill adds (evidenced plots with no authored
//     node), whose geometry comes from the layout's fillGeometry
//     template.
// Baked and runtime paths agree by construction; layout-v3.test.mjs
// asserts it.
//
// World frame (the scene scaffold's, scene.mjs header): x east,
// z south (grid +y runs south), 1 layout grid cell = 10 world units,
// the Plaza's grid position (4,4) at the origin. All rects are
// axis-aligned in this frame: {cx, cz, w, d} = centre + x/z extents.
//
// A street path connects the two ends of an edge door-to-door (or
// door-to-paving / gate-to-paving at the Plaza and the empty plots):
// it leaves a door along its face normal to a kerb point, rounds the
// building's own corner when the straight line to the street would
// cross the building, joins the street centreline where the
// centreline exits the node's cell, runs along the centreline, and
// mirrors into the far end. Paths never cross a building footprint:
// layout-v3.test.mjs asserts that over every edge, against every
// building rect in the layout.

export const CELL_UNITS = 10;
export const GRID_ORIGIN = { x: 4, y: 4 }; // the Plaza's grid position sits at the world origin

// Street width: the scene scaffold's as-built strip width (3.4 units,
// RIG-AS-BUILT), adopted by layout v3 as a staging constant. No design
// token names a street width (checked build/visual/tokens, 2026-11-03);
// if one ever does, it lands here and in the layout note together.
export const STREET_WIDTH_UNITS = 3.4;

// ------------------------------------------------- T2 kerbs + wear
// Look touch-up T2 (lane-look-touchup-scope.md §T2, DECISIONS.md
// 2026-11-03: "roads: kerbs + wear texture core"). The street
// RENDERING pieces for one layout path are computed here, purely
// from the path data — scene.mjs's strip loop consumes these
// descriptors and nothing else decides kerb/wear placement. That is
// the path-driven property the spatial pass relies on: when a path
// changes (or a new segment appears), kerbs and the wear role
// follow with no code change, because no placement is hand-authored
// anywhere. Street GEOMETRY is not decided here — this module only
// dresses the paths it is given, exactly as given.
//
// Kerbs (T2a): two thin strips per segment, flush with the street's
// own edges (a kerb centre sits KERB_WIDTH_UNITS/2 inside the edge,
// so its outer face is the street's outer edge — no spill onto the
// ground or parcels beside the street). A kerb piece reuses the
// street strip's own conventions verbatim, so the joints behave the
// same way the strips' joints already do:
//   - plane length = segment length + STREET_WIDTH_UNITS * 0.5
//     (the strips' half-width overlap at each joint), and
//   - the per-edge y-stagger below (the strips' anti-z-fight step).
// Kerbs sit one KERB_Y_LIFT above their own street strip: larger
// than the whole stagger range (4 steps × STREET_Y_STAGGER = 0.0016),
// so a kerb never sinks below a neighbouring edge's street strip
// where two edges meet, and never z-fights the strip it lies on.
export const KERB_WIDTH_UNITS = 0.3;
export const KERB_CENTRE_OFFSET_UNITS = STREET_WIDTH_UNITS / 2 - KERB_WIDTH_UNITS / 2;
export const KERB_Y_LIFT = 0.002;
export const STREET_Y_BASE = 0.012;
export const STREET_Y_STAGGER = 0.0004;
export const STREET_Y_STAGGER_STEPS = 5;

/** The street strip height for one edge: the scene's as-built
 *  stagger (0.012 + (edgeIndex % 5) * 0.0004), named here so the
 *  kerbs inherit exactly the same step, never a copy of it. */
export function streetYForEdge(edgeIndex) {
  return STREET_Y_BASE + (edgeIndex % STREET_Y_STAGGER_STEPS) * STREET_Y_STAGGER;
}

/**
 * streetSegmentPieces(pa, pb, streetY) -> segment descriptor | null
 * The rendering pieces for one straight run pa -> pb of a street
 * path: one street strip (carrying the `street-wear` material role —
 * scene.mjs assigns materials.mjs's derived wear texture to every
 * piece with that role) and its two kerbs. Returns null for a
 * degenerate run (< 0.01 units — the strips' own skip rule).
 * `dir` is the unit vector along the run, `perp` the unit vector
 * across it; the strip's PlaneGeometry runs its U axis along the
 * plane's length (dir, once rotated) and its V axis across the
 * width (perp), so a texture that varies only in V follows the
 * path by construction, bends included (each run is textured
 * independently, in its own frame).
 */
export function streetSegmentPieces(pa, pb, streetY) {
  const dx = pb.x - pa.x;
  const dz = pb.z - pa.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) return null;
  const dir = { x: dx / len, z: dz / len };
  const perp = { x: -dir.z, z: dir.x };
  const rotationZ = -Math.atan2(dz, dx);
  const centre = { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 };
  const planeLength = len + STREET_WIDTH_UNITS * 0.5; // the strips' joint overlap rule
  const street = {
    kind: 'street', materialRole: 'street-wear',
    centre, planeLength, width: STREET_WIDTH_UNITS,
    y: streetY, rotationZ, dir, perp, length: len,
  };
  const kerbs = [-1, 1].map((side) => ({
    kind: 'kerb', side, materialRole: 'kerb-trim',
    centre: {
      x: centre.x + perp.x * side * KERB_CENTRE_OFFSET_UNITS,
      z: centre.z + perp.z * side * KERB_CENTRE_OFFSET_UNITS,
    },
    planeLength, width: KERB_WIDTH_UNITS,
    y: streetY + KERB_Y_LIFT, rotationZ, dir, perp, length: len,
    offset: side * KERB_CENTRE_OFFSET_UNITS,
  }));
  return { street, kerbs, length: len, dir, perp, rotationZ, centre };
}

/**
 * streetPiecesForPath(path, edgeIndex) -> { y, streets, kerbs, segments }
 * Every rendering piece for one edge's whole path ([{x, z}, ...]),
 * at that edge's staggered height. This is the single entry point
 * scene.mjs's street loop calls per edge — authored (baked) paths
 * and staged-fill (runtime-computed) paths alike — so any path the
 * layout carries, present or future, gains kerbs + wear here.
 */
export function streetPiecesForPath(path, edgeIndex) {
  const y = streetYForEdge(edgeIndex);
  const segments = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const seg = streetSegmentPieces(path[i], path[i + 1], y);
    if (seg) segments.push(seg);
  }
  return {
    y, edgeIndex,
    segments,
    streets: segments.map((s) => s.street),
    kerbs: segments.flatMap((s) => s.kerbs),
  };
}

const KERB_REACH = 1.2; // door -> kerb distance along the face normal
const RECT_PAD = 0.5; // corner-routing clearance around a building's own rect

export const gridToWorld = (gx, gy) => ({
  x: (gx - GRID_ORIGIN.x) * CELL_UNITS,
  z: (gy - GRID_ORIGIN.y) * CELL_UNITS,
});

export const FACE_NORMAL = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
};

// The extent of a footprint rect along a face's normal / along the face.
export const normalExtent = (rect, face) => (face === 'north' || face === 'south' ? rect.d : rect.w);
export const faceWidth = (rect, face) => (face === 'north' || face === 'south' ? rect.w : rect.d);

// ------------------------------------------------------------ rect maths
export function rectCorners(rect, pad = 0) {
  const hw = rect.w / 2 + pad;
  const hd = rect.d / 2 + pad;
  return [
    { x: rect.cx - hw, z: rect.cz - hd },
    { x: rect.cx + hw, z: rect.cz - hd },
    { x: rect.cx + hw, z: rect.cz + hd },
    { x: rect.cx - hw, z: rect.cz + hd },
  ];
}

// Segment vs axis-aligned rect (slab test). A segment registers only
// when it spends positive length inside the rect: touching a boundary
// point or running along a face is not a crossing. A negative pad
// shrinks the rect (an interior-only test).
export function segmentIntersectsRect(p, q, rect, pad = 0) {
  const minX = rect.cx - rect.w / 2 - pad;
  const maxX = rect.cx + rect.w / 2 + pad;
  const minZ = rect.cz - rect.d / 2 - pad;
  const maxZ = rect.cz + rect.d / 2 + pad;
  const eps = 0;
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  if (Math.abs(dx) < 1e-12) {
    if (p.x < minX + eps || p.x > maxX - eps) return false;
  } else {
    let ta = (minX - p.x) / dx;
    let tb = (maxX - p.x) / dx;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-12) {
    if (p.z < minZ + eps || p.z > maxZ - eps) return false;
  } else {
    let ta = (minZ - p.z) / dz;
    let tb = (maxZ - p.z) / dz;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  // The overlap must have positive length inside the rect (a segment
  // that only kisses a corner point is not a crossing).
  return t1 - t0 > 1e-9;
}

// Where the ray from `centre` toward `toward` exits the axis-aligned
// rect centred on `centre` with half-extents (halfW, halfD).
export function rectExitPoint(centre, toward, halfW, halfD) {
  const dx = toward.x - centre.x;
  const dz = toward.z - centre.z;
  let t = Infinity;
  if (Math.abs(dx) > 1e-12) t = Math.min(t, halfW / Math.abs(dx));
  if (Math.abs(dz) > 1e-12) t = Math.min(t, halfD / Math.abs(dz));
  if (!Number.isFinite(t)) return { ...centre };
  return { x: centre.x + dx * t, z: centre.z + dz * t };
}

const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

function dedupe(points, eps = 0.01) {
  const out = [];
  for (const p of points) {
    if (!out.length || dist(out[out.length - 1], p) > eps) out.push(p);
  }
  return out;
}

// ------------------------------------------------------- one path end
// An "end" describes one side of an edge:
//   kind 'door'  : a building door — { point (door anchor), face,
//                  rect (own footprint rect), centre (node centre) }
//   kind 'gate'  : an empty plot's gate — { point, centre }; the plot
//                  has no building, so the path runs straight from the
//                  gate to the cell exit over the plot's own ground.
//   kind 'plaza' : the open place — { point (paving-edge point on the
//                  centreline), centre }; streets end at the paving.
// Returns the waypoints from the end's own point out to the point
// where the street centreline exits this end's cell.
function endWaypoints(end, otherCentre) {
  const centre = end.centre;
  const exit = rectExitPoint(centre, otherCentre, CELL_UNITS / 2, CELL_UNITS / 2);
  if (end.kind === 'plaza') return [end.point];
  if (end.kind === 'gate') return dedupe([end.point, exit]);
  // door
  const n = FACE_NORMAL[end.face];
  const kerb = { x: end.point.x + n.x * KERB_REACH, z: end.point.z + n.z * KERB_REACH };
  // A façade sits 1 unit inside its cell edge, so for a door whose
  // street leaves through the near cell edge the exit can be closer
  // than the kerb — the path then runs door -> exit directly rather
  // than doubling back past the kerb.
  const start = dist(end.point, exit) < KERB_REACH ? end.point : kerb;
  const pts = start === kerb ? [end.point, kerb] : [end.point];
  // Interior-only trigger (the rect shrunk by a hair): the door sits
  // ON the boundary and a path out along the face must not read as a
  // crossing, while a path that genuinely enters the building must.
  if (segmentIntersectsRect(start, exit, end.rect, -0.001)) {
    // Round the building: the nearer of the two street-side corners
    // of the padded rect (the corners on the door face's side), by
    // total path length; ties break by corner x, then z.
    const corners = rectCorners(end.rect, RECT_PAD).filter((c) =>
      end.face === 'north' || end.face === 'south'
        ? Math.sign(c.z - end.rect.cz) === n.z
        : Math.sign(c.x - end.rect.cx) === n.x,
    );
    let best = null;
    for (const c of corners) {
      const len = dist(start, c) + dist(c, exit);
      if (
        !best ||
        len < best.len - 1e-9 ||
        (Math.abs(len - best.len) <= 1e-9 && (c.x < best.c.x || (c.x === best.c.x && c.z < best.c.z)))
      ) {
        best = { c, len };
      }
    }
    if (best) pts.push(best.c);
  }
  pts.push(exit);
  return dedupe(pts);
}

// Bend a composed path around any building it would cross. The
// centreline between two node centres can graze a third place's
// building (the staged-fill Plaza edge passes the Library Annex's
// corner) — a street bends around the corner instead. Deterministic:
// the first crossing segment (in path order) takes the clear corner
// (padded rect) of least added length, ties by corner x then z; the
// scan restarts and is bounded, so a pathological case returns the
// best path found rather than looping (the layout test fails loudly
// on any crossing that remains).
function bendAroundObstacles(points, obstacles) {
  let pts = points;
  for (let iter = 0; iter < 8; iter++) {
    let bent = false;
    outer: for (let i = 0; i + 1 < pts.length; i++) {
      for (const rect of obstacles) {
        if (!segmentIntersectsRect(pts[i], pts[i + 1], rect, -0.001)) continue;
        let best = null;
        for (const c of rectCorners(rect, RECT_PAD)) {
          if (segmentIntersectsRect(pts[i], c, rect, -0.001)) continue;
          if (segmentIntersectsRect(c, pts[i + 1], rect, -0.001)) continue;
          const len = dist(pts[i], c) + dist(c, pts[i + 1]);
          if (
            !best ||
            len < best.len - 1e-9 ||
            (Math.abs(len - best.len) <= 1e-9 && (c.x < best.c.x || (c.x === best.c.x && c.z < best.c.z)))
          ) {
            best = { c, len };
          }
        }
        if (best) {
          pts = [...pts.slice(0, i + 1), best.c, ...pts.slice(i + 1)];
          bent = true;
          break outer;
        }
      }
    }
    if (!bent) return pts;
  }
  return pts;
}

/**
 * streetPathFor(endA, endB, obstacles = []) -> [{x, z}, ...]
 * The full door-to-door (or gate/paving) street path for one edge.
 * `obstacles` is every building footprint rect the path must not
 * cross (the ends' own buildings included — their door segments only
 * ever touch their own boundary, which the interior test ignores).
 * Deterministic: same inputs => same path.
 */
export function streetPathFor(endA, endB, obstacles = []) {
  const aPts = endWaypoints(endA, endB.centre);
  const bPts = endWaypoints(endB, endA.centre).reverse();
  return bendAroundObstacles(dedupe([...aPts, ...bPts]), obstacles);
}

/**
 * The end descriptor for one side of an edge, from a layout node's
 * composed geometry (layout v3). `pavingRect` is the Plaza's.
 */
export function endForNode(node, otherNode) {
  const centre = gridToWorld(node.x, node.y);
  const g = node.geometry || {};
  if (node.code === 'EMBER_PLAZA_OF_UNITY') {
    const other = gridToWorld(otherNode.x, otherNode.y);
    const paving = g.pavingRect;
    const point = paving
      ? rectExitPoint(centre, other, paving.w / 2, paving.d / 2)
      : centre;
    return { kind: 'plaza', point, centre };
  }
  if (g.door) {
    return { kind: 'door', point: { ...g.door.anchor }, face: g.door.face, rect: g.footprintRect, centre };
  }
  if (g.gate) {
    return { kind: 'gate', point: { ...g.gate.anchor }, centre };
  }
  // No composed geometry (authored node without a door — the Plaza
  // apart, every authored node has one; a staged-fill node carries the
  // fillGeometry gate). Fall back to the node's own centre: the path
  // still runs, and the layout test fails loudly on the missing door.
  return { kind: 'gate', point: centre, centre };
}

/**
 * fillNodeGeometry(node, layout, hubNode) -> geometry object
 * The composed geometry for a staged-fill node (an evidenced plot
 * with no authored node), synthesised from the layout's fillGeometry
 * template: an 8×8 parcel centred on the node and a gate on the
 * parcel side facing the Plaza hub (dominant axis of the hub vector,
 * ties south-first — the specs' door-face tie-break). The gate is the
 * plot's street point and its plot sign stands there (signAnchor at
 * ground level: no door head exists to derive the 2.6 sign height
 * from, and none is claimed). No building, no door — the honest
 * empty-plot treatment the PLOT_30 spec names, generalised.
 */
export function fillNodeGeometry(node, layout, hubNode) {
  const tpl = layout.fillGeometry;
  if (!tpl) return null;
  const c = gridToWorld(node.x, node.y);
  const hub = gridToWorld(hubNode.x, hubNode.y);
  const dx = hub.x - c.x;
  const dz = hub.z - c.z;
  let face;
  if (Math.abs(dz) >= Math.abs(dx)) face = dz < 0 ? 'north' : 'south';
  else face = dx > 0 ? 'east' : 'west';
  const n = FACE_NORMAL[face];
  const parcelRect = { cx: c.x, cz: c.z, w: tpl.parcelRect.w, d: tpl.parcelRect.d };
  const gateAnchor = {
    x: c.x + n.x * (normalExtent(parcelRect, face) / 2),
    z: c.z + n.z * (normalExtent(parcelRect, face) / 2),
  };
  return {
    source: 'layout fillGeometry template',
    footprintRect: null,
    parcelRect,
    door: null,
    gate: { face, anchor: gateAnchor },
    signAnchor: { x: gateAnchor.x, y: 0, z: gateAnchor.z },
  };
}
