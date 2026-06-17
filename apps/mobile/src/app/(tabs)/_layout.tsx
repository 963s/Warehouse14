/**
 * Bottom-tab shell, driven by the surface registry (src/warehouse14/surfaces.ts).
 * Adding a surface = one append there + one route file in this folder.
 */
import { Tabs } from "expo-router"
import { useColorScheme } from "react-native"

import { SURFACES } from "@/warehouse14/surfaces"
import { darkPalette, lightPalette } from "@/warehouse14/theme"

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
              tabBarIcon: ({ color, size }) => <TabIcon color={color} size={size} />,
            }}
          />
        )
      })}
    </Tabs>
  )
}
