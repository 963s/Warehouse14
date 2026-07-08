# Fiskal-Export Review (api-cloud), 2026-07-08

Adversarielle Prüfung der Export-Bausteine, die ein Betriebsprüfer / das Finanzamt
konsumiert: DSFinV-K (KassenSichV §146a), DATEV (Buchungsstapel), Kassenbericht
und das An-/Verkaufsbuch (GwG §10 / §38 GewO).

**Methodik:** 5 Prüf-Dimensionen (find), jede Feststellung danach durch 3
unabhängige Widerleger geprüft (refute). Nur mehrheitlich bestätigte
Feststellungen sind hier gelistet. Zwei interne Konsistenzfehler wurden mit
Unit-Test behoben; alle formatspezifischen Punkte bleiben zur Freigabe durch die
Steuerberatung offen.

Betroffene Dateien: `apps/api-cloud/src/lib/dsfinvk-export.ts`,
`apps/api-cloud/src/lib/datev-export.ts`,
`apps/api-cloud/src/lib/kassenbericht-export.ts`,
`apps/api-cloud/src/routes/closing-export.ts`,
`apps/api-cloud/src/routes/registers.ts`.

> **Deploy-Sperre:** Die beiden behobenen Punkte sind NUR auf dem Branch committet,
> NICHT deployt. Vor dem Ausrollen auf den Produktiv-Server braucht es die
> steuerliche Freigabe und einen Integrationslauf gegen echte Abschlüsse.

---

## A · Behoben (interne Konsistenz, Unit-getestet, Branch-only)

Diese zwei brauchten keine externe Spec: die richtige Referenz steht bereits im
eigenen Code. Beide mit neuem Unit-Test, 217 api-cloud Unit-Tests grün.

### A1 · HOCH · DSFinV-K `bon_ust` fasste einen gemischten Bon auf einen Steuersatz zusammen
`dsfinvk-export.ts` · `buildBonUst` · Commit `5a2fcd8`

- **War:** Eine Bonkopf-USt-Zeile pro Bon, geschlüsselt auf den einen Bon-Steuercode
  (`tax_treatment_code`). Ein gemischter Bon (z. B. eine 19-%-Position plus eine
  nach §25c steuerfreie Anlagegold-Position) verbuchte den GESAMTEN
  Brutto/Netto/USt unter einem USt-Schlüssel. Der steuerfreie Umsatz erschien so
  als 19-%-Umsatz, und `bon_ust` widersprach der (korrekten) positionsweisen
  `bon_pos_ust`, die das DSFinV-K-Prüftool gegeneinander abgleicht.
- **Beleg der Richtigkeit im Code selbst:** `buildBonPosUst` und der DATEV-Pfad
  `toDatevRows` splitten einen gemischten Bon bereits nach der Positions-Behandlung.
- **Jetzt:** Gruppierung je Bon nach `ustKey(line.appliedTaxTreatmentCode)`, Summen
  in ganzen Cent (kein Float, neue Helfer `eurToCents`/`centsToDec`), eine Zeile je
  (Bon, USt-Schlüssel). Einzel-Steuersatz-Bon unverändert.
- **Test:** gemischter Bon liefert zwei Zeilen (Schlüssel 1 = 119,00/100,00/19,00 und
  Schlüssel 5 = 500,00/500,00/0,00), keine Sammelzeile 619,00 mehr.

### A2 · HOCH · DATEV Belegdatum nahm das UTC-Datum statt des Berliner Geschäftstags
`closing-export.ts` · `toDatevRow` · Commit `36d36e7`

- **War:** Der Export wählt die Umsätze über
  `berlin_business_day(finalized_at) = closing.business_day` (Mitternacht Berlin,
  DST-korrekt, `packages/db/migrations/0002_helpers.sql`), leitete das Belegdatum
  aber aus `new Date(finalized_at).toISOString().slice(0,10)` (UTC-Datum) ab. Ein
  Verkauf kurz nach Mitternacht Berliner Zeit (z. B. 00:30 MESZ = 22:30 UTC am
  Vortag) landete korrekt im heutigen Abschluss, wurde in DATEV aber auf GESTERN
  gebucht.
