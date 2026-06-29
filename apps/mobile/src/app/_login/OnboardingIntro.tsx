/**
 * First-run intro — three calm, brand-forward slides shown once on the very
 * first cold open (gated by `onboarding.ts`) and re-openable from the login
 * screen. It introduces the language of the Owner OS, not its mechanics:
 *
 *   1. Die Schatzkammer — the dashboard as the heart of the app.
 *   2. Deine Flächen     — the four primary surfaces, at a glance.
 *   3. Ehrliche Zahlen   — the honesty principle (every number is real).
 *
 * It is a calm overlay rendered INSIDE the login surface (no route of its own),
 * so it touches nothing in the shared shell. Everything moves and feels via the
 * shared spine: the motion vocabulary (cross-fade + rise, reduce-motion aware),
 * the haptic vocabulary (one selection per advance, a single Heavy on the gold
 * landing), and the theme tokens (brass brand, verdigris positive, gold purely
 * decorative — never under text). Fully skippable, fast, never a wall.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { BackHandler, View } from "react-native"
import { Boxes, ScrollText, ShieldCheck, Users, Vault, type LucideIcon } from "lucide-react-native"
import Animated from "react-native-reanimated"

import { Text } from "@/components/ui/text"
import { markOnboardingSeen } from "@/warehouse14/onboarding"
import { useW14Theme } from "@/warehouse14/theme"
import {
  GoldFlood,
  PaperGrain,
  PressableScale,
  haptics,
  screenEnter,
  useReduceMotion,
  useScreenInsets,
} from "@/warehouse14/ui"

import { WarehouseMark } from "./WarehouseMark"

interface Slide {
  /** The leading icon of the slide's hero disc (brass — it carries meaning). */
  icon: LucideIcon
  /** A short tracked overline above the title. */
  overline: string
  title: string
  body: string
}

const SLIDES: readonly Slide[] = [
  {
    icon: Vault,
    overline: "Dein Tag",
    title: "Die Schatzkammer",
    body: "Dein Tag auf einen Blick die Tagesquest, deine Live-Kennzahlen und der Fortschritt. Hier startest du jeden Morgen.",
  },
  {
    icon: Boxes,
    overline: "Vier Flächen",
    title: "Alles an seinem Platz",
    body: "Schatzkammer, Lager, Kunden und Mehr. Vier ruhige Flächen führen dich durch den Betrieb der Rest wohnt aufgeräumt unter Mehr.",
  },
  {
    icon: ShieldCheck,
    overline: "Vertrauen",
    title: "Ehrliche Zahlen",
    body: "Jede Zahl, die du siehst, kommt live aus deinem Betrieb. Fehlt eine Quelle, bleibt das Feld leer oder gesperrt nie erfunden. Darauf kannst du dich verlassen.",
  },
] as const

/** The four primary surfaces, rendered as a calm preview row on slide two. */
const SURFACES_PREVIEW: readonly { icon: LucideIcon; label: string }[] = [
  { icon: Vault, label: "Schatzkammer" },
  { icon: Boxes, label: "Lager" },
  { icon: Users, label: "Kunden" },
  { icon: ScrollText, label: "Mehr" },
] as const

export interface OnboardingIntroProps {
  /** Called when the owner finishes or skips — the login screen takes over. */
  onDone: () => void
}

