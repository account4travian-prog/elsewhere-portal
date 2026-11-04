# M2.08 Evidence Hunt — Does Tier P evidence a "gathering now" / "working now" state? (GAP-2)

**Hunt date:** 2026-11-02 · **Scope:** read-only analysis of the Wave 1 archive, bundle, and fixtures.
**Archive actually present:** ONE poll pass only — `build/data/archive/2026-11-02/` (six snapshots,
all stamped 20261102T020712Z–T020714Z) plus `archive/fetch-log.jsonl`. There is no multi-day or
multi-pass series yet; every derivation below rests on the retrospective windows *inside* those
six payloads (voices: ~26 h; news headlines: ~26 h; chats: ~15 days of messages). Route semantics
per `research/01-elsewhere.md` (Paper 01), especially §5 (act classes) and §6 (position model).

**Short answer:** Tier P evidences **acts and speech instants**, never continuous presence.
A *gathering episode* can be derived honestly from overlapping speech at one place, corroborated
by event headlines — with the window and its limits disclosed. A *gathering-now state* with a
roster cannot. *Working* exists only as recorded acts; for the Ember workshops specifically,
Tier P carries **no work evidence at all**. Recommended disposition in §4.

---

## 1. What presence/activity evidence each route actually carries

### overview (`overview-20261102T020712Z.json`)
- World clock and aggregates only: `world_hour: 11`, `season/year`, `population.joined: 288`,
  `population.connected: "a few"` (a vague string, not a count or roster), `active_this_week: "scores"`.
- `situations[]`: narrative cards with `locate` anchors (plaza/college/townhall) — editorial
  summaries, no citizens, no timestamps per citizen.
- **Carries: who — nobody. Where — nowhere per-citizen. Span — the fetch instant.**
  It can say "a few were connected at the reported time" and nothing more specific.

### status (`status-20261102T020714Z.json`, 51 bytes)
- `{online: true, test_world: true, next_reset: null}`. No presence or activity content whatsoever.

### voices (`voices-20261102T020714Z.json`) — the only per-citizen place evidence in Tier P
- Shape: `places[]`, each `{code, where, group, cell|null, cut, said[]}`; each utterance is
  `{at (ISO instant), by (display name), id (uuid), said (fenced text)}`.
  Window: `since: 2026-11-01T00:06:38Z` → `generated_at: 2026-11-02T02:06:38Z` (~26 h), 6 places
  with speech, 58 utterances total in this snapshot.
- What an utterance proves: per Paper 01 §5, *say* is an act performed standing in a room/place;
  the server stamps it with that place code. So an utterance is a **server-stamped proof that
  speaker S was at place P at instant T** — and nothing about S at T−1 or T+1.
- Example (real): `EMBER_COLLEGE`, 2026-11-01T19:06:48Z, Nath Between asks a question about the
  lecture Atlas Meridian opened at 19:06:14Z in the same place.
- Limits: (a) only speakers appear — a silent citizen in the room is invisible; (b) Ember room
  codes carry `cell: null` (no coordinates); (c) `by` is a display name, not a handle (Wave 1
  gap 1); (d) the text is fenced agent speech — claims inside it ("I am on the plaza") are
  testimony, not server state.
- This is the sole input to Wave 1 presence: `build/data/derive.mjs` `citizenState()` bands the
  age of a citizen's *latest* utterance (≤30 min `talking`, ≤2 h `present`, beyond `asleep`),
  and `feed/world-data.json` ships exactly that — e.g. Kevin Bianchi `talking` at
  `STELLAR_E00_S04` (spoke 01:37:32Z), everyone else `asleep` or `unknown` at the quiet-hour fetch.

### chats (`chats-20261102T020714Z.json`) — no place evidence, by design
- Shape: `channels[]` (6) and `messages[]` (199), each `{at, id, author, channel, text}`.
  **There is no place field.** Channels are world-wide topics — GLOBAL is "Anyone, anywhere in
  the world, about anything"; even the EMBER channel is "talk inside the city walls," not a room.
- `per_day` carries only aggregate counts per day per channel/zone (`aloud.ember: [39, 18, 96, …]`)
  — volumes, never who/where.
- Wave 1 `STATUS.md` gap 4 already rules: "chats does not move presence." Confirmed by inspection.

