> **Superseded by `build/CONTRACT-V2.md` — FROZEN 2026-11-02 (pending a VER delta sign-off on Amendment A1 only). Kept as the pre-freeze record.**

# Elsewhere Portal — WorldData v2 Contract (DRAFT for the M2.11 freeze)

Status: **DRAFT — not frozen.** This document specifies `portal.world-data/v2`
for the M2.11 schema freeze (plan-to-complete M2.11; dependencies M2.03,
M2.04, M2.10, M1.05). It supersedes nothing yet: `build/CONTRACT.md` (v1)
remains the live contract until the freeze checklist in §5 is complete and
both sign-off lines are signed.

**Hark-amended 2026-11-02** (mini-audit `audits/HARK-M2-MINIAUDIT-2026-11-02.md`,
dispositions adopted by Atlas): Q1 amended (a required `citizenIdStatus`
rides beside `citizenId`), Q2 adopted with a validator condition
(`scenes[]` emission is invalid), Q4 adopted with a citation requirement
(the bundle and the manifest cite the facts stream by schema id + seq),
Q5 amended (chain artefacts take schema id `portal.chain/v0`; implemented
by a separate arm), and the §1.4/§1.5 disclosure validity rule is
strengthened (template-family minimum content, rejections logged with
record ids, a render test queued at adoption). The amendments are folded
into §§1, 3, 5, 6 below and summarised in §7.

Sources this draft is built from: `build/CONTRACT.md` (v1),
`build/E1-REPORT.md` (the PORTAL-KEY work and its recommendation to ratify
at this freeze), `build/data/episodes.mjs`, `build/data/world-books.mjs`,
`build/data/chain.mjs`, `build/data/health.mjs`,
`build/data/reset-detect.mjs`, and PLAN-TO-COMPLETE items M2.01 and M2.11.

---

## 1. The v2 bundle — `portal.world-data/v2`

### 1.1 Field-level delta vs v1 (complete list)

**Changed (1):**

| Field | v1 | v2 | Reason |
|---|---|---|---|
| `schema` (bundle and manifest) | `"portal.world-data/v1"` | `"portal.world-data/v2"` | The freeze itself. This is the only value change in v2; see §4 for what it breaks. |

**Added (9 — 7 as originally drafted + `citizenIdStatus` and `world.facts` per the Hark amendments):**

| Field | Where | Source | Reason |
|---|---|---|---|
| `citizenKey` | `citizens[]`, REQUIRED, non-empty | E1 / M2.03 (already shipped under v1) | v1 keyed citizens by `handle`, which Tier P leaves `""` for every real citizen, collapsing all evidenced citizens onto one identity. The PORTAL-KEY is the only safe key until the M2.04 registry lands. Ratified here per the E1 report's recommendation. |
| `firstSeenUtc` | `citizens[]` | E1 / M2.03 (already shipped under v1) | Hark condition 2 for the PORTAL-KEY (§1.3): the record's earliest evidence within the current archive head, stored beside the key so a key's provenance in time is auditable. |
| `citizenId` | `citizens[]`, REQUIRED but nullable | M2.04 registry (plan M2.11 lists `citizenId` as a v2 field) | The registry's verified identity key. `null` means *unverified* — no binding adopted. Once non-null it is the only downstream identity key; `citizenKey` remains as the pre-registry evidence key and is never promoted into an identity. |
| `citizenIdStatus` | `citizens[]`, REQUIRED | M2.04 registry, **Hark Q1 amendment** | A bare null cannot tell "never looked" from "cannot be bound". Values: `UNBOUND_NO_ROUTE` (registry state unverified — including no evidenced route — or no registry entry), `BOUND` (verified; `citizenId` non-null), `CONFLICT` (ambiguous; `citizenId` stays null — ambiguity never auto-binds). The status is the honest, stated form of the identity gap. |
| `facts` | `world`, REQUIRED (may be `null`) | facts stream citation, **Hark Q4 amendment** | Cites the separate `portal.facts/v1` stream (§3) by schema id + its current seq: `{ "schema": "portal.facts/v1", "seq": <int> }`. When no facts stream exists the value is `null` — recorded, never omitted. The manifest carries the same citation. |
| `citizenCollisions` | top level, REQUIRED (may be `[]`) | E1 / M2.03 (already shipped under v1) | Hark condition 5 (§1.3): same normalised name, two records ⇒ the collision is published in the bundle, never silently folded. |
| `bookId` | `world`, REQUIRED | world-books registry (§2.4) | Every fact in the bundle belongs to exactly one world-book. Consumers need the book identity in-band to enforce the hard-boundary rule (§2.5). Value is the registry's current open book id (format `world-NNN`). |
| `episodes` | top level, REQUIRED (may be `[]`) | `episodes.mjs` (M2.08 disposition) | Gathering ships as derived episodes — presence evidenced at utterance instants only — never as a "gathering now" state (§1.4). |
| `actSequences` | top level, REQUIRED (may be `[]`) | `episodes.mjs` (M2.08 disposition) | Working ships as acts-only sequences of recorded acts — never as a "working" state (§1.5). |

