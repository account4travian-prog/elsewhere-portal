# Masked drill — the Ledger Press reads as a press (M4.14 exit gate)

**Subject:** Ember Ledger Press (District 1, Plot 31), GLB
`build/visual/factory/outputs-buildings/bld_ember_district_1_plot_31.glb`
(the CUSTOM printing press in its open east bay; press = 512 tris,
recipe cap 600, with the `press_platen` pivot sub-node).

**Method:** the GLB rendered in Blender (Cycles, the factory's check
lighting) from the east — the building's door/bay face — at the two
distances the scene actually uses: a town-altitude frame (30°
elevation, whole building + parcel in frame) and a follow frame
(18°, closer). Frames: `press_town_altitude.png`,
`press_follow_east.png` (this folder; renderer `render_glb.py`).
The read criteria are the recipe's own (visual-plan/02 §5.1 B8):
"tall screw + horizontal platen is the read" — plus the lever and
the paper bed. The sign and label are masked out of the judgement:
the machine itself must carry the read.

## Round 1 — FAIL (2026-11-03, first build)

Press at the bay's centre (x=1.7), sign board centred on the face.
In the town-altitude frame the board hung in the middle of the bay
and the press sat deep in the bay's shadow behind it: a faint ringed
column in the gable gloom, no platen, no lever. A masked viewer
could not have named the machine. **Fail.**

## Fix (same day)

- The press moved forward to x=2.1 and scaled 1.15× — its front now
  stands near the bay's face line, out of the deepest shadow
  (`station_press` moved to match).
- The sign BOARD hangs toward the south end of the east face
  (`along=-1.35`). The exported `anchor_sign` node did not move —
  it stays at the spec position (face centre, 2.6 up); only the
  decorative board hangs off-centre, and the kit card records it.

## Round 2 — PASS (2026-11-03, rebuilt GLB)

- **Follow frame:** the ribbed screw column (three thread rings)
  stands over the horizontal platen plate; the lever angles off the
  frame with its knob; the paper sheet lies on the bed. The
  screw-over-platen silhouette is unambiguous.
- **Town-altitude frame:** the bay's centre is open — screw visible
  in the gable light, platen + white paper at the centre, lever knob
  at the right post, newspaper stand at the door. The machine reads
  as a press in its bay.

**Verdict: PASS** on the recipe's own criteria, both frames. A human
masked drill (an unbriefed viewer naming the machine from the town
frame alone) remains available at G-J1; this report is the
mechanical + author's-eye half the lane can file tonight.
