// layout-v3-build.mjs — the layout v3 generator (M4.11).
//
// Composes the shared layout's geometry from the footprint specs
// (build/visual/footprint-specs.json, portal.footprint-specs/v1 —
// M4.14's first deliverable) and writes build/shared/ember-layout.json
// at version 3. Deterministic and idempotent: it preserves every v1
// field verbatim (codes, labels, kinds, provenance classes, grid
// positions, the edge list, street seconds) and recomputes only the
// `geometry` fields, the per-edge `street` paths, `fillGeometry`, and
// the version/note. Re-running it on its own output changes nothing.
//
//   node build/visual/layout-v3-build.mjs           (writes the layout)
//   node build/visual/layout-v3-build.mjs --check   (differs => exit 1)
//
// Composition rules (each is stated where its number is used; the
// human record is plan-to-complete/lane-geometry.md):
//   - Node grid positions do NOT move. FOOTPRINTS.md's checks found
//     street clearance clean at v1 spacing (minimum centre separation
//     √2 cells against a summed half-diagonal of ≈7.8 units), and the
//     specs' door faces / frontage vectors are derived from those
//     positions. What v3 composes is where each building stands
//     WITHIN its cell, where its door and sign sit, and how the
//     streets run door-to-door — the geometry the v1 file never had.
//   - A building's façade sits 1 unit inside its cell edge on the
//     door side (the parcel rule's street margin, FOOTPRINTS.md rule
//     2): centre offset toward the door face = 4 − (extent along the
//     face normal)/2, with Market Hall's stall apron counted in its
//     extent so the apron reaches exactly that margin line.
//   - Homes are set back by the same rule read the other way: a
//     cottage's façade is the face NEAREST its street, and the rule
//     still leaves the full margin — no home fronts directly on the
//     street line.
//   - Doors: threshold centre of the spec's door face (spec §5.2
//     anchor_door). Corner entries (FOOTPRINTS.md finding D-2's
//     composition decision): on a diagonal frontage, the door shifts
//     along its face toward the street's approach by whole 2-unit
//     modules, only where the shift keeps the whole 2-unit door on
//     the face (|shift| ≤ faceWidth/2 − 1, rounded down to a module).
//     In this town that admits Market Hall (+2) and The College (−2);
//     every other door stays centred, and each node's record says so.
//   - Signs: anchor_sign per spec §5.2 — centred on the door face,
//     on the façade plane, 2.6 units up (0.4 above the 2.2 door head).
//   - Streets: door-to-door paths from scene/streets.mjs (one
//     implementation; the scene computes fill-edge paths with the
//     same code at runtime), width = streets.mjs's staging constant.
//   - The Plaza: paving over its full cell (spec B1), centrepiece
//     anchor at its centre. Plots 18/31: parcel 8×8 centred, building
//     inside it by the same façade rule. Plot 30 (staged fill, not an
//     authored node): the fillGeometry template — an 8×8 parcel and a
//     gate on the side facing the Plaza hub, matching its spec's
//     honest empty-plot treatment.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  CELL_UNITS,
  STREET_WIDTH_UNITS,
  FACE_NORMAL,
  gridToWorld,
  normalExtent,
  faceWidth,
  streetPathFor,
  endForNode,
} from './scene/streets.mjs';

const HERE = new URL('.', import.meta.url);
const LAYOUT_PATH = new URL('../shared/ember-layout.json', HERE);
const SPECS_PATH = new URL('./footprint-specs.json', HERE);

const layout = JSON.parse(readFileSync(LAYOUT_PATH, 'utf8'));
const specsDoc = JSON.parse(readFileSync(SPECS_PATH, 'utf8'));
const specs = new Map(specsDoc.specs.map((s) => [s.code, s]));

const MODULE = specsDoc.units.moduleUnits; // 2
const STREET_MARGIN = 1; // parcel rule: cell edge minus margin = façade line distance from cell edge
const FACADE_LINE = CELL_UNITS / 2 - STREET_MARGIN; // 4 units from the node centre

