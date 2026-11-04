// labels.mjs — the label-placement system (M4.12, Design L2).
//
// Labels are scene objects, resolved at build time — never improvised
// per render frame. This module is pure (no DOM, no THREE): callers
// project world anchors to screen pixels with the projectors below
// (cross-checked against the scene's vendored THREE cameras in
// test/labels.test.mjs), hand the resolver screen-space items, and
// render exactly the boxes it returns.
//
// The ladder (Design L2), per building, in order:
//   1. sign     — the word on the building, at its sign anchor
//                 (footprint spec §5.2: centred on the door face,
//                 2.6 units up). Sign text is the building's short
//                 name (the record label minus its district/plot
//                 parenthetical — a substring, never a rewrite).
//   2. roof-tag — the full record label above the roof anchor.
//   3. edge-tag — the full label pulled inside the frame edge.
// A rung is accepted only when its box lies WHOLLY inside the frame
// and clears every already-placed box and every OTHER building's
// screen box — a label is never clipped mid-word and never struck
// through by another building. If no rung fits, the building keeps
// its physical sign and the HTML label collapses (rung 'collapsed'):
// the size floor is absolute — text is never shrunk or cut to fit.
// Citizen chips are placed after all signs, with their own ladder
// (above head → right → left → below), and yield to signs by
// construction: a chip that cannot clear the placed signs moves or
// collapses; a sign never moves for a chip. A per-frame budget
// collapses lowest-priority chips first.
//
// Determinism: items are processed signs-first in id order, then
// chips in id order; candidate order within a ladder is fixed. Same
// inputs => same placements, every run.
//
// G-J1 ROUND 2 (2026-11-03, my Hark's audit — audits/
// HARK-GJ1-AUDIT-2026-11-03.md): two rules the round-1 system did
// not carry, both now structural here:
//   - Plate-vs-figure. A citizen's nameplate may never cover a
//     figure. Callers pass figure screen rects (`figures`); every
//     chip candidate that overlaps any figure rect is refused, so
//     in practice a plate sits above its figure's head or not at
//     all — the side/below rungs survive only where they genuinely
//     clear every figure. A chip whose own figure lies wholly
//     outside the frame is out-of-frame, however near its anchor
//     sits (round 1 let such plates poke in at the frame edge).
//   - Label-pinned-to-building. A place label renders only while
//     its building is in frame. Callers pass the building's screen
//     rect (`frameRect`); a building wholly outside gets no label
//     (round 1's edge-tag clamped the Ledger Press label into the
//     frame over empty ground). A partially-in-frame building
//     gains a 'visible-tag' rung anchored to its visible part, so
//     its label rides with the part of the building that shows.
//
// G-J1 ROUND 3 (2026-11-03, my Hark's round-2 audit — audits/
// HARK-GJ1-AUDIT-R2-2026-11-03.md): three extensions on the same
// discipline:
//   - Place labels obey plate-vs-figure too. Round 2's refusal
//     covered citizen chips only; the talk frame's "Notice Board"
//     chip sat across a figure. Building candidates now refuse any
//     box that overlaps a figure rect, on every rung (the ladder
//     falls through), and station labels — which are not resolver
//     items — get the same rule through stationLabelPlacement
//     below, consumed by the scene's interior labels.
//   - Relocation before refusal. The chip ladder gains rungs
//     (above-far, above-left, above-right, right-far, left-far)
//     so a plate moves before it collapses. Every rung still
//     answers to the same refusals (frame, placed boxes, figure
//     rects) — coverage is never bought with an overlap. The
//     seq-556 street re-measurement rides in the evidence pack.
//   - The ambiguity rule. A plate must read as ITS figure's: when
//     figures carry head anchors, a chip candidate is refused
//     when another figure's anchor is strictly nearer the box
//     than the chip's own figure's anchor. (Round 2 left one
//     street plate sitting nearer a neighbour's head than its
//     own.) Callers that pass no anchors keep the round-2
//     behaviour exactly.
//
// G-J1 ROUND 4 (2026-11-03, my Hark's round-3 audit — audits/
// HARK-GJ1-AUDIT-R3-2026-11-03.md): the anchor race is not the
// whole of "reads as naming". At bundle seq 614 the street ladder
// placed Kevin Bianchi's plate (chip-above) where it sat 1.1 px
// above KAVI MARLOW's reclined body and 17.1 px above Kevin's
// own — Kevin's head anchor won the anchor race by 0.6 px
// (3.0 vs 3.6), so every round-3 rule passed and the plate still
// read as Kavi's; the overview plated the same figure "Kavi
// Marlow". For a reclined figure the head anchor (the standing
// height, +2.0) floats well above the body rect (low, toward
// +z), so anchor distance and body distance decouple. Two rules
// close the class, both measured on figure RECTS:
//   - Rect-proximity (the misname rule). A chip candidate is
//     refused when another figure's rect is nearer the box than
//     its own figure's rect — by edge distance (rect-to-rect
//     gap) or by centre distance (box centre to rect). A plate
//     may only sit where its own figure is the figure it reads
//     as naming.
//   - Detachment. A chip candidate is refused when the box's
//     horizontal gap from its own figure's rect exceeds
//     MAX_DETACH_GAP_PX (8 px — the ladder's own side offset:
//     chip-right/left stand 8 px off the head anchor, so their
//     box-to-rect gap never exceeds 8). Round 3's far side rungs
//     put Rocky Headlong's plate 44 px sideways from his body,
//     over open ground by the Town Hall door — in his column's
//     row but naming nothing. Vertical stacking (above-far)
//     stays in its figure's column by construction and is not
//     detachment; sideways drift is what breaks naming.
// Both rules need the chip's own figure rect; callers that pass
// no figures keep the earlier behaviour exactly.
//
// ITEM 3 (2026-11-03, the project owner's ruling — DECISIONS.md: "smaller
// plates, and a plate shows when a person is manually
// selected"; the look touch-up wave, stage 4):
//   - Citizen nameplates shrink: chips are sized by chipBox
//     (CHIP_FONT_PX / CHIP_PAD_X_PX below), not by the building
//     label metrics. Building signs/tags and station labels
//     keep LABEL_FONT_PX exactly — the ruling names citizen
//     plates, not place labels. Every refusal above stays at
//     full strength (figure overlap, ambiguity, rect-proximity,
//     MAX_DETACH_GAP_PX = 8 unchanged): smaller buys coverage
//     only where a smaller box honestly fits.
//   - Select-to-show: resolveLabels takes `selectedId` (a chip
//     item id). The selected citizen's chip is resolved FIRST
//     among chips — after the building signs, whose chips-yield
//     discipline is a gate law and does not move — at its best
//     (first legal) rung, and the remaining chips resolve
//     around it. Selection changes ORDER only: the selected
//     candidate answers to every refusal exactly as any other
//     does, so a selected plate with no legal rung still
//     collapses (the scene's follow/info surface names the
//     citizen instead — see scene.mjs's pick handler).
//
// SELECTED-PLATE EXEMPTION (2026-11-03, the project owner's ruling —
// DECISIONS.md: "Exempt overlap and proximity for selected
// plates"; completes the Item 3 sentence above in the form my
// Hark proposed in the touch-up batch-1 audit):
//   - For the SELECTED chip only, two refusal classes no longer
//     refuse: figure-overlap (plate-vs-figure) and detachment
//     (the proximity class — the box's horizontal gap from its
//     own figure's rect past MAX_DETACH_GAP_PX). A selected
//     candidate refused ONLY by those classes is placed, and
//     its result entry carries `exempted: [...]` naming the
//     classes waived for it.
//   - Ambiguity and rect-proximity (the misname rule) are NOT
//     exempted: they guard against a wrong name on screen and
//     hold at full strength for selected and unselected alike.
//   - Two further refusals stay absolute for the selected chip
//     because the ruling does not name them: placed-box overlap
//     (a plate never covers another plate or a building sign —
//     signs keep their gate priority) and the frame bound (a
//     plate outside the frame cannot be shown at all).
//   - Unselected chips are untouched: every refusal at full
//     strength, exactly as before the ruling.

