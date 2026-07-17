/**
 * DokumentePanel — the Dokumente surface. Lists stored documents (Ausweise,
 * Ankaufbelege, Rechnungen, …) with a category filter. Read-only oversight:
 * the encrypted files themselves are served only through the gated per-document
 * route, never bulk-downloaded here. Reads `documentsApi.list`.
 */

import { type CSSProperties, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import {
  DOCUMENT_CATEGORY_LABELS,
  type DocumentCategory,
  documentsApi,
} from '@warehouse14/api-client';
import { DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../api-context.js';
import { StatusDot } from '../components/StatusDot.js';

const CATEGORIES: DocumentCategory[] = [
  'AUSWEIS',
  'ANKAUFBELEG',
  'RECHNUNG',
  'EXPERTISE',
  'ZERTIFIKAT',
  'VERSANDBELEG',
];

const captionStyle: CSSProperties = {
  margin: 0,
  color: 'var(--w14-ink-faded)',
  fontSize: '0.9rem',
  lineHeight: 1.5,
};
const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontSize: '0.72rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
  borderBottom: '1px solid var(--w14-ink-faded)',
  whiteSpace: 'nowrap',
};
const tdStyle: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--w14-parchment-3)',
  verticalAlign: 'middle',
};
const inputStyle: CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--w14-ink-faded)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink)',
  fontFamily: 'var(--w14-font-display)',
  fontSize: '0.95rem',
};

/** bigint-as-string bytes → readable de-DE size. */
function formatSize(bytes: string): string {
  const n = Number.parseInt(bytes, 10);
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

export function DokumentePanel(): JSX.Element {
  const { baseUrl, client } = useApiClient();
  const [category, setCategory] = useState<DocumentCategory | 'ALLE'>('ALLE');

  const query = useQuery({
    queryKey: ['documents', baseUrl, category],
    queryFn: () =>
      documentsApi.list(client, {
        limit: 100,
        ...(category === 'ALLE' ? {} : { category }),
      }),
    staleTime: 30_000,
  });

  const items = query.data?.items ?? [];

  return (
    <>
      <DiamondRule tone="gold" label="Dokumente" />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginTop: 8,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <p style={{ ...captionStyle, maxWidth: 560 }}>
          Alle hinterlegten Dokumente im Überblick. Die verschlüsselten Dateien selbst werden nur
          über den geschützten Einzelabruf geöffnet, nicht hier.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>Kategorie</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as DocumentCategory | 'ALLE')}
            style={inputStyle}
          >
            <option value="ALLE">Alle</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {DOCUMENT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {query.isLoading ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={captionStyle}>Lädt Dokumente …</p>
        </ParchmentCard>
      ) : items.length === 0 ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusDot tone="info" size={11} />
            <p style={captionStyle}>Keine Dokumente in dieser Kategorie.</p>
          </div>
        </ParchmentCard>
      ) : (
        <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead>
              <tr>
                <th style={thStyle}>Kategorie</th>
                <th style={thStyle}>Datei</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Größe</th>
                <th style={thStyle}>Datum</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((doc) => (
                <tr key={doc.id}>
                  <td style={{ ...tdStyle, fontFamily: 'var(--w14-font-display)' }}>
                    {DOCUMENT_CATEGORY_LABELS[doc.category]}
                  </td>
                  <td style={{ ...tdStyle, wordBreak: 'break-all' }}>{doc.fileName}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {formatSize(doc.sizeBytes)}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: 'var(--w14-ink-faded)' }}>
                    {formatDay(doc.createdAt)}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <StatusDot tone={doc.archivedAt ? 'info' : 'ok'} size={9} />
                      <span style={{ fontSize: '0.85rem' }}>
                        {doc.archivedAt ? 'Archiviert' : 'Aktiv'}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ParchmentCard>
      )}
    </>
  );
}
