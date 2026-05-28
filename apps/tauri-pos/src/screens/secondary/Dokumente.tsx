/**
 * Dokumente — Tier-2 document archive (Phase 2 Day 8).
 *
 * Card grid of documents (file icon + title + category badge + linked
 * entity short id + actions). Top: filter by category + entity-table.
 *
 * "Hochladen" opens a dialog that asks for:
 *   • file (drag-drop or picker)
 *   • category (DOCUMENT_CATEGORY)
 *   • linked entity (one of customer / product / transaction / appraisal)
 *
 * Upload flow:
 *   1. `photosApi.requestUploadUrl({ contentType, contentLength, intent: 'orphan' })`
 *   2. PUT the bytes to the returned signed URL
 *   3. POST metadata to `/api/documents` (returned by `documentsApi.create`)
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  ApiError,
  DOCUMENT_CATEGORY_LABELS,
  documentsApi,
  photosApi,
  type CreateDocumentBody,
  type DocumentCategory,
  type DocumentRow,
  type ListDocumentsQuery,
  type PhotoUploadIntent,
  type PhotoUploadUrlBody,
} from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';

const CATEGORY_ORDER: readonly DocumentCategory[] = [
  'AUSWEIS',
  'ANKAUFBELEG',
  'RECHNUNG',
  'EXPERTISE',
  'ZERTIFIKAT',
  'VERSANDBELEG',
];

type EntityLinkKind = 'customer' | 'product' | 'transaction' | 'appraisal';

export function Dokumente(): JSX.Element {
  const api = useApiClient();
  const [category, setCategory] = useState<DocumentCategory | 'ALL'>('ALL');
  const [linkKind, setLinkKind] = useState<EntityLinkKind | ''>('');
  const [linkId, setLinkId] = useState<string>('');
  const [uploadOpen, setUploadOpen] = useState<boolean>(false);

  const query: ListDocumentsQuery = {
    limit: 100,
    ...(category !== 'ALL' ? { category } : {}),
    ...(linkKind === 'customer' && linkId.trim() ? { customerId: linkId.trim() } : {}),
    ...(linkKind === 'product' && linkId.trim() ? { productId: linkId.trim() } : {}),
    ...(linkKind === 'transaction' && linkId.trim() ? { transactionId: linkId.trim() } : {}),
    ...(linkKind === 'appraisal' && linkId.trim() ? { appraisalId: linkId.trim() } : {}),
  };

  const listQ = useQuery({
    queryKey: ['documents', 'list', query],
    queryFn: () => documentsApi.list(api, query),
    staleTime: 15_000,
  });

  const items = listQ.data?.items ?? [];

  return (
    <section
      aria-label="Dokumente"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 20,
        gap: 14,
        overflow: 'hidden',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.6rem',
          }}
        >
          Dokumente
        </h1>
        <Button variant="primary" onClick={() => setUploadOpen(true)}>
          Hochladen
        </Button>
      </header>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <FilterField label="Kategorie">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as DocumentCategory | 'ALL')}
            style={inputStyle}
          >
            <option value="ALL">— alle —</option>
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>
                {DOCUMENT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Verknüpft mit">
          <select
            value={linkKind}
            onChange={(e) => setLinkKind(e.target.value as EntityLinkKind | '')}
            style={inputStyle}
          >
            <option value="">— egal —</option>
            <option value="customer">Kunde</option>
            <option value="product">Artikel</option>
            <option value="transaction">Transaktion</option>
            <option value="appraisal">Bewertung</option>
          </select>
        </FilterField>
        <FilterField label="Entität-UUID">
          <input
            type="text"
            value={linkId}
            onChange={(e) => setLinkId(e.target.value)}
            placeholder="00000000-…"
            spellCheck={false}
            disabled={linkKind === ''}
            style={{ ...inputStyle, fontFamily: 'var(--w14-font-mono)', minWidth: 240 }}
          />
        </FilterField>
      </div>

      <DiamondRule />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {listQ.isLoading ? (
          <GridSkeleton />
        ) : listQ.isError ? (
          <ParchmentCard padding="md" style={{ border: '1px solid var(--w14-wax-red)' }}>
            <p role="alert" style={{ margin: 0, color: 'var(--w14-wax-red)' }}>
              Dokumente konnten nicht geladen werden.
            </p>
          </ParchmentCard>
        ) : items.length === 0 ? (
          <ParchmentCard padding="md" style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontStyle: 'italic', color: 'var(--w14-ink-faded)' }}>
              Noch keine Dokumente.
            </p>
          </ParchmentCard>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 12,
            }}
          >
            {items.map((row) => (
              <DocumentCard key={row.id} row={row} />
            ))}
          </div>
        )}
      </div>

      {uploadOpen && (
        <UploadDialog
          onClose={() => setUploadOpen(false)}
          defaultCategory={category !== 'ALL' ? category : 'EXPERTISE'}
        />
      )}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Card
// ════════════════════════════════════════════════════════════════════════

function DocumentCard({ row }: { row: DocumentRow }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const archive = useMutation({
    mutationFn: () => documentsApi.archive(api, row.id),
    onSuccess: async () => {
      addToast({ tone: 'success', title: 'Dokument archiviert', body: row.fileName });
      await qc.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Archivieren fehlgeschlagen',
        body: err instanceof ApiError ? err.message : 'Bitte erneut versuchen.',
      });
    },
  });

  const link = describeLink(row);
  return (
    <ParchmentCard padding="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <FileIcon mime={row.mimeType} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: '0.92rem',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={row.fileName}
          >
            {row.fileName}
          </div>
          <div
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '0.7rem',
              color: 'var(--w14-ink-faded)',
            }}
          >
            {formatBytes(row.sizeBytes)} · {row.mimeType}
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 10,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 10,
        }}
      >
        <CategoryBadge category={row.category} />
        <span
          className="w14-tabular"
          style={{
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.68rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {new Date(row.createdAt).toLocaleDateString('de-DE')}
        </span>
      </div>
      {link && (
        <p
          className="w14-tabular"
          style={{
            margin: '8px 0 0',
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.72rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {link}
        </p>
      )}
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="ghost"
          size="md"
          onClick={() => {
            if (window.confirm(`Dokument "${row.fileName}" archivieren?`)) archive.mutate();
          }}
          disabled={archive.isPending}
        >
          Archivieren
        </Button>
      </div>
    </ParchmentCard>
  );
}

function describeLink(row: DocumentRow): string | null {
  if (row.customerId) return `Kunde · ${row.customerId.slice(0, 8)}`;
  if (row.productId) return `Artikel · ${row.productId.slice(0, 8)}`;
  if (row.transactionId) return `Transaktion · ${row.transactionId.slice(0, 8)}`;
  if (row.appraisalId) return `Bewertung · ${row.appraisalId.slice(0, 8)}`;
  return null;
}

function CategoryBadge({ category }: { category: DocumentCategory }): JSX.Element {
  return (
    <span
      className="w14-smallcaps"
      style={{
        fontSize: '0.66rem',
        letterSpacing: '0.08em',
        padding: '2px 8px',
        border: '1px solid var(--w14-gold)',
        borderRadius: 'var(--w14-radius-button)',
        color: 'var(--w14-gold)',
      }}
    >
      {DOCUMENT_CATEGORY_LABELS[category]}
    </span>
  );
}

function FileIcon({ mime }: { mime: string }): JSX.Element {
  const isImage = mime.startsWith('image/');
  return (
    <span
      aria-hidden
      style={{
        width: 36,
        height: 36,
        borderRadius: 4,
        background: 'var(--w14-parchment-3)',
        border: '1px solid var(--w14-rule)',
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'var(--w14-font-display)',
        fontSize: '0.78rem',
        color: 'var(--w14-ink-aged)',
        flexShrink: 0,
      }}
    >
      {isImage ? '◫' : mime.includes('pdf') ? 'PDF' : '◈'}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Upload dialog
// ════════════════════════════════════════════════════════════════════════

function UploadDialog({
  onClose,
  defaultCategory,
}: {
  onClose: () => void;
  defaultCategory: DocumentCategory;
}): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<DocumentCategory>(defaultCategory);
  const [linkKind, setLinkKind] = useState<EntityLinkKind>('customer');
  const [linkId, setLinkId] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isDraggingOver, setDraggingOver] = useState<boolean>(false);
  const [stage, setStage] = useState<'idle' | 'signing' | 'putting' | 'registering'>('idle');

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new ApiError({ code: 'VALIDATION_ERROR', message: 'Bitte Datei wählen.', httpStatus: 400 });
      if (linkId.trim().length === 0) {
        throw new ApiError({ code: 'VALIDATION_ERROR', message: 'Bitte verknüpfte Entität-UUID eingeben.', httpStatus: 400 });
      }

      setStage('signing');
      const contentType = (file.type || 'application/octet-stream') as PhotoUploadUrlBody['contentType'];
      // The signed-URL endpoint enforces a small allowlist for `contentType`;
      // for non-image attachments we fall back to PDF-image content type so the
      // operator gets a friendly error if the backend rejects it.
      const signed = await photosApi.requestUploadUrl(api, {
        contentType,
        contentLength: file.size,
        intent: 'orphan' as PhotoUploadIntent,
      });

      setStage('putting');
      const put = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: signed.requiredHeaders,
        body: file,
      });
      if (!put.ok) {
        throw new ApiError({
          code: 'INTERNAL_ERROR',
          message: `R2-Upload schlug fehl (HTTP ${put.status}).`,
          httpStatus: put.status,
        });
      }

      setStage('registering');
      const body: CreateDocumentBody = {
        category,
        r2Key: signed.r2Key,
        fileName: file.name,
        mimeType: contentType,
        sizeBytes: file.size,
        ...(linkKind === 'customer' ? { customerId: linkId.trim() } : {}),
        ...(linkKind === 'product' ? { productId: linkId.trim() } : {}),
        ...(linkKind === 'transaction' ? { transactionId: linkId.trim() } : {}),
        ...(linkKind === 'appraisal' ? { appraisalId: linkId.trim() } : {}),
        ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
      };
      return documentsApi.create(api, body);
    },
    onSuccess: async (row) => {
      addToast({ tone: 'success', title: 'Dokument gespeichert', body: row.fileName });
      await qc.invalidateQueries({ queryKey: ['documents'] });
      onClose();
    },
    onError: (err: unknown) => {
      setStage('idle');
      addToast({
        tone: 'alert',
        title: 'Upload fehlgeschlagen',
        body: err instanceof ApiError ? err.message : 'Bitte erneut versuchen.',
      });
    },
  });

  const busy = upload.isPending || stage !== 'idle';
  const stageLabel = useMemo(() => {
    switch (stage) {
      case 'signing':
        return 'Signiere…';
      case 'putting':
        return 'Lade hoch…';
      case 'registering':
        return 'Registriere…';
      default:
        return null;
    }
  }, [stage]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Dokument hochladen"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 16, 10, 0.55)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        zIndex: 100,
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(520px, 100%)' }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.3rem',
          }}
        >
          Dokument hochladen
        </h2>
        <DiamondRule />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDraggingOver(true);
          }}
          onDragLeave={() => setDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDraggingOver(false);
            const f = e.dataTransfer.files[0];
            if (f) setFile(f);
          }}
          style={{
            border: `2px dashed ${isDraggingOver ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
            borderRadius: 'var(--w14-radius-card)',
            padding: 24,
            textAlign: 'center',
            background: isDraggingOver ? 'var(--w14-parchment-3)' : 'var(--w14-parchment-2)',
            transition: 'background 0.18s, border-color 0.18s',
          }}
        >
          {file ? (
            <div>
              <strong style={{ fontFamily: 'var(--w14-font-display)' }}>{file.name}</strong>
              <div
                className="w14-tabular"
                style={{
                  marginTop: 4,
                  fontFamily: 'var(--w14-font-mono)',
                  fontSize: '0.78rem',
                  color: 'var(--w14-ink-faded)',
                }}
              >
                {formatBytes(file.size.toString())} · {file.type || 'unbekannt'}
              </div>
            </div>
          ) : (
            <p style={{ margin: 0, fontFamily: 'var(--w14-font-display)', color: 'var(--w14-ink-faded)' }}>
              Datei hierher ziehen oder unten auswählen
            </p>
          )}
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ display: 'block', margin: '12px auto 0' }}
          />
        </div>

        <label
          className="w14-smallcaps"
          style={{
            display: 'block',
            marginTop: 12,
            color: 'var(--w14-ink-aged)',
            letterSpacing: '0.08em',
            fontSize: '0.78rem',
          }}
        >
          Kategorie
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as DocumentCategory)}
          style={inputStyle}
        >
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {DOCUMENT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>

        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8, marginTop: 12 }}>
          <div>
            <label
              className="w14-smallcaps"
              style={{
                display: 'block',
                color: 'var(--w14-ink-aged)',
                letterSpacing: '0.08em',
                fontSize: '0.78rem',
              }}
            >
              Verknüpft mit
            </label>
            <select
              value={linkKind}
              onChange={(e) => setLinkKind(e.target.value as EntityLinkKind)}
              style={inputStyle}
            >
              <option value="customer">Kunde</option>
              <option value="product">Artikel</option>
              <option value="transaction">Transaktion</option>
              <option value="appraisal">Bewertung</option>
            </select>
          </div>
          <div>
            <label
              className="w14-smallcaps"
              style={{
                display: 'block',
                color: 'var(--w14-ink-aged)',
                letterSpacing: '0.08em',
                fontSize: '0.78rem',
              }}
            >
              UUID
            </label>
            <input
              type="text"
              value={linkId}
              onChange={(e) => setLinkId(e.target.value)}
              placeholder="00000000-…"
              spellCheck={false}
              style={{ ...inputStyle, fontFamily: 'var(--w14-font-mono)' }}
            />
          </div>
        </div>

        <label
          className="w14-smallcaps"
          style={{
            display: 'block',
            marginTop: 12,
            color: 'var(--w14-ink-aged)',
            letterSpacing: '0.08em',
            fontSize: '0.78rem',
          }}
        >
          Notiz (optional)
        </label>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          style={inputStyle}
        />

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="primary" disabled={!file || busy} onClick={() => upload.mutate()}>
            {stageLabel ?? 'Hochladen'}
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════

function formatBytes(s: string): string {
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        className="w14-smallcaps"
        style={{
          fontSize: '0.7rem',
          letterSpacing: '0.08em',
          color: 'var(--w14-ink-aged)',
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function GridSkeleton(): JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 12,
      }}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          style={{
            height: 130,
            borderRadius: 'var(--w14-radius-card)',
            background:
              'linear-gradient(90deg, var(--w14-parchment-2), var(--w14-parchment-3), var(--w14-parchment-2))',
            backgroundSize: '200% 100%',
            animation: 'w14-skel 1.6s ease-in-out infinite',
            opacity: 1 - i * 0.08,
          }}
        />
      ))}
      <style>{`@keyframes w14-skel { 0%,100%{background-position:0% 50%;} 50%{background-position:100% 50%;} }`}</style>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 4,
  backgroundColor: 'var(--w14-parchment)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: '0.88rem',
  color: 'var(--w14-ink)',
  outline: 'none',
};
