// Elsewhere Portal — the 3D scene's talk state (M5.01/M5.03
// consumption; SURFACE CONSUMPTION lane).
//
// The scene's half of the one-model rule: this module schedules the
// recorded episodes through the shared talk scheduler
// (logic.scheduleTalkScenes — priority is the record's own order, a
// figure is never in two scenes at once) and resolves the act on
// stage at any playback instant through the shared consumption
// model (logic.talkActPresentation). The scene itself (scene.mjs)
// only APPLIES the result: it plays the named clips on the figures'
// existing clip players, rotates figures toward the facing points,
// and positions the bubble overlay. Nothing here moves a figure —
// talk gestures are in place, and positions are read for facing
// only, never written.
//
// Pure and headless-testable: no THREE, no DOM, no fetch. scene.mjs
// hands in the episodes feed it fetched and the positions it has.
//
// G-J1 round 5 adds one thing to that division: for a RECORDING,
// sceneTalkAct can also resolve staged positions — the act's
// speaker and evidenced listeners placed at the episode's
// recorded place (recordedActPositions above) — which scene.mjs
// applies to the figures for the act's duration and restores
// when the act ends. The shared model still writes no position:
// staging positions are an input the scene supplies to it (they
// drive its facing) and an output the scene consumes; live
// surfaces never receive them.

import { scheduleTalkScenes, talkActPresentation, conversationStaging, episodeKeyOf } from '../../app/logic.mjs';

/**
 * Build the scene's talk timeline from an episodes feed's episode
 * list: the shared scheduler's scenes (record order), the episodes
 * it skipped for having no recorded words, and a key -> episode map
 * (a schedule scene carries no words of its own; the words resolve
 * back to the episode here, exactly as the panel resolves them).
 */
export function buildTalkTimeline(episodes) {
  const list = Array.isArray(episodes) ? episodes : [];
  // The timeline's programme is the recorded episodes by
  // construction — a recording, so the scheduler's recording mode
  // (M5.07 ruling, 2026-11-03): scenes play in full, the 90 s cap
  // and its pointer govern live scenes only.
  const { scenes, skipped } = scheduleTalkScenes(list, { mode: 'recording' });
  const byKey = new Map(list.map((ep) => [episodeKeyOf(ep), ep]));
  return {
    scenes,
    skipped,
    byKey,
    endMs: scenes.reduce((m, s) => Math.max(m, s.endMs), 0),
  };
}

/** The scheduled event on stage at elapsedMs, or null (between
 *  scenes, before the first, after the last — the honest gaps in a
 *  recorded programme, where the scene stages no talk). */
export function talkEventAt(timeline, elapsedMs) {
  if (!timeline || !Number.isFinite(elapsedMs)) return null;
  for (const scene of timeline.scenes) {
    if (elapsedMs < scene.startMs || elapsedMs >= scene.endMs) continue;
    const event = scene.events.find((e) => elapsedMs >= e.startMs && elapsedMs < e.endMs);
    if (event) return { scene, event, episode: timeline.byKey.get(scene.key) || null };
  }
  return null;
}

/**
 * The scene's talk act at elapsedMs: talkEventAt resolved through
 * the ONE consumption model, with the scene's own inputs (positions
 * it actually has, the treatments its figures carry, its viewing
 * altitude — 'town' in overview, 'scene' in follow). Returns null
 * when no utterance is on stage at that instant. The return is
 * talkActPresentation's object plus the scene's disclosure, so the
 * renderer can head its overlay with the episode's own words about
 * itself.
 *
 * `mode` is the model's mode (logic.talkActPresentation, THE MODE)
 * and is REQUIRED here too — forwarded, never defaulted: the
 * scene's own playback passes 'recording', because its programme
 * is the recorded episodes (VER-D22); a caller staging live talk
 * through this path would pass 'live' and get the letter.
 */
// --------------------------------------- recorded-act staging
// G-J1 round 5 (my Hark's round-4 audit — audits/
// HARK-GJ1-AUDIT-R4-2026-11-03.md, blocker 2, still open after
// round 4): round 4's panel refusal cleared the panel off the
// speaker, but the playback still staged the act's words on
// figures standing at their LIVE places — one recorded act
// visually happened in three places at once ("Three places for
// one recorded act isn't playing it as recorded"). His smallest
// change, first form adopted: during RECORDED playback, stage
// the speaker and evidenced listeners AT the act's recorded
// place for the act's duration; the panel anchors there; panel
// text and staging name the same building.
//
// The staging rule is NOT forked here: who speaks, who listens,
// and which way they face still come from the one M5.03 model
// (conversationStaging, inside talkActPresentation) — this
// module only supplies the positions that model consumes when
// the scene plays a recording, computed from the record's one
// positional fact: the episode's place. The formation is a
// fixed, deterministic fan: the speaker stands at the place
// point; the listeners stand south of the speaker (+y in grid
// coords = +z in world = toward the canonical southern
// camera), spaced laterally, the fan's ends a step farther
// out — a shallow arc facing the speaker, so the model's own
// facing (speaker → listeners' centroid, listeners → speaker)
// reads as a conversation from the camera's side. Positions
// are grid coords, the coordinate space of every Portal
// surface's positions map. LIVE mode never stages: a live
// surface's figures stand where the live record puts them,
// and this function is only consulted for recordings.

