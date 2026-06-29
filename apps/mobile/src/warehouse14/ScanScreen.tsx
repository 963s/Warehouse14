/**
 * Default / web-Fallback der Scan-Fläche.
 *
 * react-native-vision-camera ist ein natives Modul — es läuft nicht im Web oder
 * in Expo Go. Metro löst ScanScreen.native.tsx auf iOS/Android auf und diese
 * Datei überall sonst, damit das Web-Bundle vision-camera nie importiert. Das
 * ist auch das Modul, das TypeScript für `@/warehouse14/ScanScreen` auflöst.
 *
 * Form (DESIGN-SYSTEM.md): keine Kästen in Kästen. Der ehrliche Hinweis lebt
 * boxlos auf dem warmen Pergament — das bespoke Sucher-Siegel, ein Kicker
 * (Gilt-Diamant + Kapitälchen), die Bricolage-Stimme und großzügiger Weißraum.
 * Deutsche UI.
 */
import { View } from "react-native"
import Svg, { Circle, Line, Path } from "react-native-svg"

import { W14Text } from "./components"
import { useW14Theme } from "./theme"
import { PaperGrain } from "./ui"

export function ScanScreen() {
  const t = useW14Theme()
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.colors.background,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: t.space.x4,
        gap: t.space.x3,
      }}
    >
      <PaperGrain />

      {/* Das bespoke Sucher-Siegel — bare auf dem Papier, kein Kasten. */}
      <View style={{ marginBottom: t.space.x1 }}>
        <Svg width={68} height={68} viewBox="0 0 48 48" fill="none" accessibilityElementsHidden>
          <Circle cx={24} cy={24} r={21} stroke={t.colors.primary} strokeWidth={1.4} fill="none" />
          <Circle cx={24} cy={24} r={18} stroke={t.colors.primary} strokeWidth={0.7} strokeOpacity={0.35} fill="none" />
          <Path d="M15 18 L15 15 L18 15" stroke={t.colors.gilt} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Path d="M30 15 L33 15 L33 18" stroke={t.colors.gilt} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Path d="M33 30 L33 33 L30 33" stroke={t.colors.gilt} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Path d="M18 33 L15 33 L15 30" stroke={t.colors.gilt} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Line x1={17} y1={24} x2={31} y2={24} stroke={t.colors.gilt} strokeWidth={1.4} strokeLinecap="round" />
        </Svg>
      </View>

      {/* Kicker — Gilt-Diamant + Kapitälchen-Zeile (DESIGN-SYSTEM.md §6). */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.x1 }}>
        <View
          style={{
            height: 6,
            width: 6,
            backgroundColor: t.colors.gilt,
            transform: [{ rotate: "45deg" }],
          }}
        />
        <W14Text variant="caption" style={{ letterSpacing: 1.4, fontFamily: t.fonts.semibold }}>
          NUR IM NATIVEN BUILD
        </W14Text>
      </View>

      <W14Text variant="title" style={{ textAlign: "center" }}>
        Kamera nur im nativen Build
      </W14Text>
      <W14Text variant="caption" style={{ textAlign: "center", maxWidth: 320, lineHeight: 20 }}>
        Der Barcode-Scanner nutzt ein natives Kameramodul und läuft daher nicht im Web oder in Expo
        Go. Starte einen Dev- oder EAS-Build auf iOS oder Android, um zu scannen.
      </W14Text>
    </View>
  )
}
