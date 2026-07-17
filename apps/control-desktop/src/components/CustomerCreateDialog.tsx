/**
 * CustomerCreateDialog — Owner Desktop "Neuer Kunde" (Track B5 depth).
 *
 * Creates a customer via POST /api/customers (customersApi.create). Only the
 * name is required; contact + birthday are optional (the server stores PII
 * encrypted). KYC, trust and sanctions are handled afterwards from the row's
 * edit dialog. If the create needs a fresh PIN, the global step-up modal opens
 * and replays transparently — the happy path needs no extra wiring here.
 *
 * Shares the CustomerEditDialog overlay chrome (fixed backdrop, Esc + backdrop
 * dismiss, ParchmentCard body).
 */

import { type CSSProperties, useEffect, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { ApiError, customersApi } from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';
import { describeError } from '@warehouse14/i18n-de';

import { useApiClient } from '../api-context.js';
import { isStepUpCancelled } from '../state/step-up-store.js';

const label: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: '0.78rem',
  color: 'var(--w14-ink-faded)',
};
const input: CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--w14-ink-faded)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: '0.95rem',
};

export function CustomerCreateDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { client } = useApiClient();
  const qc = useQueryClient();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const canSave = fullName.trim().length >= 2 && !busy;

  async function save(): Promise<void> {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await customersApi.create(client, {
        fullName: fullName.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
        ...(dateOfBirth.trim() ? { dateOfBirth: dateOfBirth.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      await qc.invalidateQueries({ queryKey: ['customers'] });
      onClose();
    } catch (err) {
      if (isStepUpCancelled(err) || (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED')) {
        setError('Die PIN-Bestätigung wurde abgebrochen.');
      } else {
        setError(describeError(err));
      }
      setBusy(false);
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: backdrop-overlay modal; a native <dialog> needs imperative showModal()/focus-trap wiring beyond this scope.
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click dismisses; Esc is handled by a window keydown listener.
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (!busy) onClose();
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
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(520px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.3rem',
          }}
        >
          Neuer Kunde
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--w14-ink-faded)', fontSize: '0.88rem' }}>
          Nur der Name ist nötig. Kontakt und Geburtsdatum sind optional; KYC und Vertrauensstufe
          folgen später über die Kundenzeile.
        </p>
        <DiamondRule />

        <div style={{ display: 'grid', gap: 12 }}>
          <label style={label}>
            Name
            <input
              className="w14cd-focusable"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={200}
              placeholder="Vor- und Nachname"
              style={input}
              // biome-ignore lint/a11y/noAutofocus: first field of a deliberately-opened create dialog.
              autoFocus
            />
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ ...label, flex: '1 1 200px' }}>
              E-Mail
              <input
                className="w14cd-focusable"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={200}
                placeholder="optional"
                style={input}
              />
            </label>
            <label style={{ ...label, flex: '1 1 160px' }}>
              Telefon
              <input
                className="w14cd-focusable"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={60}
                placeholder="optional"
                style={input}
              />
            </label>
          </div>
          <label style={label}>
            Anschrift
            <input
              className="w14cd-focusable"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={300}
              placeholder="optional"
              style={input}
            />
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ ...label, flex: '1 1 160px' }}>
              Geburtsdatum
              <input
                className="w14cd-focusable"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                maxLength={40}
                placeholder="TT.MM.JJJJ (optional)"
                style={input}
              />
            </label>
            <label style={{ ...label, flex: '1 1 200px' }}>
              Notiz
              <input
                className="w14cd-focusable"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                placeholder="optional"
                style={input}
              />
            </label>
          </div>
        </div>

        {error && (
          <p role="alert" style={{ color: 'var(--w14-wax-red)', margin: '14px 0 0', fontSize: '0.9rem' }}>
            {error}
          </p>
        )}

        <DiamondRule />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <Button variant="ghost" size="md" disabled={busy} onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="primary" size="md" disabled={!canSave} onClick={() => void save()}>
            {busy ? 'Wird angelegt …' : 'Kunde anlegen'}
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}
