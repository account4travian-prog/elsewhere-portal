# Masked-state drill — M4.17 (freeze conformance parity)

Filed: 2026-11-03T10:21:24.763Z · Verdict: **PASS**

The parity check is masked by construction: build/conformance
compares the two surfaces' presentation models by PORTAL-KEY and
field path — no rendered label is ever read. Latest filed run:
bundle head seq 488, worlddataHash d3d4d0db3a44ce7ee6d65ecc3ff78293422ebc4e775369f05165baac27f48134, ok=true, diffs=0 (build/conformance/conformance-report.json, ran 2026-11-03T10:19:07.239Z).
Positive controls (planted caption diff, planted position diff) are
asserted in build/conformance/test/conformance.test.mjs.
