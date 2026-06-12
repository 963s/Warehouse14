/**
 * Einstellungen — the operator settings HUB. A left rail of sections, each a
 * focused panel, instead of scattered config. Sections:
 *   Geräte & Kasse · KI & Automatisierung · Server & Verbindung ·
 *   Social & Nachrichten · Kundenservice (Chatwoot) · Beleg & Shop.
 *
 * Secrets that must stay on the server (Anthropic key, WhatsApp/Meta tokens,
 * R2…) are shown as STATUS, never stored on the terminal. Operator-tunable,
 * terminal-local integration config (Chatwoot widget, social handles, AI
 * feature toggles) lives in the integration-settings store.
 */

import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';

import { Button, DiamondRule } from '@warehouse14/ui-kit';

import {
  IconBox,
  IconChat,
  IconPower,
  IconReceipt,
  IconServer,
  IconSparkles,
  IconUsers,
} from '../../app/chrome/Icons.js';
import { useApiClient } from '../../lib/api-context.js';
import { openChatwoot } from '../../lib/chatwoot.js';
import { requestSignOut } from '../../lib/session-actions.js';
import { useIntegrationSettings } from '../../state/integration-settings-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { Belegdesigner } from './Belegdesigner.js';
import { GeraeteKoppeln } from './GeraeteKoppeln.js';
import { GeraeteManager } from './GeraeteManager.js';
import { IntegrationenSection } from './IntegrationenSection.js';

type SectionId =
  | 'hardware'
  | 'pairing'
  | 'ai'
  | 'integrationen'
  | 'server'
  | 'social'
  | 'chatwoot'
  | 'beleg';

const SECTIONS: Array<{ id: SectionId; label: string; icon: ReactNode; desc: string }> = [
  {
    id: 'hardware',
    label: 'Geräte & Kasse',
    icon: <IconBox size={18} />,
    desc: 'Drucker · Terminal · TSE',
  },
  {
    id: 'pairing',
    label: 'Geräte koppeln',
    icon: <IconUsers size={18} />,
    desc: 'iPad · Tablet · Mobil',
  },
  {
    id: 'ai',
    label: 'KI & Automatisierung',
    icon: <IconSparkles size={18} />,
    desc: 'Bild-Analyse · Preis-KI',
  },
  {
    id: 'integrationen',
    label: 'Integrationen',
    icon: <IconServer size={18} />,
    desc: 'API-Schlüssel · Dienste',
  },
  {
    id: 'server',
    label: 'Server & Verbindung',
    icon: <IconServer size={18} />,
    desc: 'API · Synchronisation',
  },
  {
    id: 'social',
    label: 'Social & Nachrichten',
    icon: <IconUsers size={18} />,
    desc: 'WhatsApp · Instagram',
  },
  {
    id: 'chatwoot',
    label: 'Kundenservice',
    icon: <IconChat size={18} />,
    desc: 'Chatwoot Live-Chat',
  },
  { id: 'beleg', label: 'Beleg & Shop', icon: <IconReceipt size={18} />, desc: 'Geschäftsdaten' },
];

