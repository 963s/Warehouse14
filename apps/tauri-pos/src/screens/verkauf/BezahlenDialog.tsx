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
import { Button, DiamondRule, MoneyAmount, ParchmentCard } from '@warehouse14/ui-kit';

import { ZvtSpinner } from '../../components/hardware/ZvtSpinner.js';
import { currentShiftQueryKey } from '../../hooks/useCurrentShift.js';
import { dashboardQueryKey } from '../../hooks/useDashboardSummary.js';
import { resolveShopInfo, useShopInfo } from '../../hooks/useShopInfo.js';
import { useApiClient } from '../../lib/api-context.js';
import {
  type HeaderTotals,
  type LineMath,
  computeLineMath,
  computeTender,
  fromCents,
  sumHeader,
  toCents,
} from '../../lib/cart-math.js';
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
  newIntentionId,
  openTseSession,
} from '../../lib/tse-service.js';
import { type CartLine, useCartStore } from '../../state/cart-store.js';
import { useHardwareStore } from '../../state/hardware-store.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';

import { EuroInput } from '../kasse/EuroInput.js';

import { ReceiptPreview } from './ReceiptPreview.js';
import { StornoDialog } from './StornoDialog.js';
import { type AppliedVoucher, VoucherField } from './VoucherField.js';

export interface BezahlenDialogProps {
  open: boolean;
  onClose: () => void;
  lines: readonly CartLine[];
  perLineMath: readonly LineMath[];
  totals: HeaderTotals;
}