const ACT_FAN_RADIUS = 0.17; // grid units (1.7 world) — conversation distance
const ACT_FAN_STEP = 0.19; // lateral spacing between listeners
const ACT_FAN_ARC = 0.05; // the fan's ends stand this much farther south per step out

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * recordedActPositions({ point, speakerName, listenerNames })
 *   -> { [name]: {x, y} } in grid coords, or null without a
 * point or a speaker. The speaker stands at the place point;
 * the listeners fan south of the speaker in the order given
 * (the caller passes the step's listener order — the model's
 * own). A lone speaker stands at the point alone.
 */
export function recordedActPositions({ point, speakerName, listenerNames = [] } = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !speakerName) return null;
  const out = { [speakerName]: { x: round3(point.x), y: round3(point.y) } };
  const mid = (listenerNames.length - 1) / 2;
  listenerNames.forEach((name, i) => {
    const off = i - mid;
    out[name] = {
      x: round3(point.x + off * ACT_FAN_STEP),
      y: round3(point.y + ACT_FAN_RADIUS + Math.abs(off) * ACT_FAN_ARC),
    };
  });
  return out;
}

// ------------------------------------------------- panel placement
// G-J1 round 4 (my Hark's round-3 audit — audits/
// HARK-GJ1-AUDIT-R3-2026-11-03.md, blocker 2): the speech panel
// gets the same figure-refusal as plates and chips (labels.mjs).
// Round 3's talk still evidenced nobody talking: the panel sat
// centred on the speaker's head anchor and covered the act. The
// placement below tries offset positions in a fixed order and
// accepts the first that never covers the SPEAKER's projected
// rect; covering a listener is a fallback only when no offset
// avoids it. Pure (screen-space in, screen-space out) so the
// scene's DOM wiring and this suite test the same rule.

const PANEL_GAP_PX = 12; // the offset rungs stand this far off the anchor
const PANEL_MARGIN_PX = 4; // the frame margin, as in labels.mjs

const panelOverlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const panelOverlapArea = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/**
 * talkPanelPlacement({ anchor, panel, speakerRect, listenerRects,
 * labelRects, viewport })
 *   -> { x, y, rung, coversListener, coversLabel, fallback } | null
 * anchor: the speaker's projected head point — the panel's
 *   traditional bottom-centre sits on it (the 'above' rung).
 * panel: { w, h } the overlay's measured size.
 * speakerRect: the speaker's projected figure rect, or null.
 * listenerRects: the other participants' projected rects.
 * labelRects: the frame's placed label boxes — place labels and
 *   citizen plates alike (G-J1 round 5: round 4's panel covered
 *   The College's label and Lenore Nevermore's plate; my Hark:
 *   "add the panel to the figure and label refusal"). A label is
 *   a name the frame is showing; the panel no more covers one
 *   than it covers a figure.
 * viewport: { width, heightPx }.
 * Candidates, in order: above (the traditional spot), above-left,
 * above-right, left, right, below (under the speaker's rect),
 * below-far (under the whole formation — below the lowest
 * participant rect; G-J1 round 5 Item 2: a staged act's listeners
 * fan south of the speaker, filling the below spot, so the panel
 * that must clear every participant needs the rung under all of
 * them). Each is clamped into the frame BEFORE it is judged — a
 * clamped candidate that covers the speaker is refused like any
 * other.
 * Pass 1 takes the first candidate covering neither speaker nor
 * any listener nor any label; pass 2 the first covering no
 * speaker and no label (listeners may be covered, reported);
 * the fallback — reachable only when the panel cannot fit the
 * frame clear of the speaker at all — is the candidate with the
 * least speaker overlap, flagged as such, its label cover
 * reported too.
 */
