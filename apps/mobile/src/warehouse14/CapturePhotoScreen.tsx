/**
 * Default / web fallback for the capture screen. vision-camera is a native
 * module — Metro resolves CapturePhotoScreen.native.tsx on iOS/Android and this
 * file elsewhere, so the web bundle never imports vision-camera. This is also
 * the module TypeScript resolves for `@/warehouse14/CapturePhotoScreen`.
 */
import { View } from "react-native"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import type { CapturedPhoto } from "@/warehouse14/photo-pipeline"
import { useW14Theme } from "@/warehouse14/theme"

export interface CapturePhotoScreenProps {
  onConfirm: (photo: CapturedPhoto) => void | Promise<void>
  onCancel: () => void
  busy?: boolean
  error?: string | null
}

export function CapturePhotoScreen({ onCancel }: CapturePhotoScreenProps) {
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
      <Card className="gap-3 px-4 py-5">
        <Text className="text-lg font-semibold">Kamera nur im nativen Build</Text>
        <Text className="text-muted-foreground text-sm">
          Die Fotoaufnahme nutzt react-native-vision-camera (natives Modul) und läuft nicht im Web
          oder in Expo Go. Starte einen Dev-/EAS-Build auf iOS oder Android.
        </Text>
        <Button variant="outline" onPress={onCancel}>
          <Text>Zurück</Text>
        </Button>
      </Card>
    </View>
  )
}
