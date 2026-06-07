/**
 * DayControl — the guided "Open Day / Close Day" banner (Phase A #4).
 *
 * Gives the operator one unmistakable start and end point. No open shift →
 * "Tag öffnen" (Verkauf/Ankauf are gated on it). Shift open → shows since-when
 * + "Tag abschließen" (→ Kasse Z-Bon). Both actions route to /kasse, where the
 * shift-open panel and the Z-Bon dialog live.
 */

import { useNavigate } from 'react-router-dom';

import { Button, ParchmentCard } from '@warehouse14/ui-kit';

import { useCurrentShift } from '../../hooks/useCurrentShift.js';

export function DayControl(): JSX.Element | null {
  const navigate = useNavigate();
  const { data: shift, isLoading, isError, refetch, isFetching } = useCurrentShift();

  // The shift could not be fetched — DO NOT fall through to "Tag noch nicht
  // eröffnet" (a shift may well be open; we just can't see it). Say so honestly.
  if (isError && shift === undefined) {
    return (
      <ParchmentCard
        tone="parchment"
        padding="md"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          borderLeft: '3px solid var(--w14-wax-red)',
        }}
      >
        <span style={{ fontFamily: 'var(--w14-font-display)', fontSize: '1.05rem' }}>
          Schichtstatus nicht abrufbar — Verbindung prüfen.
        </span>
        <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? 'Lädt…' : 'Erneut versuchen'}
        </Button>
      </ParchmentCard>
    );
  }

  // First load — stay invisible rather than flash a wrong state.
  if (isLoading && shift === undefined) return null;

  const open = shift !== null && shift !== undefined;
  const since = open
    ? new Date(shift.openedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <ParchmentCard
      tone="parchment"
      padding="md"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        borderLeft: `3px solid ${open ? 'var(--w14-verdigris)' : 'var(--w14-gold)'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: open ? 'var(--w14-verdigris)' : 'var(--w14-gold)',
          }}
        />
        <span style={{ fontFamily: 'var(--w14-font-display)', fontSize: '1.15rem' }}>
          {open ? 'Tag läuft' : 'Tag noch nicht eröffnet'}
        </span>
        <span style={{ color: 'var(--w14-ink-faded)', fontSize: '0.85rem' }}>
          {open ? `seit ${since} Uhr` : 'Schicht öffnen, um Verkauf & Ankauf zu starten.'}
        </span>
      </div>
      <Button variant="primary" size="md" onClick={() => navigate('/kasse')}>
        {open ? 'Tag abschließen' : 'Tag öffnen'}
      </Button>
    </ParchmentCard>
  );
}