export const ELEV_DEG = 35; // the canonical camera elevation (Look Bible §4; scene.mjs RIG)
export const CHIP_FONT_PX = 10.5; // Item 3 (the project owner, 2026-11-03): citizen
// nameplates render smaller than place labels. This deliberately
// diverges from font.scale.chip (LABEL_FONT_PX below), which still
// governs building signs/tags and station labels; the scene applies
// this size to chip divs via CSSOM in scene.mjs (chipDiv.style),
// NOT through scene.html — the stylesheet there is pinned by the
// staging Worker's CSP style hash, and no Worker change rides
// with this stage. Candidate sizes 11 / 10.5 / 10 px measured
// identical plate coverage on the frozen seq-980 geometry (the
// refusals there are figure/misname-driven, not size-driven), so
// 10.5 was chosen on bulk vs glance-legibility, not on coverage.
export const CHIP_PAD_X_PX = 5; // chip horizontal padding a side (the
// .lbl building padding is 7px; chips carry the narrower pad).
export const LABEL_FONT_PX = 12.5; // tokens: font.scale.chip (0.78rem). The scene's CSS
// rendered labels at 11px (scene.html .lbl, pre-token) until
// 2026-11-03, when the CSS was aligned to this token size and the
// staging Worker's pinned CSP style hash was updated in the same
// change (VER rotation 1; see VER-LOG). The model sizes boxes at the
// token size — the ceiling — so a placement valid under this model
// stays valid at either rendered size. If the CSS ever exceeds this
// size, raise it here in the same change.
const FRAME_MARGIN = 4; // px a placed box keeps from the frame edge
const BOX_GAP = 2; // px clearance between placed boxes

