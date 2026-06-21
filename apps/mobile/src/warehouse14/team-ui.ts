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
 *   • who opened the OPEN till ON THIS DEVICE — `ShiftView.openedByUserId` +
 *     `openedAt` from `shifts.getCurrent()`. That read is DEVICE-SCOPED: the
 *     route filters to the requesting device cert and returns null when this
 *     device has no open shift. There is no list-all-open-registers endpoint, so
 *     the surface never claims to see other tills — only THIS one's session.
 * So this surface READS those facts and is explicit that the full roster, roles
 * and PINs are administered at the Desktop-Kasse. It fabricates NO staff list.
 *
 * The ONE cashier-session action the API truly allows from this device is
 * OPENING this device's register (`POST /api/shifts/open` → the Zweitkasse).
 * That is a real, verified mutation (the server enforces one open shift per
 * device; a second open answers 409 CONFLICT). Opening a drawer signs no Beleg,
 * so it carries no step-up — but it sets a counted opening float, so it is a
 * money-context act gated behind a deliberate confirm. The Blindsturz CLOSE is a
 * fiscal write (step-up) and is owned by the Kasse cockpit — this surface hands
 * off to it honestly rather than re-implementing it. Everything else here is a
 * label or a pure derivation over real session/shift data.
 *
 * Role vocabulary mirrors the server's `ActorRole` union exactly
 * (ADMIN | CASHIER | READONLY) — the same three roles `auth-pin.ts` issues.
 */
import type { ActorRole, SessionActor, ShiftView } from "@warehouse14/api-client"

import { fromCents, tryToCents } from "./sell/cart-math"

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
  subtitle: "Dieses Gerät ist eine vollwertige zweite Kasse.",
  body:
    "Jedes gekoppelte Gerät führt seine eigene Schicht über denselben " +
    "Kassen- und Steuer-Datensatz. Verkauf, Ankauf und Tagesabschluss laufen " +
    "fiskalisch sauber über den Server — wie an der Haupt-Kasse. „Im Dienst" +
    "“ zeigt deshalb die Schicht dieses Geräts, nicht die anderer Kassen.",
} as const

// ── Zweitkasse öffnen (the one cashier-session mutation this device allows) ───
/**
 * Opening THIS device's register: a counted opening float (Anfangsbestand) is
 * persisted as the shift's starting drawer. It is a money-context act — so it is
 * confirmed deliberately — but NOT a fiscal write (no Beleg, no TSE signature),
 * so it needs no PIN step-up. The server enforces one open shift per device.
 */
export const OPEN_SHIFT_COPY = {
  /** The card shown when this device has no open shift. */
  cardTitle: "Zweitkasse öffnen",
  cardSubtitle: "Starte die Schicht dieses Geräts mit dem gezählten Anfangsbestand.",
  floatLabel: "Anfangsbestand (Wechselgeld)",
  floatHint: "Der gezählte Kassenbestand zu Schichtbeginn.",
  openCta: "Zweitkasse öffnen",
  /** The confirm sheet. */
  confirmTitle: "Zweitkasse öffnen",
  amountCaption: "Anfangsbestand",
  confirmLabel: "Schicht öffnen",
  /** Honest weight note — deliberately NOT the fiscal-Beleg framing (no TSE). */
  note:
    "Damit beginnt die Schicht dieses Geräts über den gemeinsamen Kassen-Datensatz. " +
    "Der Anfangsbestand wird als Startbestand der Kasse festgehalten. Der " +
    "Tagesabschluss (Blindzählung) erfolgt später unter „Kasse“.",
  /** Step-by-step: open is here, close is in Kasse — say so plainly. */
  closeHandoffNote: "Die Schicht wird beim Kassensturz unter „Kasse“ abgeschlossen.",
} as const

/** Validation outcome for the typed opening float. */
export interface FloatValidation {
  /** The wire DECIMAL STRING ("100.00") when valid, else null. */
  wireValue: string | null
  /** Integer cents when valid, else null. */
  cents: bigint | null
  /** A German error to show under the field, or null when fine (incl. empty). */
  error: string | null
}

/**
 * Validate a user-typed opening float (tolerant of the German comma). Empty is
 * NOT an error mid-typing — it just isn't openable yet (wireValue null). A
 * non-decimal or a negative amount is a clear error. Zero is allowed (a drawer
 * may legitimately start empty). Mirrors the cart-math cents discipline so the
 * value we send is byte-clean.
 */
export function validateOpeningFloat(input: string): FloatValidation {
  const trimmed = input.trim()
  if (trimmed === "") return { wireValue: null, cents: null, error: null }
  const cents = tryToCents(trimmed)
  if (cents == null) {
    return { wireValue: null, cents: null, error: "Bitte einen gültigen Betrag eingeben." }
  }
  if (cents < 0n) {
    return { wireValue: null, cents: null, error: "Der Anfangsbestand darf nicht negativ sein." }
  }
  return { wireValue: fromCents(cents), cents, error: null }
}

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
  // Device-scoped truth: this is THIS device's open shift, not a shop-wide view.
  onDutySubtitle: "Wer die Schicht dieses Geräts geöffnet hat.",
  onDutyClosedTitle: "Keine Schicht auf diesem Gerät",
  onDutyClosedDescription:
    "Dieses Gerät hat gerade keine offene Schicht. Öffne unten die Zweitkasse, um zu starten.",
  // Shown when the shift READ failed: we must NOT claim the till is closed —
  // the status is genuinely unknown, possibly open (DESIGN.md §4 honesty).
  onDutyUnknownTitle: "Status nicht abrufbar",
  onDutyUnknownDescription:
    "Die offene Schicht konnte gerade nicht gelesen werden. Ob die Kasse offen ist, ist deshalb unklar — bitte erneut versuchen.",
  // The honest close handoff — shown on the on-duty card when a shift is open.
  closeHandoffCta: "Schicht abschließen",
  closeHandoffHint: "Kassensturz unter „Kasse“",
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
