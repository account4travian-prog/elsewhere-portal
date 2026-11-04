// Elsewhere Portal — camera + named-view chips (M4.18).
//
// Pure camera decisions for the 3D scene: named-view chips, the
// world bounds those chips and hand controls are confined to, and
// the bounded pan/zoom/reset operations. scene.mjs owns the THREE
// cameras and consumes these decisions; this module never touches
// a figure, a layout node, or any WorldData position. A camera move
// is view-only by construction.
//
// F-1 STATE, AS BUILT: Design C1's ortho-only letter and the shipped
// scaffold disagree. The scaffold's split stands here unchanged —
// the town/bookmark camera is the canonical orthographic camera at
// 35°, and Follow remains the shipped perspective camera at fov
// 28° and elevation 35°. This module builds both horns so both are
// reachable; it does not ratify either. Ratification is the project owner's,
// asked in the G-J1 pack.

import { CAMERA_WORDINGS, RIG_TOKENS } from './palette.mjs';

export const CAMERA_ELEVATION_DEG = RIG_TOKENS.camera.elevationDeg;
export const CAMERA_ELEVATION_RAD = (CAMERA_ELEVATION_DEG * Math.PI) / 180;
export const FOLLOW_FOV_DEG = RIG_TOKENS.camera.followFovDeg;
export const FOLLOW_FRAME_HEIGHT = 13;
export const OVERVIEW_DISTANCE = 220;
export const WORLD_BOUNDS_MARGIN = 6;
export const CAMERA_HEIGHT_LIMITS = Object.freeze({ min: 12, max: RIG_TOKENS.camera.overviewFrustumHeight });
export const RESET_VIEW_LABEL = CAMERA_WORDINGS.resetView;

const CELL = 10;
const gridToWorld = (gx, gy) => ({ x: (gx - 4) * CELL, z: (gy - 4) * CELL });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function requireFinite(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`camera: ${name} must be a finite number`);
  return value;
}

function addPoint(points, x, z) {
  if (Number.isFinite(x) && Number.isFinite(z)) points.push({ x, z });
}

function addRect(points, rect) {
  if (!rect) return;
  addPoint(points, rect.cx - rect.w / 2, rect.cz - rect.d / 2);
  addPoint(points, rect.cx + rect.w / 2, rect.cz + rect.d / 2);
}

/** The layout's world bounds: every authored or staged-fill place
 *  the scene can draw, expanded by WORLD_BOUNDS_MARGIN. Geometry
 *  rects and anchors govern where they exist; grid centres and
 *  street paths are included so a place is never outside its own
 *  camera bounds merely because its footprint is offset in its
 *  cell. For the shipped layout v3 this is x [-40, 40], z [-38, 38]
 *  (authored extents x [-34, 34], z [-32, 32], plus the margin). */
export function worldBoundsForLayout(layout, margin = WORLD_BOUNDS_MARGIN) {
  if (!layout || !Array.isArray(layout.nodes) || !layout.nodes.length) {
    throw new TypeError('worldBoundsForLayout: a layout with nodes is required');
  }
  requireFinite('margin', margin);
  const points = [];
  for (const node of layout.nodes) {
    const centre = gridToWorld(node.x, node.y);
    addPoint(points, centre.x, centre.z);
    const g = node.geometry || {};
    addRect(points, g.footprintRect);
    addRect(points, g.parcelRect);
    addRect(points, g.pavingRect);
    addRect(points, g.apronRect);
    addRect(points, g.towerRect);
    if (g.door?.anchor) addPoint(points, g.door.anchor.x, g.door.anchor.z);
    if (g.signAnchor) addPoint(points, g.signAnchor.x, g.signAnchor.z);
    if (g.centrepieceAnchor) addPoint(points, g.centrepieceAnchor.x, g.centrepieceAnchor.z);
    if (node.stagedPosition && layout.fillGeometry?.parcelRect) {
      addRect(points, {
        cx: centre.x, cz: centre.z,
        w: layout.fillGeometry.parcelRect.w, d: layout.fillGeometry.parcelRect.d,
      });
      if (g.signAnchor) addPoint(points, g.signAnchor.x, g.signAnchor.z);
    }
  }
  for (const edge of layout.edges || []) {
    for (const p of edge.street?.path || []) addPoint(points, p[0], p[1]);
  }
  if (!points.length) throw new Error('worldBoundsForLayout: layout carries no usable geometry');
  const minX = Math.min(...points.map((p) => p.x)) - margin;
  const maxX = Math.max(...points.map((p) => p.x)) + margin;
  const minZ = Math.min(...points.map((p) => p.z)) - margin;
  const maxZ = Math.max(...points.map((p) => p.z)) + margin;
  return Object.freeze({
    minX, maxX, minZ, maxZ,
    width: maxX - minX, depth: maxZ - minZ,
    center: Object.freeze({ x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 }),
    margin,
  });
}

