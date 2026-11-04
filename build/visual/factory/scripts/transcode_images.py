#!/usr/bin/env python3
"""Re-encode a GLB's embedded PNG images as JPEG — Portal factory tool (M4.05).

The factory's painted cards (face, fur, page textures) are opaque, and at
web-profile sizes PNG costs ~3-5x the bytes of JPEG for the same pixels.
Blender's exporter re-encodes packed images as PNG regardless of the image
datablock's format, so the transcode happens here, on the exported GLB:

  - every image/png bufferView larger than --min-bytes is decoded (Pillow)
    and re-encoded as JPEG (quality --quality, default 85);
  - the binary buffer is rebuilt in bufferView order, each view re-aligned
    to 4 bytes; accessor offsets are relative to their bufferView and are
    therefore untouched, as is every other JSON value;
  - the images' mimeType becomes image/jpeg.

Usage: transcode_images.py <in.glb> <out.glb> [--quality 85] [--min-bytes 4096]
Prints one JSON line with per-image before/after bytes. Dependency: Pillow.
"""
import io, json, struct, sys, os
from PIL import Image

def read_glb(path):
    data = open(path, "rb").read()
    assert data[:4] == b"glTF", "bad magic"
    version, _total = struct.unpack_from("<II", data, 4)
    jlen, jtype = struct.unpack_from("<II", data, 12)
    assert jtype == 0x4E4F534A, "first chunk not JSON"
    gltf = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen, btype = struct.unpack_from("<II", data, off)
    assert btype == 0x004E4942, "second chunk not BIN"
    return version, gltf, data[off + 8: off + 8 + blen]

def main():
    argv = sys.argv[1:]
    quality, min_bytes = 85, 4096
    pos = []
    i = 0
    while i < len(argv):
        if argv[i] == "--quality":
            quality = int(argv[i + 1]); i += 2
        elif argv[i] == "--min-bytes":
            min_bytes = int(argv[i + 1]); i += 2
        else:
            pos.append(argv[i]); i += 1
    src_path, out_path = pos
    version, g, binchunk = read_glb(src_path)

    image_views = {im["bufferView"]: im for im in g.get("images", [])
                   if "bufferView" in im}
    new_bin = bytearray()
    report = []
    for idx, bv in enumerate(g["bufferViews"]):
        start = bv.get("byteOffset", 0)
        raw = binchunk[start:start + bv["byteLength"]]
        if idx in image_views and image_views[idx].get("mimeType") == "image/png" \
                and len(raw) > min_bytes:
            img = Image.open(io.BytesIO(raw)).convert("RGB")
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=quality)
            new = buf.getvalue()
            report.append({"image": image_views[idx].get("name", idx),
                           "png": len(raw), "jpeg": len(new)})
            image_views[idx]["mimeType"] = "image/jpeg"
            raw = new
        pad = (4 - len(new_bin) % 4) % 4
        new_bin += b"\x00" * pad
        bv["byteOffset"] = len(new_bin)
        bv["byteLength"] = len(raw)
        new_bin += raw
    new_bin += b"\x00" * ((4 - len(new_bin) % 4) % 4)
    g["buffers"][0]["byteLength"] = len(new_bin)

    payload = json.dumps(g, separators=(",", ":")).encode()
    payload += b" " * ((4 - len(payload) % 4) % 4)
    total = 12 + 8 + len(payload) + 8 + len(new_bin)
    out = struct.pack("<4sII", b"glTF", version, total)
    out += struct.pack("<II", len(payload), 0x4E4F534A) + payload
    out += struct.pack("<II", len(new_bin), 0x004E4942) + bytes(new_bin)
    with open(out_path, "wb") as f:
        f.write(out)
    print(json.dumps({"file": os.path.basename(out_path),
                      "bytes": len(out), "transcoded": report}))

if __name__ == "__main__":
    main()
