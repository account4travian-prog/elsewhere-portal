#!/usr/bin/env python3
"""Standee finisher — Portal M4.09 / Design A6 (second stage of the pipeline).

Consumes the Blender stage's raw passes (scripts/render_standee.py) from a
per-kit work dir and produces the shipped standee products:

  masters/<kit>--<pose>.png      512x512 composited masters (Production 7.4)
  sprites/<kit>--<pose>.webp     256x384 palette-quantised sprites; each is
                                 one standee unit under the lod2 byte gate
                                 (web-profile.json: <= 8192 B)
  portraits/<kit>--portrait.png  256x256 head-and-shoulders (Production 7.4;
                                 the plan names no byte budget for portraits)
  <kit>.standee.json             per-kit record fragment

and, with --pack-atlas, the wave products:

  shadow.webp                    shared ground-shadow ellipse (40% opacity,
                                 Production 7.4 — one shared sprite, never
                                 per-citizen bytes)
  atlas.webp + standees.json     the shared atlas (Rendering 8.2) and the
                                 merged manifest: inputs + hashes, outputs,
                                 per-sprite gate verdicts.

Composite rule: the inverted-hull pass renders BEHIND the figure pass
(hull image as base, figure alpha-composited over it) — the outline-brown
silhouette peeking out around the figure is the plan's 2 px sheet outline
(Production 7.4), produced without touching the figure's own pixels.

Ship-form rule (Rendering 8.2 + VISUAL-PLAN V-13): masters are 512x512;
the shipped sprite is 256x384, taken as the centre 2:3 crop of the master
resized with Lanczos. Palette ladder (lossless WebP, libimagequant,
no dither): 160/128/96/64/48/32/24/16 colours, first fit wins; lossy
q90/q80/q70 is the recorded fallback. If nothing fits, the sprite is
recorded gate FAIL and this script exits 1 — a standee that cannot fit
the budget does not slip through quietly.

Determinism: every output is a pure function of the master pixels
(Pillow re-encodes from pixels only, so Blender's PNG metadata chunks
never reach a shipped file).
"""
import hashlib, io, json, os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
FACTORY = os.path.join(HERE, "..")
POSES = ["idle", "walk-frame", "sit", "work", "talk"]  # render order = atlas column order
PALETTE_LADDER = [160, 128, 96, 64, 48, 32, 24, 16]
LOSSY_LADDER = [90, 80, 70, 60, 50, 40]  # M4.10: extended with 60/50/40 —
# textured citizen sprites (identity-remapped atlases + props) land ~3%
# over budget at q70, and the bulkiest bases in wide poses (sit) ~5% over
# at q50; the extra rungs only engage when every existing rung fails.

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def budget_bytes():
    prof = json.load(open(os.path.join(FACTORY, "web-profile.json")))
    return prof["profiles"]["lod2"]["maxBytes"]

def composite(fig_path, hull_path):
    hull = Image.open(hull_path).convert("RGBA")
    fig = Image.open(fig_path).convert("RGBA")
    out = hull
    out.alpha_composite(fig)
    return out

def encode_sprite(img, budget):
    """Return (bytes, encoding-record) for the first encoding under budget,
    or (smallest-bytes, record) with fits=False if none fits."""
    best = None
    for colours in PALETTE_LADDER:
        try:
            method = Image.Quantize.LIBIMAGEQUANT
        except AttributeError:
            method = Image.Quantize.FASTOCTREE
        q = img.quantize(colors=colours, method=method,
                         dither=Image.Dither.NONE)
        buf = io.BytesIO()
        q.save(buf, "WEBP", lossless=True, method=6)
        data = buf.getvalue()
        rec = {"method": "webp-lossless-palette", "colours": colours,
               "bytes": len(data), "fits": len(data) <= budget}
        if best is None or len(data) < len(best[0]):
            best = (data, rec)
        if rec["fits"]:
            return data, rec
    for quality in LOSSY_LADDER:
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=quality, exact=True, method=6)
        data = buf.getvalue()
        rec = {"method": "webp-lossy", "quality": quality,
               "bytes": len(data), "fits": len(data) <= budget}
        if len(data) < len(best[0]):
            best = (data, rec)
        if rec["fits"]:
            return data, rec
    return best