/** Bounds for the shipped layout v3, before any staged fill. The
 *  scene replaces this with worldBoundsForLayout(effectiveLayout)
 *  at boot, so an evidenced staged plot expands the south edge
 *  rather than sitting outside the hand-pan bounds. */
export const WORLD_BOUNDS = Object.freeze({
  minX: -40, maxX: 40, minZ: -38, maxZ: 38,
  width: 80, depth: 76,
  center: Object.freeze({ x: 0, z: 0 }),
  margin: WORLD_BOUNDS_MARGIN,
});

/** Camera position for a target on this rig: fixed azimuth from
 *  the south, elevation 35°, no orbit. Distance is the scaffold's
 *  canonical 220 units (far enough that the ortho frame is set by
 *  its frustum height alone, and the follow frame by its fov). */
export function cameraPositionFor(target, distance = OVERVIEW_DISTANCE) {
  requireFinite('target.x', target?.x);
  requireFinite('target.y', target?.y ?? 0);
  requireFinite('target.z', target?.z);
  requireFinite('distance', distance);
  return {
    x: target.x,
    y: (target.y ?? 0) + Math.sin(CAMERA_ELEVATION_RAD) * distance,
    z: target.z + Math.cos(CAMERA_ELEVATION_RAD) * distance,
  };
}

function nodeByCode(layout, code) {
  const node = (layout?.nodes || []).find((n) => n.code === code);
  if (!node) throw new Error(`cameraChipsForLayout: layout has no node ${code}`);
  return node;
}

function nodeCentre(layout, code) {
  const node = nodeByCode(layout, code);
  const g = node.geometry || {};
  const rect = g.pavingRect || g.footprintRect || g.parcelRect;
  if (rect) return { x: rect.cx, z: rect.cz };
  return gridToWorld(node.x, node.y);
}

function rectOf(layout, code, key = 'footprintRect') {
  const node = nodeByCode(layout, code);
  const rect = node.geometry?.[key];
  if (!rect) throw new Error(`cameraChipsForLayout: ${code} has no geometry.${key}`);
  return rect;
}

function meanPoint(points) {
  return {
    x: points.reduce((a, p) => a + p.x, 0) / points.length,
    z: points.reduce((a, p) => a + p.z, 0) / points.length,
  };
}

function chip(id, labelKey, target, height, placeCode = null) {
  const t = { x: target.x, y: 0, z: target.z };
  return Object.freeze({
    id,
    label: CAMERA_WORDINGS[labelKey],
    placeCode,
    mode: 'overview',
    projection: 'orthographic',
    target: Object.freeze(t),
    height,
    position: Object.freeze(cameraPositionFor(t)),
  });
}

/** Building top heights (world units) for the street framing's
 *  projected extents: scene.mjs's BUILDING_FORM totals (h + roofH,
 *  + 3.4 for a spire — the cone stands 1.6 above the roof and rises
 *  1.8 more), with the Plaza's centrepiece top. Mirrored here
 *  because the layout carries no heights; camera.test.mjs
 *  cross-checks this table against the scene source so a height
 *  change there fails the test instead of drifting silently. */