**Kept unchanged from v1:** `bundleSeq`, `newestFetchUtc`,
`dataAgeSeconds`; `world.sky`, `world.worldHour`, `world.season`,
`world.year`; all six `counters` fields; `ember.districts`,
`ember.plots`, `ember.works`; `citizens[].handle` (still `""` — Tier P
evidences no handles), `citizens[].name`, `citizens[].placeCode`,
`citizens[].state` (same enum: `unknown|present|travelling|talking|
working|asleep`), `citizens[].evidenceUtc`,
`citizens[].provenance{route, fetchedUtc}`; all `ticker[]` fields
including `handles` and `provenance`; `journeys[]` (shape per M3.01,
reconstruction lands after this freeze). Derivation remains PURE: same
archive head ⇒ byte-identical canonical output, and sorts use code-unit
comparison, never `localeCompare` (E1).

**Delta count: 10** (1 changed + 9 added; 0 removed, 0 renamed, 0
retyped), plus two new object types (§1.4, §1.5). As first drafted the
count was 8; the Hark amendments added `citizenIdStatus` and
`world.facts`. Note that three of the nine additions (`citizenKey`,
`firstSeenUtc`, `citizenCollisions`) already ship under v1 (E1/M2.03),
so the emitted key-set delta at build time is 6 additions + the schema
change.

### 1.2 Bundle and manifest shape

`data/feed/manifest.json`:
```json
{ "bundleSeq": 1, "worlddataHash": "<sha256 of canonical world-data bytes>",
  "newestFetchUtc": "<ISO>", "schema": "portal.world-data/v2",
  "facts": null }
```
(`facts` carries the same citation object as `world.facts` — §1.1 — or
`null` when no facts stream exists; the key is always present.)

`data/feed/world-data.json` — `portal.world-data/v2`:
```json
{ "schema": "portal.world-data/v2", "bundleSeq": 1,
  "newestFetchUtc": "<ISO>", "dataAgeSeconds": 0,
  "world": { "sky": null, "worldHour": null, "season": null, "year": null,
             "bookId": "world-001", "facts": null },
  "counters": { "regionsDiscovered": 0, "regionsSurveyed": 0, "regionsNamed": 0,
                "collegeDeposits": 0, "treasury": 0, "populationKnown": 0 },
  "ember": { "districts": [], "plots": [], "works": [] },
  "citizens": [ { "citizenKey": "portal-key:<slug>", "citizenId": null,
                  "citizenIdStatus": "UNBOUND_NO_ROUTE",
                  "handle": "", "name": "", "firstSeenUtc": null,
                  "placeCode": null,
                  "state": "unknown|present|travelling|talking|working|asleep",
                  "evidenceUtc": null, "provenance": {"route":"","fetchedUtc":""} } ],
  "citizenCollisions": [ { "key": "portal-key:<slug>",
                  "names": ["<raw name>", "..."],
                  "citizenKeys": ["<key>", "..."] } ],
  "ticker": [ { "utc": "", "kind": "", "text": "", "placeCode": null,
                "handles": [], "provenance": {"route":"","fetchedUtc":""} } ],
  "episodes": [ ],
  "actSequences": [ ],
  "journeys": [] }
```

