// Elsewhere Portal — dollhouse interiors (M5.08) + the interior
// standing line (M5.12).
//
// ONE reusable cutaway shell serves all seven interiors: the shell
// is a STATE applied to a building GLB the M4.14 factory already
// built for it — opening hides the GLB's own cut_wall_front /
// cut_wall_side groups and lifts its cut_roof group in the same
// scene (the roof stays in the frame, raised; nothing is swapped
// or re-modelled per building). The seven interiors differ only in
// their registry entry (interior-kits.json, generated from the
// GLBs + kit cards by gen-interiors.mjs): stations, anchors,
// footprint.
//
// Occupancy law (the honesty core of the item): an interior shows
// EXACTLY the citizens the bundle places at its place code —
// nobody extra, nobody missing. A citizen the record places
// elsewhere is never borrowed to fill a room, and an empty room
// says so in the EMPTY_ROOM_LINE. Where a figure stands inside the
// room is Portal's staging (stations first, then floor slots);
// the standing line on every interior says exactly that, out loud.
//
// Enter/exit are WALKS over a threshold edge: thresholdPath()
// returns the polyline street -> door anchor -> room, and
// pathContinuity() is the check the no-teleport invariant runs on
// it — consecutive points never jump further than a walk step, and
// the door anchor is always a point ON the path, so a figure is
// never inside before it has crossed the threshold (the M5.10
// door beat stands on the same path).
//
// Pure model + one THREE applier (applyShell), in the buildings.mjs
// pattern: Node tests pin the model and exercise the applier
// against the real GLBs through the scene's own loader.
//
// Composition with floor levels (look touch-up T3, buildings.mjs):
// the LEVEL owns the roof's rest height. A building root may carry
// a level state (root.userData.level, registered by
// registerBuildingLevel); opening an interior first restores the
// BUILT form — the level is set aside (state.suspendedLevel records
// it, the upper set is shown, roof followers return to built
// height) and the roof lifts from the built height — and closing
// returns the building to the level the viewer had: upper set
// shown or hidden per that level, followers and roof back at that
// level's rest height. applyBuildingLevel calls made while a room
// is open are deferred by buildings.mjs into the same record, so
// closing lands on the viewer's latest chosen level. A root with
// no level state behaves exactly as the shell always has.

export const INTERIOR_KITS_URL = './interior-kits.json';

// The seven interiors the plan names (M5.08): College, Town Hall,
// Market Hall, Workshop, Library Annex, Meridian Hall, Ledger press.
export const INTERIOR_CODES = [
  'EMBER_COLLEGE',
  'EMBER_TOWNHALL',
  'MARKET_HALL',
  'PUBLIC_WORKSHOP',
  'LIBRARY_ANNEX',
  'EMBER_DISTRICT_3_PLOT_18', // Meridian Hall
  'EMBER_DISTRICT_1_PLOT_31', // Ember Ledger Press
];

// The standing staging line (M5.12): carried by EVERY interior, in
// the same words. It sits where the mistake would form — a viewer
// who believes the room's furniture or a figure's exact spot is
// world fact — and it says what is the record's and what is
// Portal's stage.
export const STANDING_LINE =
  'This room is Portal\'s stage: its layout, stations, and the exact spot where each figure stands '
  + 'are drawn by Portal so you can follow what happens. The people shown are exactly those the '
  + 'public record places here — nobody added, nobody left out.';

export const EMPTY_ROOM_LINE = 'Nobody is here right now.';

// The level set-aside note (T3): carried by the scene's interior
// line when the opened building has a second storey — opening the
// room set the viewer's floor level aside, and the words say so
// where the change of form would otherwise go unexplained.
export const LEVEL_SET_ASIDE_LINE =
  'Opening this room sets the floor level aside and shows the building in its built form; '
  + 'closing the room returns to the level you had.';

// The walk-step ceiling for threshold paths (world units): a path
// whose consecutive points jump further than this is a teleport,
// whatever it calls itself.
export const WALK_STEP_UNITS = 2.5;

/** The interior definition for a place code, or null — a place
 *  with no registry entry has no interior, and callers must say so
 *  rather than improvise one. */
export function interiorDef(registry, code) {
  const def = registry && registry.interiors ? registry.interiors[code] : null;
  return def || null;
}

export function isInterior(registry, code) {
  return interiorDef(registry, code) !== null;
}

// ------------------------------------------------------------ shell
/** The shell instruction set for one interior state. Opening and
 *  closing are the same shape with the sign flipped, so the
 *  template cannot drift between the two directions. */
