// M3.07 AMENDED CLOSE — the stand-in retirement + the SAMPLE DATA
// banner (Design H4).
//
// The conflict: M3.07's letter makes the sample fixture tests-only,
// "never a page fallback"; M4.03 / Design H4 keeps the local-dev
// fallback chain alive under a persistent "SAMPLE DATA — not the
// live town" banner with a non-LIVE badge. Coordinator ruling
// (AUTO-DECISIONS.md, reversible): H4 wins — the fallback survives,
// bannered; M3.07 closes in this amended form. Three pins follow:
//
//  1. Banner model + composition: the banner exists iff a fallback
//     bundle drives the app, composes with the STALE badge and the
//     M3.10 RECORDING caption, and never appears on live data.
//  2. Banner-or-nothing census: app.js touches the banner element
//     in exactly one function, fed by the one model call, driven
//     from updateBadge — which loadAll calls after the bundle pick —
//     so no code path renders sample data unbannered.
//  3. The stand-in grep gate, over a DEFINED SOURCE SCOPE: every
//     .js / .mjs / .html / .css / .json file under build/app (code,
//     tests, markup, styles, fixtures). STATUS.md is deliberately
//     OUT of scope: it is the dated historical record, and its
//     entries naming the deleted stand-in file are history, not
//     references — the gate's job is that no LIVE source names it.
//     (The needle below is built in two pieces so this file itself
//     stays inside the scope it enforces.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  selectBundle,
  badgeFor,
  recordingNotice,
  sampleBanner,
  SAMPLE_BANNER_TEXT,
} from '../logic.mjs';

const BUNDLE = { schema: 'portal.world-data/v2', newestFetchUtc: '2026-11-02T00:00:00Z', citizens: [] };
// The composition app.js performs after a load: state.bundle is the
// picked bundle (or null), state.isFallback its flag.
const bannerFor = (picked) =>
  sampleBanner({ isFallback: picked ? picked.isFallback : true, hasBundle: !!picked });
const noticeFor = (picked, demoActive = false) =>
  recordingNotice({ demoActive, isFallback: picked ? picked.isFallback : false });

// ------------------------------------------------------------- model

test('sample banner: visible iff a fallback bundle actually drives the app', () => {
  assert.equal(sampleBanner({ isFallback: false, hasBundle: true }), null, 'live bundle: no banner, ever');
  assert.equal(sampleBanner({ isFallback: true, hasBundle: false }), null, 'nothing loaded: nothing rendered, no banner');
  assert.equal(sampleBanner({}), null);
  assert.equal(sampleBanner({ isFallback: false, hasBundle: false }), null);
  const b = sampleBanner({ isFallback: true, hasBundle: true });
  assert.equal(b.key, 'sample');
});

test('sample banner: the wording is Design H4\'s, plainly', () => {
  assert.equal(SAMPLE_BANNER_TEXT, 'SAMPLE DATA — not the live town');
  assert.equal(sampleBanner({ isFallback: true, hasBundle: true }).text, SAMPLE_BANNER_TEXT);
});

// ------------------------------------------------- composition (H4)

test('composition: live bundle — no banner, no recording caption, badge may be LIVE', () => {
  const picked = selectBundle([{ ok: true, source: 'live', data: BUNDLE }]);
  assert.equal(picked.isFallback, false);
  assert.equal(bannerFor(picked), null);
  assert.equal(noticeFor(picked), null);
  assert.equal(badgeFor({ dataAgeSeconds: 0, isFallback: picked.isFallback }).key, 'LIVE');
});

test('composition: fallback bundle — banner AND recording caption AND a STALE badge', () => {
  for (const attempts of [
    // Shared sample wins after the live feed fails…
    [{ ok: false, source: 'live' }, { ok: true, source: 'shared-sample', data: BUNDLE }],
    // …or the app-local sample is the only thing that loads.
    [{ ok: false, source: 'live' }, { ok: false, source: 'shared-sample' }, { ok: true, source: 'app-sample', data: BUNDLE }],
  ]) {
    const picked = selectBundle(attempts);
    assert.equal(picked.isFallback, true);
    // The banner shows…
    assert.equal(bannerFor(picked).text, 'SAMPLE DATA — not the live town');
    // …the M3.10 caption shows too (sample data is a recording)…
    assert.equal(noticeFor(picked).key, 'sample');
    // …and the badge is STALE however fresh the sample claims to be:
    // sample data is never LIVE.
    assert.equal(badgeFor({ dataAgeSeconds: 0, isFallback: true }).key, 'STALE');
  }
});

test('composition: nothing loads — no pick, no banner (the page shows its honest error)', () => {
  const picked = selectBundle([{ ok: false, source: 'live' }, { ok: false, source: 'app-sample' }]);
  assert.equal(picked, null);
  assert.equal(bannerFor(picked), null);
});

