/**
 * Zielkarte instruments — reference-matched layout with a PHYSICAL primitive
 * kit underneath. Nothing is a "circle with a dot" anymore:
 *
 *  · Coin    — a real minted coin seen at an angle: elliptical face, a visible
 *              THICKNESS band (extruded edge), reeding ticks along that edge,
 *              two embossed face rings, a crescent light, and its own contact
 *              shadow cast on whatever lies beneath. Coins stack in depth rows
 *              (back rows smaller + dimmed), some tilted, some leaning.
 *  · Nugget  — irregular faceted gold grain (jittered hexagon + light/dark
 *              facets), for the gold tank.
 *  · Pebble  — rounded silver granule with double highlight, for the silver
 *              tank. Both pack with occlusion gaps, not floating dots.
 *  · IRON/BRASS/GLASS/ENGRAVE — gunmetal bezels with machining, brass accents,
 *              sheened glass, twice-struck lettering.
 *
 * No SVG filters/blur — depth is stacked light/dark geometry only (iOS +
 * Android react-native-svg safe). Worklet helpers carry "worklet"; animated
 * SVG components are module-scope; gradient ids are namespaced per instrument.
 */
import { type ReactNode, useEffect } from "react"
import { View } from "react-native"
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated"
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg"

import { Text } from "@/components/ui/text"
import { useReduceMotion } from "@/warehouse14/ui/motion/useReduceMotion"
import { TREASURE_COLORS as C, type GoalMetric, type MonthlyBar } from "./treasure-data"

const AnimatedRect = Animated.createAnimatedComponent(Rect)
const AnimatedLine = Animated.createAnimatedComponent(Line)
const AnimatedG = Animated.createAnimatedComponent(G)
const AnimatedCircle = Animated.createAnimatedComponent(Circle)

const SPRING = { damping: 16, stiffness: 80, mass: 1.1 } as const
const SVG_W = 156

// brass (accents)
const B_SPEC = "#f8e4ac"
const B_HI = "#e9cb82"
const B_MID = "#c9a55c"
const B_DEEP = "#8a6d2f"
const B_SEAT = "#33270f"
const GLINT = "#fff7e0"
// gunmetal iron
const I_HI = "#565c66"
const I_MID = "#33373e"
const I_DEEP = "#17191d"
const I_SEAT = "#0b0c0e"
// band ramp
const R_RED = "#c33b24"
const R_AMBER = "#e0a52e"
const R_GREEN = "#3fae4e"
// lettering
const GOLD_TXT = "#e3c983"
const MUTED_TXT = "#9a8b66"

function useFill(ratio: number): SharedValue<number> {
  const reduce = useReduceMotion()
  const v = useSharedValue(reduce ? ratio : 0)
  useEffect(() => {
    v.value = reduce ? ratio : withSpring(ratio, SPRING)
  }, [ratio, reduce, v])
  return v
}

function deg2rad(d: number): number {
  "worklet"
  return (d * Math.PI) / 180
}
function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  "worklet"
  return { x: cx + r * Math.cos(deg2rad(deg)), y: cy + r * Math.sin(deg2rad(deg)) }
}
function arc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const s = polar(cx, cy, r, startDeg)
  const e = polar(cx, cy, r, endDeg)
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  const sweep = endDeg > startDeg ? 1 : 0
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} ${sweep} ${e.x} ${e.y}`
}
function crescent(cx: number, cy: number, r: number): string {
  return arc(cx, cy, r, 196, 292)
}
function hexPts(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 })
    .map((_, i) => {
      const p = polar(cx, cy, r, i * 60 - 90)
      return `${p.x},${p.y}`
    })
    .join(" ")
}
/** Deterministic pseudo-random stream — aged surfaces must not re-roll per render. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function bandColor(f: number): string {
  return f < 0.34 ? R_RED : f < 0.66 ? R_AMBER : R_GREEN
}

// ─────────────────────────────────────────────────────────────────────────────
// PHYSICAL PRIMITIVES — coins, nuggets, pebbles
// ─────────────────────────────────────────────────────────────────────────────

const COIN_METAL = {
  gold: {
    face: ["#ffefb4", "#e3bc62", "#a37a29"],
    edge: ["#8a5e1f", "#5c3d10"],
    ring: "#8a5e1f",
    ring2: "#f4d88f",
    lip: "#fff3c9",
  },
  silver: {
    face: ["#ffffff", "#cdd3da", "#818a94"],
    edge: ["#5d656e", "#3a4048"],
    ring: "#6d757e",
    ring2: "#eef2f6",
    lip: "#ffffff",
  },
} as const

/** The visible thickness band between the coin face and its underside. */
function coinBand(cx: number, cy: number, r: number, ry: number, t: number): string {
  return [
    `M ${cx - r} ${cy}`,
    `A ${r} ${ry} 0 0 0 ${cx + r} ${cy}`,
    `L ${cx + r} ${cy + t}`,
    `A ${r} ${ry} 0 0 1 ${cx - r} ${cy + t}`,
    "Z",
  ].join(" ")
}

/**
 * A minted coin at an angle. `tilt` is the perspective squash of the face
 * (0.35 = lying flatter, 0.55 = facing you more). `rot` leans the whole coin.
 * Draw order: contact shadow → thickness band → reeding → face → embossing.
 * Gradients are global per metal (defined once per Svg via <CoinDefs/>).
 */
function Coin({
  cx,
  cy,
  r,
  tilt = 0.44,
  rot = 0,
  metal,
  dim = 0,
  shadow = true,
}: {
  cx: number
  cy: number
  r: number
  tilt?: number
  rot?: number
  metal: "gold" | "silver"
  /** 0..1 — back-row coins sit in the hoard's shade. */
  dim?: number
  shadow?: boolean
}): ReactNode {
  const m = COIN_METAL[metal]
  const ry = r * tilt
  const t = r * 0.3
  const g = metal === "gold" ? "pcG" : "pcS"
  return (
    <G transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined}>
      {shadow ? (
        <Ellipse cx={cx + r * 0.12} cy={cy + t + ry * 0.55} rx={r * 1.02} ry={ry * 0.8} fill="#000" opacity={0.38} />
      ) : null}
      {/* thickness band + reeding ticks along the lower edge */}
      <Path d={coinBand(cx, cy, r, ry, t)} fill={`url(#${g}e)`} stroke={m.edge[1]} strokeWidth={0.4} />
      {Array.from({ length: 9 }).map((_, i) => {
        const a = 200 + i * 17.5
        const fx = cx + r * Math.cos(deg2rad(a))
        const fy = cy + ry * Math.sin(deg2rad(a))
        return <Line key={i} x1={fx} y1={fy + 0.6} x2={fx} y2={fy + t - 0.4} stroke={i % 2 === 0 ? m.edge[1] : m.lip} strokeWidth={0.55} opacity={i % 2 === 0 ? 0.9 : 0.45} />
      })}
      {/* face + embossed rings + relief + crescent light */}
      <Ellipse cx={cx} cy={cy} rx={r} ry={ry} fill={`url(#${g}f)`} stroke={m.edge[0]} strokeWidth={0.5} />
      <Ellipse cx={cx} cy={cy} rx={r * 0.74} ry={ry * 0.74} fill="none" stroke={m.ring} strokeWidth={0.55} opacity={0.8} />
      <Ellipse cx={cx} cy={cy + ry * 0.06} rx={r * 0.74} ry={ry * 0.74} fill="none" stroke={m.ring2} strokeWidth={0.4} opacity={0.5} />
      <Ellipse cx={cx} cy={cy} rx={r * 0.42} ry={ry * 0.42} fill="none" stroke={m.ring} strokeWidth={0.45} opacity={0.55} />
      {/* tiny die relief: a struck pellet at centre */}
      <Ellipse cx={cx} cy={cy} rx={r * 0.13} ry={ry * 0.13} fill={m.ring} opacity={0.6} />
      <Ellipse cx={cx - r * 0.04} cy={cy - ry * 0.06} rx={r * 0.09} ry={ry * 0.09} fill={m.lip} opacity={0.5} />
      <Path d={`M ${cx - r * 0.72} ${cy - ry * 0.28} A ${r * 0.78} ${ry * 0.78} 0 0 1 ${cx + r * 0.1} ${cy - ry * 0.76}`} stroke={m.lip} strokeWidth={0.9} opacity={0.75} fill="none" strokeLinecap="round" />
      <Circle cx={cx - r * 0.42} cy={cy - ry * 0.42} r={0.8} fill="#fff" opacity={0.9} />
      {dim > 0 ? <Ellipse cx={cx} cy={cy + t / 2} rx={r + 0.6} ry={ry + t * 0.8} fill="#000" opacity={dim} /> : null}
    </G>
  )
}

/** Shared coin gradients — mount ONCE inside any <Defs> that draws coins. */
function CoinDefs(): ReactNode {
  return (
    <>
      <RadialGradient id="pcGf" cx="0.35" cy="0.28" r="0.95">
        <Stop offset="0" stopColor={COIN_METAL.gold.face[0]} />
        <Stop offset="0.55" stopColor={COIN_METAL.gold.face[1]} />
        <Stop offset="1" stopColor={COIN_METAL.gold.face[2]} />
      </RadialGradient>
      <LinearGradient id="pcGe" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={COIN_METAL.gold.edge[0]} />
        <Stop offset="1" stopColor={COIN_METAL.gold.edge[1]} />
      </LinearGradient>
      <RadialGradient id="pcSf" cx="0.35" cy="0.28" r="0.95">
        <Stop offset="0" stopColor={COIN_METAL.silver.face[0]} />
        <Stop offset="0.55" stopColor={COIN_METAL.silver.face[1]} />
        <Stop offset="1" stopColor={COIN_METAL.silver.face[2]} />
      </RadialGradient>
      <LinearGradient id="pcSe" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={COIN_METAL.silver.edge[0]} />
        <Stop offset="1" stopColor={COIN_METAL.silver.edge[1]} />
      </LinearGradient>
    </>
  )
}

