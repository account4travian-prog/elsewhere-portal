/**
 * tokens.test.mjs — M4.21 design-token integrity.
 *
 * Run per-file (directory-form `node --test test/` phantom-fails on
 * this Node, VER-D10):  node --test test/tokens.test.mjs
 *
 * What is pinned here:
 *  1. tokens.css is byte-identical to a fresh regeneration from
 *     tokens.json (the two can never drift).
 *  2. Every app-critical token name exists, and its CSS variable is
 *     present in the generated CSS.
 *  3. Anchor provenance: every anchor in palette-anchors.json has a
 *     token whose value IS the sampled hex and whose recorded plan
 *     constant matches the anchor file (AUTO-L04 made mechanical).
 *  4. Every token carries provenance with a kind.
 *  5. Family honesty: a family token's hex is either unpinned (null)
 *     or evidenced by a shipped surface (provenance.appSource) —
 *     never inferred from a colour name.
 *  6. Every disagreement id named in tokens.json is documented in
 *     TOKENS.md.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadTokens, buildTokensCss, allTokens, TOKENS_CSS } from '../tokens-build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const anchorsDoc = JSON.parse(
  readFileSync(join(here, '..', '..', 'palette-anchors.json'), 'utf8'),
);
const tokensMd = readFileSync(join(here, '..', 'TOKENS.md'), 'utf8');

const doc = loadTokens();
const byName = new Map();
for (const { token } of allTokens(doc)) byName.set(token.name, token);

// The names the shipped surfaces cannot lose: the app's :root palette,
// the honesty badge family, the pinned family colours, the type
// contract (families + X7 floors), the shell's signature geometry, and
// the pre-action icon floor.
const APP_CRITICAL = [
  'color.surface.bg', 'color.surface.panel', 'color.surface.ink',
  'color.surface.soft', 'color.surface.line', 'color.surface.accent',
  'color.surface.sky', 'color.surface.grass',
  'color.state.live', 'color.state.stale', 'color.state.replay',
  'color.state.loading', 'color.state.recording', 'color.state.sampleBg',
  'color.state.conflictBg', 'color.state.conflictBorder',
  'color.family.act.travel', 'color.family.act.social', 'color.family.act.civic',
  'font.family.display', 'font.family.body', 'font.family.quoted',
  'font.floor.bodyDesktop', 'font.floor.bodyMobile',
  'space.radius.panel', 'space.radius.pill', 'space.shadow.panel',
  'motion.preActionIconMin',
];

test('tokens.css is byte-identical to a fresh regeneration from tokens.json', () => {
  assert.equal(readFileSync(TOKENS_CSS, 'utf8'), buildTokensCss(doc));
});

test('every app-critical token name exists, with its CSS var in tokens.css', () => {
  const css = readFileSync(TOKENS_CSS, 'utf8');
  for (const name of APP_CRITICAL) {
    const token = byName.get(name);
    assert.ok(token, `missing token ${name}`);
    assert.ok(token.cssVar, `${name} has no cssVar`);
    assert.ok(css.includes(`${token.cssVar}:`), `${token.cssVar} (${name}) not in tokens.css`);
  }
});

test('anchor tokens: one per palette anchor, value = sampled hex, plan constant recorded', () => {
  const anchors = anchorsDoc.anchors;
  assert.equal(anchors.length, 26, 'anchor file census changed — update the artefact deliberately');
  for (const anchor of anchors) {
    const token = byName.get(`color.anchor.${anchor.id}`);
    assert.ok(token, `no token for anchor ${anchor.id}`);
    assert.equal(token.value.toUpperCase(), anchor.hex.toUpperCase(),
      `${anchor.id}: token value must be the anchor file's governing hex (AUTO-L04)`);
    // Re-pinned 2026-11-03 (T1a): an anchor carrying a ruled amendment
    // (palette-anchors.json `amendment`, from extract-palette.mjs
    // RULED_AMENDMENTS) must have its token cite that ruling — kind,
    // sampled hex superseded, and ruling text all checked, so an
    // amendment cannot land in the anchor file without the token
    // following it in the same change. Unamended anchors keep the
    // original sampled-anchor assertion exactly.
    if (anchor.amendment) {
      assert.equal(token.provenance.kind, 'ruled-amendment',
        `${anchor.id}: amended anchor requires a ruled-amendment token`);
      assert.equal(token.provenance.sampledHex, anchor.sampledHex,
        `${anchor.id}: token must record the superseded sampled hex`);
      assert.equal(token.provenance.amendment?.ruling, anchor.amendment.ruling,
        `${anchor.id}: token must cite the anchor file's ruling verbatim`);
      assert.equal(anchor.sampledHex, anchor.amendment.supersedesSampledHex,
        `${anchor.id}: anchor file amendment disagrees with its sampled hex`);
    } else {
      assert.equal(token.provenance.kind, 'sampled-anchor');
    }
    assert.equal(token.provenance.anchorId, anchor.id);
    assert.equal(token.provenance.register, anchor.register);
    assert.equal(
      (token.provenance.planConstant ?? null),
      (anchor.planConstant ?? null),
      `${anchor.id}: recorded plan constant disagrees with the anchor file`,
    );
  }
});

test('every token carries provenance with a kind', () => {
  let count = 0;
  for (const { token } of allTokens(doc)) {
    count += 1;
    assert.ok(token.provenance && typeof token.provenance.kind === 'string',
      `${token.name} lacks provenance.kind`);
  }
  assert.ok(count > 100, `suspiciously few tokens (${count})`);
});

test('family tokens: hex is unpinned or evidenced by a shipped surface', () => {
  for (const token of doc.groups['color.family'].tokens) {
    assert.ok(token.planColourName, `${token.name} lost its plan colour name`);
    const hex = token.hex ?? null;
    if (hex !== null) {
      assert.match(hex, /^#[0-9A-Fa-f]{6}$/, `${token.name} hex malformed`);
      assert.ok(token.provenance.appSource,
        `${token.name} pins ${hex} with no shipped-surface evidence — a family hex is never inferred from a colour name`);
      assert.equal(token.cssVar !== null, true, `${token.name} pinned but not emitted to CSS`);
    } else {
      assert.ok(token.hexStatus, `${token.name} unpinned without a hexStatus`);
      assert.equal(token.cssVar, null, `${token.name} unpinned but declares a cssVar`);
    }
  }
});

test('every disagreement named in tokens.json is documented in TOKENS.md', () => {
  const ids = new Set();
  for (const { token } of allTokens(doc)) {
    if (token.disagreement) ids.add(token.disagreement);
    if (token.provenance?.note) {
      for (const m of token.provenance.note.matchAll(/D-T\d{2}/g)) ids.add(m[0]);
    }
  }
  assert.ok(ids.size >= 5, `expected the known disagreement set, found ${[...ids].join(', ')}`);
  for (const id of ids) {
    assert.ok(tokensMd.includes(`**${id} —`), `${id} referenced by tokens.json but not documented in TOKENS.md`);
  }
});

test('state family: the full honesty set is present (live/stale/replay/loading/recording/sample/conflict/held)', () => {
  const names = new Set(doc.groups['color.state'].tokens.map((t) => t.name));
  for (const need of ['live', 'stale', 'replay', 'loading', 'recording', 'sampleBg', 'conflictBg', 'held']) {
    assert.ok(names.has(`color.state.${need}`), `color.state.${need} missing`);
  }
  // Held is a recorded gap, not an invented colour.
  assert.equal(byName.get('color.state.held').value, null);
});
