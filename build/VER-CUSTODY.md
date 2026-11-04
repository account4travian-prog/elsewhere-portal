# VER Custody — invariant custody list and cold-verifier checklists

Custody document of the standing verification (VER) thread. It names every
invariant the thread holds, where its check lives, its positive control,
and the cadence at which the VER seat re-runs it. Companion file:
`VER-LOG.md` (dated re-run records and defect log).

Rule of this file: a check's status is stated as it is. **Live** means the
VER seat has run it and seen it pass (and, where it has one, seen its
positive control caught). Anything else is marked with the wave that owes
it; until then the invariant is a claim, not a check.

## 1. Custody list

### 1.1 No-teleport invariant — LIVE

- **Claim (Plan B §7.3):** a figure's rendered position is always on its
  recorded route, monotone in route-distance, never early, never skipping
  a place.
- **Where the check lives:** `build/engine/playback.mjs` (`planJourney` /
  `positionAt` / `catchUp`); the invariant test is
  `build/engine/test/no-teleport.test.mjs` (continuity asserted over 5
  journeys).
- **Positive control:** `mutantPositionAt` in the same test file — a
  position function that teleports (origin until mid-journey, then the
  destination instantly). The suite asserts the checker rejects it on
  every timed journey (route-distance discontinuity, early arrival,
  skipped intermediate place). If the mutant ever passes, the suite fails.
- **VER status:** re-run 2026-11-02 — 2/2 tests pass, mutant **caught**
  (see VER-LOG.md).
- **Cadence:** every wave gate and weekly (§2). The mutant result is
  named explicitly in every VER record, never folded into a suite-green
  summary. A mutant that passes is a P1 defect in the checker and
  outranks feature work (Quality charter §2).

### 1.2 Hash-bound bundles (snapshot authority) — LIVE (manual + suite)

- **Claim:** bundle contents derive only from fetch-log-pointed snapshots;
  consumers verify `sha256(feed/world-data.json) == manifest.worlddataHash`
  before use, and a hash-failed bundle is discarded whole, never partially
  trusted (contract §6.1).
- **Where the check lives:** `build/data/build-bundle.mjs` writes
  `build/data/feed/world-data.json` (canonical bytes) +
  `build/data/feed/manifest.json`; manifest-hash equality is asserted in
  `build/data/test/bundle.test.mjs`; the deriver determinism half (same
  archive head + seq ⇒ identical bytes and hash) is asserted in
  `build/data/test/derive.test.mjs`.
- **Positive control:** a hand-edited `world-data.json` fails the SHA-256
  recomputation and is discarded whole. In Wave 1 this control is
  exercised by the VER/coordinator recomputation route (below), not yet
  by a planted-tamper automated test — VER notes this as the control's
  current form, honestly.
- **VER status:** recomputed 2026-11-02 — `sha256sum` of the bundle =
  `99cd8cda214bfbe194aa677bc577e15b1cb32f881547ffdb068f2dbd54bb9016` =
  manifest `worlddataHash` = the hash recorded in `WAVE1-REPORT.md`.
  **Match.**
- **Cadence:** recomputed at every wave gate and weekly, against the
  then-current feed head; the recomputation is done by the VER seat's own
  `sha256sum`, never quoted from the manifest alone.

### 1.3 Canonicalisation — PARTIALLY LIVE

- **Claim:** the bundle's canonical byte form is produced by recursive
  key-sort (`canonicalStringify`), so the same logical content hashes
  identically regardless of input key order or process locale — the
  cross-locale determinism invariant (same head, two locales, identical
  hash).
- **Where the check lives:** `canonicalStringify` + `sha256hex` in
  `build/data/derive.mjs`; derivation purity is tested in
  `derive.test.mjs` (same head + seq ⇒ identical canonical bytes and
  hash, also re-verified over the live archive head at Wave 1 delivery).
- **Positive control (owed):** the charter's named mutant is
  `localeCompare`-based sorting, which must fail under a second locale.
  No two-locale automated run exists in the Wave 1 tree; the canonical
  sort itself is locale-independent by construction (plain key sort), but
  VER records the two-locale check as **not yet run** — a check not run
  is reported as not run. Due with the M2 canonical-form work; VER will
  run the bundle derivation under a second `LC_ALL` locale and compare
  hashes at that gate.
