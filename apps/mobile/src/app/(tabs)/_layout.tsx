/**
 * Bottom-tab shell, driven by the primary surface registry
 * (src/warehouse14/surfaces.ts). The Owner OS lands on the Schatzkammer.
 *
 * Adding a PRIMARY tab = one append in surfaces.ts + one route file here.
 * Adding a SECONDARY surface = one append in owner-surfaces.ts (the Mehr hub) —
 * the tab bar never changes.
 *
 * FORM (docs/DESIGN-SYSTEM.md): no boxes, no tinted pill behind the active tab.
 * The bar is a parchment leaf over the canvas, capped by a SINGLE warm hairline;
 * depth comes from that paper-step + the line, never from a heavy border or a
 * card. Active = ink, inactive = faint ink; the only gold is a short GILT SEAM
 * over the active tab — gilt as a thread/edge/seal, exactly as the law demands.
 * Light only — the app never follows the system dark scheme.
 */
import { type ComponentProps, type ReactNode } from "react"
import { Pressable, Text as RNText, View } from "react-native"
import { router, Tabs } from "expo-router"
import { AudioLines } from "lucide-react-native"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"

import { SURFACES } from "@/warehouse14/surfaces"
import { useW14Theme } from "@/warehouse14/theme"
import {
  duration,
  easing,
  Hairline,
  haptics,
  useReduceMotion,
  useScreenInsets,
} from "@/warehouse14/ui"

// Land on the Schatzkammer, not the (file-system default) index/Lager route.
export const unstable_settings = {
  initialRouteName: "dashboard",
}

// The props expo-router hands a custom `tabBar`. Derived from the Tabs component
// itself so we never import the (transitive, non-hoisted) bottom-tabs package
// directly — the type stays sound and resolvable from the app's module graph.
type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0]

// The gilt seam sits as a short centred thread over the active tab — gold only
// as an edge (DESIGN-SYSTEM.md §1). These are its dimensions.
const SEAM_WIDTH = 18
const SEAM_HEIGHT = 2

// ────────────────────────────────────────────────────────────────────────────
// TabSeam — the active gold thread. A short centred seam that fades + grows in
// on focus (curator curve), and away on blur. Reduce-motion jumps to the end.
// Decorative only; hidden from accessibility.
// ────────────────────────────────────────────────────────────────────────────

function TabSeam({ active, gilt }: { active: boolean; gilt: string }): ReactNode {
  const reduce = useReduceMotion()
  const progress = useSharedValue(active ? 1 : 0)
  progress.value = reduce
    ? active
      ? 1
      : 0
    : withTiming(active ? 1 : 0, {
        duration: active ? duration.base : duration.fast,
        easing: easing.standard,
      })

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scaleX: 0.55 + progress.value * 0.45 }],
  }))

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          height: SEAM_HEIGHT,
          width: SEAM_WIDTH,
          borderRadius: SEAM_HEIGHT / 2,
          backgroundColor: gilt,
        },
        style,
      ]}
    />
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TabButton — a BARE column: the gilt seam, the line icon (ink active / faint
// ink inactive, with a calm lift on focus), the German label. No pill, no box,
// no tinted chip — the active state is carried by ink weight + the gold thread.
// ────────────────────────────────────────────────────────────────────────────

function TabButton({
  icon: Icon,
  label,
  active,
  onPress,
}: {
  icon: (props: { color: string; size: number }) => ReactNode
  label: string
  active: boolean
  onPress: () => void
}): ReactNode {
  const t = useW14Theme()
  const reduce = useReduceMotion()
  const color = active ? t.colors.primary : t.colors.mutedForeground

  // The active icon lifts a hair and settles — one calm change (DESIGN-SYSTEM.md
  // §5), translate-only, dropped entirely under reduce-motion.
  const lift = useSharedValue(active ? 1 : 0)
  lift.value = reduce
    ? active
      ? 1
      : 0
    : withTiming(active ? 1 : 0, { duration: duration.fast, easing: easing.standard })
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -lift.value }],
  }))

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 6 }}
      hitSlop={6}
    >
      <View style={{ alignItems: "center", gap: 5, minHeight: t.touch.min, justifyContent: "center" }}>
        <View style={{ height: SEAM_HEIGHT, justifyContent: "center" }}>
          <TabSeam active={active} gilt={t.colors.gilt} />
        </View>
        <Animated.View style={iconStyle}>
          <Icon color={color} size={t.icon.lg} />
        </Animated.View>
        <RNText
          numberOfLines={1}
          allowFontScaling={false}
          style={{
            fontFamily: active ? t.fonts.semibold : t.fonts.medium,
            fontSize: 11,
            letterSpacing: 0.1,
            color,
          }}
        >
          {label}
        </RNText>
      </View>
    </Pressable>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// W14TabBar — the boxless parchment bar. One leaf of paper over the canvas, a
