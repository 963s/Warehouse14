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

## E · Mutations-Integrität (finalize / return / Z-Abschluss)

Zweite Prüfung (find→refute, je Feststellung 3 Widerleger) über die Geld- und
Bestands-Mutationen. Drei bestätigte Feststellungen.

### E1 · HOCH · Return: Produkt-Flip ohne Nullung der Reservierungshülle, BEHOBEN (`10a8fac`, branch-only)
- **War:** `POST /api/transactions/:id/return` setzte das Produkt SOLD → AVAILABLE
  mit nur `sold_at = NULL`, die Reservierungshülle blieb gefüllt. Ein WEB-Verkauf
  behält diese Hülle auf der SOLD-Zeile, also verletzte der Flip die CHECK
  `products_available_no_reservation` (`0006_products.sql`) und der GANZE Return
  rollte zurück. Jeder Web-Verkaufs-Return schlug fehl.
- **Jetzt:** Der Flip nullt alle fünf Reservierungsspalten (wie der kanonische
  `release()` in `inventory-lock`). Storno flippt keine Produkte (Phase 2), dort
  kein Pendant. typecheck grün; Integrationstest braucht die DB.

### E2 · HOCH · Doppelter Z-Bon möglich (Race), REPORT-ONLY
- **Ist:** `POST /api/closings/finalize` macht check-then-insert (nicht-sperrender
  Existenz-SELECT, dann INSERT). Der einzige Schutz `UNIQUE (business_day, shop_id)`
  (`0011_closing.sql`) greift NICHT, weil `shop_id` in V1 immer NULL ist und
  Postgres NULLS DISTINCT zwei `(tag, NULL)` als verschieden behandelt. Zwei
  gleichzeitige (oder vom Offline-Outbox erneut gespielte) Abschlüsse für denselben
  Tag committen also BEIDE → zwei unveränderliche FINALIZED Z-Bons, und
  DSFinV-K/DATEV/Kassenbericht zählen den Tag doppelt. Kein Advisory-Lock, kein
  Idempotency-Key auf dieser Route.
- **Empfohlener Fix (über den `drizzle-kit`-Flow, NICHT von Hand am Journal):** ein
  partieller Unique-Index (Muster wie `0028` für `transactions`):
  `CREATE UNIQUE INDEX daily_closings_business_day_null_shop_uq ON daily_closings (business_day) WHERE shop_id IS NULL;`
  ODER `UNIQUE NULLS NOT DISTINCT`, ODER ein `pg_advisory_xact_lock` vor dem
  Existenz-Check. **Vorbedingung:** vorher prüfen, dass es KEINE doppelten
  `(business_day, NULL)`-Zeilen gibt, sonst schlägt das Anlegen des Index fehl.
  Nicht autonom umgesetzt: der Migrations-Ledger (`meta/_journal.json`) muss von
  `drizzle-kit generate` konsistent geschrieben werden, was hier nicht ausführbar ist.

### E3 · MITTEL · Z-Snapshot-Race (Transaktion fällt aus dem Abschluss), REPORT-ONLY
- **Ist:** Der Abschluss-Snapshot und der State-Flip sind nicht gegen einen
  gleichzeitig laufenden Transaktions-Finalize serialisiert; der C-3-Trigger
  (`0013_security_hardening.sql`) sieht einen noch nicht committeten Abschluss nicht.
  Eine Transaktion kann in einen gerade finalisierten Tag committen und aus dem
  Z-Snapshot herausfallen.
- **Empfohlener Fix:** beide Flows auf den Geschäftstag serialisieren, z. B.
  `pg_advisory_xact_lock(hashtext('closing:'||day))` in beiden Pfaden. Subtile
  Nebenläufigkeitsänderung am heißen Finalize-Pfad, braucht einen Integrationstest.

---

## F · Web-Zahlung: Stripe-Webhook und Storefront-Checkout

Dritte Prüfung (find→refute, je Feststellung 3 Widerleger) über den Web-Geldpfad.
Zwei bestätigte HOCH-Feststellungen.

