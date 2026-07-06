/**
 * Audit / Tagebuch — die MOBILE Präsentationsschicht für das GoBD-Ereignis-
 * register (`ledger_events`).
 *
 * Das gesamte reine Vokabular (kuratierte Labels, Mapper, Payload-Reinigung,
 * Datum/Zeit-Formatierung, Tages-Gruppierung, Zähler) lebt jetzt geteilt und
 * plattform-neutral in `@warehouse14/i18n-de` (audit-vocab), damit die
 * Desktop-Kasse und die control-Fläche dasselbe Vokabular sprechen. Diese Datei
 * behält nur, was React-Native-spezifisch ist — die lucide-Icons und die
 * Badge-Varianten je Kategorie — und re-exportiert das geteilte Vokabular, so
 * dass jede bestehende `@/warehouse14/audit-ui`-Einfuhr unverändert weiterläuft.
 */
import {
  type LucideIcon,
  CalendarClock,
  FileText,
  Lock,
  Package,
  Receipt,
  ScrollText,
  Settings2,
  ShieldAlert,
  Users,
} from "lucide-react-native"

import { CATEGORY_TEXT, type EventCategory } from "@warehouse14/i18n-de"

import type { BadgeProps } from "@/components/ui/badge"

// Das plattform-neutrale Vokabular vollständig durchreichen: eventLabel,
// entityLabel, payloadEntries, groupByDay, DATE_RANGE_*, countByCategory,
// CATEGORY_ORDER, eventCategory, formatEventDate/Time, relativeTime, shortId …
export * from "@warehouse14/i18n-de"

export type BadgeVariant = NonNullable<BadgeProps["variant"]>

// ── Kategorie-Präsentation (Icon + Badge-Variante) — die einzige RN-Schicht ───
// Die deutschen Worte (label/hint/emphasis) kommen aus dem geteilten
// CATEGORY_TEXT; hier wird je Kategorie nur das lucide-Icon und die optische
// Badge-Variante zugeordnet. „security" ist als einzige ruhig-rot (destructive),
// weil ein Compliance-Signal echte Bedeutung trägt — nie „gut/schlecht" gefärbt.
const CATEGORY_PRESENTATION: Readonly<
  Record<EventCategory, { icon: LucideIcon; variant: BadgeVariant }>
> = {
  sales: { icon: Receipt, variant: "default" },
  inventory: { icon: Package, variant: "secondary" },
  customers: { icon: Users, variant: "secondary" },
  fiscal: { icon: ScrollText, variant: "default" },
  security: { icon: ShieldAlert, variant: "destructive" },
  approvals: { icon: Lock, variant: "outline" },
  appointments: { icon: CalendarClock, variant: "secondary" },
  system: { icon: Settings2, variant: "outline" },
  other: { icon: FileText, variant: "outline" },
}

export interface CategoryMeta {
  category: EventCategory
  /** Kurzes deutsches Label für den Filter-Chip + die Detail-Kopfzeile. */
  label: string
  icon: LucideIcon
  /** Badge-Variante (rein optische Trennung — nie „gut/schlecht" gefärbt …). */
  variant: BadgeVariant
  /** … AUSSER bei „security": ein Compliance-Signal ist ruhig-rot markiert. */
  emphasis: boolean
  /** Eine ruhige deutsche Erklärzeile für die Filter-/Leer-Hilfe. */
  hint: string
}

/** Vollständige Kategorie-Meta = geteilte Worte + mobile Icon/Badge-Präsentation. */
export function categoryMeta(category: EventCategory): CategoryMeta {
  const text = CATEGORY_TEXT[category]
  const pres = CATEGORY_PRESENTATION[category]
  return {
    category,
    label: text.label,
    hint: text.hint,
    emphasis: text.emphasis,
    icon: pres.icon,
    variant: pres.variant,
  }
}
