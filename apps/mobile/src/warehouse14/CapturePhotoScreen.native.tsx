/**
 * Photo capture (iOS/Android) — vision-camera takePhoto → preview → confirm.
 * A controlled, reusable screen: the consumer decides what to do with the
 * confirmed photo (product now; KYC/Ankauf later). This file is `.native` only
 * — Metro never bundles vision-camera for web (the split keeps web export clean).
 *
 * No-persist: retake/cancel discard the temp capture file immediately; on
 * confirm, the pipeline discards it after upload (see photo-pipeline.ts); and an
 * unmount / route-dismissal while previewing discards it too (the effect below)
 * — an Ausweis must never linger on the device, on ANY path.
 */
import { useEffect, useRef, useState } from "react"
import { Image, Pressable, StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Camera, useCameraDevice, useCameraPermission } from "react-native-vision-camera"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { type CapturedPhoto, discardCapture } from "@/warehouse14/photo-pipeline"
import { useW14Theme } from "@/warehouse14/theme"

function previewUri(uri: string): string {
  return uri.startsWith("file://") || uri.startsWith("content://") ? uri : `file://${uri}`
}

export interface CapturePhotoScreenProps {
  /** The captured photo was confirmed — upload it (the consumer owns binding). */
  onConfirm: (photo: CapturedPhoto) => void | Promise<void>
  onCancel: () => void
  /** True while the consumer is uploading (disables the buttons). */
  busy?: boolean
  /** Optional error from the consumer's upload. */
  error?: string | null
}

export function CapturePhotoScreen({ onConfirm, onCancel, busy, error }: CapturePhotoScreenProps) {
  const t = useW14Theme()
  const insets = useSafeAreaInsets()
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice("back")
  const camera = useRef<Camera>(null)
  const [captured, setCaptured] = useState<CapturedPhoto | null>(null)
  const [capturing, setCapturing] = useState(false)

  // No-persist (airtight): while a capture is held, discard its temp file when we
  // stop holding it OR when the screen unmounts. This closes the one path the
  // explicit retake/cancel/confirm handlers miss — a full route dismissal
  // (Android back, swipe-to-dismiss, programmatic router.back) WHILE the preview
  // is showing. discardCapture is best-effort, so the overlap with those handlers
  // is a harmless no-op. An Ausweis must never linger on the device.
  useEffect(() => {
    return () => {
      if (captured) discardCapture(captured)
    }
  }, [captured])

  async function shoot() {
    if (!camera.current || capturing) return
    setCapturing(true)
    try {
      const photo = await camera.current.takePhoto({ flash: "off" })
      setCaptured({ uri: photo.path, mime: "image/jpeg" })
    } catch {
      // takePhoto can fail if the session is mid-teardown; just stay on camera.
    } finally {
      setCapturing(false)
    }
  }

  function retake() {
    if (captured) discardCapture(captured)
    setCaptured(null)
  }

  function cancel() {
    if (captured) discardCapture(captured)
    onCancel()
  }

  if (!hasPermission) {
    return (
      <Centered>
        <Card className="gap-3 px-4 py-5">
          <Text className="text-lg font-semibold">Kamerazugriff benötigt</Text>
          <Text className="text-muted-foreground text-sm">
            Zum Aufnehmen von Fotos braucht die App Zugriff auf die Kamera.
          </Text>
          <Button onPress={() => void requestPermission()}>
            <Text>Zugriff erlauben</Text>
          </Button>
          <Button variant="outline" onPress={cancel}>
            <Text>Abbrechen</Text>
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

  const barStyle = {
    position: "absolute" as const,
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: insets.bottom + t.space.x4,
    paddingTop: t.space.x4,
    paddingHorizontal: t.space.x4,
  }

  if (captured) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <Image
          source={{ uri: previewUri(captured.uri) }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
        />
        <View style={barStyle}>
          {error ? (
            <Text className="mb-2 text-center text-sm text-destructive">{error}</Text>
          ) : null}
          <View className="flex-row gap-3">
            <Button variant="outline" className="flex-1" onPress={retake} disabled={busy}>
              <Text>Wiederholen</Text>
            </Button>
            <Button className="flex-1" onPress={() => void onConfirm(captured)} disabled={busy}>
              <Text>{busy ? "Hochladen…" : "Verwenden"}</Text>
            </Button>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <Camera ref={camera} style={StyleSheet.absoluteFill} device={device} isActive photo />
      <View
        style={[
          barStyle,
          { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
        ]}
      >
        <Button variant="outline" onPress={cancel}>
          <Text>Abbrechen</Text>
        </Button>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Foto aufnehmen"
          onPress={() => void shoot()}
          disabled={capturing}
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: "#fff",
            borderWidth: 4,
            borderColor: t.colors.primary,
            opacity: capturing ? 0.6 : 1,
          }}
        />
        <View style={{ width: 88 }} />
      </View>
    </View>
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