// ------------------------------------------------------------ text size
// Deterministic text-width model for the scene's label font (Nunito
// 700 / Fredoka 600 class), per-character em widths with a safety
// factor. It is a model, not a measurement — the pixel-exact check is
// the M4.22 screenshot harness's job; this model only has to be
// conservative (never understate a width), which the safety factor
// and the wide capitals see to.
const EM = { space: 0.28, narrow: 0.31, mid: 0.38, lower: 0.54, upper: 0.70, digit: 0.58, wide: 0.88 };
function charEm(ch) {
  if (ch === ' ') return EM.space;
  if ('ilj.,:;\'|!'.includes(ch)) return EM.narrow;
  if ('ftr()[]-'.includes(ch)) return EM.mid;
  if ('mwMW'.includes(ch)) return EM.wide;
  if (ch >= 'A' && ch <= 'Z') return EM.upper;
  if (ch >= '0' && ch <= '9') return EM.digit;
  return EM.lower;
}
export function textWidthPx(text, fontPx = LABEL_FONT_PX) {
  let em = 0;
  for (const ch of String(text)) em += charEm(ch);
  return em * fontPx * 1.06;
}
// The .lbl box: 7px horizontal padding a side, 1px border a side,
// line height 1.32 (scene.html carries the same numbers).
export function labelBox(text, fontPx = LABEL_FONT_PX) {
  return {
    w: Math.ceil(textWidthPx(text, fontPx)) + 2 * 7 + 2,
    h: Math.round(fontPx * 1.32) + 2 * 1 + 2,
  };
}
// The citizen chip box (Item 3, 2026-11-03): the same model shape
// as labelBox — text at CHIP_FONT_PX, CHIP_PAD_X_PX padding a
// side, the same border/line-height allowances — so a placement
// valid under this model is valid for the chip div scene.mjs
// sizes via CSSOM (font-size + padding set from these constants).
export function chipBox(text) {
  return {
    w: Math.ceil(textWidthPx(text, CHIP_FONT_PX)) + 2 * CHIP_PAD_X_PX + 2,
    h: Math.round(CHIP_FONT_PX * 1.32) + 2 * 1 + 2,
  };
}

