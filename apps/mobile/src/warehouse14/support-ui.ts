/**
 * Anfragen-Vokabular — die reinen Ableitungen hinter der Ticket-Fläche.
 *
 * Kein React, kein Netz: Sortierung, Summen, Beschriftungen und die
 * Sende-Prüfung leben hier, damit die Fläche nur noch zeichnet und diese
 * Regeln ohne Simulator geprüft werden können (wie whatsapp-ui, ebay-ui).
 *
 * Die eine Regel, die dieses Modul trägt: die Warteschlange sortiert nach WER
 * ZULETZT GESPROCHEN HAT, nicht nach Alter. Eine unbeantwortete Frage ist das
 * Einzige in dieser Liste, das gerade laufend Vertrauen kostet — ein neueres
 * Ticket, das bereits eine Antwort hat, wartet auf den Kunden, nicht auf uns.
 */

import type { SupportTicketSummary, TicketStatus } from "@warehouse14/api-client"

/** Die Fächer der Kopfzeile. „ALLE" ist die Standardsicht: alles Offene. */
export type TicketBucket = TicketStatus | "ALLE"

export const TICKET_BUCKETS: readonly TicketBucket[] = [
  "ALLE",
  "OFFEN",
  "WARTET",
  "GESCHLOSSEN",
] as const

/**
 * Deutsche Beschriftung je Status. Der Server liefert Rohmarken; hier ist die
 * einzige Stelle, an der sie zu Sprache werden — nie eine Rohmarke auf dem
 * Bildschirm.
 */
export function statusLabel(status: string): string {
  switch (status) {
    case "OFFEN":
      return "Offen"
    case "WARTET":
      return "Wartet auf Antwort der Kundschaft"
    case "GESCHLOSSEN":
      return "Geschlossen"
    default:
      return "Unbekannt"
  }
}

/** Die kurze Form für eine Zeile, wo die lange Beschriftung umbrechen würde. */
export function statusShort(status: string): string {
  switch (status) {
    case "OFFEN":
      return "Offen"
    case "WARTET":
      return "Wartet"
    case "GESCHLOSSEN":
      return "Geschlossen"
    default:
      return "Unbekannt"
  }
}

/** Die Beschriftung eines Fachs in der Filterzeile. */
export function bucketLabel(bucket: TicketBucket): string {
  return bucket === "ALLE" ? "Alle offenen" : statusShort(bucket)
}

/** Wer als Absender in der Zeile steht, wenn kein Kunde verknüpft ist. */
export function ticketPartyName(ticket: SupportTicketSummary): string {
  return ticket.customerName ?? "Unbekannte Absenderin oder Absender"
}

export interface TicketCounts {
  /** Anfragen, bei denen die Kundschaft zuletzt gesprochen hat. */
  awaiting: number
  /** Alles, was nicht geschlossen ist. */
  open: number
  total: number
}

export function countTickets(tickets: readonly SupportTicketSummary[]): TicketCounts {
  let awaiting = 0
  let open = 0
  for (const t of tickets) {
    if (t.awaitingReply) awaiting += 1
    if (t.status !== "GESCHLOSSEN") open += 1
  }
  return { awaiting, open, total: tickets.length }
}

/**
 * Wartende zuerst, danach das zuletzt Gesagte zuerst. Der Server sortiert
 * bereits so; diese Kopie hält die Reihenfolge stabil, wenn die Fläche eine
 * zwischengespeicherte Liste zeigt, die aus einer anderen Abfrage stammt.
 */
export function sortTickets(
  tickets: readonly SupportTicketSummary[],
): SupportTicketSummary[] {
  const spokeAt = (t: SupportTicketSummary): number => {
    const raw = t.lastInboundAt ?? t.lastOutboundAt ?? t.createdAt
    const ms = new Date(raw).getTime()
    return Number.isFinite(ms) ? ms : 0
  }
  return [...tickets].sort((a, b) => {
    if (a.awaitingReply !== b.awaitingReply) return a.awaitingReply ? -1 : 1
    return spokeAt(b) - spokeAt(a)
  })
}

/** Der Kopfsatz über der Liste — echte Summen, sonst ein ehrliches Nichts. */
export function summaryLine(counts: TicketCounts | null): string {
  if (counts == null) return "Anfragen werden geladen."
  if (counts.total === 0) return "Keine Anfrage in diesem Fach."
  if (counts.awaiting === 0) return "Keine Anfrage wartet auf eine Antwort."
  return counts.awaiting === 1
    ? "1 Anfrage wartet auf eine Antwort."
    : `${counts.awaiting} Anfragen warten auf eine Antwort.`
}

/** Kürzeste sinnvolle Antwort. Kürzer ist fast immer ein Fehlgriff. */
export const MIN_REPLY_LENGTH = 2

export interface ReplyValidation {
  ok: boolean
  error: string | null
}

export function validateReply(body: string): ReplyValidation {
  const trimmed = body.trim()
  if (trimmed.length === 0) return { ok: false, error: "Die Antwort ist noch leer." }
  if (trimmed.length < MIN_REPLY_LENGTH)
    return { ok: false, error: "Die Antwort ist zu kurz." }
  return { ok: true, error: null }
}

/**
 * Was nach einer angenommenen Antwort auf dem Bildschirm steht.
 *
 * Bewusst „übernommen" und nie „gesendet": die Antwort wird in denselben
 * Postausgang gelegt, den auch die Reservierungsbriefe nutzen, und geht mit
 * dem nächsten Lauf des Zustellers raus. „Gesendet" wäre eine Vermutung über
 * einen Takt, der noch nicht stattgefunden hat.
 */
export function replyAcceptedNote(ticketNumber: string): string {
  return `Antwort zu ${ticketNumber} ist übernommen und liegt im Postausgang.`
}
