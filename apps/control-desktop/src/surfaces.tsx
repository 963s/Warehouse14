/**
 * Surface registry — the single source of truth for the Control Desktop's
 * back-office surfaces (Track B0). The sidebar renders these grouped by
 * `group`; the hash router (`router.ts`) resolves the current path to one entry.
 * Adding a surface is one line here.
 */

import { DiamondRule } from '@warehouse14/ui-kit';

import { ApiKeysPanel } from './panels/ApiKeysPanel.js';
import { ApprovalsPanel } from './panels/ApprovalsPanel.js';
import { AufgabenPanel } from './panels/AufgabenPanel.js';
import { ClosingsPanel } from './panels/ClosingsPanel.js';
import { DokumentePanel } from './panels/DokumentePanel.js';
import { EbayPanel } from './panels/EbayPanel.js';
import { EinstellungenPanel } from './panels/EinstellungenPanel.js';
import { FinanzenPanel } from './panels/FinanzenPanel.js';
import { KonformitaetPanel } from './panels/KonformitaetPanel.js';
import { KundenPanel } from './panels/KundenPanel.js';
import { LagerPanel } from './panels/LagerPanel.js';
import { RisikoPanel } from './panels/RisikoPanel.js';
import { TeamPanel } from './panels/TeamPanel.js';
import { TerminePanel } from './panels/TerminePanel.js';
import { WhatsAppPanel } from './panels/WhatsAppPanel.js';
import { ZielkartePanel } from './panels/ZielkartePanel.js';
import { BridgeDashboard } from './screens/übersicht/BridgeDashboard.js';

/** Sidebar section a surface belongs to. */
export type SurfaceGroup =
  | 'Überblick'
  | 'Verkauf & Lager'
  | 'Kunden & Risiko'
  | 'Finanzen'
  | 'Kommunikation'
  | 'System';

/** The order the sidebar draws the groups in. */
export const GROUP_ORDER: readonly SurfaceGroup[] = [
  'Überblick',
  'Verkauf & Lager',
  'Kunden & Risiko',
  'Finanzen',
  'Kommunikation',
  'System',
];

export interface Surface {
  /** Rail chip number + keyboard mnemonic (display only). */
  digit: number;
  label: string;
  /** Hash route path, e.g. `/kunden`. */
  path: string;
  group: SurfaceGroup;
  Component: () => JSX.Element;
}

/** Übersicht carries the Bridge dashboard under the command-centre rule. */
function UebersichtSurface(): JSX.Element {
  return (
    <>
      <DiamondRule tone="gold" label="Kommandozentrale" />
      <BridgeDashboard />
    </>
  );
}

/** The home surface — the fallback for `#/` and any unknown route. */
const UEBERSICHT: Surface = {
  digit: 1,
  label: 'Übersicht',
  path: '/uebersicht',
  group: 'Überblick',
  Component: UebersichtSurface,
};

/** The Owner's back-office surfaces. */
export const SURFACES: readonly Surface[] = [
  UEBERSICHT,
  { digit: 17, label: 'Zielkarte', path: '/zielkarte', group: 'Überblick', Component: ZielkartePanel },
  { digit: 5, label: 'Lager', path: '/lager', group: 'Verkauf & Lager', Component: LagerPanel },
  { digit: 16, label: 'eBay', path: '/ebay', group: 'Verkauf & Lager', Component: EbayPanel },
  { digit: 3, label: 'Kassenabschluss', path: '/kassenabschluss', group: 'Verkauf & Lager', Component: ClosingsPanel },
  { digit: 12, label: 'Aufgaben', path: '/aufgaben', group: 'Verkauf & Lager', Component: AufgabenPanel },
  { digit: 4, label: 'Kunden', path: '/kunden', group: 'Kunden & Risiko', Component: KundenPanel },
  { digit: 10, label: 'Risikoanalyse', path: '/risiko', group: 'Kunden & Risiko', Component: RisikoPanel },
  { digit: 7, label: 'Konformität', path: '/konformitaet', group: 'Kunden & Risiko', Component: KonformitaetPanel },
  { digit: 9, label: 'Finanzen', path: '/finanzen', group: 'Finanzen', Component: FinanzenPanel },
  { digit: 13, label: 'Dokumente', path: '/dokumente', group: 'Finanzen', Component: DokumentePanel },
  { digit: 14, label: 'WhatsApp', path: '/whatsapp', group: 'Kommunikation', Component: WhatsAppPanel },
  { digit: 6, label: 'Termine', path: '/termine', group: 'Kommunikation', Component: TerminePanel },
  { digit: 2, label: 'Genehmigungen', path: '/genehmigungen', group: 'Kommunikation', Component: ApprovalsPanel },
  { digit: 15, label: 'Team', path: '/team', group: 'System', Component: TeamPanel },
  { digit: 11, label: 'API-Schlüssel', path: '/api-schluessel', group: 'System', Component: ApiKeysPanel },
  { digit: 8, label: 'Einstellungen', path: '/einstellungen', group: 'System', Component: EinstellungenPanel },
];

/** Resolve a route path to its surface; unknown paths fall home to Übersicht. */
export function resolveSurface(path: string): Surface {
  return SURFACES.find((s) => s.path === path) ?? UEBERSICHT;
}
