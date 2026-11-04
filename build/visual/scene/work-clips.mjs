// Elsewhere Portal — scene work clips (M4.08; rest pose M4.25).
//
// The clip library (factory outputs-web/clips/work-clips.glb, built by
// factory/scripts/retarget_work_clips.py from KayKit Character
// Animations 1.1, CC0) carries the work vocabulary the kits' own clip
// sets lack, retargeted onto the shared citizen rig. One library
// serves every kit because all kits share the contract bone names —
// with one correction applied HERE, per kit, at bind time:
//
//   glTF animation tracks are ABSOLUTE local transforms. The
//   library's position tracks are written against the donor kit's
//   rest pose, and the six KayKit bases' bone offsets differ — played
//   raw, a clip would drag a Knight's limb segments by up to 2.6 cm
//   (measured, factory frame-check). retargetClip() re-bases every
//   position track onto the TARGET kit's own rest offsets (motion
//   deltas preserved exactly) and drops scale tracks (every kit's
//   bones are unit-scale; the source actions carry identity scale
//   channels). Rotation tracks — the performance — pass through
//   untouched. The factory frame-check exercises this same function.
//
// HONESTY: a work clip is a presentation vocabulary, not a claim.
// The scene plays one only when a viewer asks (the Work clips
// preview control, labelled as a preview) or when a treatment calls
// for it (the asleep treatment's rest pose, M4.25). Nothing here
// stages an act the record does not carry: the preview says what it
// is, and the coverage table below records which action-table
// families have clips and which honestly do not (carry).

export const WORK_CLIPS_URL = '../factory/outputs-web/clips/work-clips.glb';

/** Action-table family -> library clip (build/data/action-table.mjs
 *  VERB_FAMILIES). Families absent here have no clip: see
 *  clipCoverage(). */
export const FAMILY_CLIPS = {
  'excavate': 'work-dig',           // sound / excavate / sift / glean
  'build-raise-install': 'work-hammer',
  'repair-frontier': 'work-hammer', // maintain / repair / rest
  'make-craft': 'type',             // kits already carry type (Working_A)
  'harvest': 'gather',              // kits already carry gather
  'pick-up': 'work-pickup',
};

/** The whole work-clip coverage record, gaps stated as gaps. */
export function clipCoverage() {
  return {
    covered: {
      'excavate': ['work-dig', 'work-pickaxe'],
      'build-raise-install': ['work-hammer', 'work-saw', 'work-chop'],
      'repair-frontier': ['work-hammer'],
      'make-craft': ['type (kit-carried)', 'work-saw'],
      'harvest': ['gather (kit-carried)', 'work-pickup'],
      'pick-up': ['work-pickup'],
      'deliver-mend': [],
      'haul': [],
    },
    gaps: {
      'deliver-mend': 'No carry locomotion clip exists in the CC0 spine (KayKit Holding_* are static holds, not a walk-with-load). Not faked; the family stays on its caption + counter beat until a real clip source lands.',
      'haul': 'Same carry gap as deliver-mend.',
    },
    extra: {
      'work-fish': 'Fishing_Idle/Cast/Reeling ship in the library (KayKit Tools vocabulary). No action-table family names fishing; the clips are vocabulary on the shelf, staged for nobody until the record names the act.',
    },
  };
}

/** Map of sanitised node name -> rest position (THREE.Vector3-like
 *  {x,y,z}) for a loaded glTF scene (donor or kit). GLTFLoader
 *  sanitises names identically in every file, so the maps align. */
export function restPositions(gltfScene) {
  const map = new Map();
  gltfScene.traverse((o) => { if (o.name) map.set(o.name, o.position); });
  return map;
}

/**
 * Re-base one library clip onto a target kit root. Returns a NEW
 * AnimationClip (the library clip is never mutated, so one library
 * serves every kit). donorRest: restPositions(libraryScene);
 * targetRoot: the kit's loaded scene root.
 */
export function retargetClip(THREE, clip, donorRest, targetRoot) {
  const targetRest = new Map();
  targetRoot.traverse((o) => { if (o.name) targetRest.set(o.name, o.position); });
  const tracks = [];
  for (const track of clip.tracks) {
    if (track.name.endsWith('.scale')) continue; // unit-scale rigs; identity channels dropped
    if (track.name.endsWith('.position')) {
      const bone = track.name.slice(0, -'.position'.length);
      const d = donorRest.get(bone), t = targetRest.get(bone);
      if (d && t) {
        const values = new Float32Array(track.values);
        for (let i = 0; i < values.length; i += 3) {
          values[i] += t.x - d.x; values[i + 1] += t.y - d.y; values[i + 2] += t.z - d.z;
        }
        tracks.push(new THREE.VectorKeyframeTrack(track.name, track.times, values));
        continue;
      }
    }
    tracks.push(track);
  }
  const out = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  return out;
}

/** Load the library through the scene's figure loader. Returns
 *  { clips: Map<name, AnimationClip>, donorRest } or null when the
 *  library is absent (the scene then simply has no work vocabulary —
 *  kits keep their own clips). */
export async function loadWorkLibrary(load) {
  try {
    const gltf = await load(WORK_CLIPS_URL);
    const clips = new Map((gltf.animations || []).map((c) => [c.name, c]));
    if (!clips.size) return null;
    return { clips, donorRest: restPositions(gltf.scene) };
  } catch {
    return null;
  }
}

/**
 * A per-figure clip player over one mixer: crossfades between the
 * figure's current action and a requested clip. `play(name)` looks
 * the clip up in the figure's clip map (kit-carried + retargeted
 * library clips); unknown names are refused, never invented.
 */
export function createClipPlayer(THREE, root, clipMap) {
  const mixer = new THREE.AnimationMixer(root);
  let current = null;
  return {
    mixer,
    currentName: () => (current ? current.getClip().name : null),
    play(name, { fade = 0.25 } = {}) {
      const clip = clipMap.get(name);
      if (!clip) return false;
      const action = mixer.clipAction(clip);
      action.reset().setLoop(THREE.LoopRepeat).fadeIn(fade).play();
      if (current && current !== action) current.fadeOut(fade);
      current = action;
      return true;
    },
  };
}