export function Einstellungen(): JSX.Element {
  const [section, setSection] = useState<SectionId>('hardware');

  return (
    <section
      aria-label="Einstellungen"
      style={{ display: 'flex', height: '100%', minHeight: 0, background: 'var(--w14-parchment)' }}
    >
      <nav
        aria-label="Bereiche"
        style={{
          width: 250,
          flex: '0 0 auto',
          borderRight: '1px solid var(--w14-rule)',
          background: 'var(--w14-parchment-2)',
          padding: 14,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <h1
          style={{
            margin: '4px 8px 14px',
            fontSize: '1.15rem',
            fontWeight: 600,
            color: 'var(--w14-ink)',
          }}
        >
          Einstellungen
        </h1>
        <div style={{ display: 'grid', gap: 4 }}>
          {SECTIONS.map((s) => {
            const active = s.id === section;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  border: '1px solid transparent',
                  borderRadius: 'var(--w14-radius-button)',
                  cursor: 'pointer',
                  background: active ? 'var(--w14-parchment-3)' : 'transparent',
                  color: active ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
                }}
              >
                <span style={{ color: active ? 'var(--w14-gold)' : 'var(--w14-ink-faded)' }}>
                  {s.icon}
                </span>
                <span style={{ display: 'grid' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: active ? 600 : 500 }}>
                    {s.label}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--w14-ink-faded)' }}>
                    {s.desc}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <SignOutFooter />
      </nav>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {section === 'hardware' && <GeraeteManager />}
        {section === 'pairing' && <GeraeteKoppeln />}
        {section === 'ai' && <AiSection />}
        {section === 'integrationen' && <IntegrationenSection />}
        {section === 'server' && <ServerSection />}
        {section === 'social' && <SocialSection />}
        {section === 'chatwoot' && <ChatwootSection />}
        {section === 'beleg' && <BelegSection />}
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Shared bits
// ════════════════════════════════════════════════════════════════════════

const pad: CSSProperties = { padding: 24, display: 'grid', gap: 18, maxWidth: 760 };
const card: CSSProperties = {
  background: 'var(--w14-parchment-2)',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-card)',
  padding: 20,
  display: 'grid',
  gap: 14,
  boxShadow: 'var(--w14-shadow-card)',
};
const labelStyle: CSSProperties = {
  fontSize: '0.72rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
};
const inputStyle: CSSProperties = {
  padding: '9px 11px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink)',
  fontSize: '0.95rem',
  width: '100%',
};

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }): JSX.Element {
  return (
    <div>
      <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 600, color: 'var(--w14-ink)' }}>
        {title}
      </h2>
      <p style={{ margin: '4px 0 0', color: 'var(--w14-ink-faded)', fontSize: '0.88rem' }}>
        {subtitle}
      </p>
      <DiamondRule style={{ margin: '14px 0 0' }} />
    </div>
  );
}

function StatusDot({ ok, label: text }: { ok: boolean; label: string }): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.82rem' }}>
      <span
        aria-hidden="true"
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: ok ? 'var(--w14-verdigris)' : 'var(--w14-ink-faded)',
        }}
      />
      {text}
    </span>
  );
}

