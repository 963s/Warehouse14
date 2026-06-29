// NativeWind v5: load the compiled Tailwind stylesheet once, at the top-most
// component (NOT in index.js — that breaks Fast Refresh).
import "../../global.css"

import { useEffect, useState } from "react"
import { StatusBar } from "react-native"
import { useFonts } from "expo-font"
import { Stack, useRouter, useSegments } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { PortalHost } from "@rn-primitives/portal"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"

import { warehouse14Fonts } from "@/warehouse14/fonts"
import { createAppStatePersistence } from "@/warehouse14/app-state-persistence"
import { installOnboardingPersistence } from "@/warehouse14/onboarding"
import { installPreferencesPersistence } from "@/warehouse14/preferences"
import { createFileReadCachePersistence, installReadCachePersistence } from "@/warehouse14/offline"
import { useSession } from "@/warehouse14/session"
import { StepUpDialogHost } from "@/warehouse14/StepUpDialog"
import { lightPalette } from "@/warehouse14/theme"
import { installThemePreferencePersistence } from "@/warehouse14/theme-preference"
import { ConnectionBannerHost } from "@/warehouse14/ui"
import { modalPresent, stackPush } from "@/warehouse14/ui/motion/nav-transitions"

SplashScreen.preventAutoHideAsync()

// Root error boundary: if a route throws while rendering, expo-router shows this
// error screen (and dismisses the splash) instead of leaving an unmounted tree
// behind the logo. Re-exported from expo-router's built-in boundary.
export { ErrorBoundary } from "expo-router"

// Failsafe: never hang on the native splash. If RootLayout has not mounted and
// dismissed it within 8 s (slow device, font stall, a route that errored during
// its first render), force the splash away so the owner sees the app — or an
// error screen — instead of an endless logo.
setTimeout(() => {
  SplashScreen.hideAsync().catch(() => {})
}, 8000)

// Turn the read cache durable across COLD STARTS: install the on-disk adapter
// once, before React mounts, so the very first cached read on a fresh launch can
// hydrate its last-good snapshot from disk. Installing is side-effect-free beyond
// wiring the adapter (keys are pulled on demand, never eagerly slurped), and the
// adapter itself swallows every storage failure — so this can't slow or break
// startup. Read snapshots only; fiscal/money records never live here.
installReadCachePersistence(createFileReadCachePersistence())

// Durable app-state flags — the first-run "seen" gate + the owner's dashboard
// targets. Same expo-file-system shoulder, documents dir (user state the OS
// must not reclaim). Without this the onboarding intro re-shows every cold
// start and the owner's goal edits vanish on relaunch. Hydration is async +
// fire-and-forget; a failure degrades gracefully (intro plays once more,
// goals revert to defaults) — never a crash, never fabricated state.
const appStatePersistence = createAppStatePersistence()
void installOnboardingPersistence(appStatePersistence)
void installPreferencesPersistence(appStatePersistence)
void installThemePreferencePersistence(appStatePersistence)

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
  // LIGHT ONLY (owner directive): the app shell is always parchment.
  const colors = lightPalette

  // TIMEOUT FALLBACK: if fonts don't load in 5s (a device issue, a network
  // block on the expo-google-fonts fetch, a bundling gap), force the app to
  // show anyway with system fonts. Better to show the login screen with
  // fallback fonts than to hang on the splash forever.
  const [fontTimeout, setFontTimeout] = useState(false)
  useEffect(() => {
    if (fontsLoaded || fontError) return
    const timer = setTimeout(() => setFontTimeout(true), 5000)
    return () => clearTimeout(timer)
  }, [fontsLoaded, fontError])

  const ready = fontsLoaded || fontError || fontTimeout

  useEffect(() => {
    if (ready) SplashScreen.hideAsync()
  }, [ready])

  useAuthRedirect()

  if (!ready) return null

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
        <StatusBar barStyle="dark-content" animated />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.card },
            headerTintColor: colors.foreground,
            headerTitleStyle: { fontFamily: "Inter_600SemiBold" },
            contentStyle: { backgroundColor: colors.background },
            // The back button must never leak a raw route name like "(tabs)";
            // show only the chevron.
            headerBackButtonDisplayMode: "minimal",
            headerBackTitle: "",
          }}
        >
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="product/[id]" options={{ presentation: "modal", title: "Artikel", ...modalPresent() }} />
          <Stack.Screen name="product/neu" options={{ presentation: "modal", title: "Neuer Artikel", ...modalPresent() }} />
          <Stack.Screen name="product/edit" options={{ presentation: "modal", title: "Bearbeiten", ...modalPresent() }} />
          <Stack.Screen name="customer/[id]" options={{ presentation: "modal", title: "Kunde", ...modalPresent() }} />
          <Stack.Screen name="customer/neu" options={{ presentation: "modal", title: "Neuer Kunde", ...modalPresent() }} />
          <Stack.Screen name="customer/edit" options={{ presentation: "modal", title: "Kunde bearbeiten", ...modalPresent() }} />
          <Stack.Screen name="aufgaben" options={{ title: "Aufgaben", ...stackPush() }} />
          <Stack.Screen name="benachrichtigungen" options={{ title: "Benachrichtigungen", ...stackPush() }} />
          <Stack.Screen name="kasse" options={{ title: "Kasse", ...stackPush() }} />
          <Stack.Screen name="ankauf" options={{ title: "Ankauf", ...stackPush() }} />
          <Stack.Screen name="drucken" options={{ title: "Drucken", ...stackPush() }} />
          <Stack.Screen name="ebay" options={{ title: "eBay-Kanal", ...stackPush() }} />
          <Stack.Screen name="whatsapp" options={{ title: "WhatsApp", ...stackPush() }} />
          <Stack.Screen name="belege" options={{ title: "Belege & Dokumente", ...stackPush() }} />
          <Stack.Screen name="ausgaben" options={{ title: "Ausgaben", ...stackPush() }} />
          <Stack.Screen name="finanzen" options={{ title: "Finanzen", ...stackPush() }} />
          <Stack.Screen name="analytics" options={{ title: "Auswertungen", ...stackPush() }} />
          <Stack.Screen name="team" options={{ title: "Team", ...stackPush() }} />
          <Stack.Screen name="tagebuch" options={{ title: "Tagebuch", ...stackPush() }} />
          <Stack.Screen name="suche" options={{ title: "Suche", ...stackPush() }} />
          <Stack.Screen name="erfolge" options={{ title: "Erfolge", ...stackPush() }} />
          <Stack.Screen name="zielkarte" options={{ headerShown: false, ...stackPush() }} />
          <Stack.Screen name="einstellungen" options={{ title: "Einstellungen", ...stackPush() }} />
          <Stack.Screen
            name="ausgaben/ausgabe"
            options={{ presentation: "modal", title: "Ausgabe", ...modalPresent() }}
          />
          <Stack.Screen
            name="ausgaben/fixkosten"
            options={{ presentation: "modal", title: "Fixkosten", ...modalPresent() }}
          />
          <Stack.Screen
            name="aufgaben/neu"
            options={{ presentation: "modal", title: "Neue Aufgabe", ...modalPresent() }}
          />
          <Stack.Screen
            name="aufgaben/edit"
            options={{ presentation: "modal", title: "Aufgabe bearbeiten", ...modalPresent() }}
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
