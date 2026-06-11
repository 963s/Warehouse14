/**
 * CategoryPicker — calm cascading category capture for the product forms.
 *
 *   • Hauptkategorie tiles → Unterkategorie chips → third level (Briefmarken
 *     → Altdeutschland states), loaded from GET /api/categories (cached under
 *     the same TanStack key as WebSeoPanel: ['categories','tree']).
 *   • Search-as-you-type across ALL levels (shows the full path per hit).
 *   • MiNr-range hints for stamp categories (lib/taxonomy-hints constants,
 *     falling back to the node's seeded descriptionDe).
 *   • Click = select. A node with children stays open so the operator can
 *     refine; a leaf closes the picker. Selection = primaryCategoryId.
 *
 * Also exports the shared progressive-disclosure field groups both product
 * forms reuse (smallest-diff wiring in NeuesProduktDialog + ProductSheet):
 *   • StampAttributeFields    — Erhaltung segmented control + MiNr input
 *   • BeschreibungDetailsFields — Online-Shop description + 'Details' group
 *     (Epoche · Prägejahr von/bis · Herkunftsland · Katalog-Referenz)
 *
 * German UI, ≥44px targets, soft validation only (a save is never blocked
 * by a MiNr plausibility warning).
 */

import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, useMemo, useState } from 'react';

import {
  type CategoryNode,
  type CategoryTreeResponse,
  type ProductUpdateBody,
  categoriesApi,
} from '@warehouse14/api-client';
import { Field, Input, Textarea } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import {
  ERHALTUNG_OPTIONS,
  type StampErhaltung,
  formatRangeHint,
  isStampPath,
  minrWarning,
  stampRangeForPath,
  stampRangeForSlug,
} from '../../lib/taxonomy-hints.js';

// ─────────────────────────────────────────────────────────────────────────
// Tree access + selection resolution
// ─────────────────────────────────────────────────────────────────────────

/** Same key WebSeoPanel uses — one cached tree for the whole Lager screen. */
export const categoryTreeKey: readonly unknown[] = ['categories', 'tree'];

export function useCategoryTree(): {
  roots: CategoryNode[];
  isLoading: boolean;
  isError: boolean;
} {
  const api = useApiClient();
  const q = useQuery<CategoryTreeResponse>({
    queryKey: categoryTreeKey,
    queryFn: () => categoriesApi.tree(api),
    staleTime: 5 * 60_000,
  });
  return { roots: q.data?.roots ?? [], isLoading: q.isLoading, isError: q.isError };
}

export interface CategorySelection {
  id: string;
  slug: string;
  nameDe: string;
  /** Root → selected node. */
  pathNames: string[];
  pathSlugs: string[];
  rootSlug: string;
  rootNameDe: string;
}

function toSelection(path: CategoryNode[]): CategorySelection | null {
  const leaf = path[path.length - 1];
  const root = path[0];
  if (!leaf || !root) return null;
  return {
    id: leaf.id,
    slug: leaf.slug,
    nameDe: leaf.nameDe,
    pathNames: path.map((n) => n.nameDe),
    pathSlugs: path.map((n) => n.slug),
    rootSlug: root.slug,
    rootNameDe: root.nameDe,
  };
}

function findPath(roots: CategoryNode[], id: string): CategoryNode[] | null {
  const walk = (nodes: CategoryNode[], trail: CategoryNode[]): CategoryNode[] | null => {
    for (const n of nodes) {
      const next = [...trail, n];
      if (n.id === id) return next;
      const hit = walk(n.children, next);
      if (hit) return hit;
    }
    return null;
  };
  return walk(roots, []);
}

/** Resolve a category id (e.g. the product's primary category) to a full selection. */
export function resolveCategorySelection(
  roots: CategoryNode[],
  id: string | null,
): CategorySelection | null {
  if (!id || roots.length === 0) return null;
  const path = findPath(roots, id);
  return path ? toSelection(path) : null;
}

