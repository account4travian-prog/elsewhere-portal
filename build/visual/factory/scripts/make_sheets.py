#!/usr/bin/env python3
"""Compose v1-vs-v2 comparison sheets: sheets/<persona>--v1-vs-v2.png.
Grid 3x2: [v1 front | v2 front | v2 head] / [v1 iso | v2 iso | v2 type].
Note: v1 renders are Blender Workbench (flat), v2 are Cycles (shaded) -
this VM's Blender 5.2 cannot run Workbench headless (no libEGL.so.1)."""
import os
from PIL import Image, ImageDraw

BASE = os.path.join(os.path.dirname(__file__), "..")
CELL = 560
LABEL = 30

def cell(path):
    im = Image.open(path).convert("RGB")
    return im.resize((CELL, CELL), Image.LANCZOS)

def sheet(pid):
    v1 = lambda n: os.path.join(BASE, "renders", f"{pid}--{n}.png")
    v2 = lambda n: os.path.join(BASE, "renders-v2", f"{pid}--{n}.png")
    items = [("v1 front (Workbench)", v1("front")), ("v2 front (Cycles)", v2("front")),
             ("v2 head close-up", v2("head")),
             ("v1 iso (Workbench)", v1("iso")), ("v2 iso (Cycles)", v2("iso")),
             ("v2 type pose", v2("type-check"))]
    W, H = CELL * 3, (CELL + LABEL) * 2
    out = Image.new("RGB", (W, H), (24, 24, 28))
    d = ImageDraw.Draw(out)
    for i, (label, path) in enumerate(items):
        x = (i % 3) * CELL; y = (i // 3) * (CELL + LABEL)
        out.paste(cell(path), (x, y + LABEL))
        d.text((x + 10, y + 8), f"{pid} - {label}", fill=(235, 235, 235))
    dest = os.path.join(BASE, "sheets", f"{pid}--v1-vs-v2.png")
    out.save(dest)
    print("sheet:", dest, out.size)

if __name__ == "__main__":
    for p in ("atlas", "builder-1", "verifier-1", "alpha-lead"):
        sheet(p)
