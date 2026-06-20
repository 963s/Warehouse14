/**
 * Aufgaben UI helpers — the pure, dependency-light glue between the tasks
 * api-client and the Aufgaben screens (src/app/aufgaben.tsx + aufgaben/neu.tsx
 * + aufgaben/edit.tsx).
 *
 * Holds ONLY presentation + state logic: the German labels for status and
 * priority, the status → Badge-variant map, the status-group ordering for the
 * list, the de-DE due-date formatting, and the legal-transition model that
 * mirrors ALLOWED_TASK_TRANSITIONS. The actual api calls live in
 * src/warehouse14/api.ts; the server's state machine is the real authority on
 * whether a transition is legal — this module only decides what to OFFER.
 */
import type { TaskPriority, TaskRow, TaskStatus } from "@warehouse14/api-client"
import { ALLOWED_TASK_TRANSITIONS } from "@warehouse14/api-client"

// ── German labels ─────────────────────────────────────────────────────────────
export const TASK_STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  OPEN: "Offen",
  IN_PROGRESS: "In Arbeit",
  BLOCKED: "Blockiert",
  DONE: "Erledigt",
  CANCELLED: "Abgebrochen",
}

export const TASK_PRIORITY_LABELS: Readonly<Record<TaskPriority, string>> = {
  LOW: "Niedrig",
  NORMAL: "Normal",
  HIGH: "Hoch",
  URGENT: "Dringend",
}

/** The four priorities in the order they appear in the picker (low → urgent). */
export const TASK_PRIORITIES: readonly TaskPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"]

// ── Badge tone per status / priority ──────────────────────────────────────────
export type StatusBadgeVariant = "default" | "secondary" | "destructive" | "success" | "outline"

export const STATUS_BADGE_VARIANT: Readonly<Record<TaskStatus, StatusBadgeVariant>> = {
  OPEN: "outline",
  IN_PROGRESS: "secondary",
  BLOCKED: "destructive",
  DONE: "success",
  CANCELLED: "outline",
}

/** Only HIGH / URGENT earn a coloured priority pill; LOW/NORMAL stay quiet. */
export function priorityBadgeVariant(priority: TaskPriority): StatusBadgeVariant | null {
  switch (priority) {
    case "URGENT":
      return "destructive"
    case "HIGH":
      return "secondary"
    default:
      return null
  }
}

// ── List grouping ─────────────────────────────────────────────────────────────
/**
 * The status sections of the list, in display order. The live work sits at the
 * top; terminal states (done/cancelled) sink to the bottom.
 */
export const STATUS_GROUP_ORDER: readonly TaskStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "BLOCKED",
  "DONE",
  "CANCELLED",
]

export interface TaskGroup {
  status: TaskStatus
  label: string
  tasks: TaskRow[]
}

/**
 * Bucket tasks by status into the fixed STATUS_GROUP_ORDER, dropping empty
 * sections. Within a group, sort by priority (urgent first), then by due date
 * (soonest first, undated last), then by creation time as a stable tiebreaker.
 */
export function groupByStatus(tasks: readonly TaskRow[]): TaskGroup[] {
  const byStatus = new Map<TaskStatus, TaskRow[]>()
  for (const task of tasks) {
    const list = byStatus.get(task.status) ?? []
    list.push(task)
    byStatus.set(task.status, list)
  }
  return STATUS_GROUP_ORDER.map((status) => ({
    status,
    label: TASK_STATUS_LABELS[status],
    tasks: (byStatus.get(status) ?? []).sort(compareTasks),
  })).filter((group) => group.tasks.length > 0)
}

const PRIORITY_RANK: Readonly<Record<TaskPriority, number>> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
}

function compareTasks(a: TaskRow, b: TaskRow): number {
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  if (byPriority !== 0) return byPriority
  // Soonest due first; undated rows sink to the end of the group.
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate == null) return 1
    if (b.dueDate == null) return -1
    return a.dueDate.localeCompare(b.dueDate)
  }
  return a.createdAt.localeCompare(b.createdAt)
}