/** The sign's short name: the record label minus a trailing
 *  parenthetical ("Meridian Hall (District 3, Plot 18)" -> "Meridian
 *  Hall"). A substring of the record label, never a rewrite; labels
 *  without a parenthetical pass through whole. */
export function shortName(label) {
  return String(label).replace(/\s*\([^)]*\)\s*$/, '');
}

// ------------------------------------------------------------ projectors
// Match scene.mjs's cameras: orthographic overview (fixed azimuth
// from the south, elevation 35°) and the perspective follow camera
// (fov 28°, same axis). p = {x, y, z} world; returns CSS pixels in a
// width × heightPx viewport, y down, plus `visible` (inside the NDC
// cube). Cross-checked against vendored THREE in the test suite.
const ELEV = (ELEV_DEG * Math.PI) / 180;
const SIN = Math.sin(ELEV);
const COS = Math.cos(ELEV);

function toPx(ndcX, ndcY, cam) {
  return {
    x: (ndcX * 0.5 + 0.5) * cam.width,
    y: (1 - (ndcY * 0.5 + 0.5)) * cam.heightPx,
    visible: Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1,
  };
}

export function projectOrtho(p, cam) {
  const dx = p.x - cam.target.x;
  const dy = p.y - cam.target.y;
  const dz = p.z - cam.target.z;
  const sx = dx; // camera right = +x on this axis
  const sy = dy * COS - dz * SIN; // camera up = (0, cos, -sin)
  return toPx(sx / ((cam.height * cam.aspect) / 2), sy / (cam.height / 2), cam);
}

export function projectPersp(p, cam) {
  // Camera at target + (0, sin, cos) * dist, looking at the target
  // (scene.mjs placeCam): forward = (0, -sin, -cos), right = (1,0,0),
  // up = (0, cos, -sin).
  const rx = p.x - cam.target.x;
  const ry = p.y - (cam.target.y + SIN * cam.dist);
  const rz = p.z - (cam.target.z + COS * cam.dist);
  const depth = ry * -SIN + rz * -COS; // rel · forward
  if (depth <= 0.1) return { x: 0, y: 0, visible: false };
  const tanHalf = Math.tan(((cam.fovDeg * Math.PI) / 180) / 2);
  const sx = rx; // rel · right
  const sy = ry * COS + rz * -SIN; // rel · up
  return toPx(sx / (depth * tanHalf * cam.aspect), sy / (depth * tanHalf), cam);
}

// -------------------------------------------------------------- resolver
const overlaps = (a, b, gap = 0) =>
  a.x - gap < b.x + b.w && b.x - gap < a.x + a.w && a.y - gap < b.y + b.h && b.y - gap < a.y + a.h;

const inFrame = (box, viewport) =>
  box.x >= FRAME_MARGIN &&
  box.y >= FRAME_MARGIN &&
  box.x + box.w <= viewport.width - FRAME_MARGIN &&
  box.y + box.h <= viewport.heightPx - FRAME_MARGIN;

function buildingCandidates(item) {
  const sign = labelBox(item.signText);
  const full = labelBox(item.text);
  const { sign: sa, roof: ra } = item.anchors;
  const out = [];
  if (sa) out.push({ rung: 'sign', text: item.signText, box: { x: sa.x - sign.w / 2, y: sa.y - sign.h - 2, w: sign.w, h: sign.h } });
  if (ra) out.push({ rung: 'roof-tag', text: item.text, box: { x: ra.x - full.w / 2, y: ra.y - full.h - 2, w: full.w, h: full.h } });
  return out;
}

