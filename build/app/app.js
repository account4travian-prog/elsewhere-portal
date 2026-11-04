// Elsewhere Portal — viewer shell (wave 1).
// Vanilla ES modules, no build step, no external dependencies.
// Data: ../data/feed/world-data.json (Arm A bundle; portal.world-data
// v1 or the frozen v2 — logic.isBundle accepts both, an unknown schema
// neither) -> ../fixtures/sample-world-data.json (shared) ->
// fixtures/sample-world-data.json (app).
// Engine: ../engine/playback.mjs (Arm B), imported directly — the wave-1
// local stand-in engine and the built-in fallback layout with its
// invented codes are retired (M2.03): the app consumes the real
// engine and the shared layout, or honestly shows less.
// Citizens are keyed everywhere (positions, roster, follow, cards) by
// their PORTAL-KEY (bundle field citizenKey) — see logic.mjs.
import { planJourney, positionAt, catchUp, journeyRoute } from '../engine/playback.mjs';
import {
  badgeFor, selectBundle, isBundle, isEvidenced,
  citizenCaption, citizenColor, resolveExactNode, relativeTime,
  citizenKeyOf, effectiveLayout,
  formatCount, planPresentation, summaryPanel,
  isEpisodesFeed, episodeListModel, talkPlaybackModel, actListModel,
  scheduleTalkScene, bubbleKit, READ_IN_FULL_MARKER, conversationStaging,
  talkActPresentation,
  fencedSpeech, SPEECH_FENCE_LABEL, SPEECH_FENCE_QUOTE, SPEECH_FENCE_COLOR,
  workTier, conversationsSource, resolveTalkEpisode,
  citizenCardHtml, buildingCardHtml, tickerCardHtml, tickerListHtml, rosterListHtml,
  nowMs, createFrameGuard, guardedFrameStep, frameStalled, recordingNotice,
  sampleBanner,
  createWorldClockWatch, observeWorldClock, worldClockFrozen, worldFrozenSinceUtc,
  createPlacementTracker, applyBundlePlacements, placementStates, placementEventLines,
  conflictModel, heldCitizenPositions, figureStyle,
  pollOnce, POLL_INTERVAL_MS, FEED_MANIFEST_URL, LIVE_BUNDLE_URL, recordingRangeOf,
  nowLineModel, populationCounts, tickerLanding, movementLanding,
  inspectorModel, inspectorHtml, resetBannerModel, resetBannerHtml,
  directoryModel, directoryListHtml, portraitStripModel, portraitStripHtml,
  isGrowthBook, growthBookHtml,
  isChronicleBook, chronicleBookHtml, calendarHtml, quietState, quietPageHtml, LAST_SEQ_KEY,
  citizenPageModel, citizenPageHtml,
  frontierModel, frontierMapHtml, frontierTapModel, frontierFollowNote, frontierLanding,
  rhythmModel, rhythmHeaderHtml,
  createFollowMachine, mayorKeyOf,
  welcomeSeen, markWelcomeSeen, welcomeOverlayHtml, WELCOME_DISMISS_HINT, attributionsHtml,
  sceneListModel, sceneListHtml, displayPanelHtml, normaliseDisplaySettings,
  tickerScopeAllows, cycleFollowKey,
} from './logic.mjs';
import {
  isJourneysFeed, livePlans, livePositions, journeysNotice,
  liveJourneyCaption, planAt, worldTickAt,
} from './live-pacing.mjs';

const $ = (id) => document.getElementById(id);

const DEMO_PATH = ['LIBRARY_ANNEX', 'EMBER_PLAZA_OF_UNITY', 'EMBER_COLLEGE'];
const DEMO_TICKS_PER_STEP = 6;
const DEMO_TICK_RATE = 2; // playback ticks per real second in the demo

const state = {
  bundle: null, source: null, isFallback: true, loadedAtMs: nowMs(),
  layout: { version: 1, nodes: [], edges: [] }, layoutLoaded: false,
  followed: null, selected: null,
  demo: null, // {journey, key, name, tick, target, replay, playing}
  summary: null, // {journey} while a path-summary is on stage (Plan B §3.4)
  episodesFeed: null, // feed/episodes.json (portal.episodes/v1) or null — absence is graceful
  conversations: null, // the panel's episodes source: the v2 bundle when it carries them, else the feed
  journeysFeed: null, // feed/journeys.json (portal.journeys/v1) or null — absence is graceful
  growthFeed: null, // feed/growth-book.json (portal.growth-book/v1, M6.08) or null — absence is graceful
  chronicleFeed: null, // feed/chronicle-book.json (portal.chronicle-book/v1, M6.09) or null — absence is graceful
  visitSeq: null, // the bundleSeq this browser stored on its PREVIOUS visit (M6.09 since-your-last-visit); read once at load, before this visit's seq is stored
  livePlans: null, // live-pacing.livePlans(journeysFeed).plans — PORTAL-KEY -> live journey plans (M3.06)
  placements: createPlacementTracker(), // M3.04: place-conflict HOLD + labelled exits/entries (engine tracker)
  worldWatch: createWorldClockWatch(), // OM15-C1: the world's own clock, watched across live bundle loads
  placementEvents: [], // the events the most recent live bundle caused
  frontierModel: null, // M6.11: the frontier map's current model (grid + classes), for canvas taps
  followMachine: createFollowMachine(), // M6.07: the eight-state Follow machine (logic.mjs holds its wordings)
  followState: null, // the machine's current state key, for the scene list / diagnostics
  display: normaliseDisplaySettings(null), // M6.15 X6: the Display panel's toggles (display only, ever)
  welcomeChecked: false, // M6.12: the first-visit overlay is offered once per page load, when the first bundle renders
  placeFocus: null, // M6.01/M6.02: a "Take me there" place landing {x, y, code} the camera centres on when nobody is followed
  bookId: null, // M6.06: the world book this page is reading; a different book on a later live bundle raises the D6 reset banner
  talk: null, // {model, shown, timer} while a recorded conversation plays back
  cam: { x: 0, y: 0 }, // grid-space camera centre
  hits: [], // {kind, ref, sx, sy}
};

async function fetchJson(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return { ok: false, source: url };
    return { ok: true, source: url, data: await r.json() };
  } catch {
    return { ok: false, source: url };
  }
}

// Raw bytes, for the manifest poll (M4.03): the bundle is verified
// against the manifest's SHA-256 BEFORE it is parsed, so the poll
// path must handle bytes, never pre-parsed JSON.
async function fetchBytes(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return { ok: false, source: url };
    return { ok: true, source: url, bytes: new Uint8Array(await r.arrayBuffer()) };
  } catch {
    return { ok: false, source: url };
  }
}

async function loadAll() {
  const layoutRes = await fetchJson('../shared/ember-layout.json');
  if (layoutRes.ok && Array.isArray(layoutRes.data?.nodes)) {
    state.layout = layoutRes.data; state.layoutLoaded = true;
  }
  viewFit = null; // refit the view to whichever layout won
  const attempts = [];
  for (const url of ['../data/feed/world-data.json', '../fixtures/sample-world-data.json', 'fixtures/sample-world-data.json']) {
    const res = await fetchJson(url);
    attempts.push({ ok: res.ok && isBundle(res.data), source: url, data: res.data });
  }
  const picked = selectBundle(attempts);
  if (picked) {
    state.bundle = picked.data;
    state.source = picked.source;
    state.isFallback = picked.isFallback;
  }
  // M3.04: the placement tracker consumes LIVE bundles only. Sample
  // data is a recording — feeding it would manufacture movement
  // events (entries, exits, conflicts) the record never made.
  state.placementEvents = picked && !picked.isFallback
    ? applyBundlePlacements(state.placements, picked.data)
    : [];
  // OM15-C1: the world-clock watch is fed LIVE bundles only, on the
  // same rule as the placement tracker — sample data is a recording
  // and must not manufacture a frozen (or advancing) world.
  if (picked && !picked.isFallback) {
    state.worldWatch = observeWorldClock(state.worldWatch, picked.data, nowMs());
    applyBookkeeping(picked.data);
  }
  // The episodes feed rides alongside the bundle; its absence (or a
  // bad body) simply hides the Conversations panel — never an error.
  const epRes = await fetchJson('../data/feed/episodes.json');
  state.episodesFeed = epRes.ok && isEpisodesFeed(epRes.data) ? epRes.data : null;
  // The Conversations panel reads the bundle's own episodes when the
  // bundle is v2 and carries them; the feed is the fallback carrier
  // (and stays the words source for bundle episodes either way).
  state.conversations = conversationsSource(state.bundle, state.episodesFeed);
  // The journeys feed rides alongside (M3.06): reconstructed journeys,
  // played at the world's own pace by live-pacing. Absence is
  // graceful — no feed, no walks, no note.
  const jRes = await fetchJson('../data/feed/journeys.json');
  state.journeysFeed = jRes.ok && isJourneysFeed(jRes.data) ? jRes.data : null;
  state.livePlans = state.journeysFeed ? livePlans(state.journeysFeed).plans : null;
  // The growth book rides alongside (M6.08): the diff writer's counted
  // series + firsts wall. Absence is graceful — the panel shows the
  // not-begun wording, never an error.
  const gRes = await fetchJson('../data/feed/growth-book.json');
  state.growthFeed = gRes.ok && isGrowthBook(gRes.data) ? gRes.data : null;
  renderGrowthBook();
  // The Chronicle book rides alongside (M6.09/M6.10): items, the
  // Ledger, the civic calendar. Absence is graceful. The visit seq is
  // read from this browser's own storage BEFORE this visit's bundle
  // number is stored over it — since-your-last-visit compares the two.
  const cRes = await fetchJson('../data/feed/chronicle-book.json');
  state.chronicleFeed = cRes.ok && isChronicleBook(cRes.data) ? cRes.data : null;
  try {
    const stored = Number(localStorage.getItem(LAST_SEQ_KEY));
    state.visitSeq = Number.isFinite(stored) && stored > 0 ? stored : null;
  } catch { state.visitSeq = null; }
  renderChronicle();
  if (state.bundle?.bundleSeq != null) {
    try { localStorage.setItem(LAST_SEQ_KEY, String(state.bundle.bundleSeq)); } catch { /* storage unavailable — the visit simply has no memory */ }
  }
  renderJourneysNote();
  state.loadedAtMs = nowMs();
  renderPanels();
  renderEpisodes();
  updateBadge();
  const srcEl = $('source-line');
  if (!state.bundle) {
    srcEl.textContent = 'Portal could not read the public feeds or its sample data. Nothing is shown, because showing nothing is better than making something up.';
    $('now-line').textContent = 'No data right now.';
  } else if (state.isFallback) {
    srcEl.textContent = 'Showing sample data (the live bundle is not there yet). The badge says STALE because sample data is not live — that is deliberate.';
  } else {
    srcEl.textContent = `Showing the live public bundle, read at ${state.bundle.newestFetchUtc || 'an unrecorded time'}.`;
  }
  $('standin-note').textContent =
    'Wave 1 stand-ins: citizens are coloured dots with name chips (real figures come with the art pass); ' +
    'the real playback engine is in use; ' +
    (state.layoutLoaded ? 'the shared street layout is in use.' : 'the shared street layout could not be read, so the stage shows no streets — Portal does not invent a layout.');
}