def finish_kit(persona, workdir, outdir, source):
    budget = budget_bytes()
    info = json.load(open(os.path.join(workdir, "render-info.json")))
    for sub in ("masters", "sprites", "portraits"):
        os.makedirs(os.path.join(outdir, sub), exist_ok=True)
    frag = {
        "persona": persona,
        "input": {"source_glb": os.path.relpath(source, FACTORY),
                  "sha256": sha256(source), "bytes": os.path.getsize(source)},
        "render": info,
        "sprites": {}, "portrait": None, "gate": {"profile": "lod2",
                                                  "maxBytes": budget},
    }
    failed = False
    for pose in POSES:
        master = composite(os.path.join(workdir, f"{pose}--fig.png"),
                           os.path.join(workdir, f"{pose}--hull.png"))
        mpath = os.path.join(outdir, "masters", f"{persona}--{pose}.png")
        master.save(mpath, "PNG")
        # centre 2:3 crop of the 512x512 master -> 256x384 ship form
        w, h = master.size
        cw = int(w * 2 / 3)
        crop = master.crop(((w - cw) // 2, 0, (w - cw) // 2 + cw, h))
        sprite_img = crop.resize((256, 384), Image.LANCZOS)
        data, rec = encode_sprite(sprite_img, budget)
        spath = os.path.join(outdir, "sprites", f"{persona}--{pose}.webp")
        with open(spath, "wb") as f:
            f.write(data)
        frag["sprites"][pose] = {
            "file": os.path.relpath(spath, FACTORY),
            "master": os.path.relpath(mpath, FACTORY),
            "bytes": rec["bytes"], "encoding": rec,
            "sha256": hashlib.sha256(data).hexdigest(),
            "gate_verdict": "PASS" if rec["fits"] else "FAIL",
        }
        if not rec["fits"]:
            failed = True
            print(f"STANDEE GATE FAIL: {persona}--{pose}.webp "
                  f"{rec['bytes']} > {budget} under every encoding",
                  file=sys.stderr)
    # portrait: head-and-shoulders, 512x512 master -> 256x256 (no crop;
    # the portrait render is already head-framed). No plan byte budget.
    pmaster = composite(os.path.join(workdir, "portrait--fig.png"),
                        os.path.join(workdir, "portrait--hull.png"))
    pmpath = os.path.join(outdir, "masters", f"{persona}--portrait.png")
    pmaster.save(pmpath, "PNG")
    ppath = os.path.join(outdir, "portraits", f"{persona}--portrait.png")
    pmaster.resize((256, 256), Image.LANCZOS).save(ppath, "PNG")
    frag["portrait"] = {"file": os.path.relpath(ppath, FACTORY),
                        "master": os.path.relpath(pmpath, FACTORY),
                        "bytes": os.path.getsize(ppath),
                        "sha256": sha256(ppath), "gate_verdict": "UNGATED "
                        "(plan names no portrait byte budget)"}
    with open(os.path.join(outdir, f"{persona}.standee.json"), "w") as f:
        json.dump(frag, f, indent=1, sort_keys=True)
    print("STANDEE_SUMMARY " + json.dumps({
        "persona": persona,
        "sprites": {p: frag["sprites"][p]["bytes"] for p in POSES},
        "verdicts": {p: frag["sprites"][p]["gate_verdict"] for p in POSES},
        "portrait_bytes": frag["portrait"]["bytes"]}))
    return 1 if failed else 0

def make_shadow():
    """Shared ground-shadow ellipse: radial gradient, 40% peak opacity."""
    w, h = 256, 96
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y in range(h):
        for x in range(w):
            dx = (x - w / 2) / (w / 2)
            dy = (y - h / 2) / (h / 2)
            r2 = dx * dx + dy * dy
            a = max(0.0, 1.0 - r2)
            px[x, y] = (0, 0, 0, int(102 * a * a))
    return img

def pack_atlas(outdir):
    frags = []
    for name in sorted(os.listdir(outdir)):
        if name.endswith(".standee.json"):
            frags.append(json.load(open(os.path.join(outdir, name))))
    if not frags:
        print("pack-atlas: no kit fragments found", file=sys.stderr)
        return 2
    cell_w, cell_h = 256, 384
    cols = len(POSES)
    rows = len(frags)
    atlas = Image.new("RGBA", (cell_w * cols, cell_h * (rows + 1)),
                      (0, 0, 0, 0))
    rects = {}
    for r, frag in enumerate(frags):
        for c, pose in enumerate(POSES):
            sp = os.path.join(FACTORY, frag["sprites"][pose]["file"])
            atlas.alpha_composite(Image.open(sp).convert("RGBA"),
                                  (c * cell_w, r * cell_h))
            rects[f"{frag['persona']}:{pose}"] = {
                "x": c * cell_w, "y": r * cell_h, "w": cell_w, "h": cell_h}
    shadow = make_shadow()
    spath = os.path.join(outdir, "shadow.webp")
    shadow.save(spath, "WEBP", lossless=True, method=6)
    atlas.alpha_composite(shadow,
                          (0, rows * cell_h + (cell_h - shadow.size[1]) // 2))
    rects["shared:shadow"] = {"x": 0, "y": rows * cell_h, "w": shadow.size[0],
                               "h": shadow.size[1], "cell_row": rows}
    apath = os.path.join(outdir, "atlas.webp")
    atlas.save(apath, "WEBP", lossless=True, method=6)
    manifest = {
        "schema": "portal.standees/v1",
        "profile": "lod2 (web-profile.json)",
        "unit_rule": "one standee unit = one pose sprite (256x384 WebP); "
                     "the lod2 byte gate applies per sprite",
        "poses": POSES,
        "kits": frags,
        "shadow": {"file": os.path.relpath(spath, FACTORY),
                   "bytes": os.path.getsize(spath), "sha256": sha256(spath),
                   "note": "shared sprite, 40% peak opacity (Production 7.4)"},
        "atlas": {"file": os.path.relpath(apath, FACTORY),
                  "bytes": os.path.getsize(apath), "sha256": sha256(apath),
                  "cell": [cell_w, cell_h], "rects": rects},
    }
    with open(os.path.join(outdir, "standees.json"), "w") as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
    print("ATLAS_SUMMARY " + json.dumps({
        "kits": [f["persona"] for f in frags],
        "atlas_bytes": manifest["atlas"]["bytes"],
        "shadow_bytes": manifest["shadow"]["bytes"]}))
    contact_sheets(frags, outdir)
    return 0

def contact_sheets(frags, outdir):
    """Per-kit review sheets in sheets/ (the make_sheets.py precedent):
    the five sprites on a mid-grey ground — the colour a pastel cutout
    must separate from — each labelled with pose, bytes, verdict."""
    sheets_dir = os.path.join(FACTORY, "sheets")
    os.makedirs(sheets_dir, exist_ok=True)
    label_h = 26
    for frag in frags:
        sheet = Image.new("RGB", (256 * len(POSES), 384 + label_h),
                          (96, 96, 104))
        d = ImageDraw.Draw(sheet)
        for c, pose in enumerate(POSES):
            sp = Image.open(os.path.join(
                FACTORY, frag["sprites"][pose]["file"])).convert("RGBA")
            cell = Image.new("RGBA", sp.size, (96, 96, 104, 255))
            cell.alpha_composite(sp)
            sheet.paste(cell.convert("RGB"), (c * 256, label_h))
            s = frag["sprites"][pose]
            d.text((c * 256 + 6, 8),
                   f"{pose}  {s['bytes']} B  {s['gate_verdict']}",
                   fill=(240, 240, 240))
        dest = os.path.join(sheets_dir, f"{frag['persona']}--standees.png")
        sheet.save(dest, "PNG")
        print("CONTACT_SHEET " + dest)

if __name__ == "__main__":
    argv = sys.argv[1:]
    args = {}
    i = 0
    while i < len(argv):
        if argv[i].startswith("--"):
            key = argv[i][2:]
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                args[key] = argv[i + 1]; i += 2
            else:
                args[key] = True; i += 1
        else:
            i += 1
    if args.get("pack-atlas"):
        sys.exit(pack_atlas(args["outdir"]))
    sys.exit(finish_kit(args["persona"], args["workdir"], args["outdir"],
                        args["source"]))