/** MiNr subtext for a stamp node — constants first, seeded descriptionDe as fallback. */
function nodeRangeText(node: CategoryNode, underStamps: boolean): string | null {
  const hint = stampRangeForSlug(node.slug);
  if (hint)
    return `MiNr. ${hint.min}–${hint.max ?? 'laufend'}${hint.blocks ? ` · ${hint.blocks}` : ''}`;
  if (underStamps && node.descriptionDe) return node.descriptionDe;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// CategoryPicker — the cascading picker itself
// ─────────────────────────────────────────────────────────────────────────

export interface CategoryPickerProps {
  /** Selected category id (primaryCategoryId) or null. */
  value: string | null;
  onChange: (selection: CategorySelection | null) => void;
  disabled?: boolean;
}

interface FlatEntry {
  node: CategoryNode;
  path: CategoryNode[];
}

export function CategoryPicker({ value, onChange, disabled }: CategoryPickerProps): JSX.Element {
  const { roots, isLoading, isError } = useCategoryTree();
  const [query, setQuery] = useState('');

  const selectedPath = useMemo(() => (value ? (findPath(roots, value) ?? []) : []), [roots, value]);
  const activeRoot = selectedPath[0] ?? null;
  const activeSecond = selectedPath[1] ?? null;

  const flat = useMemo<FlatEntry[]>(() => {
    const out: FlatEntry[] = [];
    const walk = (nodes: CategoryNode[], trail: CategoryNode[]): void => {
      for (const n of nodes) {
        const path = [...trail, n];
        out.push({ node: n, path });
        walk(n.children, path);
      }
    };
    walk(roots, []);
    return out;
  }, [roots]);

  const q = query.trim().toLowerCase();
  const hits = useMemo<FlatEntry[]>(() => {
    if (q.length === 0) return [];
    return flat
      .filter(
        (e) =>
          e.node.nameDe.toLowerCase().includes(q) ||
          e.node.slug.includes(q) ||
          (e.node.descriptionDe ?? '').toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [flat, q]);

  const pick = (path: CategoryNode[]): void => {
    if (disabled) return;
    setQuery('');
    onChange(toSelection(path));
  };

  if (isLoading) {
    return <p style={QUIET_TEXT}>Kategorien werden geladen…</p>;
  }
  if (isError || roots.length === 0) {
    return <p style={QUIET_TEXT}>Keine Kategorien verfügbar — später erneut versuchen.</p>;
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Kategorie suchen — z. B. Baden, Goldmünzen…"
        aria-label="Kategorie suchen"
        disabled={disabled === true}
      />

      {q.length > 0 ? (
        // ── Search results across all levels ───────────────────────────
        hits.length === 0 ? (
          <p style={QUIET_TEXT}>Keine Kategorie passt zu „{query.trim()}“.</p>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {hits.map((e) => {
              const range = nodeRangeText(
                e.node,
                e.path.some((p) => p.slug === 'briefmarken'),
              );
              const isSel = e.node.id === value;
              return (
                <button
                  key={e.node.id}
                  type="button"
                  disabled={disabled === true}
                  onClick={() => pick(e.path)}
                  style={{ ...HIT_ROW, ...(isSel ? TILE_SELECTED : {}) }}
                >
                  <span style={{ fontWeight: 600 }}>{e.node.nameDe}</span>
                  <span style={HIT_PATH}>
                    {e.path.map((p) => p.nameDe).join(' › ')}
                    {range ? ` · ${range}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        )
      ) : (
        // ── Calm cascade: roots → children → grandchildren ─────────────
        <>
          <div>
            <span style={LEVEL_LABEL}>Hauptkategorie</span>
            <div style={TILE_WRAP}>
              {roots.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  disabled={disabled === true}
                  aria-pressed={activeRoot?.id === r.id}
                  onClick={() => pick([r])}
                  style={{ ...TILE, ...(activeRoot?.id === r.id ? TILE_SELECTED : {}) }}
                >
                  {r.nameDe}
                </button>
              ))}
            </div>
          </div>

          {activeRoot && activeRoot.children.length > 0 && (
            <div>
              <span style={LEVEL_LABEL}>Unterkategorie — {activeRoot.nameDe}</span>
              <div style={TILE_WRAP}>
                {activeRoot.children.map((c) => {
                  const range = nodeRangeText(c, activeRoot.slug === 'briefmarken');
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={disabled === true}
                      aria-pressed={c.id === value || activeSecond?.id === c.id}
                      onClick={() => pick([activeRoot, c])}
                      style={{
                        ...TILE,
                        ...(c.id === value || activeSecond?.id === c.id ? TILE_SELECTED : {}),
                      }}
                    >
                      <span>{c.nameDe}</span>
                      {range && <span style={TILE_SUB}>{range}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {activeRoot && activeSecond && activeSecond.children.length > 0 && (
            <div>
              <span style={LEVEL_LABEL}>{activeSecond.nameDe} — Gebiet wählen</span>
              <div style={TILE_WRAP}>
                {activeSecond.children.map((g) => {
                  const range = nodeRangeText(g, true);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      disabled={disabled === true}
                      aria-pressed={g.id === value}
                      onClick={() => pick([activeRoot, activeSecond, g])}
                      style={{ ...TILE, ...(g.id === value ? TILE_SELECTED : {}) }}
                    >
                      <span>{g.nameDe}</span>
                      {range && <span style={TILE_SUB}>{range}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CategoryPickerField — collapsed trigger row + expandable picker.
// The hot path shows ONE calm row; the cascade appears on demand.
// ─────────────────────────────────────────────────────────────────────────

export interface CategoryPickerFieldProps {
  value: string | null;
  onChange: (selection: CategorySelection | null) => void;
  disabled?: boolean;
}

export function CategoryPickerField({
  value,
  onChange,
  disabled,
}: CategoryPickerFieldProps): JSX.Element {
  const { roots } = useCategoryTree();
  const [open, setOpen] = useState(false);

  const selection = useMemo(() => resolveCategorySelection(roots, value), [roots, value]);
  const rangeHint = selection ? stampRangeForPath(selection.pathSlugs) : null;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <span style={LEVEL_LABEL}>Kategorie (Online-Shop)</span>
      <button
        type="button"
        disabled={disabled === true}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={TRIGGER_ROW}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: selection ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
            fontWeight: selection ? 600 : 400,
          }}
        >
          {selection ? selection.pathNames.join(' › ') : 'Kategorie wählen…'}
        </span>
        <span aria-hidden style={{ color: 'var(--w14-ink-faded)', flexShrink: 0 }}>
          {open ? '▾' : '▸'}
        </span>
      </button>

      {selection && rangeHint && !open && (
        <span style={QUIET_TEXT}>{formatRangeHint(rangeHint)}</span>
      )}

      {open && (
        <div style={PICKER_BOX}>
          <CategoryPicker
            value={value}
            onChange={(sel) => {
              onChange(sel);
              // A leaf ends the cascade — collapse; a parent stays open to refine.
              if (sel) {
                const path = findPath(roots, sel.id);
                const leaf = path?.[path.length - 1];
                if (leaf && leaf.children.length === 0) setOpen(false);
              }
            }}
            disabled={disabled === true}
          />
          {selection && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ ...QUIET_TEXT, alignSelf: 'center' }}>
                Ausgewählt: {selection.pathNames.join(' › ')}
              </span>
              <button
                type="button"
                onClick={() => onChange(null)}
                disabled={disabled === true}
                style={CLEAR_BTN}
              >
                Entfernen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// StampAttributeFields — only rendered when the category is under Briefmarken.
// Erhaltung segmented control (owner's dealer notation as hints) + MiNr with
// a SOFT range plausibility warning (never blocks).
// ─────────────────────────────────────────────────────────────────────────

export interface StampAttributeFieldsProps {
  pathSlugs: readonly string[];
  erhaltung: StampErhaltung | null;
  /** Raw digits string ('' = unset). */
  minr: string;
  onErhaltungChange: (v: StampErhaltung | null) => void;
  onMinrChange: (v: string) => void;
  disabled?: boolean;
}

export function StampAttributeFields({
  pathSlugs,
  erhaltung,
  minr,
  onErhaltungChange,
  onMinrChange,
  disabled,
}: StampAttributeFieldsProps): JSX.Element | null {
  if (!isStampPath(pathSlugs)) return null;

  const range = stampRangeForPath(pathSlugs);
  const minrNum = minr.trim().length > 0 ? Number.parseInt(minr, 10) : Number.NaN;
  const warning = Number.isFinite(minrNum) ? minrWarning(pathSlugs, minrNum) : null;

  return (
    <div style={STAMP_BOX}>
      <span style={LEVEL_LABEL}>Briefmarke — Erhaltung</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {ERHALTUNG_OPTIONS.map((o) => {
          const active = erhaltung === o.value;
          return (
            <button
              key={o.value}
              type="button"
              disabled={disabled === true}
              aria-pressed={active}
              onClick={() => onErhaltungChange(active ? null : o.value)}
              style={{ ...TILE, ...(active ? TILE_SELECTED : {}) }}
            >
              <span>
                {o.label}
                {o.stars ? ` ${o.stars}` : ''}
              </span>
              {o.notation && <span style={TILE_SUB}>Notation {o.notation}</span>}
            </button>
          );
        })}
      </div>
      <span style={QUIET_TEXT}>Händler-Notation: ** postfrisch · * Falz · (,) gestempelt</span>

      <div style={{ maxWidth: 220 }}>
        <Field
          label="MiNr. (Michel)"
          {...(range ? { hint: formatRangeHint(range) } : {})}
          error={warning}
        >
          <Input
            mono
            inputMode="numeric"
            value={minr}
            onChange={(e) => onMinrChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
            placeholder="z. B. 27"
            disabled={disabled === true}
          />
        </Field>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// BeschreibungDetailsFields — Online-Shop description + collapsible Details
// (Epoche · Prägejahr von/bis · Herkunftsland · Katalog-Referenz).
// ─────────────────────────────────────────────────────────────────────────

export interface CollectorDetailsDraft {
  period: string;
  yearFrom: string;
  yearTo: string;
  /** ISO-3166-1 alpha-2 — auto-uppercased; '' = unset. */
  originCountry: string;
  catalogReference: string;
}

export const EMPTY_COLLECTOR_DETAILS: CollectorDetailsDraft = {
  period: '',
  yearFrom: '',
  yearTo: '',
  originCountry: '',
  catalogReference: '',
};

export function hasCollectorDetails(d: CollectorDetailsDraft): boolean {
  return Object.values(d).some((v) => v.trim().length > 0);
}

/** '' or a valid 2-letter code — anything else is a (soft-stop) form error. */
export function isOriginCountryValid(d: CollectorDetailsDraft): boolean {
  const t = d.originCountry.trim();
  return t.length === 0 || /^[A-Z]{2}$/.test(t);
}

function intOrNull(raw: string): number | null {
  const t = raw.trim();
  if (t.length === 0) return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * PUT patch for description + Details — explicit `null` clears a field
 * (the form is hydrated from the detail, so the draft IS the truth).
 */
export function buildDetailsUpdate(
  description: string,
  d: CollectorDetailsDraft,
): ProductUpdateBody {
  return {
    descriptionDe: description.trim(),
    period: d.period.trim() || null,
    yearMintedFrom: intOrNull(d.yearFrom),
    yearMintedTo: intOrNull(d.yearTo),
    originCountry:
      isOriginCountryValid(d) && d.originCountry.trim() ? d.originCountry.trim() : null,
    catalogReference: d.catalogReference.trim() || null,
  };
}

export interface BeschreibungDetailsFieldsProps {
  description: string;
  onDescriptionChange: (v: string) => void;
  details: CollectorDetailsDraft;
  onDetailsChange: (d: CollectorDetailsDraft) => void;
  /** Open the Details group initially (e.g. when hydrated values exist). */
  defaultDetailsOpen?: boolean;
  disabled?: boolean;
}

export function BeschreibungDetailsFields({
  description,
  onDescriptionChange,
  details,
  onDetailsChange,
  defaultDetailsOpen,
  disabled,
}: BeschreibungDetailsFieldsProps): JSX.Element {
  const [openDetails, setOpenDetails] = useState(defaultDetailsOpen === true);
  const set = (patch: Partial<CollectorDetailsDraft>): void =>
    onDetailsChange({ ...details, ...patch });

  const countryError = isOriginCountryValid(details)
    ? null
    : 'Zwei-Buchstaben-Code, z. B. DE oder AT.';

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Field
        label="Beschreibung (erscheint im Online-Shop)"
        hint="Kurz und konkret — so sieht es die Kundschaft auf der Artikelseite."
      >
        <Textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={3}
          maxLength={8192}
          placeholder="z. B. Sauber erhaltene Goldmünze, Originalpatina, aus Sammlungsauflösung."
          disabled={disabled === true}
        />
      </Field>

      <button
        type="button"
        aria-expanded={openDetails}
        onClick={() => setOpenDetails((o) => !o)}
        style={TRIGGER_ROW}
      >
        <span style={{ color: 'var(--w14-ink-aged)' }}>
          Details — Epoche · Prägejahr · Herkunft · Katalog
        </span>
        <span aria-hidden style={{ color: 'var(--w14-ink-faded)', flexShrink: 0 }}>
          {openDetails ? '▾' : '▸'}
        </span>
      </button>

      {openDetails && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={GRID_2}>
            <Field label="Epoche / Periode">
              <Input
                value={details.period}
                onChange={(e) => set({ period: e.target.value })}
                placeholder="z. B. Kaiserreich"
                maxLength={128}
                disabled={disabled === true}
              />
            </Field>
            <Field label="Katalog-Referenz">
              <Input
                value={details.catalogReference}
                onChange={(e) => set({ catalogReference: e.target.value })}
                placeholder="z. B. Jaeger 489"
                maxLength={128}
                disabled={disabled === true}
              />
            </Field>
          </div>
          <div style={GRID_3}>
            <Field label="Prägejahr von">
              <Input
                mono
                inputMode="numeric"
                value={details.yearFrom}
                onChange={(e) =>
                  set({ yearFrom: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })
                }
                placeholder="1871"
                disabled={disabled === true}
              />
            </Field>
            <Field label="Prägejahr bis">
              <Input
                mono
                inputMode="numeric"
                value={details.yearTo}
                onChange={(e) => set({ yearTo: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })}
                placeholder="1918"
                disabled={disabled === true}
              />
            </Field>
            <Field label="Herkunftsland" hint="ISO-Code" error={countryError}>
              <Input
                mono
                value={details.originCountry}
                onChange={(e) =>
                  set({
                    originCountry: e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z]/g, '')
                      .slice(0, 2),
                  })
                }
                placeholder="DE"
                disabled={disabled === true}
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Styles — modern clean neutral, ≥44px targets.
// ─────────────────────────────────────────────────────────────────────────

const LEVEL_LABEL: CSSProperties = {
  display: 'block',
  fontSize: '0.72rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
  marginBottom: 6,
};

const TILE_WRAP: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const GRID_2: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'var(--space-3)',
};

const GRID_3: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 'var(--space-3)',
};

const TILE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  justifyContent: 'center',
  gap: 2,
  minHeight: 44,
  padding: '8px 12px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'transparent',
  color: 'var(--w14-ink)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: '0.86rem',
  cursor: 'pointer',
  textAlign: 'left',
};

const TILE_SELECTED: CSSProperties = {
  borderColor: 'var(--w14-accent, var(--w14-gold))',
  background: 'var(--w14-parchment-3)',
  fontWeight: 600,
};

const TILE_SUB: CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 400,
  color: 'var(--w14-ink-faded)',
  fontFamily: 'var(--w14-font-mono)',
};

const HIT_ROW: CSSProperties = {
  ...TILE,
  width: '100%',
  alignItems: 'stretch',
};

const HIT_PATH: CSSProperties = {
  fontSize: '0.74rem',
  color: 'var(--w14-ink-faded)',
};

const TRIGGER_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  width: '100%',
  minHeight: 48,
  padding: '0 12px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'transparent',
  fontFamily: 'var(--w14-font-body)',
  fontSize: '0.9rem',
  cursor: 'pointer',
  textAlign: 'left',
};

const PICKER_BOX: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: 12,
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-card)',
  background: 'var(--w14-parchment-2)',
};

const STAMP_BOX: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '12px 14px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-card)',
};

const CLEAR_BTN: CSSProperties = {
  minHeight: 44,
  padding: '0 14px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'transparent',
  color: 'var(--w14-wax-red)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: '0.84rem',
  cursor: 'pointer',
};

const QUIET_TEXT: CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--w14-ink-faded)',
  fontStyle: 'italic',
};
