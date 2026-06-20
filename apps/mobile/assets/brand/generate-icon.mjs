#!/usr/bin/env node
// Warehouse14 — Owner OS app icon + splash generator.
//
// Zero dependency: draws the brass-vault mark into an RGBA buffer and encodes
// PNGs with Node's built-in zlib. No sharp / canvas / rsvg needed (none are
// installed on this machine). The companion app-icon.svg is the human-readable
// design source of truth; this file is what actually ships the pixels so the
// output is reproducible anywhere Node runs.
//
// Run:  node apps/mobile/assets/brand/generate-icon.mjs
// Emits into apps/mobile/assets/images/:
//   app-icon-all.png                          1024 (Expo default icon)
//   app-icon-ios.png                          1024
//   app-icon-android-legacy.png               1024
//   app-icon-android-adaptive-foreground.png  1024 (safe-zone padded mark)
//   app-icon-android-adaptive-background.png  1024 (solid brand fill)
//   app-icon-web-favicon.png                  48
//   splash-logo.png                           1024 (transparent, mark only)
//
// Brand tokens (mirror apps/mobile/src/warehouse14/theme.ts, dark canvas):
//   bg #131519 · card #1b1e24 · brass #d8b14e · gold #bf9430 · verdigris #2fb277
//   primaryForeground #1a1407

import zlib from "node:zlib"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(HERE, "../images")

// ── colour helpers ──────────────────────────────────────────────────────────
const hex = (h) => {
  const n = h.replace("#", "")
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}
const C = {
  bgTop: hex("#1b1e24"),
  bgBot: hex("#101216"),
  panelEdge: hex("#0d0f12"),
  card: hex("#1b1e24"),
  vaultIn: hex("#23262d"),
  vaultOut: hex("#15171c"),
  brassHi: hex("#f0d27e"),
  brass: hex("#d8b14e"),
  brassLo: hex("#a47e2f"),
  gold: hex("#bf9430"),
  verdigris: hex("#2fb277"),
  ink: hex("#15171c"),
}
const lerp = (a, b, t) => a + (b - a) * t
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]

// ── canvas (float RGBA, premultiplied straight alpha compositing) ────────────
function makeCanvas(size) {
  const px = new Float64Array(size * size * 4) // r,g,b,a in 0..255 / 0..1
  return { size, px }
}
function blend(cv, x, y, rgb, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= cv.size || y >= cv.size) return
  const i = (y * cv.size + x) * 4
  const dst = cv.px
  const da = dst[i + 3]
  const oa = a + da * (1 - a)
  if (oa <= 0) return
  for (let k = 0; k < 3; k++) {
    dst[i + k] = (rgb[k] * a + dst[i + k] * da * (1 - a)) / oa
  }
  dst[i + 3] = oa
}

// Signed-distance coverage: 1 inside, 0 outside, smooth across a 1px edge.
const cov = (d) => Math.max(0, Math.min(1, 0.5 - d))

// ── primitives (all operate in canvas px, anti-aliased via SDF) ──────────────
function fillRoundRect(cv, x0, y0, w, h, r, colorFn, alpha = 1) {
  const x1 = x0 + w, y1 = y0 + h
  for (let y = Math.floor(y0 - 1); y < Math.ceil(y1 + 1); y++) {
    for (let x = Math.floor(x0 - 1); x < Math.ceil(x1 + 1); x++) {
      // distance to rounded rect
      const dx = Math.max(x0 + r - (x + 0.5), (x + 0.5) - (x1 - r), 0)
      const dy = Math.max(y0 + r - (y + 0.5), (y + 0.5) - (y1 - r), 0)
      const inX = (x + 0.5) >= x0 && (x + 0.5) <= x1
      const inY = (y + 0.5) >= y0 && (y + 0.5) <= y1
      let d
      if ((x + 0.5) > x0 + r && (x + 0.5) < x1 - r) d = inY ? (Math.max(y0 - (y + 0.5), (y + 0.5) - y1)) : 1
      else if ((y + 0.5) > y0 + r && (y + 0.5) < y1 - r) d = inX ? (Math.max(x0 - (x + 0.5), (x + 0.5) - x1)) : 1
      else d = Math.hypot(dx, dy) - r
      const a = cov(d) * alpha
      if (a > 0) blend(cv, x, y, colorFn(x, y), a)
    }
  }
}
function fillDisc(cv, cx, cy, r, colorFn, alpha = 1) {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r
      const a = cov(d) * alpha
      if (a > 0) blend(cv, x, y, colorFn(x, y), a)
    }
  }
}
function strokeRing(cv, cx, cy, r, width, colorFn, alpha = 1) {
  const ro = r + width / 2, ri = r - width / 2
  for (let y = Math.floor(cy - ro - 1); y <= Math.ceil(cy + ro + 1); y++) {
    for (let x = Math.floor(cx - ro - 1); x <= Math.ceil(cx + ro + 1); x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const d = Math.max(dist - ro, ri - dist)
      const a = cov(d) * alpha
      if (a > 0) blend(cv, x, y, colorFn(x, y), a)
    }
  }
}
// thick line segment with round caps
function strokeSeg(cv, ax, ay, bx, by, width, colorFn, alpha = 1) {
  const minx = Math.min(ax, bx) - width, maxx = Math.max(ax, bx) + width
  const miny = Math.min(ay, by) - width, maxy = Math.max(ay, by) + width
  const vx = bx - ax, vy = by - ay
  const len2 = vx * vx + vy * vy || 1
  for (let y = Math.floor(miny); y <= Math.ceil(maxy); y++) {
    for (let x = Math.floor(minx); x <= Math.ceil(maxx); x++) {
      const px = x + 0.5 - ax, py = y + 0.5 - ay
      let t = (px * vx + py * vy) / len2
      t = Math.max(0, Math.min(1, t))
      const dx = px - vx * t, dy = py - vy * t
      const d = Math.hypot(dx, dy) - width / 2
      const a = cov(d) * alpha
      if (a > 0) blend(cv, x, y, colorFn(x, y), a)
    }
  }
}

