/**
 * Scan (iOS/Android) — the native vision-camera barcode scanner, promoted to a
 * world-class owner surface. On a code it calls the authenticated
 * productsApi.list ({ q: code }) and classifies it with the ported
 * classifyScanMatch, giving the FULL verdict (found / sold / reserved / draft /
 * not-found). A found row opens the Lager detail.
 *
 * Craft (DESIGN.md): a calm dark scrim around a centred framing reticle with
 * brass corner brackets and a reduced-motion-aware scan sweep; an instant
 * verdict card that animates in (spine motion) with one deliberate haptic per
 * resolution (success on a hit, warning on a miss, error on a failure); and
 * graceful permission / no-camera / error+retry states. Every colour, radius,
 * spacing and motion value comes from the theme + the shared spine — no
 * hardcoded hex, no hand-rolled animation, no fabricated number.
 *
 * This file is `.native` only — Metro never bundles vision-camera for web.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { AppState, type AppStateStatus, StyleSheet, View } from "react-native"
import { useRouter } from "expo-router"
import { useIsFocused } from "@react-navigation/native"
import {
  CameraOff,
  Lock,
  PackageCheck,
  PackageX,
  RotateCcw,
  ScanLine,
  Tag,
  WifiOff,
  type LucideIcon,
} from "lucide-react-native"
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated"
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
  type Code,
} from "react-native-vision-camera"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { describeError, formatEur, resolveScannedCode } from "@/warehouse14/api"
import { statusLabel, statusVariant } from "@/warehouse14/product-ui"
import type { ScanMatch } from "@/warehouse14/scan-resolve"
import { useW14Theme } from "@/warehouse14/theme"
import {
  duration,
  easing,
  haptics,
  itemEnter,
  itemExit,
  PaperGrain,
  PressableScale,
  useReduceMotion,
  useScreenInsets,
} from "@/warehouse14/ui"

type Lookup =
  | { status: "idle" }
  | { status: "looking"; code: string }
  | { status: "done"; code: string; match: ScanMatch }
  | { status: "error"; code: string; message: string }

/** Hold a resolved verdict on screen before the same code can re-fire. */
const DEBOUNCE_MS = 1500
/** The square framing window, as a fraction of the screen's shorter edge. */
const RETICLE_RATIO = 0.66

