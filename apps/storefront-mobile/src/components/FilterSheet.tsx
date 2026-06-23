/**
 * Filter + sort sheet. A modal overlay listing the category tree, the metal
 * facet, the stamp erhaltung facet, the MiNr range, and the sort options.
 *
 German throughout, no raw tokens. Gilt marks the active choice as a thread.
 */

import { useEffect, useState } from "react"
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native"
import { Check, X } from "lucide-react-native"

import { Button } from "./ui"
import { metalLabel, erhaltungLabel } from "../lib/german"
import { t } from "../lib/german"
import { palette } from "../theme/tokens"
import type { CatalogFilters } from "../lib/use-catalog"
import type { SortKey } from "../lib/use-catalog"
import type { StorefrontCategoryNode } from "../lib/types"

interface Props {
  visible: boolean
  onClose: () => void
  filters: CatalogFilters
  sort: SortKey
  categories: StorefrontCategoryNode[]
  onApply: (filters: CatalogFilters, sort: SortKey) => void
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "newest", label: t.sortNewest },
  { key: "priceAsc", label: t.sortPriceAsc },
  { key: "priceDesc", label: t.sortPriceDesc },
  { key: "year", label: t.sortYear },
]

const METAL_OPTIONS = Object.entries(metalLabel)
const ERHALTUNG_OPTIONS = Object.entries(erhaltungLabel)

/** Flatten the category tree into a {slug, name, depth} list for the picker. */
function flattenCategories(
  nodes: StorefrontCategoryNode[],
  depth = 0,
): { slug: string; name: string; depth: number }[] {
  const out: { slug: string; name: string; depth: number }[] = []
  for (const n of nodes) {
    out.push({ slug: n.slug, name: n.nameDe, depth })
    if (n.children.length) out.push(...flattenCategories(n.children, depth + 1))
  }
  return out
}

