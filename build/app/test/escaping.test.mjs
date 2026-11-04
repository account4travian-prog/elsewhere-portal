// M2.15 — the SE-6.1 injection defect and its fix.
//
// Census (2026-11-02, app.js + logic.mjs + index.html): six innerHTML
// assignment sites, all in app.js; no insertAdjacentHTML /
// document.write / outerHTML anywhere; episodes/talk rendering uses
// textContent + createElement and the stage uses canvas fillText
// (both inherently text-only). Of the six:
//   card (citizen)  — interpolated citizen.name, the name-bearing
//                     caption, BOUND citizenId, the data-follow key,
//                     provenance route/fetchedUtc: ALL feed-derived.
//   card (building) — provenance route/fetchedUtc feed-derived;
//                     node label + tier are Portal's own.
//   card (ticker)   — item.kind, item.text, raw item.utc, place
//                     label, citizen names/handles: feed-derived.
//   ticker list     — item.kind, item.text: feed-derived.
//   roster          — citizen names, captions, BOUND citizenId,
//                     data-follow key: feed-derived.
//   growth panel    — TRUSTED-STATIC ONLY: hardcoded keys, values are
//                     formatCount numbers or a static fallback. The
//                     one template left in app.js (pinned below).
// The five untrusted sites now assign strings built in logic.mjs,
// where every feed-derived interpolation passes escapeHtml.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  escapeHtml, citizenCardHtml, buildingCardHtml, tickerCardHtml,
  tickerListHtml, rosterListHtml, talkPlaybackModel,
} from '../logic.mjs';

const labelFor = (code) => ({ EMBER_PLAZA_OF_UNITY: 'the Plaza' }[code] || String(code || ''));

// ------------------------------------------------------------- escapeHtml

test('escapeHtml: escapes the five markup characters', () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml: identity on benign text — recorded words render verbatim', () => {
  // Fence markers, backticks, and ordinary punctuation carry no
  // markup characters, so escaping cannot alter the displayed words.
  const said = 'Meet at the gate ```when the bell rings``` — bring the ledger, please.';
  assert.equal(escapeHtml(said), said);
});

// ------------------------------------------------- M2.15 positive control

const EVIL_NAME = '<img src=x onerror=alert(1)>';
const EVIL_KEY = 'portal-key:evil" onmouseover="alert(3)';
const EVIL_ID = '<svg onload=alert(4)>';
const EVIL_ROUTE = '</code><script>alert(5)</script>';

const evilCitizen = {
  citizenKey: EVIL_KEY,
  handle: '',
  name: EVIL_NAME,
  state: 'talking',
  placeCode: 'EMBER_PLAZA_OF_UNITY',
  evidenceUtc: '2026-11-02T00:00:00Z',
  citizenIdStatus: 'BOUND',
  citizenId: EVIL_ID,
  provenance: { route: EVIL_ROUTE, fetchedUtc: '2026-11-02T00:00:00Z' },
};

test('M2.15 control: a hostile citizen record renders as inert text (card + roster)', () => {
  const card = citizenCardHtml(evilCitizen, labelFor);
  assert.ok(card.includes('&lt;script&gt;alert(5)&lt;/script&gt;'), 'provenance route appears as escaped text');
  for (const html of [card, rosterListHtml({ citizens: [evilCitizen] }, labelFor)]) {
    // The payloads are present — as escaped entities, i.e. as text.
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'name appears as escaped text');
    assert.ok(html.includes('&lt;svg onload=alert(4)&gt;'), 'citizenId appears as escaped text');
    // …and never as markup: no element the payload tried to create.
    assert.ok(!html.includes('<img'), 'no <img> element');
    assert.ok(!html.includes('<svg'), 'no <svg> element');
    assert.ok(!html.includes('<script'), 'no <script> element');
    // The attribute context holds too: the key's quote is an entity,
    // so data-follow cannot break out into an onmouseover attribute.
    assert.ok(html.includes('data-follow="portal-key:evil&quot; onmouseover=&quot;alert(3)"'), 'key is attribute-escaped');
    assert.ok(!html.includes('onmouseover="alert'), 'no attribute breakout');
  }
});

