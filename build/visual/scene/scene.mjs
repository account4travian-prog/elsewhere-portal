// Elsewhere Portal — 3D scene (visual wave; rig proof VW-1, asset spine M4).
//
// Purpose: judge frame, light, and camera. The scene still builds
// procedural placeholder geometry in the sampled palette of
// ../LOOK-BIBLE-V0.md as its scaffold, and the asset spine replaces
// the blocks without touching the rig: factory figure kits over the
// citizen capsules (M4.10) and the M4.14 building set over the
// building blocks (buildings.mjs) — a kit that fails to load leaves
// its placeholder standing and is reported. No build step; ES
// modules like the rest of the project.
//
// Data is loaded, never hardcoded:
//   layout  ../../shared/ember-layout.json   (real shared layout)
//   bundle  ../../data/feed/world-data.json  (live Portal bundle)
//   citizen positions + staged fill + identity colours come from the app's
//   own pure logic (../../app/logic.mjs): citizenPositions / effectiveLayout
//   / citizenColor / citizenCaption — the same semantics the 2D app ships.
//
// HELD SEAM (OM15-C2): figure treatment is also the app logic's call
// (figureStyle). A place-conflict HOLD is a property of the bundle
// STREAM — the M3.04 tracker compares successive bundles and finds two
// claims in one tick — so this scaffold, which boots from ONE bundle,
// cannot know any holds today, and buildWorld is therefore called
// with no held set. The seam is buildWorld's third argument,
// { heldKeys: Set<PORTAL-KEY> }: when a stream source lands here, pass
// the tracker's held keys and held figures get the ghost treatment
// (faded + dashed amber ground ring + a ≠ marker overhead) through the
// same figureStyle the 2D stage uses. Until then the treatment code
// runs on every citizen and simply never sees a hold.
//
// FIGURE LOADER (M4.16): figure-loader.mjs is this scene's one GLTF
// loading path — a GLTFLoader with the vendored MeshoptDecoder wired
// in, which the factory web profile's meshopt-compressed GLBs require
// (the M4.05 debt, now closed; the wiring is pinned by
// test/figure-loader.test.mjs). Kit placement (M4.10) loads through
// loadFigure() here and through nothing else: buildWorld still draws
// a capsule placeholder per citizen, then boot attaches the factory
// kits named by figure-kits.json (figure-kits.mjs) over the capsules
// of the citizens they cover. Citizens the manifest does NOT cover
// are held out of the figure layer entirely (2026-11-03, G-J1
// touch-up audit close-out — see KITLESS HOLDOUT in boot below):
// never stood in with the capsule, which would show a generic human
// figure for a citizen who may not be one (Pound Meridian is a cat).
//
// Rig: LOOK-BIBLE-V0.md §4 baseline rig card, implemented literally in RIG
// below. Deviations found while building are recorded in RIG-AS-BUILT.md.

import * as THREE from './vendor/three.module.js';
import { citizenPositions, citizenColor, citizenCaption, effectiveLayout, figureStyle, workTier } from '../../app/logic.mjs';
import { createFigureLoader, parseFigure } from './figure-loader.mjs';
import { attachFigureKits, KIT_MANIFEST_URL } from './figure-kits.mjs';
import {
  attachBuildings, buildingConditionLine, BUILDING_MANIFEST_URL,
  registerBuildingLevel, applyBuildingLevel, buildingLevelState, levelChipEnabled,
} from './buildings.mjs';
import { resolveLabels, shortName, stationLabelPlacement, CHIP_FONT_PX, CHIP_PAD_X_PX } from './labels.mjs';
import { streetPathFor, endForNode, fillNodeGeometry, streetPiecesForPath } from './streets.mjs';
import { chunkOfNode, assignActors, representationFor, standeeSpriteUrl } from './scene-system.mjs';
import { createDriver } from './playback-driver.mjs';
import { createCalmerPlayer } from './calmer.mjs';
import { planJourney } from '../../engine/playback.mjs';
import { PALETTE, ANCHORS, RIG_TOKENS, CAMERA_WORDINGS, familyForPlace } from './palette.mjs';
import {
  CAMERA_ELEVATION_RAD, CAMERA_HEIGHT_LIMITS, CAMERA_SURFACE, FOLLOW_CAMERA,
  RESET_VIEW_LABEL, WORLD_BOUNDS, applyCameraChip, cameraChipsForLayout,
  panCameraView, resetCameraView, viewForChip, worldBoundsForLayout,
  zoomCameraView, clampCameraView,
} from './camera.mjs';
import { familyMaterials, streetMaterial } from './materials.mjs';
import { loadWorkLibrary } from './work-clips.mjs';
import { loadGestureLibrary } from './gesture-clips.mjs';
import { buildTalkTimeline, sceneTalkAct, talkPanelPlacement } from './talk-state.mjs';
import { zzzSprite, ZZZ_POSITION, reclineCapsuleMeshes, ASLEEP_CLIP } from './treatments.mjs';
import { INTERIOR_KITS_URL, interiorDef, shellPlan, applyShell, interiorRenderModel, LEVEL_SET_ASIDE_LINE } from './interiors.mjs';
import { createPanControl } from './follow-interior.mjs';

// ------------------------------------------------------------------ rig card
// LOOK-BIBLE-V0 §4 values, fed from the design tokens (palette.mjs ←
// tokens.json, rig group): colours, intensities, exposure, fog and the
// gradient texels are token values, not literals (M4.07). Positions
// and shadow tuning stay here — the tokens carry no position data.
// The probe (bottom of file) measures the Bible's shadow/lit gate
// (0.50–0.65) against these; the M4.07 probe correction (the cheek
// pair now measures a cast-shadowed cheek, not a fill-lit limb) is
// recorded in RIG-AS-BUILT.md.
const hexNum = (h) => parseInt(h.replace('#', ''), 16);
const RIG = {
  sunColor: hexNum(RIG_TOKENS.sunColor), sunIntensity: RIG_TOKENS.sunIntensity, sunPos: [-38, 52, -26], // NW, elev ≈52°
  hemiSky: hexNum(RIG_TOKENS.hemiSky), hemiGround: hexNum(RIG_TOKENS.hemiGround), hemiIntensity: RIG_TOKENS.hemiIntensity,
  fillColor: hexNum(RIG_TOKENS.fillColor), fillIntensity: RIG_TOKENS.fillIntensity, fillPos: [30, 18, 34], // SE, no shadow
  exposure: RIG_TOKENS.exposure, // NeutralToneMapping
  fogColor: hexNum(RIG_TOKENS.fogColor), fogNear: RIG_TOKENS.fogNear, fogFar: RIG_TOKENS.fogFar,
  shadowMapSize: 2048, shadowBias: -0.0004, shadowNormalBias: 0.6, shadowRadius: 4,
  gradientTexels: RIG_TOKENS.gradientTexels.map((t) => hexNum(t) & 0xff), // 4-step toon gradient map
  blobAlpha: RIG_TOKENS.blobShadowAlpha, // blob shadow centre alpha
};

// Sampled palette anchors (LOOK-BIBLE-V0 §2.1), derived from the
// tokens via the generated palette — anchors arbitrate over the plan's
// hand-picked constants (REC-2). Building surfaces no longer read
// these directly: they take their family's materials (materials.mjs,
// M4.07); PAL remains for ground/streets/probe/citizen-adjacent flats.
const PAL = {
  grass: hexNum(ANCHORS.grass_sunlit), // grass, sunlit anchor — the ground
  cobbleLit: hexNum(ANCHORS.cobble_lit), // paving, cobble lit anchor — plaza + probe pads
  cobbleShade: hexNum(ANCHORS.paving_shaded), // paving, shaded anchor — streets/pads
  timber: hexNum(ANCHORS.timber_structural), // timber, structural anchor — probe post
  trimPale: hexNum(ANCHORS.trim_pale), // trim, pale anchor — plaza pedestal
  blossom: hexNum(ANCHORS.blossom_pink), // blossom pink anchor — plaza orb
  skin: hexNum(ANCHORS.skin_base), // skin, base anchor — cheek probe spheres
};

// Grid -> world: the shared layout is a 1..7 grid (plus staged fill rows).
// 1 grid cell = 10 world units, grid (4,4) (the Plaza) at the origin,
// grid +y runs south (+z), so Town Hall (y=1) stands north, at the back of
// the south-azimuth frame, as in Sample 1's composition. Layout v3
// (M4.11) bakes composed geometry into the layout file in this same
// world frame (footprint rects, door/sign anchors, street paths —
// build/visual/layout-v3-build.mjs); this scene draws from it.
const CELL = 10;
const gridToWorld = (gx, gy) => ({ x: (gx - 4) * CELL, z: (gy - 4) * CELL });
const FACE_ROT_Y = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 };
const FACE_NORMAL_V = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };

// ------------------------------------------------------------- placeholder
// Per-code placeholder FORM: heights only — scaffold proportions, kits
// replace all of this. Colour is NOT here: each building takes its
// material family's treatment (tokens material.family, via
// familyForPlace + familyMaterials, M4.07).
const BUILDING_FORM = {
  EMBER_TOWNHALL: { h: 7.5, roofH: 3.4, spire: true },
  EMBER_COLLEGE: { h: 6.0, roofH: 3.0 },
  MARKET_HALL: { h: 4.5, roofH: 2.4 },
  LIBRARY_ANNEX: { h: 5.0, roofH: 2.8 },
  PUBLIC_WORKSHOP: { h: 4.5, roofH: 2.4 },
  EMBER_DISTRICT_3_PLOT_18: { h: 5.0, roofH: 2.8 },
  EMBER_DISTRICT_1_PLOT_31: { h: 5.0, roofH: 2.8 },
  EMBER_HOME_MAPLE_COTTAGE: { h: 3.6, roofH: 2.2 },
  EMBER_HOME_WILLOW_COTTAGE: { h: 3.6, roofH: 2.2 },
};
const FORM_DEFAULT = { h: 4.5, roofH: 2.5 };

// ------------------------------------------------------------------- setup
const canvas = document.getElementById('stage');
const labelsEl = document.getElementById('labels');
const infoEl = document.getElementById('info');
const modeEl = document.getElementById('mode-line');
const probeEl = document.getElementById('probe-out');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(canvas.clientWidth || 1280, canvas.clientHeight || 800, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = RIG.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(RIG.fogColor, RIG.fogNear, RIG.fogFar);

// Shared 4-step gradient map (Bible §4) + one toon material per colour.
const gradientMap = new THREE.DataTexture(
  new Uint8Array(RIG.gradientTexels.flatMap((v) => [v, v, v, 255])), 4, 1, THREE.RGBAFormat);
gradientMap.minFilter = THREE.NearestFilter;
gradientMap.magFilter = THREE.NearestFilter;
gradientMap.generateMipmaps = false;
gradientMap.needsUpdate = true;

const matCache = new Map();
function toonMat(hex, opts = {}) {
  const key = `${hex}|${opts.opacity ?? 1}`;
  if (!matCache.has(key)) {
    const m = new THREE.MeshToonMaterial({ color: hex, gradientMap, ...opts });
    if (opts.opacity !== undefined && opts.opacity < 1) m.transparent = true;
    matCache.set(key, m);
  }
  return matCache.get(key);
}

// Lights — the fixed NW morning rig (Bible §4). Sun is the only caster.
const hemi = new THREE.HemisphereLight(RIG.hemiSky, RIG.hemiGround, RIG.hemiIntensity);
scene.add(hemi);
const sun = new THREE.DirectionalLight(RIG.sunColor, RIG.sunIntensity);
sun.position.set(...RIG.sunPos);
sun.castShadow = true;
sun.shadow.mapSize.set(RIG.shadowMapSize, RIG.shadowMapSize);
sun.shadow.camera.left = -62; sun.shadow.camera.right = 62;
sun.shadow.camera.top = 48; sun.shadow.camera.bottom = -48;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 160;
sun.shadow.bias = RIG.shadowBias;
sun.shadow.normalBias = RIG.shadowNormalBias;
sun.shadow.radius = RIG.shadowRadius;
scene.add(sun); scene.add(sun.target);
const fill = new THREE.DirectionalLight(RIG.fillColor, RIG.fillIntensity);
fill.position.set(...RIG.fillPos);
scene.add(fill); scene.add(fill.target);

// Sky: inverted-sphere gradient dome (Bible §4 stops; implementation stops —
// the rendered sky is what L1 scores against the §2.1 sky anchor).
{
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(RIG_TOKENS.skyDomeStops[0]) },
      mid: { value: new THREE.Color(RIG_TOKENS.skyDomeStops[1]) },
      bot: { value: new THREE.Color(RIG_TOKENS.skyDomeStops[2]) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
      void main(){ float t = clamp(normalize(vP).y, -0.1, 1.0);
        vec3 c = t > 0.28 ? mix(mid, top, smoothstep(0.28, 0.9, t)) : mix(bot, mid, smoothstep(-0.05, 0.28, t));
        gl_FragColor = vec4(c, 1.0); }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), skyMat));
}

// Clouds: code-generated soft billboards (base grade alpha 0.55; the bundle
// for this scaffold run reads OVERCAST — weather grades are a later wave,
// see RIG-AS-BUILT). Static: drift is allowed only on recorded fair/clear.
function cloudTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
{
  const tex = cloudTexture();
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
    s.position.set(-160 + rnd() * 320, 62 + rnd() * 26, -140 + rnd() * 200);
    const w = 42 + rnd() * 36; s.scale.set(w, w * 0.38, 1);
    scene.add(s);
  }
}

