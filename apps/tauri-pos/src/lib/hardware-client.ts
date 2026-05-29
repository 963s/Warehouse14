/**
 * hardware-client — typed wrappers around every Tauri command.
 *
 * Single import surface for the React layer. Each function is a thin
 * `invoke<T>(...)` call with a hand-written signature that mirrors the
 * Rust struct in `src-tauri/src/commands/<module>.rs`. Keeping the wrappers
 * here (instead of inline `invoke` calls scattered across screens) means:
 *
 *   • One place to add logging / metrics.
 *   • One place to switch between real and offline-stub when running in
 *     pure-Web mode (Storybook, unit tests).
 *   • The discriminated `HardwareError` union surfaces uniformly so screens
 *     can pattern-match without re-deriving types.
 *
 * See memory.md §18.3 for the IPC contract table.
 */

import { invoke } from '@tauri-apps/api/core';

// ────────────────────────────────────────────────────────────────────────
// Shared error type — mirrors the Rust `HardwareError` serde tag.
// ────────────────────────────────────────────────────────────────────────

export type HardwareErrorKind =
  | 'network'
  | 'timeout'
  | 'device'
  | 'not_configured'
  | 'encoding'
  | 'local_io'
  | 'invalid_argument'
  | 'internal';

export interface HardwareError {
  kind: HardwareErrorKind;
  details: string;
}

/**
 * Type-guard for the shape Rust returns when a command fails. The Tauri
 * `invoke()` promise rejects with the serialized HardwareError object;
 * we narrow it here so callers can `if (isHardwareError(err)) { ... }`.
 */
export function isHardwareError(err: unknown): err is HardwareError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  return typeof e.kind === 'string' && typeof e.details === 'string';
}

/**
 * Friendly German message for a HardwareError, suitable for a toast or
 * banner. Falls back to the raw `details` if the variant is unmapped.
 */
