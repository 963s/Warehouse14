/**
 * Belegtext-Vorlagen - the receipt-legal-text editor section of Einstellungen.
 *
 * What it is: the few legal texts that print on every Beleg (the header/footer,
 * the per-Steuerschlüssel clauses, the Ankauf declaration). The truth is LIVE
 * from GET /api/belegtext-templates (currentOnly) - each row shows the real
 * CURRENT body and the date it took effect, or an honest „Noch nicht hinterlegt"
 * when no version exists. No body is ever invented.
 *
 * Why it is gated like a money commit: publishing a new version
 * (POST /api/belegtext-templates) closes the previous CURRENT row and inserts a
 * new one in one TX, then audit-logs `belegtext.published`. The text it stores
 * prints on GoBD-relevant Belege, so it carries fiscal weight - therefore the
 * publish runs through the SHARED FiscalConfirmSheet: an explicit second press,
 * the fiscal weight made visible, Owner step-up transparent via the global
 * StepUpDialogHost. It NEVER auto-fires. A non-ADMIN sees a calm locked note
 * (the server enforces; the UI is honest about who may change it).
 *
 * Spine only: SectionCard / FormField chrome, the shared Input (multiline),
 * Button, Badge, InlineError, Skeleton, haptics, useQuery/useMutation, theme
 * tokens - no hardcoded hex. German throughout.
 */
import { useCallback, useMemo, useState } from "react"
import { View } from "react-native"
import { type BelegtextKind } from "@warehouse14/api-client"
import { Check, ChevronRight, FileText, Lock, Pencil, ShieldCheck, X } from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { listBelegtext, publishBelegtext } from "@/warehouse14/api"
import { FiscalConfirmSheet } from "@/warehouse14/sell/FiscalConfirmSheet"
import { useSession } from "@/warehouse14/session"
import {
  type BelegtextEditorRow,
  buildBelegtextRows,
  belegtextPreview,
  belegtextSinceLabel,
  validateBelegtextDraft,
} from "@/warehouse14/settings-belegtext-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  InlineError,
  PressableScale,
  SectionCard,
  Skeleton,
  haptics,
  useMutation,
  useQuery,
} from "@/warehouse14/ui"

/** A 1px hairline divider - the only divider weight on the surface. */
function RowDivider() {
  const t = useW14Theme()
  return <View style={{ height: 1, backgroundColor: t.colors.border }} />
}

/**
 * One editable Belegtext row. Collapsed: label · help · a one-line preview of
 * the live body (or „Noch nicht hinterlegt") · a „seit"-stamp · a chevron.
 * Expanded (ADMIN only): a multiline editor + „Veröffentlichen"/„Abbrechen".
 * Publishing opens the FiscalConfirmSheet - the explicit, fiscal-weight gate.
 */