// Blob shadow texture (radial falloff, centre alpha = RIG.blobAlpha).
function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, `rgba(20,12,6,${RIG.blobAlpha})`);
  grad.addColorStop(1, 'rgba(20,12,6,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const blobTex = blobTexture();
function addBlob(parent, radius, y) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 24),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = y;
  parent.add(m); return m;
}

// ----------------------------------------------------------------- cameras
// Canonical: orthographic, elevation 35°, fixed azimuth from the south.
// Bible overview height is 34 units — written for layout v3's scale. On the
// current shared layout (10 units per cell, whole town ≈ 60 × 70 world
// units) 34 would crop the town, and this bookmark's job is "framing the
// whole layout", so the height is fitted (≈68) and the deviation recorded
// in RIG-AS-BUILT.md.
const ASPECT = () => (canvas.clientWidth || 1280) / (canvas.clientHeight || 800);
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 3000);
const OVERVIEW_HEIGHT = CAMERA_HEIGHT_LIMITS.max;
const perspCam = new THREE.PerspectiveCamera(FOLLOW_CAMERA.fovDeg, 16 / 9, 0.1, 3000); // Bible follow: fov 28° (F-1, as built)
const ELEV = CAMERA_ELEVATION_RAD;
// M4.18: the bookmark camera's live state, bounds, and chip set.
// camera.mjs holds the decisions (pure, Node-tested); this scene
// only applies them to the THREE cameras. The boot replaces the
// bounds/chips with ones computed from the EFFECTIVE layout, so an
// evidenced staged-fill plot expands the bounds it sits inside.
// Camera state is view-only: nothing here ever writes a figure,
// a group, or a layout node.
let cameraBounds = WORLD_BOUNDS;
let cameraChipSet = [];
let cameraView = null;
let suppressNextPick = false; // a hand-pan drag must not end as a pick click
function placeCam(cam, target, dist) {
  cam.position.set(target.x, target.y + Math.sin(ELEV) * dist, target.z + Math.cos(ELEV) * dist);
  cam.lookAt(target.x, target.y, target.z);
  cam.updateMatrixWorld();
}
function frameOverview() {
  const view = cameraView
    ? clampCameraView(cameraView, cameraBounds)
    : { target: { x: 0, y: 0, z: 3 }, height: OVERVIEW_HEIGHT };
  const a = ASPECT(), h = view.height;
  orthoCam.left = -h * a / 2; orthoCam.right = h * a / 2;
  orthoCam.top = h / 2; orthoCam.bottom = -h / 2;
  orthoCam.updateProjectionMatrix();
  placeCam(orthoCam, new THREE.Vector3(view.target.x, view.target.y, view.target.z), 220);
}
function frameFollow(target) {
  perspCam.aspect = ASPECT(); perspCam.updateProjectionMatrix();
  placeCam(perspCam, target, FOLLOW_CAMERA.distanceForFrame); // 13-unit frame height (Bible)
}

// ------------------------------------------------------------ figure loader
// M4.16: the decoder-equipped loader, created once. Kit placement
// (M4.10) parses figure GLBs through loadFigure() — the same
// parseFigure call the Node harness verifies — and no other code in
// the scene constructs a GLTFLoader.
const figureLoader = createFigureLoader();
window.__portalFigureLoader = figureLoader; // capture/verification tooling hook
async function loadFigure(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`figure fetch failed: ${res.status} ${url}`);
  return parseFigure(figureLoader, await res.arrayBuffer(), url);
}

// ------------------------------------------------------------------- world
const pickables = []; // meshes with userData.pick
const nodeGroups = new Map(); // code -> the node's scene group (M4.14 attach seam)
let worldBundle = null; // the bundle buildWorld last consumed (card wording source)
const labelDivs = new Map(); // label item id (building code / `chip:<key>`) -> div
let followTargets = []; // [{code,label,pos:Vector3}]
let state = { mode: 'overview', followIdx: 0 };
let probePads = null; // filled by buildProbes()
// M4.12 label system inputs, filled by buildWorld: buildings carry
// their v3 sign/roof anchor points in world space plus the data the
// resolver needs for their screen boxes; chips carry head points.
let labelBuildings = []; // [{code, label, signWorld, roofWorld, rect|null, height}]
let labelChips = []; // [{key, name, headWorld}]
let placements = null; // Map from labels.mjs resolveLabels
let placementSig = '';
// G-J1 round 5: while a recorded talk act stages its participants
// at the act's recorded place, the follow camera centres on the
// staging when the followed target IS that place (the info line's
// own instruction — "follow a citizen for the staged scene").
// { placeCode, x, z } in world coords, or null; written by the
// talk block below, read by followTargetPos.
let talkStagedFollow = null;

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true; return m;
}

// The held figure's ground ring: a dashed amber circle (the 2D stage's
// ring, in the conflict amber), drawn flat around the figure's feet.
function heldGroundRing() {
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62));
  }
  const ring = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineDashedMaterial({ color: hexNum(PALETTE.state.conflictBorder), dashSize: 0.16, gapSize: 0.11 }));
  ring.computeLineDistances();
  ring.position.y = 0.05;
  return ring;
}

// The held figure's overhead marker: the ≠ glyph (the record's claims
// do not agree) as a canvas sprite, amber on a pale halo — the same
// marker the 2D stage draws. Texture built once.
let heldMarkerTex = null;
function heldMarkerSprite() {
  if (!heldMarkerTex) {
    const c = document.createElement('canvas'); c.width = c.height = 96;
    const g = c.getContext('2d');
    g.font = '800 62px Nunito, system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 11; g.strokeStyle = 'rgba(255,253,248,0.95)';
    g.strokeText('≠', 48, 52);
    g.fillStyle = PALETTE.state.conflictBorder;
    g.fillText('≠', 48, 52);
    heldMarkerTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: heldMarkerTex, transparent: true, depthWrite: false }));
  s.scale.set(0.55, 0.55, 1);
  s.position.y = 2.12;
  return s;
}

