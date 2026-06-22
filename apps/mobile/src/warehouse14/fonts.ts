/**
 * Font map for the root layout. The Warehouse14 Owner OS speaks three voices
 * (the OFFICIAL STORE design system):
 *
 *   • Bricolage Grotesque — the DISPLAY grotesque. Screen titles, the hero
 *     KPI, section headlines: the confident house display voice.
 *   • Inter — all body and UI text. Calm, legible, neutral against the display.
 *   • JetBrains Mono — tabular numerals (money, weights, SKUs, IDs) that must
 *     align in a column.
 *
 * Loaded together via expo-font's useFonts in the root layout. Each weight is a
 * DISTINCT named face — React Native cannot synthesise a true bold/semibold from
 * a single file, so every weight class binds to its own loaded face (see
 * global.css). The display weights mirror Inter's emphasis ladder.
 */
import {
  BricolageGrotesque_400Regular,
  BricolageGrotesque_500Medium,
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
} from "@expo-google-fonts/bricolage-grotesque"
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter"
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from "@expo-google-fonts/jetbrains-mono"

export const warehouse14Fonts = {
  BricolageGrotesque_400Regular,
  BricolageGrotesque_500Medium,
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
}
