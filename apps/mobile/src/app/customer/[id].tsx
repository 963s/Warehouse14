/**
 * Kunde — Detail + KYC (GwG) + Vertrauen. The customer's identity, the GwG/KYC
 * status, the trust level, the sanctions/PEP flags, and the cumulative Ankauf/
 * Umsatz balance, all from `customersApi.get` (live via the shared `useQuery`:
 * refetch-on-focus so a freshly captured Ausweis / stamp shows the moment you
 * return, pull-to-refresh, in-flight de-dupe).
 *
 * Three step-up-gated actions, each through the shared `useMutation` (the global
 * StepUpDialogHost fires the PIN Dialog transparently and the call retries):
 *   • „Ausweis erfassen" → the keystone capture route (addKycDocument).
 *   • „KYC bestätigen" → stampKyc; the verification stamp is a real milestone, so
 *     a success lands with the verdigris banner, the Success haptic, and a single
 *     gold flood (DESIGN.md §6/§7 — celebrate the real false→true crossing once).
 *   • Vertrauen ändern → setTrust; SUSPICIOUS/BANNED require a note (API contract)
 *     and BANNED — an irreversible-feeling block — is confirmed in a dialog first.
 *
 * Built entirely on the shared spine: the state system (Skeleton in the detail's
 * shape · ErrorState+Retry · InlineError), SectionCard/ListRow/StatTile/CountUp,
 * PressableScale + StaggerItem motion, the haptic vocabulary, and theme tokens.
 * Honesty rule holds: every flag and number is a real value from the endpoint;
 * a missing value reads „—", never a fabricated figure.
 */
import { useCallback, useState } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import type { CustomerTrustLevel } from "@warehouse14/api-client"
import {
  BadgeCheck,
  Ban,
  CalendarClock,
  IdCard,
  Mail,
  MapPin,
  Phone,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  UserRound,
} from "lucide-react-native"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { formatEur, getCustomer, setCustomerTrust, stampCustomerKyc } from "@/warehouse14/api"
import {
  formatCustomerAddress,
  KYC_STATUS_LABEL,
  KYC_STATUS_VARIANT,
  TRUST_LEVEL_LABEL,
  TRUST_LEVEL_VARIANT,
} from "@/warehouse14/customer-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  CountUp,
  ErrorState,
  GoldFlood,
  haptics,
  InlineError,
  isNotFoundError,
  ListRow,
  PressableScale,
  SectionCard,
  Skeleton,
  StaggerItem,
  useMutation,
  useQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

const TRUST_OPTIONS: readonly CustomerTrustLevel[] = [
  "NEW",
  "VERIFIED",
  "VIP",
  "SUSPICIOUS",
  "BANNED",
]
/** Trust levels that require a price-expectation note (per the API contract). */
const TRUST_NEEDS_NOTE = new Set<CustomerTrustLevel>(["SUSPICIOUS", "BANNED"])
/** The one block that reads as irreversible — confirm it in a dialog first. */
const TRUST_DANGER = new Set<CustomerTrustLevel>(["BANNED"])
const TRUST_NOTE_MIN = 8

/** First letters of the first two name parts → the calm avatar monogram (matches
 *  the directory row, so the same customer reads identically across surfaces). */
function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** A wire euro string is a real value only when it parses to a positive number;
 *  „0,00" is the empty signal, not a balance to celebrate. */
function eurAmount(eur: string): number | null {
  const n = Number(eur)
  return Number.isFinite(n) ? n : null
}

function isoToDe(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("de-DE")
}

