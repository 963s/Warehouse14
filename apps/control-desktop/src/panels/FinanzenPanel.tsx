/**
 * FinanzenPanel — the Finanzen surface (digit 9). The owner's money view:
 * the monthly profit cascade (Umsatz − Ankauf − Ausgaben − Fixkosten =
 * Ergebnis), inventory value + unrealised margin, precious-metal holdings, and
 * the running expense + fixed-cost ledgers.
 *
 * Every figure is server-computed and read-only here: the P&L is
 * `GET /api/finance/profit`, values from `/api/inventory/*`, ledgers from
 * `/api/expenses` + `/api/fixed-costs`. All money on these routes is an INTEGER
 * number of EUR CENTS — formatted through the ui-kit `centsToEur` helper, never
 * recomputed client-side. Booking new expenses / fixed costs (ADMIN + PIN
 * step-up) lands as a follow-up; this pass is the honest overview.
 */

import { type CSSProperties, type ReactNode } from 'react';

import { useQuery } from '@tanstack/react-query';

import {
  type ExpenseCategory,
  expensesApi,
  financeApi,
  fixedCostsApi,
} from '@warehouse14/api-client';
import { DiamondRule, MoneyAmount, ParchmentCard, centsToEur } from '@warehouse14/ui-kit';

import { useApiClient } from '../api-context.js';
import { StatusDot } from '../components/StatusDot.js';

const CATEGORY_DE: Record<ExpenseCategory, string> = {
  WARENEINKAUF: 'Wareneinkauf',
  MIETE: 'Miete',
  MARKETING: 'Marketing',
  VERSAND: 'Versand',
  BUEROMATERIAL: 'Büromaterial',
  REPARATUR: 'Reparatur',
  GEBUEHREN: 'Gebühren',
  REISEKOSTEN: 'Reisekosten',
  SONSTIGES: 'Sonstiges',
};

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