export function describeHardwareError(err: HardwareError): string {
  switch (err.kind) {
    case 'network':
      return `Netzwerkfehler: ${err.details}`;
    case 'timeout':
      return 'Gerät antwortet nicht (Zeitüberschreitung). Bitte erneut versuchen.';
    case 'device':
      return `Gerätefehler: ${err.details}`;
    case 'not_configured':
      return `Nicht konfiguriert: ${err.details}`;
    case 'encoding':
      return `Datenfehler: ${err.details}`;
    case 'local_io':
      return `Lokaler Dateifehler: ${err.details}`;
    case 'invalid_argument':
      return `Ungültiger Aufruf: ${err.details}`;
    case 'internal':
    default:
      return `Interner Fehler: ${err.details}`;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Mandate 1 — Image compression
// ────────────────────────────────────────────────────────────────────────

export interface CompressOptions {
  quality: number;
  maxKb: number;
  minQuality: number;
}

export interface CompressResult {
  bytes: number[]; // serialised as JSON array; convert via `new Uint8Array(bytes)`
  sizeBytes: number;
  achievedQuality: number;
  width: number;
  height: number;
}

export async function compressToWebp(
  rgba: Uint8Array,
  width: number,
  height: number,
  options?: Partial<CompressOptions>,
): Promise<CompressResult> {
  return invoke<CompressResult>('compress_to_webp', {
    rgba: Array.from(rgba),
    width,
    height,
    options,
  });
}

/** Convenience: hand back a real `Blob` ready for `uploadBlobToR2`. */
export async function compressToWebpBlob(
  rgba: Uint8Array,
  width: number,
  height: number,
  options?: Partial<CompressOptions>,
): Promise<{ blob: Blob; result: CompressResult }> {
  const result = await compressToWebp(rgba, width, height, options);
  const blob = new Blob([new Uint8Array(result.bytes)], { type: 'image/webp' });
  return { blob, result };
}

// ────────────────────────────────────────────────────────────────────────
// Mandate 2-A — TSE (Fiskaly Cloud)
// ────────────────────────────────────────────────────────────────────────

export interface TseConfig {
  tssId: string;
  clientId: string;
  apiKey: string;
  apiSecret: string;
}

export interface TseStartParams {
  config: TseConfig;
  intentionId: string;
  processType: string;
}

export interface TseIntention {
  intentionId: string;
  fiskalyTransactionId: string;
  startedAt: string;
}

export interface TseFinishParams {
  config: TseConfig;
  intentionId: string;
  fiskalyTransactionId: string;
  amountCents: number;
  paymentKind: string; // 'Bar' | 'Unbar' per KassenSichV
  processDataBase64: string;
  processType: string;
}

export interface TseSignature {
  signatureValue: string;
  signatureCounter: number;
  signatureAlgorithm: string;
  transactionNumber: number;
  startedAt: string;
  finishedAt: string;
  qrCodePayload: string;
}

export interface TseStatus {
  reachable: boolean;
  tssState: string | null;
  lastCheckedAt: string;
  message: string;
}

export const tseClient = {
  start(params: TseStartParams): Promise<TseIntention> {
    return invoke('tse_start_transaction', { params });
  },
  finish(params: TseFinishParams): Promise<TseSignature> {
    return invoke('tse_finish_transaction', { params });
  },
  status(config: TseConfig): Promise<TseStatus> {
    return invoke('tse_status', { config });
  },
};

// ────────────────────────────────────────────────────────────────────────
// Mandate 2-B — ZVT card terminal
// ────────────────────────────────────────────────────────────────────────

export interface ZvtEndpoint {
  ip: string;
  port: number;
}

export interface ZvtResult {
  success: boolean;
  authorizationCode: string | null;
  cardPanMasked: string | null;
  cardBrand: string | null;
  receiptText: string | null;
  errorMessage: string | null;
}

export const zvtClient = {
  check(endpoint: ZvtEndpoint): Promise<boolean> {
    return invoke('zvt_check_connection', { endpoint });
  },
  authorize(endpoint: ZvtEndpoint, amountCents: number): Promise<ZvtResult> {
    return invoke('zvt_authorize_payment', { endpoint, amountCents });
  },
  reverse(endpoint: ZvtEndpoint, authorizationCode: string): Promise<boolean> {
    return invoke('zvt_reverse_payment', { endpoint, authorizationCode });
  },
};

// ────────────────────────────────────────────────────────────────────────
// Mandate 3-A — ESC/POS thermal receipt
// ────────────────────────────────────────────────────────────────────────

export interface ThermalEndpoint {
  ip: string;
  port: number;
}

export interface ThermalLineItem {
  name: string;
  quantity: number;
  unitPriceEur: string;
  lineTotalEur: string;
  vatLabel: string;
}

export interface ThermalReceiptData {
  shopName: string;
  shopAddress: string[];
  shopVatId: string;
  shopPhone: string | null;
  receiptLocator: string;
  printedAt: string;
  cashierName: string;
  shiftId: string | null;
  items: ThermalLineItem[];
  subtotalEur: string;
  vatEur: string;
  totalEur: string;
  paymentMethodLabel: string;
  cashReceivedEur: string | null;
  changeEur: string | null;
  tseSignatureValue: string;
  tseSignatureCounter: string;
  tseTransactionNumber: string;
  tseQrPayload: string;
  footerLines: string[];
}

export const thermalClient = {
  print(endpoint: ThermalEndpoint, data: ThermalReceiptData): Promise<void> {
    return invoke('print_thermal_receipt', { endpoint, data });
  },
};

// ────────────────────────────────────────────────────────────────────────
// Mandate 3-B — A4 PDF
// ────────────────────────────────────────────────────────────────────────

export interface ShopInfo {
  name: string;
  addressLines: string[];
  vatId: string;
  taxId: string | null;
  iban: string | null;
  bic: string | null;
  email: string | null;
  phone: string | null;
}

export interface CustomerInfo {
  name: string;
  addressLines: string[];
  customerNumber: string | null;
  vatId: string | null;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPriceEur: string;
  lineTotalEur: string;
  taxTreatmentCode: string;
  appliedVatRate: string;
}

export interface TaxBreakdownRow {
  label: string;
  baseEur: string;
  vatEur: string;
}

export interface TseSignatureBlock {
  signatureValue: string;
  signatureCounter: string;
  transactionNumber: string;
  startedAt: string;
  finishedAt: string;
  qrPayload: string;
}

export interface PaymentInfo {
  methodLabel: string;
  totalEur: string;
  reference: string | null;
}

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  shop: ShopInfo;
  customer: CustomerInfo | null;
  items: InvoiceItem[];
  subtotalEur: string;
  vatTotalEur: string;
  grandTotalEur: string;
  taxBreakdown: TaxBreakdownRow[];
  payment: PaymentInfo;
  tse: TseSignatureBlock;
  footerNotes: string[];
}

export interface PrintA4Params {
  printerName: string;
  pdfBytes: number[];
}

export interface PdfPreviewResult {
  tempPath: string;
}

export const pdfClient = {
  async generate(data: InvoiceData): Promise<Uint8Array> {
    const out = await invoke<number[]>('generate_invoice_pdf', { data });
    return new Uint8Array(out);
  },
  print(printerName: string, pdfBytes: Uint8Array): Promise<void> {
    return invoke('print_a4', {
      params: { printerName, pdfBytes: Array.from(pdfBytes) },
    });
  },
  preview(pdfBytes: Uint8Array): Promise<PdfPreviewResult> {
    return invoke('open_pdf_preview', { pdfBytes: Array.from(pdfBytes) });
  },
};

// ────────────────────────────────────────────────────────────────────────
// Mandate 4 — System printer probe
// ────────────────────────────────────────────────────────────────────────

export interface SystemPrinter {
  name: string;
  status: 'idle' | 'printing' | 'stopped' | 'unknown';
}

export const systemClient = {
  listPrinters(): Promise<SystemPrinter[]> {
    return invoke<SystemPrinter[]>('list_system_printers');
  },
};

// ────────────────────────────────────────────────────────────────────────
// Epic C — encrypted local KYC vault (GwG / GDPR)
// ────────────────────────────────────────────────────────────────────────

export type KycDocType = 'AUSWEIS' | 'REISEPASS' | 'AUFENTHALTSTITEL' | 'SONSTIGES';

export interface KycEncryptResult {
  /** Absolute path to the encrypted `.enc` vault file — persist on the record. */
  path: string;
  /** Hex SHA-256 of the original (plaintext) document bytes. */
  sha256: string;
}

/**
 * Encrypt an ID scan and store it in the local vault. The bytes never leave
 * the till unencrypted; the AES-256-GCM master key lives in the OS keyring.
 * Returns the opaque vault path + integrity hash to store against the customer.
 */
export async function encryptAndSaveKycDocument(
  fileBytes: Uint8Array,
  customerId: string,
  docType: KycDocType,
): Promise<KycEncryptResult> {
  return invoke<KycEncryptResult>('encrypt_and_save_kyc_document', {
    fileBytes: Array.from(fileBytes),
    customerId,
    docType,
  });
}

/** Decrypt a vault file back to bytes (e.g. to render a preview). */
export async function decryptAndLoadKycDocument(filePath: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('decrypt_and_load_kyc_document', { filePath });
  return new Uint8Array(bytes);
}

// ────────────────────────────────────────────────────────────────────────
// Tauri probe — useful to short-circuit hardware calls when the React app
// is being rendered outside Tauri (Vitest, Storybook).
// ────────────────────────────────────────────────────────────────────────

export function isRunningInTauri(): boolean {
  // Tauri 2 sets `window.__TAURI_INTERNALS__`; older builds set `__TAURI__`.
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.__TAURI_INTERNALS__ ?? w.__TAURI__);
}
