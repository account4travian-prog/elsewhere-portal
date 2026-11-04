// Elsewhere Portal — follow-through-interiors (M5.10).
//
// The follow camera's behaviour where a journey crosses a
// threshold, as a pure plan over a position track — the camera
// surface (scene.mjs today; M4.18's chips/bounds as that lane
// lands them) consumes decisions, it does not re-derive them.
//
// The behaviours (Design C3):
//   - LOOKAHEAD: on the street the camera target leads the figure
//     by a fraction of its motion, clamped — the frame arrives
//     where the figure is going, not where it was.
//   - DOOR BEAT: when the track crosses into an interior, the
//     camera HOLDS at the door for the beat. During the beat the
//     shell stays closed and the figure is rendered AT the door
//     anchor — a followed citizen is never shown inside before
//     the door beat completes. Only then does the shell open and
//     the camera move to the interior's camera anchor. Leaving is
//     the same shape in reverse: the shell closes once the figure
//     is out.
//   - PAN PAUSE: a viewer pan pauses the follow; the camera holds
//     its last target until "Re-centre" is chosen. The pause is a
//     state, not a forgotten flag — recentre() is the only way
//     back, and the control's label says so.
//   - MAP HAND-OFF: a track point whose place is not a town node
//     (the frontier, D5) hands the follow off to the map scene —
//     the town camera never chases a figure off its own stage.
//
// A track is [{ t, pos: [x, z], inside: code|null, known: bool }]
// in world coordinates; `inside` is the interior the RECORD (or
// the replay) places the figure in at that instant, and crossings
// are read from its changes — the plan invents no crossings.

export const DOOR_BEAT_MS = 1200;
export const LOOKAHEAD_MS = 600;
export const LOOKAHEAD_MAX_UNITS = 3;

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * The camera plan for a whole track. interiors: Map/object of
 * code -> { door: [x,z], camAnchor: [x,z] } in world coordinates.
 * Returns one decision per sample:
 *   { t, mode: 'street'|'door-beat'|'interior'|'handoff',
 *     target: [x,z]|null, shellOpenFor: code|null,
 *     figurePos: [x,z], figureInsideVisible: bool, note }
 * figurePos is where the figure may be RENDERED: during a door
 * beat it is the door anchor, not the track's inside position.
 */
export function followCameraPlan(track, interiors) {
  const geo = (code) => (interiors instanceof Map ? interiors.get(code) : interiors[code]) || null;
  const out = [];
  let beat = null; // { code, until, dir: 'in'|'out' }
  let prevInside = null;
  for (let i = 0; i < track.length; i++) {
    const s = track[i];
    if (s.known === false) {
      out.push({
        t: s.t, mode: 'handoff', target: null, shellOpenFor: null,
        figurePos: s.pos, figureInsideVisible: false,
        note: 'The followed citizen\'s place is off the town stage — follow hands off to the map.',
      });
      prevInside = s.inside || null;
      continue;
    }
    const inside = s.inside || null;
    if (inside !== prevInside) {
      // A crossing at this sample: the beat starts now.
      const code = inside || prevInside;
      const g = geo(code);
      beat = g ? { code, until: s.t + DOOR_BEAT_MS, dir: inside ? 'in' : 'out', door: g.door, camAnchor: g.camAnchor } : null;
    }
    if (beat && s.t < beat.until) {
      out.push({
        t: s.t, mode: 'door-beat', target: [...beat.door], shellOpenFor: null,
        figurePos: [...beat.door], figureInsideVisible: false,
        note: beat.dir === 'in'
          ? `Door beat at ${beat.code}: the camera waits at the door; the citizen is not shown inside yet.`
          : `Door beat at ${beat.code}: the citizen steps out; the shell closes behind them.`,
      });
    } else if (inside) {
      const g = geo(inside);
      out.push({
        t: s.t, mode: 'interior', target: g ? [...g.camAnchor] : [...s.pos], shellOpenFor: inside,
        figurePos: [...s.pos], figureInsideVisible: true,
        note: null,
      });
      if (beat && beat.dir === 'in') beat = null;
    } else {
      // Street: lookahead from the last two samples.
      let target = [...s.pos];
      if (i > 0 && track[i - 1].known !== false) {
        const dt = s.t - track[i - 1].t;
        if (dt > 0) {
          const vx = (s.pos[0] - track[i - 1].pos[0]) / dt;
          const vz = (s.pos[1] - track[i - 1].pos[1]) / dt;
          let lx = vx * LOOKAHEAD_MS; let lz = vz * LOOKAHEAD_MS;
          const lead = Math.hypot(lx, lz);
          if (lead > LOOKAHEAD_MAX_UNITS) { lx *= LOOKAHEAD_MAX_UNITS / lead; lz *= LOOKAHEAD_MAX_UNITS / lead; }
          target = [s.pos[0] + lx, s.pos[1] + lz];
        }
      }
      out.push({
        t: s.t, mode: 'street', target, shellOpenFor: null,
        figurePos: [...s.pos], figureInsideVisible: false, note: null,
      });
      if (beat && beat.dir === 'out') beat = null;
    }
    prevInside = inside;
  }
  return out;
}

/** The pan-pause control: following until pan() is called, then
 *  holding (camera target frozen at holdTarget) until recentre().
 *  The button the viewer is offered while paused is labelled
 *  exactly RECENTRE_LABEL. */
export const RECENTRE_LABEL = 'Re-centre';
export function createPanControl() {
  return {
    state: 'following',
    holdTarget: null,
    pan(target) { this.state = 'paused'; this.holdTarget = target ? [...target] : null; },
    recentre() { this.state = 'following'; this.holdTarget = null; },
    get label() { return this.state === 'paused' ? RECENTRE_LABEL : null; },
    /** The target the camera must use: the plan's, or the held
     *  one while paused. */
    targetFor(planTarget) { return this.state === 'paused' ? this.holdTarget : planTarget; },
  };
}

/** Break-check over a camera plan + its track: true exactly when
 *  no decision ever shows the figure inside an interior before
 *  that interior's door beat has completed, positions are
 *  continuous across every sample (the rendered figure never
 *  jumps further than a walk step between samples), and every
 *  interior sample follows a completed beat for that interior. */
export function followNeverBreaks(plan, { maxStep = 2.5 } = {}) {
  let lastPos = null;
  for (const d of plan) {
    if (lastPos && dist(lastPos, d.figurePos) > maxStep + 1e-9) return false;
    lastPos = d.figurePos;
  }
  // Sequence property, checked directly: an interior decision is
  // legal only when a door beat (or an unbroken run of interior
  // decisions) precedes it since the last street/handoff decision,
  // and a figure is visible-inside only in interior decisions.
  let state = 'street';
  for (const d of plan) {
    if (d.mode === 'door-beat') state = 'beat';
    else if (d.mode === 'interior') {
      if (state !== 'beat' && state !== 'interior') return false;
      state = 'interior';
    } else state = d.mode;
    if (d.figureInsideVisible && d.mode !== 'interior') return false;
  }
  return true;
}