// ------------------------------------------------------------ panels

// The stage layout: the shared layout plus deterministic staging nodes
// for bundle-evidenced plot codes that have no authored node (M2.06
// sorted-code fill, logic.effectiveLayout). Memoised on the inputs.
let stageCache = { layout: null, bundle: null, eff: null };
function stageLayout() {
  if (stageCache.layout !== state.layout || stageCache.bundle !== state.bundle) {
    stageCache = { layout: state.layout, bundle: state.bundle, eff: effectiveLayout(state.layout, state.bundle) };
    viewFit = null; // the node set may have grown — refit the view
  }
  return stageCache.eff;
}

function placeLabel(code) {
  const node = resolveExactNode(stageLayout(), code);
  if (node) return node.label;
  return String(code || '').replace(/^EMBER_/, '').replace(/_/g, ' ').toLowerCase() || 'Ember';
}

function updateBadge() {
  // While a demo journey is on stage the badge reads REPLAY for its
  // whole duration (M3.10 / Design H6) — not only during the moments
  // the catch-up plan happens to flag replay.
  const replaying = !!state.demo;
  // A persistently failing frame loop means the stage is a frozen
  // last picture: the badge must say STALE however fresh the data is
  // (M3.09) — a frozen page under a LIVE badge was the named defect.
  const stalled = frameStalled(frameGuard);
  // OM15-C1: the world's own clock, watched across live bundle loads.
  // Fresh fetches of a world whose clock has stopped advancing are
  // STALE with the frozen-world wording — the fetch-age rule alone
  // would call them LIVE. Recomputed on every badge tick, so the
  // state lands as the wall clock passes the threshold.
  const worldFrozen = !state.isFallback && worldClockFrozen(state.worldWatch, nowMs());
  let age = null;
  if (state.bundle) {
    const base = typeof state.bundle.dataAgeSeconds === 'number' ? state.bundle.dataAgeSeconds : null;
    const sinceLoad = Math.floor((nowMs() - state.loadedAtMs) / 1000);
    age = base === null ? null : base + (state.isFallback ? 0 : sinceLoad);
  }
  const b = badgeFor({ dataAgeSeconds: age, replaying, loading: !state.bundle && !state.source, isFallback: state.isFallback, stalled, worldFrozen, worldFrozenSinceUtc: worldFrozen ? worldFrozenSinceUtc(state.worldWatch) : null, replayRange: replaying ? currentRecordingRange() : null });
  const el = $('badge');
  el.textContent = b.label;
  el.className = `badge badge-${b.key.toLowerCase()}`;
  let detail = b.detail;
  if (b.key === 'STALE' && !stalled && !worldFrozen && state.bundle?.newestFetchUtc) detail = `Last fresh record ${relativeTime(state.bundle.newestFetchUtc)}. Showing what Portal last knew.`;
  $('badge-detail').textContent = detail;
  renderRecordingNotice();
  renderSampleBanner();
}

// The recording caption (M3.10): shown the whole time a recording —
// the demo journey, or sample data — drives the stage, and never when
// the live record does. It is a caption of its own, beside the stage;
// the badge keeps its own rules (logic.recordingNotice).
let lastNoticeKey = undefined; // updateBadge runs often; touch the DOM on change only
// The journeys note (M3.06): what the journeys feed holds — the
// count and the reconstruction disclosure — and, while the feed is
// empty, why, in plain words (live-pacing.journeysNotice). Shown
// only alongside a live bundle: under sample data the page is
// already bannered as a recording, and the live record's journeys
// do not drive it.
function renderJourneysNote() {
  const el = $('journeys-note');
  if (!el) return;
  const notice = !state.isFallback && state.bundle ? journeysNotice(state.journeysFeed) : null;
  if (!notice) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = notice.detail ? `${notice.headline} ${notice.detail}` : notice.headline;
}

// The recording now driving the stage, if any, and the date range
// it declares (M4.19: REPLAY carries its date range). The demo
// journey declares its window in its fixture (the recorded evening
// it replays); sample data IS a bundle, so its range derives from
// the bundle's own stamps (logic.recordingRangeOf). A demo played
// over a live bundle with no declared window gets no range — the
// cluster never invents one.
function currentRecordingRange() {
  if (state.demo) return state.demo.range || (state.isFallback ? recordingRangeOf(state.bundle) : null);
  if (state.isFallback && state.bundle) return recordingRangeOf(state.bundle);
  return null;
}

function renderRecordingNotice() {
  const notice = recordingNotice({ demoActive: !!state.demo, isFallback: state.isFallback && !!state.bundle, range: currentRecordingRange() });
  const key = notice ? `${notice.key}|${notice.caption}` : null;
  if (key === lastNoticeKey) return;
  lastNoticeKey = key;
  const el = $('recording-note');
  if (!el) return;
  if (!notice) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = `${notice.label} — ${notice.caption}`;
}

// The SAMPLE DATA banner (M3.07 amended close, Design H4): visible the
// whole time a fallback bundle drives the app, never on live data.
// It is a separate element from the badge (sample is STALE, never
// LIVE) and from the recording caption above (sample shows BOTH).
// logic.sampleBanner is the only source of its wording.
let lastBannerKey = undefined; // updateBadge runs often; touch the DOM on change only
function renderSampleBanner() {
  const banner = sampleBanner({ isFallback: state.isFallback, hasBundle: !!state.bundle });
  const key = banner ? banner.key : null;
  if (key === lastBannerKey) return;
  lastBannerKey = key;
  const el = $('sample-banner');
  if (!el) return;
  if (!banner) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = banner.text;
}

// Card HTML is built in logic.mjs (citizenCardHtml / buildingCardHtml /
// tickerCardHtml), which escapes every feed-derived interpolation —
// bundle text is untrusted public-feed data (M2.15, the SE-6.1
// injection defect). app.js only assigns the built string.

function showCitizenCard(citizen) {
  const key = citizenKeyOf(citizen);
  state.selected = { kind: 'citizen', ref: key };
  // The inspector shows a standing place conflict in full (M3.04,
  // §3.5): both claims, their stamps, the held place, the disclosure.
  $('card').innerHTML = citizenCardHtml(citizen, placeLabel, conflictModel(state.placements, key, placeLabel), { bundle: state.bundle });
  wireFollowButtons();
  wirePageButtons();
  wireCardRecord(() => inspectorModel({
    type: 'citizen', bundle: state.bundle, citizen,
    placement: placementStates(state.placements, state.bundle).get(key) || null,
    placeLabel,
  }));
}

function showBuildingCard(node, work) {
  state.selected = { kind: 'building', ref: node.code };
  // The tier comes only from the work's own integrity field, via
  // logic.workTier — world.integritySource is never an input.
  $('card').innerHTML = buildingCardHtml(state.bundle, node, work);
  wireCardRecord(() => inspectorModel({ type: 'building', bundle: state.bundle, node, work }));
}

function showTickerCard(item) {
  state.selected = { kind: 'ticker', ref: item.text };
  $('card').innerHTML = tickerCardHtml(item, state.bundle, placeLabel);
  wireCardRecord(() => inspectorModel({ type: 'ticker', bundle: state.bundle, item }));
}

function wireFollowButtons() {
  document.querySelectorAll('[data-follow]').forEach((btn) => {
    btn.addEventListener('click', () => follow(btn.getAttribute('data-follow')));
  });
}

// ------------------------------------------- find & watch (M6)

// The provenance inspector (M6.06): every card's and ticker item's
// [Record] action lands here — one tap from the claim to how Portal
// knows it. The model is logic.inspectorModel; this is only the
// render (HTML built + escaped in logic.inspectorHtml, M2.15).
function showInspector(model) {
  const panel = $('inspector-panel');
  if (!panel) return;
  $('inspector').innerHTML = inspectorHtml(model);
  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** Bind the [Their page →] button a card builder just rendered
 *  (M6.05): the citizen page panel, assembled from the record. */
function wirePageButtons() {
  document.querySelectorAll('#card [data-page]').forEach((btn) => {
    btn.addEventListener('click', () => showCitizenPage(btn.getAttribute('data-page')));
  });
}

// ------------------------------------------- citizen page (M6.05)

/** The citizen page: badges (evidenced titles only), the Now panel
 *  (arrival wording only where a journey record bounds one), fast
 *  facts only where real, Their story cited entry by entry — every
 *  entry's [Record] opens its claim in the M6.06 inspector — and
 *  the private-life line. Model + HTML live in logic.mjs; this is
 *  only the render and the wiring. */
function showCitizenPage(key) {
  const citizen = state.bundle?.citizens.find((c) => citizenKeyOf(c) === key);
  const panel = $('citizen-page-panel');
  if (!citizen || !panel) return;
  const model = citizenPageModel(state.bundle, citizen, {
    journeysFeed: state.journeysFeed,
    episodesSource: state.conversations,
    growthBook: state.growthFeed,
  }, { placeLabel, placement: placementStates(state.placements, state.bundle).get(key) || null });
  $('citizen-page').innerHTML = citizenPageHtml(model);
  panel.hidden = false;
  document.querySelectorAll('#citizen-page [data-record-story]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const entry = model.story[Number(btn.getAttribute('data-record-story'))];
      if (entry) showInspector(inspectorModel(entry.claim));
    });
  });
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ------------------------------------------- frontier map (M6.11)

// The frontier fill-in map's geometry: a 10×10 grid of squares for
// the FOUND ground, inset in a parchment field — the parchment
// beyond the grid is the record's blank, drawn blank on purpose.
const FRONTIER_GEOM = { x0: 60, y0: 40, cell: 26, cols: 10, rows: 10 };

/** Draw the frontier grid from the current model: named squares
 *  full pastel fill, surveyed squares outline + hatch, found
 *  squares bare outline — no square carries detail beyond its
 *  record class. Canvas fillText is a safe text sink (M2.15). */
function drawFrontierCanvas() {
  const cv = $('frontier-canvas');
  const model = state.frontierModel;
  if (!cv || !model) return;
  const g = cv.getContext('2d');
  const { width: w, height: h } = cv;
  g.clearRect(0, 0, w, h);
  // Parchment: the unknown, drawn as blank parchment.
  g.fillStyle = '#efe3c2';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(120,85,40,0.4)';
  g.strokeRect(4.5, 4.5, w - 9, h - 9);
  const { x0, y0, cell, cols } = FRONTIER_GEOM;
  (model.grid || []).forEach((cls, i) => {
    const x = x0 + (i % cols) * cell;
    const y = y0 + Math.floor(i / cols) * cell;
    if (cls === 'named') {
      g.fillStyle = '#a9cf8f';
      g.fillRect(x, y, cell, cell);
    } else if (cls === 'surveyed') {
      g.save();
      g.beginPath(); g.rect(x, y, cell, cell); g.clip();
      g.strokeStyle = 'rgba(110,90,50,0.45)';
      g.lineWidth = 1;
      for (let d = -cell; d < cell * 2; d += 6) {
        g.beginPath(); g.moveTo(x + d, y + cell); g.lineTo(x + d + cell, y); g.stroke();
      }
      g.restore();
    }
    g.strokeStyle = 'rgba(90,70,40,0.55)';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
  });
  g.fillStyle = '#4a3f35';
  g.font = '700 12.5px Nunito, system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('the found ground, in the record’s proportions', x0 + (cols * cell) / 2, y0 - 14);
  g.fillText('beyond it, the parchment is blank — unknown, not empty', x0 + (cols * cell) / 2, y0 + FRONTIER_GEOM.rows * cell + 24);
}