function chipCandidates(item) {
  const size = chipBox(item.text);
  const ha = item.anchors.head;
  if (!ha) return [];
  const above = { y: ha.y - size.h - 3 };
  return [
    { rung: 'chip-above', box: { x: ha.x - size.w / 2, y: above.y, w: size.w, h: size.h } },
    // Relocation rungs (G-J1 round 3): a second storey above the
    // head, then the above rung shifted to either side — all still
    // head-anchored placements, tried before the plate gives up
    // sideways distance or collapses.
    { rung: 'chip-above-far', box: { x: ha.x - size.w / 2, y: ha.y - 2 * size.h - 9, w: size.w, h: size.h } },
    { rung: 'chip-above-left', box: { x: ha.x - size.w - 2, y: above.y, w: size.w, h: size.h } },
    { rung: 'chip-above-right', box: { x: ha.x + 2, y: above.y, w: size.w, h: size.h } },
    { rung: 'chip-right', box: { x: ha.x + 8, y: ha.y - size.h / 2, w: size.w, h: size.h } },
    { rung: 'chip-left', box: { x: ha.x - size.w - 8, y: ha.y - size.h / 2, w: size.w, h: size.h } },
    { rung: 'chip-right-far', box: { x: ha.x + 8 + 44, y: ha.y - size.h / 2, w: size.w, h: size.h } },
    { rung: 'chip-left-far', box: { x: ha.x - size.w - 8 - 44, y: ha.y - size.h / 2, w: size.w, h: size.h } },
    { rung: 'chip-below', box: { x: ha.x - size.w / 2, y: ha.y + 8, w: size.w, h: size.h } },
  ];
}

/** Distance from a point to a box (0 when the point is inside). */
const distToBox = (p, b) => {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
  return Math.hypot(dx, dy);
};

/** Distance between two rects (0 when they touch or overlap). */
const rectGapDist = (a, b) => {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
  return Math.hypot(dx, dy);
};

const boxCentre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Horizontal gap between two rects (0 when their spans overlap). */
const rectHGap = (a, b) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);

// The detachment bound (G-J1 round 4): a plate whose box sits
// farther sideways from its figure's rect than the ladder's own
// side offset (chip-right/left stand 8 px off the head anchor)
// is refused, not placed — see the header note.
export const MAX_DETACH_GAP_PX = 8;

/**
 * The station-label placement (G-J1 round 3): interior station
 * labels ("Notice Board", "Ledger Desk") are not resolver items —
 * the scene projects them straight onto their anchors — but they
 * answer to the same plate-vs-figure discipline. Given the label
 * text, its screen anchor (the point the label's bottom-centre
 * sits on, matching the scene's translate(-50%,-100%) rendering)
 * and the figure rects on screen, returns the label's box, or
 * null when the label would leave the frame or cover a figure —
 * the caller then hides it, exactly as a collapsed resolver item
 * renders nothing.
 */
export function stationLabelPlacement({ text, anchor, figures = [], viewport }) {
  if (!anchor || !viewport) return null;
  const size = labelBox(text);
  const box = { x: anchor.x - size.w / 2, y: anchor.y - size.h, w: size.w, h: size.h };
  if (!inFrame(box, viewport)) return null;
  if (figures.some((f) => overlaps(box, f.rect, 0))) return null;
  return box;
}

function edgeTagCandidates(item, viewport) {
  const size = labelBox(item.text);
  const sa = item.anchors.sign || item.anchors.roof;
  if (!sa) return [];
  const clampX = Math.max(FRAME_MARGIN, Math.min(sa.x - size.w / 2, viewport.width - FRAME_MARGIN - size.w));
  const xs = [clampX, FRAME_MARGIN, viewport.width - FRAME_MARGIN - size.w];
  const dys = [0, -(size.h + 6), size.h + 6];
  const out = [];
  for (const dy of dys) {
    for (const x of xs) {
      out.push({ rung: 'edge-tag', text: item.text, box: { x, y: sa.y - size.h / 2 + dy, w: size.w, h: size.h } });
    }
  }
  return out;
}