export function talkPanelPlacement({ anchor, panel, speakerRect = null, listenerRects = [], labelRects = [], viewport } = {}) {
  if (!anchor || !panel || !viewport) return null;
  const { w, h } = panel;
  const clampAxis = (v, max) => Math.max(PANEL_MARGIN_PX, Math.min(v, Math.max(PANEL_MARGIN_PX, max)));
  const clamp = (x, y) => ({
    x: clampAxis(x, viewport.width - PANEL_MARGIN_PX - w),
    y: clampAxis(y, viewport.heightPx - PANEL_MARGIN_PX - h),
  });
  const belowY = speakerRect ? speakerRect.y + speakerRect.h + 8 : anchor.y + 48;
  const participantBottoms = [speakerRect, ...listenerRects].filter(Boolean).map((r) => r.y + r.h);
  const belowFarY = participantBottoms.length ? Math.max(...participantBottoms) + 8 : belowY;
  const raw = [
    { rung: 'above', x: anchor.x - w / 2, y: anchor.y - h },
    { rung: 'above-left', x: anchor.x - w - PANEL_GAP_PX, y: anchor.y - h },
    { rung: 'above-right', x: anchor.x + PANEL_GAP_PX, y: anchor.y - h },
    { rung: 'left', x: anchor.x - w - PANEL_GAP_PX, y: anchor.y - h / 2 },
    { rung: 'right', x: anchor.x + PANEL_GAP_PX, y: anchor.y - h / 2 },
    { rung: 'below', x: anchor.x - w / 2, y: belowY },
    { rung: 'below-far', x: anchor.x - w / 2, y: belowFarY },
  ];
  const cands = raw.map((c) => {
    const p = clamp(c.x, c.y);
    return { rung: c.rung, x: p.x, y: p.y, box: { x: p.x, y: p.y, w, h } };
  });
  const coversSpeaker = (box) => !!speakerRect && panelOverlaps(box, speakerRect);
  const coversListener = (box) => listenerRects.some((r) => r && panelOverlaps(box, r));
  const coversLabel = (box) => labelRects.some((r) => r && panelOverlaps(box, r));
  for (const c of cands) {
    if (!coversSpeaker(c.box) && !coversListener(c.box) && !coversLabel(c.box)) {
      return { ...c, coversListener: false, coversLabel: false, fallback: false };
    }
  }
  for (const c of cands) {
    if (!coversSpeaker(c.box) && !coversLabel(c.box)) {
      return { ...c, coversListener: coversListener(c.box), coversLabel: false, fallback: false };
    }
  }
  let best = cands[0];
  let bestArea = Infinity;
  for (const c of cands) {
    const area = speakerRect ? panelOverlapArea(c.box, speakerRect) : 0;
    if (area < bestArea) { bestArea = area; best = c; }
  }
  return { ...best, coversListener: coversListener(best.box), coversLabel: coversLabel(best.box), fallback: true };
}

export function sceneTalkAct({ timeline, elapsedMs, positionsByName = {}, placeLabel = null, altitude = 'scene', rate = 1, treatments = {}, posture = null, mode, placePointFor = null } = {}) {
  if (mode !== 'live' && mode !== 'recording') {
    throw new TypeError(`sceneTalkAct: mode must be named explicitly — 'live' or 'recording' (got ${String(mode)})`);
  }
  const hit = talkEventAt(timeline, elapsedMs);
  if (!hit || !hit.episode) return null;
  // Recorded-act staging (G-J1 round 5 — see recordedActPositions):
  // in recording mode, when the caller can resolve the act's
  // place to a point, the act's participants are positioned by
  // the formation at that place, and those positions — not the
  // live ones — feed the model, so its facing is the staged
  // conversation's facing. The step's participant names come
  // from the staging model itself (a positions-free call: the
  // names do not depend on positions), never re-derived here.
  // Live mode, a missing resolver, an unresolvable place, or a
  // step the model would reject all leave the live positions
  // exactly as passed.
  let positions = positionsByName;
  let formation = null;
  let formationPoint = null;
  if (mode === 'recording' && typeof placePointFor === 'function') {
    const staging0 = conversationStaging(hit.episode, {});
    const step0 = staging0?.steps?.[hit.event.index];
    const point = staging0 && step0 && step0.speaker === hit.event.speaker
      ? placePointFor(staging0.placeCode) : null;
    if (step0 && point) {
      formation = recordedActPositions({ point, speakerName: step0.speaker, listenerNames: step0.listeners });
      if (formation) {
        formationPoint = point;
        positions = { ...positionsByName, ...formation };
      }
    }
  }
  const pres = talkActPresentation({
    episode: hit.episode, event: hit.event, positions,
    placeLabel, altitude, rate, treatments, posture, mode,
  });
  if (!pres) return null;
  // The staged set is exactly who the model stages: the speaker
  // (when not suppressed) and the unblocked listeners. A blocked
  // listener's formation spot fed the facing centroid — it is
  // the conversation's spot at the place — but the figure itself
  // is never staged, exactly as it is never performed.
  // stagedPlace.code is the presentation's own placeCode and
  // the point the resolver returned FOR that code, so the act's
  // place, the staging's place, and the panel's named place
  // (pres.placeLabel, from the same code) agree by construction.
  let stagedPositions = null;
  let stagedPlace = null;
  if (formation && !pres.suppressed && pres.speaker) {
    stagedPositions = { [pres.speaker.name]: formation[pres.speaker.name] };
    for (const l of pres.listeners) {
      if (!l.blocked && formation[l.name]) stagedPositions[l.name] = formation[l.name];
    }
    stagedPlace = { code: pres.placeCode, point: { x: formationPoint.x, y: formationPoint.y } };
  }
  return {
    ...pres, stagedPositions, stagedPlace,
    disclosure: hit.scene.disclosure, sceneStartMs: hit.scene.startMs, sceneEndMs: hit.scene.endMs,
  };
}
