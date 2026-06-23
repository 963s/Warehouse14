/**
 * Font loading. All three families are self-hosted via expo-google-fonts (the
 * packages bundle the font files into the app, no CDN fetch at runtime, DSGVO).
 *
 *   Bricolage Grotesque = display / headings
 *   Inter = body
 *   JetBrains Mono = prices, quantities, tabular numerals
 */

import {
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
  JetBrainsMono_600SemiBold,
} from "@expo-google-fonts/jetbrains-mono"

export const fonts = {
  BricolageGrotesque_500Medium,
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
}

/** The named faces used across the app, keyed by the NativeWind font-family. */
export const fontMap = {
  "BricolageGrotesque_500Medium": BricolageGrotesque_500Medium,
  "BricolageGrotesque_600SemiBold": BricolageGrotesque_600SemiBold,
  "BricolageGrotesque_700Bold": BricolageGrotesque_700Bold,
  "Inter_400Regular": Inter_400Regular,
  "Inter_500Medium": Inter_500Medium,
  "Inter_600SemiBold": Inter_600SemiBold,
  "Inter_700Bold": Inter_700Bold,
  "JetBrainsMono_400Regular": JetBrainsMono_400Regular,
  "JetBrainsMono_500Medium": JetBrainsMono_500Medium,
  "JetBrainsMono_600SemiBold": JetBrainsMono_600SemiBold,
} as const