export function shellPlan(def, open) {
  if (!def) throw new TypeError('shellPlan: an interior definition is required');
  return {
    code: def.code,
    open: !!open,
    hideNodes: open ? [...def.cutNodes] : [],
    showNodes: open ? [] : [...def.cutNodes],
    roofNode: def.roofNode,
    roofLiftUnits: open ? def.roofLiftUnits : 0,
  };
}

function findNamed(root, name) {
  let hit = null;
  root.traverse((o) => { if (o.name === name && !hit) hit = o; });
  return hit;
}

/** Apply a shell plan to a loaded building root (THREE object).
 *  The roof's BUILT height is remembered on the node itself the
 *  first time the shell touches it (userData.builtY), and its rest
 *  height (userData.restY) is owned by the floor level when one is
 *  registered (buildings.mjs) — the shell never re-derives rest
 *  from a lowered roof. Open: the level is set aside and the built
 *  form restored before the roof lifts from the built height.
 *  Close: the roof returns to the level's rest height and the
 *  level's visuals are re-applied. Open/close cycles are
 *  idempotent under both levels and return the building to exactly
 *  the state its level dictates. Returns the nodes applied. */
export function applyShell(buildingRoot, plan) {
  const applied = { hidden: [], shown: [], roofLifted: null, levelSetAside: null, levelRestored: null };
  for (const name of plan.hideNodes) {
    const n = findNamed(buildingRoot, name);
    if (n) { n.visible = false; applied.hidden.push(name); }
  }
  for (const name of plan.showNodes) {
    const n = findNamed(buildingRoot, name);
    if (n) { n.visible = true; applied.shown.push(name); }
  }
  const level = (buildingRoot.userData && buildingRoot.userData.level) || null;
  const levelActive = !!(level && level.hasUpper);
  const setUpperVisible = (visible) => {
    for (const name of level.upperNames) {
      const n = findNamed(buildingRoot, name);
      if (n) n.visible = visible;
    }
  };
  const setFollowers = (offset) => {
    for (const name of level.roofFollowerNames) {
      const n = findNamed(buildingRoot, name);
      if (n) n.position.y = level.followerBuiltY[name] - offset;
    }
  };
  const roof = findNamed(buildingRoot, plan.roofNode);
  if (roof) {
    if (roof.userData.builtY === undefined) {
      roof.userData.builtY = (levelActive && Number.isFinite(level.roofBuiltY))
        ? level.roofBuiltY : roof.position.y;
    }
    if (roof.userData.restY === undefined) roof.userData.restY = roof.userData.builtY;
    if (plan.open) {
      if (levelActive) {
        if (level.suspendedLevel === null || level.suspendedLevel === undefined) {
          level.suspendedLevel = level.level;
        }
        applied.levelSetAside = level.suspendedLevel;
        setUpperVisible(true); // the built form: every storey stands
        setFollowers(0);
      }
      roof.position.y = roof.userData.builtY + plan.roofLiftUnits;
    } else {
      if (levelActive) {
        const returnLevel = (level.suspendedLevel !== null && level.suspendedLevel !== undefined)
          ? level.suspendedLevel : level.level;
        level.level = returnLevel;
        level.suspendedLevel = null;
        const offset = returnLevel === 'ground' ? level.storeyHeightUnits : 0;
        roof.userData.restY = roof.userData.builtY - offset;
        setUpperVisible(returnLevel === 'upper');
        setFollowers(offset);
        applied.levelRestored = returnLevel;
      }
      roof.position.y = roof.userData.restY + plan.roofLiftUnits;
    }
    applied.roofLifted = plan.roofLiftUnits;
  }
  return applied;
}

// -------------------------------------------------------- occupants
/** The citizens WorldData places at this interior's place code —
 *  exactly those, in bundle order. Citizens with no place, or a
 *  place elsewhere, are not occupants; there is no second source. */
export function interiorOccupants(bundle, code) {
  return (bundle && Array.isArray(bundle.citizens) ? bundle.citizens : [])
    .filter((c) => c && c.placeCode === code);
}

const INSET = 0.7; // a standing figure keeps this far off the walls
const SLOT_GAP = 1.1; // floor slots never crowd a station or a slot

function clampInside(def, [x, , z]) {
  const hw = def.footprint.widthUnits / 2 - INSET;
  const hd = def.footprint.depthUnits / 2 - INSET;
  return [Math.max(-hw, Math.min(hw, x)), 0, Math.max(-hd, Math.min(hd, z))];
}

/** Deterministic floor slots inside the footprint, row-major from
 *  the room's north-west, skipping any point too close to a station
 *  or an earlier slot. Enough slots for any evidenced crowd; the
 *  caller takes what it needs. */
