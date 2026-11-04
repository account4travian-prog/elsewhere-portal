# Arm A (Data) — STATUS

Wave 1 deliverable: Tier P poller/archiver → pure WorldData deriver → bundle
CLI, run once against the live world. **The live run succeeded: 6/6 routes,
HTTP 200, real snapshots archived, bundle built and hash-verified.** This
archive is the P0 archive's first entries — no payload in it is a mock.

## Files

| File | What |
|---|---|
| `poller.mjs` | One pass per invocation fetches the six Tier P routes (stdlib `fetch` only, UA `ElsewherePortal/0.1 (+archiver)`, 30 s timeout). Writes `archive/<YYYY-MM-DD>/<route>-<UTC stamp>.json` only when the body SHA-256 differs from the route's last stored body; appends every attempt (route, utc, status, bytes, sha256, snapshotId/file or error) to `archive/fetch-log.jsonl`. A failing route is recorded and never stops the pass. Bonus `--watch` mode honours `cadence.json` (smoke-tested live, see below). Exports `fetchRoute`/`runPass`/`lastSnapshot` for tests. |
| `cadence.json` | Plan B §2.1 cadences: overview/status 60 s, news/voices 120 s, map/chats 300 s, plus baseUrl/UA/timeout. In wave 1 only `--watch` consumes the intervals; cron is the integrator's step. |
| `derive.mjs` | `deriveWorldData(head, {bundleSeq})` — pure (no I/O, no wall clock). `canonicalStringify` (recursive key-sort) + `sha256hex` exported for hashing/tests. `unfence` strips `ELSEWHERE_UNTRUSTED` fence markers from display fields; content is treated as quoted text only (Plan B §6.5). |
| `build-bundle.mjs` | CLI (`--archive`, `--feed`). Newest valid snapshot per route via fetch-log pointer, falling back to a filename scan; a malformed newest snapshot is skipped with a stderr warning for the next-newest valid one. Writes `feed/world-data.json` (canonical bytes) + `feed/manifest.json`; `bundleSeq` increments from the previous manifest. |
| `test/derive.test.mjs` · `test/poller.test.mjs` · `test/bundle.test.mjs` | 22 tests, all passing (below; count includes the E1/M2.03 PORTAL-KEY tests). Fixture payloads inside them are synthetic miniatures in the real shapes, labelled as such in the test files. |
| `archive/2026-11-02/` + `archive/fetch-log.jsonl` | The live run's six snapshots (872 KB total). |
| `feed/world-data.json` · `feed/manifest.json` | Bundle seq 1 (below). |
| `../../fixtures/live-*.json` + `README.md` | Trimmed copies of this run's real payloads for Arms B/C (trims documented in that README). |

## Tests — exact commands and results (re-run at delivery)

