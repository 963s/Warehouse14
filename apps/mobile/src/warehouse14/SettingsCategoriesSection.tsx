/**
 * Sammlungen - the category-taxonomy admin section of Einstellungen.
 *
 * What it is: the storefront/inventory taxonomy (up to 3 levels per migration
 * 0063), LIVE from GET /api/categories. Each row shows the real node name, its
 * depth (indented), and its OWN productCount - every count is the server's, none
 * invented. ADMIN may add a root or child Sammlung, rename one, or delete one.
 *
 * Honesty + safety:
 *   • create/update/delete are ADMIN, NO step-up (operator-curated; no PII /
 *     fiscal / inventory side effect) - so this is a plain confirmed action, not
 *     a fiscal gate. The server remains the authority.
 *   • A delete that the FK refuses (a child or an assigned product references the
 *     node) returns a themed 409; we ALSO pre-check client-side and disable the
 *     delete with the honest reason, so the owner never taps into a dead end.
 *   • The 3-level cap is mirrored in the parent picker (a grandchild can't take
 *     children) for a friendly UI; the DB trigger is the real gate.
 *   • A non-ADMIN sees a calm read-only note.
 *
 * Spine only: SectionCard / Input / Button / Badge / InlineError / EmptyState /
 * Skeleton / PressableScale / haptics / useQuery / useMutation / theme tokens.
 * German throughout.
 */
import { useCallback, useMemo, useState } from "react"
import { ScrollView, View } from "react-native"
import { type CategoryNode } from "@warehouse14/api-client"
import {
  Check,
  ChevronRight,
  FolderTree,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { createCategory, categoryTree, deleteCategory, updateCategory } from "@/warehouse14/api"
import { useSession } from "@/warehouse14/session"
import {
  canDeleteCategory,
  countCategories,
  deleteBlockedReason,
  flattenCategoryTree,
  type FlatCategory,
  parentOptions,
  productCountLabel,
  validateCategoryName,
} from "@/warehouse14/settings-categories-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  EmptyState,
  InlineError,
  PressableScale,
  SectionCard,
  Skeleton,
  haptics,
  useMutation,
  useQuery,
} from "@/warehouse14/ui"

/** A 1px hairline divider. */
function RowDivider() {
  const t = useW14Theme()
  return <View style={{ height: 1, backgroundColor: t.colors.border }} />
}

// ── One node row (rename inline · confirm-delete) ───────────────────────────--

