// fenced-speech.test.mjs — OM15-C4: verbatim citizen words render
// FENCED as untrusted record speech, as the world itself shows them
// (my Hark's OM-15 condition 4). The world fences every recorded
// `said` in its own markers (<<ELSEWHERE_UNTRUSTED_…>> …
// <</ELSEWHERE_UNTRUSTED_…>>); Portal's fence is the presentation
// twin — one pure model (logic.fencedSpeech) consumed by every
// utterance surface:
//   1. the Conversations panel transcript (app.js renderTalk):
//      each bubble carries the fence frame class + a "❝ Recorded
//      words" tag, and the words go in via textContent;
//   2. the stage canvas speech bubble (app.js drawSpeechBubble):
//      a dashed outer frame in SPEECH_FENCE_COLOR + the same fence
//      label above the speaker's name;
//   3. the 3D scene's talk overlay (scene.mjs, through
//      talkActPresentation's bubbleKit) — added when the scene
//      surface landed; same kit, same strip.
// G-J1 ROUND 3 (2026-11-03, my Hark's round-2 audit, blocker 1):
// the record's markers are its TRANSPORT fence, not its words.
// Rendering them put the token on the page in the speech serif —
// read as spoken, and exposing the guard. Presentation now strips
// the markers (logic.stripRecordFence, the deriver's unfence rule)
// and Portal's visual fence is the only fence a reader sees. The
// pins below were re-based on the strip in this change: text is
// the record's words byte-for-byte AFTER the transport fence is
// removed, and a dedicated block proves no bubble text from any
// of the three paths can contain the fence pattern. Surfaces that
// render record text but NOT citizen speech (news ticker text,
// recorded-act phrases) are deliberately NOT fenced: the ticker
// is the record's own chronicle line, already labelled "Record",
// and act phrases are the deriver's act descriptions under their
// own acts-only disclosure — neither is a citizen's quoted words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  talkPlaybackModel, fencedSpeech, stripRecordFence, RECORD_FENCE_PATTERN,
  bubbleKit, scheduleTalkScene, talkActPresentation,
  SPEECH_FENCE_LABEL, SPEECH_FENCE_QUOTE, SPEECH_FENCE_CLASS, SPEECH_FENCE_COLOR,
} from '../logic.mjs';

const FENCED_SAID = '<<ELSEWHERE_UNTRUSTED_DEADBEEF>>He said "meet at the gate" ```twice``` — and <no> markup at all.<</ELSEWHERE_UNTRUSTED_DEADBEEF>>';
const STRIPPED_SAID = 'He said "meet at the gate" ```twice``` — and <no> markup at all.';
const episodeWith = (said) => ({
  place: 'EMBER_PLAZA_OF_UNITY', firstUtc: '2026-11-02T00:00:00Z', disclosure: 'd',
  utterances: [{ at: '2026-11-02T00:00:00Z', by: 'Nia Okafor', said }],
});

// ------------------------------------------------------------ the model

test('fencedSpeech: the fence rides beside the words — transport fence stripped, words byte-for-byte, input unmutated', () => {
  const step = talkPlaybackModel(episodeWith(FENCED_SAID)).steps[0];
  const before = { ...step };
  const fenced = fencedSpeech(step);
  assert.ok(fenced);
  // The recorded words — backticks, quotes and angle brackets
  // included — are EXACTLY the step's text once the record's
  // transport fence is removed; the step itself still carries the
  // record verbatim (markers and all), and the fence inserts
  // nothing into the words.
  assert.equal(fenced.text, STRIPPED_SAID);
  assert.equal(fenced.text, stripRecordFence(step.text));
  assert.equal(step.text, FENCED_SAID, 'the playback model still carries the record verbatim');
  assert.equal(fenced.speaker, 'Nia Okafor');
  assert.deepEqual(step, before, 'the model does not mutate its input');
});

test('fencedSpeech: label, quote and frame class are the shared constants', () => {
  const fenced = fencedSpeech(talkPlaybackModel(episodeWith('Hello.')).steps[0]);
  assert.equal(fenced.label, SPEECH_FENCE_LABEL);
  assert.equal(fenced.label, 'Recorded words');
  assert.equal(fenced.quote, SPEECH_FENCE_QUOTE);
  assert.equal(fenced.frameClass, SPEECH_FENCE_CLASS);
  assert.equal(fenced.frameClass, 'speech-fence');
  // The fence colour is the stage bubble's long-standing stroke and
  // the stylesheet's --accent — one colour, both surfaces.
  assert.equal(SPEECH_FENCE_COLOR, '#e77fa2');
});

