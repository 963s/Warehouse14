// Zero-dependency SVG → RGBA rasterizer (subset).
//
// Purpose: rasterize the REAL shop logo (apps/tauri-pos/public/shop-logo.svg —
// the same mark the cashier sees on the POS) into pixel buffers so the
// Warehouse14 Owner OS app icon / splash are the genuine brand, not an
// invented placeholder. Kept dependency-free on purpose: no sharp / resvg /
// canvas is installed on this machine, and the icon pipeline must run anywhere
// Node runs (see generate-icon.mjs).
//
// Supported SVG subset (sufficient for shop-logo.svg):
//   <path d="…">  with M m L l H h V v C c S s Q q T t A a Z z
//   <rect x y width height>
//   <circle cx cy r>
//   <polygon points="…">
//   <g> … </g>  (flattened; the source has no transforms)
// Fill rule: non-zero winding (SVG default). All shapes render as a single
// monochrome coverage mask (the source has no per-shape fills), which the icon
// generator then tints with the brand brass and composites onto the dark panel.

import fs from "node:fs"

// ── tiny path-data tokenizer ─────────────────────────────────────────────────
function tokenizePath(d) {
  const out = []
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g
  let m
  while ((m = re.exec(d)) !== null) {
    if (m[1]) out.push({ cmd: m[1] })
    else out.push({ num: parseFloat(m[2]) })
  }
  return out
}

// Flatten a cubic Bézier into line points (adaptive-ish fixed subdivision).
function cubic(p0, p1, p2, p3, steps, push) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0]
    const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
    push(x, y)
  }
}
function quad(p0, p1, p2, steps, push) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]
    const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
    push(x, y)
  }
}

// SVG elliptical arc → cubic segments. Implements the endpoint→center param
// conversion from the SVG spec (Appendix F.6).
function arc(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2, push) {
  if (rx === 0 || ry === 0) { push(x2, y2); return }
  rx = Math.abs(rx); ry = Math.abs(ry)
  const phi = (phiDeg * Math.PI) / 180
  const cosP = Math.cos(phi), sinP = Math.sin(phi)
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2
  const x1p = cosP * dx + sinP * dy
  const y1p = -sinP * dx + cosP * dy
  let rxs = rx * rx, rys = ry * ry
  const lambda = (x1p * x1p) / rxs + (y1p * y1p) / rys
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; rxs = rx * rx; rys = ry * ry }
  let denom = rxs * y1p * y1p + rys * x1p * x1p
  let num = rxs * rys - rxs * y1p * y1p - rys * x1p * x1p
  let co = Math.sqrt(Math.max(0, num / denom))
  if (largeArc === sweep) co = -co
  const cxp = (co * rx * y1p) / ry
  const cyp = (-co * ry * x1p) / rx
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2
  const ang = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy)
    let a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))))
    if (ux * vy - uy * vx < 0) a = -a
    return a
  }
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dTheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI
  const segs = Math.max(2, Math.ceil(Math.abs(dTheta) / (Math.PI / 32)))
  for (let i = 1; i <= segs; i++) {
    const t = theta1 + (dTheta * i) / segs
    const x = cosP * rx * Math.cos(t) - sinP * ry * Math.sin(t) + cx
    const y = sinP * rx * Math.cos(t) + cosP * ry * Math.sin(t) + cy
    push(x, y)
  }
}