function composeNode(node) {
  const spec = specs.get(node.code);
  if (!spec) throw new Error(`no footprint spec for ${node.code}`);
  const c = gridToWorld(node.x, node.y);
  const g = { source: 'portal.footprint-specs/v1' };

  if (spec.code === 'EMBER_PLAZA_OF_UNITY') {
    g.pavingRect = { cx: c.x, cz: c.z, w: spec.footprint.widthUnits, d: spec.footprint.depthUnits };
    g.centrepieceAnchor = { x: c.x, z: c.z };
    g.footprintRect = null;
    g.parcelRect = null;
    g.door = null;
    g.signAnchor = null;
    return g;
  }

  if (spec.parcel) g.parcelRect = { cx: c.x, cz: c.z, w: spec.parcel.widthUnits, d: spec.parcel.depthUnits };

  if (!spec.footprint) {
    // An authored node with a parcel but no building (none today —
    // PLOT_30 is staged fill, handled by fillGeometry). Kept explicit
    // so a future evidenced-empty authored plot composes honestly.
    g.footprintRect = null;
    g.door = null;
    g.signAnchor = null;
    g.gate = { face: spec.gateFace || null, anchor: null };
    return g;
  }

  const rect = { cx: c.x, cz: c.z, w: spec.footprint.widthUnits, d: spec.footprint.depthUnits };
  const face = spec.door.face;
  const n = FACE_NORMAL[face];
  const extent = normalExtent(rect, face);
  const apronDepth = spec.frontageApron ? spec.frontageApron.depthUnits : 0;
  // The wall plane sits at wallLine from the node centre along the
  // door-face normal: the façade line (1 unit inside the cell edge)
  // minus the apron, where a building has one — the apron fills from
  // the wall out to the façade line.
  const wallLine = FACADE_LINE - apronDepth;
  const centreOffset = wallLine - extent / 2;
  rect.cx = c.x + n.x * centreOffset;
  rect.cz = c.z + n.z * centreOffset;
  g.footprintRect = rect;

  if (spec.frontageApron) {
    const a = spec.frontageApron;
    const facadePlane = n.z !== 0 ? rect.cz + n.z * (rect.d / 2) : rect.cx + n.x * (rect.w / 2);
    g.apronRect = n.z !== 0
      ? { cx: rect.cx, cz: facadePlane + n.z * (a.depthUnits / 2), w: a.widthUnits, d: a.depthUnits }
      : { cx: facadePlane + n.x * (a.depthUnits / 2), cz: rect.cz, w: a.depthUnits, d: a.widthUnits };
  }

  if (spec.tower) {
    // On the body's frontage face line, offset to one end of the face
    // (spec: the end is unnamed; this build takes the west end for the
    // Town Hall — the end away from the College street's approach).
    const t = spec.tower;
    const along = faceWidth(rect, face) / 2 - t.widthUnits / 2;
    g.towerRect = n.z !== 0
      ? { cx: rect.cx - along, cz: rect.cz + n.z * (rect.d / 2) - n.z * (t.depthUnits / 2), w: t.widthUnits, d: t.depthUnits }
      : { cx: rect.cx + n.x * (rect.w / 2) - n.x * (t.widthUnits / 2), cz: rect.cz - along, w: t.widthUnits, d: t.depthUnits };
  }

  // Door: threshold centre of the face, with the corner-entry shift.
  const fw = faceWidth(rect, face);
  const maxShift = Math.floor((fw / 2 - spec.door.widthUnits / 2) / MODULE) * MODULE;
  let shift = 0;
  let cornerEntry = false;
  if (spec.frontageVector) {
    // The street's approach along the face: for N/S faces the x
    // component of the vector toward the frontage neighbour; for E/W
    // faces the y (z) component.
    const alongComponent = n.z !== 0 ? spec.frontageVector.dx : spec.frontageVector.dy;
    const diagonal = spec.frontageVector.dx !== 0 && spec.frontageVector.dy !== 0;
    if (diagonal && alongComponent !== 0 && maxShift > 0) {
      shift = Math.sign(alongComponent) * maxShift;
      cornerEntry = shift !== 0;
    }
  }
  const doorAnchor = n.z !== 0
    ? { x: rect.cx + shift, z: rect.cz + n.z * (rect.d / 2) }
    : { x: rect.cx + n.x * (rect.w / 2), z: rect.cz + shift };
  g.door = {
    face,
    anchor: doorAnchor,
    offsetUnits: shift,
    cornerEntry,
    widthUnits: spec.door.widthUnits,
    heightUnits: spec.door.heightUnits,
  };
  g.signAnchor = {
    x: n.z !== 0 ? rect.cx : rect.cx + n.x * (rect.w / 2),
    y: spec.door.anchorSignHeightUnits,
    z: n.x !== 0 ? rect.cz : rect.cz + n.z * (rect.d / 2),
  };
  return g;
}

