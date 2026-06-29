/**
 * MasseField — der geteilte „Maße & Verpackung"-Abschnitt: drei cm-Eingaben als
 * ein zusammenhängendes L × B × H, plus die antike Größen-Anzeige, die live aus
 * den Maßen (und dem Gewicht) die Versandklasse ableitet. EINE Quelle für Anlage
 * (neu) UND Bearbeitung (edit), damit beide identisch aussehen und sich gleich
 * verhalten.
 *
 * Gestaltung (DESIGN-SYSTEM.md §1): boxlos auf dem Papier — ein Kapitälchen-Kopf
 * mit Gilt-Punkt, nackte Felder, die Anzeige als Ablesung (kein Bedien-Element).
 * Gold bleibt Faden/Ring/Siegel; die aktive Klasse blendet sanft über (Opazität,
 * keine Layout- oder Farb-Animation), und respektiert „Reduce Motion".
 */
import { type ReactNode, useEffect } from "react"
import { View } from "react-native"
import { deriveSizeClass, type SizeClass, sizeClassLabel } from "@warehouse14/domain"
import Animated, {
  Extrapolation,
  FadeIn,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"

import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { Field } from "@/warehouse14/product-form"
import { useW14Theme } from "@/warehouse14/theme"
import { duration, timingStandard, useReduceMotion } from "@/warehouse14/ui"

const SIZE_STEPS: readonly SizeClass[] = ["S", "M", "L", "XL"]

// Welcher Versandkarton zur Klasse passt — der eigentliche Zweck der Maße:
// Verpackung standardisieren.
const PACKING_HINT: Record<SizeClass, string> = {
  S: "Polsterumschlag oder kleiner Karton",
  M: "Standard-Karton",
  L: "großer Karton",
  XL: "Sperrgut oder Sondergröße",
}

export type MasseFieldKey = "lengthCm" | "widthCm" | "heightCm"

export interface MasseFieldErrors {
  lengthCm?: string
  widthCm?: string
  heightCm?: string
}

// One gauge node — a base/reached dot cross-fading into the ink+gilt active dot,
// driven by the shared activeSv so the marker settles smoothly as the class
// crosses S→M→L→XL while typing. Opacity-only (no layout animation); the gilt
// ring never tweens — it fades in as a finished seal.
function SizeNode({
  index,
  step,
  activeSv,
  isActive,
  reached,
}: {
  index: number
  step: SizeClass
  activeSv: SharedValue<number>
  isActive: boolean
  reached: boolean
}): ReactNode {
  const t = useW14Theme()
  const span = [index - 0.6, index, index + 0.6]
  const baseStyle = useAnimatedStyle(() => ({
    opacity: 1 - interpolate(activeSv.value, span, [0, 1, 0], Extrapolation.CLAMP),
  }))
  const activeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(activeSv.value, span, [0, 1, 0], Extrapolation.CLAMP),
  }))
  return (
    <View className="items-center gap-1.5" style={{ width: 30 }}>
      <View style={{ width: 16, height: 16 }}>
        {/* Ruhe-/erreichter Knoten — der leise Punkt. */}
        <Animated.View
          style={[
            {
              position: "absolute",
              top: 3,
              left: 3,
              height: 10,
              width: 10,
              borderRadius: 5,
              backgroundColor: reached ? t.colors.inkAged + "33" : t.colors.background,
              borderWidth: 1.5,
              borderColor: t.colors.inkAged + "59",
            },
            baseStyle,
          ]}
        />
        {/* Aktiver Knoten — Tinte gefüllt, mit Gilt-Ring besiegelt. */}
        <Animated.View
          style={[
            {
              position: "absolute",
              top: 0,
              left: 0,
              height: 16,
              width: 16,
              borderRadius: 8,
              backgroundColor: t.colors.foreground,
              borderWidth: 2,
              borderColor: t.colors.gilt,
            },
            activeStyle,
          ]}
        />
      </View>
      <Text
        className="font-mono text-2xs"
        style={{
          // Solid secondary ink (7.49:1 on parchment, AA); the active state is
          // carried by the 700/500 weight split, not by opacity.
          color: isActive ? t.colors.foreground : t.colors.inkAged,
          fontWeight: isActive ? "700" : "500",
          letterSpacing: 0.5,
        }}
      >
        {step}
      </Text>
    </View>
  )
}

