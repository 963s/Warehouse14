/**
 * Zielkarte instruments — BAKED ART + LIVE OVERLAYS.
 *
 * The static artwork (brass, glass, wood, coins, granulate, parchment) is
 * pre-rendered offline by scripts/render-zielkarte-art.py at high fidelity
 * (real material ramps, thick beveled crystal, minted coins with reeded
 * edges, poured grain — see docs/design/zielkarte/PHILOSOPHY.md) and shipped
 * as PNGs under assets/images/zielkarte/. This file only lays those plates
 * and draws the LIVE layer on top: needles, mercury, fill covers, segment
 * rings, route + ship, engraved values.
 *
 * Geometry constants here MIRROR the renderer's anchor constants — if the
 * python changes a pivot, change it here too (single source: the py header).
 */
import { type ReactNode, useEffect } from "react"
import { Image, View } from "react-native"
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated"
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg"

import { Text } from "@/components/ui/text"
import { useReduceMotion } from "@/warehouse14/ui/motion/useReduceMotion"
import { TREASURE_COLORS as C, type GoalMetric, type MonthlyBar } from "./treasure-data"

const AnimatedRect = Animated.createAnimatedComponent(Rect)
const AnimatedG = Animated.createAnimatedComponent(G)
const AnimatedCircle = Animated.createAnimatedComponent(Circle)
const AnimatedPath = Animated.createAnimatedComponent(Path)

const SPRING = { damping: 16, stiffness: 80, mass: 1.1 } as const

const ART = {
  gauge: require("../../../assets/images/zielkarte/gauge.png"),
  porthole: require("../../../assets/images/zielkarte/porthole.png"),
  thermo: require("../../../assets/images/zielkarte/thermo.png"),
  tankGold: require("../../../assets/images/zielkarte/tank-gold.png"),
  tankSilver: require("../../../assets/images/zielkarte/tank-silver.png"),
  chestGold: require("../../../assets/images/zielkarte/chest-gold.png"),
  chestSilver: require("../../../assets/images/zielkarte/chest-silver.png"),
  balance: require("../../../assets/images/zielkarte/balance.png"),
  loupe: require("../../../assets/images/zielkarte/loupe.png"),
  scroll: require("../../../assets/images/zielkarte/scroll.png"),
  map: require("../../../assets/images/zielkarte/map.png"),
} as const

const GOLD_TXT = "#e3c983"
const MUTED_TXT = "#9a8b66"
const B_HI = "#e9cb82"
const B_DEEP = "#8a6d2f"
const R_RED = "#c33b24"
const R_AMBER = "#e0a52e"
const R_GREEN = "#3fae4e"

function useFill(ratio: number): SharedValue<number> {
  const reduce = useReduceMotion()
  const v = useSharedValue(reduce ? ratio : 0)
  useEffect(() => {
    v.value = reduce ? ratio : withSpring(ratio, SPRING)
  }, [ratio, reduce, v])
  return v
}

function bandColor(f: number): string {
  return f < 0.34 ? R_RED : f < 0.66 ? R_AMBER : R_GREEN
}

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

/** A baked plate with a live SVG overlay sharing the SAME coordinate space. */
function Plate({
  art,
  w,
  h,
  children,
}: {
  art: number
  w: number
  h: number
  children?: ReactNode
}): ReactNode {
  return (
    <View style={{ width: "100%", aspectRatio: w / h }}>
      <Image source={art} style={{ position: "absolute", width: "100%", height: "100%" }} resizeMode="contain" />
      {children ? (
        <Svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute" }}>
          {children}
        </Svg>
      ) : null}
    </View>
  )
}

