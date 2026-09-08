"""Measure how busy each patch of every room's board art is, so the board can seat weapon tokens on
calm floor instead of over the furniture.

For each painting under assets/board/rooms/ this takes the luminance gradient (ink outlines,
texture, shading edges all score high; flat floor and plain rugs score low), averages it over a
coarse grid, scales the grid so the busiest cell of that room is 255, and writes the lot to
client/src/render/boardBusyness.json as one hex string per room (two characters per cell, rows
top to bottom). The client maps a candidate token spot into the painting through the same stretch
the board uses and reads the cells under it.

Re-run whenever a board room painting is added or replaced:

    python client/scripts/boardBusyness.py

Requires Pillow and numpy (the same as the optimize-image-assets skill).
"""
from __future__ import annotations

import json
import os
import re
import sys

try:
    import numpy as np
    from PIL import Image
except ImportError as e:  # pragma: no cover
    print(f"boardBusyness: missing dependency ({e}); pip install pillow numpy", file=sys.stderr)
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ART_DIR = os.path.join(ROOT, "assets", "board", "rooms")
OUT = os.path.join(ROOT, "client", "src", "render", "boardBusyness.json")
COLS = 24  # cells across; rows follow the painting's aspect ratio


def slug(name: str) -> str:
    return re.sub(r"^_+|_+$", "", re.sub(r"[^a-z0-9]+", "_", name.lower()))


def busyness(path: str) -> dict:
    im = Image.open(path).convert("L")
    a = np.asarray(im, dtype=np.float32)
    # A touch of blur first, so fine wood grain and canvas noise don't read as furniture.
    a = np.asarray(Image.fromarray(a.astype(np.uint8)).resize((im.width // 2, im.height // 2), Image.BILINEAR), dtype=np.float32)
    gy, gx = np.gradient(a)
    g = np.hypot(gx, gy)
    h, w = g.shape
    rows = max(2, round(COLS * h / w))
    # Average the gradient over each grid cell (cells are ~w/COLS px, so the trim is negligible).
    ch, cw = h // rows, w // COLS
    grid = g[: ch * rows, : cw * COLS].reshape(rows, ch, COLS, cw).mean(axis=(1, 3))
    top = float(np.percentile(grid, 98)) or 1.0
    cells = np.clip(grid / top * 255, 0, 255).round().astype(np.uint8)
    return {"cols": COLS, "rows": int(rows), "cells": "".join(f"{v:02x}" for v in cells.flatten())}


def main() -> None:
    out: dict[str, dict] = {}
    for name in sorted(os.listdir(ART_DIR)):
        base, ext = os.path.splitext(name)
        if ext.lower() not in (".png", ".jpg", ".jpeg", ".webp", ".svg"):
            continue
        if ext.lower() == ".svg":
            continue  # no raster to measure; the board falls back to its default placement
        out[slug(base)] = busyness(os.path.join(ART_DIR, name))
        print(f"{base:20s} {out[slug(base)]['cols']}x{out[slug(base)]['rows']}")
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {OUT} ({os.path.getsize(OUT) // 1024} KB, {len(out)} rooms)")


if __name__ == "__main__":
    main()
