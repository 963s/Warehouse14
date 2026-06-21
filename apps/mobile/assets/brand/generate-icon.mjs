#!/usr/bin/env node
// Warehouse14 — Owner OS app icon + splash generator.
//
// Single source of truth = the REAL shop logo the cashier uses on the POS:
//   apps/tauri-pos/public/shop-logo.svg  (the WAREHOUSE 14 vault wordmark).
// We rasterize that exact SVG (no invented mark) and render it in the brand
// brass over the W14 dark canvas. Zero dependency on purpose: no sharp /
// resvg / canvas is installed here, so a tiny self-contained SVG rasterizer
// (./svg-raster.mjs) turns the logo into a coverage mask and Node's built-in
// zlib encodes the PNGs. Reproducible anywhere Node runs.
//
// Run:  node apps/mobile/assets/brand/generate-icon.mjs
// Emits into apps/mobile/assets/images/:
//   app-icon-all.png                          1024 (Expo default icon, branded panel)
//   app-icon-ios.png                          1024 (branded panel)
//   app-icon-android-legacy.png               1024 (branded panel)
//   app-icon-android-adaptive-foreground.png  1024 (logo on transparent, safe-zone inset)
//   app-icon-android-adaptive-background.png  1024 (solid brand canvas — brass-safe)
//   app-icon-web-favicon.png                  48   (branded panel)
//   splash-logo.png                           1024 (logo on transparent, brass)
//
// NOTE: a native build must run `expo prebuild --clean` to pick these up,
// because the icons are baked into ios/ and android/ at prebuild time.
//
// Brand tokens (mirror apps/mobile/src/warehouse14/theme.ts, dark canvas):
//   bg #131519 · card #1b1e24 · brass #d8b14e · brassHi #f0d27e · brassLo #a47e2f

import zlib from "node:zlib"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { rasterizeCoverage } from "./svg-raster.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(HERE, "../images")
const LOGO = path.resolve(HERE, "../../../tauri-pos/public/shop-logo.svg")

// ── colour helpers ──────────────────────────────────────────────────────────
const hex = (h) => {
  const n = h.replace("#", "")
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}
const C = {
  bg: hex("#131519"), // brand canvas (adaptive background, splash bg)
  bgTop: hex("#1b1e24"), // panel gradient top (= card)
  bgBot: hex("#101216"), // panel gradient bottom
  brassHi: hex("#f0d27e"),
  brass: hex("#d8b14e"),
  brassLo: hex("#a47e2f"),
}
const lerp = (a, b, t) => a + (b - a) * t
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]

// Directional brass gradient across the canvas (top-left bright → bottom-right deep).
function brassAt(x, y, size) {
  const t = Math.max(0, Math.min(1, (x + y) / (2 * size)))
  return t < 0.5 ? mix(C.brassHi, C.brass, t * 2) : mix(C.brass, C.brassLo, (t - 0.5) * 2)
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
// rgba: Uint8 buffer of size*size*4
function encodePNG(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      raw[o++] = rgba[i]; raw[o++] = rgba[i + 1]; raw[o++] = rgba[i + 2]; raw[o++] = rgba[i + 3]
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))])
}

// ── rounded-rect mask: 1 inside the panel, smooth at the corner radius ───────
function roundRectAlpha(x, y, size, r) {
  const cx = Math.max(r - x, x - (size - r), 0)
  const cy = Math.max(r - y, y - (size - r), 0)
  const d = Math.hypot(cx, cy) - r
  return Math.max(0, Math.min(1, 0.5 - d))
}

// ── render the logo coverage at `size` for a given content box ───────────────
function logoCoverage(size, padFrac) {
  const pad = Math.round(size * padFrac)
  return rasterizeCoverage({
    svgPath: LOGO,
    size,
    box: { ox: pad, oy: pad, boxW: size - 2 * pad, boxH: size - 2 * pad },
    ss: 4,
  }).coverage
}

// Branded panel: dark vertical gradient (optionally rounded) + brass logo.
function renderPanel(size, { padFrac = 0.14, rounded = true } = {}) {
  const cov = logoCoverage(size, padFrac)
  const r = 224 * (size / 1024)
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const panelA = rounded ? roundRectAlpha(x + 0.5, y + 0.5, size, r) : 1
      const bg = mix(C.bgTop, C.bgBot, y / size)
      let rr = bg[0], gg = bg[1], bb = bg[2]
      const a = cov[y * size + x]
      if (a > 0) {
        const br = brassAt(x, y, size)
        rr = lerp(rr, br[0], a); gg = lerp(gg, br[1], a); bb = lerp(bb, br[2], a)
      }
      out[i] = Math.round(rr); out[i + 1] = Math.round(gg); out[i + 2] = Math.round(bb)
      out[i + 3] = Math.round(255 * panelA)
    }
  }
  return out
}

// Logo only, brass, on transparent (Android adaptive foreground / splash).
function renderLogoTransparent(size, { padFrac = 0.18 } = {}) {
  const cov = logoCoverage(size, padFrac)
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const a = cov[y * size + x]
      if (a > 0) {
        const br = brassAt(x, y, size)
        out[i] = Math.round(br[0]); out[i + 1] = Math.round(br[1]); out[i + 2] = Math.round(br[2])
      }
      out[i + 3] = Math.round(255 * a)
    }
  }
  return out
}

// Solid fill (Android adaptive background — brand canvas, brass-safe because dark).
function renderSolid(size, rgb) {
  const out = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = rgb[0]; out[i * 4 + 1] = rgb[1]; out[i * 4 + 2] = rgb[2]; out[i * 4 + 3] = 255
  }
  return out
}

function write(name, size, rgba) {
  fs.writeFileSync(path.join(OUT, name), encodePNG(size, rgba))
  console.log("  ✓", name, `(${size}px)`)
}

console.log("Warehouse14 icon ← real shop logo (" + LOGO + ")")
console.log("→ " + OUT)

// Branded panel for iOS / Expo default / legacy.
const panel = renderPanel(1024, { padFrac: 0.15, rounded: true })
write("app-icon-all.png", 1024, panel)
write("app-icon-ios.png", 1024, panel)
write("app-icon-android-legacy.png", 1024, panel)

// Android adaptive: foreground = logo on transparent, inset into the safe zone
// (Android crops to a circle/squircle; ~0.26 padding keeps the whole wordmark
// inside the guaranteed-visible inner 66%). background = solid brand canvas.
write("app-icon-android-adaptive-foreground.png", 1024, renderLogoTransparent(1024, { padFrac: 0.26 }))
write("app-icon-android-adaptive-background.png", 1024, renderSolid(1024, C.bg))

// Web favicon — small branded panel.
write("app-icon-web-favicon.png", 48, renderPanel(48, { padFrac: 0.12, rounded: true }))

// Splash: the logo only on transparent (Expo paints brand bg #131519 behind it).
write("splash-logo.png", 1024, renderLogoTransparent(1024, { padFrac: 0.2 }))

console.log("done. (run `expo prebuild --clean` before the next native build)")
