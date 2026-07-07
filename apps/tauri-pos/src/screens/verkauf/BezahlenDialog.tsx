/**
 * BezahlenDialog — V1 Verkauf checkout, CASH only.
 *
 * Phase 1 V1 ships ONE payment method (`CASH`). The ZVT terminal, SumUp and
 * Mollie paths are deliberately deferred to Phase 1.5; the API supports them
 * already (see `FinalizePayment.paymentMethod`) but the UX flow is meaningful
 * work that doesn't belong on the revenue-critical path until card hardware
 * is connected.
 *
 * Two phases:
 *   1. INPUT  — operator types the cash received; we compute change live.
 *               Bezahlen button is disabled until cashReceived ≥ total.
 *   2. RESULT — receipt locator + finalize timestamp + "Neue Karte" CTA.
 *
 * Step-up: the `/api/transactions/finalize` route returns 403 STEP_UP_REQUIRED
 * for amounts ≥ TRANSACTION_STEP_UP_THRESHOLD_EUR. Our wrapWithStepUp
 * interceptor (memory.md #76 ⑦) catches it, opens the brand StepUpModal,
 * the operator types PIN, and the call resolves. The dialog never has to
 * know — it simply awaits the finalize.
 *
 * On finalize success the dialog:
 *   • shows the receipt locator + ID
 *   • clears the cart (so the catalog tiles refetch and the just-sold rows
 *     disappear)
 *   • invalidates dashboard + products-list queries
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiError,
  ApiOfflineQueuedError,
  type CustomerDetail,
  type FinalizeBody,
  type FinalizeLineItem,
  type FinalizeResponse,
  type PaymentMethod,
  customersApi,
  transactionsApi,
} from '@warehouse14/api-client';

const TAX_LEGAL_TEXTS: Record<string, string> = {
  STANDARD_19:
    'Im Preis ist die gesetzliche Umsatzsteuer von 19 % gemäß § 12 Abs. 1 UStG enthalten.',
  REDUCED_7: 'Im Preis ist die gesetzliche Umsatzsteuer von 7 % gemäß § 12 Abs. 2 UStG enthalten.',
  MARGIN_25A: 'Differenzbesteuerung gemäß § 25a UStG. Vorsteuerabzug ist ausgeschlossen.',
  INVESTMENT_GOLD_25C: 'Steuerfreie Lieferung von Anlagegold gemäß § 25c UStG.',
  REVERSE_CHARGE_13B: 'Steuerschuldnerschaft des Leistungsempfängers nach §13b Abs. 2 Nr. 9 UStG.',
};
import {
  AmountPad,
  Button,
  Check,
  DiamondRule,
  Icon,
  MoneyAmount,
  ParchmentCard,
} from '@warehouse14/ui-kit';

import { ZvtSpinner } from '../../components/hardware/ZvtSpinner.js';
import { currentShiftQueryKey } from '../../hooks/useCurrentShift.js';
import { dashboardQueryKey } from '../../hooks/useDashboardSummary.js';
import { useReceiptFooterLines } from '../../hooks/useReceiptFooter.js';
import { resolveShopInfo, useShopInfo } from '../../hooks/useShopInfo.js';
import { evaluateKycGate } from '../../lib/ankauf-kyc-gate.js';
import { resolveDeviceId, useApiClient } from '../../lib/api-context.js';
import { posIntentsStore, sealFiscalRequest } from '../../lib/pos-intents-store.js';
import {
  type HeaderTotals,
  type LineMath,
  computeLineMath,
  computeTender,
  fromCents,
  sumHeader,
  toCents,
} from '../../lib/cart-math.js';
import { isMoneyInput } from '../../lib/decimal.js';
import {
  type ThermalReceiptData,
  type ZvtResult,
  describeHardwareError,
  isHardwareError,
  isRunningInTauri,
  thermalClient,
  zvtClient,
} from '../../lib/hardware-client.js';
import {
  type TseSessionResult,
  closeTseSession,
  enqueueSignatureRecordOnly,
  newIntentionId,
  openTseSession,
} from '../../lib/tse-service.js';
import { computeAmountsPerVatId } from '../../lib/tse-vat.js';
import { type CartLine, useCartStore } from '../../state/cart-store.js';
import { useHardwareStore } from '../../state/hardware-store.js';
import { useLastReceiptStore } from '../../state/last-receipt-store.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';

import { KaeuferPicker } from './KaeuferPicker.js';
import { ReceiptPreview } from './ReceiptPreview.js';
import { StornoDialog } from './StornoDialog.js';
import { type AppliedVoucher, VoucherField } from './VoucherField.js';
import { computeSplitPayment } from './split-payment.js';

/**
 * Smart-denomination quick-tender chips (design-brief §1).
 *
 * PRESENTATION ONLY — every value is derived from the already-computed
 * `dueCents` via the canonical `fromCents`/`toCents` primitives. No rounding,
 * VAT or tender math is introduced here; the chips merely pre-fill the same
 * `cashReceivedEur` string the keypad and keyboard already write, so the cash
 * math downstream (computeTender) is byte-identical to a manual entry.
 *
 * The first chip is always "Passend" (exact due). The remaining chips are the
 * smallest standard German note/coin denominations that are STRICTLY greater
 * than the due — the realistic "what the customer hands over" set — capped at
 * five chips total so the row never wraps (Hick: cap visible choices).
 */
const TENDER_DENOMINATIONS_CENTS: readonly bigint[] = [
  500n,
  1000n,
  2000n,
  5000n,
  10_000n,
  20_000n,
  50_000n,
];

export interface TenderChip {
  /** Canonical dot-decimal the chip writes into `cashReceivedEur`. */
  readonly valueEur: string;
  /** German label shown on the chip ("Passend" for the exact-due chip). */
  readonly label: string;
  /** True for the exact-tender chip (no change due). */
  readonly exact: boolean;
}

export function computeTenderChips(dueCents: bigint): readonly TenderChip[] {
  if (dueCents <= 0n) return [];
  const chips: TenderChip[] = [{ valueEur: fromCents(dueCents), label: 'Passend', exact: true }];
  for (const note of TENDER_DENOMINATIONS_CENTS) {
    if (note > dueCents) {
      chips.push({ valueEur: fromCents(note), label: '', exact: false });
      if (chips.length >= 5) break;
    }
  }
  return chips;
}

export interface BezahlenDialogProps {
  open: boolean;
  onClose: () => void;
  lines: readonly CartLine[];
  perLineMath: readonly LineMath[];
  totals: HeaderTotals;
  /** Fired ONLY on the genuine finalize-success → "Neue Karte" close path. */
  onFinalizeSuccess?: (() => void) | undefined;
}