export function FilterSheet({
  visible,
  onClose,
  filters,
  sort,
  categories,
  onApply,
}: Props) {
  const [draftFilters, setDraftFilters] = useState<CatalogFilters>(filters)
  const [draftSort, setDraftSort] = useState<SortKey>(sort)

  // Resync the draft when the sheet opens.
  useEffect(() => {
    if (visible) {
      setDraftFilters(filters)
      setDraftSort(sort)
    }
  }, [visible, filters, sort])

  const flat = flattenCategories(categories)

  const apply = () => {
    onApply(draftFilters, draftSort)
    onClose()
  }

  const reset = () => {
    setDraftFilters({})
    setDraftSort("newest")
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(28,28,28,0.4)" }}>
        <View
          style={{
            backgroundColor: palette.card,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: "88%",
          }}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: palette.rule,
            }}
          >
            <Text
              style={{
                fontFamily: "BricolageGrotesque_600SemiBold",
                fontSize: 18,
                color: palette.ink,
              }}
            >
              {t.filter}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Schließen">
              <X size={22} color={palette.ink} />
            </Pressable>
          </View>

          <ScrollView style={{ padding: 16 }} showsVerticalScrollIndicator={false}>
            {/* Sort */}
            <SectionLabel label={t.sort} />
            <View style={{ gap: 4, marginBottom: 20 }}>
              {SORT_OPTIONS.map((o) => (
                <OptionRow
                  key={o.key}
                  label={o.label}
                  active={draftSort === o.key}
                  onPress={() => setDraftSort(o.key)}
                />
              ))}
            </View>

            {/* Category */}
            <SectionLabel label={t.category} />
            <View style={{ gap: 4, marginBottom: 20 }}>
              <OptionRow
                label={t.allCategories}
                active={!draftFilters.category}
                onPress={() => setDraftFilters((f) => ({ ...f, category: undefined }))}
              />
              {flat.map((c) => (
                <OptionRow
                  key={c.slug}
                  label={c.name}
                  indent={c.depth}
                  active={draftFilters.category === c.slug}
                  onPress={() => setDraftFilters((f) => ({ ...f, category: c.slug }))}
                />
              ))}
            </View>

            {/* Metal */}
            <SectionLabel label={t.metal} />
            <View style={{ gap: 4, marginBottom: 20 }}>
              <OptionRow
                label={t.allMetals}
                active={!draftFilters.metal}
                onPress={() => setDraftFilters((f) => ({ ...f, metal: undefined }))}
              />
              {METAL_OPTIONS.map(([key, label]) => (
                <OptionRow
                  key={key}
                  label={label}
                  active={draftFilters.metal === key}
                  onPress={() => setDraftFilters((f) => ({ ...f, metal: key }))}
                />
              ))}
            </View>

            {/* Erhaltung */}
            <SectionLabel label={t.erhaltung} />
            <View style={{ gap: 4, marginBottom: 20 }}>
              <OptionRow
                label={t.allCategories}
                active={!draftFilters.erhaltung}
                onPress={() =>
                  setDraftFilters((f) => ({ ...f, erhaltung: undefined }))
                }
              />
              {ERHALTUNG_OPTIONS.map(([key, label]) => (
                <OptionRow
                  key={key}
                  label={label}
                  active={draftFilters.erhaltung === (key as CatalogFilters["erhaltung"])}
                  onPress={() =>
                    setDraftFilters((f) => ({
                      ...f,
                      erhaltung: key as CatalogFilters["erhaltung"],
                    }))
                  }
                />
              ))}
            </View>

            {/* MiNr range */}
            <SectionLabel label={t.minr} />
            <View
              style={{
                flexDirection: "row",
                gap: 12,
                marginBottom: 24,
                alignItems: "center",
              }}
            >
              <LabeledInput
                label={t.minrFrom}
                value={draftFilters.minrVon?.toString() ?? ""}
                onChange={(v) =>
                  setDraftFilters((f) => ({
                    ...f,
                    minrVon: v ? Number(v) : undefined,
                  }))
                }
              />
              <LabeledInput
                label={t.minrTo}
                value={draftFilters.minrBis?.toString() ?? ""}
                onChange={(v) =>
                  setDraftFilters((f) => ({
                    ...f,
                    minrBis: v ? Number(v) : undefined,
                  }))
                }
              />
            </View>
          </ScrollView>

          {/* Footer actions */}
          <View
            style={{
              flexDirection: "row",
              gap: 12,
              padding: 16,
              borderTopWidth: 1,
              borderTopColor: palette.rule,
            }}
          >
            <View style={{ flex: 1 }}>
              <Button variant="outline" onPress={reset}>
                {t.reset}
              </Button>
            </View>
            <View style={{ flex: 2 }}>
              <Button onPress={apply}>{t.apply}</Button>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function SectionLabel({ label }: { label: string }) {
  return (
    <Text
      style={{
        fontFamily: "Inter_600SemiBold",
        fontSize: 12,
        letterSpacing: 1.4,
        textTransform: "uppercase",
        color: palette.inkFaded,
        marginBottom: 8,
      }}
    >
      {label}
    </Text>
  )
}

function OptionRow({
  label,
  active,
  onPress,
  indent = 0,
}: {
  label: string
  active: boolean
  onPress: () => void
  indent?: number
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 11,
        paddingLeft: indent * 16,
        paddingRight: 8,
        borderBottomWidth: 1,
        borderBottomColor: palette.rule,
      }}
    >
      <Text
        style={{
          fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
          fontSize: 15,
          color: active ? palette.ink : palette.inkAged,
        }}
      >
        {label}
      </Text>
      {active ? <Check size={18} color={palette.gilt} /> : null}
    </Pressable>
  )
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text
        style={{
          fontFamily: "Inter_400Regular",
          fontSize: 12,
          color: palette.inkFaded,
          marginBottom: 4,
        }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={(v) => onChange(v.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        style={{
          borderWidth: 1,
          borderColor: palette.rule,
          borderRadius: 8,
          paddingVertical: 10,
          paddingHorizontal: 12,
          fontFamily: "JetBrainsMono_400Regular",
          fontSize: 15,
          color: palette.ink,
          backgroundColor: palette.background,
        }}
        placeholder="0"
        placeholderTextColor={palette.inkFaded}
      />
    </View>
  )
}
