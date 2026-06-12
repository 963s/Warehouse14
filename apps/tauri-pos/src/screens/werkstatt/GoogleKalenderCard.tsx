/**
 * GoogleKalenderCard — embeds the owner-configured Google-Calendar EMBED URL
 * as a RAW iframe (the owner wires the real Google API himself later).
 *
 * The URL (or bare calendar ID) lives terminal-local in the
 * integration-settings store (Einstellungen → Social & Nachrichten →
 * „Google Kalender (Embed-URL)“). Empty state = a calm 3-step explainer.
 *
 * Used twice (same component, two fits):
 *   • Werkstatt left column — fills the negative space under Übersicht.
 *   • /kalender secondary surface — full-page, for comfortable WEEK view
 *     on small (1024px) screens.
 *
 * CSP: `frame-src https://calendar.google.com` is allowed in tauri.conf.json.
 */

import { DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useIntegrationSettings } from '../../state/integration-settings-store.js';

/**
 * Resolve what the operator pasted into an iframe `src`:
 *   • full embed URL (https://…)  → planted RAW, exactly as configured;
 *   • bare calendar ID (…@group.calendar.google.com or a Gmail address)
 *     → wrapped into the canonical embed URL with WEEK view + German UI.
 */
export function resolveEmbedSrc(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(value)}&mode=WEEK&hl=de`;
}

export interface GoogleKalenderCardProps {
  /**
   * `card`  — compact panel for the Werkstatt left column (default).
   * `full`  — full-page fit for the /kalender secondary surface.
   */
  variant?: 'card' | 'full';
}

export function GoogleKalenderCard({ variant = 'card' }: GoogleKalenderCardProps): JSX.Element {
  const embedUrl = useIntegrationSettings((s) => s.settings.googleCalendar.embedUrl);
  const src = resolveEmbedSrc(embedUrl);
  const full = variant === 'full';

  // Google's iframe embed needs third-party cookies + a Google session, which
  // the Tauri webview doesn't have — a PRIVATE calendar then renders blank or
  // asks to enable cookies. The reliable escape hatch: open it in the system
  // browser, where the owner is already signed in.
  const openInBrowser = (): void => {
    if (src === null) return;
    // Same pattern the Chatwoot button uses — Tauri routes an external http(s)
    // target to the OS browser, where the owner's Google session lives.
    try {
      window.open(src, '_blank', 'noopener');
    } catch {
      /* nothing else we can do */
    }
  };

  return (
    <section
      aria-label="Google Kalender"
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
    >
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <DiamondRule label="Google Kalender" />
        <p
          style={{
            margin: '-8px 0 0',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.85rem',
            textAlign: 'center',
          }}
        >
          {src === null ? 'Noch nicht verbunden' : 'Wochenansicht · Termine des Geschäfts'}
        </p>
        {src !== null && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-3)',
              marginTop: 'var(--space-2)',
            }}
          >
            <button
              type="button"
              onClick={openInBrowser}
              title="Kalender im Browser öffnen"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                minHeight: 36,
                padding: '6px 14px',
                fontSize: '0.8rem',
                fontWeight: 600,
                color: 'var(--w14-ink)',
                background: 'var(--w14-parchment-2)',
                border: '1px solid var(--w14-gold)',
                borderRadius: 'var(--w14-radius-button)',
                cursor: 'pointer',
              }}
            >
              Im Browser öffnen ↗
            </button>
            <span style={{ color: 'var(--w14-ink-faded)', fontSize: '0.74rem' }}>
              Privater Kalender oder leer? Im Browser öffnen — dort bist du angemeldet.
            </span>
          </div>
        )}
      </div>

      {src === null ? (
        <EmptyExplainer />
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: full ? 0 : 260,
            border: '1px solid var(--w14-rule)',
            borderRadius: 'var(--w14-radius-card)',
            overflow: 'hidden',
            background: 'var(--w14-parchment-2)',
            boxShadow: 'var(--w14-shadow-card)',
          }}
        >
          {/* RAW embed, exactly as configured — the owner wires the Google API later. */}
          <iframe
            title="Google Kalender"
            src={src}
            style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      )}
    </section>
  );
}

/** Calm 3-step explainer shown until an embed URL is configured. */
function EmptyExplainer(): JSX.Element {
  const steps: ReadonlyArray<{ title: string; body: string }> = [
    {
      title: 'Google Kalender öffnen',
      body: 'Im Browser calendar.google.com öffnen und unter „Einstellungen“ den gewünschten Kalender auswählen.',
    },
    {
      title: 'Embed-URL kopieren',
      body: 'Kalender in Google auf „öffentlich“ stellen oder die private Embed-URL einfügen — beides steht im Abschnitt „Kalender integrieren“.',
    },
    {
      title: 'Im POS hinterlegen',
      body: 'Die URL unter Einstellungen → Social & Nachrichten → „Google Kalender (Embed-URL)“ einfügen. Der Kalender erscheint dann hier automatisch.',
    },
  ];

  return (
    <ParchmentCard padding="md">
      <p
        style={{
          margin: '0 0 var(--space-4)',
          color: 'var(--w14-ink-aged)',
          fontFamily: 'var(--w14-font-display)',
          fontSize: '0.95rem',
        }}
      >
        Hier kann der Google Kalender des Geschäfts eingebettet werden — in drei Schritten:
      </p>
      <ol
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'grid',
          gap: 'var(--space-3)',
        }}
      >
        {steps.map((step, i) => (
          <li key={step.title} style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <span
              aria-hidden="true"
              style={{
                flex: '0 0 auto',
                width: 24,
                height: 24,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                border: '1px solid var(--w14-rule)',
                color: 'var(--w14-gold)',
                fontFamily: 'var(--w14-font-display)',
                fontSize: '0.8rem',
              }}
            >
              {i + 1}
            </span>
            <span style={{ display: 'grid', gap: 2 }}>
              <span style={{ color: 'var(--w14-ink)', fontSize: '0.88rem', fontWeight: 600 }}>
                {step.title}
              </span>
              <span style={{ color: 'var(--w14-ink-faded)', fontSize: '0.82rem' }}>
                {step.body}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </ParchmentCard>
  );
}
