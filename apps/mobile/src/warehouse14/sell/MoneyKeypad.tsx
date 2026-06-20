/**
 * MoneyKeypad — the cash-tender keypad for the sell spine.
 *
 * A big, calm numeric pad for entering "Erhalten" (cash received) on a money
 * path. Every key is a comfortable 48px money target (DESIGN.md §8) and fires
 * `impactMedium` on press — the money-path commit haptic (§7). The value is a
 * de-DE EUR string ("12,50"); the component is CONTROLLED, so the surface owns
 * the amount and can drive change/shortfall from it via `computeTender`.
 *
 * It does no money math itself beyond editing the digit string — the caller
 * parses it with `tryToCents`. Quick-cash chips (the common notes) jump straight
 * to a covering amount so a cash sale is two taps. Honest: it shows the buttons
 * and the value, never a fabricated total.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import { Delete } from "lucide-react-native"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { PressableScale } from "@/warehouse14/ui"
import { impactMedium, selection } from "@/warehouse14/ui/native"

/** Append a typed character to a de-DE EUR string, keeping it well-formed. */
export function appendKey(current: string, key: string): string {
  if (key === "⌫") return current.slice(0, -1)
  if (key === ",") {
    if (current.includes(",")) return current // one decimal separator only
    return current === "" ? "0," : `${current},`
  }
  // A digit. Block a third decimal place and a pointless leading zero run.
  const commaAt = current.indexOf(",")
  if (commaAt >= 0 && current.length - commaAt > 2) return current
  if (current === "0") return key // replace a lone leading zero
  return current + key
}

export interface MoneyKeypadProps {
  /** Current de-DE EUR string (e.g. "12,50"). Controlled. */
  value: string
  onChange: (next: string) => void
  /**
   * Quick-cash amounts in whole EUR (e.g. [10, 20, 50]) that jump the value to a
   * covering note. Omit to hide the quick row.
   */
  quickCash?: number[]
  /** Accessibility prefix for the keys (default "Ziffer"). */
  accessibilityLabelPrefix?: string
}

const KEYS: string[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [",", "0", "⌫"],
]

export function MoneyKeypad({
  value,
  onChange,
  quickCash,
  accessibilityLabelPrefix = "Ziffer",
}: MoneyKeypadProps): ReactNode {
  const t = useW14Theme()

  const press = (key: string): void => {
    impactMedium() // money-path commit haptic (DESIGN.md §7)
    onChange(appendKey(value, key))
  }

  return (
    <View className="gap-3">
      {quickCash != null && quickCash.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {quickCash.map((eur) => (
            <PressableScale
              key={eur}
              accessibilityRole="button"
              accessibilityLabel={`${eur} Euro passend`}
              onPress={() => {
                selection()
                onChange(`${eur},00`)
              }}
              style={{ minHeight: t.touch.comfortable }}
              className="flex-1 items-center justify-center rounded-md border border-border bg-card px-3"
            >
              <Text className="font-mono-medium text-base">{eur} €</Text>
            </PressableScale>
          ))}
        </View>
      ) : null}

      <View className="gap-2">
        {KEYS.map((row, ri) => (
          <View key={ri} className="flex-row gap-2">
            {row.map((key) => {
              const isDelete = key === "⌫"
              return (
                <PressableScale
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isDelete
                      ? "Löschen"
                      : key === ","
                        ? "Komma"
                        : `${accessibilityLabelPrefix} ${key}`
                  }
                  onPress={() => press(key)}
                  style={{ minHeight: t.touch.comfortable + 8 }}
                  className="flex-1 items-center justify-center rounded-md border border-border bg-card"
                >
                  {isDelete ? (
                    <Delete size={t.icon.lg} color={t.colors.foreground} />
                  ) : (
                    <Text className="font-mono-medium text-xl">{key}</Text>
                  )}
                </PressableScale>
              )
            })}
          </View>
        ))}
      </View>
    </View>
  )
}