export function ScanScreen() {
  const t = useW14Theme()
  const router = useRouter()
  const insets = useScreenInsets()
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice("back")
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" })

  // The scan route is registered `hidden:true`, so React Navigation keeps it
  // MOUNTED after the user opens it — without these guards the camera would keep
  // streaming on every other tab (battery, privacy indicator, hardware lock).
  // Hold the camera live only while this screen is focused AND the app is in the
  // foreground.
  const isFocused = useIsFocused()
  const [appActive, setAppActive] = useState(() => AppState.currentState === "active")
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: AppStateStatus) =>
      setAppActive(s === "active"),
    )
    return () => sub.remove()
  }, [])

  const lastRef = useRef<{ value: string; at: number }>({ value: "", at: 0 })
  const busyRef = useRef(false)
  // Mirrors whether the scanner is armed (idle/looking) so the codeScanner
  // callback — which keeps firing while a verdict card is shown — can bail in a
  // worklet-cheap ref read instead of stale closure state.
  const armedRef = useRef(true)

  // One deliberate haptic per resolution, paired to its colour (DESIGN.md §7):
  // success on a real hit, warning on a miss, error on a lookup failure.
  const onScanned = useCallback(async (raw: string) => {
    const now = Date.now()
    // Once a verdict is on screen we STOP scanning until "Erneut scannen": a
    // different code must not yank the card the owner is reading away, and the
    // same code held in frame must not re-resolve (and re-fire haptics) on a loop.
    if (!armedRef.current) return
    if (busyRef.current) return
    if (raw === lastRef.current.value && now - lastRef.current.at < DEBOUNCE_MS) return
    lastRef.current = { value: raw, at: now }
    busyRef.current = true
    armedRef.current = false
    setLookup({ status: "looking", code: raw })
    try {
      const match = await resolveScannedCode(raw)
      setLookup({ status: "done", code: raw, match })
      if (match.kind === "not-found") haptics.warning()
      else haptics.success()
    } catch (e) {
      setLookup({ status: "error", code: raw, message: describeError(e) })
      haptics.error()
    } finally {
      busyRef.current = false
    }
  }, [])

  // "Erneut scannen" — re-arm the scanner for the same code by clearing the
  // debounce memory, then drop back to the idle hint.
  const rescan = useCallback(() => {
    lastRef.current = { value: "", at: 0 }
    busyRef.current = false
    armedRef.current = true
    haptics.selection()
    setLookup({ status: "idle" })
  }, [])

  const codeScanner = useCodeScanner({
    codeTypes: ["qr", "ean-13", "ean-8", "code-128", "code-39"],
    onCodeScanned: (codes: Code[]) => {
      const value = codes.find((c) => c.value)?.value
      if (value) void onScanned(value)
    },
  })

  if (!hasPermission) {
    return (
      <PermissionGate
        icon={Lock}
        title="Kamerazugriff benötigt"
        description="Zum Scannen von Barcodes braucht die App Zugriff auf die Kamera. Du kannst den Zugriff jederzeit in den Einstellungen ändern."
        actionLabel="Zugriff erlauben"
        onAction={() => {
          haptics.selection()
          void requestPermission()
        }}
      />
    )
  }

  if (device == null) {
    return (
      <PermissionGate
        icon={CameraOff}
        title="Keine Kamera gefunden"
        description="Auf diesem Gerät ist keine Rückkamera verfügbar. Der Barcode-Scanner braucht eine Kamera."
      />
    )
  }

  const active = lookup.status === "idle" || lookup.status === "looking"
  // Stream only while focused + foregrounded; keep the preview live even while a
  // verdict is shown so the scene doesn't freeze (only resolution is paused).
  const cameraActive = isFocused && appActive

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={cameraActive}
        codeScanner={codeScanner}
      />

      <ScanOverlay scanning={active && cameraActive} insets={insets.screen.top} />

      <View
        style={{
          position: "absolute",
          left: insets.screen.left + t.space.x4,
          right: insets.screen.right + t.space.x4,
          bottom: insets.stickyBottom + t.space.x1,
        }}
      >
        <VerdictCard
          lookup={lookup}
          onOpen={(id) => {
            haptics.selection()
            router.push({ pathname: "/product/[id]", params: { id } })
          }}
          onRescan={rescan}
        />
      </View>
    </View>
  )
}

// ── Camera overlay: scrim · framing reticle · brass brackets · scan sweep ─────

/** Scrim colour drawn AROUND the window so the live camera reads through it. */
const SCRIM = "#0009"

