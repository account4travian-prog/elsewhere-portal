#!/usr/bin/env node
// extract-palette.mjs — Elsewhere Portal Look Bible palette extraction (VW-1).
//
// Method (per visual-plan/03-refinement.md §1.1): patch-median sampling at
// named anchor points + median-cut dominant clustering, rerunnable.
// The sampled anchors are the palette authority for the Look Bible; the
// hand-picked constants in visual-plan/01-rendering-scene.md §2.2 are
// implementation starting values. This script measures both and reports
// the divergence (CIEDE2000) per anchor class.
//
// Decoder: Node stdlib has no WebP decoder and the approved samples are
// .webp files, so pixel decoding shells out to python3 + Pillow (PIL
// 10.2.0 on this VM, WebP support verified) which writes raw RGB bytes to
// a temp file. All sampling, clustering and colour math below is Node
// stdlib only.
//
// Determinism: fixed patch table, fixed subsample stride, median-cut with
// total-order tie-breaking, per-channel medians, fixed JSON key order, no
// timestamps. Two runs on the same samples produce byte-identical output.
//
// Ruled amendments: an anchor's governing hex may be superseded by a
// Owner ruling (visual-plan/03-refinement.md §1.5 — his eye outranks
// the sampled hexes; the hexes were only ever a transcription of his
// samples). An amendment is recorded in RULED_AMENDMENTS below, never
// as a hand edit of palette-anchors.json: this script remains the only
// writer of that file, the sampled patches stay in the output as the
// evidence they are, and the amended anchor carries its sampled hex
// plus the ruling that superseded it. Re-running this script therefore
// reproduces the amended file byte-for-byte.
//
// Usage: node extract-palette.mjs [--out palette-anchors.json]
// Run from build/visual/ (paths are resolved relative to this file).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(HERE, '..', '..', 'samples');
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : join(HERE, 'palette-anchors.json');

const SAMPLES = [
  {
    id: 'sample-1-plaza',
    register: 'exterior-3d',
    file: 'media-generation-sample-1-plaza-wide-0-52f7b39c-b4ab-4b56-b5e6-0e80e24b25ec.webp',
  },
  {
    id: 'sample-2-college-cutaway',
    register: 'interior-3d',
    file: 'media-generation-sample-2-college-cutaway-0-3ec118ff-5999-4ab4-9db3-678ab2b79efb.webp',
  },
  {
    id: 'sample-3-street-alt',
    register: 'flat-2d',
    file: 'media-generation-sample-3-street-alt-style-0-ffb35b22-8f48-4c1f-812a-49d1f262d912.webp',
  },
];

