#!/usr/bin/env python3
"""Sign, clock and awning textures for the M4.14 building set.

Per visual-plan/02 §5.2: sign text is rendered per building — 512x256
canvas, cream board, outline-brown text — baked to a PNG on the board
mesh; text is never modelled geometry. The clock face (§5.1 B3) is a
rendered texture with hands fixed at 9:00: a working clock would claim
a time the record does not have. The Market Hall awning (§5.1 B4) is a
2-colour 64x64 stripe canvas — the kit's one procedural texture.

Font: the plan names Fredoka 600. Fredoka is not on this machine; the
stand-in is DejaVu Sans Bold, recorded here and in the lane note — the
textures regenerate by script when the OFL font lands.

Run with system python (PIL): scripts/make_sign_textures.py
Outputs into factory/assets/signs/.
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "assets", "signs")
os.makedirs(OUT, exist_ok=True)

FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
CREAM = (255, 246, 234)
BOARD = (253, 233, 207)      # awning cream anchor family
BROWN = (105, 74, 59)        # outline brown (scene label border tone)
PINK = (231, 127, 162)       # Sample 1 awning pink (fenced-speech rose family)
GOLD = (217, 164, 65)


def fit_font(draw, text, max_w, start=64):
    size = start
    while size > 14:
        f = ImageFont.truetype(FONT_PATH, size)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 4
    return ImageFont.truetype(FONT_PATH, 14)


def sign(slug, lines):
    img = Image.new("RGB", (512, 256), BOARD)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([10, 10, 502, 246], radius=26, outline=BROWN, width=8)
    n = len(lines)
    for i, line in enumerate(lines):
        f = fit_font(d, line, 440, 72 if n == 1 else 58)
        w = d.textlength(line, font=f)
        y = 128 - (n * 42) + i * 84 - (f.size // 2)
        d.text(((512 - w) / 2, y), line, font=f, fill=BROWN)
    img.save(os.path.join(OUT, f"sign_{slug}.png"))
    print("sign", slug, lines)


SIGNS = {
    "bld_ember_townhall": ["Town Hall"],
    "bld_market_hall": ["Market Hall"],
    "bld_ember_college": ["The College"],
    "bld_library_annex": ["Library Annex"],
    "bld_public_workshop": ["Public Workshop"],
    "bld_ember_district_3_plot_18": ["Meridian Hall"],
    "bld_ember_district_1_plot_31": ["Ember Ledger", "Press"],
    "bld_ember_home_maple_cottage": ["Maple Cottage"],
    "bld_ember_home_willow_cottage": ["Willow Cottage"],
    "bld_ember_district_1_plot_30": ["District 1 · Plot 30", "No building stands here"],
}
for slug, lines in SIGNS.items():
    sign(slug, lines)

# Clock face: cream disc, brown ring + ticks, hands fixed at 9:00.
img = Image.new("RGB", (256, 256), CREAM)
d = ImageDraw.Draw(img)
d.ellipse([8, 8, 248, 248], outline=BROWN, width=10, fill=(255, 250, 240))
for a in range(12):
    import math
    x1 = 128 + 96 * math.sin(math.radians(a * 30)); y1 = 128 - 96 * math.cos(math.radians(a * 30))
    x2 = 128 + 108 * math.sin(math.radians(a * 30)); y2 = 128 - 108 * math.cos(math.radians(a * 30))
    d.line([x1, y1, x2, y2], fill=BROWN, width=5)
d.line([128, 128, 62, 128], fill=BROWN, width=11)    # hour hand -> 9
d.line([128, 128, 128, 40], fill=BROWN, width=8)     # minute hand -> 12
d.ellipse([120, 120, 136, 136], fill=GOLD)
img.save(os.path.join(OUT, "clock_face.png"))
print("clock_face (hands fixed at 9:00)")

# Awning stripes: 64x64, pink/cream vertical stripes (Sample 1).
img = Image.new("RGB", (64, 64), CREAM)
d = ImageDraw.Draw(img)
for x in range(0, 64, 16):
    d.rectangle([x, 0, x + 7, 64], fill=PINK)
img.save(os.path.join(OUT, "awning_stripes.png"))
print("awning_stripes")
