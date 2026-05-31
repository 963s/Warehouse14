/**
 * BridgeDashboard — the ADR-0019 §1 three-pane "Bridge": the screen Basel opens
 * at 09:00 and glances at 50× a day. One question, answered in 2 seconds: "Is
 * anything wrong?"
 *
 *   ┌── ALERTS ──┬──────── LIVE FEED ────────┬── QUICK ACTIONS ──┐
 *   │ 🔴 0 🟡 2  │  [ Morgen-Briefing ▾ ]     │ Intake · Inbox    │
 *   │ 🟢 18      │  14:32 Verkauf €1.250 …    │ Genehmigungen     │
 *   │ Beobachten │  14:28 KYC erfasst …       │ Heute · €4.250    │
 *   │ • TSE 14d  │  …                         │ 🌙 Tagesabschluss │
 *   └────────────┴───────────────────────────┴───────────────────┘
 *
 * Cognitive-load discipline: summaries here, deep-dive one click away (each
 * quick-action tile navigates to its Karteikasten surface). Mock-backed for
 * now via `useBridgeData()`; SSE bindings land next without touching this file.
 */

import { type CSSProperties, useState } from 'react';

import { DiamondRule, MoneyAmount, ParchmentCard, Seal, StatTile } from '@warehouse14/ui-kit';

import { StatusDot } from '../components/StatusDot.js';
import type { AppointmentsGlance, BotStatus, LiveEvent, TodayStats, WatchItem } from './types.js';
import type { MorningBriefing } from './types.js';
import { useBridgeData } from './use-bridge-data.js';

const FOCUSABLE = 'w14cd-focusable';

const paneStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
  minWidth: 0,
};

const captionStyle: CSSProperties = {
  margin: 0,
  color: 'var(--w14-ink-faded)',
  fontSize: '0.86rem',
  lineHeight: 1.5,
};

export interface BridgeDashboardProps {
  /** Navigate to a Karteikasten surface (1-8) — wired to the rail in App. */
  onOpenSurface: (digit: number) => void;
}

export function BridgeDashboard({ onOpenSurface }: BridgeDashboardProps): JSX.Element {
  const data = useBridgeData();

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 260px) minmax(340px, 1fr) minmax(280px, 340px)',
        gap: 28,
        alignItems: 'start',
      }}
    >
      <AlertPane counts={data.counts} watch={data.watch} />
      <FeedPane briefing={data.briefing} feed={data.feed} />
      <QuickActionsPane
        quickActions={data.quickActions}
        appointments={data.appointments}
        bot={data.bot}
        stats={data.stats}
        onOpenSurface={onOpenSurface}
      />
    </div>
  );
}

// ── Left pane — Alerts + Watch ──────────────────────────────────────────────

function AlertPane({
  counts,
  watch,
}: {
  counts: { alert: number; watch: number; ok: number };
  watch: WatchItem[];
}): JSX.Element {
  const tally: Array<{ tone: 'alert' | 'watch' | 'ok'; label: string; value: number }> = [
    { tone: 'alert', label: 'Kritisch', value: counts.alert },
    { tone: 'watch', label: 'Beobachten', value: counts.watch },
    { tone: 'ok', label: 'Nominal', value: counts.ok },
  ];

  return (
    <section style={paneStyle} aria-label="Meldungen und Beobachtungen">
      <DiamondRule tone="gold" label="Meldungen" />
      <ParchmentCard tone="parchment" padding="md">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
          {tally.map((row) => (
            <li key={row.tone} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <StatusDot tone={row.tone} size={12} />
              <span
                className="w14-tabular"
                style={{
                  fontFamily: 'var(--w14-font-display)',
                  fontSize: '1.5rem',
                  lineHeight: 1,
                  minWidth: 36,
                }}
              >
                {row.value}
              </span>
              <span className="w14-smallcaps" style={{ color: 'var(--w14-ink-faded)' }}>
                {row.label}
              </span>
            </li>
          ))}
        </ul>
      </ParchmentCard>

      <DiamondRule tone="faded" label="Beobachten" />
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
        {watch.map((item) => (
          <li
            key={item.id}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '2px 0' }}
          >
            <StatusDot tone={item.tone} size={10} style={{ marginTop: 6 }} />
            <p style={captionStyle}>{item.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Center pane — Morning Briefing + Live Feed ──────────────────────────────

function FeedPane({
  briefing,
  feed,
}: {
  briefing: MorningBriefing;
  feed: LiveEvent[];
}): JSX.Element {
  return (
    <section style={paneStyle} aria-label="Live-Feed">
      <MorningBriefingBanner briefing={briefing} />
      <DiamondRule tone="gold" label="Live-Feed" />
      <ol
        // role="feed" — the always-on chronological log (ADR-0019 §1).
        role="feed"
        aria-label="Chronologischer Ereignis-Stream"
        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}
      >
        {feed.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </ol>
    </section>
  );
}

function EventRow({ event }: { event: LiveEvent }): JSX.Element {
  return (
    <li>
      <article
        aria-label={`${event.time} — ${event.title}`}
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto 1fr',
          alignItems: 'baseline',
          gap: 12,
          padding: '12px 8px',
          borderBottom: '1px solid var(--w14-ink-faded)',
        }}
      >
        <time
          className="w14-tabular"
          style={{ fontFamily: 'var(--w14-font-mono)', color: 'var(--w14-ink-faded)' }}
        >
          {event.time}
        </time>
        <StatusDot tone={event.tone} size={9} style={{ alignSelf: 'center' }} />
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontFamily: 'var(--w14-font-display)', fontSize: '1.05rem' }}>
            {event.title}
          </p>
          <p style={{ ...captionStyle, marginTop: 2 }}>{event.detail}</p>
        </div>
      </article>
    </li>
  );
}

