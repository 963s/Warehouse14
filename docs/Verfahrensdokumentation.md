# Verfahrensdokumentation

## Kassen- und Warenwirtschaftssystem „warehouse14"

**Gemäß GoBD (BMF-Schreiben vom 28.11.2019) i. V. m. §§ 145–147 AO und § 146a AO (KassenSichV)**

| | |
|---|---|
| **Unternehmen** | WAREHOUSE 14 — An- und Verkauf von Edelmetallen, Münzen, Schmuck, Uhren und Antiquitäten |
| **Anschrift** | Schornbacher Weg 66, 73614 Schorndorf |
| **System** | warehouse14 — eigenentwickeltes Kassen-/Warenwirtschaftssystem (POS + Owner-Desktop + zentraler Server) |
| **Dokumentversion** | 1.0 |
| **Stand** | 08.06.2026 |
| **Verantwortlich (fachlich/GwG)** | Roman Grützner |
| **Software-Versionsstand** | POS-Anwendung v0.4.0 (OTA-Auslieferung); Datenbank-Migrationsstand 0057 |
| **Status** | **Testbetrieb** — siehe Abschnitt 4.7 und Abschnitt 6 (offene Punkte vor Produktivbetrieb) |

> **Hinweis zum Status (Ehrlichkeitsvermerk):** Das System befindet sich zum Zeitpunkt dieser Dokumentation
> im kontrollierten **Testbetrieb**. Einzelne gesetzlich relevante Komponenten — insbesondere die produktive
> Zertifikats-/Schlüsselausstattung der TSE (Fiskaly SIGN DE V2), die mTLS-Gerätezertifikate sowie die
> finale Rotation aller Produktiv-Geheimnisse — werden erst im Rahmen des Inbetriebnahme-Termins
> („Hardware-Tag") produktiv geschaltet. Stellen, die noch nicht produktiv aktiv sind, sind in dieser
> Dokumentation **ausdrücklich als solche gekennzeichnet**. Diese Dokumentation beschreibt das tatsächlich
> implementierte System und erhebt keinen Anspruch auf eine bereits erteilte produktive Zertifizierung,
> die nicht aktiv ist.

---

## Inhaltsverzeichnis

1. [Allgemeine Beschreibung](#1-allgemeine-beschreibung)
2. [Anwenderdokumentation](#2-anwenderdokumentation)
3. [Technische Systemdokumentation](#3-technische-systemdokumentation)
4. [Betriebsdokumentation](#4-betriebsdokumentation)
5. [Anlagen und Verweise](#5-anlagen-und-verweise)
6. [Offene Punkte / vor Produktivbetrieb zu erledigen](#6-offene-punkte--vor-produktivbetrieb-zu-erledigen)

---

## 1. Allgemeine Beschreibung

### 1.1 Unternehmen und Geschäftstätigkeit

WAREHOUSE 14 betreibt in Schorndorf (PLZ 73614, Schornbacher Weg 66) ein Ladengeschäft für den **An- und
Verkauf von Edelmetallen, Anlage- und Sammlermünzen, Schmuck, Uhren und Antiquitäten** sowie ergänzend
einen geplanten Online-Verkauf. Das Geschäft ist bargeldintensiv und unterliegt damit den besonderen
Aufzeichnungs- und Einzelaufzeichnungspflichten des Bargeschäfts (§ 146 AO) sowie — wegen des Handels mit
hochwertigen Gütern und Edelmetallen — den geldwäscherechtlichen Sorgfaltspflichten des
Geldwäschegesetzes (GwG).

### 1.2 Zweck des Kassensystems

Das System „warehouse14" dient der

- **vollständigen, richtigen, zeitgerechten und geordneten Einzelaufzeichnung** aller baren und unbaren
  Geschäftsvorfälle (Verkauf und Ankauf) gemäß § 146 AO;
- **unveränderbaren Aufzeichnung** dieser Vorfälle gemäß GoBD (kryptografische Hash-Kette, siehe 3.4) und
  über eine **zertifizierte Technische Sicherheitseinrichtung (TSE)** gemäß § 146a AO / KassenSichV
  (Fiskaly SIGN DE V2, siehe 3.5);
- **Belegausgabe** an den Kunden (Belegausgabepflicht § 146a Abs. 2 AO, siehe 2.5);
- **Erfüllung der geldwäscherechtlichen Identifizierungs- und Dokumentationspflichten** (GwG, siehe 2.3);
- **Erzeugung der für die Finanzbuchhaltung und eine Außenprüfung / Kassen-Nachschau erforderlichen
  Auswertungen und Exporte** (DATEV, Kassenbericht, DSFinV-K, siehe 3.6).

### 1.3 Geltungsbereich

Diese Verfahrensdokumentation umfasst den gesamten Lebenslauf eines steuerlich relevanten Datensatzes —
von der **Erfassung** an der Kasse über die **Verarbeitung** und **Speicherung** auf dem zentralen Server
bis zur **Archivierung** und **Auswertung**. Sie beschreibt die eingesetzte Software, die organisatorischen
Abläufe, das interne Kontrollsystem und das Änderungsmanagement. Hardwarekomponenten (Bondrucker,
Kartenterminal, TSE-Anbindung) werden insoweit beschrieben, als sie für die fiskalische Aufzeichnung
relevant sind.

### 1.4 Verwendete Begriffe

| Begriff | Bedeutung |
|---|---|
| **POS** | Point-of-Sale-Anwendung (Kassen-App) auf dem Verkaufsterminal (Windows, Tauri-Desktop-Anwendung) |
| **Owner-Desktop / Kommandozentrale** | Auswertungs-, Verwaltungs- und Kontroll-Oberfläche des Inhabers |
| **TSE** | Technische Sicherheitseinrichtung nach § 146a AO / KassenSichV; hier: Fiskaly SIGN DE V2 (Cloud-TSE) |
| **Ledger / Hash-Kette** | Fortlaufendes, kryptografisch verkettetes Journal aller fiskalisch relevanten Vorgänge |
| **VERKAUF** | Verkauf einer Ware an einen Kunden |
| **ANKAUF** | Ankauf einer Ware vom Kunden |
| **Storno** | Stornierung eines bereits abgeschlossenen Vorgangs (siehe 2.6) |
| **Z-Bon / Kassenabschluss** | Tagesabschluss je Geschäftstag (`daily_closings`) |
| **KYC / GwG-Identifizierung** | Identifizierung des Vertragspartners nach Geldwäschegesetz |
| **R2** | Cloudflare-R2-Objektspeicher (S3-kompatibel) — Archiv-Ablage |

---

## 2. Anwenderdokumentation

### 2.1 Anmeldung und Sitzung

Die Anmeldung an der Kasse erfolgt über eine **persönliche PIN** je Mitarbeiter auf einem
gerätegebundenen Terminal. Jeder Anmeldevorgang, jede Abmeldung und jede fehlgeschlagene PIN-Eingabe wird
protokolliert (`audit_log`). Nach **fünf fehlgeschlagenen PIN-Versuchen** wird das Benutzerkonto an der
Kasse gesperrt (`pos_pin_locked_until`); die Entsperrung erfolgt über die vollständige Anmeldung
(Full-Login). Schwache PINs (z. B. „0000", „1234", Wiederholziffern) werden durch eine Blacklist
abgelehnt. Details siehe 4.3.

### 2.2 Verkauf (VERKAUF)

1. Der Kassierer erfasst die Artikel (aus dem Katalog/Lager oder als manuelle Position).
2. Je Artikel ist eine **Steuerbehandlung** hinterlegt, die deterministisch aus einer festen Tabelle
   stammt (kein KI-Verfahren): Differenzbesteuerung § 25a UStG, Regelbesteuerung (19 %), ermäßigt (7 %),
   Kleinunternehmer § 19 UStG oder Anlagegold § 25c UStG (steuerfrei). Die Steuerbehandlung wird als
   unveränderlicher Snapshot mit der Position gespeichert.
3. Rabatte und Gutscheine können erfasst werden; die Beträge fließen in die Steuer- und Summenrechnung
   ein. Alle Geldbeträge werden zentgenau (`NUMERIC(18,2)`, Decimal-Arithmetik) geführt; deutsche
   Komma-Eingabe wird akzeptiert und intern normalisiert.
4. Der Kassierer wählt die **Zahlungsart** (Bar, Karte/ZVT, SumUp, Überweisung, Gutschein u. a.) und
   schließt den Vorgang ab („Bezahlen").
5. Beim Abschluss wird der Vorgang in der Datenbank festgeschrieben, die Hash-Kette fortgeschrieben und
   der Beleg über die **TSE signiert** (siehe 3.5). Die TSE-Signatur wird serverseitig dauerhaft und
   unveränderbar gespeichert (`tse_signatures`).
6. Der **Kassenbeleg** wird ausgegeben (Druck/Vorschau, siehe 2.5).

**GwG-Schwelle beim Verkauf:** Erreicht oder überschreitet der Gesamtbetrag eines Verkaufsvorgangs die
geldwäscherechtliche Schwelle (Standard **2.000,00 €**, § 10 GwG), so ist die **Identifizierung des
Käufers zwingend** — das System verweigert serverseitig den Abschluss ohne identifizierten Kunden (harte
Sperre, siehe 2.3 und 3.7).

### 2.3 Ankauf (ANKAUF) und GwG-Identifizierung

Der Ankauf folgt demselben Erfassungs- und Abschlussweg, jedoch mit **umgekehrter Geldrichtung** (das
Unternehmen zahlt an den Kunden aus).

**GwG-/§ 259-StGB-Regel (unbedingt, ohne Schwelle):** Bei **jedem Ankauf ab 0,01 €** ist der Verkäufer
(Einlieferer) **zwingend zu identifizieren**. Diese Regel ist im System als un-umgehbarer
Datenbank-Trigger umgesetzt (`trg_transactions_validate_kyc`, Migration 0050) und kann **nicht per
Einstellung deaktiviert werden**. Ein Ankauf ohne identifizierten, KYC-geprüften Verkäufer wird
serverseitig abgewiesen. Hintergrund ist die konservative Politik zur Vermeidung der Hehlerei (§ 259 StGB)
und die geldwäscherechtliche Sorgfaltspflicht.

**„Smurfing"-Erkennung (§ 10 Abs. 3 Nr. 2 GwG):** Das System erkennt zusammenhängende Ankäufe desselben
Kunden, die einzeln unter der Schwelle bleiben, in der Summe über ein rollierendes Zeitfenster (Standard
**30 Tage**) jedoch auffällig werden. Diese Muster werden **erkannt, dokumentiert und dem Mitarbeiter
angezeigt** (Hinweis/Alert); eine harte Sperre des Einzelvorgangs allein wegen der Summenschwelle erfolgt
in diesem Aggregat-Fall derzeit nicht (beim Einzelvorgang ≥ Schwelle hingegen schon). Die genaue
Verfahrensweise ist mit dem Steuerberater/Geldwäschebeauftragten abzustimmen (siehe Anlage 5.4).

**Ankaufbeleg:** Für den Ankauf wird ein Ankaufbeleg/-etikett erzeugt; die Ware wird mit Lagerort in den
Bestand übernommen.

### 2.4 Kassenabschluss / Z-Bon

Je **Geschäftstag** (Zeitzone Europe/Berlin) wird genau **ein Tagesabschluss** (`daily_closings`)
geführt. Der Abschluss durchläuft die Zustände `COUNTING` → `FINALIZED`:

- **COUNTING:** Der Kassierer zählt den Kassenbestand (Bargeldzählung). Das System errechnet den
  Soll-Bestand aus den Barzahlungen, erfasst den Ist-Bestand und ermittelt die **Kassendifferenz**
  (`cash_drawer_variance_eur = gezählt − erwartet`).
- **FINALIZED:** Mit dem Abschluss werden alle Summen, Zähler, die TSE-Statuswerte und ein
  **kryptografischer Anker der Hash-Kette** (`ledger_anchor_id` / `ledger_anchor_hash`) festgeschrieben.
  Ein finalisierter Abschluss ist **unveränderbar** — nur das Feld `notes` (Bemerkung) bleibt änderbar;
  jede andere Änderung wird durch einen Datenbank-Trigger abgewiesen, und der Übergang aus `FINALIZED`
  heraus ist gesperrt.

Der Abschluss enthält u. a.: Anzahl Verkäufe/Ankäufe/Stornos, Brutto-/Netto-Summen je Richtung,
**Umsatzsteuer je Steuerbehandlung**, **Zahlungsarten-Aufstellung**, Kassendifferenz sowie die
TSE-Gesundheitswerte (finished/pending/failed). Eine Kassendifferenz über dem Schwellenwert (Standard
**5,00 €**) erfordert eine ADMIN-Prüfung.

### 2.5 Belegausgabe

Mit jedem abgeschlossenen Vorgang wird ein **Kassenbeleg** erzeugt (Belegausgabepflicht § 146a Abs. 2 AO).
Der Beleg trägt:

- die Geschäfts-Identität (Name, Anschrift, USt-IdNr., Telefon — aus `system_settings`, Schlüssel `shop.*`),
- eine fortlaufende, jahresbezogene **Belegnummer** (`receipt_locator`, Format `RCP-JJJJ-NNNNNN`),
- die Einzelpositionen mit Steuerausweis (inkl. der gesetzlichen Fußnoten zu § 25a / § 25c / § 19 UStG),
- den **TSE-Block** mit Signatur, Signaturzähler, Transaktionsnummer, Zeitstempeln und den
  **QR-Code** gemäß BSI TR-03151.

Der Beleg kann vor dem Druck in einer Vorschau geprüft und bei Bedarf **erneut gedruckt** werden
(Beleg-Reprint). Das Layout (Identität, Fußnoten, Logo) ist über den Beleg-Designer im Owner-Desktop
konfigurierbar.

### 2.6 Storno / Korrektur

Ein Storno ist **kein Löschen**, sondern eine **neue, gegenläufige Buchung**: Es wird eine eigene
Transaktionszeile mit Verweis auf den Originalvorgang (`storno_of_transaction_id`) und **negativen
Geldbeträgen** angelegt. Die Summenbildung über einen Geschäftstag ergibt damit automatisch den
Netto-Umsatz. Regeln (per Datenbank erzwungen): Storno trägt nicht-positive Beträge; ein **Storno eines
Stornos ist unzulässig**; der GwG-Trigger blockiert eine Stornierung nicht. Jeder Storno wird in der
Hash-Kette protokolliert.

### 2.7 Rollen und Berechtigungen

| Rolle | Befugnisse |
|---|---|
| **CASHIER** (Kassierer) | Verkauf, Ankauf, Storno, Kassenabschluss; nur von einem gepaarten Kassengerät aus |
| **ADMIN** (Inhaber/Verwaltung) | zusätzlich Auswertungen, Stammdaten, Einstellungen, Geräteverwaltung, Exporte; Back-Office-Vorgänge auch ohne Kassengerät |
| **READONLY** (Steuerberater) | reiner Lesezugriff auf fiskalische Auswertungen und Exporte (DATEV/Kassenbericht) |

Sensible Einzelvorgänge (insbesondere fiskalische Exporte) erfordern eine erneute PIN-Bestätigung
(„Step-up", siehe 4.3) und werden protokolliert. Für ADMIN/READONLY ist zusätzlich eine
**Zwei-Faktor-Authentifizierung (TOTP)** vorgesehen.

---

## 3. Technische Systemdokumentation

### 3.1 Komponentenübersicht

| Komponente | Technologie | Aufgabe |
|---|---|---|
| **POS (Kasse)** | Tauri-Desktop-App (Windows), Web-Frontend | Erfassung Verkauf/Ankauf, Belegdruck, TSE-Anbindung, Offline-Resilienz |
| **Owner-Desktop** | Tauri/Web | Auswertung, Stammdaten, Einstellungen, Geräte-/KYC-Verwaltung, Kettenprüfung |
| **API-Server (api-cloud)** | Node.js / Fastify | Geschäftslogik, Validierung, Schreiben in die Datenbank, Exporte |
| **Worker** | Node.js (Cron-Jobs) | TSE-Archivierung, DSFinV-K-Push, Kettenprüfung, Aufbewahrungs-/Bereinigungsjobs |
| **Datenbank** | PostgreSQL 17 | Persistenz aller fiskalischen Daten, Trigger-erzwungene Integrität |
| **Cache/Queue** | Redis | Sitzungen, Hintergrundverarbeitung |
| **Zugangs-Tunnel** | Cloudflare Tunnel (`cloudflared`) | gesicherter Zugang zum Server ohne offene Ports |
| **Objektspeicher** | Cloudflare R2 (S3-kompatibel) | Archiv-Ablage (TSE-TAR, Exporte) |
| **TSE** | Fiskaly SIGN DE V2 (Cloud-TSE) | zertifizierte Signatur nach KassenSichV / BSI TR-03153 |

Server-Betrieb: Alle Server-Komponenten laufen als Docker-Container auf einem dedizierten
arm64-Server (Oracle Cloud). Der Verbund (`docker-compose.prod.yml`) umfasst die Dienste `postgres`,
`redis`, `migrate`, `api`, `worker` und `cloudflared`. Der API-Dienst ist nur über den
Cloudflare-Tunnel erreichbar (kein offener Host-Port).

### 3.2 Datenfluss: Erfassung → Verarbeitung → Speicherung

1. **Erfassung (POS):** Der Kassierer erfasst Positionen; Beträge werden zentgenau gerechnet. Bei
   Netzausfall werden die Vorgänge lokal als „Intention" zwischengespeichert (Offline-Resilienz, siehe
   3.5) — der Verkauf bricht nicht ab, der Kunde erhält einen Beleg.
2. **Übertragung:** Der POS sendet den Vorgang über eine gesicherte Verbindung (TLS, gerätegebundenes
   Token/mTLS) an den API-Server. Eine **Idempotenzschlüssel-Logik** verhindert Doppelbuchungen bei
   Wiederholungen (`transactions.idempotency_key`).
3. **Verarbeitung (API):** Der Server validiert (Rolle, Gerät, GwG-Schwellen), schreibt die Transaktion,
   die Positionen und Zahlungen in **einer** Datenbank-Transaktion (alles-oder-nichts) und reserviert/
   verbucht den Warenbestand.
4. **Signatur (TSE):** Der Beleg wird über die Fiskaly-TSE signiert; die Signaturdaten werden serverseitig
   in `tse_signatures` dauerhaft und unveränderbar abgelegt.
5. **Speicherung + Verkettung:** Mit jedem fiskalisch relevanten Schritt schreibt ein
   Datenbank-Trigger einen Eintrag in das **Ledger** (`ledger_events`) und verkettet ihn kryptografisch
   mit dem Vorgänger (siehe 3.4).

### 3.3 Einzelaufzeichnungspflicht

Jeder Geschäftsvorfall wird als **einzelner** Datensatz mit allen wesentlichen Merkmalen geführt
(`transactions` + Positionen `transaction_items` + Zahlungen): Richtung (Verkauf/Ankauf), Beteiligte
(Kunde, Kassierer, Gerät), Einzelbeträge, Steuerbehandlung je Position (unveränderlicher Snapshot),
Belegnummer, Zeitstempel. Eine DB-Invariante stellt die Betragslogik sicher
(`subtotal_eur + vat_eur = total_eur`). Verdichtungen (Tagesabschluss) erfolgen **zusätzlich** zur
Einzelaufzeichnung, nicht an deren Stelle.

### 3.4 Unveränderbarkeit — kryptografische Hash-Kette (GoBD)

Das Herzstück der GoBD-Unveränderbarkeit ist das **fortlaufende, append-only Journal** `ledger_events`
(Migration 0008). Jeder fiskalisch relevante Zustandswechsel im gesamten System schreibt hier einen
Eintrag. Eigenschaften:

- **Verkettung:** Ein `BEFORE INSERT`-Trigger (`ledger_compute_hash`) berechnet je Zeile den
  `prev_hash` (= `row_hash` der Vorgängerzeile, Genesis = 32 Null-Bytes) und den `row_hash` als
  **SHA-256** über eine kanonische Serialisierung (Vorgänger-Hash, Ereignistyp, Entität, Akteur, Gerät,
  IP, SHA-256 des Payloads, erzwungener Zeitstempel). Der Zeitstempel wird vom Trigger auf `now()`
  gesetzt — **Rückdatierung ist ausgeschlossen**.
- **Append-only durch Rechtevergabe:** Die Anwendungs-Rolle (`warehouse14_app`) besitzt **nur SELECT und
  spaltenbeschränktes INSERT** — **kein UPDATE, kein DELETE**. Die Hash-Spalten und der Zeitstempel sind
  für die Anwendung **nicht beschreibbar**.
- **Rollen-Isolation (Defense in Depth):** Der Trigger ist `SECURITY DEFINER` und gehört der separaten
  Rolle `warehouse14_security`. Eine kompromittierte Anwendungs-Rolle kann den Trigger **weder löschen
  noch ändern noch umgehen**.
- **Prüfbarkeit:** Die Funktion `verify_ledger_chain()` läuft die gesamte Kette ab, rechnet jeden Hash
  neu und meldet die **erste Bruchstelle** (gelöschte, umsortierte oder nachträglich veränderte Zeile).
  Eine **leere Ergebnismenge bedeutet: Kette intakt.** Diese Prüfung läuft **täglich um 05:00 Uhr**
  automatisiert (Worker-Job `chain_verifier`) und ist im Owner-Desktop on-demand auslösbar; ein
  erkannter Bruch löst einen kritischen Alarm aus.
- **Tages-Anker:** Jeder finalisierte Tagesabschluss speichert den Kettenkopf
  (`ledger_anchor_id`/`ledger_anchor_hash`) als Checkpoint.

Ergänzend führt `audit_log` die **nicht-fiskalischen** Sicherheitsereignisse (Anmeldungen,
Rollenänderungen, Einstellungsänderungen) — ebenfalls append-only (kein UPDATE/DELETE), jedoch ohne
Hash-Kette, da hier ein anderes Bedrohungsmodell gilt. Jede Änderung an `system_settings` schreibt
automatisch einen `audit_log`-Eintrag (alter/neuer Wert).

### 3.5 Zertifizierte TSE (KassenSichV § 146a AO)

Die Absicherung gegen nachträgliche Manipulation auf Belegebene erfolgt über die **zertifizierte
Cloud-TSE Fiskaly SIGN DE V2** (BSI TR-03153 / TR-03151). Je Transaktion wird genau **eine**
TSE-Aufzeichnung geführt:

- **Lebenszyklus (`tse_transactions`, Migration 0010):** `QUEUED_OFFLINE` → `ACTIVE` → `FINISHED`
  (bzw. `CANCELLED` / `FAILED`). `QUEUED_OFFLINE` trägt die **Offline-Resilienz**: bei Netzausfall wird
  lokal signiert/zwischengespeichert und vom Worker nach Wiederverbindung an Fiskaly nachgeführt.
- **Signaturpersistenz (`tse_signatures`, Migration 0054):** Nach erfolgreicher Signatur ruft der POS die
  API auf (`POST /api/transactions/:id/tse-signature`) und legt die Signatur **dauerhaft, unveränderbar
  und exakt einmal je Transaktion** ab (eindeutiger Index, idempotent). Gespeichert werden u. a.:
  Signaturwert, Signaturzähler, TSS-/Client-ID, Transaktionsnummer, Signaturalgorithmus, Prozesstyp
  (`Kassenbeleg-V1`), QR-Code-Daten sowie Start-/Endzeit der TSE-Transaktion. Der INSERT erweitert die
  Hash-Kette um ein Ereignis `tse.signature_recorded`. Das Schreiben einer Signatur durch einen
  Kassierer setzt ein **gepaartes Kassengerät (mTLS)** voraus.
- **Zertifikatsüberwachung:** Ein Worker-Job (`tse_cert_checker`, täglich 05:00) überwacht den
  Zertifikatsstatus/-ablauf der TSE-Clients und alarmiert rechtzeitig.

> **Status-Hinweis (Testbetrieb):** Die produktiven Fiskaly-TSE-Zugangsdaten (TSS-ID, API-Key/Secret)
> werden erst am Inbetriebnahme-Termin produktiv hinterlegt. Sind keine Zugangsdaten gesetzt, druckt der
> Beleg den Hinweis „TSE Ausfall"; ein solcher Beleg ist **nicht** go-live-legal. Vor Produktivbetrieb ist
> die TSE mit produktiven Schlüsseln zu aktivieren (siehe Abschnitt 6).

### 3.6 Schnittstellen und Exporte (Auswertungen / Datenzugriff Z1/Z2/Z3)

| Export | Beschreibung | Zugriff |
|---|---|---|
| **DATEV (Buchungsstapel EXTF, Format 700, Kategorie 21)** | Semikolon-getrennte CSV mit fixem EXTF-Header, deutscher Dezimaldarstellung (Komma), Belegdatum DDMM, Belegfeld1 = Belegnummer; je FINALIZED-Tag werden die Vorgänge auf SKR-Buchungszeilen (Soll/Haben, Konto/Gegenkonto, BU-Schlüssel) abgebildet. | `GET /api/closings/:id/export/datev` — ADMIN/READONLY + PIN-Step-up + Protokollierung |
| **Kassenbericht** | Tagesbezogener deutscher Kassenbericht (CSV) aus dem gespeicherten `daily_closing`. | `GET /api/closings/:id/export/kassenbericht` — ADMIN/READONLY + Step-up |
| **DSFinV-K** | Tägliche Erzeugung je finalisiertem Tagesabschluss (`dsfinvk_exports`); optionaler Push der Kassenabschlussdaten an die Fiskaly-DSFinV-K-Cloud (DFKA-Taxonomie). Worker-Job `dsfinvk_daily_export`, täglich 02:00. | Worker + Owner-Desktop; revisionssicherer Nachweis je Lieferung an den Steuerberater |
| **TSE-§10-Archiv (TAR)** | Tägliche vollständige TSE-Transaktionsausfuhr des Vortags als § 10-konformes TAR, SHA-256-gehasht, Ablage in R2 (siehe 4.2). Worker-Job `tse_archive_exporter`, täglich 03:00. | automatisiert; Nachweis in `tse_daily_archives` |

**Datenzugriff bei Außenprüfung/Kassen-Nachschau:** Die Anforderungen des Z1- (unmittelbarer Zugriff,
lesend über die Auswertungs-Oberfläche), Z2- (mittelbarer Zugriff über Auswertungen) und insbesondere
**Z3-Zugriffs** (Datenträgerüberlassung) werden durch die o. g. Exporte abgedeckt; der DSFinV-K-Export
(DFKA-Taxonomie) ist der maßgebliche, strukturierte Datensatz für die Kassen-Nachschau. Die zugrunde
liegenden Einzelaufzeichnungen sind vollständig, unveränderbar und über die Hash-Kette verifizierbar.

> Hinweis: Der frühere Begriff „GDPdU" wurde 2015 durch „GoBD" abgelöst und wird hier nicht verwendet.

### 3.7 GwG-/KYC-Durchsetzung (technisch)

Die geldwäscherechtliche Identifizierungspflicht ist als **un-umgehbarer Datenbank-Trigger**
(`trg_transactions_validate_kyc`, Migration 0050, `BEFORE INSERT` auf `transactions`) umgesetzt:

- **ANKAUF:** Verkäufer muss KYC-geprüft sein (`customers.kyc_verified_at` gesetzt) — **ab 0,01 €, ohne
  Schwelle**. Diese Regel liest **bewusst keinen** Konfigurationswert und ist daher **nicht
  abschaltbar**.
- **VERKAUF:** Bei Gesamtbetrag ≥ Schwelle (`gwg.verkauf_identity_threshold_eur`, Standard 2.000,00 €)
  muss ein KYC-geprüfter Käufer hinterlegt sein.
- **Stornos** sind ausgenommen (sie kehren einen bereits validierten Vorgang um).

Der Trigger ist `SECURITY DEFINER` (Eigentümer `warehouse14_security`) und kann von der Anwendungs-Rolle
nicht entfernt oder verändert werden. Eine Verweigerung ist eine **Transaktionsabweisung**, kein bloßer
Hinweis.

### 3.8 Datenmodell-Überblick (fiskalisch relevante Tabellen)

| Tabelle | Inhalt |
|---|---|
| `transactions` / `transaction_items` / `payments` | Einzelaufzeichnung Verkauf/Ankauf inkl. Positionen, Steuer, Zahlung, Storno-Verweis |
| `tse_transactions` / `tse_signatures` | TSE-Lebenszyklus und persistierte Signaturen je Transaktion |
| `ledger_events` | kryptografisch verkettetes, append-only Fiskal-Journal (Unveränderbarkeit) |
| `audit_log` | append-only Sicherheits-/Verwaltungsereignisse |
| `daily_closings` | Tagesabschluss (Z-Bon), nach `FINALIZED` unveränderbar |
| `dsfinvk_exports` / `tse_daily_archives` | revisionssichere Export-/Archiv-Nachweise |
| `customers` (KYC-Felder) | Kundenstamm inkl. Identifizierungsnachweis (`kyc_verified_at`) |
| `tax_treatment_codes` | feste Steuerbehandlungs-Tabelle (§ 25a / § 25c / § 19 / Regelsatz) |
| `system_settings` | Laufzeit-Konfiguration mit automatischer Audit-Protokollierung |
| `users` / `devices` | Benutzer/Rollen und mTLS-gepaarte Geräte |

---

## 4. Betriebsdokumentation

### 4.1 Laufender Betrieb

Die Server-Dienste laufen als Docker-Container und starten nach einem Neustart automatisch wieder.
Hintergrundprozesse (Worker-Cron-Jobs) laufen u. a. zu festen Zeiten (Zeitzone Berlin):

| Zeit | Job | Zweck |
|---|---|---|
| 02:00 | `dsfinvk_daily_export` | DSFinV-K-Export/-Push des Vortags |
| 03:00 | `tse_archive_exporter` | TSE-§10-TAR-Archiv des Vortags nach R2 |
| 04:00 | `gdpr_cleanup` | DSGVO-Aufbewahrungs-/Löschlauf |
| 05:00 | `chain_verifier` | Verifikation der Hash-Kette |
| 05:00 | `tse_cert_checker` | TSE-Zertifikatsablauf-Überwachung |

Marktpreise (Edelmetalle) werden regelmäßig aktualisiert; weitere Jobs (Sitzungsbereinigung,
Reservierungs-Sweeper u. a.) sichern den ordnungsgemäßen Betrieb.

### 4.2 Datensicherung und Archivierung

- **TSE-Archiv:** Täglich wird der vollständige TSE-Transaktionssatz des Vortags als TAR exportiert, mit
  **SHA-256** gehasht und in **Cloudflare R2** abgelegt (`tse-archives/<tss>/<datum>.tar`). Der Nachweis
  (Hash, R2-Schlüssel, Transaktionsanzahl, Status) wird in `tse_daily_archives` geführt; ein Fehlschlag
  erzeugt einen kritischen Alarm.
- **DSFinV-K-Nachweis:** Jede Erzeugung/Lieferung wird in `dsfinvk_exports` revisionssicher dokumentiert
  (Zeitpunkt, Anforderer, Zeitraum, Datei-Hash, Lieferweg). Diese Tabelle wird durch die Anwendung
  **nie gelöscht**.
- **Datenbank:** Die PostgreSQL-Datenbank ist die führende Quelle; sie ist gegen Manipulation durch die
  Rechte-/Trigger-Architektur abgesichert (siehe 3.4) und in die Server-Sicherung einzubeziehen.
- **Aufbewahrungsfrist:** Fiskalische Belege/Kassendaten **10 Jahre** (§ 147 AO / GoBD). KYC-/
  Ausweisdaten nach GwG (i. d. R. 5 Jahre, § 8 GwG) — die genaue Fristabgrenzung gegenüber der
  10-Jahres-Frist ist mit dem Steuerberater/Geldwäschebeauftragten zu bestätigen (siehe Anlage 5.4).

### 4.3 Zugriffsschutz

- **PIN + Sperre:** persönliche PIN je Mitarbeiter, argon2id-Hash, Blacklist gegen schwache PINs,
  Sperre nach 5 Fehlversuchen.
- **Rollen (RBAC):** ADMIN / CASHIER / READONLY (siehe 2.7).
- **Geräte-Bindung (mTLS):** Kassenvorgänge (Verkauf/Ankauf/Storno/TSE-Signatur) setzen ein
  **gepaartes Gerät** mit eindeutigem Zertifikat voraus (`devices.cert_serial`, Status active/revoked/
  expired). Ein widerrufenes Gerät wird am API-Eingang abgewiesen.
- **Step-up:** sensible Einzelvorgänge (z. B. fiskalische Exporte) erfordern eine frische
  PIN-Bestätigung; der Zugriff wird protokolliert.
- **2FA (TOTP):** für ADMIN/READONLY vorgesehen.
- **Drei-Rollen-Datenbankmodell:** `warehouse14_migrator` (nur Migrationen), `warehouse14_app`
  (Laufzeit, kein DELETE, spaltenbeschränkte Rechte), `warehouse14_security` (NOLOGIN, Eigentümer der
  sicherheitskritischen Trigger/Funktionen). Default-deny auf dem Schema.
- **Netzabsicherung:** Zugang ausschließlich über Cloudflare-Tunnel (keine offenen Ports); TLS auf allen
  Verbindungen; Rate-Limiting an den Authentifizierungs-Endpunkten.

### 4.4 Änderungsmanagement und Versionierung

- **POS-Auslieferung (OTA):** Die Kassen-Anwendung wird über einen signierten Over-the-Air-Mechanismus
  versioniert ausgeliefert (aktuell v0.4.0). Releases werden über die CI signiert und als
  GitHub-Release veröffentlicht; die App aktualisiert sich gegen `latest.json`.
- **Datenbankschema:** Änderungen erfolgen ausschließlich über **nummerierte, transaktionale,
  idempotente Migrationen** (aktueller Stand 0057), die als eigenes Migrations-Image versioniert und
  beim Deploy automatisch angewendet werden. Migrationen sind im Versionskontrollsystem nachvollziehbar.
- **Server-Images:** API/Worker/Migrate werden als versionierte Container-Images ausgeliefert.
- **Nachvollziehbarkeit:** Quellcode und Migrationen liegen unter Versionskontrolle; jede
  Konfigurationsänderung (`system_settings`) wird automatisch im `audit_log` protokolliert.

### 4.5 Ausfallszenarien

- **Netzausfall an der Kasse:** Vorgänge werden lokal als „Intention" gepuffert; die TSE-Signatur läuft
  über `QUEUED_OFFLINE` und wird nach Wiederverbindung vom Worker nachgeführt. Der Verkauf bricht nicht
  ab; der Kunde erhält einen Beleg. Ein offline gequeuter Vorgang gilt **nicht** als Fehlbuchung.
- **TSE-Ausfall:** Schlägt die Signatur fehl, wird der Vorgang gequeued und nachgeführt; auf dem Beleg
  erscheint andernfalls der Hinweis „TSE Ausfall". TSE-Status (`pending`/`failed`) fließt in den
  Tagesabschluss ein. Anhaltende Ausfälle/Archivierungsfehler erzeugen einen **kritischen Alarm**
  (`alert.tse_critical_failure`).
- **Kartenterminal (ZVT):** Finalisierungs-Wiederholungen erfolgen ohne erneute Autorisierung
  (Finalize-Retry); Zombie-Reservierungen werden zurückgerollt.
- **Doppelbuchung:** Idempotenzschlüssel auf Client- und Serverseite verhindern Doppelzahlungen.

### 4.6 Internes Kontrollsystem (IKS)

- **Erzwungene Integrität durch die Datenbank:** Betragslogik (CHECK), Storno-Disziplin,
  Abschluss-Unveränderbarkeit, KYC-Pflicht und Hash-Verkettung sind als Trigger/Constraints umgesetzt —
  unabhängig von der Anwendungslogik.
- **Funktionstrennung:** Drei Datenbankrollen; kein DELETE für die Laufzeit-Rolle auf fiskalischen
  Tabellen.
- **Automatische Kontrollen:** tägliche Hash-Ketten-Verifikation, TSE-Zertifikats- und
  Archivierungs-Überwachung, Anomalie-Watchdog, Smurfing-Erkennung, Kassendifferenz-Schwelle.
- **Protokollierung:** lückenlose Audit-Protokollierung (`audit_log`) für Anmeldungen, Rollen-/
  Einstellungsänderungen; fiskalische Vorgänge zusätzlich in der Hash-Kette.
- **Vier-/Mehr-Augen-Elemente:** Step-up und ADMIN-Prüfung bei auffälligen Kassendifferenzen.

### 4.7 Hinweis Testbetrieb

Zum Stand dieser Dokumentation läuft das System im Testbetrieb. **Vor dem ersten echten Geschäftsvorfall**
sind die in Abschnitt 6 genannten Punkte abzuarbeiten (produktive TSE-Schlüssel, mTLS-Geräte, reale
USt-IdNr./Telefon, Secret-Rotation). Bis dahin sind erzeugte Belege/Signaturen **nicht** als produktiv
fiskalisch gültig zu betrachten.

---

## 5. Anlagen und Verweise

| Nr. | Anlage / Verweis | Inhalt |
|---|---|---|
| 5.1 | `docs/security-audit-2026-06-07.md` | Sicherheits-/Compliance-Audit (Critical/High/Medium/Low) |
| 5.2 | `docs/deep-audit-2026-06-07.md` | vertiefte Mehr-Personen-Prüfung (54 Befunde) und deren Behebung |
| 5.3 | `docs/go-live-preparation.md`, `docs/go-live-hardware-checklist.md` | Inbetriebnahme-Checklisten (Hardware-Tag) |
| 5.4 | `docs/steuerberater-anfrage.md` | Abstimmungsschreiben an Steuerberater/Geldwäschebeauftragten (Schwellenwerte, SKR-Kontenrahmen, Aufbewahrung) |
| 5.5 | Beleg-Muster `Warehouse14-Kassenbon-Muster.pdf` | Beispiel-Kassenbon mit TSE-Block/QR und Steuerfußnoten |
| 5.6 | Stammdaten `system_settings` (`shop.*`) | Geschäfts-Identität (Name, Anschrift, USt-IdNr., Telefon) |
| 5.7 | Datenbank-Migrationen `packages/db/migrations/` | maßgebliche fiskalische Logik (insb. 0008, 0009, 0010, 0011, 0050, 0054) |

### Kontenzuordnung (SKR) — **offener Punkt**

Die Abbildung der Geschäftsvorfälle auf konkrete **SKR03-Konten je Steuerbehandlung** (Sach-/Gegenkonten
für An-/Verkauf, Kasse, Differenzbesteuerung; Berater-/Mandantennummer; SKR03 vs. SKR04) ist im
DATEV-Export technisch vorbereitet, muss aber inhaltlich vom **Steuerberater bestätigt** werden, bevor der
Produktivbetrieb beginnt (siehe Anlage 5.4, dort insbesondere die Punkte 1, 2, 4 und 5).

---

## 6. Offene Punkte / vor Produktivbetrieb zu erledigen

| # | Punkt | Bezug |
|---|---|---|
| 1 | **Produktive TSE aktivieren** (Fiskaly TSS-ID + API-Key/Secret hinterlegen); ohne diese druckt der Beleg „TSE Ausfall" und ist nicht go-live-legal. | 3.5 |
| 2 | **mTLS-Geräte koppeln** (Hardware-Tag) und produktive Geräte-Zertifikate ausstellen. | 4.3 |
| 3 | **Reale USt-IdNr. und Telefonnummer** in `shop.*` eintragen (derzeit provisorische DUMMY-Werte). | 2.5 / 5.6 |
| 4 | **Alle Produktiv-Geheimnisse rotieren** (Schlüssel/Token), Fiskaly-Schlüssel in die OS-Keychain überführen. | 4.3 |
| 5 | **SKR-Kontenzuordnung und GwG-Schwellen** mit Steuerberater/Geldwäschebeauftragtem abstimmen und bestätigen. | 5.4 |
| 6 | **Geldwäschebeauftragten** benennen und Verdachtsmeldungs-Workflow (§ 43 GwG) festlegen. | 5.4 |

---

*Diese Verfahrensdokumentation beschreibt den tatsächlichen Implementierungs- und Betriebsstand des
Systems „warehouse14" zum 08.06.2026. Sie ist bei jeder wesentlichen Änderung des Verfahrens
fortzuschreiben; die Versionshistorie ergibt sich aus dem Versionskontrollsystem (Migrationsstand,
POS-Release-Tag).*
