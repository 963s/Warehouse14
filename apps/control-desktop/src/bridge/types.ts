/**
 * Bridge data model (ADR-0019 §1, §3). These are the view-model shapes the
 * three-pane dashboard renders. They are deliberately transport-agnostic: the
 * next step swaps the mock source for the SSE stream (ADR-0014) + TanStack
 * Query pulls without touching a single component.
 */

import type { StatusTone } from '../components/StatusDot.js';

/** One row of the center Live Feed (ADR-0019 §1, driven by SSE). */
export interface LiveEvent {
  id: string;
  /** Berlin wall-clock `HH:MM` of the event. */
  time: string;
  tone: StatusTone;
  title: string;
  detail: string;
}

/** A left-rail "Watch" item — slow-burning concerns, not acute alerts. */
export interface WatchItem {
  id: string;
  tone: StatusTone;
  text: string;
}

/** The 🔴 / 🟡 / 🟢 tallies at the top of the left rail. */
export interface AlertCounts {
  alert: number;
  watch: number;
  ok: number;
}

/** A right-rail quick-action tile — a count + the surface it deep-dives into. */
export interface QuickAction {
  id: string;
  label: string;
  count: number;
  /** Karteikasten-Index digit (1-8) this tile navigates to. */
  surface: number;
}

/** Bot supervision glance (ADR-0019 §1). */
export interface BotStatus {
  active: number;
  awaitingHuman: number;
}

/** Appointments glance (ADR-0020 surfaces here as a first-class rail item). */
export interface AppointmentsGlance {
  /** Next appointment time `HH:MM`, or null when none remain today. */
  next: string | null;
  today: number;
}

/** Today's summary numbers (ADR-0019 §1 "📊 Today"). */
export interface TodayStats {
  revenueEur: string;
  salesCount: number;
  ankaufCount: number;
  ankaufEur: string;
}

/** The Claude-generated Morning Briefing (ADR-0019 §5) — Arabic for Basel. */
export interface MorningBriefing {
  greeting: string;
  lines: string[];
}

/** The full Bridge view-model assembled for the Übersicht surface. */
export interface BridgeData {
  briefing: MorningBriefing;
  feed: LiveEvent[];
  watch: WatchItem[];
  counts: AlertCounts;
  quickActions: QuickAction[];
  bot: BotStatus;
  appointments: AppointmentsGlance;
  stats: TodayStats;
}