export const PLACE_TOP_UNITS = Object.freeze({
  EMBER_TOWNHALL: 14.3,
  EMBER_COLLEGE: 9.0,
  MARKET_HALL: 6.9,
  LIBRARY_ANNEX: 7.8,
  PUBLIC_WORKSHOP: 6.9,
  EMBER_DISTRICT_3_PLOT_18: 7.8,
  EMBER_DISTRICT_1_PLOT_31: 7.8,
  EMBER_HOME_MAPLE_COTTAGE: 5.8,
  EMBER_HOME_WILLOW_COTTAGE: 5.8,
  EMBER_PLAZA_OF_UNITY: 3.2,
});
const STREET_ASPECT = 1.6; // the gate frame's aspect (1280 x 800)
const STREET_OVERHANG = 0.35; // roof overhang beyond the footprint rect
const STREET_TAG_ALLOWANCE = 1.6; // a roof-tag box above the top point

/** A place's projected extent on the town camera, in frame
 *  coordinates: x in world units, u = y·cos35 − z·sin35 (the
 *  camera-up coordinate before the target offset). Corners of the
 *  place's rect (with roof overhang) at ground and at its top, the
 *  tag-allowance point over its centre, and its door/sign anchors. */
function streetExtentOf(node) {
  const g = node.geometry || {};
  const rect = g.footprintRect || g.pavingRect || g.parcelRect;
  if (!rect) return null;
  const top = PLACE_TOP_UNITS[node.code]
    ?? (g.signAnchor ? g.signAnchor.y + 1 : 7.8);
  const cos = Math.cos(CAMERA_ELEVATION_RAD);
  const sin = Math.sin(CAMERA_ELEVATION_RAD);
  const xs = [];
  const us = [];
  const push = (x, y, z) => { xs.push(x); us.push(y * cos - z * sin); };
  for (const x of [rect.cx - rect.w / 2 - STREET_OVERHANG, rect.cx + rect.w / 2 + STREET_OVERHANG]) {
    for (const z of [rect.cz - rect.d / 2 - STREET_OVERHANG, rect.cz + rect.d / 2 + STREET_OVERHANG]) {
      push(x, 0, z);
      push(x, top, z);
    }
  }
  push(rect.cx, top + STREET_TAG_ALLOWANCE, rect.cz);
  if (g.door?.anchor) push(g.door.anchor.x, 0, g.door.anchor.z);
  if (g.signAnchor) push(g.signAnchor.x, g.signAnchor.y + 1.2, g.signAnchor.z);
  return {
    code: node.code,
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minU: Math.min(...us), maxU: Math.max(...us),
  };
}

function streetFramingFor(extents) {
  const minX = Math.min(...extents.map((e) => e.minX));
  const maxX = Math.max(...extents.map((e) => e.maxX));
  const minU = Math.min(...extents.map((e) => e.minU));
  const maxU = Math.max(...extents.map((e) => e.maxU));
  const sin = Math.sin(CAMERA_ELEVATION_RAD);
  const required = Math.max((maxX - minX) / STREET_ASPECT, maxU - minU);
  return {
    target: { x: (minX + maxX) / 2, z: -(minU + maxU) / 2 / sin },
    height: Math.ceil(required / 2) * 2,
  };
}

const extentIntersectsFraming = (e, f) => {
  const sin = Math.sin(CAMERA_ELEVATION_RAD);
  const halfW = (f.height * STREET_ASPECT) / 2;
  const halfU = f.height / 2;
  const midU = -f.target.z * sin;
  return e.minX < f.target.x + halfW && e.maxX > f.target.x - halfW
    && e.minU < midU + halfU && e.maxU > midU - halfU;
};
const extentContainedInFraming = (e, f) => {
  const sin = Math.sin(CAMERA_ELEVATION_RAD);
  const halfW = (f.height * STREET_ASPECT) / 2;
  const halfU = f.height / 2;
  const midU = -f.target.z * sin;
  return e.minX >= f.target.x - halfW && e.maxX <= f.target.x + halfW
    && e.minU >= midU - halfU && e.maxU <= midU + halfU;
};