// Anchor patch table. Centres are normalised (x, y) fractions of the frame;
// size is the square patch edge in pixels at full resolution (a patch entry
// may carry its own size as a third element). Patch locations were placed on
// the named surfaces by eye against the samples (the same named anchor
// points Refinement §1.1 describes), then verified against annotated
// overlays of all three samples and corrected where a patch straddled a
// neighbouring surface (crate, figure, roof slope, page background).
// planConstant = the hand-picked constant in 01-rendering-scene.md §2.2 for
// the same class (implementation starting value), or null where §2.2 has none.
const ANCHORS = [
  // --- Sample 1: exterior ---
  { id: 'sky_upper', sample: 'sample-1-plaza', size: 41, patches: [[0.45, 0.045], [0.07, 0.05]], planConstant: '#A8D4EC', planConstantName: 'sky zenith' },
  { id: 'grass_sunlit', sample: 'sample-1-plaza', size: 41, patches: [[0.63, 0.72], [0.945, 0.83]], planConstant: '#B7E2A0', planConstantName: 'grass base', planConstantSecondary: '#CDEBB4' },
  { id: 'grass_shade', sample: 'sample-1-plaza', size: 41, patches: [[0.055, 0.845], [0.30, 0.855]], planConstant: '#8FD0A0', planConstantName: 'leaf green' },
  { id: 'cobble_lit', sample: 'sample-1-plaza', size: 41, patches: [[0.42, 0.83], [0.415, 0.585]], planConstant: '#E9E2D2', planConstantName: 'plaza cobble' },
  { id: 'paving_shaded', sample: 'sample-1-plaza', size: 41, patches: [[0.215, 0.625], [0.49, 0.955]], planConstant: '#CFC4AC', planConstantName: 'cobble grout/shadow step' },
  { id: 'roof_lavender_college', sample: 'sample-1-plaza', size: 41, patches: [[0.43, 0.125], [0.475, 0.155]], planConstant: '#A78FD0', planConstantName: 'College purple (roof/trim)' },
  { id: 'roof_blush_spire', sample: 'sample-1-plaza', size: 41, patches: [[0.755, 0.2]], planConstant: '#F2B8C6', planConstantName: 'Town Hall pink (roof)' },
  { id: 'timber_structural', sample: 'sample-1-plaza', size: 25, patches: [[0.107, 0.333], [0.316, 0.44]], planConstant: '#8A6742', planConstantName: 'timber dark (doors, beams)', planConstantSecondary: '#B98A5E' },
  { id: 'trim_pale', sample: 'sample-1-plaza', size: 41, patches: [[0.775, 0.415], [0.183, 0.825]], planConstant: '#FBF3E2', planConstantName: 'cream plaster' },
  { id: 'blossom_pink', sample: 'sample-1-plaza', size: 41, patches: [[0.885, 0.165], [0.038, 0.235]], planConstant: '#F6C9D8', planConstantName: 'blossom pink' },
  { id: 'awning_banner_cream', sample: 'sample-1-plaza', size: 31, patches: [[0.222, 0.434], [0.682, 0.464]], planConstant: '#FFF6EA', planConstantName: 'awning stripe cream' },
  { id: 'skin_base', sample: 'sample-1-plaza', size: 15, patches: [[0.351, 0.573], [0.417, 0.578]], planConstant: null, planConstantName: null },
  { id: 'sign_wood', sample: 'sample-1-plaza', size: 41, patches: [[0.501, 0.647]], planConstant: '#B98A5E', planConstantName: 'timber (warm wood)' },
  // --- Sample 2: interior ---
  { id: 'interior_floor_wood', sample: 'sample-2-college-cutaway', size: 41, patches: [[0.6, 0.865], [0.79, 0.775]], planConstant: '#E8C39A', planConstantName: 'interior wood' },
  { id: 'interior_frame_timber', sample: 'sample-2-college-cutaway', size: 31, patches: [[0.5, 0.166], [0.297, 0.42, 25]], planConstant: '#B98A5E', planConstantName: 'timber (warm wood)' },
  { id: 'interior_wall_mint', sample: 'sample-2-college-cutaway', size: 41, patches: [[0.128, 0.52], [0.845, 0.3]], planConstant: '#CFE3D2', planConstantName: 'interior wall mint' },
  { id: 'interior_chalkboard', sample: 'sample-2-college-cutaway', size: 41, patches: [[0.4, 0.295], [0.333, 0.474]], planConstant: '#5E7D6A', planConstantName: 'chalk green' },
  { id: 'interior_curtain_cream', sample: 'sample-2-college-cutaway', size: 31, patches: [[0.648, 0.44], [0.838, 0.4]], planConstant: null, planConstantName: null },
  { id: 'interior_window_glow', sample: 'sample-2-college-cutaway', size: 31, patches: [[0.743, 0.415], [0.72, 0.33]], planConstant: '#FFD9A0', planConstantName: 'warm lamp' },
  // --- Sample 3: 2D register ---
  { id: 'sky_wash_2d', sample: 'sample-3-street-alt', size: 41, patches: [[0.5, 0.055], [0.3, 0.045]], planConstant: '#FBF7EE', planConstantName: '2D paper' },
  // Line-work is thinner than any honest patch, so this anchor is
  // cluster-derived: the largest-share warm cluster (hue 10-50 deg) with
  // L* < 45 in the median-cut set — the line + deep-shadow family.
  { id: 'outline_umber_2d', sample: 'sample-3-street-alt', clusterRule: 'largest warm cluster (hue 10-50deg) with L* < 45', planConstant: '#8A6D5A', planConstantName: '2D outline brown' },
  { id: 'sage_2d', sample: 'sample-3-street-alt', size: 41, patches: [[0.28, 0.215], [0.68, 0.23]], planConstant: '#8FD0A0', planConstantName: 'leaf green' },
  { id: 'grass_wash_2d', sample: 'sample-3-street-alt', size: 41, patches: [[0.09, 0.86], [0.72, 0.9]], planConstant: '#B7E2A0', planConstantName: 'grass base' },
  { id: 'path_bluecream_2d', sample: 'sample-3-street-alt', size: 41, patches: [[0.47, 0.855], [0.415, 0.775]], planConstant: '#E9E2D2', planConstantName: 'plaza cobble' },
  { id: 'window_glow_2d', sample: 'sample-3-street-alt', size: 25, patches: [[0.887, 0.583], [0.175, 0.393]], planConstant: '#FFD9A0', planConstantName: 'warm lamp' },
  { id: 'lantern_warm_2d', sample: 'sample-3-street-alt', size: 21, patches: [[0.263, 0.848]], planConstant: '#FFD9A0', planConstantName: 'warm lamp' },
];

