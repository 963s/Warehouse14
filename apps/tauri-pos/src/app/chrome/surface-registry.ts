/**
 * surface-registry — the SINGLE declarative source of every screen the
 * operator can navigate to. Locked by memory.md §11.
 *
 * The Karteikasten rail, the Spotlight palette, and the router all read
 * from this module. Adding a screen is exactly one append.
 *
 * Hard rules (compile-time + runtime):
 *   1. Tier 1 (`tier === 'primary'`) count NEVER exceeds 8 (§11.3).
 *   2. Every path starts with `/` and is unique (§11.3).
 *   3. Every surface has a German label + a German description.
 *   4. Tier 2 (`tier === 'secondary'`) reachable ONLY via Spotlight.
 *
 * The `assertSurfaceRegistry()` invariant runs at module-load and fails
 * the bundle if any rule is violated.
 */

import type { ComponentType } from 'react';

export type SurfaceTier = 'primary' | 'secondary';

export interface SurfaceDescriptor {
  /**
   * Stable URL anchor — the router consumes this verbatim and the deep
   * links from notifications / toasts use it. Never rename without a
   * compatibility shim.
   */
  path: string;

  /** German label that appears in chips, Spotlight, breadcrumbs. */
  label: string;

  /**
   * Mid-text German description for tooltips + Spotlight secondary line.
   * One short sentence. No exclamation marks.
   */
  description: string;

  /**
   * 1..8 for primary tier, undefined for secondary tier.
   * The Karteikasten rail sorts primary surfaces by this digit.
   */
  digit?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

  tier: SurfaceTier;

  /**
   * Lazy-loadable React component for the route. The router renders
   * this inside the AppShell <Outlet>. Day 4 ships placeholders; later
   * days swap them out one-by-one without touching the registry.
   */
  component: ComponentType;

  /**
   * Optional second-tier keywords that the Spotlight matches against
   * for fuzzy search. Useful for synonyms (e.g. "Z-Bon" finds Kasse).
   */
  searchAliases?: readonly string[];
}

import { Ankauf } from '../../screens/ankauf/Ankauf.js';
import { Aufgaben } from '../../screens/aufgaben/Aufgaben.js';
import { Bewertung } from '../../screens/bewertung/Bewertung.js';
import { Kasse } from '../../screens/kasse/Kasse.js';
import { Kunden } from '../../screens/kunden/Kunden.js';
import { Lager } from '../../screens/lager/Lager.js';
import { Belegtexte } from '../../screens/secondary/Belegtexte.js';
import { Dokumente } from '../../screens/secondary/Dokumente.js';
import { Ebay } from '../../screens/secondary/Ebay.js';
import { Einstellungen } from '../../screens/secondary/Einstellungen.js';
import { Fotos } from '../../screens/secondary/Fotos.js';
import { Kurse } from '../../screens/secondary/Kurse.js';
import { Schreiben } from '../../screens/secondary/Schreiben.js';
import { Tagebuch } from '../../screens/secondary/Tagebuch.js';
import { WhatsApp } from '../../screens/secondary/WhatsApp.js';
import { Verkauf } from '../../screens/verkauf/Verkauf.js';
// Lazy imports — kept at the top so `npm/pnpm typecheck` validates them all.
import { Werkstatt } from '../../screens/werkstatt/Werkstatt.js';