function BelegtextRowItem({
  row,
  canEdit,
  onPublished,
}: {
  row: BelegtextEditorRow
  canEdit: boolean
  onPublished: () => void
}) {
  const t = useW14Theme()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const publish = useMutation((vars: { kind: BelegtextKind; bodyText: string }) =>
    publishBelegtext({ kind: vars.kind, bodyText: vars.bodyText }),
  )

  const since = belegtextSinceLabel(row.validFrom)
  const hasBody = row.body != null

  const beginEdit = useCallback(() => {
    haptics.selection()
    setFieldError(null)
    publish.reset()
    setDraft(row.body ?? "")
    setEditing(true)
  }, [row.body, publish])

  const cancelEdit = useCallback(() => {
    haptics.selection()
    setEditing(false)
    setFieldError(null)
    publish.reset()
  }, [publish])

  // First press: validate the draft, then OPEN the confirm sheet. The legal
  // write only happens on the SECOND, explicit press inside the sheet.
  const requestPublish = useCallback(() => {
    const v = validateBelegtextDraft(draft, row.body)
    if (!v.ok) {
      haptics.error()
      setFieldError(v.error)
      return
    }
    haptics.selection()
    setFieldError(null)
    setConfirmOpen(true)
  }, [draft, row.body])

  const doPublish = useCallback(async () => {
    const v = validateBelegtextDraft(draft, row.body)
    if (!v.ok) throw new Error(v.error ?? "Ungültiger Text.")
    await publish.mutate({ kind: row.kind, bodyText: v.value })
  }, [draft, row.body, row.kind, publish])

  const onConfirmed = useCallback(() => {
    setEditing(false)
    setFieldError(null)
    onPublished()
  }, [onPublished])

  if (!editing) {
    return (
      <PressableScale
        onPress={canEdit ? beginEdit : undefined}
        disabled={!canEdit}
        accessibilityRole={canEdit ? "button" : undefined}
        accessibilityLabel={canEdit ? `${row.label} bearbeiten` : `${row.label}, nur lesbar`}
      >
        <View className="min-h-[44px] flex-row items-center gap-3 py-2.5">
          <View className="flex-1 gap-0.5">
            <View className="flex-row items-center gap-2">
              <Text className="text-base font-medium" numberOfLines={1}>
                {row.label}
              </Text>
              {hasBody ? null : (
                <Badge variant="outline">
                  <Text>offen</Text>
                </Badge>
              )}
            </View>
            <Text className="text-muted-foreground text-xs" numberOfLines={2}>
              {belegtextPreview(row.body)}
            </Text>
            {since != null ? <Text className="text-muted-foreground text-2xs">{since}</Text> : null}
          </View>
          {canEdit ? (
            <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} />
          ) : (
            <Lock size={t.icon.sm} color={t.colors.mutedForeground} />
          )}
        </View>
      </PressableScale>
    )
  }

  return (
    <View className="gap-2 py-2.5">
      <View className="gap-0.5">
        <Text className="text-base font-medium">{row.label}</Text>
        {row.help.length > 0 ? (
          <Text className="text-muted-foreground text-xs">{row.help}</Text>
        ) : null}
      </View>

      <Input
        value={draft}
        onChangeText={(v) => {
          setDraft(v)
          if (fieldError) setFieldError(null)
        }}
        placeholder="Belegtext eingeben…"
        multiline
        editable={!publish.isPending}
        aria-invalid={!!fieldError}
        className="h-auto min-h-[120px] py-3"
        style={[
          { textAlignVertical: "top" },
          fieldError ? { borderColor: t.colors.destructive } : undefined,
        ]}
        accessibilityLabel={`${row.label} - Text`}
      />

      {fieldError != null ? (
        <Text className="text-xs" style={{ color: t.colors.destructive }}>
          {fieldError}
        </Text>
      ) : (
        <Text className="text-muted-foreground text-2xs">
          Veröffentlichen erzeugt eine neue Version und ersetzt die bisherige (protokolliert).
        </Text>
      )}

      {publish.error != null ? <InlineError message={publish.error} /> : null}

      <View className="flex-row gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={publish.isPending}
          onPress={cancelEdit}
          accessibilityLabel="Abbrechen"
        >
          <X size={t.icon.sm} color={t.colors.foreground} />
          <Text>Abbrechen</Text>
        </Button>
        <Button
          className="flex-1"
          disabled={publish.isPending}
          onPress={requestPublish}
          accessibilityLabel={`${row.label} veröffentlichen`}
        >
          <Check size={t.icon.sm} color={t.colors.primaryForeground} />
          <Text>Veröffentlichen</Text>
        </Button>
      </View>

      {/* The explicit, fiscal-weight gate. The legal write fires on the SECOND
          press inside the sheet; Owner step-up is transparent via the host. */}
      <FiscalConfirmSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={doPublish}
        onConfirmed={onConfirmed}
        title="Belegtext veröffentlichen"
        amountCaption="Vorlage"
        amountLabel={row.label}
        confirmLabel="Jetzt veröffentlichen"
        fiscalNote={
          "Dieser Text erscheint auf jedem Beleg dieser Steuerart und ist GoBD-relevant. " +
          "Die bisherige Version wird geschlossen und durch die neue ersetzt; der Vorgang " +
          "wird protokolliert."
        }
      >
        {/* A small preview of exactly what will be stored. */}
        <View className="gap-1 rounded-xl border border-border bg-card px-3.5 py-3">
          <Text className="text-muted-foreground text-2xs">Neuer Text</Text>
          <Text className="text-sm leading-5" numberOfLines={8}>
            {draft.trim()}
          </Text>
        </View>
      </FiscalConfirmSheet>
    </View>
  )
}

export function SettingsBelegtextSection() {
  const t = useW14Theme()
  const { actor } = useSession()
  const canEdit = actor?.role === "ADMIN"

  const q = useQuery(() => listBelegtext({ currentOnly: true }), {
    key: "settings:belegtext",
  })

  const rows = useMemo(() => (q.data != null ? buildBelegtextRows(q.data.items) : []), [q.data])

  const refetch = useCallback(() => void q.refetch(), [q])

  return (
    <SectionCard
      title="Belegtexte"
      subtitle="Die rechtlichen Texte auf jedem Beleg, pro Steuerart und Beleg-Rahmen."
      icon={FileText}
    >
      {q.isLoading && q.data == null ? (
        <View className="gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} className="gap-2 py-1">
              <Skeleton width="42%" height={15} />
              <Skeleton width="80%" height={12} />
            </View>
          ))}
        </View>
      ) : q.error != null && q.data == null ? (
        <InlineError message={q.error} onRetry={refetch} />
      ) : (
        <View>
          {!canEdit ? (
            <View
              className="mb-1 flex-row items-start gap-2.5 rounded-xl px-3 py-2.5"
              style={{ backgroundColor: t.colors.raised }}
            >
              <View className="pt-0.5">
                <ShieldCheck size={t.icon.sm} color={t.colors.primary} />
              </View>
              <Text className="text-muted-foreground flex-1 text-xs leading-5">
                Belegtexte ändert nur der Inhaber. Du siehst hier die aktuell gültigen Texte.
              </Text>
            </View>
          ) : null}

          {rows.map((row, i) => (
            <View key={row.kind}>
              {i === 0 ? null : <RowDivider />}
              <BelegtextRowItem row={row} canEdit={canEdit} onPublished={refetch} />
            </View>
          ))}

          {canEdit ? (
            <View className="flex-row items-center gap-1.5 pt-2">
              <Pencil size={t.icon.xs} color={t.colors.mutedForeground} />
              <Text className="text-muted-foreground text-2xs">
                Tippen zum Bearbeiten · Veröffentlichen ist PIN-bestätigt.
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </SectionCard>
  )
}
