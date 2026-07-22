/**
 * Anfragen — die Kundenpost, endlich gelesen und beantwortet.
 *
 * Bis 0097 war die Post des Hauses EINSEITIG: Reservierungsbriefe gingen raus,
 * und wer darauf antwortete, schrieb in ein Postfach, das niemand öffnete. Der
 * Eingangs-Sammler auf dem Server legt diese Antworten seither als Tickets ab —
 * diese Fläche ist die Seite, auf der jemand sie liest und beantwortet.
 *
 * Die Ordnung: wartende Anfragen zuerst, danach das zuletzt Gesagte zuerst.
 * Nicht nach Alter. Eine unbeantwortete Frage ist das Einzige hier, das gerade
 * laufend Vertrauen kostet; ein neueres Ticket mit bereits erteilter Antwort
 * wartet auf die Kundschaft, nicht auf uns.
 *
 * Ehrlichkeitsregel: nichts hier verschickt Post im Moment des Tippens. Eine
 * Antwort wird in denselben Postausgang gelegt, den die Reservierungsbriefe
 * nutzen, und geht mit dem nächsten Lauf des Zustellers raus — deshalb steht
 * dort „übernommen" und niemals „gesendet". Der Brief verlässt das Haus von
 * genau der Adresse, an die geschrieben wurde.
 *
 * Form (DESIGN-SYSTEM.md): keine Kästen in Kästen. Die Warteschlange lebt
 * boxlos auf dem warmen Papier, getrennt nur durch eine einzige Haarlinie;
 * Gold bleibt Faden, Kante, Siegel — nie eine Füllung.
 */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, View } from "react-native"
import Svg, { Circle, Path } from "react-native-svg"
import type { SupportTicketSummary, TicketStatus } from "@warehouse14/api-client"
import { Mail, MailOpen, RotateCcw, Send, ShieldCheck } from "lucide-react-native"

import { Button } from "@/components/ui/button"
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
  getSupportTicket,
  listSupportTickets,
  replySupportTicket,
  setSupportTicketStatus,
} from "@/warehouse14/api"
import { relativeTime } from "@/warehouse14/notifications"
import {
  bucketLabel,
  countTickets,
  replyAcceptedNote,
  sortTickets,
  statusLabel,
  statusShort,
  TICKET_BUCKETS,
  type TicketBucket,
  ticketPartyName,
  validateReply,
} from "@/warehouse14/support-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  EmptyState,
  Hairline,
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

// ────────────────────────────────────────────────────────────────────────────
// LetterSeal — ein bespoke Post-Siegel (react-native-svg): ein gestempelter
// Ring mit einer Briefklappe. Die Klappe (der Faden) tönt in Gilt, der Ring
// bleibt Tinte — Gold nur als Faden / Siegel, nie als Füllung (§1, §6).
// ────────────────────────────────────────────────────────────────────────────

function LetterSeal({ size = 26, ink, gilt }: { size?: number; ink: string; gilt: string }): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      <Circle cx="12" cy="12" r="10.2" stroke={ink} strokeWidth="1.1" opacity={0.6} />
      {/* Der Umschlag — Kante in Tinte. */}
      <Path
        d="M6.4 9.2h11.2v6.1H6.4z"
        stroke={ink}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Die Klappe — der eine Gilt-Faden. */}
      <Path
        d="M6.4 9.2 12 13.1l5.6-3.9"
        stroke={gilt}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TicketRow — eine nackte Zeile. Ticketnummer in Ziffern, Betreff in der
// Anzeige-Stimme, darunter die Kundschaft und wann zuletzt gesprochen wurde.
// ────────────────────────────────────────────────────────────────────────────