// Ruled amendments to sampled anchors (see the header note). Keyed by
// anchor id; `governingHex` replaces the sampled hex as the anchor's
// value everywhere downstream (tokens, scene palette, Bible target).
const RULED_AMENDMENTS = {
  grass_sunlit: {
    governingHex: '#CDEAC0',
    date: '2026-11-03',
    ruling:
      'DECISIONS.md 2026-11-03 — the project owner approved the full scoped touch-up set for building in the scoped order ("Build the touch-ups in that order")',
    scope:
      'plan-to-complete/lane-look-touchup-scope.md §T1a — settle D-T02 to one grass green: the app 2D stage\'s existing #CDEAC0 (the sampled #E5CE9D reads as sand; the plan secondary #CDEBB4 is superseded with it)',
  },
};

const CLUSTER_COUNT = 12;
const CLUSTER_STRIDE = 3; // every 3rd pixel, scanline order

// ---------- decode ----------
function decode(file) {
  const dir = mkdtempSync(join(tmpdir(), 'vw1-extract-'));
  const rawPath = join(dir, 'raw.rgb');
  const py = [
    'import sys',
    'from PIL import Image',
    'im = Image.open(sys.argv[1]).convert("RGB")',
    'open(sys.argv[2], "wb").write(im.tobytes())',
    'print(im.size[0], im.size[1])',
  ].join('\n');
  const out = execFileSync('python3', ['-c', py, file, rawPath], { encoding: 'utf8' });
  const [w, h] = out.trim().split(/\s+/).map(Number);
  const rgb = readFileSync(rawPath);
  rmSync(dir, { recursive: true, force: true });
  if (rgb.length !== w * h * 3) throw new Error(`decode size mismatch for ${file}`);
  return { w, h, rgb };
}

// ---------- colour helpers ----------
const hexOf = (r, g, b) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const parseHex = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
function median(vals) {
  const s = [...vals].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2);
}
function medianColour(pixels) {
  return [
    median(pixels.map((p) => p[0])),
    median(pixels.map((p) => p[1])),
    median(pixels.map((p) => p[2])),
  ];
}

