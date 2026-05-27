/**
 * Übersicht panel — the 6-tile dashboard cluster on the Werkstatt left column.
 *
 * Each tile is a self-contained presentational element. The PARENT
 * (`UebersichtPanel`) holds the dashboard summary; the tiles never read
 * from the store directly. This keeps re-render scopes tight: when the
 * summary refreshes, only the tile whose value actually changed is touched
 * — React's reconciliation sees identical props on the others.
 *
 * Attention rules (memory.md §10):
 *   • `tasksOverdue > 0`         → red dot + caption "Überfällig"
 *   • `ebayConflictsWeek > 0`    → red dot + caption "Sofort prüfen"
 *   • `workerDlqUnacked > 0`     → not its own tile (too rare), shown in worker strip
 *   • Everything else 0          → grey-out the value, no dot
 */

import { DiamondRule, StatTile } from '@warehouse14/ui-kit';

import type { DashboardSummary } from '@warehouse14/api-client';

export interface UebersichtPanelProps {
  data: DashboardSummary | undefined;
  isLoading: boolean;
}

export function UebersichtPanel({ data, isLoading }: UebersichtPanelProps): JSX.Element {
  const placeholder = isLoading || data === undefined;

  return (
    <section aria-label="Übersicht">
      <PanelHeading
        label="Übersicht"
        sublabel={placeholder ? 'Lädt…' : 'Heute · Stand jetzt'}
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 16,
        }}
      >
        <StatTile
          index={1}
          value={placeholder ? '—' : data!.openTasksMine}
          label="Meine Aufgaben"
        />
        <StatTile
          index={2}
          value={placeholder ? '—' : data!.tasksDueToday}
          label="Heute fällig"
          attention={!placeholder && data!.tasksDueToday > 0}
          attentionCaption="Heute erledigen."
        />
        <StatTile
          index={3}
          value={placeholder ? '—' : data!.tasksOverdue}
          label="Überfällig"
          attention={!placeholder && data!.tasksOverdue > 0}
          attentionCaption="Sofortige Beachtung."
        />
        <StatTile
          index={4}
          value={placeholder ? '—' : data!.pendingAppraisals}
          label="Offene Bewertungen"
        />
        <StatTile
          index={5}
          value={placeholder ? '—' : data!.ebayPipelineDepth}
          label="eBay-Pipeline"
        />
        <StatTile
          index={6}
          value={placeholder ? '—' : data!.ebayConflictsWeek}
          label="eBay-Konflikte (7 T.)"
          attention={!placeholder && data!.ebayConflictsWeek > 0}
          attentionCaption="Sofortige Prüfung."
        />
      </div>
    </section>
  );
}

function PanelHeading({ label, sublabel }: { label: string; sublabel: string }): JSX.Element {
  return (
    <div style={{ marginBottom: 14 }}>
      <DiamondRule label={label} />
      <p
        style={{
          margin: '-8px 0 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: '0.85rem',
          textAlign: 'center',
        }}
      >
        {sublabel}
      </p>
    </div>
  );
}