// single warm hairline as its only edge, the home-indicator inset honoured.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// VierzehnButton — the assistant's own seat in the bar (owner directive
// 2026-07-20: one tap from anywhere, no hunting through the Mehr hub). A calm
// ink medallion holding the voice glyph, sized like its neighbours' touch
// target; it PUSHES the full-screen /vierzehn stack surface instead of
// switching tabs, so the orb experience keeps the whole screen.
// ────────────────────────────────────────────────────────────────────────────

function VierzehnButton(): ReactNode {
  const t = useW14Theme()
  return (
    <Pressable
      onPress={() => {
        haptics.selection()
        router.push("/vierzehn")
      }}
      accessibilityRole="button"
      accessibilityLabel="Vierzehn Sprachassistent öffnen"
      style={{ flex: 1, alignItems: "center", paddingTop: 2 }}
      hitSlop={6}
    >
      {({ pressed }) => (
        <View style={{ alignItems: "center", gap: 3, opacity: pressed ? 0.82 : 1 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: t.colors.foreground,
              transform: [{ translateY: -6 }, ...(pressed ? [{ scale: 0.95 }] : [])],
              shadowColor: "#000",
              shadowOpacity: 0.18,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 3 },
              elevation: 4,
            }}
          >
            <AudioLines size={21} color={t.colors.card} strokeWidth={2.2} />
          </View>
          <RNText
            numberOfLines={1}
            allowFontScaling={false}
            style={{
              fontFamily: t.fonts.medium,
              fontSize: 11,
              letterSpacing: 0.1,
              color: t.colors.mutedForeground,
              transform: [{ translateY: -6 }],
            }}
          >
            Vierzehn
          </RNText>
        </View>
      )}
    </Pressable>
  )
}

function W14TabBar({ state, descriptors, navigation }: TabBarProps): ReactNode {
  const t = useW14Theme()
  const insets = useScreenInsets()

  // The assistant medallion sits mid-bar (after Lager, before Kunden) like a
  // centre seal; visible tabs render around it in registry order.
  const VIERZEHN_AT = 2

  return (
    <View style={{ backgroundColor: t.colors.card }}>
      {/* The single warm hairline — the bar's only edge, never a heavy border. */}
      <Hairline />
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          paddingTop: 8,
          // Sit clear of the home indicator; a small floor on devices without one.
          paddingBottom: Math.max(insets.raw.bottom, 10),
          paddingHorizontal: 8,
        }}
      >
        {(() => {
          let visibleIdx = 0
          return state.routes.flatMap((route, index) => {
          const { options } = descriptors[route.key]
          // Hidden surfaces (href:null) carry no tab button — keep them off the bar.
          if (options.tabBarButton != null) return []

          const active = state.index === index
          const label =
            typeof options.title === "string" && options.title.length > 0
              ? options.title
              : route.name

          const renderIcon =
            options.tabBarIcon != null
              ? (props: { color: string; size: number }) =>
                  options.tabBarIcon!({ ...props, focused: active })
              : () => null

          const onPress = () => {
            // A tab switch is a navigation tap → the same quiet selection haptic
            // every row/chip fires, so the most-touched control is not silent.
            haptics.selection()
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            })
            if (!active && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params)
            }
          }

          const pos = visibleIdx++
          const button = (
            <TabButton
              key={route.key}
              icon={renderIcon}
              label={label}
              active={active}
              onPress={onPress}
            />
          )
          // Seat the assistant medallion mid-bar, before this visible tab.
          return pos === VIERZEHN_AT ? [<VierzehnButton key="vierzehn" />, button] : [button]
          })
        })()}
      </View>
    </View>
  )
}

export default function TabsLayout() {
  const t = useW14Theme()

  return (
    <Tabs
      tabBar={(props) => <W14TabBar {...props} />}
      screenOptions={{
        // Parchment-2 header on the warm canvas; ink title in the display voice.
        headerStyle: { backgroundColor: t.colors.card },
        headerTintColor: t.colors.foreground,
        headerTitleStyle: { fontFamily: t.fonts.displaySemibold, color: t.colors.foreground },
        headerShadowVisible: false,
      }}
    >
      {SURFACES.map((s) => {
        const TabIcon = s.icon
        return (
          <Tabs.Screen
            key={s.name}
            name={s.name}
            options={{
              title: s.label,
              // Hidden surfaces stay mounted (deep-linkable) but show no tab button.
              href: s.hidden ? null : undefined,
              tabBarIcon: ({ color, size }) => <TabIcon color={color} size={size} strokeWidth={1.7} />,
            }}
          />
        )
      })}
    </Tabs>
  )
}
