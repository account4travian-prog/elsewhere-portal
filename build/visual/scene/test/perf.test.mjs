/* M4.16 — frame-rate evidence on the golden gathering fixture.
 *
 * METHOD, stated plainly: this environment has no GPU and no browser
 * renderer available to Node, so this test measures the CPU side of
 * a frame — the work the scene itself does per frame: driver
 * positions for every driven figure, LOD band evaluation per figure,
 * animation mixer updates for every embodied kit figure, and a full
 * scene-graph matrix update over the real chunked graph (buildings +
 * 30 embodied figures with real parsed kit GLBs). GPU rasterization
 * is NOT measured and this test does not claim it: the gate it proves
 * is "the scene's own per-frame CPU cost sustains ≥ 30 fps with
 * headroom" — if CPU cost per frame exceeded 33.3 ms, 30 fps would
 * be impossible regardless of GPU.
 *
 * THE FIXTURE: the golden gathering — the app fixture bundle
 * (sample-world-data.json: six citizens gathered at the Plaza and
 * Town Hall) — replayed with every citizen walking the demo-journey
 * pattern to the Plaza, at the full actor budget: the fixture's cast
 * plus gathered stand-ins up to 31 placed figures, of which the
 * budget embodies 30 and rails 1 (the M4.16 gate shape).
 *
 * Run per file: node --test test/perf.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

globalThis.self = globalThis;
register('./three-vendor-hook.mjs', import.meta.url);

const THREE = await import('../vendor/three.module.js');
const { clone } = await import('../vendor/SkeletonUtils.js');
const { createFigureLoader, parseFigure } = await import('../figure-loader.mjs');
const { planJourney } = await import('../../../engine/playback.mjs');
const { createDriver } = await import('../playback-driver.mjs');
const { chunkLayout, lodForDistance, assignActors, MAX_ACTORS } = await import('../scene-system.mjs');

const LAYOUT = JSON.parse(readFileSync(new URL('../../../shared/ember-layout.json', import.meta.url), 'utf8'));
const SAMPLE = JSON.parse(readFileSync(new URL('../../../app/fixtures/sample-world-data.json', import.meta.url), 'utf8'));
const KITS = JSON.parse(readFileSync(new URL('../figure-kits.json', import.meta.url), 'utf8'));

test('frame CPU cost sustains ≥30 fps on the golden gathering at full actor budget', async () => {
  // --- build the chunked graph (buildings as the scaffold's blocks)
  const scene = new THREE.Scene();
  const chunks = chunkLayout(LAYOUT);
  for (const [id, nodes] of chunks) {
    const g = new THREE.Group();
    g.name = `chunk:${id}`;
    for (const n of nodes) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(6.4, 5, 6.4), new THREE.MeshToonMaterial({ color: 0xcfbe95 }));
      b.position.set((n.x - 4) * 10, 2.5, (n.y - 4) * 10);
      g.add(b);
    }
    scene.add(g);
  }

  // --- the cast: the gathering fixture's citizens + stand-ins to 31
  // (stand-ins are synthetic keys wearing real kits — a stress cast,
  // labelled as such; the fixture's own citizens keep their keys).
  const kitKeys = Object.keys(KITS.kits);
  const kitByKey = new Map();
  const keys = [];
  for (const c of (SAMPLE.citizens || []).filter((x) => x.placeCode)) {
    keys.push(c.citizenKey);
    if (KITS.kits[c.citizenKey]) kitByKey.set(c.citizenKey, c.citizenKey);
  }
  for (let i = 0; keys.length < 31; i++) {
    const key = `standin:${i}`;
    keys.push(key);
    kitByKey.set(key, kitKeys[i % kitKeys.length]);
  }
  const { actors, rail } = assignActors(keys.slice(0, 31));
  assert.equal(actors.length, MAX_ACTORS);
  assert.equal(rail.length, 1);

  // --- embody the actors with real kit GLBs (clones of parsed kits)
  const loader = createFigureLoader();
  const parsed = new Map();
  for (const key of actors) {
    const kitKey = kitByKey.get(key);
    const entry = kitKey && KITS.kits[kitKey];
    if (!entry) continue;
    if (!parsed.has(kitKey)) {
      const url = new URL(`../${entry.lod1}`, import.meta.url);
      const buf = readFileSync(url);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      parsed.set(kitKey, await parseFigure(loader, ab, entry.lod1));
    }
  }
  const driver = createDriver({ layout: LAYOUT });
  const figures = new Map(); // key -> {group, mixer}
  for (const key of actors) {
    const kitKey = kitByKey.get(key);
    const src = kitKey && parsed.get(kitKey);
    const group = new THREE.Group();
    let mixer = null;
    if (src) {
      const fig = clone(src.scene);
      group.add(fig);
      const idle = (src.animations || []).find((a) => a.name === 'idle');
      if (idle) { mixer = new THREE.AnimationMixer(fig); mixer.clipAction(idle).play(); }
    }
    scene.add(group);
    figures.set(key, { group, mixer });
    // Every figure walks the gathering pattern: its place -> Plaza.
    const citizen = (SAMPLE.citizens || []).find((c) => c.citizenKey === key);
    const from = citizen?.placeCode || 'EMBER_COLLEGE';
    driver.addJourney(key, planJourney({
      handle: key, path: [from, 'EMBER_PLAZA_OF_UNITY'], startTick: 1000, ticksPerStep: 4,
    }));
  }

  // --- run frames: 600 frames at the driver's tick clock
  const FRAMES = 600;
  const camPos = { x: 0, y: 40, z: 60 }; // overview-ish vantage for LOD evaluation
  const frameMs = [];
  let lodCounts = { lod0: 0, lod1: 0, standee: 0 };
  for (let f = 0; f < FRAMES; f++) {
    const t0 = performance.now();
    const tick = 1000 + (f / 60) / 30 * 30; // 60 fps cadence over world ticks (30 s/tick at 1×: f/60 s -> tick = 1000 + f/1800... kept simple below)
    void tick;
    const tickF = 1000 + f / 120; // half a world-tick per 60 frames ≈ walking pace across the fixture span
    const frame = driver.frame(tickF);
    lodCounts = { lod0: 0, lod1: 0, standee: 0 };
    for (const [key, pos] of frame) {
      const fig = figures.get(key);
      if (!fig) continue;
      fig.group.position.set((pos.x - 4) * 10, 0, (pos.y - 4) * 10);
      const d = Math.hypot(fig.group.position.x - camPos.x, fig.group.position.z - camPos.z);
      lodCounts[lodForDistance(d)]++;
      if (fig.mixer) fig.mixer.update(1 / 60);
    }
    scene.updateMatrixWorld(true);
    frameMs.push(performance.now() - t0);
  }
  frameMs.sort((a, b) => a - b);
  const avg = frameMs.reduce((s, v) => s + v, 0) / frameMs.length;
  const p95 = frameMs[Math.floor(frameMs.length * 0.95)];
  console.log(`perf: ${FRAMES} frames, ${actors.length} embodied figures (+${rail.length} railed), ` +
    `avg frame CPU ${avg.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, sustained CPU-bound fps ${(1000 / avg).toFixed(0)}; ` +
    `final-frame LOD mix ${JSON.stringify(lodCounts)} (GPU rasterization not measured — see header)`);
  assert.ok(avg < 33.3, `average frame CPU ${avg.toFixed(2)} ms exceeds the 30 fps budget`);
  assert.ok(p95 < 33.3, `p95 frame CPU ${p95.toFixed(2)} ms exceeds the 30 fps budget`);
});
