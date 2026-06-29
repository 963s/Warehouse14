/**
 * Zielkarte instruments — antique brass gauges drawn as rich vector SVG, lit from
 * a single TOP-LEFT source. One shared material system across the board: a 4-zone
 * brass ramp (specular #f6e0a6 → mid #c9a55c → deep #8a6d2f → core shadow #4f3d1a),
 * domed rivets (seat + body + up-left glint), specular-crescent lip highlights on
 * every round rim, a cool-dark glass recipe (sheen up-left, occlusion down-right),
 * and aged parchment (vertical gradient + edge vignette + tea-stains + rolled ends).
 * No SVG filters/blur — depth is faked with stacked light/dark shapes + low-opacity
 * transparent-rim radials (iOS + Android react-native-svg safe).
 *
 * Gotchas obeyed: worklet helpers carry "worklet"; any <Svg width="100%"> wrapped
 * in a <View> gives that View width:"100%"; animated SVG components are module-scope;
 * gradient ids are namespaced per instrument.
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

const SPRING = { damping: 18, stiffness: 90, mass: 1 } as const
const SVG_W = 150

// brass ramp
const B_SPEC = "#f6e0a6"
const B_MID = "#c9a55c"
const B_DEEP = "#8a6d2f"
const B_SHADOW = "#4f3d1a"
const B_SEAT = "#3a2c12"
const GLINT = "#fff7e0"

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
/** Upper-left specular crescent path (≈195°→290°) — the "metal looks round" lift. */
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

// ── shared material gradients (place inside an <Svg>'s <Defs>) ─────────────────

function Brass4({ id, h = false }: { id: string; h?: boolean }): ReactNode {
  // lit→shadow along the light axis (top-left → bottom-right by default)
  return (
    <LinearGradient id={id} x1="0" y1="0" x2={h ? "1" : "0.85"} y2={h ? "0.2" : "1"}>
      <Stop offset="0" stopColor="#fdecb2" />
      <Stop offset="0.24" stopColor="#e7c97f" />
      <Stop offset="0.5" stopColor={B_MID} />
      <Stop offset="0.78" stopColor={B_DEEP} />
      <Stop offset="1" stopColor="#3a2c10" />
    </LinearGradient>
  )
}
function BrassDomeGrad({ id }: { id: string }): ReactNode {
  return (
    <RadialGradient id={id} cx="0.34" cy="0.28" r="0.9">
      <Stop offset="0" stopColor="#fdecb2" />
      <Stop offset="0.45" stopColor={B_MID} />
      <Stop offset="1" stopColor="#3a2c10" />
    </RadialGradient>
  )
}

/** A 3-layer domed rivet: seat shadow (down-right) · brass body · glint (up-left). */
function Rivet({ cx, cy, r, dome, dim = false }: { cx: number; cy: number; r: number; dome: string; dim?: boolean }): ReactNode {
  return (
    <G>
      <Circle cx={cx + r * 0.45} cy={cy + r * 0.5} r={r} fill={B_SEAT} opacity={0.8} />
      <Circle cx={cx} cy={cy} r={r} fill={`url(#${dome})`} />
      <Circle cx={cx - r * 0.4} cy={cy - r * 0.45} r={r * 0.42} fill={GLINT} opacity={dim ? 0.4 : 0.85} />
    </G>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Frame + plate
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
        backgroundColor: C.panel,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: C.edge,
        borderTopColor: "#3d331f",
        borderBottomColor: "#0d0b07",
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 12,
        gap: 8,
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      {/* recessed-panel finish: corner vignette + top sheen (behind content) */}
      <Svg
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        pointerEvents="none"
      >
        <Defs>
          <RadialGradient id="frm_vig" cx="0.5" cy="0.32" r="0.95">
            <Stop offset="0" stopColor="#2c2517" stopOpacity={0.4} />
            <Stop offset="0.55" stopColor="#15130e" stopOpacity={0} />
            <Stop offset="1" stopColor="#000" stopOpacity={0.5} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={100} height={100} fill="url(#frm_vig)" />
        <Rect x={0} y={0} width={100} height={2} fill="#4a3f29" opacity={0.45} />
      </Svg>
      <View style={{ alignItems: "center", gap: 1 }}>
        <Text style={{ color: C.ink, fontSize: 12.5, fontWeight: "700", letterSpacing: 0.7 }} numberOfLines={1}>
          {title}
        </Text>
        <Text style={{ color: C.inkMuted, fontSize: 10.5 }} numberOfLines={1}>
          {zielText}
        </Text>
      </View>
      {children}
    </View>
  )
}

/** Engraved value plate: a brass-framed sunken slab, struck numerals. */
function ValuePlate({ value, pct, tone }: { value: string; pct: string | null; tone: string }): ReactNode {
  return (
    <View
      style={{
        backgroundColor: C.glass,
        borderRadius: 7,
        borderWidth: 1.5,
        borderColor: B_DEEP,
        borderTopColor: B_SPEC,
        borderLeftColor: B_MID,
        paddingHorizontal: 12,
        paddingVertical: 5,
        alignItems: "center",
        minWidth: "62%",
      }}
    >
      <Text style={{ color: B_SPEC, fontSize: 18, fontWeight: "800" }} numberOfLines={1}>
        {value}
      </Text>
      {pct != null ? (
        <Text style={{ color: tone, fontSize: 11, fontWeight: "800", marginTop: -1 }}>{pct}</Text>
      ) : null}
    </View>
  )
}

