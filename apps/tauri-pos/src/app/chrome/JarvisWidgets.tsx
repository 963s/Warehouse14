/**
 * JarvisWidgets — the dramatic on-screen cards Vierzehn paints while it speaks.
 *
 * `JarvisWidgetLayer` subscribes to the widget store and renders the ONE active
 * widget centered over the overlay hero band: a glass panel that slides + glows
 * in the active mode's colour, a headline number that counts up, and honest
 * German labels. Auto-dismisses after a few seconds or on the × / next tool call.
 *
 * Money is shown from the server's own German EUR strings (source of truth); the
 * count-up only animates the parsed magnitude, then settles on the exact string.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';

import {
  type JarvisWidget,
  dismissWidget,
  getWidgetSnapshot,
  subscribeWidget,
} from './jarvis-widget-store.js';

const AUTO_DISMISS_MS = 9500;

// ── number helpers ───────────────────────────────────────────────────────────

/**
 * Parse a money magnitude from EITHER a German-formatted string ("1.234,56 EUR",
 * dot=thousands, comma=decimal — from finance_overview) OR a plain SQL decimal
 * ("12480.00", dot=decimal — from sales_report / situation_report / metal prices).
 * Heuristic: a comma means German; no comma means a plain decimal.
 */
function parseEuroMagnitude(s?: string | null): number {
  if (!s) return 0;
  let t = s.replace(/[^\d.,-]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/** German EUR from a numeric magnitude, so every card reads consistently. */
function formatEur(n: number): string {
  return `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} EUR`;
}

/** Animate 0 → target with an ease-out cubic; returns the live value. */
function useCountUp(target: number, ms = 950): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start = 0;
    const tick = (t: number): void => {
      if (start === 0) start = t;
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setV(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function fmtInt(n: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(Math.round(n));
}

const STATUS_DE: Record<string, string> = {
  DRAFT: 'Entwurf',
  AVAILABLE: 'Verfügbar',
  RESERVED: 'Reserviert',
  SOLD: 'Verkauft',
};
const TRUST_DE: Record<string, string> = {
  NEW: 'Neu',
  VERIFIED: 'Verifiziert',
  VIP: 'VIP',
  SUSPICIOUS: 'Auffällig',
  BANNED: 'Gesperrt',
};
const PERIOD_DE: Record<string, string> = {
  today: 'heute',
  last7days: 'letzte 7 Tage',
  last30days: 'letzte 30 Tage',
  thismonth: 'dieser Monat',
};

interface Palette {
  primary: string;
  secondary: string;
}

// ── shared bits ──────────────────────────────────────────────────────────────

function Eyebrow({ children, color }: { children: string; color: string }): JSX.Element {
  return (
    <div
      style={{
        fontFamily: 'var(--w14-font-mono, ui-monospace, monospace)',
        fontSize: '0.66rem',
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: `${color}cc`,
      }}
    >
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string | undefined;
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <span
        style={{
          fontFamily: 'var(--w14-font-mono, monospace)',
          fontSize: '0.62rem',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'rgba(236,241,247,0.55)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--w14-font-body, system-ui, sans-serif)',
          fontSize: '1.35rem',
          fontWeight: 600,
          color: accent ?? '#eef4fb',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ── the individual widget bodies ─────────────────────────────────────────────

function RevenueCard({ data, pal }: { data: JarvisWidget['data'] & Record<string, unknown>; pal: Palette }): JSX.Element {
  const revenueStr = String((data as Record<string, unknown>).verkaufRevenueEur ?? '0');
  const magnitude = parseEuroMagnitude(revenueStr);
  const live = useCountUp(magnitude);
  const done = Math.abs(live - magnitude) < 0.5;
  const vCount = Number((data as Record<string, unknown>).verkaufCount ?? 0);
  const ankStr = String((data as Record<string, unknown>).ankaufValueEur ?? '0');
  const aCount = Number((data as Record<string, unknown>).ankaufCount ?? 0);
  const period = PERIOD_DE[String((data as Record<string, unknown>).period ?? '')] ?? '';
  return (
    <div style={{ display: 'grid', gap: 16, justifyItems: 'center', textAlign: 'center' }}>
      <Eyebrow color={pal.primary}>{`Umsatz${period ? ` · ${period}` : ''}`}</Eyebrow>
      <div
        style={{
          fontFamily: 'var(--w14-font-mono, monospace)',
          fontSize: 'clamp(2.8rem, 8vw, 5rem)',
          fontWeight: 700,
          lineHeight: 1,
          color: pal.secondary,
          textShadow: `0 0 34px ${pal.primary}88`,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {done ? formatEur(magnitude) : `${fmtInt(live)} EUR`}
      </div>
      <div style={{ display: 'flex', gap: 34, marginTop: 4 }}>
        <Stat label="Verkäufe" value={String(vCount)} accent={pal.primary} />
        <Stat label="Ankauf" value={formatEur(parseEuroMagnitude(ankStr))} />
        <Stat label="Ankäufe" value={String(aCount)} />
      </div>
    </div>
  );
}

function DaySummaryCard({ data, pal }: { data: Record<string, unknown>; pal: Palette }): JSX.Element {
  const metals = (data.metalPricesEurPerGram ?? {}) as Record<string, string | null>;
  const metalRow: Array<[string, string | null]> = [
    ['Gold', metals.gold ?? null],
    ['Silber', metals.silver ?? null],
    ['Platin', metals.platinum ?? null],
    ['Palladium', metals.palladium ?? null],
  ];
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <Eyebrow color={pal.primary}>Stand des Tages</Eyebrow>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0,1fr))',
          gap: '16px 34px',
        }}
      >
        <Stat label="Umsatz offene Schicht" value={formatEur(parseEuroMagnitude(String(data.openShiftRevenueEur ?? '0')))} accent={pal.secondary} />
        <Stat label="Aufgaben heute" value={String(data.tasksDueToday ?? 0)} />
        <Stat label="Überfällig" value={String(data.tasksOverdue ?? 0)} accent={Number(data.tasksOverdue ?? 0) > 0 ? '#f0a091' : undefined} />
        <Stat label="Offene Bewertungen" value={String(data.pendingAppraisals ?? 0)} />
      </div>
      <div style={{ height: 1, background: `${pal.primary}33` }} />
      <div style={{ display: 'grid', gap: 8 }}>
        <Eyebrow color={pal.primary}>Metalle · EUR/Gramm</Eyebrow>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {metalRow.map(([name, val]) => (
            <div
              key={name}
              style={{
                flex: '1 1 110px',
                padding: '10px 12px',
                borderRadius: 12,
                border: `1px solid ${pal.primary}33`,
                background: 'rgba(255,255,255,0.03)',
                display: 'grid',
                gap: 2,
              }}
            >
              <span style={{ fontSize: '0.66rem', letterSpacing: '0.1em', color: 'rgba(236,241,247,0.6)' }}>
                {name}
              </span>
              <span
                style={{
                  fontFamily: 'var(--w14-font-mono, monospace)',
                  fontSize: '1.05rem',
                  fontWeight: 600,
                  color: val ? pal.secondary : 'rgba(236,241,247,0.4)',
                }}
              >
                {val
                  ? `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseEuroMagnitude(val))} €`
                  : 'k. A.'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FinanceCard({ data, pal }: { data: Record<string, unknown>; pal: Palette }): JSX.Element {
  const resultStr = String(data.resultEur ?? '0');
  const negative = resultStr.trim().startsWith('-');
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Eyebrow color={pal.primary}>Finanzen</Eyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '14px 34px' }}>
        <Stat label="Umsatz" value={formatEur(parseEuroMagnitude(String(data.revenueEur ?? '0')))} accent={pal.secondary} />
        <Stat label="Wareneinkauf" value={formatEur(parseEuroMagnitude(String(data.wareneinkaufEur ?? '0')))} />
        <Stat label="Ausgaben" value={formatEur(parseEuroMagnitude(String(data.expensesEur ?? '0')))} />
        <Stat label="Fixkosten (anteilig)" value={formatEur(parseEuroMagnitude(String(data.fixedCostsAllocatedEur ?? '0')))} />
      </div>
      <div style={{ height: 1, background: `${pal.primary}33` }} />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <Eyebrow color={pal.primary}>Ergebnis (grob)</Eyebrow>
        <span
          style={{
            fontFamily: 'var(--w14-font-mono, monospace)',
            fontSize: 'clamp(1.6rem, 4vw, 2.4rem)',
            fontWeight: 700,
            color: negative ? '#f0a091' : pal.secondary,
            textShadow: `0 0 22px ${(negative ? '#f0a091' : pal.primary)}66`,
          }}
        >
          {formatEur(parseEuroMagnitude(resultStr))}
        </span>
      </div>
    </div>
  );
}

function ProductCard({ data, pal }: { data: Record<string, unknown>; pal: Palette }): JSX.Element {
  const status = String(data.status ?? '');
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Eyebrow color={pal.primary}>Artikel</Eyebrow>
      <div
        style={{
          fontFamily: 'var(--w14-font-display, Georgia, serif)',
          fontSize: 'clamp(1.4rem, 4vw, 2rem)',
          fontWeight: 600,
          color: pal.secondary,
          lineHeight: 1.15,
        }}
      >
        {String(data.name ?? 'Ohne Namen')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '14px 34px' }}>
        <Stat label="Artikelnummer" value={String(data.sku ?? 'k. A.')} />
        <Stat label="Status" value={STATUS_DE[status] ?? status ?? 'k. A.'} accent={pal.primary} />
        <Stat label="Listenpreis" value={data.listPriceEur ? formatEur(parseEuroMagnitude(String(data.listPriceEur))) : 'k. A.'} accent={pal.secondary} />
        <Stat label="Standort" value={data.location ? String(data.location) : 'k. A.'} />
      </div>
      {data.categoryName ? (
        <span style={{ fontSize: '0.8rem', color: 'rgba(236,241,247,0.6)' }}>
          Sammlung: {String(data.categoryName)}
        </span>
      ) : null}
    </div>
  );
}

function CustomerCard({ data, pal }: { data: Record<string, unknown>; pal: Palette }): JSX.Element {
  const trust = String(data.trustLevel ?? 'NEW');
  const flagged = trust === 'SUSPICIOUS' || trust === 'BANNED';
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Eyebrow color={pal.primary}>Kunde</Eyebrow>
      <div
        style={{
          fontFamily: 'var(--w14-font-display, Georgia, serif)',
          fontSize: 'clamp(1.4rem, 4vw, 2rem)',
          fontWeight: 600,
          color: pal.secondary,
        }}
      >
        {String(data.displayName ?? 'Ohne Namen')}
      </div>
      <div style={{ display: 'flex', gap: 34 }}>
        <Stat label="Telefon" value={data.phone ? String(data.phone) : 'k. A.'} />
        <Stat label="Vertrauensstufe" value={TRUST_DE[trust] ?? trust} accent={flagged ? '#f0a091' : pal.primary} />
      </div>
    </div>
  );
}

function AgendaCard({ data, pal }: { data: Record<string, unknown>; pal: Palette }): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Eyebrow color={pal.primary}>Was ansteht</Eyebrow>
      <div style={{ display: 'flex', gap: 40, justifyContent: 'center' }}>
        <div style={{ display: 'grid', justifyItems: 'center', gap: 4 }}>
          <span style={{ fontFamily: 'var(--w14-font-mono, monospace)', fontSize: '3rem', fontWeight: 700, color: pal.secondary, textShadow: `0 0 24px ${pal.primary}66` }}>
            {String(data.appointmentsUpcoming ?? 0)}
          </span>
          <span style={{ fontSize: '0.72rem', letterSpacing: '0.1em', color: 'rgba(236,241,247,0.6)' }}>Termine</span>
        </div>
        <div style={{ display: 'grid', justifyItems: 'center', gap: 4 }}>
          <span style={{ fontFamily: 'var(--w14-font-mono, monospace)', fontSize: '3rem', fontWeight: 700, color: pal.secondary, textShadow: `0 0 24px ${pal.primary}66` }}>
            {String(data.openTasks ?? 0)}
          </span>
          <span style={{ fontSize: '0.72rem', letterSpacing: '0.1em', color: 'rgba(236,241,247,0.6)' }}>Offene Aufgaben</span>
        </div>
      </div>
    </div>
  );
}

/** A row of the catalog browse: the answer to „zeig mir die Produkte". */
function ProductListCard({ data, pal }: { data: Record<string, unknown>; pal: Palette }): JSX.Element {
  const rows = Array.isArray(data.products) ? (data.products as Array<Record<string, unknown>>) : [];
  const shown = rows.slice(0, 6);
  const count = Number(data.count ?? rows.length);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Eyebrow color={pal.primary}>{`Artikel · ${fmtInt(count)} gefunden`}</Eyebrow>
      <div style={{ display: 'grid', gap: 7 }}>
        {shown.map((r, i) => {
          const meta = [r.statusDe, r.itemTypeDe].filter(Boolean).map(String).join(' · ');
          const live = [r.liveWeb ? 'Webshop' : null, r.liveEbay ? 'eBay' : null].filter(Boolean).join(' + ');
          return (
            <div
              key={String(r.sku ?? i)}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 14,
                borderBottom: '1px solid rgba(236,241,247,0.08)',
                paddingBottom: 6,
              }}
            >
              <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <span
                  style={{
                    fontFamily: 'var(--w14-font-body, system-ui, sans-serif)',
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: '#eef4fb',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {String(r.name ?? '')}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--w14-font-mono, monospace)',
                    fontSize: '0.6rem',
                    letterSpacing: '0.08em',
                    color: 'rgba(236,241,247,0.45)',
                  }}
                >
                  {live ? `${meta} · live ${live}` : meta}
                </span>
              </div>
              <span
                style={{
                  fontFamily: 'var(--w14-font-mono, monospace)',
                  fontSize: '1rem',
                  fontWeight: 700,
                  color: pal.secondary,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatEur(parseEuroMagnitude(String(r.listPriceEur ?? '0')))}
              </span>
            </div>
          );
        })}
      </div>
      {count > shown.length ? (
        <span style={{ fontSize: '0.68rem', color: 'rgba(236,241,247,0.5)' }}>
          {`und ${fmtInt(count - shown.length)} weitere`}
        </span>
      ) : null}
    </div>
  );
}

