// Elsewhere Portal — scene building set (M4.14).
//
// The manifest consumer: building-kits.json (beside this module) maps
// every effective-layout place code to the factory building GLB that
// replaces the scaffold's placeholder block for that place. Buildings
// are produced by the factory (build/visual/factory,
// scripts/build_buildings.py from kits/bld_<code>.json cards); this
// module is the only scene code that knows their paths.
//
// Every place gets an entry — a building, or the honest treatments:
// the Plaza (open place: paving + statue) and District 1 Plot 30
// (fenced parcel, no building). A place with no manifest entry keeps
// its placeholder and is reported in `missing` — the M4.14 exit gate
// (zero labelled placeholder boxes) is judged on the manifest
// covering the whole effective layout, which the scene test pins
// against the live bundle.
//
// Paths in the manifest are relative to this scene directory and point
// into the build tree; staging publishes the same set under its own
// snapshot (staging/publish.mjs), so the staged scene resolves them
// identically.

export const BUILDING_MANIFEST_URL = './building-kits.json';

// Attach building GLBs to node placeholder groups.
//   groups:    Map<placeCode, THREE.Group> — the groups buildWorld made
//   nodes:     Map<placeCode, layoutNode> — for the v3 geometry rects
//              each kit's origin is placed on (manifest `origin`)
//   manifest:  parsed building-kits.json
//   load:      (url) => Promise<gltf> — scene.mjs's loadFigure (the
//              decoder-equipped figure-loader path)
//   pickables: the scene's pick array — GLB meshes are registered with
//              the same pick record the placeholder base carried.
// Returns { attached: [code...], failed: [{code, error}...],
//           missing: [code...] }.
// A failed load leaves the placeholder standing and is reported — the
// scene must never lose a place to a missing file, and the failure is
// loud in the report rather than silent in the frame.
export async function attachBuildings({ groups, nodes, manifest, load, pickables }) {
  const attached = [];
  const failed = [];
  const missing = [];
  const entries = (manifest && manifest.buildings) || {};
  for (const [code, group] of groups) {
    const entry = entries[code];
    if (!entry) { missing.push(code); continue; }
    try {
      const gltf = await load(entry.glb);
      const bld = gltf.scene;
      bld.name = `building:${entry.slug}`;
      // Placement: the kit GLB's origin sits on the layout geometry
      // rect its manifest entry names (footprint by default; the
      // parcelled places and the Plaza are built around their parcel
      // / paving origin). Rects are world coords; the node group
      // sits at the cell centre, so the local offset is the rect
      // centre minus the group's world position.
      const geo = (nodes && nodes.get(code) && nodes.get(code).geometry) || {};
      const rect = (entry.origin === 'parcel' && geo.parcelRect) ? geo.parcelRect
        : (entry.origin === 'paving' && geo.pavingRect) ? geo.pavingRect
        : geo.footprintRect || geo.parcelRect || geo.pavingRect || null;
      if (rect) bld.position.set(rect.cx - group.position.x, 0, rect.cz - group.position.z);
      // Placeholder out, building in: hide exactly the meshes
      // buildWorld flagged as scaffold placeholder (box, roof, door,
      // pads, plaza disc/orb/pedestal) but keep the group itself —
      // labels, follow targets and the blob contact shadow live on it.
      for (const child of group.children) {
        if (child.userData && child.userData.placeholder === true) {
          child.visible = false;
        }
      }
      bld.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.userData.pick = { type: 'building', code, label: entry.label };
          if (pickables) pickables.push(o);
        }
      });
      group.add(bld);
      attached.push(code);
    } catch (err) {
      failed.push({ code, error: String(err && err.message || err) });
    }
  }
  return { attached, failed, missing };
}

// The scene building card's condition line — M4.15 (D-9b). The wording
// comes from the app logic's own tier source (workTier → integrityTier),
// the exact function the 2D building card composes from: one wording
// source for both surfaces, never a second string. In Tier P every
// work's integrity is null, so the line is the not-in-record tier.
export function buildingConditionLine(workTierFn, bundle, code) {
  const tier = workTierFn(bundle, code);
  return `Repair: ${tier.label}.`;
}

