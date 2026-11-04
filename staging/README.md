# Elsewhere Portal — Staging (M4.02, local half)

The delivery spine for the Portal staging environment (SE-5.1 / SE-5.2 /
SE-5.4, decision D7): one thin Cloudflare Worker + one R2 bucket,
content-addressed publishing, rollback by repointing one manifest.

**State: the local half is BUILT AND DRY-RUN PROVEN (2026-11-02). Nothing
has been deployed and no account has been touched.** The first write to
Atlas's own Cloudflare account (creating the Worker + R2 bucket and
enabling the `workers.dev` route) is the milestone's one the project owner-gated
step: under D7's adopted form it goes to the project owner as a notification with a
veto, not a request. Everything below runs without it.

## Shape

```
build/ (app, scene, shared, fixtures, data/feed)
        │  publish.mjs — bundle-check gate, then content addressing
        ▼
bucket:  objects/<sha256>            immutable, written once
         publishes/<publishId>.json  every publish, archived
         publish-manifest.json       THE pointer — written LAST
        │  Worker handler (identical code locally and on Cloudflare)
        ▼
GET /<pathToken>/…                   link-only: no token, no site
```

- **Worker** (`worker/worker.mjs`) — the SE-5.4 thin Worker. Pure
  handler core `createHandler({ store, config })` over any store with
  `async get(key)`; the default export adapts the R2 binding
  (`env.BUCKET`) and the `PORTAL_PATH_TOKEN` secret. It holds no
  Elsewhere key and no per-visitor state (SE-6.3).
- **Link-only posture (D3/D7)** — every route lives under an
  unguessable path-token segment. Wrong token, missing token, `/`, and
  unknown paths are all the same 404; there is no listing and hashed
  objects are never URL-addressed. A missing/short token makes handler
  construction throw — misconfiguration can never degrade to open
  access. The real token is generated at deploy time and lives only in
  the Worker secret and the (uncommitted) staging URL: the URL is the
  credential.
- **Honesty surface (SE-5.4)** — every response carries
  `X-Robots-Tag: noindex, nofollow` and `X-Content-Type-Options:
  nosniff`; every served response stamps `X-Portal-Worlddata-Hash`,
  `X-Portal-Newest-Fetch`, `X-Portal-Bundle-Seq`, `X-Portal-Publish-Id`
  so any client can verify freshness without trusting the page. HTML
  carries SE-6.5's self-only CSP with `frame-ancestors 'none'`.
  Non-GET/HEAD ⇒ **405** with `Allow: GET, HEAD`.
