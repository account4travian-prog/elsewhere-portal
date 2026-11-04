# Scene (3D surface) — STATUS

The 3D diorama surface: vendored Three.js r186, the Bible baseline
rig, factory citizen kits, and — since the 2026-11-03 scene-systems
lane (M4.16 → M4.26 → M4.17 → M4.20) — the chunked scene system,
LOD/standee representation system, actor budget, engine-driven demo
replay, the rendered-stream invariant harness, and Calmer. Lane
record: `plan-to-complete/lane-scene-systems.md`.

## Files

| File | What |
|---|---|
| `scene.mjs` / `scene.html` | The scene: chunk groups, kit attach, LOD rigs, roster rail, demo replay + Calmer controls, probe |
| `scene-system.mjs` | M4.16 decisions, pure: chunks, LOD bands, mid-route swap ban, actor budget (30 + rail) |
| `playback-driver.mjs` | Journeys → per-tick positions; every answer is engine `positionAt` verbatim |
| `figure-loader.mjs` | The one GLTF path (MeshoptDecoder wired) |
| `figure-kits.mjs` / `figure-kits.json` | M4.10 kit manifest + attach (LOD1 standing figure) |
| `stream-harness.mjs` | M4.26: sampled-stream no-teleport checks for both renderers + the stepped (Calmer) checker |
| `calmer.mjs` | M4.20: stepped poses = route vertices in order, caption per pose, monotone stepped position function |
| `run-drills.mjs` + `drills/` | Masked-state drill reports for M4.16 / M4.17 / M4.20 (all PASS, 2026-11-03) |
| `probe-check.mjs`, `RIG-AS-BUILT.md` | The Bible light-rig probe and its as-built record |

## Tests (per-file, Node v24)

scene-system 7 · calmer 6 · stream-harness 4 · perf 1 ·
figure-kits 4 · figure-loader 3 — **25/25**. Perf method and its
honest limit (CPU frame cost only, no GPU claim) are stated in
`test/perf.test.mjs`'s header: avg 0.60 ms/frame at the full
30-actor budget on the golden gathering fixture.

## Open seams

- Rendered-pixel confirmation of LOD swaps and the 3D demo replay
  rides the staging screenshot ladder (browser-side), as before.
- The held-figure seam (M3.04 stream holds) is unchanged: wired,
  waiting on a stream source.
- Freeze conformance for this surface lives in
  `build/conformance/` (M4.17): `{ok: true, diffs: []}` at bundle
  seq 488 on 2026-11-03.
