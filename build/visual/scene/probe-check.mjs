// Elsewhere Portal — scene probe check (analytic, Node, no external deps).
//
// The Bible gate (LOOK-BIBLE-V0 §4 / visual-plan 01 §1.2): shadow/lit
// luminance ratio 0.50–0.65 at three probe points — cobble in sun,
// cobble in College shadow, a figure's shadow-side cheek. The in-page
// probe in scene.mjs measures this by pixel sampling and is the
// primary method at capture time. This script is the analytic twin:
// it replicates the exact r186 shader math from the vendored source —
//   * getGradientIrradiance: gradient texel at coord dotNL*0.5+0.5,
//     NearestFilter over the rig gradient texels (tokens)
//   * getHemisphereLightIrradiance: mix(ground, sky, 0.5*dotNL+0.5)
//   * BRDF_Lambert 1/PI factor on every term (kept for absolutes)
//   * NeutralToneMapping GLSL verbatim (StartCompression 0.76, Desat 0.15)
//   * sRGB output encode, then display-space luminance (0.2126/0.7152/0.0722)
//     on the 0–255 values, matching the in-page sampler's definition.
// Rig values come from the generated palette (palette.mjs ← tokens),
// so this check can never drift from the scene's own numbers.
//
// M4.07 CALIBRATION + CORRECTION (RIG-AS-BUILT has the full record):
// the previous cheek model zeroed the sun on the sphere's SE limb and
// called it "shadow-side". Live pixels read that limb at ratio 0.906
// while the old model predicted 0.549: the limb faces the SE fill and
// the hemisphere dome — it is not in shadow — and with
// shadowNormalBias 0.6 the shadow map does not darken it either. This
// model computes the sampler's TRUE surface normals by replicating
// its camera geometry and raycasting the probe sphere, and with the
// sun left ON at both sunlit-sphere points it reproduces the live
// reads (cobble 0.580 modelled vs 0.602 live; fill-limb 0.908 vs
// 0.906 live). The gated cheek pair is therefore the cast-shadow pair
// the Bible names — the same sun-side cheek point on the sunlit
// sphere vs on the identical sphere standing in the College's cast
// shadow (scene.mjs buildProbes). The SE-limb read is kept as a
// labelled diagnostic. PCFSoft edge softness remains the known
// residual vs pixel sampling (the cobble pair's +0.022 live delta).
//
// Run: node probe-check.mjs   (exit 1 if a gated ratio is out of band)

import { ANCHORS, RIG_TOKENS } from './palette.mjs';

const TEXELS = RIG_TOKENS.gradientTexels.map((t) => parseInt(t.slice(1, 3), 16));
const RIG = {
  sun: { hex: RIG_TOKENS.sunColor, i: RIG_TOKENS.sunIntensity, pos: [-38, 52, -26] },
  hemi: { sky: RIG_TOKENS.hemiSky, ground: RIG_TOKENS.hemiGround, i: RIG_TOKENS.hemiIntensity },
  fill: { hex: RIG_TOKENS.fillColor, i: RIG_TOKENS.fillIntensity, pos: [30, 18, 34] },
  exposure: RIG_TOKENS.exposure,
};

const srgb2lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const hex2lin = (h) => [1, 3, 5].map((i) => srgb2lin(parseInt(h.slice(i, i + 2), 16)));
const lin2srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const grad = (d) => TEXELS[Math.min(3, Math.floor(Math.min(1, Math.max(0, d * 0.5 + 0.5)) * 4))] / 255;
const scaled = (hex, i) => hex2lin(hex).map((v) => v * i);

