/**
 * IntegrationenSection — the Einstellungen → Integrationen panel.
 *
 * Lists the four integrations from GET /api/integrations. Each is a card with
 * the server-provided label, a status dot (verbunden vs. nicht konfiguriert),
 * a MASKED key input + „Speichern" (PUT), and a „Verbindung testen" button
 * (POST) whose result renders inline (green check „Verbunden" / red cross + the
 * German message). Integrations that need extra ids (WhatsApp phone-number-id,
 * Chatwoot base-url + account-id) render those fields too.
 *
 * SECURITY: the server never returns a key — only `configured`, the `source`
 * (env | settings | none) and the last test outcome. The key input is therefore
 * write-only: it starts empty and is cleared after a save. The key never lives
 * in this component's persisted state.
 */

import { type CSSProperties, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@warehouse14/api-client';
import { Button, DiamondRule } from '@warehouse14/ui-kit';

import { IconCheck } from '../../app/chrome/Icons.js';
import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@warehouse14/i18n-de';

type IntegrationSource = 'env' | 'settings' | 'none';

interface IntegrationItem {
  id: string;
  label: string;
  configured: boolean;
  source: IntegrationSource;
  lastTestOk: boolean | null;
  lastTestedAt: string | null;
}
interface PutResponse {
  configured: boolean;
}
interface TestResponse {
  ok: boolean;
  status?: number;
  message: string;
}

/** A related (non-key) field an integration also stores, e.g. an account id. */
interface RelatedFieldUi {
  bodyKey: 'phoneNumberId' | 'baseUrl' | 'accountId';
  label: string;
  placeholder: string;
  mono?: boolean;
}

/** Per-integration UI hints: the key placeholder + a short German description. */
const UI_HINTS: Record<
  string,
  { keyLabel: string; keyPlaceholder: string; description: string; related: RelatedFieldUi[] }
> = {
  ai: {
    keyLabel: 'API-Schlüssel',
    keyPlaceholder: 'sk-ant-…',
    description: 'Bild-Analyse und Preisvorschläge per Claude.',
    related: [],
  },
  whatsapp: {
    keyLabel: 'Zugangstoken',
    keyPlaceholder: 'Meta-Zugangstoken',
    description: 'Nachrichten und Terminbestätigungen über WhatsApp.',
    related: [
      {
        bodyKey: 'phoneNumberId',
        label: 'Telefonnummer-ID',
        placeholder: 'z. B. 1234567890',
        mono: true,
      },
    ],
  },
  social: {
    keyLabel: 'Seiten-Zugangstoken',
    keyPlaceholder: 'Meta-Page-Token',
    description: 'Beiträge und Antworten für Instagram & Facebook.',
    related: [],
  },
  chatwoot: {
    keyLabel: 'Bot-Token',
    keyPlaceholder: 'Chatwoot-Bot-Token',
    description: 'Live-Chat und Kundenservice-Postfach.',
    related: [
      {
        bodyKey: 'baseUrl',
        label: 'Chatwoot-Adresse',
        placeholder: 'https://chat.warehouse14.de',
        mono: true,
      },
      { bodyKey: 'accountId', label: 'Konto-ID', placeholder: 'z. B. 1', mono: true },
    ],
  },
};

const integrationsQueryKey = ['integrations'] as const;

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
  padding: '11px 12px',
  minHeight: 44,
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
          flex: '0 0 auto',
          background: ok ? 'var(--w14-verdigris)' : 'var(--w14-ink-faded)',
        }}
      />
      {text}
    </span>
  );
}