export function BezahlenDialog({
  open,
  onClose,
  lines,
  perLineMath,
  totals: _totals,
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
      inFlightRef.current = false;
      idempotencyKeyRef.current = newIntentionId();

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
  const validCash = /^\d{1,16}(\.\d{1,2})?$/.test(cashReceivedEur);

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

  const b2bValid =
    !isB2b ||
    ((viesStatus === 'valid' || viesStatus === 'unavailable' || viesStatus === 'timeout') &&
      companyName.trim().length > 0 &&
      cleanVatId.length >= 4);

  const canSubmit = enoughCash && !submitting && finalized === null && lines.length > 0 && b2bValid;
  const canSubmitCard = lines.length > 0 && !submitting && b2bValid;

  /**
   * Run the TSE INTENTION → finalize → FINISH sandwich. Returns the
   * server's FinalizeResponse so the caller can render the receipt.
   *
   * TSE failures DO NOT block the sale (V1 — KassenSichV permits a
   * short outage window). Failed signatures land in the offline queue;
   * a future worker job (Phase 1.5 #I-23) drains them back.
   */
  const finalizeWithTse = useCallback(
    async (
      payments: NonNullable<FinalizeBody['payments']>,
      paymentKind: 'Bar' | 'Unbar',
    ): Promise<FinalizeResponse> => {
      let customerId: string | null = null;
      if (isB2b) {
        const cleanVat = vatId.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

        // 1. Search existing customers by name
        const searchRes = await customersApi.list(api, { q: companyName });
        for (const item of searchRes.items) {
          const detail = await customersApi.get(api, item.id);
          if (detail.vatId === cleanVat) {
            customerId = detail.id;
            break;
          }
        }

        // 2. If not found, create new customer
        if (!customerId) {
          const companyAddress = viesAddress && viesAddress !== '---' ? viesAddress : manualAddress;
          const createBody = {
            fullName: companyName,
            vatId: cleanVat,
            notes: 'Automated B2B registration via checkout (VIES verified)',
            ...(companyAddress?.trim() ? { address: companyAddress.trim() } : {}),
          };
          const createRes = await customersApi.create(api, createBody);
          customerId = createRes.id;
        }
      }

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
      const result = await transactionsApi.finalize(api, body);

      // 3. TSE FINISH — only if INTENTION succeeded. Capture the signature
      //    in a ref so the thermal-print step (W-7) can render the
      //    KassenSichV signature block on the paper receipt.
      lastTseSignatureRef.current = null;
      if ('intention' in intentionRes) {
        const totalCents = Number(toCents(adjustedTotals.totalEur));
        const finishRes: TseSessionResult = await closeTseSession({
          config: hardwareCfg.tse,
          intentionId,
          receiptLocator: result.receiptLocator,
          paymentKind,
          intention: intentionRes.intention,
          amountCents: totalCents,
        });
        if (finishRes.kind === 'signed') {
          lastTseSignatureRef.current = {
            signatureValue: finishRes.signature.signatureValue,
            signatureCounter: String(finishRes.signature.signatureCounter),
            transactionNumber: String(finishRes.signature.transactionNumber),
            qrPayload: finishRes.signature.qrCodePayload,
          };
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
    [
      addToast,
      api,
      hardwareCfg.tse,
      lines,
      adjustedTotals,
      b2bActive,
      isB2b,
      vatId,
      companyName,
      viesAddress,
      manualAddress,
      adjustedPerLineMath,
    ],
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
      return {
        shopName: shop.name,
        shopAddress: [...shop.address],
        shopVatId: shop.vatId,
        shopPhone: shop.phone,
        receiptLocator: result.receiptLocator,
        printedAt: new Date(result.finalizedAt).toLocaleString('de-DE', {
          timeZone: 'Europe/Berlin',
        }),
        cashierName: sessionActor ? `Bediener ${sessionActor.id.slice(0, 6)}` : 'Bediener',
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
          'Vielen Dank für Ihren Besuch.',
          'Beleg auf Wunsch elektronisch.',
          ...legalFooters,
        ],
      };
    },
    [cashReceivedEur, lines, adjustedPerLineMath, adjustedTotals, b2bActive, sessionActor, shopApi, dueCents],
  );

  /** Whether a thermal print can actually be attempted right now. */
  const canPrint = isRunningInTauri() && hardwareCfg.thermal.ip.length > 0;

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
        await thermalClient.print(
          { ip: hardwareCfg.thermal.ip, port: hardwareCfg.thermal.port },
          data,
        );
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
    [addToast, canPrint, hardwareCfg.thermal.ip, hardwareCfg.thermal.port],
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
      const result = await finalizeWithTse(payments, tender.dueCents > 0n ? 'Bar' : 'Unbar');
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
          await api.request('POST', `/api/vouchers/${encodeURIComponent(appliedVoucher.code)}/redeem`, {
            transactionId: result.id,
            amountEur: fromCents(tender.appliedVoucherCents),
          });
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
    setZvtBusy(true);

    const totalCents = Number(toCents(adjustedTotals.totalEur));
    let zvt: ZvtResult;
    try {
      zvt = await zvtClient.authorize(
        { ip: hardwareCfg.zvt.ip, port: hardwareCfg.zvt.port },
        totalCents,
      );
    } catch (err) {
      setError(
        isHardwareError(err) ? describeHardwareError(err) : 'Karten-Terminal nicht erreichbar.',
      );
      // Release the mutex + UI flags so the operator can re-attempt.
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
      const result = await finalizeWithTse(payments, 'Unbar');
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
      // The card was already charged — surface this prominently so the
      // operator runs a reversal on the terminal before retrying.
      setError(
        `Buchung fehlgeschlagen NACH Karten-Autorisierung. Bitte Storno am Terminal ausführen. Details: ${formatPaymentError(err)}`,
      );
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [
    addToast,
    finalized,
    finalizeWithTse,
    hardwareCfg.zvt.ip,
    hardwareCfg.zvt.port,
    lines.length,
    qc,
    adjustedTotals.totalEur,
    buildReceiptData,
  ]);

  const closeAfterFinalize = useCallback(() => {
    clearCart();
    onClose();
  }, [clearCart, onClose]);

  // Submit dispatcher — picks CASH vs ZVT_CARD based on toggle.
  const dispatchSubmit = useCallback(() => {
    if (paymentChoice === 'CASH') void submit();
    else void submitCard();
  }, [paymentChoice, submit, submitCard]);

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
            submitting={submitting}
            error={error}
            onSubmit={dispatchSubmit}
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
  submitting,
  error,
  onSubmit,
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
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
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
    if (paymentChoice === 'CASH') return 'Beleg ausgeben';
    return 'Karte autorisieren';
  })();

  const canSubmit = paymentChoice === 'CASH' ? canSubmitCash : canSubmitCard;

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
        Bezahlen · {paymentChoice === 'CASH' ? 'Bar' : 'Karte'}
      </h2>

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

      <table
        className="w14-tabular"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'var(--w14-font-mono)',
        }}
      >
        <tbody>
          <Row label="Zu zahlen" value={<MoneyAmount valueEur={totalEur} emphasis />} emphasised />
        </tbody>
      </table>

      {paymentChoice === 'CASH' ? (
        <>
          {/* Gift voucher — covers up to the full total; the rest is paid in cash. */}
          <VoucherField applied={appliedVoucher} onApplied={onApplyVoucher} disabled={submitting} />
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
                    <MoneyAmount valueEur={`-${fromCents(toCents(totalEur) - toCents(dueEur))}`} />
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

          {toCents(dueEur) > 0n && (
            <div style={{ marginTop: 16 }}>
              <EuroInput
                label="Erhaltener Betrag (bar)"
                valueEur={cashReceivedEur}
                onValueChange={setCashReceivedEur}
                autoFocus
                disabled={submitting}
              />
            </div>
          )}

          <table
            className="w14-tabular"
            style={{
              marginTop: 16,
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: 'var(--w14-font-mono)',
            }}
          >
            <tbody>
              <Row
                label="Wechselgeld"
                value={<MoneyAmount valueEur={enoughCash ? changeEur : '0.00'} emphasis />}
                emphasised
                valueColor={enoughCash ? 'var(--w14-gold)' : 'var(--w14-ink-faded)'}
              />
            </tbody>
          </table>
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

      <div
        style={{
          marginTop: 22,
          display: 'flex',
          gap: 12,
          justifyContent: 'flex-end',
        }}
      >
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          Abbrechen
        </Button>
        <Button variant="primary" onClick={onSubmit} disabled={!canSubmit}>
          {buttonLabel}
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
        backgroundColor: active ? 'var(--w14-gold)' : 'var(--w14-parchment-2)',
        color: active ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 999,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
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

function formatPaymentError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'STEP_UP_REQUIRED') return 'PIN-Bestätigung wurde abgebrochen.';
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
