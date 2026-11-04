#!/usr/bin/env python3
"""Validate a factory GLB by parsing its JSON chunk (no external deps).
Usage: validate_glb.py <file.glb> [...]  -> prints one JSON object per file."""
import json, struct, sys, os

REQUIRED_BONES = ["hips", "spine", "chest", "head",
                  "arm.L", "forearm.L", "hand.L", "arm.R", "forearm.R", "hand.R",
                  "leg.L", "shin.L", "leg.R", "shin.R"]
REQUIRED_CLIPS = ["idle", "sit", "type", "stand", "walk", "knock", "wait", "gather"]

def validate(path):
    data = open(path, "rb").read()
    assert data[:4] == b"glTF", "bad magic"
    version, total = struct.unpack_from("<II", data, 4)
    jlen, jtype = struct.unpack_from("<II", data, 12)
    assert jtype == 0x4E4F534A, "first chunk not JSON"
    g = json.loads(data[20:20 + jlen])
    meshes = g.get("meshes", [])
    tris = 0
    for m in meshes:
        for prim in m.get("primitives", []):
            idx = prim.get("indices")
            if idx is not None:
                tris += g["accessors"][idx]["count"] // 3
            else:
                tris += g["accessors"][prim["attributes"]["POSITION"]]["count"] // 3
    bones, props = [], []
    for skin in g.get("skins", []):
        for j in skin.get("joints", []):
            bones.append(g["nodes"][j].get("name", "?"))
    for n in g.get("nodes", []):
        if n.get("name", "").startswith("prop."):
            props.append(n["name"])
    anims = [a.get("name", "?") for a in g.get("animations", [])]
    channels = {a["name"]: len(a.get("channels", [])) for a in g.get("animations", [])}
    extras = {}
    for n in g.get("nodes", []):
        if n.get("extras"):
            extras = n["extras"]
    return {
        "file": os.path.basename(path), "bytes": len(data), "gltf_version": version,
        "meshes": len(meshes), "triangles": tris, "nodes": len(g.get("nodes", [])),
        "bones": len(bones), "bone_names": sorted(bones),
        "missing_bones": [b for b in REQUIRED_BONES if b not in bones],
        "extra_bones_ok": all(b in REQUIRED_BONES or b.startswith("extra.") for b in bones),
        "animations": len(anims), "clip_names": anims,
        "missing_clips": [c for c in REQUIRED_CLIPS if c not in anims],
        "channels_per_clip": channels, "props": sorted(props),
        "armature_extras": extras,
        "images": len(g.get("images", [])), "materials": len(g.get("materials", [])),
        "skins": len(g.get("skins", [])),
    }

if __name__ == "__main__":
    argv = sys.argv[1:]
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
    if profile_name is None and not gate:
        for p in files:
            print(json.dumps(validate(p), indent=1))
    else:
        # --- Portal extension (M4.05 / SE-4.2): the size gate. -------------
        # Budgets live in ../web-profile.json (plan section 5.2). Without
        # --gate this stays a report; with --gate an over-budget figure
        # FAILS THE BUILD (exit 1). A profile carrying no budget (desktop)
        # can never gate: asking it to is an error (exit 2), because a gate
        # that cannot fail is not a gate.
        here = os.path.dirname(os.path.abspath(__file__))
        prof_path = os.path.join(here, "..", "web-profile.json")
        profiles = json.load(open(prof_path))["profiles"]
        if profile_name not in profiles:
            print(f"size gate: unknown profile {profile_name!r} "
                  f"(known: {', '.join(sorted(profiles))})", file=sys.stderr)
            sys.exit(2)
        prof = profiles[profile_name]
        if gate and prof.get("maxBytes") is None and prof.get("maxTriangles") is None:
            print(f"size gate: profile {profile_name!r} carries no budget "
                  f"and cannot gate", file=sys.stderr)
            sys.exit(2)
        failed = False
        for p in files:
            r = validate(p)
            over = []
            if prof.get("maxBytes") is not None and r["bytes"] > prof["maxBytes"]:
                over.append(f"bytes {r['bytes']} > {prof['maxBytes']}")
            if prof.get("maxTriangles") is not None and r["triangles"] > prof["maxTriangles"]:
                over.append(f"triangles {r['triangles']} > {prof['maxTriangles']}")
            r["profile"] = profile_name
            r["within_budget"] = not over
            if over:
                r["over_budget"] = over
                failed = True
            print(json.dumps(r, indent=1))
            if over:
                print(f"SIZE GATE {'FAIL' if gate else 'over'}: "
                      f"{r['file']} over {profile_name} budget: "
                      + "; ".join(over), file=sys.stderr)
        if gate and failed:
            sys.exit(1)
