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
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

# The gradient runs from the light at the top left to the dark under the card,
# so the white card always sits on the dark end of the ramp.
GRADIENT_LIGHT = (0x8A, 0x6B, 0xFF)
GRADIENT_DARK = (0x3F, 0x23, 0xC4)
FRAME_FILL = (255, 255, 255)
CARD_FILL = (255, 255, 255)
SHEEN = (255, 255, 255)
SHADOW = (0x18, 0x0A, 0x46)

CONTAINER_RADIUS = 0.22

# One profile per toolbar slot. A 16 px icon cannot show a hole inside the frame
# or a drop shadow, so it is drawn as two solid shapes with a gap between them;
# the larger sizes add the hole, the sheen and the shadow.
#
#   frame:    (x0, y0, x1, y1, radius, wall)  wall 0 draws a solid block
#   card:     (x0, y0, x1, y1, radius)        always overlaps the frame corner
#   moat_px:  the gap that keeps the two white shapes apart. That gap is the
#             whole point of the mark, so it is given in pixels, not fractions.
SIZE_PROFILES = {
    16: {
        "supersample": 5,
        "feather_px": 1.25,
        "frame": (0.15, 0.17, 0.77, 0.69, 0.10, 0.0),
        "card": (0.46, 0.44, 0.90, 0.79, 0.08),
        "moat_px": 1.5,
        "sheen": 0.0,
        "shadow": 0.0,
    },
    48: {
        "supersample": 4,
        "feather_px": 1.6,
        "frame": (0.15, 0.17, 0.71, 0.63, 0.09, 0.10),
        "card": (0.44, 0.44, 0.87, 0.77, 0.07),
        "moat_px": 2.0,
        "sheen": 0.10,
        "shadow": 0.0,
    },
    128: {
        "supersample": 4,
        "feather_px": 1.9,
        "frame": (0.14, 0.16, 0.71, 0.63, 0.09, 0.085),
        "card": (0.43, 0.43, 0.87, 0.77, 0.07),
        "moat_px": 2.4,
        "sheen": 0.13,
        "shadow": 0.30,
    },
}


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


def container_colour(u: float, v: float, profile) -> tuple[float, float, float]:
    """Background gradient plus the soft light that falls from the top edge."""
    t = clamp((u + v) / 2.0, 0.0, 1.0)
    colour = over(GRADIENT_LIGHT, GRADIENT_DARK, t)
    if profile["sheen"]:
        colour = over(colour, SHEEN, profile["sheen"] * clamp((0.32 - v) / 0.32, 0.0, 1.0))
    return colour


def ring(outer_coverage: float, inner_coverage: float) -> float:
    """Coverage of a band bounded by an outer and an inner shape."""
    return max(0.0, outer_coverage - inner_coverage)


def sample(u: float, v: float, size: int, profile):
    """Colour for one subsample at normalised coordinates, plus its alpha.

    Draw order is the whole trick: background, frame, then the moat punched in
    the background colour, then the card. Swap the last two and the white shapes
    fuse into one blob at small sizes.
    """
    feather = profile["feather_px"] / size

    alpha = coverage(
        rounded_rect_sdf(u, v, 0.0, 0.0, 1.0, 1.0, CONTAINER_RADIUS), feather
    )
    if alpha <= 0.0:
        return (0.0, 0.0, 0.0, 0.0)

    background = container_colour(u, v, profile)
    colour = background

    fx0, fy0, fx1, fy1, fradius, wall = profile["frame"]
    frame_outer = coverage(
        rounded_rect_sdf(u, v, fx0, fy0, fx1, fy1, fradius), feather
    )
    if wall > 0:
        frame_inner = coverage(
            rounded_rect_sdf(
                u,
                v,
                fx0 + wall,
                fy0 + wall,
                fx1 - wall,
                fy1 - wall,
                max(fradius - wall, 0.0),
            ),
            feather,
        )
        frame = ring(frame_outer, frame_inner)
    else:
        frame = frame_outer
    colour = over(colour, FRAME_FILL, frame)

    cx0, cy0, cx1, cy1, cradius = profile["card"]
    moat = profile["moat_px"] / size
    card = coverage(rounded_rect_sdf(u, v, cx0, cy0, cx1, cy1, cradius), feather)
    moat_outer = coverage(
        rounded_rect_sdf(
            u, v, cx0 - moat, cy0 - moat, cx1 + moat, cy1 + moat, cradius + moat
        ),
        feather,
    )
    colour = over(colour, background, ring(moat_outer, card))

    if profile["shadow"]:
        offset_x, offset_y = 0.012, 0.022
        shadow = coverage(
            rounded_rect_sdf(
                u,
                v,
                cx0 + offset_x - moat,
                cy0 + offset_y - moat,
                cx1 + offset_x + moat,
                cy1 + offset_y + moat,
                cradius + moat,
            ),
            feather,
        )
        colour = over(colour, SHADOW, profile["shadow"] * ring(shadow, card))

    colour = over(colour, CARD_FILL, card)

    return (colour[0], colour[1], colour[2], alpha)


def render(size: int, profile):
    supersample = profile["supersample"]
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            r = g = b = a = 0.0
            for sy in range(supersample):
                for sx in range(supersample):
                    u = (x + (sx + 0.5) / supersample) / size
                    v = (y + (sy + 0.5) / supersample) / size
                    sr, sg, sb, sa = sample(u, v, size, profile)
                    r += sr * sa
                    g += sg * sa
                    b += sb * sa
                    a += sa
            total = supersample * supersample
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
        write_png(target, render(size, SIZE_PROFILES[size]))
        print(f"wrote {target} ({os.path.getsize(target)} bytes)")


if __name__ == "__main__":
    main()
