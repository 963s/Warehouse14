/**
 * Finanzen — Tier-2 Gewinnrechnung, Lagerwert und Ausgaben.
 *
 * Vier Endpunkte, die es im api-client seit langem gibt und die im Kassen-
 * programm bisher niemand gelesen hat: `/api/finance/profit`,
 * `/api/inventory/value`, `/api/inventory/metal-weights` und `/api/expenses`
 * (samt `/api/fixed-costs`).
 *
 * Zwei Regeln tragen diesen Bildschirm:
 *
 *   1. Der Server rechnet, nicht wir. Das Ergebnis der Gewinnrechnung steht so,
 *      wie es geliefert wurde. Wir summieren die Posten nicht nach und tun auch
 *      nicht so, als hätten wir sie geprüft.
 *   2. Ein fehlgeschlagener Aufruf zeigt einen Fehler, keine Null. Eine Null
 *      bedeutet „kein Umsatz", und das ist etwas völlig anderes als „nicht
 *      geladen".
 *
 * Alle Beträge kommen als ganze Cent vom Server und werden erst bei der Anzeige
 * geteilt. Das Anlegen von Ausgaben und Fixkosten verlangt ADMIN und eine
 * PIN-Bestätigung und ist noch nicht Teil dieses Bildschirms; die Liste ist es.
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import {
  type FinancePeriod,
  expensesApi,
  financeApi,
  fixedCostsApi,
} from '@warehouse14/api-client';
import {
  FINANCE_PERIOD_LABELS,
  centsToDecimalString,
  expenseCategoryLabel,
  formatCents,
  formatGrams,
  profitSteps,
} from '@warehouse14/i18n-de';
import { DiamondRule, MoneyAmount, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';

const PERIODS: readonly FinancePeriod[] = ['day', 'month'];

export function Finanzen(): JSX.Element {
  const api = useApiClient();
  const [period, setPeriod] = useState<FinancePeriod>('day');

  const profitQ = useQuery({
    queryKey: ['finance', 'profit', period],
    queryFn: () => financeApi.profit(api, { period }),
    staleTime: 30_000,
  });

  const inventoryQ = useQuery({
    queryKey: ['finance', 'inventory-value'],
    queryFn: () => financeApi.inventoryValue(api),
    staleTime: 60_000,
  });

  const metalsQ = useQuery({
    queryKey: ['finance', 'metal-weights'],
    queryFn: () => financeApi.metalWeights(api),
    staleTime: 60_000,
  });

  const expensesQ = useQuery({
    queryKey: ['finance', 'expenses', { limit: 25 }],
    queryFn: () => expensesApi.list(api, { limit: 25 }),
    staleTime: 30_000,
  });

  const fixedQ = useQuery({
    queryKey: ['finance', 'fixed-costs'],
    queryFn: () => fixedCostsApi.list(api, { activeOnly: true, limit: 25 }),
    staleTime: 60_000,
  });

  return (
    <section
      aria-label="Finanzen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 20,
        gap: 14,
        overflowY: 'auto',
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
          Finanzen
        </h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className="w14-smallcaps"
              style={{
                fontSize: '0.74rem',
                letterSpacing: '0.08em',
                padding: '4px 12px',
                cursor: 'pointer',
                borderRadius: 'var(--w14-radius-button)',
                border: `1px solid ${period === p ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
                background: period === p ? 'var(--w14-parchment-3)' : 'transparent',
                color: period === p ? 'var(--w14-gold)' : 'var(--w14-ink-aged)',
              }}
            >
              {FINANCE_PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </header>

      <DiamondRule />

      {/* ── Gewinnrechnung ─────────────────────────────────────────────── */}
      <ParchmentCard padding="md">
        <DiamondRule label={`Gewinnrechnung · ${FINANCE_PERIOD_LABELS[period]}`} />
        {profitQ.isLoading ? (
          <Lade />
        ) : profitQ.isError || !profitQ.data ? (
          <Fehler was="Die Gewinnrechnung" />
        ) : (
          <div style={{ display: 'grid', gap: 2, marginTop: 8 }}>
            {profitSteps(profitQ.data).map((step) => (
              <div
                key={step.label}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'baseline',
                  gap: 12,
                  padding: '8px 0',
                  borderTop: step.isResult ? '1px solid var(--w14-rule)' : undefined,
                  marginTop: step.isResult ? 6 : 0,
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: 'var(--w14-font-display)',
                      fontSize: step.isResult ? '1.05rem' : '0.95rem',
                      fontWeight: step.isResult ? 600 : 500,
                    }}
                  >
                    {step.label}
                  </div>
                  <div
                    style={{ fontSize: '0.74rem', color: 'var(--w14-ink-faded)', lineHeight: 1.4 }}
                  >
                    {step.hint}
                  </div>
                </div>
                <MoneyAmount
                  valueEur={centsToDecimalString(step.cents)}
                  signed
                  {...(step.isResult ? { emphasis: true } : {})}
                />
              </div>
            ))}
          </div>
        )}
      </ParchmentCard>

      {/* ── Lagerwert + Metallgewichte ─────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 12,
        }}
      >
        <ParchmentCard padding="md">
          <DiamondRule label="Lagerwert" />
          {inventoryQ.isLoading ? (
            <Lade />
          ) : inventoryQ.isError || !inventoryQ.data ? (
            <Fehler was="Der Lagerwert" />
          ) : (
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              <Zeile
                label="Verkaufswert"
                wert={formatCents(inventoryQ.data.listValueCents)}
                hinweis="Summe der Verkaufspreise verfügbarer Artikel."
              />
              <Zeile
                label="Einkaufswert"
                wert={formatCents(inventoryQ.data.acquisitionValueCents)}
                hinweis="Was diese Artikel im Einkauf gekostet haben."
              />
              <Zeile
                label="Artikel verfügbar"
                wert={inventoryQ.data.availableCount.toLocaleString('de-DE')}
                hinweis="Nur verkaufsbereite Stücke, ohne Entwürfe."
              />
            </div>
          )}
        </ParchmentCard>

        <ParchmentCard padding="md">
          <DiamondRule label="Edelmetall im Lager" />
          {metalsQ.isLoading ? (
            <Lade />
          ) : metalsQ.isError || !metalsQ.data ? (
            <Fehler was="Die Metallgewichte" />
          ) : (
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              <Zeile label="Gold" wert={formatGrams(metalsQ.data.goldGrams)} />
              <Zeile label="Silber" wert={formatGrams(metalsQ.data.silverGrams)} />
              <Zeile label="Platin" wert={formatGrams(metalsQ.data.platinumGrams)} />
              <Zeile label="Palladium" wert={formatGrams(metalsQ.data.palladiumGrams)} />
            </div>
          )}
        </ParchmentCard>
      </div>

      {/* ── Ausgaben ───────────────────────────────────────────────────── */}
      <ParchmentCard padding="md">
        <DiamondRule label="Letzte Ausgaben" />
        {expensesQ.isLoading ? (
          <Lade />
        ) : expensesQ.isError || !expensesQ.data ? (
          <Fehler was="Die Ausgaben" />
        ) : expensesQ.data.items.length === 0 ? (
          <Leer text="Für diesen Zeitraum ist keine Ausgabe gebucht." />
        ) : (
          <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 2 }}>
            {expensesQ.data.items.map((row) => (
              <li
                key={row.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '110px 1fr auto',
                  gap: 12,
                  alignItems: 'baseline',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--w14-rule)',
                }}
              >
                <span
                  className="w14-tabular"
                  style={{
                    fontFamily: 'var(--w14-font-mono)',
                    fontSize: '0.76rem',
                    color: 'var(--w14-ink-faded)',
                  }}
                >
                  {new Date(row.date).toLocaleDateString('de-DE')}
                </span>
                <span style={{ fontSize: '0.9rem' }}>
                  {expenseCategoryLabel(row.category)}
                  {row.note && (
                    <span style={{ color: 'var(--w14-ink-faded)' }}> · {row.note}</span>
                  )}
                </span>
                <MoneyAmount valueEur={centsToDecimalString(-row.amountCents)} signed />
              </li>
            ))}
          </ul>
        )}
        <p style={{ margin: '10px 0 0', fontSize: '0.76rem', color: 'var(--w14-ink-faded)' }}>
          Ausgaben bucht die Ladenleitung. Dieser Bildschirm zeigt sie nur.
        </p>
      </ParchmentCard>

      {/* ── Fixkosten ──────────────────────────────────────────────────── */}
      <ParchmentCard padding="md">
        <DiamondRule label="Laufende Fixkosten" />
        {fixedQ.isLoading ? (
          <Lade />
        ) : fixedQ.isError || !fixedQ.data ? (
          <Fehler was="Die Fixkosten" />
        ) : fixedQ.data.items.length === 0 ? (
          <Leer text="Es sind keine laufenden Fixkosten hinterlegt." />
        ) : (
          <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 2 }}>
            {fixedQ.data.items.map((row) => (
              <li
                key={row.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 12,
                  alignItems: 'baseline',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--w14-rule)',
                }}
              >
                <span style={{ fontSize: '0.9rem' }}>
                  {row.label}
                  <span style={{ color: 'var(--w14-ink-faded)', fontSize: '0.76rem' }}>
                    {' '}
                    · seit {new Date(row.activeFrom).toLocaleDateString('de-DE')}
                  </span>
                </span>
                <span className="w14-tabular" style={{ fontFamily: 'var(--w14-font-mono)' }}>
                  {formatCents(row.monthlyAmountCents)} / Monat
                </span>
              </li>
            ))}
          </ul>
        )}
      </ParchmentCard>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Kleinteile
