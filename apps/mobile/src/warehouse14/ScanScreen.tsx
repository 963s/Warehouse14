/**
 * Default / web fallback for the scan screen.
 *
 * react-native-vision-camera is a native module — it cannot run on the web or
 * in Expo Go. Metro resolves ScanScreen.native.tsx on iOS/Android and this
 * file everywhere else, so the web bundle never imports vision-camera. This is
 * also the module TypeScript resolves for `@/warehouse14/ScanScreen`.
 */
import { View } from "react-native"

import { Card, W14Text } from "./components"
import { useW14Theme } from "./theme"

export function ScanScreen() {
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
      <Card style={{ gap: t.space.x3 }}>
        <W14Text variant="title">Kamera nur im nativen Build</W14Text>
        <W14Text variant="caption">
          Der Barcode-Scanner nutzt react-native-vision-camera (natives Modul) und läuft daher
          nicht im Web oder in Expo Go. Starte einen Dev-/EAS-Build auf iOS oder Android, um zu
          scannen.
        </W14Text>
      </Card>
    </View>
  )
}
