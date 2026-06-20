/**
 * WhatsApp-Posteingang — die geteilte Präsentationsschicht (deutsche Labels,
 * Status-Badges, Telefon-Formatierung, Sende-Validierung, KI-Status-Texte). Die
 * Wahrheit über den Nachrichten-Lebenszyklus lebt im Server (der Meta-Provider
 * besitzt queued → sent → delivered → read → failed); dieses Modul ÜBERSETZT
 * diese Zustände nur für die Owner-UI und erfindet nichts: ein „gesendet" wird
 * nur gezeigt, wenn der Server es so meldet, ein „in Warteschlange" bleibt
 * ehrlich „in Warteschlange", solange kein Meta-Zugang hinterlegt ist.
 *
 * Reines, framework-freies Modul (keine React-Imports) — nur Daten + Mapper, so
 * wie ebay-ui.ts / ankauf-ui.ts. Die Bildschirme ziehen daraus.
 */
import type {
  WhatsAppMessageDirection,
  WhatsAppOutboundStatus,
  WhatsAppSendResponse,
  WhatsAppThreadSummary,
} from "@warehouse14/api-client"

import type { BadgeProps } from "@/components/ui/badge"

export type BadgeVariant = NonNullable<BadgeProps["variant"]>

// ── Sende-Grenzen ─────────────────────────────────────────────────────────────
// Der Server lehnt einen leeren Body ab; die UI prüft schon vorher, damit der
// Sende-Knopf nicht feuert, wenn nichts oder etwas Unmögliches drinsteht. Die
// Obergrenze spiegelt das WhatsApp-Textlimit großzügig — der Server bleibt die
// echte Wahrheit, das hier ist nur ein freundlicher Riegel vor dem Tippen.
export const WHATSAPP_BODY_MAX = 4096
export const WHATSAPP_PHONE_MIN_DIGITS = 7

// ── Telefon-Formatierung (Anzeige + E.164-Normalisierung) ─────────────────────
// Der Server speichert eine Telefonnummer als Schlüssel des Threads. Wir zeigen
// sie lesbar an (mit „+"-Präfix, wenn international), normalisieren aber für den
// Versand auf reine Ziffern mit optionalem „+", damit der Provider sie annimmt.

/** Reduziert eine Eingabe auf E.164-nahe Form: führendes „+" plus Ziffern. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim()
  const hasPlus = trimmed.startsWith("+")
  const digits = trimmed.replace(/\D+/g, "")
  return hasPlus ? `+${digits}` : digits
}

/** Anzahl der reinen Ziffern in einer Nummer (für die Mindestlängen-Prüfung). */
export function phoneDigitCount(raw: string): number {
  return raw.replace(/\D+/g, "").length
}

/**
 * Lesbare Darstellung einer gespeicherten Thread-Nummer. Wir stellen ein „+"
 * voran, wenn keines da ist (Threads kommen meist als reine Ziffern), und
 * gruppieren in lockere Blöcke, ohne ein bestimmtes Land anzunehmen — also kein
 * erfundenes Format, nur eine ruhige Lesbarkeit.
 */
export function formatPhone(phone: string): string {
  const norm = normalizePhone(phone)
  const digits = norm.replace(/^\+/, "")
  if (digits.length === 0) return phone
  const withPlus = `+${digits}`
  // In 3er/4er-Blöcken gruppieren, ab dem Länder-Teil — rein optisch.
  const head = withPlus.slice(0, 3) // „+49"
  const rest = withPlus.slice(3)
  const grouped = rest.replace(/(\d{3,4})(?=\d)/g, "$1 ").trim()
  return grouped ? `${head} ${grouped}` : head
}

// ── Richtung (eingehend / ausgehend) ──────────────────────────────────────────

export const DIRECTION_LABEL: Readonly<Record<WhatsAppMessageDirection, string>> = {
  inbound: "Eingegangen",
  outbound: "Gesendet",
}

export function directionLabel(direction: WhatsAppMessageDirection): string {
  return DIRECTION_LABEL[direction]
}

/** Ob eine Nachricht von uns stammt (für die Blasen-Ausrichtung rechts). */
export function isOutbound(direction: WhatsAppMessageDirection): boolean {
  return direction === "outbound"
}

