// Elsewhere Portal — scene figure treatments (M4.25 asleep/away).
//
// The DECISION is the app logic's (figureStyle, OM15-C2): driven by
// the citizen's presence class (citizen.state), never by placeCode —
// a citizen asleep at a place and a citizen awake at the same place
// get different treatments, and a citizen with no evidenced place is
// never placed at all (the roster rail keeps them; citizenPositions
// already enforces it). This module is only the 3D rendering of the
// decision, in one place so the frame, the plan, and the tests agree:
//
//   asleep (M4.25): rest pose (the kit plays the library's rest-lie
//     clip; the capsule placeholder reclines), a Zzz badge overhead,
//     and the dimmed chip (opacity = ASLEEP_OPACITY, the same 0.55
//     the 2D roster chip dims to — one value, every surface).
//   held: figureStyle's ring + ≠ marker (scene.mjs, OM-15) — shape
//     channels, unchanged here.
//   normal: nothing extra.
//
// Nothing here invents a state: every branch keys off figureStyle's
// treatment string and nothing else.

import { ASLEEP_OPACITY } from '../../app/logic.mjs';
import { PALETTE } from './palette.mjs';

/** The asleep badge's glyph. A badge, not a claim: the record's word
 *  stays "asleep / away" (the caption and card carry it verbatim). */
export const ASLEEP_BADGE_GLYPH = 'Zzz';
/** The clip the asleep treatment plays on kit figures (the library's
 *  retargeted KayKit Lie_Idle — a real rest pose, not a tilt). */
export const ASLEEP_CLIP = 'rest-lie';
/** Capsule recline (radians about the feet, toward the camera side):
 *  the placeholder's rest pose until a kit replaces it. */
export const CAPSULE_RECLINE_RAD = 1.15;

/**
 * The treatment plan for one figureStyle result — pure, so the
 * cross-surface agreement test reads the same plan the scene applies.
 *   { opacity, zzz, restPose, reclineCapsule, dimmedChip }
 */
export function treatmentPlan(style) {
  if (!style || style.treatment === 'normal') {
    return { opacity: 1, zzz: false, restPose: false, reclineCapsule: false, dimmedChip: false };
  }
  if (style.treatment === 'asleep') {
    return {
      opacity: style.opacity ?? ASLEEP_OPACITY,
      zzz: true, restPose: true, reclineCapsule: true, dimmedChip: true,
    };
  }
  if (style.treatment === 'held') {
    // Held is drawn by scene.mjs's ring/marker path (OM-15); the plan
    // names it so a reader sees the whole treatment table in one file.
    return { opacity: style.opacity ?? 0.5, zzz: false, restPose: false, reclineCapsule: false, dimmedChip: false, held: true };
  }
  return { opacity: 1, zzz: false, restPose: false, reclineCapsule: false, dimmedChip: false };
}

let zzzTex = null;
/** The Zzz badge as a sprite (canvas texture, built once): umber ink
 *  (the 2D register's outline anchor, via the palette) on a pale halo,
 *  the held marker's construction. */
export function zzzSprite(THREE) {
  if (!zzzTex) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 96;
    const g = c.getContext('2d');
    g.font = '800 54px Nunito, system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 12; g.strokeStyle = 'rgba(255,253,248,0.95)';
    g.strokeText(ASLEEP_BADGE_GLYPH, 64, 50);
    g.fillStyle = PALETTE.anchors.outline_umber_2d;
    g.fillText(ASLEEP_BADGE_GLYPH, 64, 50);
    zzzTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: zzzTex, transparent: true, depthWrite: false }));
  s.scale.set(0.85, 0.64, 1);
  return s;
}

/** Where the badge floats over an upright-standing group whose figure
 *  reclines/lies toward the camera side (+z): above the head end. */
export const ZZZ_POSITION = { x: 0.35, y: 1.0, z: 1.0 };

/**
 * Recline a capsule placeholder's body+head meshes about the feet
 * (they are direct children of the citizen group; the blob shadow and
 * any ring stay flat on the ground where they belong). Returns true
 * when both meshes were found and reclined.
 */
export function reclineCapsuleMeshes(meshes, angle = CAPSULE_RECLINE_RAD) {
  let done = 0;
  for (const m of meshes) {
    const y = m.position.y, z = m.position.z;
    m.position.y = y * Math.cos(angle) - z * Math.sin(angle);
    m.position.z = y * Math.sin(angle) + z * Math.cos(angle);
    m.rotation.x += angle;
    done++;
  }
  return done === meshes.length && done > 0;
}
