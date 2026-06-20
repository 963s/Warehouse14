/**
 * useReduceMotion — the single accessibility gate for the motion system.
 *
 * Wraps reanimated's `useReducedMotion()` (which reads the OS "reduce motion"
 * setting and updates reactively) behind a stable name. Every motion primitive
 * funnels through this so the degrade-to-opacity path is decided in exactly one
 * place. When it returns true, surfaces drop translate/scale/stagger and keep
 * only opacity cross-fades (DESIGN.md §6).
 */
import { useReducedMotion } from "react-native-reanimated"

/** True when the OS "reduce motion" accessibility setting is enabled. */
export function useReduceMotion(): boolean {
  return useReducedMotion()
}
