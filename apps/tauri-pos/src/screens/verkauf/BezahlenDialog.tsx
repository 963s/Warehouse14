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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  ApiError,
  transactionsApi,
  type FinalizeBody,
  type FinalizeLineItem,
  type FinalizeResponse,
  type PaymentMethod,
} from '@warehouse14/api-client';
import {
  Button,
  DiamondRule,
  MoneyAmount,
  ParchmentCard,
} from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useCartStore, type CartLine } from '../../state/cart-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { useHardwareStore } from '../../state/hardware-store.js';
import { dashboardQueryKey } from '../../hooks/useDashboardSummary.js';
import { currentShiftQueryKey } from '../../hooks/useCurrentShift.js';
import {
  fromCents,
  toCents,
  type HeaderTotals,
  type LineMath,
} from '../../lib/cart-math.js';
import {
  describeHardwareError,
  isHardwareError,
  isRunningInTauri,
  thermalClient,
  zvtClient,
  type ThermalReceiptData,
  type ZvtResult,
} from '../../lib/hardware-client.js';
import {
  closeTseSession,
  newIntentionId,
  openTseSession,
  type TseSessionResult,
} from '../../lib/tse-service.js';
import { ZvtSpinner } from '../../components/hardware/ZvtSpinner.js';
import { useSessionStore } from '../../state/session-store.js';

