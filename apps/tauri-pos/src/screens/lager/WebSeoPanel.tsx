/**
 * WebSeoPanel — Day 14 (Phase 2.B UI).
 *
 * The "Web & SEO" tab inside the Lager → InventoryAdjustmentDialog.
 * Powers four operator actions against a single product row:
 *
 *   1. Publication toggle — flips `is_published_to_web` via
 *      `productsApi.update(id, { isPublishedToWeb })`. The DB trigger
 *      `on_products_publish_to_web` (migration 0029) stamps
 *      `publishedAt` on the first TRUE flip; the storefront covering
 *      index `products_storefront_catalog_idx` makes the row appear
 *      in `GET /api/storefront/products` on the next refresh.
 *
 *   2. Category selector — reads `GET /api/categories` (hierarchical
 *      tree, 2-level cap). Operator picks ONE node = primary category.
 *      Persisted via `categoriesApi.setForProduct(id, { categoryIds,
 *      primaryCategoryId })`. Day-14 keeps the UX single-pick (one
 *      primary); the multi-select / secondary-categories surface is
 *      Phase 2.B Day 15.
 *
 *   3. SEO metadata — slug, seoTitle, seoDescription. Persisted via
 *      the same `productsApi.update`. Save-on-explicit-action (not
 *      autosave on blur) to keep network traffic predictable when
 *      the operator is mid-typing.
 *
 *   4. AI button — calls `mcpApi.generateSeoDescription` for the
 *      `seo_description` field. ADMIN-only (per the MCP tool manifest).
 *      The tool itself ALSO writes the row server-side; on success we
 *      pull the fresh detail to reflect the new description.
 *
 * EVERY MUTATION is a TanStack Query `useMutation`. On success we
 * invalidate the product detail query + the catalog list query so
 * Lager + storefront previews refresh.
 *
 * Visual identity: Parchment surface + Gold accent + JetBrains Mono
 * for monospace fields (slug, sku). Pulsing dot for LIVE status.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  type CategoryNode,
  McpToolError,
  type ProductDetail,
  categoriesApi,
  mcpApi,
  productsApi,
} from '@warehouse14/api-client';
import { describeError } from '@warehouse14/i18n-de';
import { Button, DiamondRule } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';

export interface WebSeoPanelProps {
  /** Product id. The panel fetches its own detail via TanStack Query. */
  productId: string;
}

// TanStack Query keys — exported so callers can invalidate after writes.
export const productDetailQueryKey = (id: string): readonly unknown[] => ['products', 'detail', id];
export const categoriesTreeQueryKey: readonly unknown[] = ['categories', 'tree'];

