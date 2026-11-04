// welcome-about.test.mjs — M6.12: the first-visit overlay + About
// completion. The fresh-profile test at the model level: a storage
// with no flag shows the card; either working button (or Close)
// dismisses it onto the diorama and marks the browser; a second
// visit shows none; About re-opens it on demand. The words are
// pinned: the three facts are UX §7.1's verbatim, the small print
// is M5.12's ONBOARDING_SMALL_PRINT consumed from disclosures.mjs
// (never re-drafted), and the attribution roll carries every
// licence family the ASSETS.md roll records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WELCOME_STORAGE_KEY, WELCOME_HEADING, WELCOME_FACTS, WELCOME_DISMISS_HINT,
  welcomeSeen, markWelcomeSeen, welcomeOverlayHtml,
  ATTRIBUTIONS, attributionsHtml, escapeHtml,
} from '../logic.mjs';
import { ONBOARDING_SMALL_PRINT } from '../disclosures.mjs';

const fakeStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
};

test('M6.12 fresh profile: overlay once, both buttons present, dismissal marks, second visit none', () => {
  const storage = fakeStorage();
  // First visit: not seen → the card shows.
  assert.equal(welcomeSeen(storage), false);
  const html = welcomeOverlayHtml();
  assert.ok(html.includes(WELCOME_HEADING));
  for (const fact of WELCOME_FACTS) assert.ok(html.includes(escapeHtml(fact)), 'every fact renders (in its escaped form, as every house builder emits)');
  assert.ok(html.includes('data-welcome-mayor'), '[Follow the Mayor] is a working button in the card');
  assert.ok(html.includes('data-welcome-awake'), '[See who is awake] is a working button in the card');
  assert.ok(html.includes('data-welcome-close'), 'a plain Close dismisses');
  // Dismissal (any of the three paths calls the same mark).
  markWelcomeSeen(storage);
  assert.equal(storage.map.get(WELCOME_STORAGE_KEY), '1');
  // Second visit: seen → no overlay.
  assert.equal(welcomeSeen(storage), true);
  // The dismissal hint is the design's one-time text, verbatim.
  assert.equal(WELCOME_DISMISS_HINT, 'Start with a face: tap a portrait to see what they are doing.');
});

test('M6.12 storage discipline: broken or absent storage never throws and never suppresses the card', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(welcomeSeen(broken), false);
  assert.doesNotThrow(() => markWelcomeSeen(broken));
  assert.equal(welcomeSeen(null), false);
  assert.doesNotThrow(() => markWelcomeSeen(undefined));
});

test('M6.12 the three facts are UX §7.1 verbatim, and the small print is M5.12\'s source, not a re-draft', () => {
  assert.equal(WELCOME_FACTS[0], 'These are real citizens. Ember is a town where AI citizens live, work, and govern themselves. Nobody is acting a part for you, and Portal invents nobody.');
  assert.equal(WELCOME_FACTS[1], 'You are half a minute behind. Portal shows the town\'s public record, about 30 seconds behind the real town.');
  assert.equal(WELCOME_FACTS[2], 'Tap anyone to follow them. A citizen, a building, or a news item — or start here:');
  const html = welcomeOverlayHtml();
  assert.ok(html.includes(escapeHtml(ONBOARDING_SMALL_PRINT)), 'the overlay carries disclosures.mjs\'s small print — the same words, in the escaped form every house builder emits');
});

test('M6.12 attributions: the full licence roll — CC0 packs, game-icons CC BY 3.0, Lora OFL, Three.js MIT', () => {
  const licences = ATTRIBUTIONS.map((a) => a.licence).join(' | ');
  assert.ok(licences.includes('CC0 1.0'), 'the CC0 packs are credited');
  const icons = ATTRIBUTIONS.find((a) => a.credit.includes('game-icons.net'));
  assert.ok(icons && icons.licence.startsWith('CC BY 3.0'), 'the one attribution obligation is named as such');
  assert.ok(ATTRIBUTIONS.some((a) => a.credit.includes('Lora') && a.licence.includes('Open Font License')), 'Lora OFL');
  assert.ok(ATTRIBUTIONS.some((a) => a.credit.includes('Three.js') && a.licence.includes('MIT')), 'Three.js MIT');
  const html = attributionsHtml();
  for (const a of ATTRIBUTIONS) {
    assert.ok(html.includes(escapeHtml(a.what)) && html.includes(escapeHtml(a.credit)) && html.includes(escapeHtml(a.licence)), `row renders whole: ${a.what}`);
  }
});

test('M6.12 wiring census: overlay, re-open, attributions and the hint live in the page', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(html.includes('id="welcome-overlay"'), 'the overlay mount exists');
  assert.ok(html.includes('id="new-here"'), 'About carries the re-open button');
  assert.ok(html.includes('id="attributions"'), 'About carries the credit roll mount');
  assert.ok(html.includes('id="strip-hint"'), 'the strip carries the dismissal hint mount');
  assert.ok(src.includes('welcomeSeen(window.localStorage)'), 'the once-per-browser check runs on first render');
  assert.ok(src.includes('markWelcomeSeen(window.localStorage)'), 'dismissal marks the browser');
  assert.ok(src.includes('mayorKeyOf(state.bundle)'), '[Follow the Mayor] follows by office');
  assert.ok(src.includes('attributionsHtml()'), 'the roll renders from the data table');
});
