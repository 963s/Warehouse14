/**
 * Mehr — the Owner OS hub. A calm, scannable launcher onto every secondary owner
 * surface, grouped into labelled sections, fully driven by the OWNER_SURFACES
 * registry (src/warehouse14/owner-surfaces.ts). A later agent adds a screen by
 * appending ONE entry there and flipping its `available` flag — this screen
 * needs no edit and goes live the moment the registry says the route exists.
 *
 * Composition (DESIGN-SYSTEM.md §1, §9 — kill boxes-inside-boxes):
 *   Not a wall of two-column cards. Each section is a small-caps OVERLINE label
 *   with a gilt diamond seal, over ONE half-step parchment leaf (parchment-2)
 *   framed by a single warm hairline. Inside the leaf the surfaces are BARE rows
 *   — a leading ink glyph (no tinted chip), the German label + one-line meaning,
 *   then a chevron — divided only by an inset hairline. Depth is the parchment
 *   step + that one rule, never a stack of cards or a heavier shadow.
 *
 * Honesty rule (DESIGN.md §4): an `available` row has a real, built route, so it
 * presses (the spine press-scale), fires the selection haptic, and pushes. A
 * not-yet-built surface (`available: false`) is a calm muted row sealed with the
 * bespoke gilt diamond and the honest bald-verfügbar caption. It does NOT
 * press and does NOT navigate, so the hub can never route into a missing screen
 * and never implies a feature exists before it does.
 *
 * Spine: the §6 motion vocabulary (PressableScale + a capped StaggerItem
 * cascade), the §7 haptic vocabulary (selection on a navigate), the type ramp +
 * icon scale from `useW14Theme`, and `useScreenInsets` for grid-correct paddings.
 * No hardcoded hex / radius / off-grid spacing; every colour is a theme token.
 */
import { useMemo } from "react"
import { ScrollView, View } from "react-native"
import { type Href, useRouter } from "expo-router"
import { ChevronRight } from "lucide-react-native"
import Svg, { Path } from "react-native-svg"

import { Text } from "@/components/ui/text"
import {
  OWNER_SURFACES,
  SECTION_ORDER,
  type OwnerSurface,
  type OwnerSurfaceGroup,
} from "@/warehouse14/owner-surfaces"
import { SURFACES } from "@/warehouse14/surfaces"
import { useW14Theme } from "@/warehouse14/theme"
import {
  Hairline,
  haptics,
  PaperGrain,
  PressableScale,
  SectionHeader,
  StaggerItem,
  useScreenInsets,
} from "@/warehouse14/ui"

/**
 * The house seal — a small gilt diamond, the §6 "Kicker" mark ported to native.
 * Hairline-stroked (the gilt is a thread/edge/seal, never a fill), so it opens a
 * section the way the storefront's ◆ opens a region. Decorative → a11y-hidden.
 */
function DiamondSeal({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" fill="none" accessibilityElementsHidden>
      <Path
        d="M6 1 L11 6 L6 11 L1 6 Z"
        stroke={color}
        strokeWidth={1.2}
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  )
}

/**
 * One launcher row — bare, never a card. Leading ink glyph (no tinted chip box),
 * the German label + a one-line meaning, then the affordance:
 *   • available → a chevron; the whole row is a PressableScale (press-scale +
 *     selection haptic + push).
 *   • locked    → muted text + the gilt diamond seal and the bald-verfügbar
 *     caption; no press, no navigation. The seal alone tells the story.
 *
 * `last` drops the trailing inset hairline so a group's final row has no rule
 * under it — the parchment leaf already ends there.
 */
function HubRow({
  surface,
  last,
}: {
  surface: OwnerSurface
  last: boolean
}) {
  const t = useW14Theme()
  const router = useRouter()
  const Icon = surface.icon
  const available = surface.available === true

  const titleColor = available ? t.colors.foreground : t.colors.mutedForeground
  const iconColor = available ? t.colors.foreground : t.colors.mutedForeground

  const body = (
    <View>
      <View
        className="min-h-[56px] flex-row items-center px-4"
        style={{ paddingVertical: t.space.x1_5, gap: t.space.x2 }}
      >
        {/* Leading glyph sits directly on the leaf — no tinted chip box. A bare
            ink mark reads as a calm, native launcher target (DESIGN-SYSTEM.md §9). */}
        <View className="h-7 w-7 items-center justify-center">
          <Icon size={t.icon.lg} color={iconColor} strokeWidth={1.7} />
        </View>

        <View className="flex-1 gap-0.5">
          <Text
            className="text-base font-medium"
            style={{ color: titleColor }}
            numberOfLines={1}
          >
            {surface.label}
          </Text>
          <Text className="text-muted-foreground text-xs" numberOfLines={1}>
            {available ? surface.description : "bald verfügbar"}
          </Text>
        </View>

        {available ? (
          <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} />
        ) : (
          // Locked: the gilt diamond seal as a quiet edge/seal accent (never a
          // fill), so the row reads as held-back, not broken.
          <View className="h-7 w-7 items-center justify-center">
            <DiamondSeal size={t.icon.sm} color={t.colors.gilt} />
          </View>
        )}
      </View>

      {/* The ONE divider weight — a warm hairline, inset under the text so it
          starts past the glyph (row pad 16 + glyph 28 + gap 16), list-style. */}
      {!last ? <Hairline inset={t.space.x5 - t.space.x1_2} /> : null}
    </View>
  )

  // Locked: a static row, no press feedback, no navigation, no haptic — nothing
  // happened, so nothing is signalled.
  if (!available) {
    return (
      <View
        accessibilityRole="summary"
        accessibilityLabel={`${surface.label}, bald verfügbar`}
      >
        {body}
      </View>
    )
  }

  return (
    <PressableScale
      // The registry holds plain route strings (some not yet built); only
      // `available` ones reach this branch. Cast to Href at this boundary.
      onPress={() => {
        haptics.selection()
        router.push(surface.route as Href)
      }}
      accessibilityRole="button"
      accessibilityLabel={`${surface.label}. ${surface.description}`}
    >
      {body}
    </PressableScale>
  )
}

