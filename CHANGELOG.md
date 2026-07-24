# Changelog

All notable changes to the Warehouse14 POS desktop binary are recorded
here. The format follows [Keep a Changelog](https://keepachangelog.com)
and the project adheres to [SemVer](https://semver.org).

## [Unreleased]

## [0.7.2] - 2026-07-24

- **Bestellungen sind eine echte Arbeitsfläche.** Die Online-Reservierungen öffnen sich jetzt als Meister-Detail: links die Warteschlange nach Fächern, rechts der ganze Vorgang mit Kundenname, Positionen, Herkunft (Laden oder Webshop) und den Schritten annehmen, vorbereiten, bereitstellen, übergeben. Kein schwebender Kasten mehr in der Mitte.
- **Bestellungen steht jetzt direkt neben Ankauf** (Kartei-Ziffer 3), nicht mehr am Ende der Leiste, und die Ziffernfolge in der Leiste stimmt wieder von 1 bis 8.
- **Vorläufige Rechnung für den Kunden, auch ohne TSE.** Ein klar als nicht-fiskalisch gekennzeichneter Beleg lässt sich für den Kunden drucken, bevor an der Kasse bei der Bezahlung der echte fiskalische Bon nach §146a AO entsteht.

## [0.7.1] - 2026-07-23

- **Bestellungen sind jetzt ein sichtbarer Bereich, kein Suchtreffer.** Der Schirm war seit v0.7.0 vollständig gebaut, aber nur über die Suche erreichbar — es gab keinen Knopf an der Oberfläche, um eine Online-Reservierung anzunehmen, vorzubereiten oder zu übergeben. Bestellungen steht jetzt als eigener Bereich mit der Kartei-Ziffer 8 in der Hauptleiste. Der Leitstand, eine reine Blick-Fläche, ist dafür in die Suche gewandert (der Inhaber trägt ihn ohnehin in der Telefon-App).

## [0.7.0] - 2026-07-23

- **Die Bestätigung verlangt jetzt Ihren Gerätecode, nicht mehr die abgeschaffte Kassen-PIN.** Jeder Steuerexport, jedes Storno, jeder Z-Bon, jede Löschung fragte weiter nach der vierstelligen Zahl, die am 21.07. abgeschafft wurde. Sie geben jetzt denselben Code ein wie beim Entsperren der Kasse. Geprüft wird er auf diesem Gerät, mit derselben Sperre nach mehreren Fehlversuchen; er wird nicht über das Netz geschickt. Wichtig für Sie als Inhaber: ein neu angelegter Mitarbeiter hatte gar keine alte PIN und hätte den Steuerexport NIE ausführen können.
- **Sie können jetzt eine einzelne Position aus einer Bestellung nehmen.** Ist eines von drei Stücken beim Vorbereiten beschädigt, mussten Sie bisher die ganze Bestellung ablehnen — der Kunde bekam eine Absage für zwei einwandfreie Stücke. Jetzt nehmen Sie das eine heraus, es geht sofort zurück in den Verkauf, und der Kunde erfährt die Änderung per Brief. Die letzte Position lässt sich so nicht entfernen; dafür gibt es das Ablehnen mit Grund.
- **Sie können die Abholfrist verlängern.** Ruft jemand an und schafft es erst Samstag, geben Sie ihm drei, sieben oder vierzehn Tage mehr. Bisher war nichts zu machen: die Reservierung verfiel, die Stücke gingen zurück in den Verkauf, und die Vertrauensstufe zählte es als Nichtabholung — der Kunde wurde also bestraft, weil er angerufen hat. Der Kunde bekommt das neue Datum schriftlich.
- **Bestellungen ablehnen, mit Grund.** Der Grund steht im Absagebrief, im Beleg und im Tagebuch.
- **Ein Aufkleber zum Ausdrucken**, mit Anschrift, Bestellnummer und Strichcode. Bei einer Abholung ist es der Regalzettel: derselbe Strichcode, damit ein Handscanner das Paket am Tresen sofort findet. Eine Sendungsnummer steht bewusst NICHT darauf, solange kein Zusteller angebunden ist.
- **Ein gelöschtes Kundenkonto verschwindet nicht mehr aus der Liste.** Es steht durchgestrichen da, mit dem Hinweis, ob der Kunde es selbst gelöscht hat oder wir. Kundennummer und Umsätze bleiben erhalten. In der Kundenauswahl beim Verkauf wird ein gelöschtes Konto weiterhin nicht angeboten.
- Eine Versandbestellung liest sich jetzt als „Versand" statt als Abholung mit unbekanntem Stand.

## [0.6.0] - 2026-07-23

- Neu: die Bestellungen. Was ein Kunde im Onlineshop reserviert, steht jetzt als eigene Warteschlange an der Kasse, mit Name, Kontakt, Positionen, Bestellnummer und Frist. Vier Knöpfe führen den Vorgang von Anfang bis Ende: annehmen, vorbereiten, abholbereit melden, übergeben. Bis heute gab es dafür keine einzige Schaltfläche, und eine Web-Reservierung liess sich überhaupt nicht abschliessen.
- Die Übergabe läuft über den ganz normalen Verkauf. Sie laden die Bestellung an die Kasse, kassieren, und der Beleg entsteht auf demselben Weg wie jeder andere. Das Stück geht auf verkauft, die Bestellung wird mit dem Beleg verknüpft, und im Tagebuch steht, wer übergeben hat.
- „Abholbereit" schickt dem Kunden den Brief, dass sein Stück bereit liegt. Geht der Versand schief, sagt die Kasse es Ihnen sofort, statt so zu tun, als sei der Brief unterwegs.
- Zwei falsche Anzeigen in der Kundenakte sind behoben. Ein roher Zustandsname erscheint nicht mehr im Klartext, und ein fehlgeschlagener Lesevorgang wird nicht länger als „nichts bestellt" dargestellt. Ein Fehler beim Lesen sagt jetzt, dass gelesen werden wollte und nicht ging.
- Die Meldung bei einem Widerspruch ist ehrlich geworden. Sie sagt jetzt, ob die Bestellung verfallen, storniert oder bereits übergeben ist, statt zu behaupten, sie stehe nicht mehr auf einem Stand, auf dem sie sichtbar steht.
- Das Tagebuch kennt die neuen Vorgänge auf Deutsch. Statt eines rohen Kürzels steht dort, dass eine Bestellung angenommen, vorbereitet oder als abholbereit gemeldet wurde.

## [0.5.5] - 2026-07-21

- Der Gerätecode ist jetzt gegen systematisches Raten geschützt. Ab der dritten Fehleingabe sperrt sich das Tastenfeld für 15 Sekunden, ab der fünften für eine Minute, ab der siebten für fünf Minuten und ab der neunten für fünfzehn Minuten, jeweils mit sichtbarer Restzeit. Nach zehn Fehlversuchen wird der gespeicherte Code gelöscht und eine neue Anmeldung mit Google verlangt.
- Der Zähler der Fehlversuche wird dauerhaft gespeichert. Die App zu schließen und wieder zu öffnen setzt ihn nicht mehr zurück.
- Der Gerätecode wird deutlich stärker abgelegt: statt eines einzelnen Durchgangs jetzt PBKDF2 mit 100.000 Runden. Ein bereits gesetzter Code wird bei der nächsten richtigen Eingabe automatisch übernommen, Sie müssen nichts tun.

## [0.5.4] - 2026-07-19

- Vierzehn wird ausführend: Der Assistent kann Artikel jetzt nicht nur anlegen, sondern auch ändern („ändere den Preis der Taschenuhr auf 450") und Entwürfe löschen, immer mit lautem Zurücklesen und erst nach einem gesprochenen Ja, mit vollem Vorher/Nachher im Tagebuch. Seine Grenzen bleiben hart: nur Ware, niemals Einkaufspreis, Steuer, Status-Schalter, Geldpfade oder System.
- Die Foto-Brücke: Auf dem Telefon gibt es den neuen „Fotoeingang", der Ware direkt vom Regal an Vierzehn sendet. An der Kasse zeigt der Assistent die angekommenen Bilder als Vorschau und hängt sie auf Zuruf an den diktierten Artikel („leg ein Produkt an, mit den drei neuen Fotos"), das erste wird automatisch das Hauptfoto. Ein gelöschter Entwurf gibt seine Fotos in den Eingang zurück, nichts geht verloren.

- Neuer Leitstand (nur für den Inhaber): der Zustand des ganzen Hauses auf einer ruhigen Seite. Ein Urteil oben („Alles in Ordnung", „Achtung erforderlich", „Störung"), der Zustand jedes Bereichs als eigene Kachel (Server, Datenbank mit Schema-Stand, Hintergrund-Jobs, Fiskal mit TSE-Restlaufzeit, Warnsignale, Edge-Schutz), eine Liste der wirklich offenen Probleme mit einem direkten Weg zur Lösung, und die Türen zu Risikoanalyse und Schaufenster an einer Stelle. So sind Risiko, Systemzustand, Probleme und die Firewall endlich verbunden statt versteckt.
- Kundenakte tiefer: die Suche findet einen Kunden jetzt auch über die Bestellnummer, nicht nur über Name, Kundennummer, E-Mail oder Telefon. In der Akte steht, wie der Kunde entstanden ist (mit Google registriert, online registriert oder im Geschäft angelegt), und jeder Vorgang trägt seine Herkunft als Kennzeichen (Online, eBay oder Telefon gegenüber der Kasse).
- Ruhigere, reichere Bewegung: neue Bildschirme setzen sich mit einer sanften, gestaffelten Einblendung zusammen statt hart aufzuspringen, und das Profilmenü öffnet sich weich aus dem Medaillon. Alles achtet die Systemeinstellung für reduzierte Bewegung.
- Feinschliff der Risikoanalyse: die Balken tragen jetzt ruhige Tinte statt eines falschen Goldtons, und die Statuspunkte folgen der Hausfarblehre (grün für ruhig, Gold für Beobachtung, Rot für Alarm).

## [0.5.3] - 2026-07-17

- Anmeldung mit Google: Sie melden sich mit dem Warehouse14-Google-Konto an und vergeben danach einen eigenen Code oder ein Passwort, das nur auf diesem Gerät gespeichert wird. Die PIN-Anmeldung bleibt als Alternative erhalten.
- Sicherer Start: die App öffnet nie mehr von selbst. Bei jedem Öffnen ist der Gerätecode Pflicht (nicht mehr überspringbar), und nach fünf Minuten ohne Bedienung sperrt sie sich wieder. Die Google-Identität wird verlangt, sobald die Sitzung abläuft. Eine gespeicherte Sitzung allein reicht nie, um hineinzukommen.
- Vollständiges Profil statt des „14"-Siegels: oben links zeigt ein Messing-Medaillon jetzt Ihr Google-Bild (oder Ihre Initialen). Ein Klick öffnet Name, angemeldete E-Mail, Ihre Rolle mit den zugehörigen Berechtigungen, die Gültigkeit der Sitzung und die Abmeldung an einer einzigen Stelle.
- Neue Zielkarte: die Ziele des Hauses als lebendige Instrumententafel mit echten Live-Werten (Umsatz, Bestand, Gold und Silber, Gewinn). Jedes Instrument ist fein ausgearbeitet wie echtes Werkstatt-Gerät: Messing-Manometer mit gravierten Zahlenskalen und Zeigern aus gebläutem Stahl, ein Thermometer, Glasgefäße voller geschmolzenem Gold und Silber, hölzerne Schatztruhen mit Messingbeschlägen und Nieten, eine Balkenwaage mit Ketten sowie eine gealterte Schatzkarte mit Galeone und Kompassrose.
- Neue Risikoanalyse: Warnsignale und die Kunden-Beobachtungsliste an einem Ort, samt Edge-Schutz von Cloudflare, der zeigt, wie viele Bedrohungen am Rand gestoppt wurden, an welchen Tagen und aus welchen Ländern sie kamen.
- Neues Schaufenster: wer vor dem Fenster steht. Besucher pro Tag, Seitenaufrufe, Herkunftsländer, verwendete Browser, der getrennt ausgewiesene Anteil des Ladens gegenüber der App-Schnittstelle und die Frage, ob der Laden sauber geantwortet hat. Besucher sind bewusst keine Kunden und werden nie über Tage addiert.
- Neues Team und Rollen: Mitarbeiter über ihre Google-E-Mail freischalten, die Rolle setzen und den Zugang wieder entziehen.
- API-Schlüssel in den Einstellungen: programmatische Zugänge für Agenten oder Dienste anlegen, mit fester Rolle und optionaler Nur-Lesen-Beschränkung. Der Schlüssel wird nur einmal angezeigt.
- Kundenakte: die Gesamtzahl der Kunden und der letzte Vorgang je Kunde werden jetzt angezeigt.
- Vierzehn kann auf Zuruf einen Artikel als Entwurf anlegen (nach gesprochener Bestätigung) und bleibt bei längeren Gesprächen zuverlässig verbunden.
- Ehrliche Fehlerantworten am Rand: ein fehlerhaft gesendeter Aufruf wird jetzt als solcher beantwortet (nicht mehr als Serverfehler), und eine noch nicht eingerichtete Funktion (Kartenzahlung, Fotospeicher) meldet ehrlich „nicht verfügbar" statt einen Absturz vorzutäuschen. Das hält die Störungsanzeige im Schaufenster sauber.
- Allgemeine Verbesserungen und Politur.

## [0.5.2] - 2026-07-15

- Vierzehn ist jetzt deutlich lauter und klarer zu hören, mit sauberem Hochdeutsch und einer natürlicheren Stimme.
- Vierzehn zeigt jetzt, was er sagt: während er über Zahlen spricht, erscheint eine dramatische Karte auf dem Bildschirm. Der Umsatz als große, hochzählende Zahl; der Stand des Tages mit Metallpreisen; die Finanzen; ein gefundener Artikel oder Kunde; die Agenda.
- Vierzehn liest jetzt das ganze Haus: Umsätze, Finanzen, Bestand, Artikel, Kunden, Termine und Aufgaben, und antwortet mit echten Zahlen statt abzulehnen.
- Allgemeine Verbesserungen und Politur.

## [0.5.1] - 2026-07-15

- Vierzehn hört jetzt zuverlässig: das Mikrofon wird beim Start automatisch angefragt, danach wacht der Sprachassistent sofort auf und begrüßt Sie. Bei gesperrtem Mikrofon führt ein Knopf direkt zu den Systemeinstellungen.
- Vierzehn ganz neu gestaltet: eine bildschirmfüllende Darstellung mit drei umschaltbaren Ansichten (Reaktor, Partikel, Gewebe), jede in eigener Farbe.
- Verkauf: der Warenkorb bleibt kompakt, „Bezahlen" ist jetzt immer sichtbar, auch bei vielen Positionen. Kein Herunterscrollen mehr.
- Ruhigerer Dunkelmodus in kühlem Schiefer, ohne Gelbstich.
- Allgemeine Fehlerbehebungen und Politur der Bedienung.

## [0.5.0] - 2026-07-15

- Neuer Sprachassistent „Vierzehn": Sie sprechen einfach mit der Kasse. Er liest und berichtet, zum Beispiel den Stand des Tages, und begrüßt Sie beim Öffnen auf Deutsch.
- Dunkelmodus: die ganze App in einem warmen, augenschonenden Dunkel, umschaltbar über die Kopfzeile.
- Stabilere Verbindung: klare Meldungen bei Netzausfall, keine hängende Ansicht mehr, schnellere Fehlererkennung.
- Sichtbarere aktive Zustände und Schalter; ein Farbfehler in Verkauf und Einstellungen wurde behoben.
- Überarbeitetes Aktualisierungs-Center: grüner Hinweis bei neuer Version, mit einer Liste der Neuerungen.
- Allgemeine Fehlerbehebungen und Politur der Bedienung.

## [0.4.11] — 2026-06-10

- **World-class cashier & inventory redesign** (grounded in a 13-agent UX-research
  brief): the payment screen now shows the amount due as the dominant figure with
  one-tap exact-change & note chips and one-tap card; removing a cart line is
  instant with an Undo (no more confirm dialog); the number pad, Storno safety,
  inventory list and contrast/icons were all tightened for speed and calm. No
  change to any amount, tax, or receipt — money logic untouched, proven by tests.
- **Product photos reach the online shop**: a published product now shows its real
  photo on the website (with a multi-image gallery), and the cashier picks which
  photo is the main one. Products also get a clean web address automatically.

## [0.4.10] — 2026-06-08

- **DSFinV-K export** (Steuer-Export + Owner-Desktop): one-click download of the
  standardized cash-register data bundle a tax inspector asks for in a
  Kassen-Nachschau. (Core export — to be validated against the official
  DSFinV-K Prüftool and your tax advisor before a real audit.)
- **Verfahrensdokumentation**: the GoBD-required procedural documentation of the
  cash system is now written and included.
- **Cleaner German labels**: product type, condition, status, appointment and
  customer fields now show proper German text instead of internal codes.

## [0.4.9] — 2026-06-08

- **Security hardening** (from a final internal audit): the customer-display
  companion now carries its access token in a handshake header instead of the
  connection URL, so it can't be recovered from device logs/history.
- **Internal cleanup**: the money rounding/conversion helpers are now defined
  once and shared (previously copied across three screens), removing the risk of
  the cash, intake and appraisal screens ever rounding differently. No change to
  any amount — proven by tests.

## [0.4.8] — 2026-06-08

- **Split payment** (Kasse): pay part of a sale in cash and the rest on the
  card terminal — one receipt, one transaction. Appears as a "Betrag aufteilen"
  option in the Bezahlen dialog when a card terminal is configured.
- **Publish to eBay** (Lager): the "Bei eBay listen" button now drives a real
  eBay listing push when an eBay account is connected (shows a clear "token
  pending" note until then) — no fiscal data involved.
- **Reliability hardening** (server): fixed three latent permission/typing
  faults in the audit-ledger triggers that would have surfaced on the first
  real cash-up, card/TSE event, or viewing-appointment booking.

## [0.4.7] — 2026-06-08

- **Customer display updates live** (Kundenanzeige companion): the paired
  iPad/phone now mirrors the cashier's cart in real time over the shop Wi-Fi
  instead of refreshing once a second.
- **Second cashier can build a cart** (Zweitkasse companion): add items, adjust
  quantities and see the running total on a paired tablet; payment is handed
  back to the main till (the companion never writes a fiscal record on its own).
- **Cleaner, more accessible chrome**: clearer top-bar spacing and a more
  legible connection badge; clickable cards and the search overlay are now
  fully keyboard-operable.

## [0.4.6] — 2026-06-08

- **Cleaner screens across the app**: consistent spacing, stronger hierarchy
  (the cart/day total now dominates), and one obvious brass primary action per
  view — applied to Verkauf, Lager, Ankauf, Tageskasse, Kunden and Werkstatt.

## [0.4.5] — 2026-06-08

- **Visible primary buttons** (brass accent across every screen) + a real
  spacing scale in the design system.
- **In-app camera** enabled (camera usage description + entitlement) — capture
  product photos directly (works in the installed app; first use prompts for
  macOS camera permission).
- **TSE signatures are persisted server-side** (GoBD): each KassenSichV
  signature is durably stored, linked to its transaction (migration 0054).

## [0.4.4] — 2026-06-08

- **Verkauf catalog shows product photo cards** (image + name + price + metal),
  fed by a new primary-photo field on the products feed.
- **Product lifecycle**: a 'Fertig' finish button in the photo studio; delete a
  DRAFT product (guarded, owner + step-up); a single 'Bei eBay listen' action
  (honest stub) alongside the existing web-shop toggle.
- **Companion (iPad/phone)**: real role screens — Lager (label printer, add/edit
  product, inventory + clean barcode lookup), Zweitkasse, Kundenanzeige — with
  big-icon role selection after pairing.

## [0.4.3] — 2026-06-08

- **Product photos now display in the app.** The CSP `img-src` now allows the
  API media host, so server-stored product photos render as thumbnails in the
  product sheet (upload already worked in 0.4.2; this lets the webview show them).

## [0.4.2] — 2026-06-08

- **Product photos work again.** Upload now goes through the API
  (`POST /api/photos/upload`) instead of a direct browser→R2 PUT, removing the
  R2-CORS dependency that silently blocked every upload; fixed a webp/jpeg
  content-type mismatch; photos now render as thumbnails in the product sheet
  (CSP extended for the R2 media host).
- **iPad/iPhone pairing connects.** The companion hub now detects the real
  Wi-Fi LAN IP (ignoring VPN/Docker interfaces) for the pairing QR, and the
  subnet guard tolerates real LAN topologies instead of rejecting the device.

## [0.4.1] — 2026-06-07

Security hardening of the companion LAN subsystem (review-driven, before any
second-cashier payment ring-up):

- The companion proxy role allow-list is now positive + deny-by-default: a
  paired Second-Cashier tablet can only ring up (`transactions/finalize`) — it
  can no longer reach Ankauf (cash payout), Storno (void) or Return (refund).
- The proxy path is traversal-safe (percent-decoded + rejected on `..`/`//`),
  closing a deny-list bypass.
- Pairing code is single-use + 5-min TTL + CSPRNG + per-TCP-peer rate limit +
  global lockout; strict CSP + no innerHTML sink on the companion page;
  same-subnet peer guard + token TTL; request body/concurrency/timeout limits.

## [0.4.0] — 2026-06-07

Deep-overhaul release (test mode). Driven by a 54-finding multi-agent audit
(`docs/deep-audit-2026-06-07.md`).

### Fixed — the "no server connection" on Windows

- The cloud session cookie is `SameSite=None; Secure`, which Windows WebView2
  drops at the non-secure `http://tauri.localhost` origin — so the app opened
  but every request read as logged-out. Now the session token is also carried
  as `Authorization: Bearer` (immune to cookie policy), with an `access_token`
  query param for the SSE stream. Auth now survives on Windows.

### Fixed — money safety & honest connection state

- Ankauf double-pay on double-click (client mutex + idempotency key + server
  dedup); offline-queued buy-ins/cards no longer read as "failure"; ZVT
  finalize-retry no longer re-authorizes (no double charge); cart-line removal
  rolls back on release failure (no zombie reservation); offline fiscal
  mutations are correctly GoBD-tagged.
- A down server now shows "Keine Verbindung zum Server" + retry instead of an
  empty catalog / the PIN pad; the status badge reflects real reachability.

### Added — high-value sale & companion devices

- §10 GwG: a VERKAUF ≥ €2.000 is now completable — a buyer picker with
  Ausweisprüfung (search / create / KYC-verify) attaches a verified buyer.
- **Companion LAN hub** (`docs/companion-architecture.md`): the mother POS
  embeds a local server so an iPad/phone on the shop Wi-Fi pairs via QR
  (Settings → "Geräte koppeln"), picks a role (Lager / Zweitkasse /
  Kundenanzeige), and rides the mother's session through a role-scoped proxy.
  The Customer-Display shows the mother's live cart. (Second-cashier ring-up +
  realtime WebSocket are the next phase.)

### Changed

- German UI polish (no English enums on the floor); enforced server rate
  limits; mTLS-bypass boot guard; ±50% metal-price plausibility band; 11
  secondary surfaces lazy-loaded off the first-paint path.

## [0.3.0] — 2026-06-07

Go-live release candidate (shop test build, **test mode** — mTLS/secret
rotation deferred to go-live). Consolidates the full UX redesign +
fiscal/compliance stack accumulated since v0.2.2.

### Compliance (binding — Roman Grützner sign-off)

- **GwG direction-aware KYC enforcement** (migration 0050). ANKAUF requires
  a KYC-verified seller for every buy from €0,01 (§259 StGB); VERKAUF
  requires identification at/above €2.000 (§10 GwG). Enforced by an
  un-bypassable SECURITY DEFINER trigger; the cashier sees a friendly 403,
  not a raw error. Stornos are never re-blocked.
- **AML smurfing-aggregation framework** + **TSE/KassenSichV compliance
  tables** (migrations 0049 and the AML set) — alert-only thresholds are
  placeholders pending the Steuerberater's confirmation.
- **Sample fiscal exports** (`docs/samples/`): real DATEV EXTF
  Buchungsstapel + Kassenbericht for the accountant's review. Open question
  surfaced: all VERKAUF currently post to revenue account `8400` regardless
  of `tax_treatment_code` (see the marked TODO).

### POS & Owner Desktop

- Full UX pass: shared Dialog/Sheet + form primitives, number-key
  navigation, cashier keypad/discount/barcode/confirm flows, plain-language
  Kasse, in-place product sheet, per-metal margin editor, metal ticker,
  Ankauf estimator, Steuer-Export surface, and the Control Desktop polish.

## [0.2.2] — 2026-06-05

Kasse usability pass for Roman's daily flow (reviewed + integrated
consolidation of the four `claude/kasse-*` + `test-gate` branches).

### Kasse

- **Ankauf — KYC surfaced early.** The GwG §10 identification gate
  (≥ €2.000) is shown up front via the pure, tested `evaluateKycGate`;
  enforcement is behaviour-identical (not weakened). Faster item entry:
  expanded form with sticky metal/tax and clearer price-direction labels.
- **Verkauf — clearer discounts + faster turnaround.** Live
  discount-reason feedback with touch-sized controls (pure, tested
  `isDiscountReasonValid`); the catalog search auto-refocuses the moment
  a sale finalizes so the next scan/keystroke lands without a click.
- **Lager — scan-to-adjust + clearer notes.** A barcode scan auto-opens
  the inventory-adjustment dialog; the adjustment note shows a live
  minimum-length hint before submit.

### Hardware (software-complete, awaiting the device day)

- **ZVT card path** hardened to a spec-accurate BMP parser
  (ecrterm-grounded) driving the full multi-message authorisation
  conversation; mocks promoted from facade to validating. Proven by the
  in-repo HIL suite (`cargo test`). Real-terminal field-location +
  status-cadence confirmation remain quarantined for the go-live day.

### Backend (ships separately)

Database migrations **0045–0048** (blind-index HMAC, cumulative SELECT
grant, `DEBT` payment method, ledger hash-chain serialization) deploy via
the migrate service per `docs/runbooks/0045-0048-prod-apply.md` — **not**
bundled in this desktop binary.

## [0.1.0] — 2026-05-27

First public release of the desktop POS bundle.

### Highlights

- **Tier-1 POS Core (Phase 1.0–1.9).** PIN-login + Verkauf cart + Kasse
  shift management + Ankauf intake + Bewertung appraisal + Lager
  inventory + Kunden CRM + Werkstatt dashboard with live ledger SSE.
- **Hardware bridge (Phase 2 Day 8, memory.md §18).** Native Rust
  commands for: TSE (Fiskaly Cloud), ZVT 1.10 card terminals over TCP,
  ESC/POS thermal printers, A4 invoice PDF via `printpdf`, image
  compression to WebP, OS print queue probe. Every command has a mock
  alternative gated by `WAREHOUSE14_MOCK_HARDWARE=1`.
- **Web-Zentrale UI (Day 14, memory.md §23).** Operator can publish
  products to the storefront, assign categories, edit SEO metadata,
  and trigger AI-generated SEO descriptions via MCP — all from the
  Lager detail dialog.
- **Brutal-audit fixes (memory.md §19).** Four critical findings closed:
  inventory-lock now matches `(sessionId, userId)`; per-operator
  `localStorage` keys are wiped on sign-out; `bewertung` + `ankauf`
  stores reset on sign-out; finalize requires a client-supplied
  `idempotencyKey` (UUIDv4) backed by a partial UNIQUE index.
- **Storefront catalog API (Phase 2.A, memory.md §20).** Public
  read-only endpoints under `/api/storefront/*` with strict column
  projection — `acquisition_cost_eur` and PII cannot leak. Heavy
  edge caching.
- **MCP server (Phase 2.A, memory.md §20.5).** JSON-RPC 2.0 endpoint
  at `POST /api/mcp` exposing two tools: `generate_seo_description`
  (writes) and `appraise_estate_item` (read-only). Every invocation
  audited to `mcp_tool_invocations`.
- **Auto-update from GitHub Releases (Day-15, memory.md §25).**
  Tauri-plugin-updater wired with minisign signature verification.
  In-app banner polls hourly + on launch; operator clicks
  "Aktualisieren" → download + verify + relaunch.

### Database migrations

This release applies migrations 0001 → 0030. Production deployment
requires applying the three migrations that landed in this cycle:

```
0028_transactions_idempotency.sql
0029_storefront_publishing.sql
0030_mcp_tool_invocations.sql
```

### Known limitations

- No Apple Developer ID + no Microsoft Authenticode signing. Gatekeeper
  on macOS shows a one-time warning (strip with
  `sudo xattr -dr com.apple.quarantine "/Applications/Warehouse14 POS.app"`);
  Windows SmartScreen shows a "More info → Run anyway" gate on first
  install. **Auto-updates work regardless** — Tauri verifies its own
  minisign signature independently of OS code-signing.
- The bundled AI tools ship as deterministic stubs. A real
  `@anthropic-ai/sdk` call replaces the `runLlm()` body in a single
  follow-up patch.
- The PDF invoice prints the textual TSE block; QR raster embed lands
  once `printpdf`'s image API stabilises.

[Unreleased]: https://github.com/__GITHUB_OWNER__/__GITHUB_REPO__/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/__GITHUB_OWNER__/__GITHUB_REPO__/compare/v0.1.0...v0.2.2
[0.1.0]: https://github.com/__GITHUB_OWNER__/__GITHUB_REPO__/releases/tag/v0.1.0
