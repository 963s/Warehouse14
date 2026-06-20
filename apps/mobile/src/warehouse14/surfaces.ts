/**
 * Primary bottom-tab registry — the single declarative source for the bottom-tab
 * shell, mirroring apps/tauri-pos/src/app/chrome/surface-registry.ts. Adding a
 * PRIMARY tab is one append here + one route file under src/app/(tabs)/.
 *
 * The Owner OS keeps exactly FOUR primary tabs:
 *   1. Schatzkammer — the owner dashboard (Tagesquest, Live-Kennzahlen).
 *   2. Lager        — der Bestand mit Lagerort und Schmelzwert.
 *   3. Kunden       — Kundensuche mit KYC und Sanktionsprüfung.
 *   4. Mehr         — der Hub auf alle weiteren Owner-Flächen (Termine,
 *                     Aufgaben, Kasse, Finanzen, Einstellungen, Scannen, …).
 * Everything else lives behind "Mehr" and is registered in owner-surfaces.ts,
 * so a new secondary surface NEVER touches the tab bar.
 *
 * `name` is the expo-router route name inside the (tabs) group. The registry
 * order is the visible tab order. `hidden` keeps a (tabs) route mounted (so it
 * stays deep-linkable, e.g. /scan from the hub) without a tab-bar button.
 */
import { Boxes, MoreHorizontal, ScanLine, Users, Vault, type LucideIcon } from "lucide-react-native"

export interface MobileSurface {
  /** expo-router route name under (tabs). */
  name: string
  /** German tab label. */
  label: string
  /** One-sentence German description (no exclamation marks). */
  description: string
  icon: LucideIcon
  /** Mounted but kept off the tab bar (reachable via deep link / the Mehr hub). */
  hidden?: boolean
}

export const SURFACES: readonly MobileSurface[] = [
  {
    name: "dashboard",
    label: "Schatzkammer",
    description: "Tagesquest, Live-Kennzahlen und Fortschritt.",
    icon: Vault,
  },
  {
    name: "index",
    label: "Lager",
    description: "Bestand mit Lagerort und Schmelzwert.",
    icon: Boxes,
  },
  {
    name: "customers",
    label: "Kunden",
    description: "Kundensuche mit KYC-Status und Sanktionsprüfung.",
    icon: Users,
  },
  {
    name: "more",
    label: "Mehr",
    description: "Alle weiteren Owner-Flächen an einem Ort.",
    icon: MoreHorizontal,
  },
  {
    // Kept mounted for the hub's "Scannen"-Karte + deep links; no tab button.
    name: "scan",
    label: "Scannen",
    description: "Barcode scannen und Artikel finden.",
    icon: ScanLine,
    hidden: true,
  },
] as const