function CategoryRowItem({
  flat,
  canEdit,
  onChanged,
}: {
  flat: FlatCategory
  canEdit: boolean
  onChanged: () => void
}) {
  const t = useW14Theme()
  const { node, depth } = flat
  const [mode, setMode] = useState<"view" | "rename" | "confirmDelete">("view")
  const [draft, setDraft] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)

  const rename = useMutation(
    (vars: { id: string; nameDe: string }) => updateCategory(vars.id, { nameDe: vars.nameDe }),
    {
      onSuccess: () => {
        haptics.success()
        setMode("view")
        setFieldError(null)
        onChanged()
      },
    },
  )

  const remove = useMutation((id: string) => deleteCategory(id), {
    onSuccess: () => {
      haptics.success()
      setMode("view")
      onChanged()
    },
  })

  const beginRename = useCallback(() => {
    haptics.selection()
    setFieldError(null)
    rename.reset()
    setDraft(node.nameDe)
    setMode("rename")
  }, [node.nameDe, rename])

  const commitRename = useCallback(async () => {
    // Only the display name is editable here; the slug stays stable so existing
    // storefront URLs do not break. Validate the name (slug check is moot here).
    const v = validateCategoryName(draft, node.slug)
    if (!v.ok) {
      haptics.error()
      setFieldError(v.error)
      return
    }
    if (v.nameDe === node.nameDe) {
      setMode("view")
      return
    }
    try {
      await rename.mutate({ id: node.id, nameDe: v.nameDe })
    } catch {
      // rename.error renders the themed message in the InlineError.
    }
  }, [draft, node.slug, node.nameDe, node.id, rename])

  const deletable = canDeleteCategory(node)
  const blockReason = deleteBlockedReason(node)

  const indent = depth * 16

  if (mode === "rename") {
    return (
      <View className="gap-2 py-2.5" style={{ paddingLeft: indent }}>
        <Text className="text-muted-foreground text-2xs">
          {`Name ändern · Kurzname bleibt ${node.slug}"`}
        </Text>
        <View className="flex-row items-center gap-2">
          <Input
            value={draft}
            onChangeText={(v) => {
              setDraft(v)
              if (fieldError) setFieldError(null)
            }}
            autoFocus
            editable={!rename.isPending}
            maxLength={128}
            aria-invalid={!!fieldError}
            className="flex-1"
            style={fieldError ? { borderColor: t.colors.destructive } : undefined}
            accessibilityLabel={`${node.nameDe} umbenennen`}
          />
        </View>
        {fieldError != null ? (
          <Text className="text-xs" style={{ color: t.colors.destructive }}>
            {fieldError}
          </Text>
        ) : null}
        {rename.error != null ? <InlineError message={rename.error} /> : null}
        <View className="flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={rename.isPending}
            onPress={() => {
              haptics.selection()
              setMode("view")
              setFieldError(null)
              rename.reset()
            }}
            accessibilityLabel="Abbrechen"
          >
            <X size={t.icon.sm} color={t.colors.foreground} />
            <Text>Abbrechen</Text>
          </Button>
          <Button
            className="flex-1"
            disabled={rename.isPending}
            onPress={() => void commitRename()}
            accessibilityLabel="Namen speichern"
          >
            <Check size={t.icon.sm} color={t.colors.primaryForeground} />
            <Text>{rename.isPending ? "Speichern…" : "Speichern"}</Text>
          </Button>
        </View>
      </View>
    )
  }

  if (mode === "confirmDelete") {
    return (
      <View className="py-2.5" style={{ paddingLeft: indent }}>
        <Card className="gap-3 px-3.5 py-3" style={{ borderColor: t.colors.destructive }}>
          <Text className="text-sm font-semibold" style={{ color: t.colors.destructive }}>
            {`${node.nameDe}" löschen?`}
          </Text>
          <Text className="text-muted-foreground text-xs leading-5">
            Die Sammlung wird entfernt. Artikelzuordnungen müssen vorher gelöst sein.
          </Text>
          {remove.error != null ? <InlineError message={remove.error} /> : null}
          <View className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={remove.isPending}
              onPress={() => {
                haptics.selection()
                setMode("view")
                remove.reset()
              }}
              accessibilityLabel="Abbrechen"
            >
              <Text>Abbrechen</Text>
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={remove.isPending}
              onPress={() => {
                void remove.mutate(node.id).catch(() => {})
              }}
              accessibilityLabel={`${node.nameDe} jetzt löschen`}
            >
              <Text>{remove.isPending ? "Löschen…" : "Löschen"}</Text>
            </Button>
          </View>
        </Card>
      </View>
    )
  }

  return (
    <View
      className="min-h-[44px] flex-row items-center gap-2 py-2.5"
      style={{ paddingLeft: indent }}
    >
      {depth > 0 ? <ChevronRight size={t.icon.xs} color={t.colors.mutedForeground} /> : null}
      <View className="flex-1 gap-0.5">
        <Text className="text-base font-medium" numberOfLines={1}>
          {node.nameDe}
        </Text>
        <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
          {productCountLabel(node.productCount)} · {node.slug}
        </Text>
      </View>

      {node.hiddenFromStorefront ? (
        <Badge variant="outline">
          <Text>versteckt</Text>
        </Badge>
      ) : null}

      {canEdit ? (
        <View className="flex-row items-center gap-1">
          <PressableScale
            onPress={beginRename}
            accessibilityRole="button"
            accessibilityLabel={`${node.nameDe} umbenennen`}
            hitSlop={8}
          >
            <View className="h-9 w-9 items-center justify-center">
              <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} />
            </View>
          </PressableScale>
          <PressableScale
            onPress={
              deletable
                ? () => {
                    haptics.selection()
                    remove.reset()
                    setMode("confirmDelete")
                  }
                : () => haptics.error()
            }
            disabled={!deletable}
            accessibilityRole="button"
            accessibilityLabel={
              deletable ? `${node.nameDe} löschen` : `${node.nameDe} kann nicht gelöscht werden`
            }
            accessibilityHint={blockReason ?? undefined}
            hitSlop={8}
          >
            <View className="h-9 w-9 items-center justify-center">
              <Trash2
                size={t.icon.sm}
                color={deletable ? t.colors.destructive : t.colors.mutedForeground}
              />
            </View>
          </PressableScale>
        </View>
      ) : null}
    </View>
  )
}

