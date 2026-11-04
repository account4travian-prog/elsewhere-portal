# Design tokens — the one home (M4.21, Design G1 / G2)

`tokens.json` in this folder is the design system's single token source.
`tokens.css` is **generated from it** by `tokens-build.mjs` — never edit
`tokens.css` by hand. Per Visual Plan REC-1, this source is the one
shipped source of colour: the Look Bible's palette is targets and
measurement only (never imported by a renderer), and the scene's
`palette.js` and Blender's `assets/palette.json` are generated
serialisations of these tokens when those consumers land.

Every token carries a provenance. Colour tokens for the world come from
the sampled palette anchors (`build/visual/palette-anchors.json`);
**sampled values govern, plan constants never do** (AUTO-L04, ledgered).
Where a shipped surface and the plan disagree, the token carries both
values and names the disagreement — nothing here silently resolves a
conflict. The disagreements list is at the end of this file.

## Which surface consumes which group

| Token group | 2D app (`build/app/`) | 3D scene (`build/visual/scene/`) | Staging / published bundle |
|---|---|---|---|
| `color.anchor` | Stage world colours (via tokens.css vars) — sky pending D-T01 harmonisation; grass settled 2026-11-03 (D-T02 resolved, `#CDEAC0`) | **Primary palette**: ground, roofs, interiors, figures — consumed as a generated `palette.js` serialisation | Carried with the bundle; the honesty surfaces never restyle anchors |
| `color.family` | State chips, caption accents, follow bar — always paired with the family's icon + caption word | Family head icons and place sign colours when kit surfaces land | Same as app |
| `color.identity` | Roster dots, talk speaker names, follow targets | Citizen tint/identity channel (never state) | Same as app |
| `color.state` | Top-bar badge (LIVE / STALE / REPLAY / LOADING), recording note, sample banner, conflict section | Not consumed — the 3D stage carries no badge chrome | The staging page must use this family verbatim; a staging surface that restyles honesty states fails the M2.14-class review |
| `color.surface` | All chrome: panels, ink, buttons, topbar | Not consumed | Same as app |
| `font` | Everything textual; floors are hard (body ≥16px desktop / ≥15px mobile) | Signage/plaque text uses `font.family.display` when text lands in-scene | Same as app |
| `space` | Panels, cards, chips, layout gaps | Only `space.outline.2d` (the 2D register; 3D has no outlines by ruling) | Same as app |
| `motion` | Playback-driven UI (pre-action icon floor binds every speed) | Walk/drift/sway rates, interior cutaway timing | Same as app |
| `presence` | Roster/caption treatments (hatch chip, silhouette, dim) | Figure treatments (hatch shell, silhouette, asleep dim) | Same as app |
| `rig` | Not consumed | **The scene's light/camera contract** — consumed as data by scene.mjs (today mirrored in its RIG literal; the mirror is RIG-AS-BUILT-checked) | Not consumed |
| `wording` | Not consumed | Camera chip and reset-control labels (M4.18) — consumed through the generated scene palette serialisation | Carried with the scene bundle |

Rule of thumb: **world colours come from `color.anchor`, interface
colours from `color.surface`/`color.state`, meaning colours from
`color.family`/`color.identity`** — and meaning is never carried by
colour alone (UX §4.1; every family/state token pairs with an icon, a
word, or a treatment in the consuming surface).

## Change discipline

- **Anchors change only via the palette pipeline.** A `color.anchor`
  value may change only when `build/visual/extract-palette.mjs` re-runs
  against the approved samples and `palette-anchors.json` changes; the
  token then follows the anchor file in the same change. Hand-editing
  an anchor value in tokens.json is never allowed — the test suite
  compares every anchor token against the anchor file and fails on any
  drift.
- **Ruled amendments ride the same pipeline.** A Owner ruling may
  supersede a sampled anchor (the Bible's delta path,
  `visual-plan/03-refinement.md` §1.5 — his eye outranks the sampled
  hexes). The amendment is recorded in `extract-palette.mjs`
  (`RULED_AMENDMENTS`, with the ruling cited) and the extractor re-runs:
  `palette-anchors.json` keeps the sampled hex as `sampledHex`
  evidence and carries the amended governing hex plus the ruling; the
  token follows in the same change with the ruling in its provenance
  (the test suite checks the citation verbatim). First use:
  `grass_sunlit`, 2026-11-03 (D-T02 settled to `#CDEAC0`).
- **A token change is an AUTO-L decision, ledgered.** Any other change
  to tokens.json (a family pin, a state colour, a type/spacing/motion
  value) is appended to `~/workspace/elsewhere-portal/AUTO-DECISIONS.md`
  with its reason, in the same change that edits the token. Under the
  Automation Package this is AUTO tier for values already evidenced by
  a shipped surface or an anchor; pinning a previously unpinned family
  colour is a new design value — it goes through the look-gate path
  (G-J1/G-J4 auto-proceed forms) rather than a silent edit.
