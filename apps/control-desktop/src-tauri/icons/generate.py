#!/usr/bin/env python3
"""
Warehouse14 POS — app icon generator.

Produces a brand-aligned icon (memory.md §10 + tokens.css):
  • Parchment-1 (#F1ECE0) ground with a vignette
  • Gold (#A8853E) double-ring "wax stamp" border
  • "W14" monogram in ink (#0F0F0F), serif italic — the brand wordmark
    reduced to the smallest readable form

Emits every size the Tauri bundle needs:
  • 32 / 128 / 128@2x / 256 / 512 / 1024 → PNG
  • Apple Silicon DMG bundler uses 32 / 128 / 128@2x; rest are reserved
    for the macOS .icns and Windows .ico multi-resolution containers.

The script is dependency-only on Pillow (already present in the
operator's python3 install). No SVG renderer, no cairo, no brew. The
SVG source is generated as a side-artifact so the brand can iterate
manually later without rerunning Python.
"""

from __future__ import annotations

import os
import struct
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ──────────────────────────────────────────────────────────────────────
# Palette — mirrors packages/ui-kit/src/tokens.css §10.2 verbatim.
# ──────────────────────────────────────────────────────────────────────
PARCHMENT      = (241, 236, 224)   # #F1ECE0
PARCHMENT_2    = (234, 228, 213)   # #EAE4D5
PARCHMENT_3    = (222, 214, 194)   # #DED6C2 — vignette edge
INK            = (15, 15, 15)      # #0F0F0F
INK_AGED       = (58, 51, 43)      # #3A332B
GOLD           = (168, 133, 62)    # #A8853E
GOLD_SOFT      = (196, 165, 110)   # #C4A56E

HERE = Path(__file__).resolve().parent

# Tauri bundle expectations (see existing 32x32.png / 128x128.png paths).
SIZES = [32, 64, 128, 256, 512, 1024]

# ──────────────────────────────────────────────────────────────────────
# Font resolution — Cormorant Garamond is the brand display face but is
# not always installed. Fall back through the same chain tokens.css
# documents (Times → serif). The font is rasterised onto the icon at
# generation time; nothing about the bundle needs the file at runtime.
# ──────────────────────────────────────────────────────────────────────
def resolve_font(size_px: int) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf",
        "/System/Library/Fonts/Times.ttc",
        "/Library/Fonts/Times New Roman Italic.ttf",
        "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
        "/Library/Fonts/Cormorant Garamond.ttf",
    ]
    for path in candidates:
        if os.path.isfile(path):
            try:
                return ImageFont.truetype(path, size_px)
            except Exception:
                continue
    return ImageFont.load_default()