// ── Transition model ──────────────────────────────────────────────────────────
/** Whether a row is in a terminal state (no further transitions offered). */
export function isTerminal(status: TaskStatus): boolean {
  return ALLOWED_TASK_TRANSITIONS[status].length === 0
}

/** The legal next states for a row, straight from the api-client table. */
export function allowedTransitions(status: TaskStatus): readonly TaskStatus[] {
  return ALLOWED_TASK_TRANSITIONS[status]
}

/**
 * The German verb for the button that MOVES a task INTO `target`. "Erledigen"
 * for DONE, "Starten" for IN_PROGRESS, etc. — phrased as the action, not the
 * resulting noun.
 */
export function transitionActionLabel(target: TaskStatus): string {
  switch (target) {
    case "IN_PROGRESS":
      return "Starten"
    case "BLOCKED":
      return "Blockieren"
    case "DONE":
      return "Erledigen"
    case "CANCELLED":
      return "Abbrechen"
    case "OPEN":
      return "Wieder öffnen"
    default:
      return TASK_STATUS_LABELS[target]
  }
}

/**
 * A spoken accessibility label for a transition button — the verb plus the task
 * title, so a screen reader announces what the tap actually does to which task.
 */
export function transitionAccessibilityLabel(target: TaskStatus, title: string): string {
  return `${transitionActionLabel(target)}: ${title}`
}

/**
 * Which transition is the PRIMARY (happy-path) move for a status — the one we
 * raise to a filled brass button and offer as the swipe-to-act. OPEN/BLOCKED →
 * the productive forward step (start / resume); IN_PROGRESS → finish. The rest
 * (block, reopen, cancel) stay as quiet outline actions. Terminal rows have none.
 */
export function primaryTransition(status: TaskStatus): TaskStatus | null {
  switch (status) {
    case "OPEN":
      return "IN_PROGRESS"
    case "IN_PROGRESS":
      return "DONE"
    case "BLOCKED":
      return "IN_PROGRESS"
    default:
      return null
  }
}

// ── de-DE due-date formatting ─────────────────────────────────────────────────
const DUE_DATE_FMT = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

/**
 * Parse a `due_date` value into a LOCAL calendar day, never round-tripped
 * through UTC. `internal_tasks.due_date` is a Postgres DATE, so the wire value
 * is a date-only "YYYY-MM-DD" string. `new Date("YYYY-MM-DD")` would read that
 * as UTC midnight, which renders as the PREVIOUS day for any negative-offset
 * operator — so a bare date is split and rebuilt at LOCAL midnight instead.
 * Full date-time values (legacy rows) still flow through the native parser.
 * Returns null on a malformed value.
 */
function parseDueDateLocal(value: string): Date | null {
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnly) {
    const [, yyyy, mm, dd] = dateOnly
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 0, 0, 0, 0)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "Mi, 24.06.2026" for a due-date string, or null when undated. */
export function formatDueDate(iso: string | null): string | null {
  if (!iso) return null
  const d = parseDueDateLocal(iso)
  if (!d) return null
  return DUE_DATE_FMT.format(d)
}

/**
 * Whether the due date is in the past relative to today (local midnight). A live
 * task past its due date is rendered with a destructive accent. Terminal rows
 * never count as overdue.
 */
export function isOverdue(task: TaskRow): boolean {
  if (!task.dueDate || isTerminal(task.status)) return false
  const due = parseDueDateLocal(task.dueDate)
  if (!due) return false
  due.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return due.getTime() < today.getTime()
}

/** Whether a task's due date falls on today (local midnight window). */
export function isDueToday(task: TaskRow): boolean {
  if (!task.dueDate || isTerminal(task.status)) return false
  const due = parseDueDateLocal(task.dueDate)
  if (!due) return false
  const today = new Date()
  return (
    due.getFullYear() === today.getFullYear() &&
    due.getMonth() === today.getMonth() &&
    due.getDate() === today.getDate()
  )
}

