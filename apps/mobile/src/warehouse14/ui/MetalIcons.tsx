/**
 * Bespoke SVG metal icons — domain-specific marks for the four precious metals
 * Warehouse14 trades in. Each is a hand-crafted SVG rendered via react-native-svg,
 * designed to read as a metal ingot/bar with a distinct silhouette per element:
 *
 *   Gold     — a solid bar with a sunburst facet (warm, dense)
 *   Silber   — a bar with a crystalline split (cool, reflective)
 *   Platin   — a bar with a geometric Pt mark (dense, industrial)
 *   Palladium — a bar with a soft Pd wave (light, airy)
 *
 * The icons use `currentColor` so they tint from the parent's text colour,
 * matching the NativeWind `text-*` convention the rest of the app uses.
 */
import { type ComponentProps } from "react"
import Svg, { Path, Rect, G } from "react-native-svg"

type SvgProps = ComponentProps<typeof Svg>
export type MetalKind = "GOLD" | "SILBER" | "PLATIN" | "PALLADIUM"

interface MetalIconProps extends Omit<SvgProps, "children"> {
  metal: MetalKind
  size?: number
}

const DEFAULT_SIZE = 24

export function MetalIcon({ metal, size = DEFAULT_SIZE, ...rest }: MetalIconProps) {
  const s = size
  switch (metal) {
    case "GOLD":
      return <GoldBar size={s} {...rest} />
    case "SILBER":
      return <SilverBar size={s} {...rest} />
    case "PLATIN":
      return <PlatinumBar size={s} {...rest} />
    case "PALLADIUM":
      return <PalladiumBar size={s} {...rest} />
  }
}

/**
 * Gold — a solid ingot with a sunburst top facet and an engraved "Au" mark.
 * The sunburst suggests density and warmth without using a literal colour fill.
 */
function GoldBar({ size, ...rest }: { size: number } & SvgProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
      {/* Ingot body */}
      <Path
        d="M4 14 L6 8 L18 8 L20 14 L20 17 L4 17 Z"
        fill="currentColor"
        fillOpacity={0.15}
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      {/* Sunburst facet on top */}
      <Path
        d="M6 8 L9 5 L15 5 L18 8"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinejoin="round"
        fill="none"
      />
      {/* Inner facet line */}
      <Path
        d="M9 5 L8 8 M15 5 L16 8 M12 5 L12 8"
        stroke="currentColor"
        strokeWidth={0.8}
        strokeOpacity={0.5}
      />
    </Svg>
  )
}

/**
 * Silver — a bar with a crystalline split down the middle, suggesting the
 * reflective, cool quality of polished silver.
 */
function SilverBar({ size, ...rest }: { size: number } & SvgProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
      <Path
        d="M4 14 L6 8 L18 8 L20 14 L20 17 L4 17 Z"
        fill="currentColor"
        fillOpacity={0.1}
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      {/* Crystal split — two angled lines meeting at center */}
      <Path
        d="M12 8 L10 12 L13 14 L11 17"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinejoin="round"
        strokeOpacity={0.6}
        fill="none"
      />
      {/* Top edge */}
      <Path
        d="M6 8 L9 6 L15 6 L18 8"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  )
}

/**
 * Platinum — a dense industrial bar with a geometric Pt cross-hatch mark.
 */
function PlatinumBar({ size, ...rest }: { size: number } & SvgProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
      <Path
        d="M4 14 L6 8 L18 8 L20 14 L20 17 L4 17 Z"
        fill="currentColor"
        fillOpacity={0.12}
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      {/* Geometric Pt mark — a square with internal cross */}
      <G stroke="currentColor" strokeWidth={1} strokeOpacity={0.55}>
        <Rect x={9} y={10.5} width={6} height={5} rx={0.5} fill="none" />
        <Path d="M12 10.5 L12 15.5 M9 13 L15 13" />
      </G>
      {/* Top edge */}
      <Path
        d="M6 8 L9 6 L15 6 L18 8"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  )
}

/**
 * Palladium — a bar with a soft wave mark, suggesting the light, airy quality
 * of the least dense platinum-group metal.
 */
function PalladiumBar({ size, ...rest }: { size: number } & SvgProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
      <Path
        d="M4 14 L6 8 L18 8 L20 14 L20 17 L4 17 Z"
        fill="currentColor"
        fillOpacity={0.08}
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      {/* Soft wave */}
      <Path
        d="M8 13 Q10 11 12 13 T16 13"
        stroke="currentColor"
        strokeWidth={1.1}
        strokeLinecap="round"
        fill="none"
      />
      {/* Top edge */}
      <Path
        d="M6 8 L9 6 L15 6 L18 8"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  )
}

/**
 * A stamp icon — for philatelic items (Briefmarken). A perforated rectangle
 * with a simple postmark circle, the universal stamp silhouette.
 */
export function StampIcon({ size = DEFAULT_SIZE, ...rest }: { size?: number } & SvgProps) {
  const r = 1.5 // perforation radius
  const perforations = [
    [4, 4], [8, 4], [12, 4], [16, 4], [20, 4],
    [4, 20], [8, 20], [12, 20], [16, 20], [20, 20],
    [4, 8], [4, 12], [4, 16],
    [20, 8], [20, 12], [20, 16],
  ]
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
      {/* Stamp body */}
      <Rect x={4} y={4} width={16} height={16} rx={1} fill="currentColor" fillOpacity={0.08} stroke="currentColor" strokeWidth={1.2} />
      {/* Perforation dots */}
      {perforations.map(([cx, cy], i) => (
        <G key={i}>
          <Path d={`M${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy}`} fill="currentColor" fillOpacity={0.3} />
        </G>
      ))}
      {/* Postmark circle */}
      <Path d="M12 9 m-2.5 0 a 2.5 2.5 0 1 0 5 0 a 2.5 2.5 0 1 0 -5 0" fill="none" stroke="currentColor" strokeWidth={1} strokeOpacity={0.5} />
    </Svg>
  )
}

/**
 * A coin icon — for numismatic items (Münzen). A circle with a reeded edge
 * and a simple embossed star, the universal coin silhouette.
 */
export function CoinIcon({ size = DEFAULT_SIZE, ...rest }: { size?: number } & SvgProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
      {/* Coin face */}
      <Path d="M12 4 m-8 0 a 8 8 0 1 0 16 0 a 8 8 0 1 0 -16 0" fill="currentColor" fillOpacity={0.08} stroke="currentColor" strokeWidth={1.4} />
      {/* Inner ring (reeded edge hint) */}
      <Path d="M12 6 m-6 0 a 6 6 0 1 0 12 0 a 6 6 0 1 0 -12 0" fill="none" stroke="currentColor" strokeWidth={0.7} strokeOpacity={0.4} />
      {/* Embossed star/mark */}
      <Path
        d="M12 9 L13 11.5 L15.5 11.5 L13.5 13 L14 15.5 L12 14 L10 15.5 L10.5 13 L8.5 11.5 L11 11.5 Z"
        fill="currentColor"
        fillOpacity={0.5}
      />
    </Svg>
  )
}
