/**
 * Warehouse14 Owner OS — the sell/transact spine.
 *
 * The pure, reusable cart + tender + fiscal-confirm vocabulary that BOTH money
 * paths share: Verkauf (finalize) and Ankauf (payout). Surfaces compose these;
 * they never reinvent the cart math, the keypad, or the legal confirm. The math
 * mirrors the audited server (transaction-math.ts) + tauri-pos contract exactly,
 * so a body built here passes the server's re-validation byte-for-byte.
 *
 *   cart-math     — bigint-cents money + per-Steuerschlüssel tax (server-faithful),
 *                   header sums, VAT grouping, the cash-tender split.
 *   cart          — the direction-agnostic cart model (reducer + useCart hook)
 *                   and its derived totals.
 *   build-finalize — turn a derived cart + tender into the exact FinalizeBody.
 *   idempotency   — the at-most-once UUIDv4 key for a commit.
 *   labels        — German Steuerschlüssel + Zahlungsart copy.
 *   MoneyKeypad   — the cash keypad (48px money targets, impactMedium haptic).
 *   CartLineRow / CartSummary — the cart UI on the shared spine.
 *   ReceiptPreview — the honest receipt-shaped preview of a pending commit.
 *   FiscalConfirmSheet — the ONE gate before any fiscal commit (explicit confirm,
 *                   step-up transparent, fiscal weight made visible, never auto-fires).
 */

// Math + model (pure)
export {
  toCents,
  fromCents,
  tryToCents,
  roundHalfEven,
  computeLineMath,
  lineForQuantity,
  sumHeaderCents,
  groupVat,
  computeTender,
  type LineMath,
  type HeaderTotalsCents,
  type VatGroup,
  type TenderSplit,
} from "./cart-math"

export {
  useCart,
  cartReducer,
  deriveCart,
  emptyCart,
  type CartLine,
  type CartLineView,
  type CartState,
  type CartAction,
  type CartTotals,
  type UseCart,
} from "./cart"

export {
  buildFinalizeBody,
  headerTaxTreatment,
  type BuildFinalizeParams,
} from "./build-finalize"

export { newIdempotencyKey } from "./idempotency"

export {
  TAX_TREATMENT_SHORT,
  TAX_TREATMENT_LONG,
  PAYMENT_METHOD_LABELS,
  formatVatRate,
} from "./labels"

// UI (composed on the shared spine)
export { MoneyKeypad, appendKey, type MoneyKeypadProps } from "./MoneyKeypad"
export { CartLineRow, type CartLineRowProps } from "./CartLineRow"
export { CartSummary, type CartSummaryProps } from "./CartSummary"
export { ReceiptPreview, type ReceiptPreviewProps } from "./ReceiptPreview"
export { FiscalConfirmSheet, type FiscalConfirmSheetProps } from "./FiscalConfirmSheet"