function SizeMeter({ active }: { active: SizeClass | null }): ReactNode {
  const t = useW14Theme()
  const reduceMotion = useReduceMotion()
  const activeIndex = active ? SIZE_STEPS.indexOf(active) : -1
  const activeSv = useSharedValue(activeIndex)
  useEffect(() => {
    // Settle the marker on the curator curve; jump instantly under reduce-motion.
    activeSv.value = reduceMotion ? activeIndex : withTiming(activeIndex, timingStandard("base"))
  }, [activeIndex, reduceMotion, activeSv])

  return (
    <View className="gap-3 pt-0.5">
      {/* Gauge — die Knoten auf dem Gilt-Faden. Jeder Knoten sitzt zentriert in
          einer 16px-Box, damit der Faden durch alle Mitten läuft und die
          Buchstaben auf einer Grundlinie stehen. */}
      <View className="relative flex-row items-start justify-between px-2">
        {/* Der Faden liegt hinter den Knoten, auf Knoten-Mitte (Box-Höhe/2). */}
        <View
          style={{
            position: "absolute",
            left: 23,
            right: 23,
            top: 7.25,
            height: 1.5,
            backgroundColor: t.colors.gilt + "4d",
            borderRadius: 1,
          }}
        />
        {SIZE_STEPS.map((step, i) => (
          <SizeNode
            key={step}
            index={i}
            step={step}
            activeSv={activeSv}
            isActive={i === activeIndex}
            reached={activeIndex >= 0 && i <= activeIndex}
          />
        ))}
      </View>

      {/* Lesbare Zusammenfassung — quert die Klasse, blendet sanft über. Leere
          Maße zeigen die ehrliche leere Anzeige. */}
      {active ? (
        <Animated.View
          key={active}
          entering={reduceMotion ? undefined : FadeIn.duration(duration.base)}
          className="flex-row items-center gap-2"
        >
          <Text className="text-sm font-semibold" style={{ color: t.colors.foreground }}>
            {sizeClassLabel(active)}
          </Text>
          <View style={{ height: 3, width: 3, borderRadius: 1.5, backgroundColor: t.colors.gilt }} />
          <Text className="text-muted-foreground flex-1 text-xs" numberOfLines={1}>
            {PACKING_HINT[active]}
          </Text>
        </Animated.View>
      ) : (
        <Text className="text-muted-foreground text-xs leading-5">
          Maße eingeben — die Größenklasse erscheint hier automatisch.
        </Text>
      )}
    </View>
  )
}

/**
 * The shared section: the small-caps kicker, the L × B × H measurement row, and
 * the live size gauge. `weightGrams` (when known) bumps a heavy item up one
 * class. Errors paint the offending input red and surface one message.
 */
export function MasseField({
  lengthCm,
  widthCm,
  heightCm,
  weightGrams,
  onChange,
  errors,
}: {
  lengthCm: string
  widthCm: string
  heightCm: string
  weightGrams?: string | null
  onChange: (key: MasseFieldKey, value: string) => void
  errors?: MasseFieldErrors
}): ReactNode {
  const t = useW14Theme()
  const num = (v: string) => (v.trim() ? Number(v) : null)
  const active = deriveSizeClass({
    lengthCm: num(lengthCm),
    widthCm: num(widthCm),
    heightCm: num(heightCm),
    weightGrams: weightGrams != null && weightGrams !== "" ? Number(weightGrams) : null,
  })

  return (
    <View className="gap-3.5">
      {/* Kapitälchen-Kopf mit Gilt-Punkt — boxlos auf dem Papier. */}
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }} />
          <Text
            className="text-muted-foreground text-2xs font-semibold"
            style={{ letterSpacing: 1.2 }}
            numberOfLines={1}
          >
            MASSE & VERPACKUNG
          </Text>
        </View>
        <Text className="text-muted-foreground text-xs leading-5">
          Außenmaße bestimmen die Größenklasse für einen einheitlichen Versandkarton.
        </Text>
      </View>

      {/* Ein zusammenhängendes Maß: L × B × H in einer Zeile, nicht drei Kästen. */}
      <Field
        label="Maße"
        hint="Länge × Breite × Höhe, in Zentimetern."
        error={errors?.lengthCm ?? errors?.widthCm ?? errors?.heightCm}
      >
        <View className="flex-row items-center gap-3">
          <Input
            value={lengthCm}
            onChangeText={(v) => onChange("lengthCm", v)}
            keyboardType="decimal-pad"
            placeholder="12"
            className="flex-1"
            style={{
              textAlign: "center",
              ...(errors?.lengthCm ? { borderColor: t.colors.destructive } : {}),
            }}
            aria-invalid={!!errors?.lengthCm}
            accessibilityLabel="Länge in Zentimetern"
          />
          <Text className="text-sm" style={{ color: t.colors.inkAged }}>
            ×
          </Text>
          <Input
            value={widthCm}
            onChangeText={(v) => onChange("widthCm", v)}
            keyboardType="decimal-pad"
            placeholder="8"
            className="flex-1"
            style={{
              textAlign: "center",
              ...(errors?.widthCm ? { borderColor: t.colors.destructive } : {}),
            }}
            aria-invalid={!!errors?.widthCm}
            accessibilityLabel="Breite in Zentimetern"
          />
          <Text className="text-sm" style={{ color: t.colors.inkAged }}>
            ×
          </Text>
          <Input
            value={heightCm}
            onChangeText={(v) => onChange("heightCm", v)}
            keyboardType="decimal-pad"
            placeholder="3"
            className="flex-1"
            style={{
              textAlign: "center",
              ...(errors?.heightCm ? { borderColor: t.colors.destructive } : {}),
            }}
            aria-invalid={!!errors?.heightCm}
            accessibilityLabel="Höhe in Zentimetern"
          />
          <Text className="font-mono-medium text-sm" style={{ color: t.colors.inkAged }}>
            cm
          </Text>
        </View>
      </Field>

      {/* Abgeleitete Größenklasse als antike Anzeige, live aus den Maßen. */}
      <SizeMeter active={active} />
    </View>
  )
}