// ── Create form (root or child) ─────────────────────────────────────────────--

function CreateCategoryForm({
  roots,
  onCreated,
  onCancel,
}: {
  roots: readonly CategoryNode[]
  onCreated: () => void
  onCancel: () => void
}) {
  const t = useW14Theme()
  const [name, setName] = useState("")
  const [parentId, setParentId] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const parents = useMemo(() => parentOptions(roots), [roots])

  const create = useMutation(
    (vars: { nameDe: string; slug: string; parentId: string | null }) =>
      createCategory({
        nameDe: vars.nameDe,
        slug: vars.slug,
        // A root Sammlung has no parent: OMIT the key rather than send `null`, so
        // the create succeeds against any server (the create-body schema only
        // started accepting an explicit null recently). A child sends its parent id.
        ...(vars.parentId != null ? { parentId: vars.parentId } : {}),
      }),
    {
      onSuccess: () => {
        haptics.success()
        onCreated()
      },
    },
  )

  const submit = useCallback(async () => {
    const v = validateCategoryName(name)
    if (!v.ok) {
      haptics.error()
      setFieldError(v.error)
      return
    }
    setFieldError(null)
    try {
      await create.mutate({ nameDe: v.nameDe, slug: v.slug, parentId })
    } catch {
      // create.error renders below.
    }
  }, [name, parentId, create])

  return (
    <Card className="gap-3 px-3.5 py-3.5">
      <Text className="text-sm font-semibold">Neue Sammlung</Text>

      <View className="gap-1.5">
        <Text className="text-sm font-medium">Name</Text>
        <Input
          value={name}
          onChangeText={(v) => {
            setName(v)
            if (fieldError) setFieldError(null)
          }}
          autoFocus
          editable={!create.isPending}
          maxLength={128}
          placeholder="z. B. Ringe"
          aria-invalid={!!fieldError}
          style={fieldError ? { borderColor: t.colors.destructive } : undefined}
          accessibilityLabel="Name der neuen Sammlung"
        />
        {fieldError != null ? (
          <Text className="text-xs" style={{ color: t.colors.destructive }}>
            {fieldError}
          </Text>
        ) : (
          <Text className="text-muted-foreground text-2xs">
            Der Kurzname (Slug) wird automatisch aus dem Namen gebildet.
          </Text>
        )}
      </View>

      {/* Parent picker - oberste Ebene" first, then each legal parent. */}
      <View className="gap-1.5">
        <Text className="text-sm font-medium">Übergeordnet</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
          keyboardShouldPersistTaps="handled"
        >
          <ParentChip
            label="Oberste Ebene"
            active={parentId === null}
            onPress={() => {
              haptics.selection()
              setParentId(null)
            }}
          />
          {parents.map((p) => (
            <ParentChip
              key={p.id}
              label={p.label.trim()}
              active={parentId === p.id}
              onPress={() => {
                haptics.selection()
                setParentId(p.id)
              }}
            />
          ))}
        </ScrollView>
      </View>

      {create.error != null ? <InlineError message={create.error} /> : null}

      <View className="flex-row gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={create.isPending}
          onPress={() => {
            haptics.selection()
            onCancel()
          }}
          accessibilityLabel="Abbrechen"
        >
          <Text>Abbrechen</Text>
        </Button>
        <Button
          className="flex-1"
          disabled={create.isPending}
          onPress={() => void submit()}
          accessibilityLabel="Sammlung anlegen"
        >
          <Plus size={t.icon.sm} color={t.colors.primaryForeground} />
          <Text>{create.isPending ? "Anlegen…" : "Anlegen"}</Text>
        </Button>
      </View>
    </Card>
  )
}

