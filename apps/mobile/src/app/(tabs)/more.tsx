/**
 * Mehr — the Owner OS hub. A scannable launcher grid onto every secondary owner
 * surface, grouped into labelled sections, fully driven by the OWNER_SURFACES
 * registry (src/warehouse14/owner-surfaces.ts). A later agent adds a screen by
 * appending ONE entry there and flipping its `available` flag — this screen
 * needs no edit and goes live the moment the registry says the route exists.
 *
 * Honesty rule (DESIGN.md §4): an `available` card has a real, built route, so it
 * presses, fires the selection haptic, and pushes. A not-yet-built surface
 * (`available: false`) renders as a calm, dashed locked tile labelled
 * „bald verfügbar", does NOT animate a press, and does NOT navigate — so the hub
 * can never route into a missing screen and never implies a feature exists before
 * it does. The three Finanzen/System cards flip to live automatically once their
 * route files land this phase.
 *
 * Spine: the §6 motion vocabulary (PressableScale + a capped StaggerItem
 * cascade), the §7 haptic vocabulary (selection on a navigate), the type ramp +
 * icon scale from `useW14Theme`, and `useScreenInsets` for grid-correct paddings.
 * No hardcoded hex / radius / off-grid spacing; every colour is a theme token.
 */
import { useMemo } from "react"
import { ScrollView, View } from "react-native"
import { type Href, useRouter } from "expo-router"
import { ChevronRight, Lock } from "lucide-react-native"

import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import {
  OWNER_SURFACES,
  SECTION_ORDER,
  type OwnerSurface,
  type OwnerSurfaceGroup,
} from "@/warehouse14/owner-surfaces"
import { useW14Theme } from "@/warehouse14/theme"
import {
  haptics,
  PaperGrain,
  PressableScale,
  StaggerItem,
  useScreenInsets,
} from "@/warehouse14/ui"

/**
 * One launcher card. Available cards are a `PressableScale` (spine press-scale +
 * selection haptic + push); locked cards are a static, dashed tile with a lock
 * badge and the honest „bald verfügbar" caption — no press, no navigation.
 *
 * Both branches own the 48% grid width on the outer wrapper so the two layouts
 * line up identically across a row regardless of availability.
 */
function HubCard({ surface, index }: { surface: OwnerSurface; index: number }) {
  const t = useW14Theme()
  const router = useRouter()
  const Icon = surface.icon
  const available = surface.available === true

  const iconTint = available ? t.colors.primary : t.colors.mutedForeground

  const body = (
    <Card
      className="w-full gap-3 px-4 py-4"
      style={available ? undefined : { borderStyle: "dashed", opacity: 0.9 }}
    >
      <View className="flex-row items-start justify-between">
        {/* Leading icon disc — a soft brass-tinted square so the glyph reads as a
            launcher target. The tint carries no text, so brass is correct here. */}
        <View
          className="items-center justify-center rounded-xl"
          style={{
            width: 44,
            height: 44,
            backgroundColor: iconTint + "1f", // ~12% tint of the role colour
          }}
        >
          <Icon size={t.icon.lg} color={iconTint} />
        </View>
        {available ? (
          <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} />
        ) : (
          <View
            className="flex-row items-center gap-1 rounded-md px-2 py-1"
            style={{ backgroundColor: t.colors.mutedForeground + "14" }}
          >
            <Lock size={t.icon.xs} color={t.colors.mutedForeground} />
          </View>
        )}
      </View>

      <View className="gap-1">
        <Text
          className="text-base font-semibold"
          style={available ? undefined : { color: t.colors.mutedForeground }}
          numberOfLines={1}
        >
          {surface.label}
        </Text>
        <Text className="text-muted-foreground text-xs" numberOfLines={2}>
          {available ? surface.description : "bald verfügbar"}
        </Text>
      </View>
    </Card>
  )

  // Locked: a static tile, no press feedback, no navigation, no haptic — nothing
  // happened, so nothing is signalled. The lock badge already tells the story.
  if (!available) {
    return (
      <StaggerItem
        index={Math.min(index, 8)}
        exit={false}
        style={{ width: "48%" }}
        accessibilityRole="summary"
        accessibilityLabel={`${surface.label}, bald verfügbar`}
      >
        {body}
      </StaggerItem>
    )
  }

  return (
    <StaggerItem index={Math.min(index, 8)} exit={false} style={{ width: "48%" }}>
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
    </StaggerItem>
  )
}

export default function MehrScreen() {
  const t = useW14Theme()
  const insets = useScreenInsets()

  // Bucket surfaces by group once, preserving registry (append) order.
  const sections = useMemo(() => {
    const byGroup = new Map<OwnerSurfaceGroup, OwnerSurface[]>()
    for (const s of OWNER_SURFACES) {
      const list = byGroup.get(s.group) ?? []
      list.push(s)
      byGroup.set(s.group, list)
    }
    return SECTION_ORDER.map((section) => ({
      ...section,
      items: byGroup.get(section.group) ?? [],
    })).filter((section) => section.items.length > 0)
  }, [])

  // A single running index across all sections drives one continuous cascade so
  // the grid settles in top-to-bottom as one motion, not section-by-section.
  let cardIndex = 0

  return (
    <View className="flex-1 bg-background">
      {/* Die gealterte Papier-Maserung als Leinwand — Tiefe aus dem geschichteten
          Creme plus dieser feinen warmen Struktur, nie eine flache Fläche
          (DESIGN.md §1, §5). */}
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: insets.screen.top + t.space.x4,
          paddingHorizontal: t.space.x4,
          paddingBottom: insets.contentBottom,
          gap: t.space.x6,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-1">
          {/* Bildschirmtitel in der Bricolage-Display-Stimme (DESIGN-SYSTEM.md §3). */}
          <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
            Mehr
          </Text>
          <Text className="text-muted-foreground text-sm" numberOfLines={2}>
            Alle Werkzeuge deines Betriebs an einem Ort.
          </Text>
        </View>

        {sections.map((section) => (
          <View key={section.group} className="gap-3">
            <Text
              className="text-muted-foreground text-xs font-semibold uppercase"
              style={{ letterSpacing: 0.8 }}
            >
              {section.label}
            </Text>
            <View className="flex-row flex-wrap justify-between" style={{ rowGap: t.space.x3 }}>
              {section.items.map((s) => (
                <HubCard key={s.id} surface={s} index={cardIndex++} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}
