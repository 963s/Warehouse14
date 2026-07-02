/**
 * Ankauf — the mobile buy-in flow. Pick the seller, value each item, and pay out
 * a legal, TSE-signed Ankauf that creates the bought-in products in one DB
 * transaction. This is a MONEY-MOVEMENT + FISCAL surface, so it obeys the
 * absolute rules (DESIGN.md + the Owner OS fiscal doctrine):
 *
 *   • Client-only over the SERVER fiscal endpoint. The payout is written by
 *     `transactionsApi.ankauf` (api: ankaufTransaction); the TSE signing, the
 *     product creation, the cash-OUT shift attribution, the §259/§10 GwG checks
 *     and the ledger/hash-chain all happen SERVER-side. We never reimplement tax
 *     or the KYC gate — the valuation hint is a client suggestion the server
 *     re-prices; the total is the plain Σ of the negotiated prices it re-sums.
 *   • KYC is gated HONESTLY. An ANKAUF requires a KYC-verified seller for EVERY
 *     buy from €0,01 (§259 StGB Hehlerei — no threshold). The server's BEFORE
 *     INSERT trigger is the un-bypassable authority; this screen surfaces the
 *     same truth early — the payout button is locked, with a one-tap path to the
 *     customer's KYC, until the seller is verified. Never a fabricated green.
 *   • The fiscal commit is gated. The `FiscalConfirmSheet` is the ONE gate: it
 *     never auto-fires (opening it is an explicit tap; the payout needs a SECOND
 *     explicit press), it makes the fiscal weight VISIBLE, and the step-up
 *     (403 STEP_UP_REQUIRED → the global PIN host) is transparent. The
 *     at-most-once idempotency key is generated once per sheet-open.
 *
 * Honesty rule is absolute: every figure is a real summed cent value (formatted
 * via formatCents), or a real EUR string from the endpoint. The valuation hint
 * appears only when a real metal rate can compute it. Built on the shared spine
 * (the sell fiscal primitives, the product-form controls, the §6 motion + §7
 * haptic vocabulary, W14 theme tokens only). German UI, de-DE money.
 */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useFocusEffect, useRouter } from "expo-router"
import type {
  AnkaufItemType,
  AnkaufMetal,
  AnkaufPayoutMethod,
  CustomerListRow,
  MetalRatesResponse,
} from "@warehouse14/api-client"
import {
  Banknote,
  Check,
  ChevronRight,
  FileText,
  IdCard,
  Info,
  Landmark,
  type LucideIcon,
  Monitor,
  Plus,
  Printer,
  Receipt,
  ScanFace,
  Search,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  UserRound,
  X,
} from "lucide-react-native"
import Svg, { Path } from "react-native-svg"

import { Badge } from "@/components/ui/badge"
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
  buildAnkaufBody,
  emptyIntakeLine,
  evaluateAnkaufKyc,
  type IntakeLine,
  useAnkaufLot,
  validateIntakeLine,
  type ValuationHint,
  valuationHint,
} from "@/warehouse14/ankauf-flow"
import {
  ANKAUF_TAX_OPTIONS,
  COMMON_FINENESS_PER_MILLE,
  CONDITION_OPTIONS,
  finenessDecimalForPerMille,
  generateAnkaufSku,
  ITEM_TYPE_LABEL,
  ITEM_TYPE_OPTIONS,
  METAL_OPTIONS,
  metalFromItemType,
  PAYOUT_METHOD_LABEL,
} from "@/warehouse14/ankauf-ui"
import {
  ankaufTransaction,
  formatCents,
  formatEur,
  getCustomer,
  listCustomers,
  metalRates,
} from "@/warehouse14/api"
import {
  KYC_STATUS_LABEL,
  KYC_STATUS_VARIANT,
  TRUST_LEVEL_LABEL,
  TRUST_LEVEL_VARIANT,
} from "@/warehouse14/customer-ui"
import { germanLabel } from "@/warehouse14/german-text"
import {
  escposRequirement,
  getPrintCapabilities,
  printPrintable,
  PrintPreview,
  sharePdfPrintable,
  type ReceiptDoc,
} from "@/warehouse14/print"
import {
  ChipSelect,
  Field,
  MetalWeightField,
  MoneyField,
  WheelPicker,
} from "@/warehouse14/product-form"
import {
  buildReceiptDoc,
  FiscalConfirmSheet,
  newIdempotencyKey,
  ReceiptPreview,
  type CartTotals,
} from "@/warehouse14/sell"
import { useW14Theme } from "@/warehouse14/theme"
import {
  CoinIcon,
  CountUp,
  EmptyState,
  Hairline,
  haptics,
  InlineError,
  type MetalKind,
  MetalIcon,
  PaperGrain,
  PressableScale,
  Skeleton,
  StampIcon,
  StaggerItem,
  useQuery,
  useScreenInsets,
} from "@/warehouse14/ui"

const DEBOUNCE_MS = 300

/** The two payout rails the Ankauf route accepts. */
const PAYOUTS: { method: AnkaufPayoutMethod; icon: LucideIcon }[] = [
  { method: "CASH", icon: Banknote },
  { method: "BANK_TRANSFER", icon: Landmark },
]

/** First letters of the first two name parts → the calm avatar monogram. */
function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Lowercase wire metal (`gold`) → the bespoke MetalIcon's uppercase kind. */
const METAL_ICON_KIND: Readonly<Record<AnkaufMetal, MetalKind>> = {
  gold: "GOLD",
  silver: "SILBER",
  platinum: "PLATIN",
  palladium: "PALLADIUM",
}

/**
 * Pick the bespoke SVG mark for an intake line: the metal ingot when a metal is
 * known, a coin for numismatic types, a stamp for philatelic/antique pieces, and
 * a calm shopping-bag fallback otherwise. The glyph tints from `currentColor` /
 * the passed `color`, so it stays ink on the parchment.
 */
function IntakeGlyph({
  line,
  size,
  color,
}: {
  line: IntakeLine
  size: number
  color: string
}): ReactNode {
  if (line.metal) {
    return <MetalIcon metal={METAL_ICON_KIND[line.metal]} size={size} color={color} />
  }
  if (line.itemType.endsWith("coin")) return <CoinIcon size={size} color={color} />
  if (line.itemType === "antique") return <StampIcon size={size} color={color} />
  return <ShoppingBag size={size} color={color} />
}

// ────────────────────────────────────────────────────────────────────────────
// Kicker — the gilt diamond ◆ that opens every section (DESIGN-SYSTEM.md §6).
// A bespoke 8×8 react-native-svg lozenge in the gilt thread colour — the one
// place gold appears on this screen, as a seal, never a fill behind text.
// ────────────────────────────────────────────────────────────────────────────

function GiltDiamond({ size = 8 }: { size?: number }): ReactNode {
  const t = useW14Theme()
  return (
    <Svg width={size} height={size} viewBox="0 0 8 8" accessibilityElementsHidden>
      <Path d="M4 0 L8 4 L4 8 L0 4 Z" fill={t.colors.gilt} />
    </Svg>
  )
}

/**
 * SectionLead — an un-carded section opener that sits directly on the parchment:
 * the gilt diamond seal + a Lucide mark + the Bricolage display title, with an
 * optional right-hand slot (a count Badge, a „Leeren" link). De-boxed: the old
 * numbered raised-circle chip is gone; hierarchy now comes from the display
 * voice + whitespace + a single warm hairline, never a nested box.
 */
