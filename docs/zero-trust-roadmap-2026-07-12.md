<!--
  Zero-Trust-Sicherheitsbewertung + Fahrplan. Erstellt 2026-07-12 aus einem
  belegbasierten Audit der bestehenden Architektur (Code + read-only Produktion).
  Reine Bewertung + Plan. KEINE Live-Änderung an Auth/Netz ohne Basels Deploy-Tor.
-->

# Zero-Trust-Bewertung und Fahrplan (warehouse14)

Stand 2026-07-12. Grundlage: belegbasiertes Audit des Codes plus read-only Prüfung der Produktion (`ssh myserver`). Gemessen an **NIST SP 800-207** (die sieben Grundsätze), **OWASP ASVS 4.0 Level 2**, **BSI IT-Grundschutz** und **DSGVO Art. 25/32** (Datenschutz durch Technik). Dies ist ein Reifegrad-Plan, keine Live-Umstellung: Änderungen an Auth und Netz auf einem laufenden Fiskalgerät gehen über Basels Deploy-Tor.

---

## 1. Gesamturteil

Das Fundament ist bereits stark und in vielen Zonen auf oder über internationalem Standard. Der Kern der Zero-Trust-Idee ist im System schon materiell umgesetzt: kein impliziter Vertrauensraum in der Datenbank (PII verschlüsselt mit einem Schlüssel, der nicht in der DB liegt), least-privilege-Datenbankrollen, die beim Boot erzwungen werden, ein manipulationssicherer Buchungs-Hash-Chain, den die App nicht ändern kann, und Stripe, das nie Kartendaten berührt.

Die offenen Punkte sind bekannt, im Code als „Phase 1.5" markiert und lassen sich in drei Klassen ordnen: erstens die **Geräte-Vertrauensschicht** (die mTLS-Bindung ist noch nicht scharfgeschaltet), zweitens die **Schlüssel- und Geheimnisverwaltung** (statischer Schlüssel aus der Umgebung statt KMS), drittens einige **Härtungsdetails** (Session-Token im Klartext gespeichert, CSP aus, In-Memory-Ratenlimit). Keiner dieser Punkte ist ein Widerspruch zur Fähigkeit des Systems, alle sind eine bewusste Reihenfolge-Entscheidung, die jetzt geordnet nachgeholt wird.

**Zur Idee des Fragestellers** (App an ein Verbindungs-Token binden, Nutzer nach der Registrierung an ein Token knüpfen, Rohdaten nicht anfassen sondern als Token ablegen): das System macht bereits das Stärkere. Siehe Abschnitt 5.

---

## 2. Was schon dem Standard entspricht (NIST 800-207 Grundsätze)

| NIST-Grundsatz | Umsetzung im System | Beleg |
|---|---|---|
| 1. Alle Datenquellen als Ressourcen behandeln | jede Route hinter `requireAuth`/`requireRole`; kein offener Lesepfad | `lib/auth-policy.ts:84,94` |
| 2. Kommunikation gesichert unabhängig vom Netz | TLS am Rand (Cloudflare Tunnel), interner Docker-Bridge nicht host-exponiert | `docker-compose.prod.yml:35,91,120` |
| 3. Zugriff pro Sitzung, kleinstmöglich | opakes, widerrufbares Sitzungstoken mit TTL; Step-up-Fenster 10 min | `auth-pin.ts:325`, `auth-policy.ts:122` |
| 4. Zugriff über dynamische Richtlinie | Rolle + `isOwner` + Step-up + Gerätestatus als kombinierte Bedingung | `plugins/mtls.ts:71`, `auth-policy.ts:144` |
| 5. Integrität aller Assets überwachen | `ledger_events`-Hash-Chain via `SECURITY DEFINER`-Trigger, von der App nicht änderbar; TSE-Signaturen | `0008_audit_chain.sql:92,145` |
| 6. Authentifizierung + Autorisierung streng vor Zugriff | argon2id-PIN (OWASP-2024-Parameter), Duress-PIN, konstant-zeitige Doppelprüfung | `packages/auth-pin/src/index.ts:126,139` |
| 7. So viel Information wie möglich sammeln | `audit_log` (append-only) + Buchungs-Chain + Alarme (`alert.*`, Duress) | `0008:283`, `lib/duress.ts` |

Weitere belegte Stärken, die über die Basis hinausgehen:

