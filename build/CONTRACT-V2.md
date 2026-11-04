# Elsewhere Portal — WorldData v2 Contract — FROZEN (M2.11)

Status: **FROZEN 2026-11-02 (America/Chicago)** — fully frozen.
**Amendment A1** (`world.integritySource`, §§1.1/7) was added at the
freeze, on the D9-prep finding, AFTER the VER seventh shift's sign-off,
and was held as the one pending item; the **VER eighth shift's delta
sign-off on A1 landed 2026-11-03** (`build/VER-LOG.md`: value required
and exact, mutation controls reject wrong/absent values, post-A1 size
delta 4,228 B vs the 50 KB gate). No part of this contract remains
pending.

Freeze evidence:
- VER sign-off: seventh shift, `build/VER-LOG.md` (2026-11-03) — VER
  signs off on M2.11, no blockers. Same-head size pair measured there:
  v1 = 12,020 B, v2 = 16,720 B, delta = 4,700 B against the 50 KB gate
  (pre-A1 measurement; A1 adds one short constant field — the delta
  sign-off re-measures).
- Hark mini-audit: `audits/HARK-M2-MINIAUDIT-2026-11-02.md` — rulings
  Q1–Q5 adopted and implemented (§7).
- Amendment A1 source: `plan-to-complete/D9-INTEGRITY-FORK.md` — M2.07
  names `integritySource` in the plan; the field existed nowhere in
  `build/` or in the draft this document was frozen from.

**Feed switch — LANDED 2026-11-03:** at the freeze, this section said
the live feed stays on `portal.world-data/v1` until the app adopts v2.
The app adopted v2 (dual-schema, app suite 56/56), and the feed switch
followed: the supervisor's bundle step now builds with
`build-bundle-v2.mjs`, gated on the bundle-v2 tests and the v2
`bundle-check.mjs` (which delegates to `validate-v2.mjs` and FAILS a
v1 bundle). First live v2 bundle: **seq 28** (2026-11-03T01:06:53Z
cycle) — the publication sequence continued across the schema change
(…26, 27 v1 → 28, 29, 30 v2, no reset). This document is now the
**live contract**; `build/CONTRACT.md` (v1) is the historical contract,
superseded for live use.

**Amendment A2 — record-scope wording (landed 2026-11-02,
America/Chicago; OM-15 condition C3).** Both disclosure strings
(§§1.4, 1.5) are reworded so every scope claim names the public feeds
Portal reads, never "the public record" — Portal reads only the Tier P
feeds, and the old wording claimed the whole record. The validator's
rule is unchanged in form: the strings in `episodes.mjs` are the filed
templates, the old strings now fail the same controls that stubs and
near-copies fail, and the new strings pass. §7 item 7 carries the delta
table and the list of non-contract surfaces reworded in the same pass.
Status: landed with a delta check in `build/data/test/bundle-v2.test.mjs`
(pre-A2 strings rejected, one-word-altered A2 copies rejected); the
OM-15 close still requires VER's re-check of C1–C4.

**Amendment A3 — optional carriage: `offices` + ticker `dueUtc`
(landed 2026-11-03, America/Chicago; M6 carriage lane).** Two
projections of evidence the Tier P record already carried but the
frozen bundle did not: the overview's named office holder(s) and a
headline's own due/response stamp. Both are OPTIONAL under §4.2's
additive-only discipline: consumers that ignore them are unaffected,
a bundle without them (pre-A3) remains valid, and absence stays
honest — no title renders where no office is carried, and no
deadline renders where no stamp is carried. §7 item 8 carries the
full text. Status: landed in `build/data/derive-v2.mjs` +
`build/data/validate-v2.mjs`, pinned by the A3 tests in
`build/data/test/bundle-v2.test.mjs` (present-when-evidenced,
absent-when-not, provenance attached, fabricated-office negative
control); lane record `plan-to-complete/lane-carriage.md`.

This document specifies `portal.world-data/v2` for the M2.11 schema
freeze (plan-to-complete M2.11; dependencies M2.03, M2.04, M2.10,
M1.05). As of the 2026-11-03 feed switch it supersedes
`build/CONTRACT.md` for live use.

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

