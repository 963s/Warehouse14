/**
 * KeyboardAvoidingScreen — the shared keyboard-avoidance + scroll scaffold every
 * input-bearing owner surface sits in, so a focused field is never hidden behind
 * the keyboard and taps outside a field dismiss it the same way everywhere.
 *
 * It owns the boring, repeated native plumbing:
 *   • a `KeyboardAvoidingView` with the correct per-platform `behavior`
 *     ("padding" on iOS, "height" on Android) — the one combination that feels
 *     right across both,
 *   • an optional scrolling body with `keyboardShouldPersistTaps="handled"` and
 *     `keyboardDismissMode="interactive"` (iOS drag-to-dismiss),
 *   • safe-area aware top inset and bottom content inset via `useScreenInsets`,
 *     so content clears the notch and the home indicator without each screen
 *     re-deriving the maths.
 *
 * Use `scroll={false}` for a fixed, single-screen form (its own layout owns the
 * spacing); keep the default for the common scrolling case. A sticky footer
 * (e.g. a save bar) should be rendered OUTSIDE the scroll body — pass it via
 * `footer`, which sits below the scroll area and inside the keyboard-avoiding
 * frame, getting `stickyBottom` padding automatically.
 *
 * This is deliberately layout-only and theme-driven (`bg-background`); it adds
 * no business logic and no haptics. FormScreen and bespoke input screens both
 * compose it.
 *
 * `grain` (default true) drops the shared `PaperGrain` canvas behind the body so
 * an input-bearing owner surface carries the same aged-paper depth as every
 * scroll surface (DESIGN.md §1, §5) — never a flat fill. It is pure decoration
 * (pointer-events off, hidden from the a11y tree) and sits behind the content.
 */
import { type ReactNode } from "react"
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import { space } from "@/warehouse14/theme"

import { PaperGrain } from "../PaperGrain"
import { useScreenInsets } from "./useScreenInsets"

export interface KeyboardAvoidingScreenProps {
  children: ReactNode
  /**
   * Wrap children in a keyboard-aware ScrollView (default true). Set false for a
   * fixed, non-scrolling form that manages its own height.
   */
  scroll?: boolean
  /**
   * A pinned footer (e.g. a sticky save bar) rendered below the scroll body and
   * inside the keyboard-avoiding frame. It receives `stickyBottom` padding so it
   * sits off the home indicator.
   */
  footer?: ReactNode
  /** Inner padding for the scroll content / fixed body. Defaults to `space.x4`. */
  contentPadding?: number
  /** Extra style merged onto the scroll content container (scroll mode only). */
  contentContainerStyle?: StyleProp<ViewStyle>
  /** Pass-through ScrollView props for the scroll body (e.g. a RefreshControl). */
  scrollViewProps?: Omit<
    ScrollViewProps,
    "children" | "contentContainerStyle" | "keyboardShouldPersistTaps"
  >
  /**
   * Drop the aged-paper grain canvas behind the body (default true). The same
   * depth every scroll surface carries (DESIGN.md §1, §5); set false only where
   * the screen paints its own canvas.
   */
  grain?: boolean
}

export function KeyboardAvoidingScreen({
  children,
  scroll = true,
  footer,
  contentPadding = space.x4,
  contentContainerStyle,
  scrollViewProps,
  grain = true,
}: KeyboardAvoidingScreenProps): ReactNode {
  const insets = useScreenInsets()

  const body = scroll ? (
    <ScrollView
      className="flex-1"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      contentContainerStyle={[
        {
          padding: contentPadding,
          // When there is no sticky footer the body owns the bottom inset.
          paddingBottom: footer != null ? contentPadding : insets.contentBottom,
        },
        contentContainerStyle,
      ]}
      {...scrollViewProps}
    >
      {children}
    </ScrollView>
  ) : (
    <View className="flex-1" style={{ padding: contentPadding }}>
      {children}
    </View>
  )

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {grain ? <PaperGrain /> : null}
      {body}
      {footer != null ? (
        <View style={{ paddingBottom: insets.stickyBottom }}>{footer}</View>
      ) : null}
    </KeyboardAvoidingView>
  )
}
