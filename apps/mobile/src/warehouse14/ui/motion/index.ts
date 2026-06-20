/**
 * Warehouse14 Owner OS — motion system.
 *
 * The shared, reanimated-v4 (+ worklets) vocabulary EVERY surface moves with,
 * implementing DESIGN.md §6 exactly. Reach for these and nothing else so the
 * whole app feels like one app. All animation runs on the UI thread; every
 * primitive honours the OS "reduce motion" setting via `useReduceMotion`.
 *
 *   tokens          — durations (instant/fast/base/slow), named easings, the
 *                     one emphasis spring, press + stagger constants.
 *   useReduceMotion — the single accessibility gate.
 *   transitions     — screen/list enter + exit builders for `entering`/`exiting`
 *                     props, plus the capped `staggerDelay`.
 *   PressableScale  — the press-scale primitive (0.97 + opacity dip).
 *   Stagger / StaggerItem — list + section entrance cascade.
 *   CountUp         — honest number/money count-up (animates magnitude, formats
 *                     through the caller's de-DE formatter).
 *   GoldFlood       — the celebratory gold flood at break-even / milestones
 *                     (visual only; the haptics module fires Heavy on peak).
 */
export {
  duration,
  easing,
  emphasisSpring,
  press,
  enterRise,
  stagger,
  timingStandard,
  timingExit,
  type DurationToken,
} from "./tokens"

export { useReduceMotion } from "./useReduceMotion"

export {
  screenEnter,
  screenExit,
  itemEnter,
  itemExit,
  staggerDelay,
} from "./transitions"

export { PressableScale, type PressableScaleProps } from "./PressableScale"
export { Stagger, StaggerItem, type StaggerProps, type StaggerItemProps } from "./Stagger"
export { CountUp, type CountUpProps } from "./CountUp"
export { GoldFlood, type GoldFloodProps } from "./GoldFlood"