/** ISO date (YYYY-MM-DD) → readable de-DE date. */
function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/** Grams with one decimal, de-DE, plus the unit. */
function formatGrams(g: number): string {
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(g)} g`;
}

/** A headline metric tile. */
function Kennzahl({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string | undefined;
}): JSX.Element {
  return (
    <ParchmentCard tone="parchment" padding="md" style={{ flex: '1 1 180px', minWidth: 180 }}>
      <div
        style={{
          fontSize: '0.72rem',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--w14-ink-faded)',
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 8, fontSize: '1.35rem', fontFamily: 'var(--w14-font-display)' }}>
        {children}
      </div>
      {hint ? (
        <div style={{ marginTop: 4, fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
          {hint}
        </div>
      ) : null}
    </ParchmentCard>
  );
}

/** One line in the profit cascade. */
function CascadeRow({
  label,
  cents,
  op,
  strong,
}: {
  label: string;
  cents: number;
  op: '+' | '−' | '=';
  strong?: boolean;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 16,
        padding: '9px 0',
        borderTop: op === '=' ? '1px solid var(--w14-ink-faded)' : '1px solid var(--w14-parchment-3)',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 10,
          fontFamily: 'var(--w14-font-display)',
          fontSize: strong ? '1.05rem' : '0.98rem',
          fontWeight: strong ? 600 : 400,
          color: strong ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 14, textAlign: 'center', color: 'var(--w14-ink-faded)' }}
        >
          {op}
        </span>
        {label}
      </span>
      <span style={{ fontWeight: strong ? 600 : 400 }}>
        <MoneyAmount valueEur={centsToEur(cents)} signed={op === '='} />
      </span>
    </div>
  );
}

export function FinanzenPanel(): JSX.Element {
  const { baseUrl, client } = useApiClient();

  const profit = useQuery({
    queryKey: ['finance', 'profit', 'month', baseUrl],
    queryFn: () => financeApi.profit(client, { period: 'month' }),
    staleTime: 60_000,
  });
  const inventory = useQuery({
    queryKey: ['finance', 'inventory-value', baseUrl],
    queryFn: () => financeApi.inventoryValue(client),
    staleTime: 60_000,
  });
  const metals = useQuery({
    queryKey: ['finance', 'metal-weights', baseUrl],
    queryFn: () => financeApi.metalWeights(client),
    staleTime: 60_000,
  });
  const expenses = useQuery({
    queryKey: ['finance', 'expenses', baseUrl],
    queryFn: () => expensesApi.list(client, { limit: 8 }),
    staleTime: 60_000,
  });
  const fixed = useQuery({
    queryKey: ['finance', 'fixed-costs', baseUrl],
    queryFn: () => fixedCostsApi.list(client, { activeOnly: true, limit: 20 }),
    staleTime: 60_000,
  });

  const p = profit.data;
  const inv = inventory.data;
  const marginCents =
    inv != null ? inv.listValueCents - inv.acquisitionValueCents : 0;

  const metalRows: Array<{ label: string; grams: number }> = metals.data
    ? [
        { label: 'Gold', grams: metals.data.goldGrams },
        { label: 'Silber', grams: metals.data.silverGrams },
        { label: 'Platin', grams: metals.data.platinumGrams },
        { label: 'Palladium', grams: metals.data.palladiumGrams },
      ]
    : [];

  return (
    <>
      <DiamondRule tone="gold" label="Finanzen" />
      <p style={{ ...captionStyle, marginTop: 8, marginBottom: 20, maxWidth: 640 }}>
        Gewinnrechnung des Monats, Lagerwert und Edelmetallbestand, sowie die laufenden Ausgaben und
        Fixkosten. Alle Beträge werden serverseitig berechnet.
      </p>

      {/* ── Gewinnrechnung (monthly profit cascade) ─────────────────────── */}
      <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 620, marginBottom: 20 }}>
        <div
          style={{
            fontSize: '0.72rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--w14-ink-faded)',
            marginBottom: 6,
          }}
        >
          Gewinnrechnung · laufender Monat
        </div>
        {profit.isLoading ? (
          <p style={captionStyle}>Lädt Gewinnrechnung …</p>
        ) : p ? (
          <div>
            <CascadeRow label="Umsatz (Verkauf)" cents={p.grossRevenueCents} op="+" />
            <CascadeRow label="Ankauf (Einkauf)" cents={-p.grossAnkaufCents} op="−" />
            <CascadeRow label="Ausgaben" cents={-p.expensesCents} op="−" />
            <CascadeRow label="Fixkosten (anteilig)" cents={-p.fixedCostsAllocatedCents} op="−" />
            <CascadeRow label="Ergebnis" cents={p.netProfitCents} op="=" strong />
          </div>
        ) : (
          <p style={captionStyle}>Gewinnrechnung derzeit nicht verfügbar.</p>
        )}
      </ParchmentCard>

      {/* ── Kennzahlen (inventory value + margin) ───────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20, maxWidth: 920 }}>
        <Kennzahl label="Lagerwert (Verkauf)" hint={inv ? `${inv.availableCount} Stück verfügbar` : undefined}>
          {inv ? <MoneyAmount valueEur={centsToEur(inv.listValueCents)} /> : '—'}
        </Kennzahl>
        <Kennzahl label="Einkaufswert">
          {inv ? <MoneyAmount valueEur={centsToEur(inv.acquisitionValueCents)} /> : '—'}
        </Kennzahl>
        <Kennzahl label="Unrealisierte Marge" hint="Lagerwert − Einkaufswert">
          {inv ? <MoneyAmount valueEur={centsToEur(marginCents)} signed /> : '—'}
        </Kennzahl>
      </div>

      {/* ── Edelmetall im Lager ─────────────────────────────────────────── */}
      <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920, marginBottom: 20 }}>
        <div
          style={{
            fontSize: '0.72rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--w14-ink-faded)',
            marginBottom: 10,
          }}
        >
          Edelmetall im Lager · Feingewicht
        </div>
        {metals.isLoading ? (
          <p style={captionStyle}>Lädt Edelmetallbestand …</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
            {metalRows.map((m) => (
              <div key={m.label} style={{ minWidth: 120 }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--w14-ink-faded)' }}>{m.label}</div>
                <div
                  style={{ fontFamily: 'var(--w14-font-display)', fontSize: '1.2rem', marginTop: 2 }}
                >
                  {formatGrams(m.grams)}
                </div>
              </div>
            ))}
          </div>
        )}
      </ParchmentCard>

      {/* ── Letzte Ausgaben ─────────────────────────────────────────────── */}
      <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920, marginBottom: 20 }}>
        <div
          style={{
            fontSize: '0.72rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--w14-ink-faded)',
            marginBottom: 6,
          }}
        >
          Letzte Ausgaben
        </div>
        {expenses.isLoading ? (
          <p style={captionStyle}>Lädt Ausgaben …</p>
        ) : (expenses.data?.items.length ?? 0) === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
            <StatusDot tone="info" size={10} />
            <p style={captionStyle}>Noch keine Ausgaben gebucht.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Datum</th>
                <th style={thStyle}>Kategorie</th>
                <th style={thStyle}>Notiz</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Betrag</th>
              </tr>
            </thead>
            <tbody>
              {expenses.data?.items.map((e) => (
                <tr key={e.id}>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDay(e.date)}</td>
                  <td style={tdStyle}>{CATEGORY_DE[e.category]}</td>
                  <td style={{ ...tdStyle, color: 'var(--w14-ink-faded)' }}>{e.note ?? '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <MoneyAmount valueEur={centsToEur(e.amountCents)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ParchmentCard>

      {/* ── Laufende Fixkosten ──────────────────────────────────────────── */}
      <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 920 }}>
        <div
          style={{
            fontSize: '0.72rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--w14-ink-faded)',
            marginBottom: 6,
          }}
        >
          Laufende Fixkosten · monatlich
        </div>
        {fixed.isLoading ? (
          <p style={captionStyle}>Lädt Fixkosten …</p>
        ) : (fixed.data?.items.length ?? 0) === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
            <StatusDot tone="info" size={10} />
            <p style={captionStyle}>Noch keine Fixkosten hinterlegt.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Bezeichnung</th>
                <th style={thStyle}>Aktiv seit</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Monatlich</th>
              </tr>
            </thead>
            <tbody>
              {fixed.data?.items.map((f) => (
                <tr key={f.id}>
                  <td style={{ ...tdStyle, fontFamily: 'var(--w14-font-display)' }}>{f.label}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: 'var(--w14-ink-faded)' }}>
                    {formatDay(f.activeFrom)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <MoneyAmount valueEur={centsToEur(f.monthlyAmountCents)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ParchmentCard>
    </>
  );
}