- **Cadence:** purity test at every wave gate (it is inside the data
  suite); two-locale comparison at the M2 gate and thereafter whenever
  the canonicalisation code changes.

### 1.4 Identity verification rule — RULE IN CUSTODY, NO SUBJECTS YET

- **Claim:** a citizen's handle counts only when the public agent route
  answers for it **and** the display name matches the record exactly,
  character for character. Slugify-guessing a handle from a display name
  is banned. Until a handle is verified, citizens ship under the
  Portal-generated `citizenKey` (interim keying), never under an inferred
  handle.
- **Where the check will live:** the M2 identity registry work; the
  anti-slugification test (a fixture whose slugified guess differs from
  the verified handle must not bind) is required at the M2 contract
  freeze.
- **Wave 1 state:** Tier P exposes display names only, so every real
  citizen in bundle seq 1 ships `handle: ""`, keyed by name. There are
  no handles in the tree to verify, and VER verified that negative
  directly in the bundle rather than assuming it. The known consequence —
  citizens keyed by a shared empty handle in app state — is the plan's
  WP-02 / M2.03 `citizenKey` fix, owned by the data/engineering arms;
  VER holds the exit check for it.
- **Positive control (owed at M2):** the namesake/slugify fixture above,
  plus a keying-by-evidence-timestamp mutant for identity stability
  across consecutive bundles (charter §2).
- **Cadence:** rule audited at the M2 freeze; thereafter, every bundle
  head's key stability is sampled in the weekly pass (same citizen, same
  `citizenKey`, consecutive bundles).

### 1.5 Remaining charter invariants — status table (honest)

| Invariant | Wave 1 status | Where it lands | Positive control |
|---|---|---|---|
| Provenance completeness | Partially live: `derive.test.mjs` asserts route + fetch-time provenance on every citizen and ticker item in the derived bundle. Works/Chronicle/talk are not yet bundle scope. | Full bundle-walking crawl at the wave gates from M3; speech/Growth extensions at M5/M6. | One item with provenance stripped must fail the crawl, naming the item. |
| Identity stability | Not yet automated (see §1.4). | M2 registry + consecutive-bundle checks. | Keying by evidence timestamp must change a key and be caught. |
| Cross-locale determinism | Purity live; two-locale run not yet done (see §1.3). | M2 canonical-form gate. | `localeCompare` sorting mutant fails under locale two. |
| No-write | True by construction only: the Wave 1 poller issues GETs to the six committed Tier P routes and nothing else. No automated log check yet. | M2.13 slot-unread test + fetch-record checks under v1 config. | A planted non-`/public/` record must be caught. |
| Book isolation | Not yet applicable: reset detection is not built; the `status` route is archived only. | Reset/book work (Plan B §2.3 lineage). | A merged-books fixture must be rejected. |

## 2. Re-run cadence the VER thread keeps

- **Per wave gate (every wave, from M1 onward):** the full `run-all`
  equivalent — every suite in every arm, re-run by the VER seat or the
  coordinator with the exact commands in the arms' STATUS.md files —
  plus the invariant suite, plus **every mutant executed against its
  checker and named in the record (caught / not caught)**. Bundle hash
  recomputed at the gate head. No wave's items enter the next wave's
  inputs until their verification records exist.
- **Weekly steady state (width 1):** re-run all suites at the current
  head; recompute the current bundle hash against its manifest; sample
  the fetch log (row parse, per-route counts since last pass, any error
  rows dispositioned); confirm the custody list's statuses still match
  the tree (a check that moved or vanished is a finding).
- **Milestone exits (width 2):** the per-wave routine plus the cold
  verifier executing the milestone's exit gate exactly as written,
  including its positive controls, against the live effect — never by
  summing item reports.
- **On any checker change:** the changed checker's full control set
  (mutants + golden corpus) re-runs before it gates anything again, and
  every gate it touched since its last known-good control run is
  re-run (Quality charter §5.1 blast-radius rule).

## 3. M1-exit cold-verifier checklist — the 48-hour mark (A0)