// directional brass gradient (top-left bright → bottom-right deep)
function brassFn(cx, cy, r) {
  return (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - (cx - r)) + (y - (cy - r))) / (4 * r)))
    return t < 0.5 ? mix(C.brassHi, C.brass, t * 2) : mix(C.brass, C.brassLo, (t - 0.5) * 2)
  }
}
const solid = (rgb) => () => rgb

// vertical panel gradient
function panelFn(size) {
  return (x, y) => mix(C.bgTop, C.bgBot, y / size)
}
function vaultFn(cx, cy, r) {
  return (x, y) => {
    const t = Math.min(1, Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r)
    return mix(C.vaultIn, C.vaultOut, t)
  }
}

// ── "W14" wordmark — compact stroked vector glyphs ───────────────────────────
function drawW14(cv, cx, baseY, scale, colorFn) {
  const sw = 17 * scale // stroke width
  const h = 78 * scale
  const top = baseY - h
  const seg = (ax, ay, bx, by) => strokeSeg(cv, ax, ay, bx, by, sw, colorFn)
  // letters laid out around cx; total visual width ~ 320*scale
  const gap = 26 * scale
  const wW = 150 * scale
  const wOne = 30 * scale
  const wFour = 96 * scale
  const total = wW + gap + wOne + gap + wFour
  let x = cx - total / 2
  // W
  seg(x, top, x + wW * 0.22, baseY)
  seg(x + wW * 0.22, baseY, x + wW * 0.5, top + h * 0.42)
  seg(x + wW * 0.5, top + h * 0.42, x + wW * 0.78, baseY)
  seg(x + wW * 0.78, baseY, x + wW, top)
  x += wW + gap
  // 1
  seg(x + wOne, top, x + wOne, baseY)
  seg(x + wOne, top, x + wOne * 0.1, top + h * 0.24)
  seg(x, baseY, x + wOne * 2, baseY)
  x += wOne + gap
  // 4
  seg(x + wFour * 0.7, top, x + wFour * 0.7, baseY) // stem
  seg(x + wFour * 0.7, top, x, top + h * 0.62) // diagonal
  seg(x, top + h * 0.62, x + wFour, top + h * 0.62) // crossbar
}

