/**
 * Warehouse14 Owner OS — motion system.
 *
 * The shared, reanimated-v4 (+ worklets) vocabulary EVERY surface moves with,
 * implementing docs/DESIGN-SYSTEM.md §5 exactly (curator ease
 * cubic-bezier(0.16,1,0.3,1); durations 180/420/650ms; stagger 70ms; calm
 * motion only — no glow, no bloom, no gaudy ripple). Reach for these and
 * nothing else so the whole app feels like one app. All animation runs on the
 * UI thread; every primitive honours the OS "reduce motion" setting via
 * `useReduceMotion`.
 *
 *   tokens          — durations (instant/fast/base/slow), named easings
 *                     (standard/curator, hover, exit), the one emphasis spring,
 *                     press + stagger constants.
 *   useReduceMotion — the single accessibility gate.
 *   transitions     — screen/list enter + exit builders for `entering`/`exiting`
 *                     props, plus the capped `staggerDelay`.
 *   nav-transitions — React Navigation route transition specs (modal present /
 *                     stack push) tuned to the curator curve.
 *   PressableScale  — the press-scale primitive (0.97 + opacity dip).
 *   Stagger / StaggerItem — list + section entrance cascade.
 *   CountUp         — honest number/money count-up (animates magnitude, formats
 *                     through the caller's de-DE formatter).
 *   GoldFlood       — the calm milestone veil (visual only; the haptics module
 *                     fires Heavy on peak).
 */
export {
  duration,
  easing,
  emphasisSpring,
  press,
  enterRise,
  stagger,
  timingStandard,
  timingHover,
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

export { modalPresent, stackPush, calmFade, iosModal } from "./nav-transitions"

export { PressableScale, type PressableScaleProps } from "./PressableScale"
export { Stagger, StaggerItem, type StaggerProps, type StaggerItemProps } from "./Stagger"
export { CountUp, type CountUpProps } from "./CountUp"
export { GoldFlood, type GoldFloodProps } from "./GoldFlood"
