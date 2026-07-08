/**
 * CustomerEditDialog — Owner Desktop AML/Trust editing for one customer.
 *
 * Two guarded mutations, both Owner + frische PIN (step-up) + gekoppeltes Gerät:
 *
 *   • Vertrauensstufe → PATCH /api/customers/:id/trust
 *       VERDÄCHTIG / GESPERRT verlangen eine Begründung (≥ 8 Zeichen).
 *       BESTÄTIGT / VIP verlangen eine vorherige KYC-Prüfung (sonst 409).
 *   • KYC-Prüfung    → PATCH /api/customers/:id/kyc
 *       Stempelt die physische Ausweisprüfung; optional Heraufstufung.
 *
 * The step-up middleware opens the global PIN modal on STEP_UP_REQUIRED and
 * replays the request — so the happy path needs no extra wiring here. We only
 * translate the remaining error codes into precise German.
 */

import { useEffect, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import {
  ApiError,
  CUSTOMER_KYC_STATUS_LABELS,
  CUSTOMER_TRUST_LEVEL_LABELS,
  type CustomerKycStatus,
  type CustomerTrustLevel,
  customersApi,
} from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../api-context.js';
import { isStepUpCancelled } from '../state/step-up-store.js';
import { describeError } from '@warehouse14/i18n-de';

export interface EditableCustomer {
  id: string;
  fullName: string;
  kycStatus: string;
  kycVerifiedAt: string | null;
  trustLevel: string;
}

type DocumentType =
  | 'PERSONALAUSWEIS'
  | 'REISEPASS'
  | 'EU_NATIONAL_ID'
  | 'AUFENTHALTSTITEL'
  | 'PASSPORT_NON_EU';

const TRUST_OPTIONS: Array<{
  value: CustomerTrustLevel;
  label: string;
  tone: 'gold' | 'ink' | 'wax-red';
}> = [
  { value: 'NEW', label: 'NEU (Standard)', tone: 'ink' },
  { value: 'VERIFIED', label: 'BESTÄTIGT (Stammkunde)', tone: 'gold' },
  { value: 'VIP', label: 'VIP (Sammler)', tone: 'gold' },
  { value: 'SUSPICIOUS', label: 'BEOBACHTEN (Verdacht)', tone: 'wax-red' },
  { value: 'BANNED', label: 'GESPERRT (kein Geschäft)', tone: 'wax-red' },
];

const DOCUMENT_OPTIONS: Array<{ value: DocumentType; label: string }> = [
  { value: 'PERSONALAUSWEIS', label: 'Personalausweis' },
  { value: 'REISEPASS', label: 'Reisepass' },
  { value: 'EU_NATIONAL_ID', label: 'EU-Personalausweis' },
  { value: 'AUFENTHALTSTITEL', label: 'Aufenthaltstitel' },
  { value: 'PASSPORT_NON_EU', label: 'Reisepass (Nicht-EU)' },
];

/** Map an error to a precise German sentence. */
function germanError(err: unknown): string {
  // A cancelled PIN modal rejects with a plain StepUpCancelledError (not an
  // ApiError), so it must be caught here — else a deliberate cancel would fall
  // through to the "Verbindung gestört" network line.
  if (isStepUpCancelled(err)) return 'PIN-Bestätigung wurde abgebrochen.';
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'STEP_UP_REQUIRED':
        return 'PIN-Bestätigung wurde abgebrochen.';
      case 'DEVICE_NOT_AUTHORIZED':
        return 'Diese Aktion erfordert ein gekoppeltes Gerät (mTLS).';
      case 'CONFLICT':
        return 'KYC-Prüfung erforderlich, bevor BESTÄTIGT oder VIP gesetzt werden kann.';
      case 'FORBIDDEN':
        return 'Nur der Inhaber darf diese Änderung vornehmen.';
      default:
        return describeError(err);
    }
  }
  return 'Verbindung gestört. Bitte erneut versuchen.';
}

/** The word the operator types to arm the irreversible Art. 17 erasure. */
const ERASE_CONFIRM_WORD = 'LÖSCHEN';