export const SURFACES: readonly SurfaceDescriptor[] = [
  // ── Tier 1 — 6 frontline chips, action-frequency order (ADR Option B) ─
  // Verkauf → Ankauf → Kasse lead; Lager/Kunden/Werkstatt follow. Aufgaben +
  // Bewertung are demoted to Spotlight (Bewertung now lives inside the Ankauf
  // buy-flow — an appraisal is just a draft purchase).
  {
    path: '/verkauf',
    label: 'Verkauf',
    description: 'Verkauf an Kunden — Beleg, Zahlung, Kasse.',
    digit: 1,
    tier: 'primary',
    component: Verkauf,
    searchAliases: ['sale', 'rechnung', 'belegnummer', 'pos'],
  },
  {
    path: '/ankauf',
    label: 'Ankauf',
    description: 'Ankauf & Bewertung — Ausweis, AML, Ankaufbeleg.',
    digit: 2,
    tier: 'primary',
    component: Ankauf,
    searchAliases: ['kauf', 'erwerb', 'einkauf', 'aml', 'bewertung', 'konvolut'],
  },
  {
    path: '/kasse',
    label: 'Kasse',
    description: 'Schicht öffnen und schließen, Z-Bon, Geldtransit.',
    digit: 3,
    tier: 'primary',
    component: Kasse,
    searchAliases: ['z-bon', 'schicht', 'shift', 'kassensturz', 'tagesabschluss'],
  },
  {
    path: '/lager',
    label: 'Lager',
    description: 'Bestand mit Lagerort und Schmelzwert.',
    digit: 4,
    tier: 'primary',
    component: Lager,
    searchAliases: ['inventar', 'bestand', 'tresor', 'fach', 'inventory'],
  },
  {
    path: '/kunden',
    label: 'Kunden',
    description: 'Kundenakte, KYC-Stempel, Vertrauen.',
    digit: 5,
    tier: 'primary',
    component: Kunden,
    searchAliases: ['customer', 'kunde', 'kundenakte', 'crm'],
  },
  {
    path: '/werkstatt',
    label: 'Werkstatt',
    description: 'Übersicht, Tagebuch und Edelmetallkurs.',
    digit: 6,
    tier: 'primary',
    component: Werkstatt,
    searchAliases: ['home', 'dashboard', 'übersicht', 'startseite'],
  },
  // ── Tier 2 — Spotlight-only (demoted from the frontline rail) ─────────
  {
    path: '/aufgaben',
    label: 'Aufgaben',
    description: 'Tagesliste der offenen Posten.',
    tier: 'secondary',
    component: Aufgaben,
    searchAliases: ['tasks', 'todo', 'erinnerungen'],
  },
  {
    path: '/bewertung',
    label: 'Konvolut-Bewertung',
    description: 'Konvolut-Bewertung mit Pro-rata-Verteilung — Teil des Ankaufs.',
    tier: 'secondary',
    component: Bewertung,
    searchAliases: ['appraisal', 'expertise', 'gutachten', 'konvolut', 'ankauf', 'bewertung'],
  },

  // ── Tier 1 (#7) — the live Edelmetall trading terminal ───────────────
  {
    path: '/kurse',
    label: 'Kurse',
    description: 'Live-Kurse für Gold, Silber, Platin, Palladium — Handelsterminal.',
    digit: 7,
    tier: 'primary',
    component: Kurse,
    searchAliases: ['kurs', 'gold', 'silber', 'platin', 'metallpreis', 'lbma', 'chart', 'börse'],
  },
  // ── Tier 1 (#8) — A4 document studio (contracts / invoices / letters) ─
  {
    path: '/schreiben',
    label: 'Schreiben',
    description: 'Verträge, Rechnungen und Briefe auf A4 erstellen — mit KI-Assistent.',
    digit: 8,
    tier: 'primary',
    component: Schreiben,
    searchAliases: ['brief', 'vertrag', 'ankaufvertrag', 'rechnung', 'dokument', 'a4', 'schreiben', 'ki'],
  },
  {
    path: '/ebay',
    label: 'eBay-Konsole',
    description: 'Neun-stufige Listing-Pipeline + Konfliktwarnungen.',
    tier: 'secondary',
    component: Ebay,
    searchAliases: ['ebay', 'listing', 'verkauft', 'reklamiert'],
  },
  {
    path: '/fotos',
    label: 'Foto-Werkstatt',
    description: 'Fünf-stufiger Foto-Workflow (Kanban).',
    tier: 'secondary',
    component: Fotos,
    searchAliases: ['photo', 'foto', 'freigestellt', 'bearbeitet'],
  },
  {
    path: '/belegtexte',
    label: 'Belegtext-Editor',
    description: 'Versionierte Rechtstexte für Rechnungen und Z-Bons.',
    tier: 'secondary',
    component: Belegtexte,
    searchAliases: ['rechnung', 'text', '§25a', 'differenzbesteuerung'],
  },
  {
    path: '/tagebuch',
    label: 'Tagebuch',
    description: 'Vollständige Ereignis-Chronik der Hash-Kette.',
    tier: 'secondary',
    component: Tagebuch,
    searchAliases: ['ledger', 'history', 'historie', 'chain', 'audit'],
  },
  {
    path: '/dokumente',
    label: 'Dokumente',
    description: 'Belege, Ausweise, Expertisen — verknüpft pro Entität.',
    tier: 'secondary',
    component: Dokumente,
    searchAliases: ['ausweis', 'rechnung', 'expertise', 'zertifikat', 'r2'],
  },
  {
    path: '/einstellungen',
    label: 'Einstellungen',
    description: 'Operator-Profile, Drucker, Geräte.',
    tier: 'secondary',
    component: Einstellungen,
    searchAliases: ['settings', 'preferences', 'drucker', 'gerät'],
  },
  {
    path: '/whatsapp',
    label: 'WhatsApp',
    description: 'Eingehende Nachrichten triagieren und Antworten senden.',
    tier: 'secondary',
    component: WhatsApp,
    searchAliases: ['whatsapp', 'wa', 'meta', 'chat', 'nachricht', 'inbox'],
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────
// Selectors + helpers
// ─────────────────────────────────────────────────────────────────────────

export const PRIMARY_SURFACES: readonly SurfaceDescriptor[] = SURFACES.filter(
  (s) => s.tier === 'primary',
);

export const SECONDARY_SURFACES: readonly SurfaceDescriptor[] = SURFACES.filter(
  (s) => s.tier === 'secondary',
);

/** Find a surface by URL path. Returns undefined for unknown routes. */
export function findSurfaceByPath(path: string): SurfaceDescriptor | undefined {
  return SURFACES.find((s) => s.path === path);
}

/** The route that opens by default after login. */
export const HOME_PATH = '/werkstatt';

// ─────────────────────────────────────────────────────────────────────────
// Invariants — fail-fast at module load. The bundler runs this once.
// ─────────────────────────────────────────────────────────────────────────

(function assertSurfaceRegistry(): void {
  // Rule 1 — Tier 1 budget.
  if (PRIMARY_SURFACES.length > 8) {
    throw new Error(
      `[surface-registry] tier-1 count is ${PRIMARY_SURFACES.length}; ` +
        'memory.md §11.3 caps it at 8. Move one surface to tier 2 or replace.',
    );
  }
  // Rule 2 — unique paths.
  const paths = new Set<string>();
  for (const s of SURFACES) {
    if (!s.path.startsWith('/')) {
      throw new Error(`[surface-registry] path "${s.path}" must start with "/"`);
    }
    if (paths.has(s.path)) {
      throw new Error(`[surface-registry] duplicate path "${s.path}"`);
    }
    paths.add(s.path);
  }
  // Rule 3 — primary surfaces have digits 1..8, secondary have none.
  const digitsSeen = new Set<number>();
  for (const s of PRIMARY_SURFACES) {
    if (s.digit === undefined) {
      throw new Error(`[surface-registry] primary surface "${s.path}" missing digit`);
    }
    if (digitsSeen.has(s.digit)) {
      throw new Error(`[surface-registry] duplicate digit ${s.digit}`);
    }
    digitsSeen.add(s.digit);
  }
  for (const s of SECONDARY_SURFACES) {
    if (s.digit !== undefined) {
      throw new Error(`[surface-registry] secondary surface "${s.path}" must not carry a digit`);
    }
  }
})();