export function BezahlenDialog({
  open,
  onClose,
  lines,
  perLineMath,
  totals: _totals,
  onFinalizeSuccess,
}: BezahlenDialogProps): JSX.Element | null {
  const api = useApiClient();
  const qc = useQueryClient();
  // Post-finalize the server has already transitioned RESERVED → SOLD,
  // so the cart-store reservations are obsolete. We clear without
  // calling release (server-side those holds no longer exist).
  const clearCart = useCartStore((s) => s.clearCart);
  const addToast = useToastStore((s) => s.addToast);
  const hardwareCfg = useHardwareStore((s) => s.config);
  const sessionActor = useSessionStore((s) => s.actor);
  const { data: shopApi } = useShopInfo();
  const customFooter = useReceiptFooterLines();
  const setLastReceipt = useLastReceiptStore((s) => s.setLastReceipt);

  const [paymentChoice, setPaymentChoice] = useState<'CASH' | 'ZVT_CARD'>('CASH');
  const [cashReceivedEur, setCashReceivedEur] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [finalized, setFinalized] = useState<FinalizeResponse | null>(null);
  /** Set while the ZVT terminal owns the cardholder's attention. */
  const [zvtBusy, setZvtBusy] = useState<boolean>(false);
  /** The finalized receipt awaiting the operator's print confirmation (preview). */
  const [previewData, setPreviewData] = useState<ThermalReceiptData | null>(null);
  const [printing, setPrinting] = useState<boolean>(false);
  /** Applied gift voucher (Phase C2) — covers up to the full total; rest in cash. */
  const [appliedVoucher, setAppliedVoucher] = useState<AppliedVoucher | null>(null);
  /**
   * Split payment (Phase C1) — when on, the operator's entered cash amount is a
   * PARTIAL cash leg and the remainder is charged to the card. Off = the cash
   * field is full payment (the classic single-method cash path).
   */
  const [splitCard, setSplitCard] = useState<boolean>(false);

  /**
   * § 10 GwG buyer — a KYC-verified Käufer attached to a high-value (≥ €2.000)
   * sale. `null` for the common anonymous Tafelgeschäft under the threshold.
   * Set via the KaeuferPicker; its `customerId` rides on the finalize body so
   * the server's `transactions_validate_kyc` trigger is satisfied.
   */
  const [selectedBuyer, setSelectedBuyer] = useState<CustomerDetail | null>(null);
  const [buyerPickerOpen, setBuyerPickerOpen] = useState<boolean>(false);

  // B2B state
  const [isB2b, setIsB2b] = useState<boolean>(false);
  const [vatId, setVatId] = useState<string>('');
  const [viesStatus, setViesStatus] = useState<
    'idle' | 'checking' | 'valid' | 'invalid' | 'unavailable' | 'timeout'
  >('idle');
  const [viesCompany, setViesCompany] = useState<string>('');
  const [viesAddress, setViesAddress] = useState<string>('');
  const [manualCompany, setManualCompany] = useState<string>('');
  const [manualAddress, setManualAddress] = useState<string>('');

  const cleanVatId = useMemo(() => vatId.replace(/[^A-Za-z0-9]/g, '').toUpperCase(), [vatId]);
  const companyName = useMemo(() => {
    return viesCompany && viesCompany !== '---' ? viesCompany : manualCompany;
  }, [viesCompany, manualCompany]);

  const b2bActive =
    isB2b && (viesStatus === 'valid' || viesStatus === 'unavailable' || viesStatus === 'timeout');

  const adjustedPerLineMath = useMemo(() => {
    return lines.map((line, idx) => {
      const actualTaxCode =
        b2bActive && line.taxTreatmentCode === 'STANDARD_19'
          ? 'REVERSE_CHARGE_13B'
          : line.taxTreatmentCode;
      const originalMath = perLineMath[idx];
      if (!originalMath) throw new Error('cart-math/lines length mismatch');
      if (actualTaxCode === line.taxTreatmentCode) {
        return originalMath;
      }
      return computeLineMath({
        taxTreatmentCode: actualTaxCode,
        listPriceEur: line.listPriceEur,
        acquisitionCostEur: line.acquisitionCostEur,
        discountEur: line.discountEur,
      });
    });
  }, [lines, perLineMath, b2bActive]);

  const adjustedTotals = useMemo(() => sumHeader(adjustedPerLineMath), [adjustedPerLineMath]);

  const verifyVat = useCallback(async () => {
    if (!vatId.trim()) return;
    setViesStatus('checking');
    try {
      const res = await api.request<{
        valid: boolean;
        name?: string;
        address?: string;
        error?: string;
      }>('GET', `/api/customers/verify-vat?vatId=${encodeURIComponent(vatId)}`);

      if (res.valid) {
        setViesStatus('valid');
        setViesCompany(res.name || '---');
        setViesAddress(res.address || '---');
        setManualCompany(res.name && res.name !== '---' ? res.name : '');
        setManualAddress(res.address && res.address !== '---' ? res.address : '');
      } else {
        if (res.error === 'VIES_TIMEOUT') {
          setViesStatus('timeout');
        } else if (res.error === 'VIES_UNAVAILABLE') {
          setViesStatus('unavailable');
        } else {
          setViesStatus('invalid');
        }
      }
    } catch {
      setViesStatus('unavailable');
    }
  }, [api, vatId]);

  /**
   * §19.3 W-1/W-2 — synchronous mutex.
   *
   * `useState(submitting)` is async — React doesn't commit the
   * `setSubmitting(true)` until after the event handler yields, so a
   * fast double-click CAN re-enter `submit`/`submitCard` and trigger
   * TWO ZVT authorizations. A `useRef.current = true` is visible
   * immediately on the next synchronous read, killing the race.
   *
   * The ref is reset in the `finally` of both submit paths AND when
   * the dialog re-opens (operator dismissed and re-opened).
   */
  const inFlightRef = useRef<boolean>(false);

  /**
   * §19.2 C-4 — idempotency key for at-most-once finalize.
   *
   * Generated ONCE per dialog open and held in a ref so retries (e.g.
   * step-up cancel-then-resume, or network error retry) send the SAME
   * key. The server's partial UNIQUE INDEX deduplicates on this value.
   */
  const idempotencyKeyRef = useRef<string>(newIntentionId());

  /**
   * §19.3 C-3 — a SUCCESSFUL ZVT authorization whose finalize then failed.
   *
   * The card is already debited. Re-running `submitCard` must NOT re-authorize
   * (that double-charges); it must retry ONLY the finalize against THIS
   * authorization. We stash the winning `ZvtResult` here on auth-success and
   * clear it once finalize succeeds (or the dialog re-opens). While set, the
   * card path skips the terminal and goes straight to finalize.
   */
  const pendingAuthRef = useRef<ZvtResult | null>(null);

  /**
   * P1.3 — the B2B company customer resolved ONCE per checkout (by VAT id), so
   * a finalize-retry after a card charge never re-resolves / re-creates. Cleared
   * on dialog open. `null` = not yet resolved this session.
   */
  const resolvedCustomerIdRef = useRef<string | null>(null);

  /**
   * §19.3 W-7 — TSE signature captured from the FINISH call so the
   * thermal print step can include the KassenSichV-mandated signature
   * block + QR. `null` when TSE is offline or unconfigured (the print
   * still fires; the operator sees a "TSE-Signatur fehlt" line on the
   * paper receipt and the queue picks up the sync later).
   */
  const lastTseSignatureRef = useRef<{
    signatureValue: string;
    signatureCounter: string;
    transactionNumber: string;
    qrPayload: string;
  } | null>(null);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setPaymentChoice('CASH');
      setCashReceivedEur('');
      setSubmitting(false);
      setError(null);
      setFinalized(null);
      setZvtBusy(false);
      setPreviewData(null);
      setPrinting(false);
      setAppliedVoucher(null);
      setSplitCard(false);
      setSelectedBuyer(null);
      setBuyerPickerOpen(false);
      inFlightRef.current = false;
      idempotencyKeyRef.current = newIntentionId();
      pendingAuthRef.current = null;
      resolvedCustomerIdRef.current = null;

      setIsB2b(false);
      setVatId('');
      setViesStatus('idle');
      setViesCompany('');
      setViesAddress('');
      setManualCompany('');
      setManualAddress('');
    }
  }, [open]);

  // Esc closes (unless mid-submit).
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && !submitting) {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, submitting]);

  const totalCents = useMemo(() => toCents(adjustedTotals.totalEur), [adjustedTotals.totalEur]);
  const cashCents = useMemo(() => {
    if (cashReceivedEur.length === 0) return 0n;
    try {
      return toCents(cashReceivedEur);
    } catch {
      return 0n;
    }
  }, [cashReceivedEur]);
  const validCash = isMoneyInput(cashReceivedEur);

  // Voucher + cash split: the voucher covers up to the full total, the cash leg
  // pays the remainder, and change is computed on that remainder.
  const voucherBalanceCents = useMemo(
    () => (appliedVoucher ? toCents(appliedVoucher.balanceEur) : null),
    [appliedVoucher],
  );
  const tender = useMemo(
    () => computeTender({ totalCents, voucherBalanceCents, cashCents }),
    [totalCents, voucherBalanceCents, cashCents],
  );
  const dueCents = tender.dueCents;
  // When the voucher covers the whole sale (due === 0) no cash entry is needed.
  const enoughCash = dueCents === 0n ? true : validCash && tender.cashCovered;
  const changeCents = tender.changeCents;

  // Phase C1 — cash+card split. The entered cash amount becomes a PARTIAL cash
  // leg; the remainder rides on the card. Pure, tested math (split-payment.ts).
  const split = useMemo(
    () => computeSplitPayment(dueCents, cashReceivedEur),
    [dueCents, cashReceivedEur],
  );
  // A split sale is ready when the math is valid (0 < cash < due, exact remainder).
  // Card hardware must be configured (the remainder runs through the ZVT terminal).
  const canSubmitSplit = split.valid && lines.length > 0 && !submitting;

  const b2bValid =
    !isB2b ||
    ((viesStatus === 'valid' || viesStatus === 'unavailable' || viesStatus === 'timeout') &&
      companyName.trim().length > 0 &&
      cleanVatId.length >= 4);

  /**
   * § 10 GwG buyer gate (UI-surfacing only — the server trigger is the real
   * gate). A VERKAUF total ≥ €2.000 needs a KYC-verified buyer attached. The
   * selected buyer satisfies it only once their `kycVerifiedAt` is stamped.
   */
  const kycGate = useMemo(
    () =>
      evaluateKycGate({
        direction: 'VERKAUF',
        totalCents,
        customer: selectedBuyer ? { kycVerifiedAt: selectedBuyer.kycVerifiedAt } : null,
      }),
    [totalCents, selectedBuyer],
  );
  // A verified buyer is required when the threshold is reached and we don't yet
  // have one attached. (`required` only flips true once a customer is selected
  // but unverified; the "no buyer at all" case is captured by thresholdReached.)
  const buyerVerified = selectedBuyer != null && selectedBuyer.kycVerifiedAt != null;
  // A B2B reverse-charge sale identifies the buyer via the company's VAT id +
  // name + address (resolved/created at finalize) — that satisfies the §10
  // identity requirement on its own, so we must NOT also force a private KYC
  // buyer (which finalize would then discard anyway).
  const needsBuyer = kycGate.thresholdReached && !buyerVerified && !b2bActive;

  const canSubmit =
    enoughCash && !submitting && finalized === null && lines.length > 0 && b2bValid && !needsBuyer;
  const canSubmitCard = lines.length > 0 && !submitting && b2bValid && !needsBuyer;

  /**
   * Run the TSE INTENTION → finalize → FINISH sandwich. Returns the
   * server's FinalizeResponse so the caller can render the receipt.
   *
   * TSE failures DO NOT block the sale (V1 — KassenSichV permits a
   * short outage window). Failed signatures land in the offline queue;
   * a future worker job (Phase 1.5 #I-23) drains them back.
   */
  /**
   * Resolve the customer id for the finalize body — the §10 GwG buyer for a
   * high-value private sale, or the B2B company customer. P1.3: resolved with a
   * SINGLE bounded `findByVatId` (was a customer LIST + a serial GET per row on
   * the checkout path — an N+1 that also hit the ADMIN-only by-id route, so a
   * cashier till would 403 mid-sale). The result is cached in a ref so a
   * finalize-retry after a card charge never re-resolves or re-creates.
   *
   * MUST be called BEFORE the TSE intention / card charge — a throw here then
   * aborts the sale with the card untouched.
   */
  const resolveB2bCustomerId = useCallback(async (): Promise<string | null> => {
    if (!isB2b) return selectedBuyer?.id ?? null;
    if (resolvedCustomerIdRef.current) return resolvedCustomerIdRef.current;

    const existing = await customersApi.findByVatId(api, cleanVatId);
    if (existing) {
      resolvedCustomerIdRef.current = existing.id;
      return existing.id;
    }

    const companyAddress = viesAddress && viesAddress !== '---' ? viesAddress : manualAddress;
    const created = await customersApi.create(api, {
      fullName: companyName,
      vatId: cleanVatId,
      notes: 'Automated B2B registration via checkout (VIES verified)',
      ...(companyAddress?.trim() ? { address: companyAddress.trim() } : {}),
    });
    resolvedCustomerIdRef.current = created.id;
    return created.id;
  }, [api, isB2b, cleanVatId, companyName, viesAddress, manualAddress, selectedBuyer]);

  const finalizeWithTse = useCallback(
    async (
      payments: NonNullable<FinalizeBody['payments']>,
      paymentKind: 'Bar' | 'Unbar',
      customerId: string | null,
    ): Promise<FinalizeResponse> => {
      // `customerId` is resolved by the caller (resolveB2bCustomerId) BEFORE any
      // charge — never inside this finalize sandwich, where a lookup throw would
      // reject AFTER the card is debited.
      const headTreatment = b2bActive
        ? 'REVERSE_CHARGE_13B'
        : lines[0]?.taxTreatmentCode || 'STANDARD_19';

      // 1. TSE INTENTION — best-effort; failure logs a toast but doesn't block.
      const intentionId = newIntentionId();
      const intentionRes = await openTseSession({
        config: hardwareCfg.tse,
        receiptLocator: null,
        intentionId,
        paymentKind,
      });

      const items = lines.map((line, idx) => {
        const math = adjustedPerLineMath[idx];
        if (!math) throw new Error('cart-math/lines length mismatch');
        const item: FinalizeLineItem = {
          productId: line.productId,
          reservationSessionId: line.reservationSessionId,
          lineSubtotalEur: fromCents(math.lineSubtotalCents),
          lineVatEur: fromCents(math.lineVatCents),
          lineTotalEur: fromCents(math.lineTotalCents),
          appliedTaxTreatmentCode:
            b2bActive && line.taxTreatmentCode === 'STANDARD_19'
              ? 'REVERSE_CHARGE_13B'
              : line.taxTreatmentCode,
          appliedVatRate: math.appliedVatRate,
          acquisitionCostEurSnapshot:
            math.acquisitionCostSnapshotCents !== null
              ? fromCents(math.acquisitionCostSnapshotCents)
              : null,
          marginEur: math.marginCents !== null ? fromCents(math.marginCents) : null,
          ...(math.lineDiscountCents > 0n
            ? {
                lineDiscountEur: fromCents(math.lineDiscountCents),
                lineDiscountReason: line.discountReason ?? 'Rabatt',
              }
            : {}),
          displayOrder: idx + 1,
        };
        return item;
      });

      // 2. Finalize on the API. The idempotency key is held in a ref so
      //    every retry path (step-up, network blip) sends the SAME value
      //    — server's partial UNIQUE INDEX dedupes (§19.2 C-4).
      const body: FinalizeBody = {
        direction: 'VERKAUF',
        customerId,
        subtotalEur: adjustedTotals.subtotalEur,
        vatEur: adjustedTotals.vatEur,
        totalEur: adjustedTotals.totalEur,
        taxTreatmentCode: headTreatment,
        items,
        payments,
        idempotencyKey: idempotencyKeyRef.current,
      };
      // Phase 1.4: crystallize the intent to disk BEFORE the network call, so a
      // crash between here and the server leaves a recoverable pos_intents row —
      // the startup reconcile funnels it into the outbox on this SAME key (the
      // server's partial-UNIQUE dedups → no double-finalize). Best-effort: a
      // store-write failure must NEVER block the sale.
      try {
        await posIntentsStore.create({
          key: idempotencyKeyRef.current,
          intentType: 'sale',
          sealedRequestJson: JSON.stringify(
            sealFiscalRequest({
              baseUrl: api.baseUrl,
              path: '/api/transactions/finalize',
              body,
              idempotencyKey: idempotencyKeyRef.current,
              deviceId: resolveDeviceId(),
            }),
          ),
          createdAt: Date.now(),
        });
      } catch {
        /* best-effort — the sale proceeds even if the intent write fails */
      }
      const result = await transactionsApi.finalize(api, body);
      // The request reached the server — resolve the intent (no reconcile needed).
      try {
        await posIntentsStore.markResolved(idempotencyKeyRef.current, result);
      } catch {
        /* best-effort */
      }

      // 3. TSE FINISH — only if INTENTION succeeded. Capture the signature
      //    in a ref so the thermal-print step (W-7) can render the
      //    KassenSichV signature block on the paper receipt.
      lastTseSignatureRef.current = null;
      if ('intention' in intentionRes) {
        const totalCents = Number(toCents(adjustedTotals.totalEur));
        // DSFinV-K per-VAT gross breakdown for the signed body (§146a): group the
        // applied per-line treatments by USt-Schlüssel (same canonical mapping the
        // server's DSFinV-K export uses), so the signed receipt carries the real
        // decomposition instead of an empty amounts_per_vat_id.
        const amountsPerVatId = computeAmountsPerVatId(
          items.map((item, idx) => ({
            appliedTaxTreatmentCode: item.appliedTaxTreatmentCode,
            lineTotalCents: Number(adjustedPerLineMath[idx]?.lineTotalCents ?? 0n),
          })),
        );
        const finishRes: TseSessionResult = await closeTseSession({
          config: hardwareCfg.tse,
          intentionId,
          receiptLocator: result.receiptLocator,
          paymentKind,
          intention: intentionRes.intention,
          amountCents: totalCents,
          serverTransactionId: result.id,
          amountsPerVatId,
        });
        if (finishRes.kind === 'signed') {
          const sig = finishRes.signature;
          lastTseSignatureRef.current = {
            signatureValue: sig.signatureValue,
            signatureCounter: String(sig.signatureCounter),
            transactionNumber: String(sig.transactionNumber),
            qrPayload: sig.qrCodePayload,
          };

          // GoBD / BSI TR-03153 — durably persist the TSE signature server-side,
          // linked to the transaction. Previously the signature lived ONLY on the
          // thermal receipt + the offline-queue localStorage; the fiscal record
          // was lost if the receipt or this workstation went away. This POST is
          // idempotent (one signature row per transaction) and best-effort: a
          // failure NEVER blocks the sale — the operator still gets a printed,
          // signed receipt, and the value survives in the offline queue.
          try {
            await transactionsApi.recordTseSignature(api, result.id, {
              fiskalyTssId: hardwareCfg.tse.tssId,
              fiskalyClientId: hardwareCfg.tse.clientId,
              fiskalyTransactionId: intentionRes.intention.fiskalyTransactionId,
              fiskalyTransactionNumber: String(sig.transactionNumber),
              signatureValue: sig.signatureValue,
              signatureCounter: String(sig.signatureCounter),
              signatureAlgorithm: sig.signatureAlgorithm,
              qrCodeData: sig.qrCodePayload,
              tseStartTime: sig.startedAt,
              tseEndTime: sig.finishedAt,
            });
          } catch (err) {
            // Record-failed (path b): we HOLD the signature but the server POST
            // failed. Enqueue the SIGNED entry to the durable queue so the drain
            // re-POSTs it — never re-FINISH. Previously this was lost after the
            // toast; now it survives crash + sign-out.
            const queued = await enqueueSignatureRecordOnly({
              config: hardwareCfg.tse,
              intention: intentionRes.intention,
              serverTransactionId: result.id,
              amountCents: totalCents,
              paymentKind,
              amountsPerVatId,
              receiptLocator: result.receiptLocator,
              signature: sig,
              error: err,
            });
            // Honest surface: if the durable queue write ALSO failed, the signature
            // survives only on the printed receipt — tell the operator to keep it.
            addToast(
              queued
                ? {
                    tone: 'alert',
                    title: 'TSE-Signatur nicht gespeichert',
                    body: 'Verkauf gebucht — die Signatur wird nachgereicht.',
                  }
                : {
                    tone: 'alert',
                    title: 'TSE-Signatur nicht gesichert',
                    body: 'Verkauf gebucht — bitte den gedruckten Beleg aufbewahren.',
                  },
            );
            // eslint-disable-next-line no-console
            console.warn('recordTseSignature failed (non-blocking)', err);
          }
        } else if (finishRes.kind === 'queued_offline') {
          addToast({
            tone: 'alert',
            title: 'TSE-Signatur in Warteschlange',
            body: 'Verkauf gebucht — Signatur wird später nachgereicht.',
          });
        }
      } else if (hardwareCfg.tse.tssId.length > 0) {
        // TSE is configured but unreachable — surface so the operator knows.
        addToast({
          tone: 'alert',
          title: 'TSE nicht erreichbar',
          body: 'Verkauf wurde ohne Signatur abgeschlossen.',
        });
      }
      return result;
    },
    [addToast, api, hardwareCfg.tse, lines, adjustedTotals, b2bActive, adjustedPerLineMath],
  );

  /**
   * §19.3 W-7 — fire-and-forget thermal print after a successful
   * finalize. The print happens AFTER `setFinalized(result)` so the UI
   * doesn't wait on paper — any failure surfaces as a toast and the
   * operator can re-print from a future Belege screen.
   *
   * Skipped silently when:
   *   • thermal printer IP is unset (operator hasn't configured it)
   *   • running outside Tauri (e.g. Vitest)
   */
  const buildReceiptData = useCallback(
    (
      result: FinalizeResponse,
      payments: NonNullable<FinalizeBody['payments']>,
    ): ThermalReceiptData => {
      const tse = lastTseSignatureRef.current;
      const cashPayment = payments.find((p) => p.paymentMethod === 'CASH');
      const cardPayment = payments.find((p) => p.paymentMethod === 'ZVT_CARD');
      const voucherPayment = payments.find((p) => p.paymentMethod === 'VOUCHER');
      const labelParts: string[] = [];
      if (cashPayment) labelParts.push('Bar');
      if (cardPayment) labelParts.push(`Karte ${cardPayment.zvtCardBrand ?? ''}`.trim());
      if (voucherPayment) labelParts.push('Gutschein');
      const paymentLabel = labelParts.join(' + ') || 'Zahlung';

      const activeTaxCodes = Array.from(
        new Set(
          lines.map((line) =>
            b2bActive && line.taxTreatmentCode === 'STANDARD_19'
              ? 'REVERSE_CHARGE_13B'
              : line.taxTreatmentCode,
          ),
        ),
      );

      const legalFooters = activeTaxCodes
        .map((code) => TAX_LEGAL_TEXTS[code])
        .filter(Boolean) as string[];

      // Shop identity: Owner-editable via GET /api/shop-info (system_settings,
      // migration 0044), with the bundled SHOP_INFO constant as the fallback.
      const shop = resolveShopInfo(shopApi);
      const data: ThermalReceiptData = {
        shopName: shop.name,
        shopAddress: [shop.tagline, ...shop.address].filter((l) => l.trim().length > 0),
        shopVatId: shop.vatId,
        shopPhone: shop.phone,
        receiptLocator: result.receiptLocator,
        printedAt: new Date(result.finalizedAt).toLocaleString('de-DE', {
          timeZone: 'Europe/Berlin',
        }),
        // The customer receipt must not carry machine text: a UUID slice
        // ("Bediener 5f3a2c") is a raw id fragment, not a name (doctrine a), and
        // SessionActor exposes no display name. Show the honest role instead; the
        // real per-operator identity lives in the server-side fiscal ledger
        // (actorUserId). Named operators on the receipt would need the server to
        // expose the user's name — a separate enhancement.
        cashierName: sessionActor?.isOwner ? 'Inhaber' : 'Bediener',
        shiftId: null,
        items: lines.map((line, idx) => {
          const math = adjustedPerLineMath[idx];
          const discountSuffix =
            math && math.lineDiscountCents > 0n
              ? ` (Rabatt −${fromCents(math.lineDiscountCents)} €)`
              : '';
          return {
            name: `${line.name}${discountSuffix}`,
            quantity: 1,
            unitPriceEur: math ? fromCents(math.lineTotalCents) : line.listPriceEur,
            lineTotalEur: math ? fromCents(math.lineTotalCents) : line.listPriceEur,
            vatLabel: math
              ? math.appliedVatRate !== null
                ? `${Math.round(Number(math.appliedVatRate) * 100)}%`
                : ''
              : '',
          };
        }),
        subtotalEur: adjustedTotals.subtotalEur,
        vatEur: adjustedTotals.vatEur,
        totalEur: adjustedTotals.totalEur,
        paymentMethodLabel: paymentLabel,
        cashReceivedEur: cashPayment ? cashReceivedEur || cashPayment.amountEur : null,
        changeEur: cashPayment && cashReceivedEur ? fromCents(changeCentsForPrint()) : null,
        tseSignatureValue: tse?.signatureValue ?? 'TSE Ausfall',
        tseSignatureCounter: tse?.signatureCounter ?? 'TSE Ausfall',
        tseTransactionNumber: tse?.transactionNumber ?? 'TSE Ausfall',
        tseQrPayload: tse?.qrPayload ?? 'TSE Ausfall',
        footerLines: [
          ...(voucherPayment ? [`Gutschein eingelöst: −${voucherPayment.amountEur} €`] : []),
          ...(customFooter && customFooter.length > 0
            ? customFooter
            : ['Vielen Dank für Ihren Besuch.', 'Beleg auf Wunsch elektronisch.']),
          ...legalFooters,
        ],
      };
      // Remember it so the operator can re-print after closing the preview.
      setLastReceipt(data);
      return data;
    },
    [
      cashReceivedEur,
      lines,
      adjustedPerLineMath,
      adjustedTotals,
      b2bActive,
      sessionActor,
      shopApi,
      customFooter,
      dueCents,
      setLastReceipt,
    ],
  );

  /** Whether a thermal print can actually be attempted right now. USB mode is
   *  ready once a printer queue is picked; network mode needs an IP. */
  const canPrint =
    isRunningInTauri() &&
    (hardwareCfg.thermal.mode === 'usb'
      ? hardwareCfg.thermal.printerName.length > 0
      : hardwareCfg.thermal.ip.length > 0);

  /**
   * Send an already-built receipt to the thermal printer. Called from the
   * preview's "Drucken" button. On success the preview closes; on failure a
   * toast surfaces and the operator can retry or hand over a digital copy.
   */
  const printReceipt = useCallback(
    async (data: ThermalReceiptData): Promise<void> => {
      if (!canPrint) {
        addToast({
          tone: 'info',
          title: 'Kein Drucker',
          body: 'Beleg nur als Vorschau — Drucker unter „Geräte" einrichten.',
        });
        return;
      }
      setPrinting(true);
      try {
        // USB mode → raw ESC/POS to the OS queue (no IP); network → ip:port.
        const endpoint =
          hardwareCfg.thermal.mode === 'usb'
            ? { ip: '', port: 9100, printerName: hardwareCfg.thermal.printerName }
            : { ip: hardwareCfg.thermal.ip, port: hardwareCfg.thermal.port };
        await thermalClient.print(endpoint, data);
        setPreviewData(null);
      } catch (err) {
        addToast({
          tone: 'alert',
          title: 'Druck fehlgeschlagen',
          body: isHardwareError(err)
            ? describeHardwareError(err)
            : 'Drucker prüfen — Beleg digital ausgegeben.',
        });
      } finally {
        setPrinting(false);
      }
    },
    [
      addToast,
      canPrint,
      hardwareCfg.thermal.mode,
      hardwareCfg.thermal.printerName,
      hardwareCfg.thermal.ip,
      hardwareCfg.thermal.port,
    ],
  );

  /** Helper for the print path — change is cash minus the post-voucher due. */
  function changeCentsForPrint(): bigint {
    try {
      const cash = toCents(cashReceivedEur || '0');
      return cash >= dueCents ? cash - dueCents : 0n;
    } catch {
      return 0n;
    }
  }

  /**
   * CASH path — runs the TSE sandwich + invalidates dependent queries.
   *
   * §19.3 W-1 mutex: `inFlightRef.current` is read+set SYNCHRONOUSLY.
   * A double-click that fires before React commits the `setSubmitting`
   * state would re-enter this callback; the ref guard catches it
   * before any side-effect runs.
   */
  const submit = useCallback(async () => {
    if (inFlightRef.current) return;
    if (!canSubmit) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      // Resolve the B2B/§10 customer BEFORE the fiscal sandwich — a lookup throw
      // here aborts cleanly (cash, no charge yet).
      const resolvedCustomerId = await resolveB2bCustomerId();
      // Voucher leg (if any) first, then the cash remainder — Σ = total.
      const payments: FinalizeBody['payments'] = [];
      if (appliedVoucher && tender.appliedVoucherCents > 0n) {
        payments.push({
          paymentMethod: 'VOUCHER',
          amountEur: fromCents(tender.appliedVoucherCents),
          externalRef: appliedVoucher.code,
        });
      }
      if (tender.dueCents > 0n) {
        payments.push({ paymentMethod: 'CASH', amountEur: fromCents(tender.dueCents) });
      }
      const result = await finalizeWithTse(
        payments,
        tender.dueCents > 0n ? 'Bar' : 'Unbar',
        resolvedCustomerId,
      );
      setFinalized(result);
      addToast({
        tone: 'success',
        title: 'Beleg ausgegeben',
        body: `Beleg-Nr. ${result.receiptLocator}`,
      });
      // Redeem the voucher against the now-finalized transaction (decrements its
      // balance). A failure here doesn't undo the sale — surface it for manual fix.
      if (appliedVoucher && tender.appliedVoucherCents > 0n) {
        try {
          await api.request(
            'POST',
            `/api/vouchers/${encodeURIComponent(appliedVoucher.code)}/redeem`,
            {
              transactionId: result.id,
              amountEur: fromCents(tender.appliedVoucherCents),
            },
          );
        } catch {
          addToast({
            tone: 'alert',
            title: 'Gutschein-Verbuchung',
            body: 'Beleg ausgegeben, aber der Gutschein konnte nicht verbucht werden — bitte manuell prüfen.',
          });
        }
      }
      // §19.3 W-7 — pop the receipt preview; the operator confirms the print.
      setPreviewData(buildReceiptData(result, payments));
      await Promise.all([
        qc.invalidateQueries({ queryKey: dashboardQueryKey }),
        qc.invalidateQueries({ queryKey: ['products', 'list'] }),
        qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
      ]);
    } catch (err) {
      if (err instanceof ApiOfflineQueuedError) {
        // Phase 1.4: the outbox now owns this key — hand the intent OFF (resolved
        // into the outbox), not fail. The reconcile must not re-enqueue it.
        void posIntentsStore.markHandedOff(idempotencyKeyRef.current);
        const offlineLocator = `OFFLINE-${idempotencyKeyRef.current.slice(0, 8).toUpperCase()}`;
        const dummyResult: FinalizeResponse = {
          id: idempotencyKeyRef.current,
          receiptLocator: offlineLocator,
          finalizedAt: new Date(err.enqueuedAt).toISOString(),
          ledgerEventId: -1,
          direction: 'VERKAUF',
          totalEur: adjustedTotals.totalEur,
          storno: false,
        };
        setFinalized(dummyResult);
        addToast({
          tone: 'info',
          title: 'Offline gespeichert',
          body: `Beleg wird synchronisiert (Temp-Nr. ${offlineLocator})`,
        });

        const payments: FinalizeBody['payments'] = [];
        if (appliedVoucher && tender.appliedVoucherCents > 0n) {
          payments.push({
            paymentMethod: 'VOUCHER',
            amountEur: fromCents(tender.appliedVoucherCents),
            externalRef: appliedVoucher.code,
          });
          // Offline: the voucher can't be redeemed now (no transaction id yet).
          addToast({
            tone: 'alert',
            title: 'Gutschein offline',
            body: 'Gutschein wird erst beim Synchronisieren verbucht — bitte später prüfen.',
          });
        }
        if (tender.dueCents > 0n) {
          payments.push({ paymentMethod: 'CASH', amountEur: fromCents(tender.dueCents) });
        }
        setPreviewData(buildReceiptData(dummyResult, payments));

        await Promise.all([
          qc.invalidateQueries({ queryKey: dashboardQueryKey }),
          qc.invalidateQueries({ queryKey: ['products', 'list'] }),
          qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
        ]);
      } else {
        // § 10 GwG — if the server refused for a missing buyer ID, drive the
        // operator straight to the KaeuferPicker instead of a dead error.
        if (isKycRequiredError(err)) setBuyerPickerOpen(true);
        setError(formatPaymentError(err));
      }
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [
    addToast,
    canSubmit,
    finalizeWithTse,
    resolveB2bCustomerId,
    buildReceiptData,
    qc,
    api,
    appliedVoucher,
    tender,
    adjustedTotals.totalEur,
  ]);

  /**
   * CARD (ZVT) path — opens spinner, authorises on the terminal, then
   * runs the same TSE sandwich + finalize.
   *
   * §19.3 W-1/W-2 mutex: `inFlightRef.current` is the FIRST line of
   * defence against a double-click. The original guard
   * (`lines.length === 0 || submitting || finalized !== null`) reads
   * stale state from the React closure — by the time it runs, a fast
   * second click MAY have already passed the same check. The ref is
   * synchronous and immediately visible to the second invocation.
   *
   * Without this guard, a double-click on "Karte autorisieren" runs
   * `zvtClient.authorize` TWICE → customer's card is debited twice.
   */
  const submitCard = useCallback(async () => {
    if (inFlightRef.current) return;
    if (lines.length === 0 || finalized !== null) return;
    if (!hardwareCfg.zvt.ip) {
      addToast({
        tone: 'alert',
        title: 'Terminal nicht konfiguriert',
        body: 'Bitte IP-Adresse unter Einstellungen → Hardware setzen.',
      });
      return;
    }
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);

    // Resolve the B2B/§10 customer BEFORE touching the terminal — a lookup throw
    // must NOT happen after the card is charged. Cached in a ref, so the
    // finalize-retry branch below reuses it without re-resolving.
    let resolvedCustomerId: string | null;
    try {
      resolvedCustomerId = await resolveB2bCustomerId();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde konnte nicht ermittelt werden.');
      setSubmitting(false);
      inFlightRef.current = false;
      return;
    }

    // §19.3 C-3 — if a PRIOR authorization succeeded but its finalize failed,
    // REUSE that authorization. Re-authorizing here would debit the card a
    // second time. We only touch the terminal when there's no pending auth.
    let zvt: ZvtResult;
    if (pendingAuthRef.current) {
      zvt = pendingAuthRef.current;
    } else {
      setZvtBusy(true);
      try {
        const totalCents = Number(toCents(adjustedTotals.totalEur));
        zvt = await zvtClient.authorize(
          { ip: hardwareCfg.zvt.ip, port: hardwareCfg.zvt.port },
          totalCents,
        );
      } catch (err) {
        setError(
          isHardwareError(err) ? describeHardwareError(err) : 'Karten-Terminal nicht erreichbar.',
        );
        // No charge happened — release the mutex + UI flags so the operator
        // can re-attempt (this WILL re-authorize, which is correct here).
        setZvtBusy(false);
        setSubmitting(false);
        inFlightRef.current = false;
        return;
      } finally {
        setZvtBusy(false);
      }

      if (!zvt.success) {
        setError(zvt.errorMessage ?? 'Karte wurde abgelehnt.');
        setSubmitting(false);
        inFlightRef.current = false;
        return;
      }

      // Authorization captured — from here on, the card IS charged. Stash it
      // so any finalize failure retries finalize-only, never re-authorizes.
      pendingAuthRef.current = zvt;
    }

    try {
      const payments: FinalizeBody['payments'] = [
        {
          paymentMethod: 'ZVT_CARD' as PaymentMethod,
          amountEur: adjustedTotals.totalEur,
          ...(zvt.authorizationCode ? { zvtReceiptNumber: zvt.authorizationCode } : {}),
          ...(zvt.cardBrand ? { zvtCardBrand: zvt.cardBrand } : {}),
          ...(zvt.cardPanMasked ? { zvtCardPanMasked: zvt.cardPanMasked } : {}),
        },
      ];
      const result = await finalizeWithTse(payments, 'Unbar', resolvedCustomerId);
      // Finalize succeeded — the authorization is consumed; clear it so a fresh
      // sale can't accidentally replay this card charge.
      pendingAuthRef.current = null;
      setFinalized(result);
      addToast({
        tone: 'success',
        title: 'Karte autorisiert · Beleg ausgegeben',
        body: `Auth ${zvt.authorizationCode ?? '—'}`,
      });
      // §19.3 W-7 — pop the receipt preview; the operator confirms the print.
      setPreviewData(buildReceiptData(result, payments));
      await Promise.all([
        qc.invalidateQueries({ queryKey: dashboardQueryKey }),
        qc.invalidateQueries({ queryKey: ['products', 'list'] }),
        qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
      ]);
    } catch (err) {
      if (err instanceof ApiOfflineQueuedError) {
        // Phase 1.4: the outbox now owns this key — hand the intent OFF (resolved
        // into the outbox), not fail. The reconcile must not re-enqueue it.
        void posIntentsStore.markHandedOff(idempotencyKeyRef.current);
        // §19.3 C-3 — card AUTHORIZED + finalize QUEUED offline. The sale is
        // safely captured for replay (GoBD §146); telling the cashier to Storno
        // would wrongly reverse a booked charge. Advance to the receipt phase.
        pendingAuthRef.current = null;
        const offlineLocator = `OFFLINE-${idempotencyKeyRef.current.slice(0, 8).toUpperCase()}`;
        const dummyResult: FinalizeResponse = {
          id: idempotencyKeyRef.current,
          receiptLocator: offlineLocator,
          finalizedAt: new Date(err.enqueuedAt).toISOString(),
          ledgerEventId: -1,
          direction: 'VERKAUF',
          totalEur: adjustedTotals.totalEur,
          storno: false,
        };
        setFinalized(dummyResult);
        addToast({
          tone: 'info',
          title: 'Karte autorisiert · offline gespeichert',
          body: `Beleg wird synchronisiert (Temp-Nr. ${offlineLocator})`,
        });
        const payments: FinalizeBody['payments'] = [
          {
            paymentMethod: 'ZVT_CARD' as PaymentMethod,
            amountEur: adjustedTotals.totalEur,
            ...(zvt.authorizationCode ? { zvtReceiptNumber: zvt.authorizationCode } : {}),
            ...(zvt.cardBrand ? { zvtCardBrand: zvt.cardBrand } : {}),
            ...(zvt.cardPanMasked ? { zvtCardPanMasked: zvt.cardPanMasked } : {}),
          },
        ];
        setPreviewData(buildReceiptData(dummyResult, payments));
        await Promise.all([
          qc.invalidateQueries({ queryKey: dashboardQueryKey }),
          qc.invalidateQueries({ queryKey: ['products', 'list'] }),
          qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
        ]);
      } else {
        // §19.3 C-3 — the card was already charged but finalize failed for a
        // genuine reason (validation, reservation, step-up cancel). We KEEP
        // `pendingAuthRef` so the next "Karte autorisieren" click retries the
        // finalize against the SAME authorization instead of charging again.
        //
        // § 10 GwG — if it failed for a missing buyer ID, open the KaeuferPicker
        // so the operator can attach + verify a buyer; the retry then finalizes
        // against the same authorization (no second charge).
        if (isKycRequiredError(err)) setBuyerPickerOpen(true);
        setError(
          `Buchung fehlgeschlagen NACH Karten-Autorisierung. Bitte erneut „Karte autorisieren" — die Zahlung wird ohne erneute Belastung gebucht. Details: ${formatPaymentError(err)}`,
        );
      }
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [
    addToast,
    finalized,
    finalizeWithTse,
    resolveB2bCustomerId,
    hardwareCfg.zvt.ip,
    hardwareCfg.zvt.port,
    lines.length,
    qc,
    adjustedTotals.totalEur,
    buildReceiptData,
  ]);

  /**
   * SPLIT path (Phase C1) — cash + card in ONE sale.
   *
   * The operator entered a PARTIAL cash leg; the remainder is authorized on the
   * card terminal and BOTH legs are posted on the same finalize (Σ legs ===
   * total, server-validated). This reuses `submitCard`'s double-charge guard:
   *   • `inFlightRef` mutex — a double-click can never run two authorizations.
   *   • `pendingAuthRef` — a SUCCESSFUL card auth whose finalize then failed is
   *     stashed; a retry finalizes against the SAME auth (no second charge).
   *
   * The card leg is authorized for EXACTLY `split.cardCents` — not the gross
   * total — so the cardholder is debited only the remainder.
   */
  const submitSplit = useCallback(async () => {
    if (inFlightRef.current) return;
    if (lines.length === 0 || finalized !== null) return;
    if (!split.valid) return;
    if (!hardwareCfg.zvt.ip) {
      addToast({
        tone: 'alert',
        title: 'Terminal nicht konfiguriert',
        body: 'Kartenanteil benötigt ein Terminal — Einstellungen → Hardware.',
      });
      return;
    }
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);

    // Resolve the B2B/§10 customer BEFORE touching the terminal — a lookup throw
    // must NOT happen after the card is charged.
    let resolvedCustomerId: string | null;
    try {
      resolvedCustomerId = await resolveB2bCustomerId();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde konnte nicht ermittelt werden.');
      setSubmitting(false);
      inFlightRef.current = false;
      return;
    }

    // §19.3 C-3 — reuse a prior successful authorization; never re-authorize.
    let zvt: ZvtResult;
    if (pendingAuthRef.current) {
      zvt = pendingAuthRef.current;
    } else {
      setZvtBusy(true);
      try {
        zvt = await zvtClient.authorize(
          { ip: hardwareCfg.zvt.ip, port: hardwareCfg.zvt.port },
          Number(split.cardCents),
        );
      } catch (err) {
        setError(
          isHardwareError(err) ? describeHardwareError(err) : 'Karten-Terminal nicht erreichbar.',
        );
        setZvtBusy(false);
        setSubmitting(false);
        inFlightRef.current = false;
        return;
      } finally {
        setZvtBusy(false);
      }
      if (!zvt.success) {
        setError(zvt.errorMessage ?? 'Karte wurde abgelehnt.');
        setSubmitting(false);
        inFlightRef.current = false;
        return;
      }
      pendingAuthRef.current = zvt;
    }

    // Build the legs: VOUCHER (if any) + CASH (the partial) + ZVT_CARD (remainder).
    // The split math runs on the POST-voucher due, so voucher + cash + card === total.
    const buildSplitPayments = (): FinalizeBody['payments'] => {
      const payments: FinalizeBody['payments'] = [];
      if (appliedVoucher && tender.appliedVoucherCents > 0n) {
        payments.push({
          paymentMethod: 'VOUCHER',
          amountEur: fromCents(tender.appliedVoucherCents),
          externalRef: appliedVoucher.code,
        });
      }
      payments.push({ paymentMethod: 'CASH', amountEur: fromCents(split.cashCents) });
      payments.push({
        paymentMethod: 'ZVT_CARD' as PaymentMethod,
        amountEur: fromCents(split.cardCents),
        ...(zvt.authorizationCode ? { zvtReceiptNumber: zvt.authorizationCode } : {}),
        ...(zvt.cardBrand ? { zvtCardBrand: zvt.cardBrand } : {}),
        ...(zvt.cardPanMasked ? { zvtCardPanMasked: zvt.cardPanMasked } : {}),
      });
      return payments;
    };

    try {
      const payments = buildSplitPayments();
      const result = await finalizeWithTse(payments, 'Unbar', resolvedCustomerId);
      pendingAuthRef.current = null;
      setFinalized(result);
      addToast({
        tone: 'success',
        title: 'Bar + Karte · Beleg ausgegeben',
        body: `Bar ${fromCents(split.cashCents)} € · Karte ${fromCents(split.cardCents)} €`,
      });
      // Redeem the voucher against the finalized transaction (decrements balance).
      if (appliedVoucher && tender.appliedVoucherCents > 0n) {
        try {
          await api.request(
            'POST',
            `/api/vouchers/${encodeURIComponent(appliedVoucher.code)}/redeem`,
            {
              transactionId: result.id,
              amountEur: fromCents(tender.appliedVoucherCents),
            },
          );
        } catch {
          addToast({
            tone: 'alert',
            title: 'Gutschein-Verbuchung',
            body: 'Beleg ausgegeben, aber der Gutschein konnte nicht verbucht werden — bitte manuell prüfen.',
          });
        }
      }
      setPreviewData(buildReceiptData(result, payments));
      await Promise.all([
        qc.invalidateQueries({ queryKey: dashboardQueryKey }),
        qc.invalidateQueries({ queryKey: ['products', 'list'] }),
        qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
      ]);
    } catch (err) {
      if (err instanceof ApiOfflineQueuedError) {
        // Phase 1.4: the outbox now owns this key — hand the intent OFF (resolved
        // into the outbox), not fail. The reconcile must not re-enqueue it.
        void posIntentsStore.markHandedOff(idempotencyKeyRef.current);
        // Card AUTHORIZED + finalize QUEUED offline — the sale is safely captured
        // for replay (GoBD §146). Advance to the receipt phase; a Storno would
        // wrongly reverse a booked charge.
        pendingAuthRef.current = null;
        const offlineLocator = `OFFLINE-${idempotencyKeyRef.current.slice(0, 8).toUpperCase()}`;
        const dummyResult: FinalizeResponse = {
          id: idempotencyKeyRef.current,
          receiptLocator: offlineLocator,
          finalizedAt: new Date(err.enqueuedAt).toISOString(),
          ledgerEventId: -1,
          direction: 'VERKAUF',
          totalEur: adjustedTotals.totalEur,
          storno: false,
        };
        setFinalized(dummyResult);
        addToast({
          tone: 'info',
          title: 'Bar + Karte · offline gespeichert',
          body: `Beleg wird synchronisiert (Temp-Nr. ${offlineLocator})`,
        });
        if (appliedVoucher && tender.appliedVoucherCents > 0n) {
          addToast({
            tone: 'alert',
            title: 'Gutschein offline',
            body: 'Gutschein wird erst beim Synchronisieren verbucht — bitte später prüfen.',
          });
        }
        setPreviewData(buildReceiptData(dummyResult, buildSplitPayments()));
        await Promise.all([
          qc.invalidateQueries({ queryKey: dashboardQueryKey }),
          qc.invalidateQueries({ queryKey: ['products', 'list'] }),
          qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
        ]);
      } else {
        // §19.3 C-3 — card already charged but finalize failed. KEEP pendingAuthRef
        // so a retry finalizes against the SAME auth (no second charge).
        if (isKycRequiredError(err)) setBuyerPickerOpen(true);
        setError(
          `Buchung fehlgeschlagen NACH Karten-Autorisierung. Bitte erneut bestätigen — die Zahlung wird ohne erneute Belastung gebucht. Details: ${formatPaymentError(err)}`,
        );
      }
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [
    addToast,
    api,
    appliedVoucher,
    tender,
    split,
    finalized,
    finalizeWithTse,
    resolveB2bCustomerId,
    hardwareCfg.zvt.ip,
    hardwareCfg.zvt.port,
    lines.length,
    qc,
    adjustedTotals.totalEur,
    buildReceiptData,
  ]);

  const closeAfterFinalize = useCallback(() => {
    // Genuine finalize-SUCCESS close only (the result phase's "Neue Karte" CTA).
    // Cancel/Esc go through onClose directly; an error keeps the dialog open —
    // so this fires exactly when a sale really completed.
    if (finalized !== null) onFinalizeSuccess?.();
    clearCart();
    onClose();
  }, [clearCart, finalized, onClose, onFinalizeSuccess]);

  // Submit dispatcher — picks CASH vs ZVT_CARD based on toggle.
  //
  // § 10 GwG: a high-value sale (≥ €2.000) with no KYC-verified buyer attached
  // CANNOT finalize — the server trigger refuses it. Rather than let the
  // operator hit a dead 403, the primary action first opens the KaeuferPicker
  // so they can attach + verify a buyer; finalize runs on the next click.
  const dispatchSubmit = useCallback(() => {
    if (needsBuyer) {
      setBuyerPickerOpen(true);
      return;
    }
    if (paymentChoice === 'CASH') {
      // Phase C1 — when the split toggle is on the cash field is a PARTIAL leg
      // and the remainder is charged to the card; otherwise it's full cash.
      if (splitCard) void submitSplit();
      else void submit();
    } else void submitCard();
  }, [needsBuyer, paymentChoice, splitCard, submit, submitCard, submitSplit]);

  /**
   * One-tap full-amount card (design-brief §1): from the cash panel the cashier
   * taps `Karte` and goes STRAIGHT to the ZVT terminal for the full total — no
   * intermediate amount screen. It flips the visible method to card (so the UI
   * state stays coherent) and fires `submitCard` directly; routing through the
   * dispatcher would read the not-yet-committed `paymentChoice`. The double-pay
   * idempotency guard inside `submitCard` (inFlightRef) is untouched.
   */
  const payCardFull = useCallback(() => {
    if (needsBuyer) {
      setBuyerPickerOpen(true);
      return;
    }
    setPaymentChoice('ZVT_CARD');
    void submitCard();
  }, [needsBuyer, submitCard]);

  // ── Keyboard-first cash finalize (Wave 1) ──────────────────────────────
  // With NO text field focused (Kundensuche / USt-IdNr / Gutschein keep their own
  // Enter), Enter drives the most-repeated sale of the day — exact cash — with no
  // aiming: an empty cash entry → prefill "Passend" (exact due); once cash covers
  // → finalize. So a plain cash sale is Enter, Enter. This is a pure focus/keydown
  // layer on top of the existing, untouched tender + fiscal math (computeTender /
  // dispatchSubmit are byte-identical). Placed after dispatchSubmit so the deps
  // array is out of its temporal dead zone.
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Enter') return;
      if (submitting || finalized !== null) return;
      // Card + split run their own deliberate flow (terminal round-trip).
      if (paymentChoice !== 'CASH' || splitCard) return;
      if (lines.length === 0) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = (el?.tagName ?? '').toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        (el?.isContentEditable ?? false)
      ) {
        return; // a real text field is focused — let it keep its own Enter.
      }
      ev.preventDefault();
      if (canSubmit) {
        dispatchSubmit();
      } else if (dueCents > 0n && cashCents < dueCents && b2bValid && !needsBuyer) {
        setCashReceivedEur(fromCents(dueCents)); // prefill Passend; a second Enter finalizes.
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    open,
    submitting,
    finalized,
    paymentChoice,
    splitCard,
    lines.length,
    canSubmit,
    dueCents,
    cashCents,
    b2bValid,
    needsBuyer,
    dispatchSubmit,
  ]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bezahlen"
      onClick={() => {
        // §19.3 W-2 — backdrop dismiss must NOT win against an in-flight
        // mutation. We check the synchronous mutex ref AND the React state
        // flags. The ref protects against the same React-commit-window
        // race that submit/submitCard guard against.
        if (inFlightRef.current || submitting || zvtBusy) return;
        if (finalized === null) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--w14-overlay)',
        zIndex: 1050,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(ev) => ev.stopPropagation()}
        style={{
          width: 'min(520px, 100%)',
          boxShadow: 'var(--w14-shadow-modal)',
          // Cashier-confirm fix: during the input phase bound the card to the
          // viewport and make it a flex column so the payment body can scroll
          // while the action footer stays pinned + reachable (the tall AmountPad
          // used to push the confirm button below the fold). The receipt phase
          // keeps its natural sizing.
          ...(finalized === null
            ? {
                maxHeight: 'calc(100vh - 48px)',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }
            : {}),
        }}
      >
        {finalized === null ? (
          <PaymentInput
            paymentChoice={paymentChoice}
            setPaymentChoice={setPaymentChoice}
            totalEur={adjustedTotals.totalEur}
            dueEur={fromCents(dueCents)}
            appliedVoucher={appliedVoucher}
            onApplyVoucher={setAppliedVoucher}
            cashReceivedEur={cashReceivedEur}
            setCashReceivedEur={setCashReceivedEur}
            changeEur={fromCents(changeCents)}
            enoughCash={enoughCash}
            cardConfigured={hardwareCfg.zvt.ip.length > 0}
            canSubmitCash={canSubmit}
            canSubmitCard={canSubmitCard}
            splitCard={splitCard}
            setSplitCard={setSplitCard}
            canSubmitSplit={canSubmitSplit}
            splitCardEur={split.valid ? fromCents(split.cardCents) : null}
            needsBuyer={needsBuyer}
            selectedBuyer={selectedBuyer}
            onOpenBuyerPicker={() => setBuyerPickerOpen(true)}
            submitting={submitting}
            error={error}
            onSubmit={dispatchSubmit}
            onPayCardFull={payCardFull}
            onCancel={onClose}
            isB2b={isB2b}
            setIsB2b={setIsB2b}
            vatId={vatId}
            setVatId={setVatId}
            viesStatus={viesStatus}
            viesCompany={viesCompany}
            viesAddress={viesAddress}
            manualCompany={manualCompany}
            setManualCompany={setManualCompany}
            manualAddress={manualAddress}
            setManualAddress={setManualAddress}
            verifyVat={verifyVat}
          />
        ) : (
          <ReceiptResult
            finalized={finalized}
            cashReceivedEur={cashReceivedEur}
            changeEur={fromCents(changeCents)}
            onDismiss={closeAfterFinalize}
          />
        )}
      </ParchmentCard>

      {/* § 10 GwG buyer step — attach + ID-verify a buyer for a ≥ €2.000 sale. */}
      {buyerPickerOpen && (
        <KaeuferPicker
          totalEur={adjustedTotals.totalEur}
          initialCustomerId={selectedBuyer?.id ?? null}
          onConfirm={(customer) => {
            setSelectedBuyer(customer);
            setBuyerPickerOpen(false);
            setError(null);
          }}
          onCancel={() => setBuyerPickerOpen(false)}
        />
      )}

      {/* ZVT terminal owns the cardholder's attention — block the UI. */}
      {zvtBusy && <ZvtSpinner amountEur={adjustedTotals.totalEur} />}

      {/* Receipt preview — pops up after finalize; operator confirms the print. */}
      {previewData && (
        <ReceiptPreview
          data={previewData}
          printing={printing}
          canPrint={canPrint}
          onPrint={() => void printReceipt(previewData)}
          onClose={() => setPreviewData(null)}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Input phase
// ────────────────────────────────────────────────────────────────────────

function PaymentInput({
  paymentChoice,
  setPaymentChoice,
  totalEur,
  dueEur,
  appliedVoucher,
  onApplyVoucher,
  cashReceivedEur,
  setCashReceivedEur,
  changeEur,
  enoughCash,
  cardConfigured,
  canSubmitCash,
  canSubmitCard,
  splitCard,
  setSplitCard,
  canSubmitSplit,
  splitCardEur,
  needsBuyer,
  selectedBuyer,
  onOpenBuyerPicker,
  submitting,
  error,
  onSubmit,
  onPayCardFull,
  onCancel,
  isB2b,
  setIsB2b,
  vatId,
  setVatId,
  viesStatus,
  viesCompany,
  viesAddress,
  manualCompany,
  setManualCompany,
  manualAddress,
  setManualAddress,
  verifyVat,
}: {
  paymentChoice: 'CASH' | 'ZVT_CARD';
  setPaymentChoice: (next: 'CASH' | 'ZVT_CARD') => void;
  totalEur: string;
  dueEur: string;
  appliedVoucher: AppliedVoucher | null;
  onApplyVoucher: (v: AppliedVoucher | null) => void;
  cashReceivedEur: string;
  setCashReceivedEur: (v: string) => void;
  changeEur: string;
  enoughCash: boolean;
  cardConfigured: boolean;
  canSubmitCash: boolean;
  canSubmitCard: boolean;
  splitCard: boolean;
  setSplitCard: (v: boolean) => void;
  canSubmitSplit: boolean;
  /** Card remainder to show on the confirm button (null when split invalid). */
  splitCardEur: string | null;
  needsBuyer: boolean;
  selectedBuyer: CustomerDetail | null;
  onOpenBuyerPicker: () => void;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
  /** One-tap full-amount card from the cash panel → straight to the terminal. */
  onPayCardFull: () => void;
  onCancel: () => void;
  isB2b: boolean;
  setIsB2b: (v: boolean) => void;
  vatId: string;
  setVatId: (v: string) => void;
  viesStatus: 'idle' | 'checking' | 'valid' | 'invalid' | 'unavailable' | 'timeout';
  viesCompany: string;
  viesAddress: string;
  manualCompany: string;
  setManualCompany: (v: string) => void;
  manualAddress: string;
  setManualAddress: (v: string) => void;
  verifyVat: () => void;
}): JSX.Element {
  const buttonLabel = (() => {
    if (submitting) return 'Schließt ab…';
    // § 10 GwG — when a verified buyer is still missing the primary action
    // routes to the KaeuferPicker, not to finalize. Label it as that step.
    if (needsBuyer) return 'Käufer zuordnen';
    // Explicit "this RECORDS the sale" wording — the old "Beleg ausgeben" read
    // like a print action, not a finalize.
    // Phase C1 — split routes through the card terminal for the remainder.
    if (paymentChoice === 'CASH') return splitCard ? 'Restbetrag Karte' : 'Zahlung abschließen';
    return 'Karte autorisieren';
  })();

  // The button stays clickable while a buyer is required (it opens the picker);
  // otherwise it follows the per-method finalize guard. In split mode the cash
  // panel uses the split guard (valid partial cash + card remainder).
  const canSubmit = needsBuyer
    ? !submitting
    : paymentChoice === 'CASH'
      ? splitCard
        ? canSubmitSplit
        : canSubmitCash
      : canSubmitCard;

  // Smart-denomination quick-tender chips — presentation only, derived from the
  // post-voucher `dueEur` via the canonical cents primitives (no math change).
  // Hidden in split mode (the cash leg there is a deliberate partial amount).
  const dueCents = (() => {
    try {
      return toCents(dueEur);
    } catch {
      return 0n;
    }
  })();
  const tenderChips = splitCard ? [] : computeTenderChips(dueCents);

  // Live "Noch zu zahlen" — outstanding cash (due minus entered cash, floored
  // at 0). Presentation only; the authoritative gate stays `canSubmit`.
  const cashOutstandingBasisCents = dueCents;
  const cashOutstandingCents = (() => {
    if (dueCents <= 0n) return 0n;
    let entered = 0n;
    if (isMoneyInput(cashReceivedEur)) {
      try {
        entered = toCents(cashReceivedEur);
      } catch {
        entered = 0n;
      }
    }
    return entered >= dueCents ? 0n : dueCents - entered;
  })();

  return (
    <>
      {/* Scrollable payment body — overflows independently so the pinned footer
          below stays reachable no matter how tall the AmountPad is. Plain block
          flow inside, so the existing spacing is unchanged. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.5rem',
            textAlign: 'center',
          }}
        >
          Bezahlen · {paymentChoice === 'CASH' ? 'Bar' : 'Karte'}
        </h2>

        {/* GwG §10: a sale ≥ €2.000 needs a KYC-verified buyer. The server
            (transactions_validate_kyc) is the authoritative gate; this block is
            the UX that lets the cashier satisfy it — open the KaeuferPicker to
            attach + ID-verify a buyer, or show the verified buyer once chosen. */}
        {evaluateKycGate({ direction: 'VERKAUF', totalCents: toCents(totalEur), customer: null })
          .thresholdReached && (
          <div
            style={{
              margin: '12px 0 0',
              padding: '10px 12px',
              borderRadius: 'var(--w14-radius-button)',
              border: `1px solid ${needsBuyer ? 'var(--w14-wax-red)' : 'var(--w14-gold)'}`,
              background: 'var(--w14-parchment-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {selectedBuyer && !needsBuyer ? (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span
                  style={{
                    color: 'var(--w14-ink-aged)',
                    fontFamily: 'var(--w14-font-display)',
                    fontSize: '0.85rem',
                  }}
                >
                  Käufer:{' '}
                  <strong style={{ color: 'var(--w14-gold)' }}>{selectedBuyer.fullName}</strong> ·
                  Ausweis geprüft ✓
                </span>
                <button
                  type="button"
                  onClick={onOpenBuyerPicker}
                  disabled={submitting}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--w14-ink-faded)',
                    fontFamily: 'var(--w14-font-display)',
                    fontStyle: 'italic',
                    fontSize: '0.8rem',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    textDecoration: 'underline',
                    textUnderlineOffset: 2,
                  }}
                >
                  ändern
                </button>
              </div>
            ) : (
              <>
                <p
                  role="note"
                  style={{
                    margin: 0,
                    color: 'var(--w14-ink-aged)',
                    fontSize: '0.82rem',
                    lineHeight: 1.4,
                  }}
                >
                  Käufer zuordnen — Ausweis erforderlich (ab 2.000&nbsp;€, § 10 GwG). Ohne geprüften
                  Käufer lehnt das System den Verkauf ab.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onOpenBuyerPicker}
                  disabled={submitting}
                >
                  Käufer zuordnen
                </Button>
              </>
            )}
          </div>
        )}

        {/* Payment-method toggle */}
        <div
          role="tablist"
          aria-label="Zahlungsart"
          style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 10 }}
        >
          <MethodChip
            active={paymentChoice === 'CASH'}
            label="Barzahlung"
            onClick={() => setPaymentChoice('CASH')}
            disabled={submitting}
          />
          <MethodChip
            active={paymentChoice === 'ZVT_CARD'}
            label="Kartenzahlung"
            onClick={() => setPaymentChoice('ZVT_CARD')}
            disabled={submitting || !cardConfigured}
            {...(!cardConfigured
              ? { disabledReason: 'Terminal nicht konfiguriert (Einstellungen → Hardware)' }
              : {})}
          />
        </div>

        {/* B2B Reverse Charge Toggle & Panel */}
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--w14-font-display)',
              fontSize: '0.9rem',
              color: 'var(--w14-ink-aged)',
            }}
          >
            <input
              type="checkbox"
              checked={isB2b}
              onChange={(e) => setIsB2b(e.target.checked)}
              disabled={submitting}
              style={{
                accentColor: 'var(--w14-gold)',
                cursor: submitting ? 'not-allowed' : 'pointer',
                width: 16,
                height: 16,
              }}
            />
            <span>B2B Reverse Charge (§ 13b UStG)</span>
          </label>

          {isB2b && (
            <div
              style={{
                padding: 12,
                borderRadius: 6,
                backgroundColor: 'var(--w14-parchment-2)',
                border: '1px dashed var(--w14-rule)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <input
                    type="text"
                    placeholder="USt-IdNr. (z.B. DE123456789)"
                    value={vatId}
                    onChange={(e) => setVatId(e.target.value)}
                    disabled={submitting || viesStatus === 'checking'}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 4,
                      border: '1px solid var(--w14-rule)',
                      backgroundColor: 'var(--w14-parchment-1)',
                      color: 'var(--w14-ink-aged)',
                      fontFamily: 'var(--w14-font-mono)',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>
                <Button
                  variant="ghost"
                  onClick={verifyVat}
                  disabled={submitting || viesStatus === 'checking' || !vatId.trim()}
                  style={{ alignSelf: 'stretch', padding: '0 16px' }}
                >
                  {viesStatus === 'checking' ? 'Prüft...' : 'Prüfen'}
                </Button>
              </div>

              {/* VIES Status display */}
              {viesStatus !== 'idle' && (
                <div style={{ fontSize: '0.85rem', fontFamily: 'var(--w14-font-display)' }}>
                  {viesStatus === 'checking' && (
                    <span style={{ color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>
                      USt-IdNr. wird über EU-VIES validiert…
                    </span>
                  )}
                  {viesStatus === 'valid' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ color: 'var(--w14-gold)', fontWeight: 600 }}>
                        ✓ USt-IdNr. gültig
                      </span>
                      {viesCompany && viesCompany !== '---' && (
                        <div style={{ color: 'var(--w14-ink-aged)' }}>
                          <strong>Firma:</strong> {viesCompany}
                        </div>
                      )}
                      {viesAddress && viesAddress !== '---' && (
                        <div style={{ color: 'var(--w14-ink-faded)' }}>
                          <strong>Adresse:</strong> {viesAddress}
                        </div>
                      )}
                    </div>
                  )}
                  {viesStatus === 'invalid' && (
                    <span style={{ color: 'var(--w14-wax-red)', fontWeight: 600 }}>
                      ✗ Ungültige USt-IdNr. laut EU-VIES-Datenbank.
                    </span>
                  )}
                  {viesStatus === 'unavailable' && (
                    <span style={{ color: 'var(--w14-wax-red)' }}>
                      ⚠ VIES-Dienst nicht erreichbar. Manuelle Prüfung erforderlich.
                    </span>
                  )}
                  {viesStatus === 'timeout' && (
                    <span style={{ color: 'var(--w14-wax-red)' }}>
                      ⚠ Zeitüberschreitung bei VIES-Prüfung. Manuelle Prüfung erforderlich.
                    </span>
                  )}
                </div>
              )}

              {/* Manual fallback fields if name/address is masked or VIES is down/timeout */}
              {(viesStatus === 'unavailable' ||
                viesStatus === 'timeout' ||
                (viesStatus === 'valid' && (!viesCompany || viesCompany === '---'))) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--w14-ink-faded)',
                      fontStyle: 'italic',
                    }}
                  >
                    {viesStatus === 'valid'
                      ? 'Daten durch EU-Datenschutz ausgeblendet. Bitte manuell ergänzen:'
                      : 'Bitte Firmenname und Adresse manuell eintragen:'}
                  </div>
                  <input
                    type="text"
                    placeholder="Firmenname"
                    value={manualCompany}
                    onChange={(e) => setManualCompany(e.target.value)}
                    disabled={submitting}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      borderRadius: 4,
                      border: '1px solid var(--w14-rule)',
                      backgroundColor: 'var(--w14-parchment-1)',
                      color: 'var(--w14-ink-aged)',
                      fontFamily: 'var(--w14-font-display)',
                      fontSize: '0.85rem',
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Adresse (z.B. Str, PLZ, Ort)"
                    value={manualAddress}
                    onChange={(e) => setManualAddress(e.target.value)}
                    disabled={submitting}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      borderRadius: 4,
                      border: '1px solid var(--w14-rule)',
                      backgroundColor: 'var(--w14-parchment-1)',
                      color: 'var(--w14-ink-aged)',
                      fontFamily: 'var(--w14-font-display)',
                      fontSize: '0.85rem',
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <DiamondRule label="Beleg" />

        {/* Permanent money anchor (design-brief §1) — the amount due is the
            single largest type on the payment screen, .w14-tabular, high
            contrast for the 80cm read. It never hides behind a tap.
            FONT RULE (cross-app): the single biggest money figure is TABULAR
            MONO (--w14-font-mono) in BOTH apps — this matches the mobile money
            hero in apps/mobile sell/FiscalConfirmSheet (font-mono-medium).
            Serif is reserved for titles; precise money stays column-aligned. */}
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 18px',
            background: 'var(--w14-parchment-3)',
            borderRadius: 'var(--w14-radius-card)',
          }}
        >
          <span
            className="w14-smallcaps"
            style={{
              fontSize: '0.95rem',
              letterSpacing: '0.08em',
              color: 'var(--w14-ink-aged)',
            }}
          >
            Zu zahlen
          </span>
          <span
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '2.4rem',
              fontWeight: 700,
              lineHeight: 1,
              color: 'var(--w14-ink)',
            }}
          >
            <MoneyAmount valueEur={totalEur} />
          </span>
        </div>

        {paymentChoice === 'CASH' ? (
          <>
            {/* Gift voucher — covers up to the full total; the rest is paid in cash. */}
            <VoucherField
              applied={appliedVoucher}
              onApplied={onApplyVoucher}
              disabled={submitting}
            />
            {appliedVoucher && (
              <table
                className="w14-tabular"
                style={{
                  marginTop: 12,
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontFamily: 'var(--w14-font-mono)',
                }}
              >
                <tbody>
                  <Row
                    label="Gutschein"
                    value={
                      <MoneyAmount
                        valueEur={`-${fromCents(toCents(totalEur) - toCents(dueEur))}`}
                      />
                    }
                    valueColor="var(--w14-gold)"
                  />
                  <Row
                    label="Zu zahlen (bar)"
                    value={<MoneyAmount valueEur={dueEur} emphasis />}
                    emphasised
                  />
                </tbody>
              </table>
            )}

            {/* Phase C1 — Bar + Karte split. When on, the entered cash is a
                PARTIAL leg and the remainder is charged to the card terminal.
                Hidden when no card terminal is configured (a split needs it). */}
            {toCents(dueEur) > 0n && cardConfigured && (
              <label
                style={{
                  marginTop: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--w14-font-display)',
                  fontSize: '0.9rem',
                  color: 'var(--w14-ink-aged)',
                }}
              >
                <input
                  type="checkbox"
                  checked={splitCard}
                  onChange={(e) => setSplitCard(e.target.checked)}
                  disabled={submitting}
                  style={{
                    accentColor: 'var(--w14-gold)',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    width: 16,
                    height: 16,
                  }}
                />
                <span>Betrag aufteilen — Restbetrag per Karte</span>
              </label>
            )}

            {/* Smart-denomination quick-tender (design-brief §1) — chips
                computed from the due via money-core; one tap pre-fills the
                exact cash field so the dominant cash sale needs zero keypad
                entry, and the live Rückgeld below updates instantly. Plus a
                one-tap full-amount Karte that goes straight to the terminal. */}
            {tenderChips.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <span
                  className="w14-smallcaps"
                  style={{
                    display: 'block',
                    marginBottom: 8,
                    fontSize: '0.78rem',
                    letterSpacing: '0.08em',
                    color: 'var(--w14-ink-faded)',
                  }}
                >
                  Schnellzahlung
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {tenderChips.map((chip) => (
                    <TenderChipButton
                      key={chip.valueEur + chip.label}
                      chip={chip}
                      active={isMoneyInput(cashReceivedEur) && cashReceivedEur === chip.valueEur}
                      disabled={submitting}
                      onClick={() => setCashReceivedEur(chip.valueEur)}
                    />
                  ))}
                  {cardConfigured && (
                    <button
                      type="button"
                      onClick={onPayCardFull}
                      disabled={submitting}
                      style={{
                        minHeight: 52,
                        padding: '0 18px',
                        flex: '1 1 auto',
                        background: 'var(--w14-parchment-2)',
                        border: '1px solid var(--w14-accent)',
                        borderRadius: 'var(--w14-radius-button)',
                        cursor: submitting ? 'not-allowed' : 'pointer',
                        opacity: submitting ? 0.5 : 1,
                        fontFamily: 'var(--w14-font-display)',
                        fontSize: '0.95rem',
                        fontWeight: 600,
                        color: 'var(--w14-accent)',
                        transition: 'background var(--w14-dur-short) var(--w14-ease-curator)',
                      }}
                    >
                      Karte
                    </button>
                  )}
                </div>
              </div>
            )}

            {toCents(dueEur) > 0n && (
              <div style={{ marginTop: 16 }}>
                <span
                  className="w14-smallcaps"
                  style={{
                    display: 'block',
                    marginBottom: 8,
                    fontSize: '0.78rem',
                    letterSpacing: '0.08em',
                    color: 'var(--w14-ink-faded)',
                  }}
                >
                  {splitCard ? 'Barbetrag (Teilzahlung)' : 'Erhaltener Betrag (bar)'}
                </span>
                {/* On-screen keypad — feeds the SAME cashReceivedEur the keyboard did. */}
                <div
                  style={{
                    opacity: submitting ? 0.5 : 1,
                    pointerEvents: submitting ? 'none' : 'auto',
                  }}
                >
                  <AmountPad
                    value={cashReceivedEur}
                    onChange={setCashReceivedEur}
                    dueEur={dueEur}
                  />
                </div>
                {!splitCard && (
                  <p
                    style={{
                      margin: '0.45rem 0 0',
                      fontSize: '0.78rem',
                      textAlign: 'center',
                      color: 'var(--w14-ink-faded)',
                    }}
                  >
                    Tipp: <strong>Enter</strong> füllt „Passend“ und schließt ab
                  </p>
                )}
              </div>
            )}

            {/* Prominent live money readout (design-brief §1). Three live
                states, all presentation-only (derived from the entered cash vs
                the post-voucher due via cents primitives):
                  • split mode → the exact card remainder ("Restbetrag (Karte)");
                  • cash short → "Noch zu zahlen" (the outstanding amount that
                    keeps the Bezahlen button disabled until it hits €0,00);
                  • cash covers → "Rückgeld" in verdigris (zero-change = €0,00). */}
            {(() => {
              // Outstanding = how much cash is still owed (0 once covered).
              const outstandingCents = (() => {
                if (cashOutstandingBasisCents <= 0n) return 0n;
                return cashOutstandingCents;
              })();
              const isShort = !splitCard && outstandingCents > 0n;
              const label = splitCard
                ? 'Restbetrag (Karte)'
                : isShort
                  ? 'Noch zu zahlen'
                  : 'Rückgeld';
              const valueColor = splitCard
                ? splitCardEur !== null
                  ? 'var(--w14-gold)'
                  : 'var(--w14-ink-faded)'
                : isShort
                  ? 'var(--w14-ink-aged)'
                  : enoughCash
                    ? 'var(--w14-verdigris)'
                    : 'var(--w14-ink-faded)';
              const displayValue = splitCard
                ? (splitCardEur ?? '0.00')
                : isShort
                  ? fromCents(outstandingCents)
                  : enoughCash
                    ? changeEur
                    : '0.00';
              return (
                <div
                  style={{
                    marginTop: 16,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 12,
                    padding: '12px 16px',
                    background: 'var(--w14-parchment-2)',
                    border: '1px solid var(--w14-rule)',
                    borderRadius: 'var(--w14-radius-card)',
                  }}
                >
                  <span
                    className="w14-smallcaps"
                    style={{
                      fontSize: '0.95rem',
                      letterSpacing: '0.08em',
                      color: 'var(--w14-ink-aged)',
                    }}
                  >
                    {label}
                  </span>
                  <span
                    className="w14-tabular"
                    style={{
                      fontFamily: 'var(--w14-font-mono)',
                      fontSize: '1.8rem',
                      fontWeight: 700,
                      color: valueColor,
                    }}
                  >
                    <MoneyAmount valueEur={displayValue} emphasis />
                  </span>
                </div>
              );
            })()}
          </>
        ) : (
          <p
            style={{
              margin: '18px 0 0',
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: '0.92rem',
              textAlign: 'center',
            }}
          >
            Bei Klick wird das Karten-Terminal angesprochen. Der Kunde bestätigt am Terminal.
          </p>
        )}

        {error && (
          <p
            role="alert"
            style={{
              color: 'var(--w14-wax-red)',
              margin: '14px 0 0',
              fontSize: '0.92rem',
              textAlign: 'center',
            }}
          >
            {error}
          </p>
        )}
      </div>

      {/* Pinned action footer — never scrolls, stays reachable no matter how
          tall the body is. Serves BOTH panels: CASH (finalize once cash ≥ due)
          and ZVT_CARD (authorize). canSubmit already encodes the per-panel
          guard, so the wiring is unchanged — only its position + the label. */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          gap: 12,
          alignItems: 'stretch',
          marginTop: 14,
          paddingTop: 14,
          borderTop: '1px solid var(--w14-rule)',
        }}
      >
        <Button
          variant="ghost"
          size="lg"
          onClick={onCancel}
          disabled={submitting}
          style={{ flex: 'none', alignSelf: 'stretch' }}
        >
          Abbrechen
        </Button>
        <Button
          variant="primary"
          size="lg"
          iconLeft={<Icon icon={Check} size={18} />}
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{
            flex: 1,
            // Bezahlen = effectively-infinite Fitts target (design-brief §1):
            // 72–88px tall, brass, bottom-right-anchored. The largest, most
            // dominant action in the dialog — survives the squint test.
            minHeight: 78,
            fontSize: '1.1rem',
            fontWeight: 600,
            // Goes solid brass the moment it can record the sale — an
            // unmistakable "ready to finalize" affordance (matches the active
            // brass treatment used elsewhere).
            ...(canSubmit
              ? {
                  backgroundColor: 'var(--w14-accent)',
                  borderColor: 'var(--w14-accent)',
                  color: 'var(--w14-accent-ink)',
                }
              : {}),
          }}
        >
          {buttonLabel}
          {paymentChoice === 'CASH' && !submitting && !needsBuyer ? (
            <>
              {' · '}
              {/* Collect the POST-voucher amount, not the gross total — when a
                  voucher covers part of the sale the cashier takes `dueEur` in
                  cash, so the button must read that (else it overstates).
                  In split mode the card covers the remainder, so the button
                  reads the CARD leg (what the terminal will authorize). */}
              <MoneyAmount valueEur={splitCard ? (splitCardEur ?? dueEur) : dueEur} />
            </>
          ) : null}
        </Button>
      </div>
    </>
  );
}

