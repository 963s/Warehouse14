# Bestellungen als echter Arbeitsplatz — der Bauplan

Stand 2026-07-23. Grundlage: Basels Befund, und er ist der richtige.

> „ماني فاهم كيف اعرف وين عندي طلبات وكيف استلمها واجهزها مافي شي واضح"

Er hat recht. Der Abholablauf EXISTIERT seit heute im Server und in beiden
Personal-Apps, aber er ist versteckt: die Inhaber-App erreicht ihn nur über
den Mehr-Hub, es gibt keine Benachrichtigung, wenn eine Bestellung eintrifft,
und es gibt keine Möglichkeit, eine Bestellung ABZULEHNEN. Wer nicht zufällig
nachsieht, erfährt nie, dass jemand etwas reserviert hat.

## Was heute fehlt, gemessen und nicht vermutet

| Fehlt | Beleg |
|---|---|
| Echte Benachrichtigungen | keine Push-Abhängigkeit in irgendeiner `package.json`, keine Tabelle für Gerätemarken, kein Versender |
| Ablehnen einer Bestellung | kein `reject` in `routes/orders.ts` |
| Storno-Gründe auf `carts` | keine Spalte mit `cancel`, `reject` oder `reason` |
| Wer die Löschung veranlasst hat | `customers` trägt nur `soft_deleted_at` und `anonymized_at`, nicht WER |
| Bestellungen in der unteren Leiste | die Leiste trägt Start, Schatzkammer, Kunden, Scannen, Mehr |
| Brief bei der Annahme | es gibt Bestätigung, Abholbereit und Storno, aber nichts bei „angenommen" |

## Der Grundsatz für Briefe und Benachrichtigungen

Basels Regel, und sie ist die richtige: **die App klopft, die Post nicht.**

- **Benachrichtigung auf dem Gerät** bei allem, was das Personal sofort wissen
  muss. Sie kostet den Kunden nichts.
- **Brief an die Kundschaft nur bei den vier Wendepunkten**: reserviert,
  angenommen, abholbereit, abgelehnt oder storniert. Beim internen Schritt
  „in Vorbereitung" bleibt es still, denn für den Kunden ändert sich nichts.
- Der Kunde sieht den Fortschritt jederzeit **im Shop**, nicht im Postfach.

## Phase 1 — Server

**1.1 Migration 0103.** `carts` bekommt `cancelled_at`, `cancelled_by_user_id`,
`cancellation_reason` und `cancelled_by_role`. Ablehnen ist kein neuer
Abholstand, sondern ein Storno mit Grund: das Stück geht zurück ins Regal, der
Beleg wird `CANCELLED`, und der Kundenshop kennt diesen Zustand bereits.
`customers` bekommt `erasure_initiated_by`, damit ein selbst gelöschtes Konto
sichtbar von einem durch uns gelöschten unterscheidbar ist. Beide mit ihren
Vergaben, nach dem Fehler von heute Morgen.

**1.2 Gerätemarken und Push-Ausgang.** Tabelle `device_push_tokens` (Person,
Marke, Plattform, App, zuletzt gesehen, widerrufen) und `push_outbox` nach dem
bewährten Muster von `email_outbox`: eingereiht, sichtbar, mit Versuchszähler
und ehrlichem Fehler. Ein Versender im worker gegen den Expo-Dienst. Ohne
Marken wird NICHT geraten, sondern `skipped` gemeldet.

**1.3 Routen.** `POST /api/devices/push-token` und `DELETE`. In `orders.ts`
ein `POST /:orderNumber/reject` mit Grund, das die Halte freigibt, den Beleg
storniert, den Brief schreibt und einen Tagebucheintrag setzt.

**1.4 Briefe.** `composeOrderAccepted` in allen dreizehn Sprachen, und der
Storno-Brief bekommt den Grund, wenn einer genannt wurde.

**1.5 Bei jeder neuen Reservierung** eine Benachrichtigung an jedes Gerät mit
Rolle ADMIN oder CASHIER.

## Phase 2 — Inhaber-App

Ein eigener Platz in der unteren Leiste mit eigenem Zeichen und einer Zahl,
die zeigt, wie viele Bestellungen warten. Darin: die Warteschlange, annehmen,
ablehnen mit Grund, vorbereiten, abholbereit, stornieren, und die Einzelheiten
an einer Stelle. Dazu die Anmeldung des Geräts für Benachrichtigungen und der
Sprung von der Benachrichtigung direkt in die Bestellung.

## Phase 3 — Kundenshop

Der Fortschritt als Weg mit fünf Stationen: reserviert, angenommen, in
Vorbereitung, abholbereit, abgeholt. Eine abgelehnte Bestellung sagt es
deutlich und nennt den Grund, wenn einer genannt wurde.

## Phase 4 — Kasse

Ablehnen und Stornieren wie in der Inhaber-App, damit beide Seiten dieselbe
Wahrheit zeigen.

## Phase 5 — Gelöschte Konten sichtbar machen

In der Kundenliste und in der Akte: der Name durchgestrichen, die Kundennummer
und alle Vorgänge bleiben, und eine Notiz sagt, dass der Kunde sein Konto
SELBST gelöscht hat, mit Datum. Von uns gelöschte Konten tragen die andere
Notiz. Beides aus `erasure_initiated_by`, nicht geraten.

## Phase 6 — Versandmarke

Ein druckbarer Aufkleber mit Anschrift, Bestellnummer und deren Strichcode.
**Keine Sendungsnummer eines Zustellers, solange kein Zusteller angebunden
ist.** Eine erfundene Nummer ist genau der Fehler, den dieses Haus schon
zweimal gemacht hat.
