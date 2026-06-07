/**
 * Werkstatt — the home screen the operator sees on every successful login.
 *
 * Layout (memory.md §10, #74-G):
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │  Header (Seal · Werkstatt · SSE status)                │
 *   │  ◆ — diamond rule —                                    │
 *   ├──────────────────────────────┬─────────────────────────┤
 *   │ ◆ Übersicht                  │ ◆ Tagebuch              │
 *   │ [6 stat tiles 3×2]           │  ledger feed (live)     │
 *   │                              │                         │
 *   │ ◆ Edelmetallkurs             │                         │
 *   │ [4-row prices]               │                         │
 *   ├──────────────────────────────┴─────────────────────────┤
 *   │ Footer (N° · Heute · Shift OPEN · €4.231,42)            │
 *   └────────────────────────────────────────────────────────┘
 *
 * Data ownership:
 *   • Dashboard summary  → TanStack Query (useDashboardSummary)
 *   • Live ledger feed   → Zustand (useLedgerFeed) populated by useLedgerStream
 *   • SSE status         → returned by useLedgerStream
 *
 * The two are STAPLED together via the SSE hook's debounced invalidation
 * of the dashboard query — see useLedgerStream.ts.
 */

import { Seal } from '@warehouse14/ui-kit';

import { useDashboardSummary } from '../../hooks/useDashboardSummary.js';
import { useLedgerStream } from '../../hooks/useLedgerStream.js';
import { useSessionStore } from '../../state/session-store.js';

import { DayControl } from './DayControl.js';
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

      {/* A4: guided start/end of day — one clear control on the landing screen. */}
      <div style={{ padding: '4px 28px 0' }}>
        <DayControl />
      </div>

      <main
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: 28,
          padding: '8px 28px 24px',
        }}
      >
        {/* Left column — Übersicht (Edelmetallkurs now lives in the chrome ticker, UX P2) */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <UebersichtPanel
            data={data}
            isLoading={isLoading}
            isError={isError && data === undefined}
            onRetry={() => void refetch()}
            retrying={isFetching}
          />

          {/* Tiny seal in the negative space at the bottom — anchoring brand */}
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', paddingTop: 36 }}>
            <Seal size="sm" tone="faded" />
          </div>
        </div>

        {/* Right column — Tagebuch (live ledger feed) */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <TagebuchFeed />
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