/** A crisp red cross — the inverse of IconCheck — for a failed connection test. */
function CrossMark(): JSX.Element {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <title>Fehler</title>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function IntegrationCard({ item }: { item: IntegrationItem }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const hints = UI_HINTS[item.id] ?? {
    keyLabel: 'API-Schlüssel',
    keyPlaceholder: 'Schlüssel',
    description: '',
    related: [] as RelatedFieldUi[],
  };

  const [draftKey, setDraftKey] = useState('');
  const [related, setRelated] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<TestResponse | null>(null);

  const save = useMutation({
    mutationFn: async (): Promise<PutResponse> => {
      const body: Record<string, string> = { apiKey: draftKey.trim() };
      for (const field of hints.related) {
        const v = (related[field.bodyKey] ?? '').trim();
        if (v.length > 0) body[field.bodyKey] = v;
      }
      return api.request<PutResponse>(
        'PUT',
        `/api/integrations/${encodeURIComponent(item.id)}`,
        body,
      );
    },
    onSuccess: async () => {
      setDraftKey('');
      setTestResult(null);
      addToast({
        tone: 'success',
        title: 'Gespeichert',
        body: `${item.label}: Schlüssel hinterlegt.`,
      });
      await qc.invalidateQueries({ queryKey: integrationsQueryKey });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Speichern fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });

  const test = useMutation({
    mutationFn: async (): Promise<TestResponse> => {
      return api.request<TestResponse>(
        'POST',
        `/api/integrations/${encodeURIComponent(item.id)}/test`,
      );
    },
    onSuccess: async (res) => {
      setTestResult(res);
      await qc.invalidateQueries({ queryKey: integrationsQueryKey });
    },
    onError: (err: unknown) => {
      setTestResult({
        ok: false,
        message:
          err instanceof ApiError ? describeError(err) : 'Test fehlgeschlagen. Bitte erneut versuchen.',
      });
    },
  });

  const canSave = draftKey.trim().length > 0 && !save.isPending;
  const statusLabel = item.configured ? 'Verbunden' : 'Nicht konfiguriert';

  return (
    <div style={card}>
      <div
        style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}
      >
        <div style={{ display: 'grid', gap: 3 }}>
          <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--w14-ink)' }}>
            {item.label}
          </span>
          {hints.description && (
            <span style={{ fontSize: '0.8rem', color: 'var(--w14-ink-faded)' }}>
              {hints.description}
            </span>
          )}
          {item.source === 'env' && (
            <span style={{ fontSize: '0.74rem', color: 'var(--w14-ink-faded)' }}>
              Aktiver Schlüssel aus der Server-Konfiguration (.env).
            </span>
          )}
        </div>
        <StatusDot ok={item.configured} label={statusLabel} />
      </div>

      <label style={{ display: 'grid', gap: 5 }}>
        <span style={labelStyle}>{hints.keyLabel}</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          style={{ ...inputStyle, fontFamily: 'var(--w14-font-mono)' }}
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
          placeholder={
            item.configured
              ? 'Hinterlegt — zum Ersetzen neuen Schlüssel eingeben'
              : hints.keyPlaceholder
          }
        />
      </label>

      {hints.related.map((field) => (
        <label key={field.bodyKey} style={{ display: 'grid', gap: 5 }}>
          <span style={labelStyle}>{field.label}</span>
          <input
            autoComplete="off"
            spellCheck={false}
            style={{
              ...inputStyle,
              fontFamily: field.mono ? 'var(--w14-font-mono)' : 'var(--w14-font-body)',
            }}
            value={related[field.bodyKey] ?? ''}
            onChange={(e) =>
              setRelated((prev) => ({ ...prev, [field.bodyKey]: e.target.value }))
            }
            placeholder={field.placeholder}
          />
        </label>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Button variant="primary" size="lg" disabled={!canSave} onClick={() => save.mutate()}>
          {save.isPending ? 'Speichert…' : 'Speichern'}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          disabled={!item.configured || test.isPending}
          onClick={() => test.mutate()}
        >
          {test.isPending ? 'Prüft…' : 'Verbindung testen'}
        </Button>

        {testResult && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.82rem',
              color: testResult.ok ? 'var(--w14-verdigris)' : 'var(--w14-danger)',
            }}
          >
            {testResult.ok ? <IconCheck size={18} /> : <CrossMark />}
            {testResult.ok ? 'Verbunden' : testResult.message}
          </span>
        )}
      </div>
    </div>
  );
}

export function IntegrationenSection(): JSX.Element {
  const api = useApiClient();
  const query = useQuery({
    queryKey: integrationsQueryKey,
    queryFn: () => api.request<IntegrationItem[]>('GET', '/api/integrations'),
  });

  return (
    <div style={pad}>
      <SectionTitle
        title="Integrationen"
        subtitle="Externe Dienste verbinden. API-Schlüssel werden ausschließlich serverseitig gespeichert und nie an das Terminal zurückgegeben."
      />

      {query.isPending && (
        <div style={{ ...card, color: 'var(--w14-ink-faded)', fontSize: '0.9rem' }}>Lädt…</div>
      )}

      {query.isError && (
        <div style={{ ...card, color: 'var(--w14-danger)', fontSize: '0.9rem' }}>
          Integrationen konnten nicht geladen werden.
        </div>
      )}

      {query.data?.map((item) => (
        <IntegrationCard key={item.id} item={item} />
      ))}
    </div>
  );
}