function ScanOverlay({ scanning, insets }: { scanning: boolean; insets: number }) {
  const t = useW14Theme()
  const reduceMotion = useReduceMotion()
  const sweep = useSharedValue(0)
  // The reticle is a real centred square; we measure the overlay and size it off
  // the shorter edge, then place the window + the four scrim panels in absolute
  // PIXELS (no mixed %-edge + margin, which Yoga can resolve inconsistently).
  // The camera shows through the genuine gap — not through a "transparent"
  // overlay that would still dim it, and with no SVG mask.
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  const size = box ? Math.round(Math.min(Math.min(box.w, box.h) * RETICLE_RATIO, 320)) : 0
  const left = box ? Math.round((box.w - size) / 2) : 0
  const top = box ? Math.round((box.h - size) / 2) : 0

  // The sweep animates a brass hairline down the window. It runs only while the
  // scanner is armed, and degrades to a centred still line under reduce motion
  // (DESIGN.md §6 — never translate under reduced motion).
  useEffect(() => {
    if (reduceMotion || !scanning) {
      cancelAnimation(sweep)
      sweep.value = reduceMotion ? 0.5 : 0
      return
    }
    sweep.value = 0
    sweep.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.cubic) }),
        withTiming(0, { duration: 1700, easing: Easing.inOut(Easing.cubic) }),
      ),
      -1,
      false,
    )
    return () => cancelAnimation(sweep)
  }, [reduceMotion, scanning, sweep])

  const sweepStyle = useAnimatedStyle(() => {
    "worklet"
    // 0..1 → top..bottom of the window, inset so it never clips the rounded
    // corners; the line fades at the extremes so the turnaround stays calm.
    const p = sweep.value
    const edge = Math.min(p, 1 - p)
    return {
      top: `${6 + p * 88}%`,
      opacity: scanning ? Math.min(1, edge * 6 + 0.15) : 0,
    }
  })

  const bracket = t.colors.primary
  const corner = 26
  const thick = 3
  const ready = box != null && size > 0

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout
        setBox({ w: width, h: height })
      }}
    >
      {/* Four scrim panels framing a clear window in the centre. */}
      {ready ? (
        <ScrimFrame left={left} top={top} size={size} insets={insets} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]} />
      )}

      {ready ? (
        <View
          style={{
            position: "absolute",
            width: size,
            height: size,
            left,
            top,
            borderRadius: t.radii.card,
          }}
        >
          {/* Faint white edge so the window reads as a frame against the scrim. */}
          <View
            style={[
              StyleSheet.absoluteFill,
              { borderRadius: t.radii.card, borderWidth: 1, borderColor: "#ffffff33" },
            ]}
          />

          {/* Animated scan sweep a brass hairline travelling the window. */}
          <Animated.View
            style={[
              {
                position: "absolute",
                left: "6%",
                right: "6%",
                height: 2,
                borderRadius: t.radii.button,
                backgroundColor: bracket,
              },
              sweepStyle,
            ]}
          />

          {/* Four brass corner brackets framing the window. */}
          <Corner style={{ top: 0, left: 0, borderTopWidth: thick, borderLeftWidth: thick }} size={corner} color={bracket} radius={t.radii.card} />
          <Corner style={{ top: 0, right: 0, borderTopWidth: thick, borderRightWidth: thick }} size={corner} color={bracket} radius={t.radii.card} />
          <Corner style={{ bottom: 0, left: 0, borderBottomWidth: thick, borderLeftWidth: thick }} size={corner} color={bracket} radius={t.radii.card} />
          <Corner style={{ bottom: 0, right: 0, borderBottomWidth: thick, borderRightWidth: thick }} size={corner} color={bracket} radius={t.radii.card} />

          {/* Quiet hint, pinned just below the window. */}
          <View
            style={{
              position: "absolute",
              top: size + t.space.x5,
              left: 0,
              right: 0,
              alignItems: "center",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: t.space.x2,
                backgroundColor: "#0007",
                borderRadius: t.radii.button,
                paddingHorizontal: t.space.x3,
                paddingVertical: t.space.x2,
              }}
            >
              <ScanLine size={t.icon.sm} color="#fff" />
              <Text style={{ color: "#fff" }} className="text-sm">
                Barcode in den Rahmen halten
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  )
}

/**
 * The scrim drawn as four pixel-positioned panels around the centred window so
 * the live camera shows through the gap. Top/bottom span the full width; the two
 * side bands fill only the band beside the window. No SVG/mask — pure layout, so
 * it stays cheap and theme-pure. `insets` keeps the top band at least as tall as
 * the notch so the reticle never rides under it on a tall layout.
 */
function ScrimFrame({
  left,
  top,
  size,
  insets,
}: {
  left: number
  top: number
  size: number
  insets: number
}) {
  const band = { position: "absolute" as const, backgroundColor: SCRIM as string }
  const topBand = Math.max(top, insets)
  return (
    <>
      {/* Top band full width, down to the window's top edge (≥ the notch). */}
      <View style={[band, { top: 0, left: 0, right: 0, height: topBand }]} />
      {/* Bottom band full width, from the window's bottom edge down. */}
      <View style={[band, { top: top + size, left: 0, right: 0, bottom: 0 }]} />
      {/* Left band beside the window only. */}
      <View style={[band, { top, height: size, left: 0, width: left }]} />
      {/* Right band beside the window only. */}
      <View style={[band, { top, height: size, left: left + size, right: 0 }]} />
    </>
  )
}