test('M2.15 control: a hostile utterance stays verbatim in the model and inert as HTML', () => {
  const said = 'Before </div><script>alert(2)</script> after ```fence``` <img src=x onerror=alert(1)>';
  // Model level: the playback model carries the recorded words
  // VERBATIM (its DOM sink is textContent, which never parses them).
  const episode = {
    place: 'EMBER_PLAZA_OF_UNITY', firstUtc: '2026-11-02T00:00:00Z', disclosure: 'd',
    utterances: [{ at: '2026-11-02T00:00:00Z', by: 'Nia', said }],
  };
  assert.equal(talkPlaybackModel(episode).steps[0].text, said);
  // DOM-string level: anywhere the same words DO enter an HTML
  // string (here, the news path — same trust class), they are
  // escaped into inert text, fence markers visible as characters.
  const escaped = '&lt;/div&gt;&lt;script&gt;alert(2)&lt;/script&gt;';
  assert.ok(escapeHtml(said).includes(escaped));
  const ticker = tickerListHtml({ ticker: [{ kind: 'News', text: said, utc: '2026-11-02T00:00:00Z' }] });
  assert.ok(ticker.includes(escaped), 'utterance text is escaped in list HTML');
  assert.ok(!ticker.includes('<script') && !ticker.includes('<img'), 'no element is created');
  const card = tickerCardHtml(
    { kind: 'News', text: said, utc: '2026-11-02T00:00:00Z', handles: [EVIL_KEY], provenance: null },
    { citizens: [evilCitizen] }, labelFor,
  );
  assert.ok(card.includes(escaped), 'utterance text is escaped in card HTML');
  assert.ok(!card.includes('<script') && !card.includes('<img'), 'card creates no element from the payload');
});

// ------------------------------------------------------- benign rendering

test('benign data renders exactly as before (names literal, structure intact)', () => {
  const nia = {
    citizenKey: 'portal-key:nia-okafor', handle: '', name: 'Nia Okafor',
    state: 'present', placeCode: 'EMBER_PLAZA_OF_UNITY', evidenceUtc: '2026-11-02T00:00:00Z',
  };
  const card = citizenCardHtml(nia, labelFor);
  assert.ok(card.includes('>Nia Okafor</h3>'));
  assert.ok(card.includes('data-follow="portal-key:nia-okafor"'));
  assert.ok(card.includes('Follow Nia Okafor'));
  const roster = rosterListHtml({ citizens: [nia] }, labelFor);
  assert.ok(roster.includes('<span class="who">Nia Okafor</span>'));
  const building = buildingCardHtml(
    { ember: { works: [{ code: 'MARKET_HALL', integrity: 85, provenance: { route: 'map', fetchedUtc: '2026-11-02T00:00:00Z' } }] } },
    { code: 'MARKET_HALL', label: 'Market Hall' },
    { code: 'MARKET_HALL', integrity: 85, provenance: { route: 'map', fetchedUtc: '2026-11-02T00:00:00Z' } },
  );
  assert.ok(building.includes('<h3>Market Hall</h3>'));
  assert.ok(building.includes('In good repair (85 out of 100)'));
  assert.ok(building.includes('<code>map</code>'));
});

// ------------------------------------------------------------- the census

test('M2.15 census pin: every innerHTML assignment in app.js is a logic builder or the trusted-static growth rows', () => {
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const assignments = src.split('\n').filter((l) => /\.innerHTML\s*=/.test(l));
  // 6 at M2.15; 11 after the M6 find-&-watch lane (2026-11-03) added
  // the inspector, the reset banner, the building directory and the
  // portrait strip; 14 after the M6 page + map lane (2026-11-03)
  // added the citizen page (M6.05), the frontier map (M6.11) and
  // the rhythm header (M6.14); 17 after the M6 chronicle lane
  // (2026-11-03) added the Chronicle book (M6.09), the civic
  // calendar (M6.10) and the quiet page (M6.13); 22 after the M6
  // final lane (2026-11-03) added the welcome overlay (M6.12), the
  // attribution roll (M6.12), the scene list and the display panel
  // (M6.15) — all logic.mjs builders on the same escaping rule —
  // plus clearCard's trusted-static empty-card literal (no
  // interpolation of anything, feed-born or otherwise) — each added
  // to the pin deliberately with the item, not around it.
  assert.equal(assignments.length, 22);
  for (const line of assignments) {
    assert.ok(
      /citizenCardHtml|buildingCardHtml|tickerCardHtml|tickerListHtml|rosterListHtml|inspectorHtml|resetBannerHtml|directoryListHtml|portraitStripHtml|growthBookHtml|citizenPageHtml|frontierMapHtml|rhythmHeaderHtml|chronicleBookHtml|calendarHtml|quietPageHtml|welcomeOverlayHtml|attributionsHtml|sceneListHtml|displayPanelHtml|rows\.map|'<p class="soft">Nothing picked yet/.test(line),
      `unpinned innerHTML assignment: ${line.trim()}`,
    );
  }
});