**Added (10 — 7 as originally drafted + `citizenIdStatus` and `world.facts` per the Hark amendments + `world.integritySource` per Amendment A1):**

| Field | Where | Source | Reason |
|---|---|---|---|
| `citizenKey` | `citizens[]`, REQUIRED, non-empty | E1 / M2.03 (already shipped under v1) | v1 keyed citizens by `handle`, which Tier P leaves `""` for every real citizen, collapsing all evidenced citizens onto one identity. The PORTAL-KEY is the only safe key until the M2.04 registry lands. Ratified here per the E1 report's recommendation. |
| `firstSeenUtc` | `citizens[]` | E1 / M2.03 (already shipped under v1) | Hark condition 2 for the PORTAL-KEY (§1.3): the record's earliest evidence within the current archive head, stored beside the key so a key's provenance in time is auditable. |
| `citizenId` | `citizens[]`, REQUIRED but nullable | M2.04 registry (plan M2.11 lists `citizenId` as a v2 field) | The registry's verified identity key. `null` means *unverified* — no binding adopted. Once non-null it is the only downstream identity key; `citizenKey` remains as the pre-registry evidence key and is never promoted into an identity. |
| `citizenIdStatus` | `citizens[]`, REQUIRED | M2.04 registry, **Hark Q1 amendment** | A bare null cannot tell "never looked" from "cannot be bound". Values: `UNBOUND_NO_ROUTE` (registry state unverified — including no evidenced route — or no registry entry), `BOUND` (verified; `citizenId` non-null), `CONFLICT` (ambiguous; `citizenId` stays null — ambiguity never auto-binds). The status is the honest, stated form of the identity gap. |
| `facts` | `world`, REQUIRED (may be `null`) | facts stream citation, **Hark Q4 amendment** | Cites the separate `portal.facts/v1` stream (§3) by schema id + its current seq: `{ "schema": "portal.facts/v1", "seq": <int> }`. When no facts stream exists the value is `null` — recorded, never omitted. The manifest carries the same citation. |
| `integritySource` | `world`, REQUIRED, constant | M2.07 (SE-1.11), **Amendment A1** | Tier P publishes no building integrity: the three civic works are a bare name list in every archived snapshot (D9 evidence pack, `plan-to-complete/D9-INTEGRITY-FORK.md`) and each work's `integrity` stays `null`. This field states that in-band — the only conformant value is `"none-in-tier-p"`, and that constant is the whole value. A future real source changes the contract, never the constant. Added at the freeze, post-VER-sign-off: FROZEN pending a VER delta sign-off on A1 only (status header, §7 item 6). |
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

**Delta count: 11** (1 changed + 10 added; 0 removed, 0 renamed, 0
retyped), plus two new object types (§1.4, §1.5). As first drafted the
count was 8; the Hark amendments added `citizenIdStatus` and
`world.facts`; Amendment A1 (at the freeze, post-VER-sign-off) added
`world.integritySource`. Note that three of the ten additions (`citizenKey`,
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
             "bookId": "world-001", "facts": null, "integritySource": "none-in-tier-p" },
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
  "offices": [ { "office": "MAYOR", "name": "<evidenced holder name>",
                 "citizenKey": "portal-key:<slug> | null",
                 "provenance": {"route":"overview","fetchedUtc":""} } ],
  "ticker": [ { "utc": "", "kind": "", "text": "", "placeCode": null,
                "handles": [], "provenance": {"route":"","fetchedUtc":""},
                "dueUtc": "<ISO — present ONLY where the item's own source record carries a due stamp; otherwise absent>" } ],
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
  > feeds Portal reads do not show who else was present, who stayed
  > silent, or when each of them left." (Wording as amended by
  > Amendment A2, §7 item 7.)

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

  > "Recorded acts only. The public feeds Portal reads show acts, not
  > ongoing work." (Wording as amended by Amendment A2, §7 item 7.)

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
  document (both disclosure strings were reworded once, by Amendment A2,
  §7 item 7).