- **PII-Schlüssel-Trennung.** Kundendaten sind mit `pgp_sym_encrypt` (AES-256) verschlüsselt; der Schlüssel liegt **nicht** in der Datenbank, sondern wird pro Transaktion mit `set_config('warehouse14.pii_key', …, true)` gebunden und beim COMMIT gelöscht, kein Pool-Rest. Ein reiner DB-Dump ohne den Umgebungsschlüssel ist nutzlos. (`lib/pii.ts:98`)
- **Blind-Index** (HMAC-SHA256) erlaubt Exakt-Suche über E-Mail/Telefon **ohne** Entschlüsselung. (`0007:123`)
- **KYC-Bilder** mit AES-256-GCM, frischem 12-Byte-IV je Verschlüsselung, eigenem Schlüssel. (`kyc-store.ts:112`)
- **Least-privilege-DB-Rollen, beim Boot erzwungen:** die App verbindet ausschließlich als `warehouse14_app` (nur SELECT/INSERT + enge Spalten-UPDATE, **nie DELETE**); der Trigger-Eigentümer `warehouse14_security` ist NOLOGIN. Der Boot bricht ab, wenn die `DATABASE_URL` nicht diese Rolle nennt. (`config/env.ts:487`, `0003_roles.sql:84`)
- **Stripe berührt nie Kartendaten** (nur PaymentIntents); Webhook-Prüfung per HMAC-SHA256 mit `crypto.timingSafeEqual` und Replay-Fenster. (`lib/stripe-signature.ts:24`)
- **`AUTH_SECRET` ohne Default, Boot bricht sonst ab** (schließt das better-auth-Standardgeheimnis-Loch). (`config/env.ts:53`)

---

## 3. Reifegrad je Säule

| Säule | Reifegrad | Kurzbegründung |
|---|---|---|
| Identität (Nutzer) | **hoch** | argon2id, Duress, Step-up, mandatorisches Auth-Secret |
| Gerät | **niedrig** | mTLS-Bindung vorhanden aber per Bypass umgangen (Abschnitt 4, P0) |
| Netz / Segmentierung | **mittel** | TLS am Rand + isoliertes Bridge-Netz; interner Hop + DB unverschlüsselt |
| Anwendung / Autorisierung | **mittel-hoch** | in-Handler-Rollen + least-privilege-DB; keine RLS |
| Daten (Ruhe) | **hoch** | PII + KYC verschlüsselt, Schlüssel getrennt; ein statischer Schlüssel |
| Sichtbarkeit / Audit | **hoch** | manipulationssichere Chain + append-only-Log + TSE |
| Automatisierung / Geheimnisse | **niedrig-mittel** | validierte Env; aber Klartext-Geheimnisse auf dem Host, kein Vault |

---

## 4. Priorisierter Fahrplan

Jeder Punkt trägt: den Standard, den er erfüllt, die **Sprengweite** (Risiko der Umstellung) und ob er **Basels Deploy-Tor** braucht. „Branch-only" heißt: kann jetzt sicher gebaut und getestet werden, wirkt erst beim Deploy.

### P0 — vor jedem Skalieren oder weiterer Öffnung

**P0-1. Geräte-Vertrauensschicht scharfschalten (echtes mTLS).**
Heute ist `TEST_DEVICE_FINGERPRINT` in der Produktion gesetzt und per `ALLOW_TEST_DEVICE_FINGERPRINT_IN_PROD=true` bewusst quittiert, weil Cloudflare-Access-mTLS noch nicht bereitgestellt ist. Damit fällt jede unzertifizierte Anfrage auf ein einziges geseedetes Gerät zurück, die Geräteschicht ist praktisch aus. (`plugins/mtls.ts:51`, `config/env.ts:521`)
- **Aktion:** Cloudflare Access mTLS bereitstellen, je Gerät ein Client-Zertifikat ausstellen, `devices.cert_serial` befüllen, dann den Bypass entfernen. Zusätzlich `Cf-Access-Jwt-Assertion` serverseitig verifizieren (heute empfangen, nicht geprüft, `mtls.ts:8`).
- **Standard:** NIST 800-207 Grundsatz 4 (Gerät als Zugriffsbedingung), BSI APP.4.
- **Sprengweite: hoch.** Falsche Reihenfolge sperrt den Live-iMac im Salon aus. Deshalb: erst Zertifikate ausstellen und verifizieren, dann Bypass entfernen. **Nur mit Basel, Deploy-Tor.** Ich fasse das live nicht an.

