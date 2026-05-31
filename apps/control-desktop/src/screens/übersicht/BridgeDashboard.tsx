/**
 * BridgeDashboard — the Übersicht surface (digit 1) of the Owner Control Desktop.
 *
 * Three-column layout per ADR-0019 §1:
 *   LEFT  — StatusDot + watch items (TSE cert, DLQ) + location caption
 *   CENTER — 2-col StatTile grid (6 tiles) covering queues + appointments
 *   RIGHT  — Today's revenue (Umsatz + Ankauf)
 *
 * Constraints:
 *   • No backdrop-blur (memory.md §5 salon-Mac performance rule)
 *   • Colors: red/yellow/green for STATUS only, never decorative (ADR-0019 §10)
 *   • No spinner — loading state uses DiamondRule label="Lade …"
 *   • Polls every 30 s; clears interval on unmount
 *   • All CSS via inline style objects + var(--w14-*) tokens
 */

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DiamondRule, MoneyAmount, ParchmentCard, StatTile } from '@warehouse14/ui-kit';

import { useApiClient } from '../../api-context.js';

// ── Types ────────────────────────────────────────────────────────────────

interface BridgeData {
  todayRevenueCents: number;
  todaySalesCount: number;
  todayAnkaufCount: number;
  todayAnkaufValueCents: number;
  intakeDraftsPending: number;
  approvalsPending: number;
  whatsappUnreadCount: number;
  nextAppointmentAt: string | null;
  todayAppointmentCount: number;
  tseCertDaysRemaining: number | null;
  workerDlqUnacked: number;
  systemStatus: 'ok' | 'watch' | 'alert';
  computedAt: string;
}

// ── Local atom — StatusDot (not in @warehouse14/ui-kit) ──────────────────

const STATUS_COLORS: Record<BridgeData['systemStatus'], string> = {
  ok: '#16a34a',
  watch: '#ca8a04',
  alert: '#dc2626',
};

const STATUS_LABELS: Record<BridgeData['systemStatus'], string> = {
  ok: 'Nominal',
  watch: 'Achtung',
  alert: 'Alarm',
};