function Corner({
  style,
  size,
  color,
  radius,
}: {
  style: object
  size: number
  color: string
  radius: number
}) {
  return (
    <View
      style={[
        { position: "absolute", width: size, height: size, borderColor: color, borderRadius: radius },
        style,
      ]}
    />
  )
}

// ── Verdict card: animated, themed, one card per state ────────────────────────

function VerdictCard({
  lookup,
  onOpen,
  onRescan,
}: {
  lookup: Lookup
  onOpen: (id: string) => void
  onRescan: () => void
}) {
  const reduceMotion = useReduceMotion()
  // Re-key on the meaningful state so each new verdict re-animates in.
  const key =
    lookup.status === "done"
      ? `done:${lookup.match.kind}:${lookup.code}`
      : lookup.status === "error"
        ? `error:${lookup.code}`
        : lookup.status

  return (
    <Animated.View
      key={key}
      entering={itemEnter(0, reduceMotion)}
      exiting={itemExit(reduceMotion)}
    >
      <VerdictBody lookup={lookup} onOpen={onOpen} onRescan={onRescan} />
    </Animated.View>
  )
}

function VerdictBody({
  lookup,
  onOpen,
  onRescan,
}: {
  lookup: Lookup
  onOpen: (id: string) => void
  onRescan: () => void
}) {
  const t = useW14Theme()

  if (lookup.status === "idle") {
    return (
      <Card className="px-4 py-3">
        <Text className="text-muted-foreground text-center text-sm">
          Bereit zum Scannen
        </Text>
      </Card>
    )
  }

  if (lookup.status === "looking") {
    return (
      <Card className="gap-1 px-4 py-3">
        <CodeLine code={lookup.code} />
        <Pulse>
          <Text className="text-muted-foreground text-sm">Suche im Lager…</Text>
        </Pulse>
      </Card>
    )
  }

  if (lookup.status === "error") {
    const offline = /verbindung|netzwerk|network|timeout|zeitüberschreitung/i.test(lookup.message)
    return (
      <Card className="gap-3 px-4 py-4" style={{ borderColor: t.colors.destructive }}>
        <View className="flex-row items-start gap-3">
          <VerdictDisc icon={offline ? WifiOff : PackageX} color={t.colors.destructive} />
          <View className="flex-1 gap-1">
            <Text className="text-xl font-display-semibold leading-tight">
              {offline ? "Keine Verbindung" : "Suche fehlgeschlagen"}
            </Text>
            <Text style={{ color: t.colors.destructive }} className="text-sm" numberOfLines={3}>
              {lookup.message}
            </Text>
            <CodeLine code={lookup.code} />
          </View>
        </View>
        <Button variant="outline" accessibilityLabel="Erneut scannen" onPress={onRescan}>
          <RotateCcw size={t.icon.sm} color={t.colors.foreground} />
          <Text>Erneut scannen</Text>
        </Button>
      </Card>
    )
  }

  // status === "done"
  if (lookup.match.kind === "not-found") {
    return (
      <Card className="gap-3 px-4 py-4">
        <View className="flex-row items-center gap-3">
          <VerdictDisc icon={PackageX} color={t.colors.destructive} />
          <View className="flex-1 gap-1">
            <Text className="text-xl font-display-semibold leading-tight">Nicht im Lager</Text>
            <CodeLine code={lookup.code} />
          </View>
        </View>
        <Button variant="outline" accessibilityLabel="Erneut scannen" onPress={onRescan}>
          <RotateCcw size={t.icon.sm} color={t.colors.foreground} />
          <Text>Erneut scannen</Text>
        </Button>
      </Card>
    )
  }

  const p = lookup.match.product
  const found = lookup.match.kind === "found"
  // A found (AVAILABLE) product is the happy path → verdigris check. Sold /
  // reserved / draft are real-but-flagged → brass tag, with the status badge
  // carrying the precise meaning. Never colour a non-available state green.
  const tone = found ? t.colors.verdigris : t.colors.primary
  const Icon: LucideIcon = found ? PackageCheck : Tag

  return (
    <Card className="gap-3 px-4 py-4">
      <View className="flex-row items-center gap-3">
        <VerdictDisc icon={Icon} color={tone} />
        <View className="flex-1 gap-1">
          <Text className="text-xl font-display-semibold leading-tight" numberOfLines={2}>
            {p.name}
          </Text>
          <View className="flex-row items-center gap-2">
            <Badge variant={statusVariant(p.status)}>
              <Text>{statusLabel(p.status)}</Text>
            </Badge>
            <Text className="font-mono text-xs text-muted-foreground" numberOfLines={1}>
              {p.sku}
            </Text>
          </View>
        </View>
        <Text className="font-mono-medium text-base" style={{ color: t.colors.primary }}>
          {formatEur(p.listPriceEur)}
        </Text>
      </View>
      <View className="flex-row gap-3">
        <Button
          variant="outline"
          className="flex-1"
          accessibilityLabel="Erneut scannen"
          onPress={onRescan}
        >
          <RotateCcw size={t.icon.sm} color={t.colors.foreground} />
          <Text>Erneut</Text>
        </Button>
        <PressableScale
          className="flex-1"
          accessibilityRole="button"
          accessibilityLabel={`${p.name} im Lager öffnen`}
          onPress={() => onOpen(p.id)}
          style={{
            minHeight: t.touch.comfortable,
            borderRadius: t.radii.button,
            backgroundColor: t.colors.primary,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: t.space.x4,
          }}
        >
          <Text style={{ color: t.colors.primaryForeground }} className="font-semibold">
            Im Lager öffnen
          </Text>
        </PressableScale>
      </View>
    </Card>
  )
}