**P0-2. Cloudflare-Tunnel-Token nicht als Kommandozeilen-Argument.**
Das Tunnel-Token steht im `run`-Argument der `cloudflared`-Container und ist über `docker inspect`/`ps` lesbar.
- **Aktion:** Token als gemountete Credentials-Datei übergeben statt inline.
- **Standard:** OWASP ASVS 6.4 (Geheimnis-Handhabung), BSI SYS.1.6.
- **Sprengweite: niedrig.** Compose-Änderung + ein Container-Neustart. Deploy-Tor.

### P1 — bald, hoher Wert bei überschaubarem Risiko

**P1-1. Session-Token nur als Hash speichern (nicht Klartext).**
Der Operator-Session-Token wird im Klartext in `sessions.token` abgelegt und per `WHERE token = …` gesucht. Ein DB-Leck ergibt lebende Sitzungen. (`plugins/auth.ts:160`)
- **Aktion:** nur `sha256(token)` speichern, beim Login den Klartext einmal ausgeben, bei jeder Anfrage den eingehenden Token hashen und danach suchen. Sorgfalt: better-auth-Sitzungen teilen ggf. dieselbe Tabelle, also Umstellung getrennt und getestet; bestehende Sitzungen werden beim Deploy einmalig ungültig (alle melden sich neu an).
- **Standard:** OWASP ASVS 3.5.2, 2.10.4.
- **Sprengweite: mittel.** Branch-only baubar, ein Integrationstest deckt Login-plus-Zugriff ab. Deploy-Tor.

**P1-2. Desktop-Session-Token in den OS-Schlüsselbund.**
Heute in `localStorage` (der Datei-Header markiert das selbst als go-live-TODO). Ein XSS könnte es lesen. (`lib/session-token.ts:17`)
- **Aktion:** Tauri-Keychain/Stronghold nutzen (wie der Fiskaly-Schlüssel). Native Fähigkeit, braucht einen Desktop-Build.
- **Standard:** OWASP ASVS 2.7, MASVS-STORAGE.
- **Sprengweite: niedrig-mittel.** Build-Phase, also Basels Build-Tor.

**P1-3. Content-Security-Policy für die öffentlichen Flächen (Storefront + Site).**
CSP ist am Ursprung global aus (wegen Swagger-Inline-Skripten). Für das öffentliche `norns-site`/Storefront ist das die wichtigste fehlende Abwehr gegen XSS. (`plugins/security-headers.ts:44`)
- **Aktion:** eine strikte CSP je öffentlicher Fläche (nonce-basiert), Swagger auf eine eigene, gelockerte Route beschränken. Die `/api`-JSON-Antworten führen keine Skripte aus, dort ist die Priorität niedriger.
- **Standard:** OWASP ASVS 14.4, BSI APP.3.1.
- **Sprengweite: mittel** (CSP kann legitime Ressourcen brechen, braucht Report-Only-Vorlauf). Branch-only entwickelbar. Deploy-Tor.

**P1-4. Ratenlimit auf gemeinsamen, dauerhaften Speicher (Redis).**
Heute in-memory, setzt beim Neustart zurück, nicht instanzübergreifend. (`plugins/rate-limit.ts:18`)
- **Aktion:** Redis-Backend (der Prod-Stack hat bereits Redis). Branch-only.
- **Standard:** OWASP ASVS 11.1, NIST 800-207 (dynamische Richtlinie).

### P2 — später, Tiefe der Zero-Trust-Härtung

**P2-1. Schlüssel aus einem KMS/Vault statt statischer Umgebung.**
Der PII-Schlüssel ist ein einzelner statischer Wert aus `WAREHOUSE14_PII_KEY` (min. 16 Zeichen), pro-Shop/KMS-Ableitung ist unumgesetzt. Auf demselben Host wie die DB heißt das: Host-Kompromiss ergibt Schlüssel plus Daten. (`request-context.ts:35`)
- **Aktion:** KMS-verwalteter Root-Schlüssel, pro-Shop-abgeleitete Datenschlüssel (envelope encryption), Rotation. Das ist der eigentliche Zero-Trust-Sprung für die Datenschicht.
- **Standard:** DSGVO Art. 32, BSI CON.1, NIST 800-57.