function LockedFace({ height }: { height: number }): ReactNode {
  return (
    <View style={{ height, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: C.inkFaint, fontSize: 11 }}>gleich verfügbar</Text>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Instruments
// ─────────────────────────────────────────────────────────────────────────────

/** Brass speedometer: milled bezel + rivets, enamel dial, beveled colour track,
 *  graduations, a tapered counter-weighted needle on a domed hub. */
function ArcGauge({ fill }: { fill: SharedValue<number> }): ReactNode {
  const h = 96
  const cx = SVG_W / 2
  const cy = 80
  const r = 58
  const needle = useAnimatedProps(() => {
    "worklet"
    const a = 180 + fill.value * 180
    const tip = polar(cx, cy, r - 14, a)
    return { x2: tip.x, y2: tip.y }
  })
  const tail = useAnimatedProps(() => {
    "worklet"
    const a = 180 + fill.value * 180
    const t = polar(cx, cy, 12, a + 180)
    return { x2: t.x, y2: t.y }
  })
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${SVG_W} ${h}`}>
      <Defs>
        <Brass4 id="arc_bezel" />
        <BrassDomeGrad id="arc_dome" />
        <RadialGradient id="arc_dial" cx="0.4" cy="0.32" r="0.95">
          <Stop offset="0" stopColor="#27221b" />
          <Stop offset="0.6" stopColor="#171410" />
          <Stop offset="1" stopColor="#0a0805" />
        </RadialGradient>
        <LinearGradient id="arc_band" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#e23a25" />
          <Stop offset="0.5" stopColor="#f0b02f" />
          <Stop offset="1" stopColor="#3fa84d" />
        </LinearGradient>
      </Defs>
      {/* dial face */}
      <Path d={arc(cx, cy, r - 8, 178, 362)} stroke="url(#arc_dial)" strokeWidth={30} fill="none" />
      <Ellipse cx={cx - 16} cy={cy - 30} rx={16} ry={7} fill="#ffffff" opacity={0.05} />
      {/* milled bezel: occlusion + brass band + specular crescent + reflected edge */}
      <Path d={arc(cx, cy, r + 5, 177, 363)} stroke={B_SHADOW} strokeWidth={11} fill="none" strokeLinecap="round" />
      <Path d={arc(cx, cy, r + 5, 178, 362)} stroke="url(#arc_bezel)" strokeWidth={8} fill="none" strokeLinecap="round" />
      <Path d={crescent(cx, cy, r + 5)} stroke={B_SPEC} strokeWidth={1.6} opacity={0.85} fill="none" strokeLinecap="round" />
      <Ellipse cx={polar(cx, cy, r + 5, 224).x} cy={polar(cx, cy, r + 5, 224).y} rx={4.5} ry={2} fill="#fffdf5" opacity={0.75} />
      <Path d={arc(cx, cy, r + 5, 18, 92)} stroke="#241a0c" strokeWidth={2.4} opacity={0.5} fill="none" />
      <Path d={arc(cx, cy, r - 2, 300, 358)} stroke="#b98f44" strokeWidth={1} opacity={0.5} fill="none" />
      {/* beveled colour track */}
      <Path d={arc(cx, cy, r - 5, 180, 360)} stroke="#000" strokeWidth={9} opacity={0.55} fill="none" strokeLinecap="round" />
      <Path d={arc(cx, cy, r - 5, 180, 360)} stroke="url(#arc_band)" strokeWidth={6.5} fill="none" strokeLinecap="round" />
      <Path d={arc(cx, cy, r - 3, 182, 358)} stroke="#ffffff" strokeWidth={1} opacity={0.25} fill="none" />
      {/* graduations */}
      {Array.from({ length: 21 }).map((_, i) => {
        const a = 180 + i * 9
        const major = i % 5 === 0
        const p1 = polar(cx, cy, r - 9, a)
        const p2 = polar(cx, cy, r - (major ? 15 : 12), a)
        return <Line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={major ? "#d8b873" : "#6e5a32"} strokeWidth={major ? 1.3 : 0.6} />
      })}
      <SvgText x={cx - r + 6} y={cy - 1} fill="#caa86a" fontSize={7.5} fontWeight="700">0%</SvgText>
      <SvgText x={cx} y={cy - r + 4} fill="#caa86a" fontSize={7.5} fontWeight="700" textAnchor="middle">50%</SvgText>
      <SvgText x={cx + r - 13} y={cy - 1} fill="#caa86a" fontSize={7.5} fontWeight="700">100%</SvgText>
      {/* bezel rivets */}
      {[180, 225, 270, 315, 360].map((a, i) => {
        const p = polar(cx, cy, r + 5, a)
        return <Rivet key={i} cx={p.x} cy={p.y} r={2} dome="arc_dome" dim={a > 290} />
      })}
      {/* mounting bracket: top hex nut + two end tabs (the gauge sits in a frame) */}
      <Polygon points={hexPts(cx, cy - r - 5, 5.5)} fill="url(#arc_dome)" stroke={B_SEAT} strokeWidth={0.6} />
      <Circle cx={cx - 1.6} cy={cy - r - 6.6} r={1.5} fill={GLINT} opacity={0.85} />
      <Rect x={cx - r - 12} y={cy - 6} width={13} height={12} rx={2} fill="url(#arc_bezel)" stroke={B_SEAT} strokeWidth={0.6} />
      <Rect x={cx + r - 1} y={cy - 6} width={13} height={12} rx={2} fill="url(#arc_bezel)" stroke={B_SEAT} strokeWidth={0.6} />
      <Rivet cx={cx - r - 5.5} cy={cy} r={1.5} dome="arc_dome" />
      <Rivet cx={cx + r + 5.5} cy={cy} r={1.5} dome="arc_dome" dim />
      {/* needle + counterweight + domed hub */}
      <AnimatedLine x1={cx} y1={cy} animatedProps={tail} stroke={B_DEEP} strokeWidth={4} strokeLinecap="round" />
      <AnimatedLine x1={cx} y1={cy} animatedProps={needle} stroke="url(#arc_bezel)" strokeWidth={3.4} strokeLinecap="round" />
      <Circle cx={cx} cy={cy} r={7} fill={B_SEAT} />
      <Circle cx={cx} cy={cy} r={5.5} fill="url(#arc_dome)" />
      <Circle cx={cx - 2} cy={cy - 2.4} r={1.8} fill={GLINT} />
    </Svg>
  )
}

/** Steampunk vault porthole: forged riveted brass torus + hinge, a sunken
 *  graduated colour ring, a cool-deep central chamber carrying the %. */
function VaultRing({ pct, ratio }: { pct: string; ratio: number }): ReactNode {
  const h = 100
  const cx = SVG_W / 2
  const cy = h / 2
  const r = 34
  const tone = (a: number): string => {
    const f = (a + 90) / 360
    return f < 0.34 ? "#d23b27" : f < 0.7 ? "#e3a72e" : "#3f9d4b"
  }
  return (
    <View style={{ width: "100%" }}>
      <Svg width="100%" height={h} viewBox={`0 0 ${SVG_W} ${h}`}>
        <Defs>
          <Brass4 id="vr_rim" />
          <BrassDomeGrad id="vr_bolt" />
          <RadialGradient id="vr_well" cx="0.42" cy="0.36" r="0.75">
            <Stop offset="0" stopColor="#20303a" />
            <Stop offset="0.55" stopColor="#11202a" />
            <Stop offset="1" stopColor="#060c10" />
          </RadialGradient>
        </Defs>
        {/* contact shadow */}
        <Ellipse cx={cx + 2} cy={cy + r + 12} rx={r} ry={4} fill="#000" opacity={0.3} />
        {/* hinge */}
        <Rect x={cx - r - 22} y={cy - 10} width={13} height={20} rx={2} fill="url(#vr_rim)" stroke={B_SEAT} strokeWidth={1} />
        <Rivet cx={cx - r - 15} cy={cy - 4} r={1.6} dome="vr_bolt" />
        <Rivet cx={cx - r - 15} cy={cy + 4} r={1.6} dome="vr_bolt" />
        {/* right latch handle */}
        <Rect x={cx + r + 6} y={cy - 7} width={11} height={14} rx={2} fill="url(#vr_rim)" stroke={B_SEAT} strokeWidth={1} />
        <Rect x={cx + r + 8} y={cy + 4} width={7} height={11} rx={2} fill="url(#vr_rim)" stroke={B_SEAT} strokeWidth={0.8} />
        <Rivet cx={cx + r + 11.5} cy={cy - 2} r={1.6} dome="vr_bolt" dim />
        {/* forged torus: occlusion + lit outer + band + specular crescent */}
        <Circle cx={cx} cy={cy} r={r + 12} fill={B_SEAT} />
        <Circle cx={cx} cy={cy} r={r + 11} fill="none" stroke="url(#vr_rim)" strokeWidth={12} />
        <Path d={crescent(cx, cy, r + 11)} stroke={B_SPEC} strokeWidth={2.2} opacity={0.7} fill="none" strokeLinecap="round" />
        <Ellipse cx={polar(cx, cy, r + 11, 222).x} cy={polar(cx, cy, r + 11, 222).y} rx={5.5} ry={2.4} fill="#fffdf5" opacity={0.7} />
        <Path d={arc(cx, cy, r + 11, 16, 96)} stroke="#241a0c" strokeWidth={3} opacity={0.5} fill="none" />
        <Path d={arc(cx, cy, r + 11, 30, 100)} stroke="#b98f44" strokeWidth={1.4} opacity={0.45} fill="none" />
        {/* bolts */}
        {Array.from({ length: 8 }).map((_, i) => {
          const a = i * 45 - 90
          const p = polar(cx, cy, r + 11, a)
          return <Rivet key={i} cx={p.x} cy={p.y} r={2} dome="vr_bolt" dim={a > 10 && a < 170} />
        })}
        {/* sunken graduated colour ring */}
        <Circle cx={cx} cy={cy} r={r - 1} fill="none" stroke="#0d0a05" strokeWidth={6} />
        {Array.from({ length: 40 }).map((_, i) => {
          const a = i * 9 - 90
          const filled = i / 40 <= ratio
          const p1 = polar(cx, cy, r + 2, a)
          const p2 = polar(cx, cy, r - 4, a)
          return <Line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={tone(a)} strokeWidth={2.4} opacity={filled ? 1 : 0.18} />
        })}
        {/* vault chamber */}
        <Circle cx={cx} cy={cy} r={r - 6} fill="url(#vr_well)" />
        <Path d={arc(cx, cy, r - 7, 200, 290)} stroke="#000" strokeWidth={3} opacity={0.5} fill="none" />
        <Path d={arc(cx, cy, r - 8, 30, 90)} stroke="#6fa0b8" strokeWidth={1.6} opacity={0.35} fill="none" />
        <Ellipse cx={cx} cy={cy + 2} rx={18} ry={10} fill="#ffd27a" opacity={0.08} />
      </Svg>
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: C.ink, fontSize: 20, fontWeight: "800" }}>{pct}</Text>
      </View>
    </View>
  )
}

/** Glass thermometer: cylindrical glass tube + sheen, encased mercury + meniscus,
 *  a glass-sphere bulb, a brass ferrule + an engraved scale plate. */
function Thermometer({ fill, tone }: { fill: SharedValue<number>; tone: string }): ReactNode {
  const h = 100
  const tx = 64
  const tubeTop = 12
  const tubeBot = 64
  const tubeH = tubeBot - tubeTop
  const mercury = useAnimatedProps(() => {
    "worklet"
    const fh = tubeH * fill.value
    return { y: tubeBot - fh, height: fh }
  })
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${SVG_W} ${h}`}>
      <Defs>
        <LinearGradient id="th_glass" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#322c22" />
          <Stop offset="0.45" stopColor="#0b0906" />
          <Stop offset="0.8" stopColor="#161109" />
          <Stop offset="1" stopColor="#2a2114" />
        </LinearGradient>
        <RadialGradient id="th_bulb" cx="0.36" cy="0.3" r="0.8">
          <Stop offset="0" stopColor="#ff7d5e" />
          <Stop offset="0.55" stopColor="#ef4b34" />
          <Stop offset="1" stopColor="#6e1d10" />
        </RadialGradient>
        <Brass4 id="th_collar" />
      </Defs>
      {/* contact shadow */}
      <Ellipse cx={tx + 8} cy={tubeBot + 26} rx={15} ry={4} fill="#000" opacity={0.28} />
      {/* engraved scale plate */}
      <Rect x={90} y={10} width={32} height={56} rx={3} fill="#15110b" stroke={B_DEEP} strokeWidth={1} />
      <Line x1={90} y1={11} x2={122} y2={11} stroke="#000" strokeWidth={1} opacity={0.6} />
      <Line x1={90} y1={65} x2={122} y2={65} stroke={B_SPEC} strokeWidth={0.6} opacity={0.4} />
      {[0, 25, 50, 75, 100].map((p) => {
        const y = tubeBot - (tubeH * p) / 100
        return (
          <G key={p}>
            <Line x1={94} y1={y} x2={101} y2={y} stroke={B_MID} strokeWidth={1.2} />
            <Line x1={94} y1={y + 0.5} x2={101} y2={y + 0.5} stroke="#000" strokeWidth={0.5} opacity={0.5} />
            <SvgText x={104} y={y + 3} fill="#d8c187" fontSize={7.5} fontWeight="700">{p}%</SvgText>
          </G>
        )
      })}
      {/* tube */}
      <Rect x={tx} y={tubeTop} width={16} height={tubeH + 6} rx={8} fill="url(#th_glass)" stroke="#3a342a" strokeWidth={1.2} />
      {/* mercury (animated) + encasing overlays */}
      <AnimatedRect x={tx + 3.5} width={9} rx={4.5} fill={tone} animatedProps={mercury} />
      <Rect x={tx + 3.5} y={tubeBot - 6} width={9} height={7} fill={tone} />
      <Rect x={tx + 4} y={tubeTop + 2} width={2.4} height={tubeH} rx={1.2} fill="#fff" opacity={0.2} />
      <Rect x={tx + 11} y={tubeTop + 2} width={2} height={tubeH} rx={1} fill="#000" opacity={0.22} />
      {/* brass ferrule */}
      <Rect x={tx - 1} y={9} width={18} height={9} rx={3} fill="url(#th_collar)" stroke={B_SEAT} strokeWidth={0.8} />
      <Line x1={tx - 1} y1={10} x2={tx + 17} y2={10} stroke={B_SPEC} strokeWidth={0.7} opacity={0.7} />
      {/* glass-sphere bulb */}
      <Circle cx={tx + 8} cy={tubeBot + 14} r={13} fill="url(#th_bulb)" stroke={B_SHADOW} strokeWidth={1.2} />
      <Path d={arc(tx + 8, tubeBot + 14, 11, 110, 250)} stroke="#4a120a" strokeWidth={3} opacity={0.5} fill="none" />
      <Ellipse cx={tx + 3} cy={tubeBot + 9} rx={4} ry={2.6} fill="#ffe6da" opacity={0.85} />
      <Circle cx={tx + 4} cy={tubeBot + 10} r={1.4} fill="#fff" opacity={0.9} />
    </Svg>
  )
}

