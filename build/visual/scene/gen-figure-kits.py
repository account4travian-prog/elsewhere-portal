#!/usr/bin/env python3
"""Generate figure-kits.json — the scene's citizen-kit manifest (M4.10).

Reads the factory kit records (build/visual/factory/kits/citizens/*.json)
for the citizens the CURRENT live bundle places, verifies every file the
manifest will name exists, and writes build/visual/scene/figure-kits.json
keyed by PORTAL-KEY. Re-run after a kit rebuild or a cast change; the
scene test (test/figure-kits.test.mjs) fails if the manifest and the
live bundle's placed set drift apart.

Paths in the manifest are relative to the scene directory.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.abspath(os.path.join(HERE, "..", ".."))
FACTORY = os.path.join(BUILD, "visual", "factory")

bundle = json.load(open(os.path.join(BUILD, "data", "feed", "world-data.json")))
placed = [c for c in bundle["citizens"] if c.get("placeCode")]

kits = {}
for c in sorted(placed, key=lambda c: c["citizenKey"]):
    key = c["citizenKey"]
    slug = key.split(":", 1)[1]
    kit_path = os.path.join(FACTORY, "kits", "citizens", f"{slug}.json")
    if not os.path.exists(kit_path):
        sys.exit(f"placed citizen {key} has no kit record at {kit_path}")
    kit = json.load(open(kit_path))
    assert kit["citizen_key"] == key, f"{slug}: kit record key mismatch"
    entry = {
        "citizenKey": key,
        "kit": slug,
        "identityColour": kit["identity_colour"],
        "lod0": f"../factory/outputs-web/{slug}--lod0.glb",
        "lod1": f"../factory/outputs-web/{slug}--lod1.glb",
        "standeeManifest": f"../factory/outputs-web/standees/{slug}.standee.json",
    }
    for rel in (entry["lod0"], entry["lod1"], entry["standeeManifest"]):
        p = os.path.normpath(os.path.join(HERE, rel))
        if not os.path.exists(p):
            sys.exit(f"{key}: manifest target missing: {rel}")
    kits[key] = entry

manifest = {
    "version": 1,
    "generatedBy": "build/visual/scene/gen-figure-kits.py (M4.10)",
    "bundleSeq": bundle["bundleSeq"],
    "note": ("Cast = the citizens the live bundle places at generation "
             "time. Kits are factory web-profile outputs (build tree); "
             "staging deployment copies figures under its own publish "
             "step. Citizens with no entry keep the capsule placeholder."),
    "kits": kits,
}
out = os.path.join(HERE, "figure-kits.json")
with open(out, "w") as f:
    json.dump(manifest, f, indent=2)
    f.write("\n")
print(f"wrote {out}: {len(kits)} kits, bundleSeq {bundle['bundleSeq']}")