function Field({
  title,
  value,
  onChange,
  placeholder,
  mono,
  readOnly,
  type,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  readOnly?: boolean;
  type?: 'text' | 'password';
}): JSX.Element {
  return (
    <label style={{ display: 'grid', gap: 5 }}>
      <span style={labelStyle}>{title}</span>
      <input
        type={type ?? 'text'}
        style={{
          ...inputStyle,
          fontFamily: mono ? 'var(--w14-font-mono)' : 'var(--w14-font-body)',
        }}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function Toggle({
  on,
  onChange,
  title,
  desc,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  title: string;
  desc: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        padding: '12px 14px',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-button)',
        background: 'var(--w14-parchment)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ display: 'grid', gap: 2 }}>
        <span style={{ fontSize: '0.95rem', color: 'var(--w14-ink)' }}>{title}</span>
        <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>{desc}</span>
      </span>
      <span
        aria-hidden="true"
        style={{
          width: 42,
          height: 24,
          flex: '0 0 auto',
          borderRadius: 999,
          background: on ? 'var(--w14-gold)' : 'var(--w14-rule)',
          position: 'relative',
          transition: 'background 160ms ease',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: on ? 21 : 3,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 160ms ease',
            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
          }}
        />
      </span>
    </button>
  );
}

/**
 * SignOutFooter — pinned to the bottom of the section rail. The header lock was
 * removed, so this is the operator's way out. A calm confirm guards the click;
 * `requestSignOut` runs the AppShell-owned sign-out (store resets + PIN logout).
 */
function SignOutFooter(): JSX.Element {
  const onAbmelden = (): void => {
    if (window.confirm('Wirklich abmelden?')) requestSignOut();
  };
  return (
    <div style={{ marginTop: 'auto', paddingTop: 14 }}>
      <button
        type="button"
        onClick={onAbmelden}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 9,
          width: '100%',
          minHeight: 44,
          padding: '10px 12px',
          border: '1px solid var(--w14-rule)',
          borderRadius: 'var(--w14-radius-button)',
          cursor: 'pointer',
          background: 'var(--w14-parchment)',
          color: 'var(--w14-ink)',
          fontSize: '0.9rem',
          fontWeight: 600,
        }}
      >
        <IconPower size={18} />
        Abmelden
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Sections
// ════════════════════════════════════════════════════════════════════════

function AiSection(): JSX.Element {
  const ai = useIntegrationSettings((s) => s.settings.ai);
  const setAi = useIntegrationSettings((s) => s.setAi);
  return (
    <div style={pad}>
      <SectionTitle
        title="KI & Automatisierung"
        subtitle="Bild-Analyse und Preisvorschläge per KI. Der Anthropic-Schlüssel liegt sicher auf dem Server."
      />
      <div style={card}>
        <StatusDot ok label="Anthropic-Schlüssel: serverseitig konfiguriert (.env)" />
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--w14-ink-faded)' }}>
          API-Schlüssel werden aus Sicherheitsgründen nur auf dem Server gesetzt, nicht am Terminal.
        </p>
      </div>
      <div style={card}>
        <Toggle
          on={ai.visionEnabled}
          onChange={(v) => setAi({ visionEnabled: v })}
          title="Bild-Analyse (Vision)"
          desc="Aus Produktfotos automatisch Merkmale erkennen."
        />
        <Toggle
          on={ai.priceEstimateEnabled}
          onChange={(v) => setAi({ priceEstimateEnabled: v })}
          title="Preisvorschlag (KI)"
          desc="Vorschlag für Verkaufspreis beim Anlegen eines Artikels."
        />
      </div>
    </div>
  );
}

function ServerSection(): JSX.Element {
  const api = useApiClient();
  const addToast = useToastStore((s) => s.addToast);
  const [checking, setChecking] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const baseUrl = (api as { baseUrl?: string }).baseUrl ?? 'https://api.warehouse14.de';

  const test = async (): Promise<void> => {
    setChecking(true);
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, { credentials: 'include' });
      const ok = res.ok;
      setReachable(ok);
      addToast({
        tone: ok ? 'success' : 'alert',
        title: ok ? 'Server erreichbar' : 'Server nicht erreichbar',
        body: baseUrl,
      });
    } catch {
      setReachable(false);
      addToast({ tone: 'alert', title: 'Server nicht erreichbar', body: baseUrl });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div style={pad}>
      <SectionTitle
        title="Server & Verbindung"
        subtitle="Der Backend-Server bündelt Daten, Edelmetallkurse und Hintergrunddienste."
      />
      <div style={card}>
        <Field title="API-Adresse" value={baseUrl} onChange={() => {}} mono readOnly />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Button variant="ghost" size="md" disabled={checking} onClick={() => void test()}>
            {checking ? 'Prüft…' : 'Verbindung testen'}
          </Button>
          {reachable !== null && (
            <StatusDot ok={reachable} label={reachable ? 'Verbunden' : 'Keine Verbindung'} />
          )}
        </div>
      </div>
    </div>
  );
}

function SocialSection(): JSX.Element {
  const social = useIntegrationSettings((s) => s.settings.social);
  const setSocial = useIntegrationSettings((s) => s.setSocial);
  return (
    <div style={pad}>
      <SectionTitle
        title="Social & Nachrichten"
        subtitle="Öffentliche Profile des Geschäfts. Zugangs-Tokens (WhatsApp/Meta) liegen auf dem Server."
      />
      <div style={card}>
        <Field
          title="WhatsApp-Nummer"
          value={social.whatsappNumber}
          onChange={(v) => setSocial({ whatsappNumber: v })}
          placeholder="+49 …"
          mono
        />
        <Field
          title="Instagram"
          value={social.instagramHandle}
          onChange={(v) => setSocial({ instagramHandle: v })}
          placeholder="@warehouse14"
        />
        <Field
          title="Facebook-Seite"
          value={social.facebookPage}
          onChange={(v) => setSocial({ facebookPage: v })}
          placeholder="facebook.com/…"
        />
      </div>
      <GoogleKalenderStatusCard />
      <div style={card}>
        <StatusDot ok={false} label="Meta/WhatsApp-Token: serverseitig (in .env setzen)" />
      </div>
    </div>
  );
}