function buildWorld(layout, bundle, opts = {}) {
  // Held seam (see the header): PORTAL-KEYs under a place-conflict
  // HOLD. Empty today — a single bundle carries no stream to hold
  // against — but the treatment below consumes it unchanged when a
  // caller can supply it.
  const heldKeys = opts.heldKeys || new Set();
  const eff = effectiveLayout(layout, bundle);
  const byCode = new Map(eff.nodes.map((n) => [n.code, n]));

  // Layout v3 (M4.11): authored nodes carry composed geometry baked
  // into the layout file; staged-fill nodes (evidenced plots with no
  // authored node) get theirs here from the layout's fillGeometry
  // template (streets.mjs — the same synthesis the tests verify).
  const hubNode = byCode.get('EMBER_PLAZA_OF_UNITY');
  for (const n of eff.nodes) {
    if (n.stagedPosition && !n.geometry) n.geometry = fillNodeGeometry(n, layout, hubNode);
  }
  const obstacles = eff.nodes.map((n) => n.geometry?.footprintRect).filter(Boolean);

  // M4.16 chunks: every building and figure lives under its chunk
  // group (civic-core / district-1 / district-3 / south). The
  // frontier is a separate map scene (D5) and never appears here.
  const chunkGroups = new Map();
  const chunkGroup = (node) => {
    const id = chunkOfNode(node);
    if (!chunkGroups.has(id)) {
      const g = new THREE.Group();
      g.name = `chunk:${id}`;
      scene.add(g);
      chunkGroups.set(id, g);
    }
    return chunkGroups.get(id);
  };

  // Ground: one big plane in the sunlit-grass anchor. No other
  // ground dressing is added: nothing in the record names a tree,
  // rock, or water feature here, so none is drawn (M4.13).
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), toonMat(PAL.grass));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);

  // Ground rects from the v3 geometry (M4.13): a parcel under each
  // plot, the Market stall apron, and a plain pad under each
  // building — flat planes in the shaded-paving anchor, sized by the
  // footprint specs, drawn as children of each node's group below.
  // Streets (M4.13): ribbons along the layout v3 street paths —
  // door-to-door polylines baked into the layout for authored edges,
  // computed here by the same streets.mjs code for staged-fill
  // edges — so a drawn street and the route graph never disagree.
  // T2 (kerbs + wear): the pieces for each path — the street strip
  // and its two kerbs — come from streets.mjs streetPiecesForPath,
  // driven by the path data alone: this loop only turns descriptors
  // into meshes, assigning the derived wear material (materials.mjs
  // streetMaterial, from the cobble anchors) to every street piece
  // and the flat trim-pale anchor to every kerb. No street path is
  // moved or reshaped here; geometry stays exactly the layout's.
  const streetMat = streetMaterial(THREE, gradientMap);
  const kerbMat = toonMat(PAL.trimPale);
  let edgeIdx = 0;
  for (const e of eff.edges || []) {
    const a = byCode.get(e.a), b = byCode.get(e.b);
    if (!a || !b) continue;
    const raw = e.street?.path
      ? e.street.path.map(([px, pz]) => ({ x: px, z: pz }))
      : streetPathFor(endForNode(a, b), endForNode(b, a), obstacles);
    const pieces = streetPiecesForPath(raw, edgeIdx++);
    for (const seg of pieces.segments) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(seg.street.planeLength, seg.street.width), streetMat);
      strip.rotation.x = -Math.PI / 2;
      strip.rotation.z = seg.street.rotationZ;
      strip.position.set(seg.street.centre.x, seg.street.y, seg.street.centre.z);
      strip.receiveShadow = true;
      strip.userData.streetPiece = 'street';
      scene.add(strip);
      for (const kerb of seg.kerbs) {
        const km = new THREE.Mesh(new THREE.PlaneGeometry(kerb.planeLength, kerb.width), kerbMat);
        km.rotation.x = -Math.PI / 2;
        km.rotation.z = kerb.rotationZ;
        km.position.set(kerb.centre.x, kerb.y, kerb.centre.z);
        km.receiveShadow = true;
        km.userData.streetPiece = 'kerb';
        scene.add(km);
      }
    }
  }

  // Buildings (or the plaza marker) at every effective node. The
  // placeholder blocks stand on their v3 footprint rects (the M4.14
  // kits replace them), the door sits on its spec face at its baked
  // anchor, and a plain sign board hangs at the sign anchor — board
  // and HTML label agree in position by design (visual-plan/02 §5.2).
  worldBundle = bundle;
  for (const n of eff.nodes) {
    const { x, z } = gridToWorld(n.x, n.y);
    const g = new THREE.Group(); g.position.set(x, 0, z);
    nodeGroups.set(n.code, g);
    const geo = n.geometry || {};
    if (geo.parcelRect) {
      const pr = new THREE.Mesh(new THREE.PlaneGeometry(geo.parcelRect.w, geo.parcelRect.d), toonMat(PAL.cobbleShade));
      pr.rotation.x = -Math.PI / 2; pr.position.set(geo.parcelRect.cx - x, 0.014, geo.parcelRect.cz - z);
      pr.receiveShadow = true; g.add(pr);
    }
    if (n.code === 'EMBER_PLAZA_OF_UNITY') {
      const paving = geo.pavingRect || { cx: x, cz: z, w: 10, d: 10 };
      const slab = new THREE.Mesh(new THREE.PlaneGeometry(paving.w, paving.d), toonMat(PAL.cobbleLit));
      slab.rotation.x = -Math.PI / 2; slab.position.set(paving.cx - x, 0.018, paving.cz - z); slab.receiveShadow = true;
      slab.userData.placeholder = true; // M4.14: the kit's own paving replaces it
      g.add(slab);
      const pedestal = box(1.7, 1.1, 1.7, toonMat(PAL.trimPale)); pedestal.position.y = 0.55; pedestal.userData.placeholder = true; g.add(pedestal);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.95, 20, 16), toonMat(PAL.blossom));
      orb.position.y = 2.15; orb.castShadow = true; orb.userData.placeholder = true; g.add(orb);
      labelBuildings.push({
        code: n.code, label: n.label, rect: null, height: 0,
        signWorld: { x: paving.cx, y: 3.2, z: paving.cz }, roofWorld: { x: paving.cx, y: 3.2, z: paving.cz },
        frameWorld: { cx: paving.cx, cz: paving.cz, w: paving.w, d: paving.d, topY: 3.2 },
      });
    } else if (geo.footprintRect) {
      const r = geo.footprintRect;
      const ox = r.cx - x, oz = r.cz - z; // the building's offset inside its cell (v3 composition)
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(r.w + 1.2, r.d + 1.2), toonMat(PAL.cobbleShade));
      pad.rotation.x = -Math.PI / 2; pad.position.set(ox, 0.010, oz); pad.receiveShadow = true;
      g.add(pad);
      if (geo.apronRect) {
        const ap = new THREE.Mesh(new THREE.PlaneGeometry(geo.apronRect.w, geo.apronRect.d), toonMat(PAL.cobbleShade));
        ap.rotation.x = -Math.PI / 2; ap.position.set(geo.apronRect.cx - x, 0.016, geo.apronRect.cz - z);
        ap.receiveShadow = true; g.add(ap);
      }
      const st = BUILDING_FORM[n.code] || FORM_DEFAULT;
      const mats = familyMaterials(THREE, gradientMap, familyForPlace(n.code));
      const base = box(r.w, st.h, r.d, mats.wall); base.position.set(ox, st.h / 2, oz); base.userData.placeholder = true; g.add(base);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1, st.roofH, 4), mats.roof);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set((r.w + 0.6) / Math.SQRT2, 1, (r.d + 0.6) / Math.SQRT2);
      roof.position.set(ox, st.h + st.roofH / 2, oz);
      roof.castShadow = true; roof.receiveShadow = true; roof.userData.placeholder = true; g.add(roof);
      if (st.spire) {
        const spire = new THREE.Mesh(new THREE.ConeGeometry(1.15, 3.6, 12), mats.roof);
        spire.position.set(ox, st.h + st.roofH + 1.6, oz); spire.castShadow = true; spire.userData.placeholder = true; g.add(spire);
      }
      if (geo.door) {
        const nv = FACE_NORMAL_V[geo.door.face];
        const door = box(geo.door.widthUnits, geo.door.heightUnits, 0.18, mats.trim);
        door.rotation.y = FACE_ROT_Y[geo.door.face];
        door.position.set(geo.door.anchor.x - x + nv.x * 0.09, geo.door.heightUnits / 2, geo.door.anchor.z - z + nv.z * 0.09);
        door.userData.placeholder = true;
        g.add(door);
        const boardW = Math.min(Math.max(shortName(n.label).length * 0.34, 2.4), (geo.door.face === 'north' || geo.door.face === 'south' ? r.w : r.d));
        const board = new THREE.Mesh(new THREE.PlaneGeometry(boardW, 0.95), toonMat(PAL.signWood));
        board.rotation.y = FACE_ROT_Y[geo.door.face];
        board.position.set(geo.signAnchor.x - x + nv.x * 0.06, geo.signAnchor.y, geo.signAnchor.z - z + nv.z * 0.06);
        board.userData.placeholder = true; // M4.14 kits carry their own lettered sign boards
        g.add(board);
      }
      const blob = addBlob(g, Math.max(r.w, r.d) / 2 * 1.15, 0.03); // Bible §2.4: radius = footprint × 1.15
      blob.position.x = ox; blob.position.z = oz;
      base.userData.pick = { type: 'building', code: n.code, label: n.label };
      pickables.push(base);
      labelBuildings.push({
        code: n.code, label: n.label, rect: r, height: st.h + st.roofH,
        signWorld: { x: geo.signAnchor.x, y: geo.signAnchor.y, z: geo.signAnchor.z },
        roofWorld: { x: r.cx, y: st.h + st.roofH + 0.4, z: r.cz },
        frameWorld: { cx: r.cx, cz: r.cz, w: r.w, d: r.d, topY: st.h + st.roofH },
      });
    } else {
      // Honest empty plot (staged fill): the parcel above is its
      // whole treatment — no building, no labelled box. Its label
      // is a plot sign at the gate (the fillGeometry sign anchor).
      labelBuildings.push({
        code: n.code, label: n.label, rect: null, height: 0,
        signWorld: { x: geo.signAnchor.x, y: geo.signAnchor.y, z: geo.signAnchor.z },
        roofWorld: { x: geo.parcelRect.cx, y: 0, z: geo.parcelRect.cz },
        frameWorld: { cx: geo.parcelRect.cx, cz: geo.parcelRect.cz, w: geo.parcelRect.w, d: geo.parcelRect.d, topY: (geo.signAnchor.y || 0) + 1 },
      });
    }
    chunkGroup(n).add(g);
    followTargets.push({ code: n.code, label: n.label, pos: new THREE.Vector3(x, 1.2, z) });

    const div = document.createElement('div');
    div.className = 'lbl'; div.textContent = n.label;
    labelsEl.appendChild(div); labelDivs.set(n.code, div);
  }

  // Citizens: the app's citizenPositions map (exact layout + staged fill),
  // unmodified — grid coords through the same transform as the buildings.
  // Treatment is figureStyle's call (the app logic's, OM15-C2), fed a
  // minimal placement marker for seam-held keys: figureStyle reads only
  // placement.conflict, and when this scene consumes the real M3.04
  // tracker the same call takes the real snapshot unchanged.
  const citizensByKey = new Map((bundle.citizens || []).map((c) => [c.citizenKey || c.handle || c.name, c]));
  const positions = citizenPositions(bundle, layout);
  const citizenGroups = new Map(); // PORTAL-KEY -> placeholder group (M4.10 kit attach)
  // M4.16 actor budget: at most MAX_ACTORS figures are embodied;
  // overflow goes to the roster rail (returned for the rail line) —
  // named, never dropped, never faked into the scene.
  const { actors: actorKeys, rail: railKeys } = assignActors([...positions.keys()]);
  const actorSet = new Set(actorKeys);
  const railCitizens = railKeys
    .map((k) => citizensByKey.get(k))
    .filter(Boolean)
    .map((c) => ({ key: c.citizenKey || c.handle || c.name, name: c.name || c.handle || 'A citizen' }));
  let heldCitizens = 0;
  for (const [key, p] of positions) {
    const c = citizensByKey.get(key);
    if (!c) continue;
    if (!actorSet.has(key)) continue; // roster rail — see railCitizens
    const { x, z } = gridToWorld(p.x, p.y);
    const style = figureStyle(c, heldKeys.has(key) ? { conflict: true } : null);
    const mat = toonMat(new THREE.Color(citizenColor(key)).getHex(), style.opacity < 1 ? { opacity: style.opacity } : {});
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.30, 0.85, 4, 12), mat);
    body.position.y = 0.74; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 16, 12), mat);
    head.position.y = 1.48; head.castShadow = true; g.add(head); // total height ≈1.81 (Bible figure height 1.8)
    addBlob(g, 0.55, 0.025); // Bible §2.4: citizen blob radius 0.55
    if (style.treatment === 'asleep') {
      // M4.25 asleep treatment (treatments.mjs): the capsule reclines
      // (its rest pose; a kit figure plays the library's rest-lie
      // clip instead) and the Zzz badge floats over it. The dimming
      // is already in the material (figureStyle's opacity). The old
      // 0.9-scale scaffold cue is superseded by this treatment.
      reclineCapsuleMeshes([body, head]);
      const z = zzzSprite(THREE);
      z.position.set(ZZZ_POSITION.x, ZZZ_POSITION.y, ZZZ_POSITION.z);
      z.userData.sleepBadge = true; // G-J1 round 3: talk playback's sleep suspension finds the badge by this tag
      g.add(z);
    }
    if (style.treatment === 'held') {
      heldCitizens++;
      g.add(heldGroundRing());
      g.add(heldMarkerSprite());
    }
    body.userData.pick = { type: 'citizen', key, name: c.name, citizen: c };
    head.userData.pick = body.userData.pick;
    pickables.push(body, head);
    citizenGroups.set(key, g);
    // M4.12: the citizen's name chip joins the label layer; the
    // placement resolver (updateLabels) positions it — chips yield
    // to signs by construction.
    const chipDiv = document.createElement('div');
    chipDiv.className = 'lbl chip'; chipDiv.textContent = c.name;
    chipDiv.style.borderColor = citizenColor(key);
    chipDiv.style.borderWidth = '2px';
    chipDiv.style.background = 'rgba(255,255,255,.85)';
    // Item 3 (the project owner, 2026-11-03): citizen plates render smaller
    // than place labels — the size labels.mjs's chipBox models
    // (CHIP_FONT_PX / CHIP_PAD_X_PX), applied here via CSSOM like
    // the border/background above. scene.html's .lbl stylesheet
    // is NOT edited: it is pinned by the staging Worker's CSP
    // style hash, and no Worker change rides with this stage.
    chipDiv.style.fontSize = `${CHIP_FONT_PX}px`;
    chipDiv.style.padding = `1px ${CHIP_PAD_X_PX}px`;
    labelsEl.appendChild(chipDiv); labelDivs.set(`chip:${key}`, chipDiv);
    labelChips.push({ key, name: c.name, group: g, reclined: style.treatment === 'asleep' }); // head anchor = the group's live position + 2.0 up (the driver may walk it); reclined = the asleep treatment (the figure lies toward +z, so its screen rect is low and long — labels.mjs's plate-vs-figure rule needs the true extent)
    chunkGroup(byCode.get(p.code) || eff.nodes[0]).add(g);
  }

  buildProbes(byCode);
  return { eff, placedCitizens: positions.size, heldCitizens, citizenGroups, railCitizens, chunkGroups, nodeGroups, citizensByKey, positionsByKey: positions };
}

// Probe pads: scaffold instrumentation for the Bible §1.2/§4 gate — three
// probe points (cobble in sun, cobble in College shadow, a figure's
// shadow-side cheek). Small cobble pads + skin spheres on posts, all
// removable in one group when the golden-capture route takes over.
//
// M4.07 PROBE CORRECTION (RIG-AS-BUILT has the full record): the cheek
// pair used to sample two LIMBS of one sunlit sphere — but the
// "shadow-side" limb faces the SE fill light and the hemisphere dome,
// so it is not in shadow at all (it read 0.906 on live pixels, and a
// scan of the whole visible disc finds no point under 0.836 under this
// rig: no rig in the card's register can put that point in band). The
// Bible's quantity is a cheek IN SHADOW, so the pair is now what the
// cobble pair is: the same cheek point, sunlit vs inside a cast
// shadow — a second, identical sphere standing in the College's cast
// shadow beside the shadow pad (offset perpendicular to the shadow
// direction so it never covers the pad from the overview camera, and
// verified inside the wall's shadow at its height). The old limb
// sample is still read and printed as a labelled diagnostic (it
// measures the fill's strength on a figure's SE side; it is not the
// gate and never was measuring shade).
function buildProbes(byCode) {
  const g = new THREE.Group(); g.name = 'probe-instrumentation';
  const padGeo = new THREE.CylinderGeometry(1.15, 1.15, 0.07, 24);
  const litPad = new THREE.Mesh(padGeo, toonMat(PAL.cobbleLit));
  litPad.position.set(3.4, 0.035, 3.4); litPad.receiveShadow = true; g.add(litPad);

  const college = byCode.get('EMBER_COLLEGE');
  const cw = gridToWorld(college.x, college.y);
  // Shadow direction: opposite the sun's horizontal position.
  const sl = Math.hypot(RIG.sunPos[0], RIG.sunPos[2]);
  const sdx = -RIG.sunPos[0] / sl, sdz = -RIG.sunPos[2] / sl;
  const shadowPad = new THREE.Mesh(padGeo, toonMat(PAL.cobbleLit));
  shadowPad.position.set(cw.x + sdx * 5.1, 0.035, cw.z + sdz * 5.1);
  shadowPad.receiveShadow = true; g.add(shadowPad);

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.15, 8), toonMat(PAL.timber));
  post.position.set(-3.2, 0.575, 2.2); post.castShadow = true; g.add(post);
  const cheek = new THREE.Mesh(new THREE.SphereGeometry(1.05, 24, 18), toonMat(PAL.skin));
  cheek.position.set(-3.2, 2.3, 2.2); cheek.castShadow = true; cheek.receiveShadow = true; g.add(cheek);

  // The shadowed cheek sphere: same skin anchor, same radius, on its
  // own post inside the College's cast shadow.
  const scx = shadowPad.position.x - sdz * 2.4, scz = shadowPad.position.z + sdx * 2.4;
  const post2 = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.15, 8), toonMat(PAL.timber));
  post2.position.set(scx, 0.575, scz); post2.castShadow = true; g.add(post2);
  const cheekShadowed = new THREE.Mesh(new THREE.SphereGeometry(1.05, 24, 18), toonMat(PAL.skin));
  cheekShadowed.position.set(scx, 2.3, scz); cheekShadowed.castShadow = true; cheekShadowed.receiveShadow = true; g.add(cheekShadowed);

  scene.add(g);
  probePads = {
    litPoint: new THREE.Vector3(3.4, 0.08, 3.4),
    shadowPoint: shadowPad.position.clone().setY(0.08),
    cheekCentre: cheek.position.clone(),
    cheekShadowCentre: cheekShadowed.position.clone(),
    cheekRadius: 1.05,
  };
}

