#!/usr/bin/env python3
"""
Zielkarte art renderer — bakes the instrument artwork as high-fidelity PNGs.

Philosophy: docs/design/zielkarte/PHILOSOPHY.md ("Gilded Instrumentarium").
One light source (upper-left). Real material ramps, thick beveled glass,
minted coins with edge thickness + reeding + relief, poured granulate.
Everything static is baked here; needles/fills/values stay live in RN.

Run:  python3 apps/mobile/scripts/render-zielkarte-art.py [all|coins|gauge|...]
Out:  apps/mobile/assets/images/zielkarte/*.png  (+ a composite proof sheet)
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "images", "zielkarte")
FONTS = "/Users/basel/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/e0dd4060-2771-4493-ae5a-544ef39c1464/83bd55b8-8127-4df4-ab0e-47eba4b924de/skills/canvas-design/canvas-fonts"
os.makedirs(OUT, exist_ok=True)

SS = 2  # supersample factor; render big, downscale LANCZOS

# ── palette ──────────────────────────────────────────────────────────────────
BRASS = [(0.0, (252, 233, 178)), (0.22, (233, 203, 130)), (0.5, (201, 165, 92)),
         (0.78, (138, 109, 47)), (1.0, (49, 36, 12))]
IRON = [(0.0, (146, 152, 161)), (0.45, (66, 71, 79)), (1.0, (14, 16, 19))]
GOLD_FACE = [(0.0, (255, 240, 185)), (0.5, (222, 184, 104)), (1.0, (146, 104, 38))]
SILVER_FACE = [(0.0, (255, 255, 255)), (0.5, (198, 204, 212)), (1.0, (106, 114, 124))]


def lut(stops, n=256):
    arr = np.zeros((n, 3), dtype=np.float32)
    for i in range(n):
        t = i / (n - 1)
        for (p0, c0), (p1, c1) in zip(stops[:-1], stops[1:]):
            if p0 <= t <= p1:
                f = 0 if p1 == p0 else (t - p0) / (p1 - p0)
                arr[i] = [c0[j] + (c1[j] - c0[j]) * f for j in range(3)]
                break
        else:
            arr[i] = stops[-1][1]
    return arr


def field_to_rgba(field, stops, alpha=None):
    """field: HxW floats 0..1 → RGBA image via色 ramp."""
    l = lut(stops)
    idx = np.clip((field * 255), 0, 255).astype(np.uint8)
    rgb = l[idx].astype(np.uint8)
    h, w = field.shape
    a = (np.ones((h, w), dtype=np.uint8) * 255) if alpha is None else alpha
    return Image.fromarray(np.dstack([rgb, a]), "RGBA")


def radial_field(w, h, cx, cy, r, power=1.0):
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2) / max(r, 1)
    return np.clip(d, 0, 1) ** power


def noise(w, h, scale, seed, octaves=3):
    rng = np.random.default_rng(seed)
    acc = np.zeros((h, w), dtype=np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        gw, gh = max(2, int(w / scale / (2 ** o))), max(2, int(h / scale / (2 ** o)))
        g = rng.random((gh, gw)).astype(np.float32)
        layer = np.array(Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), dtype=np.float32) / 255
        acc += layer * amp
        tot += amp
        amp *= 0.5
    return acc / tot


def ellipse_mask(w, h, box):
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).ellipse(box, fill=255)
    return m


def blurred(img, r):
    return img.filter(ImageFilter.GaussianBlur(r))


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def engrave(draw, xy, text, f, bright=(227, 201, 131, 255), dark=(0, 0, 0, 230), anchor="mm", dy=1.4):
    x, y = xy
    draw.text((x, y + dy), text, font=f, fill=dark, anchor=anchor)
    draw.text((x, y), text, font=f, fill=bright, anchor=anchor)


def ring_band(size, cx, cy, r_in, r_out, stops, light_at=225):
    """A torus band shaded along the light axis + radial curvature."""
    w = h = size
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    dx, dy = xs - cx, ys - cy
    d = np.sqrt(dx * dx + dy * dy)
    band = (d >= r_in) & (d <= r_out)
    # curvature across the band: 0 at inner edge → 1 at outer (tube profile)
    t = np.where(band, (d - r_in) / max(r_out - r_in, 1), 0)
    tube = np.abs(t - 0.42) * 2.2  # bright ridge slightly inside
    # light direction: angle to the source dims the far side
    ang = np.degrees(np.arctan2(dy, dx))
    ld = (np.cos(np.radians(ang - light_at)) + 1) / 2  # 1 facing light
    shade = np.clip(0.15 + 0.85 * (0.35 * (1 - tube) + 0.65 * ld), 0, 1)
    field = 1 - shade  # ramp expects 0=lit
    alpha = (band * 255).astype(np.uint8)
    return field_to_rgba(field, stops, alpha)


# ─────────────────────────────────────────────────────────────────────────────
# COIN — minted, thick, reeded, embossed
# ─────────────────────────────────────────────────────────────────────────────

_relief_font_cache = {}


def render_coin(px, metal, rng, tilt=None, with_shadow=True):
    """A coin tile (px × px, supersampled inside). Light from upper-left."""
    S = px * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = S * 0.36
    tilt = tilt if tilt is not None else 0.42 + rng.random() * 0.1
    ry = r * tilt
    th = r * 0.3  # edge thickness
    cx, cy = S / 2, S / 2 - th / 2
    face = SILVER_FACE if metal == "silver" else GOLD_FACE
    edge_dark = (58, 63, 71) if metal == "silver" else (92, 61, 16)
    edge_mid = (122, 129, 138) if metal == "silver" else (150, 108, 40)
    ring_c = (109, 117, 126) if metal == "silver" else (138, 94, 31)
    lip = (255, 255, 255) if metal == "silver" else (255, 243, 201)

    if with_shadow:
        sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse([cx - r * 1.02, cy + th - ry * 0.15, cx + r * 1.02, cy + th + ry * 1.15], fill=(0, 0, 0, 150))
        img = Image.alpha_composite(img, blurred(sh, S * 0.03))
        d = ImageDraw.Draw(img)

    # edge band (thickness) with vertical shading + reeding
    band = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    bd.ellipse([cx - r, cy - ry + th, cx + r, cy + ry + th], fill=edge_mid + (255,))
    grad = field_to_rgba(np.tile(np.linspace(0, 1, S).reshape(S, 1), (1, S)),
                         [(0, edge_mid), (1, edge_dark)])
    band = Image.composite(grad, band, band.split()[3])
    img = Image.alpha_composite(img, band)
    d = ImageDraw.Draw(img)
    for i in range(11):
        a = math.radians(196 + i * 14.8)
        fx, fy = cx + r * math.cos(a), cy + ry * math.sin(a)
        col = lip + (110,) if i % 2 else edge_dark + (230,)
        d.line([(fx, fy + 1), (fx, fy + th - 1)], fill=col, width=max(1, int(S * 0.006)))

    # face: offset radial light
    fld = radial_field(S, S, cx - r * 0.35, cy - ry * 0.4, r * 1.55, power=1.15)
    face_img = field_to_rgba(fld, face, np.array(ellipse_mask(S, S, [cx - r, cy - ry, cx + r, cy + ry])))
    img = Image.alpha_composite(img, face_img)
    d = ImageDraw.Draw(img)

    # rim + embossed inner rings (dark under, light over = relief)
    d.ellipse([cx - r, cy - ry, cx + r, cy + ry], outline=edge_dark + (255,), width=max(1, int(S * 0.008)))
    for rr, off, col, wdt in [
        (0.78, 1.6, (0, 0, 0, 150), 0.007),
        (0.78, -1.2, lip + (170,), 0.005),
        (0.5, 1.4, (0, 0, 0, 120), 0.005),
        (0.5, -1.0, lip + (130,), 0.004),
    ]:
        d.ellipse([cx - r * rr, cy - ry * rr + off * SS, cx + r * rr, cy + ry * rr + off * SS],
                  outline=col, width=max(1, int(S * wdt)))

    # centre relief mark
    key = int(S * 0.16)
    if key not in _relief_font_cache:
        _relief_font_cache[key] = font("CrimsonPro-Bold.ttf", key)
    f = _relief_font_cache[key]
    d.text((cx, cy + 1.8 * SS), "14", font=f, fill=(0, 0, 0, 140), anchor="mm")
    d.text((cx, cy), "14", font=f, fill=ring_c + (210,), anchor="mm")
    d.text((cx - 0.8 * SS, cy - 1.2 * SS), "14", font=f, fill=lip + (90,), anchor="mm")

    # crescent light + specular
    cres = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(cres).arc([cx - r * 0.86, cy - ry * 0.86, cx + r * 0.86, cy + ry * 0.86],
                             start=195, end=285, fill=lip + (220,), width=max(2, int(S * 0.02)))
    img = Image.alpha_composite(img, blurred(cres, S * 0.008))
    spec = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(spec).ellipse([cx - r * 0.52, cy - ry * 0.62, cx - r * 0.2, cy - ry * 0.3], fill=(255, 255, 255, 120))
    img = Image.alpha_composite(img, blurred(spec, S * 0.012))

    rot = (rng.random() - 0.5) * 40
    img = img.rotate(rot, resample=Image.BICUBIC, expand=False)
    return img.resize((px, px), Image.LANCZOS)


def coin_heap(canvas, cx_frac, y_frac, width_frac, metal, seed, rows=3, base_px=None):
    """Paste a hoard of coins onto canvas around the given region."""
    W, H = canvas.size
    rng = np.random.default_rng(seed)
    heap_w = W * width_frac
    base = base_px or int(W * 0.16)
    # pooled ambient occlusion under the hoard
    ao = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(ao).ellipse([W * cx_frac - heap_w / 2, H * y_frac - base * 0.4,
                                W * cx_frac + heap_w / 2, H * y_frac + base * 0.55], fill=(0, 0, 0, 170))
    canvas.alpha_composite(blurred(ao, W * 0.012))
    for row in range(rows):
        depth = row / max(rows - 1, 1)  # 0 back → 1 front
        n = max(4, int((heap_w / (base * 0.62)) * (0.75 + 0.25 * depth)))
        size = int(base * (0.66 + 0.44 * depth))
        yy = H * y_frac - base * 0.5 * (1 - depth) * 2.05
        for i in range(n):
            t = i / max(n - 1, 1)
            px = W * cx_frac - heap_w / 2 + heap_w * t + (rng.random() - 0.5) * base * 0.3
            py = yy - math.sin(t * math.pi) * base * 0.52 + (rng.random() - 0.5) * base * 0.16
            coin = render_coin(size, metal, rng)
            if depth < 1:
                dimmer = Image.new("RGBA", coin.size, (8, 5, 0, int(120 * (1 - depth))))
                coin = Image.alpha_composite(coin, Image.composite(dimmer, Image.new("RGBA", coin.size, (0, 0, 0, 0)), coin.split()[3]))
            canvas.alpha_composite(coin, (int(px - size / 2), int(py - size / 2)))


# ─────────────────────────────────────────────────────────────────────────────
# GAUGE — brass bezel, enamel dial, chapter band, thick beveled crystal
# ─────────────────────────────────────────────────────────────────────────────

GAUGE_W, GAUGE_H = 960, 700  # output px (logical ~160×117 @3x → crisp)
GAUGE_PIVOT = (0.5, 0.70)    # mirrored in RN
GAUGE_R = 0.325              # dial radius as fraction of width


def render_gauge():
    W, H = GAUGE_W * SS, GAUGE_H * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cx, cy = W * GAUGE_PIVOT[0], H * GAUGE_PIVOT[1]
    R = W * GAUGE_R

    # panel shadow of the whole case
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).pieslice([cx - R * 1.16, cy - R * 1.16, cx + R * 1.16, cy + R * 1.16], 175, 365, fill=(0, 0, 0, 190))
    img.alpha_composite(blurred(sh, W * 0.012).transform(img.size, Image.AFFINE, (1, 0, -W * 0.008, 0, 1, W * 0.010)))

    # iron case ring behind bezel
    img.alpha_composite(ring_band(W, cx, cy, R * 1.0, R * 1.15, IRON)[0:H] if False else ring_band(W, cx, cy, R * 1.0, R * 1.15, IRON).crop((0, 0, W, H)))

    # knurl teeth
    d = ImageDraw.Draw(img)
    for i in range(64):
        a = math.radians(168 + i * (204 / 63))
        p1 = (cx + (R * 1.17) * math.cos(a), cy + (R * 1.17) * math.sin(a))
        p2 = (cx + (R * 1.11) * math.cos(a), cy + (R * 1.11) * math.sin(a))
        lit = 200 < math.degrees(a) % 360 < 300
        d.line([p1, p2], fill=(233, 203, 130, 255) if lit else (30, 24, 10, 255), width=max(2, int(W * 0.0032)))

    # brass bezel torus + brushing + speculars
    img.alpha_composite(ring_band(W, cx, cy, R * 0.94, R * 1.12, BRASS).crop((0, 0, W, H)))
    rngb = np.random.default_rng(7)
    br = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bd = ImageDraw.Draw(br)
    for i in range(70):
        rr = R * (0.95 + 0.16 * rngb.random())
        alpha = int(10 + 26 * rngb.random())
        col = (255, 240, 200, alpha) if rngb.random() > 0.5 else (20, 14, 4, alpha)
        bd.arc([cx - rr, cy - rr, cx + rr, cy + rr], 150, 390, fill=col, width=SS)
    img.alpha_composite(br)
    cres = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(cres).arc([cx - R * 1.06, cy - R * 1.06, cx + R * 1.06, cy + R * 1.06], 196, 286,
                             fill=(255, 247, 224, 235), width=max(3, int(W * 0.006)))
    img.alpha_composite(blurred(cres, W * 0.004))
    cool = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(cool).arc([cx - R * 1.05, cy - R * 1.05, cx + R * 1.05, cy + R * 1.05], 20, 90,
                             fill=(125, 147, 168, 90), width=max(3, int(W * 0.005)))
    img.alpha_composite(blurred(cool, W * 0.005))

    # enamel dial
    dial_m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(dial_m).pieslice([cx - R * 0.94, cy - R * 0.94, cx + R * 0.94, cy + R * 0.94], 168, 372, fill=255)
    fld = radial_field(W, H, cx - R * 0.3, cy - R * 0.5, R * 1.8, power=1.3)
    enamel = field_to_rgba(fld, [(0, (46, 41, 33)), (0.55, (24, 20, 15)), (1, (7, 5, 3))], np.array(dial_m))
    img.alpha_composite(enamel)
    d = ImageDraw.Draw(img)
    for gr in (0.62, 0.56):
        d.arc([cx - R * gr, cy - R * gr, cx + R * gr, cy + R * gr], 180, 360, fill=(0, 0, 0, 160), width=SS)
        d.arc([cx - R * gr + SS, cy - R * gr + SS, cx + R * gr + SS, cy + R * gr + SS], 180, 360, fill=(120, 104, 74, 60), width=SS)

    # chapter band: enamel colours + struck graduations
    band_r0, band_r1 = R * 0.72, R * 0.86
    for i in range(120):
        f = i / 119
        a0 = 180 + f * 180
        seg = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        col = (195, 59, 36) if f < 0.34 else ((224, 165, 46) if f < 0.66 else (63, 174, 78))
        ImageDraw.Draw(seg).arc([cx - band_r0 - (band_r1 - band_r0) / 2] * 0 or
                                [cx - (band_r0 + band_r1) / 2, cy - (band_r0 + band_r1) / 2,
                                 cx + (band_r0 + band_r1) / 2, cy + (band_r0 + band_r1) / 2],
                                a0, a0 + 1.9, fill=col + (255,), width=int(band_r1 - band_r0))
        img.alpha_composite(seg)
    d = ImageDraw.Draw(img)
    # bevel edges of the band channel
    d.arc([cx - band_r1, cy - band_r1, cx + band_r1, cy + band_r1], 180, 360, fill=(0, 0, 0, 190), width=2 * SS)
    d.arc([cx - band_r0, cy - band_r0, cx + band_r0, cy + band_r0], 180, 360, fill=(255, 244, 214, 70), width=SS)
    for i in range(51):
        a = math.radians(180 + i * 3.6)
        major = i % 5 == 0
        r_a = band_r1 + (R * 0.02)
        r_b = band_r0 - (R * (0.05 if major else 0.015))
        p1 = (cx + r_a * math.cos(a), cy + r_a * math.sin(a))
        p2 = (cx + r_b * math.cos(a), cy + r_b * math.sin(a))
        d.line([p1, p2], fill=(12, 9, 5, 235), width=(3 if major else 2) * SS // 2 + SS)
    # engraved figures
    ff = font("CrimsonPro-Bold.ttf", int(R * 0.13))
    for val, adeg in [("0", 187), ("25", 225), ("50", 270), ("75", 315), ("100", 353)]:
        a = math.radians(adeg)
        tx, ty = cx + (R * 0.6) * math.cos(a), cy + (R * 0.6) * math.sin(a)
        engrave(d, (tx, ty), val, ff, bright=(224, 199, 133, 255))
    fm = font("CrimsonPro-Bold.ttf", int(R * 0.085))
    engrave(d, (cx, cy - R * 0.24), "W-14", fm, bright=(150, 128, 82, 255))

    # jewel hub seat (needle itself is live)
    d.ellipse([cx - R * 0.10, cy - R * 0.10, cx + R * 0.10, cy + R * 0.10], fill=(23, 17, 6, 255))
    hub = ring_band(W, cx, cy, 0, R * 0.085, BRASS).crop((0, 0, W, H))
    img.alpha_composite(hub)
    d.ellipse([cx - R * 0.028, cy - R * 0.028, cx + R * 0.028, cy + R * 0.028], fill=(150, 34, 20, 255))
    d.ellipse([cx - R * 0.016, cy - R * 0.020, cx, cy], fill=(255, 200, 185, 220))

    # THICK BEVELED CRYSTAL over everything
    glass = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glass)
    gd.pieslice([cx - R * 0.93, cy - R * 0.93, cx + R * 0.93, cy + R * 0.93], 168, 372, fill=(210, 230, 255, 10))
    sheen = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sheen).ellipse([cx - R * 0.78, cy - R * 0.95, cx + R * 0.05, cy - R * 0.25], fill=(255, 255, 255, 46))
    glass.alpha_composite(blurred(sheen, W * 0.014))
    streak = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(streak).arc([cx - R * 0.8, cy - R * 0.8, cx + R * 0.8, cy + R * 0.8], 208, 250, fill=(255, 255, 255, 120), width=int(R * 0.05))
    glass.alpha_composite(blurred(streak, W * 0.006))
    refr = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(refr).arc([cx - R * 0.9, cy - R * 0.9, cx + R * 0.9, cy + R * 0.9], 20, 120, fill=(190, 220, 255, 60), width=3 * SS)
    glass.alpha_composite(blurred(refr, W * 0.004))
    img.alpha_composite(glass)

    # mounting tabs + slotted screws + hex boss
    for sx, dim in [(cx - R * 1.24, False), (cx + R * 1.24, True)]:
        tab = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(tab).rounded_rectangle([sx - W * 0.02, cy - W * 0.018, sx + W * 0.02, cy + W * 0.018], W * 0.006, fill=(58, 63, 71, 255), outline=(10, 11, 13, 255), width=SS)
        img.alpha_composite(tab)
        scr(img, sx, cy, W * 0.011, dim)
    hexb = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hexb)
    pts = [(cx + R * 0.14 * math.cos(math.radians(i * 60 - 90)), (cy - R * 1.2) + R * 0.14 * math.sin(math.radians(i * 60 - 90))) for i in range(6)]
    hd.polygon(pts, fill=(70, 76, 84, 255), outline=(12, 13, 15, 255))
    hd.polygon([(p[0] * 0.9992, p[1] - R * 0.012) for p in pts[:3]] + [pts[3]], fill=(150, 156, 165, 90))
    img.alpha_composite(hexb)

    return img.resize((GAUGE_W, GAUGE_H), Image.LANCZOS)


def scr(img, x, y, r, dim=False):
    d = ImageDraw.Draw(img)
    d.ellipse([x - r, y - r, x + r, y + r], fill=(148, 154, 163, 255) if not dim else (96, 102, 110, 255), outline=(10, 11, 13, 255), width=max(1, int(r * 0.14)))
    a = np.random.default_rng(int(x + y)).random() * math.pi
    d.line([(x - r * 0.7 * math.cos(a), y - r * 0.7 * math.sin(a)), (x + r * 0.7 * math.cos(a), y + r * 0.7 * math.sin(a))], fill=(15, 16, 18, 255), width=max(1, int(r * 0.3)))
    d.ellipse([x - r * 0.45, y - r * 0.5, x - r * 0.05, y - r * 0.1], fill=(255, 255, 255, 110))


# ─────────────────────────────────────────────────────────────────────────────
# PORTHOLE — hammered iron ring, washered bolts, brass hinge/latch, deep well
# ─────────────────────────────────────────────────────────────────────────────

PORT_W, PORT_H = 900, 760
PORT_C = (0.5, 0.5)
PORT_R = 0.215  # well radius fraction of width; segments live in RN around it


def render_porthole():
    W, H = PORT_W * SS, PORT_H * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cx, cy = W * PORT_C[0], H * PORT_C[1]
    R = W * PORT_R

    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([cx - R * 1.5, cy - R * 1.5, cx + R * 1.5, cy + R * 1.55], fill=(0, 0, 0, 200))
    img.alpha_composite(blurred(sh, W * 0.014).transform(img.size, Image.AFFINE, (1, 0, -W * 0.006, 0, 1, W * 0.012)))

    # brass hinge left (двух knuckles) + latch right, UNDER the ring
    hy = cy
    hinge = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hinge)
    hd.rounded_rectangle([cx - R * 1.85, hy - R * 0.42, cx - R * 1.32, hy + R * 0.42], W * 0.008, fill=(160, 128, 66, 255), outline=(40, 30, 10, 255), width=SS)
    for ky in (hy - R * 0.24, hy + R * 0.08):
        hd.rounded_rectangle([cx - R * 1.48, ky, cx - R * 1.18, ky + R * 0.17], W * 0.006, fill=(190, 155, 84, 255), outline=(40, 30, 10, 255), width=SS)
        hd.line([(cx - R * 1.46, ky + SS), (cx - R * 1.2, ky + SS)], fill=(255, 240, 200, 190), width=SS)
    grad = field_to_rgba(np.tile(np.linspace(0, 1, H).reshape(H, 1), (1, W)), [(0, (250, 226, 158)), (0.5, (176, 140, 70)), (1, (66, 49, 18))])
    hinge = Image.composite(grad, hinge, hinge.split()[3])
    img.alpha_composite(hinge)
    latch = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(latch)
    ld.rounded_rectangle([cx + R * 1.3, hy - R * 0.2, cx + R * 1.72, hy + R * 0.2], W * 0.008, fill=(176, 140, 70, 255), outline=(40, 30, 10, 255), width=SS)
    ld.rounded_rectangle([cx + R * 1.42, hy + R * 0.14, cx + R * 1.6, hy + R * 0.62], W * 0.008, fill=(176, 140, 70, 255), outline=(40, 30, 10, 255), width=SS)
    latch = Image.composite(grad, latch, latch.split()[3])
    img.alpha_composite(latch)
    d = ImageDraw.Draw(img)
    d.line([(cx + R * 1.32, hy - R * 0.17), (cx + R * 1.7, hy - R * 0.17)], fill=(255, 240, 200, 170), width=SS)

    # hammered iron ring: base band + noise dents + speculars
    ring = ring_band(W, cx, cy, R * 1.06, R * 1.5, IRON).crop((0, 0, W, H))
    img.alpha_composite(ring)
    nz = noise(W, H, 13, 21, octaves=2)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    dd = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2)
    band = ((dd > R * 1.06) & (dd < R * 1.5)).astype(np.float32)
    dents_a = (np.clip(nz - 0.58, 0, 1) * 2.2 * band * 85).astype(np.uint8)
    dents_l = (np.clip(0.4 - nz, 0, 1) * 2.2 * band * 50).astype(np.uint8)
    img.alpha_composite(Image.fromarray(np.dstack([np.zeros((H, W, 3), dtype=np.uint8), dents_a])))
    lightm = np.dstack([np.full((H, W), 255, dtype=np.uint8), np.full((H, W), 240, dtype=np.uint8), np.full((H, W), 205, dtype=np.uint8), dents_l])
    img.alpha_composite(Image.fromarray(lightm))
    cres = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(cres).arc([cx - R * 1.44, cy - R * 1.44, cx + R * 1.44, cy + R * 1.44], 196, 288, fill=(214, 222, 232, 200), width=max(3, int(W * 0.006)))
    img.alpha_composite(blurred(cres, W * 0.005))

    # washered dome bolts
    for i in range(10):
        a = math.radians(i * 36 - 90)
        bx, by = cx + R * 1.28 * math.cos(a), cy + R * 1.28 * math.sin(a)
        dim = 0 < math.degrees(a) < 180
        r0 = W * 0.016
        d.ellipse([bx - r0 * 1.5, by - r0 * 1.5, bx + r0 * 1.5, by + r0 * 1.5], outline=(8, 9, 11, 220), width=SS)
        d.ellipse([bx - r0 * 1.35, by - r0 * 1.35, bx + r0 * 1.35, by + r0 * 1.35], outline=(150, 156, 165, 90), width=SS)
        sb = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sb).ellipse([bx - r0 + r0 * 0.4, by - r0 + r0 * 0.5, bx + r0 + r0 * 0.4, by + r0 + r0 * 0.5], fill=(0, 0, 0, 160))
        img.alpha_composite(blurred(sb, W * 0.003))
        d = ImageDraw.Draw(img)
        fldb = radial_field(W, H, bx - r0 * 0.4, by - r0 * 0.45, r0 * 1.9)
        boltimg = field_to_rgba(fldb, IRON if dim else [(0, (208, 213, 220)), (0.5, (96, 102, 110)), (1, (16, 18, 21))],
                                np.array(ellipse_mask(W, H, [bx - r0, by - r0, bx + r0, by + r0])))
        img.alpha_composite(boltimg)
        d.ellipse([bx - r0 * 0.42, by - r0 * 0.5, bx - r0 * 0.02, by - r0 * 0.1], fill=(255, 255, 255, 150 if not dim else 70))

    # groove channel where the LIVE segment ring sits (RN draws segments)
    d.arc([cx - R * 0.99, cy - R * 0.99, cx + R * 0.99, cy + R * 0.99], 0, 360, fill=(5, 4, 2, 255), width=int(R * 0.17))
    d.arc([cx - R * 1.08, cy - R * 1.08, cx + R * 1.08, cy + R * 1.08], 0, 360, fill=(0, 0, 0, 200), width=2 * SS)
    d.arc([cx - R * 0.9, cy - R * 0.9, cx + R * 0.9, cy + R * 0.9], 0, 360, fill=(120, 104, 74, 60), width=SS)

    # deep well + glass
    fldw = radial_field(W, H, cx - R * 0.25, cy - R * 0.3, R * 1.35, power=1.2)
    well = field_to_rgba(fldw, [(0, (40, 36, 28)), (0.6, (18, 15, 10)), (1, (4, 3, 2))], np.array(ellipse_mask(W, H, [cx - R * 0.86, cy - R * 0.86, cx + R * 0.86, cy + R * 0.86])))
    img.alpha_composite(well)
    d = ImageDraw.Draw(img)
    d.arc([cx - R * 0.84, cy - R * 0.84, cx + R * 0.84, cy + R * 0.84], 190, 300, fill=(0, 0, 0, 200), width=3 * SS)
    sheen = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sheen).ellipse([cx - R * 0.62, cy - R * 0.72, cx - R * 0.02, cy - R * 0.22], fill=(255, 255, 255, 34))
    img.alpha_composite(blurred(sheen, W * 0.012))
    refr = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(refr).arc([cx - R * 0.8, cy - R * 0.8, cx + R * 0.8, cy + R * 0.8], 25, 95, fill=(150, 190, 220, 60), width=3 * SS)
    img.alpha_composite(blurred(refr, W * 0.005))

    return img.resize((PORT_W, PORT_H), Image.LANCZOS)


# ─────────────────────────────────────────────────────────────────────────────
# THERMOMETER — walnut board, brass plate seat, silver tube, red bulb, scale
# ─────────────────────────────────────────────────────────────────────────────

TH_W, TH_H = 960, 700
TH_TUBE_X = 0.615          # tube centre x fraction (mirrored in RN)
TH_TUBE_TOP = 0.115
TH_TUBE_BOT = 0.66
TH_PLATE = (0.045, 0.28, 0.44, 0.30)  # x,y,w,h fractions where RN puts values


def render_thermo():
    W, H = TH_W * SS, TH_H * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # walnut backboard with grain + carved edge
    bx0, by0, bx1, by1 = W * 0.02, H * 0.03, W * 0.98, H * 0.97
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([bx0 + W * 0.012, by0 + H * 0.02, bx1 + W * 0.012, by1 + H * 0.02], W * 0.03, fill=(0, 0, 0, 190))
    img.alpha_composite(blurred(sh, W * 0.012))
    # VERTICAL grain on the backboard (stretched noise → striations)
    coarse = np.array(Image.fromarray((noise(max(2, W // 4), max(2, H // 50), 2, 3, 2) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC).rotate(90, expand=False), dtype=np.float32) / 255
    fine = np.array(Image.fromarray((noise(max(2, W // 60), max(2, H // 3), 2, 5, 1) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), dtype=np.float32) / 255
    fieldw = np.clip(0.22 + 0.55 * fine + 0.23 * coarse, 0, 1)
    wood = field_to_rgba(fieldw, [(0, (112, 82, 44)), (0.5, (64, 45, 22)), (1, (28, 18, 8))])
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle([bx0, by0, bx1, by1], W * 0.03, fill=255)
    img.alpha_composite(Image.composite(wood, Image.new("RGBA", (W, H), (0, 0, 0, 0)), mask))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([bx0, by0, bx1, by1], W * 0.03, outline=(16, 11, 5, 255), width=2 * SS)
    d.rounded_rectangle([bx0 + 3 * SS, by0 + 3 * SS, bx1 - 3 * SS, by1 - 3 * SS], W * 0.028, outline=(140, 104, 58, 120), width=SS)
    for sx, sy, dim in [(bx0 + W * 0.045, by0 + H * 0.07, False), (bx1 - W * 0.045, by0 + H * 0.07, True),
                        (bx0 + W * 0.045, by1 - H * 0.07, False), (bx1 - W * 0.045, by1 - H * 0.07, True)]:
        scr(img, sx, sy, W * 0.014, dim)
        d = ImageDraw.Draw(img)

    # brass plate seat (RN engraves the value over it)
    px0, py0 = W * TH_PLATE[0], H * TH_PLATE[1]
    px1, py1 = px0 + W * TH_PLATE[2], py0 + H * TH_PLATE[3]
    psh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(psh).rounded_rectangle([px0 + W * 0.008, py0 + W * 0.010, px1 + W * 0.008, py1 + W * 0.010], W * 0.012, fill=(0, 0, 0, 200))
    img.alpha_composite(blurred(psh, W * 0.008))
    plate = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(plate).rounded_rectangle([px0, py0, px1, py1], W * 0.012, fill=(255, 255, 255, 255))
    pgrad = field_to_rgba(np.tile(np.linspace(0, 1, H).reshape(H, 1), (1, W)), BRASS)
    img.alpha_composite(Image.composite(pgrad, Image.new("RGBA", (W, H), (0, 0, 0, 0)), plate.split()[3]))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([px0, py0, px1, py1], W * 0.012, outline=(40, 30, 10, 255), width=SS)
    d.rounded_rectangle([px0 + 4 * SS, py0 + 4 * SS, px1 - 4 * SS, py1 - 4 * SS], W * 0.01, fill=(13, 11, 8, 255), outline=(0, 0, 0, 200), width=SS)
    d.line([(px0 + 3 * SS, py0 + 2 * SS), (px1 - 3 * SS, py0 + 2 * SS)], fill=(255, 240, 200, 200), width=SS)
    scr(img, px0 + W * 0.02, (py0 + py1) / 2, W * 0.011)
    scr(img, px1 - W * 0.02, (py0 + py1) / 2, W * 0.011, True)

    # glass tube (silver empty) + brass clips; mercury stays live in RN
    tx = W * TH_TUBE_X
    ty0, ty1 = H * TH_TUBE_TOP, H * TH_TUBE_BOT
    tw = W * 0.045
    d = ImageDraw.Draw(img)
    tsh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(tsh).rounded_rectangle([tx - tw / 2 + W * 0.006, ty0 + W * 0.008, tx + tw / 2 + W * 0.006, ty1 + W * 0.008], tw / 2, fill=(0, 0, 0, 170))
    img.alpha_composite(blurred(tsh, W * 0.006))
    tube_fld = np.tile(np.linspace(0, 1, W).reshape(1, W), (H, 1))
    tube_fld = np.abs(tube_fld - (tx / W)) / (tw / W / 2)
    tube_fld = np.clip(tube_fld, 0, 1) ** 1.4
    tmask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(tmask).rounded_rectangle([tx - tw / 2, ty0, tx + tw / 2, ty1], tw / 2, fill=255)
    tube = field_to_rgba(1 - tube_fld, [(0, (58, 63, 71)), (0.4, (188, 194, 202)), (0.75, (246, 248, 251)), (1, (120, 126, 134))], np.array(tmask))
    img.alpha_composite(tube)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([tx - tw / 2, ty0, tx + tw / 2, ty1], tw / 2, outline=(60, 66, 74, 255), width=SS)
    d.line([(tx - tw * 0.26, ty0 + tw * 0.4), (tx - tw * 0.26, ty1 - tw * 0.4)], fill=(255, 255, 255, 190), width=2 * SS)
    for cyy in (ty0 + (ty1 - ty0) * 0.16, ty0 + (ty1 - ty0) * 0.78):
        clip = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(clip).rounded_rectangle([tx - tw * 1.1, cyy, tx + tw * 1.1, cyy + H * 0.035], W * 0.01, fill=(255, 255, 255, 255))
        img.alpha_composite(Image.composite(pgrad, Image.new("RGBA", (W, H), (0, 0, 0, 0)), clip.split()[3]))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([tx - tw * 1.1, cyy, tx + tw * 1.1, cyy + H * 0.035], W * 0.01, outline=(40, 30, 10, 255), width=SS)
        d.line([(tx - tw, cyy + 2 * SS), (tx + tw, cyy + 2 * SS)], fill=(255, 240, 200, 190), width=SS)

    # bulb: dark glass sphere of liquid — deep ramp, occlusion, twin speculars
    bcx, bcy, br = tx, ty1 + H * 0.075, W * 0.052
    bsh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(bsh).ellipse([bcx - br, bcy - br + W * 0.012, bcx + br, bcy + br + W * 0.012], fill=(0, 0, 0, 200))
    img.alpha_composite(blurred(bsh, W * 0.01))
    fldb = radial_field(W, H, bcx - br * 0.42, bcy - br * 0.48, br * 2.0, power=1.35)
    bulb = field_to_rgba(fldb, [(0, (250, 112, 84)), (0.4, (196, 48, 28)), (0.75, (112, 22, 10)), (1, (38, 7, 3))],
                         np.array(ellipse_mask(W, H, [bcx - br, bcy - br, bcx + br, bcy + br])))
    img.alpha_composite(bulb)
    d = ImageDraw.Draw(img)
    d.ellipse([bcx - br, bcy - br, bcx + br, bcy + br], outline=(46, 16, 8, 255), width=SS)
    occl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(occl).arc([bcx - br * 0.86, bcy - br * 0.86, bcx + br * 0.86, bcy + br * 0.86], 20, 150, fill=(20, 4, 2, 200), width=int(br * 0.22))
    img.alpha_composite(blurred(occl, W * 0.005))
    # neck shadow where the tube enters
    neck = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(neck).ellipse([bcx - tw * 0.7, bcy - br * 1.06, bcx + tw * 0.7, bcy - br * 0.72], fill=(0, 0, 0, 150))
    img.alpha_composite(blurred(neck, W * 0.004))
    spec = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd2 = ImageDraw.Draw(spec)
    sd2.ellipse([bcx - br * 0.58, bcy - br * 0.64, bcx - br * 0.22, bcy - br * 0.26], fill=(255, 235, 225, 210))
    sd2.ellipse([bcx + br * 0.1, bcy - br * 0.55, bcx + br * 0.26, bcy - br * 0.38], fill=(255, 220, 208, 90))
    img.alpha_composite(blurred(spec, W * 0.004))

    # right scale: brass bracket + engraved figures
    sx = tx + tw * 1.7
    d = ImageDraw.Draw(img)
    d.line([(sx, ty0), (sx, ty1)], fill=(138, 109, 47, 255), width=2 * SS)
    ff = font("CrimsonPro-Bold.ttf", int(W * 0.036))
    for i, p in enumerate([0, 25, 50, 75, 100]):
        yy = ty1 - (ty1 - ty0) * p / 100
        d.line([(sx - W * 0.014, yy), (sx + W * 0.014, yy)], fill=(201, 165, 92, 255), width=2 * SS)
        d.line([(sx - W * 0.014, yy + SS), (sx + W * 0.014, yy + SS)], fill=(0, 0, 0, 160), width=SS)
        engrave(d, (sx + W * 0.055, yy), f"{p}", ff, bright=(224, 199, 133, 255))
    for p in (12.5, 37.5, 62.5, 87.5):
        yy = ty1 - (ty1 - ty0) * p / 100
        d.line([(sx - W * 0.008, yy), (sx + W * 0.008, yy)], fill=(138, 109, 47, 220), width=SS)

    return img.resize((TH_W, TH_H), Image.LANCZOS)


# ─────────────────────────────────────────────────────────────────────────────
# TANKS — glass cylinder, poured granulate (nuggets / pebbles), caps
# ─────────────────────────────────────────────────────────────────────────────

TANK_W, TANK_H = 960, 560
TANK_BODY = (0.10, 0.16, 0.80, 0.52)  # x,y,w,h fractions — RN cover aligns to this


def pebble_sprite(px, seed):
    """A silver granule: a properly SHADED sphere (radial light, soft ground
    shadow inside the tile) — no cartoon arcs."""
    S = px * 3
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    rng = np.random.default_rng(seed)
    r = S * 0.36
    sq = 0.86 + rng.random() * 0.2
    cx, cy = S / 2, S / 2 - r * 0.08
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([cx - r * 0.95, cy + r * sq * 0.45, cx + r * 0.95, cy + r * sq * 1.15], fill=(0, 0, 0, 130))
    img.alpha_composite(blurred(sh, S * 0.05))
    fld = radial_field(S, S, cx - r * 0.38, cy - r * sq * 0.42, r * 1.75, power=1.25)
    sphere = field_to_rgba(fld, [(0, (255, 255, 255)), (0.42, (206, 212, 219)), (0.78, (128, 136, 145)), (1, (54, 60, 68))],
                           np.array(ellipse_mask(S, S, [cx - r, cy - r * sq, cx + r, cy + r * sq])))
    img.alpha_composite(sphere)
    d = ImageDraw.Draw(img)
    d.ellipse([cx - r, cy - r * sq, cx + r, cy + r * sq], outline=(70, 77, 85, 200), width=max(1, S // 90))
    d.ellipse([cx - r * 0.5, cy - r * sq * 0.55, cx - r * 0.2, cy - r * sq * 0.26], fill=(255, 255, 255, 235))
    d.ellipse([cx + r * 0.1, cy - r * sq * 0.6, cx + r * 0.28, cy - r * sq * 0.42], fill=(255, 255, 255, 90))
    return img.rotate(rng.random() * 360, resample=Image.BICUBIC).resize((px, px), Image.LANCZOS)


def nugget_sprite(px, seed):
    """A faceted gold grain with its own soft contact shadow."""
    S = px * 3
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    rng = np.random.default_rng(seed)
    r = S * 0.34
    cx, cy = S / 2, S / 2 - r * 0.06
    pts = []
    for i in range(7):
        a = math.radians(i * (360 / 7) + rng.random() * 24 - 12)
        rr = r * (0.72 + rng.random() * 0.5)
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([cx - r, cy + r * 0.4, cx + r, cy + r * 1.15], fill=(0, 0, 0, 140))
    img.alpha_composite(blurred(sh, S * 0.05))
    body = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    bd.polygon(pts, fill=(255, 255, 255, 255))
    fld = radial_field(S, S, cx - r * 0.4, cy - r * 0.45, r * 1.9, power=1.1)
    shaded = field_to_rgba(fld, GOLD_FACE, np.array(body.split()[3]))
    img.alpha_composite(shaded)
    d = ImageDraw.Draw(img)
    d.polygon(pts, outline=(104, 70, 17, 230))
    d.polygon([pts[4], pts[5], (cx, cy)], fill=(255, 243, 201, 120))
    d.polygon([pts[0], pts[1], (cx, cy)], fill=(80, 52, 12, 120))
    d.line([pts[2], (cx, cy)], fill=(70, 46, 10, 90), width=max(1, S // 110))
    d.ellipse([cx - r * 0.4, cy - r * 0.5, cx - r * 0.16, cy - r * 0.26], fill=(255, 255, 255, 200))
    return img.rotate(rng.random() * 360, resample=Image.BICUBIC).resize((px, px), Image.LANCZOS)


def render_tank(metal):
    W, H = TANK_W * SS, TANK_H * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gold = metal == "gold"
    x0, y0 = W * TANK_BODY[0], H * TANK_BODY[1]
    bw, bh = W * TANK_BODY[2], H * TANK_BODY[3]
    x1, y1 = x0 + bw, y0 + bh
    cy = (y0 + y1) / 2
    rng = np.random.default_rng(91 if gold else 92)

    # caustic pool + contact shadow
    pool = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(pool).ellipse([x0 + bw * 0.06, y1 + H * 0.02, x1 - bw * 0.06, y1 + H * 0.16],
                                 fill=((232, 180, 95, 70) if gold else (174, 185, 198, 60)))
    img.alpha_composite(blurred(pool, W * 0.02))
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([x0, y1 - H * 0.02, x1, y1 + H * 0.09], fill=(0, 0, 0, 200))
    img.alpha_composite(blurred(sh, W * 0.012))

    # glass interior (dark)
    body = Image.new("L", (W, H), 0)
    ImageDraw.Draw(body).rounded_rectangle([x0, y0, x1, y1], bh / 2, fill=255)
    fld = np.tile(np.linspace(0, 1, H).reshape(H, 1), (1, W))
    interior = field_to_rgba(fld, [(0, (60, 66, 74)), (0.42, (26, 30, 36)), (1, (8, 10, 13))], np.array(body))
    img.alpha_composite(interior)

    # granulate heap — pre-shaded sprites packed in five mounded rows
    heap = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bed = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(bed).rounded_rectangle([x0 + bw * 0.02, y1 - bh * 0.5, x1 - bw * 0.02, y1 - bh * 0.04], bh * 0.18, fill=(0, 0, 0, 160))
    img.alpha_composite(blurred(bed, W * 0.008))
    rows = [
        (y1 - bh * 0.62, 0.058, 15, 0.16, 90),
        (y1 - bh * 0.50, 0.062, 17, 0.11, 55),
        (y1 - bh * 0.38, 0.066, 18, 0.07, 30),
        (y1 - bh * 0.24, 0.070, 19, 0.03, 10),
        (y1 - bh * 0.11, 0.072, 20, 0.0, 0),
    ]
    for ri, (ry, grf, n, amp, dimm) in enumerate(rows):
        for i in range(n):
            t = i / (n - 1)
            gx = x0 + bw * 0.045 + (bw * 0.91) * t + (rng.random() - 0.5) * bw * 0.018
            gy = ry - math.sin(min(1, t * 1.3) * math.pi) * bh * amp + (rng.random() - 0.5) * bh * 0.025
            gpx = max(10, int(H * grf * (0.85 + rng.random() * 0.35)))
            sp = nugget_sprite(gpx * 2, int(rng.integers(1, 1e9))) if gold else pebble_sprite(gpx * 2, int(rng.integers(1, 1e9)))
            if dimm:
                dk = Image.new("RGBA", sp.size, (5, 4, 8, dimm))
                sp = Image.alpha_composite(sp, Image.composite(dk, Image.new("RGBA", sp.size, (0, 0, 0, 0)), sp.split()[3]))
            heap.alpha_composite(sp, (int(gx - gpx), int(gy - gpx)))
    img.alpha_composite(Image.composite(heap, Image.new("RGBA", (W, H), (0, 0, 0, 0)), body))

    # glass overlays ABOVE granulate
    d = ImageDraw.Draw(img)
    sheen = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    sd.ellipse([x0 + bw * 0.05, y0 + bh * 0.04, x1 - bw * 0.3, y0 + bh * 0.3], fill=(255, 255, 255, 46))
    img.alpha_composite(blurred(sheen, W * 0.014))
    streak = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(streak).line([(x0 + bw * 0.12, y0 + bh * 0.16), (x0 + bw * 0.42, y0 + bh * 0.1)], fill=(255, 255, 255, 130), width=int(bh * 0.05))
    img.alpha_composite(blurred(streak, W * 0.006))
    d.rounded_rectangle([x0, y0, x1, y1], bh / 2, outline=(15, 18, 22, 255), width=2 * SS)
    d.line([(x0 + bw * 0.06, y1 - 3 * SS), (x1 - bw * 0.06, y1 - 3 * SS)], fill=(0, 0, 0, 170), width=3 * SS)

    # end caps
    capg = BRASS if gold else [(0.0, (188, 194, 203)), (0.5, (96, 103, 112)), (1.0, (26, 29, 34))]
    for ex, dim in [(x0, False), (x1, True)]:
        csh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(csh).ellipse([ex - bw * 0.045 + W * 0.006, cy - bh * 0.58 + W * 0.008, ex + bw * 0.045 + W * 0.006, cy + bh * 0.58 + W * 0.008], fill=(0, 0, 0, 190))
        img.alpha_composite(blurred(csh, W * 0.008))
        fldc = radial_field(W, H, ex - bw * 0.02, cy - bh * 0.28, bh * 0.95)
        cap = field_to_rgba(fldc, capg, np.array(ellipse_mask(W, H, [ex - bw * 0.045, cy - bh * 0.58, ex + bw * 0.045, cy + bh * 0.58])))
        img.alpha_composite(cap)
        d = ImageDraw.Draw(img)
        d.ellipse([ex - bw * 0.045, cy - bh * 0.58, ex + bw * 0.045, cy + bh * 0.58], outline=(20, 15, 5, 255) if gold else (8, 9, 11, 255), width=2 * SS)
        d.ellipse([ex - bw * 0.028, cy - bh * 0.44, ex + bw * 0.028, cy + bh * 0.44], outline=(0, 0, 0, 130), width=SS)
        for j, ry in enumerate([cy - bh * 0.34, cy, cy + bh * 0.34]):
            rv = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            rr = W * 0.009
            fldr = radial_field(W, H, ex - rr * 0.4, ry - rr * 0.45, rr * 2)
            rvi = field_to_rgba(fldr, capg, np.array(ellipse_mask(W, H, [ex - rr, ry - rr, ex + rr, ry + rr])))
            img.alpha_composite(rvi)
            d.ellipse([ex - rr * 0.5, ry - rr * 0.55, ex - rr * 0.1, ry - rr * 0.15], fill=(255, 255, 255, 90 if dim else 160))

    return img.resize((TANK_W, TANK_H), Image.LANCZOS)


# ─────────────────────────────────────────────────────────────────────────────
# CHEST — open lined lid on hinge arms, coin hoard, straps, slot seat
# ─────────────────────────────────────────────────────────────────────────────

CH_W, CH_H = 960, 760
CH_SLOT = (0.185, 0.565, 0.63, 0.075)   # live fill bar rect (fractions)
CH_PLATES_Y = 0.70                       # RN plates row


def render_chest(metal):
    W, H = CH_W * SS, CH_H * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gold = metal == "gold"
    cx = W / 2
    bodyW = W * 0.74
    x0 = cx - bodyW / 2
    x1 = cx + bodyW / 2
    mouthY = H * 0.44
    bodyH = H * 0.42
    rng = np.random.default_rng(55 if gold else 56)

    # ground shadow
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([x0 - W * 0.02, mouthY + bodyH - H * 0.02, x1 + W * 0.02, mouthY + bodyH + H * 0.07], fill=(0, 0, 0, 210))
    img.alpha_composite(blurred(sh, W * 0.014))

    def plank_grain(seed):
        # HORIZONTAL grain: coarse noise stretched wide + fine streaks
        coarse = np.array(Image.fromarray((noise(max(2, W // 60), max(2, H // 4), 2, seed, 2) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), dtype=np.float32) / 255
        fine = np.array(Image.fromarray((noise(max(2, W // 6), max(2, H // 40), 2, seed + 3, 1) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), dtype=np.float32) / 255
        return np.clip(0.2 + 0.55 * coarse + 0.25 * fine, 0, 1)

    wood_img = field_to_rgba(plank_grain(11), [(0, (118, 87, 47)), (0.5, (66, 47, 22)), (1, (26, 17, 7))])
    lidwood = field_to_rgba(plank_grain(17), [(0, (126, 94, 52)), (0.5, (74, 53, 26)), (1, (30, 20, 8))])

    # OPEN LID (outer shell tilted back) + deep lining
    lid_out = Image.new("L", (W, H), 0)
    lod = ImageDraw.Draw(lid_out)
    lod.polygon([(x0 + bodyW * 0.02, mouthY - H * 0.205), (x0 + bodyW * 0.07, mouthY - H * 0.315),
                 (x1 - bodyW * 0.07, mouthY - H * 0.315), (x1 - bodyW * 0.02, mouthY - H * 0.205)], fill=255)
    img.alpha_composite(Image.composite(lidwood, Image.new("RGBA", (W, H), (0, 0, 0, 0)), lid_out))
    d = ImageDraw.Draw(img)
    d.polygon([(x0 + bodyW * 0.02, mouthY - H * 0.205), (x0 + bodyW * 0.07, mouthY - H * 0.315),
               (x1 - bodyW * 0.07, mouthY - H * 0.315), (x1 - bodyW * 0.02, mouthY - H * 0.205)], outline=(20, 13, 5, 255), width=2 * SS)
    lining = Image.new("L", (W, H), 0)
    ImageDraw.Draw(lining).polygon([(x0 + bodyW * 0.05, mouthY - H * 0.21), (x0 + bodyW * 0.1, mouthY - H * 0.3),
                                    (x1 - bodyW * 0.1, mouthY - H * 0.3), (x1 - bodyW * 0.05, mouthY - H * 0.21)], fill=255)
    linfld = np.clip(0.3 + 0.5 * noise(W, H, 22, 31, 3), 0, 1)
    lin_img = field_to_rgba(linfld, [(0, (96, 30, 26)), (0.5, (62, 18, 16)), (1, (30, 8, 7))], np.array(lining))
    img.alpha_composite(lin_img)
    d = ImageDraw.Draw(img)
    for f in (0.28, 0.5, 0.72):
        lx = x0 + bodyW * f
        d.line([(lx, mouthY - H * 0.295), (lx, mouthY - H * 0.215)], fill=(20, 6, 5, 200), width=SS)
    # brass lid edging + straps
    d.line([(x0 + bodyW * 0.02, mouthY - H * 0.205), (x1 - bodyW * 0.02, mouthY - H * 0.205)], fill=(201, 165, 92, 255), width=3 * SS)
    d.line([(x0 + bodyW * 0.02, mouthY - H * 0.199), (x1 - bodyW * 0.02, mouthY - H * 0.199)], fill=(40, 28, 8, 255), width=SS)
    for f in (0.16, 0.5, 0.84):
        sx0 = x0 + bodyW * f
        strap = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(strap).polygon([(sx0 - W * 0.016, mouthY - H * 0.205), (sx0 - W * 0.013, mouthY - H * 0.31),
                                       (sx0 + W * 0.013, mouthY - H * 0.31), (sx0 + W * 0.016, mouthY - H * 0.205)], fill=(66, 71, 79, 255))
        img.alpha_composite(strap)
        d = ImageDraw.Draw(img)
        d.line([(sx0 - W * 0.011, mouthY - H * 0.3), (sx0 - W * 0.011, mouthY - H * 0.21)], fill=(174, 180, 188, 130), width=SS)

    # hinge arms connecting lid ↔ body
    for ax, mirror in [(x0 + bodyW * 0.045, 1), (x1 - bodyW * 0.045, -1)]:
        d.line([(ax, mouthY - H * 0.20), (ax - mirror * W * 0.012, mouthY + H * 0.005)], fill=(52, 57, 64, 255), width=int(W * 0.012))
        d.line([(ax, mouthY - H * 0.20), (ax - mirror * W * 0.012, mouthY + H * 0.005)], fill=(174, 180, 188, 90), width=2 * SS)
        for (px, py) in [(ax, mouthY - H * 0.195), (ax - mirror * W * 0.012, mouthY)]:
            scr(img, px, py, W * 0.008, mirror < 0)
            d = ImageDraw.Draw(img)

    # hoard glow + coins
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([x0 + bodyW * 0.08, mouthY - H * 0.19, x1 - bodyW * 0.08, mouthY - H * 0.005],
                                 fill=((255, 214, 133, 120) if gold else (233, 238, 244, 90)))
    img.alpha_composite(blurred(glow, W * 0.02))
    mouth = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(mouth).ellipse([x0 + bodyW * 0.03, mouthY - H * 0.035, x1 - bodyW * 0.03, mouthY + H * 0.015], fill=(14, 9, 2, 255))
    img.alpha_composite(mouth)
    coin_heap(img, 0.5, mouthY / H - 0.008, bodyW / W * 0.86, metal, seed=5 if gold else 6, rows=4, base_px=int(W * 0.072))

    # two leaning coins on the lip
    lean_l = render_coin(int(W * 0.085), metal, rng, tilt=0.6, with_shadow=True).rotate(-22, resample=Image.BICUBIC)
    lean_r = render_coin(int(W * 0.08), metal, rng, tilt=0.56, with_shadow=True).rotate(17, resample=Image.BICUBIC)
    img.alpha_composite(lean_l, (int(x0 + bodyW * 0.075), int(mouthY - H * 0.052)))
    img.alpha_composite(lean_r, (int(x1 - bodyW * 0.075 - W * 0.08), int(mouthY - H * 0.048)))

    # FRONT LIP thickness
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x0, mouthY - H * 0.012, x1, mouthY + H * 0.014], W * 0.006, fill=(122, 92, 51, 255), outline=(24, 16, 6, 255), width=SS)
    d.line([(x0 + 3 * SS, mouthY - H * 0.004), (x1 - 3 * SS, mouthY - H * 0.004)], fill=(201, 158, 95, 220), width=SS)

    # brass lock hasp + keyhole on the lip
    hx = cx
    hsh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(hsh).rounded_rectangle([hx - W * 0.028 + W * 0.004, mouthY - H * 0.006 + W * 0.005, hx + W * 0.028 + W * 0.004, mouthY + H * 0.052 + W * 0.005], W * 0.008, fill=(0, 0, 0, 190))
    img.alpha_composite(blurred(hsh, W * 0.006))
    lock = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(lock).rounded_rectangle([hx - W * 0.028, mouthY - H * 0.006, hx + W * 0.028, mouthY + H * 0.052], W * 0.008, fill=(255, 255, 255, 255))
    lgrad = field_to_rgba(np.tile(np.linspace(0, 1, H).reshape(H, 1), (1, W)), BRASS)
    img.alpha_composite(Image.composite(lgrad, Image.new("RGBA", (W, H), (0, 0, 0, 0)), lock.split()[3]))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([hx - W * 0.028, mouthY - H * 0.006, hx + W * 0.028, mouthY + H * 0.052], W * 0.008, outline=(40, 28, 8, 255), width=SS)
    d.line([(hx - W * 0.024, mouthY - H * 0.002), (hx + W * 0.024, mouthY - H * 0.002)], fill=(255, 240, 200, 220), width=SS)
    d.ellipse([hx - W * 0.0068, mouthY + H * 0.012, hx + W * 0.0068, mouthY + H * 0.026], fill=(16, 10, 3, 255))
    d.polygon([(hx - W * 0.004, mouthY + H * 0.024), (hx + W * 0.004, mouthY + H * 0.024), (hx + W * 0.0058, mouthY + H * 0.042), (hx - W * 0.0058, mouthY + H * 0.042)], fill=(16, 10, 3, 255))
    d.arc([hx - W * 0.0075, mouthY + H * 0.0115, hx + W * 0.006, mouthY + H * 0.0255], 120, 300, fill=(255, 240, 200, 120), width=SS)

    # body wood + staves + grain
    bmask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(bmask).rounded_rectangle([x0, mouthY + H * 0.012, x1, mouthY + bodyH], W * 0.012, fill=255)
    img.alpha_composite(Image.composite(wood_img, Image.new("RGBA", (W, H), (0, 0, 0, 0)), bmask))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x0, mouthY + H * 0.012, x1, mouthY + bodyH], W * 0.012, outline=(22, 14, 6, 255), width=2 * SS)
    for f in (0.22, 0.44, 0.66, 0.88):
        sx0 = x0 + bodyW * f
        d.line([(sx0, mouthY + H * 0.02), (sx0, mouthY + bodyH - H * 0.01)], fill=(24, 16, 7, 220), width=SS)
        d.line([(sx0 + SS, mouthY + H * 0.02), (sx0 + SS, mouthY + bodyH - H * 0.01)], fill=(130, 98, 56, 130), width=SS)

    # iron corner plates + rust weep
    for (px, py), dim in [((x0, mouthY + H * 0.02), False), ((x1 - W * 0.045, mouthY + H * 0.02), True),
                          ((x0, mouthY + bodyH - H * 0.075), False), ((x1 - W * 0.045, mouthY + bodyH - H * 0.075), True)]:
        d.rounded_rectangle([px, py, px + W * 0.045, py + H * 0.055], W * 0.006, fill=(60, 65, 73, 255), outline=(10, 11, 13, 255), width=SS)
        d.line([(px + 2 * SS, py + 2 * SS), (px + W * 0.045 - 2 * SS, py + 2 * SS)], fill=(174, 180, 188, 120), width=SS)
        rust = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(rust).line([(px + W * 0.022, py + H * 0.055), (px + W * 0.024, py + H * 0.1)], fill=(122, 62, 27, 140), width=2 * SS)
        img.alpha_composite(blurred(rust, W * 0.003))
        d = ImageDraw.Draw(img)
        scr(img, px + W * 0.022, py + H * 0.027, W * 0.009, dim)
        d = ImageDraw.Draw(img)

    # slot seat (live bar in RN) — sunken brass-edged channel
    sx0, sy0 = W * CH_SLOT[0], H * CH_SLOT[1]
    sx1, sy1 = sx0 + W * CH_SLOT[2], sy0 + H * CH_SLOT[3]
    d.rounded_rectangle([sx0 - W * 0.012, sy0 - H * 0.014, sx1 + W * 0.012, sy1 + H * 0.014], H * 0.03, outline=(201, 165, 92, 255), width=2 * SS)
    d.rounded_rectangle([sx0 - W * 0.012 + SS, sy0 - H * 0.014 + SS, sx1 + W * 0.012 - SS, sy1 + H * 0.014 - SS], H * 0.028, outline=(40, 28, 8, 200), width=SS)
    d.rounded_rectangle([sx0, sy0, sx1, sy1], H * 0.024, fill=(9, 6, 3, 255), outline=(0, 0, 0, 220), width=SS)

    # spilt coins on the ground
    for (fx, fy, tilt, rot, sz) in [(0.16, 0.925, 0.3, -8, 0.075), (0.27, 0.945, 0.26, 5, 0.07), (0.8, 0.935, 0.28, -4, 0.072)]:
        c = render_coin(int(W * sz), metal, rng, tilt=tilt).rotate(rot, resample=Image.BICUBIC)
        img.alpha_composite(c, (int(W * fx), int(H * fy - W * sz / 2)))

    return img.resize((CH_W, CH_H), Image.LANCZOS)


# ─────────────────────────────────────────────────────────────────────────────
# BALANCE — turned column, LINK chains, rimmed pans, bars vs coins (static art;
# the value plate seat sits right, RN engraves the numbers)
# ─────────────────────────────────────────────────────────────────────────────

BAL_W, BAL_H = 960, 720
BAL_PLATE = (0.60, 0.36, 0.36, 0.30)  # RN value plate rect (fractions)


def _brass_rect(img, box, radius, W):
    m = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(m).rounded_rectangle(box, radius, fill=(255, 255, 255, 255))
    grad = field_to_rgba(np.tile(np.linspace(0, 1, img.size[1]).reshape(img.size[1], 1), (1, img.size[0])), BRASS)
    img.alpha_composite(Image.composite(grad, Image.new("RGBA", img.size, (0, 0, 0, 0)), m.split()[3]))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box, radius, outline=(40, 28, 8, 255), width=SS)
    d.line([(box[0] + 3 * SS, box[1] + 2 * SS), (box[2] - 3 * SS, box[1] + 2 * SS)], fill=(255, 240, 200, 200), width=SS)


def _chain(img, x1, y1, x2, y2, links=7):
    d = ImageDraw.Draw(img)
    for i in range(links):
        f = i / (links - 1)
        lx, ly = x1 + (x2 - x1) * f, y1 + (y2 - y1) * f
        big = i % 2 == 0
        rx = (5 if big else 3.4) * SS
        ry = (7.5 if big else 5) * SS
        d.ellipse([lx - rx, ly - ry, lx + rx, ly + ry], outline=(138, 109, 47, 255), width=2 * SS)
        d.arc([lx - rx, ly - ry, lx + rx, ly + ry], 200, 300, fill=(252, 233, 178, 220), width=SS)


def render_balance():
    W, H = BAL_W * SS, BAL_H * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cx = W * 0.33
    baseY = H * 0.9
    tilt = math.radians(7)  # right pan (gold) sits lower — wealth on the scale
    rng = np.random.default_rng(88)

    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([cx - W * 0.16, baseY - H * 0.012, cx + W * 0.16, baseY + H * 0.035], fill=(0, 0, 0, 200))
    img.alpha_composite(blurred(sh, W * 0.012))

    # plinth (two steps) + column + knops
    _brass_rect(img, [cx - W * 0.155, baseY - H * 0.055, cx + W * 0.155, baseY], W * 0.012, W)
    _brass_rect(img, [cx - W * 0.105, baseY - H * 0.098, cx + W * 0.105, baseY - H * 0.052], W * 0.01, W)
    col = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cdr = ImageDraw.Draw(col)
    cdr.rounded_rectangle([cx - W * 0.022, H * 0.205, cx + W * 0.022, baseY - H * 0.09], W * 0.018, fill=(255, 255, 255, 255))
    colgrad = field_to_rgba(np.tile(np.linspace(0, 1, W).reshape(1, W), (H, 1)), [(0, (252, 233, 178)), (0.35, (201, 165, 92)), (0.75, (110, 85, 36)), (1, (49, 36, 12))])
    img.alpha_composite(Image.composite(colgrad, Image.new("RGBA", (W, H), (0, 0, 0, 0)), col.split()[3]))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([cx - W * 0.022, H * 0.205, cx + W * 0.022, baseY - H * 0.09], W * 0.018, outline=(40, 28, 8, 255), width=SS)
    d.line([(cx - W * 0.011, H * 0.215), (cx - W * 0.011, baseY - H * 0.1)], fill=(255, 240, 200, 170), width=SS)
    for ky in (H * 0.42, H * 0.64):
        kn = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(kn).ellipse([cx - W * 0.03, ky - H * 0.02, cx + W * 0.03, ky + H * 0.02], fill=(255, 255, 255, 255))
        img.alpha_composite(Image.composite(colgrad, Image.new("RGBA", (W, H), (0, 0, 0, 0)), kn.split()[3]))
        d = ImageDraw.Draw(img)
        d.ellipse([cx - W * 0.03, ky - H * 0.02, cx + W * 0.03, ky + H * 0.02], outline=(40, 28, 8, 255), width=SS)
        d.ellipse([cx - W * 0.02, ky - H * 0.014, cx - W * 0.004, ky - H * 0.004], fill=(255, 247, 224, 190))

    # pivot + beam at fixed tilt + finial
    pvx, pvy = cx, H * 0.20
    armL = W * 0.275
    exL = (pvx - armL * math.cos(tilt), pvy + armL * math.sin(tilt))
    exR = (pvx + armL * math.cos(tilt), pvy - armL * math.sin(tilt))
    bsh2 = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(bsh2).line([exL, exR], fill=(0, 0, 0, 160), width=int(W * 0.014))
    img.alpha_composite(blurred(bsh2, W * 0.006).transform(img.size, Image.AFFINE, (1, 0, 0, 0, 1, -W * 0.006)))
    d = ImageDraw.Draw(img)
    d.line([exL, exR], fill=(160, 126, 62, 255), width=int(W * 0.016))
    d.line([(exL[0], exL[1] - W * 0.004), (exR[0], exR[1] - W * 0.004)], fill=(250, 228, 168, 230), width=2 * SS)
    d.line([(exL[0], exL[1] + W * 0.0045), (exR[0], exR[1] + W * 0.0045)], fill=(46, 33, 10, 255), width=2 * SS)
    hexr = W * 0.026
    pts = [(pvx + hexr * math.cos(math.radians(i * 60 - 90)), pvy + hexr * math.sin(math.radians(i * 60 - 90))) for i in range(6)]
    d.polygon(pts, fill=(214, 178, 102, 255), outline=(46, 33, 10, 255))
    d.polygon([pts[3], pts[4], pts[5]], fill=(252, 233, 178, 130))
    d.ellipse([pvx - W * 0.008, pvy - W * 0.008, pvx + W * 0.008, pvy + W * 0.008], fill=(74, 20, 12, 255))
    d.ellipse([pvx - W * 0.0045, pvy - W * 0.0055, pvx, pvy - W * 0.001], fill=(255, 200, 185, 220))

    # pans on link chains + contents
    for side, ex in (("L", exL), ("R", exR)):
        px, py = ex
        pan_y = py + H * 0.21
        _chain(img, px - W * 0.052, py, px - W * 0.062, pan_y - H * 0.012)
        _chain(img, px, py, px, pan_y - H * 0.016)
        _chain(img, px + W * 0.052, py, px + W * 0.062, pan_y - H * 0.012)
        pan = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        pd = ImageDraw.Draw(pan)
        pd.polygon([(px - W * 0.12, pan_y), (px + W * 0.12, pan_y), (px + W * 0.075, pan_y + H * 0.055), (px - W * 0.075, pan_y + H * 0.055)], fill=(255, 255, 255, 255))
        pangrad = field_to_rgba(np.tile(np.linspace(0, 1, H).reshape(H, 1), (1, W)), BRASS)
        img.alpha_composite(Image.composite(pangrad, Image.new("RGBA", (W, H), (0, 0, 0, 0)), pan.split()[3]))
        d = ImageDraw.Draw(img)
        d.polygon([(px - W * 0.12, pan_y), (px + W * 0.12, pan_y), (px + W * 0.075, pan_y + H * 0.055), (px - W * 0.075, pan_y + H * 0.055)], outline=(40, 28, 8, 255))
        d.line([(px - W * 0.12, pan_y), (px + W * 0.12, pan_y)], fill=(255, 244, 214, 230), width=2 * SS)
        d.line([(px - W * 0.085, pan_y + H * 0.053), (px + W * 0.085, pan_y + H * 0.053)], fill=(20, 14, 4, 220), width=2 * SS)
        inner = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(inner).ellipse([px - W * 0.1, pan_y - H * 0.012, px + W * 0.1, pan_y + H * 0.022], fill=(30, 21, 6, 170))
        img.alpha_composite(blurred(inner, W * 0.004))
        d = ImageDraw.Draw(img)
        if side == "L":
            for i, (bx, by, rot) in enumerate([(-0.045, -0.028, -8), (0.0, -0.036, 5), (-0.024, -0.05, 0)]):
                bar = Image.new("RGBA", (int(W * 0.09), int(W * 0.032)), (0, 0, 0, 0))
                bd2 = ImageDraw.Draw(bar)
                bd2.rounded_rectangle([0, int(W * 0.008), int(W * 0.09) - 1, int(W * 0.03)], W * 0.005, fill=(58, 64, 72, 220))
                bd2.rounded_rectangle([0, 0, int(W * 0.09) - 1, int(W * 0.024)], W * 0.005, fill=(198, 204, 212, 255), outline=(87, 94, 103, 255), width=SS)
                bd2.rounded_rectangle([int(W * 0.006), int(W * 0.003), int(W * 0.084), int(W * 0.01)], W * 0.003, fill=(255, 255, 255, 160))
                for nx in (0.3, 0.55):
                    bd2.line([(int(W * 0.09 * nx), int(W * 0.007)), (int(W * 0.09 * nx), int(W * 0.017))], fill=(109, 117, 126, 255), width=SS)
                bar = bar.rotate(rot, resample=Image.BICUBIC, expand=True)
                img.alpha_composite(bar, (int(px + W * bx - bar.width / 2), int(pan_y + H * by - bar.height / 2)))
        else:
            crng = np.random.default_rng(31)
            for (bx, by) in [(-0.035, -0.02), (0.012, -0.026), (-0.012, -0.048), (0.035, -0.015)]:
                c = render_coin(int(W * 0.052), "gold", crng)
                img.alpha_composite(c, (int(px + W * bx - W * 0.026), int(pan_y + H * by - W * 0.026)))

    return img.resize((BAL_W, BAL_H), Image.LANCZOS)


# ─────────────────────────────────────────────────────────────────────────────
# LOUPE — machined brass rim, deep lens with bulged script, turned handle
# (RN draws the live progress ring around LOUPE_R and the values inside)
# ─────────────────────────────────────────────────────────────────────────────

LP_W, LP_H = 900, 760
LP_C = (0.44, 0.42)   # lens centre fractions (mirrored in RN)
LP_R = 0.28           # lens radius fraction of width


def render_loupe():
    W, H = LP_W * SS, LP_H * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cx, cy = W * LP_C[0], H * LP_C[1]
    R = W * LP_R

    # handle (turned dark wood) + ferrule + rim screw
    a = math.radians(48)
    hx0, hy0 = cx + (R * 1.02) * math.cos(a), cy + (R * 1.02) * math.sin(a)
    hx1, hy1 = cx + (R * 2.4) * math.cos(a), cy + (R * 2.4) * math.sin(a)
    hsh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(hsh).line([(hx0 + W * 0.01, hy0 + W * 0.014), (hx1 + W * 0.01, hy1 + W * 0.014)], fill=(0, 0, 0, 190), width=int(W * 0.052))
    img.alpha_composite(blurred(hsh, W * 0.012))
    d = ImageDraw.Draw(img)
    d.line([(hx0, hy0), (hx1, hy1)], fill=(40, 28, 14, 255), width=int(W * 0.062))
    d.line([(hx0, hy0), (hx1, hy1)], fill=(84, 61, 32, 255), width=int(W * 0.046))
    d.line([(hx0 - W * 0.006, hy0 - W * 0.008), (hx1 - W * 0.006, hy1 - W * 0.008)], fill=(140, 104, 58, 230), width=int(W * 0.009))
    for f in (0.4, 0.62, 0.84):
        gx, gy = hx0 + (hx1 - hx0) * f, hy0 + (hy1 - hy0) * f
        d.ellipse([gx - W * 0.02, gy - W * 0.014, gx + W * 0.02, gy + W * 0.014], outline=(24, 16, 8, 220), width=2 * SS)
    end = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(end).ellipse([hx1 - W * 0.026, hy1 - W * 0.026, hx1 + W * 0.026, hy1 + W * 0.026], fill=(255, 255, 255, 255))
    endgrad = field_to_rgba(radial_field(W, H, hx1 - W * 0.008, hy1 - W * 0.01, W * 0.045), BRASS, np.array(end.split()[3]))
    img.alpha_composite(endgrad)
    fx, fy = cx + (R * 1.12) * math.cos(a), cy + (R * 1.12) * math.sin(a)
    fer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(fer).ellipse([fx - W * 0.032, fy - W * 0.026, fx + W * 0.032, fy + W * 0.026], fill=(255, 255, 255, 255))
    fergrad = field_to_rgba(radial_field(W, H, fx - W * 0.01, fy - W * 0.012, W * 0.055), BRASS, np.array(fer.split()[3]))
    img.alpha_composite(fergrad)
    d = ImageDraw.Draw(img)
    d.ellipse([fx - W * 0.032, fy - W * 0.026, fx + W * 0.032, fy + W * 0.026], outline=(40, 28, 8, 255), width=SS)
    scr(img, cx + (R * 1.04) * math.cos(a - 0.35), cy + (R * 1.04) * math.sin(a - 0.35), W * 0.011)

    # lens well shadow + rim torus with turning marks
    lsh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(lsh).ellipse([cx - R * 1.14, cy - R * 1.1, cx + R * 1.2, cy + R * 1.22], fill=(0, 0, 0, 180))
    img.alpha_composite(blurred(lsh, W * 0.014))
    img.alpha_composite(ring_band(W, cx, cy, R * 0.96, R * 1.12, BRASS).crop((0, 0, W, H)))
    rngl = np.random.default_rng(3)
    br = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bd = ImageDraw.Draw(br)
    for i in range(50):
        rr = R * (0.97 + 0.14 * rngl.random())
        alpha = int(8 + 22 * rngl.random())
        col = (255, 240, 200, alpha) if rngl.random() > 0.5 else (20, 14, 4, alpha)
        bd.arc([cx - rr, cy - rr, cx + rr, cy + rr], 0, 360, fill=col, width=SS)
    img.alpha_composite(br)
    cres = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(cres).arc([cx - R * 1.06, cy - R * 1.06, cx + R * 1.06, cy + R * 1.06], 196, 288, fill=(255, 247, 224, 230), width=max(3, int(W * 0.006)))
    img.alpha_composite(blurred(cres, W * 0.004))

    # deep green lens + BULGED script + refraction ring + speculars
    fld = radial_field(W, H, cx - R * 0.3, cy - R * 0.34, R * 1.5, power=1.3)
    lens = field_to_rgba(fld, [(0, (46, 66, 58)), (0.55, (22, 36, 31)), (1, (5, 10, 8))], np.array(ellipse_mask(W, H, [cx - R * 0.95, cy - R * 0.95, cx + R * 0.95, cy + R * 0.95])))
    img.alpha_composite(lens)
    d = ImageDraw.Draw(img)
    for i, dy in enumerate([-0.5, -0.34, 0.3, 0.46, 0.62]):
        bend = R * 0.24 * (1 - abs(dy) * 0.9)
        yy = cy + R * dy
        pts = [(cx - R * 0.8 + (R * 1.6) * t, yy - math.sin(t * math.pi) * bend) for t in np.linspace(0, 1, 24)]
        d.line(pts, fill=(139, 190, 165, 120 if abs(dy) > 0.42 else 175), width=(4 if abs(dy) < 0.42 else 3) * SS, joint="curve")
    d.arc([cx - R * 0.9, cy - R * 0.9, cx + R * 0.9, cy + R * 0.9], 25, 115, fill=(150, 200, 230, 60), width=3 * SS)
    sheen = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sheen).ellipse([cx - R * 0.72, cy - R * 0.7, cx - R * 0.1, cy - R * 0.38], fill=(235, 248, 242, 66))
    sheen = sheen.rotate(-24, center=(cx - R * 0.4, cy - R * 0.54), resample=Image.BICUBIC)
    img.alpha_composite(blurred(sheen, W * 0.012))
    streak = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(streak).arc([cx - R * 0.78, cy - R * 0.78, cx + R * 0.78, cy + R * 0.78], 205, 245, fill=(255, 255, 255, 120), width=int(R * 0.05))
    img.alpha_composite(blurred(streak, W * 0.006))
    d.ellipse([cx - R * 0.36 - W * 0.004, cy - R * 0.44 - W * 0.004, cx - R * 0.36 + W * 0.004, cy - R * 0.44 + W * 0.004], fill=(244, 251, 248, 230))

    return img.resize((LP_W, LP_H), Image.LANCZOS)


# ─────────────────────────────────────────────────────────────────────────────
# SCROLL + MAP parchment sheets (bars/route/values live in RN)
# ─────────────────────────────────────────────────────────────────────────────

SCROLL_W, SCROLL_H = 1080, 660  # matches 5 monthly rows layout in RN
MAP_W, MAP_H = 1080, 560


def _parchment(W, H, seed, torn=False):
    fld = np.clip(0.28 + 0.5 * noise(W, H, 90, seed, 4) + 0.22 * noise(W, H, 14, seed + 2, 2), 0, 1)
    sheet = field_to_rgba(1 - fld, [(0, (238, 222, 180)), (0.5, (214, 195, 152)), (1, (176, 152, 108))])
    return sheet


def render_scroll():
    W, H = SCROLL_W * SS, SCROLL_H * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rollH = H * 0.085
    sy0, sy1 = rollH * 0.9, H - rollH * 0.9
    rng = np.random.default_rng(77)

    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle([W * 0.035, sy0 + H * 0.012, W * 0.965, sy1 + H * 0.014], fill=(0, 0, 0, 190))
    img.alpha_composite(blurred(sh, W * 0.01))
    sheet = _parchment(W, H, 12)
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).rectangle([W * 0.03, sy0, W * 0.97, sy1], fill=255)
    img.alpha_composite(Image.composite(sheet, Image.new("RGBA", (W, H), (0, 0, 0, 0)), m))
    d = ImageDraw.Draw(img)
    # curl shading toward the rolls + side vignettes
    for (yy0, yy1, top) in [(sy0, sy0 + H * 0.05, True), (sy1 - H * 0.05, sy1, False)]:
        curl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(curl).rectangle([W * 0.03, yy0, W * 0.97, yy1], fill=(40, 28, 10, 90))
        img.alpha_composite(blurred(curl, H * 0.014))
    for xx0, xx1 in [(W * 0.03, W * 0.075), (W * 0.925, W * 0.97)]:
        sv = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sv).rectangle([xx0, sy0, xx1, sy1], fill=(40, 28, 10, 70))
        img.alpha_composite(blurred(sv, W * 0.008))
    # foxing + fibre
    d = ImageDraw.Draw(img)
    for i in range(46):
        fx, fy = W * 0.06 + rng.random() * W * 0.88, sy0 + H * 0.03 + rng.random() * (sy1 - sy0 - H * 0.06)
        rr = W * 0.0009 + rng.random() * W * 0.0022
        d.ellipse([fx - rr, fy - rr, fx + rr, fy + rr], fill=(116, 92, 52, int(14 + rng.random() * 20)))
    for i in range(6):
        yy = sy0 + H * 0.05 + rng.random() * (sy1 - sy0 - H * 0.1)
        pts = [(W * (0.07 + 0.86 * t), yy + math.sin(t * math.pi * (1.5 + rng.random())) * H * 0.006) for t in np.linspace(0, 1, 18)]
        d.line(pts, fill=(138, 116, 74, 13), width=SS, joint="curve")

    # rolled cylinders + turned caps
    rollgrad = field_to_rgba(np.tile(np.linspace(0, 1, H).reshape(H, 1), (1, W)),
                             [(0, (122, 100, 62)), (0.3, (208, 180, 124)), (0.52, (240, 220, 170)), (0.78, (170, 143, 92)), (1, (96, 76, 44))])
    for ry in (0, H - rollH * 2):
        rsh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(rsh).rounded_rectangle([W * 0.005, ry + H * 0.012, W * 0.995, ry + rollH * 2], rollH, fill=(0, 0, 0, 170))
        img.alpha_composite(blurred(rsh, W * 0.006))
        roll = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(roll).rounded_rectangle([W * 0.005, ry, W * 0.995, ry + rollH * 2], rollH, fill=(255, 255, 255, 255))
        # localize the roll gradient vertically
        local = np.zeros((H, W), dtype=np.float32)
        yslice = np.linspace(0, 1, int(rollH * 2))
        y0i = int(ry)
        local[y0i:y0i + int(rollH * 2), :] = yslice.reshape(-1, 1)
        rollimg = field_to_rgba(local, [(0, (122, 100, 62)), (0.3, (208, 180, 124)), (0.52, (240, 220, 170)), (0.78, (170, 143, 92)), (1, (96, 76, 44))],
                                np.array(roll.split()[3]))
        img.alpha_composite(rollimg)
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([W * 0.005, ry, W * 0.995, ry + rollH * 2], rollH, outline=(56, 42, 20, 255), width=SS)
        for ex in (W * 0.02, W * 0.98):
            d.ellipse([ex - rollH * 0.6, ry + rollH * 0.28, ex + rollH * 0.6, ry + rollH * 1.72], fill=(196, 168, 112, 255), outline=(66, 51, 26, 255), width=SS)
            d.ellipse([ex - rollH * 0.28, ry + rollH * 0.6, ex + rollH * 0.28, ry + rollH * 1.4], outline=(66, 51, 26, 220), width=SS)
            d.ellipse([ex - rollH * 0.1, ry + rollH * 0.82, ex + rollH * 0.1, ry + rollH * 1.18], fill=(66, 51, 26, 200))

    return img.resize((SCROLL_W, SCROLL_H), Image.LANCZOS)


def render_map():
    W, H = MAP_W * SS, MAP_H * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rng = np.random.default_rng(63)

    # torn silhouette
    teeth = 30
    pts = []
    for i in range(teeth + 1):
        pts.append((W * 0.02 + (W * 0.96) * i / teeth, H * 0.03 + rng.random() * H * 0.025))
    for i in range(9):
        pts.append((W * 0.98 - rng.random() * W * 0.012, H * 0.05 + (H * 0.9) * i / 8))
    for i in range(teeth, -1, -1):
        pts.append((W * 0.02 + (W * 0.96) * i / teeth, H * 0.97 - rng.random() * H * 0.025))
    for i in range(8, -1, -1):
        pts.append((W * 0.02 + rng.random() * W * 0.012, H * 0.05 + (H * 0.9) * i / 8))
    sil = Image.new("L", (W, H), 0)
    ImageDraw.Draw(sil).polygon(pts, fill=255)
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).polygon([(x + W * 0.008, y + H * 0.012) for x, y in pts], fill=(0, 0, 0, 190))
    img.alpha_composite(blurred(sh, W * 0.008))
    sheet = _parchment(W, H, 40)
    img.alpha_composite(Image.composite(sheet, Image.new("RGBA", (W, H), (0, 0, 0, 0)), sil))

    # scorched edge: darkening ring inside silhouette boundary
    edge = Image.composite(Image.new("L", (W, H), 255), Image.new("L", (W, H), 0), sil)
    inner = edge.filter(ImageFilter.MinFilter(9))
    for _ in range(3):
        inner = inner.filter(ImageFilter.MinFilter(9))
    burnband = np.clip((np.array(edge, dtype=np.int16) - np.array(inner, dtype=np.int16)), 0, 255).astype(np.uint8)
    burn = Image.fromarray(np.dstack([np.full((H, W), 34, np.uint8), np.full((H, W), 18, np.uint8), np.full((H, W), 5, np.uint8),
                                      (np.array(Image.fromarray(burnband).filter(ImageFilter.GaussianBlur(W * 0.004)), dtype=np.float32) * 0.85).astype(np.uint8)]))
    img.alpha_composite(burn)

    d = ImageDraw.Draw(img)
    # topography + soundings + rhumb lines from the rose
    for i in range(4):
        tx, ty = W * (0.12 + rng.random() * 0.45), H * (0.22 + rng.random() * 0.55)
        for k in range(2):
            rr = W * (0.024 + 0.02 * k)
            pts = []
            for j in range(14):
                aa = j / 14 * 2 * math.pi
                jr = rr * (0.75 + rng.random() * 0.5)
                pts.append((tx + jr * math.cos(aa), ty + jr * 0.55 * math.sin(aa)))
            d.polygon(pts, outline=(120, 99, 60, 46 - k * 16))
    rosex, rosey = W * 0.84, H * 0.2
    for i in range(16):
        aa = math.radians(i * 22.5)
        d.line([(rosex, rosey), (rosex + W * 0.5 * math.cos(aa), rosey + W * 0.5 * math.sin(aa))], fill=(125, 104, 64, 13), width=SS)
    for i in range(10):
        sx, sy = W * (0.1 + rng.random() * 0.6), H * (0.15 + rng.random() * 0.7)
        d.line([(sx, sy), (sx + W * 0.012, sy - H * 0.008), (sx + W * 0.024, sy)], fill=(111, 90, 52, 70), width=SS, joint="curve")

    # compass rose (engraved, with needle shadow)
    for rr, wd_ in [(W * 0.052, 2), (W * 0.042, 1)]:
        d.ellipse([rosex - rr, rosey - rr, rosex + rr, rosey + rr], outline=(94, 76, 42, 220), width=wd_ * SS)
    for i in range(8):
        aa = math.radians(i * 45 - 90)
        long = i % 2 == 0
        tipr = W * (0.048 if long else 0.03)
        tip = (rosex + tipr * math.cos(aa), rosey + tipr * math.sin(aa))
        b1 = (rosex + W * 0.009 * math.cos(aa + math.pi / 2), rosey + W * 0.009 * math.sin(aa + math.pi / 2))
        b2 = (rosex + W * 0.009 * math.cos(aa - math.pi / 2), rosey + W * 0.009 * math.sin(aa - math.pi / 2))
        d.polygon([(tip[0] + W * 0.0015, tip[1] + W * 0.002), (b1[0] + W * 0.0015, b1[1] + W * 0.002), (b2[0] + W * 0.0015, b2[1] + W * 0.002)], fill=(0, 0, 0, 90))
        d.polygon([tip, b1, b2], fill=(163, 130, 59, 255) if long else (94, 76, 42, 255))
    d.ellipse([rosex - W * 0.006, rosey - W * 0.006, rosex + W * 0.006, rosey + W * 0.006], fill=(214, 178, 102, 255), outline=(66, 51, 26, 255))
    fN = font("CrimsonPro-Bold.ttf", int(W * 0.03))
    engrave(d, (rosex, rosey - W * 0.062), "N", fN, bright=(94, 76, 42, 255), dark=(238, 222, 180, 200), dy=-1.4)

    # island + palm + open chest with REAL coins (destination)
    ix, iy = W * 0.85, H * 0.62
    d.ellipse([ix - W * 0.085, iy - H * 0.035, ix + W * 0.085, iy + H * 0.06], fill=(206, 184, 134, 255), outline=(138, 116, 74, 255), width=SS)
    d.arc([ix - W * 0.06, iy + H * 0.006, ix - W * 0.008, iy + H * 0.04], 20, 160, fill=(138, 116, 74, 130), width=SS)
    px0, py0 = ix + W * 0.032, iy - H * 0.085
    d.line([(px0, iy - H * 0.005), (px0 + W * 0.006, py0)], fill=(74, 52, 21, 255), width=3 * SS)
    for aa in (-45, -15, 20, 50, 82, 110):
        ar = math.radians(aa)
        ex_, ey_ = px0 + W * 0.006 + W * 0.034 * math.cos(ar), py0 - W * 0.02 * math.sin(ar) - W * 0.006
        d.line([(px0 + W * 0.006, py0), ((px0 + W * 0.006 + ex_) / 2, (py0 + ey_) / 2 - W * 0.006), (ex_, ey_)], fill=(58, 82, 36, 255), width=3 * SS, joint="curve")
    chx, chy = ix - W * 0.012, iy - H * 0.01
    d.rounded_rectangle([chx - W * 0.03, chy - H * 0.02, chx + W * 0.03, chy + H * 0.028], W * 0.005, fill=(84, 64, 31, 255), outline=(36, 23, 8, 255), width=SS)
    d.polygon([(chx - W * 0.03, chy - H * 0.02), (chx, chy - H * 0.052), (chx + W * 0.03, chy - H * 0.02)], fill=(163, 130, 59, 255), outline=(122, 94, 34, 255))
    crng = np.random.default_rng(8)
    for (fx, fy) in [(-0.014, -0.028), (0.001, -0.034), (0.014, -0.027)]:
        c = render_coin(int(W * 0.022), "gold", crng, with_shadow=False)
        img.alpha_composite(c, (int(chx + W * fx - W * 0.011), int(chy + H * fy - W * 0.011)))
    d = ImageDraw.Draw(img)

    # hand-struck X at the start
    xx, xy = W * 0.1, H * 0.66
    for (dx, dy, col, wd_) in [(W * 0.002, H * 0.004, (60, 18, 8, 130), 4), (0, 0, (160, 44, 23, 255), 4)]:
        d.line([(xx - W * 0.02 + dx, xy - H * 0.035 + dy), (xx + W * 0.02 + dx, xy + H * 0.035 + dy)], fill=col, width=wd_ * SS)
        d.line([(xx + W * 0.02 + dx, xy - H * 0.035 + dy), (xx - W * 0.02 + dx, xy + H * 0.035 + dy)], fill=col, width=wd_ * SS)

    return img.resize((MAP_W, MAP_H), Image.LANCZOS)


# ─────────────────────────────────────────────────────────────────────────────
# proof sheet for the eye
# ─────────────────────────────────────────────────────────────────────────────

def proof_coins():
    W, H = 900, 560
    img = Image.new("RGBA", (W, H), (18, 15, 11, 255))
    rng = np.random.default_rng(4)
    for i, metal in enumerate(["gold", "silver"]):
        for j in range(4):
            c = render_coin(150, metal, rng)
            img.alpha_composite(c, (30 + j * 160, 26 + i * 170))
    coin_heap(img, 0.5, 0.86, 0.7, "gold", seed=9, rows=3, base_px=110)
    img.convert("RGB").save(os.path.join(OUT, "_proof-coins.png"))


def _save(img, name):
    img.save(os.path.join(OUT, name + ".png"))
    bg = Image.new("RGBA", img.size, (22, 19, 16, 255))
    bg.alpha_composite(img)
    bg.convert("RGB").save(os.path.join(OUT, "_proof-" + name + ".png"))
    print(name, "done")


def main():
    targets = sys.argv[1:] or ["all"]
    every = "all" in targets
    if "coins" in targets:
        proof_coins()
        print("coins proof done")
    if every or "gauge" in targets:
        _save(render_gauge(), "gauge")
    if every or "porthole" in targets:
        _save(render_porthole(), "porthole")
    if every or "thermo" in targets:
        _save(render_thermo(), "thermo")
    if every or "tanks" in targets:
        _save(render_tank("gold"), "tank-gold")
        _save(render_tank("silver"), "tank-silver")
    if every or "chests" in targets:
        _save(render_chest("gold"), "chest-gold")
        _save(render_chest("silver"), "chest-silver")
    if every or "balance" in targets:
        _save(render_balance(), "balance")
    if every or "loupe" in targets:
        _save(render_loupe(), "loupe")
    if every or "scroll" in targets:
        _save(render_scroll(), "scroll")
    if every or "map" in targets:
        _save(render_map(), "map")


if __name__ == "__main__":
    main()
