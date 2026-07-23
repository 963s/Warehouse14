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

import { type ComponentType, lazy } from 'react';

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

  /**
   * When true, the surface is visible ONLY to the Owner — hidden from the rail,
   * the digit-nav, and Spotlight for every other role. The backing route still
   * enforces its own guard; this is the UI half so a non-owner never sees a
   * chip they cannot use. Used by the owner Leitstand.
   */
  ownerOnly?: boolean;
}

// ── Tier 1 frontline surfaces — STATIC imports. These render on first paint
//    (the operator lands on /werkstatt and reaches Verkauf/Ankauf/Kasse in one
//    keystroke), so code-splitting them would only add a needless network round
//    trip. Keep them eager.
import { Ankauf } from '../../screens/ankauf/Ankauf.js';
import { Kasse } from '../../screens/kasse/Kasse.js';
import { Kunden } from '../../screens/kunden/Kunden.js';
import { Anfragen } from '../../screens/secondary/Anfragen.js';
import { Inventur } from '../../screens/secondary/Inventur.js';
import { Lager } from '../../screens/lager/Lager.js';
import { Schreiben } from '../../screens/secondary/Schreiben.js';
import { Verkauf } from '../../screens/verkauf/Verkauf.js';
import { Werkstatt } from '../../screens/werkstatt/Werkstatt.js';

// ── Tier 2 secondary surfaces — LAZY (React.lazy + dynamic import). Each becomes
//    its own bundle chunk, fetched only when the operator first navigates there
//    via Spotlight. This keeps the heavy modules (e.g. the @fullcalendar suite in
//    Aufgaben, the trading terminal in Kurse) off the first-paint critical path.
//    The router wraps the <Outlet> in <Suspense> with a German fallback.
//    Every module exports a NAMED component, so map it onto `default` for lazy().
const Aufgaben = lazy(() =>
  import('../../screens/aufgaben/Aufgaben.js').then((m) => ({ default: m.Aufgaben })),
);
const Bewertung = lazy(() =>
  import('../../screens/bewertung/Bewertung.js').then((m) => ({ default: m.Bewertung })),
);
const Belegtexte = lazy(() =>
  import('../../screens/secondary/Belegtexte.js').then((m) => ({ default: m.Belegtexte })),
);
const Bestellungen = lazy(() =>
  import('../../screens/secondary/Bestellungen.js').then((m) => ({ default: m.Bestellungen })),
);
const Dokumente = lazy(() =>
  import('../../screens/secondary/Dokumente.js').then((m) => ({ default: m.Dokumente })),
);
const Ebay = lazy(() =>
  import('../../screens/secondary/Ebay.js').then((m) => ({ default: m.Ebay })),
);
const Finanzen = lazy(() =>
  import('../../screens/secondary/Finanzen.js').then((m) => ({ default: m.Finanzen })),
);
const Einstellungen = lazy(() =>
  import('../../screens/secondary/Einstellungen.js').then((m) => ({ default: m.Einstellungen })),
);
const Fotos = lazy(() =>
  import('../../screens/secondary/Fotos.js').then((m) => ({ default: m.Fotos })),
);
const Kalender = lazy(() =>
  import('../../screens/werkstatt/KalenderSurface.js').then((m) => ({
    default: m.KalenderSurface,
  })),
);
const Kurse = lazy(() =>
  import('../../screens/secondary/Kurse.js').then((m) => ({ default: m.Kurse })),
);
const SteuerExport = lazy(() =>
  import('../../screens/secondary/SteuerExport.js').then((m) => ({ default: m.SteuerExport })),
);
const Tagebuch = lazy(() =>
  import('../../screens/secondary/Tagebuch.js').then((m) => ({ default: m.Tagebuch })),
);
const Termine = lazy(() =>
  import('../../screens/termine/Termine.js').then((m) => ({ default: m.Termine })),
);
const WhatsApp = lazy(() =>
  import('../../screens/secondary/WhatsApp.js').then((m) => ({ default: m.WhatsApp })),
);
const Konfliktpostfach = lazy(() =>
  import('../../screens/secondary/Konfliktpostfach.js').then((m) => ({
    default: m.Konfliktpostfach,
  })),
);
const Zielkarte = lazy(() =>
  import('../../screens/zielkarte/Zielkarte.js').then((m) => ({ default: m.Zielkarte })),
);
const Risikoanalyse = lazy(() =>
  import('../../screens/risiko/Risikoanalyse.js').then((m) => ({ default: m.Risikoanalyse })),
);
const Schaufenster = lazy(() =>
  import('../../screens/schaufenster/Schaufenster.js').then((m) => ({ default: m.Schaufenster })),
);
const Team = lazy(() => import('../../screens/team/Team.js').then((m) => ({ default: m.Team })));
const Leitstand = lazy(() =>
  import('../../screens/leitstand/Leitstand.js').then((m) => ({ default: m.Leitstand })),
);