/** Stock at a glance: the hero number is the catalog, the value counts up. */
function InventoryCard({ data, pal }: { data: Record<string, unknown>; pal: Palette }): JSX.Element {
  const value = parseEuroMagnitude(String(data.availableValueEur ?? '0'));
  const live = useCountUp(value);
  const done = Math.abs(live - value) < 0.5;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Eyebrow color={pal.primary}>Bestand</Eyebrow>
      <div style={{ display: 'grid', justifyItems: 'center', gap: 2 }}>
        <span
          style={{
            fontFamily: 'var(--w14-font-mono, monospace)',
            fontSize: '2.6rem',
            fontWeight: 700,
            color: pal.secondary,
            textShadow: `0 0 26px ${pal.primary}66`,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {done ? formatEur(value) : `${fmtInt(live)} EUR`}
        </span>
        <span style={{ fontSize: '0.68rem', letterSpacing: '0.1em', color: 'rgba(236,241,247,0.55)' }}>
          Wert verfügbarer Ware
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
        <Stat label="Im Katalog" value={fmtInt(Number(data.totalActive ?? 0))} />
        <Stat label="Verfügbar" value={fmtInt(Number(data.availableCount ?? 0))} accent={pal.secondary} />
        <Stat label="Reserviert" value={fmtInt(Number(data.reservedCount ?? 0))} />
        <Stat label="Verkauft" value={fmtInt(Number(data.soldCount ?? 0))} />
        <Stat label="Live im Webshop" value={fmtInt(Number(data.publishedCount ?? 0))} />
        <Stat label="Live bei eBay" value={fmtInt(Number(data.ebayCount ?? 0))} />
      </div>
    </div>
  );
}

/** What sells: revenue hero plus proportional category bars. */
function SalesBreakdownCard({ data, pal }: { data: Record<string, unknown>; pal: Palette }): JSX.Element {
  const revenue = parseEuroMagnitude(String(data.totalRevenueEur ?? '0'));
  const live = useCountUp(revenue);
  const done = Math.abs(live - revenue) < 0.5;
  const cats = (Array.isArray(data.byItemType) ? (data.byItemType as Array<Record<string, unknown>>) : []).slice(0, 4);
  const max = Math.max(...cats.map((c) => parseEuroMagnitude(String(c.revenueEur ?? '0'))), 1);
  const periodDe = PERIOD_DE[String(data.period ?? '')] ?? '';
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Eyebrow color={pal.primary}>{`Verkäufe${periodDe ? ` · ${periodDe}` : ''}`}</Eyebrow>
      <div style={{ display: 'grid', justifyItems: 'center', gap: 2 }}>
        <span
          style={{
            fontFamily: 'var(--w14-font-mono, monospace)',
            fontSize: '2.4rem',
            fontWeight: 700,
            color: pal.secondary,
            textShadow: `0 0 26px ${pal.primary}66`,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {done ? formatEur(revenue) : `${fmtInt(live)} EUR`}
        </span>
        <span style={{ fontSize: '0.68rem', letterSpacing: '0.1em', color: 'rgba(236,241,247,0.55)' }}>
          {`${fmtInt(Number(data.saleCount ?? 0))} Verkäufe · Ø ${formatEur(parseEuroMagnitude(String(data.avgSaleEur ?? '0')))}`}
        </span>
      </div>
      <div style={{ display: 'grid', gap: 7 }}>
        {cats.map((c, i) => {
          const v = parseEuroMagnitude(String(c.revenueEur ?? '0'));
          return (
            <div key={`${String(c.itemTypeDe ?? i)}`} style={{ display: 'grid', gap: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: '0.78rem', color: 'rgba(236,241,247,0.8)' }}>
                  {`${String(c.itemTypeDe ?? '')} · ${fmtInt(Number(c.units ?? 0))}`}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--w14-font-mono, monospace)',
                    fontSize: '0.78rem',
                    color: pal.secondary,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatEur(v)}
                </span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'rgba(236,241,247,0.08)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.max(3, (v / max) * 100)}%`,
                    height: '100%',
                    background: `linear-gradient(90deg, ${pal.primary}, ${pal.secondary})`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Cross-channel board: eBay, WhatsApp, documents, appraisals, web orders. */
function ChannelsCard({ data, pal }: { data: Record<string, unknown>; pal: Palette }): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Eyebrow color={pal.primary}>Kanäle</Eyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12 }}>
        <Stat label="eBay online" value={fmtInt(Number(data.ebayOnline ?? 0))} accent={pal.secondary} />
        <Stat label="Zu versenden" value={fmtInt(Number(data.ebayToShip ?? 0))} />
        <Stat label="Reklamation" value={fmtInt(Number(data.ebayProblem ?? 0))} />
        <Stat
          label="WhatsApp offen"
          value={fmtInt(Number(data.whatsappUnhandledThreads ?? 0))}
          accent={Number(data.whatsappUnhandledThreads ?? 0) > 0 ? pal.secondary : undefined}
        />
        <Stat label="Dokumente" value={fmtInt(Number(data.documentsTotal ?? 0))} />
        <Stat label="Bewertungen" value={fmtInt(Number(data.pendingAppraisals ?? 0))} />
        <Stat label="Abholaufträge" value={fmtInt(Number(data.openStorefrontOrders ?? 0))} />
        <Stat label="Im Bezahlen" value={fmtInt(Number(data.checkoutInProgress ?? 0))} />
      </div>
    </div>
  );
}

/** Best buyers, by customer number: never a name (that stays in find_customer). */
function TopCustomersCard({ data, pal }: { data: Record<string, unknown>; pal: Palette }): JSX.Element {
  const rows = (Array.isArray(data.customers) ? (data.customers as Array<Record<string, unknown>>) : []).slice(0, 5);
  const total = Number(data.totalWithRevenue ?? rows.length);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Eyebrow color={pal.primary}>{`Beste Kunden · ${fmtInt(total)} mit Umsatz`}</Eyebrow>
      <div style={{ display: 'grid', gap: 7 }}>
        {rows.map((c, i) => (
          <div
            key={String(c.customerNumber ?? i)}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 14,
              borderBottom: '1px solid rgba(236,241,247,0.08)',
              paddingBottom: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
              <span
                style={{
                  fontFamily: 'var(--w14-font-mono, monospace)',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  color: pal.primary,
                }}
              >
                {String(c.rank ?? i + 1)}
              </span>
              <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <span
                  style={{
                    fontFamily: 'var(--w14-font-mono, monospace)',
                    fontSize: '0.85rem',
                    color: '#eef4fb',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {String(c.customerNumber ?? '')}
                </span>
                <span style={{ fontSize: '0.6rem', letterSpacing: '0.08em', color: 'rgba(236,241,247,0.45)' }}>
                  {String(c.trustLevelDe ?? '')}
                </span>
              </div>
            </div>
            <span
              style={{
                fontFamily: 'var(--w14-font-mono, monospace)',
                fontSize: '1rem',
                fontWeight: 700,
                color: pal.secondary,
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
              }}
            >
              {formatEur(parseEuroMagnitude(String(c.cumulativeSpendEur ?? '0')))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The customer base at a glance: counts only, never a name. */
function CustomerBaseCard({ data, pal }: { data: Record<string, unknown>; pal: Palette }): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Eyebrow color={pal.primary}>Kundenstamm</Eyebrow>
      <div style={{ display: 'grid', justifyItems: 'center', gap: 2 }}>
        <span
          style={{
            fontFamily: 'var(--w14-font-mono, monospace)',
            fontSize: '2.6rem',
            fontWeight: 700,
            color: pal.secondary,
            textShadow: `0 0 26px ${pal.primary}66`,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fmtInt(Number(data.totalActive ?? 0))}
        </span>
        <span style={{ fontSize: '0.68rem', letterSpacing: '0.1em', color: 'rgba(236,241,247,0.55)' }}>
          aktive Kunden
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
        <Stat label="Mit Umsatz" value={fmtInt(Number(data.buyers ?? 0))} accent={pal.secondary} />
        <Stat label="Mit Ankauf" value={fmtInt(Number(data.sellers ?? 0))} />
        <Stat label="KYC verifiziert" value={fmtInt(Number(data.kycVerified ?? 0))} />
        <Stat label="Beobachtungsliste" value={fmtInt(Number(data.watchlist ?? 0))} />
        <Stat label="Umsatz gesamt" value={formatEur(parseEuroMagnitude(String(data.totalSpendEur ?? '0')))} />
        <Stat label="Ankauf gesamt" value={formatEur(parseEuroMagnitude(String(data.totalAnkaufEur ?? '0')))} />
      </div>
    </div>
  );
}

function WidgetBody({ widget, pal }: { widget: JarvisWidget; pal: Palette }): JSX.Element {
  switch (widget.kind) {
    case 'revenue':
      return <RevenueCard data={widget.data as Record<string, unknown>} pal={pal} />;
    case 'daySummary':
      return <DaySummaryCard data={widget.data as Record<string, unknown>} pal={pal} />;
    case 'finance':
      return <FinanceCard data={widget.data as Record<string, unknown>} pal={pal} />;
    case 'product':
      return <ProductCard data={widget.data as Record<string, unknown>} pal={pal} />;
    case 'customer':
      return <CustomerCard data={widget.data as Record<string, unknown>} pal={pal} />;
    case 'agenda':
      return <AgendaCard data={widget.data as Record<string, unknown>} pal={pal} />;
    case 'productList':
      return <ProductListCard data={widget.data as Record<string, unknown>} pal={pal} />;
    case 'inventory':
      return <InventoryCard data={widget.data as Record<string, unknown>} pal={pal} />;
    case 'salesBreakdown':
      return <SalesBreakdownCard data={widget.data as Record<string, unknown>} pal={pal} />;
    case 'channels':
      return <ChannelsCard data={widget.data as Record<string, unknown>} pal={pal} />;
    case 'topCustomers':
      return <TopCustomersCard data={widget.data as Record<string, unknown>} pal={pal} />;
    case 'customerBase':
      return <CustomerBaseCard data={widget.data as Record<string, unknown>} pal={pal} />;
  }
}

// ── the layer ────────────────────────────────────────────────────────────────

export function JarvisWidgetLayer({ primary, secondary }: Palette): JSX.Element | null {
  const widget = useSyncExternalStore(subscribeWidget, getWidgetSnapshot, getWidgetSnapshot);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!widget) return;
    setEntered(false);
    const raf = requestAnimationFrame(() => setEntered(true));
    const timer = window.setTimeout(() => dismissWidget(), AUTO_DISMISS_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [widget]);

  if (!widget) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
        zIndex: 3,
        padding: 16,
      }}
    >
      <div
        role="status"
        style={{
          pointerEvents: 'auto',
          position: 'relative',
          width: 'min(620px, 92vw)',
          padding: '30px 34px',
          borderRadius: 20,
          border: `1px solid ${primary}55`,
          background: `linear-gradient(180deg, ${primary}18, rgba(5,7,11,0.9) 70%)`,
          backdropFilter: 'blur(12px)',
          boxShadow: `0 0 66px ${primary}44, 0 26px 64px rgba(0,0,0,0.6)`,
          opacity: entered ? 1 : 0,
          transform: entered ? 'translateY(0) scale(1)' : 'translateY(18px) scale(0.95)',
          transition:
            'opacity 460ms cubic-bezier(0.2,0.8,0.2,1), transform 460ms cubic-bezier(0.2,0.8,0.2,1)',
        }}
      >
        <WidgetBody widget={widget} pal={{ primary, secondary }} />
        <button
          type="button"
          aria-label="Anzeige schließen"
          onClick={() => dismissWidget()}
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            width: 30,
            height: 30,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'transparent',
            color: `${secondary}bb`,
            fontSize: '1rem',
            lineHeight: 1,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