/** Irregular faceted gold grain — jittered hexagon, lit + shadow facets. */
function Nugget({ cx, cy, r, seedN }: { cx: number; cy: number; r: number; seedN: number }): ReactNode {
  const rnd = seeded(seedN)
  const pts: Array<{ x: number; y: number }> = Array.from({ length: 6 }).map((_, i) => {
    const a = i * 60 + rnd() * 26 - 13
    const rr = r * (0.78 + rnd() * 0.4)
    return { x: cx + rr * Math.cos(deg2rad(a)), y: cy + rr * Math.sin(deg2rad(a)) }
  })
  const poly = pts.map((p) => `${p.x},${p.y}`).join(" ")
  return (
    <G>
      <Polygon points={poly} fill="url(#pcGf)" stroke="#6e4a12" strokeWidth={0.5} />
      {/* lit facet up-left, occluded facet down-right */}
      <Polygon points={`${pts[3].x},${pts[3].y} ${pts[4].x},${pts[4].y} ${cx},${cy}`} fill="#fff3c9" opacity={0.5} />
      <Polygon points={`${pts[0].x},${pts[0].y} ${pts[1].x},${pts[1].y} ${cx},${cy}`} fill="#5c3d10" opacity={0.45} />
      <Circle cx={cx - r * 0.3} cy={cy - r * 0.35} r={0.8} fill="#fff" opacity={0.9} />
    </G>
  )
}

/** Rounded silver granule with a soft double highlight. */
function Pebble({ cx, cy, r, seedN }: { cx: number; cy: number; r: number; seedN: number }): ReactNode {
  const rnd = seeded(seedN)
  const sq = 0.82 + rnd() * 0.26
  const tiltDeg = rnd() * 40 - 20
  return (
    <G transform={`rotate(${tiltDeg} ${cx} ${cy})`}>
      <Ellipse cx={cx} cy={cy} rx={r} ry={r * sq} fill="url(#pcSf)" stroke="#575e67" strokeWidth={0.45} />
      <Path d={`M ${cx - r * 0.62} ${cy - r * sq * 0.2} A ${r * 0.7} ${r * sq * 0.7} 0 0 1 ${cx + r * 0.08} ${cy - r * sq * 0.66}`} stroke="#fff" strokeWidth={0.8} opacity={0.7} fill="none" strokeLinecap="round" />
      <Circle cx={cx - r * 0.34} cy={cy - r * sq * 0.34} r={0.9} fill="#fff" opacity={0.9} />
      <Path d={arc(cx, cy, r * 0.82, 20, 120)} stroke="#2f353c" strokeWidth={0.8} opacity={0.4} fill="none" />
    </G>
  )
}

// ── shared material gradients ────────────────────────────────────────────────

function Brass5({ id, h = false }: { id: string; h?: boolean }): ReactNode {
  return (
    <LinearGradient id={id} x1="0" y1="0" x2={h ? "1" : "0.85"} y2={h ? "0.2" : "1"}>
      <Stop offset="0" stopColor="#fdecb2" />
      <Stop offset="0.22" stopColor={B_HI} />
      <Stop offset="0.5" stopColor={B_MID} />
      <Stop offset="0.78" stopColor={B_DEEP} />
      <Stop offset="1" stopColor="#31240c" />
    </LinearGradient>
  )
}
function BrassDomeGrad({ id }: { id: string }): ReactNode {
  return (
    <RadialGradient id={id} cx="0.34" cy="0.28" r="0.9">
      <Stop offset="0" stopColor="#fdecb2" />
      <Stop offset="0.45" stopColor={B_MID} />
      <Stop offset="1" stopColor="#31240c" />
    </RadialGradient>
  )
}
function IronGrad({ id, h = false }: { id: string; h?: boolean }): ReactNode {
  return (
    <LinearGradient id={id} x1="0" y1="0" x2={h ? "1" : "0.7"} y2={h ? "0.2" : "1"}>
      <Stop offset="0" stopColor={I_HI} />
      <Stop offset="0.5" stopColor={I_MID} />
      <Stop offset="1" stopColor={I_DEEP} />
    </LinearGradient>
  )
}
function IronDomeGrad({ id }: { id: string }): ReactNode {
  return (
    <RadialGradient id={id} cx="0.34" cy="0.28" r="0.9">
      <Stop offset="0" stopColor="#8d939c" />
      <Stop offset="0.5" stopColor={I_MID} />
      <Stop offset="1" stopColor={I_SEAT} />
    </RadialGradient>
  )
}

function Rivet({ cx, cy, r, dome, dim = false }: { cx: number; cy: number; r: number; dome: string; dim?: boolean }): ReactNode {
  return (
    <G>
      <Circle cx={cx + r * 0.45} cy={cy + r * 0.55} r={r} fill="#000" opacity={0.6} />
      <Circle cx={cx} cy={cy} r={r + 0.7} fill="none" stroke="#00000059" strokeWidth={0.6} />
      <Circle cx={cx} cy={cy} r={r} fill={`url(#${dome})`} />
      <Circle cx={cx - r * 0.4} cy={cy - r * 0.45} r={r * 0.38} fill={GLINT} opacity={dim ? 0.3 : 0.75} />
    </G>
  )
}

function Engraved({
  x,
  y,
  size,
  children,
  color = GOLD_TXT,
  anchor = "middle",
  weight = "700",
}: {
  x: number
  y: number
  size: number
  children: string
  color?: string
  anchor?: "start" | "middle" | "end"
  weight?: "600" | "700" | "800"
}): ReactNode {
  return (
    <G>
      <SvgText x={x} y={y + 0.7} fill="#000" opacity={0.9} fontSize={size} fontWeight={weight} textAnchor={anchor}>
        {children}
      </SvgText>
      <SvgText x={x} y={y} fill={color} fontSize={size} fontWeight={weight} textAnchor={anchor}>
        {children}
      </SvgText>
    </G>
  )
}

