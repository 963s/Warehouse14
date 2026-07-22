/**
 * Die Vertrauensleiter für Reservierungen.
 *
 * Sie entscheidet, wer wie viel reservieren darf und wer gar nicht mehr, und
 * sie hatte bis heute KEINEN einzigen Test. Eine Regel, die Kunden dauerhaft
 * aussperrt, gehört festgenagelt.
 *
 * Der Anlass: die Leiter zählte eine verfallene Reservierung als
 * Nichtabholung, obwohl eine Abholung am Tresen technisch unmöglich war
 * (siehe HANDOVER_IS_BOOKABLE). Damit konnte niemand hinaufsteigen und jeder
 * fiel hinunter: sieben Tage Sperre nach dem ersten Verfall, dauerhaft nach
 * dem dritten. Das Haus bestrafte seine eigenen Kunden für eine Funktion, die
 * es nie gebaut hatte.
 */

import { describe, expect, it } from 'vitest';

import {
  HANDOVER_IS_BOOKABLE,
  NO_SHOWS_BEFORE_BLOCK,
  NO_SHOWS_BEFORE_DEMOTION,
  type ShopperReservationFacts,
  deriveReservationAllowance,
} from '../../src/lib/storefront-reservation-policy.js';

const NOW = new Date('2026-07-23T12:00:00Z');

function facts(over: Partial<ShopperReservationFacts> = {}): ShopperReservationFacts {
  return {
    collected: 0,
    noShows: 0,
    lastNoShowAt: null,
    trustLevel: null,
    emailVerified: true,
    isGuest: false,
    ...over,
  };
}

describe('solange die Übergabe nicht buchbar ist', () => {
  it('zählt KEINE Nichtabholung gegen den Kunden', () => {
    // Genau der Fall, der heute live feuerte: BST-2026-000001 verfiel um
    // 22:24 und der Kunde bekam eine Nichtabholung für eine Abholung, die das
    // Haus gar nicht hätte annehmen können.
    const viele = deriveReservationAllowance(
      facts({ noShows: NO_SHOWS_BEFORE_BLOCK + 5, lastNoShowAt: NOW }),
      NOW,
    );
    expect(HANDOVER_IS_BOOKABLE).toBe(false);
    expect(viele.blockedReason).toBeNull();
    expect(viele.tier).not.toBe('GESPERRT');
  });

  it('setzt auch die Abstufung aus, nicht nur die Sperre', () => {
    // Sonst bliebe die halbe Strafe stehen.
    const mit = deriveReservationAllowance(
      facts({ collected: 5, noShows: NO_SHOWS_BEFORE_DEMOTION }),
      NOW,
    );
    const ohne = deriveReservationAllowance(facts({ collected: 5, noShows: 0 }), NOW);
    expect(mit.tier).toBe(ohne.tier);
  });

  it('lässt das Urteil eines Menschen unangetastet', () => {
    // Die Aussetzung gilt der GERECHNETEN Strafe. Wer von Hand gesperrt wurde,
    // bleibt gesperrt: das ist kein Rechenfehler, das ist eine Entscheidung.
    for (const level of ['BANNED', 'SUSPICIOUS']) {
      const a = deriveReservationAllowance(facts({ trustLevel: level }), NOW);
      expect(a.blockedReason).toBe('BANNED');
      expect(a.tier).toBe('GESPERRT');
    }
  });
});

describe('die Leiter selbst', () => {
  it('beginnt bei NEU', () => {
    expect(deriveReservationAllowance(facts(), NOW).tier).toBe('NEU');
  });

  it('steigt mit dem, was wirklich abgeholt wurde', () => {
    expect(deriveReservationAllowance(facts({ collected: 1 }), NOW).tier).toBe('BEKANNT');
    expect(deriveReservationAllowance(facts({ collected: 3 }), NOW).tier).toBe('STAMM');
  });

  it('gibt einem Gast eine eigene Sprosse, keine Strafe', () => {
    const g = deriveReservationAllowance(facts({ isGuest: true }), NOW);
    expect(g.tier).toBe('GAST');
    expect(g.blockedReason).toBeNull();
    expect(g.maxItems).toBeGreaterThan(0);
  });

  it('setzt VIP und VERIFIED sofort nach oben', () => {
    for (const level of ['VIP', 'VERIFIED']) {
      expect(deriveReservationAllowance(facts({ trustLevel: level }), NOW).tier).toBe('STAMM');
    }
  });

  it('beschränkt eine unbestätigte Adresse, statt sie abzuweisen', () => {
    // Auf der Produktion trägt nur ein Bruchteil der Konten einen
    // Bestätigungszeitpunkt. Abweisen hieße: fast kein Geschäft mehr.
    const a = deriveReservationAllowance(facts({ collected: 5, emailVerified: false }), NOW);
    expect(a.tier).toBe('NEU');
    expect(a.blockedReason).toBeNull();
    expect(a.maxItems).toBeGreaterThan(0);
  });

  it('gibt einer Sperre immer eine Begründung und einer Freigabe nie eine', () => {
    const gesperrt = deriveReservationAllowance(facts({ trustLevel: 'BANNED' }), NOW);
    expect(gesperrt.maxItems).toBe(0);
    expect(gesperrt.blockedReason).not.toBeNull();

    const frei = deriveReservationAllowance(facts({ collected: 2 }), NOW);
    expect(frei.blockedReason).toBeNull();
    expect(frei.cooldownUntil).toBeNull();
  });
});

describe('wenn die Übergabe eines Tages buchbar ist', () => {
  it('muss dieser Test hier angepasst und die Konstante entfernt werden', () => {
    // Dieser Test ist der Wecker. Sobald Phase 2 die Übergabe am Tresen
    // baut, wird HANDOVER_IS_BOOKABLE auf true gesetzt, dieser Test bricht,
    // und wer ihn repariert, muss die Strafen bewusst wieder scharf stellen
    // statt sie schweigend liegen zu lassen.
    expect(HANDOVER_IS_BOOKABLE).toBe(false);
  });
});
