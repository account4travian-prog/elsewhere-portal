// Elsewhere Portal — scene figure kits (M4.10).
//
// The manifest consumer: figure-kits.json (beside this module) maps
// PORTAL-KEYs to the factory citizen kits that replace the placeholder
// capsules for the launch cast. Kits are produced by the factory web
// profile (build/visual/factory, scripts/build_citizen.py +
// build_web.sh); this module is the only scene code that knows their
// paths. The stand-in personas (atlas / builder-1 / verifier-1 /
// alpha-lead) are NOT in the manifest: the citizens they stood in for
// now have real kits, and no live citizen maps to a stand-in persona.
//
// KITLESS CITIZENS (2026-11-03, G-J1 touch-up audit close-out —
// supersedes the earlier "citizens with no manifest entry keep the
// capsule placeholder" behaviour): a placed citizen with NO manifest
// entry is never stood in with the capsule — a generic human figure
// would misrepresent them (the forcing case is Pound Meridian, whose
// card reads "a cat, not an agent playing one"). attachFigureKits
// reports them as `kitless` (kitlessCitizenKeys below) and the scene
// holds them out of the figure layer, naming them on the roster rail
// as present-not-shown until a kit exists. The rule applies only
// when a manifest actually loaded: no manifest at all leaves the
// scene exactly as before (a missing manifest cannot be told apart
// from a deployment failure), and a kit that exists but FAILS to
// load keeps its capsule (a missing file is not the same fact as
// no kit existing).
//
// Paths in the manifest are relative to this scene directory and point
// into the build tree. Deployment/staging copies figures under its own
// publish step (M4.16 scope); the dev scene reads the factory outputs
// directly so a rebuilt kit appears on the next scene load.

import { retargetClip, createClipPlayer } from './work-clips.mjs';
import { zzzSprite, ZZZ_POSITION, ASLEEP_CLIP } from './treatments.mjs';

export const KIT_MANIFEST_URL = './figure-kits.json';

// One manifest entry -> the LOD the scene attaches. The scene is an
// overview: LOD1 (flat colours, <=800 tris) is the standing figure;
// LOD0 stays in the manifest for the follow camera's later wave.
export function kitLodUrl(entry, lod = 'lod1') {
  return entry ? entry[lod] : null;
}

// The kitless partition (2026-11-03, see the header note): of the
// given citizen keys, the ones with NO entry in the manifest.
// Pure and synchronous so the rule is unit-testable without a
// scene; attachFigureKits reports exactly this set for the groups
// it was given. A null/empty manifest yields every key (nothing
// is covered) — callers apply the holdout only when a manifest
// actually loaded, so that case never reaches the scene.
export function kitlessCitizenKeys(manifest, keys) {
  const entries = (manifest && manifest.kits) || {};
  return keys.filter((k) => !entries[k]);
}

// Attach kit figures to citizen placeholder groups.
//   groups:   Map<PORTAL-KEY, THREE.Group> — the groups buildWorld made
//   manifest: parsed figure-kits.json
//   load:     (url) => Promise<gltf> — scene.mjs's loadFigure (the
//             decoder-equipped figure-loader path, M4.16)
//   THREE:    the scene's vendored three (AnimationMixer lives there)
//   sleepKeys: PORTAL-KEYs whose figureStyle treatment is asleep
//             (M4.25: rest pose + Zzz badge on the kit figure)
//   workLibrary: { clips, donorRest } from work-clips.mjs's
//             loadWorkLibrary (M4.08), or null — without it, kits play
//             their own idle exactly as before.
// Returns { attached: [key...], failed: [{key, error}...], kitless:
// [key...], mixers, players } — players maps PORTAL-KEY -> clip
// player (work-clips.mjs) and is empty when no library was supplied.
// `kitless` lists the group keys with no manifest entry (see
// kitlessCitizenKeys): they are not attached and NOT left as
// placeholder figures by this module's contract — the scene holds
// them out (2026-11-03 header note).
// A failed load leaves the placeholder untouched — the scene must never
// lose a citizen to a missing kit file.
export async function attachFigureKits({ groups, manifest, load, THREE, heldKeys = new Set(), sleepKeys = new Set(), workLibrary = null, gestureLibrary = null }) {
  const attached = [];
  const failed = [];
  const mixers = [];
  const players = new Map();
  const entries = (manifest && manifest.kits) || {};
  const kitless = kitlessCitizenKeys(manifest, [...groups.keys()]);
  for (const [key, group] of groups) {
    const entry = entries[key];
    if (!entry) continue;
    try {
      const gltf = await load(kitLodUrl(entry));
      const fig = gltf.scene;
      fig.name = `kit:${entry.kit}`;
      // Placeholder out, kit in: hide (not remove) the capsule meshes so
      // picking data and the held/ghost treatment stay attached to the
      // group exactly as buildWorld set them up.
      for (const child of group.children) {
        if (child.isMesh && child.geometry && child.geometry.type !== 'CircleGeometry') {
          child.visible = false;
        }
      }
      if (heldKeys.has(key)) {
        fig.traverse((o) => {
          if (o.isMesh || o.isSkinnedMesh) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => { m.transparent = true; m.opacity = 0.5; }); // figureStyle's held opacity
          }
        });
      }
      group.add(fig);
      // M4.25: the asleep treatment's badge rides the group (the kit
      // figure itself takes the rest pose below, when the library is
      // present; without it the badge + the logic's dimming still
      // carry the treatment).
      if (sleepKeys.has(key)) {
        const z = zzzSprite(THREE);
        z.position.set(ZZZ_POSITION.x, ZZZ_POSITION.y, ZZZ_POSITION.z);
        z.userData.sleepBadge = true; // G-J1 round 3: talk playback's sleep suspension finds the badge by this tag
        group.add(z);
      }
      if ((workLibrary || gestureLibrary) && THREE && THREE.AnimationMixer) {
        // One player per figure over the union of the kit's own clips
        // and the libraries', re-based onto this kit (work-clips.mjs).
        const clipMap = new Map((gltf.animations || []).map((c) => [c.name, c]));
        for (const lib of [workLibrary, gestureLibrary]) {
          if (!lib) continue;
          for (const [name, clip] of lib.clips) {
            clipMap.set(name, retargetClip(THREE, clip, lib.donorRest, fig));
          }
        }
        const player = createClipPlayer(THREE, fig, clipMap);
        const initial = sleepKeys.has(key) && clipMap.has(ASLEEP_CLIP) ? ASLEEP_CLIP : 'idle';
        player.play(initial, { fade: 0 });
        mixers.push(player.mixer);
        players.set(key, player);
      } else {
        const idle = (gltf.animations || []).find((a) => a.name === 'idle');
        if (idle && THREE && THREE.AnimationMixer) {
          const mixer = new THREE.AnimationMixer(fig);
          mixer.clipAction(idle).play();
          mixers.push(mixer);
        }
      }
      attached.push(key);
    } catch (err) {
      failed.push({ key, error: String(err && err.message || err) });
    }
  }
  return { attached, failed, kitless, mixers, players };
}