### 1.3 The PORTAL-KEY — contract clauses (from E1, Hark-audit conditions)

The `citizenKey` scheme (a pure function of the archive head, implemented
in `build/data/derive.mjs`: `portal-key:` + slug of the evidenced display
name — NFKC, trim, whitespace collapsed, lowercase, `[a-z0-9]` kept,
space/`-` → `-`, everything else percent-encoded UTF-8; collisions ordered
by a deterministic evidence tuple, strongest evidence keeps the bare key,
the rest take `#2`, `#3`, …) is bound by five clauses. A deriver or
consumer that violates any clause is not v2-conformant:

- **K1 — It is labelled, never an identity.** The key is a PORTAL-KEY in
  every doc and UI string — never called a handle, never presented as an
  identity. The `portal-key:` prefix is part of the value. `handle` stays
  `""`.
- **K2 — Raw name and first-seen ride beside it.** Every citizen record
  stores its raw display name (`name`) and `firstSeenUtc` beside the key.
- **K3 — Never merged on name alone.** One record per source record (one
  per voices speaker, one per news.residents row); records are never
  folded into each other on name evidence.
- **K4 — Renames are not chased.** A rename produces a NEW key. Records
  link only when a server-side id evidences it — that link is
  `citizenId`, adopted by the M2.04 registry rule (agent page returns
  200 **and** its display name matches exactly; candidates are never
  slugified).
- **K5 — Collisions are published, never folded.** Same name, two records
  ⇒ an entry in `citizenCollisions` (bare key, all raw names, all
  assigned keys). An empty list certifies no collisions in this bundle.

### 1.4 Episodes — gathering as derived evidence

Section schema: `portal.episodes/v1` (the `EPISODE_SCHEMA` constant in
`episodes.mjs`). Each episode object:

```json
{ "place": "<voices place code>", "where": "<place label or null>",
  "participants": ["<speaker display names, first-speech order>"],
  "firstUtc": "<ISO>", "lastUtc": "<ISO>", "utteranceCount": 0,
  "corroborated": false,
  "corroboratedBy": { "headlineId": "<id or null>", "at": "<ISO>" } ,
  "disclosure": "<REQUIRED — see below>" }
```
(`corroboratedBy` is `null` when `corroborated` is false.)

Semantics, binding on producers and consumers:

- An episode is a run of utterances at one place, consecutive utterances
  at most 15 minutes apart (`EXCHANGE_GAP_MS`, a disclosed derivation
  parameter — half the 30-minute `talking` band — not a fact about the
  world), with 2+ distinct speakers who interleave (A…B…A). It claims
  presence **only at the utterance instants of its speakers**.
- `participants` are **speakers only**. Names appearing inside utterance
  text are fenced agent speech (testimony) and are never parsed into the
  roster — attendees who never spoke do not appear.
- `corroborated` means a `CITY_EVENT_BEGAN` headline's anchor maps to the
  episode's place. It cross-checks the occasion; it is never attendance
  evidence.
- **`disclosure` is a REQUIRED field. An episode object without its
  `disclosure` string is schema-invalid and a conformant consumer MUST
  reject the object (and a conformant validator MUST fail the bundle).**
  **Hark-strengthened (2026-11-02):** presence alone is not validity —
  the string must match the filed template family (the verbatim
  `DISCLOSURE` constant in `episodes.mjs`), so a stub ("n/a") or an
  altered near-copy fails exactly like an omission; and every validator
  rejection is logged with the rejected record's id — a rejected
  episode must never disappear silently. The string is carried verbatim
  on every episode:

  > "Presence is evidenced at the moments each of them spoke; the public
  > record does not show who else was present, who stayed silent, or when
  > each of them left."

- An episode is never presented as a "gathering now" state, by any
  consumer, in any wording.

### 1.5 Act sequences — working as recorded acts only

