/**
 * Transactions domain client. Mirrors the backend schemas exactly.
 *
 *   finalize(body) — POST /api/transactions/finalize   (Verkauf, Day 13)
 *   ankauf(body)   — POST /api/transactions/ankauf     (Day 8)
 *
 * The two routes are deliberately separate (see ADR `day8-domain-decision.md`
 * §15.2). Verkauf releases RESERVED → SOLD via inventory-lock; Ankauf
 * creates products in the same DB transaction as the Ankauf transaction.
 * Different write semantics → different routes → different schemas.
 *
 * Math helpers for the V1 Verkauf client live in
 * `apps/tauri-pos/src/lib/cart-math.ts`. Ankauf math helpers live in
 * `apps/tauri-pos/src/lib/intake-math.ts`.
 */

import type { ApiClient } from '../client.js';
import type { TaxTreatmentCode } from './products.js';

export type TransactionDirection = 'VERKAUF' | 'ANKAUF';

export type PaymentMethod =
  | 'CASH'
  | 'ZVT_CARD'
  | 'SUMUP'
  | 'MOLLIE'
  | 'STRIPE'
  | 'EBAY'
  | 'BANK_TRANSFER'
  | 'VOUCHER';

export interface FinalizeLineItem {
  productId: string;
  reservationSessionId: string;
  lineSubtotalEur: string;
  lineVatEur: string;
  lineTotalEur: string;
  appliedTaxTreatmentCode: TaxTreatmentCode;
  appliedVatRate: string | null;
  acquisitionCostEurSnapshot: string | null;
  marginEur: string | null;
  displayOrder?: number;
}

export interface FinalizePayment {
  paymentMethod: PaymentMethod;
  amountEur: string;
  externalRef?: string;
  zvtTerminalId?: string;
  zvtReceiptNumber?: string;
  zvtCardBrand?: string;
  zvtCardPanMasked?: string;
  molliePaymentId?: string;
}

export interface FinalizeBody {
  direction: TransactionDirection;
  customerId: string | null;
  subtotalEur: string;
  vatEur: string;
  totalEur: string;
  taxTreatmentCode: TaxTreatmentCode;
  items: FinalizeLineItem[];
  payments: FinalizePayment[];
  /**
   * §19.2 C-4 — UUIDv4 generated client-side once per Bezahlen dialog
   * open. Sent UNCHANGED on every retry. The server's partial UNIQUE
   * INDEX guarantees at-most-once finalize: a lost-response retry
   * returns the original transaction row, not a duplicate.
   */
  idempotencyKey: string;
  stornoOfTransactionId?: string;
  notesInternal?: string;
}

export interface FinalizeResponse {
  id: string;
  receiptLocator: string;
  finalizedAt: string;
  ledgerEventId: number;
  direction: TransactionDirection;
  totalEur: string;
  storno: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Ankauf — POST /api/transactions/ankauf (Day 8 dedicated route)
// ────────────────────────────────────────────────────────────────────────

export type AnkaufPayoutMethod = 'CASH' | 'BANK_TRANSFER';

export type AnkaufItemType =
  | 'gold_jewelry' | 'gold_coin' | 'gold_bar'
  | 'silver_jewelry' | 'silver_coin' | 'silver_bar'
  | 'platinum_jewelry' | 'platinum_coin' | 'platinum_bar'
  | 'antique' | 'watch' | 'other';

export type AnkaufMetal = 'gold' | 'silver' | 'platinum' | 'palladium';

export type AnkaufCondition =
  | 'NEW'
  | 'USED_EXCELLENT'
  | 'USED_GOOD'
  | 'USED_FAIR'
  | 'ANTIQUE_RESTORED'
  | 'ANTIQUE_AS_FOUND';

export interface AnkaufLineItem {
  sku: string;
  barcode?: string;
  itemType: AnkaufItemType;
  metal?: AnkaufMetal;
  karatCode?: string;
  finenessDecimal?: string;
  weightGrams?: string;
  hallmarkStamps?: string[];
  condition: AnkaufCondition;
  taxTreatmentCode: TaxTreatmentCode;
  name: string;
  descriptionDe?: string;
  listPriceEur: string;
  /** The actual cash paid for this item. Becomes acquisition_cost_eur. */
  negotiatedPriceEur: string;
  /** TRUE → AVAILABLE on insert; FALSE → DRAFT (photo workflow first). */
  publishImmediately?: boolean;
  /** Optional client-side correlation id for matching the response back. */
  clientReferenceId?: string;
}

export interface AnkaufBody {
  /** REQUIRED. Database CHECK refuses null for ANKAUF. */
  customerId: string;
  payoutMethod: AnkaufPayoutMethod;
  /** REQUIRED when payoutMethod = BANK_TRANSFER; refused for CASH. */
  payoutExternalRef?: string;
  totalEur: string;
  notesInternal?: string;
  items: AnkaufLineItem[];
}

export interface AnkaufResponseProduct {
  id: string;
  sku: string;
  status: 'DRAFT' | 'AVAILABLE';
  clientReferenceId: string | null;
}

export interface AnkaufResponse {
  transactionId: string;
  receiptLocator: string;
  finalizedAt: string;
  ledgerEventId: number;
  totalEur: string;
  payoutMethod: AnkaufPayoutMethod;
  createdProducts: AnkaufResponseProduct[];
}

// ────────────────────────────────────────────────────────────────────────
// Methods
// ────────────────────────────────────────────────────────────────────────

export const transactionsApi = {
  finalize(client: ApiClient, body: FinalizeBody): Promise<FinalizeResponse> {
    return client.request<FinalizeResponse>('POST', '/api/transactions/finalize', body);
  },
  ankauf(client: ApiClient, body: AnkaufBody): Promise<AnkaufResponse> {
    return client.request<AnkaufResponse>('POST', '/api/transactions/ankauf', body);
  },
};