import { EuroInput } from '../kasse/EuroInput.js';

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
  totals,
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

  const [paymentChoice, setPaymentChoice] = useState<'CASH' | 'ZVT_CARD'>('CASH');
  const [cashReceivedEur, setCashReceivedEur] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [finalized, setFinalized] = useState<FinalizeResponse | null>(null);
  /** Set while the ZVT terminal owns the cardholder's attention. */
  const [zvtBusy, setZvtBusy] = useState<boolean>(false);

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
      inFlightRef.current = false;
      idempotencyKeyRef.current = newIntentionId();
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

  const totalCents = useMemo(() => toCents(totals.totalEur), [totals.totalEur]);
  const cashCents = useMemo(() => {
    if (cashReceivedEur.length === 0) return 0n;
    try {
      return toCents(cashReceivedEur);
    } catch {
      return 0n;
    }
  }, [cashReceivedEur]);
  const validCash = /^\d{1,16}(\.\d{1,2})?$/.test(cashReceivedEur);
  const enoughCash = validCash && cashCents >= totalCents;
  const changeCents = enoughCash ? cashCents - totalCents : 0n;
  const canSubmit = enoughCash && !submitting && finalized === null && lines.length > 0;

  /**
   * Build the line-items array — identical for cash and card paths.
   */
  const buildItems = useCallback((): FinalizeLineItem[] => {
    return lines.map((line, idx) => {
      const math = perLineMath[idx];
      if (!math) throw new Error('cart-math/lines length mismatch');
      const item: FinalizeLineItem = {
        productId: line.productId,
        reservationSessionId: line.reservationSessionId,
        lineSubtotalEur: fromCents(math.lineSubtotalCents),
        lineVatEur: fromCents(math.lineVatCents),
        lineTotalEur: fromCents(math.lineTotalCents),
        appliedTaxTreatmentCode: line.taxTreatmentCode,
        appliedVatRate: math.appliedVatRate,
        acquisitionCostEurSnapshot:
          math.acquisitionCostSnapshotCents !== null
            ? fromCents(math.acquisitionCostSnapshotCents)
            : null,
        marginEur: math.marginCents !== null ? fromCents(math.marginCents) : null,
        displayOrder: idx + 1,
      };
      return item;
    });
  }, [lines, perLineMath]);

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
      const headTreatment = lines[0]?.taxTreatmentCode;
      if (!headTreatment) throw new Error('Warenkorb leer');

      // 1. TSE INTENTION — best-effort; failure logs a toast but doesn't block.
      const intentionId = newIntentionId();
      const intentionRes = await openTseSession({
        config: hardwareCfg.tse,
        receiptLocator: null,
        intentionId,
        paymentKind,
      });

      // 2. Finalize on the API. The idempotency key is held in a ref so
      //    every retry path (step-up, network blip) sends the SAME value
      //    — server's partial UNIQUE INDEX dedupes (§19.2 C-4).
      const body: FinalizeBody = {
        direction: 'VERKAUF',
        customerId: null,
        subtotalEur: totals.subtotalEur,
        vatEur: totals.vatEur,
        totalEur: totals.totalEur,
        taxTreatmentCode: headTreatment,
        items: buildItems(),
        payments,
        idempotencyKey: idempotencyKeyRef.current,
      };
      const result = await transactionsApi.finalize(api, body);

      // 3. TSE FINISH — only if INTENTION succeeded. Capture the signature
      //    in a ref so the thermal-print step (W-7) can render the
      //    KassenSichV signature block on the paper receipt.
      lastTseSignatureRef.current = null;
      if ('intention' in intentionRes) {
        const totalCents = Number(toCents(totals.totalEur));
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
    [addToast, api, buildItems, hardwareCfg.tse, lines, totals],
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
  const firePrintReceipt = useCallback(
    (result: FinalizeResponse, payments: NonNullable<FinalizeBody['payments']>): void => {
      if (!isRunningInTauri()) return;
      if (!hardwareCfg.thermal.ip) return;

      const tse = lastTseSignatureRef.current;
      const cashPayment = payments.find((p) => p.paymentMethod === 'CASH');
      const cardPayment = payments.find((p) => p.paymentMethod === 'ZVT_CARD');
      const paymentLabel = cashPayment ? 'Bar' : cardPayment ? `Karte ${cardPayment.zvtCardBrand ?? ''}`.trim() : 'Zahlung';

      const data: ThermalReceiptData = {
        // V1: shop info is constant in code. Phase 1.5 will pull from
        // `system_settings` once that API exists (memory.md §18.6).
        shopName: 'WAREHOUSE 14',
        shopAddress: ['Musterstraße 1', '10115 Berlin'],
        shopVatId: 'DE000000000',
        shopPhone: null,
        receiptLocator: result.receiptLocator,
        printedAt: new Date(result.finalizedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }),
        cashierName: sessionActor ? `Bediener ${sessionActor.id.slice(0, 6)}` : 'Bediener',
        shiftId: null,
        items: lines.map((line, idx) => {
          const math = perLineMath[idx];
          return {
            name: line.name,
            quantity: 1,
            unitPriceEur: line.listPriceEur,
            lineTotalEur: math ? fromCents(math.lineTotalCents) : line.listPriceEur,
            vatLabel: math ? `${math.appliedVatRate}%` : '',
          };
        }),
        subtotalEur: totals.subtotalEur,
        vatEur: totals.vatEur,
        totalEur: totals.totalEur,
        paymentMethodLabel: paymentLabel,
        cashReceivedEur: cashPayment ? cashReceivedEur || cashPayment.amountEur : null,
        changeEur: cashPayment && cashReceivedEur ? fromCents(changeCentsForPrint()) : null,
        tseSignatureValue: tse?.signatureValue ?? 'TSE-OFFLINE',
        tseSignatureCounter: tse?.signatureCounter ?? '0',
        tseTransactionNumber: tse?.transactionNumber ?? '0',
        tseQrPayload: tse?.qrPayload ?? `OFFLINE;tx=${result.id}`,
        footerLines: ['Vielen Dank für Ihren Besuch.', 'Beleg auf Wunsch elektronisch.'],
      };

      void thermalClient
        .print({ ip: hardwareCfg.thermal.ip, port: hardwareCfg.thermal.port }, data)
        .catch((err) => {
          addToast({
            tone: 'alert',
            title: 'Druck fehlgeschlagen',
            body: isHardwareError(err) ? describeHardwareError(err) : 'Drucker prüfen — Beleg digital ausgegeben.',
          });
        });
    },
    [addToast, cashReceivedEur, hardwareCfg.thermal.ip, hardwareCfg.thermal.port, lines, perLineMath, sessionActor, totals],
  );

  /** Helper for the print path — recomputes change from cash + total. */
  function changeCentsForPrint(): bigint {
    try {
      const cash = toCents(cashReceivedEur || '0');
      const total = toCents(totals.totalEur);
      return cash >= total ? cash - total : 0n;
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
      const payments: FinalizeBody['payments'] = [
        { paymentMethod: 'CASH', amountEur: totals.totalEur },
      ];
      const result = await finalizeWithTse(payments, 'Bar');
      setFinalized(result);
      addToast({
        tone: 'success',
        title: 'Beleg ausgegeben',
        body: `Beleg-Nr. ${result.receiptLocator}`,
      });
      // §19.3 W-7 — fire-and-forget thermal print.
      firePrintReceipt(result, payments);
      await Promise.all([
        qc.invalidateQueries({ queryKey: dashboardQueryKey }),
        qc.invalidateQueries({ queryKey: ['products', 'list'] }),
        qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
      ]);
    } catch (err) {
      setError(formatPaymentError(err));
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [addToast, canSubmit, finalizeWithTse, firePrintReceipt, qc, totals.totalEur]);

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

    const totalCents = Number(toCents(totals.totalEur));
    let zvt: ZvtResult;
    try {
      zvt = await zvtClient.authorize(
        { ip: hardwareCfg.zvt.ip, port: hardwareCfg.zvt.port },
        totalCents,
      );
    } catch (err) {
      setError(
        isHardwareError(err)
          ? describeHardwareError(err)
          : 'Karten-Terminal nicht erreichbar.',
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
          amountEur: totals.totalEur,
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
      // §19.3 W-7 — fire-and-forget thermal print.
      firePrintReceipt(result, payments);
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
    firePrintReceipt,
    hardwareCfg.zvt.ip,
    hardwareCfg.zvt.port,
    lines.length,
    qc,
    totals.totalEur,
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
            totalEur={totals.totalEur}
            cashReceivedEur={cashReceivedEur}
            setCashReceivedEur={setCashReceivedEur}
            changeEur={fromCents(changeCents)}
            enoughCash={enoughCash}
            cardConfigured={hardwareCfg.zvt.ip.length > 0}
            canSubmitCash={canSubmit}
            canSubmitCard={lines.length > 0 && !submitting}
            submitting={submitting}
            error={error}
            onSubmit={dispatchSubmit}
            onCancel={onClose}
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
      {zvtBusy && <ZvtSpinner amountEur={totals.totalEur} />}
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
}: {
  paymentChoice: 'CASH' | 'ZVT_CARD';
  setPaymentChoice: (next: 'CASH' | 'ZVT_CARD') => void;
  totalEur: string;
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
          <Row
            label="Zu zahlen"
            value={<MoneyAmount valueEur={totalEur} emphasis />}
            emphasised
          />
        </tbody>
      </table>

      {paymentChoice === 'CASH' ? (
        <>
          <div style={{ marginTop: 16 }}>
            <EuroInput
              label="Erhaltener Betrag (bar)"
              valueEur={cashReceivedEur}
              onValueChange={setCashReceivedEur}
              autoFocus
              disabled={submitting}
            />
          </div>

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
                value={
                  <MoneyAmount
                    valueEur={enoughCash ? changeEur : '0.00'}
                    emphasis
                  />
                }
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
          Bei Klick wird das Karten-Terminal angesprochen.
          Der Kunde bestätigt am Terminal.
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
          <Row
            label="Bar erhalten"
            value={<MoneyAmount valueEur={cashReceivedEur || '0.00'} />}
          />
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

      <div style={{ marginTop: 22, display: 'flex', justifyContent: 'center' }}>
        <Button variant="primary" size="lg" onClick={onDismiss}>
          Neue Karte
        </Button>
      </div>
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
