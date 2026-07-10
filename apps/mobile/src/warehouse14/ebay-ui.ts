/**
 * eBay-Kanal — die Telefon-Präsentationsschicht.
 *
 * Das deutsche Vokabular (Phasen, Übergangs-Verben, Konflikt-Texte, Quellen-
 * Labels, Veröffentlichungs-Auslegung) lebt in `@warehouse14/i18n-de`, damit
 * die Kasse und das Telefon WORTGLEICH sprechen. Hier bleibt nur, was an das
 * React-Native-Badge gebunden ist: die Varianten-Zuordnung je Zustand.
 *
 * Die Bildschirme importieren weiterhin alles aus diesem Modul; die Re-Exporte
 * unten halten diese eine Import-Adresse stabil.
 */
import { EBAY_STATE_LABELS, type EbayState } from "@warehouse14/api-client"

import type { BadgeProps } from "@/components/ui/badge"

export type BadgeVariant = NonNullable<BadgeProps["variant"]>

// ── Zustands-Badges (Badge-Variante je Zustand) ───────────────────────────────
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

/** Die Badge-Variante für einen Zustand. NULL ist eine neutrale Umriss-Badge. */
export function stateVariant(state: EbayState | null): BadgeVariant {
  return state == null ? "outline" : EBAY_STATE_VARIANT[state]
}

/** Das Label eines Zustands, direkt aus der Server-Wahrheit. */
export { EBAY_STATE_LABELS }

// ── Geteiltes Vokabular (eine Quelle für Telefon + Kasse) ─────────────────────

export {
  countPipeline,
  describePublish,
  describeSideEffect,
  EBAY_PHASES,
  EBAY_SOLD_CLUSTER,
  EBAY_SOURCE_LABELS,
  EBAY_STATE_ORDER,
  EBAY_STATE_PHASE,
  entersSoldCluster,
  isTerminal,
  nextTransitions,
  phaseOf,
  sourceLabel,
  stateLabel,
} from "@warehouse14/i18n-de"

export type {
  EbayPhase,
  EbayPhaseMeta,
  EbayTransitionOption,
  PipelineCounts,
  PublishMeta,
  PublishOutcome,
  SideEffectMeta,
  SideEffectTone,
} from "@warehouse14/i18n-de"