For the cold verifier who did not build the archiver. Source of truth:
`build/data/archive/fetch-log.jsonl` plus the snapshot files it points
at. Cadences (from `build/data/cadence.json`): overview 60 s,
status 60 s, news 120 s, voices 120 s, map 300 s, chats 300 s.

**Log format (cold-read from the Wave 1 rows and `poller.mjs`).** One
JSON object per line, one line per fetch attempt, appended in attempt
order. Every row carries `route` and `utc` (ISO 8601, attempt time).
Success rows (HTTP 200, body changed) add `snapshotId`, `file`
(`<YYYY-MM-DD>/<route>-<UTC stamp>.json`, relative to the archive root),
`status: 200`, `bytes`, `sha256` (of the stored body). Unchanged-body
rows are recorded without a new snapshot (the poller's console form
shows `unchanged`; the verifier confirms the marker's exact field from
a real row in the log, not from source). Error rows: a network/fetch
failure records `status: "error"`, `bytes: 0`, `sha256: null`, and
`error: "fetch failed: …"`; a non-200 response records the HTTP
`status`, the body's `bytes`/`sha256`, and `error: "HTTP <status>"`; an
unparseable body records `status`, `sha256`, and
`error: "malformed JSON: …"`. A failing route never stops the pass, so
every scheduled attempt must leave a row of one of these shapes.

**The checklist:**

1. **Parse the whole log.** Every line of `fetch-log.jsonl` parses as
   JSON and carries `route` + `utc`. Any unparseable or field-missing
   line is a finding; quote its line number.
2. **Window and expected counts.** Take the 48 h window from the log
   itself (first to last row). Expected attempts per route over a full
   48 h: overview ≈ 2,880; status ≈ 2,880; news ≈ 1,440; voices ≈
   1,440; map ≈ 576; chats ≈ 576 (pro-rate if the window is shorter,
   and say so). Record actual vs expected per route.
3. **Gap analysis per route.** For each route, compute the interval
   between consecutive `utc` values. Any interval **> 2× the route's
   cadence** (i.e. at least one full missed cycle beyond scheduling
   jitter) is a **gap**: list each gap with route, start, end, and
   duration. Gaps are reported as gaps — never averaged away.
4. **No backfill.** Rows are in non-decreasing `utc` order, and each
   success row's `file` timestamp matches its row's `utc` to the
   second. An out-of-order row or a snapshot whose stamp disagrees
   with its log row is evidence of interpolation/backfilling:
   **stop-the-line finding**.
5. **Snapshot integrity.** For every success row, the file exists at
   `archive/<file>` and `sha256(file bytes)` equals the row's
   `sha256`. For every unchanged row, confirm it points at the prior
   body (same `sha256` as the route's last stored snapshot) and that
   no duplicate snapshot file was written. Sample at minimum: all rows
   for the first and last hour, plus 20 rows drawn at random per route
   — or the full set if tooling makes it cheap; state which was done.
6. **Error dispositions.** Enumerate every row with `status != 200` or
   an `error` field. Classify each (fetch failed / HTTP code /
   malformed JSON). Every error row must have a disposition reachable
   from the wave record (cause + what the failure ladder did). Any run
   of **> 3 consecutive errors on one route**, and any malformed-JSON
   row (check the deriver skipped that snapshot for the next-newest
   valid one at bundle time), is individually named in the report.
7. **No-write / route-set check.** Every row's `route` is one of the
   six committed Tier P routes. Any other route string is a
   **stop-the-line finding**.
8. **The A0 figure.** State one number: **gap-free hours** — the length
   of the span, ending at the window's end, during which every route's
   attempt-gap stayed ≤ 2× its cadence — plus each route's coverage
   (actual ÷ expected attempts, %). **A0 passes only at 48.0 gap-free
   hours** with every gap and error from steps 3 and 6 dispositioned
   on the record. Anything less is reported as the number it is
   ("A0: 31.5 gap-free hours of 48"), not rounded into a pass.
9. **Bundle continuity.** Recompute `sha256(build/data/feed/world-data.json)`
   against the live manifest's `worlddataHash` (must match), and
   confirm the manifest's `newestFetchUtc` is no older than 2× the
   slowest cadence (600 s) before the moment of checking — the bundle
   the app would serve is actually being rebuilt from the archive the
   verifier just audited.