**P2-2. Postgres-Verbindung verschlüsseln (`sslmode`).**
Interner Hop und DB-Verkehr sind unverschlüsselt, nur durch die Netz-Isolation geschützt. Bei mehreren Knoten oder einem geteilten Netz relevant. (`docker-compose.prod.yml:76`)
- **Standard:** NIST 800-207 Grundsatz 2, BSI SYS.1.3.

**P2-3. Row-Level Security als zweite Autorisierungsschicht.**
Heute gibt es keine RLS; Autorisierung ist rein Grants plus in-Handler-Checks. Sobald echte Mandantentrennung (mehrere Shops) kommt, ist RLS auf `shop_id` die defense-in-depth-Schicht, die eine App-Lücke abfängt.
- **Standard:** NIST 800-207 (kleinstmöglicher Zugriff), OWASP ASVS 4.1.

**P2-4. Geheimnisse aus Klartext-Env in Docker-Secrets/Vault.**
Heute Klartext-`.env` auf dem Host, geschützt nur durch Dateirechte. (`0003_roles.sql:44`)
- **Standard:** OWASP ASVS 6.4, BSI SYS.1.6.

**P2-5. Owner-Sitzung 30 Tage überdenken + SSE-Token nicht im Query-String.**
30 Tage plus Klartext-Speicher ist ein großes Fenster; das SSE-`access_token` im Query-String kann in Proxy-Logs landen.
- **Standard:** OWASP ASVS 3.3, 8.3.1.

---

## 5. Zur Idee „Tokenisierung / Verbindungs-Token"

Der Vorschlag war: die App an ein Verbindungs-Token binden, den Nutzer nach der Registrierung an ein Token knüpfen, Rohdaten nicht anfassen, sondern als Token in der DB ablegen. Ehrliche Einordnung, weil die Formulierung zwei getrennte Dinge vermischt:

1. **„App an ein Verbindungs-Token binden."** Das existiert bereits und ist stärker als ein Token: die App verbindet als die least-privilege-Rolle `warehouse14_app`, die per Boot-Wächter erzwungen wird und nicht einmal DELETE kann. Ein gestohlenes App-Credential kann keine Buchung löschen und keine Kundenzeile hart entfernen. Das ist das richtige Muster; ein flaches „Token" wäre ein Rückschritt.

2. **„Rohdaten nicht anfassen, sondern als Token ablegen" (Tokenisierung).** Klassische Tokenisierung ersetzt einen sensiblen Wert durch einen bedeutungslosen Token und hält die Zuordnung in einem separaten Tresor. Das System macht das **funktional Stärkere**: die Rohdaten sind mit AES-256 verschlüsselt, der Schlüssel liegt getrennt (nicht in der DB, pro Transaktion gebunden), und für die Suche gibt es Blind-Indizes (HMAC), sodass man E-Mail/Telefon finden kann, **ohne** zu entschlüsseln. Für Fiskal- und KYC-Daten, die man wieder lesbar brauchen muss (Rechnung, Ausweisabgleich), ist reversible Verschlüsselung mit getrenntem Schlüssel der korrekte Weg, nicht Tokenisierung. Der sinnvolle Zusatz ist nicht Tokenisierung, sondern **P2-1** (den Schlüssel in ein KMS heben und pro Shop ableiten).

Kurz: die Richtung stimmt, das System ist an diesem Punkt bereits nahe am besten Stand. Der nächste echte Schritt ist die Geräteschicht (P0-1) und das Schlüssel-KMS (P2-1), nicht eine App-Token- oder Tokenisierungs-Umstellung.

---

## 6. Was jetzt sicher geht vs. was Basels Tor braucht

- **Jetzt branch-only entwickelbar** (kein Live-Risiko, wirkt erst beim Deploy): P1-1 (Token-Hash), P1-3 (CSP, report-only-Vorlauf), P1-4 (Redis-Ratenlimit).
- **Braucht einen Desktop-Build** (Basels Build-Tor): P1-2 (Keychain).
- **Braucht Infrastruktur + Basels Deploy-Tor, live nicht anzufassen:** P0-1 (mTLS), P0-2 (Tunnel-Token), P2-1 (KMS), P2-2 (DB-TLS), P2-4 (Vault).

Ich habe an der laufenden Produktion nichts verändert. Dieser Fahrplan ist die Vorbereitung; die Reihenfolge und das Scharfschalten entscheidet Basel.
