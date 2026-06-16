import { useEffect } from "react"
import { useFonts } from "expo-font"
import { Stack } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"

import { warehouse14Fonts } from "@/warehouse14/fonts"
import { lightPalette, darkPalette } from "@/warehouse14/theme"
import { useColorScheme } from "react-native"

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(warehouse14Fonts)
  const scheme = useColorScheme()
  const colors = scheme === "dark" ? darkPalette : lightPalette

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync()
  }, [fontsLoaded, fontError])

  if (!fontsLoaded && !fontError) return null

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.foreground,
          headerTitleStyle: { fontFamily: "Inter_600SemiBold" },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Warehouse14 · Katalog" }} />
        <Stack.Screen name="scan" options={{ title: "Scannen" }} />
      </Stack>
    </SafeAreaProvider>
  )
}