/** The Sample street framing (G-J1 round 2): the subjects are the
 *  street's three places — Plaza paving + College frontage + Town
 *  Hall block — and the framing is the smallest centred frame that
 *  holds its content WHOLE. Round 1's hand-set frame (target
 *  (9.5, −13.5), height 42, the subjects' ground bounding box)
 *  clipped what it touched: Market Hall's edge, the bottom row of
 *  plates, a figure at the frame edge (my Hark's audit, Blocker 2).
 *  The derivation now starts from the subjects' full projected
 *  extents (roofs and tag headroom included, not ground corners)
 *  and widens to a fixed point: any place whose extent the frame
 *  intersects but does not contain is folded in whole and the
 *  frame recomputed, until everything the frame touches is whole.
 *  On layout v3 the fixed point is the town's built extent — the
 *  town is compact enough that any street frame holding its
 *  content whole is a town-centre frame; the pack says so plainly
 *  rather than pretending a tighter crop was honest. */
export function sampleStreetFraming(layout) {
  const subjects = ['EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE', 'EMBER_TOWNHALL'];
  const extents = new Map();
  for (const node of layout.nodes || []) {
    const e = streetExtentOf(node);
    if (e) extents.set(node.code, e);
  }
  const inSet = new Set(subjects.filter((c) => extents.has(c)));
  if (!inSet.size) throw new Error('sampleStreetFraming: no subject places in layout');
  let framing = streetFramingFor([...inSet].map((c) => extents.get(c)));
  for (let pass = 0; pass < (layout.nodes || []).length + 1; pass++) {
    let grew = false;
    for (const [code, e] of extents) {
      if (inSet.has(code)) continue;
      if (extentIntersectsFraming(e, framing) && !extentContainedInFraming(e, framing)) {
        inSet.add(code);
        grew = true;
      }
    }
    if (!grew) break;
    framing = streetFramingFor([...inSet].map((c) => extents.get(c)));
  }
  return { ...framing, contains: [...inSet].sort() };
}

/** The named-view chips, in bar order. Every target is read from
 *  layout v3 geometry (footprint / parcel / paving rects and door
 *  anchors), never from a second copy of the town's coordinates:
 *   - Overview: the whole town (bounds centre + the scaffold's
 *     step south, at the as-built overview frustum height).
 *   - Plaza: the Plaza's paving centre.
 *   - The College corner: the College's footprint centre averaged
 *     with its door anchor — the corner a visitor arrives at.
 *   - Town Hall corner: footprint centre, tower centre, and door
 *     anchor averaged — the tower corner over the entrance.
 *   - The Ledger block: the Ledger press's parcel + footprint
 *     centres — the whole block, not just the press house.
 *   - Sample street: the street's three places, framed by
 *     sampleStreetFraming (G-J1 round 2: the smallest frame that
 *     holds everything it touches whole). */
export function cameraChipsForLayout(layout) {
  const bounds = worldBoundsForLayout(layout);
  const plaza = nodeCentre(layout, 'EMBER_PLAZA_OF_UNITY');
  const collegeRect = rectOf(layout, 'EMBER_COLLEGE');
  const collegeDoor = nodeByCode(layout, 'EMBER_COLLEGE').geometry.door.anchor;
  const collegeCorner = meanPoint([
    { x: collegeRect.cx, z: collegeRect.cz },
    { x: collegeDoor.x, z: collegeDoor.z },
  ]);
  const hallRect = rectOf(layout, 'EMBER_TOWNHALL');
  const hallTower = rectOf(layout, 'EMBER_TOWNHALL', 'towerRect');
  const hallDoor = nodeByCode(layout, 'EMBER_TOWNHALL').geometry.door.anchor;
  const hallCorner = meanPoint([
    { x: hallRect.cx, z: hallRect.cz },
    { x: hallTower.cx, z: hallTower.cz },
    { x: hallDoor.x, z: hallDoor.z },
  ]);
  const ledgerFoot = rectOf(layout, 'EMBER_DISTRICT_1_PLOT_31');
  const ledgerParcel = rectOf(layout, 'EMBER_DISTRICT_1_PLOT_31', 'parcelRect');
  const ledgerBlock = meanPoint([
    { x: ledgerFoot.cx, z: ledgerFoot.cz },
    { x: ledgerParcel.cx, z: ledgerParcel.cz },
  ]);
  const streetFraming = sampleStreetFraming(layout);

  return [
    chip('overview', 'overview', { x: bounds.center.x, z: bounds.center.z + 3 }, CAMERA_HEIGHT_LIMITS.max),
    chip('plaza', 'plaza', plaza, 28, 'EMBER_PLAZA_OF_UNITY'),
    chip('college-corner', 'collegeCorner', collegeCorner, 28, 'EMBER_COLLEGE'),
    chip('town-hall-corner', 'townHallCorner', hallCorner, 28, 'EMBER_TOWNHALL'),
    chip('ledger-block', 'ledgerBlock', ledgerBlock, 30, 'EMBER_DISTRICT_1_PLOT_31'),
    chip('sample-street', 'sampleStreet', streetFraming.target, streetFraming.height),
  ];
}