// ════════════════════════════════════════════════════════════════════════

function Zeile({
  label,
  wert,
  hinweis,
}: {
  label: string;
  wert: string;
  hinweis?: string;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 12,
        alignItems: 'baseline',
        padding: '4px 0',
      }}
    >
      <div>
        <div style={{ fontSize: '0.9rem' }}>{label}</div>
        {hinweis && (
          <div style={{ fontSize: '0.72rem', color: 'var(--w14-ink-faded)', lineHeight: 1.4 }}>
            {hinweis}
          </div>
        )}
      </div>
      <span className="w14-tabular" style={{ fontFamily: 'var(--w14-font-mono)' }}>
        {wert}
      </span>
    </div>
  );
}

function Lade(): JSX.Element {
  return (
    <p style={{ margin: '8px 0 0', color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>Lädt…</p>
  );
}

/**
 * Ein gescheiterter Aufruf zeigt nie eine Null. „0,00 €" hieße „kein Umsatz",
 * und das wäre gelogen, solange wir die Zahl gar nicht kennen.
 */
function Fehler({ was }: { was: string }): JSX.Element {
  return (
    <p role="alert" style={{ margin: '8px 0 0', color: 'var(--w14-wax-red)', fontSize: '0.88rem' }}>
      {was} konnte nicht geladen werden. Die Zahl ist unbekannt, nicht null.
    </p>
  );
}

function Leer({ text }: { text: string }): JSX.Element {
  return (
    <p style={{ margin: '8px 0 0', color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>{text}</p>
  );
}
