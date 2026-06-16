/**
 * Goal 2 — native camera + barcode scan (iOS/Android only).
 *
 * Uses react-native-vision-camera's built-in `useCodeScanner` — a true native
 * code scanner (AVFoundation / CameraX), NOT a webview or getUserMedia. On a
 * hit it runs the goal-1 lookup (storefrontApi { q: code }) and shows the
 * matched product, mirroring the cashier scan→resolve shape.
 *
 * This file is `.native` only; Metro never bundles vision-camera for web.
 */
import { useCallback, useRef, useState } from "react"
import { StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
  type Code,
} from "react-native-vision-camera"

import { formatPrice, lookupScannedCode, type StorefrontScanMatch } from "./api"
import { Badge, Button, Card, W14Text } from "./components"
import { useW14Theme } from "./theme"

type Lookup =
  | { status: "idle" }
  | { status: "looking"; code: string }
  | { status: "done"; code: string; match: StorefrontScanMatch }
  | { status: "error"; code: string; message: string }

const DEBOUNCE_MS = 2000

export function ScanScreen() {
  const t = useW14Theme()
  const insets = useSafeAreaInsets()
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice("back")
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" })

  // Debounce duplicate reads: ignore the same value within DEBOUNCE_MS and
  // ignore any new scan while a lookup is in flight.
  const lastRef = useRef<{ value: string; at: number }>({ value: "", at: 0 })
  const busyRef = useRef(false)

  const onScanned = useCallback(async (code: string) => {
    const now = Date.now()
    if (busyRef.current) return
    if (code === lastRef.current.value && now - lastRef.current.at < DEBOUNCE_MS) return
    lastRef.current = { value: code, at: now }
    busyRef.current = true
    setLookup({ status: "looking", code })
    try {
      const match = await lookupScannedCode(code)
      setLookup({ status: "done", code, match })
    } catch (err) {
      setLookup({ status: "error", code, message: err instanceof Error ? err.message : String(err) })
    } finally {
      busyRef.current = false
    }
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
      <Centered>
        <Card style={{ gap: t.space.x3 }}>
          <W14Text variant="title">Kamerazugriff benötigt</W14Text>
          <W14Text variant="caption">
            Zum Scannen von Barcodes braucht die App Zugriff auf die Kamera.
          </W14Text>
          <Button title="Zugriff erlauben" money onPress={() => void requestPermission()} />
        </Card>
      </Centered>
    )
  }

  if (device == null) {
    return (
      <Centered>
        <Card>
          <W14Text variant="title">Keine Kamera gefunden</W14Text>
        </Card>
      </Centered>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <Camera style={StyleSheet.absoluteFill} device={device} isActive codeScanner={codeScanner} />
      <View
        style={{
          position: "absolute",
          left: t.space.x4,
          right: t.space.x4,
          bottom: insets.bottom + t.space.x4,
        }}
      >
        <ResultCard lookup={lookup} />
      </View>
    </View>
  )
}

function ResultCard({ lookup }: { lookup: Lookup }) {
  const t = useW14Theme()
  if (lookup.status === "idle") {
    return (
      <Card>
        <W14Text variant="caption">Barcode in den Rahmen halten…</W14Text>
      </Card>
    )
  }
  if (lookup.status === "looking") {
    return (
      <Card>
        <W14Text variant="mono">{lookup.code}</W14Text>
        <W14Text variant="caption">Suche im Katalog…</W14Text>
      </Card>
    )
  }
  if (lookup.status === "error") {
    return (
      <Card style={{ borderColor: t.colors.destructive, gap: t.space.x1 }}>
        <W14Text variant="mono">{lookup.code}</W14Text>
        <W14Text variant="caption" color={t.colors.destructive}>
          {lookup.message}
        </W14Text>
      </Card>
    )
  }
  // done
  if (lookup.match.kind === "not-found") {
    return (
      <Card style={{ gap: t.space.x1 }}>
        <W14Text variant="mono">{lookup.code}</W14Text>
        <Badge label="Nicht im Katalog" tone="danger" />
      </Card>
    )
  }
  const p = lookup.match.product
  return (
    <Card style={{ flexDirection: "row", alignItems: "center", gap: t.space.x3 }}>
      <View style={{ flex: 1, gap: t.space.x1 }}>
        <W14Text variant="title" numberOfLines={2}>
          {p.name}
        </W14Text>
        <W14Text variant="mono">{p.sku}</W14Text>
        <Badge label="Gefunden" tone="positive" />
      </View>
      <W14Text variant="title" color={t.colors.primary}>
        {formatPrice(p)}
      </W14Text>
    </Card>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  const t = useW14Theme()
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, justifyContent: "center", padding: t.space.x4 }}>
      {children}
    </View>
  )
}