/** Horizontal glass cylinder: domed riveted brass caps + band, a mounded pellet
 *  heap (silver/gold), glass sheen + base occlusion. */
function GlassTank({ fill, metal }: { fill: SharedValue<number>; metal: "silver" | "gold" }): ReactNode {
  const h = 80
  const x = 14
  const y = 22
  const w = SVG_W - 28
  const tankH = 38
  const cy = y + tankH / 2
  const fillW = w - 10
  const pelletFill = useAnimatedProps(() => {
    "worklet"
    return { width: fillW * fill.value }
  })
  const cap = metal === "gold" ? "gt_capG" : "gt_capS"
  const pile = metal === "gold" ? "gt_pileG" : "gt_pileS"
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${SVG_W} ${h}`}>
      <Defs>
        <RadialGradient id="gt_capG" cx="0.32" cy="0.3" r="0.85">
          <Stop offset="0" stopColor={B_SPEC} />
          <Stop offset="0.55" stopColor={B_MID} />
          <Stop offset="1" stopColor={B_SHADOW} />
        </RadialGradient>
        <RadialGradient id="gt_capS" cx="0.32" cy="0.3" r="0.85">
          <Stop offset="0" stopColor="#eef1f5" />
          <Stop offset="0.55" stopColor="#aeb4bc" />
          <Stop offset="1" stopColor="#5b626b" />
        </RadialGradient>
        <LinearGradient id="gt_glass" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3a4047" />
          <Stop offset="0.42" stopColor="#1b2027" />
          <Stop offset="1" stopColor="#0a0d11" />
        </LinearGradient>
        <LinearGradient id="gt_pileG" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#f6e0a6" />
          <Stop offset="0.5" stopColor={B_MID} />
          <Stop offset="1" stopColor={B_DEEP} />
        </LinearGradient>
        <LinearGradient id="gt_pileS" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#f2f4f7" />
          <Stop offset="0.5" stopColor="#b9c0c7" />
          <Stop offset="1" stopColor="#6c747c" />
        </LinearGradient>
      </Defs>
      {/* contact shadow */}
      <Ellipse cx={cx_(x, w)} cy={y + tankH + 6} rx={w / 2} ry={3.5} fill="#000" opacity={0.35} />
      {/* glass body */}
      <Rect x={x} y={y} width={w} height={tankH} rx={tankH / 2} fill="url(#gt_glass)" stroke="#1a1d21" strokeWidth={1.5} />
      {/* pellet pile (animated width) */}
      <AnimatedRect x={x + 5} y={y + 5} height={tankH - 10} rx={(tankH - 10) / 2} fill={`url(#${pile})`} animatedProps={pelletFill} />
      <AnimatedRect x={x + 5} y={y + 6} height={5} rx={2.5} fill="#ffffff" opacity={0.22} animatedProps={pelletFill} />
      {/* glass sheen + base occlusion */}
      <Path d={`M ${x + 10} ${y + 4} Q ${cx_(x, w)} ${y + 1} ${x + w - 10} ${y + 4}`} stroke="#eef3f7" strokeWidth={3} opacity={0.4} fill="none" strokeLinecap="round" />
      <Path d={`M ${x + 12} ${y + tankH - 3} Q ${cx_(x, w)} ${y + tankH + 1} ${x + w - 12} ${y + tankH - 3}`} stroke="#05070a" strokeWidth={2.5} opacity={0.5} fill="none" strokeLinecap="round" />
      {/* end caps + rivets */}
      <Ellipse cx={x} cy={cy} rx={8} ry={tankH / 2 + 2} fill={`url(#${cap})`} stroke={B_SEAT} strokeWidth={1} />
      <Ellipse cx={x + w} cy={cy} rx={8} ry={tankH / 2 + 2} fill={`url(#${cap})`} stroke={B_SEAT} strokeWidth={1} />
      <Ellipse cx={x - 2} cy={cy - 9} rx={2.4} ry={5} fill={metal === "gold" ? B_SPEC : "#fff"} opacity={0.5} />
      <Ellipse cx={x + w - 3} cy={cy - 9} rx={2.2} ry={4.5} fill={metal === "gold" ? B_SPEC : "#fff"} opacity={0.32} />
      {[cy - 9, cy, cy + 9].map((ry, i) => (
        <Rivet key={`l${i}`} cx={x} cy={ry} r={1.5} dome={cap} />
      ))}
      {[cy - 9, cy, cy + 9].map((ry, i) => (
        <Rivet key={`r${i}`} cx={x + w} cy={ry} r={1.5} dome={cap} dim />
      ))}
      {/* centre band */}
      <Rect x={cx_(x, w) - 4} y={y - 2} width={8} height={tankH + 4} rx={2} fill="url(#gt_pileG)" opacity={metal === "gold" ? 0 : 0} />
      {/* curved glass specular streak (top) */}
      <Path d={`M ${x + 14} ${y + 7} Q ${x + 30} ${y + 3} ${x + 46} ${y + 8}`} stroke="#fff" strokeWidth={2.5} opacity={0.45} fill="none" strokeLinecap="round" />
    </Svg>
  )
}
function cx_(x: number, w: number): number {
  return x + w / 2
}