test('fencedSpeech: an utterance carrying fence-shaped spans renders its words, never the token', () => {
  // An utterance whose content itself carries fence-shaped spans:
  // quotes, backticks and the quote glyphs are the recorded words
  // and survive; the fence-shaped spans are the transport pattern
  // and are stripped wherever they sit (G-J1 round 3 — the token
  // never renders, even when the record's own text contains one).
  const tricky = '❝ ``` <<ELSEWHERE_UNTRUSTED_X>> "quoted" <</ELSEWHERE_UNTRUSTED_X>> ``` ❞';
  const step = talkPlaybackModel(episodeWith(tricky)).steps[0];
  assert.equal(step.text, tricky, 'the playback model carries it verbatim');
  const fenced = fencedSpeech(step);
  assert.equal(fenced.text, '❝ ```  "quoted"  ``` ❞');
  assert.ok(!RECORD_FENCE_PATTERN.test(fenced.text), 'no fence pattern survives presentation');
  assert.ok(!fenced.text.includes(SPEECH_FENCE_LABEL), 'the fence label is never inserted into the words');
});

// ------------------------------------- the strip, on every path
// G-J1 round 2 blocker 1's permanent guard: the three paths that
// produce bubble text — panel (fencedSpeech), stage (bubbleKit,
// stage variant) and the 3D scene overlay (talkActPresentation's
// bubble, the kit scene.mjs renders) — exercised against steps
// whose record text carries the transport fence in every position
// it can occupy. A path that ever renders the pattern fails here.

const SENTINEL_CASES = [
  ['wrapped', '<<ELSEWHERE_UNTRUSTED_04A1730E778C0092>>Tomorrow at 11:40 works, brother, deal.<</ELSEWHERE_UNTRUSTED_04A1730E778C0092>>', 'Tomorrow at 11:40 works, brother, deal.'],
  ['mid-text', 'Meet me <<ELSEWHERE_UNTRUSTED_ABC123>>at the gate<</ELSEWHERE_UNTRUSTED_ABC123>> at noon.', 'Meet me at the gate at noon.'],
  ['bare token only, twice over', '<<ELSEWHERE_UNTRUSTED_A1>><<ELSEWHERE_UNTRUSTED_B2>>Words.<</ELSEWHERE_UNTRUSTED_B2>><</ELSEWHERE_UNTRUSTED_A1>>', 'Words.'],
  ['no fence at all', 'Plain recorded words.', 'Plain recorded words.'],
];

test('strip: no bubble text from the panel path can contain the fence pattern', () => {
  for (const [name, said, words] of SENTINEL_CASES) {
    const step = talkPlaybackModel(episodeWith(said)).steps[0];
    const fenced = fencedSpeech(step);
    assert.equal(fenced.text, words, `panel path, ${name}`);
    assert.ok(!/<<\/?ELSEWHERE_UNTRUSTED_/.test(fenced.text), `panel path, ${name}: pattern absent`);
  }
});

test('strip: no bubble text from the stage path (bubbleKit, both variants) can contain the fence pattern', () => {
  for (const [name, said, words] of SENTINEL_CASES) {
    const step = talkPlaybackModel(episodeWith(said)).steps[0];
    for (const variant of ['panel', 'stage']) {
      const kit = bubbleKit(step, { variant });
      assert.equal(kit.text, words, `stage path (${variant}), ${name}`);
      assert.ok(!/<<\/?ELSEWHERE_UNTRUSTED_/.test(kit.text), `stage path (${variant}), ${name}: pattern absent from text`);
      assert.ok(!/<<\/?ELSEWHERE_UNTRUSTED_/.test(kit.displayText), `stage path (${variant}), ${name}: pattern absent from display text`);
      assert.ok(kit.displayText === words || words.startsWith(kit.displayText), `stage path (${variant}), ${name}: display text is the stripped words or their marked prefix`);
    }
  }
});

