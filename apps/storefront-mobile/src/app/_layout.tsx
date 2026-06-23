// NativeWind v5: load the compiled Tailwind stylesheet once, at the top-most
// component (NOT in index.js, that breaks Fast Refresh).
import "../../global.css"

import { useEffect } from "react"
import { StatusBar } from "expo-status-bar"
import { useFonts } from "expo-font"
import { Stack } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"

import { fontMap } from "../lib/fonts"
import { palette } from "../theme/tokens"
import { ShopperProvider } from "../store/shopper"

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontMap)

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync()
  }, [fontsLoaded, fontError])

  if (!fontsLoaded && !fontError) return null

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.background }}>
        <ShopperProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: palette.background },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="artikel/[slug]"
              options={{ presentation: "card", animation: "slide_from_right" }}
            />
            <Stack.Screen
              name="konto/anmelden"
              options={{ presentation: "modal", animation: "slide_from_bottom" }}
            />
            <Stack.Screen
              name="konto/registrieren"
              options={{ presentation: "modal", animation: "slide_from_bottom" }}
            />
          </Stack>
          <StatusBar style="dark" />
        </ShopperProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  )
}