// ------------------------------------------------------------------ render
function currentCam() { return state.mode === 'overview' ? orthoCam : perspCam; }
function render() {
  const cam = currentCam();
  if (state.mode === 'overview') frameOverview();
  else frameFollow(followTargetPos());
  renderer.render(scene, cam);
  updateLabels(cam);
  const t = followTargets[state.followIdx];
  modeEl.textContent = state.mode === 'overview'
    ? `Overview — canonical orthographic, elevation 35°, from the south${cameraView?.label ? ` · ${cameraView.label}` : ' · custom view (Reset view recovers Overview)'}`
    : `Follow — perspective 28°, centred on ${t ? t.label : '—'}`;
  document.getElementById('btn-overview').setAttribute('aria-pressed', String(state.mode === 'overview'));
  document.getElementById('btn-follow').setAttribute('aria-pressed', String(state.mode === 'follow'));
  for (const b of document.querySelectorAll('[data-camera-chip]')) {
    b.setAttribute('aria-pressed', String(state.mode === 'overview' && cameraView?.chipId === b.getAttribute('data-camera-chip')));
  }
  updateLevelChip();
}
const _v = new THREE.Vector3();
// M4.12: labels are placed by labels.mjs's resolver, never by hand
// per frame. Anchors are projected with the real camera; placement
// re-resolves only when the projected picture changes (mode, follow
// target, canvas size, or a figure the driver is walking) — the
// signature check makes the common static frame free.
function updateLabels(cam) {
  const w = canvas.clientWidth || 1280, h = canvas.clientHeight || 800;
  const project = (p) => {
    _v.set(p.x, p.y, p.z).project(cam);
    return {
      x: (_v.x * 0.5 + 0.5) * w,
      y: (1 - (_v.y * 0.5 + 0.5)) * h,
      visible: _v.z <= 1 && _v.z >= -1,
    };
  };
  const items = [];
  const obstacles = [];
  const figures = [];
  // A world box (centre + size + top height) projected to its screen
  // AABB — the shape labels.mjs's round-2 rules consume: a building's
  // frameRect (the label renders only while this intersects the
  // frame) and a figure's rect (no nameplate may cover it).
  const screenAabb = (cx, cz, w, d, topY, y0 = 0) => {
    const pts = [];
    for (const px of [cx - w / 2, cx + w / 2]) {
      for (const pz of [cz - d / 2, cz + d / 2]) {
        for (const py of [y0, topY]) pts.push(project({ x: px, y: py, z: pz }));
      }
    }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const sigParts = [state.mode, state.followIdx, `${w}x${h}`,
    // Item 3: the selection is a placement input (select-to-show
    // below) — a new pick must re-resolve even when the follow
    // target does not move (two citizens at the same place).
    `sel:${pickedKey || ''}`,
    cameraView ? `${Math.round(cameraView.target.x * 10)},${Math.round(cameraView.target.z * 10)},${Math.round(cameraView.height * 10)}` : 'nocam'];
  for (const b of labelBuildings) {
    const sign = project(b.signWorld);
    const roof = project(b.roofWorld);
    sigParts.push(`${b.code}:${Math.round(sign.x)},${Math.round(sign.y)}`);
    const fw = b.frameWorld || (b.rect ? { cx: b.rect.cx, cz: b.rect.cz, w: b.rect.w, d: b.rect.d, topY: b.height } : null);
    const frameRect = fw ? screenAabb(fw.cx, fw.cz, fw.w, fw.d, fw.topY) : null;
    if (frameRect) {
      // The building's extent includes its own sign/roof anchors (a
      // gate sign can stand on the parcel's edge) — presence is
      // judged on the whole named thing, anchors included.
      for (const p of [sign, roof]) {
        const x0 = Math.min(frameRect.x, p.x), y0 = Math.min(frameRect.y, p.y);
        frameRect.w = Math.max(frameRect.x + frameRect.w, p.x) - x0;
        frameRect.h = Math.max(frameRect.y + frameRect.h, p.y) - y0;
        frameRect.x = x0; frameRect.y = y0;
      }
    }
    items.push({
      id: b.code, kind: 'building', text: b.label, signText: shortName(b.label),
      anchors: { sign, roof }, ownObstacle: b.code, frameRect,
    });
    if (b.rect) {
      const pts = [];
      for (const cx of [b.rect.cx - b.rect.w / 2, b.rect.cx + b.rect.w / 2]) {
        for (const cz of [b.rect.cz - b.rect.d / 2, b.rect.cz + b.rect.d / 2]) {
          for (const cy of [0, b.height]) pts.push(project({ x: cx, y: cy, z: cz }));
        }
      }
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      obstacles.push({ id: b.code, rect: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } });
    }
  }
  for (const c of labelChips) {
    const gx = c.group.position.x, gz = c.group.position.z;
    const head = project({ x: gx, y: 2.0, z: gz });
    sigParts.push(`chip:${c.key}:${Math.round(head.x)},${Math.round(head.y)}:${c.reclined ? 1 : 0}`);
    items.push({ id: `chip:${c.key}`, kind: 'chip', text: c.name, anchors: { head }, figureId: `chip:${c.key}` });
    // The figure's screen rect (G-J1 round 2, plate-vs-figure): a
    // standing figure is ~1.95 tall over a 1×1 ground box; a
    // reclined (asleep) figure lies toward +z — low (0.75) and long
    // (from 0.2 behind its origin to 1.9 ahead of it).
    figures.push({
      id: `chip:${c.key}`,
      // The head anchor rides along (G-J1 round 3): the resolver's
      // ambiguity rule measures each plate against it.
      anchor: head,
      rect: c.reclined
        ? screenAabb(gx, gz + 0.85, 1.0, 2.1, 0.75)
        : screenAabb(gx, gz, 1.0, 1.0, 1.95),
    });
  }
  const sig = sigParts.join('|');
  if (sig !== placementSig || !placements) {
    // Item 3 select-to-show (the project owner, 2026-11-03): the manually
    // selected citizen is the last citizen the viewer clicked
    // (pickedKey — the pick handler below is the scene's existing
    // selection model; it also centres the follow camera on the
    // citizen's place). Their plate resolves first among chips,
    // at its best legal rung, inside labels.mjs. Selection never
    // overrides a refusal there: if no rung is legal the plate
    // stays collapsed and the citizen is named by the #info line
    // instead (the pick handler sets it via citizenCaption) —
    // the follow/info surface is the fallback, by design.
    // Composition with recorded talk staging: none needed and
    // none added. Talk participants are named by the speech
    // panel's header in all cases, and their plates ride the
    // ordinary ladder to the recorded place (round 5); this
    // selection path touches neither the talk staging nor the
    // panel — a selected citizen who is also a talk participant
    // simply gets chip priority like any selected citizen, and
    // the panel's label-refusal still reads the placed boxes.
    placements = resolveLabels({
      items, obstacles, figures, viewport: { width: w, heightPx: h }, budget: 28,
      selectedId: pickedKey ? `chip:${pickedKey}` : null,
    });
    placementSig = sig;
  }
  for (const [id, div] of labelDivs) {
    const r = placements.get(id);
    if (!r || !r.box) { div.style.display = 'none'; continue; }
    div.style.display = '';
    div.style.transform = 'none';
    div.style.boxSizing = 'border-box';
    div.style.textAlign = 'center';
    div.style.left = `${r.box.x}px`;
    div.style.top = `${r.box.y}px`;
    div.style.width = `${r.box.w}px`;
    div.style.height = `${r.box.h}px`;
    if (div.textContent !== r.text) div.textContent = r.text;
  }
}

