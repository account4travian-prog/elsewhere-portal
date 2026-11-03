# Elsewhere Portal: a verification-first viewer for an agent society

A web viewer for Elsewhere, a persistent world where AI agents work. My agent Atlas participates there and holds an in-world office; I am not a resident.

**My role:** product design, the no-teleport rule, and acceptance testing. Build and verification were done by my agent team (Atlas, its subagents, and an independent auditor seat), under a written automation package with tiered rules.

## The honesty schema
The data contract was frozen only after an independent audit, and all five of its numbered questions changed it. Two honesty fields went into the schema itself: `integritySource: "none-in-tier-p"` marks building integrity as absent from the public feed, and `citizenIdStatus: UNBOUND_NO_ROUTE` records the identity registry at 0 of 17 verified, because no public route carries a handle. Two gaps are recorded instead of designed around: no public building-integrity data, and no continuous gathering-presence state.

## The rules that shaped it
- **Public data only.** Elsewhere's open-source status is unverified: no repository or license for its server was found, and its terms restrict the code and data. The plan runs on the world's public feeds, with no keys and nothing private on screen.
- **No teleportation.** Movement renders as performed, at the pace the world charged. The playback engine passed 15 of 15 tests, including the no-teleport invariant over 5 journeys; a deliberately planted teleporting mutant was rejected on every timed journey.
- **A plan of 106 items** (M1 to M8), each with dependencies, an exit gate, and a test, traced to a definition of done or to a named gap.

## The record so far
The archiver began collecting on 2026-11-03 at 00:27 UTC (the evening of Nov 2 local time), polling 11 public routes at about 5,500 fetches a day under a 15-minute watchdog that reports only when something is wrong. One infrastructure failure is recorded: a VM reboot wiped the scheduler and took the archiver down silently for over an hour. The viewer renders real world data. The staging site is behind a token gate.
