// NativeWind v5: load the compiled Tailwind stylesheet once, at the top-most
// component (NOT in index.js — that breaks Fast Refresh).
import "../../global.css"

import { useEffect } from "react"
import { useColorScheme } from "react-native"
import { useFonts } from "expo-font"
import { Stack, useRouter, useSegments } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { PortalHost } from "@rn-primitives/portal"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"

import { warehouse14Fonts } from "@/warehouse14/fonts"
import { useSession } from "@/warehouse14/session"
import { StepUpDialogHost } from "@/warehouse14/StepUpDialog"
import { darkPalette, lightPalette } from "@/warehouse14/theme"

SplashScreen.preventAutoHideAsync()

/** Redirect to /login when there is no session, and away from it once there is. */
function useAuthRedirect(): void {
  const { isAuthenticated } = useSession()
  const segments = useSegments()
  const router = useRouter()
  useEffect(() => {
    const onLogin = segments[0] === "login"
    if (!isAuthenticated && !onLogin) router.replace("/login")
    else if (isAuthenticated && onLogin) router.replace("/")
  }, [isAuthenticated, segments, router])
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(warehouse14Fonts)
  const scheme = useColorScheme()
  const colors = scheme === "dark" ? darkPalette : lightPalette

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync()
  }, [fontsLoaded, fontError])

  useAuthRedirect()

  if (!fontsLoaded && !fontError) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.card },
            headerTintColor: colors.foreground,
            headerTitleStyle: { fontFamily: "Inter_600SemiBold" },
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="product/[id]" options={{ presentation: "modal", title: "Artikel" }} />
          <Stack.Screen name="product/neu" options={{ presentation: "modal", title: "Neuer Artikel" }} />
          <Stack.Screen name="product/edit" options={{ presentation: "modal", title: "Bearbeiten" }} />
          <Stack.Screen name="customer/[id]" options={{ presentation: "modal", title: "Kunde" }} />
          <Stack.Screen
            name="capture"
            options={{ presentation: "fullScreenModal", headerShown: false }}
          />
          <Stack.Screen
            name="kyc-capture"
            options={{ presentation: "fullScreenModal", title: "Ausweis erfassen" }}
          />
        </Stack>
        <StepUpDialogHost />
        <PortalHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