/** Render the frontier panel from the current bundle + journeys
 *  feed (HTML built + escaped in logic.frontierMapHtml), then draw
 *  the parchment canvas and wire its taps. */
function renderFrontier() {
  const el = $('frontier');
  if (!el || !state.bundle) return;
  state.frontierModel = frontierModel(state.bundle, state.journeysFeed);
  el.innerHTML = frontierMapHtml(state.frontierModel);
  drawFrontierCanvas();
  const cv = $('frontier-canvas');
  if (cv) {
    cv.addEventListener('click', (ev) => {
      const rect = cv.getBoundingClientRect();
      const sx = (ev.clientX - rect.left) * (cv.width / rect.width);
      const sy = (ev.clientY - rect.top) * (cv.height / rect.height);
      const { x0, y0, cell, cols, rows } = FRONTIER_GEOM;
      const col = Math.floor((sx - x0) / cell);
      const row = Math.floor((sy - y0) / cell);
      const detail = $('frontier-detail');
      if (!detail) return;
      if (col < 0 || row < 0 || col >= cols || row >= rows) {
        detail.textContent = frontierTapModel(state.frontierModel, -1).text;
        return;
      }
      detail.textContent = frontierTapModel(state.frontierModel, row * cols + col).text;
    });
  }
  refreshFrontierHandoff();
}

/** Follow's hand-off at the wall (M6.11): a followed citizen the
 *  record places beyond the town plan continues on this map. */
function refreshFrontierHandoff() {
  const el = $('frontier-handoff');
  if (!el) return;
  const note = state.followed && state.bundle ? frontierFollowNote(state.bundle, stageLayout(), state.followed) : null;
  if (!note) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = note.text;
}

/** A frontier ticker item's [Take me there]: the frontier map is
 *  its "there" — scroll to it and say where the reader came from. */
