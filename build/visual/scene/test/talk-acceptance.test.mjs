/* M5.07 — the talk acceptance fixture, kept as a permanent
   regression (the wave brief's standing instruction).
   Run per file: node --test test/talk-acceptance.test.mjs

   The gate itself lives in ../m5.07-gate.mjs (runnable cold:
   `node m5.07-gate.mjs`); this file pins its clause verdicts so a
   future change to the talk model, the deriver, or the fixture
   has to move them deliberately, with the reason on record.

   History of the atlas-speaks-2312 pin: at the gate's first
   filing (2026-11-03) the clause was pinned at CONFLICT —
   M5.01's 90 s cap summarised the storytelling scene's last
   three utterances (Atlas's among them); see M5.07-GATE.md.
   the project owner ruled the same day: "Acceptance replays play in full
   — the 90-second cap governs live scenes only." The pin now
   stands at the RULED expectation (pass, words as a bubble,
   byte-equal), citing that ruling; the cap's live letter is
   positive-controlled in the app talk-system suite. If either
   moves, this test fails and the gate record must be re-filed;
   it must never drift silently. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { runGate } = await import('../m5.07-gate.mjs');

const { clauses, verdict } = runGate();
const byId = new Map(clauses.map((c) => [c.id, c]));

for (const id of ['fixture-fidelity', 'derivation-agreement', 'bubbles-in-order-verbatim',
  'atlas-arrival', 'dinner-2320', 'both-altitudes', 'negative-witness']) {
  test(`M5.07 clause ${id}: pass`, () => {
    assert.equal(byId.get(id)?.verdict, 'pass', byId.get(id)?.evidence);
  });
}

test('M5.07 clause atlas-speaks-2312: pass under the project owner\'s ruling (acceptance replays play in full)', () => {
  const c = byId.get('atlas-speaks-2312');
  assert.equal(c.verdict, 'pass', c.evidence);
  assert.match(c.evidence, /byte-equal/, 'his words render as a bubble, byte-equal to the archive');
  assert.match(c.evidence, /no summary pointer/, 'a recording produces no pointer');
  assert.match(c.evidence, /Ruled by the project owner, 2026-11-03/, 'the ruling is cited on the clause itself');
});

test('M5.07 overall verdict: pass — every clause green under the ruling', () => {
  assert.equal(verdict, 'pass');
  assert.equal(clauses.filter((c) => c.verdict !== 'pass').length, 0);
});