export const SURFACES: readonly SurfaceDescriptor[] = [
  // ── Tier 1 — 6 frontline chips, action-frequency order (ADR Option B) ─
  // Verkauf → Ankauf → Kasse lead; Lager/Kunden/Werkstatt follow. Aufgaben +
  // Bewertung are demoted to Spotlight (Bewertung now lives inside the Ankauf
  // buy-flow — an appraisal is just a draft purchase).
  {
    path: '/verkauf',
    label: 'Verkauf',
    description: 'Verkauf an Kunden. Beleg, Zahlung, Kasse.',
    digit: 1,
    tier: 'primary',
    component: Verkauf,
    searchAliases: ['sale', 'rechnung', 'belegnummer', 'pos'],
  },
  {
    path: '/ankauf',
    label: 'Ankauf',
    description: 'Ankauf & Bewertung. Ausweis, AML, Ankaufbeleg.',
    digit: 2,
    tier: 'primary',
    component: Ankauf,
    searchAliases: ['kauf', 'erwerb', 'einkauf', 'aml', 'bewertung', 'konvolut'],
  },
  {
    path: '/kasse',
    label: 'Tageskasse',
    description: 'Die Bargeld-Schublade des Tages: öffnen, Bargeld im Blick, Z-Bon.',
    digit: 3,
    tier: 'primary',
    component: Kasse,
    // Keep the old term searchable so muscle memory still lands here.
    searchAliases: [
      'kasse',
      'z-bon',
      'schicht',
      'shift',
      'kassensturz',
      'tagesabschluss',
      'startgeld',
    ],
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
    path: '/anfragen',
    label: 'Anfragen',
    description: 'Kundenanfragen per E-Mail, lesen und beantworten.',
    tier: 'secondary',
    component: Anfragen,
    searchAliases: ['support', 'tickets', 'anfrage', 'mail', 'email', 'antworten'],
  },
  {
    path: '/bestellungen',
    label: 'Bestellungen',
    description: 'Online-Reservierungen zur Abholung annehmen, vorbereiten und übergeben.',
    digit: 8,
    // PRIMAER, nicht mehr im Suchmenue vergraben. Basels Befund am 23.07.2026:
    // „لسا مافي قسم طلبات اقدر اجهز طلب استلم اوفق اسلم" — es gab keinen
    // sichtbaren Ort, um eine Bestellung anzunehmen, vorzubereiten, zu
    // uebergeben. Der Schirm war vollstaendig gebaut und trotzdem nur ueber die
    // Suche erreichbar. Was jeden Tag Arbeit macht, gehoert an die Oberflaeche,
    // nicht hinter ein Suchfeld. Genau wie in der Inhaber-App am selben Tag.
    tier: 'primary',
    component: Bestellungen,
    searchAliases: [
      'bestellung',
      'bestellungen',
      'abholung',
      'reservierung',
      'online',
      'webshop',
      'pickup',
      'orders',
      'reserve',
    ],
  },
  {
    path: '/inventur',
    label: 'Inventur',
    description: 'Stichtagsinventur: jedes Stück scannen, Schwund feststellen.',
    tier: 'secondary',
    component: Inventur,
    searchAliases: ['inventur', 'bestandsaufnahme', 'zaehlen', 'schwund', 'stichtag'],
  },
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
    description: 'Konvolut-Bewertung mit Pro-rata-Verteilung. Teil des Ankaufs.',
    tier: 'secondary',
    component: Bewertung,
    searchAliases: ['appraisal', 'expertise', 'gutachten', 'konvolut', 'ankauf', 'bewertung'],
  },

  // ── Tier 2 — Edelmetall trading terminal (UX P2: DEMOTED off the rail). The
  //    daily glance now lives in the always-visible chrome ticker; the deep
  //    candlestick charts AND the ADMIN "Manueller Override" stay here, reached
  //    via Spotlight or the ticker popover's "Details / Verlauf" link. ─────────
  {
    path: '/finanzen',
    label: 'Finanzen',
    description: 'Gewinnrechnung, Lagerwert und die gebuchten Ausgaben.',
    tier: 'secondary',
    component: Finanzen,
    searchAliases: ['gewinn', 'verlust', 'ausgaben', 'fixkosten', 'lagerwert', 'profit', 'guv'],
  },

  {
    path: '/kurse',
    label: 'Kurse',
    description: 'Live-Kurse für Gold, Silber, Platin, Palladium. Handelsterminal.',
    tier: 'secondary',
    component: Kurse,
    searchAliases: [
      'kurs',
      'gold',
      'silber',
      'platin',
      'palladium',
      'metallpreis',
      'lbma',
      'chart',
      'börse',
      'edelmetall',
      'terminal',
    ],
  },
  // ── Tier 1 (#7) — A4 document studio (contracts / invoices / letters) ─
  {
    path: '/schreiben',
    label: 'Schreiben',
    description: 'Verträge, Rechnungen und Briefe auf A4 erstellen, mit KI-Assistent.',
    digit: 7,
    tier: 'primary',
    component: Schreiben,
    searchAliases: [
      'brief',
      'vertrag',
      'ankaufvertrag',
      'rechnung',
      'dokument',
      'a4',
      'schreiben',
      'ki',
    ],
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
    path: '/compliance-inbox',
    label: 'Konfliktpostfach',
    description: 'Offline-Vorgänge, die vom Server abweichen und geprüft werden müssen.',
    tier: 'secondary',
    component: Konfliktpostfach,
    searchAliases: ['konflikt', 'sync', 'compliance', 'warteschlange', 'outbox'],
  },
  {
    path: '/dokumente',
    label: 'Dokumente',
    description: 'Belege, Ausweise, Expertisen, verknüpft pro Entität.',
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
    path: '/termine',
    label: 'Termine',
    description: 'Terminkalender. Besichtigung, Ankauf-Bewertung, Beratung, Abholung.',
    tier: 'secondary',
    component: Termine,
    searchAliases: [
      'termin',
      'kalender',
      'calendar',
      'besichtigung',
      'beratung',
      'abholung',
      'ankauf-termin',
      'ics',
      'appointment',
    ],
  },
  {
    path: '/kalender',
    label: 'Kalender',
    description: 'Google Kalender des Geschäfts. Eingebettete Wochenansicht, ganzseitig.',
    tier: 'secondary',
    component: Kalender,
    searchAliases: ['google', 'google kalender', 'gcal', 'wochenansicht', 'embed'],
  },
  {
    path: '/whatsapp',
    label: 'WhatsApp',
    description: 'Eingehende Nachrichten triagieren und Antworten senden.',
    tier: 'secondary',
    component: WhatsApp,
    searchAliases: ['whatsapp', 'wa', 'meta', 'chat', 'nachricht', 'inbox'],
  },
  {
    path: '/steuer-export',
    label: 'Steuer-Export',
    description: 'Tagesabschlüsse herunterladen: DATEV und Kassenbericht für das Finanzamt.',
    tier: 'secondary',
    component: SteuerExport,
    searchAliases: [
      'steuer',
      'export',
      'datev',
      'kassenbericht',
      'dsfinvk',
      'finanzamt',
      'steuerberater',
      'gobd',
      'abschluss',
    ],
  },
  // ── New management additions (Tier-2, Spotlight-reachable) ────────────
  {
    path: '/zielkarte',
    label: 'Zielkarte',
    description: 'Lebendige Instrumententafel der Hausziele: Umsatz, Bestand, Metalle, Gewinn.',
    tier: 'secondary',
    component: Zielkarte,
    ownerOnly: true,
    searchAliases: ['ziel', 'ziele', 'zielkarte', 'instrumente', 'kennzahlen', 'gauges', 'dashboard'],
  },
  {
    path: '/risiko',
    label: 'Risikoanalyse',
    description: 'Warnungen und Kunden-Beobachtungsliste aus den Geldwäsche-Meldern.',
    tier: 'secondary',
    component: Risikoanalyse,
    ownerOnly: true,
    searchAliases: ['risiko', 'aml', 'gwg', 'sanktionen', 'pep', 'warnung', 'watchlist', 'compliance'],
  },
  {
    path: '/schaufenster',
    label: 'Schaufenster',
    description: 'Wer vor dem Fenster steht: Besucher, Herkunft und Gesundheit des Ladens.',
    tier: 'secondary',
    component: Schaufenster,
    ownerOnly: true,
    searchAliases: ['schaufenster', 'besucher', 'reichweite', 'webshop', 'laden', 'traffic', 'zugriffe', 'cloudflare'],
  },
  {
    path: '/team',
    label: 'Team & Rollen',
    description: 'Mitarbeiter freischalten, Rolle setzen, Zugang entziehen (Inhaber).',
    tier: 'secondary',
    component: Team,
    ownerOnly: true,
    searchAliases: ['team', 'mitarbeiter', 'rollen', 'personal', 'staff', 'benutzer', 'zugang'],
  },
  // ── Der Owner-Leitstand: Systemzustand, offene Probleme, Zugang zu Risiko +
  //    Edge-Schutz. Am 23.07.2026 von Tier 1 (#8) auf secondary gesenkt, damit
  //    „Bestellungen" die Ziffer 8 an der Kartei-Schiene bekommt. Grund: der
  //    Leitstand ist eine Blick-Fläche, keine Transaktions-Fläche, und der
  //    Inhaber trägt denselben Leitstand ohnehin in der Telefon-App. Er bleibt
  //    hier über Suche und Spotlight jederzeit erreichbar. ──
  {
    path: '/leitstand',
    label: 'Leitstand',
    description: 'Systemzustand, offene Probleme und der Zugang zu Risiko und Edge-Schutz.',
    tier: 'secondary',
    component: Leitstand,
    ownerOnly: true,
    searchAliases: [
      'leitstand',
      'system',
      'systemzustand',
      'status',
      'gesundheit',
      'probleme',
      'überwachung',
      'monitoring',
      'betrieb',
    ],
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

/**
 * True when this viewer may see the surface. `ownerOnly` surfaces are visible
 * only to the Owner. The rail, the digit-nav and Spotlight all funnel through
 * this so an owner-only chip can never leak into a non-owner's UI.
 */
export function isSurfaceVisible(s: SurfaceDescriptor, isOwner: boolean): boolean {
  return !s.ownerOnly || isOwner;
}

/** Filter a surface list to what this viewer may see (preserves order). */
export function visibleSurfaces(
  surfaces: readonly SurfaceDescriptor[],
  isOwner: boolean,
): SurfaceDescriptor[] {
  return surfaces.filter((s) => isSurfaceVisible(s, isOwner));
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
      `[surface-registry] tier-1 count is ${PRIMARY_SURFACES.length}; memory.md §11.3 caps it at 8. Move one surface to tier 2 or replace.`,
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
