// Elsewhere Portal — scene materials (M4.07 pastel material treatment).
//
// The six building families (civic / college / market / work / social /
// home) as token-driven materials. Every colour comes from the
// generated palette (palette.mjs ← build/visual/tokens/tokens.json):
// this module contains NO colour literals of its own, and neither does
// scene.mjs — the test suite pins that.
//
// Treatment (plan M4.07: "flat colour + gradient atlases; fixed NW
// light, soft shadows"):
//   - flat colour: MeshToonMaterial under the shared rig gradient map
//     (the Bible §4 banding), one material per (family, role).
//   - gradient atlases: each textured role (wall, roof) carries a
//     vertical gradient atlas generated from its own token colour —
//     the role colour at the top, stepping down through the rig
//     gradient map's own band ratios toward the base, the way the
//     approved samples shade a wall toward its foot. The atlas is
//     DERIVED (band ratios from rig.gradientMap tokens), never painted
//     with invented colours.
//   - the light rig itself is scene.mjs's RIG, fed from the same
//     palette's rig tokens; materials.mjs never touches lights.
//
// Pure helpers (hex/luminance/shade/gradient stops) are exported for
// the greyscale drill in test/materials.test.mjs: state distinctions
// must survive a greyscale render, so the drill reads luminances from
// here rather than re-deriving them.

import { ANCHORS, FAMILIES, RIG_TOKENS } from './palette.mjs';

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase()).join('');
}
/** Display-space relative luminance (the probe's definition). */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Hue-preserving shade: scale the sRGB channels by f. */
export function shade(hex, f) {
  return rgbToHex(hexToRgb(hex).map((v) => v * f));
}

/** The rig gradient map's band ratios, brightest last (tokens store
 *  the texels as grey hexes — the ratio is the channel byte / 255). */
export function gradientBandRatios() {
  return RIG_TOKENS.gradientTexels.map((t) => parseInt(t.slice(1, 3), 16) / 255);
}

/**
 * Gradient atlas stops for one role colour, in texture-v space
 * (v = 0 at the base of a wall, v = 1 at its top): the rig's own band
 * ratios walking up — texel 1 at the base, texel 2 mid-wall, the full
 * colour at the top. The floor texel (deepest shade band) is not
 * used — a wall base in the deepest band would read as a different
 * material, and the samples shade walls gently.
 */
export function gradientStops(hex) {
  const bands = gradientBandRatios(); // [floor, low, high, full]
  return [
    { at: 0, hex: shade(hex, bands[1]) },
    { at: 0.38, hex: shade(hex, bands[2]) },
    { at: 1, hex },
  ];
}

const ATLAS_H = 64;
/** Pure atlas raster: { width: 1, height, data: Uint8Array(RGBA) }. */
export function gradientAtlasData(hex) {
  const stops = gradientStops(hex);
  const data = new Uint8Array(ATLAS_H * 4);
  for (let y = 0; y < ATLAS_H; y++) {
    const t = y / (ATLAS_H - 1); // DataTexture row 0 is v=0 (flipY=false): the wall's base
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i].at && t <= stops[i + 1].at) { a = stops[i]; b = stops[i + 1]; break; }
    }
    const span = (b.at - a.at) || 1;
    const f = Math.max(0, Math.min(1, (t - a.at) / span));
    const ca = hexToRgb(a.hex), cb = hexToRgb(b.hex);
    for (let c = 0; c < 3; c++) data[y * 4 + c] = Math.round(ca[c] + (cb[c] - ca[c]) * f);
    data[y * 4 + 3] = 255;
  }
  return { width: 1, height: ATLAS_H, data };
}

