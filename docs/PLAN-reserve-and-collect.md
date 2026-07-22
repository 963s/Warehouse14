# Reservieren und Abholen — der vollständige Bauplan

Stand 2026-07-23. Grundlage: drei unabhängige Prüfungen (Kundenshop, Server,
Personal-Apps), die alle auf dieselbe Ursache stießen.

## Die Ursache in einem Satz

Eine Web-Reservierung nimmt den Halt mit `userId: null`
(`apps/api-cloud/src/routes/storefront-reserve.ts:299`), und sowohl `finalize()`
als auch `release()` verlangen `reserved_by_user_id IS NOT DISTINCT FROM
${userId}` (`packages/inventory-lock/src/finalize.ts:43`, `release.ts:45`).
`NULL` gegen eine UUID ist nie „not distinct", also null Zeilen, also 409.

Daraus folgt alles Weitere: `CONVERTED` ist unerreichbar, `collected` ist für
jeden Kunden dauerhaft 0, jede Reservierung verfällt nach drei Tagen auf
`ABANDONED`, und die Vertrauensstufe zählt genau das als Nichtabholung.

---

## Phase 0 — den laufenden Schaden stoppen

Kein Kunde darf für eine Funktion bestraft werden, die es nicht gibt.

- **0.1** `lib/storefront-reservation-policy.ts`: die Nichtabholungs-Zählung
  aussetzen, solange keine Abholung buchbar ist. Nicht löschen, sondern hinter
  einen ausdrücklichen Schalter legen, der in Phase 2 wieder fällt.
- **0.2** Die bereits angerechneten Verfälle der fünf laufenden Kunden bereinigen.
- **0.3** Beweis: Abfrage vor und nach der Bereinigung, Zahlen im Commit.

## Phase 1 — der Server, das Fundament

### 1.1 Migration 0099

- `cart_status` bekommt die fehlenden Stände: `ANGENOMMEN`, `IN_VORBEREITUNG`,
  `ABHOLBEREIT`. Reihenfolge und Übergänge werden per CHECK festgenagelt.
- Die CHECK aus 0098 (`fulfilment_method = 'PICKUP'` erzwingt
  `fulfilment_status = 'NOT_REQUIRED'`) wird ersetzt, sonst ist „abholbereit"
  nicht darstellbar.
- `carts` bekommt `collected_at`, `collected_by_user_id`, `ready_at`,
  `approved_at`, `approved_by_user_id`.
- `erase_customer` wird um `carts` erweitert (`shipping_address_encrypted`,
  Kontaktfelder). **Dies ist die Wiederholung der 0094- und 0096-Lücke und der
  Grund, warum jede neue PII-Spalte künftig einen Test braucht.**
- Ein Test, der jede Tabelle mit einer `_encrypted`-Spalte gegen den Rumpf von
  `erase_customer` prüft und bricht, wenn eine fehlt.

### 1.2 Den Halt für das Personal öffnen

Der Web-Halt bleibt `reserved_by_user_id = NULL` (er gehört keinem Kassierer),
aber `finalize()` und `release()` bekommen einen ausdrücklichen Weg für den
Kanal `WEB_RESERVATION`: wer die Rolle CASHIER oder ADMIN hat und die
Bestellnummer nennt, darf übernehmen. Kein Aufweichen des Schutzes für
POS-Halte, sondern ein zweiter, benannter Pfad.

### 1.3 Die vier Übergänge als Routen

`POST /api/orders/:orderNumber/approve`, `/prepare`, `/ready`, `/handover`.
ADMIN und CASHIER. Jede schreibt einen Tagebuch-Eintrag. `/handover` erzeugt
die Kassentransaktion, verknüpft sie über `converted_to_transaction_id` und
setzt das Stück auf `SOLD`.

### 1.4 Die Warteschlange

`GET /api/orders?status=…` — die Liste, die es heute nicht gibt. Mit Name,
Kontakt, Positionen, Bestellnummer, Frist.

### 1.5 Briefe

`composeOrderReady` (das Wichtigste: „Ihr Stück liegt bereit"), und eine
Erinnerung vor Fristablauf. Der Versand darf nicht mehr stillschweigend
verschluckt werden: schlägt er fehl, muss der Beleg es zeigen.

### 1.6 Löschung nachweisbar machen

Ein `audit_log`-Eintrag auch beim kundeninitiierten Löschen, und ein
`includeDeleted`-Schalter, damit der Nachweis auffindbar bleibt.

## Phase 2 — die drei Oberflächen, parallel

### Kasse (`apps/tauri-pos`)
Bestellungs-Warteschlange, die vier Knöpfe, der Verkauf eines Web-Halts, die
zwei Lügen in `CustomerHistoryPanels` (roher Zustand `CONVERTED`, gescheiterter
Lesevorgang als „nichts bestellt"), und `web_order.*` in die deutsche
Wortliste.

### Inhaber-App (`apps/mobile`)
Eine echte Bestellungen-Fläche, `web_order` in die Benachrichtigungen, das
deutsche Komma im Preisfeld, und die verschluckte Prüfmeldung.

### Kundenshop (`storefront-mobile`)
Der erfundene Nullbetrag auf der Bestätigung, Adresse und Öffnungszeiten und
das Datum, der tote Statusbalken, die falschen Meldungen bei Löschung und
Datenexport, der weggeworfene Export, die lokalen Zwischenspeicher.

## Phase 3 — Nachweis

Ein echter Durchlauf auf der Produktion: reservieren, annehmen, vorbereiten,
abholbereit melden, übergeben, und am Ende steht das Stück auf SOLD, der Beleg
existiert, und der Kunde hat zwei Briefe bekommen. Erst danach wird gebaut.