- **Regenerate, never hand-sync.** After any tokens.json edit:
  `node tokens-build.mjs`, and commit tokens.json + tokens.css
  together. The test asserts byte-identical regeneration.
- **Disagreements are resolved by ruling, not by edit.** A token with a
  `values` map stays dual-valued until a ruling (AUTO-L entry, or
  the project owner at a look gate where the package says so) picks the governing
  value; the ruling is cited in the token's provenance when the map
  collapses.

## Known disagreements

Standing rule behind several of these: every one of the 26 sampled
anchors diverges from its plan constant (ΔE00 from 2.09 to 40.43), and
AUTO-L04 already resolved that class in favour of the samples — so
anchor-vs-plan divergence is recorded as provenance, not listed per
token below. What follows are the disagreements that remain *live*
between surfaces.

- **D-T01 — Sky: app vs anchor.** The app's `--sky` is `#A8D4F0`,
  following the superseded plan constant `#A8D4EC`; the sampled
  `sky_upper` anchor is `#EBE6E2` (ΔE00 18.13). The token
  (`color.surface.sky`) carries both; tokens.css emits the app value
  because it describes the shipped 2D surface. Related but *not* the
  same issue: the scene's sky-dome top stop is `#A8D4EC` by rig-card
  design (`rig.skyDomeStops`) — an implementation stop whose rendered
  result is scored against the anchor (REC-2).
- **D-T02 — Grass: app vs anchor vs scene. RESOLVED 2026-11-03** by
  the project owner's ruling (DECISIONS.md 2026-11-03, approving
  `plan-to-complete/lane-look-touchup-scope.md` §T1a): one grass green
  everywhere, **`#CDEAC0`** — the app 2D stage's existing value,
  adopted as the governing `grass_sunlit` anchor through the palette
  pipeline (ruled amendment in `extract-palette.mjs`; sampled
  `#E5CE9D`, which read as sand, kept as `sampledHex` evidence in
  `palette-anchors.json`; the plan constant's secondary `#CDEBB4`
  superseded with it). Token `color.surface.grass` collapsed from its
  three-value map to the single value, with the ruling cited in its
  provenance; the scene reads the same green via `PAL.grass`. The
  entry stays here as the resolution record.
- **D-T03 — Fonts planned vs shipped.** X7 wants Fredoka (display) +
  Nunito (body) **self-hosted woff2 with OFL licence files kept**; the
  app ships a system stack with no webfont downloads (Wave 1,
  styles.css header) and lists Nunito before Fredoka, so the wordmark
  renders in the body stack. `font.family.display` records the planned
  stack; `font.family.body` records the as-built stack.
- **D-T04 — LIVE borrows grass.** The shipped LIVE badge background
  `#CDEAC0` is exactly the app's grass value — the badge family has no
  green of its own, so the grass green is also LIVE's green. (Since
  D-T02's resolution on 2026-11-03 that green is the settled single
  grass value, so the coupling now points at a settled colour.) UX
  §6.1 pins badge *wordings* only; no plan colour exists to conflict
  with, so this is recorded as an as-built coupling, not a plan breach.
- **D-T05 — Identity palette lives in code.** The 8 identity colours
  are a hard-coded array in `build/app/logic.mjs` (`PALETTE`), outside
  this token source. The G2 gate greps for hard-coded *family* colours;
  identity colours are a different system (who, never state) and are
  recorded here as built (`color.identity.*`) so the sweep is honest.
  Migration path: `citizenColor()` reads the palette from tokens.json
  in a later app pass; until then, changing a colour means editing
  both places, and this file is where the change is ledgered.
- **D-T06 — Overview frustum: rig card vs scaffold.** The rig card
  says overview frustum height 34 units; the scene scaffold ships 68
  (RIG-AS-BUILT deviation 1: 34 presumes layout v3 scale and would crop
  the current layout). Token `rig.camera.overviewFrustumHeight`
  carries both values; the card value governs again when the town
  layout reaches v3 scale.
- **D-T07 — Held has no colour.** The held state (place-conflict HOLD,
  M3.04) has no colour of its own in the plan or any shipped surface:
  it renders through the conflict amber in the inspector and the
  follow bar's sky family. `color.state.held` records the gap rather
  than inventing a value; giving held a colour is a design decision
  for the G1 artefact pass, not a token edit.

## What this artefact is not

The rest of the M4.21 item — label language, icon language, caption
templates, the Follow wording table, the coverage matrix, the prop
register — lives in the G1 design artefact and the app copy it governs;
this folder is the **tokens slice** of that item: the values, their
provenance, and the rules for changing them.