function TicketRow({
  ticket,
  onPress,
}: {
  ticket: SupportTicketSummary
  onPress: () => void
}): ReactNode {
  const t = useW14Theme()
  const spokeAt = ticket.lastInboundAt ?? ticket.lastOutboundAt ?? ticket.createdAt

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Anfrage ${ticket.ticketNumber} öffnen`}
    >
      <View className="flex-row items-center gap-3 py-3.5">
        <View className="h-9 w-9 items-center justify-center">
          {ticket.awaitingReply ? (
            <Mail size={t.icon.lg} color={t.colors.destructive} />
          ) : (
            <MailOpen size={t.icon.lg} color={t.colors.mutedForeground} />
          )}
        </View>
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text
              className="text-muted-foreground text-2xs font-semibold"
              style={{ letterSpacing: 0.8, fontVariant: ["tabular-nums"] }}
            >
              {ticket.ticketNumber}
            </Text>
            {ticket.awaitingReply ? (
              <Text className="text-destructive text-2xs font-semibold">wartet</Text>
            ) : null}
          </View>
          <Text className="font-display-semibold text-base leading-tight" numberOfLines={1}>
            {ticket.subject}
          </Text>
          <Text className="text-muted-foreground text-xs leading-5" numberOfLines={1}>
            {ticketPartyName(ticket)}
            {ticket.customerNumber != null ? ` · ${ticket.customerNumber}` : ""}
            {" · "}
            {statusShort(ticket.status)}
            {" · "}
            {relativeTime(spokeAt)}
          </Text>
        </View>
      </View>
    </PressableScale>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TicketSheet — der Verlauf und die Antwort.
// ────────────────────────────────────────────────────────────────────────────

function TicketSheet({
  ticketId,
  open,
  onOpenChange,
  onChanged,
}: {
  ticketId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Nach jeder Änderung, damit die Warteschlange neu lädt. */
  onChanged: () => void
}): ReactNode {
  const t = useW14Theme()

  const detail = useQuery(() => getSupportTicket(ticketId as string), {
    key: ticketId ? `support:ticket:${ticketId}` : undefined,
    enabled: open && ticketId != null,
    pollIntervalMs: open ? 20_000 : 0,
  })

  const [body, setBody] = useState("")
  const [touched, setTouched] = useState(false)
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const messagesRef = useRef<ScrollView>(null)

  useEffect(() => {
    if (open) {
      setBody("")
      setTouched(false)
      setPending(false)
      setNote(null)
    }
  }, [open, ticketId])

  const validation = validateReply(body)
  const showBodyError = touched && !validation.ok

  const replyM = useMutation((vars: { body: string }) => replySupportTicket(ticketId as string, vars.body), {
    onSuccess: (res) => {
      if (!res) return
      haptics.success()
      setBody("")
      setTouched(false)
      setPending(false)
      setNote(replyAcceptedNote(res.ticketNumber))
      void detail.refetch()
      onChanged()
    },
    onError: () => {
      haptics.error()
      setPending(false)
    },
  })

  const statusM = useMutation(
    (vars: { status: TicketStatus }) => setSupportTicketStatus(ticketId as string, vars.status),
    {
      onSuccess: () => {
        haptics.success()
        void detail.refetch()
        onChanged()
      },
      onError: () => haptics.error(),
    },
  )

  const arm = useCallback(() => {
    setTouched(true)
    if (!validateReply(body).ok) {
      haptics.error()
      return
    }
    haptics.selection()
    setNote(null)
    setPending(true)
  }, [body])

  const data = detail.data
  const messages = data?.messages ?? []
  const closed = data?.status === "GESCHLOSSEN"
  const busy = replyM.isPending || statusM.isPending
  const firstLoading = detail.status === "loading" && data == null

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (busy) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="gap-4">
        <KeyboardAvoidingView
          className="gap-4"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <DialogHeader>
            <DialogTitle>{data?.subject ?? "Anfrage"}</DialogTitle>
            <DialogDescription>
              {data != null
                ? `${data.ticketNumber} · ${statusLabel(data.status)}`
                : "Wird geladen …"}
            </DialogDescription>
          </DialogHeader>

          <ScrollView
            ref={messagesRef}
            className="max-h-[400px]"
            contentContainerStyle={{ gap: 14 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => messagesRef.current?.scrollToEnd({ animated: false })}
          >
            {firstLoading ? (
              <View className="gap-3" accessibilityElementsHidden>
                <Skeleton width="70%" height={14} />
                <Skeleton width="90%" height={14} />
                <Skeleton width="55%" height={14} />
              </View>
            ) : detail.error != null && data == null ? (
              <InlineError message={detail.error} onRetry={() => void detail.refetch()} />
            ) : (
              messages.map((m) => {
                const inbound = m.direction === "INBOUND"
                return (
                  <View key={m.id} className="gap-1">
                    <View className="flex-row items-center gap-2">
                      <View
                        style={{
                          height: 5,
                          width: 5,
                          borderRadius: 3,
                          backgroundColor: inbound ? t.colors.destructive : t.colors.gilt,
                        }}
                      />
                      <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
                        {inbound ? m.from : "Warehouse 14"}
                        {" · "}
                        {relativeTime(m.createdAt)}
                      </Text>
                    </View>
                    <Text className="text-sm leading-6">{m.body}</Text>
                  </View>
                )
              })
            )}
          </ScrollView>

          {/* ── Antwort ──────────────────────────────────────────────────── */}
          {data != null ? (
            <View className="gap-2.5">
              <Hairline />
              <Input
                value={body}
                onChangeText={(next: string) => {
                  setBody(next)
                  setNote(null)
                  if (pending) setPending(false)
                }}
                placeholder="Antwort schreiben…"
                multiline
                editable={!busy}
                className="h-auto min-h-[88px] py-3"
                style={{ textAlignVertical: "top" }}
                accessibilityLabel="Antworttext"
              />
              {showBodyError ? (
                <Text className="text-destructive text-xs">{validation.error}</Text>
              ) : null}

              {replyM.error != null ? (
                <InlineError message={replyM.error} onDismiss={replyM.reset} />
              ) : null}
              {statusM.error != null ? (
                <InlineError message={statusM.error} onDismiss={statusM.reset} />
              ) : null}

              {note != null ? (
                <View className="flex-row items-start gap-2">
                  <View
                    style={{
                      height: 5,
                      width: 5,
                      borderRadius: 3,
                      marginTop: 6,
                      backgroundColor: t.colors.verdigris,
                    }}
                  />
                  <Text className="flex-1 text-xs leading-5" style={{ color: t.colors.verdigris }}>
                    {note}
                  </Text>
                </View>
              ) : null}

              {/* Die ausdrückliche Bestätigung ein zweiter Druck, bevor ein
                  Brief in den Postausgang geht. Boxlos über einer Haarlinie. */}
              {pending ? (
                <View className="gap-2 pt-1">
                  <Hairline />
                  <View className="flex-row items-center gap-2 pt-1.5">
                    <View
                      style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: t.colors.gilt }}
                    />
                    <Text className="text-sm font-semibold">Antwort abschicken?</Text>
                  </View>
                  <Text className="text-muted-foreground text-xs leading-5">
                    Der Brief geht von genau der Adresse raus, an die geschrieben wurde. Er wird in
                    den Postausgang gelegt und mit dem nächsten Lauf zugestellt.
                  </Text>
                  <View className="flex-row gap-2 pt-1">
                    <Button
                      className="flex-1"
                      onPress={() => void replyM.mutate({ body: body.trim() })}
                      disabled={busy}
                      accessibilityLabel="Antwort bestätigen"
                    >
                      <Send size={t.icon.sm} color={t.colors.primaryForeground} />
                      <Text>{replyM.isPending ? "Wird übernommen…" : "Abschicken"}</Text>
                    </Button>
                    <Button
                      variant="outline"
                      onPress={() => setPending(false)}
                      disabled={busy}
                      accessibilityLabel="Antwort abbrechen"
                    >
                      <Text>Abbrechen</Text>
                    </Button>
                  </View>
                </View>
              ) : (
                <View className="flex-row gap-2">
                  <Button
                    className="flex-1"
                    onPress={arm}
                    disabled={busy}
                    accessibilityLabel="Antwort abschicken"
                  >
                    <Send size={t.icon.sm} color={t.colors.primaryForeground} />
                    <Text>Antworten</Text>
                  </Button>
                  <Button
                    variant="outline"
                    onPress={() => void statusM.mutate({ status: closed ? "OFFEN" : "GESCHLOSSEN" })}
                    disabled={busy}
                    accessibilityLabel={closed ? "Anfrage wieder öffnen" : "Anfrage schließen"}
                  >
                    <RotateCcw size={t.icon.sm} color={t.colors.foreground} />
                    <Text>{closed ? "Wieder öffnen" : "Schließen"}</Text>
                  </Button>
                </View>
              )}
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </DialogContent>
    </Dialog>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Die Fläche.
// ────────────────────────────────────────────────────────────────────────────

export default function AnfragenScreen() {
  const t = useW14Theme()
  const insets = useScreenInsets()

  const [bucket, setBucket] = useState<TicketBucket>("ALLE")
  const [openId, setOpenId] = useState<string | null>(null)

  const tickets = useQuery(() => listSupportTickets(bucket === "ALLE" ? undefined : bucket), {
    key: `support:tickets:${bucket}`,
    staleTimeMs: 10_000,
    pollIntervalMs: 60_000,
    // Beim Fachwechsel die vorherigen Zeilen stehen lassen, statt auf ein
    // Skelett zurückzufallen — der Filter fühlt sich sonst wie ein Neuladen an.
    keepPreviousData: true,
  })
  const rc = useRefreshControl(tickets)

  const sorted = useMemo(() => (tickets.data ? sortTickets(tickets.data) : []), [tickets.data])
  const counts = useMemo(() => (tickets.data ? countTickets(tickets.data) : null), [tickets.data])
  const hasTickets = sorted.length > 0
  const firstLoading = tickets.status === "loading" && tickets.data == null
  const hardError = tickets.error != null && tickets.data == null ? tickets.error : null

  const openTicket = useCallback((ticket: SupportTicketSummary) => {
    haptics.selection()
    setOpenId(ticket.id)
  }, [])

  return (
    <View className="flex-1 bg-background">
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.contentBottom,
          gap: 24,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...rc} />}
      >
        {/* ── Kopf ─────────────────────────────────────────────────────────── */}
        <View className="gap-4">
          <View className="gap-1.5">
            <View className="flex-row items-center gap-2">
              <View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }} />
              <Text
                className="text-muted-foreground text-2xs font-semibold"
                style={{ letterSpacing: 1.2 }}
              >
                KUNDENPOST
              </Text>
            </View>
            <View className="flex-row items-center gap-2.5">
              <LetterSeal size={26} ink={t.colors.primary} gilt={t.colors.gilt} />
              <Text className="flex-1 text-2xl font-display-semibold leading-tight" numberOfLines={1}>
                Anfragen
              </Text>
            </View>
          </View>

          {/* Kopf-Bilanz — echte Summen aus echten Zeilen, sonst gar nichts. */}
          {counts != null ? (
            <View className="gap-2">
              <Hairline />
              <View className="flex-row items-center gap-2 py-1">
                <View
                  style={{
                    height: 5,
                    width: 5,
                    borderRadius: 3,
                    backgroundColor: counts.awaiting > 0 ? t.colors.destructive : t.colors.verdigris,
                  }}
                />
                <Text className="flex-1 text-sm leading-5">
                  {counts.awaiting > 0
                    ? counts.awaiting === 1
                      ? "1 Anfrage wartet auf eine Antwort."
                      : `${counts.awaiting} Anfragen warten auf eine Antwort.`
                    : "Keine Anfrage wartet auf eine Antwort."}
                </Text>
              </View>
              <Hairline />
            </View>
          ) : null}

          {/* Fächer — nackte Marken, keine Kästen. */}
          <View className="flex-row flex-wrap gap-x-4 gap-y-2">
            {TICKET_BUCKETS.map((b) => {
              const active = bucket === b
              return (
                <Pressable
                  key={b}
                  onPress={() => {
                    haptics.selection()
                    setBucket(b)
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Fach ${bucketLabel(b)}`}
                >
                  <View className="gap-1">
                    <Text
                      className={active ? "text-sm font-semibold" : "text-muted-foreground text-sm"}
                    >
                      {bucketLabel(b)}
                    </Text>
                    <View
                      style={{
                        height: 1.5,
                        borderRadius: 1,
                        backgroundColor: active ? t.colors.gilt : "transparent",
                      }}
                    />
                  </View>
                </Pressable>
              )
            })}
          </View>
        </View>

        {hardError != null ? (
          <InlineError message={hardError} onRetry={() => void tickets.refetch()} />
        ) : (
          <View>
            {firstLoading ? (
              <View accessibilityElementsHidden>
                {Array.from({ length: 4 }).map((_, i) => (
                  <View key={i}>
                    {i > 0 ? <Hairline inset={48} /> : null}
                    <View className="flex-row items-center gap-3 py-3.5">
                      <Skeleton width={36} height={36} radius="full" />
                      <View className="flex-1 gap-2">
                        <Skeleton width="45%" height={12} />
                        <Skeleton width="75%" height={14} />
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : !hasTickets && tickets.data != null ? (
              <EmptyState
                icon={MailOpen}
                title="Keine Anfrage in diesem Fach"
                description="Antworten auf unsere Briefe erscheinen hier von selbst. Es muss niemand ein Postfach im Blick behalten."
              />
            ) : (
              <View>
                {sorted.map((ticket, index) => (
                  <StaggerItem key={ticket.id} index={Math.min(index, 8)} exit={false}>
                    {index > 0 ? <Hairline inset={48} /> : null}
                    <TicketRow ticket={ticket} onPress={() => openTicket(ticket)} />
                  </StaggerItem>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Die EINE bewusste Karte — eine Museums-Tafel über den Weg der Post. */}
        <SectionCard
          title="Woher diese Anfragen kommen"
          subtitle="Antworten der Kundschaft auf unsere Briefe, serverseitig eingesammelt."
          icon={ShieldCheck}
        >
          <Text className="text-muted-foreground text-xs leading-5">
            Schreibt jemand an eine unserer öffentlichen Adressen, legt der Server die Nachricht
            hier als Anfrage mit eigener Nummer ab. Deine Antwort verlässt das Haus von genau der
            Adresse, an die geschrieben wurde. Sie wird in den Postausgang gelegt und mit dem
            nächsten Lauf zugestellt — deshalb steht dort „übernommen" und nicht „gesendet".
          </Text>
        </SectionCard>
      </ScrollView>

      <TicketSheet
        ticketId={openId}
        open={openId != null}
        onOpenChange={(next) => {
          if (!next) setOpenId(null)
        }}
        onChanged={() => void tickets.refetch()}
      />
    </View>
  )
}
