/**
 * Ebay — Tier-2 9-stufige Listing-Pipeline (Phase 2 Day 8).
 *
 * Kanban-style Spalten (eine je ebayState). Karten sind Artikel, die in der
 * eBay-Zustandsmaschine eingebucht sind (`ebay_state IS NOT NULL`), gefiltert
 * über `enrolledOnEbay: true`. NICHT über das alte `listedOnEbay`-Flag: das
 * kippt erst bei einem echten Marktplatz-Push auf true, so dass die Tafel damit
 * fast immer leer blieb.
 *
 * `GET /api/products` liefert `ebayState` direkt auf der Listenzeile, also
 * genügt EIN Request für die ganze Tafel. Kein Detail-Fächer je Karte mehr.
 *
 * Eine führende Spalte zeigt verfügbare, noch nicht eingebuchte Artikel, damit
 * die Pipeline von hier aus überhaupt begonnen werden kann.
 *
 * Deutsche Sprache, Konflikt-Texte und Übergangs-Verben kommen aus
 * `@warehouse14/i18n-de` — wortgleich mit der Telefon-App.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import {
  ApiError,
  type EbayState,
  type ProductListRow,
  ebayApi,
  productsApi,
} from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';
import {
  EBAY_STATE_ORDER,
  type EbayTransitionOption,
  type SideEffectMeta,
  describeError,
  describeSideEffect,
  entersSoldCluster,
  nextTransitions,
  relativeTime,
  sourceLabel,
  stateLabel,
} from '@warehouse14/i18n-de';

/** Wie viele Einbuch-Kandidaten die führende Spalte höchstens anbietet. */
const ENROLL_CANDIDATE_LIMIT = 50;

export function Ebay(): JSX.Element {
  const api = useApiClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Die Pipeline: alle Artikel mit einem eBay-Zustand, in EINEM Request.
  const listQ = useQuery({
    queryKey: ['products', 'list', { enrolledOnEbay: true, limit: 200 }],
    queryFn: () => productsApi.list(api, { enrolledOnEbay: true, limit: 200 }),
    staleTime: 30_000,
  });

  // Einbuch-Kandidaten: verfügbar im Laden, noch nie in der eBay-Pipeline.
  const candidatesQ = useQuery({
    queryKey: [
      'products',
      'list',
      { enrolledOnEbay: false, status: 'AVAILABLE', limit: ENROLL_CANDIDATE_LIMIT },
    ],
    queryFn: () =>
      productsApi.list(api, {
        enrolledOnEbay: false,
        status: 'AVAILABLE',
        limit: ENROLL_CANDIDATE_LIMIT,
      }),
    staleTime: 30_000,
  });

  const rows = listQ.data?.items ?? [];
  const candidates = candidatesQ.data?.items ?? [];

  const byState = useMemo(() => {
    const buckets = new Map<EbayState, ProductListRow[]>();
    for (const state of EBAY_STATE_ORDER) buckets.set(state, []);
    for (const row of rows) {
      if (row.ebayState == null) continue; // durch den Filter unmöglich, defensiv
      buckets.get(row.ebayState)?.push(row);
    }
    return buckets;
  }, [rows]);

  return (
    <section
      aria-label="eBay-Pipeline"
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
          eBay-Konsole
        </h1>
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-faded)', fontSize: '0.74rem', letterSpacing: '0.08em' }}
        >
          {listQ.isFetching ? 'lädt…' : `${rows.length} in der Pipeline`}
        </span>
      </header>

      <DiamondRule />

      {listQ.isLoading ? (
        <KanbanSkeleton />
      ) : listQ.isError ? (
        <ErrorBanner />
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            gap: 10,
            overflowX: 'auto',
            paddingBottom: 8,
          }}
        >
          {candidates.length > 0 && (
            <Column
              title="Nicht eingebucht"
              hint="Verfügbar im Laden, noch nicht bei eBay."
              count={candidates.length}
              muted
            >
              {candidates.map((row) => (
                <ProductCard
                  key={row.id}
                  row={row}
                  selected={selectedId === row.id}
                  onClick={() => setSelectedId(row.id)}
                />
              ))}
            </Column>
          )}

          {rows.length === 0 && candidates.length === 0 ? (
            <EmptyState />
          ) : (
            EBAY_STATE_ORDER.map((state) => (
              <Column key={state} title={stateLabel(state)} count={byState.get(state)?.length ?? 0}>
                {(byState.get(state) ?? []).map((row) => (
                  <ProductCard
                    key={row.id}
                    row={row}
                    selected={selectedId === row.id}
                    onClick={() => setSelectedId(row.id)}
                  />
                ))}
              </Column>
            ))
          )}
        </div>
      )}

      {selectedId && <ProductDrawer productId={selectedId} onClose={() => setSelectedId(null)} />}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Column + Card
