#!/usr/bin/env python3
"""Size gate for sheet files (standee sprites) — Portal M4.09 / Design A6.

validate_glb.py gates GLBs; a standee is a WebP sprite, not a GLB, so the
same budget needs a byte gate for plain files. This is that gate, with the
same semantics and the same budget source (../web-profile.json):

  validate_sheet.py --profile lod2 --gate <file.webp> [...]
    -> one JSON object per file; exit 1 if any file is over budget and
       --gate was given; exit 2 for an unknown profile, a profile with no
       byte budget, or a profile that also carries a triangle budget
       (a sheet has no triangles — gating one against a figure profile is
       a category error and must be loud, not silent).

Without --gate it reports only (never fails the build), like
validate_glb.py's report mode.
"""
import json, os, sys

def main(argv):
    profile_name, gate = None, False
    files = []
    i = 0
    while i < len(argv):
        if argv[i] == "--profile":
            profile_name = argv[i + 1]; i += 2
        elif argv[i] == "--gate":
            gate = True; i += 1
        else:
            files.append(argv[i]); i += 1
    if profile_name is None:
        print("usage: validate_sheet.py --profile <name> [--gate] <file> [...]",
              file=sys.stderr)
        return 2
    here = os.path.dirname(os.path.abspath(__file__))
    prof_path = os.path.join(here, "..", "web-profile.json")
    profiles = json.load(open(prof_path))["profiles"]
    if profile_name not in profiles:
        print(f"size gate: unknown profile {profile_name!r} "
              f"(known: {', '.join(sorted(profiles))})", file=sys.stderr)
        return 2
    prof = profiles[profile_name]
    if prof.get("maxTriangles") is not None:
        print(f"size gate: profile {profile_name!r} carries a triangle "
              f"budget; sheets have no triangles — refusing to gate",
              file=sys.stderr)
        return 2
    if prof.get("maxBytes") is None:
        print(f"size gate: profile {profile_name!r} carries no byte budget "
              f"and cannot gate", file=sys.stderr)
        return 2
    failed = False
    for p in files:
        size = os.path.getsize(p)
        over = []
        if size > prof["maxBytes"]:
            over.append(f"bytes {size} > {prof['maxBytes']}")
        r = {"file": os.path.basename(p), "bytes": size,
             "profile": profile_name, "within_budget": not over}
        if over:
            r["over_budget"] = over
            failed = True
        print(json.dumps(r))
        if over:
            print(f"SIZE GATE {'FAIL' if gate else 'over'}: "
                  f"{r['file']} over {profile_name} budget: "
                  + "; ".join(over), file=sys.stderr)
    if gate and failed:
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