- **Cache rules** — feed documents (`data/feed/*`): `Cache-Control:
  no-cache` + strong ETag (the bundle's SHA-256). A client must
  revalidate; a 304 is issued only against the exact current bytes, so
  a stale bundle is never served as fresh. Static files: `public,
  max-age=300` + ETag. (SE-5.2's `immutable` hashed-asset rule is
  satisfied by construction — objects are content-addressed and only
  ever reached through the pointer.)
- **Publisher** (`publish.mjs`) — snapshot allowlist mirrors `build/`'s
  relative layout (`app/`, `fixtures/`, `shared/`, `data/feed/`,
  `visual/scene/` incl. `vendor/`), so the app and scene run unchanged.
  Never published: tests, shots, docs, and `facts-state.json` (the
  archiver's private cursor). The feed must pass
  `build/data/bundle-check.mjs` before a single byte is written — a
  failing feed publishes nothing. Each publish archives its manifest
  under `publishes/`, records `publish-plan.json`, and writes the live
  pointer **last** (temp + rename). **Rollback** = verify every named
  object exists, then copy one archived manifest over the pointer;
  the handler reads the pointer per request, so it takes effect with
  no restart and no redeploy.
- **Local surface** — `worker/store-fs.mjs` (filesystem store with R2
  semantics) + `worker/serve-local.mjs` (node HTTP wrapper) run the
  identical handler against the local bucket directory
  (`.local-bucket/`, 2.4 MB at the dry run).

## Local usage

```bash
node staging/publish.mjs [--build <dir>] [--bucket <dir>] [--note <text>]
node staging/publish.mjs --list
node staging/publish.mjs --rollback <publishId>
node staging/publish.mjs --emit-wrangler-script <file> [--r2-bucket <name>]
PORTAL_PATH_TOKEN=<any-16+-chars> node staging/worker/serve-local.mjs [--port 8917]
node --test staging/test/handler.test.mjs       # 9 tests
node --test staging/test/publish.test.mjs       # 9 tests
node --test staging/test/staging-cycle.test.mjs # 7 tests (auto-republish)
node staging/staging-cycle.mjs                  # one auto-republish step
```

## Dry-run evidence (2026-11-02, this machine)

Published the live build (bundleSeq 53) to `.local-bucket/` and served
it through the real handler on `127.0.0.1:8917` with a generated token:

- `GET /<token>/` → 200 (app index); `/<token>/visual/scene/scene.html`
  → 200; `episodes.json` and `journeys.json` → 200.
- `GET /<token>/data/feed/world-data.json` → 200; served bytes' SHA-256
  `c0b6787d…a64cd` equals, character for character, the live feed's
  hash at publish time, the publish manifest's `worlddataHash`, the
  response ETag, and the `X-Portal-Worlddata-Hash` stamp.
  `Cache-Control: no-cache`; `X-Portal-Bundle-Seq: 53`;
  `X-Portal-Newest-Fetch` matching the feed manifest.
- All 17 published files: served bytes hash-equal to their publish
  manifest entries (17/17 OK).
- Wrong token → 404; no token → 404; `POST` to the bundle → **405**.
- **Rollback rehearsed over HTTP:** published variant B (one comment
  appended to `app.js`; served bytes `e46126ae…`), then
  `--rollback pub-53-20261103T013142` — the next fetch served the
  original bytes (`0b8920b2…`) with no server restart. The bucket's
  resting pointer was then advanced to a fresh publish of the live
  build (seq 54, `pub-54-20261103T013204`).
- Tests: handler 6/6, publisher 5/5 (incl. the bundle-check gate —
  a failing feed publishes nothing — rollback as one pointer write,
  and rollback refusing a manifest whose named object is missing),
  run per file with `node --test`. 11/11 total.

## Deploy day — the the project owner-gated step

**Account state, verified by the deploy arm on 2026-11-02 —
deployment was PAUSED on an open question for the project owner; the project owner has
now ruled.** The deploy token at `~/.config/cf-api-token`
authenticates, but to the **owner's** Cloudflare account.
The account this design originally targeted — Atlas's own, under
<agent-account-email> (see `config.example.json`) — is **not
reachable with that token**. the project owner ruled on **2026-11-02 20:16
CST**: **staging deploys on the owner's account instead.**
That ruling amends the D7/D3 account record for staging only (see
`DECISIONS.md`); the agent's own account remains Atlas's separate
infrastructure account but is not the staging target. The checklist
below therefore runs against the owner's account
(`<CLOUDFLARE_ACCOUNT_ID>`), creating only the
`elsewhere-portal-staging` Worker, its secret, and the
`elsewhere-portal-staging` bucket.

**Deploy attempt 2026-11-02 (after the ruling) — stopped at
checklist step 3, credential scope.** Checklist step 1 completed
(`worker/wrangler.toml` filled for the ruled account) and the path
token was generated, but `wrangler r2 bucket create
elsewhere-portal-staging` failed: Cloudflare API **authentication
error code 10000** on `/accounts/<account-id>…/r2/buckets`. Read-only
diagnosis: the token itself verifies **valid and active**, yet even
`wrangler r2 bucket list` fails with the same code — **the deploy
token carries no R2 permissions on this account** (it was scoped
for Workers deploys, the agent-channel precedent). Nothing was
created on the account; the generated path token was never set as
a secret and was discarded. Unblocking is a the project owner dashboard
action: add R2 edit permission (Account → Workers R2 Storage →
Edit) to the existing token, or provision R2/the bucket in the
dashboard — a token cannot widen its own scope, so the deploy does
not improvise around this. The checklist resumes at step 3 once
the token can write R2.

## Deploy-day checklist

*Reconstructed 2026-11-02 from `config.example.json`, `worker/wrangler.toml.example`, `publish.mjs`, `worker/worker.mjs`, and the staging tests, after the original write of this file was truncated and this section lost.*

Precondition: the account question above is ruled on, and the
staging notification-with-veto has gone to the project owner under D7 with no
veto returned.

1. **Prepare the deploy config.** Copy
   `worker/wrangler.toml.example` to `worker/wrangler.toml`
   (uncommitted) and fill its blanks for the account the project owner's ruling
   names: Worker `elsewhere-portal-staging`, R2 bucket
   `elsewhere-portal-staging` (binding `BUCKET`), `workers_dev =
   true`. No custom domain and no DNS change (D3/D7).
2. **Generate the path token and set it as the Worker secret.** 32+
   random hex chars (`openssl rand -hex 24`); `wrangler secret put
   PORTAL_PATH_TOKEN`. The token is never written to this repo — the
   staging URL is the credential (D3). A missing or short token makes
   handler construction throw, so a misconfigured deploy fails
   closed, never open.
3. **Create the R2 bucket and the Worker** on that account (the
   milestone's first write to it) and enable the `workers.dev`
   route, making the site addressable as
   `https://elsewhere-portal-staging.<subdomain>.workers.dev/<pathToken>/`.
4. **Publish the current build locally.** `node staging/publish.mjs
   --note <text>` — the feed must pass
   `build/data/bundle-check.mjs` before a single byte is written; a
   failing feed publishes nothing. Files land as immutable
   `objects/<sha256>`, the manifest is archived under `publishes/`
   and copied to `publish-plan.json`, and the live pointer
   `publish-manifest.json` is written **last** (temp + rename).
5. **Render and run the R2 upload script.** `node
   staging/publish.mjs --emit-wrangler-script <file> --r2-bucket
   elsewhere-portal-staging`, then run the script: it uploads every
   object the publish manifest names (not just objects new to the
   local bucket), each `put` with `--remote` — without it wrangler
   writes to local state and the real bucket stays empty — objects
   first and the pointer last, so R2 never serves a half-published
   site and a first publish against an empty bucket is complete.
6. **Deploy the Worker** (`wrangler deploy`) with the `BUCKET`
   binding and the secret from step 2.
7. **Verify the token gate at the live URL.** The token root serves
   the app (200); a wrong token, a missing token, `/`, and an
   unknown path are all the same 404; a non-GET/HEAD request returns
   405 with `Allow: GET, HEAD`; responses carry `X-Robots-Tag:
   noindex, nofollow` and `X-Content-Type-Options: nosniff`.
8. **Verify freshness four ways.** Fetch
   `/<pathToken>/data/feed/world-data.json` and check the served
   bytes' SHA-256 matches, character for character: (a) the live
   feed's bytes at publish time, (b) the publish manifest's
   `worlddataHash`, (c) the response ETag, and (d) the
   `X-Portal-Worlddata-Hash` header stamp — with `Cache-Control:
   no-cache` on the feed document and the `X-Portal-Bundle-Seq`,
   `X-Portal-Newest-Fetch`, and `X-Portal-Publish-Id` stamps
   agreeing with the manifest. (The dry run passed this check
   locally; deploy day repeats it against R2.)
9. **Rehearse rollback, then report.** Repoint
   `publish-manifest.json` to an archived manifest — one pointer
   write; `publish.mjs --rollback` verifies every object it names
   still exists first — and confirm the next fetch serves the
   earlier publish's bytes with no redeploy; then roll forward to
   the resting publish. Report to the project owner: the staging link, the
   four-way hash result, and the rollback result. Any later rollback
   is the same single repoint — the handler reads the pointer per
   request, so it takes effect with no restart.
## Republish cadence — CLOSED (the project owner, 2026-11-02 22:08 CST)

The one item the deploy-day checklist left open — *fix a periodic
republish cadence (frequency and owner), or leave publishes manual
and recorded* — is decided and built. **the project owner's ruling:
"Republish staging automatically as new bundles land"**
(`DECISIONS.md`). Manual publishing is superseded for the live feed;
`publish.mjs` remains the mechanism and the rollback path.

- **Owner:** the archiver supervisor. Its hook cycle runs
  `staging-cycle.mjs` after the journeys step (i.e. after the bundle
  step and after the episodes/facts/journeys steps that refresh the
  feed files the bundle cites), so staging tracks the same
  publications the local feed gets.
- **Trigger + throttle:** republish when the feed bundle hash
  (`worlddataHash`) differs from the last staging publish AND at
  least 60 s have passed since it — in practice staging lands within
  a cycle or two of the local feed. Skipped cycles (unchanged /
  throttled / paused) write nothing anywhere.
- **Delta-only:** objects are content-addressed and immutable;
  `.staging-publish-state.json` records every object sha already in
  the R2 bucket, and only genuinely new objects + the manifest
  pointer (last, as always) are uploaded — steady state observed at
  3–5 PUTs per republish. Missing or stale state falls back to one
  full publish and rebuilds itself. Every put carries `--remote`;
  `publish.mjs`'s bundle-check refusal still gates every republish.
- **Isolation:** a staging failure is logged (step log +
  `publish-log.jsonl`, with the error text) and the data cycle
  continues — the archiver is the M1 record; staging is a viewer of
  it. `DEVELOPMENT-PAUSED` skips the staging step silently (the
  archiver itself stays exempt, by the project owner's design).
- **Log:** `publish-log.jsonl` in this directory, append-only, one
  line per republish (publish id, bundle seq, objects
  uploaded/skipped) and one per failure.

Live evidence and the current resting publish: `STAGING-LIVE.md`,
"Automatic republish" section.