// ════════════════════════════════════════════════════════════════════════

function Column({
  title,
  hint,
  count,
  muted = false,
  children,
}: {
  title: string;
  hint?: string;
  count: number;
  muted?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      style={{
        flex: '0 0 220px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: muted ? 'transparent' : 'var(--w14-parchment-1)',
        border: muted ? '1px dashed var(--w14-rule)' : '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        padding: 8,
        gap: 6,
      }}
    >
      <div style={{ padding: '4px 6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span
            className="w14-smallcaps"
            style={{
              fontSize: '0.74rem',
              letterSpacing: '0.08em',
              color: 'var(--w14-ink-aged)',
            }}
          >
            {title}
          </span>
          <span
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '0.7rem',
              color: 'var(--w14-ink-faded)',
            }}
          >
            {count}
          </span>
        </div>
        {hint && (
          <p
            style={{
              margin: '3px 0 0',
              fontSize: '0.68rem',
              lineHeight: 1.35,
              color: 'var(--w14-ink-faded)',
              fontStyle: 'italic',
            }}
          >
            {hint}
          </p>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          overflowY: 'auto',
          minHeight: 0,
          flex: 1,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ProductCard({
  row,
  selected,
  onClick,
}: {
  row: ProductListRow;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <ParchmentCard
      padding="sm"
      onClick={onClick}
      style={{
        cursor: 'pointer',
        border: selected ? '1px solid var(--w14-gold)' : '1px solid transparent',
        background: selected ? 'var(--w14-parchment-3)' : 'var(--w14-parchment-2)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--w14-font-display)',
          fontSize: '0.86rem',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {row.name}
      </div>
      <div
        className="w14-tabular"
        style={{
          fontFamily: 'var(--w14-font-mono)',
          fontSize: '0.7rem',
          color: 'var(--w14-ink-faded)',
        }}
      >
        {row.sku} · {formatEuro(row.listPriceEur)} €
      </div>
    </ParchmentCard>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Drawer
// ════════════════════════════════════════════════════════════════════════

function ProductDrawer({
  productId,
  onClose,
}: {
  productId: string;
  onClose: () => void;
}): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  /** Ein Schritt, der auf die ausdrückliche Bestätigung des Kassierers wartet. */
  const [pending, setPending] = useState<EbayTransitionOption | null>(null);
  /** Der letzte Bestands-Nebeneffekt, sichtbar bis der Kassierer weitergeht. */
  const [sideEffect, setSideEffect] = useState<SideEffectMeta | null>(null);

  const detailQ = useQuery({
    queryKey: ['products', 'detail', productId],
    queryFn: () => productsApi.get(api, productId),
    staleTime: 5_000,
  });

  const historyQ = useQuery({
    queryKey: ['products', 'ebay-history', productId],
    queryFn: () => ebayApi.history(api, productId, { limit: 20 }),
    staleTime: 5_000,
  });

  const transition = useMutation({
    mutationFn: (toState: EbayState) => ebayApi.transition(api, productId, { toState }),
    onSuccess: async (res) => {
      setPending(null);

      const effect = describeSideEffect(res.inventorySideEffect);
      setSideEffect(effect.show ? effect : null);

      // Ein Konflikt ist KEIN Erfolg. Der Bestand widerspricht dem eBay-Schritt,
      // das muss als Warnung stehen bleiben, nicht als grüne Bestätigung.
      if (effect.isConflict) {
        addToast({ tone: 'alert', title: effect.title, body: effect.message });
      } else {
        addToast({
          tone: 'success',
          title: `${stateLabel(res.fromState)} → ${stateLabel(res.toState)}`,
          body: effect.show ? effect.message : undefined,
        });
      }

      await qc.invalidateQueries({ queryKey: ['products', 'detail', productId] });
      await qc.invalidateQueries({ queryKey: ['products', 'ebay-history', productId] });
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
    },
    onError: (err: unknown) => {
      setPending(null);
      addToast({
        tone: 'alert',
        title: 'Übergang abgelehnt',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });

  const detail = detailQ.data;
  const options = nextTransitions(detail?.ebayState ?? null);

  /**
   * Schritte, die den Bestand reservieren, laufen über eine ausdrückliche
   * Bestätigung. Alles andere ist umkehrbar und geht direkt.
   */
  function requestTransition(opt: EbayTransitionOption): void {
    setSideEffect(null);
    if (entersSoldCluster(opt.to)) {
      setPending(opt);
      return;
    }
    transition.mutate(opt.to);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Artikel-Übergänge"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(420px, 100%)',
        background: 'var(--w14-parchment)',
        borderLeft: '1px solid var(--w14-rule)',
        boxShadow: '-12px 0 28px rgba(0,0,0,0.18)',
        padding: 22,
        overflowY: 'auto',
        zIndex: 80,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
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
          eBay-Übergang
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: '1.4rem',
            lineHeight: 1,
            color: 'var(--w14-ink-faded)',
          }}
        >
          ×
        </button>
      </header>

      {detailQ.isLoading || !detail ? (
        <p style={{ color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>Lade…</p>
      ) : (
        <>
          <ParchmentCard padding="md">
            <div
              style={{
                fontFamily: 'var(--w14-font-display)',
                fontWeight: 500,
                fontSize: '1rem',
              }}
            >
              {detail.name}
            </div>
            <div
              className="w14-tabular"
              style={{
                marginTop: 4,
                fontFamily: 'var(--w14-font-mono)',
                fontSize: '0.78rem',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {detail.sku} · {formatEuro(detail.listPriceEur)} €
            </div>
            <div style={{ marginTop: 8 }}>
              <span
                className="w14-smallcaps"
                style={{
                  fontSize: '0.74rem',
                  letterSpacing: '0.08em',
                  color: 'var(--w14-gold)',
                }}
              >
                Aktuell: {stateLabel(detail.ebayState)}
              </span>
            </div>
          </ParchmentCard>

          {sideEffect && <SideEffectPanel meta={sideEffect} />}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <DiamondRule label="Übergänge" />

            {pending ? (
              <ConfirmPanel
                option={pending}
                busy={transition.isPending}
                onConfirm={() => transition.mutate(pending.to)}
                onCancel={() => setPending(null)}
              />
            ) : options.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  fontStyle: 'italic',
                  color: 'var(--w14-ink-faded)',
                  fontSize: '0.9rem',
                }}
              >
                Endzustand erreicht.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {options.map((opt) => (
                  <div key={opt.to} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Button
                      variant={opt.isRevert ? 'ghost' : 'primary'}
                      onClick={() => requestTransition(opt)}
                      disabled={transition.isPending}
                    >
                      {opt.actionLabel}
                    </Button>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        lineHeight: 1.4,
                        color: 'var(--w14-ink-faded)',
                        paddingLeft: 2,
                      }}
                    >
                      {opt.hint}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <DiamondRule label="Historie" />
            {historyQ.isLoading ? (
              <p style={{ color: 'var(--w14-ink-faded)', fontStyle: 'italic', margin: 0 }}>Lade…</p>
            ) : !historyQ.data || historyQ.data.items.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  fontStyle: 'italic',
                  color: 'var(--w14-ink-faded)',
                  fontSize: '0.9rem',
                }}
              >
                Noch keine Übergänge.
              </p>
            ) : (
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {historyQ.data.items.map((ev) => (
                  <li
                    key={ev.id}
                    style={{
                      fontSize: '0.76rem',
                      lineHeight: 1.45,
                      color: 'var(--w14-ink-aged)',
                    }}
                  >
                    <strong style={{ color: 'var(--w14-ink)', fontWeight: 500 }}>
                      {stateLabel(ev.fromState)} → {stateLabel(ev.toState)}
                    </strong>
                    <br />
                    {sourceLabel(ev.changedBySource)} · {relativeTime(ev.createdAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Der ehrliche Bestands-Hinweis nach einem Übergang (Konflikt bleibt stehen). */
function SideEffectPanel({ meta }: { meta: SideEffectMeta }): JSX.Element {
  const accent = meta.isConflict ? 'var(--w14-wax-red)' : 'var(--w14-verdigris)';
  return (
    <ParchmentCard padding="md" style={{ border: `1px solid ${accent}` }}>
      <div
        role={meta.isConflict ? 'alert' : undefined}
        style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <span
          className="w14-smallcaps"
          style={{ fontSize: '0.74rem', letterSpacing: '0.08em', color: accent }}
        >
          {meta.title}
        </span>
        <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.5, color: 'var(--w14-ink-aged)' }}>
          {meta.message}
        </p>
      </div>
    </ParchmentCard>
  );
}

/**
 * Die Bestätigung vor einem Schritt, der den Bestand serverseitig reserviert.
 * Ein Fehlgriff hier verkauft einen Artikel zweimal — deshalb kein Ein-Klick.
 */
function ConfirmPanel({
  option,
  busy,
  onConfirm,
  onCancel,
}: {
  option: EbayTransitionOption;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ border: '1px solid var(--w14-gold)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span
          className="w14-smallcaps"
          style={{ fontSize: '0.74rem', letterSpacing: '0.08em', color: 'var(--w14-gold)' }}
        >
          Bestätigung erforderlich
        </span>
        <p style={{ margin: 0, fontSize: '0.86rem', lineHeight: 1.5, color: 'var(--w14-ink-aged)' }}>
          „{option.actionLabel}" reserviert den Artikel im Lager, damit er nicht zusätzlich im Laden
          verkauft wird. Ist der eBay-Verkauf sicher?
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Wird gebucht…' : 'Ja, buchen'}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Abbrechen
          </Button>
        </div>
      </div>
    </ParchmentCard>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════

function formatEuro(s: string): string {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function KanbanSkeleton(): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          style={{
            flex: '0 0 220px',
            background:
              'linear-gradient(180deg, var(--w14-parchment-2), var(--w14-parchment-3), var(--w14-parchment-2))',
            backgroundSize: '100% 200%',
            animation: 'w14-skel 1.6s ease-in-out infinite',
            borderRadius: 'var(--w14-radius-card)',
            border: '1px solid var(--w14-rule)',
          }}
        />
      ))}
      <style>{`@keyframes w14-skel { 0%,100%{background-position:0% 0%;} 50%{background-position:0% 100%;} }`}</style>
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 32, flex: 1 }}>
      <ParchmentCard padding="lg" style={{ textAlign: 'center', maxWidth: 480 }}>
        <DiamondRule />
        <p
          style={{
            margin: '8px 0 0',
            color: 'var(--w14-ink-faded)',
            fontStyle: 'italic',
            fontFamily: 'var(--w14-font-display)',
          }}
        >
          Noch keine Artikel im eBay-Workflow.
        </p>
      </ParchmentCard>
    </div>
  );
}

function ErrorBanner(): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ border: '1px solid var(--w14-wax-red)' }}>
      <p role="alert" style={{ margin: 0, color: 'var(--w14-wax-red)' }}>
        eBay-Pipeline konnte nicht geladen werden.
      </p>
    </ParchmentCard>
  );
}