// ------------------------------------------------------------ levels
// Two-storey rendering (look touch-up T3; DECISIONS.md 2026-11-03 —
// the project owner: two-storey buildings render the bottom floor by default;
// the upper floor renders when the viewer manually goes up a level).
//
// Classification is derived, never hard-coded per building: the kit
// card's `storeys` count (the caller passes the card or its count)
// plus the loaded GLB's own wrapper heights. The roof height is the
// `piece_*` wrapper height inside `cut_roof`; one storey is that
// height divided by the card's storey count; the upper set is every
// `piece_*` wrapper sitting at an intermediate storey height
// (1..storeys-1 storeys up, roof pieces excluded). A building whose
// card evidences fewer than two storeys has NO upper set — several
// single-storey kits carry their roof piece at one-storey height,
// and that piece is a roof, not a floor. On the shipped set only the
// College classifies: card `storeys: 2`, roof at y 6.24, storey
// height 3.12, 26 upper pieces.
//
// Level state lives on the building root itself
// (root.userData.level), beside the interior shell state — the
// shell composition contract is documented in interiors.mjs, which
// reads the same state object. The LEVEL owns the roof's rest
// height: register/apply write roof.userData.builtY (the cut_roof
// group's built position) and roof.userData.restY (built minus one
// storey at ground level, built at upper level).
//
// Roof followers: meshes sitting at the roof height OUTSIDE the
// cut_roof group (the College's gable infills are direct building
// children in the GLB, not cut_roof members — measured). They are
// part of the roof assembly: lowering only the cut_roof group would
// leave them floating at built height, so they move with it.

export const LEVEL_GROUND = 'ground';
export const LEVEL_UPPER = 'upper';
export const BUILDING_LEVELS = Object.freeze([LEVEL_GROUND, LEVEL_UPPER]);
const LEVEL_EPS = 0.02; // wrapper heights are float32 GLB translations