/** THREE wrapper around gradientAtlasData (browser + headless-safe). */
export function gradientTexture(THREE, hex) {
  const { width, height, data } = gradientAtlasData(hex);
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------- materials
const cache = new Map();
/**
 * The material set for one family: { wall, roof, trim, accent }.
 * wall/roof carry their gradient atlases (material colour white — the
 * atlas holds the colour); trim/accent are flat. gradientMap is the
 * scene's shared rig gradient map (Bible §4).
 */
export function familyMaterials(THREE, gradientMap, family) {
  const key = `fam:${family}`;
  if (cache.has(key)) return cache.get(key);
  const fam = FAMILIES[family];
  if (!fam) throw new Error(`materials: unknown family ${family}`);
  const textured = (hex) => new THREE.MeshToonMaterial({
    color: 0xffffff, map: gradientTexture(THREE, hex), gradientMap,
  });
  const flat = (hex) => new THREE.MeshToonMaterial({ color: new THREE.Color(hex), gradientMap });
  const set = {
    wall: textured(fam.roles.wall),
    roof: textured(fam.roles.roof),
    trim: flat(fam.roles.trim),
    accent: flat(fam.roles.accent),
  };
  cache.set(key, set);
  return set;
}

// ------------------------------------------------- T2 street wear
// Look touch-up T2b (lane-look-touchup-scope.md §T2): the street
// strips' wear texture, derived by the same machinery as the wall
// gradient atlases above — every colour in it is a palette value or
// a shade() of one by a rig gradient band ratio, never an invented
// hex (this module holds no colour literals, and the streets test
// censuses the texture's colours back to these derivations).
//
// The texture is 1 texel along the street (U — constant by
// construction, so nothing in it can run across the path) by
// WEAR_ROWS texels across it (V). A street strip's PlaneGeometry
// runs U along its length and V across its width, so the cross
// profile below lands across every segment, in that segment's own
// frame: two darker wheel tracks, a lighter centre, the base cobble
// elsewhere — following bends because each segment carries it.
// The profile is symmetric about the centre, so the texture reads
// the same whichever way a segment's V axis happens to point.
// Bands are discrete (no interpolation between stops): in the toon
// register the hard band IS the shading, and discreteness is what
// makes the colour census exact.
export const STREET_WEAR_ROWS = 128;
export const STREET_WEAR_PROFILE = {
  // Cross-street positions, in V space (0 = one edge, 1 = the other).
  trackCentres: [0.27, 0.73],
  trackHalfWidth: 0.09,
  centreHalfWidth: 0.09,
};

/**
 * The wear palette: exactly three derived colours.
 *   base   — the street cobble anchor itself (paving_shaded, the
 *            strips' flat colour before this texture).
 *   track  — the base shaded by the rig gradient map's low band
 *            ratio (gradientBandRatios()[1] — the same derivation
 *            the wall atlases use for their base stop).
 *   centre — the lit cobble anchor itself (cobble_lit, the Plaza's
 *            paving tone): lighter than the base, still a cobble
 *            token, not a lightened invention.
 */
export function streetWearPalette(baseHex = ANCHORS.paving_shaded, litHex = ANCHORS.cobble_lit) {
  return {
    base: baseHex,
    track: shade(baseHex, gradientBandRatios()[1]),
    centre: litHex,
  };
}

/** Which wear zone a cross-street position t ∈ [0, 1] falls in. */
export function streetWearZoneAt(t, profile = STREET_WEAR_PROFILE) {
  if (Math.abs(t - 0.5) <= profile.centreHalfWidth) return 'centre';
  for (const c of profile.trackCentres) {
    if (Math.abs(t - c) <= profile.trackHalfWidth) return 'track';
  }
  return 'base';
}

/** The derived colour at cross-street position t. */
export function streetWearColorAt(t, palette = streetWearPalette()) {
  return palette[streetWearZoneAt(t)];
}

const WEAR_ATLAS_W = 1;
/** Pure wear raster: { width: 1, height, data: Uint8Array(RGBA) }.
 *  Row y is V = y / (height - 1), the cross-street axis. */
export function streetWearTextureData(baseHex = ANCHORS.paving_shaded, litHex = ANCHORS.cobble_lit) {
  const palette = streetWearPalette(baseHex, litHex);
  const data = new Uint8Array(WEAR_ATLAS_W * STREET_WEAR_ROWS * 4);
  for (let y = 0; y < STREET_WEAR_ROWS; y++) {
    const hex = streetWearColorAt(y / (STREET_WEAR_ROWS - 1), palette);
    const [r, g, b] = hexToRgb(hex);
    data[y * 4] = r; data[y * 4 + 1] = g; data[y * 4 + 2] = b; data[y * 4 + 3] = 255;
  }
  return { width: WEAR_ATLAS_W, height: STREET_WEAR_ROWS, data };
}

/** THREE wrapper around streetWearTextureData (browser + headless-safe). */
export function streetWearTexture(THREE, baseHex = ANCHORS.paving_shaded, litHex = ANCHORS.cobble_lit) {
  const { width, height, data } = streetWearTextureData(baseHex, litHex);
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The street strips' material: white-based toon material carrying
 * the wear texture (the atlas holds the colour, exactly as the
 * family wall/roof materials do), banded by the shared rig
 * gradient map. Cached like the family sets.
 */
export function streetMaterial(THREE, gradientMap, baseHex = ANCHORS.paving_shaded, litHex = ANCHORS.cobble_lit) {
  const key = `street-wear:${baseHex}|${litHex}`;
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshToonMaterial({
    color: 0xffffff, map: streetWearTexture(THREE, baseHex, litHex), gradientMap,
  });
  cache.set(key, m);
  return m;
}

/** A single flat toon material from an anchor hex (ground, streets, skin). */
export function anchorMaterial(THREE, gradientMap, hex, opts = {}) {
  const key = `anchor:${hex}|${opts.opacity ?? 1}`;
  if (!cache.has(key)) {
    const m = new THREE.MeshToonMaterial({ color: new THREE.Color(hex), gradientMap, ...opts });
    if (opts.opacity !== undefined && opts.opacity < 1) m.transparent = true;
    cache.set(key, m);
  }
  return cache.get(key);
}