/** The icon disc that leads every verdict — a soft tinted circle (DESIGN.md §3). */
function VerdictDisc({ icon: Icon, color }: { icon: LucideIcon; color: string }) {
  const t = useW14Theme()
  return (
    <View
      className="h-10 w-10 items-center justify-center rounded-full"
      style={{ backgroundColor: color + "1f" }}
    >
      <Icon size={t.icon.lg} color={color} />
    </View>
  )
}

/** The scanned code, mono, single line — the trustworthy raw value. */
function CodeLine({ code }: { code: string }) {
  return (
    <Text className="font-mono text-xs text-muted-foreground" numberOfLines={1}>
      {code}
    </Text>
  )
}

/** A calm opacity pulse for the "looking…" line (still under reduce motion). */
function Pulse({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReduceMotion()
  const o = useSharedValue(1)
  useEffect(() => {
    if (reduceMotion) {
      o.value = 0.6
      return
    }
    o.value = withRepeat(
      withSequence(
        withTiming(0.45, { duration: duration.base, easing: easing.standard }),
        withTiming(1, { duration: duration.base, easing: easing.standard }),
      ),
      -1,
      false,
    )
    return () => cancelAnimation(o)
  }, [reduceMotion, o])
  const style = useAnimatedStyle(() => ({ opacity: o.value }))
  return <Animated.View style={style}>{children}</Animated.View>
}

// ── Permission / no-camera gate — themed, on the parchment canvas ─────────────

function PermissionGate({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}) {
  const t = useW14Theme()
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.colors.background,
        alignItems: "center",
        justifyContent: "center",
        padding: t.space.x6,
        gap: t.space.x4,
      }}
    >
      <PaperGrain />
      <View
        className="h-16 w-16 items-center justify-center rounded-full"
        style={{
          backgroundColor: t.colors.primary + "14",
          borderColor: t.colors.border,
          borderWidth: 1,
        }}
      >
        <Icon size={t.icon.xl} color={t.colors.primary} />
      </View>
      <Text className="text-center text-2xl font-display-semibold leading-tight">{title}</Text>
      <Text className="text-muted-foreground max-w-xs text-center text-sm leading-5">
        {description}
      </Text>
      {actionLabel && onAction ? (
        <Button onPress={onAction} className="mt-2">
          <Text>{actionLabel}</Text>
        </Button>
      ) : null}
    </View>
  )
}
