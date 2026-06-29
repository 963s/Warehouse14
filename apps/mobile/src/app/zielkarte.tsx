/**
 * Zielkarte route — a deliberately TINY route module. expo-router evaluates every
 * route file synchronously at cold start in a release build; this one imports
 * nothing heavy, so it adds no depth to that startup require graph. The real
 * board (reanimated worklets + 15 react-native-svg instruments + the live data
 * layer) lives in goals/ZielkarteBoard and is pulled in LAZILY only when the
 * owner opens this screen — keeping the cold-start stack well under Hermes's
 * native limit. A calm dark canvas covers the brief lazy load.
 */
import { lazy, Suspense, type ReactNode } from "react"
import { View } from "react-native"

const ZielkarteBoard = lazy(() => import("@/warehouse14/goals/ZielkarteBoard"))

export default function ZielkarteScreen(): ReactNode {
  return (
    <Suspense fallback={<View style={{ flex: 1, backgroundColor: "#0c0b08" }} />}>
      <ZielkarteBoard />
    </Suspense>
  )
}