// ------------------------------------------------------------------- probe
// The Bible gate: shadow/lit luminance ratio 0.50–0.65 at all three probe
// points. Primary method: pixel sampling of the actual render (the golden
// capture's method). Sampling happens synchronously right after a render
// (preserveDrawingBuffer is also on), 5×5 px average, relative luminance
// from the sRGB pixel values (state it: this is a *display-space* ratio).
function lumOf(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function sampleAt(cam, worldPoint) {
  const gl = renderer.getContext();
  const wpx = renderer.domElement.width, hpx = renderer.domElement.height;
  _v.copy(worldPoint).project(cam);
  const px = Math.round((_v.x * 0.5 + 0.5) * wpx), py = Math.round((1 - (_v.y * 0.5 + 0.5)) * hpx);
  const buf = new Uint8Array(4 * 25);
  gl.readPixels(px - 2, hpx - py - 2, 5, 5, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < 25; i++) { r += buf[i * 4]; g += buf[i * 4 + 1]; b += buf[i * 4 + 2]; }
  return lumOf(r / 25, g / 25, b / 25);
}
function runProbe() {
  if (!probePads) { probeEl.textContent = 'Probe: world not built yet.'; return null; }
  // 1) Cobble pair from the canonical overview.
  state.mode = 'overview';
  if (cameraChipSet.length) cameraView = resetCameraView(cameraChipSet);
  render();
  const litLum = sampleAt(orthoCam, probePads.litPoint);
  const shadowLum = sampleAt(orthoCam, probePads.shadowPoint);
  const cobbleRatio = shadowLum / litLum;
  // 2) Cheek pair (M4.07 correction — see buildProbes): the same
  //    sun-side cheek point on both probe spheres, one sunlit and one
  //    standing in the College's cast shadow. Each sphere gets its own
  //    close follow-style frame; the sample offsets are identical, so
  //    the only difference between the two reads is the cast shadow —
  //    the quantity the Bible gate names. The sunlit sphere's SE limb
  //    (the pre-correction "shadow-side" point, which faces the fill
  //    light) is still sampled and printed as a diagnostic.
  const gl = renderer.getContext();
  const wpx = renderer.domElement.width, hpx = renderer.domElement.height;
  const samplePx = (px, py) => {
    const buf = new Uint8Array(4 * 25);
    gl.readPixels(Math.round(px) - 2, hpx - Math.round(py) - 2, 5, 5, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < 25; i++) { r += buf[i * 4]; g += buf[i * 4 + 1]; b += buf[i * 4 + 2]; }
    return lumOf(r / 25, g / 25, b / 25);
  };
  const cheekFrame = (centre) => {
    const cam = new THREE.PerspectiveCamera(28, ASPECT(), 0.1, 3000);
    placeCam(cam, centre, 7.5);
    renderer.render(scene, cam);
    _v.copy(centre).project(cam);
    const cx = (_v.x * 0.5 + 0.5) * wpx, cy = (1 - (_v.y * 0.5 + 0.5)) * hpx;
    const edge = centre.clone(); edge.x += probePads.cheekRadius;
    _v.copy(edge).project(cam);
    const rPx = Math.abs((_v.x * 0.5 + 0.5) * wpx - cx);
    return {
      sunSide: samplePx(cx - rPx * 0.55, cy - rPx * 0.5), // toward the NW sun
      fillSide: samplePx(cx + rPx * 0.55, cy + rPx * 0.42), // toward the SE fill
    };
  };
  const litFrame = cheekFrame(probePads.cheekCentre);
  const shadowFrame = cheekFrame(probePads.cheekShadowCentre);
  const cheekLit = litFrame.sunSide;
  const cheekShadow = shadowFrame.sunSide;
  const cheekRatio = cheekShadow / cheekLit;
  const fillLimbRatio = litFrame.fillSide / cheekLit; // diagnostic only — not gated
  render(); // restore the main view
  const inBand = (v) => v >= 0.50 && v <= 0.65;
  const verdict = inBand(cobbleRatio) && inBand(cheekRatio) ? 'PASS' : 'OUT OF BAND';
  const lines = [
    `Probe (pixel sampling of the render, sRGB display-space luminance, 5×5 average):`,
    `  cobble lit luminance        ${litLum.toFixed(1)}`,
    `  cobble in College shadow    ${shadowLum.toFixed(1)}   ratio ${cobbleRatio.toFixed(3)}  ${inBand(cobbleRatio) ? 'in band 0.50–0.65' : 'OUT OF BAND'}`,
    `  cheek, sunlit sphere        ${cheekLit.toFixed(1)}`,
    `  cheek, sphere in shadow     ${cheekShadow.toFixed(1)}   ratio ${cheekRatio.toFixed(3)}  ${inBand(cheekRatio) ? 'in band 0.50–0.65' : 'OUT OF BAND'}`,
    `  diagnostic — sunlit sphere's fill-side limb ratio ${fillLimbRatio.toFixed(3)} (faces the SE fill; not a shadow read, not gated)`,
    `  GATE: ${verdict}`,
    `Rig as rendered: sun ${RIG.sunIntensity} ${RIG_TOKENS.sunColor}, hemi ${RIG.hemiIntensity}, fill ${RIG.fillIntensity}, Neutral @ ${RIG.exposure}.`,
  ];
  probeEl.textContent = lines.join('\n');
  console.log(lines.join('\n'));
  return { cobbleRatio, cheekRatio, fillLimbRatio, verdict };
}
window.__portalProbe = runProbe; // capture tooling hook (golden-capture route)

// ------------------------------------------------- interiors (M5.08) +
// follow behaviours (M5.10). The models live in interiors.mjs /
// follow-interior.mjs (pure, Node-tested); this is their scene
// consumption: one shell template over the M4.14 GLBs, occupants
// placed at the registry's stations, the standing line on every
// opening, and the follow camera framing the interior's own
// camera anchor while a room is open. The pan pause holds the
// follow target on a drag until "Re-centre" — the camera surface
// as it exists; M4.18's chips/bounds are a parallel lane's, and
// any gap against them is recorded in the interiors lane record,
// not forked here.
const panControl = createPanControl();
const interiorCtl = {
  registry: null, roots: new Map(), openCode: null,
  saved: new Map(), labelDivs: new Map(), camWorld: new Map(),
  citizenGroups: null, bundle: null,
};
// Floor levels (T3): per-building level state, beside the interior
// shell state — the models live in buildings.mjs (classification,
// state, applier) and interiors.mjs (the shell composition rule);
// this is their scene consumption. roots/states are filled at boot
// from the kit cards + loaded GLBs; today only the College has a
// second storey, so only it ever enables the chip.
const levelCtl = { roots: new Map(), states: new Map() };
let pickedBuildingCode = null; // the last building the viewer clicked (the chip's selection, with the follow target)
const LEVEL_CHIP_LABEL = CAMERA_WORDINGS.upperFloor;

function levelTargetCode() {
  if (interiorCtl.openCode) return interiorCtl.openCode;
  if (pickedBuildingCode && levelCtl.states.has(pickedBuildingCode)) return pickedBuildingCode;
  const t = followTargets[state.followIdx];
  return t ? t.code : null;
}
let levelChipShown = null; // last rendered chip state (render() runs per frame; the DOM is touched only on change)
function updateLevelChip() {
  const btn = document.getElementById('btn-level');
  if (!btn) return;
  const code = levelTargetCode();
  const st = code ? levelCtl.states.get(code) : null;
  const enabled = levelChipEnabled(st);
  const sig = `${enabled ? 1 : 0}|${enabled && st.level === 'upper' ? 1 : 0}|${code || ''}`;
  if (sig === levelChipShown) return;
  levelChipShown = sig;
  btn.disabled = !enabled;
  btn.setAttribute('aria-pressed', String(!!(enabled && st.level === 'upper')));
  btn.title = enabled
    ? `${followTargets.find((t) => t.code === code)?.label || code} has a second storey — show or hide its upper floor.`
    : 'No building with a second storey is selected.';
}
function toggleLevel() {
  const code = levelTargetCode();
  const root = code ? levelCtl.roots.get(code) : null;
  const st = code ? levelCtl.states.get(code) : null;
  if (!root || !levelChipEnabled(st)) return;
  const next = st.level === 'upper' ? 'ground' : 'upper';
  const rep = applyBuildingLevel(root, next);
  const label = followTargets.find((t) => t.code === code)?.label || code;
  infoEl.textContent = rep && rep.deferred
    ? `${label} — the ${next === 'upper' ? 'upper floor' : 'ground floor'} level is chosen; it takes effect when the interior closes.`
    : `${label} — ${next === 'upper' ? 'upper floor shown: the whole building stands as built.' : 'ground floor shown: the upper floor is hidden and the roof sits on the ground storey.'}`;
  levelChipShown = null;
  render();
}
function buildLevelChip() {
  const bar = document.getElementById('bar');
  if (!bar || document.getElementById('btn-level')) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.id = 'btn-level';
  b.dataset.levelChip = 'upper-floor';
  b.setAttribute('aria-pressed', 'false');
  b.disabled = true;
  b.textContent = LEVEL_CHIP_LABEL;
  b.addEventListener('click', toggleLevel);
  bar.appendChild(b);
}
// Verification/capture hook, same standing as __portalCamera: the
// level surface as data, so a capture can assert both levels from
// the page's own numbers.
window.__portalLevels = {
  label: LEVEL_CHIP_LABEL,
  get targetCode() { return levelTargetCode(); },
  state: (code) => {
    const st = levelCtl.states.get(code);
    return st ? {
      code, level: st.level, hasUpper: st.hasUpper, storeys: st.storeys,
      storeyHeightUnits: st.storeyHeightUnits, upperCount: st.upperNames.length,
      suspendedLevel: st.suspendedLevel, chipEnabled: levelChipEnabled(st),
    } : null;
  },
  get states() { return [...levelCtl.states.keys()].map((c) => window.__portalLevels.state(c)); },
  apply: (code, level) => {
    const root = levelCtl.roots.get(code);
    return root ? applyBuildingLevel(root, level) : null;
  },
  toggle: () => toggleLevel(),
};

function followTargetPos() {
  const t = followTargets[state.followIdx];
  let pos = t ? t.pos : new THREE.Vector3();
  if (t && interiorCtl.openCode === t.code && interiorCtl.camWorld.has(t.code)) {
    pos = interiorCtl.camWorld.get(t.code);
  }
  if (t && talkStagedFollow && t.code === talkStagedFollow.placeCode) {
    // A recorded act is staged at this place right now: the
    // figures the viewer followed here stand at the staging,
    // not at their live spots — centre on the speaker's staged
    // position (G-J1 round 5).
    pos = new THREE.Vector3(talkStagedFollow.x, pos.y, talkStagedFollow.z);
  }
  if (panControl.state === 'paused' && panControl.holdTarget) {
    return new THREE.Vector3(panControl.holdTarget[0], pos.y, panControl.holdTarget[1]);
  }
  return pos;
}

function closeInterior() {
  const code = interiorCtl.openCode;
  if (!code) return;
  const def = interiorDef(interiorCtl.registry, code);
  const root = interiorCtl.roots.get(code);
  if (root && def) applyShell(root, shellPlan(def, false));
  for (const [g, pos] of interiorCtl.saved) g.position.copy(pos);
  interiorCtl.saved.clear();
  for (const { div } of interiorCtl.labelDivs.values()) div.remove();
  interiorCtl.labelDivs.clear();
  interiorCtl.openCode = null;
}

/** Toggle one interior. Returns a line for the info surface (or
 *  null when the place has no interior to open). Occupants are
 *  the bundle's citizens at the place — the render model's set,
 *  nobody else — moved to their stations for the duration. */
function toggleInterior(code) {
  if (!interiorCtl.registry || !interiorCtl.roots.has(code)) return null;
  if (interiorCtl.openCode === code) { closeInterior(); return 'Interior closed — roof and walls restored.'; }
  closeInterior();
  const def = interiorDef(interiorCtl.registry, code);
  const root = interiorCtl.roots.get(code);
  applyShell(root, shellPlan(def, true));
  interiorCtl.openCode = code;
  root.updateWorldMatrix(true, false);
  const origin = new THREE.Vector3();
  root.getWorldPosition(origin);
  const model = interiorRenderModel(interiorCtl.registry, interiorCtl.bundle, code);
  for (const p of model.placed) {
    const key = p.citizen.citizenKey || p.citizen.handle || p.citizen.name;
    const g = interiorCtl.citizenGroups ? interiorCtl.citizenGroups.get(key) : null;
    if (!g) continue;
    if (!interiorCtl.saved.has(g)) interiorCtl.saved.set(g, g.position.clone());
    g.position.set(origin.x + p.position[0], 0, origin.z + p.position[2]);
  }
  for (const s of def.stations) {
    const div = document.createElement('div');
    div.className = 'lbl station';
    div.textContent = s.label;
    labelsEl.appendChild(div);
    interiorCtl.labelDivs.set(`${code}:${s.id}`, {
      div, world: new THREE.Vector3(origin.x + s.position[0], 1.7, origin.z + s.position[2]),
    });
  }
  interiorCtl.camWorld.set(code, new THREE.Vector3(
    origin.x + def.anchors.camInterior[0], def.anchors.camInterior[1], origin.z + def.anchors.camInterior[2]));
  const levelNote = levelChipEnabled(buildingLevelState(root)) ? ` ${LEVEL_SET_ASIDE_LINE}` : '';
  return (model.empty
    ? `Interior open. ${model.emptyLine} ${model.standingLine}`
    : `Interior open. Inside: ${model.placed.map((p) => p.citizen.name).join(', ')}. ${model.standingLine}`) + levelNote;
}

function updateInteriorLabels() {
  if (!interiorCtl.labelDivs.size) return;
  const cam = currentCam();
  const w = canvas.clientWidth || 1280, h = canvas.clientHeight || 800;
  // Figure rects for the station labels' plate-vs-figure rule
  // (G-J1 round 3 — the talk frame's "Notice Board" chip sat
  // across a figure): every figure that can be on screen, town
  // chips and interior placements alike, as screen AABBs in the
  // same construction updateLabels uses (standing 1.95 over a 1×1
  // ground box; reclined low and long toward +z). Interior figures
  // carry no reclined flag here and are measured standing — the
  // taller, more conservative rect.
  const project = (p) => {
    _v.set(p.x, p.y, p.z).project(cam);
    return { x: (_v.x * 0.5 + 0.5) * w, y: (1 - (_v.y * 0.5 + 0.5)) * h };
  };
  const figRect = (gx, gz, reclined) => {
    const pts = [];
    const [cz, d, topY] = reclined ? [gz + 0.85, 2.1, 0.75] : [gz, 1.0, 1.95];
    for (const px of [gx - 0.5, gx + 0.5]) {
      for (const pz of [cz - d / 2, cz + d / 2]) {
        for (const py of [0, topY]) pts.push(project({ x: px, y: py, z: pz }));
      }
    }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const figures = [];
  for (const c of labelChips) figures.push({ id: `chip:${c.key}`, rect: figRect(c.group.position.x, c.group.position.z, c.reclined) });
  if (interiorCtl.citizenGroups) {
    for (const g of interiorCtl.citizenGroups.values()) figures.push({ id: 'interior', rect: figRect(g.position.x, g.position.z, false) });
  }
  for (const { div, world } of interiorCtl.labelDivs.values()) {
    _v.copy(world).project(cam);
    if (_v.z > 1 || _v.z < -1) { div.style.display = 'none'; continue; }
    const anchor = { x: (_v.x * 0.5 + 0.5) * w, y: (1 - (_v.y * 0.5 + 0.5)) * h };
    const box = stationLabelPlacement({ text: div.textContent, anchor, figures, viewport: { width: w, heightPx: h } });
    if (!box) { div.style.display = 'none'; continue; }
    div.style.display = '';
    // The stylesheet centres the label on (left, top) via
    // translate(-50%, -100%): hand it the placed box's
    // bottom-centre, so the rendered label IS the resolver's box.
    div.style.left = `${(box.x + box.w / 2).toFixed(1)}px`;
    div.style.top = `${(box.y + box.h).toFixed(1)}px`;
  }
}

// Pan pause (M5.10): a drag on the canvas in follow mode holds the
// camera's target; the Re-centre button is the only way back.
let panDrag = null;
canvas.addEventListener('pointerdown', (ev) => { panDrag = { x: ev.clientX, y: ev.clientY }; });
canvas.addEventListener('pointermove', (ev) => {
  if (!panDrag || state.mode !== 'follow' || panControl.state === 'paused') return;
  if (Math.hypot(ev.clientX - panDrag.x, ev.clientY - panDrag.y) < 6) return;
  const pos = followTargetPos();
  panControl.pan([pos.x, pos.z]);
  const b = document.getElementById('btn-recentre');
  if (b) b.hidden = false;
  infoEl.textContent = 'Follow paused — the camera holds here while the town goes on. Re-centre resumes the follow.';
});
canvas.addEventListener('pointerup', () => { panDrag = null; });
document.getElementById('btn-recentre')?.addEventListener('click', () => {
  panControl.recentre();
  document.getElementById('btn-recentre').hidden = true;
  render();
});

// ------------------------------------------------------------------ picking
const ray = new THREE.Raycaster();
canvas.addEventListener('click', (ev) => {
  if (suppressNextPick) { suppressNextPick = false; return; } // the click that ends a hand-pan drag is not a pick
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, currentCam());
  const hit = ray.intersectObjects(pickables, false)[0];
  if (!hit) return;
  const p = hit.object.userData.pick;
  if (p.type === 'building') {
    pickedBuildingCode = p.code;
    const i = followTargets.findIndex((t) => t.code === p.code);
    if (i >= 0) { state.followIdx = i; state.mode = 'follow'; }
    // M4.15 (D-9b): the card reads its condition line from the app
    // logic's own tier source — the same wording the 2D card uses,
    // never a condition claim of the scene's own.
    const cond = worldBundle ? buildingConditionLine(workTier, worldBundle, p.code) : null;
    const interiorLine = toggleInterior(p.code);
    infoEl.textContent = (cond
      ? `${p.label} — ${cond} Follow camera centred.`
      : `${p.label} — on the real layout node. Follow camera centred.`)
      + (interiorLine ? ` ${interiorLine}` : '');
  } else if (p.type === 'citizen') {
    const node = followTargets.find((t) => t.code === p.citizen.placeCode);
    state.followIdx = Math.max(0, followTargets.indexOf(node));
    state.mode = 'follow';
    pickedKey = p.key; pickedCitizen = p.citizen;
    infoEl.textContent = citizenCaption(p.citizen, node ? node.label : undefined);
  }
  render();
});

// ------------------------------------------------------- work clips (M4.08)
// The clip-library preview: plays a retargeted work/rest clip on the
// last citizen the viewer clicked. It is a PREVIEW of the scene's
// vocabulary — labelled as such every time it fires; it never claims
// the record shows the citizen working. clipPlayers is filled by the
// boot's kit attach (figure-kits.mjs players).
let pickedKey = null;
let pickedCitizen = null;
let clipPlayers = new Map();
function previewClip(name) {
  const player = pickedKey ? clipPlayers.get(pickedKey) : null;
  if (!player) {
    infoEl.textContent = 'Click a citizen first — the clip preview plays on the citizen you pick (and only on citizens wearing factory kits).';
    return;
  }
  if (player.play(name)) {
    const who = pickedCitizen ? (pickedCitizen.name || 'the citizen') : 'the citizen';
    infoEl.textContent = name === 'idle'
      ? `${who} is back to their idle.`
      : `Clip preview — ${who} plays “${name}” from the clip library. This is the scene's work vocabulary on show, not the record: nothing in the public feeds Portal reads says ${who} is doing this now.`;
  } else {
    infoEl.textContent = `The clip library has no clip named “${name}” — nothing was played, and no clip was invented to fill the gap.`;
  }
}
for (const btn of document.querySelectorAll('[data-work-clip]')) {
  btn.addEventListener('click', () => previewClip(btn.getAttribute('data-work-clip')));
}

// ---------------------------------------------------------------- controls
function setMode(m) { state.mode = m; render(); }
function cycle(d) {
  if (!followTargets.length) return;
  state.followIdx = (state.followIdx + d + followTargets.length) % followTargets.length;
  state.mode = 'follow'; render();
  const t = followTargets[state.followIdx];
  infoEl.textContent = `Follow target: ${t.label}.`;
}

// M4.18 chips + Reset view. The chips are built from camera.mjs's
// chip set (labels from the wording tokens, framings from layout
// v3 geometry); the existing Overview button IS the overview chip.
// Applying a chip moves ONLY the camera — the info line says so,
// because in this scene a thing that moves the camera must never
// be mistakable for a thing that moves a citizen.
function goCameraChip(id) {
  const oneChip = cameraChipSet.find((c) => c.id === id);
  if (!oneChip) return;
  closeInterior();
  cameraView = applyCameraChip(cameraView || viewForChip(oneChip), oneChip);
  state.mode = 'overview';
  infoEl.textContent = `${oneChip.label} — the camera moved to this named framing. No citizen moved.`;
  render();
}
function resetView() { goCameraChip('overview'); }
function buildCameraChips() {
  const bar = document.getElementById('bar');
  if (!bar || bar.querySelector('[data-camera-chip]')) return;
  const overviewBtn = document.getElementById('btn-overview');
  for (const oneChip of cameraChipSet) {
    if (oneChip.id === 'overview') {
      overviewBtn.dataset.cameraChip = 'overview';
      overviewBtn.textContent = `${oneChip.label} — orthographic 35° (O)`;
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.cameraChip = oneChip.id;
    b.setAttribute('aria-pressed', 'false');
    b.textContent = oneChip.label;
    b.addEventListener('click', () => goCameraChip(oneChip.id));
    bar.appendChild(b);
  }
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.id = 'btn-reset-view';
  resetBtn.textContent = RESET_VIEW_LABEL;
  resetBtn.addEventListener('click', resetView);
  bar.appendChild(resetBtn);
}
// Verification/capture hook, same standing as __portalProbe: the
// camera surface as data (CAMERA_SURFACE) plus the live view.
window.__portalCamera = {
  surface: CAMERA_SURFACE,
  wordings: CAMERA_WORDINGS,
  get view() { return cameraView; },
  get chips() { return cameraChipSet; },
  get bounds() { return cameraBounds; },
  goChip: (id) => goCameraChip(id),
  reset: () => resetView(),
};

// M4.18 hand-pan/zoom (Overview only): drag pans, wheel zooms —
// both bounded by camera.mjs to cameraBounds, so the town cannot
// be lost into empty space. Follow mode keeps its own gesture:
// the M5.10 pan pause above, untouched.
let viewDrag = null;
canvas.addEventListener('pointerdown', (ev) => {
  if (state.mode === 'overview') viewDrag = { x: ev.clientX, y: ev.clientY, moved: false };
});
canvas.addEventListener('pointermove', (ev) => {
  if (!viewDrag || state.mode !== 'overview' || !cameraView) return;
  const dx = ev.clientX - viewDrag.x, dy = ev.clientY - viewDrag.y;
  if (!dx && !dy) return;
  if (Math.hypot(ev.clientX - (viewDrag.sx ?? viewDrag.x), ev.clientY - (viewDrag.sy ?? viewDrag.y)) > 3) viewDrag.moved = true;
  viewDrag.sx = viewDrag.sx ?? viewDrag.x; viewDrag.sy = viewDrag.sy ?? viewDrag.y;
  viewDrag.x = ev.clientX; viewDrag.y = ev.clientY;
  panCameraView(cameraView, dx, dy, { heightPx: canvas.clientHeight || 800 }, cameraBounds);
  render();
});
const endViewDrag = () => { if (viewDrag?.moved) suppressNextPick = true; viewDrag = null; };
canvas.addEventListener('pointerup', endViewDrag);
canvas.addEventListener('pointercancel', endViewDrag);
canvas.addEventListener('wheel', (ev) => {
  if (state.mode !== 'overview' || !cameraView) return;
  ev.preventDefault();
  zoomCameraView(cameraView, ev.deltaY, cameraBounds);
  render();
}, { passive: false });

document.getElementById('btn-overview').addEventListener('click', () => goCameraChip('overview'));
document.getElementById('btn-follow').addEventListener('click', () => setMode('follow'));
document.getElementById('btn-prev').addEventListener('click', () => cycle(-1));
document.getElementById('btn-next').addEventListener('click', () => cycle(1));
document.getElementById('btn-probe').addEventListener('click', runProbe);
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'o' || ev.key === 'O') goCameraChip('overview');
  else if (ev.key === 'f' || ev.key === 'F') setMode('follow');
  else if (ev.key === '[') cycle(-1);
  else if (ev.key === ']') cycle(1);
});
window.addEventListener('resize', render);

