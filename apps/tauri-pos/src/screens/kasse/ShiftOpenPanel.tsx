/**
 * ShiftOpenPanel — the Kasse "no shift" sub-view.
 *
 * Empty-state hero centred on parchment. Operator types the opening float
 * (Wechselgeld), optionally a note ("Bargeld vom Tresor übernommen"), and
 * confirms. On success: toast.success + dashboard/shift query invalidation
 * so the Werkstatt footer counter lights gold within the next render.
 */

import { useCallback, useState } from 'react';

import { ApiError, shifts as shiftsApi } from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard, Seal } from '@warehouse14/ui-kit';

import { useCurrentShift } from '../../hooks/useCurrentShift.js';
import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';

import { EuroInput } from './EuroInput.js';

export function ShiftOpenPanel(): JSX.Element {
  const api = useApiClient();
  const { invalidateShiftScope } = useCurrentShift();
  const addToast = useToastStore((s) => s.addToast);

  const [openingFloatEur, setOpeningFloatEur] = useState<string>('200.00');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const valid = /^\d{1,16}(\.\d{1,2})?$/.test(openingFloatEur);

  const submit = useCallback(async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const body =
        notes.trim().length > 0 ? { openingFloatEur, notes: notes.trim() } : { openingFloatEur };
      const opened = await shiftsApi.open(api, body);
      addToast({
        tone: 'success',
        title: 'Schicht eröffnet',
        body: `Wechselgeld ${formatPreview(opened.openingFloatEur)} · ID ${opened.id.slice(0, 8)}…`,
      });
      await invalidateShiftScope();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'CONFLICT') {
          setError('Eine Schicht ist bereits geöffnet auf diesem Gerät.');
        } else if (err.code === 'DEVICE_NOT_AUTHORIZED') {
          setError('Dieses Gerät ist nicht für die Kasse autorisiert.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Verbindung gestört — Netzwerk prüfen.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [addToast, api, invalidateShiftScope, notes, openingFloatEur, submitting, valid]);

  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        padding: 32,
      }}
    >
      <ParchmentCard padding="lg" style={{ width: 'min(520px, 100%)', textAlign: 'center' }}>
        <Seal size="lg" tone="faded" label="4" />
        <h1
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '2rem',
            margin: '20px 0 2px',
          }}
        >
          Tag beginnen
        </h1>
        <p
          className="w14-smallcaps"
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            letterSpacing: '0.08em',
            fontSize: '0.82rem',
          }}
        >
          Schicht öffnen
        </p>
        <p
          style={{
            margin: '8px 0 0',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
          }}
        >
          Zähle dein Startgeld in der Schublade.
        </p>
        <DiamondRule label="Eröffnung" />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, textAlign: 'left' }}>
          <EuroInput
            label="Startgeld in der Schublade (Wechselgeld)"
            valueEur={openingFloatEur}
            onValueChange={setOpeningFloatEur}
            autoFocus
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label
              htmlFor="kasse-notes"
              className="w14-smallcaps"
              style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem' }}
            >
              Notiz (optional)
            </label>
            <input
              id="kasse-notes"
              type="text"
              value={notes}
              onChange={(ev) => setNotes(ev.target.value)}
              disabled={submitting}
              maxLength={500}
              style={{
                width: '100%',
                border: 'none',
                outline: 'none',
                borderBottom: '2px solid var(--w14-rule)',
                background: 'transparent',
                color: 'var(--w14-ink)',
                fontFamily: 'var(--w14-font-body)',
                fontSize: '0.95rem',
                padding: '8px 4px',
              }}
            />
          </div>
        </div>

        {error && (
          <p
            role="alert"
            style={{
              color: 'var(--w14-wax-red)',
              margin: '14px 0 0',
              fontSize: '0.92rem',
            }}
          >
            {error}
          </p>
        )}

        <div style={{ marginTop: 24 }}>
          <Button
            variant="primary"
            size="lg"
            onClick={() => void submit()}
            disabled={!valid || submitting}
            fullWidth
          >
            {submitting ? 'Beginne…' : 'Tag beginnen'}
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}

/** Tiny inline copy of the EuroInput preview, used in the success toast. */
function formatPreview(canonical: string): string {
  const [whole = '0', frac = ''] = canonical.split('.');
  const wholeFmt = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fracFmt = frac.padEnd(2, '0').slice(0, 2);
  return `${wholeFmt},${fracFmt} €`;
}
