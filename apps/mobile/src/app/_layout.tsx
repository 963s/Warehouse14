// NativeWind v5: load the compiled Tailwind stylesheet once, at the top-most
// component (NOT in index.js — that breaks Fast Refresh).
import "../../global.css"

import { useEffect } from "react"
import { StatusBar, useColorScheme } from "react-native"
import { useFonts } from "expo-font"
import { Stack, useRouter, useSegments } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { PortalHost } from "@rn-primitives/portal"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"

import { warehouse14Fonts } from "@/warehouse14/fonts"
import { createFileReadCachePersistence, installReadCachePersistence } from "@/warehouse14/offline"
import { useSession } from "@/warehouse14/session"
import { StepUpDialogHost } from "@/warehouse14/StepUpDialog"
import { darkPalette, lightPalette } from "@/warehouse14/theme"
import { ConnectionBannerHost } from "@/warehouse14/ui"

SplashScreen.preventAutoHideAsync()

// Turn the read cache durable across COLD STARTS: install the on-disk adapter
// once, before React mounts, so the very first cached read on a fresh launch can
// hydrate its last-good snapshot from disk. Installing is side-effect-free beyond
// wiring the adapter (keys are pulled on demand, never eagerly slurped), and the
// adapter itself swallows every storage failure — so this can't slow or break
// startup. Read snapshots only; fiscal/money records never live here.
installReadCachePersistence(createFileReadCachePersistence())

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
        {/*
         * System status-bar contrast. Edge-to-edge draws the app behind the
         * status bar (transparent background owned by the react-native-edge-to-edge
         * plugin), so we only steer the ICON colour: light glyphs on the dark
         * theme, dark glyphs on the light theme — readable against the header on
         * both Android and iOS. `translucent` is left to the plugin; setting it
         * here would fight edge-to-edge.
         */}
        <StatusBar barStyle={scheme === "dark" ? "light-content" : "dark-content"} animated />
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
          <Stack.Screen name="analytics" options={{ title: "Auswertungen" }} />
          <Stack.Screen name="team" options={{ title: "Team" }} />
          <Stack.Screen name="tagebuch" options={{ title: "Tagebuch" }} />
          <Stack.Screen name="suche" options={{ title: "Suche" }} />
          <Stack.Screen name="erfolge" options={{ title: "Erfolge" }} />
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
