// Elsewhere Portal — the M5.07 talk acceptance gate, as a runnable
// cold verification.
//
// The gate replays the recorded evening of 2026-11-01 (the fixture
// generated from the archived Wave 1 snapshots) through the ONE
// talk model and checks the plan's clauses against the ARCHIVE
// itself — not against the fixture's say-so. Every clause returns
// its own verdict with its evidence; the gate's overall verdict is
// the worst clause's, stated plainly.
//
// One clause stood in plan-internal conflict at the gate's first
// filing (2026-11-03): M5.01's law capped a scene at 90 s and
// summarised the tail as counts; the storytelling scene's
// recorded words run ≈137 s at that law's pacing, so Atlas's
// 23:12 utterance — the scene's last — was reached in order and
// summarised (his name and count in the pointer), not rendered
// as a bubble. The gate REPORTED the conflict rather than
// resolving it, and the project owner ruled the same day: "Acceptance
// replays play in full — the 90-second cap governs live scenes
// only." The gate therefore schedules the replay in recording
// mode, as every replay now does; the cap's live letter stands
// untouched and is positive-controlled in the talk-system suite.
// The first filing's record (M5.07-GATE.md) keeps the conflict
// and its arithmetic; this runner's verdict is the ruled one.
//
// Amendment (G-J1 round 3, 2026-11-03): the two byte-equality
// clauses (bubbles-in-order-verbatim, atlas-speaks-2312) now
// compare bubble text against the archived utterance's WORDS —
// the said inside its transport fence — because presentation
// strips the record's fence markers on every surface (my Hark's
// G-J1 round-2 blocker 1: the token was rendering as speech).
// The words protected by the clauses are unchanged; the data-
// layer fidelity clause (fixture vs archive, markers included)
// is untouched. Recorded in M5.07-GATE.md.
//
// Usage: node m5.07-gate.mjs   (exit 0 = pass, 1 = any clause short)

import { readFileSync } from 'node:fs';

const {
  scheduleTalkScene, scheduleTalkScenes, bubbleKit, episodeKeyOf, stripRecordFence,
} = await import('../../app/logic.mjs');
const { deriveEpisodes } = await import('../../data/episodes.mjs');
const { planJourney } = await import('../../engine/playback.mjs');
const { buildTalkTimeline, sceneTalkAct } = await import('./talk-state.mjs');
const { buildStagings } = await import('./stagings.mjs');
const { buildEveningFixture } = await import('./gen-evening-fixture.mjs');

const ARCHIVE = new URL('../../data/archive/2026-11-02/', import.meta.url);
const voices = JSON.parse(readFileSync(new URL('voices-20261102T020714Z.json', ARCHIVE), 'utf8'));
const news = JSON.parse(readFileSync(new URL('news-20261102T020713Z.json', ARCHIVE), 'utf8'));
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/evening-2026-11-01.json', import.meta.url), 'utf8'));
const REGISTRY = JSON.parse(readFileSync(new URL('./interior-kits.json', import.meta.url), 'utf8'));

