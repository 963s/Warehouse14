/**
 * eBay-Kanal — die geteilte Präsentationsschicht (deutsche Labels, Phasen,
 * Badge-Varianten, Konflikt-Texte, Übergangs-Aktionen, Veröffentlichungs-
 * Auslegung). Die Logik der Zustandsmaschine selbst lebt im api-client
 * (`ALLOWED_EBAY_TRANSITIONS`, `EBAY_STATE_ORDER`, `EBAY_STATE_LABELS`) und im
 * Server-Trigger — dieses Modul ÜBERSETZT diese Wahrheit nur für die Owner-UI.
 * Es erfindet nichts: jeder Übergang wird gegen `ALLOWED_EBAY_TRANSITIONS`
 * geprüft, jede Konflikt-Zeile gegen den echten `inventorySideEffect`.
 *
 * Reines, framework-freies Modul (keine React-Imports) — nur Daten + Mapper, so
 * wie product-ui.ts / ankauf-ui.ts. Die Bildschirme ziehen daraus.
 */
import {
  ALLOWED_EBAY_TRANSITIONS,
  EBAY_STATE_LABELS,
  EBAY_STATE_ORDER,
  type EbayInventorySideEffect,
  type EbayPublishResponse,
  type EbaySource,
  type EbayState,
} from "@warehouse14/api-client"

import type { BadgeProps } from "@/components/ui/badge"

export type BadgeVariant = NonNullable<BadgeProps["variant"]>

// ── Phasen (die 9 Stufen zu 4 lesbaren Abschnitten verdichtet) ────────────────
// Die Pipeline-Übersicht gruppiert Artikel nach Phase, damit der Owner auf einen
// Blick sieht, „was vorbereitet wird, was online ist, was verkauft ist und was
// reklamiert wurde". Die Reihenfolge folgt EBAY_STATE_ORDER.

export type EbayPhase = "vorbereitung" | "online" | "verkauft" | "reklamation"

export interface EbayPhaseMeta {
  phase: EbayPhase
  /** Deutsches Phasen-Label für die Übersicht. */
  label: string
  /** Kurze Beschreibung der Phase (eine Zeile, kein Ausrufezeichen). */
  description: string
}

/** Phasen in Anzeigereihenfolge (für die Übersichts-Kacheln + Filter). */
export const EBAY_PHASES: readonly EbayPhaseMeta[] = [
  {
    phase: "vorbereitung",
    label: "Vorbereitung",
    description: "Entwurf und Prüfung, noch nicht online.",
  },
  {
    phase: "online",
    label: "Online",
    description: "Aktiv bei eBay gelistet.",
  },
  {
    phase: "verkauft",
    label: "Verkauft",
    description: "Verkauft, bezahlt, verpackt oder versendet.",
  },
  {
    phase: "reklamation",
    label: "Reklamation",
    description: "Reklamiert oder retourniert.",
  },
] as const

/** Welcher Zustand zu welcher Phase gehört. */
export const EBAY_STATE_PHASE: Readonly<Record<EbayState, EbayPhase>> = {
  ENTWURF: "vorbereitung",
  GEPRUEFT: "vorbereitung",
  ONLINE: "online",
  VERKAUFT: "verkauft",
  BEZAHLT: "verkauft",
  VERPACKT: "verkauft",
  VERSENDET: "verkauft",
  REKLAMIERT: "reklamation",
  RETOURNIERT: "reklamation",
}

/** Die Phase eines Artikels — NULL (nie eingebucht) zählt als „vorbereitung". */
export function phaseOf(state: EbayState | null): EbayPhase {
  return state == null ? "vorbereitung" : EBAY_STATE_PHASE[state]
}

// ── Zustands-Badges (deutsches Label + Badge-Variante je Zustand) ─────────────
// Wir lehnen uns an die Status-Badge-Sprache aus product-ui.ts an: „success"
// (verdigris) für aktiv/online, „default" (Messing) für den laufenden Verkauf,
// „destructive" für Reklamation/Retoure, „secondary" für Entwurf/geprüft.

