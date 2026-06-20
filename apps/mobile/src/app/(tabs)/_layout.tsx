/**
 * Bottom-tab shell, driven by the primary surface registry
 * (src/warehouse14/surfaces.ts). The Owner OS lands on the Schatzkammer.
 *
 * Adding a PRIMARY tab = one append in surfaces.ts + one route file here.
 * Adding a SECONDARY surface = one append in owner-surfaces.ts (the Mehr hub) —
 * the tab bar never changes.
 */
import { Tabs } from "expo-router"
import { useColorScheme } from "react-native"

import { SURFACES } from "@/warehouse14/surfaces"
import { darkPalette, lightPalette } from "@/warehouse14/theme"

// Land on the Schatzkammer, not the (file-system default) index/Lager route.
export const unstable_settings = {
  initialRouteName: "dashboard",
}

export default function TabsLayout() {
  const scheme = useColorScheme()
  const colors = scheme === "dark" ? darkPalette : lightPalette

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.foreground,
        headerTitleStyle: { fontFamily: "Inter_600SemiBold" },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11 },
      }}
    >
      {SURFACES.map((s) => {
        const TabIcon = s.icon
        return (
          <Tabs.Screen
            key={s.name}
            name={s.name}
            options={{
              title: s.label,
              // Hidden surfaces stay mounted (deep-linkable) but show no tab button.
              href: s.hidden ? null : undefined,
              tabBarIcon: ({ color, size }) => <TabIcon color={color} size={size} />,
            }}
          />
        )
      })}
    </Tabs>
  )
}