function SectionLead({
  icon: Icon,
  title,
  trailing,
}: {
  icon: LucideIcon
  title: string
  trailing?: ReactNode
}): ReactNode {
  const t = useW14Theme()
  return (
    <View className="flex-row items-center justify-between gap-3">
      <View className="flex-1 flex-row items-center gap-2.5">
        <GiltDiamond />
        <Icon size={t.icon.md} color={t.colors.primary} />
        <Text className="flex-1 text-lg font-display-semibold leading-tight" numberOfLines={1}>
          {title}
        </Text>
      </View>
      {trailing != null ? <View>{trailing}</View> : null}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Screen
// ────────────────────────────────────────────────────────────────────────────

export default function AnkaufScreen() {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const router = useRouter()

  const lot = useAnkaufLot()

  // ── Selected seller (id + a live detail read for the KYC gate) ──────────────
  const [customerId, setCustomerId] = useState<string | null>(null)
  const customerQ = useQuery(() => getCustomer(customerId as string), {
    key: `ankauf:customer:${customerId}`,
    enabled: !!customerId,
  })
  const customer = customerId ? (customerQ.data ?? null) : null

  // The seller's KYC must be re-checked when we return from the detail screen
  // (the operator may have just stamped it there). Refetch-on-focus.
  useFocusEffect(
    useCallback(() => {
      if (customerId) void customerQ.refetch()
      // refetch identity is stable for a fixed key
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customerId]),
  )

  // ── Live metal rates (powers the valuation hint; honest when missing) ───────
  const ratesQ = useQuery(() => metalRates(), { key: "ankauf:rates" })

  // ── Customer picker + item-entry sheets ─────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false)
  const [entryOpen, setEntryOpen] = useState(false)

  // ── KYC gate decision (mirrors the server's §259 rule) ──────────────────────
  const kyc = useMemo(
    () => evaluateAnkaufKyc({ customer, totalCents: lot.totalCents }),
    [customer, lot.totalCents],
  )

  // ── Fiscal confirm + payout ─────────────────────────────────────────────────
  const [method, setMethod] = useState<AnkaufPayoutMethod>("CASH")
  const [externalRef, setExternalRef] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => newIdempotencyKey())
  // The sealed buy-in after a successful payout — the honest "what was just
  // booked": the server's Beleg number + payout total + the count of created
  // articles, PLUS a full ReceiptDoc snapshot (built at commit, BEFORE the lot
  // clears) so the Beleg screen can print/share a faithful copy of exactly this
  // Ankauf — mirroring the Verkauf done screen.
  const [done, setDone] = useState<{
    receiptLocator: string
    totalEur: string
    count: number
    receiptDoc: ReceiptDoc
  } | null>(null)

  const totalCents = lot.totalCents
  const refRequired = method === "BANK_TRANSFER"
  const refMissing = refRequired && externalRef.trim().length === 0
  const canCommit = !lot.isEmpty && customerId != null && kyc.kycVerified && !refMissing

  // A receipt-shaped preview needs CartTotals; an Ankauf has no VAT, so we build a
  // minimal, honest totals object: each line at its negotiated price, zero VAT. It
  // feeds BOTH the confirm-sheet ReceiptPreview and the sealed Beleg ReceiptDoc, so
  // the printed copy matches the sheet line-for-line.
  const previewTotals = useMemo<CartTotals>(() => buildPreviewTotals(lot.lines), [lot.lines])

  const openConfirm = useCallback(() => {
    if (!canCommit) {
      haptics.error()
      return
    }
    // Fresh idempotency key per sheet-open: a prior attempt that failed (cancelled
    // step-up / server refusal), then got EDITED and resubmitted, must NOT reuse
    // the old key — the server would dedupe to the stale attempt and silently drop
    // the edits. A double-tap WITHIN one open still shares this key (the sheet owns
    // the confirm), so the at-most-once guard for the same payout is preserved.
    setIdempotencyKey(newIdempotencyKey())
    haptics.impactLight()
    setConfirmOpen(true)
  }, [canCommit])

  // The legal commit handed to the FiscalConfirmSheet. It builds the exact
  // AnkaufBody from the lot + payout, POSTs it (step-up transparent), and on
  // success records the receipt. A throw lands in the sheet's InlineError; the
  // SAME idempotency key is retried safely (server dedups).
  const commit = useCallback(async () => {
    if (customerId == null) throw new Error("Kein Kunde ausgewählt.")
    const body = buildAnkaufBody({
      customerId,
      lines: lot.lines,
      payoutMethod: method,
      payoutExternalRef: refRequired ? externalRef : undefined,
      idempotencyKey,
    })
    const res = await ankaufTransaction(body)
    // Snapshot a faithful, shareable Ankauf-Beleg NOW — the lot clears in
    // onConfirmed, so we build the ReceiptDoc from the same minimal totals the
    // confirm sheet just showed (each line at its negotiated payout, zero VAT —
    // a buy-in bears no output VAT) BEFORE then. The Beleg number + the sealed
    // timestamp + the payout method ride in from the server response; every
    // figure is the same real cents the sheet showed (honesty rule).
    const receiptDoc = buildReceiptDoc({
      totals: previewTotals,
      kind: "Ankauf",
      receiptLocator: res.receiptLocator,
      issuedAt: res.finalizedAt,
      // payoutMethod ⊂ PaymentMethod (CASH | BANK_TRANSFER); the receipt builder
      // resolves the German label for both, so the Beleg shows Bar / Überweisung.
      payment: { method: res.payoutMethod },
    })
    setDone({
      receiptLocator: res.receiptLocator,
      totalEur: res.totalEur,
      count: res.createdProducts.length,
      receiptDoc,
    })
  }, [customerId, lot.lines, method, refRequired, externalRef, idempotencyKey, previewTotals])

  const onConfirmed = useCallback(() => {
    // After a sealed payout: clear the lot, reset the payout, arm a fresh key.
    lot.clear()
    setExternalRef("")
    setMethod("CASH")
    setIdempotencyKey(newIdempotencyKey())
  }, [lot])

  // The success screen after a finalized payout.
  if (done) {
    return (
      <AnkaufDoneScreen
        receiptLocator={done.receiptLocator}
        totalEur={done.totalEur}
        count={done.count}
        receiptDoc={done.receiptDoc}
        onNew={() => {
          haptics.selection()
          setDone(null)
        }}
        onClose={() => {
          haptics.selection()
          router.back()
        }}
      />
    )
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      // The same per-platform combination the shared KeyboardAvoidingScreen
      // uses, so the focused Referenz field is never hidden behind the keyboard.
      // The screen keeps its own ScrollView and sheet siblings, hence the bare
      // KeyboardAvoidingView instead of the full scaffold.
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* The aged-paper grain canvas depth from the layered cream plus this
          faint warm tooth, never a flat fill (DESIGN.md §1). */}
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.contentBottom,
          gap: 16,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1 · Verkäufer ──────────────────────────────────────────────────── */}
        <View className="gap-3">
          <SectionLead icon={UserRound} title="Verkäufer" />

          {customerId == null ? (
            // De-boxed: a bare tappable row on a single warm hairline, not a
            // tinted card. The leading mark sits directly (no chip box); the eye
            // reads it as a calm native target.
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Verkäufer auswählen"
              onPress={() => {
                haptics.selection()
                setPickerOpen(true)
              }}
            >
              <View className="hairline-b min-h-[56px] flex-row items-center gap-3 py-3">
                <Search size={t.icon.md} color={t.colors.primary} />
                <View className="flex-1">
                  <Text className="text-base font-semibold">Verkäufer auswählen</Text>
                  <Text className="text-muted-foreground text-xs">
                    Pflicht der Ankauf verlangt eine geprüfte Identität.
                  </Text>
                </View>
                <Plus size={t.icon.sm} color={t.colors.mutedForeground} />
              </View>
            </PressableScale>
          ) : customerQ.isLoading && customer == null ? (
            <View className="hairline-b flex-row items-center gap-3 py-3">
              <Skeleton width={44} height={44} radius="full" />
              <View className="flex-1 gap-2">
                <Skeleton width="56%" height={14} />
                <Skeleton width="32%" height={11} />
              </View>
            </View>
          ) : customer != null ? (
            <SellerCard
              fullName={customer.fullName}
              customerNumber={customer.customerNumber}
              kycStatus={customer.kycStatus}
              trustLevel={customer.trustLevel}
              sanctionsMatch={customer.sanctionsMatch}
              onChange={() => {
                haptics.selection()
                setPickerOpen(true)
              }}
            />
          ) : (
            <InlineError
              message={customerQ.error ?? "Der Kunde konnte nicht geladen werden."}
              onRetry={() => void customerQ.refetch()}
            />
          )}

          {/* The honest KYC gate. A selected-but-unverified seller blocks the
              payout with a one-tap path to stamp the Ausweis in the profile. */}
          {customer != null && kyc.blocked ? (
            <KycGateBanner
              fullName={customer.fullName}
              aggregateReached={kyc.aggregateReached}
              windowDays={customer.gwgRollingAnkauf.windowDays}
              onVerify={() => {
                haptics.selection()
                router.push({ pathname: "/customer/[id]", params: { id: customer.id } })
              }}
            />
          ) : null}
          {customer != null && (customer.sanctionsMatch || customer.pepMatch) ? (
            <ComplianceStop sanctions={customer.sanctionsMatch} />
          ) : null}
          {customer != null && kyc.kycVerified ? (
            // De-boxed: the „geprüft" confirmation is a bare verdigris row, the
            // functional colour carrying meaning, no tinted card.
            <View className="flex-row items-center gap-2 px-0.5">
              <ShieldCheck size={t.icon.sm} color={t.colors.verdigris} />
              <Text className="text-xs font-medium" style={{ color: t.colors.verdigris }}>
                Identität geprüft Ankauf zulässig.
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── 2 · Stücke ─────────────────────────────────────────────────────── */}
        <View className="gap-3">
          <SectionLead
            icon={ShoppingBag}
            title="Stücke"
            trailing={
              !lot.isEmpty ? (
                <View className="flex-row items-center gap-3">
                  <Text className="text-muted-foreground font-mono text-xs">
                    {lot.lines.length}
                  </Text>
                  <Pressable
                    onPress={() => {
                      haptics.selection()
                      lot.clear()
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Alle Stücke entfernen"
                    className="flex-row items-center gap-1 py-1"
                  >
                    <Trash2 size={t.icon.xs} color={t.colors.mutedForeground} />
                    <Text className="text-muted-foreground text-xs">Leeren</Text>
                  </Pressable>
                </View>
              ) : undefined
            }
          />

          {lot.isEmpty ? (
            // De-boxed empty state: a calm centred placeholder on the bare
            // parchment ruled by a single warm hairline, never a card.
            <View className="hairline-t hairline-b items-center gap-2 py-8">
              <ShoppingBag size={t.icon.xl} color={t.colors.mutedForeground} />
              <Text className="text-muted-foreground max-w-[260px] text-center text-sm leading-5">
                Noch kein Stück erfasst. Tippe auf Stück hinzufügen, um die Bewertung zu beginnen.
              </Text>
            </View>
          ) : (
            // The lot is a ruled ledger: each line sits on one shared warm
            // hairline, not in its own stacked card (de-boxed).
            <View className="hairline-t">
              {lot.lines.map((line, index) => (
                <StaggerItem key={line.id} index={Math.min(index, 8)} exit={false}>
                  <IntakeRow
                    line={line}
                    onRemove={() => {
                      haptics.selection()
                      lot.removeLine(line.id)
                    }}
                  />
                </StaggerItem>
              ))}
            </View>
          )}

          <Button
            variant="outline"
            size="xl"
            onPress={() => {
              haptics.selection()
              setEntryOpen(true)
            }}
            accessibilityLabel="Stück hinzufügen"
          >
            <Plus size={t.icon.sm} color={t.colors.primary} />
            <Text>Stück hinzufügen</Text>
          </Button>
        </View>

        {/* ── 3 · Auszahlung ─────────────────────────────────────────────────── */}
        {!lot.isEmpty ? (
          <>
            <View className="gap-3">
              <SectionLead icon={Banknote} title="Auszahlung" />
              <PayoutPicker method={method} onPick={setMethod} />

              {method === "BANK_TRANSFER" ? (
                <Field
                  label="Verwendungszweck / Referenz"
                  required
                  error={
                    refMissing ? "Für eine Überweisung ist eine Referenz erforderlich." : undefined
                  }
                  hint="Pflicht bei Überweisung erscheint im Kassenbuch."
                >
                  <Input
                    value={externalRef}
                    onChangeText={setExternalRef}
                    placeholder="z. B. Ankauf-Beleg oder IBAN-Notiz"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    accessibilityLabel="Verwendungszweck"
                  />
                </Field>
              ) : (
                // De-boxed: a calm bare note on a single warm hairline, not a card.
                <View className="hairline-t flex-row items-start gap-2.5 pt-3">
                  <Info size={t.icon.sm} color={t.colors.mutedForeground} />
                  <Text className="text-muted-foreground flex-1 text-sm leading-5">
                    Der Betrag wird bar aus der Kasse ausgezahlt. Der Ankauf wird als Barauszahlung
                    in der Schicht erfasst.
                  </Text>
                </View>
              )}
            </View>

            {/* The payout total ruled by a single warm hairline above, not boxed.
                The figure rolls to its new sum with the calm emphasis spring
                (CountUp formats through formatCents — honest, never a fake
                number). */}
            <View className="hairline-t flex-row items-baseline justify-between pt-3.5">
              <Text className="text-muted-foreground text-sm">Auszahlung gesamt</Text>
              <CountUp
                value={Number(totalCents)}
                format={(n) => formatCents(n)}
                className="font-mono-medium text-3xl"
                style={{ color: t.colors.foreground }}
                accessibilityLabel={`Auszahlung gesamt ${formatCents(Number(totalCents))}`}
              />
            </View>

            {/* The fiscal gate opener NEVER the commit itself. */}
            <View className="gap-2 pt-1">
              <View className="flex-row items-center gap-1.5">
                <GiltDiamond />
                <Text className="text-xs font-semibold" style={{ color: t.colors.foreground }}>
                  Fiskalische Aktion
                </Text>
              </View>
              <Button
                size="xl"
                onPress={openConfirm}
                disabled={!canCommit}
                accessibilityLabel={`Ankauf über ${formatCents(Number(totalCents))} auszahlen`}
              >
                <Banknote size={t.icon.sm} color={t.colors.primaryForeground} />
                <Text>{`Auszahlen · ${formatCents(Number(totalCents))}`}</Text>
              </Button>
              {customerId == null ? (
                <GateHint text="Zuerst einen Verkäufer auswählen." />
              ) : kyc.blocked ? (
                <GateHint text="Identität des Verkäufers zuerst prüfen (KYC)." />
              ) : refMissing ? (
                <GateHint text="Referenz für die Überweisung eingeben." />
              ) : customer == null ? (
                <GateHint text="Verkäuferdaten werden geladen …" />
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* The customer picker sheet. */}
      <CustomerPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(row) => {
          haptics.selection()
          setCustomerId(row.id)
          setPickerOpen(false)
        }}
      />

      {/* The item-entry sheet valuation happens here. */}
      <ItemEntrySheet
        open={entryOpen}
        onOpenChange={setEntryOpen}
        rate={ratesQ.data ?? null}
        onAdd={(line) => {
          lot.addLine(line)
          haptics.success()
          setEntryOpen(false)
        }}
      />

      {/* The ONE fiscal gate. */}
      <FiscalConfirmSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={commit}
        onConfirmed={onConfirmed}
        title="Ankauf auszahlen"
        amountCaption="Auszahlung"
        amountLabel={formatCents(Number(totalCents))}
        confirmLabel="Ankauf auszahlen"
        fiscalNote={
          "Mit der Auszahlung wird ein rechtsverbindlicher, TSE-signierter Ankauf-Beleg " +
          "erzeugt und im Kassenbuch festgeschrieben (GoBD). Die Stücke werden als Artikel " +
          "angelegt; der gezahlte Preis ist der gesperrte Einkaufswert. Eine Korrektur ist " +
          "nur per Storno möglich."
        }
      >
        <ReceiptPreview
          totals={previewTotals}
          kind="Ankauf"
          payment={{ method: method === "CASH" ? "CASH" : "BANK_TRANSFER" }}
        />
      </FiscalConfirmSheet>
    </KeyboardAvoidingView>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Payout picker — the two rails (Bar · Überweisung) as bare segmented targets
// ────────────────────────────────────────────────────────────────────────────

function PayoutPicker({
  method,
  onPick,
}: {
  method: AnkaufPayoutMethod
  onPick: (m: AnkaufPayoutMethod) => void
}) {
  const t = useW14Theme()
  return (
    <View className="flex-row gap-2">
      {PAYOUTS.map(({ method: m, icon: Icon }) => {
        const active = method === m
        return (
          <PressableScale
            key={m}
            onPress={() => {
              haptics.selection()
              onPick(m)
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Auszahlung ${PAYOUT_METHOD_LABEL[m]}`}
            style={{
              minHeight: t.touch.comfortable,
              borderColor: active ? t.colors.primary : t.colors.border,
              backgroundColor: active ? t.colors.raised : undefined,
            }}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-md border px-2 py-2"
          >
            <Icon size={t.icon.md} color={active ? t.colors.primary : t.colors.mutedForeground} />
            <Text
              className="text-sm font-medium"
              style={{ color: active ? t.colors.primary : t.colors.mutedForeground }}
            >
              {PAYOUT_METHOD_LABEL[m]}
            </Text>
          </PressableScale>
        )
      })}
    </View>
  )
}

function GateHint({ text }: { text: string }) {
  return <Text className="text-muted-foreground text-center text-xs">{text}</Text>
}

// ────────────────────────────────────────────────────────────────────────────
// Seller card — the chosen customer with the flags an operator scans
// ────────────────────────────────────────────────────────────────────────────

function SellerCard({
  fullName,
  customerNumber,
  kycStatus,
  trustLevel,
  sanctionsMatch,
  onChange,
}: {
  fullName: string
  customerNumber: string
  kycStatus: keyof typeof KYC_STATUS_LABEL
  trustLevel: keyof typeof TRUST_LEVEL_LABEL
  sanctionsMatch: boolean
  onChange: () => void
}) {
  const t = useW14Theme()
  // De-boxed: the chosen seller is a bare row ruled by a single warm hairline,
  // not a stacked card. The monogram is a quiet raised disc (an avatar, not a
  // chip), and the flags sit as a calm badge run beneath the name.
  return (
    <View className="hairline-t hairline-b gap-3 py-3">
      <View className="flex-row items-center gap-3">
        <View
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: t.colors.raised }}
        >
          <Text className="text-sm font-semibold" style={{ color: t.colors.foreground }}>
            {initialsOf(fullName)}
          </Text>
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-base font-semibold" numberOfLines={1}>
            {fullName}
          </Text>
          <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
            {customerNumber}
          </Text>
        </View>
        <Button
          variant="ghost"
          size="sm"
          onPress={onChange}
          accessibilityLabel="Verkäufer wechseln"
        >
          <Text className="text-primary">Wechseln</Text>
        </Button>
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        <Badge variant={KYC_STATUS_VARIANT[kycStatus]} dot>
          <Text>{KYC_STATUS_LABEL[kycStatus]}</Text>
        </Badge>
        <Badge variant={TRUST_LEVEL_VARIANT[trustLevel]} dot>
          <Text>{TRUST_LEVEL_LABEL[trustLevel]}</Text>
        </Badge>
        {sanctionsMatch ? (
          <Badge variant="destructive" dot>
            <Text>Sanktion</Text>
          </Badge>
        ) : null}
      </View>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// KYC gate banner — the honest block, with a path to verify
// ────────────────────────────────────────────────────────────────────────────

function KycGateBanner({
  fullName,
  aggregateReached,
  windowDays,
  onVerify,
}: {
  fullName: string
  aggregateReached: boolean
  windowDays: number
  onVerify: () => void
}) {
  const t = useW14Theme()
  // An honest legal block. De-boxed to a bare alert ruled by a single warm
  // hairline above + below (not a tinted bordered card): the IdCard mark sits
  // directly, the copy carries the weight, and a calm ink primary button leads
  // to the Ausweis stamp. The one place this surface raises its voice.
  return (
    <View className="hairline-t hairline-b gap-3 py-3.5" accessibilityRole="alert">
      <View className="flex-row items-start gap-2.5">
        <View className="pt-0.5">
          <IdCard size={t.icon.md} color={t.colors.primary} />
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-sm font-semibold" style={{ color: t.colors.foreground }}>
            Identifizierung erforderlich (§ 259 StGB)
          </Text>
          <Text className="text-muted-foreground text-sm leading-5">
            Jeder Ankauf verlangt eine geprüfte Ausweis-Identifikation des Verkäufers. {fullName}
            ist noch nicht bestätigt.
          </Text>
          {aggregateReached ? (
            <Text className="text-muted-foreground text-2xs leading-4">
              Hinweis: Die Ankäufe dieses Verkäufers überschreiten als verknüpfte Transaktionen im
              Fenster der letzten {windowDays} Tage die GwG-Schwelle (§ 10).
            </Text>
          ) : null}
        </View>
      </View>
      <Button onPress={onVerify} accessibilityLabel="Identität jetzt prüfen">
        <ScanFace size={t.icon.sm} color={t.colors.primaryForeground} />
        <Text>Identität prüfen</Text>
      </Button>
    </View>
  )
}

function ComplianceStop({ sanctions }: { sanctions: boolean }) {
  const t = useW14Theme()
  // The hard compliance stop. A bare destructive-led row on a single warm
  // hairline — the wax-red carries the meaning, no tinted bordered box. The
  // left edge is a thin wax-red seal so the eye lands on the legal weight.
  return (
    <View
      className="flex-row items-start gap-2.5 py-3.5 pl-3"
      style={{ borderLeftWidth: 2, borderLeftColor: t.colors.destructive }}
      accessibilityRole="alert"
    >
      <View className="pt-0.5">
        <ShieldCheck size={t.icon.sm} color={t.colors.destructive} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-semibold" style={{ color: t.colors.destructive }}>
          {sanctions ? "Sanktionslisten-Treffer" : "Politisch exponierte Person"}
        </Text>
        <Text className="text-muted-foreground text-sm leading-5">
          Erhöhte Sorgfaltspflicht (GwG). Ankauf nur nach interner Prüfung fortsetzen.
        </Text>
      </View>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Intake row — one bought-in item in the lot
// ────────────────────────────────────────────────────────────────────────────

function IntakeRow({ line, onRemove }: { line: IntakeLine; onRemove: () => void }) {
  const t = useW14Theme()
  // Always a clean German label — `germanLabel` returns „Unbekannt" rather than
  // the raw lower_snake token if a future backend enum ever arrives unmapped, so
  // a developer string can never surface in the lot row.
  const itemTypeLabel = germanLabel(ITEM_TYPE_LABEL, line.itemType)
  // The optional weight·fineness suffix the operator typed — shown only when both
  // are real (no fabricated „0 g"), so the row reads richer when measured.
  const weight = line.weightGrams.trim()
  const fineness = line.finenessDecimal.trim()
  // Comma-tolerant: a German keyboard types „0,585"; Number(„0,585") is NaN, so
  // the row would print „NaN" per mille. Parse with a dot + guard finiteness.
  const finenessNum = Number(fineness.replace(",", "."))
  const measure =
    weight && Number.isFinite(finenessNum)
      ? `${weight} g · ${(finenessNum * 1000).toFixed(0)}`
      : weight
        ? `${weight} g`
        : null
  return (
    <View className="hairline-b flex-row items-center gap-3 py-3">
      {/* The bespoke domain mark — a metal ingot / coin / stamp glyph (SVG),
          ink on the parchment, so the lot reads as carved articles. */}
      <View className="h-9 w-9 items-center justify-center">
        <IntakeGlyph line={line} size={t.icon.lg} color={t.colors.inkAged} />
      </View>
      <View className="flex-1 gap-1">
        <Text className="text-base font-semibold" numberOfLines={1}>
          {line.name || "Unbenanntes Stück"}
        </Text>
        <View className="flex-row items-center gap-2">
          <Text className="text-muted-foreground font-mono text-2xs" numberOfLines={1}>
            {line.sku}
          </Text>
          <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
            · {itemTypeLabel}
            {measure ? ` · ${measure}` : ""}
          </Text>
        </View>
      </View>
      <Text className="text-foreground font-mono-medium text-base">
        {formatEur(line.negotiatedPriceEur || "0")}
      </Text>
      <Pressable
        onPress={onRemove}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${line.name || "Stück"} entfernen`}
        className="h-8 w-8 items-center justify-center rounded-md"
      >
        <Trash2 size={t.icon.sm} color={t.colors.mutedForeground} />
      </Pressable>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Customer picker sheet — search + select the seller
// ────────────────────────────────────────────────────────────────────────────

function CustomerPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (row: CustomerListRow) => void
}) {
  const t = useW14Theme()
  const router = useRouter()
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

  // Blocked sellers can never complete a buy-in (the server refuses them), so we
  // exclude them from the picker honestly rather than letting the operator pick a
  // dead end.
  const results = useQuery(
    () => listCustomers({ q: debouncedQ || undefined, excludeBlocked: true, limit: 30 }),
    { key: `ankauf:picker:${debouncedQ}`, enabled: open },
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4">
        <DialogHeader>
          <DialogTitle>Verkäufer wählen</DialogTitle>
          <DialogDescription>Suche nach Name, E-Mail oder Telefon.</DialogDescription>
        </DialogHeader>

        <View className="relative justify-center">
          <View className="absolute left-3 z-10">
            <Search size={t.icon.sm} color={t.colors.mutedForeground} />
          </View>
          <Input
            value={q}
            onChangeText={setQ}
            placeholder="Kunde suchen…"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            className="pl-9 pr-9"
            accessibilityLabel="Verkäufer durchsuchen"
          />
          {q.length > 0 ? (
            <Pressable
              onPress={() => setQ("")}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Suche löschen"
              className="absolute right-2.5 z-10 h-6 w-6 items-center justify-center"
            >
              <X size={t.icon.sm} color={t.colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          className="max-h-[360px]"
          contentContainerStyle={{ gap: 8 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {results.status === "loading" && results.data == null ? (
            <View className="gap-2">
              {[0, 1, 2, 3].map((i) => (
                <View key={i} className="flex-row items-center gap-3 hairline-b px-3 py-3">
                  <Skeleton width={40} height={40} radius="full" />
                  <View className="flex-1 gap-2">
                    <Skeleton width="58%" height={13} />
                    <Skeleton width="32%" height={10} />
                  </View>
                </View>
              ))}
            </View>
          ) : results.data != null && results.data.items.length === 0 ? (
            <EmptyState
              icon={UserRound}
              title={debouncedQ ? "Keine Treffer" : "Keine Kunden"}
              description={
                debouncedQ
                  ? "Kein Kunde zu dieser Suche. Schreibweise prüfen oder neu anlegen."
                  : "Lege zuerst einen Kunden an, dann erscheint er hier."
              }
            />
          ) : results.data != null ? (
            results.data.items.map((row) => (
              <PressableScale
                key={row.id}
                accessibilityRole="button"
                accessibilityLabel={`${row.fullName}, ${KYC_STATUS_LABEL[row.kycStatus]}`}
                onPress={() => onPick(row)}
              >
                <View className="flex-row items-center gap-3 hairline-b px-3 py-3">
                  <View
                    className="h-10 w-10 items-center justify-center rounded-full"
                    style={{ backgroundColor: t.colors.raised }}
                  >
                    <Text className="text-xs font-semibold" style={{ color: t.colors.foreground }}>
                      {initialsOf(row.fullName)}
                    </Text>
                  </View>
                  <View className="flex-1 gap-1">
                    <Text className="text-sm font-semibold" numberOfLines={1}>
                      {row.fullName}
                    </Text>
                    <Text className="text-muted-foreground font-mono text-2xs" numberOfLines={1}>
                      {row.customerNumber}
                    </Text>
                  </View>
                  <Badge variant={KYC_STATUS_VARIANT[row.kycStatus]} dot>
                    <Text>{KYC_STATUS_LABEL[row.kycStatus]}</Text>
                  </Badge>
                </View>
              </PressableScale>
            ))
          ) : results.error != null ? (
            <InlineError message={results.error} onRetry={() => void results.refetch()} />
          ) : null}
        </ScrollView>

        <Button
          variant="outline"
          onPress={() => {
            onOpenChange(false)
            router.push("/customer/neu")
          }}
          accessibilityLabel="Neuen Kunden anlegen"
        >
          <Text>Neuen Kunden anlegen</Text>
        </Button>
      </DialogContent>
    </Dialog>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Item-entry sheet — the valuation form for one item
// ────────────────────────────────────────────────────────────────────────────

function ItemEntrySheet({
  open,
  onOpenChange,
  rate,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rate: MetalRatesResponse | null
  onAdd: (line: IntakeLine) => void
}) {
  const t = useW14Theme()
  const insets = useSafeAreaInsets()

  // A fresh draft each time the sheet opens; reset on close.
  const [draft, setDraft] = useState<IntakeLine>(() => emptyIntakeLine())
  const [showErrors, setShowErrors] = useState(false)
  useEffect(() => {
    if (open) {
      setDraft(emptyIntakeLine())
      setShowErrors(false)
    }
  }, [open])

  const patch = useCallback((p: Partial<IntakeLine>) => setDraft((d) => ({ ...d, ...p })), [])

  // The per-metal rate row for the draft's metal (drives the valuation hint).
  const metalRate = useMemo(() => {
    if (!rate || !draft.metal) return null
    return rate.rates.find((r) => r.metal === draft.metal) ?? null
  }, [rate, draft.metal])

  const hint = useMemo(
    () =>
      valuationHint({
        metal: draft.metal,
        weightGrams: draft.weightGrams,
        finenessDecimal: draft.finenessDecimal,
        rate: metalRate,
      }),
    [draft.metal, draft.weightGrams, draft.finenessDecimal, metalRate],
  )

  const invalidField = validateIntakeLine(draft)

  const submit = () => {
    if (invalidField != null) {
      setShowErrors(true)
      haptics.error()
      return
    }
    onAdd(draft)
  }

  // When the operator changes the item type, follow its metal (so the hint and
  // fineness presets track it) — but only while they have not overridden it by
  // hand to a different metal. Simplest honest rule: itemType drives metal.
  const onItemType = (next: AnkaufItemType) => {
    patch({ itemType: next, metal: metalFromItemType(next) })
  }

  const finenessPresets = useMemo<readonly number[]>(
    () => (draft.metal ? COMMON_FINENESS_PER_MILLE[draft.metal] : []),
    [draft.metal],
  )

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => onOpenChange(false)}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* An RN Modal sits outside any screen-level scaffold, so the sheet
            carries its own keyboard avoidance: with the keyboard up, Gezahlter
            Preis / Verkaufspreis and the footer buttons lift into view instead
            of being typed blind. */}
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: t.colors.background, paddingTop: insets.top }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View className="hairline-b flex-row items-start justify-between gap-3 px-5 pb-3 pt-1">
            <View className="flex-1">
              <Text className="text-foreground font-display-semibold text-lg leading-tight">
                Stück bewerten
              </Text>
              <Text className="text-muted-foreground mt-0.5 text-sm leading-snug">
                Warenart, Edelmetall und den gezahlten Preis erfassen.
              </Text>
            </View>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Schließen"
              onPress={() => onOpenChange(false)}
              hitSlop={12}
            >
              <X size={t.icon.md} color={t.colors.mutedForeground} />
            </PressableScale>
          </View>

          <ScrollView
            className="flex-1 px-5"
            contentContainerStyle={{ gap: 14, paddingTop: 14, paddingBottom: 16 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
          <Field label="Warenart" required>
            <WheelPicker
              options={ITEM_TYPE_OPTIONS}
              value={draft.itemType}
              onChange={(v) => onItemType(v)}
            />
          </Field>

          <Field label="Edelmetall" hint="Steuert die Bewertungshilfe (Schmelzwert).">
            <ChipSelect
              options={METAL_OPTIONS}
              value={draft.metal}
              onChange={(v) => patch({ metal: v })}
              allowClear
              clearLabel="Kein Metall"
            />
          </Field>

          {draft.metal ? (
            <View className="gap-2">
              <MetalWeightField
                weight={draft.weightGrams}
                onWeightChange={(v) => patch({ weightGrams: v })}
                fineness={draft.finenessDecimal}
                onFinenessChange={(v) => patch({ finenessDecimal: v })}
              />
              {finenessPresets.length > 0 ? (
                <View className="flex-row flex-wrap gap-2">
                  {finenessPresets.map((pm) => (
                    <PressableScale
                      key={pm}
                      accessibilityRole="button"
                      accessibilityLabel={`Feinheit ${pm}`}
                      onPress={() => {
                        haptics.selection()
                        patch({ finenessDecimal: finenessDecimalForPerMille(pm) })
                      }}
                    >
                      <Badge variant="outline">
                        <Text>{pm}</Text>
                      </Badge>
                    </PressableScale>
                  ))}
                </View>
              ) : null}

              {/* The valuation hint honest: shown only when a real rate computes it. */}
              <ValuationHintCard
                hint={hint}
                onUseSuggestion={(eur) => patch({ negotiatedPriceEur: eur })}
              />
            </View>
          ) : null}

          <Field
            label="Bezeichnung"
            required
            error={
              showErrors && invalidField === "name" ? "Bitte eine Bezeichnung eingeben." : undefined
            }
          >
            <Input
              value={draft.name}
              onChangeText={(v) => patch({ name: v })}
              placeholder="z. B. Ehering 585 Gelbgold"
              accessibilityLabel="Bezeichnung"
            />
          </Field>

          <MoneyField
            label="Gezahlter Preis"
            required
            value={draft.negotiatedPriceEur}
            onChangeText={(v) => patch({ negotiatedPriceEur: v })}
            error={
              showErrors && invalidField === "negotiatedPriceEur"
                ? "Bitte einen Auszahlungsbetrag > 0 eingeben."
                : undefined
            }
            hint="Der bar/überwiesen gezahlte Betrag wird zum gesperrten Einkaufswert."
          />

          <MoneyField
            label="Verkaufspreis (Liste)"
            required
            value={draft.listPriceEur}
            onChangeText={(v) => patch({ listPriceEur: v })}
            error={
              showErrors && invalidField === "listPriceEur"
                ? "Bitte einen Listenpreis ≥ 0 eingeben."
                : undefined
            }
            hint="Der spätere Verkaufspreis im Lager."
          />

          <Field label="Zustand">
            <WheelPicker
              options={CONDITION_OPTIONS}
              value={draft.condition}
              onChange={(v) => patch({ condition: v })}
            />
          </Field>

          <Field
            label="Steuerschlüssel (Wiederverkauf)"
            hint="Standard für Privatankauf: §25a Differenzbesteuerung."
          >
            <ChipSelect
              options={ANKAUF_TAX_OPTIONS}
              value={draft.taxTreatmentCode}
              onChange={(v) => v && patch({ taxTreatmentCode: v })}
            />
          </Field>

          <Field label="SKU" hint="Automatisch vergeben bei Bedarf anpassbar.">
            <View className="flex-row items-center gap-2">
              <View className="flex-1">
                <Input
                  value={draft.sku}
                  onChangeText={(v) => patch({ sku: v })}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  className="font-mono"
                  accessibilityLabel="SKU"
                />
              </View>
              <Button
                variant="outline"
                size="sm"
                onPress={() => {
                  haptics.selection()
                  patch({ sku: generateAnkaufSku() })
                }}
                accessibilityLabel="Neue SKU erzeugen"
              >
                <Text>Neu</Text>
              </Button>
            </View>
          </Field>

          <Field
            label="Sofort verfügbar"
            hint="Aus: als Entwurf anlegen (erst Fotos), Ein: sofort im Lager verfügbar."
          >
            <ChipSelect
              options={[
                { value: "draft", label: "Entwurf" },
                { value: "available", label: "Sofort verfügbar" },
              ]}
              value={draft.publishImmediately ? "available" : "draft"}
              onChange={(v) => patch({ publishImmediately: v === "available" })}
            />
          </Field>
          </ScrollView>

          <View
            className="hairline-t gap-2 px-5"
            style={{ paddingTop: 12, paddingBottom: insets.bottom + 12 }}
          >
            <Button size="xl" onPress={submit} accessibilityLabel="Stück hinzufügen">
              <Check size={t.icon.sm} color={t.colors.primaryForeground} />
              <Text>Stück hinzufügen</Text>
            </Button>
            <Button
              variant="outline"
              size="xl"
              onPress={() => onOpenChange(false)}
              accessibilityLabel="Abbrechen"
            >
              <Text>Abbrechen</Text>
            </Button>
          </View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Valuation hint card — the honest melt + suggested-buy assist
// ────────────────────────────────────────────────────────────────────────────

function ValuationHintCard({
  hint,
  onUseSuggestion,
}: {
  hint: ValuationHint
  onUseSuggestion: (eur: string) => void
}) {
  const t = useW14Theme()
  // Honest: nothing to show until a real rate can compute at least the melt. A
  // bare ruled note, not a boxed card.
  if (hint.meltCents == null && hint.suggestedCents == null) {
    return (
      <View className="hairline-t flex-row items-start gap-2 pt-2.5">
        <Info size={t.icon.xs} color={t.colors.mutedForeground} />
        <Text className="text-muted-foreground flex-1 text-2xs leading-4">
          Bewertungshilfe erscheint, sobald Gewicht, Feinheit und ein aktueller Metallkurs
          vorliegen.
        </Text>
      </View>
    )
  }
  const basisLabel =
    hint.basis === "ankauf"
      ? "Ankaufskurs (Marge berücksichtigt)"
      : hint.basis === "margin"
        ? "Schmelzwert abzüglich Sicherheitsmarge"
        : "Schmelzwert"
  // De-boxed: the live valuation assist sits on a single warm hairline, opened
  // by the gilt diamond seal — the melt + suggested figures in mono, never a
  // tinted box.
  return (
    <View className="hairline-t gap-2 pt-3">
      <View className="flex-row items-center gap-2">
        <GiltDiamond />
        <Text className="text-xs font-semibold" style={{ color: t.colors.foreground }}>
          Bewertungshilfe
        </Text>
      </View>
      {hint.meltCents != null ? (
        <View className="flex-row items-center justify-between">
          <Text className="text-muted-foreground text-xs">Schmelzwert (Kurs aktuell)</Text>
          <Text className="font-mono-medium text-sm">{formatCents(Number(hint.meltCents))}</Text>
        </View>
      ) : null}
      {hint.suggestedCents != null ? (
        <>
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-medium" style={{ color: t.colors.foreground }}>
              Vorschlag Ankauf
            </Text>
            <Text className="font-mono-medium text-base" style={{ color: t.colors.foreground }}>
              {formatCents(Number(hint.suggestedCents))}
            </Text>
          </View>
          <Text className="text-muted-foreground text-2xs">{basisLabel}</Text>
          <Button
            variant="outline"
            size="sm"
            onPress={() => {
              haptics.selection()
              onUseSuggestion(centsToEur(hint.suggestedCents as bigint))
            }}
            accessibilityLabel="Vorschlag als gezahlten Preis übernehmen"
          >
            <Text>Vorschlag übernehmen</Text>
          </Button>
        </>
      ) : null}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Success screen — the honest, sealed Ankauf-Beleg (preview + print + PDF share)
// ────────────────────────────────────────────────────────────────────────────

function AnkaufDoneScreen({
  receiptLocator,
  totalEur,
  count,
  receiptDoc,
  onNew,
  onClose,
}: {
  receiptLocator: string
  totalEur: string
  count: number
  receiptDoc: ReceiptDoc
  onNew: () => void
  onClose: () => void
}) {
  const t = useW14Theme()
  const insets = useScreenInsets()

  // The on-device print/share capability — resolved once. The owner can print the
  // Ankauf-Beleg via the OS print dialog (AirPrint / Android print framework) or
  // share it as a PDF (iOS + Android via expo-sharing). The certified counter
  // print still lives on the Desktop-Kasse — see the honest note below. This is
  // the exact Beleg surface the Verkauf done screen offers, so a buy-in ends with
  // the same faithful, shareable receipt a sale does.
  const caps = useMemo(() => getPrintCapabilities(), [])
  const printable = useMemo(() => ({ type: "receipt" as const, doc: receiptDoc }), [receiptDoc])

  // Which action is running, so each button shows its own "wird vorbereitet".
  const [busy, setBusy] = useState<null | "print" | "pdf">(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  // PRIMARY — one tap opens the OS print dialog (AirPrint / Android print).
  const onPrint = useCallback(async () => {
    if (busy) return
    setBusy("print")
    setActionError(null)
    haptics.selection()
    const res = await printPrintable(printable)
    setBusy(null)
    if (res.status === "ok") haptics.success()
    else if (res.status === "unsupported") setActionError(res.reason)
    else if (res.status === "error") setActionError(res.message)
    // "dismissed" is a normal user choice — no error, no haptic.
  }, [busy, printable])

  // SECONDARY — render a real PDF and hand it to the OS share sheet.
  const onSharePdf = useCallback(async () => {
    if (busy) return
    setBusy("pdf")
    setActionError(null)
    haptics.selection()
    const res = await sharePdfPrintable(printable, { dialogTitle: "Ankauf-Beleg als PDF teilen" })
    setBusy(null)
    if (res.status === "ok") haptics.success()
    else if (res.status === "unsupported") setActionError(res.reason)
    else if (res.status === "error") setActionError(res.message)
  }, [busy, printable])

  return (
    <View className="flex-1 bg-background">
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 24,
          // The "Ankauf" stack header already clears the safe area; adding
          // insets.screen.top here double-counted it and opened an empty band
          // under the header. A small top breath is enough.
          paddingTop: t.space.x4,
          paddingBottom: insets.contentBottom,
          gap: 20,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center gap-4 pt-2">
          {/* The sealed-receipt mark a verdigris seal ringed by a fine gilt
              hairline, the antique „festgeschrieben" flourish — gold as a seal,
              the one place it appears on this screen. */}
          <View
            className="h-20 w-20 items-center justify-center rounded-full"
            style={{
              backgroundColor: t.colors.verdigris + "1f",
              borderWidth: 1,
              borderColor: t.colors.gilt,
            }}
          >
            <Check size={36} color={t.colors.verdigris} />
          </View>
          <View className="items-center gap-1.5">
            <Text className="text-2xl font-display-semibold leading-tight">Ankauf ausgezahlt</Text>
            <Text className="text-muted-foreground text-center text-sm leading-5">
              Der Beleg ist TSE-signiert und im Kassenbuch festgeschrieben.{" "}
              {count > 0
                ? `${count} ${count === 1 ? "Artikel wurde" : "Artikel wurden"} angelegt.`
                : ""}
            </Text>
          </View>

          {/* De-boxed receipt summary: two bare rows ruled by a single warm
              hairline, the payout in display-scale mono — not a stacked card. */}
          <View className="hairline-t hairline-b w-full gap-2.5 py-3.5">
            <View className="flex-row items-center justify-between">
              <Text className="text-muted-foreground text-sm">Beleg-Nr.</Text>
              <Text className="font-mono-medium text-sm">{receiptLocator}</Text>
            </View>
            <Hairline />
            <View className="flex-row items-baseline justify-between">
              <Text className="text-base font-semibold">Auszahlung</Text>
              <Text className="font-mono-medium text-2xl">{formatEur(totalEur)}</Text>
            </View>
          </View>
        </View>

        {/* ── Beleg: a faithful copy of exactly this buy-in, to share/print ───── */}
        <View className="gap-3">
          <SectionLead icon={Receipt} title="Beleg" />

          {/* The on-screen Beleg the same lines and payout that were booked. A
              tap reveals the full receipt as it will be shared/printed. */}
          {previewOpen ? (
            <PrintPreview printable={printable} />
          ) : (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Beleg-Vorschau anzeigen"
              onPress={() => {
                haptics.selection()
                setPreviewOpen(true)
              }}
            >
              {/* De-boxed: a bare tappable row on a single warm hairline, the
                  leading Receipt mark sitting directly (no tinted chip box). */}
              <View className="hairline-t hairline-b flex-row items-center gap-3 py-3.5">
                <Receipt size={t.icon.md} color={t.colors.primary} />
                <View className="flex-1">
                  <Text className="text-sm font-semibold">Beleg-Vorschau anzeigen</Text>
                  <Text className="text-muted-foreground text-xs">
                    Die Belegkopie genau so, wie sie geteilt oder gedruckt wird.
                  </Text>
                </View>
                <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} />
              </View>
            </PressableScale>
          )}

          {actionError != null ? (
            <InlineError message={actionError} onDismiss={() => setActionError(null)} />
          ) : null}

          {/* PRIMARY one tap: open the OS print dialog. AirPrint on iOS, the
              Android print framework on Android; from there: any known printer or
              "als PDF sichern". Honestly disabled if the module is missing. */}
          <Button
            size="xl"
            onPress={() => void onPrint()}
            disabled={busy !== null || !caps.canPrintNative}
            accessibilityLabel="Beleg drucken"
          >
            <Printer size={t.icon.sm} color={t.colors.primaryForeground} />
            <Text>{busy === "print" ? "Wird vorbereitet…" : "Beleg drucken"}</Text>
          </Button>

          {/* SECONDARY render a PDF and share it (Dateien, Mail, …). */}
          {caps.canSharePdf ? (
            <Button
              variant="outline"
              size="xl"
              onPress={() => void onSharePdf()}
              disabled={busy !== null}
              accessibilityLabel="Beleg als PDF teilen"
            >
              <FileText size={t.icon.sm} color={t.colors.primary} />
              <Text>{busy === "pdf" ? "Wird vorbereitet…" : "Als PDF teilen"}</Text>
            </Button>
          ) : null}

          {!caps.canExportDocument ? <DesktopBelegNote /> : null}
        </View>

        {/* ── Weiter ──────────────────────────────────────────────────────────── */}
        <View className="gap-2 pt-1">
          <Button size="xl" onPress={onNew} accessibilityLabel="Neuen Ankauf starten">
            <Text>Neuer Ankauf</Text>
          </Button>
          <Button
            variant="outline"
            size="xl"
            onPress={onClose}
            accessibilityLabel="Ankauf schließen"
          >
            <Text>Fertig</Text>
          </Button>
        </View>
      </ScrollView>
    </View>
  )
}

/**
 * The honest note shown only on the rare device where NEITHER printing nor PDF
 * sharing is available: the certified counter print lives on the Desktop-Kasse,
 * and the precise reason + the real alternative are spelled out — never a
 * fabricated capability. Mirrors the Verkauf done-screen note.
 */
function DesktopBelegNote() {
  const t = useW14Theme()
  // De-boxed: the honest „print lives on the Desktop-Kasse" note is a run of bare
  // rows ruled by a single warm hairline above + below, the marks sitting
  // directly — no card, no nested tinted boxes.
  return (
    <View className="hairline-t hairline-b gap-3 py-3.5">
      <View className="flex-row items-center gap-2.5">
        <Monitor size={t.icon.md} color={t.colors.mutedForeground} />
        <View className="flex-1">
          <Text className="text-sm font-semibold">Beleg über den Desktop-Kassenplatz</Text>
          <Text className="text-muted-foreground text-xs">{escposRequirement.summary}</Text>
        </View>
      </View>
      <Hairline inset={28} />
      <View className="flex-row items-start gap-2.5">
        <View className="pt-0.5">
          <Info size={t.icon.md} color={t.colors.mutedForeground} />
        </View>
        <Text className="text-muted-foreground flex-1 text-xs leading-5">
          Auf diesem Gerät ist das Drucken des Belegs nicht verfügbar. Der zertifizierte Druck läuft
          über die Desktop-Kasse.
        </Text>
      </View>
      <View className="flex-row items-start gap-2.5">
        <View className="pt-0.5">
          <Printer size={t.icon.md} color={t.colors.primary} />
        </View>
        <Text className="text-muted-foreground flex-1 text-xs leading-5">
          {escposRequirement.alternative}
        </Text>
      </View>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** bigint cents → wire EUR string ("1999.99"), for the suggestion fill. */
function centsToEur(cents: bigint): string {
  const sign = cents < 0n ? "-" : ""
  const abs = cents < 0n ? -cents : cents
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`
}

/**
 * Build the minimal `CartTotals` the ReceiptPreview consumes for an Ankauf.
 * An Ankauf bears no output VAT, so each line is its negotiated price with zero
 * VAT, and the header total is the plain Σ — honest, no fabricated tax rows.
 */
function buildPreviewTotals(lines: readonly IntakeLine[]): CartTotals {
  const previewLines: CartTotals["lines"] = lines.map((l, i) => {
    const cents = eurToCents(l.negotiatedPriceEur)
    return {
      id: l.id,
      name: l.name || "Stück",
      sku: l.sku,
      qty: 1,
      // The buy-in preview prices each line at the negotiated payout. These two
      // fields exist on the shared CartLine; for an Ankauf preview the payout IS
      // the relevant figure, so both mirror it (no VAT decomposition is applied).
      listPriceEur: l.negotiatedPriceEur || "0",
      acquisitionCostEur: l.negotiatedPriceEur || "0",
      taxTreatmentCode: l.taxTreatmentCode,
      displayOrder: i,
      math: {
        lineTotalCents: cents,
        lineVatCents: 0n,
        lineSubtotalCents: cents,
        marginCents: null,
        appliedVatRate: null,
        acquisitionCostSnapshotCents: null,
        lineDiscountCents: 0n,
      },
    }
  })
  let total = 0n
  for (const l of previewLines) total += l.math.lineTotalCents
  return {
    lines: previewLines,
    header: { subtotalCents: total, vatCents: 0n, totalCents: total },
    vatGroups: [],
    itemCount: previewLines.length,
    isEmpty: previewLines.length === 0,
  }
}

/** Lenient EUR→cents for the preview (a partial/empty value reads as 0). */
function eurToCents(input: string): bigint {
  const eur = input.trim().replace(",", ".")
  if (eur === "" || eur === ".") return 0n
  if (!/^-?\d+(\.\d+)?$/.test(eur)) return 0n
  const sign = eur.startsWith("-") ? -1n : 1n
  const abs = eur.startsWith("-") ? eur.slice(1) : eur
  const [whole = "0", frac = ""] = abs.split(".")
  const fracPadded = frac.padEnd(2, "0").slice(0, 2)
  return sign * (BigInt(whole) * 100n + BigInt(fracPadded || "0"))
}