// ── compose the mark at a given canvas size (with optional safe-zone inset) ──
// padScale: 1.0 = full bleed; <1 shrinks the mark toward centre (Android safe zone).
function drawMark(cv, { panel = true, padScale = 1.0, transparent = false } = {}) {
  const S = cv.size
  const cx = S / 2
  const r = (R) => R * (S / 1024)

  if (panel && !transparent) {
    fillRoundRect(cv, 0, 0, S, S, r(224), panelFn(S))
  }

  // mark centre is lifted slightly above middle to leave room for wordmark
  const vcx = cx
  const vcy = S * 0.48
  const k = padScale
  const ringR = r(228) * k
  const ringW = r(34) * k

  // outer brass ring
  strokeRing(cv, vcx, vcy, ringR, ringW, brassFn(vcx, vcy, ringR))
  // inner vault face
  fillDisc(cv, vcx, vcy, r(196) * k, vaultFn(vcx, vcy, r(196) * k))
  // gold inner bezel (decorative, faint)
  strokeRing(cv, vcx, vcy, r(178) * k, r(6) * k, solid(C.gold), 0.55)

  // rivets (gold)
  const rivetR = r(13) * k
  const rivetOrbit = r(204) * k
  for (let i = 0; i < 8; i++) {
    const ang = (-90 + i * 45) * (Math.PI / 180)
    fillDisc(cv, vcx + Math.cos(ang) * rivetOrbit, vcy + Math.sin(ang) * rivetOrbit, rivetR, solid(C.gold))
  }

  // verdigris accent arc (top-right quadrant of the rim)
  {
    const aw = ringW * 0.92
    const steps = 90
    for (let i = 0; i <= steps; i++) {
      const ang = (-78 + (i / steps) * 70) * (Math.PI / 180)
      const x = vcx + Math.cos(ang) * ringR
      const y = vcy + Math.sin(ang) * ringR
      fillDisc(cv, x, y, aw / 2, solid(C.verdigris))
    }
  }

  // dial spokes (three, 120° apart) + hub
  const spoke = r(150) * k
  const sw = r(30) * k
  for (let i = 0; i < 3; i++) {
    const ang = (-90 + i * 120) * (Math.PI / 180)
    strokeSeg(cv, vcx, vcy, vcx + Math.cos(ang) * spoke, vcy + Math.sin(ang) * spoke, sw, brassFn(vcx, vcy, spoke))
  }
  fillDisc(cv, vcx, vcy, r(58) * k, brassFn(vcx, vcy, r(58) * k))
  fillDisc(cv, vcx, vcy, r(30) * k, solid(C.ink))

  // wordmark
  drawW14(cv, cx, S * 0.83, (S / 1024) * k, solid(C.brass))
}

// ── PNG encode (8-bit RGBA, zlib deflate, no deps) ───────────────────────────
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, "ascii")
  const body = Buffer.concat([t, data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function encodePNG(cv) {
  const S = cv.size
  const raw = Buffer.alloc(S * (S * 4 + 1))
  let o = 0
  for (let y = 0; y < S; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4
      raw[o++] = Math.round(Math.max(0, Math.min(255, cv.px[i])))
      raw[o++] = Math.round(Math.max(0, Math.min(255, cv.px[i + 1])))
      raw[o++] = Math.round(Math.max(0, Math.min(255, cv.px[i + 2])))
      raw[o++] = Math.round(Math.max(0, Math.min(255, cv.px[i + 3] * 255)))
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))])
}

// ── supersample render: draw at 2x then box-downscale for crisp AA ───────────
function renderMark(size, opts) {
  const ss = 2
  const big = makeCanvas(size * ss)
  drawMark(big, opts)
  const out = makeCanvas(size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < ss; dy++) {
        for (let dx = 0; dx < ss; dx++) {
          const i = ((y * ss + dy) * big.size + (x * ss + dx)) * 4
          const pa = big.px[i + 3]
          r += big.px[i] * pa; g += big.px[i + 1] * pa; b += big.px[i + 2] * pa; a += pa
        }
      }
      const n = ss * ss
      const oi = (y * size + x) * 4
      if (a > 0) { out.px[oi] = r / a; out.px[oi + 1] = g / a; out.px[oi + 2] = b / a }
      out.px[oi + 3] = a / n
    }
  }
  return out
}

function solidCanvas(size, rgb, rounded) {
  const cv = makeCanvas(size)
  if (rounded) fillRoundRect(cv, 0, 0, size, size, 224 * (size / 1024), solid(rgb))
  else for (let i = 0; i < size * size; i++) { cv.px[i * 4] = rgb[0]; cv.px[i * 4 + 1] = rgb[1]; cv.px[i * 4 + 2] = rgb[2]; cv.px[i * 4 + 3] = 1 }
  return cv
}

function write(name, cv) {
  const p = path.join(OUT, name)
  fs.writeFileSync(p, encodePNG(cv))
  console.log("  ✓", name, `(${cv.size}px)`)
}

console.log("Warehouse14 icon → " + OUT)
// Full-bleed branded panel for iOS / default / legacy
const full = renderMark(1024, { panel: true, padScale: 1.0 })
write("app-icon-all.png", full)
write("app-icon-ios.png", full)
write("app-icon-android-legacy.png", full)
// Android adaptive: foreground = mark on transparent, inset into the safe zone;
// background = solid brand fill.
write("app-icon-android-adaptive-foreground.png", renderMark(1024, { panel: false, transparent: true, padScale: 0.72 }))
write("app-icon-android-adaptive-background.png", solidCanvas(1024, C.bgBot, false))
// Web favicon
write("app-icon-web-favicon.png", renderMark(48, { panel: true, padScale: 1.0 }))
// Splash: the mark only, on transparent (Expo paints brand bg behind it)
write("splash-logo.png", renderMark(1024, { panel: false, transparent: true, padScale: 0.86 }))
console.log("done.")
