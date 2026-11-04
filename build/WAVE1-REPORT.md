# Engineering Wave 1 — Report (Atlas-verified 2026-11-01)

Thin end-to-end slice: live Tier P snapshots -> portal.world-data/v1 -> tick playback -> viewer page.

## Verified by Atlas's own re-runs (not arm self-reports)
- Data: `node --test` 13/13 pass; bundle seq 1 worlddataHash 99cd8cda... == sha256sum of feed/world-data.json; archive holds 6 real snapshots (2026-11-02T02:07Z, all HTTP 200) + fetch log.
- Engine: 15/15 pass incl. Plan B §7.3 no-teleport invariant over 5 journeys AND the teleporting-mutant positive control (mutant rejected on every timed journey).
- App: 18/18 logic tests pass; page rendered via CDP screenshot (app/shots/wave1-initial.png, read by Atlas): LIVE badge + "half a minute ahead" caption, real ticker (Atlas's College lecture, mayor's meeting, ruin excavations), stage with labelled buildings, 1 evidenced citizen on stage (Rocky Headlong at the Plaza).
- End-to-end: app loads the REAL bundle as primary; demo journey runs through the real engine (Library Annex -> Plaza -> College, continuous, settles on College).

## Real-data findings (follow-ups, not blockers)
- Tier P gives display names, not true handles; no per-plot data; civic-works integrity is null in the public payloads (no band-colouring of works until a source exists).
- Real place codes: LIBRARY_ANNEX, MARKET_HALL, PUBLIC_WORKSHOP (pin exact codes in wave 2; app currently resolves code-then-label).
- Engine catchUp on very short journeys: app consumes speed/replay safely; reconcile replay-flag semantics with Plan B §3 in wave 2.
- Screenshot shows wave-1 visual limits honestly: buildings are labelled boxes, some label overlap/clipping at stage edges (Town Hall, Public Workshop), citizens are dots+chips. Art is P3, as planned.

## Not yet done (by design / next waves)
- Archiver is one-pass + --watch; cron wiring + 48h gap-free A0 acceptance still ahead. No Cloudflare deployment yet (local server only). No Three.js scene yet (canvas stage). Talk system is P4.