/** Wooden chest: barrel lid + crown sheen, iron brackets + banded rivets, a coin
 *  heap (gold/silver spheres), a beveled lock hasp, an inset progress gauge. */
function TreasureChest({ fill, tone, metal }: { fill: SharedValue<number>; tone: string; metal: "gold" | "silver" }): ReactNode {
  const h = 84
  const cx = SVG_W / 2
  const bodyW = 100
  const x = cx - bodyW / 2
  const lidY = 8
  const bodyY = 32
  const barX = x + 10
  const barW = bodyW - 20
  const coin = metal === "gold" ? "ch_coinG" : "ch_coinS"
  const bar = useAnimatedProps(() => {
    "worklet"
    return { width: barW * fill.value }
  })
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${SVG_W} ${h}`}>
      <Defs>
        <LinearGradient id="ch_wood" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#5e4628" />
          <Stop offset="1" stopColor="#2c1f0e" />
        </LinearGradient>
        <LinearGradient id="ch_lid" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#6e5331" />
          <Stop offset="0.5" stopColor="#4a3519" />
          <Stop offset="1" stopColor="#2a1d0c" />
        </LinearGradient>
        <Brass4 id="ch_brass" />
        <BrassDomeGrad id="ch_rivet" />
        <RadialGradient id="ch_coinG" cx="0.35" cy="0.3" r="0.85">
          <Stop offset="0" stopColor="#ffe9a8" />
          <Stop offset="0.55" stopColor="#d9b154" />
          <Stop offset="1" stopColor="#8a5e1f" />
        </RadialGradient>
        <RadialGradient id="ch_coinS" cx="0.35" cy="0.3" r="0.85">
          <Stop offset="0" stopColor="#f4f6f9" />
          <Stop offset="0.55" stopColor="#c4c9d0" />
          <Stop offset="1" stopColor="#767d86" />
        </RadialGradient>
      </Defs>
      {/* contact shadow */}
      <Ellipse cx={cx + 2} cy={bodyY + 44} rx={bodyW / 2} ry={4} fill="#000" opacity={0.3} />
      {/* coin heap (behind lid mouth) */}
      <Ellipse cx={cx} cy={bodyY - 2} rx={bodyW / 2 - 6} ry={7} fill="#1a1206" />
      {[
        [x + 16, -1], [x + 30, -3], [x + 46, -5], [x + 62, -3], [x + 78, -1],
        [x + 24, -7], [x + 40, -9], [x + 56, -8], [x + 70, -6],
      ].map((c, i) => (
        <G key={i}>
          <Circle cx={c[0]} cy={bodyY + c[1]} r={5} fill={`url(#${coin})`} stroke={metal === "gold" ? "#8a5e1f" : "#767d86"} strokeWidth={0.8} />
          <Circle cx={c[0] - 1.6} cy={bodyY + c[1] - 1.8} r={1.4} fill="#fff6d8" opacity={0.7} />
        </G>
      ))}
      {/* barrel lid */}
      <Path
        d={`M ${x} ${bodyY} L ${x} ${lidY + 8} Q ${cx} ${lidY - 6} ${x + bodyW} ${lidY + 8} L ${x + bodyW} ${bodyY} Z`}
        fill="url(#ch_lid)"
        stroke="url(#ch_brass)"
        strokeWidth={2}
      />
      <Path d={`M ${x + 4} ${bodyY - 2} Q ${cx} ${lidY - 2} ${x + bodyW - 4} ${bodyY - 2}`} stroke="#f0d9a0" strokeWidth={1.4} opacity={0.5} fill="none" />
      <Line x1={x} y1={bodyY} x2={x + bodyW} y2={bodyY} stroke="url(#ch_brass)" strokeWidth={2} />
      {/* body */}
      <Rect x={x} y={bodyY} width={bodyW} height={42} rx={4} fill="url(#ch_wood)" stroke="url(#ch_brass)" strokeWidth={2} />
      {/* wood stave seams */}
      {[x + 25, x + 50, x + 75].map((sx, i) => (
        <G key={i}>
          <Line x1={sx} y1={bodyY + 3} x2={sx} y2={bodyY + 39} stroke="#2a1d0c" strokeWidth={1} />
          <Line x1={sx + 1} y1={bodyY + 3} x2={sx + 1} y2={bodyY + 39} stroke="#6a5030" strokeWidth={0.6} opacity={0.6} />
        </G>
      ))}
      {/* brass bands + rivets */}
      {[bodyY + 6, bodyY + 36].map((by, bi) => (
        <G key={bi}>
          <Rect x={x} y={by} width={bodyW} height={3} fill="url(#ch_brass)" />
          <Line x1={x} y1={by} x2={x + bodyW} y2={by} stroke={B_SPEC} strokeWidth={0.6} opacity={0.6} />
          {[x + 8, x + 30, x + 70, x + bodyW - 8].map((rx, ri) => (
            <Rivet key={ri} cx={rx} cy={by + 1.5} r={1.4} dome="ch_rivet" />
          ))}
        </G>
      ))}
      {/* corner brackets */}
      {[[x + 1, bodyY + 1], [x + bodyW - 7, bodyY + 1], [x + 1, bodyY + 35], [x + bodyW - 7, bodyY + 35]].map((c, i) => (
        <Rect key={i} x={c[0]} y={c[1]} width={6} height={6} rx={1} fill="url(#ch_brass)" stroke={B_SEAT} strokeWidth={0.4} />
      ))}
      {/* progress gauge */}
      <Rect x={barX} y={bodyY + 15} width={barW} height={12} rx={6} fill="#0c0a07" stroke="url(#ch_brass)" strokeWidth={1} />
      <AnimatedRect x={barX} y={bodyY + 15} height={12} rx={6} fill={tone} animatedProps={bar} />
      <AnimatedRect x={barX} y={bodyY + 16} height={3.5} rx={1.75} fill="#fff" opacity={0.22} animatedProps={bar} />
      {/* lock hasp */}
      <Path d={arc(cx, bodyY - 1, 4, 180, 360)} stroke="url(#ch_brass)" strokeWidth={2} fill="none" />
      <Rect x={cx - 5} y={bodyY - 2} width={10} height={12} rx={2} fill="url(#ch_brass)" stroke={B_SEAT} strokeWidth={0.6} />
      <Circle cx={cx} cy={bodyY + 3} r={1.5} fill="#1a130a" />
    </Svg>
  )
}