export const CAMERA_CHIP_IDS = Object.freeze([
  'overview', 'plaza', 'college-corner', 'town-hall-corner', 'ledger-block', 'sample-street',
]);

/** A mutable camera view: the ortho bookmark camera's live state.
 *  Views are plain data so tests (and the interiors lane) can hold
 *  one without a renderer. */
export function viewForChip(oneChip) {
  if (!oneChip || !oneChip.target) throw new TypeError('viewForChip: a camera chip is required');
  return {
    mode: 'overview',
    chipId: oneChip.id,
    label: oneChip.label,
    target: { ...oneChip.target },
    height: oneChip.height,
  };
}

export function resetCameraView(chips) {
  const overview = (chips || []).find((c) => c.id === 'overview');
  if (!overview) throw new Error('resetCameraView: the chip set has no overview chip');
  return viewForChip(overview);
}

export function applyCameraChip(view, oneChip) {
  const next = viewForChip(oneChip);
  view.mode = next.mode;
  view.chipId = next.chipId;
  view.label = next.label;
  view.target = next.target;
  view.height = next.height;
  return view;
}

/** Confine a view to the world bounds: the target centre cannot
 *  leave the bounds, the target stays on the ground plane, and the
 *  frustum height stays inside the zoom limits. This is the whole
 *  "the camera cannot be lost" law — every hand control and every
 *  chip passes through here before a frame is drawn. */
export function clampCameraView(view, bounds = WORLD_BOUNDS) {
  if (!view || !view.target) throw new TypeError('clampCameraView: a camera view is required');
  requireFinite('view.target.x', view.target.x);
  requireFinite('view.target.z', view.target.z);
  requireFinite('view.height', view.height);
  view.target.x = clamp(view.target.x, bounds.minX, bounds.maxX);
  view.target.y = 0;
  view.target.z = clamp(view.target.z, bounds.minZ, bounds.maxZ);
  view.height = clamp(view.height, CAMERA_HEIGHT_LIMITS.min, CAMERA_HEIGHT_LIMITS.max);
  return view;
}

export function viewWithinBounds(view, bounds = WORLD_BOUNDS) {
  return !!view && !!view.target
    && view.target.x >= bounds.minX && view.target.x <= bounds.maxX
    && view.target.z >= bounds.minZ && view.target.z <= bounds.maxZ
    && view.height >= CAMERA_HEIGHT_LIMITS.min && view.height <= CAMERA_HEIGHT_LIMITS.max;
}

/** Hand-pan: drag the town. dxPx/dyPx are pointer movement in CSS
 *  pixels (right/down positive); the view moves so the grabbed
 *  ground follows the pointer — horizontally one frustum unit per
 *  pixel-scale, vertically along the camera's ground projection
 *  (the 1/sin(35°) factor is the elevation foreshortening, derived
 *  in the lane record). The result is clamped to the bounds, and a
 *  panned view is no longer a chip view (chipId clears). */