Each act-sequence object (produced by `deriveActSequences` in
`episodes.mjs`):

```json
{ "actor": "<display name>", "kind": "<headline kind>",
  "presentation": "acts-only", "count": 0,
  "firstUtc": "<ISO>", "lastUtc": "<ISO>",
  "acts": [ { "at": "<ISO>", "phrase": "<headline phrase>",
              "cell": ["<cell>", "..."] } ],
  "disclosure": "<REQUIRED — see below>" }
```
(`cell` is `null` when the headline carries no cell.)

Semantics:

- A sequence groups headlines by (actor, kind) where the actor is
  extracted by an explicit per-kind pattern. A headline whose phrase
  matches no pattern yields **no** actor and is never grouped — an
  unparsed actor is never guessed. Groups below 2 acts are not emitted.
- A sequence asserts nothing between acts: no state, no duration, no
  in-progress flag, no "currently doing". `presentation` is always the
  literal `"acts-only"`.
- **`disclosure` is a REQUIRED field, under the same validity rule as
  §1.4 — including the Hark strengthening: the string must be the
  verbatim `ACTS_DISCLOSURE` template, stubs fail, and rejections are
  logged with the record's id.** Carried verbatim on every sequence:

  > "Recorded acts only. The public record shows acts, not ongoing work."

---

## 2. Archive-side contracts

These artefacts live in `build/data/archive/` and are consumed by the
deriver, thinning (M1.09), and the inspectors. They are contracts even
though most are not served to browsers.

### 2.1 Snapshot hash chain — `chain-<route>.jsonl`

Producer/consumer: `build/data/chain.mjs`. **Schema id: none** — the
module defines no schema constant; the record shape below is the contract
by convention (see open question Q5). One append-only record per snapshot,
per route:

```json
{ "seq": 1, "route": "<route>", "file": "<day>/<route>-<stamp>.json",
  "sha256": "<sha256 of the snapshot file's RAW BYTES>",
  "prev_hash": "<previous record's sha256, null at genesis>",
  "captured_at": "<ISO, from the filename stamp>",
  "window_oldest": { "at": "<ISO>", "id": "<id or null>" },
  "window_newest": { "at": "<ISO>", "id": "<id or null>" } }
```

- `window_oldest`/`window_newest` appear only on rolling routes
  (`chats`, `news`) and record the feed-window edges evidenced in the
  body, so scroll-off between polls is visible as an edge gap.
- `sha256` is over raw bytes, never a re-serialisation. `prev_hash`
  chains records: any altered, reordered, or dropped snapshot breaks the
  chain observably. Building is idempotent — existing records are never
  rewritten. Edge gaps are **reported, not failures** (lost feed
  visibility, not tampering).

### 2.2 Archive health — `health.json`

Producer: `build/data/health.mjs` (pure read over `fetch-log.jsonl` +
`cadence.json`; it never fetches). **Schema id: none** (see Q5). Shape:

```json
{ "generatedAtUtc": "<ISO>", "gapFactor": 2,
  "routes": { "<route>": { "cadenceSeconds": 0, "gapThresholdSeconds": 0,
      "attempts": 0, "successes": 0, "errors24h": 0,
      "lastAttemptUtc": null, "lastSuccessUtc": null, "lastChangeUtc": null,
      "lastSha256": null, "secondsSinceLastSuccess": null,
      "gapStatus": "ok|gap|never-succeeded|no-data",
      "gaps": [ { "route": "<route>", "startUtc": "<ISO>",
                  "endUtc": "<ISO or null>", "durationSeconds": 0,
                  "ongoing": false } ] } },
  "a0": { "hoursSinceLastUnexplainedGap": null, "inGapNow": false,
          "unexplainedGapCount": 0, "lastGap": null } }
```

- A **gap** is any interval between consecutive successes (or before the
  first success, or from the last success to now) longer than
  `gapFactor × cadence` — the M1.04 acceptance language: zero gaps > 2×
  cadence.
