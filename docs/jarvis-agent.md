# Vierzehn als ausführender Agent — Studie + Architektur (2026-07-19)

Basels Auftrag: Jarvis/Vierzehn soll mehr sein als ein Sprachassistent — ein
ECHTER ausführender Agent rund um die Ware (anlegen, suchen, ändern, löschen,
Formulare füllen), mit höheren Rechten aber harten Grenzen (niemals Code,
niemals System), und er muss DAS Kernproblem lösen: das volle Lager schnell
erfassen, mit Fotos direkt vom Telefon des Inhabers.

## Was der Bestand hergab (Studie)

1. **Die Werkzeug-Architektur ist backend-first.** Alle Vierzehn-Werkzeuge
   leben in `apps/api-cloud/src/mcp/tools/` und werden über EIN Flag
   (`assistantExposed`) sowohl dem Sprachmodell angeboten (Mint-Route) als auch
   zur Ausführung zugelassen (`/api/mcp/assistant`, JSON-RPC). Jeder Aufruf
   wird auditiert. Ein neues Werkzeug = eine Datei + ein Registry-Eintrag —
   NULL Frontend-Änderung.
2. **Das Schreib-Muster existierte schon** (`create_product`): DRAFT-only,
   Namens-Idempotenz, Audit mit `source:assistant`, gesprochene Bestätigung als
   Persona-Pflicht. Lese-Werkzeuge für Suche/Detail/Liste existierten ebenfalls.
3. **Der Fotoeingang existierte strukturell:** `product_photos.product_id` ist
   NULLABLE — verwaiste Fotos sind ein erlaubter Zustand, und
   `GET /api/photos/unassigned` listet sie. Kein neues Schema nötig.
4. Fotos liegen als doppelte WebP-Renditionen auf der lokalen Platte des
   Servers (Volume `photosdata`), Upload base64 über `/api/photos/upload`,
   Handy komprimiert vorab auf ≤1600px JPEG.

## Was gebaut wurde

### Exekutiv-Gürtel (vier neue Werkzeuge, api-cloud)

| Werkzeug | Art | Grenzen |
|---|---|---|
| `update_product` | Schreiben | Nur Name, Preis, Beschreibung, Zustand, Gewicht. Nur DRAFT + AVAILABLE. Intake-gesperrte Felder (EK, Steuer, SKU) und Status/Kanal-Schalter strukturell UNERREICHBAR. Voller Vorher/Nachher-Diff im Audit und in der Antwort. |
| `delete_product` | Schreiben | NUR Entwürfe (strenger als die HTTP-Route, weil Step-up im MCP-Kontext nicht existiert). Angehängte Fotos wandern zurück in den Eingang statt zerstört zu werden. |
| `list_inbox_photos` | Lesen | Der Fotoeingang: unzugeordnete lokale Fotos, neueste zuerst. Malt die Vorschau-Leiste im Overlay. |
| `attach_photos` | Schreiben | Bindet Eingangs-Fotos an einen Artikel (`latest: N` für die Stimme, exakte IDs fürs Werkzeug-Ketten). Erstes Foto wird Hauptfoto, wenn keines existiert. Archiviert/verkauft wird verweigert. |

Dazu: `create_product` kann jetzt `attachInboxPhotos: N` — Diktat + Fotos in
einem Atemzug. Gemeinsame Primitive in `_product-lookup.ts` (gesprochene
Referenz: SKU, exakter Name, UUID; Mehrdeutigkeit wird ehrlich benannt).

### Sicherheitsmodell (تنفيذي آمن)

- **Werkzeugliste ist die Grenze:** kein Shell, kein Code, keine Settings,
  keine Fiskal-/Geldpfade. Die Persona-Sicherheitsregel bleibt unumstößlich,
  der sichere Ausweg bleibt `open_dev_ticket`.
- **Bestätigungs-Ritual für JEDE Schreibaktion:** laut wiederholen, auf ein
  gesprochenes „Ja" warten, danach das Ergebnis (mit Diff) zurücklesen.
- **Server-seitig unumgehbar:** Rollen (`ADMIN`), `assistantExposed`-Schranke
  an Advertise- UND Execute-Stelle, Audit-Zeile in derselben Transaktion wie
  jede Änderung (`source:'assistant', via:'jarvis'`).
- **Strukturelle Schranken schlagen Anweisungen:** was das Schema nicht
  enthält (EK-Preis, Status-Sprünge, Löschen von Nicht-Entwürfen), kann kein
  Prompt der Welt erzwingen.

### Foto-Brücke (die Kernmission: volles Lager erfassen)

Telefon: neue Fläche **„Fotoeingang"** (`apps/mobile/src/app/fotoeingang.tsx`,
Mehr-Hub, Betrieb): Kamera oder Galerie-Mehrfachauswahl → on-device
JPEG-Kompression → Upload OHNE Produkt → Warteliste zeigt die SERVER-Wahrheit
(dieselbe Liste, die Vierzehn sieht), mit Sende-Queue, ehrlichen Fehlerzeilen
und erneut-senden.

Kasse: Vierzehn sieht den Eingang (`list_inbox_photos`, Thumbnail-Karte im
Overlay) und bindet beim Anlegen (`create_product` +
`attachInboxPhotos`) oder nachträglich (`attach_photos`).

**Der Ablauf am Regal:** fotografieren → senden → „Vierzehn, leg ein Produkt
an: Goldring 585, 4 Gramm, Preis 289, mit den drei neuen Fotos" → Vierzehn
wiederholt, wartet auf „Ja", legt den Entwurf mit Fotos an, das erste wird
Hauptfoto. Kein Tastendruck.

## Bewusst NICHT in dieser Stufe

- **Veröffentlichen (DRAFT→AVAILABLE) per Stimme** — bleibt eine bewusste
  Lager-Entscheidung des Inhabers am Bildschirm.
- **Verkauf, Ankauf, Storno, Preise verkaufter Ware** — Geldpfade bleiben
  menschlich + Step-up-geschützt.
- **DeepSeek-Executor** — Env-Schlüssel sind reserviert (`env.ts`); ein
  zweites, günstigeres Ausführungs-Hirn hinter derselben MCP-Schranke ist der
  nächste Ausbauschritt, wenn die Werkzeuglast wächst.
- **Vision-Vorschläge** (Fotos → automatischer Titel/Kategorie-Vorschlag):
  attraktiver Folgeschritt, sobald die Brücke im Alltag sitzt.
