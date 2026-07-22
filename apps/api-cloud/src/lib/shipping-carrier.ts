/**
 * Der Anschluss für den Versanddienst, und was er tut, solange keiner da ist.
 *
 * Ein Etikett kostet Geld und trägt eine Nummer, die der Kunde in die
 * Sendungsverfolgung tippt. Beides darf nicht entstehen, wenn niemand
 * tatsächlich einen Auftrag angenommen hat. Deshalb ist die zentrale
 * Entscheidung hier nicht, WIE DHL angesprochen wird, sondern was passiert,
 * wenn DHL noch gar nicht angeschlossen ist:
 *
 *   NICHT KONFIGURIERT  →  ein ausdrückliches Nein mit deutschem Grund.
 *                          Keine Nummer, kein Etikett, kein „so tun als ob".
 *   SIMULATION          →  eine Nummer, die NIEMAND für echt halten kann.
 *   ECHT                →  der Anbieter.
 *
 * Die Simulation ist der gefährliche Teil und deshalb streng: sie erzeugt
 * bewusst KEINE Nummer im DHL-Format. Eine simulierte Sendungsnummer, die
 * aussieht wie eine echte, endet damit, dass jemand ein echtes Paket mit
 * einem erfundenen Etikett zur Post trägt. Jede simulierte Nummer beginnt
 * darum sichtbar mit `SIMULATION-`, und der Zustand sagt es noch einmal.
 *
 * Dieselbe Haltung wie beim Postausgang: ohne Zugang heisst es ehrlich „liegt
 * in der Warteschlange", nicht „gesendet".
 */

/** Eine Anschrift, wie der Versanddienst sie braucht. Ohne Verschlüsselung: */
/*  dieses Objekt lebt nur für die Dauer eines Aufrufs im Speicher.           */
export interface CarrierAddress {
  recipientName: string;
  line1: string;
  line2?: string | null;
  postalCode: string;
  city: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  email?: string | null;
  phone?: string | null;
}

/**
 * Was der Zoll bei einer Sendung ausserhalb der EU verlangt.
 *
 * Für einen Laden, der Münzen und Antiquitäten in die Welt schickt, ist das
 * keine Kür: ohne Inhaltserklärung, Wert und Warennummer bleibt das Paket
 * stehen. Der Anschluss verlangt sie deshalb, statt sie später zu vermissen.
 */
export interface CustomsDeclaration {
  /** Was drin ist, in einem Satz, den ein Zöllner lesen kann. */
  contentsDescription: string;
  /** Warenwert in ganzen Cent. */
  valueCents: number;
  /** Zolltarifnummer (HS code), soweit bekannt. */
  tariffNumber?: string | null;
  /** Ursprungsland der Ware, ISO alpha-2. */
  originCountry: string;
}

export interface CreateLabelInput {
  shipmentId: string;
  serviceCode: string;
  recipient: CarrierAddress;
  weightG: number;
  /** Deklarierter Wert für die Haftung, in ganzen Cent. */
  insuredValueCents?: number | null;
  /** Pflicht ausserhalb der EU, sonst weglassen. */
  customs?: CustomsDeclaration | null;
}

export type CarrierRefusal =
  /** Kein Zugang hinterlegt. Der ehrliche Normalfall vor dem Anschluss. */
  | 'NOT_CONFIGURED'
  /** Die Eingabe reicht nicht (Adresse unvollständig, Zoll fehlt, Gewicht 0). */
  | 'INVALID_INPUT'
  /** Der Anbieter hat abgelehnt oder war nicht erreichbar. */
  | 'CARRIER_REJECTED';

export interface CarrierLabel {
  trackingNumber: string;
  trackingUrl: string;
  /** Das Etikett als PDF. Bei Simulation absichtlich leer. */
  labelPdf: Uint8Array | null;
  /** Wahr, wenn diese Sendung NICHT bei einem echten Dienst liegt. */
  simulated: boolean;
}

export type CarrierResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: CarrierRefusal; detail: string };

export type TrackingState =
  | 'UNKNOWN'
  | 'LABEL_CREATED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'RETURNED'
  | 'PROBLEM';

export interface TrackingUpdate {
  state: TrackingState;
  /** Was der Dienst zuletzt gemeldet hat, in seiner eigenen Sprache. */
  rawStatus: string | null;
  deliveredAt: Date | null;
}

/**
 * Der Anschluss. Alles, was der Laden von einem Versanddienst braucht, und
 * nichts darüber hinaus. DHL ist die erste Umsetzung, nicht die einzige
 * mögliche: die Sendung trägt ihren Träger als Feld.
 */
export interface ShippingCarrier {
  readonly name: string;
  /** Falsch heisst: dieser Anschluss wird jeden Auftrag ehrlich ablehnen. */
  readonly configured: boolean;
  /** Wahr heisst: nichts davon ist echt, egal wie plausibel es aussieht. */
  readonly simulated: boolean;
  createLabel(input: CreateLabelInput): Promise<CarrierResult<CarrierLabel>>;
  track(trackingNumber: string): Promise<CarrierResult<TrackingUpdate>>;
}