const anchorInFrame = (a, viewport) =>
  a && a.x >= -40 && a.y >= -40 && a.x <= viewport.width + 40 && a.y <= viewport.heightPx + 40;

/** Does a screen rect touch the viewport at all? (Raw frame edges —
 *  a building whose extent merely touches the frame is in frame;
 *  the FRAME_MARGIN rule governs where boxes may be *placed*, not
 *  whether the named thing is present.) */
export function rectIntersectsViewport(rect, viewport) {
  return !!rect &&
    rect.x < viewport.width && rect.x + rect.w > 0 &&
    rect.y < viewport.heightPx && rect.y + rect.h > 0;
}

/** The visible-tag rung (G-J1 round 2): the full record label
 *  anchored to the part of the building that is actually in frame —
 *  centred over the building's visible span, just above its visible
 *  top when the top shows, else at the frame's top margin over the
 *  building (the sign-on-the-building idea, for a building whose
 *  top is cut). Only for items carrying a frameRect that intersects
 *  the viewport; resolveLabels gates that before calling this. */
function visibleTagCandidate(item, viewport) {
  const rect = item.frameRect;
  if (!rect) return null;
  const size = labelBox(item.text);
  const visL = Math.max(rect.x, 0);
  const visR = Math.min(rect.x + rect.w, viewport.width);
  if (visR <= visL) return null;
  let x = (visL + visR) / 2 - size.w / 2;
  x = Math.max(FRAME_MARGIN, Math.min(x, viewport.width - FRAME_MARGIN - size.w));
  const y = rect.y >= FRAME_MARGIN ? rect.y - size.h - 2 : FRAME_MARGIN;
  return { rung: 'visible-tag', text: item.text, box: { x, y, w: size.w, h: size.h } };
}

/**
 * resolveLabels({ items, obstacles, figures, viewport, budget,
 *                  selectedId })
 * selectedId (Item 3, 2026-11-03): the id of the manually
 *   selected citizen's chip item, or null. Buildings resolve
 *   first as always (signs are gate law; chips yield to them),
 *   then the selected chip at its best legal rung, then the
 *   remaining chips in id order around it. The selected item's
 *   result entry carries `selected: true`. Selection never
 *   overrides a refusal: a selected chip with no legal rung is
 *   'collapsed' (or 'out-of-frame') exactly as an unselected
 *   one. A selectedId that names no chip item is ignored.
 * items: [{ id, kind: 'building'|'chip', text, signText?,
 *           anchors: { sign?, roof?, head? }, ownObstacle?,
 *           frameRect?, figureId? }]
 *   frameRect (buildings): the named building's own screen rect.
 *     When present it governs presence: wholly outside the frame
 *     => 'out-of-frame' (no label, however near an anchor sits);
 *     intersecting => the item is present even if every anchor is
 *     off-frame, and the visible-tag rung anchors its label to the
 *     visible part. When absent, presence falls back to the anchor
 *     rule (the pre-round-2 behaviour, kept for synthetic callers).
 *   figureId (chips): the id of the chip's own entry in `figures`;
 *     a chip whose figure lies wholly outside the frame is
 *     'out-of-frame' — a plate never floats in at the edge for a
 *     figure that is not there.
 * obstacles: [{ id, rect: {x, y, w, h} }] — building screen boxes;
 *   a building's label may overlap only its OWN obstacle, and only
 *   on the sign rung (the word sits on its own building by design).
 * figures: [{ id, rect, anchor? }] — figure screen boxes. A chip
 *   candidate that overlaps ANY figure rect is refused
 *   (plate-vs-figure, G-J1 round 2), and since round 3 a BUILDING
 *   candidate is refused on the same rule (place-vs-figure). The
 *   optional anchor is the figure's head point: when anchors are
 *   present, a chip candidate is also refused when another
 *   figure's anchor is strictly nearer the box than its own
 *   figure's (the ambiguity rule, G-J1 round 3). Since round 4 a
 *   chip candidate is further refused when another figure's RECT
 *   is nearer the box than its own figure's rect — by edge
 *   distance or by box-centre distance (the misname rule) — and
 *   when the box's horizontal gap from its own figure's rect
 *   exceeds MAX_DETACH_GAP_PX (the detachment bound). Both round-4
 *   rules need the chip's own entry in `figures` (its figureId).
 *   For the selected chip (selectedId), the figure-overlap and
 *   detachment refusals are waived (the project owner's 2026-11-03
 *   selected-plate exemption — see the header note); ambiguity
 *   and rect-proximity are not.
 * Returns a Map: id -> { rung, text, box|null } (a placed selected
 * chip's entry may carry `exempted: [...]`) with rung one of
 * 'sign' | 'roof-tag' | 'visible-tag' | 'edge-tag' | 'chip-above' |
 * 'chip-above-far' | 'chip-above-left' | 'chip-above-right' |
 * 'chip-right' | 'chip-left' | 'chip-right-far' | 'chip-left-far' |
 * 'chip-below' | 'collapsed' | 'out-of-frame'.
 */
