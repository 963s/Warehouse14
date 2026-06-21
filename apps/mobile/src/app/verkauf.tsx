/**
 * Verkauf — the mobile POS sell flow. Search or scan an article into a cart,
 * choose how the customer pays, and finalize a legal, TSE-signed sale. This is a
 * MONEY-MOVEMENT + FISCAL surface, so it obeys the absolute rules (DESIGN.md +
 * the Owner OS fiscal doctrine):
 *
 *   • Client-only over the SERVER fiscal endpoint. The sale is written by
 *     `transactionsApi.finalize` (api: finalizeTransaction); the TSE signing,
 *     the §25a/§19 tax authority, the RESERVED→SOLD inventory lock and the
 *     ledger/hash-chain all happen SERVER-side. We never reimplement tax — the
 *     line money comes from the shared `cart-math` mirror, which the server
 *     re-validates byte-for-byte and refuses if it disagrees.
 *   • Reservation-backed. A line cannot be sold straight from AVAILABLE: the
 *     `useVerkaufSession` hook reserves each product (RESERVED) on add under one
 *     POS session, finalize releases it to SOLD, and a back-out releases it to
 *     AVAILABLE. Stock is never stranded.
 *   • The fiscal commit is gated. The `FiscalConfirmSheet` is the ONE gate: it
 *     never auto-fires (opening it is an explicit tap; the commit needs a SECOND
 *     explicit press), it makes the fiscal weight VISIBLE, and the step-up
 *     (403 STEP_UP_REQUIRED → the global PIN host) is transparent. The
 *     at-most-once idempotency key is generated once per sheet-open.
 *
 * Honesty rule is absolute here: every figure is a real summed cent value from
 * `cart-math` (formatted via formatCents), or a real EUR string from the
 * endpoint. Nothing is fabricated — an empty cart shows the empty state, a
 * reserve/finalize refusal shows the themed German message. Built on the shared
 * spine (search like Lager, the sell UI primitives, the §6 motion + §7 haptic
 * vocabulary, W14 theme tokens only). German UI, de-DE money.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, ScrollView, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import type { CustomerListRow, PaymentMethod, ProductListRow } from "@warehouse14/api-client"
import {
  Banknote,
  Check,
  CreditCard,
  IdCard,
  Landmark,
  Receipt,
  ScanFace,
  Search,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  UserRound,
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
  finalizeTransaction,
  formatCents,
  formatEur,
  getCustomer,
  getProduct,
  listCustomers,
  listProducts,
} from "@/warehouse14/api"
import { KYC_STATUS_LABEL, KYC_STATUS_VARIANT } from "@/warehouse14/customer-ui"
import { STATUS_LABEL, STATUS_VARIANT } from "@/warehouse14/product-ui"
import {
  buildFinalizeBody,
  CartLineRow,
  CartSummary,
  computeTender,
  evaluateVerkaufKyc,
  FiscalConfirmSheet,
  MoneyKeypad,
  newIdempotencyKey,
  PAYMENT_METHOD_LABELS,
  ReceiptPreview,
  tryToCents,
  useVerkaufSession,
  VERKAUF_KYC_THRESHOLD_CENTS,
} from "@/warehouse14/sell"
import { useW14Theme } from "@/warehouse14/theme"
import {
  EmptyState,
  haptics,
  InlineError,
  PressableScale,
  Skeleton,
  StaggerItem,
  useQuery,
  useScreenInsets,
} from "@/warehouse14/ui"

const DEBOUNCE_MS = 300
const SEARCH_LIMIT = 20

/** The tenders the mobile Verkauf offers. CASH drives the keypad + change; the
 *  cashless tenders pay the exact total (the terminal/transfer handles the rest).
 *  These are the V1 single-tender methods; the server accepts the full set. */
const TENDERS: { method: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { method: "CASH", label: PAYMENT_METHOD_LABELS.CASH, icon: Banknote },
  { method: "ZVT_CARD", label: PAYMENT_METHOD_LABELS.ZVT_CARD, icon: CreditCard },
  { method: "BANK_TRANSFER", label: PAYMENT_METHOD_LABELS.BANK_TRANSFER, icon: Landmark },
]

// ────────────────────────────────────────────────────────────────────────────
// Search results row — an AVAILABLE article you can add to the cart
// ────────────────────────────────────────────────────────────────────────────