export const EBAY_STATE_VARIANT: Readonly<Record<EbayState, BadgeVariant>> = {
  ENTWURF: "secondary",
  GEPRUEFT: "secondary",
  ONLINE: "success",
  VERKAUFT: "default",
  BEZAHLT: "default",
  VERPACKT: "default",
  VERSENDET: "default",
  REKLAMIERT: "destructive",
  RETOURNIERT: "destructive",
}

/** Das deutsche Label für einen Zustand — NULL liest sich als „Nicht eingebucht". */
export function stateLabel(state: EbayState | null): string {
  return state == null ? "Nicht eingebucht" : EBAY_STATE_LABELS[state]
}

/** Die Badge-Variante für einen Zustand — NULL ist eine neutrale Umriss-Badge. */
export function stateVariant(state: EbayState | null): BadgeVariant {
  return state == null ? "outline" : EBAY_STATE_VARIANT[state]
}

// ── Übergänge (die erlaubten nächsten Schritte als Owner-Aktionen) ────────────
// Der Server ist die Wahrheit: ALLOWED_EBAY_TRANSITIONS. Wir hängen nur ein
// deutsches Verb + eine Erklärung an jeden erlaubten Schritt, damit die UI genau
// die Knöpfe zeigt, die der Server akzeptieren wird — kein erfundener Pfad.

export interface EbayTransitionOption {
  /** Zielzustand (gegen den Server validiert). */
  to: EbayState
  /** Deutsches Verb für den Knopf, z. B. „Online stellen". */
  actionLabel: string
  /** Kurze Erklärung, was der Schritt bewirkt (eine Zeile). */
  hint: string
  /**
   * Ob der Schritt ein Zurücksetzen ist (z. B. ONLINE → ENTWURF). Solche
   * Schritte rendert die UI als sekundäre/Umriss-Aktion, nicht als Haupt-CTA.
   */
  isRevert: boolean
}

/** Statische Beschreibung je Zielzustand (Verb + Hinweis), unabhängig vom Start. */
const TRANSITION_META: Readonly<
  Record<EbayState, { actionLabel: string; hint: string }>
> = {
  ENTWURF: {
    actionLabel: "Zurück zum Entwurf",
    hint: "Listung zurückziehen und erneut bearbeiten.",
  },
  GEPRUEFT: {
    actionLabel: "Als geprüft markieren",
    hint: "Angaben sind vollständig und korrekt.",
  },
  ONLINE: {
    actionLabel: "Online stellen",
    hint: "Den Artikel bei eBay sichtbar listen.",
  },
  VERKAUFT: {
    actionLabel: "Als verkauft markieren",
    hint: "Käufer steht fest reserviert den Bestand.",
  },
  BEZAHLT: {
    actionLabel: "Zahlung bestätigen",
    hint: "Der Käufer hat bezahlt.",
  },
  VERPACKT: {
    actionLabel: "Als verpackt markieren",
    hint: "Bereit für den Versand.",
  },
  VERSENDET: {
    actionLabel: "Als versendet markieren",
    hint: "Paket ist auf dem Weg zum Käufer.",
  },
  REKLAMIERT: {
    actionLabel: "Reklamation erfassen",
    hint: "Der Käufer beanstandet den Kauf.",
  },
  RETOURNIERT: {
    actionLabel: "Als retourniert markieren",
    hint: "Die Ware ist zurück im Lager.",
  },
}

/** Zustände, in denen ein Schritt als „Zurücksetzen" gilt (sekundäre Aktion). */
const REVERT_TARGETS: ReadonlySet<EbayState> = new Set<EbayState>(["ENTWURF"])

/**
 * Die erlaubten nächsten Schritte für einen Artikel im Zustand `state` (NULL =
 * nie eingebucht → nur ENTWURF). Liest direkt aus ALLOWED_EBAY_TRANSITIONS, so
 * dass die UI nie einen Knopf zeigt, den der Server mit 409 ablehnen würde.
 */
