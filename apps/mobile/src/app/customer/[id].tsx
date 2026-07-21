/**
 * Kunde — Detail + KYC (GwG) + Vertrauen. Die Identität des Kunden, der GwG/KYC-
 * Status, die Vertrauensstufe, die Sanktions-/PEP-Flags und die kumulierte
 * Ankauf-/Umsatz-Bilanz, alles aus `customersApi.get` (live über das geteilte
 * `useQuery`: Refetch beim Fokus, damit ein frisch erfasster Ausweis oder Stempel
 * sofort beim Zurückkommen sichtbar ist, Ziehen zum Aktualisieren, In-Flight-
 * Entdoppelung).
 *
 * FORM (DESIGN-SYSTEM.md): keine Kästen in Kästen. Das Profil lebt direkt auf dem
 * warmen Papier — ein ruhiger Kopf mit Monogramm und ehrlichen Status-Fäden, dann
 * nackte beschriftete Reihen, getrennt nur durch eine einzige warme Haarlinie.
 * Tiefe kommt aus dem geschichteten Papier und der Linie, nie aus gestapelten
 * Karten. Gold erscheint nur als Faden / Kante / Siegel.
 *
 * Drei step-up-gesicherte Aktionen, je über das geteilte `useMutation` (der
 * globale StepUpDialogHost zeigt den PIN-Dialog transparent, der Aufruf wird
 * wiederholt):
 *   • Ausweis erfassen → die Schlüssel-Erfassungsroute (addKycDocument).
 *   • KYC bestätigen → stampKyc; der Prüfstempel ist ein echter Meilenstein, also
 *     landet ein Erfolg mit dem Verdigris-Faden, der Erfolgs-Haptik und einer
 *     einzelnen Gold-Flut (DESIGN-SYSTEM.md §5 — den echten false→true-Übergang
 *     einmal feiern).
 *   • Vertrauen ändern → setTrust; Beobachten/Gesperrt verlangen eine Notiz (API-
 *     Vertrag) und Gesperrt — eine unumkehrbar wirkende Sperre — wird zuerst in
 *     einem Dialog bestätigt.
 *
 * Ehrlichkeitsregel (absolut): jedes Flag und jede Zahl ist ein echter Wert aus
 * dem Endpunkt; ein fehlender Wert liest ein ruhiges Strich-Zeichen, nie eine
 * erfundene Zahl.
 */
import { type ReactNode, useCallback, useState } from "react"
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import type { CustomerTrustLevel } from "@warehouse14/api-client"
import Svg, { Circle, Path } from "react-native-svg"
import {
  Ban,
  Trash2,
  CalendarClock,
  IdCard,
  Mail,
  MapPin,
  Phone,
  ScanFace,
  ShieldAlert,
} from "lucide-react-native"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import {
  deleteCustomerKycDocuments,
  eraseCustomer,
  formatEur,
  getCustomer,
  getCustomerWebOrders,
  setCustomerTrust,
  stampCustomerKyc,
} from "@/warehouse14/api"
import {
  formatCustomerAddress,
  KYC_STATUS_LABEL,
  TRUST_LEVEL_LABEL,
} from "@/warehouse14/customer-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  CountUp,
  ErrorState,
  GoldFlood,
  Hairline,
  haptics,
  InlineError,
  isNotFoundError,
  PaperGrain,
  PressableScale,
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

/** A wire euro string is a real value only when it parses to a finite number;
 *  otherwise it is the empty signal, not a balance. */
function eurAmount(eur: string): number | null {
  const n = Number(eur)
  return Number.isFinite(n) ? n : null
}

function isoToDe(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("de-DE")
}

// ─────────────────────────────────────────────────────────────────────────────
// TrustSeal — ein bespoke Vertrauens-Siegel (react-native-svg). Ein gestempelter
// Ring mit einem Schild-Faden: die ruhige Marke des Kundenprofils. Der Schild-
// Faden tönt in Gilt, der Ring bleibt Tinte — Gold nur als Faden / Siegel.
// ─────────────────────────────────────────────────────────────────────────────

function TrustSeal({ size = 26, ink, gilt }: { size?: number; ink: string; gilt: string }): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      {/* Gestempelter Ring — die Siegel-Tinte. */}
      <Circle cx={12} cy={12} r={8.6} stroke={ink} strokeWidth={1.4} fill="none" />
      <Circle cx={12} cy={12} r={6.4} stroke={ink} strokeWidth={0.7} strokeOpacity={0.4} fill="none" />
      {/* Schild — der Gilt-Faden im Siegel (Gold nur als Faden). */}
      <Path
        d="M12 7.4 L15.2 8.6 L15.2 11.6 C15.2 13.8 13.8 15.4 12 16.2 C10.2 15.4 8.8 13.8 8.8 11.6 L8.8 8.6 Z"
        stroke={gilt}
        strokeWidth={1.3}
        strokeLinejoin="round"
        fill="none"
      />
      {/* Häkchen im Schild. */}
      <Path d="M10.4 11.6 L11.6 12.9 L13.8 10.3" stroke={gilt} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  )
}

