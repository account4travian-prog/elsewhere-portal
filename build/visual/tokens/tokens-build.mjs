/**
 * tokens-build.mjs — generate tokens.css FROM tokens.json (M4.21).
 *
 * tokens.json is the one source (Design G2 / Visual Plan REC-1). This
 * script is the only writer of tokens.css: run it after any token
 * change and commit both files together. A token reaches the CSS only
 * if it carries a cssVar AND a single emittable string value; tokens
 * with a `values` map (a recorded disagreement) emit the value named
 * by `cssEmits`, with a comment naming the disagreement so the shipped
 * CSS never hides it.
 *
 * Deterministic: group order is fixed below, tokens are emitted in
 * file order within each group, and there are no timestamps.
 *
 * Usage:
 *   node tokens-build.mjs          regenerate tokens.css in place
 *   node tokens-build.mjs --check  exit 1 if tokens.css differs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const TOKENS_JSON = join(here, 'tokens.json');
export const TOKENS_CSS = join(here, 'tokens.css');

// Short labels for the generated comments (tokens.json's per-group
// `about` is prose; the CSS wants one line).
const GROUP_LABEL = {
  'color.anchor': 'sampled palette anchors — the world colours (AUTO-L04)',
  'material.family': 'M4.07 building material families (data-only; consumed via the scene palette)',
  'color.family': 'act & place family colours (never the sole signal)',
  'color.identity': 'citizen identity colours (who, never state)',
  'color.state': 'honesty/state badge family, as shipped',
  'color.surface': '2D app chrome palette, as built',
  font: 'typography (X7; quoted-words font is fork F-2)',
  space: 'spacing / radius / border / shadow — the Wave 1 shell scale',
  motion: 'motion durations & rates (G2)',
  presence: 'presence treatments (data-only; no CSS emission)',
  rig: '3D scene rig values (data-only; no CSS emission)',
  wording: 'camera wording (data-only; no CSS emission)',
};
export const GROUP_ORDER = [
  'color.anchor',
  'material.family',
  'color.family',
  'color.identity',
  'color.state',
  'color.surface',
  'font',
  'space',
  'motion',
  'presence',
  'rig',
  'wording',
];

export function loadTokens(path = TOKENS_JSON) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function* allTokens(doc) {
  for (const group of Object.keys(doc.groups)) {
    for (const token of doc.groups[group].tokens) yield { group, token };
  }
}

export function buildTokensCss(doc = loadTokens()) {
  const lines = [
    '/* Portal design tokens — GENERATED from tokens.json by tokens-build.mjs.',
    ' * Do not edit by hand: change tokens.json, re-run the build, commit both.',
    ' * Colour authority: sampled palette anchors govern over plan constants',
    ' * (AUTO-L04). See TOKENS.md for usage rules and the disagreements list. */',
    '',
    ':root {',
  ];
  for (const group of GROUP_ORDER) {
    const g = doc.groups[group];
    if (!g) continue;
    lines.push(`  /* ${group} — ${GROUP_LABEL[group] ?? group} */`);
    for (const token of g.tokens) {
      if (!token.cssVar) continue;
      // Family tokens carry their emittable hex under `hex`; every
      // other emittable token uses `value`.
      const single = typeof token.value === 'string' ? token.value
        : typeof token.hex === 'string' ? token.hex
        : null;
      if (single !== null) {
        lines.push(`  ${token.cssVar}: ${single};`);
      } else if (token.values && token.cssEmits) {
        lines.push(`  /* DISAGREEMENT ${token.disagreement}: emits the ${token.cssEmits} value; see TOKENS.md. */`);
        lines.push(`  ${token.cssVar}: ${token.values[token.cssEmits]};`);
      }
    }
    lines.push('');
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const css = buildTokensCss();
  if (process.argv.includes('--check')) {
    const current = readFileSync(TOKENS_CSS, 'utf8');
    if (current !== css) {
      console.error('tokens.css is stale — regenerate with: node tokens-build.mjs');
      process.exit(1);
    }
    console.log('tokens.css is byte-identical to a fresh regeneration.');
  } else {
    writeFileSync(TOKENS_CSS, css);
    console.log(`tokens.css regenerated (${css.length} bytes).`);
  }
}
