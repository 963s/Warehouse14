/**
 * CustomerEraseDialog — DSGVO Art. 17 (Recht auf Löschung).
 *
 * Calls `POST /api/customers/:id/erase` (ADMIN + step-up; the wrapWithStepUp
 * interceptor drives the PIN dialog + retry, exactly as CustomerTrustDialog does).
 * The server anonymizes the customer IN PLACE and deletes their server-side KYC
 * images; fiscal / GoBD / GwG records are kept with PII redacted and the
 * `customer_number` survives as a pseudonym.
 *
 * IRREVERSIBLE, so two gates guard it: the operator must type the confirm word,
 * AND the server enforces a step-up PIN. On success we also purge the LOCAL
 * encrypted Ausweis-Tresor for this customer (the Phase 3.2 delete), so the
 * erase is total — no at-rest PII copy survives on this till either.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError, type CustomerDetail, customersApi } from '@warehouse14/api-client';
import { describeError } from '@warehouse14/i18n-de';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { deleteKycDocument } from '../../lib/hardware-client.js';
import { deleteKycRecord, listKycForCustomer } from '../../lib/kyc-store.js';
import { useToastStore } from '../../state/toast-store.js';

import { kycLocalQueryKey } from './KycLocalDocs.js';

/** The word the operator types to arm the irreversible erase. */
const CONFIRM_WORD = 'LÖSCHEN';

/**
 * Best-effort purge of this customer's local encrypted Ausweis files. The server
 * erase is the authoritative action; this removes the offline cached copies on
 * THIS till. Returns the count that could not be removed so the operator hears
 * the truth rather than a blanket "gelöscht".
 */
async function purgeLocalVault(customerId: string): Promise<number> {
  let failed = 0;
  let records: Awaited<ReturnType<typeof listKycForCustomer>> = [];
  try {
    records = await listKycForCustomer(customerId);
  } catch {
    // Outside Tauri (or no local DB) there is nothing to purge.
    return 0;
  }
  for (const rec of records) {
    try {
      await deleteKycDocument(rec.filePath);
      await deleteKycRecord(rec.id);
    } catch {
      failed += 1;
    }
  }
  return failed;
}

export interface CustomerEraseDialogProps {
  open: boolean;
  customer: CustomerDetail;
  onClose: () => void;
}

export function CustomerEraseDialog({
  open,
  customer,
  onClose,
}: CustomerEraseDialogProps): JSX.Element | null {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [confirmText, setConfirmText] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setConfirmText('');
    setSubmitting(false);
    setError(null);
  }, [open]);

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

  const armed = confirmText.trim().toUpperCase() === CONFIRM_WORD && !submitting;

  const submit = async (): Promise<void> => {
    if (!armed) return;
    setSubmitting(true);
    setError(null);
    try {
      await customersApi.erase(api, customer.id);
      // Server erase succeeded — now purge the local at-rest copies.
      const failedLocal = await purgeLocalVault(customer.id);

      addToast({
        tone: 'success',
        title: 'Kundendaten gelöscht',
        body:
          failedLocal > 0
            ? `Serverseitig anonymisiert. ${failedLocal} lokale Tresor-Datei(en) konnten nicht entfernt werden.`
            : 'Serverseitig anonymisiert, lokaler Ausweis-Tresor geleert.',
      });
      await qc.invalidateQueries({ queryKey: ['customers', customer.id] });
      await qc.invalidateQueries({ queryKey: ['customers', 'list'] });
      await qc.invalidateQueries({ queryKey: kycLocalQueryKey(customer.id) });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'STEP_UP_REQUIRED') setError('PIN-Bestätigung wurde abgebrochen.');
        else setError(describeError(err));
      } else {
        setError('Verbindung gestört — bitte erneut versuchen.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Kundendaten löschen"
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
        style={{
          width: 'min(480px, 100%)',
          boxShadow: 'var(--w14-shadow-modal)',
          border: '2px solid var(--w14-wax-red)',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.4rem',
            textAlign: 'center',
            color: 'var(--w14-wax-red)',
          }}
        >
          Kundendaten löschen
        </h2>
        <p
          style={{
            margin: '4px 0 0',
            textAlign: 'center',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.85rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {customer.fullName} · {customer.customerNumber}
        </p>

        <DiamondRule label="Recht auf Löschung (Art. 17)" />

        <p style={{ margin: '4px 0 0', fontSize: '0.9rem', lineHeight: 1.5 }}>
          Alle personenbezogenen Daten dieses Kunden werden unwiderruflich
          anonymisiert und die gespeicherten Ausweisbilder gelöscht — server- und
          geräteseitig. Steuer-, GoBD- und GwG-Belege bleiben mit geschwärzten
          Daten erhalten; die Kundennummer bleibt als Pseudonym bestehen.
        </p>
        <p
          style={{
            margin: '10px 0 0',
            fontSize: '0.85rem',
            color: 'var(--w14-wax-red)',
            fontStyle: 'italic',
          }}
        >
          Dieser Schritt kann nicht rückgängig gemacht werden.
        </p>

        <label
          htmlFor="w14-erase-confirm"
          className="w14-smallcaps"
          style={{
            display: 'block',
            color: 'var(--w14-ink-faded)',
            fontSize: '0.72rem',
            letterSpacing: '0.08em',
            marginTop: 16,
          }}
        >
          Zum Bestätigen »{CONFIRM_WORD}« eingeben
        </label>
        <input
          id="w14-erase-confirm"
          type="text"
          value={confirmText}
          onChange={(ev) => setConfirmText(ev.target.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={submitting}
          style={{
            width: '100%',
            marginTop: 6,
            border: 'none',
            outline: 'none',
            borderBottom: '2px solid var(--w14-rule)',
            background: 'transparent',
            padding: '6px 4px',
            fontFamily: 'var(--w14-font-mono)',
            letterSpacing: '0.12em',
            fontSize: '0.98rem',
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

        <div style={{ marginTop: 22, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={!armed}>
            {submitting ? 'Löscht…' : 'Endgültig löschen'}
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}