/** Sprach-Etikett für ein Kunden-Sprachkürzel (DE-Klartext, nie das Kürzel). */
function languageLabel(code: string): string {
  switch (code) {
    case "de":
      return "Deutsch"
    case "en":
      return "Englisch"
    case "ar":
      return "Arabisch"
    default:
      return "—"
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// StatusFaden — ein Status als ruhiger Faden (Punkt + Text), kein Pillen-Kasten.
// Der getönte Punkt trägt die Bedeutung; der Text bleibt Tinte. Gold/Funktions-
// farben nur als Punkt (Faden), nie als Fläche.
// ─────────────────────────────────────────────────────────────────────────────

function StatusThread({ label, dot }: { label: string; dot: string }) {
  const t = useW14Theme()
  return (
    <View className="flex-row items-center gap-1.5">
      <View style={{ height: 6, width: 6, borderRadius: 3, backgroundColor: dot }} />
      <Text
        className="text-xs font-medium"
        style={{ color: t.colors.inkAged, letterSpacing: 0.2 }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FieldRow — eine NACKTE beschriftete Reihe auf dem Papier (kein Kasten, kein
// Chip). Leitsymbol bare in Tinte, eine leise Beschriftung, der echte Wert (mono
// für Nummern). Ein fehlender Wert liest ehrlich „—" und wird gedämpft.
// ─────────────────────────────────────────────────────────────────────────────

function FieldRow({
  icon: Icon,
  label,
  value,
  mono = false,
  muted = false,
}: {
  icon: (props: { size: number; color: string }) => ReactNode
  label: string
  value: string
  mono?: boolean
  muted?: boolean
}) {
  const t = useW14Theme()
  return (
    <View className="min-h-[44px] flex-row items-center gap-3 py-2.5">
      <View className="h-7 w-7 items-center justify-center">
        <Icon size={t.icon.md} color={muted ? t.colors.mutedForeground : t.colors.foreground} />
      </View>
      <Text className="text-muted-foreground flex-1 text-sm" numberOfLines={1}>
        {label}
      </Text>
      <Text
        className={mono ? "font-mono-medium text-sm" : "text-sm font-medium"}
        style={{ color: muted ? t.colors.mutedForeground : t.colors.foreground, maxWidth: "58%" }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  )
}

/** Eine ruhige Gruppen-Überschrift (Kicker), boxlos: ein Gilt-Punkt + eine kleine
 *  Versalien-Zeile über einer warmen Haarlinie. Das öffnet jede Sektion. */
function GroupKicker({ label }: { label: string }) {
  const t = useW14Theme()
  return (
    <View className="gap-2 pb-1">
      <View className="flex-row items-center gap-2">
        <View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }} />
        <Text
          className="text-muted-foreground text-2xs font-semibold"
          style={{ letterSpacing: 1.2 }}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
      <Hairline />
    </View>
  )
}

/** The first-load placeholder — the detail's own shape, boxless, never a spinner. */
function DetailSkeleton() {
  return (
    <View className="gap-6">
      <View className="flex-row items-center gap-3">
        <Skeleton width={56} height={56} radius="full" />
        <View className="flex-1 gap-2">
          <Skeleton width="62%" height={22} />
          <Skeleton width="40%" height={12} />
        </View>
      </View>
      <View className="flex-row gap-4">
        <Skeleton width={96} height={14} />
        <Skeleton width="84%" height={14} />
      </View>
      {[0, 1].map((g) => (
        <View key={g} className="gap-2">
          <Skeleton width="34%" height={10} />
          <Skeleton width="100%" height={1} />
          {[0, 1, 2].map((i) => (
            <View key={i} className="flex-row items-center gap-3 py-2.5">
              <Skeleton width={28} height={28} radius="card" />
              <Skeleton width="40%" height={12} />
              <View className="flex-1" />
              <Skeleton width="28%" height={12} />
            </View>
          ))}
        </View>
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

  // Web-shop orders (Inhaber-Direktive 2026-07-20): the customer's reservations
  // and completed orders with number, items and totals — the full shop history
  // next to the POS balance. Same focus-refetch rhythm as the identity read.
  const ordersQ = useQuery(() => getCustomerWebOrders(id), {
    key: `customer-orders:${id}`,
    enabled: !!id,
  })
  const webOrders = ordersQ.data?.items ?? []

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
  const [confirmErase, setConfirmErase] = useState(false)

  // ── Mutations (step-up is transparent in the api layer) ─────────────────────
  // The backend audit enum requires `documentType` (omitting it 400s before any
  // DB write). The stamp records the operator's eyeball-check of the physically
  // inspected ID — for a German Ankauf counter that is the Personalausweis, the
  // honest default audit context (the value gates nothing; it's audit metadata).
  const stampM = useMutation(
    (_vars: void) => stampCustomerKyc(id, { documentType: "PERSONALAUSWEIS" }),
    {
      onSuccess: (res, _vars, queuedOffline) => {
        void customerQ.refetch()
        if (queuedOffline) {
          // The write only reached the offline outbox — the server has NOT
          // recorded the GwG check. No „bestätigt", no flood; an honest queued
          // note + the calm selection tick, not the success notification.
          haptics.selection()
          setOkMsg("Bestätigung in der Warteschlange, wird gesendet sobald wieder Verbindung besteht.")
          return
        }
        // One haptic per action (DESIGN-SYSTEM.md §5): the Success notification IS
        // the confirm; the gold flood that follows is visual-only, never a second buzz.
        haptics.success()
        setOkMsg(res ? `KYC bestätigt am ${isoToDe(res.kycVerifiedAt)}` : "KYC bestätigt")
        setCelebrate(true)
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
      onSuccess: (_res, vars, queuedOffline) => {
        setEditingTrust(false)
        setTrustNotes("")
        void customerQ.refetch()
        if (queuedOffline) {
          // A compliance-relevant trust change (Gesperrt/Beobachten gates the
          // Kasse) only outboxed — do not assert it is live.
          haptics.selection()
          setOkMsg(
            `Vertrauensänderung in der Warteschlange, wird gesendet sobald wieder Verbindung besteht.`,
          )
          return
        }
        haptics.success()
        setOkMsg(`Vertrauen gesetzt auf ${TRUST_LEVEL_LABEL[vars.level]}`)
      },
      onError: () => haptics.error(),
    },
  )

  // DSGVO Art.17 erasure — step-up transparent (the route requires it). On success
  // the customer is anonymized; there is nothing left to show, so leave the screen.
  const eraseM = useMutation((_vars: void) => eraseCustomer(id), {
    onSuccess: () => {
      haptics.success()
      router.back()
    },
    onError: () => haptics.error(),
  })

  // Ausweis löschen (C4) — purge the saved ID so a fresh one can be captured
  // (delete, then „Ausweis erfassen" = replace). Step-up transparent; on success
  // refetch so the KYC status updates in place.
  const deleteKycM = useMutation((_vars: void) => deleteCustomerKycDocuments(id), {
    onSuccess: () => {
      haptics.success()
      setOkMsg("Ausweis gelöscht")
      void customerQ.refetch()
    },
    onError: () => haptics.error(),
  })

  const busy = stampM.isPending || trustM.isPending || eraseM.isPending || deleteKycM.isPending
  const actionError = stampM.error ?? trustM.error ?? eraseM.error ?? deleteKycM.error

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
      <View className="flex-1 bg-background">
        <PaperGrain />
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: insets.contentBottom }}
        >
          <DetailSkeleton />
        </ScrollView>
      </View>
    )
  }

  if (customer == null) {
    // A 404 here is normal (a deep-link to a customer that was merged or removed)
    // — render the calm muted „nicht gefunden" frame, never the red error card.
    const customerMissing = isNotFoundError(customerQ.errorCause)
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <PaperGrain />
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
  const kycVerified = customer.kycVerifiedAt != null
  const ankauf = eurAmount(customer.cumulativeAnkaufEur)
  const spend = eurAmount(customer.cumulativeSpendEur)
  const debt = eurAmount(customer.cumulativeDebtEur)
  const rollingAnkauf = eurAmount(customer.gwgRollingAnkauf.priorAnkaufEur)
  const address = formatCustomerAddress(customer.address)
  const flagged = customer.sanctionsMatch || customer.pepMatch
  const trustDot =
    customer.trustLevel === "BANNED" || customer.trustLevel === "SUSPICIOUS"
      ? customer.trustLevel === "BANNED"
        ? t.colors.destructive
        : t.colors.terra
      : customer.trustLevel === "VERIFIED" || customer.trustLevel === "VIP"
        ? t.colors.verdigris
        : t.colors.mutedForeground
  const kycDot = kycVerified ? t.colors.verdigris : t.colors.mutedForeground

  // Honest „Verlauf": only the real audit milestones the endpoint carries (no
  // fabricated transaction log — the app has no per-customer history endpoint).
  // Registration provenance — only when the (newer) server sends it; an older
  // API simply omits the field and the row stays out, never guessed.
  const registrationLabel =
    customer.registration?.method === "GOOGLE"
      ? "Mit Google registriert"
      : customer.registration?.method === "EMAIL"
        ? "Online registriert"
        : customer.registration != null
          ? "Im Geschäft angelegt"
          : null

  const timeline: { label: string; value: string; active: boolean }[] = [
    { label: "Angelegt", value: isoToDe(customer.createdAt), active: true },
    ...(registrationLabel != null
      ? [{ label: "Registrierung", value: registrationLabel, active: true }]
      : []),
    {
      label: "KYC erfasst",
      value: isoToDe(customer.kycCompletedAt),
      active: customer.kycCompletedAt != null,
    },
    {
      label: "KYC bestätigt",
      value: isoToDe(customer.kycVerifiedAt),
      active: kycVerified,
    },
    {
      label: "Aufbewahrung bis",
      value: isoToDe(customer.retentionUntil),
      active: customer.retentionUntil != null,
    },
  ]

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      // Dieselbe Plattform-Kombination wie im geteilten KeyboardAvoidingScreen,
      // damit die fokussierte Vertrauens-Notiz nie hinter der Tastatur liegt.
      // Der Bildschirm behält seine eigene ScrollView samt Dialog-Geschwistern,
      // daher die nackte KeyboardAvoidingView statt des vollen Gerüsts.
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Die gealterte Papier-Maserung trägt die Tiefe (DESIGN-SYSTEM.md §1, §5):
          geschichtetes Cremepapier plus diese feine warme Tönung, nie eine flache
          Füllung. */}
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.contentBottom,
          gap: 28,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...rc} />}
        // With the multiline trust-note focused, Android's default
        // (`keyboardShouldPersistTaps="never"`) eats the first tap on
        // „Vertrauen setzen" to merely dismiss the keyboard — a lost tap on a
        // money-adjacent action. „handled" lets the button receive that tap
        // while a tap on empty space still closes the keyboard.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* ── Identitäts-Kopf — Monogramm · Name · Nummer · die Status-Fäden ─── */}
        <StaggerItem index={0}>
          <View className="gap-4">
            <View className="flex-row items-center gap-3.5">
              {/* Monogramm-Scheibe auf gehobenem Papier — eine Stufe tiefer als der
                  Grund, mit einem Gilt-Faden als Kante (Gold nur als Kante). */}
              <View
                className="h-14 w-14 items-center justify-center rounded-full"
                style={{
                  backgroundColor: t.colors.raised,
                  borderColor: t.colors.gilt,
                  borderWidth: 1,
                }}
              >
                <Text className="text-lg font-bold" style={{ color: t.colors.foreground }}>
                  {initialsOf(customer.fullName)}
                </Text>
              </View>
              <View className="flex-1 gap-1">
                {/* Der Name ist die Bildschirm-Identität — die Bricolage-Grotesque-
                    Display-Stimme (DESIGN-SYSTEM.md §3). */}
                <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={2}>
                  {customer.fullName}
                </Text>
                <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
                  {customer.customerNumber}
                </Text>
              </View>
            </View>

            {/* Status-Fäden — KYC · Vertrauen · etwaige Compliance-Treffer. Keine
                Pillen, keine Kästen; der getönte Punkt trägt die Bedeutung. */}
            <View className="flex-row flex-wrap items-center gap-x-4 gap-y-2">
              <StatusThread label={KYC_STATUS_LABEL[customer.kycStatus]} dot={kycDot} />
              <StatusThread label={TRUST_LEVEL_LABEL[customer.trustLevel]} dot={trustDot} />
              {customer.sanctionsMatch ? (
                <StatusThread label="Sanktionstreffer" dot={t.colors.destructive} />
              ) : null}
              {customer.pepMatch ? (
                <StatusThread label="PEP" dot={t.colors.destructive} />
              ) : null}
            </View>
          </View>
        </StaggerItem>

        {/* Ein echter Sanktions-/PEP-Treffer ist ein Compliance-Stopp — eine
            einzelne ruhige Warn-Zeile auf dem Papier, kein gestapelter Kasten.
            Die warme Haarlinie und die Tinten-Reihe tragen sie; nur der Punkt und
            das Schild-Glyph führen die Funktionsfarbe. */}
        {flagged ? (
          <StaggerItem index={1}>
            <View className="gap-2.5" accessibilityRole="alert">
              <Hairline />
              <View className="flex-row items-start gap-3 pt-0.5">
                <View className="pt-0.5">
                  <ShieldAlert size={t.icon.md} color={t.colors.destructive} />
                </View>
                <View className="flex-1 gap-1">
                  <Text className="text-sm font-semibold" style={{ color: t.colors.destructive }}>
                    {customer.sanctionsMatch
                      ? "Sanktionslisten-Treffer"
                      : "Politisch exponierte Person"}
                  </Text>
                  <Text className="text-muted-foreground text-sm leading-5">
                    Erhöhte Sorgfaltspflicht (GwG). Geschäft nur nach interner Prüfung fortsetzen.
                  </Text>
                </View>
              </View>
              <Hairline />
            </View>
          </StaggerItem>
        ) : null}

        {/* Aktions-Rückmeldung — der Verdigris-Erfolg als Faden / der vereinte
            Fehler. Beide boxlos: eine Tinten-Zeile mit Funktionsfarbe nur am Punkt. */}
        {okMsg ? (
          <StaggerItem index={2} exit>
            <View className="flex-row items-center gap-2.5" accessibilityRole="alert">
              <View
                style={{ height: 7, width: 7, borderRadius: 4, backgroundColor: t.colors.verdigris }}
              />
              <Text className="flex-1 text-sm font-semibold" style={{ color: t.colors.verdigris }}>
                {okMsg}
              </Text>
            </View>
          </StaggerItem>
        ) : null}
        {actionError ? (
          <StaggerItem index={2} exit>
            <InlineError message={actionError} onDismiss={clearActionState} />
          </StaggerItem>
        ) : null}

        {/* ── Stammdaten ─────────────────────────────────────────────────────── */}
        <StaggerItem index={3}>
          <View>
            <View className="flex-row items-end justify-between pb-1">
              <View className="flex-1">
                <GroupKicker label="STAMMDATEN" />
              </View>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Stammdaten bearbeiten"
                onPress={() => {
                  haptics.selection()
                  router.push({ pathname: "/customer/edit", params: { id: customer.id } })
                }}
              >
                <View className="flex-row items-center gap-1.5 pb-1.5 pl-3" style={{ minHeight: 36 }}>
                  <View
                    style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: t.colors.gilt }}
                  />
                  <Text className="text-sm font-medium" style={{ color: t.colors.foreground }}>
                    Bearbeiten
                  </Text>
                </View>
              </PressableScale>
            </View>
            <FieldRow
              icon={CalendarClock}
              label="Geburtsdatum"
              // de-DE rendering of the stored bare ISO day; a malformed legacy
              // value falls through unchanged rather than pretending.
              value={
                customer.dateOfBirth
                  ? customer.dateOfBirth.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, "$3.$2.$1")
                  : "—"
              }
              muted={!customer.dateOfBirth}
            />
            <Hairline inset={40} />
            <FieldRow
              icon={Mail}
              label="E-Mail"
              value={customer.email ?? "—"}
              muted={!customer.email}
            />
            <Hairline inset={40} />
            <FieldRow
              icon={Phone}
              label="Telefon"
              value={customer.phone ?? "—"}
              muted={!customer.phone}
            />
            <Hairline inset={40} />
            <FieldRow
              icon={MapPin}
              label="Adresse"
              value={address ?? "—"}
              muted={address == null}
            />
            <Hairline inset={40} />
            <FieldRow
              icon={Mail}
              label="Sprache"
              value={languageLabel(customer.preferredLanguage)}
            />
            {customer.vatId ? (
              <>
                <Hairline inset={40} />
                <FieldRow icon={IdCard} label="USt-IdNr." value={customer.vatId} mono />
              </>
            ) : null}
          </View>
        </StaggerItem>

        {/* ── KYC + Bilanz — die kumulierte Bilanz als boxlose Reihe (keine Tiles) ─ */}
        <StaggerItem index={4}>
          <View>
            <GroupKicker label="KYC UND BILANZ" />
            <Text className="text-muted-foreground pb-3 text-xs leading-5">
              Geldwäschegesetz-Schwellen (GwG) aus dem rollierenden Fenster. Jede Zahl ist eine
              echte Summe aus dem Endpunkt.
            </Text>

            {/* Boxlose Bilanz-Reihe — drei Zahlen, durch senkrechte Haarlinien
                getrennt, die Beträge in Mono. Gold/Funktionsfarbe nur in der Zahl. */}
            <View className="flex-row items-stretch py-1">
              <BalanceCell label="Ankauf kumuliert" amount={ankauf} tone="ink" />
              <Hairline vertical length={40} />
              <BalanceCell label="Umsatz kumuliert" amount={spend} tone="verdigris" leftPad />
              {debt != null && debt > 0 ? (
                <>
                  <Hairline vertical length={40} />
                  <BalanceCell label="Offen" amount={debt} tone="wax" leftPad />
                </>
              ) : null}
            </View>

            <View className="pt-3">
              <Hairline inset={0} />
            </View>

            <FieldRow
              icon={CalendarClock}
              label="KYC bestätigt am"
              value={isoToDe(customer.kycVerifiedAt)}
              muted={!kycVerified}
            />
            <Hairline inset={40} />
            <View className="min-h-[44px] flex-row items-center gap-3 py-2.5">
              <View className="h-7 w-7 items-center justify-center">
                <CalendarClock size={t.icon.md} color={t.colors.foreground} />
              </View>
              <Text className="text-muted-foreground flex-1 text-sm" numberOfLines={2}>
                Ankauf · letzte {customer.gwgRollingAnkauf.windowDays} Tage
              </Text>
              <Text
                className="font-mono-medium text-sm"
                style={{ color: rollingAnkauf != null ? t.colors.foreground : t.colors.mutedForeground }}
                numberOfLines={1}
              >
                {rollingAnkauf != null ? formatEur(customer.gwgRollingAnkauf.priorAnkaufEur) : "—"}
              </Text>
            </View>
          </View>
        </StaggerItem>

        {/* ── KYC-Dokument — die Schlüssel-Erfassung + der Prüfstempel ────────── */}
        <StaggerItem index={5}>
          <View>
            <GroupKicker label="KYC-DOKUMENT" />
            <Text className="text-muted-foreground pb-3 text-xs leading-5">
              Ausweis serverseitig verschlüsselt ablegen (GwG/DSGVO) und die Sichtprüfung stempeln.
            </Text>

            {/* Die einzige bewusst gehobene Fläche der Sektion: eine tap-bare Reihe
                auf gehobenem Papier mit einem Gilt-Kantenfaden — eine Stufe Tiefe,
                kein gestapelter Kasten. */}
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
                className="min-h-[56px] flex-row items-center gap-3 rounded-xl px-3.5 py-3"
                style={{
                  backgroundColor: t.colors.raised,
                  borderLeftColor: t.colors.gilt,
                  borderLeftWidth: 2,
                }}
              >
                <ScanFace size={t.icon.lg} color={t.colors.foreground} />
                <View className="flex-1">
                  <Text className="text-base font-semibold">Ausweis erfassen</Text>
                  <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                    Fotografieren · sofort verschlüsselt · nicht auf dem Gerät
                  </Text>
                </View>
              </View>
            </PressableScale>

            {/* Ausweis löschen (C4) — only when one is saved. Delete then re-capture
                = replace. Step-up PIN is the friction; the row becomes a redacted
                GwG evidence shell server-side. */}
            {customer.kycCompletedAt != null ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Ausweis löschen"
                disabled={busy}
                onPress={() => {
                  haptics.selection()
                  clearActionState()
                  void deleteKycM.mutate()
                }}
                className="mt-2.5"
              >
                <View className="min-h-[44px] flex-row items-center gap-3 rounded-xl px-3.5 py-2.5">
                  <Trash2 size={t.icon.md} color={t.colors.destructive} />
                  <View className="flex-1">
                    <Text className="text-base font-medium" style={{ color: t.colors.destructive }}>
                      Ausweis löschen
                    </Text>
                    <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                      Gespeicherten Ausweis entfernen, dann neu erfassen
                    </Text>
                  </View>
                </View>
              </PressableScale>
            ) : null}

            <View className="pt-3">
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
            </View>
            {kycVerified ? (
              <Text className="text-muted-foreground pt-2 text-2xs">
                Bereits bestätigt am {isoToDe(customer.kycVerifiedAt)}.
              </Text>
            ) : null}
          </View>
        </StaggerItem>

        {/* ── Vertrauen ──────────────────────────────────────────────────────── */}
        <StaggerItem index={6}>
          <View>
            <GroupKicker label="VERTRAUEN" />
            {editingTrust ? (
              <View className="gap-3 pt-1">
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
                        Für {TRUST_LEVEL_LABEL[trustLevel]} ist eine Notiz (min. {TRUST_NOTE_MIN}{" "}
                        Zeichen) erforderlich.
                      </Text>
                    ) : (
                      <Text className="text-muted-foreground text-2xs">
                        Pflichtfeld für Beobachten und Gesperrt (GwG-Nachvollziehbarkeit).
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
              </View>
            ) : (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Vertrauen ändern"
                onPress={openTrustEditor}
              >
                <View className="min-h-[48px] flex-row items-center gap-3 py-2">
                  <View style={{ height: 8, width: 8, borderRadius: 4, backgroundColor: trustDot }} />
                  <View className="flex-1">
                    <Text className="text-base font-medium">Vertrauensstufe</Text>
                    <Text className="text-muted-foreground text-xs">
                      Aktuell {TRUST_LEVEL_LABEL[customer.trustLevel]}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-1.5">
                    <View
                      style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: t.colors.gilt }}
                    />
                    <Text className="text-sm font-medium" style={{ color: t.colors.foreground }}>
                      Ändern
                    </Text>
                  </View>
                </View>
              </PressableScale>
            )}
          </View>
        </StaggerItem>

        {/* ── Verlauf — nur echte Audit-Meilensteine (keine erfundene Historie) ── */}
        <StaggerItem index={7}>
          <View>
            <GroupKicker label="VERLAUF" />
            <View className="pt-1">
              {timeline.map((step, i) => (
                <View key={step.label}>
                  {i > 0 ? <Hairline inset={28} /> : null}
                  <View className="min-h-[40px] flex-row items-center gap-3 py-2">
                    {/* Punkt-Faden: aktiv tönt Verdigris, sonst gedämpft. */}
                    <View className="w-2 items-center">
                      <View
                        style={{
                          height: 8,
                          width: 8,
                          borderRadius: 4,
                          backgroundColor: step.active ? t.colors.verdigris : "transparent",
                          borderColor: step.active ? t.colors.verdigris : t.colors.border,
                          borderWidth: 1,
                        }}
                      />
                    </View>
                    <Text
                      className="flex-1 text-sm"
                      style={{ color: step.active ? t.colors.foreground : t.colors.mutedForeground }}
                      numberOfLines={1}
                    >
                      {step.label}
                    </Text>
                    <Text
                      className="font-mono text-sm"
                      style={{ color: step.active ? t.colors.inkAged : t.colors.mutedForeground }}
                      numberOfLines={1}
                    >
                      {step.value}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </StaggerItem>

        {/* ── Bestellungen im Online-Shop — Nummer, Status, Positionen, Summe.
            Ehrlich: nur echte Server-Daten; ohne Bestellungen eine ruhige
            Leerzeile statt einer erfundenen Historie. */}
        <StaggerItem index={8}>
          <View>
            <GroupKicker label="BESTELLUNGEN IM SHOP" />
            {webOrders.length === 0 ? (
              ordersQ.status === "error" ? (
                // Honest failure: a dropped read must NEVER assert an empty
                // history (the customer may hold a live reservation right now).
                <View className="flex-row items-center gap-3 pt-1">
                  <Text className="text-muted-foreground flex-1 text-sm">
                    Die Bestellungen konnten nicht geladen werden.
                  </Text>
                  <PressableScale
                    onPress={() => void ordersQ.refetch()}
                    accessibilityRole="button"
                    hitSlop={8}
                  >
                    <Text className="text-sm font-semibold underline">Erneut versuchen</Text>
                  </PressableScale>
                </View>
              ) : (
                <Text className="text-muted-foreground pt-1 text-sm">
                  {ordersQ.status === "loading"
                    ? "Bestellungen werden geladen …"
                    : "Keine Bestellungen im Online-Shop."}
                </Text>
              )
            ) : (
              <View className="pt-1">
                {webOrders.map((order, i) => (
                  <View key={order.id}>
                    {i > 0 ? <Hairline /> : null}
                    <View className="gap-1 py-2.5">
                      <View className="flex-row items-center justify-between gap-3">
                        <Text className="font-mono text-sm font-semibold" numberOfLines={1}>
                          {order.id.slice(0, 8).toUpperCase()}
                        </Text>
                        <Text
                          className="text-xs font-semibold"
                          style={{
                            color:
                              order.status === "RESERVED"
                                ? t.colors.gilt
                                : order.status === "CANCELLED"
                                  ? t.colors.destructive
                                  : t.colors.verdigris,
                          }}
                        >
                          {order.status === "RESERVED"
                            ? "Reserviert"
                            : order.status === "CANCELLED"
                              ? "Storniert"
                              : "Abgeschlossen"}
                        </Text>
                      </View>
                      <View className="flex-row items-center justify-between gap-3">
                        <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                          {new Date(order.createdAt).toLocaleDateString("de-DE", {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })}
                          {" · "}
                          {order.itemCount} {order.itemCount === 1 ? "Artikel" : "Artikel"}
                        </Text>
                        <Text className="font-mono text-sm" style={{ color: t.colors.inkAged }}>
                          {formatEur(order.totalEur)}
                        </Text>
                      </View>
                      {order.lines.map((line) => (
                        <View
                          key={`${order.id}-${line.productId ?? line.name}`}
                          className="flex-row items-center justify-between gap-3 pl-3"
                        >
                          <Text
                            className="text-muted-foreground flex-1 text-xs"
                            numberOfLines={1}
                          >
                            {line.quantity > 1 ? `${line.quantity} × ` : ""}
                            {line.name}
                          </Text>
                          <Text className="text-muted-foreground font-mono text-xs">
                            {formatEur(line.unitPriceEur)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </StaggerItem>

        <StaggerItem index={9}>
          <View className="gap-2 pt-2">
            <Text className="text-sm font-medium">Datenschutz</Text>
            <Text className="text-muted-foreground text-2xs">
              DSGVO Art.17: alle persönlichen Daten dieses Kunden unwiderruflich
              anonymisieren (Name, Kontakt, Ausweis). Steuer- und GoBD-Belege bleiben
              gesetzlich erhalten — nur geschwärzt.
            </Text>
            <Button
              variant="outline"
              disabled={busy}
              onPress={() => setConfirmErase(true)}
              accessibilityLabel="Kundendaten löschen"
              style={{ borderColor: t.colors.destructive }}
            >
              <Trash2 size={16} color={t.colors.destructive} />
              <Text style={{ color: t.colors.destructive }}>Daten löschen (DSGVO)</Text>
            </Button>
          </View>
        </StaggerItem>

        <StaggerItem index={10}>
          <View className="flex-row items-center justify-center gap-2 pt-1">
            <TrustSeal size={16} ink={t.colors.mutedForeground} gilt={t.colors.gilt} />
            <Text className="text-muted-foreground text-2xs">
              Jede Aktion ist PIN-bestätigt und im Prüfprotokoll vermerkt.
            </Text>
          </View>
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
              {customer.fullName} wird gesperrt. Käufe und Verkäufe werden an der Kasse blockiert,
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

      {/* DSGVO Art.17 erasure — irreversible, so make the operator confirm explicitly. */}
      <Dialog open={confirmErase} onOpenChange={setConfirmErase}>
        <DialogContent>
          <DialogHeader>
            <View className="flex-row items-center gap-2.5">
              <View
                className="h-9 w-9 items-center justify-center rounded-full"
                style={{ backgroundColor: t.colors.destructive + "1f" }}
              >
                <Trash2 size={t.icon.md} color={t.colors.destructive} />
              </View>
              <DialogTitle>Kundendaten löschen?</DialogTitle>
            </View>
            <DialogDescription>
              Alle persönlichen Daten von {customer.fullName} werden UNWIDERRUFLICH
              anonymisiert. Steuer- und GoBD-Belege bleiben geschwärzt erhalten. Dies
              erfüllt das DSGVO-Löschrecht (Art.17).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onPress={() => setConfirmErase(false)}
              accessibilityLabel="Abbrechen"
            >
              <Text>Abbrechen</Text>
            </Button>
            <Button
              variant="destructive"
              onPress={() => {
                setConfirmErase(false)
                eraseM.mutate()
              }}
              accessibilityLabel="Endgültig löschen"
            >
              <Text>Endgültig löschen</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The KYC-confirmed milestone flood — visual only (the Success haptic already
          fired on the confirm); once per stamp, above content, never blocks a tap. */}
      <GoldFlood visible={celebrate} onDone={() => setCelebrate(false)} />
    </KeyboardAvoidingView>
  )
}

/** A boxless balance cell: the label, then the amount in JetBrains Mono, count-up
 *  to its magnitude — but only when the wire value is a real number; otherwise a
 *  muted „—" (honesty). The tone tints ONLY the number (functional colour as a
 *  thread, never a fill). Separated from its siblings by a vertical hairline. */
function BalanceCell({
  label,
  amount,
  tone = "ink",
  leftPad = false,
}: {
  label: string
  amount: number | null
  tone?: "ink" | "verdigris" | "wax"
  leftPad?: boolean
}) {
  const t = useW14Theme()
  const color =
    amount == null
      ? t.colors.mutedForeground
      : tone === "verdigris"
        ? t.colors.verdigris
        : tone === "wax"
          ? t.colors.destructive
          : t.colors.foreground
  return (
    <View className="flex-1 gap-1.5" style={{ paddingLeft: leftPad ? 16 : 0 }}>
      <Text
        className="text-muted-foreground text-2xs font-medium"
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
          className="font-mono-medium text-xl leading-none"
          style={{ color }}
        />
      ) : (
        <Text className="font-mono-medium text-xl leading-none" style={{ color }}>
          —
        </Text>
      )}
    </View>
  )
}
