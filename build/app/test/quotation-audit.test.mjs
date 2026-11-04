// quotation-audit.test.mjs — M5.13 (Design H9): the sampled audit
// that proves speech lives only inside quotation styling. Two
// halves, both load-bearing:
//   1. a POSITIVE CONTROL — a bundle whose ticker carries a run of
//      recorded words MUST be flagged (an audit that cannot catch a
//      planted quotation proves nothing when it reports zero);
//   2. the LIVE sample — the audit over the real episodes feed and
//      bundle currently in build/data/feed, which is the item's
//      exit-gate run. If the record ever changes so that a surface
//      genuinely quotes speech (a headline repeating six recorded
//      words, say), this test fails loudly and the finding is
//      dispositioned — never silently re-baselined.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditQuotation, speechWords, shinglesOf } from '../quotation-audit.mjs';

const feedWith = (said) => ({
  schema: 'portal.episodes/v1',
  episodes: [{
    place: 'EMBER_COLLEGE', firstUtc: '2026-11-02T10:00:00Z', lastUtc: '2026-11-02T10:05:00Z',
    participants: ['Nia Okafor', 'Kavi Marlow'], disclosure: 'd', utteranceCount: 2,
    utterances: [
      { at: '2026-11-02T10:00:00Z', by: 'Nia Okafor', said },
      { at: '2026-11-02T10:02:00Z', by: 'Kavi Marlow', said: '<<ELSEWHERE_UNTRUSTED_T>>Short reply.<</ELSEWHERE_UNTRUSTED_T>>' },
    ],
  }],
  actSequences: [],
});

const SAID = '<<ELSEWHERE_UNTRUSTED_T>>The corridor figures are published and the ledger carries them now.<</ELSEWHERE_UNTRUSTED_T>>';

test('M5.13 positive control: a ticker line quoting recorded words is flagged', () => {
  const bundle = {
    ticker: [{ kind: 'Record', text: 'News: the corridor figures are published and the ledger carries them now, officials say.', utc: '2026-11-02T10:01:00Z' }],
    citizens: [],
  };
  const report = auditQuotation({ feed: feedWith(SAID), bundle });
  assert.ok(report.findings.length >= 1, 'the planted quotation is caught');
  assert.ok(report.findings.some((f) => f.surface.startsWith('ticker')), 'flagged on the ticker surface');
  assert.equal(report.findings[0].speaker, 'Nia Okafor', 'the finding names the utterance it came from');
});

test('M5.13: ticker from structured fields only — a clean record finds nothing', () => {
  const bundle = {
    ticker: [{ kind: 'Record', text: 'A lecture began at the College.', utc: '2026-11-02T10:01:00Z' }],
    citizens: [],
  };
  const report = auditQuotation({ feed: feedWith(SAID), bundle });
  assert.deepEqual(report.findings, []);
  assert.ok(report.utterances === 2 && report.shingles > 0, 'the corpus was really sampled');
});

test('G-J1 round 3 positive control: a surface string carrying the fence pattern is a sentinel finding', () => {
  const bundle = {
    ticker: [{ kind: 'Record', text: 'News: gates open <<ELSEWHERE_UNTRUSTED_PLANT>> at dawn.', utc: '2026-11-02T10:01:00Z' }],
    citizens: [],
  };
  const report = auditQuotation({ feed: feedWith(SAID), bundle });
  const sentinel = report.findings.filter((f) => f.kind === 'sentinel');
  assert.ok(sentinel.length >= 1, 'the planted sentinel is caught as its own class');
  assert.ok(sentinel.every((f) => f.surface.startsWith('ticker')), 'named on the ticker surfaces');
});

test('G-J1 round 3 positive control: a fence variant the strip does not know is caught inside the bubble', () => {
  // An empty-id fence is not the pattern stripRecordFence removes
  // (the world's ids are non-empty) — if such a variant ever
  // reached a bubble, the audit's broader sentinel pattern names
  // it on the talk-bubble surface.
  const feed = feedWith('<<ELSEWHERE_UNTRUSTED_>>Words in an unknown fence.<</ELSEWHERE_UNTRUSTED_>>');
  const report = auditQuotation({ feed, bundle: { ticker: [], citizens: [] } });
  const sentinel = report.findings.filter((f) => f.kind === 'sentinel');
  assert.ok(sentinel.length >= 1, 'the unknown-fence bubble is caught');
  assert.ok(sentinel.some((f) => f.surface.startsWith('talk-bubble')), 'named on the talk-bubble surface');
});

test('M5.13 shingles: fence markers and punctuation cannot hide a quotation', () => {
  const words = speechWords(SAID);
  assert.ok(!words.some((w) => w.includes('elsewhere')), 'the world fence markers are stripped');
  assert.ok(shinglesOf(words).has('the corridor figures are published and'), 'the run is shingled verbatim-normalised');
});

test('M5.13 live sample: zero speech-derived runs outside quotation styling', () => {
  const feed = JSON.parse(readFileSync(new URL('../../data/feed/episodes.json', import.meta.url), 'utf8'));
  const bundle = JSON.parse(readFileSync(new URL('../../data/feed/world-data.json', import.meta.url), 'utf8'));
  const labelFor = (code) => (feed.episodes.find((e) => e.place === code)?.where) || code;
  const report = auditQuotation({ feed, bundle, labelFor });
  assert.ok(report.utterances >= 20, `sampled ${report.utterances} live utterances`);
  assert.ok(report.surfaces.length >= 30, `sampled ${report.surfaces.length} surfaces`);
  assert.deepEqual(report.findings, [], 'the exit gate: zero findings on the live record');
});