export function panCameraView(view, dxPx, dyPx, viewport, bounds = WORLD_BOUNDS) {
  requireFinite('dxPx', dxPx);
  requireFinite('dyPx', dyPx);
  const heightPx = viewport?.heightPx || viewport?.height;
  if (!Number.isFinite(heightPx) || heightPx <= 0) {
    throw new TypeError('panCameraView: a viewport with a positive height is required');
  }
  const scale = view.height / heightPx;
  view.target.x -= dxPx * scale;
  view.target.z -= (dyPx * scale) / Math.sin(CAMERA_ELEVATION_RAD);
  // Overflow is a direction, not an escape: an absurd drag lands
  // on the edge it was heading for, never outside the bounds.
  if (!Number.isFinite(view.target.x)) view.target.x = dxPx > 0 ? bounds.minX : bounds.maxX;
  if (!Number.isFinite(view.target.z)) view.target.z = dyPx > 0 ? bounds.minZ : bounds.maxZ;
  view.chipId = null;
  view.label = null;
  return clampCameraView(view, bounds);
}

/** Zoom-as-magnifier: wheel delta scales the frustum height
 *  exponentially (equal wheel steps feel equal), clamped to the
 *  zoom limits and the bounds. No dolly, no orbit — the camera
 *  stays on its fixed axis and only the magnification changes. */
export function zoomCameraView(view, deltaY, bounds = WORLD_BOUNDS) {
  requireFinite('deltaY', deltaY);
  view.height *= Math.exp(deltaY * 0.001);
  if (!Number.isFinite(view.height)) {
    // An absurd wheel delta overflows the exponential; it still
    // lands on the zoom limit it was heading for.
    view.height = deltaY > 0 ? CAMERA_HEIGHT_LIMITS.max : CAMERA_HEIGHT_LIMITS.min;
  }
  view.chipId = null;
  view.label = null;
  return clampCameraView(view, bounds);
}

/** The follow camera's spec, as shipped (F-1's second horn):
 *  perspective, fov 28°, elevation 35°, a 13-unit frame height at
 *  the target. scene.mjs's frameFollow consumes exactly this; the
 *  M5.10 follow behaviours (lookahead, pan pause, door beat) plan
 *  targets over it via follow-interior.mjs and are unchanged. */
export const FOLLOW_CAMERA = Object.freeze({
  projection: 'perspective',
  fovDeg: FOLLOW_FOV_DEG,
  elevationDeg: CAMERA_ELEVATION_DEG,
  frameHeight: FOLLOW_FRAME_HEIGHT,
  distanceForFrame: (FOLLOW_FRAME_HEIGHT / 2) / Math.tan((FOLLOW_FOV_DEG * Math.PI) / 360),
});

/** The camera surface the INTERIORS lane (M5.10) consumes — the
 *  stable public behaviour of this lane, stated as data. If a
 *  future camera change alters any line here, it is a breaking
 *  change for that lane and must be re-agreed, not slipped in. */
export const CAMERA_SURFACE = Object.freeze({
  schema: 'portal.camera-surface/v1',
  viewOnly: true,
  overview: Object.freeze({
    projection: 'orthographic',
    elevationDeg: CAMERA_ELEVATION_DEG,
    azimuth: 'fixed from the south',
    freeOrbit: false,
    chips: CAMERA_CHIP_IDS,
    handPan: 'bounded to WORLD_BOUNDS (worldBoundsForLayout of the effective layout)',
    zoom: `bounded zoom-as-magnifier, frustum height ${CAMERA_HEIGHT_LIMITS.min}–${CAMERA_HEIGHT_LIMITS.max} units`,
    reset: 'Reset view always recovers the Overview chip framing',
  }),
  follow: Object.freeze({
    projection: 'perspective',
    fovDeg: FOLLOW_FOV_DEG,
    elevationDeg: CAMERA_ELEVATION_DEG,
    frameHeight: FOLLOW_FRAME_HEIGHT,
    targetSource: 'scene.mjs followTargetPos() — the follow target, or the open interior\u2019s camera anchor, or the pan-pause hold target',
    stableBehaviours: Object.freeze([
      'lookahead (follow-interior.mjs followCameraPlan)',
      'pan pause with Re-centre (follow-interior.mjs createPanControl)',
      'door beat hooks (follow-interior.mjs followCameraPlan door-beat decisions)',
      'map hand-off for off-stage places (follow-interior.mjs handoff decisions)',
    ]),
  }),
});
