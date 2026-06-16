/**
 * BridgeDashboard — the Übersicht surface (digit 1) of the Owner Control
 * Desktop. A calm, three-column glance answering "is anything wrong?": status
 * + alerts on the left, the action queues in the middle, today's money on the
 * right (ADR-0019 §1). Owner-only; backed by the live `/api/bridge/summary`
 * aggregate (no mock data). Polls every 30s.
 *
 * Aesthetic discipline (ADR-0019 §10, memory.md §5): red/yellow/green for
 * STATUS ONLY, no backdrop-blur, brand `--w14-*` tokens, no spinners.
 */

import { type Static, Type } from '@sinclair/typebox';
import { type CSSProperties, useCallback, useEffect, useState } from 'react';

import { parseResponse } from '@warehouse14/api-client';
import {
  Button,
  DiamondRule,
  MoneyAmount,
  ParchmentCard,
  StatTile,
  centsToEur,
} from '@warehouse14/ui-kit';

import { useApiClient } from '../../api-context.js';
import { useLedgerStream } from '../../bridge/use-ledger-stream.js';

// ── Types — mirrors GET /api/bridge/summary ─────────────────────────────────

type SystemStatus = 'ok' | 'watch' | 'alert';

// The hand-written interface was a compile-time fiction over `res.data as T`. It
// is now a REAL TypeBox schema validated at the api-client seam — money fields
// are integer cents (a non-integer would throw in `centsToEur` and blank the
// desktop), counts are integers, the status is the closed union.
const BridgeSummarySchema = Type.Object({
  todayRevenueCents: Type.Integer(),
  todaySalesCount: Type.Integer(),
  todayAnkaufCount: Type.Integer(),
  todayAnkaufValueCents: Type.Integer(),

  intakeDraftsPending: Type.Integer(),
  approvalsPending: Type.Integer(),
  whatsappUnreadCount: Type.Integer(),

  nextAppointmentAt: Type.Union([Type.String(), Type.Null()]),
  todayAppointmentCount: Type.Integer(),

  tseCertDaysRemaining: Type.Union([Type.Integer(), Type.Null()]),
  workerDlqUnacked: Type.Integer(),

  systemStatus: Type.Union([Type.Literal('ok'), Type.Literal('watch'), Type.Literal('alert')]),
  computedAt: Type.String(),
});
type BridgeData = Static<typeof BridgeSummarySchema>;

// ── Status atom (local — NOT in ui-kit) ─────────────────────────────────────

const STATUS_COLOR: Record<SystemStatus, string> = {
  ok: '#16a34a',
  watch: '#ca8a04',
  alert: '#dc2626',
};

const STATUS_LABEL: Record<SystemStatus, string> = {
  ok: 'Nominal',
  watch: 'Achtung',
  alert: 'Alarm',
};

function StatusDot({ status }: { status: SystemStatus }): JSX.Element {
  const label = STATUS_LABEL[status];
  return (
    <span
      role="status"
      aria-label={`Systemstatus: ${label}`}
      style={{
        display: 'inline-block',
        flex: '0 0 auto',
        width: 12,
        height: 12,
        borderRadius: '50%',
        backgroundColor: STATUS_COLOR[status],
      }}
    />
  );
}

/** ISO → Berlin `HH:MM`. */
function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(new Date(iso));
}

// Cents → dot-decimal string for `<MoneyAmount valueEur>` comes from the ui-kit
// `centsToEur` (exact bigint split — no float / toFixed drift).

// ── Data hook — fetch + 30s poll ────────────────────────────────────────────