export function WebSeoPanel({ productId }: WebSeoPanelProps): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const actor = useSessionStore((s) => s.actor);
  const isAdmin = actor?.role === 'ADMIN';

  // ── Data loads ──────────────────────────────────────────────────────
  const detailQ = useQuery({
    queryKey: productDetailQueryKey(productId),
    queryFn: () => productsApi.get(api, productId),
    staleTime: 30_000,
  });

  const treeQ = useQuery({
    queryKey: categoriesTreeQueryKey,
    queryFn: () => categoriesApi.tree(api),
    staleTime: 5 * 60_000, // taxonomy changes rarely
  });

  // ── Local form state — initialized from the loaded detail ───────────
  const [slugDraft, setSlugDraft] = useState<string>('');
  const [seoTitleDraft, setSeoTitleDraft] = useState<string>('');
  const [seoDescriptionDraft, setSeoDescriptionDraft] = useState<string>('');
  const [primaryCategoryDraft, setPrimaryCategoryDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!detailQ.data) return;
    setSlugDraft(detailQ.data.slug ?? '');
    setSeoTitleDraft(detailQ.data.seoTitle ?? '');
    setSeoDescriptionDraft(detailQ.data.seoDescription ?? '');
    // `ProductCategoryAssignment` exposes the category's own id as `id`
    // (alongside slug, nameDe). The "primary one" → its id is what we
    // post back to `setForProduct` as `primaryCategoryId`.
    const currentPrimary = detailQ.data.categories.find((c) => c.isPrimary);
    setPrimaryCategoryDraft(currentPrimary ? currentPrimary.id : null);
  }, [detailQ.data]);

  // ── Mutations ───────────────────────────────────────────────────────

  const publishToggle = useMutation({
    mutationFn: (isPublishedToWeb: boolean) =>
      productsApi.update(api, productId, { isPublishedToWeb }),
    onSuccess: async (_res, isPublishedToWeb) => {
      addToast({
        tone: 'success',
        title: isPublishedToWeb ? 'Online geschaltet' : 'Vom Web entfernt',
        body: isPublishedToWeb
          ? 'Artikel ist jetzt im Web-Shop sichtbar.'
          : 'Artikel ist im Web-Shop ausgeblendet.',
      });
      await qc.invalidateQueries({ queryKey: productDetailQueryKey(productId) });
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Schalten fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Netzwerkfehler — bitte erneut versuchen.',
      });
    },
  });

  const saveSeo = useMutation({
    mutationFn: () =>
      productsApi.update(api, productId, {
        slug: slugDraft.trim() === '' ? null : slugDraft.trim(),
        seoTitle: seoTitleDraft.trim() === '' ? null : seoTitleDraft,
        seoDescription: seoDescriptionDraft.trim() === '' ? null : seoDescriptionDraft,
      }),
    onSuccess: async (res) => {
      addToast({
        tone: 'success',
        title: 'SEO-Daten gespeichert',
        body:
          res.changedFields.length > 0
            ? `Geändert: ${res.changedFields.join(', ')}`
            : 'Keine Änderung erkannt.',
      });
      await qc.invalidateQueries({ queryKey: productDetailQueryKey(productId) });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Speichern fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte Eingaben prüfen.',
      });
    },
  });

  const setCategory = useMutation({
    mutationFn: (categoryId: string | null) =>
      categoriesApi.setForProduct(api, productId, {
        categoryIds: categoryId ? [categoryId] : [],
        primaryCategoryId: categoryId,
      }),
    onSuccess: async () => {
      addToast({ tone: 'success', title: 'Kategorie gesetzt' });
      await qc.invalidateQueries({ queryKey: productDetailQueryKey(productId) });
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Kategorie konnte nicht gesetzt werden',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });

  // ── AI: SEO Text Generieren ─────────────────────────────────────────
  // The MCP tool writes the description server-side AND returns it.
  // We surface the returned text in the textarea immediately so the
  // operator can review + tweak before optionally saving again.
  const aiGenerate = useMutation({
    mutationFn: async () => {
      const result = await mcpApi.generateSeoDescription(api, {
        productId,
        locale: 'de',
        tone: 'collector',
        maxLength: 160,
      });
      return result.data;
    },
    onSuccess: async (data) => {
      setSeoDescriptionDraft(data.description);
      addToast({
        tone: 'success',
        title: data.wrote
          ? 'KI-Text generiert + gespeichert'
          : 'KI-Text generiert (identisch zum aktuellen)',
        body: `${data.description.length} Zeichen.`,
      });
      // The tool itself wrote the row; re-fetch detail for the truth.
      await qc.invalidateQueries({ queryKey: productDetailQueryKey(productId) });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof McpToolError
          ? describeError(err)
          : err instanceof ApiError
            ? describeError(err)
            : 'Unbekannter KI-Fehler';
      addToast({ tone: 'alert', title: 'KI-Generierung fehlgeschlagen', body: msg });
    },
  });

  // ── Derived UI bits ─────────────────────────────────────────────────

  /** Flatten the tree to a select-friendly indented list. */
  const flatCategories = useMemo(() => {
    if (!treeQ.data) return [] as Array<{ id: string; label: string; depth: number }>;
    const out: Array<{ id: string; label: string; depth: number }> = [];
    const walk = (nodes: CategoryNode[], depth: number): void => {
      for (const n of nodes) {
        if (n.hiddenFromStorefront) continue; // hide from picker too
        out.push({ id: n.id, label: n.nameDe, depth });
        if (n.children.length > 0) walk(n.children, depth + 1);
      }
    };
    walk(treeQ.data.roots, 0);
    return out;
  }, [treeQ.data]);

  const isLive = detailQ.data?.isPublishedToWeb === true;
  const detailLoading = detailQ.isLoading;
  const detailError = detailQ.isError;

  // ── Render ──────────────────────────────────────────────────────────

  if (detailLoading) {
    return (
      <section style={{ padding: 18 }}>
        <p
          style={{
            color: 'var(--w14-ink-faded)',
            textAlign: 'center',
            fontFamily: 'var(--w14-font-display)',
          }}
        >
          Lade Produktdetails…
        </p>
      </section>
    );
  }

  if (detailError || !detailQ.data) {
    return (
      <section style={{ padding: 18 }}>
        <p role="alert" style={{ color: 'var(--w14-wax-red)', textAlign: 'center' }}>
          Produktdetails konnten nicht geladen werden.
        </p>
      </section>
    );
  }

  const detail: ProductDetail = detailQ.data;

  return (
    <section
      aria-label="Web & SEO"
      style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px 4px' }}
    >
      {/* ── 1. Publication toggle ── */}
      <PublishToggle
        isLive={isLive}
        publishedAt={
          detail.archivedAt ? null : null /* detail.publishedAt not on type yet — Phase 2.B I-29 */
        }
        busy={publishToggle.isPending}
        onToggle={(next) => publishToggle.mutate(next)}
      />

      <DiamondRule />

      {/* ── 2. Category selector ── */}
      <FieldGroup label="Primäre Kategorie" hint="Treibt Breadcrumb + JSON-LD im Web-Shop.">
        <select
          value={primaryCategoryDraft ?? ''}
          onChange={(e) => {
            const next = e.target.value || null;
            setPrimaryCategoryDraft(next);
            setCategory.mutate(next);
          }}
          disabled={treeQ.isLoading || setCategory.isPending}
          style={selectStyle}
        >
          <option value="">— keine Kategorie —</option>
          {flatCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {`${'  '.repeat(c.depth)}${c.label}`}
            </option>
          ))}
        </select>
      </FieldGroup>

      <DiamondRule />

      {/* ── 3. SEO metadata ── */}
      <FieldGroup label="URL-Slug" hint="warehouse14.de/artikel/<slug>-<sku-tail>">
        <input
          value={slugDraft}
          onChange={(e) => setSlugDraft(e.target.value)}
          placeholder="goldmuenze-saint-gaudens-1907"
          spellCheck={false}
          style={{ ...inputStyle, fontFamily: 'var(--w14-font-mono)' }}
        />
        <small style={hintStyle}>
          Nur Kleinbuchstaben, Ziffern und Bindestriche. Leer lassen für automatischen Slug.
        </small>
      </FieldGroup>

      <FieldGroup label="SEO-Title" hint="≤ 60 Zeichen — erscheint im Browser-Tab.">
        <input
          value={seoTitleDraft}
          onChange={(e) => setSeoTitleDraft(e.target.value)}
          placeholder="Saint-Gaudens 1907 — Anlagegold..."
          maxLength={256}
          style={inputStyle}
        />
        <small style={hintStyle}>{seoTitleDraft.length}/256</small>
      </FieldGroup>

      <FieldGroup label="SEO-Beschreibung" hint="≤ 160 Zeichen empfohlen für Google-Snippets.">
        <textarea
          value={seoDescriptionDraft}
          onChange={(e) => setSeoDescriptionDraft(e.target.value)}
          rows={4}
          maxLength={4096}
          placeholder="Beschreibe das Stück so, wie ein Sammler sucht…"
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'var(--w14-font-body)' }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <small style={hintStyle}>{seoDescriptionDraft.length} Zeichen</small>
          <AiGenerateButton
            disabled={!isAdmin || aiGenerate.isPending}
            busy={aiGenerate.isPending}
            {...(!isAdmin ? { disabledReason: 'Nur für ADMIN-Konten verfügbar' } : {})}
            onClick={() => aiGenerate.mutate()}
          />
        </div>
      </FieldGroup>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <Button variant="primary" onClick={() => saveSeo.mutate()} disabled={saveSeo.isPending}>
          {saveSeo.isPending ? 'Speichert…' : 'SEO-Daten speichern'}
        </Button>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Building blocks
// ════════════════════════════════════════════════════════════════════════

function PublishToggle({
  isLive,
  busy,
  onToggle,
}: {
  isLive: boolean;
  publishedAt: string | null;
  busy: boolean;
  onToggle: (next: boolean) => void;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 18,
        padding: '10px 14px',
        backgroundColor: 'var(--w14-parchment-2)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            borderRadius: 999,
            backgroundColor: isLive ? 'var(--w14-gold)' : 'var(--w14-rule)',
            boxShadow: isLive
              ? '0 0 0 2px var(--w14-parchment-2), 0 0 12px var(--w14-gold-soft)'
              : 'none',
            animation: isLive ? 'w14-publish-pulse 2.2s ease-in-out infinite' : 'none',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            className="w14-smallcaps"
            style={{
              letterSpacing: '0.1em',
              fontSize: '0.78rem',
              color: isLive ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
              fontWeight: 600,
            }}
          >
            {isLive ? 'LIVE im Web-Shop' : 'Nicht veröffentlicht'}
          </span>
          <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>
            warehouse14.de zeigt dieses Stück {isLive ? 'sofort an.' : 'noch nicht.'}
          </span>
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={isLive}
        onClick={() => onToggle(!isLive)}
        disabled={busy}
        style={{
          position: 'relative',
          width: 56,
          height: 30,
          padding: 0,
          border: 'none',
          background: isLive ? 'var(--w14-gold)' : 'var(--w14-rule)',
          borderRadius: 999,
          cursor: busy ? 'wait' : 'pointer',
          transition: 'background 0.18s ease',
          opacity: busy ? 0.6 : 1,
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 3,
            left: isLive ? 28 : 3,
            width: 24,
            height: 24,
            borderRadius: 999,
            backgroundColor: 'var(--w14-parchment)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
            transition: 'left 0.18s ease',
          }}
        />
      </button>

      <style>{`
        @keyframes w14-publish-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(1.3); opacity: 0.85; }
        }
      `}</style>
    </div>
  );
}

function AiGenerateButton({
  disabled,
  busy,
  disabledReason,
  onClick,
}: {
  disabled: boolean;
  busy: boolean;
  disabledReason?: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabledReason}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px',
        border: '1px solid var(--w14-gold)',
        background: busy
          ? 'linear-gradient(120deg, var(--w14-gold-soft), var(--w14-gold), var(--w14-gold-soft))'
          : 'var(--w14-parchment-2)',
        backgroundSize: busy ? '300% 100%' : '100% 100%',
        animation: busy ? 'w14-ai-shimmer 1.8s ease-in-out infinite' : 'none',
        color: busy ? 'var(--w14-parchment)' : 'var(--w14-gold)',
        fontFamily: 'var(--w14-font-display)',
        fontSize: '0.82rem',
        letterSpacing: '0.06em',
        fontWeight: 500,
        borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled && !busy ? 0.5 : 1,
        boxShadow: busy ? '0 0 14px var(--w14-gold-soft)' : 'none',
        transition: 'box-shadow 0.2s ease, color 0.2s ease',
      }}
    >
      <span aria-hidden style={{ fontSize: '1rem', lineHeight: 1 }}>
        {busy ? '✦' : '✧'}
      </span>
      {busy ? 'KI denkt…' : 'KI: SEO-Text generieren'}
      <style>{`
        @keyframes w14-ai-shimmer {
          0%, 100% { background-position: 0% 50%; }
          50%      { background-position: 100% 50%; }
        }
      `}</style>
    </button>
  );
}

function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label
        className="w14-smallcaps"
        style={{
          color: 'var(--w14-ink-aged)',
          letterSpacing: '0.08em',
          fontSize: '0.78rem',
          fontWeight: 600,
        }}
      >
        {label}
        {hint && (
          <span
            style={{
              marginLeft: 8,
              color: 'var(--w14-ink-faded)',
              fontStyle: 'italic',
              fontWeight: 400,
              textTransform: 'none',
              letterSpacing: 0,
              fontSize: '0.72rem',
            }}
          >
            {hint}
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 4,
  backgroundColor: 'var(--w14-parchment-1, var(--w14-parchment))',
  fontFamily: 'var(--w14-font-body)',
  fontSize: '0.92rem',
  color: 'var(--w14-ink)',
  outline: 'none',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: 'var(--w14-font-display)',
  cursor: 'pointer',
};

const hintStyle: React.CSSProperties = {
  color: 'var(--w14-ink-faded)',
  fontSize: '0.72rem',
  fontStyle: 'italic',
};
