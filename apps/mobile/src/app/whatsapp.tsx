/**
 * WhatsApp-Posteingang — die Owner-Fläche über den serverseitigen Nachrichten-
 * Eingang. Sie ist CLIENT-ONLY über die Server-Endpunkte: der Server besitzt den
 * Meta-Provider, den Nachrichten-Speicher und den Lebenszyklus jeder ausgehenden
 * Nachricht (queued → sent → delivered → read → failed). Diese Fläche zeigt nur,
 * was wirklich da ist, und löst nur Aktionen aus, die der Server akzeptieren wird.
 *
 * Aufbau:
 *   • Posteingang-Kopf — echte Summen aus echten Threads (ungelesene gesamt,
 *     Chats mit offenen Eingängen). Nichts da → ehrlicher leerer Zustand.
 *   • Threads — die Konversationen als Zeilen, ungelesene zuerst; eine Badge mit
 *     der echten ungelesenen Anzahl. Tippen öffnet den Chat.
 *   • Chat-Detail — der Nachrichten-Verlauf in Blasen (eingehend links,
 *     ausgehend rechts mit ehrlichem Status), der KI-/Mensch-Umschalter, das
 *     „als erledigt"-Markieren eingehender Nachrichten, die Kunden-Verknüpfung
 *     und der Sende-Verfasser mit ausdrücklicher Bestätigung (Step-up ist
 *     transparent über den globalen Host).
 *   • Neue Nachricht — an eine beliebige Nummer schreiben (gleicher Sende-Pfad,
 *     gleiche ausdrückliche Bestätigung).
 *
 * Ehrlichkeitsregel: jede Zahl ist eine echte Summe aus einer echten Antwort,
 * jeder Status ein echtes Feld vom Server. Eine Sendung ohne Meta-Zugang sagt
 * „in Warteschlange" — nie „gesendet". Ein Provider-Reject sagt ehrlich, dass
 * nichts rausging. Gebaut auf dem geteilten Spine (die UI-Primitive, das §6-
 * Motion- + §7-Haptik-Vokabular, nur W14-Theme-Tokens). Deutsche UI.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, View } from "react-native"
import type {
  WhatsAppMessage,
  WhatsAppSendResponse,
  WhatsAppThreadSummary,
} from "@warehouse14/api-client"
import {
  ArrowRight,
  Bot,
  CheckCheck,
  ChevronRight,
  Link2,
  MessageCircle,
  MessageSquarePlus,
  Search,
  Send,
  User,
  UserCheck,
  X,
} from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import {
  describeError,
  getWhatsappThread,
  linkWhatsappCustomer,
  listCustomers,
  listWhatsappThreads,
  markWhatsappHandled,
  sendWhatsapp,
  setWhatsappAiStatus,
} from "@/warehouse14/api"
import { relativeTime } from "@/warehouse14/notifications"
import { OfflineNotice, useSafeRetry } from "@/warehouse14/offline"
import { useW14Theme } from "@/warehouse14/theme"
import {
  countInbox,
  describeAiStatus,
  describeSend,
  formatPhone,
  type InboxCounts,
  normalizePhone,
  type SendMeta,
  sortThreads,
  statusLabel,
  statusVariant,
  threadDisplayName,
  validateSend,
} from "@/warehouse14/whatsapp-ui"
import {
  EmptyState,
  haptics,
  InlineError,
  PaperGrain,
  PressableScale,
  SectionCard,
  Skeleton,
  StaggerItem,
  useMutation,
  useQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

const DEBOUNCE_MS = 300
const CUSTOMER_SEARCH_LIMIT = 8

// ────────────────────────────────────────────────────────────────────────────
// Inbox header — the real unread/thread tallies
// ────────────────────────────────────────────────────────────────────────────

function InboxHeader({ counts }: { counts: InboxCounts }) {
  const t = useW14Theme()
  const tiles: { label: string; value: number; active: boolean; color: string }[] = [
    {
      label: "Ungelesen",
      value: counts.unreadTotal,
      active: counts.unreadTotal > 0,
      color: t.colors.primary,
    },
    {
      label: "Offene Chats",
      value: counts.unreadThreads,
      active: counts.unreadThreads > 0,
      color: t.colors.verdigris,
    },
    {
      label: "Konversationen",
      value: counts.threads,
      active: counts.threads > 0,
      color: t.colors.mutedForeground,
    },
  ]
  return (
    <View className="flex-row gap-2.5">
      {tiles.map((tile) => (
        <Card key={tile.label} className="flex-1 gap-1.5 px-3 py-3">
          <Text
            className="text-muted-foreground text-2xs font-medium uppercase"
            style={{ letterSpacing: 0.4 }}
            numberOfLines={1}
          >
            {tile.label}
          </Text>
          <Text
            className="font-mono-medium text-2xl"
            style={{ color: tile.active ? tile.color : t.colors.mutedForeground }}
          >
            {tile.value}
          </Text>
        </Card>
      ))}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// One conversation row
// ────────────────────────────────────────────────────────────────────────────

function ThreadRow({
  thread,
  onPress,
}: {
  thread: WhatsAppThreadSummary
  onPress: () => void
}) {
  const t = useW14Theme()
  const unread = thread.unreadCount > 0
  const name = threadDisplayName(thread)
  const fromCustomer = thread.linkedCustomerName != null
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Chat mit ${name}${
        unread ? `, ${thread.unreadCount} ungelesen` : ""
      }`}
    >
 <View className="flex-row items-center gap-3 hairline-b px-3 py-3">
        <View
          className="h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: t.colors.primary + (unread ? "29" : "14") }}
        >
          {fromCustomer ? (
            <User size={t.icon.md} color={t.colors.primary} />
          ) : (
            <MessageCircle size={t.icon.md} color={t.colors.primary} />
          )}
        </View>
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <Text
              className={unread ? "text-base font-semibold" : "text-base font-medium"}
              numberOfLines={1}
              style={{ flexShrink: 1 }}
            >
              {name}
            </Text>
            {fromCustomer ? (
              <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
                {formatPhone(thread.phone)}
              </Text>
            ) : null}
          </View>
          <Text
            className={
              unread
                ? "text-foreground text-sm leading-5"
                : "text-muted-foreground text-sm leading-5"
            }
            numberOfLines={1}
          >
            {thread.lastMessageDirection === "outbound" ? "Du: " : ""}
            {thread.lastMessagePreview}
          </Text>
        </View>
        <View className="items-end gap-1.5">
          <Text className="text-muted-foreground text-2xs">
            {relativeTime(thread.lastMessageAt)}
          </Text>
          {unread ? (
            <Badge variant="default">
              <Text>{thread.unreadCount}</Text>
            </Badge>
          ) : (
            <ChevronRight size={t.icon.sm} color={t.colors.mutedForeground} />
          )}
        </View>
      </View>
    </PressableScale>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// One message bubble
// ────────────────────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  onMarkHandled,
  handling,
}: {
  message: WhatsAppMessage
  onMarkHandled: () => void
  handling: boolean
}) {
  const t = useW14Theme()
  const outbound = message.direction === "outbound"
  const statusMeta = message.status
  return (
    <View className={outbound ? "items-end" : "items-start"}>
      <View
        className="max-w-[82%] gap-1 rounded-2xl px-3.5 py-2.5"
        style={{
          backgroundColor: outbound ? t.colors.raised : t.colors.card,
          borderWidth: outbound ? 0 : 1,
          borderColor: t.colors.border,
          borderBottomRightRadius: outbound ? 4 : 16,
          borderBottomLeftRadius: outbound ? 16 : 4,
        }}
      >
        <Text className="text-foreground text-sm leading-5">{message.body}</Text>
        <View className="flex-row items-center gap-2">
          <Text className="text-muted-foreground text-2xs">
            {relativeTime(message.timestamp)}
          </Text>
          {outbound && statusMeta != null ? (
            <Text
              className="text-2xs font-medium"
              style={{
                color:
                  statusMeta === "failed"
                    ? t.colors.destructive
                    : statusMeta === "read"
                      ? t.colors.verdigris
                      : t.colors.mutedForeground,
              }}
            >
              {statusLabel(statusMeta)}
            </Text>
          ) : null}
        </View>
      </View>
      {/* Inbound messages can be triaged as handled (honest: a real PATCH). */}
      {!outbound ? (
        message.handledAt != null ? (
          <View className="mt-1 flex-row items-center gap-1 pl-1">
            <CheckCheck size={t.icon.xs} color={t.colors.verdigris} />
            <Text className="text-muted-foreground text-2xs">
              erledigt {relativeTime(message.handledAt)}
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={onMarkHandled}
            disabled={handling}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Als erledigt markieren"
            className="mt-1 flex-row items-center gap-1 pl-1"
            style={{ opacity: handling ? 0.5 : 1 }}
          >
            <CheckCheck size={t.icon.xs} color={t.colors.mutedForeground} />
            <Text className="text-muted-foreground text-2xs">
              {handling ? "Wird markiert…" : "Als erledigt markieren"}
            </Text>
          </Pressable>
        )
      ) : null}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// The send-result banner (sent / queued — honest, never a faked "sent")