// --------------------------------------------------------------------- boot
(async () => {
  try {
    const [layout, bundle, episodesFeed] = await Promise.all([
      fetch('../../shared/ember-layout.json').then((r) => r.json()),
      fetch('../../data/feed/world-data.json').then((r) => r.json()),
      // The recorded conversations (portal.episodes/v1) — the talk
      // state's source. Absence is graceful: no feed, no talk state,
      // and the talk button says so rather than staging silence.
      fetch('../../data/feed/episodes.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    // M4.18: bounds + chips from the effective layout (staged fill
    // included), before the first frame is drawn.
    const effForCamera = effectiveLayout(layout, bundle);
    cameraBounds = worldBoundsForLayout(effForCamera);
    cameraChipSet = cameraChipsForLayout(effForCamera);
    cameraView = resetCameraView(cameraChipSet);
    buildCameraChips();
    buildLevelChip();
    const { placedCitizens, citizenGroups, railCitizens, eff, nodeGroups, citizensByKey } = buildWorld(layout, bundle);
    // M4.16 roster rail: citizens beyond the actor budget are named
    // here — present in Ember, honestly not embodied in the scene.
    if (railCitizens && railCitizens.length) {
      const railEl = document.getElementById('rail');
      railEl.hidden = false;
      railEl.textContent = `Also in Ember, beyond the scene's figure budget — on the roster rail, not placed in the scene: ${railCitizens.map((c) => c.name).join(', ')}.`;
    }
    // M4.10: attach factory citizen kits over the placeholders of the
    // citizens figure-kits.json covers. Best-effort by design: a kit
    // that fails to load leaves its capsule standing (attachFigureKits
    // reports it), and no kit at all leaves today's scene unchanged.
    let kitNote = '';
    let mixers = [];
    // M4.16 LOD rigs: per embodied kit citizen, the three
    // representations (lod0 / lod1 / standee sprite) with exactly one
    // visible at a time, chosen per frame by scene-system's band +
    // swap rules (never mid-route — a standee never slides).
    const rigs = new Map(); // key -> { group, lod0, lod1, standee, current }
    try {
      const manifest = await fetch(KIT_MANIFEST_URL).then((r) => (r.ok ? r.json() : null));
      if (manifest) {
        // M4.08/M4.25: the shared clip library (work vocabulary +
        // rest pose), and the keys whose treatment is asleep — the
        // treatment is figureStyle's call from the citizen's presence
        // class, computed from the same bundle buildWorld read.
        const workLibrary = await loadWorkLibrary(loadFigure);
        const gestureLibrary = await loadGestureLibrary(loadFigure);
        const sleepKeys = new Set((bundle.citizens || [])
          .filter((c) => figureStyle(c).treatment === 'asleep')
          .map((c) => c.citizenKey || c.handle || c.name));
        const res = await attachFigureKits({ groups: citizenGroups, manifest, load: loadFigure, THREE, sleepKeys, workLibrary, gestureLibrary });
        mixers = res.mixers;
        clipPlayers = res.players || new Map();
        window.__portalClipPlayers = clipPlayers; // capture/verification tooling hook
        if (!workLibrary) kitNote += ' The work-clip library did not load — kits play their own clips only.';
        if (!gestureLibrary) kitNote += ' The gesture-clip library did not load — talk/listening states keep icon + caption only.';
        kitNote = ` ${res.attached.length} citizens wear factory kits (figure-kits.json).`;
        for (const f of res.failed) console.warn(`kit attach failed for ${f.key}: ${f.error} — capsule placeholder kept`);
        for (const key of res.attached) {
          const group = citizenGroups.get(key);
          const entry = manifest.kits[key];
          const lod1 = group.children.find((ch) => typeof ch.name === 'string' && ch.name.startsWith('kit:')) || null;
          const rig = { group, lod0: null, lod1, standee: null, current: 'lod1' };
          try {
            const g0 = await loadFigure(entry.lod0);
            g0.scene.visible = false;
            group.add(g0.scene);
            rig.lod0 = g0.scene;
            const idle0 = (g0.animations || []).find((a) => a.name === 'idle');
            if (idle0) { const mx = new THREE.AnimationMixer(g0.scene); mx.clipAction(idle0).play(); mixers.push(mx); }
          } catch (err) { console.warn(`LOD0 load failed for ${key}: ${err.message} — LOD1/standee still apply`); }
          const spriteUrl = standeeSpriteUrl(entry);
          if (spriteUrl) {
            const tex = new THREE.TextureLoader().load(spriteUrl);
            const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
            spr.scale.set(1.7, 2.3, 1);
            spr.position.y = 1.05;
            spr.visible = false;
            group.add(spr);
            rig.standee = spr;
          }
          rigs.set(key, rig);
        }
        // KITLESS HOLDOUT (2026-11-03, G-J1 touch-up audit
        // close-out): a placed citizen with no figure kit is
        // NEVER stood in with the capsule placeholder — a
        // generic human figure misrepresents them (Pound
        // Meridian's card: a cat, not an agent playing one).
        // Hold them out of the figure layer: group out of the
        // scene graph, name chip out of the label layer, meshes
        // out of the pick list, key out of the citizen map (the
        // talk/demo/interior systems all read that map with
        // presence guards, so a held-out citizen is simply not
        // embodied — their recorded words still play and the
        // talk panel still names them). They are named on the
        // roster rail as present-not-shown. Scope: this runs
        // only when a manifest loaded (no manifest = no basis
        // to tell "no kit exists" from a deployment failure);
        // a kit that exists but failed to load is in
        // res.failed, not res.kitless, and keeps its capsule.
        const kitlessNames = [];
        for (const key of res.kitless || []) {
          const g = citizenGroups.get(key);
          if (g && g.parent) g.parent.remove(g);
          const div = labelDivs.get(`chip:${key}`);
          if (div) { div.remove(); labelDivs.delete(`chip:${key}`); }
          const ci = labelChips.findIndex((c) => c.key === key);
          if (ci >= 0) labelChips.splice(ci, 1);
          for (let i = pickables.length - 1; i >= 0; i--) {
            if (pickables[i].userData.pick && pickables[i].userData.pick.key === key) pickables.splice(i, 1);
          }
          citizenGroups.delete(key);
          kitlessNames.push((citizensByKey.get(key) || {}).name || key);
        }
        if (kitlessNames.length) {
          const line = `In Ember and placed by the record, but not shown as a figure — no figure kit exists for them yet, and Portal does not stand a citizen in with a default figure: ${kitlessNames.join(', ')}. They are named here instead; a figure kit for each is factory follow-up.`;
          // NB: the roster-rail element is fetched here, not
          // reused from the budget block above — that block's
          // railEl is scoped to it (the first staging effect
          // check caught exactly that: the removals landed, then
          // the rail write threw and the catch swallowed it).
          const railEl = document.getElementById('rail');
          if (railEl) {
            railEl.hidden = false;
            railEl.textContent = railEl.textContent ? `${railEl.textContent} ${line}` : line;
          }
          kitNote += ` ${kitlessNames.length} placed citizen${kitlessNames.length === 1 ? ' has' : 's have'} no figure kit and are not stood in as figures (named on the roster rail).`;
          window.__portalKitless = { keys: [...(res.kitless || [])], names: kitlessNames };
        }
      }
    } catch (err) {
      console.warn('figure kits not attached:', err);
    }
    // M4.14: attach the Ember building set over the placeholder
    // blocks. Best-effort by the same rule as the figure kits: a
    // building that fails to load leaves its placeholder standing
    // (attachBuildings reports it), and no manifest at all leaves
    // the scene unchanged.
    let buildingNote = '';
    try {
      const bManifest = await fetch(BUILDING_MANIFEST_URL).then((r) => (r.ok ? r.json() : null));
      if (bManifest) {
        const nodesByCode = new Map((eff.nodes || []).map((n) => [n.code, n]));
        const bRes = await attachBuildings({ groups: nodeGroups, nodes: nodesByCode, manifest: bManifest, load: loadFigure, pickables });
        buildingNote = ` ${bRes.attached.length} of ${Object.keys(bManifest.buildings || {}).length} places wear their M4.14 building kits (building-kits.json).`;
        for (const f of bRes.failed) console.warn(`building attach failed for ${f.code}: ${f.error} — placeholder kept`);
        for (const m of bRes.missing) console.warn(`building kit missing for ${m} — placeholder kept`);
      }
    } catch (err) {
      console.warn('buildings not attached:', err);
    }
    // T3 floor levels: register each attached building's level
    // state from its kit card (the card's `storeys` is the
    // classification's authority — buildings.mjs derives the rest
    // from the loaded GLB). Default ground applies here, before any
    // interior can open, so the shell's built-height capture is
    // never taken from a lowered roof. Best-effort like the kits:
    // a card that fails to load leaves that building level-less.
    let levelNote = '';
    try {
      const bManifest2 = await fetch(BUILDING_MANIFEST_URL).then((r) => (r.ok ? r.json() : null));
      if (bManifest2) {
        for (const [code, entry] of Object.entries(bManifest2.buildings || {})) {
          const group = nodeGroups.get(code);
          const root = group ? group.children.find((c) => c.name === `building:${entry.slug}`) : null;
          if (!root) continue;
          try {
            const card = await fetch(entry.card).then((r) => (r.ok ? r.json() : null));
            const st = registerBuildingLevel(root, card);
            levelCtl.roots.set(code, root);
            levelCtl.states.set(code, st);
          } catch (err) {
            console.warn(`building level not registered for ${code}: ${err.message}`);
          }
        }
        const twoStorey = [...levelCtl.states.values()].filter((s) => s.hasUpper).length;
        if (twoStorey) {
          levelNote = ` ${twoStorey} building${twoStorey === 1 ? ' has' : 's have'} a second storey — it renders at ground level until you select it and use the “${LEVEL_CHIP_LABEL}” chip.`;
        }
      }
    } catch (err) {
      console.warn('building levels not registered:', err);
    }
    // M5.08: register the dollhouse interiors against the building
    // roots attachBuildings just placed — clicking a civic building
    // lifts its roof (see toggleInterior). Best-effort like the
    // kits: no registry, no interiors, the scene unchanged.
    let interiorNote = '';
    try {
      const iReg = await fetch(INTERIOR_KITS_URL).then((r) => (r.ok ? r.json() : null));
      if (iReg) {
        interiorCtl.registry = iReg;
        interiorCtl.bundle = bundle;
        interiorCtl.citizenGroups = citizenGroups;
        for (const [code, group] of nodeGroups) {
          const def = interiorDef(iReg, code);
          if (!def) continue;
          const root = group.children.find((c) => c.name === `building:${def.slug}`);
          if (root) interiorCtl.roots.set(code, root);
        }
        if (interiorCtl.roots.size) {
          interiorNote = ` ${interiorCtl.roots.size} dollhouse interiors stand ready — click a civic building to lift its roof and see exactly who the record places inside.`;
        }
      }
    } catch (err) {
      console.warn('interiors not registered:', err);
    }
    const sky = bundle.world ? `${bundle.world.sky}, ${bundle.world.season} of year ${bundle.world.year}` : 'record';
    infoEl.textContent = `Bundle seq ${bundle.bundleSeq} — ${placedCitizens} citizens placed by the app's citizenPositions; recorded sky: ${sky}.${kitNote}${buildingNote}${interiorNote}${levelNote} ` +
      'Place-conflict holds are a bundle-stream state (M3.04) this single snapshot cannot show — the held-figure treatment is wired and waiting on that seam (see the header note). ' +
      'Rig is the Bible baseline (weather grades land in a later wave). Click a building or citizen, or press ] to tour follow targets.';

    // ------------------------------------------- demo replay in 3D
    // The demo journey (a recording — build/fixtures/demo-journey.json)
    // replayed through the real engine: the driver answers positions,
    // this loop only moves the figure group to them. Calmer (M4.20)
    // swaps the glide for the stepped player; the journey, the route
    // and every visited square are identical either way.
    const labelFor = (code) => (layout.nodes.find((n) => n.code === code) || {}).label || code;
    const demo = { active: false, calmer: false, key: null, journey: null, driver: null, player: null, tick: 0, between: null, lastPose: -1 };
    const DEMO_TICKS_PER_SECOND = 2; // the app demo's own rate
    async function toggleDemo() {
      if (demo.active) { demo.active = false; document.getElementById('btn-demo').setAttribute('aria-pressed', 'false'); return; }
      try {
        const spec = await fetch('../../fixtures/demo-journey.json').then((r) => r.json());
        const key = `portal-key:${spec.handle}`;
        if (!citizenGroups.has(key)) {
          infoEl.textContent = `The demo journey's citizen (${spec.name || spec.handle}) is not placed in this bundle — nothing to replay.`;
          return;
        }
        demo.journey = planJourney({ handle: spec.handle, path: spec.path, startTick: spec.startTick, ticksPerStep: spec.ticksPerStep });
        demo.driver = createDriver({ layout });
        demo.driver.addJourney(key, demo.journey);
        demo.key = key;
        demo.tick = demo.journey.startTick;
        demo.between = null;
        demo.lastPose = -1;
        demo.player = createCalmerPlayer(demo.journey, layout, { labelFor });
        demo.active = true;
        document.getElementById('btn-demo').setAttribute('aria-pressed', 'true');
        infoEl.textContent = `● RECORDING — replaying the demo journey in 3D: ${spec.name || spec.handle} walks ${spec.path.map(labelFor).join(' → ')}.`;
      } catch (err) {
        infoEl.textContent = `Demo journey could not start (${err.message}).`;
      }
    }
    document.getElementById('btn-demo').addEventListener('click', toggleDemo);
    document.getElementById('btn-calmer').addEventListener('click', () => {
      demo.calmer = !demo.calmer;
      demo.lastPose = -1;
      document.getElementById('btn-calmer').setAttribute('aria-pressed', String(demo.calmer));
      infoEl.textContent = demo.calmer
        ? 'Calmer on: stepped still poses along the route, captions carry the journey — every square in order, only the glide removed.'
        : 'Calmer off: the glide is back. The route never changed.';
    });

    function stepDemo(dt) {
      if (!demo.active || !demo.journey) return;
      if (demo.tick < demo.journey.endTick) demo.tick = Math.min(demo.journey.endTick, demo.tick + dt * DEMO_TICKS_PER_SECOND);
      const group = citizenGroups.get(demo.key);
      if (!group) return;
      if (demo.calmer && demo.player) {
        const p = demo.player.positionAt(demo.tick);
        const w = gridToWorld(p.x, p.y);
        group.position.set(w.x, 0, w.z);
        demo.between = null; // a pose is always AT a square
        const pose = demo.player.poses.find((q) => q.code === p.code && q.x === p.x && q.y === p.y);
        const idx = pose ? demo.player.poses.indexOf(pose) : -1;
        if (idx !== demo.lastPose && pose) {
          demo.lastPose = idx;
          infoEl.textContent = `● RECORDING (Calmer) — ${pose.caption}`;
        }
      } else {
        const p = demo.driver.positionAt(demo.key, demo.tick);
        const w = gridToWorld(p.x, p.y);
        group.position.set(w.x, 0, w.z);
        demo.between = p.between;
      }
    }

    function evalLod() {
      if (!rigs.size) return;
      const cam = currentCam();
      for (const [key, rig] of rigs) {
        const d = cam.position.distanceTo(rig.group.position);
        const wanted = representationFor({
          current: rig.current, distance: d,
          between: key === demo.key && demo.active ? demo.between : null,
        });
        if (wanted === rig.current) continue;
        // A representation that failed to load cannot be shown; fall
        // back to the nearest loaded one rather than blanking a citizen.
        const has = { lod0: !!rig.lod0, lod1: !!rig.lod1, standee: !!rig.standee };
        const pick = has[wanted] ? wanted : has.lod1 ? 'lod1' : has.lod0 ? 'lod0' : 'standee';
        if (rig.lod0) rig.lod0.visible = pick === 'lod0';
        if (rig.lod1) rig.lod1.visible = pick === 'lod1';
        if (rig.standee) rig.standee.visible = pick === 'standee';
        rig.current = pick;
      }
    }

    // ------------------------------------------- talk state in 3D
    // (M5.01/M5.03 consumption): the recorded conversations staged
    // on the figures through the ONE consumption model
    // (talk-state.mjs over logic.talkActPresentation — the same
    // call the panel and the 2D stage make). Playback is explicit:
    // the button starts a labelled RECORDING that runs on the frame
    // clock in the record's own order. Gestures play on the
    // figures' existing clip players; facing rotates a figure
    // toward the model's facing point. The model never writes a
    // position — but this RECORDING surface, since G-J1 round 5,
    // stages the act's participants at the act's recorded place
    // for the act's duration (talk-state.mjs's recordedActPositions,
    // resolved through sceneTalkAct): round 4 staged the words on
    // figures standing at their live places, so one act visually
    // happened in three places at once (my Hark's round-4 audit,
    // blocker 2). The staging is this surface's own, under the
    // ● RECORDING label; saved positions restore when the act
    // changes or playback stops, and no live surface ever moves
    // a figure.
    // Altitude follows the camera: overview is TOWN altitude (talk
    // collapses to icon + caption — no bubble, no facing, no
    // gesture); follow is SCENE altitude (bubble + gestures +
    // facing). This playback is a recording, and the model is
    // called in recording mode (VER-D22, the project owner's ruling): a
    // figure asleep in the LIVE snapshot still performs its
    // recorded act — the record is the authority for who was
    // awake at it — and its live treatment resumes untouched when
    // playback stops. The record's own facts still suppress (a
    // held figure's disputed place; a rail figure this scene does
    // not embody); the overlay then carries the model's
    // resolution line, not a performance.
    // The clip-preview buttons are a separate labelled vocabulary
    // preview; a talk act change overrides them on the figures it
    // touches, and stopping talk restores idle / the asleep clip.
    const talkTimeline = buildTalkTimeline(episodesFeed?.episodes || []);
    const talkBtn = document.getElementById('btn-talk');
    const talkOverlay = document.getElementById('talk-overlay');
    const talkEls = {
      fence: document.getElementById('talk-fence'), head: document.getElementById('talk-head'),
      words: document.getElementById('talk-words'), marker: document.getElementById('talk-marker'),
      read: document.getElementById('talk-read'), caption: document.getElementById('talk-caption'),
    };
    const nameKey = new Map();
    for (const [key, c] of citizensByKey) if (c?.name && !nameKey.has(c.name)) nameKey.set(c.name, key);
    const railNames = new Set((railCitizens || []).map((c) => c.name));
    const talk = {
      active: false, elapsedMs: 0, appliedId: null, anchorKey: null,
      participantKeys: null, // G-J1 round 4: {speaker, listeners[]} — the panel placement's refusal inputs
      lastPanelCheck: null, // G-J1 round 4: the last refusal placement's inputs + result (capture hook below)
      savedRotations: new Map(), touchedPlayers: new Set(),
      suspendedSleep: new Map(), // G-J1 round 3: key -> {badges, mats} hidden/lifted for the current act
      savedPositions: new Map(), // G-J1 round 5: key -> {x, z} live group position, while the act stages the figure at its recorded place
      lastStaged: null, // G-J1 round 5: {placeCode, placeLabel, positionsByName, stagedPlace} of the current act's staging (capture hook below)
    };
    // Verification/capture hook, same standing as __portalCamera:
    // the speech panel's figure-refusal, as the scene itself
    // computed it — the projected rects the placement judged and
    // the rung it took — so a capture can assert panel-vs-figure
    // geometry from the page's own numbers, not by eye.
    window.__portalTalk = {
      get panelCheck() { return talk.lastPanelCheck; },
      get participantKeys() { return talk.participantKeys; },
      get staged() { return talk.lastStaged; },
    };
    function talkTreatments() {
      const out = {};
      for (const c of citizensByKey.values()) {
        if (!c?.name) continue;
        const t = figureStyle(c).treatment;
        if (t && t !== 'normal') out[c.name] = t;
      }
      for (const n of railNames) out[n] = 'overflow'; // M4.16: named on the rail, never embodied
      return out;
    }
    function talkPositionsByName() {
      // The figures' LIVE group positions, read back through the
      // scene's own grid transform (gridToWorld's inverse) — read
      // only: talk reads positions for facing and writes none.
      const out = {};
      for (const [key, g] of citizenGroups) {
        const c = citizensByKey.get(key);
        if (c?.name) out[c.name] = { x: g.position.x / CELL + 4, y: g.position.z / CELL + 4 };
      }
      return out;
    }
    function restoreTalkFigures() {
      // Sleep suspension lifts first (G-J1 round 3): badges shown
      // again, dimming back to the live treatment's own values —
      // and the label layer's reclined flag returns with them
      // (G-J1 round 5 Item 2: applyTalkAct stood the figure up
      // for the label layer too; see there).
      for (const [, saved] of talk.suspendedSleep) {
        for (const b of saved.badges) b.obj.visible = b.visible;
        for (const m of saved.mats) m.mat.opacity = m.opacity;
        if (saved.chipReclined) saved.chipReclined.reclined = true;
      }
      talk.suspendedSleep.clear();
      // Recorded-act staging restores (G-J1 round 5): every figure
      // the act moved to its recorded place returns to the live
      // position it was saved from — the live snapshot is exactly
      // as it was, as with the treatments above.
      for (const [key, pos] of talk.savedPositions) {
        const g = citizenGroups.get(key);
        if (g) { g.position.x = pos.x; g.position.z = pos.z; }
      }
      talk.savedPositions.clear();
      talk.lastStaged = null;
      talkStagedFollow = null;
      for (const [key, rot] of talk.savedRotations) {
        const g = citizenGroups.get(key);
        if (g) g.rotation.y = rot;
      }
      talk.savedRotations.clear();
      for (const key of talk.touchedPlayers) {
        const player = clipPlayers.get(key);
        if (!player) continue;
        const c = citizensByKey.get(key);
        const asleep = !!c && figureStyle(c).treatment === 'asleep';
        if (!(asleep && player.play(ASLEEP_CLIP, { fade: 0.25 }))) player.play('idle', { fade: 0.25 });
      }
      talk.touchedPlayers.clear();
      talk.anchorKey = null;
      talk.participantKeys = null;
      talk.lastPanelCheck = null;
    }
    function applyTalkAct(pres) {
      restoreTalkFigures();
      // Sleep suspension (G-J1 round 3 — the recordings ruling's
      // presentation consequence): a participant the live snapshot
      // has asleep, whom the record stages in this act, does not
      // wear the sleep presentation while the act plays — the Zzz
      // badge hides and the asleep dimming lifts. The model names
      // them (pres.suspendSleep, recording mode only);
      // restoreTalkFigures puts both back when the act changes or
      // playback stops. Non-participants are never named, so their
      // sleep is untouched.
      for (const name of pres.suspendSleep || []) {
        const key = nameKey.get(name);
        const g = key ? citizenGroups.get(key) : null;
        if (!g) continue;
        const saved = { badges: [], mats: [] };
        g.traverse((o) => {
          if (o.userData && o.userData.sleepBadge) { saved.badges.push({ obj: o, visible: o.visible }); o.visible = false; }
          if (o.isMesh && o.material) {
            for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
              if (typeof m.opacity === 'number' && m.opacity < 1) { saved.mats.push({ mat: m, opacity: m.opacity }); m.opacity = 1; }
            }
          }
        });
        // Presented-pose truth for the label layer (G-J1 round 5
        // Item 2): while the sleep presentation is suspended the
        // figure STANDS (its talk/listen clip plays; badge and
        // dimming are off), so the label layer must stop measuring
        // it as reclined — the seq-654 capture showed the failure
        // otherwise: the participant's plate was placed for a
        // lying body and landed on her standing figure, and the
        // panel's refusal rect for her was the reclined shape.
        // The flag restores in restoreTalkFigures with the rest
        // of the suspension.
        const chip = labelChips.find((c) => c.key === key);
        if (chip && chip.reclined) { saved.chipReclined = chip; chip.reclined = false; }
        if (saved.badges.length || saved.mats.length || saved.chipReclined) talk.suspendedSleep.set(key, saved);
      }
      // Recorded-act staging (G-J1 round 5 — my Hark's round-4
      // audit, blocker 2): the act's participants stand at the
      // act's RECORDED place for the act's duration, so the
      // panel, the act text, and the figures all name the same
      // building. pres.stagedPositions is the model's staged set
      // (speaker + unblocked listeners, grid coords) resolved by
      // talk-state.mjs from the record's place; it is null for
      // live mode, a suppressed act, or an unresolvable place —
      // in every such case no figure moves, exactly as before.
      // Live positions are saved first and restored by
      // restoreTalkFigures when the act changes or playback
      // stops. Facing below reads talkPositionsByName() AFTER
      // this move, so it resolves over the staged positions the
      // model itself faced from.
      if (pres.stagedPositions) {
        for (const [name, gp] of Object.entries(pres.stagedPositions)) {
          const key = nameKey.get(name);
          const g = key ? citizenGroups.get(key) : null;
          if (!g || !key) continue;
          if (!talk.savedPositions.has(key)) talk.savedPositions.set(key, { x: g.position.x, z: g.position.z });
          const w = gridToWorld(gp.x, gp.y);
          g.position.x = w.x; g.position.z = w.z;
        }
        talk.lastStaged = {
          placeCode: pres.stagedPlace?.code || pres.placeCode,
          placeLabel: pres.placeLabel,
          positionsByName: pres.stagedPositions,
          // The presentation's own staged place object ({code,
          // point}), carried so the panel check below can report
          // the place the PANEL is staged at — the read the
          // round-5 capture surface was designed around (Item 2's
          // diagnosis: lastPanelCheck never carried it, so the
          // capture's panel-place sub-condition could never hold).
          stagedPlace: pres.stagedPlace || null,
        };
        const sw = gridToWorld(pres.stagedPositions[pres.speaker.name].x, pres.stagedPositions[pres.speaker.name].y);
        talkStagedFollow = { placeCode: talk.lastStaged.placeCode, x: sw.x, z: sw.z };
      }
      const speakerKey = nameKey.get(pres.speaker?.name || '');
      talk.anchorKey = speakerKey && citizenGroups.has(speakerKey) ? speakerKey : null;
      talk.participantKeys = {
        speaker: talk.anchorKey,
        listeners: (pres.listeners || [])
          .filter((l) => !l.blocked)
          .map((l) => nameKey.get(l.name))
          .filter((k) => k && citizenGroups.has(k)),
      };
      talkOverlay.hidden = false;
      talkEls.fence.textContent = ''; talkEls.head.textContent = '';
      talkEls.words.textContent = ''; talkEls.marker.textContent = '';
      talkEls.read.replaceChildren(); talkEls.caption.textContent = '';
      if (!talk.anchorKey) { talkOverlay.style.left = '12px'; talkOverlay.style.top = '12px'; talkOverlay.style.transform = 'none'; }
      if (pres.suppressed) {
        talkEls.caption.textContent = pres.suppressedBy
          ? `${pres.suppressedBy.name} ${pres.suppressedBy.resolution}.`
          : 'This recorded act is not staged on the figures.';
        return;
      }
      if (pres.collapsed && pres.collapsed.mode === 'icon-caption') {
        // Town altitude (M5.03): icon + caption only — the talking
        // head icon with its word, and the model's caption. No
        // bubble, no facing, no gesture at this altitude.
        const p = pres.speaker.presentation;
        const row = document.createElement('div');
        row.textContent = p && p.icon ? `${p.icon.glyph} ${p.icon.word}` : 'Talking';
        talkEls.read.append(row);
        talkEls.caption.textContent = pres.collapsed.caption || '';
        return;
      }
      // Scene altitude: gestures in place, facing per the staging
      // model, and the bubble from the kit's stage variant.
      const playOn = (name, clip) => {
        const key = nameKey.get(name);
        const player = key ? clipPlayers.get(key) : null;
        if (player && clip && player.play(clip)) talk.touchedPlayers.add(key);
      };
      playOn(pres.speaker.name, pres.speaker.clip);
      for (const l of pres.listeners) if (!l.blocked) playOn(l.name, l.clip);
      const positions = talkPositionsByName();
      const faceToward = (name, point) => {
        const key = nameKey.get(name);
        const g = key ? citizenGroups.get(key) : null;
        const from = positions[name];
        if (!g || !point || !from) return;
        if (!talk.savedRotations.has(key)) talk.savedRotations.set(key, g.rotation.y);
        const dx = point.x - from.x, dz = point.y - from.y;
        if (dx || dz) g.rotation.y = Math.atan2(dx, dz);
      };
      faceToward(pres.speaker.name, pres.speaker.facesPoint);
      for (const l of pres.listeners) if (!l.blocked) faceToward(l.name, l.facesPoint);
      const kit = pres.bubble;
      if (kit) {
        talkEls.fence.textContent = `${kit.quote} ${kit.label}`;
        talkEls.head.textContent = kit.header;
        talkEls.words.textContent = kit.displayText; // the kit's display text: whole words, or a marked prefix
        talkEls.marker.textContent = kit.marker || '';
      }
      const rowFor = (fig) => {
        if (!fig || !fig.presentation) return;
        const p = fig.presentation;
        const row = document.createElement('div');
        row.textContent = `${p.icon ? `${p.icon.glyph} ${p.icon.word}` : ''} — ${p.caption || ''}`;
        talkEls.read.append(row);
      };
      rowFor(pres.speaker);
      for (const l of pres.listeners) if (!l.blocked) rowFor(l);
    }
    function startTalk3d() {
      if (!talkTimeline.scenes.length) {
        infoEl.textContent = 'No recorded conversations reached this scene — the episodes feed is absent or carries no recorded words, so no talk is staged.';
        return;
      }
      talk.active = true;
      talk.elapsedMs = 0;
      talk.appliedId = null;
      talkBtn.setAttribute('aria-pressed', 'true');
      infoEl.textContent = `● RECORDING — the recorded conversations play in the 3D scene, in the order they were spoken (${talkTimeline.scenes.length} conversation${talkTimeline.scenes.length === 1 ? '' : 's'}${talkTimeline.skipped.length ? `; ${talkTimeline.skipped.length} wordless episode${talkTimeline.skipped.length === 1 ? '' : 's'} skipped, as the scheduler rules` : ''}). Overview collapses talk to icon + caption; follow a citizen for the staged scene.`;
    }
    function stopTalk3d(finished) {
      talk.active = false;
      restoreTalkFigures();
      talkOverlay.hidden = true;
      talkBtn.setAttribute('aria-pressed', 'false');
      infoEl.textContent = finished
        ? 'The recorded conversations have played through — the scene is back to the live snapshot.'
        : 'Talk playback stopped — the scene is back to the live snapshot.';
    }
    talkBtn.addEventListener('click', () => (talk.active ? stopTalk3d(false) : startTalk3d()));
    function stepTalk(dt) {
      if (!talk.active) return;
      talk.elapsedMs += dt * 1000;
      if (talk.elapsedMs >= talkTimeline.endMs) { stopTalk3d(true); return; }
      const pres = sceneTalkAct({
        timeline: talkTimeline, elapsedMs: talk.elapsedMs,
        positionsByName: talkPositionsByName(), placeLabel: labelFor,
        altitude: state.mode === 'overview' ? 'town' : 'scene',
        treatments: talkTreatments(),
        // A RECORDING (VER-D22): the programme is the recorded
        // conversations, so the record governs who was awake at
        // each act; the live treatments above are inputs to the
        // model, not vetoes over the record.
        mode: 'recording',
        // Recorded-act staging (G-J1 round 5): the act's place
        // resolves to its layout node — the record's one
        // positional fact — and the act's participants are
        // staged there for the act's duration.
        placePointFor: (code) => {
          const n = (layout.nodes || []).find((nd) => nd.code === code);
          return n ? { x: n.x, y: n.y } : null;
        },
      });
      const id = pres ? `${pres.key}|${pres.index}|${state.mode}` : 'gap';
      if (id !== talk.appliedId) {
        talk.appliedId = id;
        if (pres) applyTalkAct(pres);
        else { restoreTalkFigures(); talkOverlay.hidden = true; }
      }
    }
    function placeTalkOverlay() {
      if (!talk.active || talkOverlay.hidden || !talk.anchorKey) return;
      const g = citizenGroups.get(talk.anchorKey);
      if (!g) return;
      const w = canvas.clientWidth || 1280, h = canvas.clientHeight || 800;
      const cam = currentCam();
      _v.set(g.position.x, 2.6, g.position.z).project(cam);
      if (_v.z > 1 || _v.z < -1) { talkOverlay.style.display = 'none'; return; }
      talkOverlay.style.display = '';
      const anchor = { x: (_v.x * 0.5 + 0.5) * w, y: (1 - (_v.y * 0.5 + 0.5)) * h };
      // Figure-refusal for the speech panel (G-J1 round 4 — my
      // Hark's round-3 audit, blocker 2): the panel never covers
      // the speaker's projected rect. The rect construction is
      // updateLabels' own (standing 1×1×1.95; reclined toward +z,
      // low and long), projected with the live camera; the
      // placement rule itself is talk-state.mjs's
      // talkPanelPlacement — offsets tried in order, listeners
      // covered only when no offset avoids it, the speaker never.
      // Since round 5 the refusal also covers the frame's placed
      // LABELS — place labels and citizen plates alike (round 4's
      // panel sat on The College's label and on Lenore
      // Nevermore's plate): the boxes are this frame's own
      // resolver output (the module-level placements map,
      // refreshed by render() before this runs).
      const project = (p) => {
        _v.set(p.x, p.y, p.z).project(cam);
        return { x: (_v.x * 0.5 + 0.5) * w, y: (1 - (_v.y * 0.5 + 0.5)) * h };
      };
      const screenAabb = (cx, cz, bw, bd, topY) => {
        const pts = [];
        for (const px of [cx - bw / 2, cx + bw / 2]) {
          for (const pz of [cz - bd / 2, cz + bd / 2]) {
            for (const py of [0, topY]) pts.push(project({ x: px, y: py, z: pz }));
          }
        }
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      };
      const chipByKey = new Map(labelChips.map((c) => [c.key, c]));
      const rectFor = (key) => {
        const grp = citizenGroups.get(key);
        if (!grp) return null;
        const gx = grp.position.x, gz = grp.position.z;
        return chipByKey.get(key)?.reclined
          ? screenAabb(gx, gz + 0.85, 1.0, 2.1, 0.75)
          : screenAabb(gx, gz, 1.0, 1.0, 1.95);
      };
      const labelRects = placements
        ? [...placements.values()].filter((r) => r && r.box).map((r) => ({ ...r.box }))
        : [];
      const placement = talkPanelPlacement({
        anchor,
        panel: { w: talkOverlay.offsetWidth, h: talkOverlay.offsetHeight },
        speakerRect: rectFor(talk.anchorKey),
        listenerRects: (talk.participantKeys?.listeners || []).map(rectFor).filter(Boolean),
        labelRects,
        viewport: { width: w, heightPx: h },
      });
      if (!placement || !talkOverlay.offsetWidth) {
        // Unmeasurable this frame (overlay not laid out yet): the
        // traditional centred spot for one frame; the refusal
        // placement takes over as soon as the size is real.
        talk.lastPanelCheck = null;
        talkOverlay.style.left = `${anchor.x.toFixed(1)}px`;
        talkOverlay.style.top = `${anchor.y.toFixed(1)}px`;
        talkOverlay.style.transform = 'translate(-50%, -100%)';
        return;
      }
      talk.lastPanelCheck = {
        speakerRect: rectFor(talk.anchorKey),
        listenerRects: (talk.participantKeys?.listeners || []).map(rectFor).filter(Boolean),
        labelRects,
        // The panel's own staged place: the current act's
        // presentation staged place, as recorded by applyTalkAct
        // — null whenever the act on stage is not a staged
        // recording act. Place agreement (the episode's place ==
        // the staging's place == the panel's place) is asserted
        // from this read; it was absent before the round-5 Item 2
        // fix, which left that assertion unmeetable in the page.
        stagedPlace: talk.lastStaged?.stagedPlace ?? null,
        placement: { x: placement.x, y: placement.y, rung: placement.rung, coversListener: placement.coversListener, coversLabel: placement.coversLabel, fallback: placement.fallback },
        panel: { w: talkOverlay.offsetWidth, h: talkOverlay.offsetHeight },
      };
      talkOverlay.style.left = `${placement.x.toFixed(1)}px`;
      talkOverlay.style.top = `${placement.y.toFixed(1)}px`;
      talkOverlay.style.transform = 'none';
    }

    render();
    // One frame loop for everything the M4.16 scene does per frame:
    // demo stepping, kit idle animation, LOD evaluation.
    const clock = new THREE.Clock();
    const tick = () => {
      const dt = Math.min(clock.getDelta(), 0.1);
      stepDemo(dt);
      stepTalk(dt);
      for (const m of mixers) m.update(dt);
      render();
      placeTalkOverlay();
      updateInteriorLabels();
      evalLod();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    runProbe();
  } catch (err) {
    infoEl.textContent = `Could not load layout/bundle (${err.message}). Serve over HTTP or open with file access allowed; paths are ../../shared/ember-layout.json and ../../data/feed/world-data.json.`;
    probeEl.textContent = 'Probe: not run — data failed to load.';
    console.error(err);
  }
})();