function findNamedNode(root, name) {
  let hit = null;
  root.traverse((o) => { if (o.name === name && !hit) hit = o; });
  return hit;
}
function isDescendantOf(node, ancestor) {
  for (let p = node; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

/** Classify one loaded building root against its kit card's storey
 *  count (a number, or a card object carrying `storeys`). Pure
 *  measurement: nothing is moved or hidden here. */
export function classifyBuildingLevels(root, storeysOrCard) {
  if (!root || typeof root.traverse !== 'function') {
    throw new TypeError('classifyBuildingLevels: a loaded building root is required');
  }
  const storeys = (storeysOrCard && typeof storeysOrCard === 'object')
    ? storeysOrCard.storeys : storeysOrCard;
  const roof = findNamedNode(root, 'cut_roof');
  let roofHeightUnits = null;
  if (roof) {
    const ys = [];
    roof.traverse((o) => { if (o.name && o.name.startsWith('piece_')) ys.push(o.position.y); });
    if (ys.length) roofHeightUnits = Math.max(...ys);
  }
  const base = {
    storeys: Number.isFinite(storeys) ? storeys : null,
    roofHeightUnits,
    storeyHeightUnits: null,
    hasUpper: false,
    upperNames: [],
    roofFollowerNames: [],
  };
  if (!Number.isFinite(storeys) || storeys < 2 || !(roofHeightUnits > 0)) return base;
  const storeyHeightUnits = roofHeightUnits / storeys;
  const upperNames = [];
  const roofFollowerNames = [];
  root.traverse((o) => {
    if (!o.name) return;
    if (o.name.startsWith('piece_')) {
      if (roof && isDescendantOf(o, roof)) return; // the roof itself
      const k = o.position.y / storeyHeightUnits;
      const kr = Math.round(k);
      if (Math.abs(k - kr) <= LEVEL_EPS && kr >= 1 && kr < storeys) upperNames.push(o.name);
    } else if (o.isMesh && o !== roof && Math.abs(o.position.y - roofHeightUnits) <= LEVEL_EPS) {
      roofFollowerNames.push(o.name);
    }
  });
  return {
    ...base,
    storeyHeightUnits,
    hasUpper: upperNames.length > 0,
    upperNames,
    roofFollowerNames,
  };
}

/** The level state registered on a building root, or null. */
export function buildingLevelState(root) {
  return (root && root.userData && root.userData.level) || null;
}

/** Whether the scene's level chip is enabled for a state: only a
 *  building with a classified upper set gains a level control. */
export function levelChipEnabled(state) {
  return !!(state && state.hasUpper);
}

function levelOffset(state, level) {
  return level === LEVEL_GROUND ? state.storeyHeightUnits : 0;
}

function applyLevelVisuals(root, state, level) {
  const offset = levelOffset(state, level);
  const shown = [];
  const hidden = [];
  for (const name of state.upperNames) {
    const n = findNamedNode(root, name);
    if (!n) continue;
    n.visible = level === LEVEL_UPPER;
    (level === LEVEL_UPPER ? shown : hidden).push(name);
  }
  for (const name of state.roofFollowerNames) {
    const n = findNamedNode(root, name);
    if (n) n.position.y = state.followerBuiltY[name] - offset;
  }
  const roof = findNamedNode(root, state.roofNode);
  let roofY = null;
  if (roof) {
    roof.userData.builtY = state.roofBuiltY;
    roof.userData.restY = state.roofBuiltY - offset;
    roof.position.y = roof.userData.restY;
    roofY = roof.position.y;
  }
  return { shown, hidden, roofY };
}

/** Register the level state on a loaded building root and render
 *  the default level (ground). Idempotent: re-registering returns
 *  the existing state untouched — built heights are captured once,
 *  before any lowering, and never re-captured from a lowered roof. */
export function registerBuildingLevel(root, storeysOrCard) {
  const existing = buildingLevelState(root);
  if (existing) return existing;
  const cls = classifyBuildingLevels(root, storeysOrCard);
  const roof = findNamedNode(root, 'cut_roof');
  const followerBuiltY = {};
  for (const name of cls.roofFollowerNames) {
    const n = findNamedNode(root, name);
    if (n) followerBuiltY[name] = n.position.y;
  }
  const state = {
    level: LEVEL_GROUND,
    suspendedLevel: null, // interiors.mjs: the level set aside while a room is open
    storeys: cls.storeys,
    hasUpper: cls.hasUpper,
    storeyHeightUnits: cls.storeyHeightUnits,
    roofHeightUnits: cls.roofHeightUnits,
    upperNames: [...cls.upperNames],
    roofFollowerNames: [...cls.roofFollowerNames],
    roofNode: 'cut_roof',
    roofBuiltY: roof ? roof.position.y : null,
    followerBuiltY,
  };
  root.userData.level = state;
  if (state.hasUpper) applyLevelVisuals(root, state, LEVEL_GROUND);
  return state;
}

/** Set a building's level. Instant state change (no animation is
 *  claimed anywhere in the rig). While an interior is open the
 *  shell owns the built form, so the new level is recorded (and the
 *  roof's rest height updated) but its visuals are DEFERRED: the
 *  shell's close applies them — see interiors.mjs applyShell.
 *  Returns the applied report, or null for an unregistered root. */
export function applyBuildingLevel(root, level) {
  if (!BUILDING_LEVELS.includes(level)) {
    throw new TypeError(`applyBuildingLevel: level must be one of ${BUILDING_LEVELS.join('/')}`);
  }
  const state = buildingLevelState(root);
  if (!state) return null;
  if (!state.hasUpper) {
    state.level = LEVEL_GROUND;
    return { level: LEVEL_GROUND, hasUpper: false, shown: [], hidden: [], roofY: null, deferred: false };
  }
  state.level = level;
  const roof = findNamedNode(root, state.roofNode);
  if (roof) {
    roof.userData.builtY = state.roofBuiltY;
    roof.userData.restY = state.roofBuiltY - levelOffset(state, level);
  }
  if (state.suspendedLevel !== null && state.suspendedLevel !== undefined) {
    state.suspendedLevel = level;
    return { level, hasUpper: true, shown: [], hidden: [], roofY: roof ? roof.position.y : null, deferred: true };
  }
  const applied = applyLevelVisuals(root, state, level);
  return { level, hasUpper: true, ...applied, deferred: false };
}