// ────────────────────────────────────────────────────────────────────────────

function SendBanner({ meta }: { meta: SendMeta }) {
  const t = useW14Theme()
  const color = meta.isLive ? t.colors.verdigris : t.colors.mutedForeground
  const Icon = meta.isLive ? CheckCheck : Send
  return (
    <View
      className="flex-row items-start gap-2.5 rounded-xl px-3.5 py-3"
      style={{ backgroundColor: color + "14" }}
      accessibilityRole="alert"
    >
      <View className="pt-0.5">
        <Icon size={t.icon.md} color={color} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-semibold" style={{ color }}>
          {meta.title}
        </Text>
        <Text className="text-muted-foreground text-xs leading-5">{meta.message}</Text>
      </View>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// The send composer + explicit confirm gate (shared by detail + new message)
// ────────────────────────────────────────────────────────────────────────────

function SendComposer({
  toPhone,
  /** When true the phone is fixed (a thread); when false the user types it. */
  phoneLocked,
  onPhoneChange,
  onSent,
}: {
  toPhone: string
  phoneLocked: boolean
  onPhoneChange?: (next: string) => void
  onSent: (res: WhatsAppSendResponse) => void
}) {
  const t = useW14Theme()
  const [body, setBody] = useState("")
  const [pending, setPending] = useState(false) // the explicit confirm gate
  const [touched, setTouched] = useState(false)

  const validation = useMemo(() => validateSend({ toPhone, body }), [toPhone, body])

  const sendM = useMutation(
    (vars: { toPhone: string; body: string }) =>
      sendWhatsapp({ toPhone: normalizePhone(vars.toPhone), body: vars.body.trim() }),
    {
      onSuccess: (res) => {
        if (!res) return
        const meta = describeSend(res)
        if (meta.isLive) haptics.success()
        else haptics.selection()
        setBody("")
        setTouched(false)
        onSent(res)
      },
      onError: () => haptics.error(),
    },
  )

  function requestSend() {
    setTouched(true)
    if (!validation.ok) {
      haptics.error()
      return
    }
    haptics.selection()
    setPending(true)
  }

  async function confirmSend() {
    haptics.impactLight()
    try {
      await sendM.mutate({ toPhone, body })
    } catch {
      // error surfaced via sendM.error (themed German); keep the composer open
    } finally {
      setPending(false)
    }
  }

  const showBodyError = touched && validation.bodyError != null
  const showPhoneError = touched && validation.phoneError != null

  return (
    <View className="gap-2.5">
      {/* Phone (only editable in the "new message" path) */}
      {!phoneLocked ? (
        <View className="gap-1.5">
          <Text className="text-sm font-medium">An (Telefonnummer)</Text>
          <Input
            value={toPhone}
            onChangeText={(next: string) => onPhoneChange?.(next)}
            placeholder="+49 …"
            keyboardType="phone-pad"
            autoCorrect={false}
            editable={!sendM.isPending}
            accessibilityLabel="Telefonnummer des Empfängers"
          />
          {showPhoneError ? (
            <Text className="text-destructive text-xs">{validation.phoneError}</Text>
          ) : null}
        </View>
      ) : null}

      {/* Body */}
      <View className="gap-1.5">
        <Input
          value={body}
          onChangeText={setBody}
          placeholder="Nachricht schreiben…"
          multiline
          editable={!sendM.isPending}
          className="h-auto min-h-[88px] py-3"
          style={{ textAlignVertical: "top" }}
          accessibilityLabel="Nachrichtentext"
        />
        {showBodyError ? (
          <Text className="text-destructive text-xs">{validation.bodyError}</Text>
        ) : null}
      </View>

      {sendM.error != null ? (
        <InlineError message={sendM.error} onDismiss={sendM.reset} />
      ) : null}

      {/* The explicit confirm gate a second press before the provider call.
          Step-up (403) is transparent via the global StepUpDialogHost. */}
      {pending ? (
        <View className="gap-2 rounded-xl border border-border bg-card p-3">
          <Text className="text-sm font-semibold">Nachricht senden?</Text>
          <Text className="text-muted-foreground text-xs leading-5">
            An {formatPhone(toPhone)}. Ist noch kein WhatsApp-Zugang hinterlegt, wird sie nur in
            die Warteschlange gelegt und noch nicht zugestellt.
          </Text>
          <View className="flex-row gap-2 pt-1">
            <Button
              className="flex-1"
              onPress={() => void confirmSend()}
              disabled={sendM.isPending}
              accessibilityLabel="Senden bestätigen"
            >
              <Send size={t.icon.sm} color={t.colors.primaryForeground} />
              <Text>{sendM.isPending ? "Wird gesendet…" : "Senden"}</Text>
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onPress={() => {
                haptics.selection()
                setPending(false)
              }}
              disabled={sendM.isPending}
              accessibilityLabel="Abbrechen"
            >
              <Text>Abbrechen</Text>
            </Button>
          </View>
        </View>
      ) : (
        <Button
          onPress={requestSend}
          disabled={sendM.isPending}
          accessibilityLabel="Nachricht senden"
        >
          <Send size={t.icon.sm} color={t.colors.primaryForeground} />
          <Text>Senden</Text>
        </Button>
      )}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Link-customer picker (search known customers, attach to the last inbound msg)
// ────────────────────────────────────────────────────────────────────────────

function LinkCustomerPicker({
  messageId,
  onLinked,
  onCancel,
}: {
  messageId: string
  onLinked: () => void
  onCancel: () => void
}) {
  const t = useW14Theme()
  const [q, setQ] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQ(q.trim()), DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q])

  const search = useQuery(
    () => listCustomers({ q: debouncedQ || undefined, limit: CUSTOMER_SEARCH_LIMIT }),
    { key: `whatsapp:link:${debouncedQ}`, enabled: debouncedQ.length > 0 },
  )

  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const link = useCallback(
    async (customerId: string) => {
      haptics.selection()
      setLinkingId(customerId)
      setError(null)
      try {
        await linkWhatsappCustomer(messageId, customerId)
        haptics.success()
        onLinked()
      } catch (e) {
        haptics.error()
        setError(describeError(e))
      } finally {
        setLinkingId(null)
      }
    },
    [messageId, onLinked],
  )

  return (
    <View className="gap-2.5 rounded-xl border border-border bg-card p-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold">Kunde verknüpfen</Text>
        <Pressable
          onPress={onCancel}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Verknüpfen abbrechen"
        >
          <X size={t.icon.sm} color={t.colors.mutedForeground} />
        </Pressable>
      </View>
      <View className="relative justify-center">
        <View className="absolute left-3 z-10">
          <Search size={t.icon.sm} color={t.colors.mutedForeground} />
        </View>
        <Input
          value={q}
          onChangeText={setQ}
          placeholder="Kunde suchen: Name, Nummer…"
          autoCorrect={false}
          className="pl-9"
          accessibilityLabel="Kunde zum Verknüpfen suchen"
        />
      </View>

      {error != null ? <InlineError message={error} onDismiss={() => setError(null)} /> : null}

      {debouncedQ.length === 0 ? (
        <Text className="text-muted-foreground text-xs leading-5">
          Gib einen Namen oder eine Nummer ein, um einen bestehenden Kunden zu finden.
        </Text>
      ) : search.status === "loading" && search.data == null ? (
        <View className="gap-2">
          <Skeleton width="70%" height={14} />
          <Skeleton width="55%" height={14} />
        </View>
      ) : search.error != null && search.data == null ? (
        <InlineError message={search.error} onRetry={() => void search.refetch()} />
      ) : search.data != null && search.data.items.length === 0 ? (
        <Text className="text-muted-foreground text-xs leading-5">
          Kein passender Kunde gefunden.
        </Text>
      ) : search.data != null ? (
        <View className="gap-1.5">
          {search.data.items.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => void link(c.id)}
              disabled={linkingId != null}
              accessibilityRole="button"
              accessibilityLabel={`${c.fullName} verknüpfen`}
              className="flex-row items-center gap-3 rounded-lg border border-border px-3 py-2.5"
              style={{ opacity: linkingId != null && linkingId !== c.id ? 0.5 : 1 }}
            >
              <UserCheck size={t.icon.sm} color={t.colors.primary} />
              <View className="flex-1">
                <Text className="text-sm font-medium" numberOfLines={1}>
                  {c.fullName}
                </Text>
                <Text className="text-muted-foreground text-2xs">{c.customerNumber}</Text>
              </View>
              {linkingId === c.id ? (
                <Text className="text-muted-foreground text-2xs">Wird verknüpft…</Text>
              ) : (
                <ArrowRight size={t.icon.sm} color={t.colors.mutedForeground} />
              )}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Chat detail sheet — messages, AI toggle, send, mark-handled, link
// ────────────────────────────────────────────────────────────────────────────

function ChatDetailSheet({
  phone,
  displayName,
  open,
  onOpenChange,
  onChanged,
}: {
  phone: string | null
  displayName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after any change so the thread list refetches. */
  onChanged: () => void
}) {
  const t = useW14Theme()

  const detail = useQuery(() => getWhatsappThread(phone as string), {
    key: phone ? `whatsapp:thread:${phone}` : undefined,
    enabled: open && phone != null,
    pollIntervalMs: open ? 15_000 : 0,
  })

  const [sendMeta, setSendMeta] = useState<SendMeta | null>(null)
  const [handlingId, setHandlingId] = useState<string | null>(null)
  const [handleError, setHandleError] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)

  useEffect(() => {
    if (open) {
      setSendMeta(null)
      setHandlingId(null)
      setHandleError(null)
      setLinking(false)
    }
  }, [open, phone])

  const aiM = useMutation(
    (vars: { aiActive: boolean }) => setWhatsappAiStatus(phone as string, vars.aiActive),
    {
      onSuccess: () => {
        haptics.success()
        void detail.refetch()
      },
      onError: () => haptics.error(),
    },
  )

  // Marking an inbound message „erledigt" is an IDEMPOTENT, NON-FISCAL admin write
  // (PATCH …/handled just stamps handled_at = now()). Route it through useSafeRetry
  // so a transport drop mid-tap doesn't lose the operator's triage: the policy
  // classifies it `safe`, and the moment the LAN returns the hook re-fires the
  // exact same PATCH on its own — repeating it lands the same end state. A real
  // server refusal (never fiscal here) is still surfaced, not retried. This is the
  // first real consumer of the offline safe-retry path.
  const handledM = useSafeRetry((messageId: string) => markWhatsappHandled(messageId), {
    request: { method: "PATCH", path: "/api/whatsapp/messages/:id/handled", idempotent: true },
    onSuccess: () => {
      haptics.success()
      void detail.refetch()
      onChanged()
    },
    onError: (e) => {
      haptics.error()
      setHandleError(describeError(e))
    },
    onSettled: () => setHandlingId(null),
  })

  const markHandled = useCallback(
    async (messageId: string) => {
      haptics.selection()
      setHandlingId(messageId)
      setHandleError(null)
      // mutate REJECTS on a real failure (onError already themed the message +
      // armed the auto-retry if the drop was transient); swallow so the tap's
      // promise doesn't bubble an unhandled rejection.
      await handledM.mutate(messageId).catch(() => {})
    },
    [handledM],
  )

  const data = detail.data
  const aiActive = data?.aiActive ?? false
  const aiMeta = describeAiStatus(aiActive)
  const messages = data?.messages ?? []
  const linkedName = data?.linkedCustomerName ?? null
  const linkedId = data?.linkedCustomerId ?? null

  // The most-recent inbound message is the link anchor (link-customer is keyed
  // to a message id; the newest inbound is the natural target).
  const lastInbound = useMemo(
    () => [...messages].reverse().find((m) => m.direction === "inbound") ?? null,
    [messages],
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (aiM.isPending) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="gap-4">
        {/* Keyboard avoidance: focusing the send composer lifts the sheet clear
            of the keyboard (padding on iOS, height on Android the spine's
            KeyboardAvoidingScreen behavior), so the Senden-Knopf stays reachable. */}
        <KeyboardAvoidingView
          className="gap-4"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <DialogHeader>
          <DialogTitle>{displayName}</DialogTitle>
          <DialogDescription>
            {linkedName != null
              ? `${formatPhone(phone ?? "")} · ${linkedName}`
              : formatPhone(phone ?? "")}
          </DialogDescription>
        </DialogHeader>

        <ScrollView
          className="max-h-[420px]"
          contentContainerStyle={{ gap: 12 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* AI / human toggle */}
          {data != null ? (
            <View className="flex-row items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
              <View
                className="h-8 w-8 items-center justify-center rounded-md"
                style={{
                  backgroundColor:
                    (aiActive ? t.colors.verdigris : t.colors.primary) + "1f",
                }}
              >
                {aiActive ? (
                  <Bot size={t.icon.sm} color={t.colors.verdigris} />
                ) : (
                  <User size={t.icon.sm} color={t.colors.primary} />
                )}
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold">{aiMeta.title}</Text>
                <Text className="text-muted-foreground text-2xs leading-4">{aiMeta.hint}</Text>
              </View>
              <Button
                variant="outline"
                size="sm"
                onPress={() => void aiM.mutate({ aiActive: !aiActive })}
                disabled={aiM.isPending}
                accessibilityLabel={aiMeta.toggleLabel}
              >
                <Text>{aiM.isPending ? "…" : aiMeta.toggleLabel}</Text>
              </Button>
            </View>
          ) : null}

          {aiM.error != null ? (
            <InlineError message={aiM.error} onDismiss={aiM.reset} />
          ) : null}

          {/* Messages */}
          {detail.status === "loading" && data == null ? (
            <View className="gap-3">
              <View className="items-start">
                <Skeleton width="70%" height={44} radius="card" />
              </View>
              <View className="items-end">
                <Skeleton width="55%" height={36} radius="card" />
              </View>
            </View>
          ) : detail.error != null && data == null ? (
            <InlineError message={detail.error} onRetry={() => void detail.refetch()} />
          ) : messages.length === 0 ? (
            <Text className="text-muted-foreground text-xs leading-5">
              Noch keine Nachricht in diesem Chat.
            </Text>
          ) : (
            <View className="gap-2.5">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  onMarkHandled={() => void markHandled(m.id)}
                  handling={handlingId === m.id}
                />
              ))}
            </View>
          )}

          {/* The triage-mark is being held to re-fire on reconnect (the wire
              dropped mid-tap): show the calm offline note with the honest auto-
              retry line NOT a red error, because nothing was lost. A real
              server refusal (no auto-retry) still shows the themed InlineError. */}
          {handledM.willAutoRetry ? (
            <OfflineNotice
              show
              message={"Die Markierung erledigt konnte gerade nicht gespeichert werden."}
              retryHint={handledM.retryHint}
            />
          ) : handleError != null ? (
            <InlineError message={handleError} onDismiss={() => setHandleError(null)} />
          ) : null}

          {/* Link customer only when not yet linked + there is an inbound anchor */}
          {data != null && linkedId == null && lastInbound != null ? (
            linking ? (
              <LinkCustomerPicker
                messageId={lastInbound.id}
                onLinked={() => {
                  setLinking(false)
                  void detail.refetch()
                  onChanged()
                }}
                onCancel={() => setLinking(false)}
              />
            ) : (
              <Button
                variant="outline"
                onPress={() => {
                  haptics.selection()
                  setLinking(true)
                }}
                accessibilityLabel="Kunde verknüpfen"
              >
                <Link2 size={t.icon.sm} color={t.colors.primary} />
                <Text>Kunde verknüpfen</Text>
              </Button>
            )
          ) : null}

          {/* Send result + composer */}
          {sendMeta != null ? <SendBanner meta={sendMeta} /> : null}
          {phone != null ? (
            <View className="gap-2 border-t border-border pt-3">
              <SendComposer
                toPhone={phone}
                phoneLocked
                onSent={(res) => {
                  setSendMeta(describeSend(res))
                  void detail.refetch()
                  onChanged()
                }}
              />
            </View>
          ) : null}
        </ScrollView>

        <Button
          variant="outline"
          size="xl"
          onPress={() => onOpenChange(false)}
          disabled={aiM.isPending}
          accessibilityLabel="Schließen"
        >
          <Text>Schließen</Text>
        </Button>
        </KeyboardAvoidingView>
      </DialogContent>
    </Dialog>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// New-message sheet (outbound to an arbitrary number)
// ────────────────────────────────────────────────────────────────────────────

function NewMessageSheet({
  open,
  onOpenChange,
  onSent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSent: () => void
}) {
  const [phone, setPhone] = useState("")
  const [sendMeta, setSendMeta] = useState<SendMeta | null>(null)

  useEffect(() => {
    if (open) {
      setPhone("")
      setSendMeta(null)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4">
        {/* Keyboard avoidance: focusing Nummer/Nachricht lifts the sheet clear of
            the keyboard (padding on iOS, height on Android), so Senden + Schließen
            stay reachable. */}
        <KeyboardAvoidingView
          className="gap-4"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <DialogHeader>
          <DialogTitle>Neue Nachricht</DialogTitle>
          <DialogDescription>
            An eine beliebige Nummer schreiben. Ohne WhatsApp-Zugang landet sie in der
            Warteschlange.
          </DialogDescription>
        </DialogHeader>

        {sendMeta != null ? <SendBanner meta={sendMeta} /> : null}

        <SendComposer
          toPhone={phone}
          phoneLocked={false}
          onPhoneChange={setPhone}
          onSent={(res) => {
            setSendMeta(describeSend(res))
            onSent()
          }}
        />

        <Button
          variant="outline"
          onPress={() => onOpenChange(false)}
          accessibilityLabel="Schließen"
        >
          <Text>Schließen</Text>
        </Button>
        </KeyboardAvoidingView>
      </DialogContent>
    </Dialog>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Screen
// ────────────────────────────────────────────────────────────────────────────

export default function WhatsAppScreen() {
  const t = useW14Theme()
  const insets = useScreenInsets()

  const threads = useQuery(listWhatsappThreads, {
    key: "whatsapp:threads",
    staleTimeMs: 5_000,
    pollIntervalMs: 30_000,
  })
  const rc = useRefreshControl(threads)

  const [openPhone, setOpenPhone] = useState<string | null>(null)
  const [openName, setOpenName] = useState("")
  const [newOpen, setNewOpen] = useState(false)

  const openThread = useCallback((th: WhatsAppThreadSummary) => {
    haptics.selection()
    setOpenPhone(th.phone)
    setOpenName(threadDisplayName(th))
  }, [])

  const sorted = useMemo(
    () => (threads.data ? sortThreads(threads.data.items) : []),
    [threads.data],
  )
  const counts = useMemo(
    () => (threads.data ? countInbox(threads.data.items) : null),
    [threads.data],
  )
  const hasThreads = sorted.length > 0

  return (
    <View className="flex-1 bg-background">
      {/* The aged-paper grain canvas depth from the layered cream plus this
          faint warm tooth, never a flat fill (DESIGN.md §1, §5). */}
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.contentBottom,
          gap: 20,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...rc} />}
      >
        {/* ── Posteingang-Kopf ─────────────────────────────────────────────── */}
        <View className="gap-3">
          <View className="flex-row items-center justify-between gap-2">
            <View className="flex-1 flex-row items-center gap-2">
              <MessageCircle size={t.icon.lg} color={t.colors.primary} />
              {/* Screen title in the Bricolage Grotesque display voice (DESIGN-SYSTEM.md §3). */}
              <Text
                className="flex-1 text-2xl font-display-semibold leading-tight"
                numberOfLines={1}
              >
                WhatsApp-Posteingang
              </Text>
            </View>
            <Button
              size="sm"
              onPress={() => {
                haptics.selection()
                setNewOpen(true)
              }}
              accessibilityLabel="Neue Nachricht schreiben"
            >
              <MessageSquarePlus size={t.icon.sm} color={t.colors.primaryForeground} />
              <Text>Neu</Text>
            </Button>
          </View>

          {threads.status === "loading" && threads.data == null ? (
            <View className="flex-row gap-2.5" accessibilityElementsHidden>
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="flex-1 gap-2 px-3 py-3">
                  <Skeleton width="60%" height={10} />
                  <Skeleton width="40%" height={24} />
                </Card>
              ))}
            </View>
          ) : threads.error != null && threads.data == null ? (
            <InlineError message={threads.error} onRetry={() => void threads.refetch()} />
          ) : counts != null ? (
            <InboxHeader counts={counts} />
          ) : null}
        </View>

        {/* ── Konversationen ───────────────────────────────────────────────── */}
        <View className="gap-3">
          {threads.status === "loading" && threads.data == null ? (
            <View className="gap-2.5" accessibilityElementsHidden>
              {Array.from({ length: 4 }).map((_, i) => (
 <View key={i} className="flex-row items-center gap-3 hairline-b px-3 py-3">
                  <Skeleton width={40} height={40} radius="full" />
                  <View className="flex-1 gap-2">
                    <Skeleton width="55%" height={14} />
                    <Skeleton width="75%" height={12} />
                  </View>
                  <Skeleton width={36} height={20} radius="button" />
                </View>
              ))}
            </View>
          ) : !hasThreads && threads.data != null ? (
            <EmptyState
              icon={MessageCircle}
              title="Noch keine Konversation"
              description="Eingehende WhatsApp-Nachrichten erscheinen hier. Oben rechts kannst du selbst eine neue Nachricht schreiben."
            />
          ) : (
            <View className="gap-2.5">
              {sorted.map((th, index) => (
                <StaggerItem key={th.phone} index={Math.min(index, 8)} exit={false}>
                  <ThreadRow thread={th} onPress={() => openThread(th)} />
                </StaggerItem>
              ))}
            </View>
          )}
        </View>

        {/* A calm honest note on scope: the AI assistant + provider live on the
            server; this surface reads + sends over those endpoints. */}
        <SectionCard
          title="So funktioniert der Posteingang"
          subtitle="Der WhatsApp-Zugang und der KI-Assistent laufen serverseitig."
          icon={Bot}
        >
          <Text className="text-muted-foreground text-xs leading-5">
            Eingehende Nachrichten werden serverseitig empfangen. Ist ein WhatsApp-Zugang
            verbunden, gehen deine Antworten direkt raus; ohne Zugang landen sie ehrlich in der
            Warteschlange, bis der Owner WhatsApp verbindet. Den KI-Assistenten kannst du je Chat
            an- oder ausschalten.
          </Text>
        </SectionCard>
      </ScrollView>

      <ChatDetailSheet
        phone={openPhone}
        displayName={openName}
        open={openPhone != null}
        onOpenChange={(next) => {
          if (!next) setOpenPhone(null)
        }}
        onChanged={() => void threads.refetch()}
      />

      <NewMessageSheet
        open={newOpen}
        onOpenChange={setNewOpen}
        onSent={() => void threads.refetch()}
      />
    </View>
  )
}
