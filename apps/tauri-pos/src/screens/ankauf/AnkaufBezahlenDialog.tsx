/**
 * AnkaufBezahlenDialog — final confirmation + KYC gate (Day 8).
 *
 * Two phases:
 *   1. REVIEW — operator confirms: customer name, total, payout method,
 *      KYC status. EVERY Ankauf requires ID (§259 StGB, from €0,01): if the
 *      customer is NOT kyc_verified, the Bezahlen button is replaced with
 *      "KYC bestätigen" which calls PATCH /api/customers/:id/kyc (step-up
 *      required). After stamp, the dialog re-renders with the Bezahlen
 *      button enabled.
 *   2. RECEIPT — show transaction id, receipt locator, payout total,
 *      timestamp. "Neue Aufnahme" CTA clears the store + closes.
 *
 * Step-up on the finalize call itself: when totalEur ≥
 * TRANSACTION_STEP_UP_THRESHOLD_EUR, the server raises 403 STEP_UP_REQUIRED
 * and the wrapWithStepUp interceptor opens the PIN modal transparently.
 * Same UX as Verkauf finalize.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type AnkaufBody,
  type AnkaufLineItem,
  type AnkaufResponse,
  type AnkaufResponseProduct,
  ApiError,
  ApiOfflineQueuedError,
  type CustomerDetail,
  customersApi,
  transactionsApi,
} from '@warehouse14/api-client';
import { Button, DiamondRule, MoneyAmount, ParchmentCard } from '@warehouse14/ui-kit';
import type { LabelData } from '../../lib/hardware-client.js';
import { useLabelPrinter } from '../../lib/use-label-printer.js';
import type { IntakeItem } from '../../state/ankauf-cart-store.js';

import { currentShiftQueryKey } from '../../hooks/useCurrentShift.js';
import { dashboardQueryKey } from '../../hooks/useDashboardSummary.js';
import { evaluateKycGate } from '../../lib/ankauf-kyc-gate.js';
import { useApiClient } from '../../lib/api-context.js';
import { fromCents, sumNegotiatedCents } from '../../lib/intake-math.js';
import {
  selectAnkaufCustomerId,
  selectAnkaufItems,
  useAnkaufCartStore,
} from '../../state/ankauf-cart-store.js';
import { useToastStore } from '../../state/toast-store.js';

export interface AnkaufBezahlenDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AnkaufBezahlenDialog({
  open,
  onClose,
}: AnkaufBezahlenDialogProps): JSX.Element | null {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const printer = useLabelPrinter();
  const items = useAnkaufCartStore(selectAnkaufItems);
  const customerId = useAnkaufCartStore(selectAnkaufCustomerId);
  const payoutMethod = useAnkaufCartStore((s) => s.payoutMethod);
  const payoutExternalRef = useAnkaufCartStore((s) => s.payoutExternalRef);
  const notesInternal = useAnkaufCartStore((s) => s.notesInternal);
  const setPayoutMethod = useAnkaufCartStore((s) => s.setPayoutMethod);
  const setPayoutExternalRef = useAnkaufCartStore((s) => s.setPayoutExternalRef);
  const setNotesInternal = useAnkaufCartStore((s) => s.setNotesInternal);
  const reset = useAnkaufCartStore((s) => s.reset);

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [stampingKyc, setStampingKyc] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [finalized, setFinalized] = useState<AnkaufResponse | null>(null);

  /**
   * §19.3 W-1 — synchronous mutex (mirrors Verkauf BezahlenDialog).
   *
   * `useState(submitting)` is async — React doesn't commit `setSubmitting(true)`
   * until after the handler yields, so a fast double-click on "Auszahlen &
   * Beleg" CAN re-enter `submit` and post TWO payouts for the same goods. A
   * `useRef.current = true` is visible immediately on the next synchronous read,
   * killing the race. Reset in `submit`'s finally AND on dialog re-open.
   */
  const inFlightRef = useRef<boolean>(false);

  /**
   * §19.2 C-4 — idempotency key for at-most-once Ankauf. Generated ONCE per
   * dialog open, held in a ref so every retry (step-up cancel-resume, network
   * blip) sends the SAME key. The server's partial UNIQUE INDEX dedupes on it.
   */
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const customerQ = useQuery({
    queryKey: ['customers', customerId],
    queryFn: () => customersApi.get(api, customerId!),
    enabled: customerId !== null,
    staleTime: 5_000,
  });
  const customer: CustomerDetail | undefined = customerQ.data;

  // Reset on open.
  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setStampingKyc(false);
      setError(null);
      setFinalized(null);
      inFlightRef.current = false;
      idempotencyKeyRef.current = crypto.randomUUID();
    }
  }, [open]);

  // Esc closes when not mid-submit.
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && !submitting && !stampingKyc) {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, submitting, stampingKyc]);

  const totalCents = useMemo(() => sumNegotiatedCents(items), [items]);
  const totalEur = fromCents(totalCents);
  // Single source of truth shared with the early IntakeList banner. ANKAUF =
  // ID always required (§259 StGB), so the gate trips from €0,01.
  const kycGate = evaluateKycGate({ direction: 'ANKAUF', totalCents, customer: customer ?? null });
  const triggersGwgGate = kycGate.thresholdReached;
  const kycVerified = kycGate.kycVerified;
  const blocked = customer?.sanctionsMatch === true || customer?.trustLevel === 'BANNED';
  const needsKycStamp = triggersGwgGate && !kycVerified;

  const payoutValid =
    payoutMethod === 'CASH' ||
    (payoutMethod === 'BANK_TRANSFER' && payoutExternalRef.trim().length > 0);

  const canSubmit =
    !submitting &&
    !stampingKyc &&
    finalized === null &&
    !blocked &&
    !needsKycStamp &&
    payoutValid &&
    items.length > 0 &&
    customerId !== null;

  // ── KYC stamp ──
  const stampKyc = useCallback(async (): Promise<void> => {
    if (!customer || stampingKyc) return;
    setStampingKyc(true);
    setError(null);
    try {
      // The PATCH route requires step-up — interceptor opens the modal.
      await customersApi.stampKyc(
        api,
        customer.id,
        customer.trustLevel === 'NEW' ? { promoteTrustLevelTo: 'VERIFIED' } : {},
      );
      addToast({ tone: 'success', title: 'KYC bestätigt', body: customer.fullName });
      await qc.invalidateQueries({ queryKey: ['customers', customer.id] });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'STEP_UP_REQUIRED') {
          setError('PIN-Bestätigung wurde abgebrochen.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Verbindung gestört — KYC nicht bestätigt.');
      }
    } finally {
      setStampingKyc(false);
    }
  }, [addToast, api, customer, qc, stampingKyc]);

  // ── Finalize Ankauf ──
  const submit = useCallback(async (): Promise<void> => {
    // §19.3 W-1 mutex: read+set SYNCHRONOUSLY, BEFORE the canSubmit guard,
    // so a double-click that beats React's state commit can't post twice.
    if (inFlightRef.current) return;
    if (!canSubmit || !customerId) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);

    const wireItems: AnkaufLineItem[] = items.map((it) => {
      const item: AnkaufLineItem = {
        sku: it.sku,
        itemType: it.itemType,
        hallmarkStamps: it.hallmarkStamps,
        condition: it.condition,
        taxTreatmentCode: it.taxTreatmentCode,
        name: it.name,
        listPriceEur: it.listPriceEur,
        negotiatedPriceEur: it.negotiatedPriceEur,
        publishImmediately: it.publishImmediately,
      };
      if (it.barcode.length > 0) item.barcode = it.barcode;
      if (it.metal !== null) item.metal = it.metal;
      if (it.karatCode.length > 0) item.karatCode = it.karatCode;
      if (it.finenessDecimal.length > 0) item.finenessDecimal = it.finenessDecimal;
      if (it.weightGrams.length > 0) item.weightGrams = it.weightGrams;
      if (it.descriptionDe.length > 0) item.descriptionDe = it.descriptionDe;
      return item;
    });

    const body: AnkaufBody = {
      customerId,
      payoutMethod,
      totalEur,
      items: wireItems,
      // §19.2 C-4 — stable across retries; server dedups on the partial UNIQUE.
      idempotencyKey: idempotencyKeyRef.current,
    };
    if (payoutMethod === 'BANK_TRANSFER') body.payoutExternalRef = payoutExternalRef.trim();
    if (notesInternal.trim().length > 0) body.notesInternal = notesInternal.trim();

    try {
      const result = await transactionsApi.ankauf(api, body);
      setFinalized(result);
      addToast({
        tone: 'success',
        title: 'Ankauf abgeschlossen',
        body: `Beleg-Nr. ${result.receiptLocator}`,
      });

      if (result.createdProducts.length > 0) {
        const bySkuMap = new Map(items.map((it) => [it.sku, it]));
        const labelsToPrint = result.createdProducts.map((p) => {
          const it = bySkuMap.get(p.sku);
          return {
            sku: p.sku,
            productName: it?.name ?? p.sku,
            weightGrams: it?.weightGrams ?? null,
            karat: it?.karatCode ?? null,
            storageLocation: null,
          } satisfies LabelData;
        });
        void printer.print(labelsToPrint);
      }

      await Promise.all([
        qc.invalidateQueries({ queryKey: dashboardQueryKey }),
        qc.invalidateQueries({ queryKey: ['products', 'list'] }),
        qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
        qc.invalidateQueries({ queryKey: ['customers', customerId] }),
        qc.invalidateQueries({ queryKey: ['customers', 'list'] }),
      ]);
    } catch (err) {
      if (err instanceof ApiOfflineQueuedError) {
        // The buy-in is SAFELY captured for replay (GoBD §146) — this is a
        // success from the cashier's point of view, NOT a failure. Mirror the
        // cash-sale offline path: advance to the receipt phase with a synthetic
        // locator, print labels from the LOCAL items (the server hasn't created
        // products yet), and invalidate the same queries.
        const offlineLocator = `OFFLINE-${idempotencyKeyRef.current.slice(0, 8).toUpperCase()}`;
        const offlineResult: AnkaufResponse = {
          transactionId: idempotencyKeyRef.current,
          receiptLocator: offlineLocator,
          finalizedAt: new Date(err.enqueuedAt).toISOString(),
          ledgerEventId: -1,
          totalEur,
          payoutMethod,
          // Synthesize from the local intake so the ReceiptPhase + label print
          // have rows to work with. The real product ids land on sync.
          createdProducts: items.map((it) => ({
            id: it.sku,
            sku: it.sku,
            status: it.publishImmediately ? ('AVAILABLE' as const) : ('DRAFT' as const),
            clientReferenceId: null,
          })),
        };
        setFinalized(offlineResult);
        addToast({
          tone: 'info',
          title: 'Ankauf offline gespeichert',
          body: `Wird synchronisiert (Temp-Nr. ${offlineLocator})`,
        });

        if (offlineResult.createdProducts.length > 0) {
          const bySkuMap = new Map(items.map((it) => [it.sku, it]));
          const labelsToPrint = offlineResult.createdProducts.map((p) => {
            const it = bySkuMap.get(p.sku);
            return {
              sku: p.sku,
              productName: it?.name ?? p.sku,
              weightGrams: it?.weightGrams ?? null,
              karat: it?.karatCode ?? null,
              storageLocation: null,
            } satisfies LabelData;
          });
          void printer.print(labelsToPrint);
        }

        await Promise.all([
          qc.invalidateQueries({ queryKey: dashboardQueryKey }),
          qc.invalidateQueries({ queryKey: ['products', 'list'] }),
          qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
          qc.invalidateQueries({ queryKey: ['customers', customerId] }),
          qc.invalidateQueries({ queryKey: ['customers', 'list'] }),
        ]);
      } else if (err instanceof ApiError) {
        if (err.code === 'STEP_UP_REQUIRED') {
          setError('PIN-Bestätigung wurde abgebrochen.');
        } else if (err.code === 'SANCTIONS_BLOCK') {
          setError('Sanktionslisten-Treffer — der Ankauf wurde abgewiesen.');
        } else if (err.code === 'CLOSING_DAY_FINALIZED') {
          setError('Heutiger Tagesabschluss ist bereits geschlossen.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Verbindung gestört — Netzwerk prüfen.');
      }
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [
    addToast,
    api,
    canSubmit,
    customerId,
    items,
    notesInternal,
    payoutExternalRef,
    payoutMethod,
    qc,
    totalEur,
    printer,
  ]);

  const dismissAfterFinalize = useCallback((): void => {
    reset();
    onClose();
  }, [reset, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ankauf bezahlen"
      onClick={() => {
        // §19.3 W-2 — backdrop dismiss must NOT win against an in-flight
        // payout. The synchronous mutex ref closes the same React-commit-window
        // race the submit guard protects against; the state flags cover the
        // KYC-stamp + already-finalized cases.
        if (inFlightRef.current || submitting || stampingKyc) return;
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
        style={{ width: 'min(560px, 100%)', boxShadow: 'var(--w14-shadow-modal)' }}
      >
        {finalized !== null ? (
          <ReceiptPhase
            finalized={finalized}
            customerName={customer?.fullName ?? ''}
            items={items}
            onDismiss={dismissAfterFinalize}
          />
        ) : (
          <ReviewPhase
            customer={customer}
            items={items}
            totalEur={totalEur}
            payoutMethod={payoutMethod}
            payoutExternalRef={payoutExternalRef}
            notesInternal={notesInternal}
            setPayoutMethod={setPayoutMethod}
            setPayoutExternalRef={setPayoutExternalRef}
            setNotesInternal={setNotesInternal}
            triggersGwgGate={triggersGwgGate}
            needsKycStamp={needsKycStamp}
            blocked={blocked}
            error={error}
            canSubmit={canSubmit}
            submitting={submitting}
            stampingKyc={stampingKyc}
            onStampKyc={() => void stampKyc()}
            onSubmit={() => void submit()}
            onCancel={onClose}
          />
        )}
      </ParchmentCard>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Review phase
// ────────────────────────────────────────────────────────────────────────

function ReviewPhase(props: {
  customer: CustomerDetail | undefined;
  items: ReadonlyArray<{ name: string; negotiatedPriceEur: string }>;
  totalEur: string;
  payoutMethod: 'CASH' | 'BANK_TRANSFER';
  payoutExternalRef: string;
  notesInternal: string;
  setPayoutMethod: (m: 'CASH' | 'BANK_TRANSFER') => void;
  setPayoutExternalRef: (v: string) => void;
  setNotesInternal: (v: string) => void;
  triggersGwgGate: boolean;
  needsKycStamp: boolean;
  blocked: boolean;
  error: string | null;
  canSubmit: boolean;
  submitting: boolean;
  stampingKyc: boolean;
  onStampKyc: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}): JSX.Element {
  const {
    customer,
    items,
    totalEur,
    payoutMethod,
    payoutExternalRef,
    notesInternal,
    setPayoutMethod,
    setPayoutExternalRef,
    setNotesInternal,
    triggersGwgGate,
    needsKycStamp,
    blocked,
    error,
    canSubmit,
    submitting,
    stampingKyc,
    onStampKyc,
    onSubmit,
    onCancel,
  } = props;

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
        Ankauf abschließen
      </h2>
      <p
        style={{
          margin: '6px 0 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: '0.92rem',
          textAlign: 'center',
        }}
      >
        Bestätigen Sie Verkäufer, Stücke und Auszahlung.
      </p>
      <DiamondRule label="Verkäufer" />

      <div
        style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, alignItems: 'baseline' }}
      >
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem', letterSpacing: '0.08em' }}
        >
          Name
        </span>
        <span
          style={{ textAlign: 'right', fontFamily: 'var(--w14-font-display)', fontWeight: 500 }}
        >
          {customer?.fullName ?? 'wird geladen…'}
        </span>
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem', letterSpacing: '0.08em' }}
        >
          KYC
        </span>
        <span
          style={{
            textAlign: 'right',
            color: customer?.kycVerifiedAt ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
          }}
        >
          {customer?.kycVerifiedAt
            ? `bestätigt ${new Date(customer.kycVerifiedAt).toLocaleDateString('de-DE')}`
            : 'noch nicht bestätigt'}
        </span>
      </div>

      {blocked && (
        <ParchmentCard
          padding="md"
          style={{ marginTop: 12, border: '2px solid var(--w14-wax-red)' }}
        >
          <p style={{ margin: 0, color: 'var(--w14-wax-red)', fontWeight: 500 }}>
            Geschäft mit diesem Verkäufer nicht zulässig — Sanktion oder Sperre.
          </p>
        </ParchmentCard>
      )}

      {triggersGwgGate && (
        <p
          style={{
            margin: '12px 0 0',
            color: needsKycStamp ? 'var(--w14-wax-red)' : 'var(--w14-ink-aged)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.88rem',
            textAlign: 'center',
          }}
        >
          Jeder Ankauf verlangt eine persönliche Ausweisprüfung des Verkäufers (§ 259 StGB) — ab dem
          ersten Euro.
        </p>
      )}

      <DiamondRule label="Auszahlung" />

      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <PayoutChip
          active={payoutMethod === 'CASH'}
          onClick={() => setPayoutMethod('CASH')}
          label="Bar"
        />
        <PayoutChip
          active={payoutMethod === 'BANK_TRANSFER'}
          onClick={() => setPayoutMethod('BANK_TRANSFER')}
          label="Überweisung"
        />
      </div>

      {payoutMethod === 'BANK_TRANSFER' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem', letterSpacing: '0.08em' }}
          >
            Verwendungszweck / Überweisungs-Ref
          </span>
          <input
            type="text"
            value={payoutExternalRef}
            onChange={(ev) => setPayoutExternalRef(ev.target.value)}
            style={{
              border: 'none',
              outline: 'none',
              borderBottom: '2px solid var(--w14-rule)',
              background: 'transparent',
              padding: '6px 4px',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '0.95rem',
              color: 'var(--w14-ink)',
            }}
          />
        </label>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem', letterSpacing: '0.08em' }}
        >
          Notiz (optional)
        </span>
        <input
          type="text"
          value={notesInternal}
          maxLength={1024}
          onChange={(ev) => setNotesInternal(ev.target.value)}
          style={{
            border: 'none',
            outline: 'none',
            borderBottom: '2px solid var(--w14-rule)',
            background: 'transparent',
            padding: '6px 4px',
            fontFamily: 'var(--w14-font-body)',
            fontSize: '0.95rem',
            color: 'var(--w14-ink)',
          }}
        />
      </label>

      {/* Permanent money anchor (design-brief §1) — the payout is the single
          largest type on the screen, .w14-tabular, high contrast for the 80cm
          read. Wax-red because this is money LEAVING the till (a payout), the
          same colour the receipt phase uses for the Auszahlung. */}
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
            fontSize: '0.9rem',
            letterSpacing: '0.08em',
            color: 'var(--w14-ink-aged)',
          }}
        >
          Auszahlung · {items.length} Stück{items.length === 1 ? '' : 'e'}
        </span>
        <span
          className="w14-tabular"
          style={{
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '2.4rem',
            fontWeight: 700,
            lineHeight: 1,
            color: 'var(--w14-wax-red)',
          }}
        >
          <MoneyAmount valueEur={totalEur} />
        </span>
      </div>

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

      {/* Action footer (design-brief §1) — the primary action is a 72–88px
          brass, bottom-right-anchored target (effectively-infinite Fitts); the
          ghost Abbrechen stays compact to its left so it can't be mis-tapped for
          the payout. The disabled state is driven by `canSubmit`, which already
          encodes the §19.3 mutex + KYC + payout-valid guards — pressing it
          disables it immediately (reinforces the existing double-pay guard). */}
      <div
        style={{
          marginTop: 22,
          display: 'flex',
          gap: 12,
          alignItems: 'stretch',
          justifyContent: 'flex-end',
        }}
      >
        <Button
          variant="ghost"
          size="lg"
          onClick={onCancel}
          disabled={submitting || stampingKyc}
          style={{ flex: 'none' }}
        >
          Abbrechen
        </Button>
        {needsKycStamp ? (
          <Button
            variant="destructive"
            size="lg"
            onClick={onStampKyc}
            disabled={blocked || stampingKyc}
            style={{ flex: 1, minHeight: 78, fontSize: '1.1rem', fontWeight: 600 }}
          >
            {stampingKyc ? 'Bestätigt…' : 'KYC bestätigen'}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            onClick={onSubmit}
            disabled={!canSubmit}
            style={{
              flex: 1,
              minHeight: 78,
              fontSize: '1.1rem',
              fontWeight: 600,
              // Solid gold once the payout can be recorded — an unmistakable
              // "ready to finalize" affordance (matches the Verkauf footer).
              ...(canSubmit
                ? {
                    backgroundColor: 'var(--w14-gold)',
                    borderColor: 'var(--w14-gold)',
                    color: '#fff',
                  }
                : {}),
            }}
          >
            {submitting ? 'Schließt ab…' : 'Auszahlen & Beleg'}
            {!submitting ? (
              <>
                {' · '}
                <MoneyAmount valueEur={totalEur} />
              </>
            ) : null}
          </Button>
        )}
      </div>
    </>
  );
}

function PayoutChip({
  active,
  onClick,
  label,
}: { active: boolean; onClick: () => void; label: string }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        flex: 1,
        // ≥48px hot-path target (design-brief §1 / WCAG 2.5.5).
        minHeight: 48,
        padding: '0 14px',
        background: active ? 'var(--w14-parchment-3)' : 'transparent',
        border: `1px solid ${active ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
        borderRadius: 'var(--w14-radius-button)',
        cursor: 'pointer',
        fontFamily: 'var(--w14-font-display)',
        fontVariant: 'all-small-caps',
        letterSpacing: '0.08em',
        fontSize: '0.9rem',
        color: active ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
        transition: 'background var(--w14-dur-short) var(--w14-ease-curator)',
      }}
    >
      {label}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Receipt phase
// ────────────────────────────────────────────────────────────────────────

function ReceiptPhase({
  finalized,
  customerName,
  items,
  onDismiss,
}: {
  finalized: AnkaufResponse;
  customerName: string;
  items: readonly IntakeItem[];
  onDismiss: () => void;
}): JSX.Element {
  const printer = useLabelPrinter();
  const bySku = new Map(items.map((it) => [it.sku, it]));
  const labelFor = (p: AnkaufResponseProduct): LabelData => {
    const it = bySku.get(p.sku);
    return {
      sku: p.sku,
      productName: it?.name ?? p.sku,
      weightGrams: it?.weightGrams ?? null,
      karat: it?.karatCode ?? null,
      storageLocation: null, // Lagerort is assigned later in Lager
    };
  };
  const allLabels = finalized.createdProducts.map(labelFor);

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
        Ankaufbeleg ausgegeben
      </h2>
      <DiamondRule />

      <table
        className="w14-tabular"
        style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--w14-font-mono)' }}
      >
        <tbody>
          <ReceiptRow
            label="Beleg-Nr."
            value={
              <span
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
          <ReceiptRow
            label="Verkäufer"
            value={<span style={{ fontFamily: 'var(--w14-font-display)' }}>{customerName}</span>}
          />
          <ReceiptRow
            label="Stücke neu im Lager"
            value={<span className="w14-tabular">{finalized.createdProducts.length}</span>}
          />
          <ReceiptRow
            label="Auszahlung"
            value={<MoneyAmount valueEur={finalized.totalEur} emphasis />}
            emphasised
            valueColor="var(--w14-wax-red)"
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
        {finalized.transactionId.slice(0, 8)}…
      </p>

      {finalized.createdProducts.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 6,
            }}
          >
            <span
              className="w14-smallcaps"
              style={{
                letterSpacing: '0.08em',
                fontSize: '0.78rem',
                color: 'var(--w14-ink-faded)',
              }}
            >
              Etiketten
            </span>
            <Button variant="ghost" size="sm" onClick={() => void printer.print(allLabels)}>
              Alle Etiketten drucken
            </Button>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
            {finalized.createdProducts.map((p) => (
              <li
                key={p.id}
                style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.86rem' }}
              >
                <span style={{ fontFamily: 'var(--w14-font-mono)', color: 'var(--w14-ink-aged)' }}>
                  {p.sku}
                </span>
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {bySku.get(p.sku)?.name ?? '—'}
                </span>
                <Button variant="ghost" size="sm" onClick={() => void printer.print([labelFor(p)])}>
                  Drucken
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 22, display: 'flex', justifyContent: 'center' }}>
        <Button variant="primary" size="lg" onClick={onDismiss}>
          Neue Aufnahme
        </Button>
      </div>
    </>
  );
}

function ReceiptRow({
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
      <td style={{ padding: '8px 0', textAlign: 'right', color: valueColor }}>{value}</td>
    </tr>
  );
}