export function OnboardingIntro({ onDone }: OnboardingIntroProps): ReactNode {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const reduceMotion = useReduceMotion()
  const [index, setIndex] = useState(0)
  const [flood, setFlood] = useState(false)

  const last = index === SLIDES.length - 1
  const slide = SLIDES[index]
  const SlideIcon = slide.icon

  const finish = useCallback(() => {
    markOnboardingSeen()
    onDone()
  }, [onDone])

  const next = useCallback(() => {
    if (last) {
      // A single warm gold landing into the app — gold is decoration only, and
      // the Heavy haptic fires once on its peak (the spine's milestone pairing).
      haptics.selection()
      setFlood(true)
      return
    }
    haptics.selection()
    setIndex((i) => i + 1)
  }, [last])

  const skip = useCallback(() => {
    haptics.selection()
    finish()
  }, [finish])

  // Step one slide back (Android hardware back). On the first slide there is
  // nothing behind the intro, so back skips it — the calm, expected gesture.
  const back = useCallback(() => {
    if (flood) return
    haptics.selection()
    if (index === 0) {
      finish()
      return
    }
    setIndex((i) => i - 1)
  }, [flood, index, finish])

  // Android: the intro is a routeless overlay, so the hardware back button would
  // otherwise bubble to the router and try to leave the screen. Capture it here
  // and treat it as "one slide back" (skip from the first). iOS has no hardware
  // back, so this is a no-op there.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      back()
      return true
    })
    return () => sub.remove()
  }, [back])

  return (
    <View className="bg-background flex-1">
      {/* Aged-paper grain the warm canvas reads as paper, not a flat cream
          fill (DESIGN.md §1, §5). Full-bleed behind the padded content; pure
          decoration, never under text it must contrast against. */}
      <PaperGrain />

      <View
        className="flex-1"
        style={{
          paddingTop: insets.screen.top + t.space.x3,
          paddingBottom: insets.stickyBottom,
          paddingHorizontal: t.space.x6,
        }}
      >
        {/* Top bar the brand crest + a quiet skip. */}
        <View className="flex-row items-center justify-between">
          <WarehouseMark size="sm" />
          <PressableScale
            onPress={skip}
            accessibilityRole="button"
            accessibilityLabel="Einführung überspringen"
            hitSlop={t.space.x3}
            style={{
              minHeight: t.touch.min,
              justifyContent: "center",
              paddingHorizontal: t.space.x2,
            }}
          >
            <Text className="text-muted-foreground text-sm font-medium">Überspringen</Text>
          </PressableScale>
        </View>

        {/* The slide body cross-fades + rises on each advance (RM: opacity only).
          A centred column, width-capped so the copy never runs edge-to-edge, and
          the surface preview lives in a RESERVED slot so the hero+title sit at the
          same height on every slide (no jump between slides 1/2/3). */}
        <View className="flex-1 items-center justify-center">
          <Animated.View
            // Re-keying on `index` replays the spine's screen-enter per slide.
            key={index}
            entering={screenEnter(reduceMotion)}
            className="w-full items-center"
            style={{ maxWidth: 360, gap: t.space.x6 }}
          >
            <View
              className="bg-card border-border items-center justify-center rounded-full border"
              style={{ width: 104, height: 104 }}
            >
              <SlideIcon size={t.icon.xl + 10} color={t.colors.primary} strokeWidth={1.75} />
            </View>

            <View className="items-center" style={{ gap: t.space.x3 }}>
              <Text
                className="text-foreground text-xs font-medium"
                style={{ letterSpacing: 0.3 }}
              >
                {slide.overline}
              </Text>
              <Text className="text-foreground font-display-bold text-center text-4xl leading-tight">
                {slide.title}
              </Text>
              <Text className="text-muted-foreground text-center text-base leading-6">
                {slide.body}
              </Text>
            </View>

            {/* Reserved preview slot the four surfaces on slide two, an equal-
              height spacer otherwise, so the title block does not shift between
              slides. The preview itself is a calm, non-tappable row. */}
            <View className="w-full items-center justify-center" style={{ minHeight: 72 }}>
              {index === 1 ? (
                <View
                  className="flex-row flex-wrap items-start justify-center"
                  style={{ gap: t.space.x3 }}
                >
                  {SURFACES_PREVIEW.map((s) => {
                    const Icon = s.icon
                    return (
                      <View
                        key={s.label}
                        className="items-center"
                        style={{ width: 72, gap: t.space.x2 }}
                      >
                        <View
                          className="bg-card border-border items-center justify-center rounded-lg border"
                          style={{ width: 52, height: 52 }}
                        >
                          <Icon size={t.icon.lg} color={t.colors.primary} strokeWidth={1.75} />
                        </View>
                        <Text
                          className="text-muted-foreground text-2xs text-center"
                          numberOfLines={1}
                        >
                          {s.label}
                        </Text>
                      </View>
                    )
                  })}
                </View>
              ) : null}
            </View>
          </Animated.View>
        </View>

        {/* Footer page dots over the primary advance, on the spacing grid, as one
          non-growing block pinned above the home indicator. */}
        <View className="w-full items-center" style={{ gap: t.space.x6 }}>
          {/* Page dots the brass dot marks the active slide. */}
          <View className="flex-row items-center justify-center" style={{ gap: t.space.x2 }}>
            {SLIDES.map((s, i) => (
              <View
                key={s.title}
                className="rounded-full"
                style={{
                  width: i === index ? 22 : 7,
                  height: 7,
                  backgroundColor: i === index ? t.colors.primary : t.colors.mutedForeground,
                }}
              />
            ))}
          </View>

          {/* Primary advance brass fill, comfortable 48px money-grade target. */}
          <PressableScale
            onPress={next}
            accessibilityRole="button"
            accessibilityLabel={last ? "Loslegen und zur Anmeldung" : "Weiter zur nächsten Folie"}
            className="bg-primary w-full flex-row items-center justify-center rounded-md"
            style={{ height: t.touch.comfortable, maxWidth: 420 }}
          >
            <Text className="text-primary-foreground text-base font-semibold">
              {last ? "Loslegen" : "Weiter"}
            </Text>
          </PressableScale>
        </View>
      </View>

      {/* The one warm gold landing fires the single Heavy on its peak, then
          hands off to the login screen. Decorative only; never under text. */}
      <GoldFlood visible={flood} onReachPeak={() => haptics.impactHeavy()} onDone={finish} />
    </View>
  )
}