interface UseBridgeData {
  data: BridgeData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function useBridgeData(): UseBridgeData {
  const { client } = useApiClient();
  const [data, setData] = useState<BridgeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    setError(null);
    client
      .request<unknown>('GET', '/api/bridge/summary')
      .then((raw) => {
        // Validate at the boundary: a malformed payload (e.g. non-integer cents)
        // degrades to an error here, never reaching centsToEur in render.
        const d = parseResponse(BridgeSummarySchema, raw, '/api/bridge/summary');
        if (!d) {
          setError('Ungültige Daten vom Server erhalten.');
          setLoading(false);
          return;
        }
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
        setLoading(false);
      });
  }, [client]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

// ── Shared styles ───────────────────────────────────────────────────────────

const railStyle: CSSProperties = {
  flex: '0 0 200px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const captionStyle: CSSProperties = {
  fontSize: '0.85rem',
  color: 'var(--w14-ink-faded)',
};

const railLabelStyle: CSSProperties = {
  fontSize: '0.72rem',
  letterSpacing: '0.08em',
  color: 'var(--w14-ink-faded)',
  textTransform: 'uppercase',
};

// ── Component ────────────────────────────────────────────────────────────────

export function BridgeDashboard(): JSX.Element {
  const { data, loading, error, refetch } = useBridgeData();
  // Live SSE feed layered OVER the 30s poll (poll stays the floor): a ledger
  // event nudges the same refetch. If SSE never connects (CORS/auth/dev), the
  // Bridge degrades silently to exactly the polling behaviour from before.
  useLedgerStream(refetch);

  if (loading && !data) {
    return <DiamondRule tone="faded" label="Lade …" />;
  }

  if (error && !data) {
    return (
      <ParchmentCard tone="parchment" padding="lg" style={{ marginTop: 24, maxWidth: 480 }}>
        <p style={{ margin: 0, color: 'var(--w14-status-alert, #dc2626)' }}>
          Fehler beim Laden der Übersicht: {error}
        </p>
        <Button variant="primary" size="sm" style={{ marginTop: 16 }} onClick={refetch}>
          Erneut versuchen
        </Button>
      </ParchmentCard>
    );
  }

  if (!data) {
    return <DiamondRule tone="faded" label="Lade …" />;
  }

  return (
    <div style={{ display: 'flex', gap: 24, marginTop: 24, alignItems: 'flex-start' }}>
      {/* ── LEFT RAIL — Status & Alerts ──────────────────────────────────── */}
      <div style={railStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StatusDot status={data.systemStatus} />
          <span style={{ fontFamily: 'var(--w14-font-display)', fontSize: '1.1rem' }}>
            {STATUS_LABEL[data.systemStatus]}
          </span>
        </div>

        <DiamondRule tone="faded" />

        {data.tseCertDaysRemaining !== null && data.tseCertDaysRemaining <= 30 ? (
          <span
            style={{
              fontSize: '0.85rem',
              color:
                data.tseCertDaysRemaining <= 7
                  ? 'var(--w14-status-alert, #dc2626)'
                  : 'var(--w14-status-watch, #ca8a04)',
            }}
          >
            TSE-Zert. läuft ab in {data.tseCertDaysRemaining}d
          </span>
        ) : null}

        {data.workerDlqUnacked > 0 ? (
          <span style={{ fontSize: '0.85rem', color: 'var(--w14-status-watch, #ca8a04)' }}>
            DLQ: {data.workerDlqUnacked} unbestätigt
          </span>
        ) : null}

        <DiamondRule tone="faded" />

        <span
          style={{
            fontSize: '0.7rem',
            color: 'var(--w14-ink-faded)',
            letterSpacing: '0.08em',
          }}
        >
          Schorndorf 73614
        </span>
      </div>

      {/* ── CENTER — Quick Action tiles ──────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          alignContent: 'start',
        }}
      >
        <StatTile
          label="Eingang (Drafts)"
          value={data.intakeDraftsPending}
          attention={data.intakeDraftsPending > 0}
        />
        <StatTile
          label="Genehmigungen"
          value={data.approvalsPending}
          attention={data.approvalsPending > 0}
        />
        <StatTile
          label="WhatsApp"
          value={data.whatsappUnreadCount}
          attention={data.whatsappUnreadCount > 0}
        />
        <StatTile
          label="Nächster Termin"
          value={data.nextAppointmentAt ? formatTime(data.nextAppointmentAt) : '—'}
        />
        <StatTile label="Termine heute" value={data.todayAppointmentCount} />
        <StatTile label="DLQ" value={data.workerDlqUnacked} attention={data.workerDlqUnacked > 0} />
      </div>

      {/* ── RIGHT RAIL — Today's Numbers ─────────────────────────────────── */}
      <div style={{ ...railStyle, gap: 8 }}>
        <span style={railLabelStyle}>Umsatz heute</span>
        <MoneyAmount valueEur={centsToEur(data.todayRevenueCents)} emphasis />
        <span style={captionStyle}>{data.todaySalesCount} Verkäufe</span>

        <DiamondRule tone="faded" />

        <span style={railLabelStyle}>Ankauf heute</span>
        <MoneyAmount valueEur={centsToEur(data.todayAnkaufValueCents)} />
        <span style={captionStyle}>{data.todayAnkaufCount} Ankäufe</span>
      </div>
    </div>
  );
}
