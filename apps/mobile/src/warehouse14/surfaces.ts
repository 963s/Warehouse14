/**
 * Mobile surface registry — the single declarative source for the bottom-tab
 * shell, mirroring apps/tauri-pos/src/app/chrome/surface-registry.ts. Adding a
 * surface is one append here + one route file under src/app/(tabs)/.
 *
 * `name` is the expo-router route name inside the (tabs) group (`index` is the
 * default-landing tab). The registry order is the tab order.
 */
import { Boxes, LayoutDashboard, ScanLine, type LucideIcon } from "lucide-react-native"

export interface MobileSurface {
  /** expo-router route name under (tabs). `index` = default tab. */
  name: string
  /** German tab label. */
  label: string
  /** One-sentence German description (no exclamation marks). */
  description: string
  icon: LucideIcon
}

export const SURFACES: readonly MobileSurface[] = [
  {
    name: "index",
    label: "Lager",
    description: "Bestand mit Lagerort und Schmelzwert.",
    icon: Boxes,
  },
  {
    name: "scan",
    label: "Scannen",
    description: "Barcode scannen und Artikel finden.",
    icon: ScanLine,
  },
  {
    name: "dashboard",
    label: "Dashboard",
    description: "Kennzahlen — in Arbeit.",
    icon: LayoutDashboard,
  },
] as const