// ── Ausgangs-Status (der Provider-Lebenszyklus, ehrlich übersetzt) ────────────
// Der Server meldet den echten Zustand jeder ausgehenden Nachricht. Wir hängen
// nur ein deutsches Label + eine Badge-Variante an. „queued" ist KEIN Fehler,
// aber auch kein „zugestellt" — es heißt ehrlich „in Warteschlange" (z. B. weil
// noch kein Meta-Zugang verbunden ist). „failed" ist die einzige destruktive
// Variante. NULL gehört zu eingehenden Nachrichten (kein Ausgangs-Status).

export interface OutboundStatusMeta {
  label: string
  variant: BadgeVariant
  /** Ob der Zustand ein Endzustand „erfolgreich beim Empfänger" ist. */
  isDelivered: boolean
  /** Ob der Zustand ein Fehlversuch ist (treibt die Fehler-Haptik + rot). */
  isFailed: boolean
  /** Ob die Nachricht noch unterwegs / nicht real zugestellt ist. */
  isPending: boolean
}

const STATUS_META: Readonly<Record<WhatsAppOutboundStatus, OutboundStatusMeta>> = {
  queued: {
    label: "In Warteschlange",
    variant: "secondary",
    isDelivered: false,
    isFailed: false,
    isPending: true,
  },
  sent: {
    label: "Gesendet",
    variant: "outline",
    isDelivered: false,
    isFailed: false,
    isPending: true,
  },
  delivered: {
    label: "Zugestellt",
    variant: "default",
    isDelivered: true,
    isFailed: false,
    isPending: false,
  },
  read: {
    label: "Gelesen",
    variant: "success",
    isDelivered: true,
    isFailed: false,
    isPending: false,
  },
  failed: {
    label: "Fehlgeschlagen",
    variant: "destructive",
    isDelivered: false,
    isFailed: true,
    isPending: false,
  },
}

/** Die Status-Meta einer ausgehenden Nachricht — NULL (eingehend) → kein Status. */
export function outboundStatusMeta(
  status: WhatsAppOutboundStatus | null,
): OutboundStatusMeta | null {
  return status == null ? null : STATUS_META[status]
}

export function statusLabel(status: WhatsAppOutboundStatus | null): string {
  return status == null ? "" : STATUS_META[status].label
}

export function statusVariant(status: WhatsAppOutboundStatus | null): BadgeVariant {
  return status == null ? "outline" : STATUS_META[status].variant
}

// ── Sende-Ergebnis (die ehrliche Auslegung der Send-Antwort) ──────────────────
// Der send-Endpunkt liefert `status: 'queued'`, wenn kein Meta-Zugang hinterlegt
// ist (die Zeile wird trotzdem gespeichert, aber NICHTS geht raus). Wir lesen
// das und sagen ehrlich „in Warteschlange — noch nicht zugestellt", statt ein
// „gesendet" vorzutäuschen. Ein echter Provider-Reject kommt als ApiError mit
// `EXTERNAL_SERVICE_FAILED` und wird vom Aufrufer separat behandelt.

export type SendOutcome = "sent" | "queued"

export interface SendMeta {
  outcome: SendOutcome
  title: string
  message: string
  /** Ob die Nachricht wirklich beim Provider abgegeben wurde (treibt Erfolg). */
  isLive: boolean
}

export function describeSend(res: WhatsAppSendResponse): SendMeta {
  if (res.status === "queued") {
    return {
      outcome: "queued",
      title: "In Warteschlange",
      message:
        "Es ist noch kein WhatsApp-Zugang hinterlegt. Die Nachricht wurde gespeichert, aber " +
        "noch nicht zugestellt. Sobald der Owner WhatsApp verbindet, geht sie raus.",
      isLive: false,
    }
  }
  // sent / delivered / read → wirklich abgegeben (der Provider hat angenommen).
  return {
    outcome: "sent",
    title: "Nachricht gesendet",
    message: `Die Nachricht wurde an ${formatPhone(res.toPhone)} übergeben.`,
    isLive: true,
  }
}

// ── KI-Status (Assistent aktiv / menschliche Übernahme) ───────────────────────
// Der Thread kann vom KI-Assistenten beantwortet werden oder vom Menschen
// übernommen sein (mit einer Abkühlphase, in der die KI pausiert). Wir
// übersetzen den Zustand in eine ruhige deutsche Zeile + ein Toggle-Label.

