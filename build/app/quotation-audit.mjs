// Elsewhere Portal — M5.13 quotation-discipline audit (Design H9).
//
// The law: recorded speech exists ONLY inside quotation styling (the
// fenced "❝ Recorded words" treatment); the ticker is built from
// structured fields; captions and every other surface never quote or
// paraphrase speech. This audit SAMPLES the live record and proves
// the negative: it takes every recorded utterance in the episodes
// feed, breaks it into 6-word shingles, and searches for any shingle
// in the rendered text of every OTHER surface the app builds from
// the same live data (ticker list + cards, roster, citizen cards,
// episode list rows, act sequences, captions). A hit means speech —
// or a run of it long enough to be a quotation in substance — is
// sitting outside the fence.
//
// The fenced bubble renders themselves are the allowed location and
// are not in the surface set; the code census (test/fenced-speech)
// pins that they are the ONLY utterance-text render sites, and this
// audit is the data-side twin. Run directly
// (`node quotation-audit.mjs`) it audits the live feed files and
// exits 1 on any finding; imported, `auditQuotation` runs over any
// feed/bundle pair (the test file adds a planted-violation control,
// so a green run is evidence, not absence of checking).
//
// The SENTINEL class (G-J1 round 3, 2026-11-03): the record's
// transport-fence pattern (<<ELSEWHERE_UNTRUSTED_…>>) is a finding
// on ANY surface string — the quoted-speech surfaces included.
// Presentation strips it (logic.stripRecordFence); the audit scans
// every surface's text as the browser would display it (basic
// entities unescaped) plus every presented bubble's fields, so a
// strip regression — or a fence variant the strip does not know —
// is named here even though the words themselves are allowed
// inside the fence.
//
// Read-only: this module reads feed JSON; it never writes, and it
// never touches the archive or the archiver.

import { readFileSync } from 'node:fs';
import {
  tickerListHtml, tickerCardHtml, rosterListHtml, citizenCardHtml,
  episodeListModel, actListModel, citizenCaption, talkPlaybackModel,
  scheduleTalkScene, talkActPresentation,
} from './logic.mjs';

/** Words of a text for shingling: fence markers stripped, case and
 *  punctuation normalised away — a quotation cannot hide behind
 *  either. */