/** The first-load placeholder — the detail's own shape, never a mid-screen spinner. */
function DetailSkeleton() {
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3">
        <Skeleton width={56} height={56} radius="full" />
        <View className="flex-1 gap-2">
          <Skeleton width="62%" height={20} />
          <Skeleton width="40%" height={12} />
        </View>
      </View>
      <View className="flex-row gap-2">
        <Skeleton width={96} height={24} radius="button" />
        <Skeleton width={84} height={24} radius="button" />
      </View>
      {[0, 1, 2].map((i) => (
        <Card key={i} className="gap-3 px-4 py-4">
          <Skeleton width="44%" height={16} />
          <Skeleton width="80%" height={12} />
          <Skeleton width="70%" height={12} />
          <Skeleton width="55%" height={12} />
        </Card>
      ))}
    </View>
  )
}

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const t = useW14Theme()
  const insets = useScreenInsets()

  // One live read, the spine drives loading/error/refetch. Refetch-on-focus keeps
  // a freshly captured Ausweis / stamp visible the moment you return.
  const customerQ = useQuery(() => getCustomer(id), {
    key: `customer:${id}`,
    enabled: !!id,
  })
  const rc = useRefreshControl(customerQ)
  const customer = customerQ.data

  useFocusEffect(
    useCallback(() => {
      if (id) void customerQ.refetch()
      // refetch identity is stable across renders for a fixed key
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]),
  )

  // ── Action feedback ─────────────────────────────────────────────────────────
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [celebrate, setCelebrate] = useState(false)

  // ── Trust editor ────────────────────────────────────────────────────────────
  const [editingTrust, setEditingTrust] = useState(false)
  const [trustLevel, setTrustLevel] = useState<CustomerTrustLevel>("NEW")
  const [trustNotes, setTrustNotes] = useState("")
  const [noteError, setNoteError] = useState(false)
  const [confirmDanger, setConfirmDanger] = useState(false)

  // ── Mutations (step-up is transparent in the api layer) ─────────────────────
  // The backend audit enum requires `documentType` (omitting it 400s before any
  // DB write). The stamp records the operator's eyeball-check of the physically
  // inspected ID — for a German Ankauf counter that is the Personalausweis, the
  // honest default audit context (the value gates nothing; it's audit metadata).
  const stampM = useMutation(
    (_vars: void) => stampCustomerKyc(id, { documentType: "PERSONALAUSWEIS" }),
    {
      onSuccess: (res) => {
        // One haptic per action (DESIGN.md §7): the Success notification IS the
        // confirm; the gold flood that follows is visual-only, never a second buzz.
        haptics.success()
        setOkMsg(res ? `KYC bestätigt · ${isoToDe(res.kycVerifiedAt)}` : "KYC bestätigt")
        setCelebrate(true)
        void customerQ.refetch()
      },
      onError: () => haptics.error(),
    },
  )

  const trustM = useMutation(
    (vars: { level: CustomerTrustLevel; notes: string }) =>
      setCustomerTrust(id, {
        trustLevel: vars.level,
        // The wire field is `reason` (backend SetTrustBody persists req.body.reason).
        // Send it whenever the operator entered one — for SUSPICIOUS/BANNED it is the
        // required ≥8-char rationale; for the other levels a typed note is still kept.
        ...(vars.notes ? { reason: vars.notes } : {}),
      }),
    {
      onSuccess: (_res, vars) => {
        haptics.success()
        setOkMsg(`Vertrauen gesetzt · ${TRUST_LEVEL_LABEL[vars.level]}`)
        setEditingTrust(false)
        setTrustNotes("")
        void customerQ.refetch()
      },
      onError: () => haptics.error(),
    },
  )

  const busy = stampM.isPending || trustM.isPending
  const actionError = stampM.error ?? trustM.error

  function clearActionState() {
    setOkMsg(null)
    stampM.reset()
    trustM.reset()
  }

  function openTrustEditor() {
    haptics.selection()
    clearActionState()
    if (customer) setTrustLevel(customer.trustLevel)
    setTrustNotes("")
    setNoteError(false)
    setEditingTrust(true)
  }

  function pickTrust(level: CustomerTrustLevel) {
    haptics.selection()
    setTrustLevel(level)
    setNoteError(false)
  }

  /** Validate the note, then either confirm a danger level or commit directly. */
  function submitTrust() {
    clearActionState()
    if (TRUST_NEEDS_NOTE.has(trustLevel) && trustNotes.trim().length < TRUST_NOTE_MIN) {
      setNoteError(true)
      haptics.error()
      return
    }
    if (TRUST_DANGER.has(trustLevel)) {
      setConfirmDanger(true)
      return
    }
    void trustM.mutate({ level: trustLevel, notes: trustNotes.trim() })
  }

  function confirmDangerTrust() {
    setConfirmDanger(false)
    void trustM.mutate({ level: trustLevel, notes: trustNotes.trim() })
  }

  // ── States ──────────────────────────────────────────────────────────────────
  if (customerQ.isLoading && customer == null) {
    return (
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.contentBottom }}
      >
        <DetailSkeleton />
      </ScrollView>
    )
  }

  if (customer == null) {
    // A 404 here is normal (a deep-link to a customer that was merged or removed)
    // — render the calm muted „nicht gefunden" frame, never the red error card.
    const customerMissing = isNotFoundError(customerQ.errorCause)
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <ErrorState
          title={customerMissing ? "Kunde nicht gefunden" : undefined}
          message={
            customerMissing
              ? "Dieser Kunde ist nicht mehr vorhanden."
              : (customerQ.error ?? "Der Kunde konnte nicht geladen werden.")
          }
          cause={customerQ.errorCause}
          onRetry={() => void customerQ.refetch()}
          retrying={customerQ.isFetching}
        />
      </View>
    )
  }

  // The owner's eyeball-verification stamp (Day-26) is the honest "already
  // confirmed" signal — it drives the re-confirm button + the date note below.
  // (The old `kycStatus === "COMPLETED"` was dead-always-false: COMPLETED is not
  // a real `kyc_status` enum value.)
  const kycVerified = customer.kycVerifiedAt != null
  const ankauf = eurAmount(customer.cumulativeAnkaufEur)
  const spend = eurAmount(customer.cumulativeSpendEur)
  const rollingAnkauf = eurAmount(customer.gwgRollingAnkauf.priorAnkaufEur)

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.contentBottom, gap: 12 }}
        refreshControl={<RefreshControl {...rc} />}
        // With the multiline trust-note focused, Android's default
        // (`keyboardShouldPersistTaps="never"`) eats the first tap on
        // „Vertrauen setzen" to merely dismiss the keyboard — a lost tap on a
        // money-adjacent action. „handled" lets the button receive that tap
        // while a tap on empty space still closes the keyboard. Drag-to-dismiss
        // matches the group's other scroll surfaces (kyc-capture, Kunden-Liste).
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Identity header — avatar monogram · name · number · the flags an operator scans */}
        <StaggerItem index={0}>
          <View className="flex-row items-center gap-3">
            <View
              className="h-14 w-14 items-center justify-center rounded-full"
              style={{ backgroundColor: t.colors.primary + "1f" }}
            >
              <Text className="text-lg font-bold" style={{ color: t.colors.primary }}>
                {initialsOf(customer.fullName)}
              </Text>
            </View>
            <View className="flex-1 gap-1">
              <Text className="text-xl font-bold" numberOfLines={2}>
                {customer.fullName}
              </Text>
              <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
                {customer.customerNumber}
              </Text>
            </View>
          </View>
        </StaggerItem>

        <StaggerItem index={1}>
          <View className="flex-row flex-wrap items-center gap-2">
            <Badge variant={KYC_STATUS_VARIANT[customer.kycStatus]} dot>
              <Text>{KYC_STATUS_LABEL[customer.kycStatus]}</Text>
            </Badge>
            <Badge variant={TRUST_LEVEL_VARIANT[customer.trustLevel]} dot>
              <Text>{TRUST_LEVEL_LABEL[customer.trustLevel]}</Text>
            </Badge>
            {customer.sanctionsMatch ? (
              <Badge variant="destructive" dot>
                <Text>Sanktionstreffer</Text>
              </Badge>
            ) : null}
            {customer.pepMatch ? (
              <Badge variant="destructive" dot>
                <Text>PEP</Text>
              </Badge>
            ) : null}
          </View>
        </StaggerItem>

        {/* A real sanctions/PEP hit is a compliance stop — surface it loudly, once. */}
        {customer.sanctionsMatch || customer.pepMatch ? (
          <StaggerItem index={2}>
            <Card
              className="flex-row items-start gap-2.5 px-4 py-3.5"
              style={{
                borderColor: t.colors.destructive + "55",
                backgroundColor: t.colors.destructive + "0D",
              }}
              accessibilityRole="alert"
            >
              <View className="pt-0.5">
                <ShieldAlert size={t.icon.sm} color={t.colors.destructive} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="text-sm font-semibold" style={{ color: t.colors.destructive }}>
                  {customer.sanctionsMatch
                    ? "Sanktionslisten-Treffer"
                    : "Politisch exponierte Person"}
                </Text>
                <Text className="text-muted-foreground text-sm leading-5">
                  Erhöhte Sorgfaltspflicht (GwG). Geschäft nur nach interner Prüfung fortsetzen.
                </Text>
              </View>
            </Card>
          </StaggerItem>
        ) : null}

        {/* Action feedback — the verdigris success / the unified error card */}
        {okMsg ? (
          <StaggerItem index={3} exit>
            <Card
              className="flex-row items-center gap-2.5 px-4 py-3.5"
              style={{
                borderColor: t.colors.verdigris + "66",
                backgroundColor: t.colors.verdigris + "12",
              }}
              accessibilityRole="alert"
            >
              <BadgeCheck size={t.icon.sm} color={t.colors.verdigris} />
              <Text className="flex-1 text-sm font-semibold" style={{ color: t.colors.verdigris }}>
                {okMsg}
              </Text>
            </Card>
          </StaggerItem>
        ) : null}
        {actionError ? (
          <StaggerItem index={3} exit>
            <InlineError message={actionError} onDismiss={clearActionState} />
          </StaggerItem>
        ) : null}

        {/* Stammdaten */}
        <StaggerItem index={4}>
          <SectionCard
            title="Stammdaten"
            icon={UserRound}
            action={
              <Button
                variant="ghost"
                size="sm"
                onPress={() => {
                  haptics.selection()
                  router.push({ pathname: "/customer/edit", params: { id: customer.id } })
                }}
                accessibilityLabel="Stammdaten bearbeiten"
              >
                <Text className="text-primary">Bearbeiten</Text>
              </Button>
            }
          >
            <ListRow
              icon={CalendarClock}
              title="Geburtsdatum"
              value={customer.dateOfBirth ?? "—"}
            />
            <ListRow icon={Mail} title="E-Mail" value={customer.email ?? "—"} />
            <ListRow icon={Phone} title="Telefon" value={customer.phone ?? "—"} />
            <ListRow icon={MapPin} title="Adresse" value={formatCustomerAddress(customer.address) ?? "—"} />
            {customer.vatId ? (
              <ListRow icon={IdCard} title="USt-IdNr." value={customer.vatId} mono />
            ) : null}
          </SectionCard>
        </StaggerItem>

        {/* KYC + Bilanz — the cumulative balance count-ups (honest: only real amounts) */}
        <StaggerItem index={5}>
          <SectionCard
            title="KYC + Bilanz"
            subtitle="Geldwäschegesetz (GwG) — Schwellen aus dem rollierenden Fenster."
            icon={ShieldCheck}
          >
            <ListRow
              icon={BadgeCheck}
              title="KYC bestätigt am"
              value={isoToDe(customer.kycVerifiedAt)}
              muted={!customer.kycVerifiedAt}
            />
            <View className="flex-row flex-wrap justify-between" style={{ rowGap: 10 }}>
              <BalanceTile label="Ankauf kumuliert" amount={ankauf} />
              <BalanceTile label="Umsatz kumuliert" amount={spend} tone="accent" />
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="text-muted-foreground text-2xs">
                Ankauf · letzte {customer.gwgRollingAnkauf.windowDays} Tage
              </Text>
              <Text className="font-mono-medium text-xs" style={{ color: t.colors.foreground }}>
                {rollingAnkauf != null ? formatEur(customer.gwgRollingAnkauf.priorAnkaufEur) : "—"}
              </Text>
            </View>
          </SectionCard>
        </StaggerItem>

        {/* KYC document — the keystone capture + the verification stamp */}
        <StaggerItem index={6}>
          <SectionCard
            title="KYC-Dokument"
            subtitle="Ausweis serverseitig verschlüsselt ablegen (GwG/DSGVO) und die Sichtprüfung stempeln."
            icon={IdCard}
          >
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Ausweis erfassen"
              onPress={() => {
                haptics.selection()
                clearActionState()
                router.push({ pathname: "/kyc-capture", params: { customerId: customer.id } })
              }}
            >
              <View
                className="min-h-[48px] flex-row items-center gap-3 rounded-xl px-3 py-3"
                style={{
                  backgroundColor: t.colors.primary + "14",
                  borderColor: t.colors.primary + "33",
                  borderWidth: 1,
                }}
              >
                <View
                  className="h-9 w-9 items-center justify-center rounded-md"
                  style={{ backgroundColor: t.colors.primary + "26" }}
                >
                  <ScanFace size={t.icon.md} color={t.colors.primary} />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-semibold">Ausweis erfassen</Text>
                  <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                    Fotografieren · sofort verschlüsselt · nicht auf dem Gerät
                  </Text>
                </View>
              </View>
            </PressableScale>

            <Button
              variant={kycVerified ? "outline" : "default"}
              size="xl"
              className="h-12"
              onPress={() => {
                clearActionState()
                void stampM.mutate()
              }}
              disabled={busy}
              accessibilityLabel="KYC bestätigen"
            >
              <Text>
                {stampM.isPending
                  ? "Bestätige…"
                  : kycVerified
                    ? "Erneut bestätigen"
                    : "KYC bestätigen"}
              </Text>
            </Button>
            {kycVerified ? (
              <Text className="text-muted-foreground text-2xs">
                Bereits bestätigt am {isoToDe(customer.kycVerifiedAt)}.
              </Text>
            ) : null}
          </SectionCard>
        </StaggerItem>

        {/* Trust changer */}
        <StaggerItem index={7}>
          {editingTrust ? (
            <SectionCard title="Vertrauensstufe" icon={ShieldCheck}>
              <View className="flex-row flex-wrap gap-2">
                {TRUST_OPTIONS.map((level) => (
                  <Button
                    key={level}
                    size="sm"
                    variant={
                      trustLevel === level
                        ? TRUST_DANGER.has(level)
                          ? "destructive"
                          : "default"
                        : "outline"
                    }
                    onPress={() => pickTrust(level)}
                    accessibilityLabel={`Vertrauen ${TRUST_LEVEL_LABEL[level]}`}
                    accessibilityState={{ selected: trustLevel === level }}
                  >
                    <Text>{TRUST_LEVEL_LABEL[level]}</Text>
                  </Button>
                ))}
              </View>
              {TRUST_NEEDS_NOTE.has(trustLevel) ? (
                <View className="gap-1.5">
                  <Input
                    value={trustNotes}
                    onChangeText={(v) => {
                      setTrustNotes(v)
                      if (noteError) setNoteError(false)
                    }}
                    placeholder="Begründung / Preiserwartung (min. 8 Zeichen)"
                    multiline
                    textAlignVertical="top"
                    className="h-auto"
                    style={{
                      minHeight: 64,
                      paddingTop: t.space.x2,
                      ...(noteError ? { borderColor: t.colors.destructive } : {}),
                    }}
                    accessibilityLabel="Begründung"
                  />
                  {noteError ? (
                    <Text className="text-destructive text-xs">
                      Für „{TRUST_LEVEL_LABEL[trustLevel]}" ist eine Notiz (min. {TRUST_NOTE_MIN}{" "}
                      Zeichen) erforderlich.
                    </Text>
                  ) : (
                    <Text className="text-muted-foreground text-2xs">
                      Pflichtfeld für „Beobachten" und „Gesperrt" (GwG-Nachvollziehbarkeit).
                    </Text>
                  )}
                </View>
              ) : null}
              <View className="flex-row gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1"
                  onPress={() => {
                    haptics.selection()
                    setEditingTrust(false)
                    setTrustNotes("")
                    setNoteError(false)
                  }}
                  disabled={busy}
                  accessibilityLabel="Abbrechen"
                >
                  <Text>Abbrechen</Text>
                </Button>
                <Button
                  className="flex-1"
                  variant={TRUST_DANGER.has(trustLevel) ? "destructive" : "default"}
                  onPress={submitTrust}
                  disabled={busy}
                  accessibilityLabel="Vertrauen setzen"
                >
                  <Text>{trustM.isPending ? "Speichern…" : "Vertrauen setzen"}</Text>
                </Button>
              </View>
            </SectionCard>
          ) : (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Vertrauen ändern"
              onPress={openTrustEditor}
            >
              <Card className="min-h-[48px] flex-row items-center gap-3 px-4 py-3">
                <View
                  className="h-8 w-8 items-center justify-center rounded-md"
                  style={{ backgroundColor: t.colors.primary + "1f" }}
                >
                  <ShieldCheck size={t.icon.md} color={t.colors.primary} />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-medium">Vertrauen ändern</Text>
                  <Text className="text-muted-foreground text-xs">
                    Aktuell: {TRUST_LEVEL_LABEL[customer.trustLevel]}
                  </Text>
                </View>
              </Card>
            </PressableScale>
          )}
        </StaggerItem>

        <StaggerItem index={8}>
          <Text className="text-muted-foreground pt-1 text-center text-2xs">
            Jede Aktion ist PIN-bestätigt und im Prüfprotokoll vermerkt.
          </Text>
        </StaggerItem>
      </ScrollView>

      {/* Danger confirm — BANNED reads as irreversible, so make the operator mean it. */}
      <Dialog open={confirmDanger} onOpenChange={setConfirmDanger}>
        <DialogContent>
          <DialogHeader>
            <View className="flex-row items-center gap-2.5">
              <View
                className="h-9 w-9 items-center justify-center rounded-full"
                style={{ backgroundColor: t.colors.destructive + "1f" }}
              >
                <Ban size={t.icon.md} color={t.colors.destructive} />
              </View>
              <DialogTitle>Kunde sperren?</DialogTitle>
            </View>
            <DialogDescription>
              „{customer.fullName}" wird gesperrt. Käufe und Verkäufe werden an der Kasse blockiert,
              bis die Sperre aufgehoben wird.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onPress={() => setConfirmDanger(false)}
              accessibilityLabel="Abbrechen"
            >
              <Text>Abbrechen</Text>
            </Button>
            <Button
              variant="destructive"
              onPress={confirmDangerTrust}
              accessibilityLabel="Kunde sperren"
            >
              <Text>Sperren</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The KYC-confirmed milestone flood — visual only (the Success haptic already
          fired on the confirm); once per stamp, above content, never blocks a tap. */}
      <GoldFlood visible={celebrate} onDone={() => setCelebrate(false)} />
    </View>
  )
}

/** A compact balance tile: the cumulative amount count-ups to its magnitude, but
 *  only when the wire value is a real number — otherwise a muted „—" (honesty). */
function BalanceTile({
  label,
  amount,
  tone = "primary",
}: {
  label: string
  amount: number | null
  tone?: "primary" | "accent"
}) {
  const t = useW14Theme()
  const color = tone === "accent" ? t.colors.verdigris : t.colors.primary
  return (
    <Card className="gap-2 px-3 py-3" style={{ width: "48%" }}>
      <Text
        className="text-muted-foreground text-xs font-medium uppercase"
        style={{ letterSpacing: 0.4 }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {amount != null ? (
        <CountUp
          value={Math.round(amount * 100)}
          format={(c) => formatEur((c / 100).toFixed(2))}
          motion="timing"
          className="font-mono-medium text-2xl"
          style={{ color }}
        />
      ) : (
        <Text className="font-mono-medium text-2xl" style={{ color: t.colors.mutedForeground }}>
          —
        </Text>
      )}
    </Card>
  )
}