function MorningBriefingBanner({ briefing }: { briefing: MorningBriefing }): JSX.Element {
  // Default expanded on first open of the day (ADR-0019 §5).
  const [expanded, setExpanded] = useState(true);

  return (
    <ParchmentCard tone="deep" padding="md" style={{ borderLeft: '3px solid var(--w14-gold)' }}>
      <button
        type="button"
        className={FOCUSABLE}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
        }}
      >
        <Seal label="ص" size="sm" tone="gold" title="Morgen-Briefing" />
        <span
          className="w14-smallcaps"
          style={{ flex: 1, fontFamily: 'var(--w14-font-display)', fontSize: '1.05rem' }}
        >
          Morgen-Briefing
        </span>
        <span aria-hidden="true" style={{ color: 'var(--w14-ink-faded)' }}>
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {/* Arabic content — Basel's preferred language (ADR-0019 §5). */}
      <div dir="rtl" lang="ar" style={{ marginTop: 14 }}>
        <p style={{ margin: 0, fontSize: '1.05rem', lineHeight: 1.6 }}>{briefing.greeting}</p>
        {expanded ? (
          <ul style={{ margin: '10px 0 0', paddingInlineStart: 20, display: 'grid', gap: 6 }}>
            {briefing.lines.map((line) => (
              <li key={line} style={{ lineHeight: 1.6 }}>
                {line}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </ParchmentCard>
  );
}

// ── Right pane — Quick Actions, glances, stats, End-of-Day ──────────────────

function QuickActionsPane({
  quickActions,
  appointments,
  bot,
  stats,
  onOpenSurface,
}: {
  quickActions: Array<{ id: string; label: string; count: number; surface: number }>;
  appointments: AppointmentsGlance;
  bot: BotStatus;
  stats: TodayStats;
  onOpenSurface: (digit: number) => void;
}): JSX.Element {
  return (
    <section style={paneStyle} aria-label="Schnellzugriff und Tagesübersicht">
      <DiamondRule tone="gold" label="Schnellzugriff" />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
          gap: 12,
        }}
      >
        {quickActions.map((action) => {
          const needsAttention = action.id === 'approvals' && action.count > 0;
          return (
            <StatTile
              key={action.id}
              className={FOCUSABLE}
              value={action.count}
              label={action.label}
              attention={needsAttention}
              attentionCaption={needsAttention ? 'Wartet auf dich' : ''}
              onClick={() => onOpenSurface(action.surface)}
            />
          );
        })}
      </div>

      <GlanceCard appointments={appointments} bot={bot} onOpenSurface={onOpenSurface} />

      <DiamondRule tone="gold" label="Heute" />
      <ParchmentCard tone="parchment" padding="md">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span className="w14-smallcaps" style={{ color: 'var(--w14-ink-faded)' }}>
            Umsatz
          </span>
          <MoneyAmount valueEur={stats.revenueEur} emphasis />
        </div>
        <DiamondRule tone="faded" style={{ margin: '14px 0' }} />
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            rowGap: 8,
            columnGap: 16,
            margin: 0,
          }}
        >
          <dt style={{ color: 'var(--w14-ink-faded)' }}>Verkäufe</dt>
          <dd className="w14-tabular" style={{ margin: 0, justifySelf: 'end' }}>
            {stats.salesCount}
          </dd>
          <dt style={{ color: 'var(--w14-ink-faded)' }}>Ankauf</dt>
          <dd className="w14-tabular" style={{ margin: 0, justifySelf: 'end' }}>
            {stats.ankaufCount}
          </dd>
          <dt style={{ color: 'var(--w14-ink-faded)' }}>davon Ankaufswert</dt>
          <dd style={{ margin: 0, justifySelf: 'end' }}>
            <MoneyAmount valueEur={stats.ankaufEur} />
          </dd>
        </dl>
      </ParchmentCard>

      <EndOfDayTrigger stats={stats} />
    </section>
  );
}