export function speechWords(text) {
  return String(text || '')
    .replace(/<<\/?ELSEWHERE_UNTRUSTED_[^>]*>>/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export const SHINGLE_WORDS = 6;

/** The set of 6-word shingles over a word list. */
export function shinglesOf(words, n = SHINGLE_WORDS) {
  const out = new Set();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

const stripTags = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** The record's transport-fence pattern, for the sentinel class:
 *  broader than the presentation strip (any id shape counts — a
 *  fence variant the strip does not know is still the guard token
 *  on a page). */
const SENTINEL_PATTERN = /<<\/?ELSEWHERE_UNTRUSTED_[^>]*>>/;
/** Surface text as the browser displays it: the HTML builders
 *  escape record text, so a token in the source text reaches the
 *  reader as literal characters — unescape before scanning. */
const asDisplayed = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * Audit one episodes feed + one bundle. `labelFor` renders place
 * codes the way the surface would. Returns the corpus size, the
 * surfaces sampled, and every finding: {surface, speaker, at,
 * shingle} — the shingle is the EVIDENCE (a run of the recorded
 * words found outside the fence), quoted here because an audit
 * report is a record about the record, not a Portal surface.
 */
export function auditQuotation({ feed, bundle, labelFor } = {}) {
  const label = typeof labelFor === 'function' ? labelFor : (code) => String(code || '');
  const utterances = [];
  for (const ep of feed?.episodes || []) {
    const model = talkPlaybackModel(ep);
    if (!model) continue;
    for (const step of model.steps) utterances.push(step);
  }
  const corpus = new Map(); // shingle -> {speaker, at}
  for (const u of utterances) {
    for (const sh of shinglesOf(speechWords(u.text))) {
      if (!corpus.has(sh)) corpus.set(sh, { speaker: u.speaker, at: u.at });
    }
  }

  const surfaces = new Map(); // name -> rendered plain text
  if (bundle) {
    surfaces.set('ticker-list', stripTags(tickerListHtml(bundle)));
    (bundle.ticker || []).forEach((item, i) => {
      surfaces.set(`ticker-card-${i}`, stripTags(tickerCardHtml(item, bundle, label)));
    });
    surfaces.set('roster', stripTags(rosterListHtml(bundle, label)));
    for (const c of bundle.citizens || []) {
      surfaces.set(`citizen-card:${c.name || c.citizenKey || '?'}`, stripTags(citizenCardHtml(c, label)));
      surfaces.set(`caption:${c.name || c.citizenKey || '?'}`, citizenCaption(c, label(c.placeCode)));
    }
  }
  const listModel = episodeListModel(feed, label);
  if (listModel) {
    surfaces.set('episode-rows', listModel.episodes.map((ep) => [
      ep.placeLabel, ep.participants.join(', '), String(ep.utteranceCount),
      ep.disclosure,
    ].join(' ')).join('\n'));
  }
  const acts = actListModel(feed);
  if (acts) {
    surfaces.set('act-sequences', acts.sequences.map((s) => [
      s.actor, s.disclosure, ...(s.acts || []).map((a) => a.phrase),
    ].join(' ')).join('\n'));
  }
  // The talk surfaces' NON-speech text (SURFACE CONSUMPTION lane):
  // every caption the consumption model builds for a staged act —
  // speaker, listeners, and the town-altitude collapse — over every
  // scheduled event of every episode. These captions render on the
  // panel strip, the 2D stage and the 3D scene; if any of them ever
  // quoted or paraphrased the words it stages, the shingles catch
  // it here. (The fenced bubble text itself is the allowed location
  // and stays out of the surface set, as before.)
  const bubbleSentinels = [];
  for (const ep of feed?.episodes || []) {
    const sched = scheduleTalkScene(ep, { mode: 'recording' });
    if (!sched) continue;
    const caps = [];
    for (const ev of sched.events) {
      // The audit enumerates the captions playback presents for
      // recorded episodes — recording mode, as the surfaces call
      // it (VER-D22). No treatments are passed, so no act is
      // suppressed or overridden here either way.
      const pres = talkActPresentation({ episode: ep, event: ev, positions: {}, placeLabel: label, mode: 'recording' });
      if (!pres) continue;
      if (pres.speaker?.presentation?.caption) caps.push(pres.speaker.presentation.caption);
      for (const l of pres.listeners) if (l.presentation?.caption) caps.push(l.presentation.caption);
      if (pres.collapsed?.caption) caps.push(pres.collapsed.caption);
      // The sentinel class reaches inside the fence: the bubble's
      // own fields are scanned directly (they never join the
      // surface set — their words are allowed; the token is not).
      if (pres.bubble) {
        for (const field of ['text', 'displayText', 'header']) {
          if (SENTINEL_PATTERN.test(pres.bubble[field] || '')) {
            bubbleSentinels.push({ surface: `talk-bubble:${ep.place || '?'}`, kind: 'sentinel', field, speaker: ev.speaker, at: ev.at });
          }
        }
      }
    }
    if (caps.length) surfaces.set(`talk-captions:${ep.place || '?'}`, caps.join('\n'));
  }

  const findings = [...bubbleSentinels];
  for (const [surface, text] of surfaces) {
    if (SENTINEL_PATTERN.test(asDisplayed(text))) {
      findings.push({ surface, kind: 'sentinel', field: 'text' });
    }
    const words = speechWords(text);
    const seen = new Set();
    for (const sh of shinglesOf(words)) {
      if (corpus.has(sh) && !seen.has(sh)) {
        seen.add(sh);
        findings.push({ surface, ...corpus.get(sh), shingle: sh });
      }
    }
  }
  return {
    utterances: utterances.length,
    shingles: corpus.size,
    surfaces: [...surfaces.keys()],
    findings,
  };
}

// ------------------------------------------------------------- CLI

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const feed = JSON.parse(readFileSync(new URL('../data/feed/episodes.json', import.meta.url), 'utf8'));
  const bundle = JSON.parse(readFileSync(new URL('../data/feed/world-data.json', import.meta.url), 'utf8'));
  const labelFor = (code) => (feed.episodes.find((e) => e.place === code)?.where) || code;
  const report = auditQuotation({ feed, bundle, labelFor });
  console.log(`M5.13 quotation audit — live feed sample`);
  console.log(`  utterances sampled: ${report.utterances}`);
  console.log(`  distinct 6-word shingles: ${report.shingles}`);
  console.log(`  surfaces sampled: ${report.surfaces.length} (${report.surfaces.join(', ')})`);
  console.log(`  findings: ${report.findings.length}`);
  for (const f of report.findings) {
    if (f.kind === 'sentinel') {
      console.log(`  FINDING [${f.surface}] SENTINEL: the record’s transport-fence pattern rendered (${f.field || 'text'})`);
    } else {
      console.log(`  FINDING [${f.surface}] ${f.speaker} @ ${f.at}: "${f.shingle}"`);
    }
  }
  if (report.findings.length > 0) process.exit(1);
  console.log('  zero speech-derived runs outside quotation styling.');
}
