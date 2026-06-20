/**
 * Team-UI — presentation helpers for the Team-/Zweitkasse-Fläche
 * (src/app/team.tsx).
 *
 * HONESTY FIRST (DESIGN.md §4, absolute). The backend exposes NO staff-roster
 * or staff-mutation endpoint to a paired device: there is no GET /api/users and
 * no api-client `usersApi`. The only people-shaped truths the app can read are
 *   • the CURRENT operator — `SessionActor` from the PIN-login session
 *     (`{ id, role, isOwner }`; the server deliberately does NOT ship a name or
 *     email to the device), and
 *   • who opened the OPEN till — `ShiftView.openedByUserId` + `openedAt` from
 *     `shifts.getCurrent()`.
 * So this surface READS those two facts and is explicit that the full roster,
 * roles and PINs are administered at the Desktop-Kasse. It fabricates NO staff
 * list and offers NO mutation. Every string here is a label or a pure derivation
 * over real session/shift data — nothing in this module touches the network.
 *
 * Role vocabulary mirrors the server's `ActorRole` union exactly
 * (ADMIN | CASHIER | READONLY) — the same three roles `auth-pin.ts` issues.
 */
import type { ActorRole, SessionActor, ShiftView } from "@warehouse14/api-client"

// ── Rollen (the server's ActorRole union, in German) ─────────────────────────
/** German display label per role. */
export const ROLE_LABELS: Record<ActorRole, string> = {
  ADMIN: "Verwaltung",
  CASHIER: "Kasse",
  READONLY: "Nur Ansicht",
}

/** One-line German description of what a role may do — the owner's reference. */
export const ROLE_DESCRIPTIONS: Record<ActorRole, string> = {
  ADMIN: "Voller Zugriff: Verkauf, Ankauf, Tagesabschluss und Verwaltung.",
  CASHIER: "Tägliches Geschäft an der Kasse: Verkauf, Ankauf und Schicht.",
  READONLY: "Liest Auswertungen und Belege, verändert aber nichts.",
}

/** Badge variant per role — ADMIN is the brass „default", the rest are calm. */
export function roleBadgeVariant(
  role: ActorRole,
): "default" | "secondary" | "outline" {
  switch (role) {
    case "ADMIN":
      return "default"
    case "CASHIER":
      return "secondary"
    case "READONLY":
      return "outline"
  }
}

/** The fixed reference order the role list renders in (most to least access). */
export const ROLE_ORDER: readonly ActorRole[] = ["ADMIN", "CASHIER", "READONLY"] as const

// ── Der aktuelle Operator (from the PIN-login SessionActor) ───────────────────
/**
 * The honest "who is signed in on THIS phone" view-model, derived purely from
 * the session actor. The server ships no name to the device, so the display
 * name is the role label (+ an „Inhaber" marker when `isOwner`), never a
 * fabricated personal name.
 */
export interface CurrentOperator {
  /** The real user id from the session (used only as a stable identifier). */
  id: string
  role: ActorRole
  /** German role label. */
  roleLabel: string
  /** True when this account is the shop owner (server `isOwner`). */
  isOwner: boolean
  /** A short, honest display title — the role label, marked when owner. */
  title: string
  /** The last 6 chars of the user id — a stable, non-PII operator reference. */
  shortRef: string
}

/** Build the current-operator view-model from the session actor, or null. */
export function currentOperator(actor: SessionActor | null): CurrentOperator | null {
  if (actor == null) return null
  const roleLabel = ROLE_LABELS[actor.role]
  return {
    id: actor.id,
    role: actor.role,
    roleLabel,
    isOwner: actor.isOwner,
    title: actor.isOwner ? `${roleLabel} · Inhaber` : roleLabel,
    shortRef: shortUserRef(actor.id),
  }
}

// ── Wer ist im Dienst (from the OPEN shift) ──────────────────────────────────
/**
 * The honest "who is on duty right now" view-model, derived purely from the
 * open shift. `null` shift → nobody on duty (the till is closed). When the open
 * shift was opened by THIS signed-in operator we say so plainly; otherwise we
 * surface the short user reference the shift carries (the server gives no name).
 */
export interface OnDuty {
  /** The shift id (stable key). */
  shiftId: string
  /** The user id that opened the till. */
  openedByUserId: string
  /** True when the OPEN shift was opened by the current operator. */
  isCurrentOperator: boolean
  /** Honest display title: „Du" when it's you, else the short user reference. */
  title: string
  /** Non-PII short reference for the opener (last 6 chars of the id). */
  shortRef: string
  /** Whether the shift is OPEN (only OPEN shifts count as "on duty"). */
  isOpen: boolean
}