export function CustomerEditDialog({
  customer,
  onClose,
}: {
  customer: EditableCustomer;
  onClose: () => void;
}): JSX.Element {
  const { client } = useApiClient();
  const qc = useQueryClient();

  const [target, setTarget] = useState<CustomerTrustLevel>(
    customer.trustLevel as CustomerTrustLevel,
  );
  const [reason, setReason] = useState('');
  const [docType, setDocType] = useState<DocumentType>('PERSONALAUSWEIS');
  const [promote, setPromote] = useState<'' | 'VERIFIED' | 'VIP'>('');
  const [confirmErase, setConfirmErase] = useState('');
  const [busy, setBusy] = useState<null | 'trust' | 'kyc' | 'erase' | 'kyc-delete'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && busy === null) {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const kycVerified = customer.kycVerifiedAt !== null;
  const requiresReason = target === 'SUSPICIOUS' || target === 'BANNED';
  const promotionBlocked = (target === 'VERIFIED' || target === 'VIP') && !kycVerified;
  const reasonValid = !requiresReason || reason.trim().length >= 8;
  const canSaveTrust =
    target !== customer.trustLevel && reasonValid && !promotionBlocked && busy === null;

  async function invalidate(): Promise<void> {
    await qc.invalidateQueries({ queryKey: ['customers'] });
  }

  async function saveTrust(): Promise<void> {
    if (!canSaveTrust) return;
    setBusy('trust');
    setError(null);
    setNotice(null);
    try {
      const body = requiresReason
        ? { trustLevel: target, reason: reason.trim() }
        : { trustLevel: target };
      await client.request(
        'PATCH',
        `/api/customers/${encodeURIComponent(customer.id)}/trust`,
        body,
      );
      await invalidate();
      setNotice(`Vertrauensstufe gesetzt: ${customer.fullName} → ${target}`);
    } catch (err) {
      setError(germanError(err));
    } finally {
      setBusy(null);
    }
  }

  async function stampKyc(): Promise<void> {
    if (busy !== null) return;
    setBusy('kyc');
    setError(null);
    setNotice(null);
    try {
      const body: { documentType: DocumentType; promoteTrustLevelTo?: 'VERIFIED' | 'VIP' } = {
        documentType: docType,
      };
      if (promote) body.promoteTrustLevelTo = promote;
      await client.request('PATCH', `/api/customers/${encodeURIComponent(customer.id)}/kyc`, body);
      await invalidate();
      setNotice('KYC-Prüfung gestempelt.');
    } catch (err) {
      setError(germanError(err));
    } finally {
      setBusy(null);
    }
  }

  const eraseArmed = confirmErase.trim().toUpperCase() === ERASE_CONFIRM_WORD && busy === null;

  /** DSGVO Art. 17 — anonymize the customer server-side + delete their KYC images. */
  async function eraseCustomer(): Promise<void> {
    if (!eraseArmed) return;
    setBusy('erase');
    setError(null);
    setNotice(null);
    try {
      await customersApi.erase(client, customer.id);
      await invalidate();
      setConfirmErase('');
      setNotice('Kundendaten gelöscht. Serverseitig anonymisiert.');
    } catch (err) {
      setError(germanError(err));
    } finally {
      setBusy(null);
    }
  }

  /** Purge the customer's stored ID documents (C4 — delete / replace a saved Ausweis). */
  async function deleteKycDocuments(): Promise<void> {
    if (busy !== null) return;
    setBusy('kyc-delete');
    setError(null);
    setNotice(null);
    try {
      const { purgedCount } = await customersApi.deleteKycDocuments(client, customer.id);
      await invalidate();
      setNotice(
        purgedCount > 0
          ? `${purgedCount} Ausweisdokument(e) gelöscht.`
          : 'Keine gespeicherten Ausweisdokumente vorhanden.',
      );
    } catch (err) {
      setError(germanError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: backdrop-overlay modal; a native <dialog> needs imperative showModal()/focus-trap wiring beyond this scope.
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click dismisses; Esc is handled by a window keydown listener.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Kundenakte bearbeiten"
      onClick={() => {
        if (busy === null) onClose();
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
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.4rem',
            textAlign: 'center',
          }}
        >
          {customer.fullName}
        </h2>
        <p
          style={{
            margin: '4px 0 0',
            textAlign: 'center',
            color: 'var(--w14-ink-faded)',
            fontSize: '0.85rem',
          }}
        >
          KYC:{' '}
          {kycVerified
            ? 'verifiziert'
            : (CUSTOMER_KYC_STATUS_LABELS[customer.kycStatus as CustomerKycStatus] ??
              customer.kycStatus)}{' '}
          · Aktuell:{' '}
          {CUSTOMER_TRUST_LEVEL_LABELS[customer.trustLevel as CustomerTrustLevel] ??
            customer.trustLevel}
        </p>

        <DiamondRule label="Vertrauensstufe" />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {TRUST_OPTIONS.map((opt) => {
            const disabled = (opt.value === 'VERIFIED' || opt.value === 'VIP') && !kycVerified;
            const color =
              opt.tone === 'gold'
                ? 'var(--w14-gold)'
                : opt.tone === 'wax-red'
                  ? 'var(--w14-wax-red)'
                  : 'var(--w14-ink-faded)';
            return (
              <label
                key={opt.value}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: 10,
                  alignItems: 'baseline',
                  padding: '6px 10px',
                  background: target === opt.value ? 'var(--w14-parchment-3)' : 'transparent',
                  border: `1px solid ${target === opt.value ? color : 'var(--w14-rule)'}`,
                  borderRadius: 'var(--w14-radius-card)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.45 : 1,
                }}
              >
                <input
                  type="radio"
                  name="trust-level"
                  value={opt.value}
                  checked={target === opt.value}
                  disabled={disabled}
                  onChange={() => setTarget(opt.value)}
                />
                <span
                  className="w14-smallcaps"
                  style={{ color, letterSpacing: '0.08em', fontSize: '0.92rem' }}
                >
                  {opt.label}
                </span>
              </label>
            );
          })}
        </div>

        {promotionBlocked && (
          <p
            style={{
              margin: '12px 0 0',
              color: 'var(--w14-wax-red)',
              fontSize: '0.85rem',
              textAlign: 'center',
              fontStyle: 'italic',
            }}
          >
            KYC-Prüfung erforderlich, bevor BESTÄTIGT oder VIP gesetzt werden kann.
          </p>
        )}

        {requiresReason && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span
              className="w14-smallcaps"
              style={{
                color: 'var(--w14-ink-faded)',
                fontSize: '0.72rem',
                letterSpacing: '0.08em',
              }}
            >
              Begründung (mind. 8 Zeichen) *
            </span>
            <textarea
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              rows={2}
              placeholder="Z. B. Hehlerverdacht, Auffälligkeit am 27.05.2026"
              style={{
                border: 'none',
                outline: 'none',
                borderBottom: '2px solid var(--w14-rule)',
                background: 'transparent',
                padding: '6px 4px',
                resize: 'vertical',
                fontFamily: 'var(--w14-font-body)',
                fontSize: '0.92rem',
                color: 'var(--w14-ink)',
              }}
            />
          </div>
        )}

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" onClick={() => void saveTrust()} disabled={!canSaveTrust}>
            {busy === 'trust' ? 'Setzt…' : 'Vertrauensstufe setzen'}
          </Button>
        </div>

        <DiamondRule label="KYC-Prüfung" />

        <p style={{ margin: '0 0 10px', color: 'var(--w14-ink-faded)', fontSize: '0.85rem' }}>
          Physisch geprüftes Ausweisdokument stempeln.{' '}
          {kycVerified
            ? 'Bereits verifiziert. Erneutes Stempeln aktualisiert Prüfer und Zeitpunkt.'
            : ''}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' }}>
            <span
              className="w14-smallcaps"
              style={{
                color: 'var(--w14-ink-faded)',
                fontSize: '0.72rem',
                letterSpacing: '0.08em',
              }}
            >
              Dokumenttyp
            </span>
            <select
              value={docType}
              onChange={(ev) => setDocType(ev.target.value as DocumentType)}
              style={{
                padding: '7px 10px',
                border: '1px solid var(--w14-ink-faded)',
                borderRadius: 'var(--w14-radius-button)',
                background: 'var(--w14-parchment)',
                color: 'var(--w14-ink)',
                fontFamily: 'var(--w14-font-body)',
              }}
            >
              {DOCUMENT_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' }}>
            <span
              className="w14-smallcaps"
              style={{
                color: 'var(--w14-ink-faded)',
                fontSize: '0.72rem',
                letterSpacing: '0.08em',
              }}
            >
              Heraufstufung (optional)
            </span>
            <select
              value={promote}
              onChange={(ev) => setPromote(ev.target.value as '' | 'VERIFIED' | 'VIP')}
              style={{
                padding: '7px 10px',
                border: '1px solid var(--w14-ink-faded)',
                borderRadius: 'var(--w14-radius-button)',
                background: 'var(--w14-parchment)',
                color: 'var(--w14-ink)',
                fontFamily: 'var(--w14-font-body)',
              }}
            >
              <option value="">Keine (nur stempeln)</option>
              <option value="VERIFIED">Auf BESTÄTIGT</option>
              <option value="VIP">Auf VIP</option>
            </select>
          </label>
        </div>

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" onClick={() => void stampKyc()} disabled={busy !== null}>
            {busy === 'kyc' ? 'Stempelt…' : 'KYC stempeln'}
          </Button>
        </div>

        <DiamondRule label="Datenschutz (Art. 17)" />

        <p style={{ margin: '0 0 10px', color: 'var(--w14-ink-faded)', fontSize: '0.85rem' }}>
          Recht auf Löschung. Die personenbezogenen Daten werden unwiderruflich
          anonymisiert und die gespeicherten Ausweisbilder gelöscht; Steuer-, GoBD-
          und GwG-Belege bleiben mit geschwärzten Daten erhalten. Jede Aktion verlangt
          eine frische PIN-Bestätigung.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' }}>
            <span
              className="w14-smallcaps"
              style={{
                color: 'var(--w14-ink-faded)',
                fontSize: '0.72rem',
                letterSpacing: '0.08em',
              }}
            >
              Zum Bestätigen »{ERASE_CONFIRM_WORD}« eingeben
            </span>
            <input
              type="text"
              value={confirmErase}
              onChange={(ev) => setConfirmErase(ev.target.value)}
              autoComplete="off"
              spellCheck={false}
              style={{
                padding: '7px 10px',
                border: '1px solid var(--w14-ink-faded)',
                borderRadius: 'var(--w14-radius-button)',
                background: 'var(--w14-parchment)',
                color: 'var(--w14-ink)',
                fontFamily: 'var(--w14-font-mono)',
                letterSpacing: '0.12em',
              }}
            />
          </label>
          <Button
            variant="destructive"
            onClick={() => void eraseCustomer()}
            disabled={!eraseArmed}
          >
            {busy === 'erase' ? 'Löscht…' : 'Kundendaten löschen'}
          </Button>
        </div>

        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void deleteKycDocuments()}
            disabled={busy !== null}
            style={{ color: 'var(--w14-wax-red)' }}
          >
            {busy === 'kyc-delete' ? 'Löscht…' : 'Gespeicherten Ausweis löschen'}
          </Button>
        </div>

        {error && (
          <p
            role="alert"
            style={{
              color: 'var(--w14-wax-red)',
              margin: '16px 0 0',
              fontSize: '0.92rem',
              textAlign: 'center',
            }}
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            style={{
              color: 'var(--w14-verdigris)',
              margin: '16px 0 0',
              fontSize: '0.92rem',
              textAlign: 'center',
            }}
          >
            {notice}
          </p>
        )}

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
          <Button variant="ghost" onClick={onClose} disabled={busy !== null}>
            Schließen
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}
