#!/usr/bin/env python3
"""Generate the PiPDesk icon set.

Renders the 16/48/128 px icons from code so the artwork stays in the repo and
no image editor or third-party library is needed. Run from the project root:

    python tools/make-icons.py
"""

from __future__ import annotations

import math
import os
import struct
import zlib

SIZES = (16, 48, 128)
SUPERSAMPLE = 3
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

GRADIENT_FROM = (0x8F, 0x74, 0xFF)
GRADIENT_TO = (0x5B, 0x3C, 0xE0)
SCREEN_STROKE = (255, 255, 255)
INSET_FILL = (255, 255, 255)
SHADOW = (0x24, 0x14, 0x66)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def rounded_rect_sdf(px, py, x0, y0, x1, y1, radius) -> float:
    """Signed distance to a rounded rectangle: negative inside."""
    cx = clamp(px, x0 + radius, x1 - radius)
    cy = clamp(py, y0 + radius, y1 - radius)
    return math.hypot(px - cx, py - cy) - radius


def coverage(distance: float, feather: float) -> float:
    return clamp(0.5 - distance / feather, 0.0, 1.0)


def over(base, top, alpha):
    return tuple(base[i] + (top[i] - base[i]) * alpha for i in range(3))


def shade(u: float, v: float) -> tuple[float, float, float]:
    t = clamp((u + v) / 2.0, 0.0, 1.0)
    return over(GRADIENT_FROM, GRADIENT_TO, t)


def sample(u: float, v: float, feather: float):
    """Colour for one subsample at normalised coordinates, plus its alpha."""
    alpha = coverage(rounded_rect_sdf(u, v, 0.0, 0.0, 1.0, 1.0, 0.22), feather)
    if alpha <= 0.0:
        return (0.0, 0.0, 0.0, 0.0)

    colour = shade(u, v)

    # Soft drop shadow under the inset card.
    shadow = coverage(rounded_rect_sdf(u, v, 0.40, 0.46, 0.84, 0.74, 0.07), feather)
    if shadow:
        colour = over(colour, SHADOW, 0.35 * shadow)

    # Outline of the "screen".
    screen_distance = abs(rounded_rect_sdf(u, v, 0.17, 0.19, 0.65, 0.56, 0.09))
    stroke = coverage(screen_distance - 0.035, feather)
    if stroke:
        colour = over(colour, SCREEN_STROKE, stroke)

    # Filled picture-in-picture card.
    inset = coverage(rounded_rect_sdf(u, v, 0.41, 0.47, 0.85, 0.75, 0.07), feather)
    if inset:
        colour = over(colour, INSET_FILL, inset)

    return (colour[0], colour[1], colour[2], alpha)


def render(size: int):
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            r = g = b = a = 0.0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    u = (x + (sx + 0.5) / SUPERSAMPLE) / size
                    v = (y + (sy + 0.5) / SUPERSAMPLE) / size
                    sr, sg, sb, sa = sample(u, v, feather=2.0 / size)
                    r += sr * sa
                    g += sg * sa
                    b += sb * sa
                    a += sa
            total = SUPERSAMPLE * SUPERSAMPLE
            if a > 0:
                row.append(
                    (
                        round(r / a),
                        round(g / a),
                        round(b / a),
                        round(255 * a / total),
                    )
                )
            else:
                row.append((0, 0, 0, 0))
        rows.append(row)
    return rows


def chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path: str, rows) -> None:
    height = len(rows)
    width = len(rows[0])
    raw = b"".join(
        b"\x00" + bytes(value for pixel in row for value in pixel) for row in rows
    )
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    payload = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as handle:
        handle.write(payload)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        target = os.path.join(OUT_DIR, f"icon{size}.png")
        write_png(target, render(size))
        print(f"wrote {target} ({os.path.getsize(target)} bytes)")


if __name__ == "__main__":
    main()
