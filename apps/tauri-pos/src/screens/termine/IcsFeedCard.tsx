/**
 * IcsFeedCard — the ICS subscription corner of the Termine cockpit
 * (CONTRACT endpoint 3). POST /api/appointments/feed-token (ADMIN; a needed
 * PIN step-up opens automatically via the api-client interceptor) returns
 * `{ token, url }`; we show the feed URL, a copy button, and a short German
 * explainer for subscribing on iPhone / Google Kalender.
 *
 * Rotating the token invalidates previously shared URLs — the card says so.
 */

import { useState } from 'react';

import { Button } from '@warehouse14/ui-kit';

import { useToastStore } from '../../state/toast-store.js';
import { useFeedToken } from './useTermineMutations.js';

export function IcsFeedCard(): JSX.Element {
  const addToast = useToastStore((s) => s.addToast);
  const feedToken = useFeedToken();
  const [copied, setCopied] = useState(false);

  const url = feedToken.data?.url ?? null;

  const copy = async (): Promise<void> => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      addToast({
        tone: 'alert',
        title: 'Kopieren fehlgeschlagen',
        body: 'Bitte markieren Sie die Adresse und kopieren Sie sie manuell.',
      });
    }
  };

  return (
    <section
      aria-label="Kalender-Abo (ICS)"
      style={{
        display: 'grid',
        gap: 10,
        padding: '12px 14px',
        background: 'var(--w14-parchment-2)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
      }}
    >
      <header style={{ display: 'grid', gap: 2 }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--w14-ink)' }}>
          In iPhone/Google Kalender abonnieren
        </h3>
        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
          Alle Termine der nächsten 90 Tage als Kalender-Abo — fügen Sie die Adresse unter
          „Kalenderabonnement" (iPhone) bzw. „Per URL hinzufügen" (Google Kalender) ein. Der
          Kalender aktualisiert sich dort automatisch.
        </p>
      </header>

      {url ? (
        <>
          <output
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '0.74rem',
              color: 'var(--w14-ink)',
              wordBreak: 'break-all',
              padding: '8px 10px',
              background: 'var(--w14-parchment-3)',
              borderRadius: 'var(--w14-radius-button)',
              userSelect: 'all',
            }}
          >
            {url}
          </output>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" size="sm" onClick={() => void copy()}>
              {copied ? 'Kopiert ✓' : 'Adresse kopieren'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={feedToken.isPending}
              onClick={() => feedToken.mutate()}
            >
              Neu erzeugen
            </Button>
          </div>
          <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--w14-ink-faded)' }}>
            Hinweis: „Neu erzeugen" macht zuvor geteilte Abo-Adressen ungültig.
          </p>
        </>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          <div>
            <Button
              variant="ghost"
              size="sm"
              disabled={feedToken.isPending}
              onClick={() => feedToken.mutate()}
            >
              {feedToken.isPending ? 'Erzeuge Adresse …' : 'Abo-Adresse anzeigen'}
            </Button>
          </div>
          {feedToken.isError ? (
            <p role="alert" style={{ margin: 0, fontSize: '0.78rem', color: 'var(--w14-wax-red)' }}>
              Abo-Adresse konnte nicht erzeugt werden. Diese Funktion erfordert Admin-Rechte.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
