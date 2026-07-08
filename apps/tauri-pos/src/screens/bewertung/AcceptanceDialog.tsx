/**
 * AcceptanceDialog — the final strike (Day 11).
 *
 * Confirms the customer accepts the offer and triggers the atomic
 * `POST /api/appraisals/:id/accept` route. The route is:
 *   • Owner-only (route enforces requireOwner)
 *   • Step-up mandatory (route enforces requireStepUp; interceptor opens modal)
 *   • Paired-device required (route enforces req.deviceId)
 *   • Creates Ankauf transaction + parent + N child products + transaction_items
 *     + transaction_payments — all in one DB transaction (the Day-11 fix to #I-38)
 *
 * The dialog also surfaces:
 *   • GwG warning when totalOfferedEur ≥ €2,000 and KYC is missing
 *     — operator must stamp KYC first (we link to Kunden surface)
 *   • Sanctions / banned warning that disables the action entirely
 *
 * On success: cache invalidates, store resets, the outcome view appears.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError, type AppraisalView, appraisalsApi, customersApi } from '@warehouse14/api-client';
import { Button, DiamondRule, MoneyAmount, ParchmentCard } from '@warehouse14/ui-kit';

import { currentShiftQueryKey } from '../../hooks/useCurrentShift.js';
import { dashboardQueryKey } from '../../hooks/useDashboardSummary.js';
import { evaluateKycGate } from '../../lib/ankauf-kyc-gate.js';
import { useApiClient } from '../../lib/api-context.js';
import { toCents } from '../../lib/bewertung-math.js';
import type { LabelData } from '../../lib/hardware-client.js';
import { useLabelPrinter } from '../../lib/use-label-printer.js';
import { useBewertungStore } from '../../state/bewertung-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@warehouse14/i18n-de';

export interface AcceptanceDialogProps {
  open: boolean;
  appraisal: AppraisalView;
  onClose: () => void;
}

export function AcceptanceDialog({
  open,
  appraisal,
  onClose,
}: AcceptanceDialogProps): JSX.Element | null {
  const api = useApiClient();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const resetBewertung = useBewertungStore((s) => s.reset);
  const printer = useLabelPrinter();

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<boolean>(false);
  const [rejectReason, setRejectReason] = useState<string>('');

  /**
   * §19.3 W-1 — synchronous mutex shared by accept + reject. Both flip the
   * async `submitting` state, so a fast double-click can re-enter before React
   * commits it — accept could create two Ankauf transactions, reject could fire
   * two rejections. The ref is visible immediately on the next synchronous read.
   */
  const inFlightRef = useRef<boolean>(false);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setError(null);
      setRejecting(false);
      setRejectReason('');
      inFlightRef.current = false;
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

  // Customer detail for KYC + sanctions check.
  const customerQ = useQuery({
    queryKey: ['customers', appraisal.customerId],
    queryFn: () => customersApi.get(api, appraisal.customerId),
    staleTime: 5_000,
  });
  const customer = customerQ.data;

  const totalOfferedEur = appraisal.totalOfferedEur ?? appraisal.totalAppraisedEur;
  const totalCents = toCents(totalOfferedEur);
  // Accepting a Konvolut IS an Ankauf, so it falls under the SAME identity rule
  // as the single-item buy: ID required from €0,01 (§259 StGB Hehlerei), NOT the
  // €2.000 §10 threshold. Use the shared gate, identical to AnkaufBezahlenDialog.
  const kycGate = evaluateKycGate({ direction: 'ANKAUF', totalCents, customer: customer ?? null });

  const sanctioned = customer?.sanctionsMatch === true;
  const banned = customer?.trustLevel === 'BANNED';
  const blocked = sanctioned || banned;
  const kycMissingForGwg = kycGate.required;

  const canAccept = customer !== undefined && !blocked && !kycMissingForGwg && !submitting;

  const accept = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    if (!canAccept) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await appraisalsApi.accept(api, appraisal.id);
      addToast({
        tone: 'success',
        title: 'Konvolut angenommen',
        body: `${appraisal.items.length} Stücke ins Lager überführt.`,
      });

      const labels = result.items
        .filter((i) => i.productId !== null)
        .map(
          (i) =>
            ({
              sku: i.productId as string,
              productName: i.name,
              weightGrams: i.weightGrams ?? null,
              karat: i.karatCode ?? null,
              storageLocation: null,
            }) satisfies LabelData,
        );

      if (labels.length > 0) {
        void printer.print(labels);
      }

      // Invalidate everything the acceptance touched.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['appraisals', appraisal.id] }),
        qc.invalidateQueries({ queryKey: ['products', 'list'] }),
        qc.invalidateQueries({ queryKey: ['customers', appraisal.customerId] }),
        qc.invalidateQueries({ queryKey: dashboardQueryKey }),
        qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
      ]);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'STEP_UP_REQUIRED') setError('PIN-Bestätigung wurde abgebrochen.');
        else if (err.code === 'SANCTIONS_BLOCK') setError('Sanktionen. Annahme verweigert.');
        else if (err.code === 'CLOSING_DAY_FINALIZED')
          setError('Heutiger Tagesabschluss ist bereits geschlossen.');
        else if (err.code === 'DEVICE_NOT_AUTHORIZED')
          setError('Dieses Gerät ist nicht autorisiert. Bitte am POS-Terminal annehmen.');
        else setError(describeError(err));
      } else {
        setError('Verbindung gestört. Bitte erneut versuchen.');
      }
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [
    addToast,
    api,
    appraisal.customerId,
    appraisal.id,
    appraisal.items.length,
    canAccept,
    onClose,
    qc,
    printer,
  ]);

  const reject = useCallback(async (): Promise<void> => {
    // §19.3 W-1 mutex — read+set SYNCHRONOUSLY before any async work so a
    // double-click on "Endgültig ablehnen" can't fire the rejection twice.
    if (inFlightRef.current) return;
    if (rejectReason.trim().length < 4) {
      setError('Begründung erforderlich (mind. 4 Zeichen).');
      return;
    }
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await appraisalsApi.reject(api, appraisal.id, { reason: rejectReason.trim() });
      addToast({
        tone: 'info',
        title: 'Bewertung abgelehnt',
        body: 'Kunde nimmt das Angebot nicht an.',
      });
      await qc.invalidateQueries({ queryKey: ['appraisals', appraisal.id] });
      resetBewertung();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? describeError(err) : 'Netzwerk prüfen.');
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [addToast, api, appraisal.id, onClose, qc, rejectReason, resetBewertung]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bewertung annehmen"
      onClick={() => {
        if (!submitting) onClose();
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
        style={{ width: 'min(580px, 100%)', boxShadow: 'var(--w14-shadow-modal)' }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.5rem',
            textAlign: 'center',
          }}
        >
          Bewertung abschließen
        </h2>
        <p
          style={{
            margin: '6px 0 0',
            textAlign: 'center',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.92rem',
          }}
        >
          {appraisal.items.length} Stück{appraisal.items.length === 1 ? '' : 'e'} ·{' '}
          {customer?.fullName ?? '…'}
        </p>

        <DiamondRule label="Angebot" />
        <table
          className="w14-tabular"
          style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--w14-font-mono)' }}
        >
          <tbody>
            <Row
              label="Summe der Einzelschätzungen"
              valueEl={<MoneyAmount valueEur={appraisal.totalAppraisedEur} />}
            />
            <Row
              label="Angebot an den Kunden"
              valueEl={<MoneyAmount valueEur={totalOfferedEur} emphasis />}
              emphasised
            />
          </tbody>
        </table>

        {blocked && (
          <ParchmentCard
            padding="md"
            style={{ marginTop: 12, border: '2px solid var(--w14-wax-red)' }}
          >
            <p style={{ margin: 0, color: 'var(--w14-wax-red)', fontWeight: 500 }}>
              Geschäft mit diesem Kunden nicht zulässig ({sanctioned ? 'Sanktion' : 'gesperrt'}).
            </p>
          </ParchmentCard>
        )}

        {kycMissingForGwg && !blocked && (
          <ParchmentCard
            padding="md"
            style={{ marginTop: 12, border: '1px solid var(--w14-wax-red)' }}
          >
            <p
              style={{
                margin: 0,
                color: 'var(--w14-wax-red)',
                fontFamily: 'var(--w14-font-display)',
              }}
            >
              Ankauf: Identität ab 0,01 € erforderlich (§ 259 StGB / § 10 GwG).
            </p>
            <p
              style={{
                margin: '4px 0 8px',
                color: 'var(--w14-ink-faded)',
                fontFamily: 'var(--w14-font-display)',
                fontStyle: 'italic',
                fontSize: '0.85rem',
              }}
            >
              Bitte zuerst im Tab „Kunden" die Identität physisch prüfen und KYC bestätigen.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/kunden?id=${appraisal.customerId}`)}
            >
              → Zu Kunden öffnen
            </Button>
          </ParchmentCard>
        )}

        {!rejecting ? (
          <>
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
              style={{ marginTop: 22, display: 'flex', gap: 10, justifyContent: 'space-between' }}
            >
              <Button variant="ghost" onClick={() => setRejecting(true)} disabled={submitting}>
                Kunde lehnt ab
              </Button>
              <div style={{ display: 'flex', gap: 10 }}>
                <Button variant="ghost" onClick={onClose} disabled={submitting}>
                  Abbrechen
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => void accept()}
                  disabled={!canAccept}
                >
                  {submitting ? 'Schließt ab…' : 'Annehmen & Ankauf erstellen'}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <DiamondRule label="Ablehnung: Begründung" />
            <textarea
              value={rejectReason}
              onChange={(ev) => setRejectReason(ev.target.value)}
              rows={3}
              placeholder="Z. B. Kunde wollte mehr als unser Angebot."
              style={{
                width: '100%',
                border: 'none',
                outline: 'none',
                borderBottom: '2px solid var(--w14-rule)',
                background: 'transparent',
                padding: '8px 4px',
                fontFamily: 'var(--w14-font-body)',
                fontSize: '0.95rem',
                resize: 'vertical',
                color: 'var(--w14-ink)',
              }}
            />
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
            <div style={{ marginTop: 22, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setRejecting(false)} disabled={submitting}>
                Zurück
              </Button>
              <Button variant="destructive" onClick={() => void reject()} disabled={submitting}>
                {submitting ? 'Lehnt ab…' : 'Endgültig ablehnen'}
              </Button>
            </div>
          </>
        )}
      </ParchmentCard>
    </div>
  );
}

function Row({
  label,
  valueEl,
  emphasised = false,
}: {
  label: string;
  valueEl: JSX.Element;
  emphasised?: boolean;
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
      <td style={{ padding: '8px 0', textAlign: 'right' }}>{valueEl}</td>
    </tr>
  );
}