export function nextTransitions(state: EbayState | null): EbayTransitionOption[] {
  const key = state ?? "__NULL__"
  const allowed = ALLOWED_EBAY_TRANSITIONS[key] ?? []
  return allowed.map((to) => ({
    to,
    actionLabel: TRANSITION_META[to].actionLabel,
    hint: TRANSITION_META[to].hint,
    isRevert: REVERT_TARGETS.has(to),
  }))
}

/** Ob ein Zustand das Ende der Pipeline ist (keine weiteren Schritte). */
export function isTerminal(state: EbayState | null): boolean {
  return nextTransitions(state).length === 0
}

/** Der „Verkauft-Cluster" — Schritte, die den Bestand serverseitig reservieren. */
export const EBAY_SOLD_CLUSTER: readonly EbayState[] = [
  "VERKAUFT",
  "BEZAHLT",
  "VERPACKT",
  "VERSENDET",
]

/** Ob ein Zielzustand den Bestand reserviert (löst die Konflikt-Prüfung aus). */
export function entersSoldCluster(to: EbayState): boolean {
  return EBAY_SOLD_CLUSTER.includes(to)
}

// ── Bestands-Nebeneffekt (der ehrliche Konflikt-Hinweis) ──────────────────────
// Der Server-Trigger meldet, was beim Verkauft-Schritt mit dem lokalen Bestand
// passiert ist. Wir übersetzen jeden Fall in eine ehrliche deutsche Zeile +
// einen Schweregrad — ein CONFLICT bedeutet: derselbe Artikel ist hier im Laden
// schon reserviert oder verkauft, der Owner muss das auflösen.

export type SideEffectTone = "neutral" | "info" | "warn"

export interface SideEffectMeta {
  /** Ob es überhaupt eine Meldung wert ist (NONE → nicht anzeigen). */
  show: boolean
  /** Ob es ein echter Konflikt ist (eskaliert die Darstellung). */
  isConflict: boolean
  tone: SideEffectTone
  /** Deutsche Überschrift, z. B. „Bestand reserviert". */
  title: string
  /** Deutsche Erklärung, eine bis zwei Zeilen. */
  message: string
}

export function describeSideEffect(effect: EbayInventorySideEffect): SideEffectMeta {
  switch (effect) {
    case "AUTO_RESERVED":
      return {
        show: true,
        isConflict: false,
        tone: "info",
        title: "Bestand reserviert",
        message:
          "Der Artikel wurde für den eBay-Verkauf automatisch reserviert, damit " +
          "er im Laden nicht doppelt verkauft wird.",
      }
    case "IDEMPOTENT_NO_OP":
      return {
        show: true,
        isConflict: false,
        tone: "neutral",
        title: "Bereits reserviert",
        message: "Der Artikel war bereits für eBay reserviert keine Änderung am Bestand.",
      }
    case "CONFLICT_LOCAL_RESERVATION":
      return {
        show: true,
        isConflict: true,
        tone: "warn",
        title: "Konflikt: lokal reserviert",
        message:
          "Dieser Artikel ist im Laden bereits für einen anderen Vorgang reserviert. " +
          "Bitte prüfen, ob der eBay-Verkauf wirklich gelten soll, bevor du fortfährst.",
      }
    case "CONFLICT_LOCAL_SOLD":
      return {
        show: true,
        isConflict: true,
        tone: "warn",
        title: "Konflikt: lokal verkauft",
        message:
          "Dieser Artikel wurde im Laden bereits verkauft. Der eBay-Verkauf kann nicht " +
          "erfüllt werden bitte die Listung stornieren oder den Käufer informieren.",
      }
    case "NONE":
    default:
      return {
        show: false,
        isConflict: false,
        tone: "neutral",
        title: "",
        message: "",
      }
  }
}