function GlanceCard({
  appointments,
  bot,
  onOpenSurface,
}: {
  appointments: AppointmentsGlance;
  bot: BotStatus;
  onOpenSurface: (digit: number) => void;
}): JSX.Element {
  return (
    <ParchmentCard tone="parchment" padding="md">
      <button
        type="button"
        className={FOCUSABLE}
        onClick={() => onOpenSurface(6)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'block',
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="w14-smallcaps" style={{ color: 'var(--w14-ink-faded)' }}>
            Termine
          </span>
          <span style={{ fontFamily: 'var(--w14-font-display)' }}>
            Nächster {appointments.next ?? '—'} · Heute {appointments.today}
          </span>
        </div>
      </button>
      <DiamondRule tone="faded" style={{ margin: '12px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="w14-smallcaps" style={{ color: 'var(--w14-ink-faded)' }}>
          Bot
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>Aktiv {bot.active}</span>
          {bot.awaitingHuman > 0 ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <StatusDot tone="watch" size={9} />
              Wartet auf Mensch {bot.awaitingHuman}
            </span>
          ) : null}
        </span>
      </div>
    </ParchmentCard>
  );
}

function EndOfDayTrigger({ stats }: { stats: TodayStats }): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        className={FOCUSABLE}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          padding: '12px 16px',
          cursor: 'pointer',
          background: 'var(--w14-ink)',
          color: 'var(--w14-parchment)',
          border: 'none',
          borderRadius: 'var(--w14-radius-button)',
          fontFamily: 'var(--w14-font-display)',
          fontSize: '1.05rem',
          letterSpacing: '0.02em',
        }}
      >
        🌙 Tagesabschluss
      </button>

      {open ? (
        <ParchmentCard tone="parchment" padding="md" style={{ marginTop: 12 }}>
          <p style={{ margin: 0, fontFamily: 'var(--w14-font-display)', fontSize: '1.1rem' }}>
            Tagesabschluss
          </p>
          <p style={{ ...captionStyle, marginTop: 6 }}>
            Umsatz heute: <MoneyAmount valueEur={stats.revenueEur} /> · {stats.salesCount} Verkäufe
            · {stats.ankaufCount} Ankauf
          </p>
          <ul style={{ margin: '12px 0 0', paddingInlineStart: 18, display: 'grid', gap: 6 }}>
            <li style={captionStyle}>TSE-Tagesarchiv: {stats.salesCount} Transaktionen signiert</li>
            <li style={captionStyle}>DSFinV-K-Export für den Steuerberater bereit</li>
            <li style={captionStyle}>Fortress-Backup: heutiges Inkrement</li>
          </ul>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button
              type="button"
              className={FOCUSABLE}
              disabled
              style={{
                padding: '8px 16px',
                background: 'var(--w14-ink)',
                color: 'var(--w14-parchment)',
                border: 'none',
                borderRadius: 'var(--w14-radius-button)',
                opacity: 0.55,
                cursor: 'not-allowed',
                fontFamily: 'var(--w14-font-display)',
              }}
            >
              Tagesabschluss bestätigen
            </button>
            <button
              type="button"
              className={FOCUSABLE}
              onClick={() => setOpen(false)}
              style={{
                padding: '8px 16px',
                background: 'none',
                color: 'var(--w14-ink)',
                border: '1px solid var(--w14-ink-faded)',
                borderRadius: 'var(--w14-radius-button)',
                cursor: 'pointer',
                fontFamily: 'var(--w14-font-display)',
              }}
            >
              Abbrechen
            </button>
          </div>
        </ParchmentCard>
      ) : null}
    </div>
  );
}