test('composition: the demo over sample data carries BOTH honesty layers', () => {
  const picked = selectBundle([{ ok: false, source: 'live' }, { ok: true, source: 'app-sample', data: BUNDLE }]);
  // The demo caption (the demo wording wins inside the notice)…
  assert.equal(noticeFor(picked, true).key, 'demo');
  // …and the sample banner still shows: the stage's DATA is sample
  // even while the demo walks on it.
  assert.equal(bannerFor(picked).text, SAMPLE_BANNER_TEXT);
  // The demo over a LIVE bundle: caption only, no banner.
  const live = selectBundle([{ ok: true, source: 'live', data: BUNDLE }]);
  assert.equal(noticeFor(live, true).key, 'demo');
  assert.equal(bannerFor(live), null);
});

// ---------------------------------------------------- page census

test('page census: the banner element sits above the stage, hidden until driven', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const bannerAt = html.indexOf('id="sample-banner"');
  assert.ok(bannerAt !== -1, 'index.html carries the banner element');
  assert.ok(html.includes('id="sample-banner" class="sample-banner" role="alert" hidden'), 'the banner starts hidden — the model unhides it, never the markup');
  assert.ok(bannerAt < html.indexOf('id="stage"'), 'the banner is above the stage canvas: prominent, first thing in the panel');
  assert.ok(html.includes('id="recording-note"'), 'the recording caption element still exists (the banner composes with it, not over it)');
});

// ------------------------------------------- banner-or-nothing pin

test('banner-or-nothing census: one element touch, one model call, driven from the badge funnel', () => {
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

  // The element is looked up exactly once, inside renderSampleBanner.
  const touches = src.split("$('sample-banner')").length - 1;
  assert.equal(touches, 1, 'app.js touches #sample-banner in exactly one place');
  const renderFn = src.slice(src.indexOf('function renderSampleBanner()'), src.indexOf('function showCitizenCard'));
  assert.ok(renderFn.includes("$('sample-banner')"), 'the single touch is renderSampleBanner\'s');
  assert.ok(renderFn.includes('.hidden'), 'renderSampleBanner drives visibility from the model');

  // The model is consulted exactly once — there is no second,
  // hand-rolled banner wording anywhere in the shell.
  const modelCalls = src.split('sampleBanner(').length - 1;
  assert.equal(modelCalls, 1, 'app.js calls logic.sampleBanner exactly once');
  assert.ok(renderFn.includes('sampleBanner({'), 'the call is renderSampleBanner\'s');

  // The funnel: updateBadge renders the banner beside the recording
  // notice, and loadAll calls updateBadge AFTER the bundle pick is
  // stored — so every load outcome (live, fallback, none) passes
  // through the banner decision with the pick already in state.
  const badgeFn = src.slice(src.indexOf('function updateBadge()'), src.indexOf('function renderRecordingNotice'));
  assert.ok(badgeFn.includes('renderRecordingNotice();') && badgeFn.includes('renderSampleBanner();'),
    'updateBadge renders notice and banner together');
  const loadFn = src.slice(src.indexOf('async function loadAll()'), src.indexOf('// ----', src.indexOf('async function loadAll()')));
  const pickAt = loadFn.indexOf('state.bundle = picked.data');
  assert.ok(pickAt !== -1 && loadFn.indexOf('updateBadge();') > pickAt,
    'loadAll stores the pick before the badge funnel runs');
});

// ------------------------------------------------------ grep gate

const NEEDLE = 'local-' + 'playback'; // split so this file passes its own gate
const SOURCE_EXTS = new Set(['.js', '.mjs', '.html', '.css', '.json']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(p, out);
    else if (SOURCE_EXTS.has(entry.name.slice(entry.name.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

test('grep gate: no live source under build/app names the retired stand-in', () => {
  const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
  const files = walk(root);
  assert.ok(files.length >= 10, `gate scope is non-vacuous (${files.length} source files)`);
  assert.ok(!files.some((f) => f.endsWith('.md')), 'scope is source-only: no Markdown in the gated set');
  for (const f of files) {
    assert.ok(!readFileSync(f, 'utf8').includes(NEEDLE), `${f} names the retired stand-in`);
  }
  // The exclusion is deliberate and load-bearing: the history really
  // is still there, outside the gate — STATUS.md's dated entries
  // record the deletion and are not rewritten.
  const status = readFileSync(new URL('../STATUS.md', import.meta.url), 'utf8');
  assert.ok(status.includes(NEEDLE), 'STATUS.md history still names it — the scope boundary is what keeps the gate honest');
});