/** EU-Mitgliedstaaten. Ausserhalb davon verlangt der Zoll eine Erklärung. */
const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'FI', 'FR', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

export function needsCustoms(country: string): boolean {
  return !EU_COUNTRIES.has(country.trim().toUpperCase());
}

/**
 * Prüft, ob ein Auftrag überhaupt versandfähig ist, BEVOR ein Anbieter
 * angerufen wird. Ein Anruf, der an einer fehlenden Postleitzahl scheitert,
 * kostet Zeit und verschleiert den Grund.
 */
export function validateLabelInput(input: CreateLabelInput): string | null {
  const r = input.recipient;
  if (r.recipientName.trim().length === 0) return 'Der Name der Empfängerin oder des Empfängers fehlt.';
  if (r.line1.trim().length === 0) return 'Die Straße fehlt.';
  if (r.postalCode.trim().length === 0) return 'Die Postleitzahl fehlt.';
  if (r.city.trim().length === 0) return 'Der Ort fehlt.';
  if (!/^[A-Za-z]{2}$/.test(r.country.trim())) return 'Das Lieferland fehlt oder ist unlesbar.';
  if (!Number.isFinite(input.weightG) || input.weightG <= 0) return 'Das Gewicht fehlt.';
  if (input.serviceCode.trim().length === 0) return 'Es ist kein Versandprodukt gewählt.';
  if (needsCustoms(r.country)) {
    const c = input.customs;
    if (c == null) return 'Für dieses Land ist eine Zollinhaltserklärung nötig.';
    if (c.contentsDescription.trim().length === 0) return 'Die Inhaltsangabe für den Zoll fehlt.';
    if (!Number.isFinite(c.valueCents) || c.valueCents <= 0) return 'Der Warenwert für den Zoll fehlt.';
    if (!/^[A-Za-z]{2}$/.test(c.originCountry.trim())) return 'Das Ursprungsland der Ware fehlt.';
  }
  return null;
}

/**
 * Der Anschluss ohne Zugang. Er lehnt ab, und zwar so, dass der Grund oben
 * ankommt: „noch nicht angeschlossen" ist etwas anderes als „DHL sagt nein",
 * und der Laden muss die beiden unterscheiden können.
 */
export function createUnconfiguredCarrier(name = 'DHL'): ShippingCarrier {
  const refuse = <T>(): CarrierResult<T> => ({
    ok: false,
    reason: 'NOT_CONFIGURED',
    detail:
      `Für ${name} ist noch kein Zugang hinterlegt. Es wurde kein Etikett gekauft ` +
      'und keine Sendungsnummer vergeben.',
  });
  return {
    name,
    configured: false,
    simulated: false,
    createLabel: async () => refuse<CarrierLabel>(),
    track: async () => refuse<TrackingUpdate>(),
  };
}

/**
 * Der Anschluss zum Üben. Er prüft dieselben Eingaben wie ein echter Dienst,
 * damit der ganze Weg durchgespielt werden kann, und macht in derselben
 * Bewegung unübersehbar, dass nichts davon echt ist.
 *
 * `seq` wird von aussen gereicht statt aus einem Zufall gezogen, damit ein
 * Testlauf zweimal dasselbe ergibt.
 */
export function createSimulatedCarrier(
  name = 'DHL',
  nextSequence: () => number = (() => {
    let n = 0;
    return () => ++n;
  })(),
): ShippingCarrier {
  return {
    name,
    configured: true,
    simulated: true,
    async createLabel(input) {
      const problem = validateLabelInput(input);
      if (problem != null) return { ok: false, reason: 'INVALID_INPUT', detail: problem };
      const seq = String(nextSequence()).padStart(6, '0');
      return {
        ok: true,
        value: {
          // Bewusst NICHT im Format des Dienstes. Eine simulierte Nummer, die
          // wie eine echte aussieht, endet damit, dass jemand ein echtes Paket
          // mit einem erfundenen Etikett zur Post trägt.
          trackingNumber: `SIMULATION-${seq}`,
          trackingUrl: '',
          labelPdf: null,
          simulated: true,
        },
      };
    },
    async track(trackingNumber) {
      if (!trackingNumber.startsWith('SIMULATION-')) {
        return {
          ok: false,
          reason: 'INVALID_INPUT',
          detail: 'Diese Sendungsnummer stammt nicht aus der Simulation und kann hier nicht verfolgt werden.',
        };
      }
      return {
        ok: true,
        value: { state: 'LABEL_CREATED', rawStatus: 'Simulation, keine echte Sendung', deliveredAt: null },
      };
    },
  };
}

/** Was der Bediener liest, wenn ein Etikett nicht zustande kam. */
export function carrierRefusalTextDe(reason: CarrierRefusal, detail: string): string {
  switch (reason) {
    case 'NOT_CONFIGURED':
      return detail;
    case 'INVALID_INPUT':
      return `Die Sendung ist noch nicht vollständig: ${detail}`;
    case 'CARRIER_REJECTED':
      return `Der Versanddienst hat die Sendung abgelehnt: ${detail}`;
  }
}
