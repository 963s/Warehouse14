/**
 * Belegtexte — Tier-2 Belegtext-Editor (Phase 2 Day 8).
 *
 * Three-column layout:
 *   1. Slot selector — list of all BELEGTEXT_KIND values
 *   2. Version timeline — every version of the selected slot, newest first;
 *      each card shows valid_from + first-line preview
 *   3. Editor pane — read-only diff vs the current text + "Neue Version
 *      veröffentlichen" button which posts a fresh row (close-out + insert
 *      is atomic on the backend).
 *
 * On publish the previous CURRENT row's valid_to is stamped server-side
 * and a new CURRENT row is inserted in one TX.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  BELEGTEXT_KIND_LABELS,
  type BelegtextKind,
  type BelegtextRow,
  belegtextApi,
} from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';

const KIND_ORDER: readonly BelegtextKind[] = [
  'MARGIN_25A',
  'STANDARD_19',
  'REDUCED_7',
  'INVESTMENT_GOLD_25C',
  'KLEINUNTERNEHMER_19',
  'ANKAUFBELEG_DECLARATION',
  'GENERIC_HEADER',
  'GENERIC_FOOTER',
];

export function Belegtexte(): JSX.Element {
  const [selectedKind, setSelectedKind] = useState<BelegtextKind>('MARGIN_25A');

  return (
    <section
      aria-label="Belegtext-Editor"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 1fr) minmax(260px, 1.4fr) minmax(0, 2fr)',
        height: '100%',
        minHeight: 0,
        flex: 1,
      }}
    >
      <KindList selected={selectedKind} onSelect={setSelectedKind} />
      <VersionTimeline kind={selectedKind} />
      <EditorPane kind={selectedKind} />
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 1. Slot selector
// ════════════════════════════════════════════════════════════════════════

function KindList({
  selected,
  onSelect,
}: {
  selected: BelegtextKind;
  onSelect: (k: BelegtextKind) => void;
}): JSX.Element {
  return (
    <section
      aria-label="Belegtext-Sammlungen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 16,
        borderRight: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-1)',
        overflowY: 'auto',
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: '1.2rem',
        }}
      >
        Sammlungen
      </h2>
      <DiamondRule />
      {KIND_ORDER.map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => onSelect(kind)}
          style={{
            textAlign: 'left',
            border: selected === kind ? '1px solid var(--w14-gold)' : '1px solid var(--w14-rule)',
            background: selected === kind ? 'var(--w14-parchment-3)' : 'var(--w14-parchment-2)',
            borderRadius: 'var(--w14-radius-card)',
            padding: '10px 12px',
            cursor: 'pointer',
            fontFamily: 'var(--w14-font-display)',
            fontSize: '0.9rem',
            color: selected === kind ? 'var(--w14-ink)' : 'var(--w14-ink-aged)',
          }}
        >
          {BELEGTEXT_KIND_LABELS[kind]}
        </button>
      ))}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 2. Version timeline
// ════════════════════════════════════════════════════════════════════════

function VersionTimeline({ kind }: { kind: BelegtextKind }): JSX.Element {
  const api = useApiClient();
  const listQ = useQuery({
    queryKey: ['belegtext', 'list', kind],
    queryFn: () => belegtextApi.list(api, { kind, currentOnly: false }),
    staleTime: 30_000,
  });

  const items = listQ.data?.items ?? [];

  return (
    <section
      aria-label="Versionshistorie"
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 16,
        gap: 10,
        borderRight: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment)',
        overflowY: 'auto',
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: '1.1rem',
        }}
      >
        Historie · {BELEGTEXT_KIND_LABELS[kind]}
      </h2>
      <DiamondRule />
      {listQ.isLoading ? (
        <ListSkeleton />
      ) : listQ.isError ? (
        <p role="alert" style={{ color: 'var(--w14-wax-red)' }}>
          Versionsliste konnte nicht geladen werden.
        </p>
      ) : items.length === 0 ? (
        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            fontStyle: 'italic',
            fontFamily: 'var(--w14-font-display)',
          }}
        >
          Noch keine Version veröffentlicht.
        </p>
      ) : (
        items.map((row) => <VersionCard key={row.id} row={row} />)
      )}
    </section>
  );
}

function VersionCard({ row }: { row: BelegtextRow }): JSX.Element {
  const isCurrent = row.validTo === null;
  const firstLine = row.bodyText.split('\n')[0] ?? '';
  return (
    <ParchmentCard
      padding="md"
      style={{
        border: isCurrent ? '1px solid var(--w14-gold)' : '1px solid var(--w14-rule)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span
          className="w14-smallcaps"
          style={{
            color: isCurrent ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
            letterSpacing: '0.08em',
            fontSize: '0.74rem',
          }}
        >
          {isCurrent ? 'AKTUELL' : 'archiviert'}
        </span>
        <span
          className="w14-tabular"
          style={{
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.74rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {new Date(row.validFrom).toLocaleDateString('de-DE')}
        </span>
      </div>
      <p
        style={{
          margin: '6px 0 0',
          fontFamily: 'var(--w14-font-body)',
          fontSize: '0.86rem',
          color: 'var(--w14-ink-aged)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {firstLine || <em>(Leer)</em>}
      </p>
      {row.validTo && (
        <p
          className="w14-tabular"
          style={{
            margin: '4px 0 0',
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.7rem',
            color: 'var(--w14-ink-faded)',
            fontStyle: 'italic',
          }}
        >
          bis {new Date(row.validTo).toLocaleDateString('de-DE')}
        </p>
      )}
    </ParchmentCard>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 3. Editor pane
// ════════════════════════════════════════════════════════════════════════

function EditorPane({ kind }: { kind: BelegtextKind }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const currentQ = useQuery({
    queryKey: ['belegtext', 'current', kind],
    queryFn: () => belegtextApi.current(api, { kind }),
    staleTime: 30_000,
  });

  const [draft, setDraft] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  useEffect(() => {
    if (currentQ.data?.bodyText) setDraft(currentQ.data.bodyText);
    else setDraft('');
  }, [currentQ.data]);

  const publish = useMutation({
    mutationFn: () =>
      belegtextApi.publish(api, {
        kind,
        bodyText: draft,
        ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
      }),
    onSuccess: async () => {
      addToast({
        tone: 'success',
        title: 'Neue Version veröffentlicht',
        body: BELEGTEXT_KIND_LABELS[kind],
      });
      setNotes('');
      await qc.invalidateQueries({ queryKey: ['belegtext'] });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Veröffentlichung abgelehnt',
        body: err instanceof ApiError ? err.message : 'Bitte erneut versuchen.',
      });
    },
  });

  const currentText = currentQ.data?.bodyText ?? '';
  const dirty = draft !== currentText && draft.trim().length > 0;

  const diff = useMemo(() => computeLineDiff(currentText, draft), [currentText, draft]);

  return (
    <section
      aria-label="Belegtext-Editor"
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 16,
        gap: 12,
        background: 'var(--w14-parchment-1)',
        overflowY: 'auto',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.2rem',
          }}
        >
          Editor · {BELEGTEXT_KIND_LABELS[kind]}
        </h2>
        <span
          className="w14-smallcaps"
          style={{
            color: dirty ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
            fontSize: '0.74rem',
            letterSpacing: '0.08em',
          }}
        >
          {dirty ? 'unveröffentlicht' : 'unverändert'}
        </span>
      </header>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={14}
        placeholder="Bitte Belegtext eingeben…"
        spellCheck
        style={{
          ...inputStyle,
          resize: 'vertical',
          fontFamily: 'var(--w14-font-body)',
          minHeight: 220,
        }}
      />
      <small
        style={{
          color: 'var(--w14-ink-faded)',
          fontStyle: 'italic',
          fontSize: '0.74rem',
        }}
      >
        {draft.length}/4000 Zeichen
      </small>

      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional: Begründung für diese Version"
        maxLength={1000}
        style={inputStyle}
      />

      <DiamondRule label="Diff zum aktuellen Text" />
      {currentText === '' ? (
        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            fontStyle: 'italic',
            fontSize: '0.86rem',
          }}
        >
          Es existiert noch keine Version — diese wird zur ersten.
        </p>
      ) : !dirty ? (
        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            fontStyle: 'italic',
            fontSize: '0.86rem',
          }}
        >
          Keine Änderung.
        </p>
      ) : (
        <pre
          style={{
            margin: 0,
            background: 'var(--w14-parchment-2)',
            border: '1px solid var(--w14-rule)',
            borderRadius: 4,
            padding: 10,
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.78rem',
            whiteSpace: 'pre-wrap',
            color: 'var(--w14-ink-aged)',
            maxHeight: 220,
            overflowY: 'auto',
          }}
        >
          {diff.map((line, i) => (
            <span
              key={i}
              style={{
                display: 'block',
                color:
                  line.type === 'add'
                    ? 'var(--w14-gold)'
                    : line.type === 'del'
                      ? 'var(--w14-wax-red)'
                      : 'var(--w14-ink-aged)',
              }}
            >
              {line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  '}
              {line.text}
            </span>
          ))}
        </pre>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <Button
          variant="primary"
          disabled={!dirty || publish.isPending}
          onClick={() => publish.mutate()}
        >
          {publish.isPending ? 'Veröffentlicht…' : 'Neue Version veröffentlichen'}
        </Button>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Trivial line-by-line diff — good enough for a paragraph-level audit.
// ────────────────────────────────────────────────────────────────────────

type DiffLine = { type: 'add' | 'del' | 'same'; text: string };

function computeLineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i >= a.length) {
      out.push({ type: 'add', text: b[j]! });
      j += 1;
      continue;
    }
    if (j >= b.length) {
      out.push({ type: 'del', text: a[i]! });
      i += 1;
      continue;
    }
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else {
      // Heuristic: if b[j] appears later in a, treat current a[i] as deletion.
      const aFutureMatch = a.indexOf(b[j]!, i + 1);
      const bFutureMatch = b.indexOf(a[i]!, j + 1);
      if (aFutureMatch !== -1 && (bFutureMatch === -1 || aFutureMatch - i <= bFutureMatch - j)) {
        out.push({ type: 'del', text: a[i]! });
        i += 1;
      } else {
        out.push({ type: 'add', text: b[j]! });
        j += 1;
      }
    }
  }
  return out;
}

function ListSkeleton(): JSX.Element {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          style={{
            height: 64,
            borderRadius: 'var(--w14-radius-card)',
            background:
              'linear-gradient(90deg, var(--w14-parchment-2), var(--w14-parchment-3), var(--w14-parchment-2))',
            backgroundSize: '200% 100%',
            animation: 'w14-skel 1.6s ease-in-out infinite',
            opacity: 1 - i * 0.14,
          }}
        />
      ))}
      <style>{`@keyframes w14-skel { 0%,100%{background-position:0% 50%;} 50%{background-position:100% 50%;} }`}</style>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 4,
  backgroundColor: 'var(--w14-parchment)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: '0.92rem',
  color: 'var(--w14-ink)',
  outline: 'none',
};