- **Jetzt:** Helfer `berlinDate()` formatiert `finalized_at` per Intl in
  Europe/Berlin und spiegelt so `berlin_business_day()` exakt. Tagesverkäufe
  unverändert.
- **Test:** Tagesverkauf unverändert; Sommer 22:30 UTC ergibt den Berliner Folgetag;
  Winter 23:30 UTC ist DST-korrekt.

---

## B · Bestätigt, aber bewusst OFFEN (Freigabe Steuerberatung nötig)

Nicht angefasst: hier entscheidet die verbindliche DATEV- bzw. DSFinV-K-Spezifikation,
nicht ein Modell-Konsens. Jeder Punkt mit Ist-Wert, behauptetem Soll-Wert und der
betroffenen Feldstelle.

### B1 · HOCH · DATEV EXTF-Kopfzeile: Sachkontenlänge im falschen Feld
`datev-export.ts` · `DATEV_EXTF_HEADER`

- **Ist:** `EXTF;700;21;Buchungsstapel;9;;;;;;;;;;4;;;;;;;EUR;...`. Die `4` liegt in
  Feld 15.
- **Behauptetes Soll:** Feld 14 ist die Sachkontenlänge; die `4` gehört in Feld 14,
  Feld 15 (Datum von) bleibt leer. Also ein Semikolon weniger zwischen der `9`
  (Feld 5) und der `4`.
- **Prüffrage an die Steuerberatung:** Ist im EXTF-Header (Format 700, Kategorie 21)
  Feld 14 die Sachkontenlänge und Feld 15 das Datum-von?

### B2 · MITTEL · DATEV Buchungstext in der falschen Spalte
`datev-export.ts` · `DATEV_COLUMNS`

- **Ist:** Spaltenreihenfolge endet `... Belegfeld1, Buchungstext`. Buchungstext ist
  Datenspalte 12, direkt nach Belegfeld1 (11). Belegfeld2 und Skonto fehlen.
- **Behauptetes Soll:** Feste Buchungsstapel-Reihenfolge 11 = Belegfeld1,
  12 = Belegfeld2, 13 = Skonto, 14 = Buchungstext. Vorschlag: leeres Belegfeld2 (12)
  und leeres Skonto (13) ergänzen, Buchungstext auf 14.
- **Prüffrage:** Erwartet der DATEV-Import den Buchungstext in Spalte 14?

### B3 · MITTEL · DSFinV-K `GV_TYP` 'Einkauf' ist kein gültiger Enum-Wert
`dsfinvk-export.ts` · `gvTyp`

- **Ist:** `direction === 'ANKAUF' ? 'Einkauf' : 'Umsatz'`. Jede Ankauf-Position
  trägt `GV_TYP = 'Einkauf'`.
- **Problem:** `GV_TYP` ist eine geschlossene DSFinV-K-Aufzählung (Umsatz,
  Auszahlung, Pfand, Rabatt, ...); 'Einkauf' ist NICHT enthalten.
- **Prüffrage:** Welcher `GV_TYP` bildet einen Ankauf/Auszahlung korrekt ab (z. B.
  'Auszahlung')? Vorzeichen der Position mit der Steuerberatung bestätigen.

### B4 · MITTEL · DSFinV-K `BON_TYP` 'Beleg-Storno' ist kein gültiger Enum-Wert
`dsfinvk-export.ts` · `bonTyp`

- **Ist:** `r.isStorno ? 'Beleg-Storno' : 'Beleg'`.
- **Problem:** `BON_TYP` ist eine geschlossene Aufzählung (Beleg, AVTransfer,
  AVBestellung, ...); 'Beleg-Storno' ist NICHT enthalten. Ein Storno wird über die
  negierten Beträge (und ggf. `bon_referenzen`) abgebildet, nicht über einen
  eigenen `BON_TYP`.
- **Prüffrage:** `BON_TYP = 'Beleg'` auch für Storno-Belege?