- `a0.hoursSinceLastUnexplainedGap` is 0 while any gap is live, and
  `null` when no gap has ever been recorded. No explanation mechanism
  exists yet, so every gap is unexplained by construction; when one
  lands, it is recorded via this surface rather than by editing the
  module's rule.

### 2.3 Reset watch — `reset-watch.jsonl`

Producer: `build/data/reset-detect.mjs`. **Schema id: none** (see Q5).
Append-only; one verdict record per inspected consecutive overview pair:

```json
{ "inspectedAtUtc": "<ISO>",
  "verdict": "no-reset|suspected|confirmed",
  "signals": [ { "kind": "<signal kind>", "strength": "strong|weak|info",
                 "detail": "<plain words>" } ],
  "evidence": { "prev": { "file": "<snapshot file>" },
                "next": { "file": "<snapshot file>" } } }
```

- `confirmed` = ≥2 strong signals, or 1 strong + a `nextreset-consumed`
  signal. `suspected` is below that bar. An announcement signal
  (`nextreset-announced`) is never itself a verdict — an announcement is
  not an event.
- Only `confirmed` verdicts create world-book boundaries. `suspected`
  verdicts annotate; they never split (§2.4).

### 2.4 World-books registry — `portal.world-books/v1`

Producer: `build/data/world-books.mjs` (`REGISTRY_SCHEMA`). File:
`archive/world-books.json`. A derived artefact, rebuilt deterministically
and idempotently from the snapshot files, the route chains, and the
reset-watch log — same inputs, byte-identical output, no wall-clock
fields.

```json
{ "schema": "portal.world-books/v1",
  "books": [ { "id": "world-001", "status": "open|closed",
      "opened_at": "<ISO or null>", "opened_with_file": "<file or null>",
      "closed_at": "<ISO or null>", "closed_with_file": "<file or null>",
      "close_reason": { "kind": "reset-confirmed",
          "inspectedAtUtc": "<ISO>", "signals": [ ],
          "next_file": "<file>" },
      "snapshot_count": 0,
      "first_snapshot": "<file or null>", "last_snapshot": "<file or null>",
      "chain_heads": { "<route>": { "seq": 0, "file": "<file>",
                                     "sha256": "<hash>" } },
      "annotations": [ { "kind": "suspected-reset",
          "inspectedAtUtc": "<ISO>", "signals": [ ],
          "prev_file": "<file or null>", "next_file": "<file or null>" } ]
    } ] }
```
(`close_reason` is `null` on the open book.)

- A book opens at the first snapshot after the previous world ended and
  closes only when reset detection **confirms** a reset; the old book
  ends with the verdict pair's `prev` file, the new book opens with its
  `next` file. Exactly one book is `open`; it is the last.