function MethodChip({
  active,
  label,
  onClick,
  disabled,
  disabledReason,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className="w14-smallcaps"
      style={{
        padding: '4px 14px',
        fontFamily: 'var(--w14-font-display)',
        letterSpacing: '0.08em',
        fontSize: '0.78rem',
        backgroundColor: active ? 'var(--w14-accent)' : 'var(--w14-parchment-2)',
        color: active ? 'var(--w14-accent-ink)' : 'var(--w14-ink-faded)',
        border: `1px solid ${active ? 'var(--w14-accent)' : 'var(--w14-rule)'}`,
        borderRadius: 999,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

/**
 * Smart-denomination quick-tender chip (design-brief §1). A ≥48px touch target
 * (hot-path / WCAG 2.5.5) that pre-fills the cash field with a single tap. The
 * exact-tender chip ("Passend") reads brass to flag the zero-change happy path;
 * the note chips render their euro value in tabular figures.
 */
function TenderChipButton({
  chip,
  active,
  disabled,
  onClick,
}: {
  chip: TenderChip;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      style={{
        minHeight: 52,
        padding: '0 16px',
        flex: '1 1 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        background: active ? 'var(--w14-gold)' : 'var(--w14-parchment-2)',
        border: `1px solid ${chip.exact ? 'var(--w14-accent)' : 'var(--w14-rule)'}`,
        borderRadius: 'var(--w14-radius-button)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background var(--w14-dur-short) var(--w14-ease-curator)',
      }}
    >
      {chip.exact ? (
        <span
          className="w14-smallcaps"
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 600,
            fontSize: '0.82rem',
            letterSpacing: '0.06em',
            color: active ? 'var(--w14-ink-aged)' : 'var(--w14-accent)',
          }}
        >
          Passend
        </span>
      ) : null}
      <span
        className="w14-tabular"
        style={{
          fontFamily: 'var(--w14-font-mono)',
          fontSize: chip.exact ? '0.92rem' : '1.05rem',
          fontWeight: 600,
          color: active ? 'var(--w14-ink-aged)' : 'var(--w14-ink)',
        }}
      >
        <MoneyAmount valueEur={chip.valueEur} />
      </span>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Result phase
// ────────────────────────────────────────────────────────────────────────

function ReceiptResult({
  finalized,
  cashReceivedEur,
  changeEur,
  onDismiss,
}: {
  finalized: FinalizeResponse;
  cashReceivedEur: string;
  changeEur: string;
  onDismiss: () => void;
}): JSX.Element {
  const [stornoOpen, setStornoOpen] = useState(false);
  // Offline-queued sales have no server-side transaction yet (locator OFFLINE-…)
  // — storno would 404, so it's only offered once the sale is really finalized.
  const canStorno = !finalized.receiptLocator.startsWith('OFFLINE-');
  return (
    <>
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: '1.5rem',
          textAlign: 'center',
        }}
      >
        Beleg ausgegeben
      </h2>
      <DiamondRule />

      <table
        className="w14-tabular"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'var(--w14-font-mono)',
        }}
      >
        <tbody>
          <Row
            label="Beleg-Nr."
            value={
              <span
                className="w14-tabular"
                style={{
                  fontFamily: 'var(--w14-font-mono)',
                  fontSize: '1.05rem',
                  color: 'var(--w14-ink-aged)',
                }}
              >
                {finalized.receiptLocator}
              </span>
            }
            emphasised
          />
          <Row
            label="Summe"
            value={<MoneyAmount valueEur={finalized.totalEur} emphasis />}
            emphasised
          />
          <Row label="Bar erhalten" value={<MoneyAmount valueEur={cashReceivedEur || '0.00'} />} />
          <Row
            label="Wechselgeld"
            value={<MoneyAmount valueEur={changeEur} emphasis />}
            emphasised
            valueColor="var(--w14-gold)"
          />
        </tbody>
      </table>

      <p
        style={{
          margin: '14px 0 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: '0.85rem',
          textAlign: 'center',
        }}
      >
        {new Date(finalized.finalizedAt).toLocaleString('de-DE')}
        {' · ID '}
        {finalized.id.slice(0, 8)}…
      </p>

      <div style={{ marginTop: 22, display: 'flex', justifyContent: 'center', gap: 12 }}>
        {canStorno && (
          <Button variant="ghost" size="lg" onClick={() => setStornoOpen(true)}>
            Stornieren
          </Button>
        )}
        <Button variant="primary" size="lg" onClick={onDismiss}>
          Neue Karte
        </Button>
      </div>

      {stornoOpen && (
        <StornoDialog
          transactionId={finalized.id}
          receiptLocator={finalized.receiptLocator}
          onClose={() => setStornoOpen(false)}
          onStornoed={() => {
            setStornoOpen(false);
            onDismiss();
          }}
        />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Shared row
// ────────────────────────────────────────────────────────────────────────

/** True when the server refused the sale for a missing § 10 GwG buyer ID. */
function isKycRequiredError(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'KYC_REQUIRED';
}

function formatPaymentError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'STEP_UP_REQUIRED') return 'PIN-Bestätigung wurde abgebrochen.';
    if (err.code === 'KYC_REQUIRED')
      return 'Käufer muss per Ausweis geprüft werden — bitte Kunden zuordnen.';
    if (err.code === 'PRODUCT_NOT_RESERVABLE')
      return 'Mindestens ein Stück ist nicht mehr reserviert. Karte leeren und neu wählen.';
    return err.message;
  }
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Verbindung gestört — Netzwerk prüfen.';
}

function Row({
  label,
  value,
  emphasised = false,
  valueColor,
}: {
  label: string;
  value: JSX.Element;
  emphasised?: boolean;
  valueColor?: string;
}): JSX.Element {
  return (
    <tr>
      <td
        style={{
          padding: '8px 0',
          color: emphasised ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontVariant: 'all-small-caps',
          letterSpacing: '0.08em',
          fontSize: emphasised ? '0.95rem' : '0.82rem',
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: '8px 0',
          textAlign: 'right',
          color: valueColor,
        }}
      >
        {value}
      </td>
    </tr>
  );
}
