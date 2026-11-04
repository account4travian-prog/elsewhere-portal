// Elsewhere Portal — scene system (M4.16): chunks, LOD bands, actor
// budget. Pure ESM, no DOM, no three — the decisions the 3D scene makes
// every frame, factored out so Node tests pin them and the browser
// scene (scene.mjs) is a thin consumer.
//
// THE LAWS this module encodes (M4.16's letter):
//   - The town renders in chunks: a civic-core chunk plus district
//     chunks; the frontier is a SEPARATE map scene (D5) and never a
//     town chunk.
//   - Every placed figure gets exactly one representation at a time,
//     chosen by camera distance: LOD0 (near) / LOD1 (mid) / standee
//     (far). A standee never slides — representation changes happen
//     only at an evidenced place, never mid-route (M4.09's rule,
//     applied to the swap: the swap function below refuses a figure
//     that is between places).
//   - Actor budget in code: at most MAX_ACTORS figures are embodied
//     in the scene. Overflow goes to the roster rail — listed, named,
//     never dropped and never faked into the scene.

// ---------------------------------------------------------------- chunks
// Civic core: the plaza and the three civic buildings around it.
// District chunks follow the layout's own geography: District 1 is
// west, District 3 is east, and the two southern buildings form the
// south chunk. A node not in the table falls back to its grid quadrant
// so a future layout node lands in SOME chunk deterministically.
export const CIVIC_CORE_CODES = new Set([
  'EMBER_PLAZA_OF_UNITY',
  'EMBER_TOWNHALL',
  'EMBER_COLLEGE',
  'MARKET_HALL',
]);

export const CHUNK_CIVIC_CORE = 'civic-core';
export const CHUNK_DISTRICT_1 = 'district-1';
export const CHUNK_DISTRICT_3 = 'district-3';
export const CHUNK_SOUTH = 'south';
// The frontier's chunk id exists only to name the separate map scene;
// chunkOfNode never returns it for a town node.
export const CHUNK_FRONTIER = 'frontier-map';

const CHUNK_BY_CODE = new Map([
  ['EMBER_DISTRICT_1_PLOT_31', CHUNK_DISTRICT_1], // Ember Ledger Press
  ['EMBER_HOME_MAPLE_COTTAGE', CHUNK_DISTRICT_1],
  ['EMBER_DISTRICT_3_PLOT_18', CHUNK_DISTRICT_3], // Meridian Hall
  ['EMBER_HOME_WILLOW_COTTAGE', CHUNK_DISTRICT_3],
  ['LIBRARY_ANNEX', CHUNK_SOUTH],
  ['PUBLIC_WORKSHOP', CHUNK_SOUTH],
]);

export function chunkOfNode(node) {
  if (!node || typeof node.code !== 'string') {
    throw new TypeError('chunkOfNode: a layout node with a code is required');
  }
  if (CIVIC_CORE_CODES.has(node.code)) return CHUNK_CIVIC_CORE;
  const named = CHUNK_BY_CODE.get(node.code);
  if (named) return named;
  // Quadrant fallback (grid is 1..7, plaza at 4,4): south row first,
  // then west/east of the plaza column.
  if (node.y > 4) return CHUNK_SOUTH;
  if (node.x < 4) return CHUNK_DISTRICT_1;
  if (node.x > 4) return CHUNK_DISTRICT_3;
  return CHUNK_CIVIC_CORE;
}

// Group layout nodes into chunks: Map<chunkId, node[]> in layout order.
export function chunkLayout(layout) {
  const chunks = new Map();
  for (const node of layout?.nodes || []) {
    const id = chunkOfNode(node);
    if (!chunks.has(id)) chunks.set(id, []);
    chunks.get(id).push(node);
  }
  return chunks;
}

// ------------------------------------------------------------ LOD bands
// Distances are world units (1 grid cell = 10 units; the follow camera
// frames a figure from ≈26 units, the overview from ≈220). Bands:
//   d <  LOD0_MAX  -> 'lod0'    (detailed kit, follow range)
//   d <  LOD1_MAX  -> 'lod1'    (flat-colour kit, neighbourhood range)
//   else           -> 'standee' (town altitude: the M4.09 sprite)
export const LOD0_MAX = 40;
export const LOD1_MAX = 110;

export function lodForDistance(d) {
  if (!Number.isFinite(d) || d < 0) {
    throw new TypeError('lodForDistance: distance must be a non-negative number');
  }
  if (d < LOD0_MAX) return 'lod0';
  if (d < LOD1_MAX) return 'lod1';
  return 'standee';
}

// The representation swap rule (M4.09): a standee never slides, and a
// figure never changes representation mid-route — a swap is allowed
// only when the figure is AT a place (between === null). Returns the
// representation the figure should show this frame: the band's choice
// when a swap is legal, otherwise the current one.
export function representationFor({ current, distance, between }) {
  const wanted = lodForDistance(distance);
  if (wanted === current) return current;
  if (between) return current; // mid-route: hold — swapping here would pop a walking figure
  return wanted;
}

// The standee sprite a kit entry renders at town altitude: the idle
// sprite named by the entry's own standee manifest (sprites live
// beside the manifests, in standees/sprites/). Null when the entry
// carries no standee manifest — the caller keeps the kit figure.
export function standeeSpriteUrl(entry) {
  if (!entry || !entry.standeeManifest || !entry.kit) return null;
  const dir = entry.standeeManifest.slice(0, entry.standeeManifest.lastIndexOf('/') + 1);
  return `${dir}sprites/${entry.kit}--idle.webp`;
}

// ---------------------------------------------------------- actor budget
// M4.16's gate, verbatim: "a 31-figure bundle renders 30 + rail
// overflow, not 31". MAX_ACTORS is that 30. Assignment is stable:
// figures keep the bundle's own order; the overflow keeps it too, so
// the rail reads in the same order as the roster.
export const MAX_ACTORS = 30;

export function assignActors(keys) {
  if (!Array.isArray(keys)) throw new TypeError('assignActors: keys must be an array');
  const seen = new Set();
  for (const k of keys) {
    if (seen.has(k)) throw new Error(`assignActors: duplicate key ${k} — a figure is never embodied twice`);
    seen.add(k);
  }
  return {
    actors: keys.slice(0, MAX_ACTORS),
    rail: keys.slice(MAX_ACTORS),
  };
}