export function floorSlots(def, count) {
  const slots = [];
  const taken = def.stations.map((s) => s.position);
  const hw = def.footprint.widthUnits / 2 - INSET;
  const hd = def.footprint.depthUnits / 2 - INSET;
  for (let z = -hd; z <= hd + 1e-9 && slots.length < count; z += SLOT_GAP) {
    for (let x = -hw; x <= hw + 1e-9 && slots.length < count; x += SLOT_GAP) {
      const p = [Math.round(x * 100) / 100, 0, Math.round(z * 100) / 100];
      if (taken.some((t) => Math.hypot(t[0] - p[0], t[2] - p[2]) < SLOT_GAP)) continue;
      taken.push(p);
      slots.push(p);
    }
  }
  return slots;
}

/**
 * Assign occupants to standing positions inside the room.
 *   roles: optional Map citizenKey -> station suffix, from a
 *     staging with an evidenced role (the lecturer at the lectern).
 *     A role naming a functional station takes that station; a
 *     role naming nothing real is refused, never approximated.
 *   Everyone else takes general stations in registry order, then
 *   floor slots. A FUNCTIONAL station is never filled by the
 *   general pass — standing at the lectern is a claim.
 * Returns [{ citizen, at: {type:'station', id} | {type:'floor'},
 * position }] in occupant order, positions clamped inside the room.
 */
export function assignStations(def, occupants, roles = new Map()) {
  const used = new Set();
  const out = [];
  const byId = new Map(def.stations.map((s) => [s.id, s]));
  const remaining = [];
  for (const citizen of occupants) {
    const key = citizen.citizenKey || citizen.handle || citizen.name;
    const suffix = roles.get(key);
    if (suffix) {
      const st = def.stations.find((s) => s.suffix === suffix);
      if (!st) throw new Error(`assignStations: ${def.code} has no station '${suffix}' for role of ${key}`);
      used.add(st.id);
      out.push({ citizen, at: { type: 'station', id: st.id }, position: clampInside(def, st.position) });
    } else remaining.push(citizen);
  }
  const general = def.stations.filter((s) => s.kind === 'general' && !used.has(s.id));
  const slots = floorSlots(def, remaining.length);
  let gi = 0; let fi = 0;
  for (const citizen of remaining) {
    if (gi < general.length) {
      const st = general[gi++];
      used.add(st.id);
      out.push({ citizen, at: { type: 'station', id: st.id }, position: clampInside(def, st.position) });
    } else {
      out.push({ citizen, at: { type: 'floor' }, position: slots[fi++] });
    }
  }
  return out;
}

/** The full render model for one interior at one bundle: the
 *  definition, the occupants placed, the empty-room line when
 *  there are none, and the standing line every interior carries. */
export function interiorRenderModel(registry, bundle, code, roles = new Map()) {
  const def = interiorDef(registry, code);
  if (!def) return null;
  const occupants = interiorOccupants(bundle, code);
  return {
    code,
    label: def.label,
    def,
    placed: assignStations(def, occupants, roles),
    occupants: occupants.map((c) => c.citizenKey || c.handle || c.name),
    empty: occupants.length === 0,
    emptyLine: occupants.length === 0 ? EMPTY_ROOM_LINE : null,
    standingLine: STANDING_LINE,
  };
}

// ------------------------------------------------------- thresholds
/**
 * The threshold walk, building-local: from a point OUTSIDE the door
 * (on the street side, one step beyond the threshold along the door
 * face's outward normal), through the door anchor itself, to a
 * point inside. The door anchor is a vertex of the path — the
 * crossing is a point on the walk, never a jump across it.
 */
export function thresholdPath(def, insidePoint) {
  const door = def.anchors.door;
  if (!door) throw new Error(`thresholdPath: ${def.code} carries no door anchor`);
  const n = { south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0] }[def.doorFace] || [0, 1];
  const outside = [door[0] + n[0] * 1.6, 0, door[2] + n[1] * 1.6];
  return { points: [outside, [...door], [...insidePoint]], doorIndex: 1 };
}

/** Subdivide a polyline so no step exceeds maxStep, keeping every
 *  original vertex (the door anchor stays a vertex). */
export function densifyPath(points, maxStep = WALK_STEP_UNITS) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]; const b = points[i + 1];
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const steps = Math.max(1, Math.ceil(d / maxStep));
    for (let s = 0; s < steps; s++) {
      out.push([a[0] + (b[0] - a[0]) * (s / steps), 0, a[2] + (b[2] - a[2]) * (s / steps)]);
    }
  }
  out.push([...points[points.length - 1]]);
  return out;
}

/** The no-teleport check over a position stream: every consecutive
 *  step within maxStep. Returns the first violating step index, or
 *  -1 when the stream is continuous. */
export function pathContinuity(points, maxStep = WALK_STEP_UNITS) {
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][2] - points[i - 1][2]);
    if (d > maxStep + 1e-9) return i;
  }
  return -1;
}