### B5 · Policy · Export ohne Prüfung auf `state = 'FINALIZED'`
`closing-export.ts` · alle drei Export-Routen

- **Ist:** Die Routen laden den Abschluss per `id` und prüfen nur die Existenz; das
  SELECT liest `state` nicht. Ein noch offener Abschluss (`COUNTING`) kann so als
  DATEV/DSFinV-K exportiert werden.
- **Entscheidung nötig:** Ist ein Export eines offenen Abschlusses als Vorschau
  gewollt, oder soll der Export `state = 'FINALIZED'` verlangen? (Reproduziert nur
  über Route + DB, gehört daher in einen Integrationstest, nicht in eine reine
  Code-Korrektur.)

---

## C · Geprüft und entkräftet (keine Fehler)

Von den Widerlegern mehrheitlich als KEIN Fehler bestätigt:

- `registers.ts` CSV-Formel-Injektion: der Schutz greift bzw. die Felder sind nicht
  betroffen (0 von 3 bestätigten den Fehler).
- `registers.ts` fehlende Ausstellungsbehörde: entkräftet.
- `registers.ts` fehlendes UTF-8-BOM: entkräftet.

---

## D · Anhang: Finalize-Money-Pfad (`transaction-math.ts`), geprüft und im Kern solide

Der Serverseitige Geld-Validator `validateTransactionMath` (er speist die Beträge,
die dann exportiert werden) ist im Kern korrekt: `Money` (Decimal, kein Float),
volle Abstimmung Netto + USt = Brutto je Position UND je Kopf, Summenprüfung der
Positionen gegen den Kopf, Summenprüfung der Zahlungen gegen den Kopf. Zwei Punkte
zur Kenntnis (beide REPORT-ONLY, keine autonome Korrektur):

### D1 · Vorzeichen-Disziplin nur auf Kopf-Ebene, nicht je Position
- **Ist:** Der App-Validator prüft das Vorzeichen nur an `totalEur`. Die DB-Constraint
  `transactions_sign_discipline` (`0009_transactions.sql`) prüft Kopf
  total/subtotal/vat, aber `transaction_items` hat NUR
  `line_subtotal + line_vat = line_total` (keine Positions-Vorzeichenprüfung). Ein
  Nicht-Storno-Vorgang könnte also eine negative Position tragen, die sich am Kopf
  wieder zu einem nicht-negativen Betrag summiert; weder Validator noch DB fangen
  das. Der Docstring des Validators behauptet Vorzeichen-Disziplin für "every header
  & line money", was nicht zutrifft.
- **Bewertung:** Defense-in-depth-Lücke (niedrig/mittel). NICHT autonom korrigiert:
  eine Positions-Vorzeichenprüfung könnte legitime negative Positionen (z. B.
  Rabatt-Position) ablehnen. Entscheidung/Bestätigung nötig.

### D2 · §25a-Marge wird serverseitig nicht rechnerisch validiert
- **Ist:** Für eine `MARGIN_25A`-Position prüft der Validator nur, dass `marginEur`
  und `acquisitionCostEurSnapshot` gemeinsam gesetzt sind, NICHT dass die USt =
  19 % der Marge und die Marge = Verkauf minus Einstand ist. Der Docstring nennt das
  als bewusste Phase-1.5-Vertagung.
- **Bewertung:** Bekannte Lücke; eine echte Marge-USt-Prüfung ist eine
  Verhaltensänderung des Finalize-Pfads und braucht die exakte §25a-Formel von der
  Steuerberatung. REPORT-ONLY.

---

## Nächste Schritte für die Freigabe

1. Steuerberatung prüft B1 bis B4 gegen die verbindliche DATEV-/DSFinV-K-Spezifikation.
2. Entscheidung zu B5 (Export offener Abschlüsse ja/nein).
3. Bewertung von D1/D2 (Positions-Vorzeichen, §25a-Marge-Prüfung).
4. Freigabe von A1 und A2, dann Deploy über den üblichen Server-Weg.