### F1 · HOCH · Checkout-Betrag mit Float-Division, jeder Cent-Betrag scheitert. BEHOBEN (`ad5e568`, branch-only)
- **War:** `storefront-cart.ts` baute den Betrag als
  `${amountCents / 100}.${amountCents % 100, zweistellig}`. `amountCents / 100` ist
  FLOAT-Division, also ergab jeder nicht-ganze-Euro-Betrag einen kaputten String:
  4999 Cent wurde zu "49.99" (Float) plus ".99" gleich "49.99.99". Die Spalte
  `payment_intents.amount_eur` ist NUMERIC(18,2) und lehnt das ab, der INSERT warf,
  und JEDER Checkout mit Cent-Betrag (der Normalfall) schlug fehl.
- **Jetzt:** `Math.floor(amountCents / 100)` für den Euro-Teil an beiden Stellen
  (INSERT und Antwort). 4999 wird "49.99", 5000 wird "50.00", 5 wird "0.05".
  Durch Auswertung des Templates verifiziert. typecheck grün; Integrationstest
  braucht die DB.

### F2 · HOCH · Webhook verschluckt Stripe-Retry, Geld kassiert, Bestellung nie erfüllt. REPORT-ONLY
- **Ist:** `storefront-webhook.ts` schreibt die Dedup-Zeile in `webhook_events`
  (Zeile 174) als eigenständige, sofort committende Anweisung, die Verarbeitung
  läuft in einer SEPARATEN Transaktion (Zeile 238). Wirft die Verarbeitung
  transient (Reservierung abgelaufen, Deadlock, Verbindungsabbruch), rollt die
  Transaktion zurück, die Dedup-Zeile bleibt aber. Beim Stripe-Retry trifft der
  INSERT den Unique-Index, und der Catch gibt bedingungslos 200 `{idempotent:true}`
  zurück, OHNE `processed_at` zu prüfen. Ergebnis: Stripe hat das Geld kassiert, die
  Bestellung wird nie erfüllt, die Reservierung bleibt hängen und wird später vom
  Cart-Sweeper freigegeben und weiterverkauft. Kein Reconciliation-Worker existiert
  (im Kommentar als künftige Phase 1.5 bezeichnet).
- **Empfohlener Fix:** die `webhook_events`-INSERT in DIESELBE Transaktion wie die
  Verarbeitung ziehen (ein Rollback entfernt dann die Dedup-Zeile, der Retry
  verarbeitet neu), ODER im Unique-Konflikt-Zweig die Zeile nachladen und bei
  `processed_at IS NULL` neu verarbeiten statt idempotent zu antworten; zusätzlich
  `processing_error` auf dem Fehlerpfad schreiben. Die inneren Idempotenz-Wächter
  (`pi.status='SUCCEEDED'` und Cart CONVERTED sind No-ops) machen ein erneutes
  Verarbeiten sicher. NICHT autonom umgesetzt: zahlungskritische Transaktions- und
  Retry-Semantik, braucht einen Integrationstest.
- Ergänzend: der Cart-Sweeper (`storefront-cart-sweeper.ts`) gibt abgelaufene
  CHECKOUT-Warenkörbe allein nach `checkout_expires_at < now()` frei, OHNE zu prüfen,
  ob der PaymentIntent SUCCEEDED ist. Ein bezahlter, aber hängender Warenkorb gibt so
  seinen Bestand wieder frei. Mit F2 im selben Fix mitbewerten.

REFUTED (0/3, korrekt kein Fehler): Out-of-order-Event ohne PI-Zeile,
fehlender Betrags-/Währungs-Abgleich im Webhook. Ein Punkt unbestätigt (Refuter
lief in das Session-Limit): `storefront-reserve.ts` Hold und Cart-Flip nicht in
einer Transaktion. Verdient einen gezielten zweiten Blick.

---

## Nächste Schritte für die Freigabe

1. Steuerberatung prüft B1 bis B4 gegen die verbindliche DATEV-/DSFinV-K-Spezifikation.
2. Entscheidung zu B5 (Export offener Abschlüsse ja/nein).
3. Bewertung von D1/D2 (Positions-Vorzeichen, §25a-Marge-Prüfung).
4. E2 und E3 (Nebenläufigkeit Z-Abschluss): partieller Unique-Index über den
   `drizzle-kit`-Flow plus Vorbedingungs-Prüfung; Advisory-Lock nach Bewertung.
5. F2 (Webhook-Idempotenz plus Cart-Sweeper) mit Integrationstest umsetzen.
6. Freigabe von A1, A2, E1 und F1, dann Deploy über den üblichen Server-Weg.
