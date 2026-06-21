/**
 * Owner-Flächen-Register — the data-driven source for the "Mehr"-Hub
 * (src/app/(tabs)/more.tsx). Every secondary Owner OS surface that is NOT one of
 * the four primary tabs (Schatzkammer, Lager, Kunden, Mehr) is listed here.
 *
 * EXTENSIBILITY CONTRACT (so parallel agents do not conflict):
 *   • To add a surface, append ONE entry to OWNER_SURFACES. Append at the END of
 *     the array; never reorder or renumber existing entries. A new screen =
 *     one append here + one route file under src/app/.
 *   • While the screen is still a stub, ship it with `available: false`. The hub
 *     then renders a locked "bald verfügbar"-Karte and does NOT navigate, so a
 *     half-built route can never crash the hub. Flip to `available: true` (or
 *     drop the flag) once the route file exists.
 *   • `id` is a stable, unique slug used only as a React key — keep it unique.
 *   • `route` is the expo-router pathname pushed on tap (e.g. "/scan",
 *     "/finanzen"). Only read when `available` is true.
 *   • `group` buckets the cards into labelled sections in the hub, in the order
 *     SECTION_ORDER below. Unknown groups fall into "Sonstiges".
 */
import {
  Activity,
  Banknote,
  BarChart3,
  Bell,
  CalendarClock,
  FileText,
  ListChecks,
  type LucideIcon,
  MessageCircle,
  Printer,
  Receipt,
  ScanLine,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Store,
  Trophy,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react-native"

/** Hub sections, rendered in this order. */
export type OwnerSurfaceGroup = "betrieb" | "finanzen" | "system"

export interface OwnerSurface {
  /** Stable unique slug (React key only). */
  id: string
  /** expo-router pathname to push on tap. Only used when `available`. */
  route: string
  /** German card title. */
  label: string
  /** Short German description (no exclamation marks). */
  description: string
  icon: LucideIcon
  /** Section bucket. */
  group: OwnerSurfaceGroup
  /**
   * Whether the route exists. `false` (or omitted while building) renders a
   * locked "bald verfügbar"-Karte that does not navigate. Default: false.
   */
  available?: boolean
}

/** Section label + order for the hub. */
export const SECTION_ORDER: readonly { group: OwnerSurfaceGroup; label: string }[] = [
  { group: "betrieb", label: "Betrieb" },
  { group: "finanzen", label: "Finanzen" },
  { group: "system", label: "System" },
] as const

export const OWNER_SURFACES: readonly OwnerSurface[] = [
  // ── Betrieb ────────────────────────────────────────────────────────────────
  {
    id: "scan",
    route: "/scan",
    label: "Scannen",
    description: "Barcode scannen und Artikel finden.",
    icon: ScanLine,
    group: "betrieb",
    available: true,
  },
  {
    id: "termine",
    route: "/termine",
    label: "Termine",
    description: "Kalender, Buchungen und freie Slots.",
    icon: CalendarClock,
    group: "betrieb",
    available: true,
  },
  {
    id: "aufgaben",
    route: "/aufgaben",
    label: "Aufgaben",
    description: "Offene To-dos und ihr Fortschritt.",
    icon: ListChecks,
    group: "betrieb",
    available: true,
  },
  {
    id: "kasse",
    route: "/kasse",
    label: "Kasse",
    description: "Schicht, Tagesabschluss und Z-Bon.",
    icon: Receipt,
    group: "betrieb",
    available: true,
  },
  // ── Finanzen ───────────────────────────────────────────────────────────────
  {
    id: "finanzen",
    route: "/finanzen",
    label: "Finanzen",
    description: "Gewinn, Umsatz und Kosten im Detail.",
    icon: Banknote,
    group: "finanzen",
    available: true,
  },
  {
    id: "ausgaben",
    route: "/ausgaben",
    label: "Ausgaben",
    description: "Einzelkosten und laufende Fixkosten.",
    icon: Wallet,
    group: "finanzen",
    available: true,
  },
  // ── System ─────────────────────────────────────────────────────────────────
  {
    id: "einstellungen",
    route: "/einstellungen",
    label: "Einstellungen",
    description: "Margen, Gerät und Abmeldung.",
    icon: Settings,
    group: "system",
    available: true,
  },
  // Appended per the extensibility contract (never reorder existing entries).
  {
    id: "kunde-neu",
    route: "/customer/neu",
    label: "Neuer Kunde",
    description: "Stammdaten anlegen, KYC folgt im Profil.",
    icon: UserPlus,
    group: "betrieb",
    available: true,
  },
  {
    id: "benachrichtigungen",
    route: "/benachrichtigungen",
    label: "Benachrichtigungen",
    description: "Freigaben, Termine und Hinweise an einem Ort.",
    icon: Bell,
    group: "system",
    available: true,
  },
  {
    id: "verkauf",
    route: "/verkauf",
    label: "Verkauf",
    description: "Artikel kassieren und rechtsverbindlich abschließen.",
    icon: ShoppingCart,
    group: "betrieb",
    available: true,
  },
  {
    id: "ankauf",
    route: "/ankauf",
    label: "Ankauf",
    description: "Stücke bewerten und an geprüfte Verkäufer auszahlen.",
    icon: ShoppingBag,
    group: "betrieb",
    available: true,
  },
  {
    id: "drucken",
    route: "/drucken",
    label: "Drucken",
    description: "Beleg und Etikett als PDF teilen oder per AirPrint senden.",
    icon: Printer,
    group: "betrieb",
    available: true,
  },
  {
    id: "ebay",
    route: "/ebay",
    label: "eBay-Kanal",
    description: "Listungen steuern, veröffentlichen und Konflikte sehen.",
    icon: Store,
    group: "betrieb",
    available: true,
  },
  {
    id: "whatsapp",
    route: "/whatsapp",
    label: "WhatsApp",
    description: "Chats lesen, antworten und Kunden verknüpfen.",
    icon: MessageCircle,
    group: "betrieb",
    available: true,
  },
  {
    id: "belege",
    route: "/belege",
    label: "Belege & Dokumente",
    description: "Rechnungen, Ankaufbelege und Nachweise revisionssicher einsehen.",
    icon: FileText,
    group: "system",
    available: true,
  },
  {
    id: "analytics",
    route: "/analytics",
    label: "Auswertungen",
    description: "Umsatz, Handel und Lager als Verlauf aus echten Tagesabschlüssen.",
    icon: BarChart3,
    group: "finanzen",
    available: true,
  },
  {
    id: "team",
    route: "/team",
    label: "Team",
    description: "Wer ist angemeldet, wer ist im Dienst und wie die Rollen geregelt sind.",
    icon: Users,
    group: "betrieb",
    available: true,
  },
  {
    id: "tagebuch",
    route: "/tagebuch",
    label: "Tagebuch",
    description: "Das lückenlose Ereignisprotokoll — wer wann was getan hat, revisionssicher.",
    icon: Activity,
    group: "system",
    available: true,
  },
  {
    id: "suche",
    route: "/suche",
    label: "Suche",
    description: "Artikel, Kunden und Belege in einem Feld finden und direkt öffnen.",
    icon: Search,
    group: "betrieb",
    available: true,
  },
  {
    id: "erfolge",
    route: "/erfolge",
    label: "Erfolge",
    description: "Rang, Serien und Siegel — die ganze Geschichte aus echten Tagesabschlüssen.",
    icon: Trophy,
    group: "betrieb",
    available: true,
  },
] as const