---

## 5. Freeze checklist for M2.11

v2 is declared frozen only when **all** of the following are true:

- [x] This draft's field-level delta (§1.1) matches the deriver's actual
      output on the current archive head, field by field.
      Evidence: VER seventh shift (`build/VER-LOG.md`) same-head key-set
      diff, field by field; `build/data/test/bundle-v2.test.mjs` delta
      test (11 deltas incl. A1).
- [x] The Wave 1 app suite passes against a v2 fixture (M2.11 exit gate).
      Evidence: app suite 42/42 (`build/app/test/`), incl.
      `episodes.test.mjs` 8/8 run by the VER seventh shift against the
      real v2-derived episodes feed; bundle-level v2 consumption is the
      app v2 adoption step named in the status header.
- [x] A no-change rebuild does not bump `bundleSeq`; seq advances only on
      change, and the manifest is published last (atomic publish).
      Evidence: `build/data/test/bundle.test.mjs` (seq persisted via the
      manifest); AUTO-B18 supervisor publish gate — `bundle-check.mjs`
      hash/seq agreement verified before publish
      (`AUTO-DECISIONS.md`, 2026-11-02 18:47 CST).
- [x] A planted mid-publish kill leaves no mismatched manifest.
      Evidence: publish is rename-based with the manifest written last
      (`build-bundle.mjs` / `build-bundle-v2.mjs`; AUTO-B18,
      `AUTO-DECISIONS.md` 2026-11-02 18:47 CST), so a kill mid-publish
      leaves the previous consistent manifest/world-data pair in place;
      `bundle-check.mjs` verifies hash agreement on every cycle.
- [x] Delta stream size ≤ 50 KB for the reference window (M2.11 exit
      gate), under whichever schema id Q4 settles.
      Evidence: VER seventh shift same-head pair — v1 12,020 B /
      v2 16,720 B, delta 4,700 B (pre-A1; A1 adds one short constant
      field, re-measured at the A1 delta sign-off).
- [x] A validator rejects an episode and an act sequence with
      `disclosure` removed (positive control for §1.4/§1.5), and accepts
      the same objects with the verbatim strings present.
      Evidence: `build/data/test/bundle-v2.test.mjs` disclosure controls;
      re-run by the VER seventh shift.
- [x] A validator rejects an episode and an act sequence whose
      `disclosure` is a stub ("n/a") or an altered near-copy
      (Hark minimum-content positive control), and every rejection is
      logged with the rejected record's id.
      Evidence: `build/data/test/bundle-v2.test.mjs` stub/near-copy
      controls; VER seventh shift — the "n/a" rejection logged as
      `episode:EMBER_PLAZA_OF_UNITY:…:#0` in
      `validation-rejections.jsonl`.
- [x] A validator rejects a bundle emitting `scenes[]` (Hark Q2
      condition — reserved means reserved) and a citizen carrying
      `presenceClass` (Q3).
      Evidence: `build/data/test/bundle-v2.test.mjs` scenes control;
      `presenceClass` rejection in `build/data/validate-v2.mjs`;
      VER seventh shift scenes control (exit 1, `scenes-emitted`).
- [x] `citizenIdStatus` maps the registry states as specified in §1.1
      (verified → `BOUND`, ambiguous → `CONFLICT`, unverified/absent →
      `UNBOUND_NO_ROUTE`), covered by tests including the real head.
      Evidence: `build/data/test/bundle-v2.test.mjs` registry-mapping
      test; VER seventh shift real-head cross-check against
      `archive/identity-registry.json` (17 citizens, all
      `UNBOUND_NO_ROUTE`, registry summary `{verified: 0,
      unverified: 17, ambiguous: 0}`).
- [ ] A render test proves the episode/act-sequence disclosure reaches
      app output (Hark condition; rides the app suite at v2 adoption).
      **OPEN at the freeze — the one unresolved checklist item.** It is
      an M2-adoption item owned by the app v2 adoption step (the next
      step after this freeze); the data-side validity rule (§§1.4/1.5)
      is fully discharged above.