export function runGate() {
  const clauses = [];
  const clause = (id, verdict, evidence) => clauses.push({ id, verdict, evidence });

  // 1 — fixture fidelity, cold-read against the archive.
  {
    const byId = new Map();
    for (const p of voices.places) for (const u of p.said) byId.set(u.id, u);
    let checked = 0; let mismatch = 0;
    for (const ep of Object.values(FIXTURE.episodes)) {
      if (!ep) continue;
      for (const u of ep.utterances) {
        const a = byId.get(u.id);
        if (!a || a.said !== u.said || a.by !== u.by || a.at !== u.at) mismatch++;
        else checked++;
      }
    }
    const fresh = JSON.stringify(buildEveningFixture(), null, 1) + '\n';
    const onDisk = readFileSync(new URL('./fixtures/evening-2026-11-01.json', import.meta.url), 'utf8');
    clause('fixture-fidelity', mismatch === 0 && fresh === onDisk ? 'pass' : 'fail',
      `${checked} fixture utterances byte-identical to the archived voices payload; `
      + `fixture file ${fresh === onDisk ? 'equals' : 'DIFFERS FROM'} a fresh generation from the archive.`);
  }

  // 2 — the data layer's own derivation agrees with the fixture.
  {
    const derived = deriveEpisodes(voices, news);
    const lec = derived.find((e) => e.place === 'EMBER_COLLEGE');
    const sto = derived.find((e) => e.place === 'EMBER_PLAZA_OF_UNITY' && e.firstUtc.startsWith('2026-11-01T22:'));
    const ok = lec && sto
      && lec.utteranceCount === FIXTURE.episodes.lecture.utterances.length
      && sto.utteranceCount === FIXTURE.episodes.storytelling.utterances.length
      && JSON.stringify(lec.participants) === JSON.stringify(FIXTURE.episodes.lecture.participants)
      && JSON.stringify(sto.participants) === JSON.stringify(FIXTURE.episodes.storytelling.participants);
    clause('derivation-agreement', ok ? 'pass' : 'fail',
      `deriveEpisodes over the archived snapshots yields the lecture (${lec?.utteranceCount} utterances) `
      + `and the storytelling (${sto?.utteranceCount}) with the fixture's participants and windows.`);
  }

  // 3 — storytelling bubbles: in recorded order, byte-equal.
  // The gate is an acceptance REPLAY: recording mode (M5.07
  // ruling) — the whole scene plays, no summarised tail.
  // BYTE-EQUALITY, RE-BASED (G-J1 round 3, 2026-11-03 — my Hark's
  // round-2 blocker 1): a bubble's text is byte-equal to the
  // archived utterance's WORDS — the said inside its transport
  // fence. The record's fence markers are its transport wrapper,
  // stripped at presentation on every surface; they were never
  // part of the words this clause protects. (Clause 1 still
  // compares the fixture's said to the archive's said byte-for-
  // byte at the data layer, markers and all — that fidelity is
  // untouched.) The re-basing is recorded in M5.07-GATE.md.
  const storyScene = scheduleTalkScene(FIXTURE.episodes.storytelling, { mode: 'recording' });
  {
    const archived = FIXTURE.episodes.storytelling.utterances;
    let verbatim = true;
    for (const ev of storyScene.events) {
      const kit = bubbleKit({ at: ev.at, speaker: ev.speaker, text: ev.text });
      if (!kit || kit.text !== stripRecordFence(archived[ev.index].said)) verbatim = false;
    }
    const ordered = storyScene.events.every((ev, i) => i === 0 || ev.at > storyScene.events[i - 1].at);
    const accounted = storyScene.events.length + (storyScene.summary?.remainingCount || 0);
    clause('bubbles-in-order-verbatim', verbatim && ordered && accounted === archived.length ? 'pass' : 'fail',
      `${storyScene.events.length} bubbles rendered in recorded order, each byte-equal to the archived `
      + `utterance's words (transport fence stripped at presentation, G-J1 round 3); played + summarised = ${accounted} of ${archived.length} — none lost, none invented.`);
  }

  // 4 — Atlas's arrival: the record's legs, before his first Plaza word.
  {
    const j = FIXTURE.arrival.journey;
    const plan = planJourney({ handle: j.handle, path: j.path, startTick: j.startTick, ticksPerStep: j.ticksPerStep });
    const plazaStep = plan.steps.find((s) => s.to === 'EMBER_PLAZA_OF_UNITY');
    const atlasPlaza = FIXTURE.episodes.storytelling.utterances.filter((u) => u.by === 'Atlas Meridian');
    const collegeLast = [...FIXTURE.episodes.lecture.utterances].reverse().find((u) => u.by === 'Atlas Meridian');
    const ok = !!plazaStep && atlasPlaza.length === 1
      && atlasPlaza[0].at === FIXTURE.arrival.atlasPlazaUtteranceUtc
      && collegeLast && collegeLast.at < atlasPlaza[0].at;
    clause('atlas-arrival', ok ? 'pass' : 'fail',
      `The record places Atlas last at the College lecture (${collegeLast?.at}) and his only Plaza utterance `
      + `of the gathering is at ${atlasPlaza[0]?.at}; the journey record (demo fixture: ${j.path.join(' → ')}) `
      + `walks him to the Plaza before it — arrival precedes his first word there. Basis stated: the legs are `
      + `the demo fixture's (a staging input, per its own note), the instants are the archive's.`);
  }

  // 5 — Atlas speaks at 23:12: the clause that stood in conflict
  // at the first filing, now under the project owner's ruling (2026-11-03):
  // acceptance replays play in full. The scene is scheduled in
  // recording mode, so the clause passes exactly when Atlas's
  // words render as a bubble, byte-equal, with the scene
  // uncapped and pointerless despite running past 90 s.
  {
    const atlasEvent = storyScene.events.find((e) => e.speaker === 'Atlas Meridian');
    const archivedAtlas = FIXTURE.episodes.storytelling.utterances.find((u) => u.by === 'Atlas Meridian');
    const kit = atlasEvent ? bubbleKit({ at: atlasEvent.at, speaker: atlasEvent.speaker, text: atlasEvent.text }) : null;
    const totalMs = storyScene.events.reduce((a, e) => a + e.delayMs, 0);
    const ok = !!atlasEvent && !!kit && !!archivedAtlas
      && kit.text === stripRecordFence(archivedAtlas.said)
      && atlasEvent === storyScene.events[storyScene.events.length - 1]
      && storyScene.capped === false && storyScene.summary === null
      && totalMs > 90 * 1000;
    clause('atlas-speaks-2312', ok ? 'pass' : 'fail',
      ok
        ? `Atlas's 23:12:30 utterance — the scene's last — renders as a bubble, byte-equal to the `
          + `archive's words (transport fence stripped at presentation, G-J1 round 3), at the mandated pacing: the recording-mode scene plays all ${storyScene.events.length} `
          + `utterances over ${totalMs} ms (past the 90 s cap that governs live scenes only), uncapped, `
          + `with no summary pointer. Ruled by the project owner, 2026-11-03: acceptance replays play in full.`
        : `Atlas's 23:12:30 utterance does NOT render as a bubble under the ruling (event present: `
          + `${!!atlasEvent}; byte-equal: ${!!kit && !!archivedAtlas && kit.text === stripRecordFence(archivedAtlas.said)}; capped: `
          + `${storyScene.capped}; summary: ${storyScene.summary ? 'present' : 'null'}; played span `
          + `${totalMs} ms). Under the ruling this is a failure, not a conflict: a recording must play in full.`);
  }

  // 6 — dinner at 23:20: occasion rendered, zero bubbles.
  {
    const dinner = buildStagings(FIXTURE, REGISTRY).find((s) => s.kind === 'dinner');
    clause('dinner-2320', dinner.atUtc === '2026-11-01T23:20:00Z' && dinner.bubbleCount === 0 && dinner.talkScene === null ? 'pass' : 'fail',
      `The dinner staging stands at ${dinner.atUtc} in Meridian Hall with zero bubbles and zero figures: `
      + `no recorded words at Meridian Hall exist in the archive, so none are performed.`);
  }

  // 7 — both altitudes (M5.03's gate half, discharged here).
  {
    const timeline = buildTalkTimeline([FIXTURE.episodes.storytelling]);
    const first = timeline.scenes[0].events[0];
    const midMs = first.startMs + 1;
    const atScene = sceneTalkAct({ timeline, elapsedMs: midMs, altitude: 'scene', placeLabel: 'the Plaza of Unity', mode: 'recording' });
    const atTown = sceneTalkAct({ timeline, elapsedMs: midMs, altitude: 'town', placeLabel: 'the Plaza of Unity', mode: 'recording' });
    const ok = !!atScene && !!atTown
      && atScene.bubble !== null && atScene.collapsed?.mode === 'bubbles'
      && atTown.bubble === null && atTown.collapsed?.mode === 'icon-caption'
      && typeof atTown.collapsed.caption === 'string' && atTown.collapsed.caption.includes(first.speaker);
    clause('both-altitudes', ok ? 'pass' : 'fail',
      `The fixture replays at scene altitude (bubble + 'bubbles' form) and collapses at town altitude `
      + `to icon + caption ("${atTown?.collapsed?.caption || 'none'}") with no bubble — M5.03's two altitudes, both honest.`);
  }

  // 8 — negative witness: feed withheld ⇒ zero bubbles.
  {
    const none = scheduleTalkScenes([], { mode: 'recording' });
    const emptyTimeline = buildTalkTimeline([]);
    const act = sceneTalkAct({ timeline: emptyTimeline, elapsedMs: 0, mode: 'recording' });
    const derivedNone = deriveEpisodes({}, null);
    clause('negative-witness', none.scenes.length === 0 && emptyTimeline.scenes.length === 0 && act === null && derivedNone.length === 0 ? 'pass' : 'fail',
      `With the voices feed withheld: the deriver yields no episodes, the scheduler no scenes, the `
      + `timeline no events, and the scene act at any instant is null — zero bubbles, by construction `
      + `and by run.`);
  }

  const worst = clauses.some((c) => c.verdict === 'fail') ? 'fail'
    : clauses.some((c) => c.verdict === 'conflict') ? 'conditional' : 'pass';
  return { clauses, verdict: worst };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { clauses, verdict } = runGate();
  for (const c of clauses) console.log(`[${c.verdict.toUpperCase()}] ${c.id} — ${c.evidence}`);
  console.log(`M5.07 GATE VERDICT: ${verdict.toUpperCase()}`);
  process.exit(verdict === 'fail' ? 1 : 0);
}