// ------------------------------------------------------------ compose
const out = JSON.parse(JSON.stringify(layout));
out.version = 3;
const nodeByCode = new Map(out.nodes.map((n) => [n.code, n]));
for (const node of out.nodes) node.geometry = composeNode(node);
const obstacles = out.nodes.map((n) => n.geometry.footprintRect).filter(Boolean);
for (const edge of out.edges) {
  const a = nodeByCode.get(edge.a);
  const b = nodeByCode.get(edge.b);
  const path = streetPathFor(endForNode(a, b), endForNode(b, a), obstacles);
  edge.street = { widthUnits: STREET_WIDTH_UNITS, path: path.map((p) => [round2(p.x), round2(p.z)]) };
}
out.fillGeometry = {
  source: 'portal.footprint-specs/v1 (EMBER_DISTRICT_1_PLOT_30 spec, generalised to any staged-fill plot)',
  parcelRect: { w: 8, d: 8 },
  gate: 'toward-hub',
  treatment: 'honest empty plot — fenced parcel, plain-word plot sign, no building until a record names one',
};
out.geometryNote =
  'Layout v3 composed geometry (M4.11): every node carries a `geometry` object derived from ' +
  'build/visual/footprint-specs.json by build/visual/layout-v3-build.mjs (deterministic; re-running ' +
  'it changes nothing). Rects and anchors are in the build\u2019s world units (1 grid cell = 10 units, ' +
  'Plaza at the origin, +x east, +z south): footprintRect is where the building stands within its ' +
  'cell (fa\u00e7ade 1 unit inside the cell edge on its door side; Market Hall\u2019s stall apron reaches ' +
  'that line), door.anchor is the threshold centre of the spec\u2019s door face (corner entries on ' +
  'diagonal frontages shift the door by whole 2-unit modules where the module grid admits it \u2014 ' +
  'Market Hall +2, The College \u22122; all other doors centred), signAnchor is centred on the same ' +
  'face 2.6 units up. Each edge carries a `street` path: the door-to-door polyline the roads are ' +
  'drawn from (scene/streets.mjs; staged-fill edges get theirs from fillGeometry at runtime by the ' +
  'same code). Grid positions, codes, edges and street seconds are unchanged from v1 \u2014 v3 changes ' +
  'geometry only. All of it is Portal staging, like every position in this file: composed ' +
  'presentation over the record\u2019s place codes, never measured Elsewhere geography, and the ' +
  'dressing implies no unrecorded feature (no river, pond, or path the record does not name).';
out.note =
  'Staged street geometry over TRUE Elsewhere location codes. Grid positions and street seconds are Portal presentation (staging), never measured world data. ' +
  'codeStatus \'verified\' = the code is attested in ~/workspace/elsewhere/reference/openapi.json (Work enum / place codes) or the household\'s observed Elsewhere record (~/workspace/elsewhere/*.md); ' +
  '\'staging\' = label-style code invented by Portal because no true code is verified for that place. provenanceClass (M2.06): \'feed-evidenced\' = the code appears in Tier P feed data ' +
  '(voices places / map civic works); \'record-attested\' = attested only in the household\'s Elsewhere record (~/workspace/elsewhere/PERSONA.md, research/01-elsewhere.md), never in the feed \u2014 ' +
  'the two anchor plots (District 3 Plot 18, District 1 Plot 31) are this class and must not be presented as Tier P data; \'staging\' = Portal-invented, no verified code. ' +
  'A plot code evidenced in the feed but absent from this file (e.g. EMBER_DISTRICT_1_PLOT_30) gets a deterministic staging position in the app by sorted-code fill ' +
  '(build/app/logic.mjs effectiveLayout) \u2014 a placed building without a layout edit, its position staging like every position here. A plot with no evidence anywhere gets no node and no position, in this file or in the app. ' +
  'Version 3 adds the composed geometry described in geometryNote; versions 1\u20132 pinned the codes and their provenance classes (REC-9).';

function round2(v) {
  return Math.round(v * 100) / 100;
}

// Serialise exactly as the file is kept: keys alphabetical at every
// level the v1 file kept them so, 0-indent JSON (the file's style).
const sortKeys = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));
const ordered = {
  edges: out.edges.map((e) => sortKeys(e, ['a', 'b', 'seconds', 'street'])),
  fillGeometry: out.fillGeometry,
  geometryNote: out.geometryNote,
  nodes: out.nodes.map((n) =>
    sortKeys(n, ['code', 'codeStatus', 'geometry', 'kind', 'label', 'provenanceClass', 'x', 'y'])),
  note: out.note,
  version: out.version,
};
const text = JSON.stringify(ordered) + '\n';

if (process.argv.includes('--check')) {
  const current = readFileSync(LAYOUT_PATH, 'utf8');
  if (current !== text) {
    console.error('ember-layout.json differs from the generator output — re-run layout-v3-build.mjs');
    process.exit(1);
  }
  console.log('layout v3 is current');
} else {
  writeFileSync(LAYOUT_PATH, text);
  console.log(`wrote layout v3 (${out.nodes.length} nodes, ${out.edges.length} edges)`);
}
