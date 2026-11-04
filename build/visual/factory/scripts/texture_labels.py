#!/usr/bin/env python3
"""Segment a KayKit palette-atlas texture into swatch labels.

The KayKit character textures are palette atlases: flat swatches with
vertical luminance ramps. This tool clusters colours at 256^2 (16-level
buckets; clusters under 0.15% absorbed into the nearest big cluster),
and writes a label table (median colour, share, uv bbox per label) plus
optionally the full-res label map (.npy) the citizen builder recolours
by role with per-pixel luminance preserved.

Usage: texture_labels.py <texture.png> [--out labels.json] [--map map.npy]
"""
import json, sys
import numpy as np
from PIL import Image

def main():
    args = sys.argv[1:]
    src = args[0]
    out = args[args.index('--out') + 1] if '--out' in args else None
    mapout = args[args.index('--map') + 1] if '--map' in args else None
    im = Image.open(src).convert('RGB')
    W, H = im.size
    full = np.asarray(im).astype(int)
    S = 256
    small = np.asarray(im.resize((S, S), Image.BILINEAR)).astype(int)
    buckets = (small // 16)
    keys = buckets[:, :, 0] * 65536 + buckets[:, :, 1] * 256 + buckets[:, :, 2]
    uniq, inverse, counts = np.unique(keys, return_inverse=True, return_counts=True)
    total = S * S
    big = counts / total >= 0.0015
    centres = {}
    for i, u in enumerate(uniq):
        if big[i]:
            centres[i] = np.array([(u // 65536) % 256, (u // 256) % 256, u % 256]) * 16 + 8
    # absorb small clusters into nearest big centre
    remap = np.zeros(len(uniq), dtype=int)
    big_idx = [i for i in range(len(uniq)) if big[i]]
    for i, u in enumerate(uniq):
        if big[i]:
            remap[i] = i
        else:
            c = np.array([(u // 65536) % 256, (u // 256) % 256, u % 256]) * 16 + 8
            remap[i] = min(big_idx, key=lambda b: int(((centres[b] - c) ** 2).sum()))
    lab_small = remap[inverse].reshape(S, S)
    # compact label ids in first-appearance order
    present = sorted(set(int(x) for x in np.unique(lab_small)))
    compact = {old: new for new, old in enumerate(present)}
    lab_small = np.vectorize(compact.get)(lab_small)
    labfull = np.asarray(
        Image.fromarray(lab_small.astype(np.uint8)).resize((W, H), Image.NEAREST)).astype(int)
    table = []
    for new, old in enumerate(present):
        mask = labfull == new
        n = int(mask.sum())
        px = full[mask]
        med = np.median(px, axis=0)
        ys, xs = np.nonzero(mask)
        table.append({
            'label': new,
            'median': '#%02x%02x%02x' % tuple(int(round(x)) for x in med),
            'share_pct': round(100.0 * n / (W * H), 2),
            'bbox_uv': [round(float(xs.min()) / W, 3), round(float(ys.min()) / H, 3),
                        round(float(xs.max()) / W, 3), round(float(ys.max()) / H, 3)],
        })
    table.sort(key=lambda t: -t['share_pct'])
    result = {'source': src, 'labels': table, 'n_labels': len(present)}
    print(json.dumps(result, indent=1))
    if out:
        json.dump(result, open(out, 'w'), indent=1)
    if mapout:
        np.save(mapout, labfull)

if __name__ == '__main__':
    main()
