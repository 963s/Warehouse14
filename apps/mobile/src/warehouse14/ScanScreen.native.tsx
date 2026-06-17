/**
 * Scan (iOS/Android) — native vision-camera barcode scanner promoted to the
 * REAL staff catalog. On a code it calls the authenticated productsApi.list
 * ({ q: code }) and classifies it with the ported classifyScanMatch, giving the
 * FULL verdict (found / sold / reserved / draft / not-found). A found row opens
 * the Lager detail. This file is `.native` only — Metro never bundles
 * vision-camera for web.
 */
import { useCallback, useRef, useState } from "react"
import { StyleSheet, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
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
import { STATUS_LABEL, STATUS_VARIANT } from "@/warehouse14/product-ui"
import type { ScanMatch } from "@/warehouse14/scan-resolve"
import { useW14Theme } from "@/warehouse14/theme"

type Lookup =
  | { status: "idle" }
  | { status: "looking"; code: string }
  | { status: "done"; code: string; match: ScanMatch }
  | { status: "error"; code: string; message: string }

const DEBOUNCE_MS = 1500

export function ScanScreen() {
  const t = useW14Theme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice("back")
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" })

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
      const match = await resolveScannedCode(code)
      setLookup({ status: "done", code, match })
    } catch (e) {
      setLookup({ status: "error", code, message: describeError(e) })
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
        <Card className="gap-3 px-4 py-5">
          <Text className="text-lg font-semibold">Kamerazugriff benötigt</Text>
          <Text className="text-muted-foreground text-sm">
            Zum Scannen von Barcodes braucht die App Zugriff auf die Kamera.
          </Text>
          <Button onPress={() => void requestPermission()}>
            <Text>Zugriff erlauben</Text>
          </Button>
        </Card>
      </Centered>
    )
  }

  if (device == null) {
    return (
      <Centered>
        <Card className="px-4 py-5">
          <Text className="text-lg font-semibold">Keine Kamera gefunden</Text>
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
        <VerdictCard lookup={lookup} onOpen={(id) => router.push({ pathname: "/product/[id]", params: { id } })} />
      </View>
    </View>
  )
}

function VerdictCard({ lookup, onOpen }: { lookup: Lookup; onOpen: (id: string) => void }) {
  if (lookup.status === "idle") {
    return (
      <Card className="px-4 py-3">
        <Text className="text-muted-foreground text-sm">Barcode in den Rahmen halten…</Text>
      </Card>
    )
  }
  if (lookup.status === "looking") {
    return (
      <Card className="gap-1 px-4 py-3">
        <Text className="font-mono text-xs">{lookup.code}</Text>
        <Text className="text-muted-foreground text-sm">Suche im Lager…</Text>
      </Card>
    )
  }
  if (lookup.status === "error") {
    return (
      <Card className="gap-1 border-destructive px-4 py-3">
        <Text className="font-mono text-xs">{lookup.code}</Text>
        <Text className="text-destructive text-sm">{lookup.message}</Text>
      </Card>
    )
  }
  if (lookup.match.kind === "not-found") {
    return (
      <Card className="gap-2 px-4 py-3">
        <Text className="font-mono text-xs">{lookup.code}</Text>
        <Badge variant="destructive">
          <Text>Nicht im Lager</Text>
        </Badge>
      </Card>
    )
  }
  const p = lookup.match.product
  return (
    <Card className="gap-3 px-4 py-3">
      <View className="flex-row items-center gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold" numberOfLines={2}>
            {p.name}
          </Text>
          <Text className="font-mono text-xs text-muted-foreground">{p.sku}</Text>
          <Badge variant={STATUS_VARIANT[p.status]}>
            <Text>{STATUS_LABEL[p.status]}</Text>
          </Badge>
        </View>
        <Text className="text-primary text-base font-bold">{formatEur(p.listPriceEur)}</Text>
      </View>
      <Button onPress={() => onOpen(p.id)}>
        <Text>Im Lager öffnen</Text>
      </Button>
    </Card>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  const t = useW14Theme()
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.colors.background,
        justifyContent: "center",
        padding: t.space.x4,
      }}
    >
      {children}
    </View>
  )
}