/** Twice-struck lettering (engraved into the art). */
function Struck({
  x,
  y,
  size,
  children,
  color = "#eadfc2",
  weight = "800",
  anchor = "middle",
}: {
  x: number
  y: number
  size: number
  children: string
  color?: string
  weight?: "600" | "700" | "800"
  anchor?: "start" | "middle" | "end"
}): ReactNode {
  return (
    <G>
      <SvgText x={x} y={y + size * 0.07} fill="#000" opacity={0.9} fontSize={size} fontWeight={weight} textAnchor={anchor}>
        {children}
      </SvgText>
      <SvgText x={x} y={y} fill={color} fontSize={size} fontWeight={weight} textAnchor={anchor}>
        {children}
      </SvgText>
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
        paddingHorizontal: 8,
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

function LockedFace(): ReactNode {
  return (
    <View style={{ height: 104, alignItems: "center", justifyContent: "center", width: "100%" }}>
      <Svg width="100%" height={104} viewBox="0 0 156 104">
        <Defs>
          <RadialGradient id="lk_glass" cx="0.4" cy="0.35" r="0.8">
            <Stop offset="0" stopColor="#181510" />
            <Stop offset="1" stopColor="#060504" />
          </RadialGradient>
          <LinearGradient id="lk_rim" x1="0" y1="0" x2="0.7" y2="1">
            <Stop offset="0" stopColor="#565c66" />
            <Stop offset="1" stopColor="#17191d" />
          </LinearGradient>
        </Defs>
        <Circle cx={78} cy={52} r={30} fill="url(#lk_glass)" stroke="url(#lk_rim)" strokeWidth={4} />
        <Struck x={78} y={55} size={8} color="#8d8065" weight="700">
          gleich verfügbar
        </Struck>
      </Svg>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Instruments — baked art + live layers (anchors mirror the renderer)
// ─────────────────────────────────────────────────────────────────────────────

/** gauge.png 960×700 · pivot (0.5, 0.70) · dial R = 0.325 × width. */
function ArcGauge({ fill }: { fill: SharedValue<number> }): ReactNode {
  const W = 960
  const H = 700
  const cx = W * 0.5
  const cy = H * 0.7
  const R = W * 0.325
  const needleRot = useAnimatedProps(() => {
    "worklet"
    return { rotation: 180 + fill.value * 180 } as never
  })
  const L = R * 0.78
  const blade = `M ${-R * 0.16} ${R * 0.028} L ${L - R * 0.09} ${R * 0.012} L ${L} 0 L ${L - R * 0.09} ${-R * 0.012} L ${-R * 0.16} ${-R * 0.028} Z`
  return (
    <Plate art={ART.gauge} w={W} h={H}>
      <Defs>
        <LinearGradient id="agn_brass" x1="0" y1="0" x2="0.85" y2="1">
          <Stop offset="0" stopColor="#fdecb2" />
          <Stop offset="0.5" stopColor="#c9a55c" />
          <Stop offset="1" stopColor="#5c4517" />
        </LinearGradient>
      </Defs>
      <AnimatedG animatedProps={needleRot} originX={cx} originY={cy}>
        <Path d={blade} x={cx + 5} y={cy + 8} fill="#000" opacity={0.4} />
        <Path d={blade} x={cx} y={cy} fill="url(#agn_brass)" stroke="#2a1e08" strokeWidth={1.4} />
        <Circle cx={cx - R * 0.19} cy={cy} r={R * 0.05} fill="none" stroke="url(#agn_brass)" strokeWidth={R * 0.03} />
      </AnimatedG>
      {/* hub cap re-strike so the needle sits UNDER the jewel */}
      <Circle cx={cx} cy={cy} r={R * 0.062} fill="#caa55e" stroke="#33270f" strokeWidth={2} />
      <Circle cx={cx} cy={cy} r={R * 0.026} fill="#962214" />
      <Circle cx={cx - R * 0.012} cy={cy - R * 0.014} r={R * 0.009} fill="#ffc8b9" />
    </Plate>
  )
}

/** porthole.png 900×760 · centre (0.5, 0.5) · segment ring at R = 0.215 × w. */
function VaultRing({ pct, ratio }: { pct: string; ratio: number }): ReactNode {
  const W = 900
  const H = 760
  const cx = W * 0.5
  const cy = H * 0.5
  const R = W * 0.215
  return (
    <View style={{ width: "100%" }}>
      <Plate art={ART.porthole} w={W} h={H}>
        {Array.from({ length: 22 }).map((_, i) => {
          const f = i / 21
          const a0 = -90 + f * 360
          const p = polar(cx, cy, R * 0.99, a0)
          const q = polar(cx, cy, R * 0.99, a0 + 10)
          const filled = f <= ratio || ratio >= 0.999
          return (
            <Path
              key={i}
              d={`M ${p.x} ${p.y} A ${R * 0.99} ${R * 0.99} 0 0 1 ${q.x} ${q.y}`}
              stroke={bandColor(f)}
              strokeWidth={R * 0.14}
              opacity={filled ? 1 : 0.2}
              fill="none"
            />
          )
        })}
        <Struck x={cx} y={cy + R * 0.17} size={R * 0.42} color="#efe7d6">
          {pct}
        </Struck>
      </Plate>
    </View>
  )
}

/** thermo.png 960×700 · tube x 0.615 · top 0.115 · bottom 0.66 · plate rect. */
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
  const W = 960
  const H = 700
  const tx = W * 0.615
  const ty0 = H * 0.115
  const ty1 = H * 0.66
  const tubeH = ty1 - ty0
  const mercury = useAnimatedProps(() => {
    "worklet"
    const fh = tubeH * fill.value
    return { y: ty1 - fh, height: fh }
  })
  const meniscus = useAnimatedProps(() => {
    "worklet"
    return { cy: ty1 - tubeH * fill.value } as never
  })
  const px = W * 0.045
  const py = H * 0.28
  const pw = W * 0.44
  const ph = H * 0.3
  return (
    <Plate art={ART.thermo} w={W} h={H}>
      <Defs>
        <LinearGradient id="thn_merc" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#ff7c60" />
          <Stop offset="0.5" stopColor="#d63a24" />
          <Stop offset="1" stopColor="#7c1e10" />
        </LinearGradient>
      </Defs>
      <AnimatedRect x={tx - 13} width={26} fill="url(#thn_merc)" animatedProps={mercury} />
      <AnimatedCircle cx={tx} r={13} fill="#d63a24" animatedProps={meniscus} />
      <Rect x={tx - 13} y={ty1 - 4} width={26} height={14} fill="#d63a24" />
      <Rect x={tx - 9} y={ty0} width={5} height={tubeH} fill="#fff" opacity={0.5} />
      <Struck x={px + pw / 2} y={py + ph * 0.46} size={ph * 0.34} color="#eadfc2">
        {value}
      </Struck>
      {pct != null ? (
        <Struck x={px + pw / 2} y={py + ph * 0.82} size={ph * 0.22} color={tone}>
          {pct}
        </Struck>
      ) : null}
    </Plate>
  )
}

/** tank-*.png 960×560 · body rect (0.10, 0.16, 0.80, 0.52). */
function GlassTank({ fill, metal }: { fill: SharedValue<number>; metal: "silver" | "gold" }): ReactNode {
  const W = 960
  const H = 560
  const x0 = W * 0.1
  const y0 = H * 0.16
  const bw = W * 0.8
  const bh = H * 0.52
  const cover = useAnimatedProps(() => {
    "worklet"
    const fw = (bw - 16) * fill.value
    return { x: x0 + 8 + fw, width: Math.max(0, bw - 16 - fw) }
  })
  return (
    <Plate art={metal === "gold" ? ART.tankGold : ART.tankSilver} w={W} h={H}>
      <AnimatedRect y={y0 + 6} height={bh - 12} rx={bh * 0.16} fill="#0e1114" opacity={0.93} animatedProps={cover} />
    </Plate>
  )
}

/** chest-*.png 960×760 · slot (0.185, 0.565, 0.63, 0.075) · plates row 0.70. */
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
  const W = 960
  const H = 760
  const sx = W * 0.185
  const sy = H * 0.565
  const sw = W * 0.63
  const sh = H * 0.075
  const bar = useAnimatedProps(() => {
    "worklet"
    return { width: sw * fill.value }
  })
  const plateY = H * 0.70
  const p1w = sw * 0.58
  const p2w = sw * 0.36
  return (
    <Plate art={metal === "gold" ? ART.chestGold : ART.chestSilver} w={W} h={H}>
      <AnimatedRect x={sx} y={sy + 4} height={sh - 8} rx={(sh - 8) / 2} fill={tone} animatedProps={bar} />
      <AnimatedRect x={sx} y={sy + 8} height={sh * 0.22} rx={sh * 0.11} fill="#fff" opacity={0.28} animatedProps={bar} />
      {/* engraved plates on the chest front */}
      <Rect x={sx} y={plateY} width={p1w} height={H * 0.095} rx={12} fill="#0d0b08" stroke="#c9a55c" strokeWidth={4.5} />
      <Rect x={sx + p1w + sw * 0.06} y={plateY} width={p2w} height={H * 0.095} rx={12} fill="#0d0b08" stroke="#c9a55c" strokeWidth={4.5} />
      <Struck x={sx + p1w / 2} y={plateY + H * 0.066} size={H * 0.06} color="#eadfc2">
        {value}
      </Struck>
      <Struck x={sx + p1w + sw * 0.06 + p2w / 2} y={plateY + H * 0.066} size={H * 0.06} color={tone}>
        {pct ?? "—"}
      </Struck>
    </Plate>
  )
}

/** balance.png 960×720 · value plate rect (0.60, 0.36, 0.36, 0.30). */
function BalanceScale({
  value,
  pct,
  tone,
}: {
  value: string
  pct: string | null
  tone: string
}): ReactNode {
  const W = 960
  const H = 720
  const px = W * 0.6
  const py = H * 0.36
  const pw = W * 0.36
  const ph = H * 0.3
  return (
    <Plate art={ART.balance} w={W} h={H}>
      <Rect x={px} y={py} width={pw} height={ph} rx={14} fill="#0d0b08" stroke="#c9a55c" strokeWidth={4} />
      <Rect x={px + 8} y={py + 8} width={pw - 16} height={ph - 16} rx={9} fill="none" stroke="#000" strokeWidth={3} opacity={0.6} />
      <Struck x={px + pw / 2} y={py + ph * 0.46} size={ph * 0.3} color="#eadfc2">
        {value}
      </Struck>
      {pct != null ? (
        <Struck x={px + pw / 2} y={py + ph * 0.82} size={ph * 0.22} color={tone}>
          {pct}
        </Struck>
      ) : null}
    </Plate>
  )
}

/** loupe.png 900×760 · lens centre (0.44, 0.42) · lens R = 0.28 × width. */
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
  const W = 900
  const H = 760
  const cx = W * 0.44
  const cy = H * 0.42
  const R = W * 0.28
  const ringR = R * 0.9
  const circ = 2 * Math.PI * ringR
  return (
    <Plate art={ART.loupe} w={W} h={H}>
      <Circle cx={cx} cy={cy} r={ringR} fill="none" stroke="#08110d" strokeWidth={R * 0.075} opacity={0.85} />
      <Circle
        cx={cx}
        cy={cy}
        r={ringR}
        fill="none"
        stroke={tone}
        strokeWidth={R * 0.06}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - Math.max(0.012, ratio))}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <Struck x={cx} y={cy - R * 0.02} size={R * 0.3} color="#efe7d6">
        {value}
      </Struck>
      <Struck x={cx} y={cy + R * 0.32} size={R * 0.2} color={tone}>
        {pct}
      </Struck>
    </Plate>
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
    face = <LockedFace />
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
        face = <BalanceScale value={metric.valueText} pct={metric.pctText} tone={metric.tone} />
        inlineValues = true
        break
      case "lens":
        face = (
          <MagnifierLens pct={metric.pctText ?? ""} ratio={metric.ratio} tone={metric.tone} value={metric.valueText} />
        )
        inlineValues = true
        break
      default:
        face = <LockedFace />
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
// Feature panels — baked parchment + live rows / route
// ─────────────────────────────────────────────────────────────────────────────

/** scroll.png 1080×660 · sheet from y 0.115 → 0.885, safe x inset 0.09. */
export function GoalsScroll({ bars }: { bars: MonthlyBar[] }): ReactNode {
  return (
    <View style={{ width: "100%", aspectRatio: 1080 / 660 }}>
      <Image source={ART.scroll} style={{ position: "absolute", width: "100%", height: "100%" }} resizeMode="stretch" />
      <View style={{ flex: 1, paddingHorizontal: "9%", paddingTop: "12.5%", paddingBottom: "12%", gap: 7 }}>
        <View style={{ alignItems: "center" }}>
          <Text style={{ color: C.parchmentInk, fontSize: 13, fontWeight: "800", letterSpacing: 1, textShadowColor: "#f4e9c8", textShadowOffset: { width: 0, height: 0.8 }, textShadowRadius: 0.5 }}>
            MONATSZIELE
          </Text>
          <Text style={{ color: C.giltDeep, fontSize: 9.5, marginTop: -1 }}>Übersicht</Text>
        </View>
        <View style={{ flex: 1, justifyContent: "space-evenly" }}>
          {bars.map((b) => (
            <View key={b.label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ color: C.parchmentInk, fontSize: 11.5, lineHeight: 15, fontWeight: "700", width: 64 }} numberOfLines={1}>
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
    </View>
  )
}

/** map.png 1080×560 · X at (0.1, 0.66) · island chest at (0.85, 0.6). */
export function TreasureMapPanel({ overall, available }: { overall: number; available: boolean }): ReactNode {
  const pct = Math.round(overall * 100)
  const p = Math.max(0, Math.min(1, overall))
  const W = 1080
  const H = 560
  const route = `M ${W * 0.115} ${H * 0.64} C ${W * 0.32} ${H * 0.36}, ${W * 0.52} ${H * 0.82}, ${W * 0.80} ${H * 0.56}`
  // ship position along the same cubic (coarse param — decorative)
  const t = p
  const bez = (a: number, b: number, c: number, d: number, tt: number): number => {
    const mt = 1 - tt
    return mt * mt * mt * a + 3 * mt * mt * tt * b + 3 * mt * tt * tt * c + tt * tt * tt * d
  }
  const shipX = bez(W * 0.115, W * 0.32, W * 0.52, W * 0.8, t)
  const shipY = bez(H * 0.64, H * 0.36, H * 0.82, H * 0.56, t) - H * 0.02
  return (
    <View style={{ width: "100%", aspectRatio: W / H }}>
      <Image source={ART.map} style={{ position: "absolute", width: "100%", height: "100%" }} resizeMode="stretch" />
      <View style={{ position: "absolute", top: "4.5%", left: 0, right: 0, alignItems: "center" }}>
        <Text style={{ color: "#2e2412", fontSize: 13, fontWeight: "800", letterSpacing: 1, textShadowColor: "#eddfb6", textShadowOffset: { width: 0, height: 0.8 }, textShadowRadius: 0.5 }}>
          GESAMTÜBERSICHT
        </Text>
        <Text style={{ color: "#6b552c", fontSize: 9.5 }}>Alle Ziele auf einen Blick</Text>
      </View>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute" }}>
        <Defs>
          <LinearGradient id="mpn_hull" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#5d4526" />
            <Stop offset="1" stopColor="#2c1f0e" />
          </LinearGradient>
        </Defs>
        <Path d={route} fill="none" stroke="#3a2c16" strokeWidth={7} opacity={0.16} strokeDasharray="4 18" strokeLinecap="round" transform="translate(0,4)" />
        <Path d={route} fill="none" stroke="#5c4626" strokeWidth={5.4} opacity={0.4} strokeDasharray="4 18" strokeLinecap="round" />
        <Path d={route} fill="none" stroke="#3f2f13" strokeWidth={6} opacity={0.9} strokeDasharray={`${p * 1400} 2800`} strokeLinecap="round" />
        {/* the galleon under sail */}
        <G transform={`translate(${shipX}, ${shipY}) rotate(-3) scale(2.6)`}>
          <Path d="M -18 9 q 7 2.6 14 0 q 7 -2.6 14 0" stroke="#6f5a34" strokeWidth={1} opacity={0.5} fill="none" />
          <Path d="M -16 2 Q 0 9 16 2 L 11 12 L -11 12 Z" fill="url(#mpn_hull)" stroke="#241708" strokeWidth={1} />
          <Path d="M -16 2 L 16 2" stroke="#c9a55c" strokeWidth={1.2} />
          <Path d="M -6 2 L -6 -20" stroke="#241708" strokeWidth={1.6} />
          <Path d="M 7 2 L 7 -13" stroke="#241708" strokeWidth={1.3} />
          <Path d="M -6 -19 Q 2 -13 5 -5 L -6 -3 Z" fill="#efe8d5" />
          <Path d="M -6 -19 Q 2 -13 5 -5 L 1 -6 Z" fill="#c9bb9e" opacity={0.75} />
          <Path d="M -6 -13 Q -12 -9 -14 -4 L -6 -2.6 Z" fill="#e4dbc4" />
          <Path d="M 7 -12 Q 12 -8 13 -3.6 L 7 -2.4 Z" fill="#e9e0ca" />
          <Path d="M -6 -20.4 L -1 -18.8 L -6 -17.2 Z" fill="#a02c17" />
        </G>
        <Struck x={W * 0.72} y={H * 0.87} size={H * 0.15} color={available && pct >= 75 ? "#4e7a3a" : "#6f5620"}>
          {available ? `${pct}%` : "—"}
        </Struck>
        <Struck x={W * 0.72} y={H * 0.945} size={H * 0.05} color="#4a3a20" weight="600">
          Zielerreichung
        </Struck>
      </Svg>
    </View>
  )
}
