/**
 * Werkstatt — the home screen the operator sees on every successful login.
 *
 * Calendar-first layout (memory.md §10, #74-G):
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │  Header (Seal · Werkstatt · SSE status)                │
 *   │  ◆ — diamond rule —                                    │
 *   ├──────────┬─────────────────────────────────────────────┤
 *   │ ◆ Tag    │                                             │
 *   │ ◆ Über-  │           ◆ Google Kalender                 │
 *   │   sicht  │     (MAIN — full height & width,            │
 *   │ ◆ Tage-  │      month/week reads in FULL)              │
 *   │   buch   │                                             │
 *   │ (rail,   │                                             │
 *   │  ~300px) │                                             │
 *   ├──────────┴─────────────────────────────────────────────┤
 *   │ Footer (N° · Heute · Shift OPEN · €4.231,42)            │
 *   └────────────────────────────────────────────────────────┘
 *
 * The display panels (DayControl · Übersicht · Tagebuch) are display-only,
 * so they collapse into a THIN scannable rail on the LEFT; the calendar gets
 * every remaining pixel.
 *
 * Data ownership:
 *   • Dashboard summary  → TanStack Query (useDashboardSummary)
 *   • Live ledger feed   → Zustand (useLedgerFeed) populated by useLedgerStream
 *   • SSE status         → returned by useLedgerStream
 *
 * The two are STAPLED together via the SSE hook's debounced invalidation
 * of the dashboard query — see useLedgerStream.ts.
 */

import { useDashboardSummary } from '../../hooks/useDashboardSummary.js';
import { useLedgerStream } from '../../hooks/useLedgerStream.js';
import { useSessionStore } from '../../state/session-store.js';

import { DayControl } from './DayControl.js';
import { GoogleKalenderCard } from './GoogleKalenderCard.js';
import { TagebuchFeed } from './TagebuchFeed.js';
import { UebersichtPanel } from './UebersichtPanel.js';
import { WerkstattFooter } from './WerkstattFooter.js';
import { WerkstattHeader } from './WerkstattHeader.js';

export function Werkstatt(): JSX.Element {
  const actor = useSessionStore((s) => s.actor);

  // SSE: open on mount; cleanup on unmount (sign-out flips the parent gate).
  const { status: sseStatus } = useLedgerStream(true);

  // Dashboard data: TanStack Query, 15s stale / 60s background refresh /
  // SSE-debounce-invalidation.
  const { data, isLoading, isError, refetch, isFetching } = useDashboardSummary();

  const todayLabel = new Date().toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div
      className="w14-paper-noise"
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--w14-parchment)',
      }}
    >
      <WerkstattHeader
        operatorName={
          actor === null
            ? 'Unbekannt'
            : actor.isOwner
              ? 'Inhaber'
              : actor.role === 'ADMIN'
                ? 'Admin'
                : actor.role === 'CASHIER'
                  ? 'Kasse'
                  : 'Beobachter'
        }
        sseStatus={sseStatus}
        todayLabel={todayLabel}
      />

      <main
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          // Calendar-first: a thin scannable display rail on the LEFT,
          // the calendar claiming every remaining pixel on the RIGHT.
          gridTemplateColumns: 'clamp(280px, 22vw, 320px) minmax(0, 1fr)',
          gap: 'var(--space-6)',
          padding: 'var(--space-3) var(--space-7) var(--space-6)',
        }}
      >
        {/* Left rail — display-only summaries, compact & stacked. */}
        <aside
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-5)',
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
          {/* A4: guided start/end of day — one clear control. */}
          <DayControl />

          <UebersichtPanel
            data={data}
            isLoading={isLoading}
            isError={isError && data === undefined}
            onRetry={() => void refetch()}
            retrying={isFetching}
            compact
          />

          {/* Tagebuch (live ledger feed) — condensed in the rail. */}
          <div style={{ flex: 1, minHeight: 200, display: 'flex', flexDirection: 'column' }}>
            <TagebuchFeed compact />
          </div>
        </aside>

        {/* MAIN — Google Kalender fills full height & width so month/week reads
            in FULL. Full-page twin: Spotlight → „Kalender“ (/kalender). */}
        <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <GoogleKalenderCard variant="full" />
        </div>
      </main>

      <WerkstattFooter
        currentShiftId={data?.currentShiftId ?? null}
        revenueEur={data?.currentShiftRevenueEur ?? '0'}
        counterValue={Math.max(1, (data?.openTasksMine ?? 0) + (data?.tasksDueToday ?? 0))}
      />
    </div>
  );
}
