/* M5.08 dollhouse interiors + M5.12 standing line.
   Run per file: node --test test/interiors.test.mjs

   Proven here:
   - the registry holds exactly the plan's seven interiors, each
     with its GLB's named stations and anchors, and the generated
     file is byte-identical to a fresh generation (determinism).
   - the ONE shell template opens and closes on two buildings
     (College, Meridian Hall) without breakage: cut walls hide,
     the roof lifts in the same scene, closing restores the built
     state exactly, and re-opening is idempotent.
   - occupancy is exact: an interior's occupants are the bundle's
     citizens at its place code — the live bundle diffed by hand —
     and an unoccupied interior renders the empty-room line.
   - station discipline: an evidenced role takes its functional
     station; the general pass NEVER fills a functional station;
     every standing position lands inside the room.
   - threshold walks: the door anchor is a vertex of the path, the
     densified walk passes the continuity check, and the check
     itself catches a planted teleport (positive control). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

globalThis.self = globalThis;
register('./three-vendor-hook.mjs', import.meta.url);

const { createFigureLoader, parseFigure } = await import('../figure-loader.mjs');
const {
  INTERIOR_CODES, STANDING_LINE, EMPTY_ROOM_LINE,
  interiorDef, shellPlan, applyShell, interiorOccupants,
  assignStations, interiorRenderModel, thresholdPath, densifyPath, pathContinuity,
} = await import('../interiors.mjs');
const { buildInteriorRegistry } = await import('../gen-interiors.mjs');

const REGISTRY = JSON.parse(readFileSync(new URL('../interior-kits.json', import.meta.url), 'utf8'));
const MANIFEST = JSON.parse(readFileSync(new URL('../building-kits.json', import.meta.url), 'utf8'));
const BUNDLE = JSON.parse(readFileSync(new URL('../../../data/feed/world-data.json', import.meta.url), 'utf8'));

async function loadBuilding(code) {
  const entry = MANIFEST.buildings[code];
  const url = new URL(entry.glb, new URL('../building-kits.json', import.meta.url));
  const d = readFileSync(url);
  const loader = createFigureLoader();
  const gltf = await parseFigure(loader, d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
  return gltf.scene;
}
function findNamed(root, name) {
  let hit = null;
  root.traverse((o) => { if (o.name === name) hit = o; });
  return hit;
}

test('registry: exactly the seven named interiors, stations + anchors from the GLBs', () => {
  assert.deepEqual(Object.keys(REGISTRY.interiors).sort(), [...INTERIOR_CODES].sort());
  for (const code of INTERIOR_CODES) {
    const def = REGISTRY.interiors[code];
    assert.ok(def.stations.length >= 1, `${code}: at least one named station`);
    assert.ok(def.anchors.door && def.anchors.camInterior, `${code}: door + interior camera anchors`);
    assert.deepEqual(def.cutNodes, ['cut_wall_front', 'cut_wall_side'], `${code}: cut set`);
  }
  const hall = REGISTRY.interiors.EMBER_DISTRICT_3_PLOT_18;
  assert.equal(hall.stations.filter((s) => s.kind === 'general').length, 6, 'Meridian Hall: six dinner seats');
  assert.equal(hall.stations.find((s) => s.kind === 'functional').suffix, 'dinner_host');
});

test('registry file is byte-identical to a fresh generation', () => {
  const fresh = JSON.stringify(buildInteriorRegistry(), null, 1) + '\n';
  const onDisk = readFileSync(new URL('../interior-kits.json', import.meta.url), 'utf8');
  assert.equal(onDisk, fresh);
});

test('the shell template opens and closes the College without breakage', async () => {
  const def = interiorDef(REGISTRY, 'EMBER_COLLEGE');
  const root = await loadBuilding('EMBER_COLLEGE');
  const roof = findNamed(root, 'cut_roof');
  const restY = roof.position.y;
  const opened = applyShell(root, shellPlan(def, true));
  assert.deepEqual(opened.hidden.sort(), ['cut_wall_front', 'cut_wall_side']);
  assert.equal(findNamed(root, 'cut_wall_front').visible, false);
  assert.equal(findNamed(root, 'cut_wall_side').visible, false);
  assert.equal(roof.position.y, restY + 3, 'roof lifted in the same scene');
  applyShell(root, shellPlan(def, true)); // idempotent re-open
  assert.equal(roof.position.y, restY + 3);
  const closed = applyShell(root, shellPlan(def, false));
  assert.deepEqual(closed.shown.sort(), ['cut_wall_front', 'cut_wall_side']);
  assert.equal(findNamed(root, 'cut_wall_front').visible, true);
  assert.equal(roof.position.y, restY, 'closing restores the built state exactly');
});

test('the same template opens and closes Meridian Hall (second building, no special case)', async () => {
  const def = interiorDef(REGISTRY, 'EMBER_DISTRICT_3_PLOT_18');
  const root = await loadBuilding('EMBER_DISTRICT_3_PLOT_18');
  applyShell(root, shellPlan(def, true));
  assert.equal(findNamed(root, 'cut_wall_front').visible, false);
  assert.equal(findNamed(root, 'station_dinner_host').visible, true, 'stations are not cut nodes — they stay');
  applyShell(root, shellPlan(def, false));
  assert.equal(findNamed(root, 'cut_wall_front').visible, true);
});

test('occupancy is exactly WorldData\'s: nobody extra, nobody missing (live bundle)', () => {
  for (const code of INTERIOR_CODES) {
    const expected = BUNDLE.citizens.filter((c) => c.placeCode === code).map((c) => c.citizenKey);
    const model = interiorRenderModel(REGISTRY, BUNDLE, code);
    assert.deepEqual(model.occupants, expected, `${code}: occupant set equals the bundle's`);
    assert.equal(model.placed.length, expected.length, `${code}: every occupant placed, none twice`);
    assert.equal(new Set(model.placed.map((p) => p.citizen.citizenKey)).size, expected.length);
    assert.equal(model.standingLine, STANDING_LINE, `${code}: the standing line rides every interior`);
  }
});

test('an empty room renders the empty-room line (live bundle: Market Hall)', () => {
  const model = interiorRenderModel(REGISTRY, BUNDLE, 'MARKET_HALL');
  assert.equal(model.empty, true);
  assert.equal(model.emptyLine, EMPTY_ROOM_LINE);
  assert.equal(EMPTY_ROOM_LINE, 'Nobody is here right now.');
  const college = interiorRenderModel(REGISTRY, BUNDLE, 'EMBER_COLLEGE');
  if (college.occupants.length > 0) assert.equal(college.emptyLine, null);
});

test('station discipline: roles take functional stations; the general pass never does', () => {
  const def = interiorDef(REGISTRY, 'EMBER_COLLEGE');
  const mk = (name) => ({ citizenKey: `portal-key:${name}`, name, placeCode: 'EMBER_COLLEGE' });
  const crowd = [mk('a'), mk('b'), mk('c')];
  const plain = assignStations(def, crowd);
  assert.ok(plain.every((p) => p.at.id !== 'station_lectern'),
    'no role evidenced ⇒ nobody stands at the lectern');
  const roled = assignStations(def, crowd, new Map([['portal-key:b', 'lectern']]));
  assert.equal(roled.find((p) => p.citizen.citizenKey === 'portal-key:b').at.id, 'station_lectern');
  assert.throws(() => assignStations(def, crowd, new Map([['portal-key:b', 'throne']])),
    /no station/, 'a role naming an unreal station is refused, not approximated');
  for (const p of [...plain, ...roled]) {
    assert.ok(Math.abs(p.position[0]) <= def.footprint.widthUnits / 2, 'inside the room (x)');
    assert.ok(Math.abs(p.position[2]) <= def.footprint.depthUnits / 2, 'inside the room (z)');
  }
});

test('dinner seats fill in registry order; overflow goes to floor slots inside the room', () => {
  const def = interiorDef(REGISTRY, 'EMBER_DISTRICT_3_PLOT_18');
  const crowd = Array.from({ length: 8 }, (_, i) => ({ citizenKey: `k${i}`, name: `C${i}`, placeCode: def.code }));
  const placed = assignStations(def, crowd, new Map([['k0', 'dinner_host']]));
  assert.equal(placed[0].at.id, 'station_dinner_host');
  assert.equal(placed.filter((p) => p.at.type === 'station').length, 7, 'host + six seats');
  assert.equal(placed.filter((p) => p.at.type === 'floor').length, 1, 'the eighth stands on the floor');
  const spots = placed.map((p) => p.position.map((v) => Math.round(v * 10)).join(','));
  assert.equal(new Set(spots).size, spots.length, 'no two figures share a spot');
});

test('threshold walk: door anchor is a vertex; the walk is continuous; a teleport is caught', () => {
  const def = interiorDef(REGISTRY, 'EMBER_COLLEGE');
  const { points, doorIndex } = thresholdPath(def, [0, 0, 0]);
  assert.deepEqual(points[doorIndex], def.anchors.door, 'the path passes through the door anchor itself');
  const dense = densifyPath(points);
  assert.equal(pathContinuity(dense), -1, 'densified threshold walk never jumps');
  assert.ok(dense.some((p) => p[0] === def.anchors.door[0] && p[2] === def.anchors.door[2]),
    'densifying keeps the door anchor as a vertex');
  const jumped = [[0, 0, 8], [0, 0, 0]]; // outside the door -> room centre in one step
  assert.equal(pathContinuity(jumped), 1, 'positive control: the checker flags the teleport step');
});