function ResultRow({
  item,
  inCart,
  reserving,
  onAdd,
}: {
  item: ProductListRow
  inCart: boolean
  reserving: boolean
  onAdd: () => void
}) {
  const t = useW14Theme()
  const sellable = item.status === "AVAILABLE"
  // Only AVAILABLE stock can be reserved → sold. A SOLD/RESERVED/DRAFT row is
  // shown honestly with its status badge and is NOT addable (no fabricated path).
  const disabled = !sellable || inCart || reserving

  return (
    <PressableScale
      onPress={onAdd}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={
        inCart
          ? `${item.name} ist bereits im Warenkorb`
          : sellable
            ? `${item.name} zum Warenkorb hinzufügen, ${formatEur(item.listPriceEur)}`
            : `${item.name}, ${STATUS_LABEL[item.status]}, nicht verkäuflich`
      }
      style={{ opacity: disabled && !inCart ? 0.55 : 1 }}
    >
      <Card className="flex-row items-center gap-3 rounded-xl border px-3 py-3">
        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold" numberOfLines={1}>
            {item.name}
          </Text>
          <View className="flex-row items-center gap-2">
            <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
              {item.sku}
            </Text>
            {!sellable ? (
              <Badge variant={STATUS_VARIANT[item.status]} dot>
                <Text>{STATUS_LABEL[item.status]}</Text>
              </Badge>
            ) : null}
          </View>
        </View>

        <Text className="text-primary font-mono-medium text-base" numberOfLines={1}>
          {formatEur(item.listPriceEur)}
        </Text>

        {/* The add affordance: a brass plus disc for sellable stock, a verdigris
            check once it's in the cart, nothing for non-sellable rows. */}
        {inCart ? (
          <View
            className="h-8 w-8 items-center justify-center rounded-md"
            style={{ backgroundColor: t.colors.verdigris + "1f" }}
          >
            <Check size={t.icon.sm} color={t.colors.verdigris} />
          </View>
        ) : sellable ? (
          <View
            className="h-8 w-8 items-center justify-center rounded-md"
            style={{ backgroundColor: t.colors.primary + "1f", opacity: reserving ? 0.5 : 1 }}
          >
            <Text className="text-primary text-lg font-semibold">+</Text>
          </View>
        ) : null}
      </Card>
    </PressableScale>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Tender picker + cash keypad
// ────────────────────────────────────────────────────────────────────────────

function TenderPicker({
  method,
  onPick,
}: {
  method: PaymentMethod
  onPick: (m: PaymentMethod) => void
}) {
  const t = useW14Theme()
  return (
    <View className="flex-row gap-2">
      {TENDERS.map(({ method: m, label, icon: Icon }) => {
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
            accessibilityLabel={`Zahlungsart ${label}`}
            style={{ minHeight: t.touch.comfortable }}
            className="flex-1 items-center justify-center gap-1 rounded-md border px-2 py-2"
          >
            <View
              className="items-center justify-center"
              style={{ borderColor: active ? t.colors.primary : t.colors.border }}
            >
              <Icon size={t.icon.md} color={active ? t.colors.primary : t.colors.mutedForeground} />
            </View>
            <Text
              className="text-xs font-medium"
              style={{ color: active ? t.colors.primary : t.colors.mutedForeground }}
              numberOfLines={1}
            >
              {label}
            </Text>
          </PressableScale>
        )
      })}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Skeleton for the search results
// ────────────────────────────────────────────────────────────────────────────

function ResultsSkeleton() {
  return (
    <View className="gap-2.5" accessibilityElementsHidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i} className="flex-row items-center gap-3 rounded-xl border px-3 py-3">
          <View className="flex-1 gap-2">
            <Skeleton width="64%" height={14} />
            <Skeleton width="34%" height={11} />
          </View>
          <Skeleton width={60} height={14} />
          <Skeleton width={32} height={32} radius="button" />
        </Card>
      ))}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Screen
// ────────────────────────────────────────────────────────────────────────────

export default function VerkaufScreen() {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const router = useRouter()

  const session = useVerkaufSession()
  const { cart, addProduct, removeLine, clearAll, markFinalized } = session
  const totals = cart.totals

  // ── Käufer (optional below the §10 line; required + verified at/above it) ────
  // A buyer is OPTIONAL for a normal sale (pure attribution / cumulative-spend
  // link), but the api-cloud finalize route hard-rejects a sale whose total is
  // at/above the GwG §10 threshold (default €2.000) without a KYC-verified buyer
  // (KYC_REQUIRED, 403). So we attach a customer and mirror that gate honestly.
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const customerQ = useQuery(() => getCustomer(customerId as string), {
    key: `verkauf:customer:${customerId}`,
    enabled: !!customerId,
  })
  const customer = customerId ? (customerQ.data ?? null) : null

  // The buyer's KYC may have been stamped on the detail screen we just returned
  // from, so re-read it on focus (mirrors the Ankauf seller gate).
  useFocusEffect(
    useCallback(() => {
      if (customerId) void customerQ.refetch()
      // refetch identity is stable for a fixed key
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customerId]),
  )

  // ── Search (debounced, mirrors the Lager tab) ──────────────────────────────
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

  // Only AVAILABLE stock is sellable, so we scope the search to it — the operator
  // never sees a SOLD row dangling an add button. A short query still searches;
  // an empty query lists recent available stock so the screen is useful at rest.
  const results = useQuery(
    () => listProducts({ q: debouncedQ || undefined, status: "AVAILABLE", limit: SEARCH_LIMIT }),
    { key: `verkauf:search:${debouncedQ}` },
  )

  // ── Tender state ───────────────────────────────────────────────────────────
  const [method, setMethod] = useState<PaymentMethod>("CASH")
  // The cash "Erhalten" string (de-DE), driving change/shortfall via computeTender.
  const [cashReceived, setCashReceived] = useState("")

  const totalCents = totals.header.totalCents
  const tender = useMemo(
    () => computeTender({ dueCents: totalCents, receivedCents: tryToCents(cashReceived) ?? 0n }),
    [totalCents, cashReceived],
  )

  // ── §10 GwG buyer-identity gate (mirrors the server's VERKAUF rule) ──────────
  // At/above the threshold a KYC-verified buyer is REQUIRED; below it the buyer
  // is optional. When `blocked`, the server would 403 KYC_REQUIRED, so the fiscal
  // gate must stay shut until a verified buyer is attached.
  const kyc = useMemo(
    () => evaluateVerkaufKyc({ customer, totalCents }),
    [customer, totalCents],
  )

  // ── Fiscal confirm + finalize ──────────────────────────────────────────────
  const [confirmOpen, setConfirmOpen] = useState(false)
  // One idempotency key per sheet-open — sent unchanged on every retry so a
  // lost-response retry never double-books (transactions.ts §19.2 C-4).
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => newIdempotencyKey())
  // The receipt after a successful sale — the honest "what was just booked".
  const [done, setDone] = useState<{ receiptLocator: string; totalEur: string } | null>(null)

  // A detail-read failure (before the reserve) is surfaced separately from the
  // session's reserve error so both can show without clobbering each other.
  const [detailError, setDetailError] = useState<string | null>(null)

  const onAdd = useCallback(
    async (row: ProductListRow) => {
      haptics.selection()
      // The cart line needs the DETAIL's tax fields (taxTreatmentCode +
      // acquisitionCostEur live on the detail, never the list row), so read the
      // detail, THEN reserve+add. A failure (sold out from under us, transport)
      // surfaces as the session error; the cart is unchanged.
      try {
        const detail = await getProduct(row.id)
        const line = await addProduct(detail)
        if (line) haptics.success()
        else haptics.error()
      } catch (e) {
        haptics.error()
        // Reuse the session error channel by routing through addProduct's catch is
        // not possible here (detail read failed before reserve), so surface inline.
        setDetailError(describeError(e))
      }
    },
    [addProduct],
  )

  const openConfirm = useCallback(() => {
    if (totals.isEmpty) return
    // §10 GwG: a sale at/above the threshold needs a KYC-verified buyer. We never
    // open the fiscal gate on a sale the server would refuse with KYC_REQUIRED.
    if (kyc.blocked) {
      haptics.error()
      return
    }
    // For a cash sale, require the received amount to cover the due before the
    // fiscal gate can open — we never finalize a cash sale we can't make change
    // for. Cashless tenders pay the exact total, so they open straight away.
    if (method === "CASH" && !tender.covered) {
      haptics.error()
      return
    }
    haptics.impactLight() // light press confirm as the fiscal sheet opens (§7)
    setConfirmOpen(true)
  }, [totals.isEmpty, kyc.blocked, method, tender.covered])

  // The legal commit handed to the FiscalConfirmSheet. It builds the exact
  // FinalizeBody from the derived cart + tender, POSTs it (step-up transparent),
  // and on success marks the reservations consumed + shows the receipt. A throw
  // lands in the sheet's InlineError; the SAME idempotency key is retried safely.
  const commit = useCallback(async () => {
    const body = buildFinalizeBody({
      totals,
      // The attached buyer (or null for an anonymous walk-in below the §10 line).
      // It rides into the finalize so the sale is buyer-attributed (cumulative
      // spend) and clears the GwG identity gate at/above the threshold.
      customerId,
      idempotencyKey,
      payment: { method },
    })
    const res = await finalizeTransaction(body)
    // RESERVED → SOLD happened server-side — abandon the release bookkeeping.
    markFinalized()
    setDone({ receiptLocator: res.receiptLocator, totalEur: res.totalEur })
  }, [totals, customerId, idempotencyKey, method, markFinalized])

  const onConfirmed = useCallback(() => {
    // After a sealed sale: clear the cart (holds already consumed), reset tender,
    // detach the buyer, and arm a fresh idempotency key for the next sale.
    cart.clear()
    setCashReceived("")
    setMethod("CASH")
    setCustomerId(null)
    setIdempotencyKey(newIdempotencyKey())
  }, [cart])

  // The success screen after a finalized sale — honest receipt locator + total.
  if (done) {
    return (
      <SaleDoneScreen
        receiptLocator={done.receiptLocator}
        totalEur={done.totalEur}
        onNewSale={() => {
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

  const canCheckout =
    !totals.isEmpty && !kyc.blocked && (method !== "CASH" || tender.covered)

  return (
    <View className="flex-1 bg-background">
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
        {/* ── Suche ─────────────────────────────────────────────────────────── */}
        <View className="gap-3">
          <View className="relative justify-center">
            <View className="absolute left-3 z-10">
              <Search size={t.icon.sm} color={t.colors.mutedForeground} />
            </View>
            <Input
              value={q}
              onChangeText={setQ}
              placeholder="Artikel suchen: SKU, Name, Barcode…"
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
              className="pl-9 pr-9"
              accessibilityLabel="Artikel für den Verkauf suchen"
            />
            {q.length > 0 ? (
              <Pressable
                onPress={() => {
                  haptics.selection()
                  setQ("")
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Suche löschen"
                className="absolute right-2.5 z-10 h-6 w-6 items-center justify-center"
              >
                <X size={t.icon.sm} color={t.colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>

          {detailError != null ? (
            <InlineError message={detailError} onDismiss={() => setDetailError(null)} />
          ) : null}
          {session.error != null ? (
            <InlineError message={session.error} onDismiss={session.clearError} />
          ) : null}

          {/* Results — AVAILABLE stock only; honest empty/loading/error. */}
          {results.status === "loading" && results.data == null ? (
            <ResultsSkeleton />
          ) : results.data != null && results.data.items.length === 0 ? (
            <EmptyState
              icon={Search}
              title={debouncedQ ? "Keine Treffer" : "Kein verfügbarer Artikel"}
              description={
                debouncedQ
                  ? "Für diese Suche ist kein verkäuflicher Artikel im Lager. Suchbegriff anpassen."
                  : "Sobald verfügbare Artikel im Lager sind, erscheinen sie hier zum Verkauf."
              }
            />
          ) : results.data != null ? (
            <View className="gap-2.5">
              {results.data.items.map((item, index) => (
                <StaggerItem key={item.id} index={Math.min(index, 8)} exit={false}>
                  <ResultRow
                    item={item}
                    inCart={cart.state.lines.some((l) => l.id === item.id)}
                    reserving={session.reservingIds.has(item.id)}
                    onAdd={() => void onAdd(item)}
                  />
                </StaggerItem>
              ))}
            </View>
          ) : results.error != null ? (
            <InlineError message={results.error} onRetry={() => void results.refetch()} />
          ) : null}
        </View>

        {/* ── Warenkorb ─────────────────────────────────────────────────────── */}
        <View className="gap-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <ShoppingCart size={t.icon.md} color={t.colors.primary} />
              <Text className="text-base font-semibold">Warenkorb</Text>
              {totals.itemCount > 0 ? (
                <Badge variant="outline">
                  <Text>{totals.itemCount}</Text>
                </Badge>
              ) : null}
            </View>
            {!totals.isEmpty ? (
              <Pressable
                onPress={() => {
                  haptics.selection()
                  clearAll()
                  setCashReceived("")
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Warenkorb leeren"
                className="flex-row items-center gap-1 px-1.5 py-1"
              >
                <Trash2 size={t.icon.xs} color={t.colors.mutedForeground} />
                <Text className="text-muted-foreground text-xs">Leeren</Text>
              </Pressable>
            ) : null}
          </View>

          {totals.isEmpty ? (
            <Card className="px-4 py-6">
              <View className="items-center gap-1.5">
                <ShoppingCart size={t.icon.xl} color={t.colors.mutedForeground} />
                <Text className="text-muted-foreground text-center text-sm">
                  Noch kein Artikel im Warenkorb. Oben suchen und hinzufügen.
                </Text>
              </View>
            </Card>
          ) : (
            <Card className="px-4 py-2">
              {totals.lines.map((line) => (
                <CartLineRow
                  key={line.id}
                  line={line}
                  editableQty={false}
                  onRemove={() => {
                    haptics.selection()
                    removeLine(line.id)
                  }}
                />
              ))}
            </Card>
          )}
        </View>

        {/* ── Zusammenfassung + Bezahlen ────────────────────────────────────── */}
        {!totals.isEmpty ? (
          <>
            <Card className="gap-3 px-4 py-4">
              <CartSummary totals={totals} />
            </Card>

            {/* ── Käufer ─────────────────────────────────────────────────────── */}
            {/* Optional below the §10 line (buyer attribution / cumulative spend),
                REQUIRED + verified at/above it. The threshold note + KYC gate make
                the fiscal weight visible BEFORE the commit. */}
            <View className="gap-3">
              <View className="flex-row items-center gap-2">
                <UserRound size={t.icon.md} color={t.colors.primary} />
                <Text className="text-base font-semibold">Käufer</Text>
                {kyc.thresholdReached ? (
                  <Badge variant="outline">
                    <Text>Pflicht ab {formatCents(Number(VERKAUF_KYC_THRESHOLD_CENTS))}</Text>
                  </Badge>
                ) : (
                  <Text className="text-muted-foreground text-xs">Optional</Text>
                )}
              </View>

              {customerId == null ? (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Käufer auswählen"
                  onPress={() => {
                    haptics.selection()
                    setPickerOpen(true)
                  }}
                >
                  <Card
                    className="min-h-[56px] flex-row items-center gap-3 rounded-xl border px-4 py-3"
                    style={{
                      borderColor: kyc.blocked ? t.colors.primary + "55" : t.colors.border,
                      backgroundColor: kyc.blocked ? t.colors.primary + "0D" : t.colors.card,
                    }}
                  >
                    <View
                      className="h-9 w-9 items-center justify-center rounded-md"
                      style={{ backgroundColor: t.colors.primary + "1f" }}
                    >
                      <Search size={t.icon.md} color={t.colors.primary} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-base font-semibold">Käufer auswählen</Text>
                      <Text className="text-muted-foreground text-xs">
                        {kyc.thresholdReached
                          ? "Pflicht — ab dieser Höhe verlangt der Verkauf eine geprüfte Identität."
                          : "Optional — verknüpft den Kauf mit dem Kunden (Kundenhistorie)."}
                      </Text>
                    </View>
                  </Card>
                </PressableScale>
              ) : customerQ.isLoading && customer == null ? (
                <Card className="flex-row items-center gap-3 rounded-xl border px-4 py-3">
                  <Skeleton width={44} height={44} radius="full" />
                  <View className="flex-1 gap-2">
                    <Skeleton width="56%" height={14} />
                    <Skeleton width="32%" height={11} />
                  </View>
                </Card>
              ) : customer != null ? (
                <BuyerCard
                  fullName={customer.fullName}
                  customerNumber={customer.customerNumber}
                  kycStatus={customer.kycStatus}
                  onChange={() => {
                    haptics.selection()
                    setPickerOpen(true)
                  }}
                  onRemove={() => {
                    haptics.selection()
                    setCustomerId(null)
                  }}
                />
              ) : (
                <InlineError
                  message={customerQ.error ?? "Der Kunde konnte nicht geladen werden."}
                  onRetry={() => void customerQ.refetch()}
                />
              )}

              {/* The honest §10 gate: a sale at/above the threshold without a
                  verified buyer is blocked — with a one-tap path to stamp the
                  Ausweis in the profile. Never a fabricated green. */}
              {kyc.blocked ? (
                <BuyerKycGate
                  hasCustomer={customer != null}
                  fullName={customer?.fullName ?? null}
                  onAction={() => {
                    haptics.selection()
                    if (customer != null) {
                      router.push({ pathname: "/customer/[id]", params: { id: customer.id } })
                    } else {
                      setPickerOpen(true)
                    }
                  }}
                />
              ) : customer != null && kyc.kycVerified ? (
                <View
                  className="flex-row items-center gap-2 rounded-xl px-3 py-2"
                  style={{ backgroundColor: t.colors.verdigris + "12" }}
                >
                  <ShieldCheck size={t.icon.sm} color={t.colors.verdigris} />
                  <Text className="text-xs font-medium" style={{ color: t.colors.verdigris }}>
                    Identität geprüft — Verkauf zulässig.
                  </Text>
                </View>
              ) : null}
            </View>

            <View className="gap-3">
              <Text className="text-base font-semibold">Zahlungsart</Text>
              <TenderPicker method={method} onPick={setMethod} />

              {/* Cash → the keypad + live change/shortfall. Cashless → a calm note
                  that the terminal/transfer settles the exact total. */}
              {method === "CASH" ? (
                <Card className="gap-3 px-4 py-4">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-muted-foreground text-sm">Erhalten</Text>
                    <Text className="font-mono-medium text-xl">
                      {cashReceived === "" ? "0,00 €" : `${cashReceived} €`}
                    </Text>
                  </View>

                  <MoneyKeypad
                    value={cashReceived}
                    onChange={setCashReceived}
                    quickCash={cashQuickChips(totalCents)}
                    accessibilityLabelPrefix="Bargeld Ziffer"
                  />

                  {/* Live tender feedback — change (verdigris) or shortfall (brass). */}
                  {tryToCents(cashReceived) != null && cashReceived !== "" ? (
                    <View
                      className="flex-row items-center justify-between rounded-xl px-3 py-2.5"
                      style={{
                        backgroundColor:
                          (tender.covered ? t.colors.verdigris : t.colors.primary) + "12",
                      }}
                    >
                      <Text
                        className="text-sm font-medium"
                        style={{ color: tender.covered ? t.colors.verdigris : t.colors.primary }}
                      >
                        {tender.covered ? "Rückgeld" : "Noch offen"}
                      </Text>
                      <Text
                        className="font-mono-medium text-base"
                        style={{ color: tender.covered ? t.colors.verdigris : t.colors.primary }}
                      >
                        {formatCents(
                          Number(tender.covered ? tender.changeCents : tender.shortfallCents),
                        )}
                      </Text>
                    </View>
                  ) : null}
                </Card>
              ) : (
                <Card className="px-4 py-3">
                  <Text className="text-muted-foreground text-sm leading-5">
                    {method === "ZVT_CARD"
                      ? "Der Betrag wird am Kartenterminal abgewickelt. Der Beleg erfasst die Kartenzahlung."
                      : "Die Zahlung erfolgt per Überweisung. Der Beleg erfasst den offenen Betrag."}
                  </Text>
                </Card>
              )}
            </View>

            {/* The fiscal gate opener — NEVER the commit itself. A clearly marked
                fiskalische Aktion that opens the confirm sheet (which then needs a
                second, explicit press). 48px money target. */}
            <View className="gap-2 pt-1">
              <View className="flex-row items-center gap-1.5">
                <Receipt size={t.icon.xs} color={t.colors.primary} />
                <Text className="text-xs font-semibold" style={{ color: t.colors.primary }}>
                  Fiskalische Aktion
                </Text>
              </View>
              <Button
                size="xl"
                onPress={openConfirm}
                disabled={!canCheckout}
                accessibilityLabel={`Verkauf über ${formatCents(Number(totalCents))} abschließen`}
              >
                <Receipt size={t.icon.sm} color={t.colors.primaryForeground} />
                <Text>{`Verkaufen · ${formatCents(Number(totalCents))}`}</Text>
              </Button>
              {kyc.blocked ? (
                <Text className="text-muted-foreground text-center text-xs">
                  {customer != null
                    ? "Identität des Käufers zuerst prüfen (KYC)."
                    : "Ab dieser Höhe zuerst einen geprüften Käufer zuordnen."}
                </Text>
              ) : method === "CASH" && !tender.covered ? (
                <Text className="text-muted-foreground text-center text-xs">
                  Bitte den erhaltenen Bargeldbetrag eingeben.
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* The buyer picker sheet — search + attach a customer to the sale. */}
      <CustomerPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(row) => {
          haptics.selection()
          setCustomerId(row.id)
          setPickerOpen(false)
        }}
      />

      {/* The ONE fiscal gate. It owns the commit lifecycle (busy/error/success),
          the legal framing, the step-up transparency, and the money-path haptic.
          We hand it the honest receipt preview + the exact async commit. */}
      <FiscalConfirmSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={commit}
        onConfirmed={onConfirmed}
        title="Verkauf abschließen"
        amountCaption="Zu zahlen"
        amountLabel={formatCents(Number(totalCents))}
        confirmLabel="Verkauf abschließen"
      >
        <ReceiptPreview
          totals={totals}
          kind="Verkauf"
          payment={{
            method,
            receivedCents: method === "CASH" ? (tryToCents(cashReceived) ?? undefined) : undefined,
            changeCents: method === "CASH" ? tender.changeCents : undefined,
          }}
        />
      </FiscalConfirmSheet>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Success screen — the honest, sealed receipt after a finalized sale
// ────────────────────────────────────────────────────────────────────────────

function SaleDoneScreen({
  receiptLocator,
  totalEur,
  onNewSale,
  onClose,
}: {
  receiptLocator: string
  totalEur: string
  onNewSale: () => void
  onClose: () => void
}) {
  const t = useW14Theme()
  const insets = useScreenInsets()
  return (
    <View
      className="flex-1 bg-background px-6"
      style={{ paddingTop: insets.screen.top + t.space.x8, paddingBottom: insets.contentBottom }}
    >
      <View className="flex-1 items-center justify-center gap-5">
        <View
          className="h-20 w-20 items-center justify-center rounded-full"
          style={{ backgroundColor: t.colors.verdigris + "1f" }}
        >
          <Check size={36} color={t.colors.verdigris} />
        </View>
        <View className="items-center gap-1.5">
          <Text className="text-xl font-bold">Verkauf abgeschlossen</Text>
          <Text className="text-muted-foreground text-center text-sm leading-5">
            Der Beleg ist TSE-signiert und im Kassenbuch festgeschrieben.
          </Text>
        </View>

        <Card className="w-full gap-2 px-4 py-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-muted-foreground text-sm">Beleg-Nr.</Text>
            <Text className="font-mono-medium text-sm">{receiptLocator}</Text>
          </View>
          <View className="h-px bg-border" />
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-semibold">Gesamt</Text>
            <Text className="font-mono-medium text-xl">{formatEur(totalEur)}</Text>
          </View>
        </Card>
      </View>

      <View className="gap-2">
        <Button size="xl" onPress={onNewSale} accessibilityLabel="Neuen Verkauf starten">
          <Text>Neuer Verkauf</Text>
        </Button>
        <Button
          variant="outline"
          size="xl"
          onPress={onClose}
          accessibilityLabel="Verkauf schließen"
        >
          <Text>Fertig</Text>
        </Button>
      </View>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Buyer card — the attached customer, with the KYC status an operator scans
// ────────────────────────────────────────────────────────────────────────────

function BuyerCard({
  fullName,
  customerNumber,
  kycStatus,
  onChange,
  onRemove,
}: {
  fullName: string
  customerNumber: string
  kycStatus: keyof typeof KYC_STATUS_LABEL
  onChange: () => void
  onRemove: () => void
}) {
  const t = useW14Theme()
  return (
    <Card className="gap-3 rounded-xl border px-4 py-3">
      <View className="flex-row items-center gap-3">
        <View
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: t.colors.primary + "1f" }}
        >
          <Text className="text-sm font-semibold" style={{ color: t.colors.primary }}>
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
        <View className="flex-row items-center gap-1">
          <Button variant="ghost" size="sm" onPress={onChange} accessibilityLabel="Käufer wechseln">
            <Text className="text-primary">Wechseln</Text>
          </Button>
          <Pressable
            onPress={onRemove}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Käufer entfernen"
            className="h-8 w-8 items-center justify-center rounded-md"
          >
            <X size={t.icon.sm} color={t.colors.mutedForeground} />
          </Pressable>
        </View>
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        <Badge variant={KYC_STATUS_VARIANT[kycStatus]} dot>
          <Text>{KYC_STATUS_LABEL[kycStatus]}</Text>
        </Badge>
      </View>
    </Card>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Buyer KYC gate — the honest §10 block, with a path to verify (or to pick one)
// ────────────────────────────────────────────────────────────────────────────

function BuyerKycGate({
  hasCustomer,
  fullName,
  onAction,
}: {
  hasCustomer: boolean
  fullName: string | null
  onAction: () => void
}) {
  const t = useW14Theme()
  return (
    <Card
      className="gap-3 rounded-xl border px-4 py-3.5"
      style={{ borderColor: t.colors.primary + "55", backgroundColor: t.colors.primary + "0F" }}
      accessibilityRole="alert"
    >
      <View className="flex-row items-start gap-2.5">
        <View className="pt-0.5">
          <IdCard size={t.icon.md} color={t.colors.primary} />
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-sm font-semibold" style={{ color: t.colors.primary }}>
            Identifizierung erforderlich (§ 10 GwG)
          </Text>
          <Text className="text-muted-foreground text-sm leading-5">
            {hasCustomer && fullName != null
              ? `Ab ${formatCents(Number(VERKAUF_KYC_THRESHOLD_CENTS))} verlangt der Verkauf eine geprüfte Ausweis-Identifikation des Käufers. „${fullName}“ ist noch nicht bestätigt.`
              : `Ab ${formatCents(Number(VERKAUF_KYC_THRESHOLD_CENTS))} verlangt der Verkauf einen geprüften Käufer. Bitte einen Käufer mit bestätigter Identität zuordnen.`}
          </Text>
        </View>
      </View>
      <Button
        onPress={onAction}
        accessibilityLabel={hasCustomer ? "Identität jetzt prüfen" : "Käufer auswählen"}
      >
        <ScanFace size={t.icon.sm} color={t.colors.primaryForeground} />
        <Text>{hasCustomer ? "Identität prüfen" : "Käufer auswählen"}</Text>
      </Button>
    </Card>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Customer picker sheet — search + attach the buyer
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

  // A BANNED buyer is a compliance dead end (the server refuses the sale), so we
  // exclude blocked customers honestly rather than offering a pick that can't pay.
  const results = useQuery(
    () => listCustomers({ q: debouncedQ || undefined, excludeBlocked: true, limit: 30 }),
    { key: `verkauf:picker:${debouncedQ}`, enabled: open },
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4">
        <DialogHeader>
          <DialogTitle>Käufer wählen</DialogTitle>
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
            accessibilityLabel="Käufer durchsuchen"
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
                <Card key={i} className="flex-row items-center gap-3 rounded-xl border px-3 py-3">
                  <Skeleton width={40} height={40} radius="full" />
                  <View className="flex-1 gap-2">
                    <Skeleton width="58%" height={13} />
                    <Skeleton width="32%" height={10} />
                  </View>
                </Card>
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
                <Card className="flex-row items-center gap-3 rounded-xl border px-3 py-3">
                  <View
                    className="h-10 w-10 items-center justify-center rounded-full"
                    style={{ backgroundColor: t.colors.primary + "1f" }}
                  >
                    <Text className="text-xs font-semibold" style={{ color: t.colors.primary }}>
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
                </Card>
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
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** First letters of the first + last name parts → the calm avatar monogram. */
function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * The quick-cash chips for the keypad: the exact due (passend), rounded up to
 * the next convenient note, and the common notes above the total — so a cash
 * sale is one or two taps. All derived from the REAL due cents; never fabricated.
 */
function cashQuickChips(dueCents: bigint): number[] {
  const dueEur = Math.ceil(Number(dueCents) / 100)
  if (dueEur <= 0) return [10, 20, 50]
  const notes = [5, 10, 20, 50, 100, 200, 500]
  const chips = new Set<number>()
  chips.add(dueEur) // passend (the exact, ceil-to-euro amount)
  for (const n of notes) {
    if (n >= dueEur) {
      chips.add(n)
      if (chips.size >= 4) break
    }
  }
  return [...chips].sort((a, b) => a - b).slice(0, 4)
}
