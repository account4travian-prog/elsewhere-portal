#!/usr/bin/env python3
"""Restore node extras stripped by gltfpack — Portal factory tool (M4.05).

gltfpack (even with -ke) drops the factory's per-node extras — for factory
figures that is the Armature node's honesty record (persona_id, clip_source,
the per-clip clip_sources map). Losing it silently would break the factory's
own rule that every clip's source travels with the figure.

This tool copies `extras` from every named node in a SOURCE glb onto the
same-named node in a TARGET glb, only where the target node has none, and
rewrites the target as a valid GLB (JSON chunk re-padded to 4 bytes).
Dependency-free, like validate_glb.py. Usage:

  patch_extras.py <target.glb> <source.glb>   (target is rewritten in place)

Prints one JSON line: {"file": ..., "patched": [node names], "bytes": N}.
Nothing else in the target is touched: binary chunk bytes are copied
verbatim, node order and all other JSON values are preserved.
"""
import json, struct, sys, os

def read_glb(path):
    data = open(path, "rb").read()
    assert data[:4] == b"glTF", "bad magic"
    version, total = struct.unpack_from("<II", data, 4)
    jlen, jtype = struct.unpack_from("<II", data, 12)
    assert jtype == 0x4E4F534A, "first chunk not JSON"
    gltf = json.loads(data[20:20 + jlen])
    rest = data[20 + jlen:]
    return version, gltf, rest

def main(target_path, source_path):
    version, tgt, rest = read_glb(target_path)
    _v, src, _r = read_glb(source_path)
    src_extras = {n["name"]: n["extras"] for n in src.get("nodes", [])
                  if n.get("name") and n.get("extras")}
    patched = []
    for n in tgt.get("nodes", []):
        name = n.get("name")
        if name in src_extras and not n.get("extras"):
            n["extras"] = src_extras[name]
            patched.append(name)
    payload = json.dumps(tgt, separators=(",", ":")).encode()
    payload += b" " * ((4 - len(payload) % 4) % 4)
    total = 12 + 8 + len(payload) + len(rest)
    out = struct.pack("<4sII", b"glTF", version, total)
    out += struct.pack("<II", len(payload), 0x4E4F534A) + payload + rest
    with open(target_path, "wb") as f:
        f.write(out)
    print(json.dumps({"file": os.path.basename(target_path),
                      "patched": patched, "bytes": len(out)}))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
