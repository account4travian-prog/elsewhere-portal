// layout-overflow.test.mjs — the side-column blowout pin.
//
// The defect (found by the G-J1 round-7 Part 3 verification,
// 2026-11-03; record: plan-to-complete/lane-overflow-fix.md):
// the app scrolled sideways at EVERY width — document
// scrollWidth 2,413 vs clientWidth 1,265 at 1280x800, and
// 1,652 vs 390 at 390x844. Cause, isolated by hide-and-
// remeasure: the Growth book's value-list twin table
// (table.growth-twin, M6.08) carries a ~1,632px min-content;
// that min-content propagated through its overflow-x:auto
// wrap into the Growth panel, a .side grid item, and .side's
// single implicit AUTO column sized to it — every panel in
// the column inherited the blown 1,632px track inside a
// 466px aside. The wrap's own overflow-x: auto never engaged.
//
// The fix caps the tracks the min-content was sizing. First
// driver (1280 evidence): .side's track is capped at the
// aside's own width — grid-template-columns: minmax(0, 1fr) —
// so each panel sizes to the track and the twin table scrolls
// inside its wrap, as designed. The table itself is SUPPOSED
// to be wide (nowrap cells, a full value list); nothing about
// it changes. Second driver (390 evidence, same defect): the
// single-column .layout-grid tracks in the <=900px and
// <=480px blocks were a bare 1fr — an fr track's automatic
// minimum is the widest item's min-content, and the stage
// panel's is ~765px (the portrait strip's no-wrap row at
// phone widths), so the track grew past the viewport and the
// sideways scroll survived the .side cap on phones. Those
// tracks are capped minmax(0, 1fr) too; the desktop tracks
// already carried definite minima (minmax(0, 1.6fr) and
// minmax(300px, 1fr)) and are pinned here so they keep them.
//
// The verification gap this pin exists to close: no suite
// ever measured document scrollWidth at the supported
// widths. The M6.15 responsive work (accessibility.test.mjs
// X4) checked touch targets, the fitting canvas, and the
// scrolling strip — never the page's own width; every other
// app test reads logic or source, and this suite has no
// layout engine. So the geometry proof (scrollWidth ==
// clientWidth at 1280 and 390, at rest and with an episode
// playing, pre-fix REAL and post-fix clean) lives in the
// regression harness manifests — captures-overflow-r7-
// seq684.json (pre) and captures-overflow-fix-seq*.json
// (post), build/visual/regression/shots/2026-11-03/ — and
// THIS file pins the shipped source so the blowout pattern
// cannot silently return between harness runs: remove the
// track cap (or the wrap's internal scroll) and this fails.
//
// Run per file: node --test test/layout-overflow.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// Every rule whose selector list is exactly `.side`.
function sideRules(source) {
  return [...source.matchAll(/\.side\s*\{([^}]*)\}/g)].map((m) => m[1]);
}

test('side column: exactly one .side rule, and its track is capped at the aside width', () => {
  const rules = sideRules(css);
  assert.equal(rules.length, 1, 'exactly one .side rule ships (a second could silently re-open the track)');
  assert.match(rules[0], /display:\s*grid/, '.side is the panels grid');
  assert.match(
    rules[0],
    /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    'the side track is minmax(0, 1fr) — capped at the aside width, never sized by panel min-content',
  );
});

test('side column: no rule anywhere re-opens the side track to content size', () => {
  // Any later .side grid-template-columns declaration that is
  // not the capped form (e.g. an implicit auto track, or a
  // minmax with an auto/content minimum) reintroduces the
  // blowout; the cascade would take the later rule.
  const decls = [...css.matchAll(/\.side\s*\{[^}]*grid-template-columns:\s*([^;}]+)/g)].map((m) => m[1].trim());
  assert.ok(decls.length >= 1, 'the cap declaration is present');
  for (const d of decls) {
    assert.equal(d, 'minmax(0, 1fr)', `side track declaration is the capped form, not: ${d}`);
  }
});

test('layout grid: every shipped track carries a definite minimum (no bare fr / auto track)', () => {
  // A grid-template-columns declaration on .layout-grid whose
  // track minimum is automatic (a bare `1fr`, `auto`, or a
  // minmax with an auto/content minimum) lets the widest
  // item's min-content size the track — the blowout pattern,
  // in whichever column or media block it returns.
  const decls = [...css.matchAll(/\.layout-grid\s*\{[^}]*grid-template-columns:\s*([^;}]+)/g)].map((m) => m[1].trim());
  assert.ok(decls.length >= 3, `the base rule and both media blocks ship a layout-grid track (found ${decls.length})`);
  for (const d of decls) {
    const tracks = d.match(/minmax\([^)]*\)|\S+/g) || [];
    for (const t of tracks) {
      assert.match(t, /^minmax\(\s*(0|\d+(?:\.\d+)?(?:px|rem|em))\s*,/, `track "${t}" in "${d}" has a definite minimum`);
    }
  }
});

test('growth twin: the internal scroll the fix relies on still ships', () => {
  const wrap = css.match(/\.growth-twin-wrap\s*\{([^}]*)\}/);
  assert.ok(wrap, '.growth-twin-wrap rule exists');
  assert.match(wrap[1], /overflow-x:\s*auto/, 'the twin wrap scrolls internally — the design the track cap restores');
  // The table stays wide by design: nowrap cells are the
  // min-content driver, and the fix deliberately leaves them
  // alone (the wrap scrolls the table; nothing truncates it).
  const cells = css.match(/\.growth-twin th, \.growth-twin td\s*\{([^}]*)\}/);
  assert.ok(cells, '.growth-twin cell rule exists');
  assert.match(cells[1], /white-space:\s*nowrap/, 'twin cells stay nowrap — the wide table is by design');
});
