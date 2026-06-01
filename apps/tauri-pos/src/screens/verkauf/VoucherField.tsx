/**
 * VoucherField — Gutschein lookup + apply inside the Bezahlen dialog (Phase C2).
 *
 * Self-contained: the operator types a code and presses "Einlösen"; this looks
 * it up via GET /api/vouchers/:code, validates it's ACTIVE with a positive
 * balance, and calls `onApplied({ code, balanceEur })`. The parent computes the
 * voucher/cash split (computeTender) and, after finalize, posts the redemption.
 *
 * Applied state shows the code + remaining balance and an "Entfernen" action.
 */

import { useState } from 'react';

import type { ApiClient } from '@warehouse14/api-client';
import { Button } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';

export interface AppliedVoucher {
  code: string;
  /** current_balance_eur at lookup time (decimal string). */
  balanceEur: string;
}

interface VoucherView {
  code: string;
  currentBalanceEur: string;
  status: string;
}

export function VoucherField({
  applied,
  onApplied,
  disabled,
}: {
  applied: AppliedVoucher | null;
  onApplied: (v: AppliedVoucher | null) => void;
  disabled: boolean;
}): JSX.Element {
  const client = useApiClient() as ApiClient;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup(): Promise<void> {
    const clean = code.trim().toUpperCase();
    if (clean.length < 8 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const v = await client.request<VoucherView>(
        'GET',
        `/api/vouchers/${encodeURIComponent(clean)}`,
      );
      if (v.status !== 'ACTIVE') {
        setError(`Gutschein ist ${v.status === 'REDEEMED' ? 'bereits eingelöst' : v.status}.`);
        return;
      }
      if (Number(v.currentBalanceEur) <= 0) {
        setError('Gutschein hat kein Guthaben mehr.');
        return;
      }
      onApplied({ code: v.code, balanceEur: v.currentBalanceEur });
      setCode('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(
        /not found|404/i.test(msg) ? 'Gutschein nicht gefunden.' : 'Prüfung fehlgeschlagen.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (applied) {
    return (
      <div
        style={{
          marginTop: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '8px 12px',
          border: '1px solid var(--w14-gold)',
          borderRadius: 'var(--w14-radius-card)',
          background: 'var(--w14-parchment-3)',
        }}
      >
        <span style={{ fontSize: '0.85rem', color: 'var(--w14-ink)' }}>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-gold)', letterSpacing: '0.06em' }}
          >
            Gutschein
          </span>{' '}
          {applied.code} · Guthaben {applied.balanceEur} €
        </span>
        <Button variant="ghost" size="sm" onClick={() => onApplied(null)} disabled={disabled}>
          Entfernen
        </Button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void lookup();
            }
          }}
          placeholder="Gutschein-Code"
          disabled={disabled}
          style={{
            flex: 1,
            padding: '8px 10px',
            border: '1px solid var(--w14-rule)',
            borderRadius: 'var(--w14-radius-button)',
            background: 'var(--w14-parchment)',
            color: 'var(--w14-ink)',
            fontFamily: 'var(--w14-font-mono)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        />
        <Button
          variant="ghost"
          size="md"
          onClick={() => void lookup()}
          disabled={disabled || busy || code.trim().length < 8}
        >
          {busy ? 'Prüft…' : 'Einlösen'}
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          style={{ color: 'var(--w14-wax-red)', fontSize: '0.8rem', margin: '6px 0 0' }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