- `chain_heads` pins each route chain's head as of the book's final
  snapshot (the open book's heads are the current tails).
- The bundle's `world.bookId` (§1.1) is the open book's `id` at derive
  time.

### 2.5 The hard-boundary rule (binding on all consumers)

**Consumers treat book boundaries as hard.** No merge, join, journey,
episode, act sequence, Growth diff, or identity link may span a
confirmed boundary: a citizen record, an episode, or a journey derived
from book *N* is never combined with evidence from book *N+1*, even when
names match character-for-character. A closed world is shown read-only
and clearly ended (D6 default); the current bundle is always derived
from the open book only. Suspected verdicts never create boundaries —
they ride as annotations on the book they fall in.

---

## 3. The delta stream (M2.11 companion)

M2.11 also freezes a pure `deriveDelta` → PortalFact stream alongside the
bundle. This draft does **not** fold the stream into
`portal.world-data/v2`: the recommendation (Q4) is that it freeze under
its own schema id at the same gate, so bundle consumers and stream
consumers version independently. Atomic publish discipline applies to
both: manifest written last, `bundleSeq` advances only on change.

**Hark Q4 amendment (adopted):** the v2 bundle and its manifest cite the
stream in-band — `world.facts` (§1.1) and the manifest's `facts` key
carry `{ "schema": "portal.facts/v1", "seq": <the stream's current
seq> }`, where the stream's current seq is the bundleSeq it has diffed
up to. When no facts stream exists, both citations are `null` — the key
is present, the absence is recorded, nothing is omitted.

---

## 4. Migration notes

### 4.1 What a v1 consumer breaks on

- **Strict schema checks fail.** Any consumer asserting
  `schema === "portal.world-data/v1"` (bundle or manifest) rejects v2.
  This is the intended break: it forces a conscious upgrade.
- **Strict unknown-key validators fail.** Consumers that reject unknown
  top-level keys will reject `citizenCollisions`, `episodes`, and
  `actSequences`; consumers that reject unknown citizen fields will
  reject `citizenKey`, `firstSeenUtc`, and `citizenId`.
- **Nothing else breaks.** Every v1 field keeps its name, type, and
  semantics. A lenient v1 consumer (ignores unknown keys) reads v2
  correctly but silently loses the new sections — in particular it keeps
  keying by `handle` unless it adopts `citizenKey`, which is precisely
  the Wave 1 collapse defect; upgrading consumers MUST switch keying to
  `citizenKey` (and to `citizenId` where a binding exists).
- The M2.11 exit gate already requires the Wave 1 app suite to pass
  against a v2 fixture before the freeze (§5).

### 4.2 Additive-only discipline

- Within the v2 line, changes are **additive only**: new fields may be
  added (optional or nullable first); no field is removed, renamed, or
  retyped; no enum value changes meaning. Anything else is a v3.
- New REQUIRED fields are a breaking change and therefore also a v3 —
  v2's required set is exactly §1 as frozen.
- Disclosure strings (§1.4, §1.5) are part of the schema. Wording changes
  to a disclosure are wording-class changes under the honesty backlog,
  never silent edits; the frozen strings are the ones quoted in this
  document.

---

## 5. Freeze checklist for M2.11

v2 is declared frozen only when **all** of the following are true:

- [ ] This draft's field-level delta (§1.1) matches the deriver's actual
      output on the current archive head, field by field.
- [ ] The Wave 1 app suite passes against a v2 fixture (M2.11 exit gate).
- [ ] A no-change rebuild does not bump `bundleSeq`; seq advances only on
      change, and the manifest is published last (atomic publish).
- [ ] A planted mid-publish kill leaves no mismatched manifest.
- [ ] Delta stream size ≤ 50 KB for the reference window (M2.11 exit
      gate), under whichever schema id Q4 settles.
- [ ] A validator rejects an episode and an act sequence with
      `disclosure` removed (positive control for §1.4/§1.5), and accepts
      the same objects with the verbatim strings present.
- [ ] A validator rejects an episode and an act sequence whose
      `disclosure` is a stub ("n/a") or an altered near-copy
      (Hark minimum-content positive control), and every rejection is
      logged with the rejected record's id.
- [ ] A validator rejects a bundle emitting `scenes[]` (Hark Q2
      condition — reserved means reserved) and a citizen carrying
      `presenceClass` (Q3).
- [ ] `citizenIdStatus` maps the registry states as specified in §1.1
      (verified → `BOUND`, ambiguous → `CONFLICT`, unverified/absent →
      `UNBOUND_NO_ROUTE`), covered by tests including the real head.
- [ ] A render test proves the episode/act-sequence disclosure reaches
      app output (Hark condition; rides the app suite at v2 adoption).
- [ ] The PORTAL-KEY clauses K1–K5 are covered by tests, including the
      anti-slugification assertion (zero `citizenId` bindings whose
      evidence is a transformation of the name).
- [ ] `world.bookId` in a derived bundle equals the registry's open book
      id for the same head, and a simulated-reset fixture shows no
      cross-book merge (the §2.5 rule under test).
- [ ] Open questions Q1–Q5 (§6) are settled or explicitly carried with
      their defaults adopted.

Sign-off lines (leave unsigned until the freeze review):

- VER sign-off: ______________________________  date: ____________
- Hark mini-audit: ______________________________  date: ____________

---

## 6. Open questions for the freeze (with recommended defaults)

- **Q1 — `citizenId`: required-nullable now, or omitted until M2.04
  completes?** Recommended default: **required but nullable in v2**, as
  drafted — `null` is the honest "unverified" value, and adding the
  field later as required would itself be a breaking change.
  **AMENDED by the Hark mini-audit (adopted):** a required
  `citizenIdStatus` (`UNBOUND_NO_ROUTE` / `BOUND` / `CONFLICT`, §1.1)
  rides beside it, so a null reads as a stated gap, never as identity
  promised and not delivered.
- **Q2 — `scenes[]`:** M2.11 names a `scenes[]` section; episodes are
  the shipped scene-evidence shape. Recommended default: **episodes are
  the v2 scene evidence; `scenes[]` is reserved, not emitted**, and any
  future scenes section is additive under §4.2. **Adopted with the
  Hark condition:** a conformant v2 validator MUST reject any bundle
  that emits `scenes[]`.
- **Q3 — `presenceClass`:** M2.11 names a citizen `presenceClass`; no
  module derives one yet, and `state` + `evidenceUtc` already carry the
  evidenced facts. Recommended default: **defer** — do not freeze a
  field whose derivation rule does not exist; add it additively when
  M2.08's successor defines it.
- **Q4 — Delta stream schema id:** fold into `portal.world-data/v2` or
  freeze separately? Recommended default: **separate schema id**
  (e.g. `portal.facts/v1`), frozen at the same gate (§3). **Adopted
  with the Hark amendment:** the v2 bundle and manifest cite the stream
  by schema id + current seq (`world.facts`, §1.1/§3); absence is
  recorded as `null`, never omitted.
- **Q5 — Archive-side schema ids:** chain records, `health.json`, and
  reset-watch records carry no version string today; only the registry
  does (`portal.world-books/v1`). Recommended default: **leave the three
  formats unversioned at this freeze** — each has exactly one writer and
  one shape — and add ids if a second writer or a shape change ever
  appears. **AMENDED by the Hark mini-audit (adopted):** the chain is
  the integrity anchor and cannot stay unversioned — chain artefacts
  take schema id `portal.chain/v0` (existing records grandfathered as
  v0 by declaration; new records carry the id). `health.json` and the
  reset-watch log stay unversioned as recommended. Implemented by a
  separate arm, not by the v2 bundle builder.

---

## 7. Amendments adopted from the Hark mini-audit (2026-11-02)

Source: `audits/HARK-M2-MINIAUDIT-2026-11-02.md`; dispositions adopted by
Atlas and implemented in `build/data/derive-v2.mjs`,
`build/data/build-bundle-v2.mjs`, and `build/data/validate-v2.mjs`
(tests: `build/data/test/bundle-v2.test.mjs`).

1. **Q1 amended** — `citizenIdStatus` (§1.1) added as a REQUIRED citizen
   field; the delta count rises from 8 to 10 (§1.1).
2. **Q2 condition** — the v2 validator rejects any bundle emitting
   `scenes[]`; a positive control is in the freeze checklist (§5).
3. **Q4 citation** — `world.facts` and the manifest's `facts` key cite
   `portal.facts/v1` by schema id + current seq; absence is `null`,
   never omitted (§§1.1, 1.2, 3).
4. **Disclosure validity strengthened** (§§1.4, 1.5, 5) — (a) a
   disclosure is valid only as the verbatim filed template (episodes)
   or its act-sequence counterpart; stubs and near-copies fail;
   (b) every validator rejection is logged with the rejected record's
   id (validator return value + a `validation-rejections.jsonl` audit
   log) — silent disappearance is designed out; (c) the render test
   (disclosure reaching app output) is an M2-adoption item riding the
   app suite, recorded in the §5 checklist — it is NOT discharged by
   the data-arm validator.
5. **Q5 amended** — chain artefacts take `portal.chain/v0` (§6, Q5);
   implemented by a separate arm.

Editorial correction found during implementation (not a Hark item):
§1.2's collision example originally named the assigned-keys field
`keys`; the shipped v1 deriver emits `citizenKeys`, and §1.2 now matches
the deriver — the §5 field-by-field check is run against actual output.