function takeMeThereFrontier(item) {
  $('frontier-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const detail = $('frontier-detail');
  if (detail && item) detail.textContent = `From the news: “${item.text}” — that happened out on the frontier. This map is its “there”: the ground the record counts, filling in as it is found, surveyed, and named.`;
}

/** Bind the [Record] button a card builder just rendered. */
function wireCardRecord(modelFor) {
  const btn = document.querySelector('#card [data-record-card]');
  if (btn) btn.addEventListener('click', () => showInspector(modelFor()));
}

/** "Take me there" to a place (M6.01/M6.02): centre the stage
 *  camera on the place and open its card. The camera focus is a
 *  staging position — the figure-follow camera yields to it until
 *  a citizen is followed again. */
function takeMeTherePlace(code) {
  const node = resolveExactNode(stageLayout(), code);
  if (!node) return;
  state.followed = null;
  state.followMachine.exit();
  state.followState = null;
  $('return-chip').hidden = true;
  state.placeFocus = { x: node.x, y: node.y, code: node.code };
  $('stop-follow').hidden = true;
  $('follow-bar').hidden = true;
  const work = (state.bundle?.ember?.works || []).find((wk) => wk.code === node.code) || null;
  showBuildingCard(node, work);
  $('stage-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** "Take me there" to a citizen: follow them (the follow camera is
 *  the landing), with the stage in view. */
function takeMeThereCitizen(key) {
  follow(key);
  $('stage-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// World-book bookkeeping (M6.06): when a LIVE bundle's book differs
// from the book this page was reading, the D6 reset banner shows —
// the old book stays readable, nobody is carried across by name.
// Sample data never runs this: a recording cannot reset the world.
function applyBookkeeping(bundle) {
  const model = resetBannerModel(state.bookId, bundle);
  if (model) {
    const el = $('reset-banner');
    if (el) {
      el.innerHTML = resetBannerHtml(model);
      el.hidden = false;
    }
  }
  if (bundle?.world?.bookId) state.bookId = bundle.world.bookId;
}

// The growth book (M6.08): series charts with their value-list twin
// and the firsts wall, built + escaped in logic.growthBookHtml. A null
// feed renders the honest not-begun wording from the same builder.
function renderGrowthBook() {
  const el = $('growth-book');
  if (el) el.innerHTML = growthBookHtml(state.growthFeed);
}

// The Chronicle + calendar (M6.09/M6.10) and the quiet page (M6.13):
// all HTML built + escaped in logic.mjs builders. The quiet page
// shows only against the LIVE bundle (never over the demo or the
// sample fallback) and only while nobody awake is evidenced.
function renderChronicle() {
  const book = state.chronicleFeed;
  const el = $('chronicle-book');
  if (el) el.innerHTML = chronicleBookHtml(book, { storedSeq: state.visitSeq, currentSeq: state.bundle?.bundleSeq ?? null });
  const cal = $('calendar');
  if (cal) cal.innerHTML = calendarHtml(book, { nowUtc: state.bundle?.newestFetchUtc ?? null });
  const q = $('quiet-panel');
  if (q) {
    const show = !state.isFallback && !state.demo && quietState(state.bundle).quiet;
    q.hidden = !show;
    if (show) q.innerHTML = quietPageHtml(state.bundle);
  }
}

function renderPanels() {
  const b = state.bundle;
  if (!b) return;
  renderChronicle();
  // Ticker (list HTML built + escaped in logic.tickerListHtml, M2.15).
  // Placement events from the latest live bundle (M3.04) ride above
  // the record's own news as Movement items. M6.01: every item
  // carries its chip and its actions — [Take me there] where a
  // landing resolves from the item's structured fields, [Record]
  // always, into the M6.06 inspector.
  const nameFor = (key) => b.citizens.find((c) => citizenKeyOf(c) === key)?.name || key;
  const placementsNow = placementStates(state.placements, b);
  const movementLinesAll = placementEventLines(state.placementEvents, nameFor, placeLabel);
  // X6 ticker scope (M6.15): display only. The movement lines are
  // filtered here (arrivals stay under civic-&-arrivals); the news
  // items are filtered inside tickerListHtml under the same rule,
  // keeping their bundle indices. The scene list below always reads
  // the UNSCOPED lines — a display scope never shrinks the record.
  const movementLines = state.display.ticker === 'civic-arrivals'
    ? movementLinesAll.filter((l) => tickerScopeAllows(l, 'civic-arrivals'))
    : movementLinesAll;
  $('ticker').innerHTML = tickerListHtml(b, movementLines, { layout: stageLayout(), placements: placementsNow, frontier: true, tickerScope: state.display.ticker });
  // X2 (M6.15): the scene in words — the parallel list over the
  // same WorldData, rebuilt per bundle, plus the live region's
  // one-line summary for screen readers.
  const sceneListEl = $('scene-list');
  if (sceneListEl) {
    const model = sceneListModel(b, stageLayout(), state.placements, placeLabel, { settings: state.display, events: movementLinesAll });
    sceneListEl.innerHTML = sceneListHtml(model);
    const live = $('scene-live');
    if (live && live.textContent !== model.summary) live.textContent = model.summary;
  }
  // M6.12: the first-visit overlay is offered once, when the first
  // bundle has rendered — over the live diorama, never instead of it.
  if (!state.welcomeChecked) {
    state.welcomeChecked = true;
    if (!welcomeSeen(window.localStorage)) showWelcome();
  }
  document.querySelectorAll('[data-ticker]').forEach((li) => {
    li.addEventListener('click', () => showTickerCard(b.ticker[Number(li.getAttribute('data-ticker'))]));
  });
  document.querySelectorAll('[data-there-item]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const landing = tickerLanding(b.ticker[Number(btn.getAttribute('data-there-item'))], b, stageLayout());
      if (!landing) return;
      if (landing.type === 'place') takeMeTherePlace(landing.code);
      else takeMeThereCitizen(landing.key);
    });
  });
  document.querySelectorAll('[data-there-frontier]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const item = b.ticker[Number(btn.getAttribute('data-there-frontier'))];
      if (item && frontierLanding(item, b, stageLayout())) takeMeThereFrontier(item);
    });
  });
  document.querySelectorAll('[data-record-item]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      showInspector(inspectorModel({ type: 'ticker', bundle: b, item: b.ticker[Number(btn.getAttribute('data-record-item'))] }));
    });
  });
  document.querySelectorAll('[data-there-move]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const landing = movementLanding(movementLines[Number(btn.getAttribute('data-there-move'))], b, placementsNow);
      if (landing) takeMeThereCitizen(landing.key);
    });
  });
  document.querySelectorAll('[data-record-move]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      showInspector(inspectorModel({ type: 'movement', bundle: b, line: movementLines[Number(btn.getAttribute('data-record-move'))] }));
    });
  });
  // Roster — placement states label exits and conflicts (M3.04)
  // instead of citizens silently vanishing or jumping. The note
  // keeps the population as three distinct numbers (M6.04): joined,
  // nameable, placed — never one bare number.
  const counts = populationCounts(b);
  $('roster-note').textContent = `${counts.nameable} citizens Portal can name in this bundle${counts.joined !== null ? `, of ${counts.joined} who have joined the world in all` : ''}. ${counts.placed} of them have a place in the public feeds Portal reads right now; the rest are listed without a figure, because Portal does not place people it has no evidence for.`;
  $('roster').innerHTML = rosterListHtml(b, placeLabel, placementsNow);
  document.querySelectorAll('[data-watch-card]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = b.citizens.find((x) => citizenKeyOf(x) === btn.getAttribute('data-watch-card'));
      if (c) showCitizenCard(c);
    });
  });
  // Building directory (M6.02): every place on the stage plan, who
  // the record places there, and a [Take me there] per row.
  const dirEl = $('directory');
  if (dirEl) {
    dirEl.innerHTML = directoryListHtml(directoryModel(b, stageLayout()));
    dirEl.querySelectorAll('[data-there-place]').forEach((btn) => {
      btn.addEventListener('click', () => takeMeTherePlace(btn.getAttribute('data-there-place')));
    });
  }
  // Portrait strip (M6.02): at most seven faces, office holders
  // first — one tap from a face to a following camera.
  const stripEl = $('portrait-strip');
  if (stripEl) stripEl.innerHTML = portraitStripHtml(portraitStripModel(b, stageLayout()));
  wireFollowButtons();
  // Growth — the one innerHTML template left in this file: its keys are
  // hardcoded below and its values are formatCount numbers or a static
  // fallback, so nothing feed-derived is interpolated (M2.15 census).
  const c = b.counters || {};
  // The population rows are the three distinct counts (M6.08, via the
  // populationCounts model the roster note already uses): joined is
  // the record's own count, nameable is this bundle's citizen list,
  // placed is the evidenced subset — never one bare number, and never
  // the joined count wearing the nameable label.
  const rows = [
    ['Regions discovered', c.regionsDiscovered], ['Regions surveyed', c.regionsSurveyed],
    ['Regions named', c.regionsNamed], ['College deposits', c.collegeDeposits],
    ['Town treasury (Bennies)', c.treasury],
    ['Citizens who have joined (the record’s own count)', counts.joined],
    ['Citizens Portal can name', counts.nameable],
    ['Named citizens with an evidenced place', counts.placed],
  ];
  $('growth').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${typeof v === 'number' ? formatCount(v) : 'not in the record'}</dd>`).join('');
  // Now line (M6.03) — one evidenced sentence from the pure model:
  // everyone the record places right now (asleep included — the old
  // inline form called a fully-asleep town "nobody", a false clause
  // the model exists to end). Clause counts ride the model for
  // clause-by-clause verification against the bundle.
  $('now-line').textContent = nowLineModel(b).text;
  // Rhythm header (M6.14): one state, with its basis, and the
  // recorded weather captioned as such — built + escaped in logic.
  const rhythmEl = $('rhythm-header');
  if (rhythmEl) {
    const rm = rhythmModel(b);
    rhythmEl.innerHTML = rhythmHeaderHtml(rm);
    rhythmEl.classList.toggle('rhythm-dusk', rm.tone === 'dusk');
  }
  // Frontier fill-in map (M6.11): counters, sentence legend, route
  // sequences, and the Follow hand-off note.
  renderFrontier();
}

// ------------------------------------------- episodes / talk (M4)

// Talk-from-record: conversations are shown from the recorded words
// only. The panel lists derived episodes (speakers-only participants,
// utterance-instant presence, the episode disclosure as its header);
// selecting one plays its utterances back one by one, in recorded
// order, verbatim — on the stage at the place's position and in the
// transcript below — with the disclosure as the panel header
// throughout. Act sequences list recorded acts under their own
// acts-only disclosure. Nothing here paraphrases, completes, or
// extends a single recorded word.

function renderEpisodes() {
  const panel = $('episodes-panel');
  const model = episodeListModel(state.conversations, (code) => placeLabel(code));
  if (!model) { panel.hidden = true; return; }
  panel.hidden = false;
  // The episodes share one disclosure string; it heads the panel.
  $('episodes-disclosure').textContent = model.episodes[0]?.disclosure || '';
  const list = $('episodes-list');
  list.replaceChildren(...model.episodes.map((ep) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'episode-row';
    btn.addEventListener('click', () => startTalk(ep.key));
    const title = document.createElement('span');
    title.className = 'episode-place';
    title.textContent = ep.corroborated ? `${ep.placeLabel} ✓ corroborated in the record` : ep.placeLabel;
    const meta = document.createElement('span');
    meta.className = 'episode-meta';
    // Bundle episodes are summaries: their words live in the episodes
    // feed. The row promises playback only when the words resolve.
    const playable = !!resolveTalkEpisode(state.conversations, state.episodesFeed, ep.key);
    meta.textContent = `${ep.participants.join(', ')} — ${ep.utteranceCount} utterance${ep.utteranceCount === 1 ? '' : 's'}, ${relativeTime(ep.firstUtc)} to ${relativeTime(ep.lastUtc)}. ${playable ? 'Play the recorded words.' : 'The recorded words are not in this bundle.'}`;
    btn.append(title, meta);
    li.append(btn);
    return li;
  }));
  if (!model.episodes.length) {
    const li = document.createElement('li');
    li.textContent = 'No conversations in the record yet.';
    list.append(li);
  }
  // Act sequences: a simple list under the acts-only disclosure.
  const acts = actListModel(state.conversations);
  const block = $('acts-block');
  if (acts && acts.sequences.length) {
    block.hidden = false;
    $('acts-disclosure').textContent = acts.sequences[0].disclosure;
    $('acts-list').replaceChildren(...acts.sequences.map((s) => {
      const li = document.createElement('li');
      const head = document.createElement('div');
      head.textContent = `${s.actor} — ${s.count} recorded acts, ${relativeTime(s.firstUtc)} to ${relativeTime(s.lastUtc)}.`;
      const sub = document.createElement('ul');
      sub.className = 'acts-sub';
      sub.replaceChildren(...s.acts.map((a) => {
        const item = document.createElement('li');
        item.textContent = `${relativeTime(a.at)} — ${a.phrase}`;
        return item;
      }));
      li.append(head, sub);
      return li;
    }));
  } else {
    block.hidden = true;
  }
}

function startTalk(key) {
  stopTalk();
  // The listed episode may be a wordless bundle summary; its recorded
  // words resolve from the episodes feed's twin (same place + stamp).
  const episode = resolveTalkEpisode(state.conversations, state.episodesFeed, key);
  const model = talkPlaybackModel(episode);
  if (!model) return;
  // M5.01: playback runs on the talk system's scheduler — the one
  // shared schedule (logic.scheduleTalkScene): at least 4 s per
  // utterance at the mandated pacing. This panel REPLAYS a recorded
  // episode, so it schedules in recording mode (M5.07 ruling,
  // 2026-11-03): the scene plays in full, however long it runs —
  // the 90 s cap and its summary pointer govern live scenes only,
  // and a recording produces no pointer. A wordless episode
  // schedules to null and nothing plays.
  const schedule = scheduleTalkScene(episode, { mode: 'recording' });
  if (!schedule) return;
  // Surface consumption (M5.03/M5.06): staging, figure treatments
  // and stage positions are captured ONCE, here, and every talk
  // render below resolves its act through the ONE consumption
  // model (logic.talkActPresentation) — the panel and the stage
  // present the same act because both read this same state.
  const gridByName = {};
  const positionsNow = currentPositions();
  for (const c of state.bundle?.citizens || []) {
    const gp = positionsNow.get(citizenKeyOf(c));
    if (gp && c.name) gridByName[c.name] = { x: gp.x, y: gp.y };
  }
  const staging = conversationStaging(episode, gridByName);
  const placeStatesNow = placementStates(state.placements, state.bundle);
  const treatments = {};
  for (const c of state.bundle?.citizens || []) {
    if (!c.name) continue;
    const t = figureStyle(c, placeStatesNow.get(citizenKeyOf(c)) || null).treatment;
    if (t && t !== 'normal') treatments[c.name] = t;
  }
  state.talk = {
    model, schedule, episode, staging, gridByName, treatments,
    shown: 0, preIndex: 0, timer: null, preTimer: null, rate: 1,
  };
  $('talk-area').hidden = false;
  $('talk-summary').hidden = true;
  renderTalk();
  armTalkTimers();
}

// The consumption model for one scheduled event of the playing
// scene, from the state startTalk captured. Null when the index
// names no event.
function talkPresAt(index) {
  const talk = state.talk;
  if (!talk) return null;
  const ev = talk.schedule.events[index];
  if (!ev) return null;
  return talkActPresentation({
    episode: talk.episode, event: ev, positions: talk.gridByName,
    placeLabel: (code) => placeLabel(code), rate: talk.rate || 1,
    treatments: talk.treatments,
    // A RECORDING: this panel replays a recorded episode, so the
    // record governs who was awake at the act (VER-D22) — the
    // treatments captured above are live-snapshot inputs, and the
    // model applies the ruling to them.
    mode: 'recording',
  });
}

// Playback timing under the pre-act rule (M5.06): an act's head
// icon lands BEFORE the act — the first utterance waits out its
// icon lead before it is revealed, and each later act's icon is
// raised during the current utterance, one lead before its start
// (the lead is the model's own: scaled by rate, never below the
// floor, never skipped). The utterance itself still holds for
// exactly its scheduled duration.
function armTalkTimers() {
  const talk = state.talk;
  if (!talk) return;
  if (talk.timer) clearTimeout(talk.timer);
  if (talk.preTimer) clearTimeout(talk.preTimer);
  talk.timer = null; talk.preTimer = null;
  if (talk.shown === 0) {
    const pres = talkPresAt(0);
    talk.timer = setTimeout(revealNextUtterance, pres?.speaker?.presentation?.iconLeadMs ?? 1000);
    return;
  }
  const current = talk.schedule.events[talk.shown - 1];
  const nextIndex = talk.shown;
  if (!current || nextIndex >= talk.schedule.events.length) return;
  const pres = talkPresAt(nextIndex);
  const lead = pres?.speaker?.presentation?.iconLeadMs ?? 1000;
  const dur = current.endMs - current.startMs;
  talk.preTimer = setTimeout(() => {
    if (state.talk !== talk) return;
    talk.preIndex = nextIndex;
    renderTalk();
  }, Math.max(0, dur - lead));
  talk.timer = setTimeout(revealNextUtterance, dur);
}

function revealNextUtterance() {
  const talk = state.talk;
  if (!talk) return;
  talk.shown += 1;
  talk.preIndex = null;
  renderTalk();
  armTalkTimers();
}

function renderTalk() {
  const talk = state.talk;
  if (!talk) return;
  const { model, shown } = talk;
  // The episode's disclosure is the panel header throughout playback.
  $('talk-disclosure').textContent = model.disclosure;
  $('talk-status').textContent = shown === 0
    ? `At ${placeLabel(model.placeCode)} — ${talk.schedule.events.length} utterance${talk.schedule.events.length === 1 ? '' : 's'}, in the order they were spoken. The first act's head icon is up; its words follow.`
    : `At ${placeLabel(model.placeCode)} — utterance ${shown} of ${talk.schedule.events.length}, in the order they were spoken.`;
  $('talk-bubbles').replaceChildren(...talk.schedule.events.slice(0, shown).map((step) => {
    // OM15-C4: the recorded words render FENCED — framed and
    // labelled as quoted record speech (logic.fencedSpeech), never
    // as Portal's own voice. The fence is presentation only: the
    // words element still receives the step's text, verbatim,
    // through textContent.
    const fenced = fencedSpeech(step);
    // M5.02 (Design K1): the bubble's header is the kit's
    // "[Name], [time]:" — the speaker and the utterance's own
    // recorded clock time, from the same shared model.
    const kit = bubbleKit(step);
    const bubble = document.createElement('div');
    bubble.className = `bubble ${fenced.frameClass}`;
    const head = document.createElement('div');
    head.className = 'bubble-head';
    const who = document.createElement('span');
    who.className = 'bubble-who';
    who.textContent = kit.header;
    const tag = document.createElement('span');
    tag.className = 'speech-fence-tag';
    tag.textContent = `${fenced.quote} ${fenced.label}`;
    head.append(who, tag);
    const words = document.createElement('p');
    words.className = 'bubble-words';
    words.textContent = fenced.text; // the recorded words, verbatim
    bubble.append(head, words);
    return bubble;
  }));
  renderTalkReadability();
  // M5.01: past the 90 s scene cap a LIVE schedule summarises
  // instead of playing on, and this line carries the pointer's
  // counts only — who spoke how many more times — never their
  // words: a summary that quoted or paraphrased speech would
  // break the quotation discipline (M5.13). The panel's own
  // schedules are recordings (startTalk) and never carry a
  // summary under the M5.07 ruling, so this branch stands for a
  // live-mode schedule, which this surface does not build; it is
  // kept honest rather than deleted, and stays hidden tonight.
  const summaryEl = $('talk-summary');
  const summary = talk.schedule.summary;
  if (summary && shown >= talk.schedule.events.length) {
    summaryEl.hidden = false;
    summaryEl.textContent = `Playback stops here — this conversation ran past the talk system's 90-second scene cap. The remaining ${summary.remainingCount} recorded utterances are summarised, not played: ${summary.bySpeaker.map((s) => `${s.name} spoke ${s.count} more time${s.count === 1 ? '' : 's'}`).join('; ')}. Their words stay in the record, unquoted here.`;
  } else {
    summaryEl.hidden = true;
  }
}