export function resolveLabels({ items, obstacles = [], figures = [], viewport, budget = Infinity, selectedId = null }) {
  const placed = []; // accepted boxes {box}
  const result = new Map();
  const obstacleById = new Map(obstacles.map((o) => [o.id, o.rect]));
  const figureById = new Map(figures.map((f) => [f.id, f.rect]));
  const figureAnchorById = new Map(figures.filter((f) => f.anchor).map((f) => [f.id, f.anchor]));
  let placedCount = 0;

  const sorted = [...items].sort((a, b) => {
    const ka = a.kind === 'building' ? 0 : 1;
    const kb = b.kind === 'building' ? 0 : 1;
    if (ka !== kb) return ka - kb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  // Resolution order (Item 3 select-to-show): buildings in id
  // order, then the selected chip (if it names a chip item),
  // then the remaining chips in id order. With no selectedId
  // this is exactly the pre-Item-3 order.
  const selectedItem = selectedId
    ? sorted.find((i) => i.kind === 'chip' && i.id === selectedId) || null
    : null;
  const ordered = [
    ...sorted.filter((i) => i.kind === 'building'),
    ...(selectedItem ? [selectedItem] : []),
    ...sorted.filter((i) => i.kind !== 'building' && i !== selectedItem),
  ];

  for (const item of ordered) {
    const isSelected = item === selectedItem;
    const anchors = item.anchors || {};
    // Presence (G-J1 round 2): the named thing itself decides, not
    // only its anchors — a building whose extent is in frame is
    // present even when its sign anchor is not, and a building (or
    // figure) wholly out of frame is absent even when an anchor
    // sits inside the ±40 px tolerance band.
    let present;
    if (item.kind === 'building' && item.frameRect) {
      present = rectIntersectsViewport(item.frameRect, viewport);
    } else if (item.kind === 'chip' && item.figureId && figureById.has(item.figureId)) {
      present = rectIntersectsViewport(figureById.get(item.figureId), viewport);
    } else {
      present = [anchors.sign, anchors.roof, anchors.head].some((a) => anchorInFrame(a, viewport));
    }
    if (!present) {
      result.set(item.id, { rung: 'out-of-frame', text: item.text, box: null, ...(isSelected ? { selected: true } : {}) });
      continue;
    }
    let candidates;
    if (item.kind === 'building') {
      candidates = buildingCandidates(item).filter((c) => c.box);
      const vt = visibleTagCandidate(item, viewport);
      if (vt) candidates.push(vt);
      candidates.push(...edgeTagCandidates(item, viewport));
      // Ladder order is sign -> roof-tag -> visible-tag -> edge-tag;
      // the candidates were generated in groups, so re-sort stably
      // by rung rank.
      const rank = { sign: 0, 'roof-tag': 1, 'visible-tag': 2, 'edge-tag': 3 };
      candidates.sort((a, b) => rank[a.rung] - rank[b.rung]);
    } else {
      candidates = chipCandidates(item);
    }
    let accepted = null;
    let acceptedExempted = null;
    for (const cand of candidates) {
      if (item.kind === 'chip' && placedCount >= budget) break;
      if (!inFrame(cand.box, viewport)) continue;
      if (placed.some((p) => overlaps(cand.box, p.box, BOX_GAP))) continue;
      // Plate-vs-figure (round 2) and place-vs-figure (round 3):
      // no label of either kind may cover a figure. A building
      // candidate falls through its ladder on this rule exactly
      // as a chip does. SELECTED-PLATE EXEMPTION (the project owner,
      // 2026-11-03): for the selected chip this refusal is
      // waived — figure-overlap is a cosmetic class (see the
      // header note); every refusal below still binds it.
      const figOverlap = figures.some((f) => overlaps(cand.box, f.rect, 0));
      if (figOverlap && !isSelected) continue;
      let exempted = figOverlap && isSelected ? ['figure-overlap'] : null;
      if (item.kind === 'chip' && item.figureId && figureAnchorById.has(item.figureId)) {
        // The ambiguity rule (round 3): the plate must read as
        // its own figure's — refused when another figure's head
        // anchor is strictly nearer the box than its own.
        const dOwn = distToBox(figureAnchorById.get(item.figureId), cand.box);
        let nearerOther = false;
        for (const f of figures) {
          if (f.id === item.figureId || !f.anchor) continue;
          if (distToBox(f.anchor, cand.box) < dOwn) { nearerOther = true; break; }
        }
        if (nearerOther) continue;
      }
      if (item.kind === 'chip' && item.figureId && figureById.has(item.figureId)) {
        const ownRect = figureById.get(item.figureId);
        // Detachment (round 4): a plate floating sideways off its
        // figure's column names nothing — refused past the bound.
        // SELECTED-PLATE EXEMPTION (the project owner, 2026-11-03): waived
        // for the selected chip — detachment is the proximity
        // class (see the header note).
        if (rectHGap(cand.box, ownRect) > MAX_DETACH_GAP_PX) {
          if (!isSelected) continue;
          exempted = [...(exempted || []), 'detachment'];
        }
        // Rect-proximity (round 4, the misname rule): the plate
        // must sit where its own figure is the nearest body — by
        // edge distance and by box-centre distance alike. (The
        // seq-614 street plate passed the anchor race by 0.6 px
        // while sitting 1.1 px over its neighbour's body and
        // 17.1 px from its own.)
        const ownEdge = rectGapDist(cand.box, ownRect);
        const ownCentre = distToBox(boxCentre(cand.box), ownRect);
        let nearerOther = false;
        for (const f of figures) {
          if (f.id === item.figureId || !f.rect) continue;
          if (rectGapDist(cand.box, f.rect) < ownEdge || distToBox(boxCentre(cand.box), f.rect) < ownCentre) {
            nearerOther = true;
            break;
          }
        }
        if (nearerOther) continue;
      }
      if (item.kind === 'building') {
        let blocked = false;
        for (const [oid, rect] of obstacleById) {
          if (oid === item.ownObstacle) continue;
          if (overlaps(cand.box, rect, 0)) { blocked = true; break; }
        }
        if (blocked) continue;
      }
      accepted = cand;
      acceptedExempted = exempted;
      break;
    }
    if (accepted) {
      placed.push({ box: accepted.box });
      placedCount++;
      result.set(item.id, { rung: accepted.rung, text: accepted.text ?? item.text, box: accepted.box, ...(isSelected ? { selected: true } : {}), ...(acceptedExempted ? { exempted: acceptedExempted } : {}) });
    } else {
      result.set(item.id, { rung: 'collapsed', text: item.signText ?? item.text, box: null, ...(isSelected ? { selected: true } : {}) });
    }
  }
  return result;
}
