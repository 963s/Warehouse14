/**
 * Mehr — the Owner OS hub. A data-driven grid of cards onto every secondary
 * owner surface, grouped into sections. Fully driven by the OWNER_SURFACES
 * registry (src/warehouse14/owner-surfaces.ts): a later agent adds a screen by
 * appending ONE entry there — this screen needs no edit.
 *
 * Available cards push their route. Not-yet-built surfaces (`available: false`)
 * render as a locked "bald verfügbar"-Karte and do not navigate, so the hub
 * can never route into a missing screen.
 */
import { useMemo } from "react"
import { Pressable, ScrollView, View } from "react-native"
import { type Href, useRouter } from "expo-router"
import { Lock } from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import {
  OWNER_SURFACES,
  SECTION_ORDER,
  type OwnerSurface,
  type OwnerSurfaceGroup,
} from "@/warehouse14/owner-surfaces"
import { useW14Theme } from "@/warehouse14/theme"

function HubCard({ surface }: { surface: OwnerSurface }) {
  const t = useW14Theme()
  const router = useRouter()
  const Icon = surface.icon
  const available = surface.available === true

  // The Card fills its cell; the CELL (Pressable when available, View when not)
  // owns the 48% grid width so both branches line up identically.
  const card = (
    <Card
      className="w-full gap-2 px-3 py-4"
      style={available ? undefined : { borderStyle: "dashed", opacity: 0.85 }}
    >
      <View className="flex-row items-center justify-between">
        <Icon size={22} color={available ? t.colors.primary : t.colors.mutedForeground} />
        {!available ? <Lock size={14} color={t.colors.mutedForeground} /> : null}
      </View>
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
    </Card>
  )

  if (!available) {
    return <View style={{ width: "48%" }}>{card}</View>
  }
  return (
    <Pressable
      style={({ pressed }) => [{ width: "48%" }, pressed ? { opacity: 0.8 } : null]}
      // The registry holds plain route strings (some not yet built); only
      // `available` ones are pushed. Cast to Href at this boundary.
      onPress={() => router.push(surface.route as Href)}
      accessibilityRole="button"
    >
      {card}
    </Pressable>
  )
}

export default function MehrScreen() {
  const t = useW14Theme()
  const insets = useSafeAreaInsets()

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

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 18 }}
    >
      {sections.map((section) => (
        <View key={section.group} className="gap-3">
          <Text
            className="text-xs font-semibold uppercase"
            style={{ color: t.colors.mutedForeground, letterSpacing: 0.5 }}
          >
            {section.label}
          </Text>
          <View className="flex-row flex-wrap justify-between" style={{ rowGap: 12 }}>
            {section.items.map((s) => (
              <HubCard key={s.id} surface={s} />
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  )
}
