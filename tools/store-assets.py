#!/usr/bin/env python3
"""Compose the Chrome Web Store images from the raw captures.

Run `node tools/store-shots.mjs` first; it writes store/raw/*.png from the real
extension loaded in Chromium. This script only arranges them: 1280 x 800 store
screenshots plus the optional 440 x 280 promo tile.

    python tools/store-assets.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "store" / "raw"
OUT = ROOT / "store"

BG_TOP = (11, 14, 20)
BG_BOTTOM = (20, 24, 33)
TEXT = (233, 237, 245)
DIM = (154, 165, 184)
MUTED = (107, 118, 136)
ACCENT = (124, 92, 255)
MINT = (52, 211, 153)

FONT_DIR = Path("C:/Windows/Fonts")
REGULAR = FONT_DIR / "segoeui.ttf"
SEMIBOLD = FONT_DIR / "seguisb.ttf"


def font(size, semibold=False):
    path = SEMIBOLD if semibold else REGULAR
    return ImageFont.truetype(str(path), size)


def background(width=1280, height=800):
    image = Image.new("RGB", (width, height), BG_TOP)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        mix = y / max(1, height - 1)
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(
                round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * mix)
                for i in range(3)
            ),
        )

    glow = Image.new("RGB", (width, height), (0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse(
        (-260, -320, 620, 360), fill=(60, 44, 130)
    )
    glow_draw.ellipse(
        (width - 360, height - 300, width + 320, height + 240),
        fill=(18, 78, 62),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(150))
    return Image.blend(image, glow, 0.55)


def rounded(image, radius):
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, image.width - 1, image.height - 1), radius, fill=255
    )
    result = image.convert("RGBA")
    result.putalpha(mask)
    return result


def shadow(canvas, box, radius=18, blur=26, alpha=170):
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(box, radius, fill=(0, 0, 0, alpha))
    canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


def trim_uniform_bottom(image, tolerance=4):
    """Drop the empty rows a fixed-height capture leaves at the bottom."""
    width, height = image.size
    last = height - 1
    while last > 0:
        row = image.crop((0, last, width, last + 1))
        extrema = row.getextrema()  # [(min, max), ...] per channel
        if any(hi - lo > tolerance for lo, hi in extrema):
            break
        last -= 1
    return image.crop((0, 0, width, last + 1))


def paste_screenshot(canvas, path, xy, scale=1.0, radius=16, trim=False):
    shot = Image.open(path).convert("RGB")
    if trim:
        shot = trim_uniform_bottom(shot)
    if scale != 1.0:
        shot = shot.resize(
            (round(shot.width * scale), round(shot.height * scale)),
            Image.LANCZOS,
        )
    x, y = xy
    shadow(canvas, (x + 6, y + 14, x + shot.width + 6, y + shot.height + 14))
    canvas.alpha_composite(rounded(shot, radius), (x, y))
    edge = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle(
        (x, y, x + shot.width - 1, y + shot.height - 1),
        radius,
        outline=(255, 255, 255, 26),
        width=1,
    )
    canvas.alpha_composite(edge)


def kicker(draw, text, xy, color=ACCENT):
    draw.text(xy, text.upper(), font=font(13, True), fill=color)


def wrap(draw, text, fnt, width):
    lines, line = [], ""
    for word in text.split():
        candidate = f"{line} {word}".strip()
        if draw.textlength(candidate, font=fnt) <= width:
            line = candidate
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def paragraph(draw, text, xy, fnt, width, fill=DIM, leading=1.55):
    x, y = xy
    for line in wrap(draw, text, fnt, width):
        draw.text((x, y), line, font=fnt, fill=fill)
        y += round(fnt.size * leading)
    return y


def dot(draw, xy, color=ACCENT, radius=3):
    x, y = xy
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)


def frame_popup():
    canvas = background().convert("RGBA")
    draw = ImageDraw.Draw(canvas)

    kicker(draw, "toolbar popup", (96, 150))
    title = font(46, True)
    y = 186
    for line in ["Pick a tab, a region,", "or a video."]:
        draw.text((96, y), line, font=title, fill=TEXT)
        y += 58
    y = paragraph(
        draw,
        "Three capture modes, one list of everything floating, and a stop button "
        "for each source. The same switches hold auto-close, the workspace "
        "window and optional sync.",
        (96, y + 26),
        font(18),
        540,
    )

    y += 26
    for item in [
        "Auto close after 15, 25 or 50 minutes",
        "Workspace window: capture beside a panel",
        "Notes, to-dos and focus timer in the same window",
    ]:
        dot(draw, (104, y + 9))
        draw.text((122, y), item, font=font(16), fill=(200, 208, 222))
        y += 36

    popup = trim_uniform_bottom(Image.open(RAW / "popup.png").convert("RGB"))
    scale = min(1.0, 726 / popup.height)
    paste_screenshot(canvas, RAW / "popup.png", (830, 38), scale=scale, radius=18, trim=True)
    return canvas.convert("RGB")


def frame_panels():
    canvas = background().convert("RGBA")
    draw = ImageDraw.Draw(canvas)

    kicker(draw, "own panels", (96, 70), MINT)
    draw.text(
        (96, 104),
        "Notes, to-dos and focus float too.",
        font=font(42, True),
        fill=TEXT,
    )
    paragraph(
        draw,
        "No second app and no second window: the same picture-in-picture "
        "surface can hold your notes, today's tasks and a Pomodoro timer.",
        (96, 166),
        font(18),
        900,
    )

    paste_screenshot(canvas, RAW / "notes.png", (214, 246), scale=0.94, radius=16)
    paste_screenshot(canvas, RAW / "timer.png", (706, 232), scale=0.94, radius=16)
    return canvas.convert("RGB")


def frame_full(path, caption, note):
    canvas = Image.open(path).convert("RGB")
    canvas = canvas.crop((0, 0, 1280, 800)).convert("RGBA")

    scrim = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(scrim)
    draw.rectangle((0, 604, 1280, 800), fill=(8, 10, 15, 232))
    canvas.alpha_composite(scrim)

    draw = ImageDraw.Draw(canvas)
    draw.text((72, 640), caption, font=font(32, True), fill=TEXT)
    draw.text((72, 690), note, font=font(17), fill=DIM)
    return canvas.convert("RGB")


def promo_tile():
    canvas = background(440, 280).convert("RGBA")
    draw = ImageDraw.Draw(canvas)

    icon = Image.open(ROOT / "icons" / "icon128.png").convert("RGBA")
    icon = icon.resize((68, 68), Image.LANCZOS)
    canvas.alpha_composite(icon, (32, 34))

    draw.text((114, 38), "PiPDesk", font=font(34, True), fill=TEXT)
    draw.text((114, 82), "Picture-in-picture workspace", font=font(14), fill=ACCENT)
    paragraph(
        draw,
        "Float a tab, a region, a video, or your own notes and timer above your work.",
        (32, 140),
        font(17),
        376,
    )
    draw.text((32, 238), "One window · up to four sources", font=font(13), fill=MUTED)
    return canvas.convert("RGB")


def main():
    OUT.mkdir(exist_ok=True)

    outputs = {
        "01-shared-window.png": frame_full(
            RAW / "welcome-top.png",
            "One window. Up to four sources.",
            "The same canvas layout the compositor draws, with a tab and a page region side by side.",
        ),
        "02-region.png": frame_full(
            RAW / "welcome-region.png",
            "Only that rectangle floats.",
            "Drag a box or hover an element; arrows nudge it, Ctrl + arrows resize it, Esc cancels.",
        ),
        "03-popup.png": frame_popup(),
        "04-panels.png": frame_panels(),
        "promo-440x280.png": promo_tile(),
    }

    for name, image in outputs.items():
        path = OUT / name
        image.save(path, optimize=True)
        print(f"{path.relative_to(ROOT)} {image.width}x{image.height}")


if __name__ == "__main__":
    main()
