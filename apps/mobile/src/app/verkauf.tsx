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
import { FlatList, Pressable, ScrollView, View } from "react-native"
import { useRouter } from "expo-router"
import type { PaymentMethod, ProductListRow } from "@warehouse14/api-client"
import {
  Banknote,
  Check,
  CreditCard,
  Landmark,
  Receipt,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import {
  describeError,
  finalizeTransaction,
  formatCents,
  formatEur,
  getProduct,
  listProducts,
} from "@/warehouse14/api"
import { STATUS_LABEL, STATUS_VARIANT } from "@/warehouse14/product-ui"
import {
  appendKey,
  buildFinalizeBody,
  CartLineRow,
  CartSummary,
  computeTender,
  FiscalConfirmSheet,
  MoneyKeypad,
  newIdempotencyKey,
  PAYMENT_METHOD_LABELS,
  ReceiptPreview,
  tryToCents,
  useVerkaufSession,
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
    // For a cash sale, require the received amount to cover the due before the
    // fiscal gate can open — we never finalize a cash sale we can't make change
    // for. Cashless tenders pay the exact total, so they open straight away.
    if (method === "CASH" && !tender.covered) {
      haptics.error()
      return
    }
    haptics.impactLight() // light press confirm as the fiscal sheet opens (§7)
    setConfirmOpen(true)
  }, [totals.isEmpty, method, tender.covered])

  // The legal commit handed to the FiscalConfirmSheet. It builds the exact
  // FinalizeBody from the derived cart + tender, POSTs it (step-up transparent),
  // and on success marks the reservations consumed + shows the receipt. A throw
  // lands in the sheet's InlineError; the SAME idempotency key is retried safely.
  const commit = useCallback(async () => {
    const body = buildFinalizeBody({
      totals,
      customerId: null,
      idempotencyKey,
      payment: { method },
    })
    const res = await finalizeTransaction(body)
    // RESERVED → SOLD happened server-side — abandon the release bookkeeping.
    markFinalized()
    setDone({ receiptLocator: res.receiptLocator, totalEur: res.totalEur })
  }, [totals, idempotencyKey, method, markFinalized])

  const onConfirmed = useCallback(() => {
    // After a sealed sale: clear the cart (holds already consumed), reset tender,
    // and arm a fresh idempotency key for the next sale.
    cart.clear()
    setCashReceived("")
    setMethod("CASH")
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

  const canCheckout = !totals.isEmpty && (method !== "CASH" || tender.covered)

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
              {method === "CASH" && !tender.covered ? (
                <Text className="text-muted-foreground text-center text-xs">
                  Bitte den erhaltenen Bargeldbetrag eingeben.
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>

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
// Helpers
// ────────────────────────────────────────────────────────────────────────────

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
