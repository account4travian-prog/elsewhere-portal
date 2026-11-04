# Chibi figure proportion gate

The scripted measurement half of the visual plan's figure work: a figure
is **measured, not eyeballed**. The first production figure — and every
figure after it — passes through this gate before it is decimated,
rendered, or scored.

Files:

- `chibi-params.json` — the proportion stations as data. Every number is
  copied from `../LOOK-BIBLE-V0.md` §5 (the section is named in each
  entry's `bible` field). It also holds the chibi procedure's factors,
  because the Bible names this file as their home. When the Bible
  freezes as v1.0 at G-J4, this file is re-checked against it.
- `measure-figure.mjs` — dependency-free Node tool. Loads a binary GLB,
  walks the node hierarchy composing world transforms, takes total
  height and head height from POSITION accessor min/max (guaranteed by
  the glTF spec — no vertex buffers are decoded), and prints a verdict
  per station.
- `test/measure-figure.test.mjs` — tests over synthetic GLBs built in
  code. Run: `node --test test/measure-figure.test.mjs`.

## Usage

```
node measure-figure.mjs <figure.glb> [--head-pattern <regex>] [--params <path>]
```

The head is the subtree of any node whose name matches the head pattern
(default `/head/i`: `Head`, `head`, `Bip01 Head`, `HeadTop_End`, …). If
**no** node matches, the tool fails loudly, printing the file's full
node list — it never guesses which node might be the head. Rename the
node or pass `--head-pattern` (e.g. `--head-pattern skull`).

Exit codes:

| Code | Meaning |
|---|---|
| 0 | Gate PASS — production and hard-defect stations in band |
| 1 | Gate FAIL — a gate-severity station is out of band |
| 2 | Measurement impossible — unreadable/corrupt/truncated file, no head node, no geometry |

The look-target station (0.38–0.42) prints PASS/FAIL but never decides
the exit code: the Bible scores a figure above target but inside
production as *look-dulling at most*, tuned at ladder rung 5.1 — a
scoring matter, not a defect. The finished-height station (1.8 units)
is reported measured-vs-target only, because the Bible states no
tolerance and this gate does not invent one.

## The intake loop (how this gate is used)

Per the visual plan's measure-first discipline:

1. **Measure** the incoming rig:
   `node measure-figure.mjs <figure.glb>`.
2. If the head share is outside the production band (40–43%), **tune** —
   adjust the procedure factors in `chibi-params.json` (head mesh scale,
   thigh/shin, arms, clavicles, hands) and re-apply the chibi procedure
   to the rig. Do not hand-nudge the mesh to a number nobody recorded,
   and do not edit the bands to fit the figure: the bands come from the
   Bible, the factors are what intake owns.
3. **Re-measure** the retuned rig. Intake is done when the gate exits 0
   with the look-target line PASS — or, if the figure sits at 42–43%,
   when the L2 scoring accepts the look-dulling note on the record.

## What this gate deliberately does NOT judge

One number — head share of height — plus a height readout. Everything
else in the look rubric is somebody else's instrument, and a green gate
says nothing about them:

- **Silhouette** — the 115% inflation treatment and the read of the
  outline at town distance are L2/judgement rows, not height arithmetic.
  (The factor is recorded in `chibi-params.json` as a reference station;
  this tool does not measure widths.)
- **Face** — features, expression, and the head's internal proportions
  are untouched by a height ratio. The one prose-only item, the neck
  pivot the head scales about, is listed under `unmeasurable` in the
  params for exactly that reason.
- **Palette** — colour conformance belongs to the sampled anchors in
  `../LOOK-BIBLE-V0.md` §2 and the extract-palette pipeline; this tool
  never opens a texture.
- **Rig quality, pose, motion, triangle/byte budgets** — the §4 rig
  card's budget rows (LOD0 ≤2,500 tris / ≤120 KB, walk speed, idle
  phase) are separate checks, not proportion stations.

A figure that passes here has earned exactly one claim: *its head is
the right share of its height, measured the same way every time.*

## Rendered-frame measure (M4.06 closure, 2026-11-03)

The gate above measures accessors. The M4.06 exit gate asks for the
same proportion **in a rendered frame**, and that is a separate
instrument: `render-measure.py` (Blender, Workbench) renders a factory
master in its **rest pose** at two orthographic cameras — the scene's
canonical view (elevation 35°, from the south) and a head-on
**plate** view (elevation 0) — in two passes each (whole figure; the
`head` mesh alone, the same node the gate counts).
`render-measure.mjs` counts alpha spans (rows over 0.5% coverage) and
writes `rendered-measure.json`; the renders live in `renders/`.

Results (2026-11-03):

| kit | plate heads-tall | plate head share | accessor share | canonical heads-tall |
| --- | --- | --- | --- | --- |
| atlas-meridian | **2.427** | 0.412 | 0.412 | 1.703 |
| orrin-lowmarsh | **2.370** | 0.422 | 0.426 | 1.648 |

Both plate counts sit inside the exit gate's 2–2.5 and the Bible's
derived 2.33–2.50. The canonical street view reads lower by
projection — the elevated camera foreshortens the body's vertical
while the near-spherical head keeps its silhouette — which is a
property of the view, not of the figure; it is recorded here rather
than tuned away. Two method notes earned on the way: the figure must
render with the armature at `pose_position = REST` (clearing actions
leaves the importer's pose in place — a ~5° head pitch inflated the
rendered head span by ~0.05 units before the fix), and the rendered
plate share for atlas-meridian lands **exactly** on the accessor
share (0.412), two instruments agreeing on one figure.
`test/rendered-measure.test.mjs` pins the record.