/**
 * Derive who is on duty from the current open shift + the signed-in actor.
 * Returns null when there is no shift or the shift is not OPEN — the honest
 * "nobody on duty / till closed" signal.
 */
export function onDuty(
  shift: ShiftView | null,
  actor: SessionActor | null,
): OnDuty | null {
  if (shift == null || shift.status !== "OPEN") return null
  const isCurrentOperator = actor != null && actor.id === shift.openedByUserId
  const shortRef = shortUserRef(shift.openedByUserId)
  return {
    shiftId: shift.id,
    openedByUserId: shift.openedByUserId,
    isCurrentOperator,
    title: isCurrentOperator ? "Du" : `Mitarbeiter ${shortRef}`,
    shortRef,
    isOpen: true,
  }
}

// ── Zweitkasse (the secondary-register reality) ──────────────────────────────
/**
 * Each paired device (phone, second till) runs ITS OWN shift over the SAME
 * fiscal record. The app reads only the shift on the current device's context;
 * there is no list-all-open-registers endpoint. This honest copy explains the
 * Zweitkasse model without inventing other registers' live state.
 */
export const ZWEITKASSE_COPY = {
  title: "Zweitkasse",
  subtitle: "Diese App ist eine vollwertige zweite Kasse.",
  body:
    "Jedes gekoppelte Gerät führt seine eigene Schicht über denselben " +
    "Kassen- und Steuer-Datensatz. Verkauf, Ankauf und Tagesabschluss laufen " +
    "fiskalisch sauber über den Server — wie an der Haupt-Kasse.",
} as const

// ── „Verwaltung am Desktop" — the honest roster note ─────────────────────────
/**
 * The roster (Mitarbeiter anlegen, Rollen vergeben, PINs setzen) is managed at
 * the Desktop-Kasse — the device exposes no staff-admin endpoint. This is the
 * single source of that copy so the screen stays declarative.
 */
export const DESKTOP_MANAGEMENT_COPY = {
  title: "Verwaltung am Desktop",
  description:
    "Mitarbeiter anlegen, Rollen vergeben und PINs setzen erfolgt sicher an " +
    "der Desktop-Kasse. Diese App zeigt das Team und wer im Dienst ist — sie " +
    "verändert die Stammdaten nicht.",
  /** The explicit backend-gap footnote — honesty made visible (DESIGN.md §4). */
  gap: "Hinweis: Das Telefon hat bewusst keinen Schreibzugriff auf Mitarbeiterdaten.",
} as const

/** Screen-level copy (title + subtitle + the empty/closed states). */
export const COPY = {
  screenTitle: "Team",
  screenSubtitle: "Wer ist angemeldet, wer ist im Dienst — und wie die Rollen geregelt sind.",
  operatorTitle: "Angemeldet auf diesem Gerät",
  operatorSubtitle: "Die aktuelle Sitzung dieses Telefons.",
  operatorEmptyTitle: "Nicht angemeldet",
  operatorEmptyDescription: "Melde dich mit deiner PIN an, um dein Konto zu sehen.",
  onDutyTitle: "Im Dienst",
  onDutySubtitle: "Wer die aktuelle Schicht geöffnet hat.",
  onDutyClosedTitle: "Niemand im Dienst",
  onDutyClosedDescription: "Keine offene Schicht. Die Kasse wird zu Schichtbeginn geöffnet.",
  rolesTitle: "Rollen",
  rolesSubtitle: "Was die drei Berechtigungen dürfen.",
  ownerBadge: "Inhaber",
  youBadge: "Du",
  openedAtPrefix: "Geöffnet am",
} as const

// ── Zeit + Identitäts-Helfer ─────────────────────────────────────────────────
/**
 * Last 6 chars of a user/shift id — a stable, non-PII reference shown when the
 * server gives no human name. Upper-cased for legibility; never the full id.
 */
export function shortUserRef(id: string): string {
  const tail = id.replace(/[^a-zA-Z0-9]/g, "").slice(-6)
  return tail.length > 0 ? tail.toUpperCase() : id
}

/** Format an ISO-8601 timestamp as a de-DE date + time, or null when absent. */
export function formatTimestamp(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * Honest, calm relative duration since `iso` (the shift opening): „gerade eben",
 * „seit 12 Min.", „seit 3 Std.", „seit 2 Tg.". Never invents precision it does
 * not have; returns null on a bad/empty timestamp.
 */
export function durationSince(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const mins = Math.floor((now - then) / 60_000)
  if (mins < 1) return "gerade eben"
  if (mins < 60) return `seit ${mins} Min.`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `seit ${hours} Std.`
  const days = Math.floor(hours / 24)
  return `seit ${days} Tg.`
}