- [x] The PORTAL-KEY clauses K1–K5 are covered by tests, including the
      anti-slugification assertion (zero `citizenId` bindings whose
      evidence is a transformation of the name).
      Evidence: `build/data/test/derive.test.mjs` (22) +
      `build/data/test/identity-registry.test.mjs` (10, incl. the
      anti-slugification negative control); VER-LOG Hark-Q2-conditions
      shift — ALL FIVE CONFIRMED.
- [x] `world.bookId` in a derived bundle equals the registry's open book
      id for the same head, and a simulated-reset fixture shows no
      cross-book merge (the §2.5 rule under test).
      Evidence: `build/data/test/world-books.test.mjs` +
      `build/data/test/reset-detect.test.mjs` (planted-reset positive
      control); VER seventh shift — `world.bookId` = `world-001` on the
      real head.
- [x] Open questions Q1–Q5 (§6) are settled or explicitly carried with
      their defaults adopted.
      Evidence: §6 dispositions; `audits/HARK-M2-MINIAUDIT-2026-11-02.md`.

Sign-off lines:

- VER sign-off: **SIGNED** — seventh shift, `build/VER-LOG.md`
  ("VER SIGNS OFF", no blockers). Amendment A1 delta sign-off:
  **PENDING** (see status header).  date: 2026-11-03
