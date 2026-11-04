# Elsewhere Portal — E1 (Contracts) Report, 2026-11-02

Scope: plan-to-complete M2.03 (WP-02) + layout code pinning + stand-in
retirement. Arms touched: data (`derive.mjs`, feed), app (`app.js`,
`logic.mjs`, sample fixture), shared layout (verification only).

## 1. citizenKey — the PORTAL-KEY (M2.03 / WP-02) — DONE

The critical defect is fixed: Wave 1 shipped every real citizen with
`handle: ""` and the app keyed positions/roster/follow by handle, so all
evidenced citizens collapsed onto one spot. The deriver now emits a
PORTAL-KEY per citizen record and the app keys everything by it.

Scheme (pure function of the archive head, in `build/data/derive.mjs`):
the key is `portal-key:` + a slug of the evidenced display name (NFKC,
trim, whitespace collapsed, lowercase; `[a-z0-9]` kept, space/`-` → `-`,
everything else percent-encoded UTF-8). Collisions — records whose
normalised names slug identically — are ordered by a deterministic
evidence tuple (raw name, state, placeCode, evidenceUtc, provenance
route, provenance fetch time; code-unit order), the strongest-evidence
record keeping the bare key and the rest taking `#2`, `#3`, ...

Hark-audit conditions, adopted and built in:
1. The key is labelled PORTAL-KEY in docs/UI strings — never a handle,
   never an identity; the `portal-key:` prefix makes the label part of
   the value. `handle` stays `""` (Tier P evidences no handles).
2. Each record stores its raw display name (`name`) and a first-seen
   timestamp (`firstSeenUtc` = the record's earliest evidence within
   the current head) beside the key.
3. Records are never merged on name alone: one record per voices
   speaker, one per news.residents row, never folded into each other.
   (A speaker's own utterances across places remain one record — that
   is one source record's evidence stream, latest utterance current.)
4. A rename produces a NEW key; nothing chases renames. Records link
   only when a server-side id evidences it (the M2.04 registry).
5. Same name, two records ⇒ the collision is flagged in the bundle's
   new top-level `citizenCollisions` list (bare key, raw names, all
   assigned keys) — never silently folded. Empty list when clean.

Also in the deriver: sorts now use code-unit comparison (`cmpStr`)
instead of `localeCompare`, so canonical bundle bytes cannot vary with
the environment's ICU build.

App side: `citizenKeyOf` + `citizenPositions` (pure, tested) in
`logic.mjs`; positions, roster, follow, cards, colours, and click hits
in `app.js` all key by the PORTAL-KEY.

Live verification (rebuilt feed, current archiver head): 17 citizen
records, all keys distinct, freshest evidence holding bare keys;
13 evidenced citizens placed at 13 distinct stage positions in a
node-level smoke through the app's own logic.

## 2. Layout codes — VERIFIED, no changes needed

`build/shared/ember-layout.json` already carried the pinned codes with
per-node `codeStatus`. Verified each claim against sources this run:
- Feed-evidenced in the Wave 1/current bundles: `EMBER_PLAZA_OF_UNITY`,
  `EMBER_COLLEGE`, `EMBER_TOWNHALL` (voices places), `LIBRARY_ANNEX`,
  `MARKET_HALL`, `PUBLIC_WORKSHOP` (map civic works).
- Openapi-attested (`~/workspace/elsewhere/reference/openapi.json`):
  `LIBRARY_ANNEX`, `MARKET_HALL`, `PUBLIC_WORKSHOP`, `EMBER_COLLEGE`.
- Record-attested (household Elsewhere record): `EMBER_DISTRICT_3_PLOT_18`,
  `EMBER_DISTRICT_1_PLOT_31`.
- The two homes (`EMBER_HOME_MAPLE_COTTAGE`, `EMBER_HOME_WILLOW_COTTAGE`)
  have no verified real code and stay honestly marked `staging`
  (disclosed in the layout note and the app's About line) — inventing
  codes for them would be a fabrication, and the Lead ruling keeps
  staging home codes disclosed.

## 3. Stand-ins retired — DONE

- **Deleted `build/app/local-playback.mjs`** (the divergent stand-in
  engine). `app.js` imports `planJourney`/`positionAt`/`catchUp` from
  `../engine/playback.mjs` directly; the demo path lost its stand-in
  branch, and the frame loop calls the real `catchUp` per its contract
  (window measured from the journey's start). No fallback remains: if
  the engine is absent the page fails loudly instead of lying quietly.
- **Deleted the built-in `FALLBACK_LAYOUT`** from app.js — the invented
  codes (`EMBER_LIBRARY_ANNEX`, `EMBER_MARKET_HALL`,
  `EMBER_PUBLIC_WORKSHOP`, `EMBER_HOME_1`, `EMBER_HOME_2`). The shared
  layout is the only layout; if it cannot be read, the stage shows no
  streets and the About line says so.
- The app sample fixture was aligned to real deriver output (real place
  codes, `handle: ""`, PORTAL-KEYs, `firstSeenUtc`,
  `citizenCollisions: []`).

Nothing remains on this item. (Out of scope and untouched, per plan:
`resolveNode`'s fuzzy label fallback — its deletion is M3.08.)

## 4. Tests — before → after, all green

| suite | before | after | notes |
|---|---|---|---|
| data (`node --test test/derive.test.mjs test/poller.test.mjs test/bundle.test.mjs`) | 13 | **22** | +8 PORTAL-KEY/no-merge/firstSeen/rename tests, 1 merge test rewritten to no-merge semantics |
| engine (`node --test test/astar.test.mjs test/playback.test.mjs test/no-teleport.test.mjs`) | 15 | **15** | untouched, still green |
| app (`node --test test/logic.test.mjs`) | 18 | **21** | stand-in tests replaced by real-engine tests (catch-up semantics differ: `none`/`catch-up` modes, speed exactly 2.5/8); +3 PORTAL-KEY keying/positions tests incl. the `handle: ""` collapse regression |
| **total** | **46** | **58** | no suite left red |

## 5. Observed, not absorbed (for the coordinator)

- `EMBER_DISTRICT_1_PLOT_30` is now evidenced in the live voices payload
  (two citizens talking there) but has no layout node, so those citizens
  are roster-only. Placing evidenced plots is M2.06's gate; flagged here
  rather than fixed with invented geometry.
- The bundle gained two additive fields (`citizenKey` on citizens,
  `citizenCollisions` top-level, plus `firstSeenUtc` on citizens) under
  schema `portal.world-data/v1`. CONTRACT.md is Atlas-owned; recommend
  ratifying the additions into it at the M2.11 v2 freeze.
- Bundle purity note: derivation stays pure per head; `bundleSeq` and
  the hash moved because the archiver's head moved during this run and
  the citizen shape changed — expected, not a purity break (the purity
  test re-derives byte-identical output from the same head).