function stopTalk() {
  if (state.talk?.timer) clearTimeout(state.talk.timer);
  if (state.talk?.preTimer) clearTimeout(state.talk.preTimer);
  state.talk = null;
  const area = $('talk-area');
  if (area) area.hidden = true;
  const strip = $('talk-readability');
  if (strip) { strip.hidden = true; strip.replaceChildren(); }
}
$('talk-stop').addEventListener('click', stopTalk);

// The talk area's readability strip: the act being presented — or,
// during the pre-act lead, the act ABOUT to be presented — rendered
// from the consumption model and nothing else: for the speaker and
// each evidenced listener, the head icon (glyph + word), the tag
// line where the act carries one, and the caption exactly as the
// model returns it. When the model suppresses the act (a figure
// treatment outranks the performance — see talkActPresentation),
// the strip says so in the model's own resolution words; the
// recorded words themselves stay in the transcript above, which is
// the record, not a performance.
function renderTalkReadability() {
  const box = $('talk-readability');
  if (!box) return;
  const talk = state.talk;
  const index = talk ? (talk.preIndex ?? (talk.shown > 0 ? talk.shown - 1 : null)) : null;
  const pres = index != null ? talkPresAt(index) : null;
  if (!pres) { box.hidden = true; box.replaceChildren(); return; }
  const phase = document.createElement('span');
  phase.className = 'talk-act-phase';
  phase.textContent = talk.preIndex != null && talk.preIndex >= talk.shown ? 'Before the act' : 'This act';
  const rows = [];
  if (pres.suppressed) {
    const row = document.createElement('div');
    row.className = 'talk-act-row';
    const note = document.createElement('span');
    note.className = 'talk-act-caption';
    note.textContent = pres.suppressedBy
      ? `${pres.suppressedBy.name} ${pres.suppressedBy.resolution}.`
      : 'This act is not staged on the figures.';
    row.append(phase, note);
    rows.push(row);
  } else {
    const rowFor = (fig) => {
      if (!fig || !fig.presentation) return null;
      const p = fig.presentation;
      const row = document.createElement('div');
      row.className = 'talk-act-row';
      const glyph = document.createElement('span');
      glyph.className = 'talk-act-glyph';
      glyph.textContent = p.icon ? p.icon.glyph : '';
      const word = document.createElement('span');
      word.className = 'talk-act-word';
      word.textContent = p.icon ? p.icon.word : '';
      row.append(glyph, word);
      if (p.tag) {
        const tag = document.createElement('span');
        tag.className = 'talk-act-tag';
        tag.textContent = p.tag;
        row.append(tag);
      }
      const caption = document.createElement('span');
      caption.className = 'talk-act-caption';
      caption.textContent = p.caption || '';
      row.append(caption);
      return row;
    };
    const speakerRow = rowFor(pres.speaker);
    if (speakerRow) { speakerRow.prepend(phase); rows.push(speakerRow); }
    for (const listener of pres.listeners) {
      if (listener.blocked) continue; // a blocked listener is not staged as one — never replaced
      const r = rowFor(listener);
      if (r) rows.push(r);
    }
  }
  box.replaceChildren(...rows);
  box.hidden = rows.length === 0;
}

// ------------------------------------------------------------ follow

function follow(key) {
  state.followed = key;
  state.placeFocus = null; // a followed citizen owns the camera (M6.02)
  const citizen = state.bundle?.citizens.find((c) => citizenKeyOf(c) === key) || null;
  // M6.07: engaging is the machine's Engaged state. The bar's words
  // come from logic's wording table — including the waiting-stale
  // words when the citizen stands under a place-conflict HOLD
  // (M3.04): the figure is held, and the bar says at which place the
  // last record put them, never a guessed one. The full conflict
  // detail lives on the card and in the inspector, as before.
  const view = state.followMachine.engage(citizen, {
    key,
    name: state.demo?.key === key ? state.demo.name : undefined,
    caption: citizen ? citizenCaption(citizen, placeLabel(citizen.placeCode)) : undefined,
    placeLabel: citizen ? placeLabel(citizen.placeCode) : null,
    conflict: citizen ? conflictModel(state.placements, key, placeLabel) : null,
    beyondWall: citizen && state.bundle ? !!frontierFollowNote(state.bundle, stageLayout(), key) : false,
  });
  state.followState = 'engaged';
  $('stop-follow').hidden = false;
  $('return-chip').hidden = true;
  const bar = $('follow-bar');
  bar.hidden = false;
  if (citizen && view.bar) bar.textContent = view.bar;
  else if (!citizen) bar.textContent = `Following ${state.demo?.name || 'the demo figure'}.`;
  if (citizen) showCitizenCard(citizen);
  refreshFrontierHandoff();
}

/** The machine's Exited state: the camera stays put, and the return
 *  chip offers the ≤1-click re-engage (UX §3.1). Resumption is the
 *  playback layer's catch-up — re-engaging never moves the figure. */
function exitFollow() {
  const view = state.followMachine.exit();
  state.followed = null;
  state.followState = 'exited';
  state.placeFocus = null;
  state.demo = null;
  hideSummary();
  $('stop-follow').hidden = true;
  $('follow-bar').hidden = true;
  const chip = $('return-chip');
  if (view.returnChip && state.followMachine.lastExited) {
    chip.textContent = view.returnChip;
    chip.hidden = false;
  } else {
    chip.hidden = true;
  }
  refreshFrontierHandoff();
  updateBadge();
}
$('stop-follow').addEventListener('click', exitFollow);
$('return-chip').addEventListener('click', () => {
  const last = state.followMachine.lastExited;
  if (last) follow(last.key);
});

/** The machine's per-frame refresh: derive the followed citizen's
 *  current view (state + bar words) from the playback layer's facts
 *  and write the bar only when its words change. */
function refreshFollowBar(positions) {
  if (!state.followed) return;
  const key = state.followed;
  const citizen = state.bundle?.citizens.find((c) => citizenKeyOf(c) === key) || null;
  const name = citizen?.name || state.demo?.name || 'A citizen';
  const gp = positions.get(key);
  let walkingToLabel = null;
  let catchingUp = null;
  let caption = null;
  if (state.demo && state.demo.key === key && gp) {
    if (gp.between) {
      walkingToLabel = placeLabel(gp.between[1]);
      catchingUp = state.demo.replay ? 'walk' : null;
    } else {
      caption = `${name} has arrived at ${placeLabel(state.demo.journey.path[state.demo.journey.path.length - 1])}.`;
    }
  } else if (!state.demo && state.livePlans?.has(key)) {
    const tick = worldTickAt(state.journeysFeed, nowMs());
    const plan = tick === null ? null : planAt(state.livePlans.get(key), tick);
    const fragment = plan && gp ? liveJourneyCaption(plan, tick, placeLabel) : null;
    if (fragment && citizen) {
      caption = `${citizen.name} ${fragment}`;
      if (gp.between) walkingToLabel = placeLabel(gp.between[1]);
    }
  }
  const view = state.followMachine.update({
    citizen, name, caption, walkingToLabel, catchingUp,
    placeLabel: citizen ? placeLabel(citizen.placeCode) : null,
    conflict: citizen ? conflictModel(state.placements, key, placeLabel) : null,
    beyondWall: citizen && state.bundle ? !!frontierFollowNote(state.bundle, stageLayout(), key) : false,
  });
  state.followState = view.state;
  const bar = $('follow-bar');
  if (view.bar && bar.textContent !== view.bar) {
    bar.hidden = false;
    bar.textContent = view.bar;
  }
}

// ------------------------------------------------- welcome (M6.12)

/** The first-visit card, over the live dimmed diorama. Both action
 *  buttons work from inside it and count in the §3.1 budgets:
 *  [Follow the Mayor] is click 1 of the mayor's ≤2; [See who is
 *  awake] lands on the portrait strip. Any dismissal marks the
 *  browser as having seen it and leaves the one-time hint by the
 *  strip. Re-openable any time from About's "New here?" button. */