- Hark mini-audit: **SIGNED** — `audits/HARK-M2-MINIAUDIT-2026-11-02.md`,
  rulings Q1–Q5 adopted (§7).  date: 2026-11-02

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
6. **Amendment A1 — `world.integritySource` (added at the freeze,
   post-VER-sign-off; NOT a Hark item).** The D9 prep arm
   (`plan-to-complete/D9-INTEGRITY-FORK.md`) found that M2.07 names a
   field `integritySource: "none-in-tier-p"` that existed nowhere in
   `build/` or in this contract's draft. The freeze is its cheapest
   landing spot, so it lands WITH the freeze, honestly labelled:
   `world.integritySource` is REQUIRED and must be exactly
   `"none-in-tier-p"` — Tier P publishes no building integrity (each
   work's `integrity` stays `null`), and the constant is the whole
   value. Any other value is invalid; a future real source changes
   the contract, never the constant. Implemented in
   `build/data/derive-v2.mjs` (`INTEGRITY_SOURCE`) +
   `build/data/validate-v2.mjs` + `build/data/test/bundle-v2.test.mjs`
   (incl. the wrong-value positive control). Status: **FROZEN pending
   a VER delta sign-off on A1 only**. The §1.1 delta count rises
   10 → 11 on this amendment.

7. **Amendment A2 — record-scope wording (2026-11-02; NOT part of the
   original freeze).** Source: my Hark's OM-15 staging-honesty audit,
   part 3 (`audits/HARK-OM15-AUDIT-2026-11-02.md`), adopted as binding
   condition C3: Portal reads only the public Tier P feeds, so no
   user-facing text may claim "the record" or "the public record" as
   its scope. The two contract disclosure strings change:

   | String | Before A2 | After A2 |
   |---|---|---|
   | Episode `disclosure` (§1.4) | "…the **public record** does not show who else was present…" | "…the **public feeds Portal reads** do not show who else was present…" (all other words unchanged) |
   | Act-sequence `disclosure` (§1.5) | "Recorded acts only. The **public record** shows acts, not ongoing work." | "Recorded acts only. The **public feeds Portal reads** show acts, not ongoing work." |

   Enforcement is by the existing mechanism, unchanged: `validate-v2.mjs`
   compares each disclosure against the `DISCLOSURE` / `ACTS_DISCLOSURE`
   constants in `build/data/episodes.mjs`, so the reworded constants are
   enforced verbatim from the moment they land — the pre-A2 strings,
   stubs ("n/a"), and one-word-altered copies of the new strings all
   fail, and every rejection is logged with the record's id (§7 item 4's
   rule). Delta controls for exactly this are pinned in
   `build/data/test/bundle-v2.test.mjs`.
   Reworded in the same pass, outside this contract's text (same rule,
   named here so the sweep is auditable): the M3.04 disclosures in
   `build/engine/conflicts.mjs` (conflict / exit / entry) and their app
   renderings in `build/app/logic.mjs` and `build/app/app.js`; the
   journey disclosure in `build/data/journeys.mjs` and the journeys
   empty-feed note in `build/app/live-pacing.mjs`; the integrity tier
   label and building-card line in `build/app/logic.mjs` ("Repair not
   in the public feeds Portal reads"); the `work.delivered` basis text
   in `build/data/action-table.mjs` (the public feeds Portal reads
   contain no delivery evidence; `DELIVERY_PATTERNS` stays empty); and
   the remaining "public record" scope phrases in `build/app/logic.mjs`,
   `build/app/app.js`, and `build/app/index.html` (badge, presence,
   provenance, growth note, load-failure and now lines). No field,
   type, enum, or derivation changes; wording-class only, per §4.2.

8. **Amendment A3 — optional carriage: `offices` + ticker `dueUtc`
   (2026-11-03; NOT part of the original freeze).** Source: the M6
   Find & Watch lane (`plan-to-complete/lane-m6-find.md`, M6.01/M6.04)
   proved the app's office-title and deadline models against fixtures
   but found them live-dark: the evidence existed in the Tier P record
   while the frozen bundle carried no projection of it. A3 adds
   exactly two OPTIONAL projections, additive under §4.2 — a consumer
   that ignores them is unaffected, and a pre-A3 bundle (no `offices`
   key, no `dueUtc` anywhere) remains valid:

   | Carriage | Where | Source (the whole rule) |
   |---|---|---|
   | `offices` | top level; the deriver always emits it (may be `[]`) | One entry per office holder an archived route NAMES. Tonight exactly one route names one: `overview.ember.mayor` (`{ name, sits }`, `sits !== false`). Entry: `{ office: "MAYOR", name, citizenKey, provenance: { route: "overview", fetchedUtc } }`. `citizenKey` is the holder's PORTAL-KEY when the evidenced name matches exactly ONE citizen record in the bundle, else `null` — a shared name binds neither (ambiguity never binds). An office asserted anywhere else (headline prose, an utterance, a record with no overview behind it) is NOT carried: assertion is not evidence. |
   | `dueUtc` | `ticker[]`, present on an item ONLY where evidenced | The item's OWN source headline record carries a due/response stamp: `due_at` or `closes_at` (the record family's closing-stamp field — discussions and stories use `closes_at` for exactly this) holding a parseable date; the value is carried verbatim. A stamp on any OTHER record is never attached — no headline references a discussion, debate, or story, so no evidenced join exists. Unparseable stamps are not carried. |

   Enforcement: `validate-v2.mjs` validates the carriage WHEN PRESENT
   (a malformed entry fails: office without its holder name, without
   provenance `{ route, fetchedUtc }`, or citing a `citizenKey` no
   citizen in the bundle carries; a `dueUtc` that is not a parseable
   date). Absence is never a failure. Pinned in
   `build/data/test/bundle-v2.test.mjs`: present-when-evidenced (real
   head + synthetic), absent-when-not, provenance attached,
   ambiguous-name unbound, unparseable-stamp not carried, and the
   negative control — an office fabricated in fixture records (a
   headline and an utterance naming a "mayor" the overview does not)
   is NOT carried. Live effect on landing: the bundle gains
   `offices: [MAYOR → Atlas Meridian]`; the live ticker gains **no**
   `dueUtc`, because no headline in the archive carries a due stamp
   tonight — the discussions' `closes_at` values (e.g. discussion #2,
   2026-11-27) exist in their own route and are not headline evidence.
   Lane record: `plan-to-complete/lane-carriage.md`. No field removed,
   renamed, or retyped; no required set change — additive only, per
   §4.2.

Editorial correction found during implementation (not a Hark item):
§1.2's collision example originally named the assigned-keys field
`keys`; the shipped v1 deriver emits `citizenKeys`, and §1.2 now matches
the deriver — the §5 field-by-field check is run against actual output.