function neutral(color, exposure) {
  let c = color.map((v) => v * exposure);
  const x = Math.min(...c);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c = c.map((v) => v - offset);
  const peak = Math.max(...c), SC = 0.8 - 0.04;
  if (peak < SC) return c;
  const d = 1 - SC, newPeak = 1 - (d * d) / (peak + d - SC);
  c = c.map((v) => (v * newPeak) / peak);
  const g = 1 - 1 / (0.15 * (peak - newPeak) + 1);
  return c.map((v) => v + (newPeak - v) * g);
}
function irradiance(n, sunShadow) {
  const sunDir = norm(RIG.sun.pos), fillDir = norm(RIG.fill.pos);
  const total = [0, 0, 0];
  const sc = scaled(RIG.sun.hex, RIG.sun.i), fc = scaled(RIG.fill.hex, RIG.fill.i);
  const gSun = grad(dot(n, sunDir)) * sunShadow, gFill = grad(dot(n, fillDir));
  for (let i = 0; i < 3; i++) total[i] += sc[i] * gSun + fc[i] * gFill;
  const w = 0.5 * dot(n, [0, 1, 0]) + 0.5;
  const sky = scaled(RIG.hemi.sky, RIG.hemi.i), gnd = scaled(RIG.hemi.ground, RIG.hemi.i);
  for (let i = 0; i < 3; i++) total[i] += gnd[i] + (sky[i] - gnd[i]) * w;
  return total;
}
function lumAt(albedo, n, sunShadow) {
  const alb = typeof albedo === 'string' ? hex2lin(albedo) : albedo;
  const irr = irradiance(n, sunShadow);
  const lin = alb.map((a, i) => (a * irr[i]) / Math.PI);
  const rgb = neutral(lin, RIG.exposure).map((c) => Math.max(0, Math.min(1, lin2srgb(c))) * 255);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

// ------------------------------------------------- sampler geometry
// Replicates scene.mjs runProbe's cheek frame in plain math:
// perspective 28°, camera at elevation 35° from the south, distance
// 7.5 from the sphere centre (radius 1.05). Sample offsets are
// fractions of the projected radius rPx (the sampler's single rPx
// serves both axes), so the ray's tangent-plane coordinates collapse
// to (fx·R/d, −fy·R/d) and the ratios are frame-size independent.
// Camera basis: right = (1,0,0), up = (0,C,−S), forward = (0,−S,−C).
const ELEV = 35 * Math.PI / 180, S = Math.sin(ELEV), C = Math.cos(ELEV);
const SPHERE_R = 1.05, CAM_DIST = 7.5;
function cheekNormal(fx, fy) {
  const dx = fx * SPHERE_R / CAM_DIST, dy = -fy * SPHERE_R / CAM_DIST;
  const dir = norm([dx, C * dy - S, -S * dy - C]);
  const origin = [0, S * CAM_DIST, C * CAM_DIST]; // relative to sphere centre
  const b = dot(origin, dir), cTerm = dot(origin, origin) - SPHERE_R * SPHERE_R;
  const disc = b * b - cTerm;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return norm(origin.map((o, i) => o + t * dir[i]));
}
function cheekLum(fx, fy, sunShadow) {
  // 5×5 average like the sampler (±2 px around the point; rPx ≈ 225
  // at the reference frame, so px offsets are fractions /225).
  let sum = 0, n = 0;
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const nrm = cheekNormal(fx + i / 225, fy + j / 225);
    if (!nrm) continue;
    sum += lumAt(ANCHORS.skin_base, nrm, sunShadow); n++;
  }
  return sum / n;
}

const UP = [0, 1, 0];
const cobbleLit = lumAt(ANCHORS.cobble_lit, UP, 1), cobbleSh = lumAt(ANCHORS.cobble_lit, UP, 0);
const cheekLit = cheekLum(-0.55, -0.5, 1), cheekSh = cheekLum(-0.55, -0.5, 0);
const results = [
  ['cobble (College shadow / sun)', cobbleSh / cobbleLit, cobbleLit, cobbleSh],
  ['cheek (cast shadow / sun)', cheekSh / cheekLit, cheekLit, cheekSh],
];
let ok = true;
for (const [name, ratio, lit, sh] of results) {
  const inBand = ratio >= 0.50 && ratio <= 0.65;
  ok = ok && inBand;
  console.log(`${name}: lit ${lit.toFixed(1)}  shadow ${sh.toFixed(1)}  ratio ${ratio.toFixed(3)}  ${inBand ? 'IN BAND 0.50–0.65' : 'OUT OF BAND'}`);
}
const fillLimb = cheekLum(0.55, 0.42, 1) / cheekLit;
console.log(`diagnostic — sunlit sphere fill-side limb ratio ${fillLimb.toFixed(3)} (faces the SE fill; not a shadow read, not gated; live pixels read 0.906 for this point)`);
console.log(`GATE (analytic): ${ok ? 'PASS' : 'FAIL'} — rig sun ${RIG.sun.i}, hemi ${RIG.hemi.i}, fill ${RIG.fill.i}, Neutral @ ${RIG.exposure}`);
process.exit(ok ? 0 : 1);
