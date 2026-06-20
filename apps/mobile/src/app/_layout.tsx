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
import { ConnectionBannerHost } from "@/warehouse14/ui"

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
          <Stack.Screen name="customer/neu" options={{ presentation: "modal", title: "Neuer Kunde" }} />
          <Stack.Screen name="customer/edit" options={{ presentation: "modal", title: "Kunde bearbeiten" }} />
          <Stack.Screen name="termine" options={{ title: "Termine" }} />
          <Stack.Screen
            name="termine/neu"
            options={{ presentation: "modal", title: "Neuer Termin" }}
          />
          <Stack.Screen name="aufgaben" options={{ title: "Aufgaben" }} />
          <Stack.Screen name="benachrichtigungen" options={{ title: "Benachrichtigungen" }} />
          <Stack.Screen name="kasse" options={{ title: "Kasse" }} />
          <Stack.Screen name="verkauf" options={{ title: "Verkauf" }} />
          <Stack.Screen name="ankauf" options={{ title: "Ankauf" }} />
          <Stack.Screen name="drucken" options={{ title: "Drucken" }} />
          <Stack.Screen name="ebay" options={{ title: "eBay-Kanal" }} />
          <Stack.Screen name="whatsapp" options={{ title: "WhatsApp" }} />
          <Stack.Screen name="belege" options={{ title: "Belege & Dokumente" }} />
          <Stack.Screen name="ausgaben" options={{ title: "Ausgaben" }} />
          <Stack.Screen name="finanzen" options={{ title: "Finanzen" }} />
          <Stack.Screen name="einstellungen" options={{ title: "Einstellungen" }} />
          <Stack.Screen
            name="ausgaben/ausgabe"
            options={{ presentation: "modal", title: "Ausgabe" }}
          />
          <Stack.Screen
            name="ausgaben/fixkosten"
            options={{ presentation: "modal", title: "Fixkosten" }}
          />
          <Stack.Screen
            name="aufgaben/neu"
            options={{ presentation: "modal", title: "Neue Aufgabe" }}
          />
          <Stack.Screen
            name="aufgaben/edit"
            options={{ presentation: "modal", title: "Aufgabe bearbeiten" }}
          />
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
        <ConnectionBannerHost />
        <PortalHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
