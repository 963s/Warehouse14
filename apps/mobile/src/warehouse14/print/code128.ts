/**
 * Pure Code 128-B encoder → SVG bars. No native dependency, no barcode font: it
 * emits a self-contained `<svg>` of black bars that any 1-D scanner reads. Used
 * for the printable product label so a SKU/barcode sticker is actually
 * SCANNABLE at the till (previously the label printed only the human digits).
 *
 * Code Set B covers ASCII 32–126 — enough for the "W14-YYMMDD-XXXX" SKU.
 */

// The 107 Code 128 symbol patterns (values 0–106). Each string is the run of
// module widths: bar, space, bar, space, bar, space (value 106 = Stop = 7 runs).
const PATTERNS: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
]

const START_B = 104
const STOP = 106

/** Module run-lengths for the full symbol (starts with a bar). */
function encodeRuns(text: string): number[] {
  let weighted = START_B
  const values: number[] = [START_B]
  let pos = 0
  for (let i = 0; i < text.length; i++) {
    const v = text.charCodeAt(i) - 32
    if (v < 0 || v > 94) continue // outside Code Set B — skip
    pos += 1
    values.push(v)
    weighted += v * pos
  }
  values.push(weighted % 103) // checksum
  values.push(STOP)

  const runs: number[] = []
  for (const value of values) {
    const pattern = PATTERNS[value]
    for (const ch of pattern) runs.push(Number(ch))
  }
  return runs
}

export interface BarcodeSvgOptions {
  /** Bar height in px. */
  height?: number
  /** Width of one module (the thinnest bar) in px. */
  moduleWidth?: number
  /** Bar colour. */
  color?: string
}

/**
 * A standalone `<svg>` string of Code 128-B bars for `text`. Embed it directly
 * in the print HTML or a react-native-svg `SvgXml`. Returns an empty string for
 * empty input.
 */
export function code128Svg(text: string, opts: BarcodeSvgOptions = {}): string {
  if (!text) return ""
  const height = opts.height ?? 46
  const m = opts.moduleWidth ?? 1.6
  const color = opts.color ?? "#1a1208"
  const runs = encodeRuns(text)

  let x = 0
  const rects: string[] = []
  for (let i = 0; i < runs.length; i++) {
    const width = runs[i] * m
    // Runs alternate bar, space, bar, …; even index = bar.
    if (i % 2 === 0) {
      rects.push(
        `<rect x="${x.toFixed(2)}" y="0" width="${width.toFixed(2)}" height="${height}" fill="${color}"/>`,
      )
    }
    x += width
  }
  const total = x.toFixed(2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${height}" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none">${rects.join("")}</svg>`
}

export interface Code128Bar {
  x: number
  width: number
}

/**
 * Bar geometry for `text` (the same Code 128-B symbol as `code128Svg`), for
 * drawing with react-native-svg `<Rect>`. `width` is the total symbol width in
 * the given module units; scale a viewBox to it. Empty input → no bars.
 */
export function code128Bars(text: string, moduleWidth = 1): { bars: Code128Bar[]; width: number } {
  if (!text) return { bars: [], width: 0 }
  const runs = encodeRuns(text)
  let x = 0
  const bars: Code128Bar[] = []
  for (let i = 0; i < runs.length; i++) {
    const w = runs[i] * moduleWidth
    if (i % 2 === 0) bars.push({ x, width: w })
    x += w
  }
  return { bars, width: x }
}
