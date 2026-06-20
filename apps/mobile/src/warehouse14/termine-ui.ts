/**
 * Termine UI helpers — the pure, dependency-light glue between the appointments
 * api-client and the Termine screens (src/app/termine.tsx + termine/neu.tsx).
 *
 * Holds ONLY presentation + state logic: de-DE date/time formatting, the day
 * window math for the agenda + slot picker, the status → Badge-variant map, and
 * the one-tap transition model (which next status a tap should write). The
 * actual api calls live in src/warehouse14/api.ts; the server's DB triggers are
 * the real authority on whether a transition is legal — this module only decides
 * what to OFFER, the backend still validates.
 */
import type {
  AppointmentListItem,
  AppointmentPatchStatus,
  AppointmentStatus,
  AppointmentType,
} from "@warehouse14/api-client"
import { APPOINTMENT_TYPE_LABELS } from "@warehouse14/api-client"

// ── Badge tone per status ─────────────────────────────────────────────────────
/** The RNR Badge variant used to colour each appointment status. */
export type StatusBadgeVariant = "default" | "secondary" | "destructive" | "success" | "outline"

export const STATUS_BADGE_VARIANT: Readonly<Record<AppointmentStatus, StatusBadgeVariant>> = {
  SCHEDULED: "outline",
  CONFIRMED: "secondary",
  CHECKED_IN: "success",
  IN_PROGRESS: "success",
  COMPLETED: "default",
  NO_SHOW: "destructive",
  CANCELLED: "destructive",
  RESCHEDULED: "outline",
}

/** The four bookable types, in the order they appear in the „Neuer Termin"-Picker. */
export const BOOKABLE_TYPES: readonly AppointmentType[] = [
  "VIEWING",
  "BUYBACK_EVAL",
  "CONSULTATION",
  "PICKUP",
]

export function typeLabel(type: AppointmentType): string {
  return APPOINTMENT_TYPE_LABELS[type]
}

// ── One-tap transition model ──────────────────────────────────────────────────
/**
 * The single forward step a "Weiter"-tap should advance a row to, per the Owner
 * happy path SCHEDULED → CONFIRMED → CHECKED_IN. Returns null once the row is at
 * (or past) CHECKED_IN, where the agenda stops offering a forward tap. The
 * backend trigger is still the authority — this only decides what to offer.
 */
export function nextStatus(status: AppointmentStatus): AppointmentPatchStatus | null {
  switch (status) {
    case "SCHEDULED":
      return "CONFIRMED"
    case "CONFIRMED":
      return "CHECKED_IN"
    default:
      return null
  }
}

/** German label for the forward-tap button leading to `next`. */
export function nextStatusLabel(next: AppointmentPatchStatus): string {
  switch (next) {
    case "CONFIRMED":
      return "Bestätigen"
    case "CHECKED_IN":
      return "Einchecken"
    default:
      return "Weiter"
  }
}

/** Whether a row is still in a live (non-terminal) state worth acting on. */
export function isTerminal(status: AppointmentStatus): boolean {
  return (
    status === "COMPLETED" ||
    status === "NO_SHOW" ||
    status === "CANCELLED" ||
    status === "RESCHEDULED"
  )
}

// ── de-DE date / time formatting ──────────────────────────────────────────────
const TIME_FMT = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" })
const DATE_FMT = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})
const DAY_HEADER_FMT = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
})

/** "14:30" for an ISO timestamp. */
export function formatTime(iso: string): string {
  return TIME_FMT.format(new Date(iso))
}

/** "14:30–15:00" for a start + end ISO pair. */
export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)}–${formatTime(endIso)}`
}

/** "Mo, 23.06.2026" — the compact date shown in the agenda's date stepper. */
export function formatDateShort(d: Date): string {
  return DATE_FMT.format(d)
}

/** "Montag, 23. Juni" — the long header used inside the booking flow. */
export function formatDayHeader(d: Date): string {
  return DAY_HEADER_FMT.format(d)
}

// ── Day-window math (local time) ──────────────────────────────────────────────
/** Midnight (local) at the start of the given day. */
export function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

/** Midnight (local) at the start of the NEXT day — the exclusive window end. */
export function endOfDay(d: Date): Date {
  const out = startOfDay(d)
  out.setDate(out.getDate() + 1)
  return out
}

/** Shift a date by whole days (negative = back), preserving the time-of-day. */
export function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + days)
  return out
}

export function isToday(d: Date): boolean {
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

/** Sort an appointment list by start time, ascending (the agenda order). */
export function sortByStart(items: readonly AppointmentListItem[]): AppointmentListItem[] {
  return [...items].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
}
