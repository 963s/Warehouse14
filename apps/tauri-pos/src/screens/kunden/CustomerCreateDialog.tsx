/**
 * CustomerCreateDialog — anlegen eines neuen Kunden, auch ohne Verkauf.
 *
 * Captures the full personal record (name, Geburtsdatum, contact, address,
 * notes, Sprache) and POSTs to /api/customers (customersApi.create, ADMIN +
 * CASHIER). On success the new customer is selected in the Kundenakte so the
 * operator lands straight on the fresh record.
 *
 * Only `fullName` is required — everything else is optional, so the shop can
 * record an interested visitor and complete the data later.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  ApiError,
  type CustomerCreateBody,
  type CustomerLanguage,
  customersApi,
} from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { germanDateToIso } from '../../lib/german-date.js';
import { useToastStore } from '../../state/toast-store.js';

export interface CustomerCreateDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the new customer id after a successful create. */
  onCreated: (id: string) => void;
}

const LANGS: Array<{ value: CustomerLanguage; label: string }> = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'Englisch' },
  { value: 'ar', label: 'Arabisch' },
];

export function CustomerCreateDialog({
  open,
  onClose,
  onCreated,
}: CustomerCreateDialogProps): JSX.Element | null {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [language, setLanguage] = useState<CustomerLanguage>('de');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFullName('');
    setDateOfBirth('');
    setEmail('');
    setPhone('');
    setAddress('');
    setNotes('');
    setLanguage('de');
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

  const canSubmit = fullName.trim().length >= 2 && !submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: CustomerCreateBody = {
        fullName: fullName.trim(),
        preferredLanguage: language,
      };
      const dob = dateOfBirth.trim();
      const em = email.trim();
      const ph = phone.trim();
      const ad = address.trim();
      const nt = notes.trim();
      if (dob) {
        const iso = germanDateToIso(dob);
        if (!iso) {
          setError('Geburtsdatum bitte als TT.MM.JJJJ eingeben (z. B. 15.06.1990).');
          setSubmitting(false);
          return;
        }
        body.dateOfBirth = iso;
      }
      if (em) body.email = em;
      if (ph) body.phone = ph;
      if (ad) body.address = ad;
      if (nt) body.notes = nt;
      const result = await customersApi.create(api, body);
      addToast({
        tone: 'success',
        title: 'Kunde angelegt',
        body: `${fullName.trim()} · ${result.customerNumber}`,
      });
      await qc.invalidateQueries({ queryKey: ['customers', 'list'] });
      onCreated(result.id);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.code === 'CONFLICT'
            ? 'E-Mail oder Telefon bereits einem anderen Kunden zugewiesen.'
            : err.message,
        );
      } else {
        setError('Verbindung gestört — bitte erneut versuchen.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; Esc handled above + explicit buttons.
    // biome-ignore lint/a11y/useSemanticElements: backdrop overlay matches the existing dialog pattern in this screen.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Neuen Kunden anlegen"
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
        style={{ width: 'min(560px, 100%)', boxShadow: 'var(--w14-shadow-modal)' }}
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
          Neuen Kunden anlegen
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
          Auch ohne Kauf — nur der Name ist Pflicht.
        </p>

        <DiamondRule label="Daten" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field
            label="Vollständiger Name"
            value={fullName}
            onChange={setFullName}
            required
            colSpan={2}
          />
          <Field
            label="Geburtsdatum (TT.MM.JJJJ)"
            value={dateOfBirth}
            onChange={setDateOfBirth}
            mono
          />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span
              className="w14-smallcaps"
              style={{
                color: 'var(--w14-ink-faded)',
                fontSize: '0.72rem',
                letterSpacing: '0.08em',
              }}
            >
              Sprache
            </span>
            <select
              value={language}
              onChange={(ev) => setLanguage(ev.target.value as CustomerLanguage)}
              style={{
                border: 'none',
                outline: 'none',
                borderBottom: '2px solid var(--w14-rule)',
                background: 'transparent',
                padding: '6px 4px',
                fontFamily: 'var(--w14-font-body)',
                fontSize: '0.92rem',
                color: 'var(--w14-ink)',
              }}
            >
              {LANGS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <Field label="E-Mail" value={email} onChange={setEmail} type="email" />
          <Field label="Telefon" value={phone} onChange={setPhone} mono />
          <Field label="Adresse" value={address} onChange={setAddress} multiline colSpan={2} />
          <Field
            label="Notizen (z. B. Personalausweis-Nr., Interesse)"
            value={notes}
            onChange={setNotes}
            multiline
            colSpan={2}
          />
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

        <div style={{ marginTop: 22, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? 'Legt an…' : 'Kunden anlegen'}
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required = false,
  mono = false,
  multiline = false,
  type = 'text',
  colSpan,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  mono?: boolean;
  multiline?: boolean;
  type?: 'text' | 'email' | 'tel';
  colSpan?: number;
}): JSX.Element {
  const containerStyle: React.CSSProperties = colSpan ? { gridColumn: `span ${colSpan}` } : {};
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...containerStyle }}>
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-faded)', fontSize: '0.72rem', letterSpacing: '0.08em' }}
      >
        {label}
        {required && <span style={{ color: 'var(--w14-wax-red)' }}> *</span>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(ev) => onChange(ev.target.value)}
          rows={2}
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
      ) : (
        <input
          type={type}
          value={value}
          spellCheck={false}
          onChange={(ev) => onChange(ev.target.value)}
          style={{
            border: 'none',
            outline: 'none',
            borderBottom: '2px solid var(--w14-rule)',
            background: 'transparent',
            padding: '6px 4px',
            fontFamily: mono ? 'var(--w14-font-mono)' : 'var(--w14-font-body)',
            fontSize: '0.92rem',
            color: 'var(--w14-ink)',
          }}
        />
      )}
    </label>
  );
}
