/**
 * tse-service — INTENTION → TRANSACTION → FINISH orchestrator.
 *
 * BezahlenDialog opens an INTENTION the moment the operator commits to
 * a sale, lets the payment method (cash / ZVT) run, and then finishes
 * the TSE with the actual sum. The result is the KassenSichV-mandated
 * signature block that lands on the receipt + the durable replay queue.
 *
 * If Fiskaly is unreachable the sale still completes: the failed signature
 * lands in the durable SQLite `tse_signature_queue` (tse-queue-store.ts) —
 * finish-failed via `closeTseSession`, record-failed via
 * `enqueueSignatureRecordOnly` — and the TSE-queue drain (tse-queue-drain.ts)
 * replays it once Fiskaly / the server is reachable again (Phase 1.3).
 */

import {
  type TseConfig,
  type TseFinishParams,
  type TseIntention,
  type TseSignature,
  type TseStartParams,
  isRunningInTauri,
  tseClient,
} from './hardware-client.js';
import { tseQueueStore } from './tse-queue-store.js';
import type { VatAmount } from './tse-vat.js';

// Phase 1.3: the volatile `localStorage['warehouse14.tse-queue.v1']` queue is
// gone — a failed TSE signature now lands in the durable SQLite
// `tse_signature_queue` (tse-queue-store.ts), which survives crash + sign-out and
// is never rolled off. The finish-failed path enqueues in `closeTseSession`; the
// record-failed path via `enqueueSignatureRecordOnly` below.

export type TseSessionResult =
  | { kind: 'signed'; signature: TseSignature; intention: TseIntention }
  | { kind: 'queued_offline'; intentionId: string; reason: string }
  | { kind: 'unavailable'; reason: string };

export interface OpenTseSessionInput {
  config: TseConfig;
  receiptLocator: string | null;
  intentionId: string;
  /** 'Bar' for cash, 'Unbar' for card / voucher / bank transfer. */
  paymentKind: 'Bar' | 'Unbar';
  processType?: string;
}

/**
 * Open a TSE session. Wraps the INTENTION step. The caller MUST follow
 * up with `closeSession` once the payment lands, otherwise Fiskaly will
 * eventually expire the intention.
 */
export async function openTseSession(
  input: OpenTseSessionInput,
): Promise<{ intention: TseIntention } | { error: string }> {
  if (!isRunningInTauri()) {
    return { error: 'Tauri-Bridge nicht verfügbar (Browser-Modus).' };
  }
  const params: TseStartParams = {
    config: input.config,
    intentionId: input.intentionId,
    processType: input.processType ?? 'Kassenbeleg-V1',
  };
  try {
    const intention = await tseClient.start(params);
    return { intention };
  } catch (err) {
    return { error: messageOf(err) };
  }
}

/**
 * Close a TSE session — runs FINISH, returns the signature. Failures
 * land in the offline queue, the sale itself is NOT blocked.
 */
export async function closeTseSession(
  input: OpenTseSessionInput & {
    intention: TseIntention;
    amountCents: number;
    /**
     * The finalized server transaction id — `result.id` (Verkauf) /
     * `result.transactionId` (Ankauf). This is the `:id` in the replay
     * POST route, so it MUST be threaded through for a finish-failed row to
     * be replayable. Required (not optional) so both call sites supply it.
     */
    serverTransactionId: string;
    /** DSFinV-K per-VAT gross breakdown for the signed `amounts_per_vat_id`. */
    amountsPerVatId?: VatAmount[];
  },
): Promise<TseSessionResult> {
  if (!isRunningInTauri()) {
    return { kind: 'unavailable', reason: 'Tauri-Bridge nicht verfügbar.' };
  }
  const params: TseFinishParams = {
    config: input.config,
    intentionId: input.intention.intentionId,
    fiskalyTransactionId: input.intention.fiskalyTransactionId,
    amountCents: input.amountCents,
    paymentKind: input.paymentKind,
    processDataBase64: '', // V1 ships an empty blob; receipt locator carried elsewhere
    processType: input.processType ?? 'Kassenbeleg-V1',
    amountsPerVatId: input.amountsPerVatId ?? [],
  };
  try {
    const signature = await tseClient.finish(params);
    return { kind: 'signed', signature, intention: input.intention };
  } catch (err) {
    const reason = messageOf(err);
    // Finish-failed → durable replay queue (path a: signature NULL). Replaces the
    // volatile localStorage queue; this fiscal record survives crash + sign-out
    // and is re-FINISHed by the drain. Enqueue is best-effort-awaited: a store
    // write failure must not throw into the sale (the sale is already finalized).
    try {
      await tseQueueStore.enqueue({
        intentionId: input.intention.intentionId,
        fiskalyTransactionId: input.intention.fiskalyTransactionId,
        tssId: input.config.tssId,
        clientId: input.config.clientId,
        serverTransactionId: input.serverTransactionId,
        amountCents: input.amountCents,
        paymentKind: input.paymentKind,
        amountsPerVatId: input.amountsPerVatId ?? [],
        processType: input.processType ?? 'Kassenbeleg-V1',
        receiptLocator: input.receiptLocator,
        signature: null,
        createdAt: Date.now(),
        lastError: err,
      });
    } catch {
      // localStorage/DB unavailable — nothing else client-side; the sale stands.
    }
    return { kind: 'queued_offline', intentionId: input.intention.intentionId, reason };
  }
}

/**
 * Record-failed enqueue (path b): the FINISH succeeded and we HOLD the signature,
 * but the server-record POST failed. Enqueue the SIGNED entry so the drain
 * re-POSTs it ONLY — it must never re-FINISH an already-finished intention. The
 * store's UPSERT promotes a pre-existing finish-failed (NULL) row for the same
 * intention to this signed one, so the signature is never lost. Best-effort:
 * a store write failure must not throw into the (already finalized) sale.
 */
export async function enqueueSignatureRecordOnly(input: {
  config: TseConfig;
  intention: TseIntention;
  serverTransactionId: string;
  amountCents: number;
  paymentKind: 'Bar' | 'Unbar';
  amountsPerVatId?: VatAmount[];
  processType?: string;
  receiptLocator: string | null;
  signature: TseSignature;
  error?: unknown;
}): Promise<void> {
  try {
    await tseQueueStore.enqueue({
      intentionId: input.intention.intentionId,
      fiskalyTransactionId: input.intention.fiskalyTransactionId,
      tssId: input.config.tssId,
      clientId: input.config.clientId,
      serverTransactionId: input.serverTransactionId,
      amountCents: input.amountCents,
      paymentKind: input.paymentKind,
      amountsPerVatId: input.amountsPerVatId ?? [],
      processType: input.processType ?? 'Kassenbeleg-V1',
      receiptLocator: input.receiptLocator,
      signature: input.signature,
      createdAt: Date.now(),
      lastError: input.error,
    });
  } catch {
    // DB unavailable — the sale stands; the signature still printed on the receipt.
  }
}

function messageOf(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'details' in err) {
    return String((err as { details: unknown }).details);
  }
  return 'Unbekannter TSE-Fehler';
}

/**
 * Stable v4-ish nonce used as the IntentionId. Fiskaly accepts any string
 * up to 64 chars; we use a UUID-shaped value so the audit log line up.
 */
export function newIntentionId(): string {
  // Browser crypto.randomUUID exists in every Tauri webview.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback (testing): pseudo-random hex.
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