function StatusDot({ status }: { status: BridgeData['systemStatus'] }) {
  const color = STATUS_COLORS[status];
  const label = STATUS_LABELS[status];
  return (
    <output
      aria-label={`Systemstatus: ${label}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: 'var(--w14-font-display, "Cormorant Garamond", serif)',
        fontSize: '1rem',
        color: 'var(--w14-ink)',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />
      {label}
    </output>
  );
}

// ── Helper — format ISO → 'HH:MM' Berlin time ───────────────────────────

const berlinTimeFmt = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Berlin',
});

function formatTime(iso: string): string {
  try {
    return berlinTimeFmt.format(new Date(iso));
  } catch {
    return '—';
  }
}

// ── Data hook ────────────────────────────────────────────────────────────

interface UseBridgeDataResult {
  data: BridgeData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function useBridgeData(): UseBridgeDataResult {
  const { client } = useApiClient();
  const [data, setData] = useState<BridgeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const result = await client.request<BridgeData>('GET', '/api/bridge/summary');
      if (isMounted.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : 'Verbindungsfehler');
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [client]);

  useEffect(() => {
    isMounted.current = true;
    void fetchData();
    const timer = setInterval(() => {
      void fetchData();
    }, 30_000);
    return () => {
      isMounted.current = false;
      clearInterval(timer);
    };
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

// ── Shared styles ─────────────────────────────────────────────────────────

const railBase: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const smallText: CSSProperties = {
  fontFamily: 'var(--w14-font-mono, "JetBrains Mono", monospace)',
  fontSize: '0.78rem',
  color: 'var(--w14-ink-faded)',
  margin: 0,
};

const captionText: CSSProperties = {
  fontFamily: 'var(--w14-font-mono, "JetBrains Mono", monospace)',
  fontSize: '0.7rem',
  color: 'var(--w14-ink-faded)',
  letterSpacing: '0.08em',
  margin: 0,
  marginTop: 'auto',
};

// ── Main component ────────────────────────────────────────────────────────

export function BridgeDashboard() {
  const { data, loading, error, refetch } = useBridgeData();

  // Loading state — no spinner per aesthetic constraints
  if (loading && !data) {
    return (
      <div style={{ padding: '32px 0' }}>
        <DiamondRule tone="faded" label="Lade …" />
      </div>
    );
  }

  // Error state
  if (error && !data) {
    return (
      <ParchmentCard tone="parchment" padding="lg" style={{ marginTop: 16 }}>
        <p
          style={{
            color: '#dc2626',
            fontFamily: 'var(--w14-font-mono, monospace)',
            fontSize: '0.88rem',
            margin: '0 0 12px',
          }}
        >
          Fehler: {error}
        </p>
        <button
          type="button"
          onClick={refetch}
          style={{
            padding: '6px 14px',
            background: 'var(--w14-ink)',
            color: 'var(--w14-parchment)',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: 'var(--w14-font-display, serif)',
          }}
        >
          Erneut versuchen
        </button>
      </ParchmentCard>
    );
  }

  if (!data) return null;

  const {
    todayRevenueCents,
    todaySalesCount,
    todayAnkaufCount,
    todayAnkaufValueCents,
    intakeDraftsPending,
    approvalsPending,
    whatsappUnreadCount,
    nextAppointmentAt,
    todayAppointmentCount,
    tseCertDaysRemaining,
    workerDlqUnacked,
    systemStatus,
  } = data;

  const certColor =
    tseCertDaysRemaining != null && tseCertDaysRemaining <= 7 ? '#dc2626' : '#ca8a04';

  return (
    <div
      style={{
        display: 'flex',
        gap: 24,
        alignItems: 'flex-start',
        padding: '24px 0',
      }}
    >
      {/* ── LEFT RAIL — Status & Alerts ─────────────────────────────── */}
      <div
        style={{
          ...railBase,
          flex: '0 0 200px',
          minWidth: 0,
        }}
      >
        <StatusDot status={systemStatus} />
        <DiamondRule tone="faded" />

        {/* TSE cert watch */}
        {tseCertDaysRemaining != null && tseCertDaysRemaining <= 30 && (
          <p style={{ ...smallText, color: certColor, margin: 0 }}>
            TSE-Zert. läuft ab in {tseCertDaysRemaining}d
          </p>
        )}

        {/* DLQ warning */}
        {workerDlqUnacked > 0 && (
          <p style={{ ...smallText, color: '#ca8a04', margin: 0 }}>
            DLQ: {workerDlqUnacked} unbestätigt
          </p>
        )}

        <DiamondRule tone="faded" />

        {/* Location caption — always shown */}
        <p style={captionText}>Schorndorf 73614</p>
      </div>

      {/* ── CENTER — Quick Action tiles (2-col grid) ─────────────────── */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          minWidth: 0,
        }}
      >
        <StatTile
          label="Eingang (Drafts)"
          value={intakeDraftsPending}
          attention={intakeDraftsPending > 0}
        />
        <StatTile label="Genehmigungen" value={approvalsPending} attention={approvalsPending > 0} />
        <StatTile
          label="WhatsApp"
          value={whatsappUnreadCount}
          attention={whatsappUnreadCount > 0}
        />
        <StatTile
          label="Nächster Termin"
          value={nextAppointmentAt ? formatTime(nextAppointmentAt) : '—'}
        />
        <StatTile label="Termine heute" value={todayAppointmentCount} />
        <StatTile label="DLQ" value={workerDlqUnacked} attention={workerDlqUnacked > 0} />
      </div>

      {/* ── RIGHT RAIL — Today's Numbers ─────────────────────────────── */}
      <div
        style={{
          ...railBase,
          flex: '0 0 200px',
          minWidth: 0,
        }}
      >
        <p style={{ ...smallText, color: 'var(--w14-ink-faded)', marginBottom: 4 }}>Umsatz heute</p>
        <MoneyAmount valueEur={String((todayRevenueCents / 100).toFixed(2))} emphasis />
        <p style={smallText}>{todaySalesCount} Verkäufe</p>

        <DiamondRule tone="faded" />

        <p style={{ ...smallText, color: 'var(--w14-ink-faded)', marginBottom: 4 }}>Ankauf heute</p>
        <MoneyAmount valueEur={String((todayAnkaufValueCents / 100).toFixed(2))} emphasis />
        <p style={smallText}>{todayAnkaufCount} Ankäufe</p>
      </div>
    </div>
  );
}