// CIEDE2000 (standard formulation; deterministic double math).
function lab(r, g, b) {
  const f = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = f(r), G = f(g), B = f(b);
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const gf = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  X = gf(X); Y = gf(Y); Z = gf(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
function deltaE00(hexA, hexB) {
  const [L1, a1, b1] = lab(...parseHex(hexA));
  const [L2, a2, b2] = lab(...parseHex(hexB));
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (ap, b) => {
    if (ap === 0 && b === 0) return 0;
    const d = Math.atan2(b, ap) / rad;
    return d >= 0 ? d : d + 360;
  };
  const h1p = h(a1p, b1), h2p = h(a2p, b2);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = h2p - h1p;
  if (C1p * C2p === 0) dhp = 0;
  else if (dhp > 180) dhp -= 360;
  else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbarp = (L1 + L2) / 2, Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else hbarp = (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2;
  const T =
    1 - 0.17 * Math.cos((hbarp - 30) * rad) + 0.24 * Math.cos(2 * hbarp * rad) +
    0.32 * Math.cos((3 * hbarp + 6) * rad) - 0.2 * Math.cos((4 * hbarp - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbarp, 7) / (Math.pow(Cbarp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  const dE = Math.sqrt(
    Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) +
    Rt * (dCp / Sc) * (dHp / Sh)
  );
  return Math.round(dE * 100) / 100;
}

// ---------- median-cut clustering (deterministic) ----------
function medianCut(pixels, target) {
  let boxes = [pixels];
  const rangesOf = (box) => {
    let mn = [255, 255, 255], mx = [0, 0, 0];
    for (const p of box) for (let c = 0; c < 3; c++) {
      if (p[c] < mn[c]) mn[c] = p[c];
      if (p[c] > mx[c]) mx[c] = p[c];
    }
    return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  };
  while (boxes.length < target) {
    // choose box: greatest max-range, then larger population, then lowest index
    let best = -1, bestKey = null;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const r = rangesOf(box);
      const key = [Math.max(...r), box.length, -i];
      if (!bestKey || key[0] > bestKey[0] ||
          (key[0] === bestKey[0] && (key[1] > bestKey[1] ||
           (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
        best = i; bestKey = key;
      }
    });
    if (best < 0) break;
    const box = boxes[best];
    const r = rangesOf(box);
    let ch = 0;
    for (let c = 1; c < 3; c++) if (r[c] > r[ch]) ch = c; // ties keep R,G,B order
    const sorted = [...box].sort((p, q) =>
      p[ch] - q[ch] || p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    const mid = Math.floor(sorted.length / 2);
    boxes.splice(best, 1, sorted.slice(0, mid), sorted.slice(mid));
  }
  return boxes
    .map((box) => {
      const [r, g, b] = medianColour(box);
      return { hex: hexOf(r, g, b), count: box.length };
    })
    .sort((a, b) => b.count - a.count || (a.hex < b.hex ? -1 : 1));
}

// ---------- run ----------
const decoded = {};
const sampleMeta = {};
for (const s of SAMPLES) {
  const path = join(SAMPLES_DIR, s.file);
  const bytes = readFileSync(path);
  sampleMeta[s.id] = {
    ...s,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  decoded[s.id] = decode(path);
  sampleMeta[s.id].width = decoded[s.id].w;
  sampleMeta[s.id].height = decoded[s.id].h;
}

function patchPixels(img, cx, cy, size) {
  const px = Math.round(cx * img.w), py = Math.round(cy * img.h);
  const half = Math.floor(size / 2);
  const x0 = Math.max(0, px - half), x1 = Math.min(img.w - 1, px + half);
  const y0 = Math.max(0, py - half), y1 = Math.min(img.h - 1, py + half);
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * img.w + x) * 3;
    out.push([img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]]);
  }
  return { pixels: out, rect: { x0, y0, x1, y1 } };
}

const clusters = {};
for (const s of SAMPLES) {
  const img = decoded[s.id];
  const sub = [];
  const total = img.w * img.h;
  for (let i = 0; i < total; i += CLUSTER_STRIDE) {
    const j = i * 3;
    sub.push([img.rgb[j], img.rgb[j + 1], img.rgb[j + 2]]);
  }
  const boxes = medianCut(sub, CLUSTER_COUNT);
  clusters[s.id] = boxes.map((c) => ({
    hex: c.hex,
    sampleCount: c.count,
    sharePct: Math.round((c.count / sub.length) * 10000) / 100,
  }));
}

// Warm-dark cluster selection for the cluster-derived outline anchor.
function pickWarmDarkCluster(sampleId) {
  const cands = clusters[sampleId]
    .map((c) => {
      const [r, g, b] = parseHex(c.hex);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      let hue = 0;
      if (mx !== mn) {
        if (mx === r) hue = 60 * (((g - b) / (mx - mn)) % 6);
        else if (mx === g) hue = 60 * ((b - r) / (mx - mn) + 2);
        else hue = 60 * ((r - g) / (mx - mn) + 4);
      }
      if (hue < 0) hue += 360;
      const [L] = lab(r, g, b);
      return { ...c, hue: Math.round(hue * 10) / 10, lightness: Math.round(L * 10) / 10 };
    })
    .filter((c) => c.hue >= 10 && c.hue <= 50 && c.lightness < 45)
    .sort((x, y) => y.sampleCount - x.sampleCount || (x.hex < y.hex ? -1 : 1));
  if (!cands.length) throw new Error(`no warm-dark cluster in ${sampleId}`);
  return cands[0];
}

const anchors = ANCHORS.map((a) => {
  const base = {
    id: a.id,
    register: sampleMeta[a.sample].register,
    sourceSample: a.sample,
    planConstant: a.planConstant,
    planConstantName: a.planConstantName,
  };
  if (a.planConstantSecondary) base.planConstantSecondary = a.planConstantSecondary;
  let hex;
  if (a.clusterRule) {
    const c = pickWarmDarkCluster(a.sample);
    hex = c.hex;
    Object.assign(base, {
      hex,
      source: 'cluster',
      clusterRule: a.clusterRule,
      cluster: { hex: c.hex, hueDeg: c.hue, lightness: c.lightness, sharePct: c.sharePct },
      patches: [],
      sampleCount: c.sampleCount,
      sampleBasis: `median-cut cluster subsample (stride ${CLUSTER_STRIDE})`,
    });
  } else {
    const img = decoded[a.sample];
    const pooled = [];
    const patchResults = a.patches.map(([cx, cy, sizeOverride]) => {
      const size = sizeOverride ?? a.size;
      const { pixels, rect } = patchPixels(img, cx, cy, size);
      pooled.push(...pixels);
      const [r, g, b] = medianColour(pixels);
      return { centre: [cx, cy], size, rect, hex: hexOf(r, g, b), sampleCount: pixels.length };
    });
    const [r, g, b] = medianColour(pooled);
    hex = hexOf(r, g, b);
    Object.assign(base, {
      hex,
      source: 'patch',
      patchSize: a.size,
      patches: patchResults,
      sampleCount: pooled.length,
    });
  }
  const amendment = RULED_AMENDMENTS[a.id];
  if (amendment) {
    // The patches/cluster above stay as sampled evidence; only the
    // governing value moves, and the ΔE fields below are then computed
    // against the governing hex, like every other anchor.
    base.sampledHex = hex;
    base.amendment = {
      kind: 'ruled-amendment',
      date: amendment.date,
      ruling: amendment.ruling,
      scope: amendment.scope,
      supersedesSampledHex: hex,
    };
    hex = amendment.governingHex;
    base.hex = hex;
  }
  base.deltaE00VsPlanConstant = a.planConstant ? deltaE00(hex, a.planConstant) : null;
  if (a.planConstantSecondary) {
    base.deltaE00VsPlanConstantSecondary = deltaE00(hex, a.planConstantSecondary);
  }
  return base;
});

const doc = {
  schema: 'portal.palette-anchors/v0',
  method:
    'Patch-median sampling at named anchor points + median-cut dominant clustering, ' +
    'per visual-plan/03-refinement.md §1.1. Decoder: python3 + Pillow (PIL) raw RGB ' +
    'dump (samples are .webp; Node stdlib has no WebP decoder). All sampling and ' +
    'colour math in Node. Deterministic: fixed patch table, fixed cluster stride, ' +
    'total-order tie-breaking, no timestamps.',
  decoder: 'python3 + Pillow (PIL 10.2.0), WebP support verified on this VM',
  clusterParams: { clusters: CLUSTER_COUNT, stride: CLUSTER_STRIDE, pixelsSampledPerImage: 'ceil(w*h/stride)' },
  samples: SAMPLES.map((s) => sampleMeta[s.id]),
  anchors,
  clusters,
};

writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
console.log(`wrote ${OUT}`);
console.log(`anchors: ${anchors.length}`);
for (const a of anchors) {
  console.log(
    `  ${a.id.padEnd(24)} ${a.hex}  samples=${a.sampleCount}` +
    (a.planConstant ? `  plan ${a.planConstant}  dE00=${a.deltaE00VsPlanConstant}` : '  plan (none)')
  );
}