function SvgPlate({
  x,
  y,
  w,
  h,
  value,
  pct,
  tone,
  valueColor = "#eadfc2",
  brass,
}: {
  x: number
  y: number
  w: number
  h: number
  value: string
  pct: string | null
  tone: string
  valueColor?: string
  brass: string
}): ReactNode {
  const cx = x + w / 2
  return (
    <G>
      <Rect x={x + 1} y={y + 1.4} width={w} height={h} rx={4} fill="#000" opacity={0.6} />
      <Rect x={x} y={y} width={w} height={h} rx={4} fill="#0d0b08" stroke={`url(#${brass})`} strokeWidth={1.4} />
      <Rect x={x + 2} y={y + 2} width={w - 4} height={h - 4} rx={2.5} fill="none" stroke="#000" strokeWidth={0.8} opacity={0.6} />
      <Engraved x={cx} y={y + (pct != null ? h / 2 : h / 2 + 3.4)} size={pct != null ? 11.5 : 12} color={valueColor} weight="800">
        {value}
      </Engraved>
      {pct != null ? (
        <Engraved x={cx} y={y + h - 4.5} size={8} color={tone} weight="800">
          {pct}
        </Engraved>
      ) : null}
    </G>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Frame + shared plate
// ─────────────────────────────────────────────────────────────────────────────

export function WidgetFrame({
  title,
  zielText,
  children,
  wide = false,
}: {
  title: string
  zielText: string
  children: ReactNode
  wide?: boolean
}): ReactNode {
  return (
    <View
      style={{
        flex: wide ? undefined : 1,
        width: wide ? "100%" : undefined,
        backgroundColor: "#161310",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#292319",
        borderTopColor: "#38301f",
        borderBottomColor: "#0a0806",
        paddingHorizontal: 10,
        paddingTop: 10,
        paddingBottom: 11,
        gap: 6,
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      <Svg
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        pointerEvents="none"
      >
        <Defs>
          <RadialGradient id="fr_vig" cx="0.5" cy="0.3" r="1">
            <Stop offset="0" stopColor="#2b2416" stopOpacity={0.35} />
            <Stop offset="0.55" stopColor="#15120c" stopOpacity={0} />
            <Stop offset="1" stopColor="#000" stopOpacity={0.55} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={100} height={100} fill="url(#fr_vig)" />
        <Rect x={0} y={0} width={100} height={1.6} fill="#4a3f29" opacity={0.4} />
      </Svg>
      <View style={{ alignItems: "center", gap: 1 }}>
        <Text
          style={{
            color: GOLD_TXT,
            fontSize: title.length > 14 ? 11 : 12.5,
            fontWeight: "800",
            letterSpacing: title.length > 14 ? 0.6 : 1,
            textShadowColor: "#000",
            textShadowOffset: { width: 0, height: 1.2 },
            textShadowRadius: 1,
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text style={{ color: MUTED_TXT, fontSize: 10 }} numberOfLines={1}>
          {zielText}
        </Text>
      </View>
      {children}
    </View>
  )
}

function ValuePlate({ value, pct, tone, valueColor }: { value: string; pct: string | null; tone: string; valueColor?: string }): ReactNode {
  return (
    <View
      style={{
        backgroundColor: "#0d0b08",
        borderRadius: 7,
        borderWidth: 1.5,
        borderColor: B_DEEP,
        borderTopColor: "#241a0b",
        borderLeftColor: "#3d2f14",
        borderBottomColor: B_HI,
        paddingHorizontal: 14,
        paddingVertical: 4,
        alignItems: "center",
        minWidth: "62%",
      }}
    >
      <Text
        style={{
          color: valueColor ?? "#eadfc2",
          fontSize: 17,
          fontWeight: "800",
          textShadowColor: "#000",
          textShadowOffset: { width: 0, height: 1.2 },
          textShadowRadius: 1,
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
      {pct != null ? (
        <Text style={{ color: tone, fontSize: 10.5, fontWeight: "800", marginTop: -2 }}>{pct}</Text>
      ) : null}
    </View>
  )
}

function LockedFace({ height }: { height: number }): ReactNode {
  return (
    <View style={{ height, alignItems: "center", justifyContent: "center", width: "100%" }}>
      <Svg width="100%" height={height} viewBox={`0 0 ${SVG_W} ${height}`}>
        <Defs>
          <IronGrad id="lk_rim" />
          <RadialGradient id="lk_glass" cx="0.4" cy="0.35" r="0.8">
            <Stop offset="0" stopColor="#181510" />
            <Stop offset="1" stopColor="#060504" />
          </RadialGradient>
        </Defs>
        <Circle cx={SVG_W / 2} cy={height / 2} r={30} fill="url(#lk_glass)" stroke="url(#lk_rim)" strokeWidth={4} />
        <Path d={crescent(SVG_W / 2, height / 2, 30)} stroke="#8d939c" strokeWidth={1} opacity={0.4} fill="none" />
        <Ellipse cx={SVG_W / 2 - 9} cy={height / 2 - 10} rx={9} ry={5} fill="#fff" opacity={0.05} />
        <Engraved x={SVG_W / 2} y={height / 2 + 3} size={8} color="#8d8065">
          gleich verfügbar
        </Engraved>
      </Svg>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Instruments
// ─────────────────────────────────────────────────────────────────────────────

/** Half-round manometer: iron bezel + top hex boss, radially BRUSHED dial, a
 *  bevel ring under the enamel band, graduations struck over the colours,
 *  engraved labels, a gold needle with counterweight ring on a jewel hub. */
function ArcGauge({ fill }: { fill: SharedValue<number> }): ReactNode {
  const h = 104
  const cx = SVG_W / 2
  const cy = 88
  const r = 62
  const needleRot = useAnimatedProps(() => {
    "worklet"
    return { rotation: 180 + fill.value * 180 } as never
  })
  const blade = `M ${-12} 2.4 L ${r - 16} 0.8 L ${r - 10} 0 L ${r - 16} -0.8 L ${-12} -2.4 Z`
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${SVG_W} ${h}`}>
      <Defs>
        <IronGrad id="ag_bezel" />
        <IronDomeGrad id="ag_idome" />
        <Brass5 id="ag_brass" />
        <BrassDomeGrad id="ag_dome" />
        <RadialGradient id="ag_dial" cx="0.42" cy="0.3" r="1">
          <Stop offset="0" stopColor="#242019" />
          <Stop offset="0.55" stopColor="#14110c" />
          <Stop offset="1" stopColor="#060503" />
        </RadialGradient>
        <RadialGradient id="ag_jewel" cx="0.36" cy="0.3" r="0.9">
          <Stop offset="0" stopColor="#ff8f7a" />
          <Stop offset="0.5" stopColor="#b03020" />
          <Stop offset="1" stopColor="#4a0e06" />
        </RadialGradient>
      </Defs>
      <Ellipse cx={cx + 2} cy={cy + 6} rx={r + 9} ry={6} fill="#000" opacity={0.45} />
      {/* dial face + radial brushing + bevel ring under the band */}
      <Path d={arc(cx, cy, r - 11, 176, 364)} stroke="url(#ag_dial)" strokeWidth={32} fill="none" />
      {Array.from({ length: 25 }).map((_, i) => {
        const a = 180 + i * 7.5
        const p1 = polar(cx, cy, 12, a)
        const p2 = polar(cx, cy, r - 12, a)
        return <Line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#fff" strokeWidth={0.5} opacity={0.03} />
      })}
      <Path d={arc(cx, cy, r - 11.4, 180, 360)} stroke="#000" strokeWidth={1.6} opacity={0.6} fill="none" />
      <Path d={arc(cx, cy, r - 12.8, 180, 360)} stroke="#5b5142" strokeWidth={0.7} opacity={0.5} fill="none" />
      {/* iron bezel */}
      <Path d={arc(cx, cy, r + 3, 170, 370)} stroke={I_SEAT} strokeWidth={12} fill="none" strokeLinecap="round" />
      <Path d={arc(cx, cy, r + 3, 171, 369)} stroke="url(#ag_bezel)" strokeWidth={9} fill="none" strokeLinecap="round" />
      <Path d={crescent(cx, cy, r + 4.4)} stroke="#9aa1ab" strokeWidth={1.5} opacity={0.75} fill="none" strokeLinecap="round" />
      <Path d={arc(cx, cy, r + 3, 20, 92)} stroke="#05070a" strokeWidth={2.2} opacity={0.6} fill="none" />
      {/* enamel band + struck graduations */}
      {Array.from({ length: 60 }).map((_, i) => {
        const f = i / 59
        const a = 180 + f * 180
        const p1 = polar(cx, cy, r - 3, a)
        const p2 = polar(cx, cy, r - 9.5, a)
        return <Line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={bandColor(f)} strokeWidth={2.6} />
      })}
      {Array.from({ length: 31 }).map((_, i) => {
        const a = 180 + i * 6
        const major = i % 5 === 0
        const p1 = polar(cx, cy, r - 2.6, a)
        const p2 = polar(cx, cy, r - (major ? 10.5 : 6.5), a)
        return <Line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#140f08" strokeWidth={major ? 1.3 : 0.6} opacity={0.85} />
      })}
      <Path d={arc(cx, cy, r - 10.4, 180, 360)} stroke="#000" strokeWidth={1.2} opacity={0.5} fill="none" />
      <Engraved x={cx - r + 16} y={cy - 4} size={7.5}>0%</Engraved>
      <Engraved x={cx} y={cy - r + 22} size={7.5}>50%</Engraved>
      <Engraved x={cx + r - 16} y={cy - 4} size={7.5}>100%</Engraved>
      <Engraved x={cx} y={cy - 14} size={5.6} color="#7d6f49" weight="600">W-14</Engraved>
      {/* top hex boss + side tabs + base screws */}
      <Polygon points={hexPts(cx, cy - r - 4, 5.4)} fill="url(#ag_idome)" stroke={I_SEAT} strokeWidth={0.7} />
      <Circle cx={cx - 1.6} cy={cy - r - 5.6} r={1.4} fill="#c7ccd3" opacity={0.8} />
      <Rect x={cx - r - 11} y={cy - 7} width={12} height={13} rx={2} fill="url(#ag_bezel)" stroke={I_SEAT} strokeWidth={0.7} />
      <Rect x={cx + r - 1} y={cy - 7} width={12} height={13} rx={2} fill="url(#ag_bezel)" stroke={I_SEAT} strokeWidth={0.7} />
      <Rivet cx={cx - r - 5} cy={cy - 0.5} r={1.6} dome="ag_idome" />
      <Rivet cx={cx + r + 5} cy={cy - 0.5} r={1.6} dome="ag_idome" dim />
      <Rivet cx={cx - 26} cy={cy - 2} r={1.5} dome="ag_dome" />
      <Rivet cx={cx + 26} cy={cy - 2} r={1.5} dome="ag_dome" dim />
      {/* needle: shadow lags · gold blade · counterweight RING */}
      <AnimatedG animatedProps={needleRot} originX={cx} originY={cy}>
        <Path d={blade} x={cx + 1.4} y={cy + 2} fill="#000" opacity={0.45} />
        <Path d={blade} x={cx} y={cy} fill="url(#ag_brass)" stroke="#2a1e08" strokeWidth={0.4} />
        <Circle cx={cx - 12} cy={cy} r={3.4} fill="none" stroke="url(#ag_brass)" strokeWidth={2} />
      </AnimatedG>
      <Circle cx={cx} cy={cy} r={6.6} fill={B_SEAT} />
      <Circle cx={cx} cy={cy} r={5.4} fill="url(#ag_dome)" />
      <Circle cx={cx} cy={cy} r={2.2} fill="url(#ag_jewel)" />
      <Circle cx={cx - 0.8} cy={cy - 0.9} r={0.7} fill="#ffd9cf" opacity={0.9} />
      <Path d={arc(cx, cy - 4, r * 0.72, 206, 258)} stroke="#fff" strokeWidth={5} opacity={0.08} fill="none" strokeLinecap="round" />
    </Svg>
  )
}

/** Vault porthole: iron ring w/ washered bolts, double-knuckle hinge, latch,
 *  segmented enamel ring, deep chamber with twin glass reflections. */
function VaultRing({ pct, ratio }: { pct: string; ratio: number }): ReactNode {
  const h = 112
  const cx = SVG_W / 2
  const cy = h / 2 + 1
  const r = 36
  return (
    <View style={{ width: "100%" }}>
      <Svg width="100%" height={h} viewBox={`0 0 ${SVG_W} ${h}`}>
        <Defs>
          <IronGrad id="vp_rim" />
          <IronDomeGrad id="vp_bolt" />
          <Brass5 id="vp_brass" h />
          <RadialGradient id="vp_well" cx="0.42" cy="0.36" r="0.8">
            <Stop offset="0" stopColor="#232019" />
            <Stop offset="0.6" stopColor="#121009" />
            <Stop offset="1" stopColor="#050403" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={cx + 2} cy={cy + r + 12} rx={r + 8} ry={5} fill="#000" opacity={0.45} />
        <Rect x={cx - r - 24} y={cy - 15} width={10} height={30} rx={2} fill="url(#vp_brass)" stroke={B_SEAT} strokeWidth={0.8} />
        {[cy - 9, cy + 3].map((hy, i) => (
          <G key={i}>
            <Rect x={cx - r - 17} y={hy} width={9} height={7} rx={2.4} fill="url(#vp_brass)" stroke={B_SEAT} strokeWidth={0.7} />
            <Line x1={cx - r - 16} y1={hy + 1.2} x2={cx - r - 9} y2={hy + 1.2} stroke={GLINT} strokeWidth={0.6} opacity={0.7} />
          </G>
        ))}
        <Rivet cx={cx - r - 19} cy={cy - 11} r={1.4} dome="vp_bolt" />
        <Rivet cx={cx - r - 19} cy={cy + 11} r={1.4} dome="vp_bolt" />
        <Rect x={cx + r + 8} y={cy - 6} width={11} height={12} rx={2.5} fill="url(#vp_brass)" stroke={B_SEAT} strokeWidth={0.8} />
        <Rect x={cx + r + 11} y={cy + 4} width={5.5} height={13} rx={2.4} fill="url(#vp_brass)" stroke={B_SEAT} strokeWidth={0.7} />
        <Rivet cx={cx + r + 13.5} cy={cy - 2} r={1.4} dome="vp_bolt" dim />
        <Circle cx={cx} cy={cy} r={r + 11} fill={I_SEAT} />
        <Circle cx={cx} cy={cy} r={r + 10} fill="none" stroke="url(#vp_rim)" strokeWidth={11} />
        <Path d={crescent(cx, cy, r + 11)} stroke="#9aa1ab" strokeWidth={1.8} opacity={0.7} fill="none" strokeLinecap="round" />
        <Path d={arc(cx, cy, r + 11, 20, 96)} stroke="#04060a" strokeWidth={2.6} opacity={0.6} fill="none" />
        {Array.from({ length: 10 }).map((_, i) => {
          const a = i * 36 - 90
          const p = polar(cx, cy, r + 10, a)
          return <Rivet key={i} cx={p.x} cy={p.y} r={1.9} dome="vp_bolt" dim={a > 10 && a < 170} />
        })}
        <Circle cx={cx} cy={cy} r={r - 1} fill="none" stroke="#080604" strokeWidth={9.5} />
        {Array.from({ length: 22 }).map((_, i) => {
          const f = i / 21
          const a0 = -90 + f * 360
          const p = polar(cx, cy, r - 1, a0)
          const q = polar(cx, cy, r - 1, a0 + 10)
          const filled = f <= ratio || ratio >= 0.999
          return (
            <Path key={i} d={`M ${p.x} ${p.y} A ${r - 1} ${r - 1} 0 0 1 ${q.x} ${q.y}`} stroke={bandColor(f)} strokeWidth={8} opacity={filled ? 1 : 0.22} fill="none" />
          )
        })}
        <Circle cx={cx} cy={cy} r={r + 3.6} fill="none" stroke="#05070a" strokeWidth={1.4} opacity={0.8} />
        <Circle cx={cx} cy={cy} r={r - 6} fill="url(#vp_well)" />
        <Path d={arc(cx, cy, r - 7, 200, 290)} stroke="#000" strokeWidth={3} opacity={0.55} fill="none" />
        <Path d={arc(cx, cy, r - 8, 30, 88)} stroke="#6fa0b8" strokeWidth={1.2} opacity={0.25} fill="none" />
        <Ellipse cx={cx - 8} cy={cy - 10} rx={10} ry={5.4} fill="#fff" opacity={0.05} />
        <Ellipse cx={cx + 10} cy={cy + 12} rx={6} ry={3} fill="#6fa0b8" opacity={0.06} />
      </Svg>
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
        <Text
          style={{
            color: "#efe7d6",
            fontSize: 19,
            fontWeight: "800",
            textShadowColor: "#000",
            textShadowOffset: { width: 0, height: 1.4 },
            textShadowRadius: 2,
          }}
        >
          {pct}
        </Text>
      </View>
    </View>
  )
}

/** Thermometer with side value plate, silver tube, red column + bulb, right
 *  bracketed scale. */
function Thermometer({
  fill,
  tone,
  value,
  pct,
}: {
  fill: SharedValue<number>
  tone: string
  value: string
  pct: string | null
}): ReactNode {
  const h = 116
  const tx = 96
  const tubeTop = 14
  const tubeBot = 78
  const tubeH = tubeBot - tubeTop
  const mercury = useAnimatedProps(() => {
    "worklet"
    const fh = tubeH * fill.value
    return { y: tubeBot - fh, height: fh }
  })
  const meniscus = useAnimatedProps(() => {
    "worklet"
    return { cy: tubeBot - tubeH * fill.value } as never
  })
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${SVG_W} ${h}`}>
      <Defs>
        <Brass5 id="tm_brass" />
        <LinearGradient id="tm_tube" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#c9ccd1" />
          <Stop offset="0.3" stopColor="#f2f4f6" />
          <Stop offset="0.7" stopColor="#b9bdc4" />
          <Stop offset="1" stopColor="#8d929a" />
        </LinearGradient>
        <RadialGradient id="tm_bulb" cx="0.36" cy="0.3" r="0.85">
          <Stop offset="0" stopColor="#ff8266" />
          <Stop offset="0.55" stopColor="#e0452f" />
          <Stop offset="1" stopColor="#5a170c" />
        </RadialGradient>
        <LinearGradient id="tm_merc" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#ff7c60" />
          <Stop offset="0.5" stopColor="#d63a24" />
          <Stop offset="1" stopColor="#7c1e10" />
        </LinearGradient>
      </Defs>
      <SvgPlate x={8} y={34} w={70} h={34} value={value} pct={pct} tone={tone} brass="tm_brass" />
      <Ellipse cx={tx + 7} cy={tubeBot + 21} rx={16} ry={4} fill="#000" opacity={0.4} />
      <Rect x={tx} y={tubeTop - 4} width={14} height={tubeH + 12} rx={7} fill="url(#tm_tube)" stroke="#5d636c" strokeWidth={1.1} />
      <Rect x={tx + 2} y={tubeTop - 2} width={3} height={tubeH + 8} rx={1.5} fill="#fff" opacity={0.65} />
      <AnimatedRect x={tx + 3} width={8} fill="url(#tm_merc)" animatedProps={mercury} />
      <AnimatedCircle cx={tx + 7} r={4} fill="#d63a24" animatedProps={meniscus} />
      <Rect x={tx + 3} y={tubeBot - 2} width={8} height={5} fill="#d63a24" />
      <Circle cx={tx + 7} cy={tubeBot + 12} r={12.5} fill="url(#tm_bulb)" stroke="#4a2a20" strokeWidth={1} />
      <Path d={arc(tx + 7, tubeBot + 12, 10, 100, 250)} stroke="#3f0e05" strokeWidth={3} opacity={0.5} fill="none" />
      <Ellipse cx={tx + 2.4} cy={tubeBot + 7} rx={3.6} ry={2.4} fill="#ffe6da" opacity={0.9} />
      <Circle cx={tx + 3.5} cy={tubeBot + 8} r={1.1} fill="#fff" opacity={0.9} />
      <Line x1={tx + 22} y1={tubeTop} x2={tx + 22} y2={tubeBot} stroke={B_DEEP} strokeWidth={1.2} />
      {[0, 25, 50, 75, 100].map((p) => {
        const y = tubeBot - (tubeH * p) / 100
        return (
          <G key={p}>
            <Line x1={tx + 17} y1={y} x2={tx + 26} y2={y} stroke={B_MID} strokeWidth={1.2} />
            <Engraved x={tx + 30} y={y + 3} size={7.4} anchor="start">{`${p}%`}</Engraved>
          </G>
        )
      })}
      {[12.5, 37.5, 62.5, 87.5].map((p) => {
        const y = tubeBot - (tubeH * p) / 100
        return <Line key={p} x1={tx + 19} y1={y} x2={tx + 25} y2={y} stroke={B_DEEP} strokeWidth={0.7} opacity={0.8} />
      })}
    </Svg>
  )
}

/** Glass cylinder: REAL granulate — faceted nuggets (gold) or rounded pebbles
 *  (silver) packed with occlusion, heaping from the left behind sheened glass. */
function GlassTank({ fill, metal }: { fill: SharedValue<number>; metal: "silver" | "gold" }): ReactNode {
  const h = 96
  const x = 20
  const y = 24
  const w = SVG_W - 40
  const tankH = 44
  const cy = y + tankH / 2
  const innerX = x + 5
  const innerW = w - 10
  const gold = metal === "gold"
  const cover = useAnimatedProps(() => {
    "worklet"
    const fw = innerW * fill.value
    return { x: innerX + fw, width: Math.max(0, innerW - fw) }
  })
  const rnd = seeded(gold ? 910 : 920)
  const rows = [
    { ry: y + tankH - 7.5, rr: 4.4, n: 15, amp: 0 },
    { ry: y + tankH - 14.5, rr: 4.1, n: 14, amp: 1.6 },
    { ry: y + tankH - 21.5, rr: 3.9, n: 12, amp: 3.2 },
    { ry: y + tankH - 28, rr: 3.6, n: 10, amp: 5 },
  ]
  const grains: Array<{ gx: number; gy: number; gr: number; s: number; row: number }> = []
  rows.forEach((row, ri) => {
    for (let i = 0; i < row.n; i++) {
      const t = i / (row.n - 1)
      grains.push({
        gx: innerX + 5 + (innerW - 10) * t + (rnd() - 0.5) * 3.4,
        gy: row.ry - Math.sin(Math.min(1, t * 1.4) * Math.PI) * row.amp + (rnd() - 0.5) * 1.8,
        gr: row.rr * (0.9 + rnd() * 0.25),
        s: Math.floor(rnd() * 100000),
        row: ri,
      })
    }
  })
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${SVG_W} ${h}`}>
      <Defs>
        <CoinDefs />
        <BrassDomeGrad id="gt_bdome" />
        <IronDomeGrad id="gt_idome" />
        <Brass5 id="gt_brass" />
        <IronGrad id="gt_iron" />
        <LinearGradient id="gt_glass" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3a4048" />
          <Stop offset="0.42" stopColor="#181c22" />
          <Stop offset="1" stopColor="#07090c" />
        </LinearGradient>
        <RadialGradient id="gt_pool" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor={gold ? "#e8b45f" : "#aeb9c6"} stopOpacity={0.22} />
          <Stop offset="1" stopColor="#000" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={x + w / 2} cy={y + tankH + 13} rx={w / 2 - 2} ry={6} fill="url(#gt_pool)" />
      <Ellipse cx={x + w / 2 + 2} cy={y + tankH + 9} rx={w / 2} ry={4} fill="#000" opacity={0.45} />
      <Rect x={x} y={y} width={w} height={tankH} rx={10} fill="url(#gt_glass)" stroke="#12161b" strokeWidth={1.4} />
      {/* heap base occlusion so grains sit IN shade, not float */}
      <Rect x={innerX} y={y + tankH - 14} width={innerW} height={12} rx={6} fill="#000" opacity={0.4} />
      {grains.map((gr, i) =>
        gold ? (
          <Nugget key={i} cx={gr.gx} cy={gr.gy} r={gr.gr} seedN={gr.s} />
        ) : (
          <Pebble key={i} cx={gr.gx} cy={gr.gy} r={gr.gr} seedN={gr.s} />
        ),
      )}
      {/* occlusion pockets between grains of the top row */}
      {grains.filter((g) => g.row === 3).map((g, i) => (
        <Ellipse key={i} cx={g.gx + g.gr * 0.8} cy={g.gy + g.gr * 0.5} rx={g.gr * 0.5} ry={g.gr * 0.3} fill="#000" opacity={0.3} />
      ))}
      <AnimatedRect y={y + 1.6} height={tankH - 3.2} fill="#0e1114" opacity={0.93} animatedProps={cover} />
      <Path d={`M ${x + 12} ${y + 6} Q ${x + w / 2} ${y + 1.6} ${x + w - 12} ${y + 6}`} stroke="#eef3f7" strokeWidth={3.2} opacity={0.38} fill="none" strokeLinecap="round" />
      <Path d={`M ${x + 18} ${y + 10} Q ${x + 46} ${y + 6} ${x + 66} ${y + 11}`} stroke="#fff" strokeWidth={1.4} opacity={0.5} fill="none" strokeLinecap="round" />
      <Path d={`M ${x + 12} ${y + tankH - 3.4} Q ${x + w / 2} ${y + tankH + 1} ${x + w - 12} ${y + tankH - 3.4}`} stroke="#04060a" strokeWidth={2.6} opacity={0.55} fill="none" strokeLinecap="round" />
      {[x, x + w].map((ex, i) => (
        <G key={i}>
          <Ellipse cx={ex} cy={cy} rx={9} ry={tankH / 2 + 2.4} fill={`url(#${gold ? "gt_brass" : "gt_iron"})`} stroke={gold ? B_SEAT : I_SEAT} strokeWidth={1} />
          <Ellipse cx={ex} cy={cy} rx={5.5} ry={tankH / 2 - 3} fill="none" stroke="#00000066" strokeWidth={1} />
          <Ellipse cx={ex - 2.4} cy={cy - 12} rx={2.2} ry={5.5} fill="#fff" opacity={i === 0 ? 0.45 : 0.28} />
          {[cy - 13, cy, cy + 13].map((ry, j) => (
            <Rivet key={j} cx={ex} cy={ry} r={1.5} dome={gold ? "gt_bdome" : "gt_idome"} dim={i === 1} />
          ))}
        </G>
      ))}
    </Svg>
  )
}

/** Sea chest with a REAL hoard: minted coins in three depth rows (back rows
 *  dimmed), tilted and leaning pieces, spills with contact shadows, walls with
 *  visible lip thickness, lined open lid, iron straps with rust drips. */
function TreasureChest({
  fill,
  tone,
  metal,
  value,
  pct,
}: {
  fill: SharedValue<number>
  tone: string
  metal: "gold" | "silver"
  value: string
  pct: string | null
}): ReactNode {
  const h = 122
  const cx = SVG_W / 2
  const bodyW = 116
  const x = cx - bodyW / 2
  const lidTop = 4
  const mouthY = 46
  const bodyH = 48
  const gold = metal === "gold"
  const rnd = seeded(gold ? 550 : 560)
  const barX = x + 12
  const barW = bodyW - 24
  const bar = useAnimatedProps(() => {
    "worklet"
    return { width: barW * fill.value }
  })
  // three coin rows, BACK → FRONT (front coins bigger, back dimmed)
  const coinRows = [
    { yy: mouthY - 15, r: 4.4, n: 8, dim: 0.3, tiltMin: 0.4 },
    { yy: mouthY - 9, r: 5.1, n: 8, dim: 0.14, tiltMin: 0.42 },
    { yy: mouthY - 3.5, r: 5.8, n: 7, dim: 0, tiltMin: 0.46 },
  ]
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${SVG_W} ${h}`}>
      <Defs>
        <CoinDefs />
        <LinearGradient id="cs_wood" x1="0" y1="0" x2="0.3" y2="1">
          <Stop offset="0" stopColor="#6a4f2b" />
          <Stop offset="0.5" stopColor="#48351b" />
          <Stop offset="1" stopColor="#241a0c" />
        </LinearGradient>
        <LinearGradient id="cs_lidIn" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3a2a15" />
          <Stop offset="0.6" stopColor="#241708" />
          <Stop offset="1" stopColor="#140c04" />
        </LinearGradient>
        <IronGrad id="cs_iron" />
        <IronDomeGrad id="cs_idome" />
        <Brass5 id="cs_brass" />
        <RadialGradient id="cs_glow" cx="0.5" cy="0.7" r="0.65">
          <Stop offset="0" stopColor={gold ? "#ffd685" : "#e9eef4"} stopOpacity={0.45} />
          <Stop offset="1" stopColor="#000" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={cx + 2} cy={mouthY + bodyH + 6} rx={bodyW / 2 + 6} ry={4.5} fill="#000" opacity={0.45} />
      {/* OPEN LID: outer shell edge + deep lining with slats + brass edging */}
      <Path
        d={`M ${x + 2} ${mouthY - 24} Q ${cx} ${lidTop - 6} ${x + bodyW - 2} ${mouthY - 24} L ${x + bodyW - 5} ${mouthY - 37} Q ${cx} ${lidTop - 17} ${x + 5} ${mouthY - 37} Z`}
        fill="url(#cs_wood)"
        stroke="#1c1207"
        strokeWidth={1.1}
      />
      <Path
        d={`M ${x + 5} ${mouthY - 36.5} Q ${cx} ${lidTop - 16} ${x + bodyW - 5} ${mouthY - 36.5} Q ${cx} ${lidTop + 10} ${x + 5} ${mouthY - 36.5} Z`}
        fill="url(#cs_lidIn)"
        stroke="#0f0a04"
        strokeWidth={0.8}
      />
      {/* lining slats + brass lid edging */}
      {[0.22, 0.4, 0.6, 0.78].map((f, i) => {
        const lx = x + 5 + (bodyW - 10) * f
        return <Line key={i} x1={lx} y1={mouthY - 36} x2={lx} y2={mouthY - 36 + 9 - Math.abs(f - 0.5) * 8} stroke="#0f0a04" strokeWidth={0.8} opacity={0.7} />
      })}
      <Path d={`M ${x + 5} ${mouthY - 36.5} Q ${cx} ${lidTop - 16} ${x + bodyW - 5} ${mouthY - 36.5}`} stroke="url(#cs_brass)" strokeWidth={1.6} fill="none" opacity={0.9} />
      {/* lid straps */}
      {[x + 22, cx, x + bodyW - 22].map((sx, i) => (
        <G key={i}>
          <Path d={`M ${sx - 3.4} ${mouthY - 24} L ${sx - 3.4} ${mouthY - 35} L ${sx + 3.4} ${mouthY - 35} L ${sx + 3.4} ${mouthY - 24} Z`} fill="url(#cs_iron)" stroke="#101216" strokeWidth={0.7} />
          <Line x1={sx - 2.4} y1={mouthY - 34} x2={sx - 2.4} y2={mouthY - 25} stroke="#aeb4bc" strokeWidth={0.5} opacity={0.5} />
        </G>
      ))}
      {/* hinge arms: the lid is CONNECTED to the body, it does not float */}
      {[x + 4, x + bodyW - 4].map((ax, i) => (
        <G key={i}>
          <Line x1={ax} y1={mouthY - 23} x2={ax + (i === 0 ? -2 : 2)} y2={mouthY - 1} stroke="url(#cs_iron)" strokeWidth={3.4} strokeLinecap="round" />
          <Line x1={ax} y1={mouthY - 23} x2={ax + (i === 0 ? -2 : 2)} y2={mouthY - 1} stroke="#aeb4bc" strokeWidth={0.7} opacity={0.4} strokeLinecap="round" />
          <Rivet cx={ax} cy={mouthY - 22} r={1.3} dome="cs_idome" dim={i === 1} />
          <Rivet cx={ax + (i === 0 ? -2 : 2)} cy={mouthY - 2} r={1.3} dome="cs_idome" dim={i === 1} />
        </G>
      ))}
      {/* hoard glow, then the coin rows back→front */}
      <Ellipse cx={cx} cy={mouthY - 10} rx={bodyW / 2 - 8} ry={15} fill="url(#cs_glow)" />
      <Ellipse cx={cx} cy={mouthY - 1} rx={bodyW / 2 - 4} ry={7.5} fill="#0e0902" />
      {coinRows.map((row, ri) => (
        <G key={ri}>
          {Array.from({ length: row.n }).map((_, i) => {
            const t = row.n === 1 ? 0.5 : i / (row.n - 1)
            const px = x + 14 + (bodyW - 28) * t + (rnd() - 0.5) * 5
            const py = row.yy - Math.sin(t * Math.PI) * 3.4 + (rnd() - 0.5) * 2
            const rot = (rnd() - 0.5) * (ri === 2 ? 26 : 14)
            return (
              <Coin
                key={i}
                cx={px}
                cy={py}
                r={row.r * (0.92 + rnd() * 0.18)}
                tilt={row.tiltMin + rnd() * 0.1}
                rot={rot}
                metal={metal}
                dim={row.dim}
                shadow={ri > 0}
              />
            )
          })}
        </G>
      ))}
      {/* two coins leaning on the front lip */}
      <Coin cx={x + 22} cy={mouthY - 1} r={6} tilt={0.62} rot={-24} metal={metal} />
      <Coin cx={x + bodyW - 24} cy={mouthY - 0.5} r={5.6} tilt={0.58} rot={18} metal={metal} />
      {/* FRONT LIP: the wall thickness the coins rest against */}
      <Rect x={x} y={mouthY - 2.4} width={bodyW} height={4.4} rx={2} fill="#7a5c33" stroke="#1c1207" strokeWidth={0.7} />
      <Line x1={x + 2} y1={mouthY - 1.6} x2={x + bodyW - 2} y2={mouthY - 1.6} stroke="#c99e5f" strokeWidth={0.7} opacity={0.7} />
      {/* body: staves + grain + iron bands + corner plates + rust drips */}
      <Rect x={x} y={mouthY + 2} width={bodyW} height={bodyH - 4} rx={4} fill="url(#cs_wood)" stroke="#1c1207" strokeWidth={1.2} />
      {[x + 26, x + 52, x + 78, x + 102].map((sx, i) => (
        <G key={i}>
          <Line x1={sx} y1={mouthY + 4} x2={sx} y2={mouthY + bodyH - 4} stroke="#1e1408" strokeWidth={1} />
          <Line x1={sx + 1} y1={mouthY + 4} x2={sx + 1} y2={mouthY + bodyH - 4} stroke="#7a5c33" strokeWidth={0.5} opacity={0.6} />
          <Path d={`M ${sx - 8} ${mouthY + 8 + (i % 2) * 16} q 3 1.5 7 0.5`} stroke="#120c04" strokeWidth={0.6} opacity={0.5} fill="none" />
        </G>
      ))}
      {[[x - 1, mouthY + 1], [x + bodyW - 9, mouthY + 1], [x - 1, mouthY + bodyH - 11], [x + bodyW - 9, mouthY + bodyH - 11]].map((c, i) => (
        <G key={i}>
          <Rect x={c[0]} y={c[1]} width={10} height={10} rx={1.6} fill="url(#cs_iron)" stroke="#101216" strokeWidth={0.7} />
          <Path d={`M ${c[0] + 5} ${c[1] + 10} q 0.8 4 0.2 7`} stroke="#6e3f1d" strokeWidth={1.4} opacity={0.45} fill="none" />
          <Rivet cx={c[0] + 5} cy={c[1] + 5} r={1.3} dome="cs_idome" dim={i % 2 === 1} />
        </G>
      ))}
      {/* front slot gauge + the two engraved plates */}
      <Rect x={barX - 2} y={mouthY + 9} width={barW + 4} height={13} rx={5} fill="#0b0805" stroke="url(#cs_brass)" strokeWidth={1.2} />
      <AnimatedRect x={barX} y={mouthY + 11} height={9} rx={4} fill={tone} animatedProps={bar} />
      <AnimatedRect x={barX} y={mouthY + 12} height={2.8} rx={1.4} fill="#fff" opacity={0.3} animatedProps={bar} />
      <SvgPlate x={x + 8} y={mouthY + 26} w={(bodyW - 22) * 0.56} h={17} value={value} pct={null} tone={tone} brass="cs_brass" />
      <SvgPlate x={x + 8 + (bodyW - 22) * 0.56 + 6} y={mouthY + 26} w={(bodyW - 22) * 0.44} h={17} value={pct ?? "—"} pct={null} tone={tone} valueColor={tone} brass="cs_brass" />
      {/* coin spills on the ground, lying at real angles */}
      <Coin cx={x + 10} cy={mouthY + bodyH + 2} r={5.4} tilt={0.34} rot={-6} metal={metal} />
      <Coin cx={x + 24} cy={mouthY + bodyH + 4} r={5} tilt={0.3} rot={4} metal={metal} />
      <Coin cx={x + bodyW - 16} cy={mouthY + bodyH + 3} r={5.2} tilt={0.32} rot={-3} metal={metal} />
    </Svg>
  )
}

/** Ornate balance: LINK chains, rimmed concave pans, minted mini-coins vs
 *  hallmarked silver bars, engraved plate at the right. */
function BalanceScale({
  fill,
  value,
  pct,
  tone,
}: {
  fill: SharedValue<number>
  value: string
  pct: string | null
  tone: string
}): ReactNode {
  const h = 116
  const cx = 46
  const beam = useAnimatedProps(() => {
    "worklet"
    const t = (fill.value - 0.5) * 13
    return { x1: cx - 31, y1: 30 + t, x2: cx + 31, y2: 30 - t }
  })
  const leftPan = useAnimatedProps(() => {
    "worklet"
    return { translateY: (fill.value - 0.5) * 13 } as never
  })
  const rightPan = useAnimatedProps(() => {
    "worklet"
    return { translateY: -(fill.value - 0.5) * 13 } as never
  })
  const ChainLinks = ({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }): ReactNode => (
    <G>
      {Array.from({ length: 6 }).map((_, i) => {
        const f = i / 5
        const lx = x1 + (x2 - x1) * f
        const ly = y1 + (y2 - y1) * f
        return <Ellipse key={i} cx={lx} cy={ly} rx={i % 2 === 0 ? 1.3 : 0.8} ry={i % 2 === 0 ? 1.9 : 1.4} fill="none" stroke="#8a6d2f" strokeWidth={0.7} opacity={0.9} />
      })}
    </G>
  )
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${SVG_W} ${h}`}>
      <Defs>
        <CoinDefs />
        <Brass5 id="bs_brass" h />
        <BrassDomeGrad id="bs_dome" />
        <RadialGradient id="bs_silver" cx="0.35" cy="0.3" r="0.85">
          <Stop offset="0" stopColor="#ffffff" />
          <Stop offset="0.5" stopColor="#c4c9d0" />
          <Stop offset="1" stopColor="#6b737d" />
        </RadialGradient>
      </Defs>
      <Ellipse cx={cx + 2} cy={h - 8} rx={26} ry={3.8} fill="#000" opacity={0.45} />
      <Polygon points={`${cx - 20},${h - 10} ${cx + 20},${h - 10} ${cx + 12},${h - 20} ${cx - 12},${h - 20}`} fill="url(#bs_brass)" stroke={B_SEAT} strokeWidth={0.9} />
      <Line x1={cx - 18} y1={h - 11.4} x2={cx + 18} y2={h - 11.4} stroke="#00000066" strokeWidth={0.9} />
      <Rect x={cx - 14} y={h - 24} width={28} height={5} rx={2} fill="url(#bs_brass)" stroke={B_SEAT} strokeWidth={0.6} />
      <Line x1={cx - 13} y1={h - 23.2} x2={cx + 13} y2={h - 23.2} stroke={GLINT} strokeWidth={0.6} opacity={0.75} />
      <Rect x={cx - 2.6} y={22} width={5.2} height={h - 45} rx={2.4} fill="url(#bs_brass)" />
      <Line x1={cx - 1.1} y1={23} x2={cx - 1.1} y2={h - 24} stroke={GLINT} strokeWidth={0.7} opacity={0.55} />
      {[40, 62, 82].map((yy, i) => (
        <G key={i}>
          <Ellipse cx={cx} cy={yy} rx={4.8} ry={2.7} fill="url(#bs_dome)" stroke={B_SEAT} strokeWidth={0.5} />
          <Ellipse cx={cx - 1.4} cy={yy - 0.8} rx={1.4} ry={0.7} fill={GLINT} opacity={0.8} />
        </G>
      ))}
      <Polygon points={hexPts(cx, 20, 5.2)} fill="url(#bs_dome)" stroke={B_SEAT} strokeWidth={0.7} />
      <Circle cx={cx} cy={12} r={2.6} fill="url(#bs_dome)" />
      <Circle cx={cx - 1.5} cy={18.4} r={1.4} fill={GLINT} opacity={0.9} />
      <AnimatedLine animatedProps={beam} stroke="url(#bs_brass)" strokeWidth={4} strokeLinecap="round" />
      {/* left pan — hallmarked silver bars on a rimmed pan, link chains */}
      <AnimatedG animatedProps={leftPan}>
        <ChainLinks x1={cx - 35} y1={31} x2={cx - 38} y2={46} />
        <ChainLinks x1={cx - 31} y1={31} x2={cx - 31} y2={46} />
        <ChainLinks x1={cx - 27} y1={31} x2={cx - 24} y2={46} />
        <Path d={`M ${cx - 44} 47 Q ${cx - 31} 57 ${cx - 18} 47 Q ${cx - 31} 51 ${cx - 44} 47 Z`} fill="url(#bs_brass)" stroke={B_SEAT} strokeWidth={0.6} />
        <Path d={`M ${cx - 44} 47 Q ${cx - 31} 43.6 ${cx - 18} 47`} stroke={B_SPEC} strokeWidth={1} opacity={0.8} fill="none" />
        <Path d={arc(cx - 31, 48, 12, 198, 282)} stroke={B_SPEC} strokeWidth={1.2} opacity={0.75} fill="none" />
        {[
          { bx: cx - 39, by: 42.4, rot: -7 },
          { bx: cx - 32, by: 40, rot: 5 },
          { bx: cx - 36.5, by: 37.4, rot: 0 },
        ].map((b, i) => (
          <G key={i} transform={`rotate(${b.rot} ${b.bx + 5} ${b.by + 2})`}>
            <Rect x={b.bx} y={b.by + 3.4} width={10.5} height={1.6} rx={0.6} fill="#3a4048" opacity={0.8} />
            <Rect x={b.bx} y={b.by} width={10.5} height={4} rx={0.8} fill="url(#bs_silver)" stroke="#5d656e" strokeWidth={0.45} />
            <Rect x={b.bx + 1} y={b.by + 0.6} width={8.5} height={1} rx={0.5} fill="#fff" opacity={0.55} />
            <Line x1={b.bx + 3} y1={b.by + 1.4} x2={b.bx + 3} y2={b.by + 2.8} stroke="#6d757e" strokeWidth={0.5} />
            <Line x1={b.bx + 7.5} y1={b.by + 1.4} x2={b.bx + 7.5} y2={b.by + 2.8} stroke="#6d757e" strokeWidth={0.5} />
          </G>
        ))}
      </AnimatedG>
      {/* right pan — three minted gold coins */}
      <AnimatedG animatedProps={rightPan}>
        <ChainLinks x1={cx + 27} y1={31} x2={cx + 24} y2={46} />
        <ChainLinks x1={cx + 31} y1={31} x2={cx + 31} y2={46} />
        <ChainLinks x1={cx + 35} y1={31} x2={cx + 38} y2={46} />
        <Path d={`M ${cx + 18} 47 Q ${cx + 31} 57 ${cx + 44} 47 Q ${cx + 31} 51 ${cx + 18} 47 Z`} fill="url(#bs_brass)" stroke={B_SEAT} strokeWidth={0.6} />
        <Path d={`M ${cx + 18} 47 Q ${cx + 31} 43.6 ${cx + 44} 47`} stroke={B_SPEC} strokeWidth={1} opacity={0.8} fill="none" />
        <Path d={arc(cx + 31, 48, 12, 198, 282)} stroke={B_SPEC} strokeWidth={1.2} opacity={0.75} fill="none" />
        <Coin cx={cx + 27} cy={43.4} r={4.2} tilt={0.42} rot={-8} metal="gold" />
        <Coin cx={cx + 35} cy={44} r={4.2} tilt={0.44} rot={6} metal="gold" />
        <Coin cx={cx + 31} cy={40} r={4} tilt={0.4} rot={0} metal="gold" />
      </AnimatedG>
      <SvgPlate x={102} y={42} w={48} h={34} value={value} pct={pct} tone={tone} brass="bs_brass" />
    </Svg>
  )
}

/** Jeweller's loupe: progress ring around the lens, BULGED script under the
 *  glass (magnification), rim screw, dark turned handle. */
function MagnifierLens({
  pct,
  ratio,
  tone,
  value,
}: {
  pct: string
  ratio: number
  tone: string
  value: string
}): ReactNode {
  const h = 116
  const cx = SVG_W / 2 - 6
  const cy = h / 2 - 6
  const r = 34
  const circ = 2 * Math.PI * (r - 3)
  const hStart = polar(cx, cy, r + 4, 48)
  const hEnd = polar(cx, cy, r + 36, 48)
  return (
    <View style={{ width: "100%" }}>
      <Svg width="100%" height={h} viewBox={`0 0 ${SVG_W} ${h}`}>
        <Defs>
          <Brass5 id="lp_rim" h />
          <BrassDomeGrad id="lp_dome" />
          <LinearGradient id="lp_wood" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#4a3822" />
            <Stop offset="0.5" stopColor="#2e2212" />
            <Stop offset="1" stopColor="#171008" />
          </LinearGradient>
          <RadialGradient id="lp_glass" cx="0.38" cy="0.32" r="0.85">
            <Stop offset="0" stopColor="#22302a" />
            <Stop offset="0.6" stopColor="#131f1a" />
            <Stop offset="1" stopColor="#040807" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={cx + 18} cy={cy + r + 15} rx={30} ry={5} fill="#000" opacity={0.4} />
        <Line x1={hStart.x} y1={hStart.y} x2={hEnd.x} y2={hEnd.y} stroke="url(#lp_wood)" strokeWidth={10} strokeLinecap="round" />
        <Line x1={hStart.x + 0.5} y1={hStart.y - 2.2} x2={hEnd.x - 0.5} y2={hEnd.y - 3} stroke="#6b4f2a" strokeWidth={1.6} opacity={0.7} strokeLinecap="round" />
        {(() => {
          const p = polar(cx, cy, r + 8, 48)
          const s = polar(cx, cy, r + 3.2, 48)
          return (
            <G>
              <Ellipse cx={p.x} cy={p.y} rx={5.6} ry={4.2} fill="url(#lp_rim)" stroke={B_SEAT} strokeWidth={0.7} transform={`rotate(48 ${p.x} ${p.y})`} />
              <Ellipse cx={p.x - 1} cy={p.y - 1.4} rx={1.6} ry={0.9} fill={GLINT} opacity={0.8} transform={`rotate(48 ${p.x} ${p.y})`} />
              <Rivet cx={s.x} cy={s.y} r={1.6} dome="lp_dome" />
            </G>
          )
        })()}
        <Circle cx={cx} cy={cy} r={r} fill="none" stroke="url(#lp_rim)" strokeWidth={7} />
        <Path d={crescent(cx, cy, r)} stroke={B_SPEC} strokeWidth={1.6} opacity={0.8} fill="none" strokeLinecap="round" />
        <Path d={arc(cx, cy, r, 26, 92)} stroke="#1c1206" strokeWidth={1.6} opacity={0.6} fill="none" />
        <Circle cx={cx} cy={cy} r={r - 5.5} fill="url(#lp_glass)" />
        {/* BULGED script: lines curve harder near centre = lens magnification */}
        {[-13, -9, 8, 12, 16].map((dy, i) => {
          const bend = 6 * (1 - Math.abs(dy) / 18)
          return (
            <Path
              key={i}
              d={`M ${cx - r + 10} ${cy + dy} Q ${cx} ${cy + dy - bend} ${cx + r - 10} ${cy + dy}`}
              stroke="#7fae97"
              strokeWidth={Math.abs(dy) < 10 ? 1.2 : 0.8}
              opacity={Math.abs(dy) < 10 ? 0.42 : 0.28}
              fill="none"
            />
          )
        })}
        <Circle cx={cx} cy={cy} r={r - 3} fill="none" stroke="#08110d" strokeWidth={5} />
        <Circle
          cx={cx}
          cy={cy}
          r={r - 3}
          fill="none"
          stroke={tone}
          strokeWidth={4.2}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - Math.max(0.01, ratio))}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        <Ellipse cx={cx - 11} cy={cy - 12} rx={8.5} ry={4.8} fill="#dff0ea" opacity={0.2} />
        <Circle cx={cx - 13} cy={cy - 13} r={1.5} fill="#f4fbf8" opacity={0.85} />
        <Path d={arc(cx, cy, r - 8, 26, 84)} stroke="#63b58e" strokeWidth={1.4} opacity={0.4} fill="none" />
        <Path d={arc(cx, cy, r - 7, 196, 240)} stroke="#bfe9ff" strokeWidth={1} opacity={0.3} fill="none" />
      </Svg>
      <View style={{ position: "absolute", top: 0, left: 0, right: 12, height: h - 12, alignItems: "center", justifyContent: "center" }}>
        <Text
          style={{
            color: "#efe7d6",
            fontSize: 15,
            fontWeight: "800",
            textShadowColor: "#000",
            textShadowOffset: { width: 0, height: 1.2 },
            textShadowRadius: 2,
          }}
        >
          {value}
        </Text>
        <Text style={{ color: tone, fontSize: 11, fontWeight: "800", marginTop: -1 }}>{pct}</Text>
      </View>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tile dispatcher
// ─────────────────────────────────────────────────────────────────────────────

export function GoalTile({ metric }: { metric: GoalMetric }): ReactNode {
  const fill = useFill(metric.ratio)
  let face: ReactNode
  let inlineValues = false
  if (!metric.available) {
    face = <LockedFace height={104} />
  } else {
    switch (metric.kind) {
      case "arc":
        face = <ArcGauge fill={fill} />
        break
      case "ring":
        face = <VaultRing pct={metric.pctText ?? ""} ratio={metric.ratio} />
        break
      case "thermo":
        face = <Thermometer fill={fill} tone={metric.tone} value={metric.valueText} pct={metric.pctText} />
        inlineValues = true
        break
      case "tank":
        face = <GlassTank fill={fill} metal={metric.id === "gold" ? "gold" : "silver"} />
        break
      case "chest":
        face = (
          <TreasureChest
            fill={fill}
            tone={metric.tone}
            metal={metric.id === "ankauf" ? "gold" : "silver"}
            value={metric.valueText}
            pct={metric.pctText}
          />
        )
        inlineValues = true
        break
      case "scale":
        face = <BalanceScale fill={fill} value={metric.valueText} pct={metric.pctText} tone={metric.tone} />
        inlineValues = true
        break
      case "lens":
        face = (
          <MagnifierLens pct={metric.pctText ?? ""} ratio={metric.ratio} tone={metric.tone} value={metric.valueText} />
        )
        inlineValues = true
        break
      default:
        face = <LockedFace height={104} />
    }
  }
  const valueColor = metric.id === "gewinn" && metric.ratio >= 0.75 ? C.green : undefined
  return (
    <WidgetFrame title={metric.title} zielText={metric.zielText}>
      {face}
      {!inlineValues ? (
        <ValuePlate value={metric.valueText} pct={metric.pctText} tone={metric.tone} valueColor={valueColor} />
      ) : null}
    </WidgetFrame>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature panels (full width)
// ─────────────────────────────────────────────────────────────────────────────

export function GoalsScroll({ bars }: { bars: MonthlyBar[] }): ReactNode {
  const rollH = 16
  // rows carry an EXPLICIT 15px line height below, so this arithmetic is
  // exact: top padding 24 + title 44 + n rows of 23.5 + tail room 18.
  const sheetH = 70 + bars.length * 24
  const total = sheetH + rollH * 2 - 8
  const W = 340
  const rnd = seeded(77)
  return (
    <View style={{ width: "100%", height: total }}>
      <Svg width="100%" height={total} viewBox={`0 0 ${W} ${total}`} preserveAspectRatio="none" style={{ position: "absolute" }}>
        <Defs>
          <LinearGradient id="sr_body" x1="0" y1="0" x2="0.2" y2="1">
            <Stop offset="0" stopColor="#e9d9b2" />
            <Stop offset="0.5" stopColor="#d7c59c" />
            <Stop offset="1" stopColor="#bda87a" />
          </LinearGradient>
          <LinearGradient id="sr_roll" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#8f7a4e" />
            <Stop offset="0.35" stopColor="#cdb27c" />
            <Stop offset="0.55" stopColor="#eedcab" />
            <Stop offset="0.8" stopColor="#a98f5c" />
            <Stop offset="1" stopColor="#6f5a34" />
          </LinearGradient>
          <RadialGradient id="sr_cap" cx="0.4" cy="0.35" r="0.85">
            <Stop offset="0" stopColor="#e9d9b2" />
            <Stop offset="0.6" stopColor="#b39a67" />
            <Stop offset="1" stopColor="#5e4b28" />
          </RadialGradient>
          <RadialGradient id="sr_stain" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#6f5c38" stopOpacity={0.15} />
            <Stop offset="1" stopColor="#6f5c38" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={12} y={rollH - 2} width={W - 24} height={sheetH} rx={3} fill="#000" opacity={0.5} transform="translate(3,4)" />
        <Rect x={12} y={rollH - 2} width={W - 24} height={sheetH} rx={3} fill="url(#sr_body)" />
        <Rect x={12} y={rollH - 2} width={22} height={sheetH} fill="#000" opacity={0.1} />
        <Rect x={W - 34} y={rollH - 2} width={22} height={sheetH} fill="#000" opacity={0.13} />
        {Array.from({ length: 8 }).map((_, i) => {
          const y = rollH + 6 + rnd() * (sheetH - 14)
          return <Path key={i} d={`M ${20 + rnd() * 24} ${y} q ${100 + rnd() * 110} ${(rnd() - 0.5) * 5} ${270 + rnd() * 30} 0`} stroke="#8a744a" strokeWidth={0.5} opacity={0.15} fill="none" />
        })}
        <Ellipse cx={78} cy={rollH + sheetH * 0.72} rx={44} ry={24} fill="url(#sr_stain)" />
        <Ellipse cx={282} cy={rollH + 26} rx={34} ry={20} fill="url(#sr_stain)" />
        {[2, total - rollH - 2].map((ry, i) => (
          <G key={i}>
            <Rect x={2} y={ry + 2.4} width={W - 4} height={rollH} rx={rollH / 2} fill="#000" opacity={0.5} />
            <Rect x={2} y={ry} width={W - 4} height={rollH} rx={rollH / 2} fill="url(#sr_roll)" />
            <Line x1={10} y1={ry + 3.4} x2={W - 10} y2={ry + 3.4} stroke="#fff5d9" strokeWidth={1} opacity={0.5} />
            <Line x1={10} y1={ry + rollH - 2.6} x2={W - 10} y2={ry + rollH - 2.6} stroke="#3a2c12" strokeWidth={1} opacity={0.5} />
            <Ellipse cx={7} cy={ry + rollH / 2} rx={5} ry={rollH / 2} fill="url(#sr_cap)" stroke="#4a3a1e" strokeWidth={0.8} />
            <Ellipse cx={W - 7} cy={ry + rollH / 2} rx={5} ry={rollH / 2} fill="url(#sr_cap)" stroke="#4a3a1e" strokeWidth={0.8} />
            <Ellipse cx={7} cy={ry + rollH / 2} rx={2.2} ry={rollH / 2 - 3} fill="none" stroke="#4a3a1e" strokeWidth={0.7} opacity={0.7} />
            <Ellipse cx={W - 7} cy={ry + rollH / 2} rx={2.2} ry={rollH / 2 - 3} fill="none" stroke="#4a3a1e" strokeWidth={0.7} opacity={0.7} />
          </G>
        ))}
      </Svg>
      <View style={{ paddingHorizontal: 30, paddingTop: rollH + 8, paddingBottom: rollH + 6, gap: 8.5 }}>
        <View style={{ alignItems: "center", marginBottom: 1 }}>
          <Text style={{ color: C.parchmentInk, fontSize: 13, fontWeight: "800", letterSpacing: 1, textShadowColor: "#f4e9c8", textShadowOffset: { width: 0, height: 0.8 }, textShadowRadius: 0.5 }}>
            MONATSZIELE
          </Text>
          <Text style={{ color: C.giltDeep, fontSize: 9.5 }}>Übersicht</Text>
        </View>
        {bars.map((b) => (
          <View key={b.label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: C.parchmentInk, fontSize: 11.5, lineHeight: 15, fontWeight: "700", width: 66 }} numberOfLines={1}>
              {b.label}
            </Text>
            <View
              style={{
                flex: 1,
                height: 11,
                borderRadius: 5.5,
                backgroundColor: "#00000030",
                overflow: "hidden",
                borderWidth: 1,
                borderColor: "#00000038",
                borderBottomColor: "#f7ecc9",
              }}
            >
              {b.available ? (
                <View
                  style={{
                    width: `${Math.round(b.ratio * 100)}%`,
                    height: "100%",
                    borderRadius: 5,
                    backgroundColor: b.ratio >= 0.75 ? "#587f3c" : b.ratio >= 0.4 ? "#b07d22" : "#9c4527",
                  }}
                >
                  <View style={{ height: 3.4, marginTop: 1, marginHorizontal: 2, borderRadius: 2, backgroundColor: "#fff", opacity: 0.3 }} />
                </View>
              ) : null}
            </View>
            <Text style={{ color: C.parchmentInk, fontSize: 11.5, lineHeight: 15, fontWeight: "800", width: 38, textAlign: "right" }}>
              {b.available ? `${Math.round(b.ratio * 100)}%` : "—"}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function tornEdge(w: number, h: number, seed: number): string {
  const rnd = seeded(seed)
  const teeth = 26
  const pts: string[] = [`M 4 ${4 + rnd() * 2}`]
  for (let i = 1; i <= teeth; i++) pts.push(`L ${(w / teeth) * i - rnd() * 4} ${2 + rnd() * 3.4}`)
  for (let i = 1; i <= 8; i++) pts.push(`L ${w - 2 - rnd() * 3} ${(h / 8) * i - rnd() * 4}`)
  for (let i = teeth - 1; i >= 0; i--) pts.push(`L ${(w / teeth) * i + rnd() * 4} ${h - 2 - rnd() * 3.4}`)
  for (let i = 7; i >= 0; i--) pts.push(`L ${2 + rnd() * 3} ${(h / 8) * i + rnd() * 4}`)
  return pts.join(" ") + " Z"
}

export function TreasureMapPanel({ overall, available }: { overall: number; available: boolean }): ReactNode {
  const pct = Math.round(overall * 100)
  const p = Math.max(0, Math.min(1, overall))
  const W = 340
  const H = 178
  const rnd = seeded(140)
  const shipX = 60 + p * 150
  const shipY = 96 - p * 30
  return (
    <View style={{ width: "100%", height: H }}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: "absolute" }}>
        <Defs>
          <RadialGradient id="mp_bg" cx="0.5" cy="0.4" r="0.95">
            <Stop offset="0" stopColor="#d9c493" />
            <Stop offset="0.7" stopColor="#c0a877" />
            <Stop offset="1" stopColor="#94794e" />
          </RadialGradient>
          <RadialGradient id="mp_burn" cx="0.5" cy="0.5" r="0.72">
            <Stop offset="0.72" stopColor="#2a1606" stopOpacity={0} />
            <Stop offset="0.92" stopColor="#361c07" stopOpacity={0.5} />
            <Stop offset="1" stopColor="#120801" stopOpacity={0.9} />
          </RadialGradient>
        </Defs>
        <Path d={tornEdge(W, H, 63)} fill="#000" opacity={0.55} transform="translate(3,4)" />
        <Path d={tornEdge(W, H, 63)} fill="url(#mp_bg)" />
        {Array.from({ length: 5 }).map((_, i) => {
          const cyy = 30 + rnd() * (H - 60)
          const cxx = 40 + rnd() * (W - 80)
          return <Ellipse key={i} cx={cxx} cy={cyy} rx={16 + rnd() * 22} ry={8 + rnd() * 10} fill="none" stroke="#7d6840" strokeWidth={0.6} opacity={0.25} />
        })}
        {Array.from({ length: 6 }).map((_, i) => {
          const sx = 24 + rnd() * 220
          const sy = 26 + rnd() * (H - 52)
          return <Path key={i} d={`M ${sx} ${sy} q 4 -3 8 0 q 4 3 8 0`} stroke="#6f5a34" strokeWidth={0.8} opacity={0.4} fill="none" />
        })}
        <Path d={tornEdge(W, H, 63)} fill="url(#mp_burn)" />
      </Svg>
      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <View style={{ alignItems: "center" }}>
          <Text style={{ color: "#2e2412", fontSize: 13, fontWeight: "800", letterSpacing: 1, textShadowColor: "#eddfb6", textShadowOffset: { width: 0, height: 0.8 }, textShadowRadius: 0.5 }}>
            GESAMTÜBERSICHT
          </Text>
          <Text style={{ color: "#6b552c", fontSize: 9.5 }}>Alle Ziele auf einen Blick</Text>
        </View>
        <Svg width="100%" height={126} viewBox="0 0 300 126">
          <Defs>
            <CoinDefs />
            <BrassDomeGrad id="mp_rose" />
            <LinearGradient id="mp_hull" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#5d4526" />
              <Stop offset="1" stopColor="#2c1f0e" />
            </LinearGradient>
            <Brass5 id="mp_brass" />
          </Defs>
          <Path d={`M 30 96 C 90 60, 150 110, 250 34`} fill="none" stroke="#3a2c16" strokeWidth={3} opacity={0.2} transform="translate(0,1.4)" strokeDasharray="1.5 6.5" strokeLinecap="round" />
          <Path d={`M 30 96 C 90 60, 150 110, 250 34`} fill="none" stroke="#5c4626" strokeWidth={2.2} opacity={0.45} strokeDasharray="1.5 6.5" strokeLinecap="round" />
          <Path d={`M 30 96 C 90 60, 150 110, 250 34`} fill="none" stroke="#3f2f13" strokeWidth={2.4} opacity={0.9} strokeDasharray={`${p * 260} 500`} strokeLinecap="round" />
          <G stroke="#a02c17" strokeWidth={4} strokeLinecap="round">
            <Line x1={23} y1={89} x2={37} y2={103} />
            <Line x1={37} y1={89} x2={23} y2={103} />
          </G>
          <G stroke="#5c1e0c" strokeWidth={1.2} strokeLinecap="round" opacity={0.5}>
            <Line x1={24.4} y1={90.6} x2={35.6} y2={101.6} />
          </G>
          <G transform={`translate(${shipX}, ${shipY}) rotate(-3)`}>
            <Path d={`M -20 10 q 7 2.6 14 0 q 7 -2.6 14 0`} stroke="#6f5a34" strokeWidth={1} opacity={0.5} fill="none" />
            <Path d="M -16 2 Q 0 9 16 2 L 11 12 L -11 12 Z" fill="url(#mp_hull)" stroke="#241708" strokeWidth={1} />
            <Line x1={-16} y1={2} x2={16} y2={2} stroke={B_MID} strokeWidth={1.2} />
            <Line x1={-15} y1={3.6} x2={15} y2={3.6} stroke="#000" strokeWidth={0.6} opacity={0.4} />
            <Line x1={-6} y1={2} x2={-6} y2={-20} stroke="#241708" strokeWidth={1.5} />
            <Line x1={7} y1={2} x2={7} y2={-13} stroke="#241708" strokeWidth={1.3} />
            <Path d="M -6 -17 Q 2 -12 5 -5 L -6 -3 Z" fill="#efe8d5" />
            <Path d="M -6 -17 Q 2 -12 5 -5 L 1 -6 Z" fill="#c9bb9e" opacity={0.75} />
            <Path d="M -6 -13 Q -12 -9 -14 -4 L -6 -2.6 Z" fill="#e4dbc4" />
            <Path d="M 7 -12 Q 12 -8 13 -3.6 L 7 -2.4 Z" fill="#e9e0ca" />
            <Path d="M -6 -18.4 L -1 -16.8 L -6 -15.2 Z" fill="#a02c17" />
          </G>
          <G transform="translate(252, 30)">
            <Ellipse cx={1} cy={13.4} rx={16} ry={3.4} fill="#000" opacity={0.25} />
            <Rect x={-13} y={0} width={26} height={13} rx={2} fill="url(#mp_hull)" stroke="#241708" strokeWidth={1} />
            <Path d="M -13 0 Q 0 -11 13 0 Z" fill="url(#mp_rose)" stroke="#7a5e22" strokeWidth={1} />
            <Path d={crescent(0, 0, 12)} stroke={B_SPEC} strokeWidth={1} opacity={0.6} fill="none" />
            <Rect x={-2} y={4} width={4} height={6} rx={1} fill={B_MID} />
            <Coin cx={-7} cy={-1.5} r={3.2} tilt={0.44} rot={-8} metal="gold" shadow={false} />
            <Coin cx={0.5} cy={-2.5} r={3} tilt={0.42} rot={4} metal="gold" shadow={false} />
            <Coin cx={7} cy={-1.5} r={3.2} tilt={0.46} rot={10} metal="gold" shadow={false} />
          </G>
          <Engraved x={222} y={106} size={27} color={available && pct >= 75 ? "#4e7a3a" : "#6f5620"} weight="800">
            {available ? `${pct}%` : "—"}
          </Engraved>
          <Engraved x={222} y={118} size={8.5} color="#4a3a20" weight="600">
            Zielerreichung
          </Engraved>
        </Svg>
      </View>
    </View>
  )
}
