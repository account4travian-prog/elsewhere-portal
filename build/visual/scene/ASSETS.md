# Scene scaffold — assets note

Scope: `build/visual/scene/` (VW scaffold). **No production assets are used
here.** All geometry is procedural placeholder built in `scene.mjs`; all
colours are palette constants sampled in `../LOOK-BIBLE-V0.md` §2. The asset
spine (Quaternius/KayKit/Kenney kits) lands in later waves and replaces the
placeholder blocks without touching the rig.

## Vendored library

| Item | Detail |
|---|---|
| Three.js | **r186** (`REVISION = '186'` in three.core.js), pinned, no CDN — the vendored Office build, exactly as LOOK-BIBLE-V0 §4 and visual-plan 01 §1.1 prescribe |
| Files | `vendor/three.module.js` (662,772 B, sha256 `9052042d…12ea`) + `vendor/three.core.js` (1,458,113 B, sha256 `9edde002…69e6`); three.module.js re-exports from `./three.core.js`, so both files are required |
| Copied from | `~/workspace/agent-office/handoff-no-deepseek/03-current-build/integrated/scene-web-serve/vendor/` (the Office scene's verified stock; the two copies there are byte-identical, same sha256) |
| Licence | **MIT**, Copyright 2010-2026 Three.js Authors. Full text: `vendor/LICENSE.three.md`. Each vendored file also carries the in-file `@license` SPDX MIT header |
| Inventory basis | resources/02-code-libraries.md: "Three.js — ADOPT — already owned", MIT per the library's own LICENSE; RESOURCE-INVENTORY.md animation/runtime rows |

## Vendored addons — figure loader path (M4.16, 2026-11-02)

Added so the scene can load the factory web profile's GLBs at all — see
`figure-loader.mjs`. Same intake discipline as the core above.

| Item | Detail |
|---|---|
| GLTFLoader + utils | `vendor/GLTFLoader.js` (117,556 B, sha256 `200cb562…b6b`) + `vendor/BufferGeometryUtils.js` (37,712 B, sha256 `9fb63427…179`) + `vendor/SkeletonUtils.js` (11,535 B, sha256 `b1632a70…86f`), flat in `vendor/` |
| Copied from | The same Office handoff vendor tree as the core (`~/workspace/agent-office/handoff-no-deepseek/03-current-build/integrated/scene-web-serve/vendor/`) — its GLTFLoader differs from the npm three@0.186.1 package's only in the two flattened `./` import paths (the Office scene's own vendoring convention); the utils are byte-identical to the package's, and the core files here are byte-identical to the package's build files, so the whole set is one consistent r186 (0.186.1) |
| MeshoptDecoder | `vendor/meshopt_decoder.module.js` (29,256 B, sha256 `d428e73a…f19`) — the three r186 addons build, the same decoder source the factory's `scripts/load_test_web.mjs` wires; byte-identical to the standalone meshoptimizer package's `meshopt_decoder.mjs` (meshoptimizer **1.1.1**) |
| Copied from | `~/workspace/agent-office/spike/agent-office/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js` |
| Licences | GLTFLoader + utils: **MIT**, Three.js Authors — covered by `vendor/LICENSE.three.md`. Decoder: **MIT**, Copyright 2016-2026 Arseny Kapoulkine (meshoptimizer) — full text vendored at `vendor/LICENSE.meshoptimizer.md`; the decoder file also carries its licence header in-file |
| Resolution | The addons import the bare specifier `three`; `scene.html` carries an importmap mapping it to `./vendor/three.module.js` (the same file `scene.mjs` imports directly, so there is one three instance) |

No other external asset, font, texture, or model is loaded by this scaffold.
The sky dome, blob-shadow falloff, and cloud puffs are generated in code
(CanvasTexture / ShaderMaterial) at runtime.