function showWelcome() {
  const el = $('welcome-overlay');
  if (!el) return;
  el.innerHTML = welcomeOverlayHtml();
  el.hidden = false;
  el.querySelector('[data-welcome-mayor]')?.addEventListener('click', () => {
    dismissWelcome();
    const key = state.bundle ? mayorKeyOf(state.bundle) : null;
    if (key) {
      follow(key);
      $('stage-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  el.querySelector('[data-welcome-awake]')?.addEventListener('click', () => {
    dismissWelcome();
    $('portrait-strip-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  el.querySelector('[data-welcome-close]')?.addEventListener('click', dismissWelcome);
}

function dismissWelcome() {
  const el = $('welcome-overlay');
  if (el) el.hidden = true;
  markWelcomeSeen(window.localStorage);
  const hint = $('strip-hint');
  if (hint && !hint.textContent) {
    hint.textContent = WELCOME_DISMISS_HINT;
    hint.hidden = false;
  }
}
$('new-here')?.addEventListener('click', showWelcome);

// About's credit roll (M6.12): static data from logic's table —
// rendered once, it has no feed input.
{ const el = $('attributions'); if (el) el.innerHTML = attributionsHtml(); }

// ------------------------------------------- display panel (M6.15 X6)

/** The Display panel's four toggles, as labelled native selects —
 *  every option is display only, and the change re-renders the
 *  panels (ticker scope, scene-list trim) and the stage (figure
 *  richness, building trim, camera motion) from the same bundle. */
function renderDisplayPanel() {
  const el = $('display-panel');
  if (!el) return;
  el.innerHTML = displayPanelHtml(state.display);
  el.querySelectorAll('[data-display]').forEach((sel) => {
    sel.addEventListener('change', () => {
      state.display = normaliseDisplaySettings({ ...state.display, [sel.getAttribute('data-display')]: sel.value });
      renderPanels();
    });
  });
}
renderDisplayPanel();

// ------------------------------------------------ keyboard (M6.15 X1)
//
// Everything the mouse does, in visible order (UX §8). Native
// controls carry Tab/Enter/Space by construction; these keys add
// the shortcuts, and each also exists as a button: F = Stop
// following / the return chip, [ and ] = the Previous/Next citizen
// buttons in the controls row, C = the Citizens find button's
// destination, Esc = the overlay's Close, then the card's close,
// then Stop following.

function clearCard() {
  state.selected = null;
  $('card').innerHTML = '<p class="soft">Nothing picked yet. Tap a citizen, a building, or a news item.</p>';
}

document.addEventListener('keydown', (ev) => {
  const tag = ev.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (ev.key === 'Escape') {
    const overlay = $('welcome-overlay');
    if (overlay && !overlay.hidden) { dismissWelcome(); return; }
    if (state.selected) { clearCard(); return; }
    if (state.followed) { exitFollow(); }
    return;
  }
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (k === 'c') {
    $('roster-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('roster-panel')?.querySelector('button')?.focus();
  } else if (k === 'f') {
    if (state.followed) exitFollow();
    else {
      const last = state.followMachine.lastExited;
      if (last) follow(last.key);
    }
  } else if (ev.key === '[' || ev.key === ']') {
    if (!state.bundle) return;
    const keys = [...heldCitizenPositions(state.bundle, stageLayout(), state.placements).keys()];
    const next = cycleFollowKey(keys, state.followed, ev.key === ']' ? 1 : -1);
    if (next) follow(next);
  }
});
$('prev-citizen')?.addEventListener('click', () => {
  if (!state.bundle) return;
  const keys = [...heldCitizenPositions(state.bundle, stageLayout(), state.placements).keys()];
  const next = cycleFollowKey(keys, state.followed, -1);
  if (next) follow(next);
});
$('next-citizen')?.addEventListener('click', () => {
  if (!state.bundle) return;
  const keys = [...heldCitizenPositions(state.bundle, stageLayout(), state.placements).keys()];
  const next = cycleFollowKey(keys, state.followed, 1);
  if (next) follow(next);
});

// ------------------------------------------- path summary (§3.4)

// After an absence over an hour the missed steps are LISTED, not
// played: the "while you were away" panel carries the journey's
// scheduled facts and the figure stands at its evidenced place (the
// frame loop puts it there — see frame()). The route stays drawn on
// the stage while the summary is up: the summary IS the continuity.
function showSummary(d, plan) {
  const model = summaryPanel(plan, d.name, placeLabel);
  state.summary = { journey: d.journey };
  const panel = $('away-panel');
  if (!model) { panel.hidden = true; return; }
  $('away-heading').textContent = model.heading;
  $('away-intro').textContent = model.intro;
  $('away-steps').replaceChildren(...model.lines.map((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    return li;
  }));
  $('away-closing').textContent = model.closing;
  panel.hidden = false;
}

function hideSummary() {
  state.summary = null;
  const panel = $('away-panel');
  if (panel) panel.hidden = true;
}

// --------------------------------------------------------- demo play

async function demoPath() {
  const res = await fetchJson('../fixtures/demo-journey.json');
  if (res.ok && Array.isArray(res.data?.path) && res.data.path.length >= 2) {
    // The shared fixture's ticksPerStep is a per-step array, which the
    // real engine accepts verbatim. Its recordedWindowUtc (M4.19) is
    // carried through only when both stamps parse — the REPLAY
    // cluster shows the range the fixture declares, or none.
    const w = res.data.recordedWindowUtc;
    const range = w && Number.isFinite(Date.parse(w.startUtc || '')) && Number.isFinite(Date.parse(w.endUtc || ''))
      ? { startUtc: w.startUtc, endUtc: w.endUtc } : null;
    return { handle: res.data.handle || 'demo-figure', name: res.data.name || null, path: res.data.path, ticksPerStep: res.data.ticksPerStep || DEMO_TICKS_PER_STEP, startTick: res.data.startTick || 0, range };
  }
  return { handle: 'demo-figure', name: 'Atlas Meridian', path: DEMO_PATH, ticksPerStep: DEMO_TICKS_PER_STEP, startTick: 0, range: null };
}

$('play-demo').addEventListener('click', async () => {
  hideSummary();
  const spec = await demoPath();
  const journey = planJourney({ handle: spec.handle, path: spec.path, startTick: spec.startTick, ticksPerStep: spec.ticksPerStep });
  const start = journey.startTick;
  // The demo figure is the named citizen when the bundle carries them:
  // follow and draw under their PORTAL-KEY; otherwise under a demo key.
  const citizen = spec.name ? state.bundle?.citizens.find((c) => c.name === spec.name) : null;
  const key = citizen ? citizenKeyOf(citizen) : `demo:${spec.handle}`;
  state.demo = { journey, key, name: spec.name || citizen?.name || 'A citizen', tick: start, target: start, replay: false, playing: true, lastTs: performance.now(), range: spec.range || null };
  follow(key);
  updateBadge();
});

// ------------------------------------------------------------- stage

const canvas = $('stage');
const ctx = canvas.getContext('2d');
const TW = 62, TH = 31;

// Camera: keep the followed figure centred by shifting the whole
// projection so the followed grid position maps near canvas centre.
function computeCamOffset(focus) {
  if (!focus) return { x: 0, y: 0 };
  const w = canvas.width, h = canvas.height;
  const raw = isoRaw(focus.x, focus.y);
  return { x: w / 2 - raw.x, y: h / 2 - raw.y };
}
// View fit: scale/centre the projection so every layout node is on canvas,
// whatever grid coordinates the shared layout uses.
let viewFit = null;
function computeViewFit() {
  const nodes = stageLayout().nodes || [];
  if (!nodes.length) {
    viewFit = { scale: 1, ox: canvas.width / 2, oy: 70 };
    return;
  }
  const pts = nodes.map((n) => ({ x: (n.x - n.y) * (TW / 2), y: (n.x + n.y) * (TH / 2) }));
  const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  const scale = Math.min(1.2, (canvas.width - 90) / spanX, (canvas.height - 150) / spanY);
  viewFit = {
    scale,
    ox: canvas.width / 2 - ((minX + maxX) / 2) * scale,
    oy: 70 - minY * scale,
  };
}
function isoRaw(x, y) {
  if (!viewFit) computeViewFit();
  return { x: viewFit.ox + (x - y) * (TW / 2) * viewFit.scale, y: viewFit.oy + (x + y) * (TH / 2) * viewFit.scale };
}

function currentPositions() {
  // PORTAL-KEY -> {x, y} grid position. Positions are HELD positions
  // (logic.heldCitizenPositions, M3.04): under a place conflict the
  // figure stays at the last unconflicted place, and a citizen the
  // record stopped placing is not drawn — never a guessed jump.
  const pos = heldCitizenPositions(state.bundle, stageLayout(), state.placements);
  // Live journeys (M3.06): a citizen with a reconstructed journey is
  // placed by the world clock — 1 tick per 30 s (live-pacing) —
  // walking the graph between their evidenced places instead of
  // jumping when a new bundle lands. Citizens under a standing
  // place-conflict are never walked (the HOLD governs), and sample
  // data is a recording: the live record's journeys do not drive it.
  if (state.livePlans && !state.isFallback) {
    const heldKeys = new Set();
    for (const [key, s] of placementStates(state.placements, state.bundle)) {
      if (s?.conflict) heldKeys.add(key);
    }
    const live = livePositions({
      feed: state.journeysFeed, plans: state.livePlans, layout: stageLayout(),
      base: pos, heldKeys, nowMsValue: nowMs(),
    });
    for (const [key, p] of live) pos.set(key, p);
  }
  if (state.demo) {
    // While a demo journey exists (playing or finished), the figure stands
    // where playback put it — falling back to the bundle place the moment
    // the demo ends would teleport the figure, which Portal never does.
    const p = positionAt(state.demo.journey, stageLayout(), state.demo.tick);
    pos.set(state.demo.key, { x: p.x, y: p.y, between: p.between });
  }
  return pos;
}

function drawStage() {
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#cdeac0';
  ctx.fillRect(0, 0, w, h);
  const positions = currentPositions();
  // Camera focus: a followed figure first; else a "Take me there"
  // place landing (M6.01/M6.02) until a citizen is followed again.
  let focus = null;
  if (state.followed && positions.has(state.followed)) focus = positions.get(state.followed);
  else if (state.placeFocus) focus = state.placeFocus;
  const target = computeCamOffset(focus);
  if (!state.camOffset) state.camOffset = { x: 0, y: 0 };
  // X6 Motion (M6.15): Calmer snaps the camera — the glide is the
  // only motion this surface adds of its own, and Calmer removes it.
  const ease = state.display.motion === 'calmer' ? 1 : 0.12;
  state.camOffset.x += (target.x - state.camOffset.x) * ease;
  state.camOffset.y += (target.y - state.camOffset.y) * ease;
  const P = (x, y) => { const r = isoRaw(x, y); return { x: r.x + state.camOffset.x, y: r.y + state.camOffset.y }; };

  const stage = stageLayout();
  // Streets (edges)
  ctx.strokeStyle = '#e8dcc0';
  ctx.lineWidth = 10; ctx.lineCap = 'round';
  for (const e of stage.edges || []) {
    const a = stage.nodes.find((n) => n.code === e.a), bnode = stage.nodes.find((n) => n.code === e.b);
    if (!a || !bnode) continue;
    const pa = P(a.x, a.y), pb = P(bnode.x, bnode.y);
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  }
  // The summarised journey's route (Plan B §3.4): while a path
  // summary is on stage, the journey's path stays drawn — the figure
  // did not walk it on this page, and the drawn route plus the panel
  // list are how the journey is told.
  if (state.summary) {
    const legs = journeyRoute(state.summary.journey, stage);
    ctx.save();
    ctx.strokeStyle = '#b388e0';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.setLineDash([9, 6]);
    ctx.beginPath();
    let started = false;
    for (const leg of legs) {
      const a = stage.nodes.find((n) => n.code === leg.a);
      const bnode = stage.nodes.find((n) => n.code === leg.b);
      if (!a || !bnode) continue;
      const pa = P(a.x, a.y);
      const pb = P(bnode.x, bnode.y);
      if (!started) { ctx.moveTo(pa.x, pa.y); started = true; }
      ctx.lineTo(pb.x, pb.y);
    }
    if (started) ctx.stroke();
    ctx.restore();
  }
  state.hits = [];
  const works = new Map((state.bundle?.ember?.works || []).map((wk) => [wk.code, wk]));
  // Buildings / places
  for (const node of stage.nodes) {
    const p = P(node.x, node.y);
    const work = works.get(node.code); // exact code match only (M3.08): a work colours the building whose code it carries, no fuzzy rescue
    const tier = workTier(state.bundle, node.code);
    const bw = 44, bh = 30, lift = 22;
    // base diamond
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 4, bw / 1.4, 10, 0, 0, Math.PI * 2); ctx.fill();
    // block
    ctx.fillStyle = tier.key === 'none' ? '#f3d9c8' : tier.color;
    ctx.strokeStyle = 'rgba(120,85,40,0.35)';
    roundRect(p.x - bw / 2, p.y - lift - bh / 2, bw, bh, 7); ctx.fill(); ctx.stroke();
    // X6 Buildings (M6.15): Simple drops the roof TRIM only. The
    // block's tier colour, the label and the repair line are the
    // building's state — information — and render in both modes.
    if (state.display.buildings === 'full') {
      ctx.fillStyle = tier.key === 'none' ? '#c99b76' : tier.roof;
      roundRect(p.x - bw / 2 - 3, p.y - lift - bh / 2 - 8, bw + 6, 12, 6); ctx.fill(); ctx.stroke();
    }
    // label (X7: canvas text sits at the token chip size, 12.5px)
    ctx.fillStyle = '#4a3f35';
    ctx.font = '700 12.5px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(node.label, p.x, p.y + 24);
    if (work && typeof work.integrity === 'number') {
      ctx.font = '600 12.5px Nunito, system-ui, sans-serif';
      ctx.fillStyle = '#8a7a6a';
      ctx.fillText(`repair ${work.integrity}/100`, p.x, p.y + 38);
    }
    state.hits.push({ kind: 'building', ref: node.code, sx: p.x, sy: p.y - lift, r: 34 });
  }
  // Citizens (wave-1 stand-ins: coloured dot + name chip — real chibi
  // figures arrive with the P3 art pass, see STATUS.md). Keyed by
  // PORTAL-KEY: every evidenced record stands at its own offset.
  // How each figure is DRAWN is logic.figureStyle's call (OM15-C2):
  // a citizen under a place-conflict HOLD is ghosted and carries a
  // dashed amber ring + a ≠ marker on the stage itself — a viewer
  // reads the map before the card, so the card cannot be the only
  // place the hold is visible.
  const placeStates = placementStates(state.placements, state.bundle);
  const drawFigure = (key, name, style = figureStyle(null, null)) => {
    const gp = positions.get(key);
    if (!gp) return;
    const p = P(gp.x, gp.y);
    // The figure itself, at the treatment's opacity. X6 Figures
    // (M6.15): Full draws the body + the first name over it + the
    // name chip; Simple drops the over-body first name (richness);
    // Portraits-only draws the name chip alone. Who is here, where,
    // and every annotation below are identical in all three modes.
    // X7: canvas text sits at the token chip size, 12.5px.
    const figMode = state.display.figures;
    ctx.save();
    ctx.globalAlpha = style.opacity;
    if (figMode !== 'portraits') {
      ctx.fillStyle = citizenColor(key);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y - 6, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (figMode === 'full') {
        ctx.fillStyle = '#4a3f35';
        ctx.font = '800 12.5px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(name.split(' ')[0], p.x, p.y - 2);
      }
    }
    ctx.font = '700 12.5px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(name).width + 10;
    ctx.fillStyle = 'rgba(255,253,248,0.92)';
    roundRect(p.x - tw / 2, p.y + 8, tw, 18, 7); ctx.fill();
    ctx.fillStyle = '#4a3f35';
    ctx.fillText(name, p.x, p.y + 21);
    ctx.restore();
    // Annotations stay at full opacity — they are the marking, and a
    // faded warning would defeat it.
    if (style.ring) {
      ctx.save();
      ctx.strokeStyle = style.ring.color;
      ctx.lineWidth = style.ring.width;
      ctx.setLineDash(style.ring.dash || []);
      ctx.beginPath(); ctx.arc(p.x, p.y - 6, 15, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (style.marker) {
      ctx.save();
      ctx.font = '800 14px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,253,248,0.95)';
      ctx.strokeText(style.marker.glyph, p.x, p.y - 24);
      ctx.fillStyle = style.marker.color;
      ctx.fillText(style.marker.glyph, p.x, p.y - 24);
      ctx.restore();
    }
    if (state.followed === key) {
      ctx.strokeStyle = '#e77fa2'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(p.x, p.y - 6, style.ring ? 20 : 16, 0, Math.PI * 2); ctx.stroke();
    }
    state.hits.push({ kind: 'citizen', ref: key, sx: p.x, sy: p.y - 6, r: 20 });
  };
  const bundleKeys = new Set();
  for (const c of state.bundle?.citizens || []) {
    const key = citizenKeyOf(c);
    bundleKeys.add(key);
    if (positions.has(key)) drawFigure(key, c.name, figureStyle(c, placeStates.get(key) || null));
  }
  // The demo figure, when it is not one of the bundle's citizens
  if (state.demo && positions.has(state.demo.key) && !bundleKeys.has(state.demo.key)) {
    drawFigure(state.demo.key, state.demo.name);
  }
  // The follow bar, every frame, from the machine (M6.07): the
  // demo's walk, a live reconstructed journey (M3.06 — its caption
  // is schedule-only wording from live-pacing: the walk is a
  // reconstruction scheduled between two pieces of evidence, and
  // the caption says so rather than claiming a followed
  // observation), a conflict HOLD, the map hand-off, or a citizen
  // the record has stopped evidencing — each is one of the eight
  // states with its table wording, never an ad-hoc string here.
  refreshFollowBar(positions);
  // Talk playback: the utterance now being spoken is drawn as a
  // speech bubble tailed to the SPEAKER (M5.02/M5.03) — anchored at
  // the speaking citizen's stage position when the current bundle
  // places them, falling back to the episode's place node when it
  // does not (a recorded conversation can predate the live bundle).
  // The bubble is capped at a few lines and marks its cut with the
  // kit's "Read in full" marker; the full recorded words, verbatim,
  // appear in the Conversations panel transcript as they are revealed.
  if (state.talk && (state.talk.shown > 0 || state.talk.preIndex != null)) {
    // Surface consumption: the stage resolves every talk act
    // through the ONE model (logic.talkActPresentation) — the same
    // call the panel strip and the 3D scene make — over the stage's
    // LIVE positions, so facing, head icons and suppression agree
    // across surfaces by construction. A suppressed act (the
    // record's own held/overflow facts — under VER-D22 a figure
    // asleep in the live snapshot no longer suppresses its
    // recorded act) draws no bubble, no ticks and no chips here;
    // its words stay in the panel transcript.
    const gridByName = {};
    for (const c of state.bundle?.citizens || []) {
      const gp = positions.get(citizenKeyOf(c));
      if (gp && c.name) gridByName[c.name] = { x: gp.x, y: gp.y };
    }
    const presFor = (idx) => {
      const ev = state.talk.schedule.events[idx];
      if (!ev) return null;
      return talkActPresentation({
        episode: state.talk.episode, event: ev, positions: gridByName,
        placeLabel: (code) => placeLabel(code), treatments: state.talk.treatments || {},
        // A RECORDING (VER-D22): the same mode the panel names.
        mode: 'recording',
      });
    };
    // A head icon + its word, drawn as a small pill over a figure.
    // Icon and word always ride together (never colour alone); a
    // pre-act chip is dashed — it is up BEFORE its act, by the
    // pre-act rule the panel's timers honour.
    const drawHeadChip = (name, presentation, dashed) => {
      const gp = gridByName[name];
      if (!gp || !presentation?.icon) return;
      const p = P(gp.x, gp.y);
      const label = `${presentation.icon.glyph} ${presentation.icon.word}`;
      ctx.save();
      ctx.font = '800 12.5px Nunito, system-ui, sans-serif';
      const wChip = ctx.measureText(label).width + 12;
      ctx.fillStyle = 'rgba(255,253,248,0.95)';
      ctx.strokeStyle = '#b04a74';
      ctx.lineWidth = 1.5;
      ctx.setLineDash(dashed ? [4, 3] : []);
      roundRect(p.x - wChip / 2, p.y - 46, wChip, 19, 7); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#4a3f35';
      ctx.textAlign = 'center';
      ctx.fillText(label, p.x, p.y - 33);
      ctx.restore();
    };
    const drawChips = (pres, dashed) => {
      if (!pres || pres.suppressed) return;
      drawHeadChip(pres.speaker.name, pres.speaker.presentation, dashed);
      for (const l of pres.listeners) if (!l.blocked) drawHeadChip(l.name, l.presentation, dashed);
    };
    // Pre-act: the NEXT act's head icons are already up (dashed)
    // while the current utterance — or the lead-in — still holds.
    if (state.talk.preIndex != null && state.talk.preIndex >= state.talk.shown) {
      drawChips(presFor(state.talk.preIndex), true);
    }
    const step = state.talk.shown > 0 ? state.talk.schedule.events[state.talk.shown - 1] : null;
    const pres = step ? presFor(state.talk.shown - 1) : null;
    if (step && pres && !pres.suppressed) {
      // M5.03 staging, from the consumption model: a short facing
      // tick on the speaker's figure points toward the listeners;
      // each listener's tick points toward the speaker. Figures the
      // current bundle does not place get no tick, and a lone
      // speaker faces nobody — no invented audience, drawn or not.
      const tick = (from, to) => {
        if (!from || !to) return;
        const a = P(from.x, from.y); const b = P(to.x, to.y);
        const dx = b.x - a.x; const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (!len) return;
        ctx.save();
        ctx.strokeStyle = '#b04a74';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x + (dx / len) * 14, a.y - 6 + (dy / len) * 14);
        ctx.lineTo(a.x + (dx / len) * 20, a.y - 6 + (dy / len) * 20);
        ctx.stroke();
        ctx.restore();
      };
      tick(gridByName[pres.speaker.name], pres.speaker.facesPoint);
      for (const l of pres.listeners) if (!l.blocked) tick(gridByName[l.name], l.facesPoint);
      drawChips(pres, false);
      let anchor = null;
      const speakerCitizen = (state.bundle?.citizens || []).find((c) => c.name === step.speaker);
      if (speakerCitizen && positions.has(citizenKeyOf(speakerCitizen))) {
        const gp = positions.get(citizenKeyOf(speakerCitizen));
        anchor = P(gp.x, gp.y);
      }
      if (!anchor) {
        const node = resolveExactNode(stage, state.talk.model.placeCode);
        if (node) anchor = P(node.x, node.y);
      }
      if (anchor) drawSpeechBubble(anchor.x, anchor.y - 78, bubbleKit(step, { variant: 'stage' }));
    }
  }
}

// A rounded speech bubble for the bubble kit's stage variant
// (M5.02): the K1 header ("[Name], [time]:") and the kit's display
// text — the recorded words whole, or a word-boundary prefix of
// them when the kit truncated. A cut is marked by the words
// "Read in full" drawn as their own line UNDER the words (the
// panel transcript carries every word verbatim — the marker's
// referent); nothing is ever appended into the quoted text itself,
// and the bubble never invents text.
// OM15-C4: the bubble is FENCED like the panel's transcript — a
// dashed outer frame in the shared fence colour plus the fence
// label (❝ Recorded words, from the kit's fence fields) above the
// header — so the stage's spoken words read as quoted record
// speech, not as the stage narrating. The fence is drawing only.
function drawSpeechBubble(cx, bottomY, kit) {
  if (!kit) return;
  const maxW = 250, pad = 9, lineH = 16, maxLines = 4, labelH = 15;
  ctx.font = '600 12.5px Nunito, system-ui, sans-serif';
  const words = String(kit.displayText).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (ctx.measureText(trial).width > maxW - pad * 2 && line) { lines.push(line); line = w; } else line = trial;
    if (lines.length > maxLines) break;
  }
  if (line && lines.length <= maxLines) lines.push(line);
  const elided = lines.length > maxLines;
  if (elided) lines.length = maxLines;
  const shown = lines.slice(0, maxLines);
  const truncated = kit.truncated || elided;
  const marker = kit.marker || READ_IN_FULL_MARKER;
  const fenceLabel = `${kit.quote} ${kit.label}`;
  ctx.font = '800 12.5px Nunito, system-ui, sans-serif';
  const labelW = ctx.measureText(fenceLabel).width;
  const markerW = truncated ? ctx.measureText(marker).width : 0;
  ctx.font = '600 12.5px Nunito, system-ui, sans-serif';
  const textW = Math.max(labelW, markerW, ctx.measureText(kit.header).width, ...shown.map((l) => ctx.measureText(l).width));
  const bw = Math.min(maxW, textW + pad * 2);
  const bh = pad * 2 + labelH + 15 + shown.length * lineH + (truncated ? 15 : 0);
  const bx = Math.max(6, Math.min(canvas.width - bw - 6, cx - bw / 2));
  const by = Math.max(6, bottomY - bh);
  ctx.save();
  ctx.fillStyle = 'rgba(255,253,248,0.97)';
  ctx.strokeStyle = SPEECH_FENCE_COLOR;
  ctx.lineWidth = 2;
  roundRect(bx, by, bw, bh, 10); ctx.fill(); ctx.stroke();
  // The fence: a dashed frame standing off the bubble, in the same
  // fence colour — the canvas twin of the panel's fence border.
  ctx.save();
  ctx.strokeStyle = SPEECH_FENCE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  roundRect(bx - 4, by - 4, bw + 8, bh + 8, 12); ctx.stroke();
  ctx.restore();
  // tail toward the speaker
  ctx.beginPath();
  ctx.moveTo(cx - 6, by + bh); ctx.lineTo(cx + 6, by + bh); ctx.lineTo(cx, by + bh + 8);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#b04a74';
  ctx.font = '800 12.5px Nunito, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(fenceLabel, bx + pad, by + pad + 8);
  ctx.font = '800 12.5px Nunito, system-ui, sans-serif';
  ctx.fillText(kit.header, bx + pad, by + pad + labelH + 9);
  ctx.fillStyle = '#4a3f35';
  ctx.font = '600 12.5px Nunito, system-ui, sans-serif';
  shown.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad + labelH + 15 + (i + 1) * lineH - 3));
  if (truncated) {
    // The truncation marker: its own line under the words, in the
    // fence colour — never appended to the quoted text.
    ctx.fillStyle = '#b04a74';
    ctx.font = '800 12.5px Nunito, system-ui, sans-serif';
    ctx.fillText(marker, bx + pad, by + pad + labelH + 15 + shown.length * lineH + 12);
  }
  ctx.restore();
}

function roundRect(x, y, w2, h2, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w2, y, x + w2, y + h2, r);
  ctx.arcTo(x + w2, y + h2, x, y + h2, r);
  ctx.arcTo(x, y + h2, x, y, r);
  ctx.arcTo(x, y, x + w2, y, r);
  ctx.closePath();
}

canvas.addEventListener('click', (ev) => {
  const rect = canvas.getBoundingClientRect();
  const sx = (ev.clientX - rect.left) * (canvas.width / rect.width);
  const sy = (ev.clientY - rect.top) * (canvas.height / rect.height);
  const hits = [...state.hits].reverse();
  for (const hit of hits) {
    if (Math.hypot(hit.sx - sx, hit.sy - sy) <= hit.r) {
      if (hit.kind === 'citizen') {
        const c = state.bundle.citizens.find((x) => citizenKeyOf(x) === hit.ref);
        if (c) showCitizenCard(c);
      } else {
        const stage = stageLayout();
        const node = stage.nodes.find((n) => n.code === hit.ref);
        const work = (state.bundle?.ember?.works || []).find((wk) => resolveExactNode(stage, wk.code)?.code === node?.code);
        if (node) showBuildingCard(node, work);
      }
      return;
    }
  }
});

// -------------------------------------------------------------- loop

// The frame loop, guarded (M3.09). Two halves, both load-bearing:
//  - frame() re-arms requestAnimationFrame BEFORE the body runs, so
//    no throw anywhere in the body can kill the loop — the failure
//    this item names was an engine throw (positionAt on an unknown
//    place code) freezing the page under a LIVE badge;
//  - the body runs through logic.guardedFrameStep, which catches the
//    throw, counts consecutive failures, and still renders after a
//    failed tick, so the stage keeps its last good picture. Once
//    failures pass the threshold the badge drops to STALE (see
//    updateBadge) — the stall is presented honestly, never silently.
const frameGuard = createFrameGuard();
let frameWasStalled = false;
let lastTs = performance.now();

function frame(ts) {
  requestAnimationFrame(frame);
  const res = guardedFrameStep(frameGuard, {
    tick: () => advanceDemo(ts),
    render: () => { if (state.bundle) drawStage(); },
  });
  if (!res.ok) {
    console.error(`Elsewhere Portal: frame step failed (${res.failures} in a row); the stage keeps its last good picture.`, res.error);
  }
  if (res.stalled !== frameWasStalled) {
    frameWasStalled = res.stalled;
    updateBadge();
  }
}

function advanceDemo(ts) {
  const dt = Math.min(0.1, (ts - lastTs) / 1000);
  lastTs = ts;
  if (state.demo?.playing) {
    const d = state.demo;
    d.target += dt * DEMO_TICK_RATE;
    const behind = d.target - d.tick;
    if (behind > 0) {
      // The demo plays journeys from their start, so it passes no
      // fromTick: catchUp's window then opens at journey.startTick by
      // default (engine contract, M3.02). The unplayed window here ends
      // at the target tick.
      const plan = catchUp(d.journey, Math.max(0, d.target - d.journey.startTick));
      const pres = planPresentation(plan);
      if (pres.isSummary && d.tick < plan.arrivalTick) {
        // Absence over an hour (Plan B §3.4): the missed steps are
        // listed, never played — no step of the summarised span is
        // animated. The figure goes to its evidenced place (the
        // journey's end) and the panel tells the journey instead.
        d.tick = plan.arrivalTick;
        d.playing = false;
        d.replay = false;
        showSummary(d, plan);
      } else {
        d.replay = pres.showReplayBadge && behind > 1;
        const speed = behind > 0.5 ? (plan.speed || 1) : 1;
        d.tick = Math.min(d.target, d.tick + dt * DEMO_TICK_RATE * speed);
      }
    } else d.replay = false;
    const endTick = d.journey.endTick ?? (d.journey.path.length - 1) * DEMO_TICKS_PER_STEP;
    if (d.tick >= endTick) { d.playing = false; d.replay = false; d.tick = endTick; }
    updateBadge();
  }
}

// The find nav (M6.02): the four locate routes, one tap each —
// Citizens (the roster), Buildings (the directory), Map (the stage
// itself: the town plan with its live dots), Faces (the portrait
// strip). Each button only scrolls its surface into view; the
// surfaces themselves carry the landings.
const FIND_ROUTES = { citizens: 'roster-panel', buildings: 'directory-panel', map: 'stage-panel', faces: 'portrait-strip-wrap' };
document.querySelectorAll('[data-find]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = document.getElementById(FIND_ROUTES[btn.getAttribute('data-find')] || '');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// ------------------------------------------------------ manifest poll

// The 20-second manifest poll (M4.03, SE-5.3). All decision logic —
// when to fetch, SHA-256 verification, discard-whole — lives in
// logic.pollOnce; this block is only the wiring: real fetches in, an
// adopted bundle applied exactly the way loadAll applies a live one
// (placement tracker, world-clock watch, derived feeds, panels), so a
// poll swap can no more produce an unscheduled position change than a
// first load can. The poll guards the LIVE bundle only: under the H4
// fallback chain the page shows a recording, and a recording is not
// replaced mid-view. A discarded mismatch is logged and nothing else
// happens — the prior bundle continues and the badge ages it to STALE
// from its own newestFetchUtc.
let pollInFlight = false;

async function adoptPolledBundle(data) {
  state.bundle = data;
  state.source = LIVE_BUNDLE_URL;
  state.isFallback = false;
  state.placementEvents = applyBundlePlacements(state.placements, data);
  state.worldWatch = observeWorldClock(state.worldWatch, data, nowMs());
  // The derived feeds ride alongside the bundle. A failed refetch
  // keeps the previous feed rather than unshowing its panel on a
  // transient error; the next adoption retries.
  const epRes = await fetchJson('../data/feed/episodes.json');
  if (epRes.ok && isEpisodesFeed(epRes.data)) state.episodesFeed = epRes.data;
  state.conversations = conversationsSource(state.bundle, state.episodesFeed);
  const jRes = await fetchJson('../data/feed/journeys.json');
  if (jRes.ok && isJourneysFeed(jRes.data)) state.journeysFeed = jRes.data;
  state.livePlans = state.journeysFeed ? livePlans(state.journeysFeed).plans : null;
  const gRes = await fetchJson('../data/feed/growth-book.json');
  if (gRes.ok && isGrowthBook(gRes.data)) state.growthFeed = gRes.data;
  renderGrowthBook();
  const cRes = await fetchJson('../data/feed/chronicle-book.json');
  if (cRes.ok && isChronicleBook(cRes.data)) state.chronicleFeed = cRes.data;
  renderChronicle();
  applyBookkeeping(data);
  renderJourneysNote();
  state.loadedAtMs = nowMs();
  renderPanels();
  renderEpisodes();
  updateBadge();
  $('source-line').textContent = `Showing the live public bundle, read at ${state.bundle.newestFetchUtc || 'an unrecorded time'}.`;
}

async function pollTick() {
  if (pollInFlight) return;
  if (!state.bundle || state.isFallback) return;
  pollInFlight = true;
  try {
    const res = await pollOnce({
      currentSeq: typeof state.bundle.bundleSeq === 'number' ? state.bundle.bundleSeq : null,
      readManifest: async () => {
        const r = await fetchJson(FEED_MANIFEST_URL);
        return r.ok ? r.data : null;
      },
      readBundleBytes: async () => {
        const r = await fetchBytes(LIVE_BUNDLE_URL);
        return r.ok ? r.bytes : null;
      },
    });
    if (res.adopted) {
      await adoptPolledBundle(res.adopted);
    } else if (res.reason === 'hash-mismatch') {
      console.warn('Elsewhere Portal: a fetched bundle failed its SHA-256 check against the feed manifest and was discarded whole; the previous bundle continues.');
    }
  } catch (err) {
    console.error('Elsewhere Portal: the manifest poll failed; the current bundle continues.', err);
  } finally {
    pollInFlight = false;
  }
}

setInterval(updateBadge, 5000);
setInterval(pollTick, POLL_INTERVAL_MS);
loadAll().then(() => requestAnimationFrame(frame));
