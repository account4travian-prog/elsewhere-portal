// font-intake.test.mjs — fork F-2 (AUTO-L10): the quoted-words serif.
//
// Pins the intake end to end, mechanically:
//   1. The token (font.family.quoted) names Lora, and the app's
//      styles.css mirror carries the token's value character-for-
//      character — the swap the fork promised is one line in each
//      place, and the two can never silently diverge.
//   2. The @font-face pair in styles.css serves Lora self-hosted:
//      both files exist under app/fonts/, are real WOFF2 (magic
//      bytes), and hash to the values filed in assets-src/ASSETS.md
//      at intake — a swapped or corrupted font file fails here, not
//      in a reader's browser.
//   3. The OFL licence file ships beside the fonts (Design X7:
//      licence files kept) and names the SIL OFL + the Lora
//      copyright line recorded at intake.
//   4. The staging publish set carries the font subtree — staged
//      quoted words must render in the same face as local ones
//      (the closure class that bit the scene in M4.02).
//
// Glyph-level proof (name table, fvar axis, cmap coverage) is a
// fontTools read recorded in plan-to-complete/lane-font-fixtures.md;
// this file pins identity and wiring, not outlines.
//
// Run per file: node --test test/font-intake.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const buildDir = join(appDir, '..');
const projectDir = join(buildDir, '..');

const tokensDoc = JSON.parse(readFileSync(join(buildDir, 'visual', 'tokens', 'tokens.json'), 'utf8'));
const quotedToken = tokensDoc.groups.font.tokens.find((t) => t.name === 'font.family.quoted');
const stylesCss = readFileSync(join(appDir, 'styles.css'), 'utf8');
const assetsMd = readFileSync(join(projectDir, 'assets-src', 'ASSETS.md'), 'utf8');

// The intake record (assets-src/ASSETS.md, Fonts section, 2026-11-03).
const INTAKE = [
  { file: 'lora-variable-latin.woff2', style: 'normal', sha256: 'ddb8c66035104e233fc024669183aad3738b6daa16deee2ebb1241bd0f98ace1' },
  { file: 'lora-italic-variable-latin.woff2', style: 'italic', sha256: 'd824d807d4d832d12c87932d0b8ec1314dcfd502157a56dee6bb04cf8a3768ae' },
];

test('F-2: the quoted-words token names the intake-cleared serif', () => {
  assert.ok(quotedToken, 'font.family.quoted token exists');
  assert.equal(quotedToken.value, '"Lora", Georgia, serif');
  assert.equal(quotedToken.provenance.kind, 'fork-cleared');
  assert.match(quotedToken.provenance.note, /AUTO-L10/);
  assert.match(quotedToken.provenance.note, /ASSETS\.md/);
});

test('F-2: the ASSETS.md intake record exists and names the licence + hashes', () => {
  assert.match(assetsMd, /### Lora \(variable, latin subset\)/);
  assert.match(assetsMd, /SIL Open Font License 1\.1/);
  assert.match(assetsMd, /Cyreal/);
  for (const { file, sha256 } of INTAKE) {
    assert.ok(assetsMd.includes(file), `ASSETS.md names ${file}`);
    assert.ok(assetsMd.includes(sha256), `ASSETS.md files the hash of ${file}`);
  }
});

test('F-2: styles.css mirrors the token value character-for-character', () => {
  assert.ok(
    stylesCss.includes(`--portal-font-family-quoted: ${quotedToken.value};`),
    'the app mirror carries the token value verbatim',
  );
  // And the consumers still read the slot (bubble kit + Ledger).
  assert.match(stylesCss, /\.bubble-words \{[^}]*var\(--portal-font-family-quoted\)/);
  assert.match(stylesCss, /\.ledger-words \{[^}]*var\(--portal-font-family-quoted\)/);
});

test('F-2: @font-face pair serves both files, variable weight range, swap display', () => {
  for (const { file, style } of INTAKE) {
    const block = new RegExp(
      `@font-face \\{[^}]*font-family: "Lora";[^}]*font-style: ${style};[^}]*font-weight: 400 700;[^}]*font-display: swap;[^}]*fonts/${file.replace('.', '\\.')}`,
    );
    assert.match(stylesCss, block, `@font-face for ${file} (${style})`);
  }
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(stylesCss), 'no third-party font host is referenced — self-hosted only');
});

test('F-2: the shipped font files are the intake files (magic + hash)', () => {
  for (const { file, sha256 } of INTAKE) {
    const bytes = readFileSync(join(appDir, 'fonts', file));
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2', `${file} carries the WOFF2 magic`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256, `${file} hashes to its intake value`);
  }
});

test('F-2: the OFL licence file ships beside the fonts', () => {
  const ofl = readFileSync(join(appDir, 'fonts', 'OFL.txt'), 'utf8');
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(ofl, /Copyright 2011 The Lora Project Authors/);
  assert.match(ofl, /Reserved Font Name "Lora"/);
});

test('F-2: the staging publish set carries the font subtree', async () => {
  const { collectSnapshot } = await import(join(projectDir, 'staging', 'publish.mjs'));
  const files = await collectSnapshot(buildDir);
  for (const { file } of INTAKE) {
    assert.ok(files.includes(`app/fonts/${file}`), `publish set includes app/fonts/${file}`);
  }
  assert.ok(files.includes('app/fonts/OFL.txt'), 'publish set includes the licence file');
});