/** Ornate brass balance: tiered plinth, turned column, beam on a pivot, two
 *  concave pans on chains holding silver + gold spheres. */
function BalanceScale({ fill }: { fill: SharedValue<number> }): ReactNode {
  const h = 88
  const cx = SVG_W / 2
  const beam = useAnimatedProps(() => {
    "worklet"
    const t = (fill.value - 0.5) * 12
    return { x1: cx - 42, y1: 24 + t, x2: cx + 42, y2: 24 - t }
  })
  const Ball = ({ bx, by, gid }: { bx: number; by: number; gid: string }): ReactNode => (
    <G>
      <Circle cx={bx} cy={by} r={2.8} fill={`url(#${gid})`} />
      <Circle cx={bx - 1} cy={by - 1.1} r={1} fill="#fffaf0" opacity={0.85} />
    </G>
  )
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${SVG_W} ${h}`}>
      <Defs>
        <Brass4 id="bs_brass" h />
        <RadialGradient id="bs_gold" cx="0.35" cy="0.3" r="0.85">
          <Stop offset="0" stopColor="#fff3cf" />
          <Stop offset="0.5" stopColor="#d9b154" />
          <Stop offset="1" stopColor="#8a6d2f" />
        </RadialGradient>
        <RadialGradient id="bs_silver" cx="0.35" cy="0.3" r="0.85">
          <Stop offset="0" stopColor="#ffffff" />
          <Stop offset="0.5" stopColor="#c4c9d0" />
          <Stop offset="1" stopColor="#7e858f" />
        </RadialGradient>
      </Defs>
      <Ellipse cx={cx + 2} cy={80} rx={20} ry={3.5} fill="#000" opacity={0.3} />
      {/* tiered plinth */}
      <Polygon points={`${cx - 15},78 ${cx + 15},78 ${cx + 9},70 ${cx - 9},70`} fill="url(#bs_brass)" stroke={B_SEAT} strokeWidth={0.8} />
      <Rect x={cx - 11} y={67} width={22} height={4} rx={1.5} fill="url(#bs_brass)" />
      <Line x1={cx - 11} y1={67.5} x2={cx + 11} y2={67.5} stroke="#fff3cf" strokeWidth={0.6} opacity={0.7} />
      {/* turned column */}
      <Rect x={cx - 2.5} y={16} width={5} height={51} rx={2} fill="url(#bs_brass)" />
      <Line x1={cx} y1={17} x2={cx} y2={66} stroke="#fff3cf" strokeWidth={0.6} opacity={0.5} />
      {[30, 45].map((yy, i) => (
        <Line key={i} x1={cx - 3} y1={yy} x2={cx + 3} y2={yy} stroke={B_SEAT} strokeWidth={1} />
      ))}
      {/* pivot */}
      <Circle cx={cx} cy={15} r={4.5} fill="url(#bs_gold)" stroke={B_SEAT} strokeWidth={0.8} />
      <Circle cx={cx - 1.4} cy={13.6} r={1.4} fill={GLINT} />
      {/* beam (tilts) */}
      <AnimatedLine animatedProps={beam} stroke="url(#bs_brass)" strokeWidth={3.5} strokeLinecap="round" />
      {/* left pan — silver */}
      <Line x1={cx - 42} y1={26} x2={cx - 42} y2={38} stroke="#6f5a28" strokeWidth={1} />
      <Path d={`M ${cx - 55} 38 Q ${cx - 42} 46 ${cx - 29} 38 Q ${cx - 42} 41 ${cx - 55} 38 Z`} fill="url(#bs_brass)" stroke={B_SEAT} strokeWidth={0.5} />
      <Path d={crescent(cx - 42, 39, 13)} stroke={B_SPEC} strokeWidth={1} opacity={0.6} fill="none" />
      <Ball bx={cx - 44} by={35} gid="bs_silver" />
      <Ball bx={cx - 39} by={36} gid="bs_silver" />
      {/* right pan — gold */}
      <Line x1={cx + 42} y1={22} x2={cx + 42} y2={34} stroke="#6f5a28" strokeWidth={1} />
      <Path d={`M ${cx + 29} 34 Q ${cx + 42} 42 ${cx + 55} 34 Q ${cx + 42} 37 ${cx + 29} 34 Z`} fill="url(#bs_brass)" stroke={B_SEAT} strokeWidth={0.5} />
      <Path d={crescent(cx + 42, 35, 13)} stroke={B_SPEC} strokeWidth={1} opacity={0.6} fill="none" />
      <Ball bx={cx + 40} by={31} gid="bs_gold" />
      <Ball bx={cx + 45} by={32} gid="bs_gold" />
    </Svg>
  )
}

/** Magnifying glass: a 3-band beveled brass rim with knurl, tinted optical glass
 *  with a green refraction, a recessed progress channel, a turned grip handle. */
function MagnifierLens({ pct, ratio, tone }: { pct: string; ratio: number; tone: string }): ReactNode {
  const h = 94
  const cx = SVG_W / 2 - 8
  const cy = h / 2 - 4
  const r = 30
  const trackR = r + 6
  const circ = 2 * Math.PI * trackR
  const handle = polar(cx, cy, r + 3, 48)
  const handleEnd = polar(cx, cy, r + 30, 48)
  return (
    <View style={{ width: "100%" }}>
      <Svg width="100%" height={h} viewBox={`0 0 ${SVG_W} ${h}`}>
        <Defs>
          <Brass4 id="mag_rim" h />
          <Brass4 id="mag_handle" />
          <RadialGradient id="mag_glass" cx="0.38" cy="0.32" r="0.8">
            <Stop offset="0" stopColor="#1c2b26" />
            <Stop offset="0.6" stopColor="#14201d" />
            <Stop offset="1" stopColor="#060b0a" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={cx + 14} cy={cy + r + 12} rx={26} ry={5} fill="#000" opacity={0.28} />
        {/* handle */}
        <Line x1={handle.x} y1={handle.y} x2={handleEnd.x} y2={handleEnd.y} stroke="url(#mag_handle)" strokeWidth={7} strokeLinecap="round" />
        <Line x1={handle.x} y1={handle.y - 1.5} x2={handleEnd.x - 1} y2={handleEnd.y - 2.5} stroke={B_SPEC} strokeWidth={1.2} opacity={0.7} strokeLinecap="round" />
        {[16, 21, 26].map((d, i) => {
          const p = polar(cx, cy, r + d, 48)
          return <Circle key={i} cx={p.x} cy={p.y} r={4} fill="url(#mag_handle)" stroke={B_SEAT} strokeWidth={0.4} />
        })}
        {/* recessed progress channel */}
        <Circle cx={cx} cy={cy} r={trackR} fill="none" stroke="#0c1512" strokeWidth={4} />
        <Circle cx={cx} cy={cy} r={trackR} fill="none" stroke="#2f6f57" strokeWidth={4} opacity={0.25} />
        <Circle cx={cx} cy={cy} r={trackR} fill="none" stroke={tone} strokeWidth={3} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - ratio)} transform={`rotate(-90 ${cx} ${cy})`} />
        {/* glass */}
        <Circle cx={cx} cy={cy} r={r - 3} fill="url(#mag_glass)" />
        <Ellipse cx={cx - 9} cy={cy - 10} rx={7} ry={4} fill="#dff0ea" opacity={0.22} />
        <Path d={arc(cx, cy, r - 5, 30, 90)} stroke="#5fae8c" strokeWidth={1.6} opacity={0.5} fill="none" />
        <Circle cx={cx - 11} cy={cy - 11} r={1.4} fill="#f4fbf8" opacity={0.8} />
        {/* 3-band brass rim */}
        <Circle cx={cx} cy={cy} r={r} fill="none" stroke="url(#mag_rim)" strokeWidth={6} />
        <Path d={crescent(cx, cy, r)} stroke={B_SPEC} strokeWidth={1.6} opacity={0.7} fill="none" strokeLinecap="round" />
        <Path d={arc(cx, cy, r, 30, 95)} stroke={B_SHADOW} strokeWidth={1.4} opacity={0.6} fill="none" />
        <Circle cx={cx} cy={cy} r={r - 3.2} fill="none" stroke={B_SEAT} strokeWidth={1} />
      </Svg>
      <View style={{ position: "absolute", top: 0, left: 0, right: 16, bottom: 8, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: C.ink, fontSize: 16, fontWeight: "800" }}>{pct}</Text>
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
  if (!metric.available) {
    face = <LockedFace height={96} />
  } else {
    switch (metric.kind) {
      case "arc":
        face = <ArcGauge fill={fill} />
        break
      case "ring":
        face = <VaultRing pct={metric.pctText ?? ""} ratio={metric.ratio} />
        break
      case "thermo":
        face = <Thermometer fill={fill} tone={metric.tone} />
        break
      case "tank":
        face = <GlassTank fill={fill} metal={metric.id === "gold" ? "gold" : "silver"} />
        break
      case "chest":
        face = <TreasureChest fill={fill} tone={metric.tone} metal={metric.id === "ankauf" ? "gold" : "silver"} />
        break
      case "scale":
        face = <BalanceScale fill={fill} />
        break
      case "lens":
        face = <MagnifierLens pct={metric.pctText ?? ""} ratio={metric.ratio} tone={metric.tone} />
        break
      default:
        face = <LockedFace height={96} />
    }
  }
  return (
    <WidgetFrame title={metric.title} zielText={metric.zielText}>
      {face}
      <ValuePlate value={metric.valueText} pct={metric.pctText} tone={metric.tone} />
    </WidgetFrame>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature panels (full width) — aged parchment
// ─────────────────────────────────────────────────────────────────────────────

/** Monatsziele — an aged parchment scroll with rolled top + bottom ends, tea
 *  stains, and engraved-channel progress bars with glossy fills. */
export function GoalsScroll({ bars }: { bars: MonthlyBar[] }): ReactNode {
  const bodyH = 44 + bars.length * 20
  return (
    <View style={{ width: "100%", height: bodyH + 18 }}>
      <Svg width="100%" height={bodyH + 18} viewBox={`0 0 340 ${bodyH + 18}`} preserveAspectRatio="none" style={{ position: "absolute" }}>
        <Defs>
          <LinearGradient id="gsc_body" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#e7d7b0" />
            <Stop offset="0.5" stopColor="#d7c59c" />
            <Stop offset="1" stopColor="#c2ad7e" />
          </LinearGradient>
          <LinearGradient id="gsc_roll" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#9a8458" />
            <Stop offset="0.4" stopColor="#c4ab74" />
            <Stop offset="0.6" stopColor="#ead7a6" />
            <Stop offset="1" stopColor="#ad9663" />
          </LinearGradient>
          <RadialGradient id="gsc_stain" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#6f5c38" stopOpacity={0.1} />
            <Stop offset="1" stopColor="#6f5c38" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {/* body + side vignettes */}
        <Rect x={6} y={9} width={328} height={bodyH} rx={3} fill="url(#gsc_body)" />
        <Rect x={6} y={9} width={26} height={bodyH} fill="#000" opacity={0.12} />
        <Rect x={308} y={9} width={26} height={bodyH} fill="#000" opacity={0.16} />
        {/* tea stains */}
        <Ellipse cx={70} cy={bodyH * 0.7} rx={42} ry={26} fill="url(#gsc_stain)" />
        <Ellipse cx={280} cy={28} rx={34} ry={22} fill="url(#gsc_stain)" />
        {/* rolled ends */}
        <Rect x={0} y={3} width={340} height={12} rx={6} fill="url(#gsc_roll)" />
        <Rect x={0} y={bodyH + 3} width={340} height={12} rx={6} fill="url(#gsc_roll)" />
        <Line x1={6} y1={15} x2={334} y2={15} stroke="#00000022" strokeWidth={1} />
        <Line x1={6} y1={bodyH + 3} x2={334} y2={bodyH + 3} stroke="#00000022" strokeWidth={1} />
      </Svg>
      <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14, gap: 9 }}>
        <View style={{ alignItems: "center", marginBottom: 2 }}>
          <Text style={{ color: C.parchmentInk, fontSize: 12.5, fontWeight: "800", letterSpacing: 0.6 }}>MONATSZIELE</Text>
          <Text style={{ color: C.giltDeep, fontSize: 10 }}>Übersicht</Text>
        </View>
        {bars.map((b) => (
          <View key={b.label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: C.parchmentInk, fontSize: 11.5, fontWeight: "600", width: 66 }} numberOfLines={1}>
              {b.label}
            </Text>
            <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: "#00000026", overflow: "hidden", borderWidth: 0.5, borderColor: "#0000002e" }}>
              {b.available ? (
                <View style={{ width: `${Math.round(b.ratio * 100)}%`, height: "100%", borderRadius: 5, backgroundColor: b.ratio >= 0.75 ? "#5a8a3e" : b.ratio >= 0.4 ? "#b88324" : "#a3472b" }} />
              ) : null}
            </View>
            <Text style={{ color: C.parchmentInk, fontSize: 11.5, fontWeight: "800", width: 38, textAlign: "right" }}>
              {b.available ? `${Math.round(b.ratio * 100)}%` : "—"}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

/** Gesamtübersicht — an aged treasure map: scorched parchment, compass rose, a
 *  dashed route from the X past a ship to the chest, and the overall %. */
export function TreasureMapPanel({ overall, available }: { overall: number; available: boolean }): ReactNode {
  const pct = Math.round(overall * 100)
  const p = Math.max(0, Math.min(1, overall))
  return (
    <View style={{ width: "100%", borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: C.parchmentEdge }}>
      <Svg width="100%" height={172} viewBox="0 0 340 172" preserveAspectRatio="none" style={{ position: "absolute" }}>
        <Defs>
          <RadialGradient id="tm_bg" cx="0.5" cy="0.4" r="0.95">
            <Stop offset="0" stopColor="#e6d6af" />
            <Stop offset="0.7" stopColor="#d2c094" />
            <Stop offset="1" stopColor="#b39c6c" />
          </RadialGradient>
          <RadialGradient id="tm_burn" cx="0.5" cy="0.5" r="0.62">
            <Stop offset="0.7" stopColor="#2a1606" stopOpacity={0} />
            <Stop offset="1" stopColor="#2a1606" stopOpacity={0.5} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={340} height={172} fill="url(#tm_bg)" />
        <Ellipse cx={60} cy={150} rx={34} ry={22} fill="#9c8657" opacity={0.12} />
        <Ellipse cx={290} cy={40} rx={26} ry={18} fill="#9c8657" opacity={0.1} />
        <Rect x={0} y={0} width={340} height={172} fill="url(#tm_burn)" />
      </Svg>
      <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, gap: 4 }}>
        <View style={{ alignItems: "center" }}>
          <Text style={{ color: C.parchmentInk, fontSize: 12.5, fontWeight: "800", letterSpacing: 0.6 }}>GESAMTÜBERSICHT</Text>
          <Text style={{ color: C.giltDeep, fontSize: 10 }}>Alle Ziele auf einen Blick</Text>
        </View>
        <Svg width="100%" height={110} viewBox="0 0 300 110">
          <Defs>
            <RadialGradient id="tm_rose" cx="0.4" cy="0.32" r="0.85">
              <Stop offset="0" stopColor={B_SPEC} />
              <Stop offset="1" stopColor={B_DEEP} />
            </RadialGradient>
          </Defs>
          {/* compass rose */}
          <G opacity={0.9}>
            <Circle cx={250} cy={18} r={13} fill="none" stroke="#6f5a28" strokeWidth={1.5} />
            {Array.from({ length: 8 }).map((_, i) => {
              const a = i * 45
              const tip = polar(250, 18, 12, a)
              const b1 = polar(250, 18, 3, a + 90)
              const b2 = polar(250, 18, 3, a - 90)
              return <Polygon key={i} points={`${tip.x},${tip.y} ${b1.x},${b1.y} ${b2.x},${b2.y}`} fill={i % 2 === 0 ? "url(#tm_rose)" : "#8a6d2f"} opacity={a >= 180 ? 0.7 : 1} />
            })}
            <Circle cx={250} cy={18} r={3} fill="url(#tm_rose)" />
            <SvgText x={250} y={2} fill="#5c4a2c" fontSize={7} fontWeight="800" textAnchor="middle">N</SvgText>
          </G>
          {/* route: shadow · remaining · travelled */}
          <Path d="M 26 64 C 90 40, 150 78, 205 46" fill="none" stroke="#3a2c16" strokeWidth={3.2} opacity={0.22} transform="translate(0,1.4)" strokeDasharray="2 6" strokeLinecap="round" />
          <Path d="M 26 64 C 90 40, 150 78, 205 46" fill="none" stroke="#6b5430" strokeWidth={2} opacity={0.4} strokeDasharray="2 6" strokeLinecap="round" />
          <Path d={`M 26 64 C 90 40, 150 78, 205 46`} fill="none" stroke="#4a3415" strokeWidth={2} opacity={0.9} strokeDasharray={`${p * 200} 400`} strokeLinecap="round" />
          {/* X start */}
          <G stroke="#a3472b" strokeWidth={3.4} strokeLinecap="round">
            <Line x1={20} y1={58} x2={32} y2={70} />
            <Line x1={32} y1={58} x2={20} y2={70} />
          </G>
          {/* ship */}
          <G transform={`translate(${26 + p * 179}, ${64 - p * 18})`}>
            <Path d="M -13 1 Q 0 7 13 1 L 8 9 L -8 9 Z" fill="#5a4326" stroke="#33240f" strokeWidth={0.8} />
            <Line x1={-13} y1={1} x2={13} y2={1} stroke="#c9a55c" strokeWidth={1} />
            <Line x1={0} y1={1} x2={0} y2={-18} stroke="#33240f" strokeWidth={1.5} />
            <Line x1={0} y1={1} x2={0.4} y2={-18} stroke={B_SPEC} strokeWidth={0.5} />
            <Path d="M 0 -17 L 11 -5 L 0 -2 Z" fill="#f2ede1" />
            <Path d="M 0 -17 L 11 -5 L 6 -7 Z" fill="#c2b49a" opacity={0.7} />
            <Path d="M 0 -14 L -9 -4 L 0 -1 Z" fill="#e8e0cf" />
          </G>
          {/* destination chest */}
          <G transform="translate(248, 60)">
            <Ellipse cx={0} cy={12} rx={14} ry={3} fill="#000" opacity={0.18} />
            <Rect x={-12} y={-1} width={24} height={13} rx={2} fill="#5a4326" stroke="#33240f" strokeWidth={1} />
            <Path d="M -12 -1 Q 0 -12 12 -1 Z" fill="url(#tm_rose)" stroke="#7a5e22" strokeWidth={1} />
            <Path d={crescent(0, -1, 12)} stroke={B_SPEC} strokeWidth={1} opacity={0.6} fill="none" />
            <Rect x={-2} y={3} width={4} height={6} rx={1} fill="#c9a55c" />
            {[-7, 0, 7].map((cxx, i) => (
              <Circle key={i} cx={cxx} cy={11} r={2.2} fill="#d9b154" stroke="#8a5e1f" strokeWidth={0.5} />
            ))}
          </G>
          {/* engraved Zielerreichung — inside the canvas so it can never clip */}
          <SvgText
            x={150}
            y={99}
            fill={available && pct >= 75 ? "#4e7a3a" : "#7a5e22"}
            fontSize={25}
            fontWeight="800"
            textAnchor="middle"
          >
            {available ? `${pct}%` : "—"}
          </SvgText>
          <SvgText x={150} y={108} fill="#5c4a2c" fontSize={8.5} fontWeight="600" textAnchor="middle">
            Zielerreichung
          </SvgText>
        </Svg>
      </View>
    </View>
  )
}