```
node --test test/derive.test.mjs   → tests 15, pass 15, fail 0
node --test test/poller.test.mjs   → tests 4, pass 4, fail 0
node --test test/bundle.test.mjs   → tests 3, pass 3, fail 0
```
(use the file-path form; directory-form `node --test test/` misbehaves on
this VM's Node v24.22.1.)

Covered: derivation purity (same head + seq ⇒ identical canonical bytes and
hash — also re-verified over the LIVE archive head outside the suite:
identical hash on re-derive); provenance present on every citizen/ticker
item; unknown-state citizens (news-only) have `placeCode: null`; citizen
state bands (talking ≤30 min, present ≤2 h, asleep beyond, measured against
the voices payload's own `generated_at`); unchanged body recorded but not
re-snapshotted; malformed payload rejected + recorded without crashing the
pass (poll stub) and skipped for the next-newest valid snapshot at bundle
time; HTTP/network failures recorded, never thrown; manifest
`worlddataHash` equals SHA-256 of the written `world-data.json` bytes
(independently confirmed with `sha256sum`: `99cd8cda…` = manifest).

## Live run — evidence

`node poller.mjs` at 2026-11-02 ~02:07 UTC, then `node build-bundle.mjs`
(zero warnings). Fetch records (full rows in `archive/fetch-log.jsonl`):

| Route | Status | Bytes | Snapshot |
|---|---|---|---|
| overview | 200 | 6,860 | `2026-11-02/overview-20261102T020712Z.json` |
| news | 200 | 98,048 | `2026-11-02/news-20261102T020713Z.json` |
| voices | 200 | 32,194 | `2026-11-02/voices-20261102T020714Z.json` |
| map | 200 | 656,689 | `2026-11-02/map-20261102T020714Z.json` |
| status | 200 | 51 | `2026-11-02/status-20261102T020714Z.json` |
| chats | 200 | 83,164 | `2026-11-02/chats-20261102T020714Z.json` |

Bundle: `bundleSeq 1`, `worlddataHash
99cd8cda214bfbe194aa677bc577e15b1cb32f881547ffdb068f2dbd54bb9016`,
`newestFetchUtc 2026-11-02T02:07:14.942Z`, `dataAgeSeconds 37`.
Derived content (real): world Spring, year 45, hour 11, sky OVERCAST;
counters 5821 discovered / 5104 surveyed / 5014 named / 616 College deposits
/ treasury 809,400 / population 288; 3 districts; 3 civic works; **12
citizens** (10 placed by voices evidence — 1 talking, 9 asleep by the ≥2 h
silence band at that quiet hour — and 2 news-only roster rows at `unknown`);
**24 ticker items** from headlines, newest 2026-11-02T01:30:52Z.
`--watch` smoke: one full live pass in ~3 s against a throwaway archive
(deleted after), all routes 200.

## Derivation mapping (what the real payloads honestly support)

- **world**: `sky` ← overview `sky.over_ember`; `worldHour` ← overview
  `world_hour` (map fallback); `season`, `year` ← overview.
- **counters**: overview `frontier.regions_*`, `college.deposits`,
  `ember.treasury_bennies`, `population.joined` — exact matches to the plan.
- **ember.districts**: overview `ember.districts` aggregates (held/vacant,
  quarters, fixtures, towers), map's identical table as fallback.
- **ember.works**: map `ember.civic_works` code list →
  `{code, integrity: null}`.
- **citizens**: latest voices utterance per speaker ⇒ place + state;
  news.residents not placed by voices ⇒ roster rows (`unknown`, place null).
- **ticker**: news `headlines` (cap 50, newest first); `locate.anchor`
  plaza/townhall/college mapped to place codes, anything else null;
  `handles` left `[]` (headlines evidence no handles — see gaps).

## Gaps vs Plan B / contract — honest list

1. **No true handles in Tier P.** voices `by` and news.residents `handle`
   both carry display *names*. Citizens therefore ship `handle: ""` with
   `name` set, keyed by name. Filling handles needs `/public/agents/{handle}`
   (on-demand route, out of wave-1's six) or Tier A — an integrator decision,
   not something to slugify into existence.
2. **No per-plot records** in the six routes (districts are aggregates;
   "counts only, never a name or a plot" per the payload itself) ⇒ no
   holder/quarters/geometry is ever derived for a plot. What voices does
   evidence is plot *place codes* with speech (M2.06): `ember.plots`
   carries one `feed-evidenced` entry per such code (existence only,
   with `firstEvidencedUtc`; occupancy stays head-based via citizens'
   placeCode). Existence is world-book-scoped (2026-11-03): an entry
   persists for the life of the current book once any of its voices
   snapshots evidences the code, never across a closed book, and the
   list is `[]` when no snapshot of the current book evidences a plot
   place. The
   named anchor plots (D3P18, D1P31) cannot be evidenced from these
   routes; they live in the layout classed `record-attested`.
3. **No civic-works integrity values** in the six routes ⇒ works carry
   `integrity: null` (Plan B §4.3: no health shown is the honest tier). The
   app must NOT colour works by integrity bands until a route evidences it.
4. **chats does not move presence** — channel speech is a side panel
   (Plan B §2.1), deliberately not stage evidence; it is archived and
   fetch-logged like the rest.
5. **Plan B §2.2 minimalism not yet implemented**: the archive currently
   keeps full bodies per changed snapshot for all six routes (Plan B wants
   voices reduced to a speech index after 48 h, map thinned after 7 days,
   status bodies dropped). Wave-1 archive is one pass (872 KB); the thinning
   job is a P0 follow-up before the archive grows teeth.
6. **No cron yet**: the poller is invoked by hand / `--watch`. Wiring the
   60–300 s cadence into cron is the integrator's A0 step; acceptance there
   is Plan B §2.4's 48 gap-free hours, which a single pass does not claim.
7. **Reset detection (§2.3) not built** — status is archived; book
   open/close logic is future work. `status.json` at run time:
   `{online: true, test_world: true, next_reset: null}`.
8. **dataAgeSeconds semantics**: largest (fetch − payload `generated_at`)
   across routes carrying `generated_at` (37 s on the live run — the world's
   own 30 s delay plus fetch spread). It is an input-derived figure, not a
   client age; clients still derive LIVE/STALE from `newestFetchUtc` per
   Plan B §6.2.
9. Citizen `state` bands use the voices window only; work/gather evidence
   (Plan B §4.3 WORKING/GATHERING) has no source in these six routes, so no
   citizen is ever derived `working` in wave 1. The contract enum's
   `travelling` likewise awaits journey reconstruction (P2).

## Integrator notes

- Bundle consumers: read `feed/manifest.json` first; verify
  `sha256(feed/world-data.json) == worlddataHash` before use (contract §6.1:
  a hash-failed bundle is discarded whole, never partially trusted).
- `build-bundle.mjs` is safe to re-run: seq increments, content for the same
  archive head is deterministic apart from `bundleSeq`.
- Snapshot filenames embed UTC (`<route>-<YYYYMMDD>T<HHMMSS>Z.json`); the
  fetch log is the authority for which snapshot is newest per route.
- No npm dependencies were added; everything is Node v24 stdlib. No licence
  notes required.

## E1 update — M2.03 citizen identity (the PORTAL-KEY), 2026-11-02

- **The `handle: ""` collapse is fixed.** Every citizen record now carries
  `citizenKey` — the PORTAL-KEY, a Portal-generated interim record label
  (never a handle, never an identity; `handle` stays `""`). Scheme and the
  five adopted Hark-audit conditions are documented in `derive.mjs`:
  `portal-key:` + name slug; collisions disambiguated by a deterministic
  evidence tuple with `#2`, `#3` suffixes and flagged in the bundle's new
  `citizenCollisions` list; records are never merged on name alone (a
  news.residents row now stands beside a voices record of the same name);
  each record stores its raw display name + `firstSeenUtc` beside the key;
  a rename yields a new key — no rename-chasing.
- Sorting in the deriver is code-unit order (`cmpStr`) instead of
  `localeCompare`, so canonical bytes cannot vary with the environment's
  ICU build.
- One earlier test's merge expectation ("voices wins over the residents
  row") was replaced by the no-merge semantics per audit condition (3).
- Feed rebuilt from the live archive head (bundleSeq incremented; the
  archiver is live, so the head keeps moving): records are one per
  evidenced person, keys distinct, `citizenCollisions` present (empty in
  the current head — no source record shares a name right now).

## M3.01 update — journey reconstruction, 2026-11-02

- **`journeys.mjs` (pure) + `journeys-cycle.mjs` (companion CLI)** land
  journey reconstruction: consecutive evidenced placements of one citizen
  (utterance union over the open world-book's voices snapshots, deduped by
  server utterance id) become legs bounded by the LAST origin utterance
  and the FIRST destination utterance, scheduled inside the evidence
  window on a 30 s tick grid anchored at the book's `opened_at`, labelled
  `reconstructed: true` and carrying `JOURNEY_DISCLOSURE` verbatim.
  Presence is claimed only at the evidenced endpoints; the walked path is
  the layout graph's (engine), per the episodes honesty rule.
- **Ceiling (adopted, open decision):** M3.01 cites M1.10's spike for its
  ceiling; no such note exists in the tree and none was invented. The
  interim ceiling is in `journeys.mjs`'s header: same citizen, same book,
  both bounds utterance-evidenced, and the window under continuous
  voices-fetch coverage (no silence > GAP_FACTOR 2 × voices cadence =
  240 s, health.mjs's gap definition) — including the era clause:
  retroactive rolling-window capture before the first fetch is not
  coverage. It lives in `windowCovered` + one constant so a future spike
  ceiling supersedes it in one place.
- **Artefact:** `feed/journeys.json`, schema `portal.journeys/v1` — a
  companion file like `episodes.json`, because CONTRACT-V2 is frozen and
  the bundle's `journeys: []` stays as frozen. First live run:
  15 speakers, 152 utterances, **27 candidate legs, 0 reconstructed,
  27 rejected by the ceiling** — every candidate predates continuous
  coverage (A0 2026-11-03T00:27Z), and since A0 no citizen has yet been
  evidenced at two places. Deterministic bytes; atomic write.
- **Invariant:** the §7.3 checker was extracted unchanged into
  `build/engine/test/invariant-harness.mjs` (no-teleport.test.mjs imports
  it; still 2/2) and `no-teleport-reconstructed.test.mjs` runs it — plus
  the teleporting-mutant positive control — over reconstructed journeys:
  golden window (exactly one journey, arrival on the first destination
  evidence), a 0-tick near-reach reconstruction, vanish/dark windows, and
  a live-corpus property run over the real archive.
- **Tests:** `test/journeys.test.mjs` 12/12, `test/journeys-cycle.test.mjs`
  5/5, engine `no-teleport-reconstructed.test.mjs` 4/4; full data suite
  156/156, engine 29/29 at delivery.
- **Not wired:** the supervisor has no journeys step yet. Hook spec is in
  `journeys-cycle.mjs`'s header (a `run_step "journeys" ...` after the
  bundle step) for the coordinator to apply like the episodes hook.
- **Naming mapping (M3.03 coordination, 2026-11-02):** the action
  table's coalesced `work.delivered` beats anchor their performance at
  `performAnchor: 'arrival-node'` — a PLACE. The journeys artefact's
  `arrivalUtc`/`arrivalTick` are TIMES (first destination evidence /
  its scheduled tick; `arrivalTick` is the engine's own term in
  playback.mjs). Spatial arrival in the journey shape is `to`. Mapping
  for consumers: an 'arrival-node' beat on a journey is performed at
  node `to`, reached at `arrivalTick`. Documented in `journeys.mjs`'s
  header; neither vocabulary renamed.

## M3.05 — corpus invariant run + stuck-actor check (2026-11-02)

- **Landed:** `corpus-invariants.mjs` (schema `portal.invariants/v1`)
  runs the §7.3 no-teleport checker over the full recorded corpus and
  writes `archive/invariants.json`; `health.mjs` embeds its summary as
  health.json's `invariants` section (null until a report exists).
  First live run: book world-001, 34 voices + 34 news snapshots,
  152 utterances, 15 speakers, 17 citizens known; 8 evidence-path
  journeys checked, **0 violations**; mutant caught 8/8; 2 stuck
  suspects (roster-only names, no speech in the 23.3 h window —
  questions, not accusations); 13 over-long beats; 14 off-graph legs
  excluded with reasons. Reconstructed set (M3.01 integration, wired
  via `buildJourneys`): 0 journeys under the coverage ceiling today.
- **Checker amendments (engine, `invariant.mjs`):** the corpus run
  found three false-positive classes in the §7.3 checker — retraced
  edges, per-place (not per-step) arrival tracking, and an
  early-arrival tolerance stricter than the engine's own 1e-6 leg-end
  snap. Fixed in the shared checker (extracted to
  `engine/invariant.mjs`; the M3.01 arm's `test/invariant-harness.mjs`
  is now a re-export shim), pinned by 4 new tests in
  `no-teleport.test.mjs`; mutant still caught everywhere.
- **Tests:** `test/corpus-invariants.test.mjs` 6/6; full tree at
  delivery: data 145/145, engine 49/49, app 84/84.
- **Not wired:** the supervisor has no invariants step yet. Hook spec
  in `INVARIANTS-HOOK-SPEC.md` (a `run_step "invariants" ...` after
  facts, before health) for the coordinator to apply by the
  established restart discipline.

## 2026-11-02 (America/Chicago) — OM15-C3: record-scope wording + contract Amendment A2 (data side)

Discharges the data half of my Hark's OM-15 condition C3: Portal reads
only the public Tier P feeds, so no user-facing string may claim "the
record" / "the public record" as its scope.

- **Disclosure constants (contract material, Amendment A2):**
  `episodes.mjs` DISCLOSURE — "…the public record does not show…" →
  "…the public feeds Portal reads do not show…" (all other words
  unchanged); ACTS_DISCLOSURE — "The public record shows acts, not
  ongoing work." → "The public feeds Portal reads show acts, not
  ongoing work." `journeys.mjs` JOURNEY_DISCLOSURE reworded the same
  way (both its scope claims).
- **Contract:** `build/CONTRACT-V2.md` — A2 header note, §§1.4/1.5
  quotes updated, §4.2 cross-reference, and §7 item 7 (amendment text
  + old→new delta table + the full list of surfaces reworded).
  `validate-v2.mjs` needed NO code change: it compares disclosures
  against the `episodes.mjs` constants, so the new templates are
  enforced verbatim from landing and the old strings fail the same
  controls as stubs and near-copies.
- **work.delivered basis text (`action-table.mjs`):** header rule 3
  now reads "the public feeds Portal reads contain no delivery
  evidence"; the beat text and the DELIVERY_PATTERNS comment reworded
  to match. DELIVERY_PATTERNS stays empty; zero-delivery behaviour
  unchanged (action-table suite 12/12).
- **Delta check (VER-style, this arm):** new control in
  `test/bundle-v2.test.mjs` — pre-A2 episode + acts strings REJECTED
  (rejection logged with kind `disclosure`), one-word-altered copies
  of both A2 strings REJECTED, new strings accepted (synthetic-bundle
  control). Standalone re-check against the live bundle shape: stub
  "n/a" rejected, altered A2 acts string rejected.
- **Suites:** data 175/175 (baseline 174 + the new A2 control),
  engine 49/49, app 136/136.
- **Live effect, no restart:** the supervisor spawns each step as a
  fresh node process per cycle, so the new constants took effect on
  the next cycle unaided — bundle seq 62 (published
  2026-11-03T01:40:08Z, bundle-check OK, hash 33941c70…) carries the
  A2 disclosures in world-data.json, episodes.json, and
  journeys.json. The archiver/supervisor were NOT restarted.
- **D9 pack:** Hark's OM-15 part-3 Tier A evidence appended to
  `plan-to-complete/D9-INTEGRITY-FORK.md` (append-only; pack text and
  recommendation untouched).