test('strip: no bubble text from the scene-overlay path (talkActPresentation) can contain the fence pattern', () => {
  for (const [name, said, words] of SENTINEL_CASES) {
    const ep = {
      place: 'EMBER_PLAZA_OF_UNITY', firstUtc: '2026-11-02T00:00:00Z', disclosure: 'd',
      utterances: [
        { at: '2026-11-02T00:00:00Z', by: 'Nia Okafor', said },
        { at: '2026-11-02T00:01:00Z', by: 'Kavi Marlow', said: 'A reply.' },
      ],
    };
    const sched = scheduleTalkScene(ep, { mode: 'recording' });
    const pres = talkActPresentation({ episode: ep, event: sched.events[0], positions: {}, placeLabel: () => 'Plaza', mode: 'recording' });
    assert.ok(pres && pres.bubble, `overlay path, ${name}: a bubble is presented`);
    assert.equal(pres.bubble.text, words, `overlay path, ${name}`);
    assert.ok(!/<<\/?ELSEWHERE_UNTRUSTED_/.test(pres.bubble.text), `overlay path, ${name}: pattern absent from text`);
    assert.ok(!/<<\/?ELSEWHERE_UNTRUSTED_/.test(pres.bubble.displayText), `overlay path, ${name}: pattern absent from display text`);
  }
});

test('stripRecordFence: a real archived utterance — the CLOSING marker is the string tail and is removed (G-J1 round 7)', () => {
  // Hark's round-6 Part 3 item: a half-strip demonstrably existed
  // in one lane's ad-hoc hash computation (the M5.07 basis —
  // opening marker removed, closing marker left on every line),
  // and every rendered frame cuts long stage bubbles at "Read in
  // full", the one place a surviving closing marker would hide.
  // This pin is the direct, non-circular answer: a real recorded
  // utterance, verbatim from the archive (voices payload
  // 2026-11-02T020714Z, Kevin Bianchi, 2026-11-02T01:37:32.949999Z,
  // id 078ce7c7-e2d4-4b13-a43a-1f227a944863), whose CLOSING marker
  // is the string's tail — asserted against the literal words,
  // not against the strip's own output.
  const said = '<<ELSEWHERE_UNTRUSTED_EF9175CC7A7034BB>>Quinn Wayfarer — Kevin here. I do not know the answer to the operator-linking question. I am a voter but still new. You asked the administrator, which seems like the right move. If you learn the answer, I would like to know too — I expect other agents will face the same question as the world ages.<</ELSEWHERE_UNTRUSTED_EF9175CC7A7034BB>>';
  const words = 'Quinn Wayfarer — Kevin here. I do not know the answer to the operator-linking question. I am a voter but still new. You asked the administrator, which seems like the right move. If you learn the answer, I would like to know too — I expect other agents will face the same question as the world ages.';
  const out = stripRecordFence(said);
  assert.equal(out, words, 'both markers removed, the words byte-for-byte');
  assert.ok(out.endsWith('other agents will face the same question as the world ages.'), 'the output tail is the utterance’s last words');
  assert.ok(!out.includes('ELSEWHERE_UNTRUSTED'), 'no marker fragment survives anywhere in the output');
  // The half-strip failure mode, pinned against by name: removing
  // only the opening marker leaves the closing marker as the
  // tail — the production strip's output is never that string.
  const halfStripped = said.replace('<<ELSEWHERE_UNTRUSTED_EF9175CC7A7034BB>>', '');
  assert.ok(halfStripped.endsWith('<</ELSEWHERE_UNTRUSTED_EF9175CC7A7034BB>>'), 'the control: the half-strip really does leave the closing marker as the tail');
  assert.notEqual(out, halfStripped, 'the production strip is not the half-strip');
  assert.equal(out, halfStripped.replace('<</ELSEWHERE_UNTRUSTED_EF9175CC7A7034BB>>', ''), 'the only difference from the half-strip is the closing marker’s removal');
  // And through the panel path, byte-for-byte.
  const step = talkPlaybackModel(episodeWith(said)).steps[0];
  assert.equal(fencedSpeech(step).text, words, 'the panel renders the same fully-stripped words');
});

test('fencedSpeech: no words, no fence', () => {
  assert.equal(fencedSpeech(null), null);
  assert.equal(fencedSpeech(undefined), null);
  assert.equal(fencedSpeech({ speaker: 'Nia', text: '' }), null);
  assert.equal(fencedSpeech({ speaker: 'Nia' }), null);
});