export interface AiStatusMeta {
  /** Überschrift, z. B. „KI antwortet". */
  title: string
  /** Erklärung, eine Zeile. */
  hint: string
  /** Label für die Umschalt-Aktion (das Gegenteil des aktuellen Zustands). */
  toggleLabel: string
}

export function describeAiStatus(aiActive: boolean): AiStatusMeta {
  if (aiActive) {
    return {
      title: "KI antwortet",
      hint: "Der Assistent beantwortet diesen Chat automatisch.",
      toggleLabel: "Selbst übernehmen",
    }
  }
  return {
    title: "Du antwortest",
    hint: "Du hast den Chat übernommen — die KI pausiert.",
    toggleLabel: "An KI zurückgeben",
  }
}

// ── Sende-Validierung (der Riegel vor dem Provider-Aufruf) ────────────────────
// Eine reine, framework-freie Prüfung, damit der Sende-Knopf nur feuert, wenn
// Body + Ziel plausibel sind. Der Server bleibt die echte Wahrheit (er kann
// strengere Format-Regeln haben), aber diese Prüfung fängt das Offensichtliche
// ab und liefert eine deutsche Fehlerzeile pro Feld.

export interface SendValidation {
  ok: boolean
  /** Feld-Fehler, falls vorhanden (deutsch). */
  bodyError: string | null
  phoneError: string | null
}

export function validateSend(args: { toPhone: string; body: string }): SendValidation {
  const body = args.body.trim()
  const phoneDigits = phoneDigitCount(args.toPhone)

  let bodyError: string | null = null
  if (body.length === 0) {
    bodyError = "Bitte eine Nachricht eingeben."
  } else if (body.length > WHATSAPP_BODY_MAX) {
    bodyError = `Die Nachricht ist zu lang (max. ${WHATSAPP_BODY_MAX} Zeichen).`
  }

  let phoneError: string | null = null
  if (phoneDigits === 0) {
    phoneError = "Bitte eine Telefonnummer eingeben."
  } else if (phoneDigits < WHATSAPP_PHONE_MIN_DIGITS) {
    phoneError = "Die Telefonnummer ist zu kurz."
  }

  return { ok: bodyError == null && phoneError == null, bodyError, phoneError }
}

// ── Posteingang-Zählung (echte Summen aus echten Threads) ─────────────────────
// Aus der Thread-Liste die Gesamtzahl ungelesener Nachrichten + die Anzahl der
// Chats mit offenen Eingängen. Reine Reduktion — die Kopfzeile zeigt echte
// Zahlen oder den leeren Zustand, nie eine erfundene „0 als Erfolg".

export interface InboxCounts {
  /** Gesamtzahl ungelesener eingehender Nachrichten über alle Threads. */
  unreadTotal: number
  /** Anzahl der Threads mit mindestens einer ungelesenen Nachricht. */
  unreadThreads: number
  /** Gesamtzahl der Threads. */
  threads: number
}

export function countInbox(threads: ReadonlyArray<WhatsAppThreadSummary>): InboxCounts {
  let unreadTotal = 0
  let unreadThreads = 0
  for (const th of threads) {
    if (th.unreadCount > 0) {
      unreadTotal += th.unreadCount
      unreadThreads += 1
    }
  }
  return { unreadTotal, unreadThreads, threads: threads.length }
}

/** Sortiert Threads neueste-zuerst, ungelesene vor gelesenen bei Gleichstand. */
export function sortThreads(
  threads: ReadonlyArray<WhatsAppThreadSummary>,
): WhatsAppThreadSummary[] {
  return [...threads].sort((a, b) => {
    // Ungelesene zuerst, dann nach letztem Zeitstempel absteigend.
    const aUnread = a.unreadCount > 0 ? 1 : 0
    const bUnread = b.unreadCount > 0 ? 1 : 0
    if (aUnread !== bUnread) return bUnread - aUnread
    return b.lastMessageAt.localeCompare(a.lastMessageAt)
  })
}

/** Der Anzeigename eines Threads — verknüpfter Kunde, sonst die Nummer. */
export function threadDisplayName(thread: WhatsAppThreadSummary): string {
  return thread.linkedCustomerName ?? formatPhone(thread.phone)
}