// ── Honest list summary (derived only from the fetched rows) ───────────────────
export interface TaskSummary {
  total: number
  open: number
  overdue: number
}

/** Count the rows that matter for the header line — never a fabricated total. */
export function summarise(tasks: readonly TaskRow[]): TaskSummary {
  let open = 0
  let overdue = 0
  for (const task of tasks) {
    if (!isTerminal(task.status)) open += 1
    if (isOverdue(task)) overdue += 1
  }
  return { total: tasks.length, open, overdue }
}

/**
 * A de-DE summary line for the header, built only from real counts, e.g.
 * „8 Aufgaben · 5 offen · 2 überfällig". Drops the parts that are zero so the
 * line stays honest and quiet.
 *
 * `serverTotal` is the endpoint's real row count for the active filter. When the
 * list hasn't loaded every page yet (the table is never pruned — „forensic +
 * GoBD-relevant" — so it can exceed one page), this keeps the leading count
 * truthful: it shows the server's total, not just the rows currently in memory.
 * The „offen"/„überfällig" parts stay derived from the loaded rows, since those
 * are only knowable for what we've actually fetched.
 */
export function summaryLine(tasks: readonly TaskRow[], serverTotal?: number): string {
  const s = summarise(tasks)
  const total = serverTotal ?? s.total
  const parts: string[] = [`${total} ${total === 1 ? "Aufgabe" : "Aufgaben"}`]
  if (s.open > 0) parts.push(`${s.open} offen`)
  if (s.overdue > 0) parts.push(`${s.overdue} überfällig`)
  return parts.join(" · ")
}

// ── de-DE date parsing for the create/edit form (no date-picker dep) ──────────
/** Prefill an "TT.MM.JJJJ" field from a due-date string (or "" when null). */
export function dueDateInput(iso: string | null): string {
  if (!iso) return ""
  const d = parseDueDateLocal(iso)
  if (!d) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

/**
 * Parse a "TT.MM.JJJJ" date field → a date-only "YYYY-MM-DD" string for the
 * `dueDate` body field, or `{ ok: false }` if malformed. An empty/whitespace
 * string is treated as "no due date" and yields `date: null` so callers can
 * clear it.
 *
 * The wire value MUST be a bare calendar day, never an ISO timestamp: the
 * backend column `internal_tasks.due_date` is a Postgres DATE and the TypeBox
 * body schema enforces `format: "date"` (ajv-formats), so a full ISO string
 * (`…T00:00:00.000Z`) is rejected with HTTP 400. It must also never be built by
 * round-tripping a local Date through `toISOString()`, which shifts the day for
 * any non-UTC operator (a Europe/Berlin Owner typing 24.06. would otherwise
 * store the 23rd). We therefore assemble the day from the typed components
 * directly and zero-pad it — no timezone ever enters the value.
 */
export function parseDueDateInput(
  input: string,
): { ok: true; date: string | null } | { ok: false } {
  const trimmed = input.trim()
  if (trimmed === "") return { ok: true, date: null }
  const m = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (!m) return { ok: false }
  const [, dd, mm, yyyy] = m
  const day = Number(dd)
  const month = Number(mm)
  const year = Number(yyyy)
  // Validate the calendar day via a local Date, then DISCARD it — we never read
  // its UTC value, only confirm the typed day didn't roll over (e.g. 32.01).
  const probe = new Date(year, month - 1, day, 0, 0, 0, 0)
  if (Number.isNaN(probe.getTime())) return { ok: false }
  if (probe.getDate() !== day || probe.getMonth() !== month - 1) return { ok: false }
  const pad = (n: number) => String(n).padStart(2, "0")
  return { ok: true, date: `${year}-${pad(month)}-${pad(day)}` }
}