// ── Veröffentlichung (Marktplatz-Push — der ehrliche „Token ausstehend") ──────
// Der publish-Endpunkt liefert `configured=false`, wenn kein eBay-OAuth-Token
// hinterlegt ist (kein HTTP, keine echte Listung). Wir lesen das und liefern
// eine ehrliche Auslegung: erfolgreich gelistet, Token ausstehend, oder vom
// Server abgelehnt — nie „gelistet", wenn es das nicht ist.

export type PublishOutcome = "published" | "pending_token" | "not_published"

export interface PublishMeta {
  outcome: PublishOutcome
  /** Deutsche Überschrift für den Hinweis. */
  title: string
  /**
   * Deutsche Erklärung. Bevorzugt den serverseitigen `detail` (bereits deutsch
   * + sicher anzuzeigen), fällt sonst auf einen festen Text zurück.
   */
  message: string
  /** Ob die Listung wirklich live ging (treibt Erfolgs-Haptik + verdigris). */
  isLive: boolean
}

export function describePublish(res: EbayPublishResponse): PublishMeta {
  if (res.published) {
    return {
      outcome: "published",
      title: "Bei eBay veröffentlicht",
      message:
        res.detail ||
        "Die Listung ist live. Der Zustand wurde auf Online gesetzt.",
      isLive: true,
    }
  }
  if (!res.configured) {
    return {
      outcome: "pending_token",
      title: "Token ausstehend",
      message:
        res.detail ||
        "Es ist noch kein eBay-Zugang hinterlegt. Sobald der Owner den Marktplatz " +
        "verbindet, kann der Artikel mit einem Tipp live gehen. Solange wird nichts " +
        "veröffentlicht.",
      isLive: false,
    }
  }
  // configured, aber nicht live — der Server hat aus einem fachlichen Grund nicht
  // veröffentlicht (selten; der detail-Text erklärt es).
  return {
    outcome: "not_published",
    title: "Nicht veröffentlicht",
    message: res.detail || "Die Veröffentlichung wurde nicht abgeschlossen.",
    isLive: false,
  }
}

// ── Verlauf (Quelle der Änderung → deutsches Label) ───────────────────────────
// Die Verlaufszeilen sagen, WER eine Stufe geändert hat. Das macht die Audit-
// Spur ehrlich: ein OWNER-Schritt vom Telefon, ein eBay-Webhook, der Reconciler-
// Worker oder ein System-Push (z. B. der Marktplatz-Publish).

export const EBAY_SOURCE_LABELS: Readonly<Record<EbaySource, string>> = {
  OWNER: "Owner",
  EBAY_WEBHOOK: "eBay",
  WORKER: "Abgleich",
  SYSTEM: "System",
}

export function sourceLabel(source: EbaySource): string {
  return EBAY_SOURCE_LABELS[source] ?? source
}

// ── Pipeline-Zählung (die Phasen-Verteilung aus eingebuchten Artikeln) ────────
// Aus einer Liste von Zuständen die Anzahl je Phase + das Gesamt. Reine
// Reduktion — die Kacheln zeigen echte Zahlen oder den leeren Zustand.

export interface PipelineCounts {
  total: number
  byPhase: Record<EbayPhase, number>
  byState: Partial<Record<EbayState, number>>
}

export function countPipeline(states: ReadonlyArray<EbayState | null>): PipelineCounts {
  const byPhase: Record<EbayPhase, number> = {
    vorbereitung: 0,
    online: 0,
    verkauft: 0,
    reklamation: 0,
  }
  const byState: Partial<Record<EbayState, number>> = {}
  let total = 0
  for (const s of states) {
    if (s == null) continue // nie eingebucht zählt nicht als Pipeline-Artikel
    total += 1
    byPhase[EBAY_STATE_PHASE[s]] += 1
    byState[s] = (byState[s] ?? 0) + 1
  }
  return { total, byPhase, byState }
}

/** Re-Export der Server-Reihenfolge, damit Bildschirme eine Quelle ziehen. */
export { EBAY_STATE_ORDER }