# ──────────────────────────────────────────────────────────────────────
# Single-size renderer. Every scale is generated independently so each
# stroke width / vignette radius / text size is proportional — never
# upscaled from a smaller raster (no resampling artifacts).
# ──────────────────────────────────────────────────────────────────────
def render(size: int) -> Image.Image:
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    # ── 1. Round-rect parchment ground ────────────────────────────────
    # macOS expects a rounded-rect with ~22% corner radius (Big Sur+).
    # Windows .ico is flexible — same shape reads as a "tile".
    ground = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(ground)
    radius = int(s * 0.22)
    gdraw.rounded_rectangle(
        [(0, 0), (s - 1, s - 1)],
        radius=radius,
        fill=PARCHMENT + (255,),
    )

    # Soft inner vignette toward Parchment-3 at the corners.
    vignette = Image.new("RGBA", (s, s), PARCHMENT_3 + (0,))
    vdraw = ImageDraw.Draw(vignette)
    vdraw.rounded_rectangle(
        [(0, 0), (s - 1, s - 1)],
        radius=radius,
        fill=PARCHMENT_3 + (60,),
    )
    inner_inset = int(s * 0.10)
    vdraw.rounded_rectangle(
        [(inner_inset, inner_inset), (s - inner_inset, s - inner_inset)],
        radius=max(2, radius - inner_inset),
        fill=(0, 0, 0, 0),
    )
    vignette = vignette.filter(ImageFilter.GaussianBlur(radius=max(1, s // 60)))
    ground.alpha_composite(vignette)

    img.alpha_composite(ground)

    # ── 2. Gold double-ring "wax stamp" ───────────────────────────────
    # Outer ring at 80% diameter, thin gold-soft inner ring at 70%.
    # The double-ring is the visual signature of a 19th-c. official seal.
    draw = ImageDraw.Draw(img)
    ring_outer_r = int(s * 0.39)
    ring_inner_r = int(s * 0.34)
    cx, cy = s // 2, s // 2

    outer_stroke = max(2, s // 36)
    inner_stroke = max(1, s // 80)

    draw.ellipse(
        [
            (cx - ring_outer_r, cy - ring_outer_r),
            (cx + ring_outer_r, cy + ring_outer_r),
        ],
        outline=GOLD,
        width=outer_stroke,
    )
    draw.ellipse(
        [
            (cx - ring_inner_r, cy - ring_inner_r),
            (cx + ring_inner_r, cy + ring_inner_r),
        ],
        outline=GOLD_SOFT,
        width=inner_stroke,
    )

    # ── 3. Eight cardinal dot markers (very subtle — only at ≥ 128px) ─
    if s >= 128:
        import math
        marker_r = max(1, s // 160)
        marker_dist = (ring_outer_r + ring_inner_r) // 2
        for i in range(8):
            angle = (i / 8) * 2 * math.pi
            mx = cx + int(marker_dist * math.cos(angle))
            my = cy + int(marker_dist * math.sin(angle))
            draw.ellipse(
                [(mx - marker_r, my - marker_r), (mx + marker_r, my + marker_r)],
                fill=GOLD,
            )

    # ── 4. "W14" monogram — ink, serif italic, centred ────────────────
    # Aimed to take up ~ 38% of the canvas height.
    text = "W14"
    target_px = int(s * 0.42)
    font = resolve_font(target_px)

    # Pillow's `getbbox` is the modern measurement API.
    bbox = font.getbbox(text)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    tx = (s - text_w) // 2 - bbox[0]
    ty = (s - text_h) // 2 - bbox[1]

    # Subtle shadow so the W14 sits on the parchment (not floating).
    shadow_offset = max(1, s // 200)
    draw.text((tx + shadow_offset, ty + shadow_offset), text,
              font=font, fill=(0, 0, 0, 40))
    draw.text((tx, ty), text, font=font, fill=INK + (255,))

    # ── 5. Top-of-seal serif tick — gold "year ring" notch ────────────
    # Echoes the wax-seal "this is the official mark" convention.
    if s >= 64:
        tick_h = max(2, s // 24)
        tick_w = max(1, s // 80)
        notch_y_top = cy - ring_outer_r - tick_h
        draw.rectangle(
            [(cx - tick_w, notch_y_top), (cx + tick_w, cy - ring_outer_r + tick_h // 2)],
            fill=GOLD,
        )

    # ── 6. Mask round-rect (clip everything past the rounded ground) ──
    mask = Image.new("L", (s, s), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.rounded_rectangle([(0, 0), (s - 1, s - 1)], radius=radius, fill=255)
    img.putalpha(mask)

    return img


# ──────────────────────────────────────────────────────────────────────
# Multi-resolution .ico writer.
# Pillow can save a single PNG-in-ICO but not multi-image. We hand-pack
# the ICO container header so Windows + Tauri Wix can pick the right
# size at draw time.
# ──────────────────────────────────────────────────────────────────────
def write_multires_ico(out_path: Path, images: dict[int, Image.Image]) -> None:
    # ICO sizes Windows expects (16, 24, 32, 48, 64, 128, 256).
    wanted = [16, 24, 32, 48, 64, 128, 256]
    members: list[tuple[int, bytes]] = []
    for size in wanted:
        # Downscale from the next-larger rendered tile for the smaller
        # variants (so 16/24 inherit the same composition).
        source_size = next((k for k in sorted(images) if k >= size), max(images))
        scaled = images[source_size].resize((size, size), Image.LANCZOS)
        # ICO entries store PNG-encoded payloads (Vista+ convention).
        import io
        buf = io.BytesIO()
        scaled.save(buf, format="PNG")
        members.append((size, buf.getvalue()))

    # ICONDIR header: reserved(2) | type=1(2) | count(2)
    header = struct.pack("<HHH", 0, 1, len(members))
    # Each ICONDIRENTRY: w b, h b, ncolors b, reserved b, planes h,
    #                   bitcount h, size_in_bytes I, offset I
    offset = 6 + 16 * len(members)
    entries = b""
    payloads = b""
    for size, png in members:
        w = 0 if size >= 256 else size
        h = 0 if size >= 256 else size
        entries += struct.pack(
            "<BBBBHHII", w, h, 0, 0, 1, 32, len(png), offset
        )
        payloads += png
        offset += len(png)
    out_path.write_bytes(header + entries + payloads)


# ──────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────
def main() -> None:
    HERE.mkdir(exist_ok=True)
    rendered: dict[int, Image.Image] = {}
    for size in SIZES:
        img = render(size)
        rendered[size] = img

    # ── Tauri-bundle-expected PNG names ───────────────────────────────
    rendered[32].save(HERE / "32x32.png", "PNG")
    rendered[128].save(HERE / "128x128.png", "PNG")
    rendered[256].save(HERE / "128x128@2x.png", "PNG")
    rendered[512].save(HERE / "icon.png", "PNG")

    # ── Multi-resolution Windows .ico ─────────────────────────────────
    write_multires_ico(HERE / "icon.ico", rendered)

    # ── Apple Silicon .icns is built via iconutil from an iconset/ dir
    #    in a subsequent shell step — we drop the source PNGs the right
    #    naming convention here.
    iconset = HERE / "icon.iconset"
    iconset.mkdir(exist_ok=True)
    for (size, scale, fname) in [
        (16, 1, "icon_16x16.png"),       (16, 2, "icon_16x16@2x.png"),
        (32, 1, "icon_32x32.png"),       (32, 2, "icon_32x32@2x.png"),
        (128, 1, "icon_128x128.png"),    (128, 2, "icon_128x128@2x.png"),
        (256, 1, "icon_256x256.png"),    (256, 2, "icon_256x256@2x.png"),
        (512, 1, "icon_512x512.png"),    (512, 2, "icon_512x512@2x.png"),
    ]:
        target_px = size * scale
        source_px = next((k for k in sorted(rendered) if k >= target_px), max(rendered))
        scaled = rendered[source_px].resize((target_px, target_px), Image.LANCZOS)
        scaled.save(iconset / fname, "PNG")

    print(f"icons: wrote {len(rendered)} PNGs + icon.ico + iconset/ in {HERE}")


if __name__ == "__main__":
    main()