// Parse one <path d> into an array of subpaths (each a closed loop of points).
function pathToLoops(d, curveSteps = 24) {
  const toks = tokenizePath(d)
  const loops = []
  let cur = []
  let x = 0, y = 0, startX = 0, startY = 0
  let prevCtrl = null // for S/T smooth
  let prevCmd = ""
  let i = 0
  const num = () => toks[i++].num
  const push = (nx, ny) => { cur.push([nx, ny]); x = nx; y = ny }
  const closeLoop = () => { if (cur.length > 1) loops.push(cur); cur = [] }

  while (i < toks.length) {
    let cmd
    if (toks[i].cmd) { cmd = toks[i].cmd; i++ } else { cmd = prevCmd === "M" ? "L" : prevCmd === "m" ? "l" : prevCmd }
    const rel = cmd === cmd.toLowerCase()
    switch (cmd.toUpperCase()) {
      case "M": {
        closeLoop()
        let nx = num(), ny = num()
        if (rel) { nx += x; ny += y }
        startX = nx; startY = ny; cur = []; push(nx, ny)
        break
      }
      case "L": {
        let nx = num(), ny = num()
        if (rel) { nx += x; ny += y }
        push(nx, ny)
        break
      }
      case "H": { let nx = num(); if (rel) nx += x; push(nx, y); break }
      case "V": { let ny = num(); if (rel) ny += y; push(x, ny); break }
      case "C": {
        let c1x = num(), c1y = num(), c2x = num(), c2y = num(), nx = num(), ny = num()
        if (rel) { c1x += x; c1y += y; c2x += x; c2y += y; nx += x; ny += y }
        cubic([x, y], [c1x, c1y], [c2x, c2y], [nx, ny], curveSteps, push)
        prevCtrl = [c2x, c2y]
        break
      }
      case "S": {
        let c2x = num(), c2y = num(), nx = num(), ny = num()
        if (rel) { c2x += x; c2y += y; nx += x; ny += y }
        const refl = prevCtrl && "CcSs".includes(prevCmd) ? [2 * x - prevCtrl[0], 2 * y - prevCtrl[1]] : [x, y]
        cubic([x, y], refl, [c2x, c2y], [nx, ny], curveSteps, push)
        prevCtrl = [c2x, c2y]
        break
      }
      case "Q": {
        let cx = num(), cy = num(), nx = num(), ny = num()
        if (rel) { cx += x; cy += y; nx += x; ny += y }
        quad([x, y], [cx, cy], [nx, ny], curveSteps, push)
        prevCtrl = [cx, cy]
        break
      }
      case "T": {
        let nx = num(), ny = num()
        if (rel) { nx += x; ny += y }
        const refl = prevCtrl && "QqTt".includes(prevCmd) ? [2 * x - prevCtrl[0], 2 * y - prevCtrl[1]] : [x, y]
        quad([x, y], refl, [nx, ny], curveSteps, push)
        prevCtrl = refl
        break
      }
      case "A": {
        const rx = num(), ry = num(), rot = num(), laf = num(), sf = num()
        let nx = num(), ny = num()
        if (rel) { nx += x; ny += y }
        arc(x, y, rx, ry, rot, laf, sf, nx, ny, push)
        prevCtrl = null
        break
      }
      case "Z": { push(startX, startY); closeLoop(); prevCtrl = null; break }
    }
    if ("CcSsQqTt".includes(cmd) === false) prevCtrl = "CcSsQqTt".includes(cmd) ? prevCtrl : null
    prevCmd = cmd
  }
  closeLoop()
  return loops
}

// rect / circle / polygon → loops
function rectLoops(x, y, w, h) {
  return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]]
}
function circleLoops(cx, cy, r, steps = 64) {
  const loop = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI
    loop.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return [loop]
}
function polygonLoops(points) {
  const nums = points.trim().split(/[\s,]+/).map(parseFloat)
  const loop = []
  for (let i = 0; i + 1 < nums.length; i += 2) loop.push([nums[i], nums[i + 1]])
  if (loop.length) loop.push(loop[0])
  return [loop]
}

