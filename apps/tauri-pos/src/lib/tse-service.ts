/**
 * tse-service — INTENTION → TRANSACTION → FINISH orchestrator.
 *
 * BezahlenDialog opens an INTENTION the moment the operator commits to
 * a sale, lets the payment method (cash / ZVT) run, and then finishes
 * the TSE with the actual sum. The result is the KassenSichV-mandated
 * signature block that lands on the receipt + the offline queue.
 *
 * V1: if Fiskaly is unreachable, the failed signature gets stored in
 * `localStorage['warehouse14.tse-queue']` so the sale completes; a
 * future worker (Phase 1.5 #I-23) drains the queue back to the API.
 */

import { Type } from '@sinclair/typebox';

import { parseResponse } from '@warehouse14/api-client';

import {
  type TseConfig,
  type TseFinishParams,
  type TseIntention,
  type TseSignature,
  type TseStartParams,
  isRunningInTauri,
  tseClient,
} from './hardware-client.js';
import type { VatAmount } from './tse-vat.js';

// Persisted-input schema (P2.6): the offline TSE queue is replayed to the fiscal
// API, so a corrupt entry (e.g. a string `amountCents`) must be DROPPED here, not
// handed to the replay worker. `amountCents` is integer cents — never a string.
const TseQueueEntrySchema = Type.Object({
  intentionId: Type.String(),
  receiptLocator: Type.Union([Type.String(), Type.Null()]),
  amountCents: Type.Integer(),
  paymentKind: Type.Union([Type.Literal('Bar'), Type.Literal('Unbar')]),
  failedAt: Type.String(),
  reason: Type.String(),
});

const QUEUE_STORAGE_KEY = 'warehouse14.tse-queue.v1';

export type TseSessionResult =
  | { kind: 'signed'; signature: TseSignature; intention: TseIntention }
  | { kind: 'queued_offline'; intentionId: string; reason: string }
  | { kind: 'unavailable'; reason: string };

export interface TseQueueEntry {
  intentionId: string;
  receiptLocator: string | null;
  amountCents: number;
  paymentKind: 'Bar' | 'Unbar';
  failedAt: string;
  reason: string;
}

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
    enqueueFailure({
      intentionId: input.intention.intentionId,
      receiptLocator: input.receiptLocator,
      amountCents: input.amountCents,
      paymentKind: input.paymentKind,
      failedAt: new Date().toISOString(),
      reason,
    });
    return { kind: 'queued_offline', intentionId: input.intention.intentionId, reason };
  }
}

/** Read the offline-queue snapshot — used by the Gerätemanager badge. */
export function readQueue(): TseQueueEntry[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Validate each entry; a corrupt one is dropped (not handed to the replay
    // worker), the valid ones survive. `.filter(Boolean)` strips the nulls.
    return parsed
      .map((e) => parseResponse(TseQueueEntrySchema, e, 'tse-queue.entry'))
      .filter((e): e is TseQueueEntry => e !== null);
  } catch {
    return [];
  }
}

function enqueueFailure(entry: TseQueueEntry): void {
  try {
    const current = readQueue();
    current.push(entry);
    // Cap at 200 to prevent runaway growth — Phase 1.5 worker drains.
    const capped = current.slice(-200);
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // localStorage full / disabled — nothing else we can do client-side.
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