/**
 * Google-Kalender-Status — der Kalender ist serverseitig über ein
 * Service-Konto angebunden, daher KEINE Eingabefelder mehr (früher
 * API-Schlüssel + Kalender-ID). Wir zeigen nur, ob die Anbindung steht,
 * abgefragt über `GET /api/calendar/status`.
 */
function GoogleKalenderStatusCard(): JSX.Element {
  const api = useApiClient();
  const [state, setState] = useState<'checking' | 'configured' | 'not-configured' | 'error'>(
    'checking',
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.request<{ configured: boolean }>('GET', '/api/calendar/status');
        if (!cancelled) setState(res?.configured === true ? 'configured' : 'not-configured');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const label =
    state === 'configured'
      ? 'Geschäftskalender verbunden ✓'
      : state === 'checking'
        ? 'Status wird geprüft…'
        : state === 'error'
          ? 'Kalender vorübergehend nicht erreichbar'
          : 'Nicht eingerichtet';

  return (
    <div style={card}>
      <StatusDot ok={state === 'configured'} label={label} />
      <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
        Der Kalender ist serverseitig angebunden (Service-Account). Die Termine erscheinen in der
        Werkstatt und unter „Kalender“ (Spotlight) und lassen sich dort direkt anlegen, bearbeiten
        und löschen.
      </p>
    </div>
  );
}

function ChatwootSection(): JSX.Element {
  const cw = useIntegrationSettings((s) => s.settings.chatwoot);
  const setChatwoot = useIntegrationSettings((s) => s.setChatwoot);
  const ready = cw.baseUrl.trim().length > 0 && cw.websiteToken.trim().length > 0;
  return (
    <div style={pad}>
      <SectionTitle
        title="Kundenservice (Chatwoot)"
        subtitle="Live-Chat + alle Kanäle (WhatsApp, Instagram, Web) in einem Posteingang. Ein Mensch übernimmt aus dem Chatwoot-Dashboard."
      />
      <div style={card}>
        <Toggle
          on={cw.enabled}
          onChange={(v) => setChatwoot({ enabled: v })}
          title="Live-Chat-Widget aktiv"
          desc="Lädt das Chatwoot-Widget in der App, wenn konfiguriert."
        />
        <Field
          title="Chatwoot-Adresse"
          value={cw.baseUrl}
          onChange={(v) => setChatwoot({ baseUrl: v })}
          placeholder="https://chat.warehouse14.de"
          mono
        />
        <Field
          title="Website-Token (Inbox)"
          value={cw.websiteToken}
          onChange={(v) => setChatwoot({ websiteToken: v })}
          placeholder="aus Chatwoot → Postfächer → Einstellungen"
          mono
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <StatusDot
            ok={cw.enabled && ready}
            label={
              cw.enabled && ready
                ? 'Widget aktiv'
                : ready
                  ? 'Konfiguriert (inaktiv)'
                  : 'Nicht konfiguriert'
            }
          />
          <Button variant="ghost" size="md" disabled={!ready} onClick={() => openChatwoot()}>
            Chat öffnen
          </Button>
          <Button
            variant="ghost"
            size="md"
            disabled={cw.baseUrl.trim().length === 0}
            onClick={() => window.open(cw.baseUrl.trim(), '_blank')}
          >
            Dashboard öffnen
          </Button>
        </div>
      </div>
    </div>
  );
}

function BelegSection(): JSX.Element {
  return (
    <div style={{ padding: 24 }}>
      <Belegdesigner />
    </div>
  );
}