function ParentChip({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  const t = useW14Theme()
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View
        className="rounded-full border px-3 py-1.5"
        style={{
          borderColor: active ? t.colors.primary : t.colors.border,
          backgroundColor: active ? t.colors.raised : "transparent",
        }}
      >
        <Text
          className="text-xs font-medium"
          style={{ color: active ? t.colors.primary : t.colors.foreground }}
        >
          {label}
        </Text>
      </View>
    </PressableScale>
  )
}

// ── Section ─────────────────────────────────────────────────────────────────--

export function SettingsCategoriesSection() {
  const t = useW14Theme()
  const { actor } = useSession()
  const canEdit = actor?.role === "ADMIN"
  const [creating, setCreating] = useState(false)

  const q = useQuery(() => categoryTree(), { key: "settings:categories" })

  const flat = useMemo(() => (q.data != null ? flattenCategoryTree(q.data.roots) : []), [q.data])
  const total = useMemo(() => (q.data != null ? countCategories(q.data.roots) : 0), [q.data])

  const refetch = useCallback(() => void q.refetch(), [q])
  const onCreated = useCallback(() => {
    setCreating(false)
    refetch()
  }, [refetch])

  return (
    <SectionCard
      title="Sammlungen"
      subtitle="Die Kategorien deines Sortiments, bis zu drei Ebenen."
      icon={FolderTree}
      action={
        canEdit && !creating && q.data != null ? (
          <PressableScale
            onPress={() => {
              haptics.selection()
              setCreating(true)
            }}
            accessibilityRole="button"
            accessibilityLabel="Neue Sammlung"
            hitSlop={8}
          >
            <View className="flex-row items-center gap-1">
              <Plus size={t.icon.sm} color={t.colors.primary} />
              <Text className="text-primary text-xs font-medium">Neu</Text>
            </View>
          </PressableScale>
        ) : undefined
      }
    >
      {q.isLoading && q.data == null ? (
        <View className="gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <View key={i} className="flex-row items-center gap-3 py-1">
              <View className="flex-1 gap-2">
                <Skeleton width="48%" height={15} />
                <Skeleton width="30%" height={11} />
              </View>
            </View>
          ))}
        </View>
      ) : q.error != null && q.data == null ? (
        <InlineError message={q.error} onRetry={refetch} />
      ) : (
        <View className="gap-2">
          {!canEdit ? (
            <View
              className="flex-row items-start gap-2.5 rounded-xl px-3 py-2.5"
              style={{ backgroundColor: t.colors.raised }}
            >
              <View className="pt-0.5">
                <ShieldCheck size={t.icon.sm} color={t.colors.primary} />
              </View>
              <Text className="text-muted-foreground flex-1 text-xs leading-5">
                Sammlungen pflegt der Inhaber. Du siehst hier die aktuelle Struktur.
              </Text>
            </View>
          ) : null}

          {creating ? (
            <CreateCategoryForm
              roots={q.data?.roots ?? []}
              onCreated={onCreated}
              onCancel={() => setCreating(false)}
            />
          ) : null}

          {flat.length === 0 && !creating ? (
            <EmptyState
              icon={FolderTree}
              title="Noch keine Sammlungen"
              description={
                canEdit
                  ? "Lege deine erste Sammlung an, um dein Sortiment zu ordnen."
                  : "Es sind noch keine Sammlungen angelegt."
              }
              actionLabel={canEdit ? "Sammlung anlegen" : undefined}
              onAction={canEdit ? () => setCreating(true) : undefined}
            />
          ) : (
            <View>
              {flat.map((f, i) => (
                <View key={f.node.id}>
                  {i === 0 ? null : <RowDivider />}
                  <CategoryRowItem flat={f} canEdit={canEdit} onChanged={refetch} />
                </View>
              ))}
            </View>
          )}

          {flat.length > 0 ? (
            <View className="flex-row items-center gap-1.5">
              <Lock size={t.icon.xs} color={t.colors.mutedForeground} />
              <Text className="text-muted-foreground text-2xs">
                {total === 1 ? "1 Sammlung" : `${total.toLocaleString("de-DE")} Sammlungen`} ·
                Zuordnung von Artikeln erfolgt am Artikel.
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </SectionCard>
  )
}