export default function MehrScreen() {
  const t = useW14Theme()
  const insets = useScreenInsets()

  // Bucket surfaces by group once, preserving registry (append) order.
  //
  // WAS HIER HERAUSFAELLT, UND WARUM
  // Alles, was schon unten in der Leiste steht. Am 23.07.2026 wanderte
  // „Bestellungen" aus diesem Hub in die Leiste — der Eintrag hier blieb aber
  // stehen, und derselbe Schirm war fortan an ZWEI Stellen zu finden. Wer eine
  // Anwendung zum ersten Mal benutzt, liest so etwas nicht als Bequemlichkeit,
  // sondern als Unordnung: „gibt es zwei Bestellungen? welche ist die echte?"
  //
  // Der Filter kommt aus derselben Quelle wie die Leiste selbst. Wird morgen
  // eine weitere Fläche befördert, verschwindet sie hier VON ALLEIN. Es zu
  // Fuss zu pflegen hiesse, denselben Fehler noch einmal einzuladen.
  const tabRouten = useMemo(
    () => new Set(SURFACES.filter((s) => !s.hidden).map((s) => `/${s.name}`)),
    [],
  )

  const sections = useMemo(() => {
    const byGroup = new Map<OwnerSurfaceGroup, OwnerSurface[]>()
    for (const s of OWNER_SURFACES) {
      if (tabRouten.has(s.route)) continue
      const list = byGroup.get(s.group) ?? []
      list.push(s)
      byGroup.set(s.group, list)
    }
    return SECTION_ORDER.map((section) => ({
      ...section,
      items: byGroup.get(section.group) ?? [],
    })).filter((section) => section.items.length > 0)
  }, [tabRouten])

  // A single running index across all sections drives one continuous cascade so
  // the hub settles in top-to-bottom as one motion, not section-by-section.
  let rowIndex = 0

  return (
    <View className="flex-1 bg-background">
      {/* Die gealterte Papier-Maserung als Leinwand-Tiefe aus dem geschichteten
          Creme plus dieser feinen warmen Struktur, nie eine flache Fläche
          (DESIGN.md §1, §5). */}
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          // The tab header already clears the safe area; adding insets.screen.top
          // here double-counted it and left a tall empty band under the header.
          // A small top breath lets the hero title sit right below the header and
          // uses the space, matching the other tabs.
          paddingTop: t.space.x2,
          paddingHorizontal: t.space.x3,
          paddingBottom: insets.contentBottom,
          gap: t.space.x4,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-1" style={{ paddingHorizontal: t.space.x1 }}>
          {/* Bildschirmtitel in der Bricolage-Display-Stimme (DESIGN-SYSTEM.md §3). */}
          <Text
            className="text-3xl font-display-semibold leading-tight"
            numberOfLines={1}
          >
            Mehr
          </Text>
          <Text className="text-muted-foreground text-sm" numberOfLines={2}>
            Alle Werkzeuge deines Betriebs an einem Ort.
          </Text>
        </View>

        {sections.map((section) => (
          <View key={section.group} className="gap-2.5">
            {/* Section opener: a gilt diamond seal + the shared small-caps
                overline (DESIGN-SYSTEM.md §6 Kicker), set on the canvas — not a
                boxed chip header. */}
            <View
              className="flex-row items-center gap-2"
              style={{ paddingHorizontal: t.space.x1 }}
            >
              <DiamondSeal size={10} color={t.colors.gilt} />
              <SectionHeader title={section.label} emphasis="overline" />
            </View>

            {/* ONE half-step parchment leaf per section, framed by a single warm
                hairline. The bare rows live on it, divided only by inset rules —
                parchment-step depth, not a stack of cards (DESIGN-SYSTEM.md §9). */}
            <View
              className="overflow-hidden bg-card"
              style={{
                borderRadius: t.radii.card,
                borderWidth: 1,
                borderColor: t.colors.border,
              }}
            >
              {section.items.map((s, i) => (
                <StaggerItem key={s.id} index={Math.min(rowIndex++, 8)} exit={false}>
                  <HubRow surface={s} last={i === section.items.length - 1} />
                </StaggerItem>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}
