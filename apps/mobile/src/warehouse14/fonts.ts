/**
 * Font map for the root layout. The Warehouse14 Owner OS speaks three voices:
 *
 *   • Cormorant Garamond — the antique DISPLAY serif. Screen titles, the hero
 *     KPI, section headlines: the elegant, aged-paper voice of the house.
 *   • Inter — all body and UI text. Calm, legible, neutral against the serif.
 *   • JetBrains Mono — tabular numerals (money, weights, SKUs, IDs) that must
 *     align in a column.
 *
 * Loaded together via expo-font's useFonts in the root layout. Each weight is a
 * DISTINCT named face — React Native cannot synthesise a true bold/semibold from
 * a single file, so every weight class binds to its own loaded face (see
 * global.css). Cormorant's display weights mirror Inter's so a heading can pick
 * the matching emphasis.
 */
import {
  CormorantGaramond_400Regular,
  CormorantGaramond_500Medium,
  CormorantGaramond_600SemiBold,
  CormorantGaramond_700Bold,
} from "@expo-google-fonts/cormorant-garamond"
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
  CormorantGaramond_400Regular,
  CormorantGaramond_500Medium,
  CormorantGaramond_600SemiBold,
  CormorantGaramond_700Bold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
}
