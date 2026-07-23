/**
 * Wie viele Bestellungen warten — für die Zahl am Bestellungen-Tab.
 *
 * WARUM ES DIESEN HAKEN GIBT
 * Basels Befund am 23.07.2026: der Abholablauf existierte vollständig und war
 * trotzdem unsichtbar. Echte Push-Benachrichtigungen sind der bessere Weg, aber
 * sie brauchen eine Firebase-Bereitstellung, die es an diesem Tag noch nicht
 * gibt. Bis dahin ist die Zahl am Tab das Ehrlichste, was ohne fremde Zugänge
 * möglich ist: sie sagt beim Blick auf die Leiste, dass jemand wartet.
 *
 * WAS „WARTEND" HEISST
 * NUR der Stand OFFEN. Eine angenommene oder vorbereitete Bestellung ist in
 * Arbeit und braucht keinen roten Punkt; eine abholbereite wartet auf den
 * Kunden, nicht auf uns. Eine Zahl, die alles zählt, verliert ihre Bedeutung
 * und wird nach zwei Tagen ignoriert.
 *
 * EHRLICHKEIT
 * Schlägt der Abruf fehl, ist das Ergebnis `null`, NICHT `0`. Null hiesse
 * „nichts zu tun" und wäre eine Behauptung über etwas, das wir nicht wissen.
 * Die Leiste zeigt dann gar keine Zahl, statt eine falsche.
 */

import { useQuery } from '@/warehouse14/ui'
import { listOrders } from '@/warehouse14/api'

export interface WaitingOrders {
  /** Wartende Bestellungen, oder `null` wenn es gerade nicht lesbar war. */
  count: number | null
}

export function useWaitingOrders(): WaitingOrders {
  const q = useQuery(() => listOrders('OFFEN'), {
    key: 'orders:waiting',
    // Ruhig getaktet: die Zahl muss nicht auf die Sekunde stimmen, und die
    // untere Leiste ist auf JEDEM Schirm sichtbar. Ein hektischer Takt hier
    // kostet Akku auf allen Flächen zugleich.
    staleTimeMs: 30_000,
    pollIntervalMs: 120_000,
    keepPreviousData: true,
    // Diese Abfrage darf den Verbindungszustand der App NICHT beeinflussen:
    // sie läuft im Hintergrund unter jedem Schirm, und ein Fehlschlag hier
    // würde sonst überall die Offline-Meldung auslösen.
    reportConnection: false,
  })

  return { count: q.data ? q.data.items.length : null }
}
