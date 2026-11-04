// Elsewhere Portal — scene gesture clips (M5.05; Design K4/K5).
//
// The social gesture library (factory outputs-web/clips/gesture-
// clips.glb, built by factory/scripts/retarget_gesture_clips.py)
// carries the talk/listening vocabulary the kits' own clip sets
// lack, on the shared citizen rig. The bind path is work-clips.mjs's
// own retargetClip (position tracks re-based per kit at bind time),
// reused — not forked — so a gesture clip behaves exactly like a
// work clip on every kit.
//
// Sourcing ladder, as rung: talk x2 are Quaternius Universal
// Animation Library 1 clips (CC0) baked onto the rig; listen/nod,
// point and present are CUSTOM bespoke (procedural, Portal-authored)
// because the CC0 spine was inventoried clip by clip and carries
// none of the three. No Mixamo clip is used, so the conditioned
// rung is never reached. Sources + licences live in the library's
// armature extras and in gestureCoverage() below; the factory
// coverage record is work-citizens/gesture-clips-coverage.json.
//
// HONESTY: a gesture is presentation vocabulary, not a claim. The
// scene plays one only for a state the record supports (a recorded
// utterance for talk, an evidenced listener for listen) — the
// readability model in build/app/logic.mjs (M5.06) is what assigns
// gestures to states; this module only binds clips to kits. The
// kits' own `gather` clip is a KayKit Idle_B talk-POSE stand-in
// (recorded as such in every kit) and is never counted as a talk
// clip here.

import { retargetClip, restPositions } from './work-clips.mjs';

export { retargetClip, restPositions };

export const GESTURE_CLIPS_URL = '../factory/outputs-web/clips/gesture-clips.glb';

/** Readability gesture -> library clip (build/app/logic.mjs
 *  GESTURE_CLIPS carries the same keys with sources). */
export const GESTURE_CLIP_FOR = {
  'talk-standing': 'gesture-talk',
  'talk-seated': 'gesture-talk-seated',
  'listen-nod': 'gesture-listen',
  'point': 'gesture-point',
  'present': 'gesture-present',
};

/** The whole gesture coverage record, rungs stated as rungs. */
export function gestureCoverage() {
  return {
    covered: {
      'talk': [
        { clip: 'gesture-talk', variant: 'standing', source: 'Quaternius Universal Animation Library 1 — Idle_Talking_Loop', licence: 'CC0 1.0', rung: 'UAL (CC0)' },
        { clip: 'gesture-talk-seated', variant: 'seated', source: 'Quaternius Universal Animation Library 1 — Sitting_Talking_Loop', licence: 'CC0 1.0', rung: 'UAL (CC0)' },
      ],
      'listen': [
        { clip: 'gesture-listen', variant: 'nod', source: 'CUSTOM bespoke — procedural nod authored on the citizen rig', licence: 'Portal-authored (no third-party rights)', rung: 'CUSTOM' },
      ],
      'point': [
        { clip: 'gesture-point', variant: 'point', source: 'CUSTOM bespoke — procedural point authored on the citizen rig', licence: 'Portal-authored (no third-party rights)', rung: 'CUSTOM' },
      ],
      'present': [
        { clip: 'gesture-present', variant: 'present', source: 'CUSTOM bespoke — procedural present authored on the citizen rig', licence: 'Portal-authored (no third-party rights)', rung: 'CUSTOM' },
      ],
    },
    ladderNotes: {
      'mixamo': 'Conditioned rung (baked output only; raw files never published) — not used by any clip in this library.',
      'cc0-inventory': 'UAL1 (43 clips) and KayKit Character Animations 1.1 Rig_Medium (119 clips) were inventoried clip by clip: no nod, point, or present gesture exists in either, which is the only reason those three sit on the CUSTOM rung.',
    },
  };
}

/** Load the gesture library through the scene's figure loader.
 *  Returns { clips: Map<name, AnimationClip>, donorRest } or null
 *  when the library is absent (the scene then simply has no gesture
 *  vocabulary — kits keep their own clips). */
export async function loadGestureLibrary(load) {
  try {
    const gltf = await load(GESTURE_CLIPS_URL);
    const clips = new Map((gltf.animations || []).map((c) => [c.name, c]));
    if (!clips.size) return null;
    return { clips, donorRest: restPositions(gltf.scene) };
  } catch {
    return null;
  }
}