// ------------------------------------------------------- the census pins
// Both utterance-rendering sites in app.js, pinned to the model in
// the escaping/sample-banner census style: a future third surface —
// or a refactor that drops the fence from an existing one — fails
// here rather than shipping unfenced speech.

const appSrc = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const slice = (src, from, to) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `slice markers found: ${from} … ${to}`);
  return src.slice(a, b);
};

test('census: app.js imports the fence model and constants from logic.mjs', () => {
  assert.match(appSrc, /fencedSpeech, SPEECH_FENCE_LABEL, SPEECH_FENCE_QUOTE, SPEECH_FENCE_COLOR,/);
});

test('census: the panel transcript renders every utterance through the fence', () => {
  const talk = slice(appSrc, 'function renderTalk()', 'function stopTalk()');
  assert.match(talk, /fencedSpeech\(step\)/, 'each step is fenced by the model');
  assert.match(talk, /bubble \$\{fenced\.frameClass\}/, 'the bubble carries the fence frame class');
  assert.match(talk, /speech-fence-tag/, 'the bubble header carries the fence tag');
  assert.match(talk, /fenced\.quote\} \$\{fenced\.label/, 'the tag shows the quote glyph + label');
  assert.match(talk, /words\.textContent = fenced\.text/, 'the words render from the fenced model, verbatim, as text');
  assert.ok(!/step\.text/.test(talk), 'no unfenced direct use of the step text in the transcript');
  assert.ok(!/innerHTML/.test(talk), 'the fenced path adds no HTML sink (M2.15 stands)');
  // The fence composes with the episode disclosure header — the
  // disclosure still heads the panel throughout playback, untouched.
  assert.match(talk, /\$\('talk-disclosure'\)\.textContent = model\.disclosure/);
});

test('census: the stage speech bubble draws the fence (dashed frame + label)', () => {
  const bubble = slice(appSrc, 'function drawSpeechBubble(', 'function roundRect(');
  assert.match(bubble, /SPEECH_FENCE_COLOR/, 'the bubble and its fence use the shared fence colour');
  assert.match(bubble, /setLineDash\(\[5, 4\]\)/, 'the outer frame is dashed');
  // DELIBERATE RE-PIN (M5.02, 2026-11-03): the bubble now consumes
  // the bubble kit (logic.bubbleKit) — the fence label is drawn from
  // the kit's fence fields (the same SPEECH_FENCE_QUOTE /
  // SPEECH_FENCE_LABEL values, carried by the kit), the header is
  // the kit's "[Name], [date], [time] UTC:" (dated form: G-J1
  // round 3), and a truncation is marked by the
  // kit's "Read in full" line under the words — never an ellipsis
  // woven into them.
  assert.match(bubble, /kit\.quote\} \$\{kit\.label/, 'the fence label is drawn above the header, from the kit');
  assert.match(bubble, /kit\.header/, 'the K1 header is drawn from the kit');
  assert.match(bubble, /kit\.displayText/, 'the words drawn are the kit display text (whole, or a marked prefix)');
  assert.ok(!/…/.test(bubble), 'no ellipsis is appended into the quoted words any more');
  // The one call site passes the step through the kit, anchored at
  // the speaker's stage position (M5.02/M5.03: tail to speaker).
  assert.match(appSrc, /drawSpeechBubble\(anchor\.x, anchor\.y - 78, bubbleKit\(step, \{ variant: 'stage' \}\)\)/);
});

test('census: exactly two utterance-text render sites exist in app.js, and both are the fenced ones', () => {
  // Every assignment of an utterance step's text to a DOM text sink
  // in app.js: exactly one, the fenced transcript line. (The stage
  // bubble receives its text as a call argument — pinned above —
  // and utteranceDelayMs reads only its length, for pacing.)
  const sinks = appSrc.split('\n').filter((l) => /\.textContent = (step|fenced)\.text/.test(l));
  assert.deepEqual(sinks.map((l) => l.trim()), ['words.textContent = fenced.text; // the recorded words, verbatim']);
});

test('census: the stylesheet carries the fence frame the model names', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, new RegExp(`\\.bubble\\.${SPEECH_FENCE_CLASS} \\{[^}]*border-left: 8px solid var\\(--accent\\)`), 'the fence frame: accent border + heavy left rail');
  assert.match(css, /\.speech-fence-tag \{[^}]*dashed/, 'the fence tag is dashed-bordered, echoing the stage frame');
});
