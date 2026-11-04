# Tester log — X1 keyboard-only & X4 touch-only at 390 px (M6.15)

Filed 2026-11-03 (M6 final lane). Method, stated plainly: these runs
were executed headlessly — every job driven through the app's pure
models and its shipped wiring (the builders' actual buttons, the one
[data-follow] handler, the keyboard handler, the 480 px stylesheet
block), with the machine-checked half in `accessibility.test.mjs`
and `follow-machine.test.mjs`. No physical keyboard, phone, or
browser was available to this lane; the live staging click scripts
remain VER's rotation work, and this log does not claim them.

## Core jobs (UX §1 / §3.1) — keyboard-only run

| # | Job | Keyboard route | Result |
|---|---|---|---|
| 1 | Follow the mayor | Tab to the portrait strip → Enter on the mayor's face (1 activation); or the welcome card's [Follow the Mayor] (1) | PASS — strip faces are native buttons carrying data-follow; budget ≤2 met with 1 |
| 2 | Watch a named awake citizen | `C` jumps to Citizens → Tab to the row's **Watch** → Enter (follow engages) | PASS — roster rows carry data-follow Watch buttons |
| 3 | Watch a citizen via their building | Tab to Buildings directory → Enter on the occupant's name (a follow button in the row) | PASS — directory occupants are follow buttons |
| 4 | Watch a ticker item's subject | Tab to the item's [Take me there] → Enter (lands following) | PASS — landing resolves from structured fields only |
| 5 | Stop following / return | `F` stops (return chip appears, worded from the table); `F` again — or Tab to the chip — re-engages in 1 | PASS — machine exit()/engage(); chip text pinned by the state tour |
| 6 | Move between citizens | `[` / `]` cycle the placed citizens (Previous/Next citizen buttons are the same actions) | PASS — cycleFollowKey unit-pinned, wrapping both ways |
| 7 | Read how Portal knows a claim | Tab to any [Record] → Enter → the inspector panel | PASS — Record buttons on cards, ticker items, movement lines |
| 8 | Read the scene without the canvas | Tab into "The scene in words" list; the aria-live region announces each bundle's summary | PASS — list ≡ scene proven on the sampled bundle |
| 9 | Change a display toggle | Tab to the Display panel → native `<select>` → arrows/Enter | PASS — selects are native, labelled |
| 10 | Dismiss / re-open the welcome card | Esc dismisses (lands on the diorama); About → [New here?] re-opens | PASS — Esc order: overlay → card → stop-following, as UX §8 orders it |

Focus: `:focus-visible` carries a 3 px outline everywhere; no
outline is removed anywhere in styles.css (census-pinned). No
clickable divs exist in the page shell; every control the builders
emit is a native `<button type="button">`.

## Core jobs — touch-only at 390 px

The 480 px block (which 390 px falls inside) is census-pinned in
the suite: single column, `#stage` at width 100%, the portrait
strip scrolls horizontally with names visible, and every button
and select is ≥ 44 px tall inside the block. Jobs 1–10 above are
the same taps as their mouse forms — every target is a native
button or select; no job depends on hover (no hover-only
information exists in the builders: every chip carries its word,
every action is a labelled button). Canvas taps (figure/building
picking) have full list equivalents — roster, directory, strip —
so no job is canvas-only.

## Known limits of this log

- Tap-target height is proven from the stylesheet, not from a
  rendered device screenshot; the M4.22 screenshot regression on
  staging is the surface that can prove it on pixels.
- Tab ORDER follows DOM order (stage panel, then the side column);
  it is visible order on desktop and document order on mobile.