// ── extract all fillable loops from an SVG string ────────────────────────────
function extractLoops(svg) {
  const loops = []
  const attr = (tag, name) => {
    const m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"'))
    return m ? m[1] : null
  }
  // paths
  for (const m of svg.matchAll(/<path\b[^>]*\bd\s*=\s*"([^"]*)"[^>]*>/g)) {
    for (const l of pathToLoops(m[1])) loops.push(l)
  }
  // rects
  for (const m of svg.matchAll(/<rect\b[^>]*>/g)) {
    const t = m[0]
    loops.push(...rectLoops(+attr(t, "x"), +attr(t, "y"), +attr(t, "width"), +attr(t, "height")))
  }
  // circles
  for (const m of svg.matchAll(/<circle\b[^>]*>/g)) {
    const t = m[0]
    loops.push(...circleLoops(+attr(t, "cx"), +attr(t, "cy"), +attr(t, "r")))
  }
  // polygons
  for (const m of svg.matchAll(/<polygon\b[^>]*>/g)) {
    const t = m[0]
    loops.push(...polygonLoops(attr(t, "points")))
  }
  return loops
}

function parseViewBox(svg) {
  const m = svg.match(/viewBox\s*=\s*"([^"]*)"/)
  if (!m) return null
  const [minX, minY, w, h] = m[1].trim().split(/[\s,]+/).map(parseFloat)
  return { minX, minY, w, h }
}

// ── rasterize loops → coverage mask (Float64 alpha 0..1) at given size ───────
// Maps the viewBox into a target box [ox,oy,boxW,boxH] inside a `size` canvas,
// preserving aspect ratio (contain). Non-zero winding via scanline crossings.
// Supersampled `ss×` for anti-aliasing.
function rasterizeCoverage({ svgPath, size, box, ss = 4 }) {
  const svg = fs.readFileSync(svgPath, "utf8")
  const vb = parseViewBox(svg)
  const loops = extractLoops(svg)
  const { ox, oy, boxW, boxH } = box

  // contain scale within the target box
  const scale = Math.min(boxW / vb.w, boxH / vb.h)
  const drawnW = vb.w * scale, drawnH = vb.h * scale
  const offX = ox + (boxW - drawnW) / 2
  const offY = oy + (boxH - drawnH) / 2
  const tx = (px) => offX + (px - vb.minX) * scale
  const ty = (py) => offY + (py - vb.minY) * scale

  // transform loops to device pixels
  const dev = loops.map((loop) => loop.map(([px, py]) => [tx(px) * ss, ty(py) * ss]))

  const W = size * ss, H = size * ss
  const acc = new Float64Array(size * size) // downsampled coverage
  // scanline at supersample resolution, accumulate into downsampled grid
  // To keep memory modest we render row-by-row at SS res and fold into acc.
  for (let sy = 0; sy < H; sy++) {
    const yc = sy + 0.5
    // collect x-crossings with winding direction
    const xs = []
    for (const loop of dev) {
      for (let k = 0; k + 1 < loop.length; k++) {
        const [x0, y0] = loop[k]
        const [x1, y1] = loop[k + 1]
        if (y0 === y1) continue
        const lo = Math.min(y0, y1), hi = Math.max(y0, y1)
        if (yc < lo || yc >= hi) continue
        const t = (yc - y0) / (y1 - y0)
        const x = x0 + t * (x1 - x0)
        xs.push([x, y1 > y0 ? 1 : -1])
      }
    }
    if (!xs.length) continue
    xs.sort((a, b) => a[0] - b[0])
    // non-zero winding spans
    let wind = 0
    const oy2 = Math.floor(sy / ss)
    for (let k = 0; k + 1 < xs.length; k++) {
      wind += xs[k][1]
      if (wind !== 0) {
        let xa = xs[k][0], xb = xs[k + 1][0]
        if (xb <= xa) continue
        let xi = Math.floor(xa), xj = Math.ceil(xb)
        for (let sx = Math.max(0, xi); sx < Math.min(W, xj); sx++) {
          const cellA = Math.max(xa, sx), cellB = Math.min(xb, sx + 1)
          const c = cellB - cellA
          if (c > 0) acc[oy2 * size + Math.floor(sx / ss)] += c
        }
      }
    }
  }
  const norm = ss * ss
  for (let i = 0; i < acc.length; i++) acc[i] = Math.min(1, acc[i] / norm)
  return { coverage: acc, size }
}

export { rasterizeCoverage, parseViewBox, extractLoops }