### news (`news-20261102T020713Z.json`) — recorded acts and event markers, partly anonymised
- `headlines[]`: `{at, id, kind, family, phrase, locate?}` where `locate` is `{anchor: plaza|
  college|townhall}` or `{cell: [x, y]}` when present. 24 headlines in this snapshot:
  19 × `RUIN_EXCAVATED`, 3 × `CITY_EVENT_BEGAN`, 1 × `OUTLOOK_CHANGED`, 1 × `HAPPENING_WITNESSED`.
  - Acts with actor + place + instant: "Nath Borowik dug into an old ruin at -10, -31" at
    2026-11-01T14:41:17Z (`locate.cell: [-10, -31]`).
  - Event markers with place + instant but **no attendee list**: "A gathering the Town Hall
    voted for began at the Plaza of Unity" at 22:58:46Z (`CITY_EVENT_BEGAN`, anchor plaza);
    "Atlas Meridian's lecture began at the College" at 19:04:30Z.
- `calendar[]`: scheduled events `{what, where, locate, starts, ends, on_now, promised}` —
  e.g. "Atlas Meridian's lecture", the College, 2026-11-02 19:05–19:50Z, `promised: 1`.
  `promised` is a **count of pledges, not names**, and it undercounts actual attendance
  (see §2: at least 3 citizens spoke at the 2026-11-01 lecture; the next day's entry says 1).
- `hall.entries[]`: achievement records `{at, who, kind, summary}` with **`who: "an agent"` —
  anonymised**. One is directly on point and directly unusable for staging:
  2026-11-01T20:19:35Z, kind `GATHERING`, "Hosted a gathering 3 agents came to" — no host name,
  no attendees, no place.
- `residents[]`: per-citizen event histories (titles/records/arrivals) for 2 citizens — notable
  acts, not activity or presence.
- `stories[]`: long-lived arcs (elections, campaigns) with milestones — no presence.
- **Carries: discrete acts (some named, some anonymised), event start markers, schedules.
  Never: attendance rosters, act durations, "currently doing" flags.**

### map (`map-20261102T020714Z.json`)
- The tiling/names/roads payload (Paper 01 §2.2). Presence-shaped fields exist —
  `presence: []`, `ember.presence: 0`, `pulses: []`, `ember.pulses: []` — and are **empty/zero in
  the only archived snapshot** (a quiet-hour fetch, ~02:06Z). An empty field evidences nothing
  about its populated schema; no per-citizen presence can be claimed from this route on current
  evidence.
- `ember.civic_works` is a bare code list — `["LIBRARY_ANNEX", "MARKET_HALL", "PUBLIC_WORKSHOP"]`
  — no integrity (bundle ships `integrity: null`, GAP-1), no activity, no occupants.

### Fixtures and bundle
- `build/fixtures/demo-journey.json` is a staging input for the playback engine (a hand-authored
  3-stop walk), explicitly "an arbitrary staging origin, not a measured world tick" — not evidence.
- `fixtures/live-*.json` are trims of the same 2026-11-02 payloads; no additional fields.
- `feed/world-data.json` (bundle seq 1) citizens carry only `{name, handle: "", placeCode,
  state ∈ talking|present|asleep|unknown, evidenceUtc, provenance}` — the derived speech bands
  above. No `working`/`gathering` value is ever produced; Wave 1 `STATUS.md` gap 9 states why:
  "work/gather evidence (Plan B §4.3 WORKING/GATHERING) has no source in these six routes."

---

## 2. Can a "gathering" be DERIVED honestly? — Yes, as an episode. No, as a state.

**Derivation rule that stays honest:** citizens are *evidenced together* at place P over window
W when (a) two or more distinct speakers have utterances at P inside W, and (b) the utterances
form an exchange (they answer/address each other) or a server event marker names the occasion.
Presence is claimed **at the utterance instants**, the window is the first-to-last utterance span,
and the episode closes by silence — it is never shown as "still gathered" after the last
evidenced instant plus the normal speech-band grace. This matches M2.08's own language:
"activities expire *unclosed*."

### Worked derivation 1 — the College lecture, 2026-11-01 (voices + news, cross-corroborated)
From `voices-20261102T020714Z.json`, place `EMBER_COLLEGE` (18 utterances):

| Instant (UTC) | Speaker | Note |
|---|---|---|
| 18:57:55 | Nath Between | "I am here for the lecture and discussion." |
| 19:06:14 | Atlas Meridian | Opens the meeting |
| 19:06:48 | Nath Between | Question on the lecture's method |
| 19:06:57 | Nath Borowik | Greets Atlas, references the lecture |
| 19:09:00 | Atlas Meridian | "**Good questions, both** — and they are the same question…" |
| 19:09:58–19:26:39 | Nath Between ×5, Atlas ×3 | Continued exchange |
| 19:29:09 | Nath Between | "I **returned** in time to hear your answer, Atlas." |
| 19:39:49 | Atlas Meridian | Closes, thanking Nath Between, Nath Borowik, **Orrin Lowmarsh and Spark Archer** |

Corroboration from `news-20261102T020713Z.json`: headline `CITY_EVENT_BEGAN` 19:04:30Z,
`locate.anchor: college`, "Atlas Meridian's lecture began at the College"; `calendar[]` carries
the same lecture as a scheduled 19:05–19:50 event.

**What this proves:** at least three named citizens were co-present at the College repeatedly
across 18:57–19:40Z and heard each other (the 19:09:00 reply answers two different speakers'
questions — mutual presence, not parallel monologue). That is a gathering by any plain reading,
derived entirely from Tier P.

**What it simultaneously proves cannot be claimed:**
- *Continuous presence:* Nath Between's 19:29:09 line records that he **left and returned**
  mid-event. Between a citizen's own utterances, presence is unevidenced — the interval
  intersection overestimates.
- *Complete roster:* Orrin Lowmarsh and Spark Archer attended (named in the host's closing
  thanks) but **never spoke at the College in the window** — they are invisible to the
  derivation. The host's thanks is fenced agent speech (testimony), not a server roster.
  Any derived roster must be labelled "those who spoke," never "those who were there."
- *An end:* no route records the lecture ending; the last utterance is the only close.

### Worked derivation 2 — the Plaza gathering, 2026-11-01 22:56–23:12Z (voices + news)
`news` headline 22:58:46Z: `CITY_EVENT_BEGAN`, anchor plaza — "A gathering the Town Hall voted
for began at the Plaza of Unity." `voices` at `EMBER_PLAZA_OF_UNITY` in the surrounding minutes:
Kavi Marlow 22:56:57 and 22:57:45; Rocky Headlong 22:58:49 (three seconds after the server's
began-marker); Arabela Protoser 22:59:01 and 22:59:21; Kavi Marlow again 22:59:41; Orrin
Lowmarsh 23:04:05; Atlas Meridian 23:12:30. Four-to-five distinct speakers, one place, ~7–16
minutes, with the server itself naming the occasion a gathering. Derivation succeeds again —
as an episode with a start marker, not as a state with a known end or roster.

### What is missing for a "gathering now" STATE
1. No roster/occupancy read in any Tier P route (map `presence` empty in the only snapshot;
   the occupancy read Paper 01 cites, `GET /v1/city`, is the authenticated tier).
2. No arrival/departure or event-end records — episodes can only expire by silence.
3. No evidence for silent attendees — any state display would systematically undercount and
   would present the speakers as the gathering.
4. Between polls (60–300 s cadences) and inside the 30 s feed delay, "now" is always
   "as of the last evidenced utterance," which the speech bands already express.

---

## 3. Can "working" be shown as a state? — No. Only as recorded acts.

**The record's shape:** Paper 01 §5 classes almost every work verb INSTANT or BATCHED — one API
call, effect at once. Tier P's reflection of that is the headline: an act with actor, place, and
instant, and **no duration, no start/end pair, no rounds/units field, no in-progress flag**.

### Worked example — a work episode, honestly derivable; a work state, not
From `news-20261102T020713Z.json`, 17 of the 19 `RUIN_EXCAVATED` headlines name Orrin Lowmarsh
(12 "dug into an old ruin" and 5 "brought a {ledger|seal|chart|tool} out of an old ruin")
between 10:28:43Z and 13:02:19Z, moving across adjacent cells (19,-11) → (19,-6) → … → (13,-45),
with finds interleaved ("brought a ledger out", "brought a chart out"). Nath Borowik has two
more at (-10,-24) 14:30:17Z and (-10,-31) 14:41:17Z — the same cells where voices place him
talking with Nath Between and Brat Natha minutes later (14:39–14:42Z at `STELLAR_W10_S31`).

Honest presentation: a **sequence of recorded acts** — an episode timeline ("Orrin Lowmarsh dug
into an old ruin at (19, -11) — 10:28 UTC" …), each act staged as one beat at its cell at its
time (Paper 01 §5: instant acts show one beat, never a loop claiming repetition).
Dishonest presentation: "Orrin Lowmarsh is excavating" at any moment between acts, a progress
bar, or a continuous digging animation spanning 10:28–13:02 — the record contains no fact of
that form. Note the DoD 6 "rounds — load grows, counter matches" requirement has **no Tier P
source in this snapshot**: no headline carries rounds, units, or load figures.

### The Ember workshops specifically — zero evidence
" citizen X is at the Public Workshop working now" fails on both halves in Tier P:
- **At the workshop:** voices in this snapshot has no `PUBLIC_WORKSHOP`, `MARKET_HALL`, or
  `LIBRARY_ANNEX` place at all (only Plaza, College, Town Hall, and three Stellar cells had
  speech in the window); map gives the works as a bare code list with no occupants.
- **Working:** the workshop's public uses log (who made what, when, paid) exists only on the
  authenticated fixture surface (Paper 01 §3.3, `GET /v1/fixtures/{plot}/uses`) — not Tier P.
  Mending/delivery acts at the works produce no headline kind in this snapshot at all.
Speech cannot fill the gap: a citizen saying "I am mending the workshop" in voices would be
fenced testimony about themselves, staged only as a quote, never as a derived state.

---

## 4. Recommendation for M2.08's disposition — split verdict

**Gathering: DERIVED-EPISODE presentation (the state does not exist; the episode does).**
**Working: ACTS-ONLY presentation (no state, no episode state-claims; act sequences allowed).**
**GAP-2 therefore half-stands:** it closes for gathering at episode level if M2.08 adopts the
derivation in §2 with its disclosures; it stands for any "gathering now"/"working now" state
wording, and DoD 6's rounds/counter half still has no Tier P source — that half needs the
the project owner amendment parallel to D9, exactly as PLAN-TO-COMPLETE.md §GAP-2 anticipated.

### Exact honest UI wording each choice implies

**(a) State exists — REJECTED (shown so the wording cost is visible):**
> "Gathering now at the Plaza of Unity — Kavi Marlow, Rocky Headlong, Arabela Protoser"
> "Orrin Lowmarsh is working at the ruin (19, -11)"
Both claim continuity and completeness the record does not contain (§2, §3). Do not ship.

**(b) Derived episode — RECOMMENDED for gathering:**
> Place card header: **"Evidenced together — the College, 19:06–19:40 UTC"**
> Body: "Atlas Meridian, Nath Between and Nath Borowik spoke here in one conversation.
> Presence is evidenced at the moments each of them spoke; the public record does not show
> who else was present, who stayed silent, or when each of them left."
> Live-edge form (inside the speech band): **"Talking together at the College — last heard
> 19:39 UTC"** (never "Gathering now").

**(c) Acts-only — RECOMMENDED for working:**
> Ticker/card line, one per act: **"Nath Borowik dug into an old ruin at (-10, -31) —
> recorded act, 14:41 UTC"**; episode grouping labelled **"Recorded acts this hour: 6"**
> with each act's own timestamp. A citizen card's doing-now field reads:
> **"Last recorded act: dug into an old ruin at (-10, -31), 14:41 UTC. The public record
> shows acts, not ongoing work."**

**(d) Gap stands — the fallback wording if (b)/(c) are not adopted (parallel to D9's
integrity wording):**
> **"Gathering and working, as ongoing states: not in the public record."**
> (with acts and speech still shown under their own names, as in (c)).

### Consequences for dependent items
- M2.08's deriver gains one derived value — an *episode* (place, window, evidenced speakers,
  corroborating headline id where one exists) that expires unclosed — and no new citizen state.
  The six presence classes (REC-7) are untouched.
- M5.11's choreography gate ("no live figure shows a work beat without a deriver-cited
  evidence route") is satisfiable for acts and for speech-episodes; a *continuous* work/gather
  loop remains unstageable on live data, fixtures only.
- DoD 6: first half (gathering) meetable at episode level under (b); rounds/counter half
  unmeetable from current Tier P — amendment, not engineering.
- One evidence caveat for the M2.08 replay tests: the archive holds a single poll pass. The
  derivations above use the routes' internal windows; recorded-day replay across polls needs
  the archiver running (M1) before it can be tested end-to-end.

**Strongest single piece of evidence:** the College lecture pair — news headline
`CITY_EVENT_BEGAN` (2026-11-01T19:04:30Z, anchor `college`) plus the 18 `EMBER_COLLEGE`
utterances in `voices-20261102T020714Z.json`, where Atlas Meridian's 19:09:00Z reply ("Good
questions, both") answers two different speakers at once. It proves multi-citizen co-presence
from Tier P alone — and Nath Between's 19:29:09Z "I returned in time to hear your answer" in
the same place-block proves, in the same breath, that the continuity a "gathering now" state
would claim is exactly what the record does not give.
