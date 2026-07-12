<!-- Read-only production load-readiness check. 2026-07-12. No stress test was run against production; no configuration was changed. All commands were SELECT / SHOW / INFO / docker inspect only. -->

# Produktions-Lastbereitschaft, Momentaufnahme 2026-07-12

Nur-Lese-Prüfung über `ssh myserver`. Es wurde **kein Lasttest gegen die
Produktion gefahren** (das hätte den Live-Betrieb gefährdet) und **nichts
verändert**. Alle Kommandos waren `SELECT` / `SHOW` / `INFO` / `docker inspect`.

## Gesamturteil

Für das reale Volumen des Salons (ein Laden, wenige Kassen) ist der Server
bequem bereit und stabil. Die Auslastung ist niedrig, die Tabellen sind gut
indiziert, die Verbindungsreserve ist groß, alle Container sind gesund. Der
einzige echte Vorbehalt betrifft nicht die Kapazität, sondern die
**Aktualität**: die Härtungs-Migrationen gegen gleichzeitige Schreibvorgänge
(0079/0080) und die Backend-Kampagne sind auf dem Branch, **nicht deployt**.

## Host

| Kennzahl | Wert |
|---|---|
| Instanz | Oracle aarch64, Ubuntu 20.04 (Kernel 5.15) |
| CPU / RAM | 4 Kerne · 23 GiB (12 GiB belegt, 10 GiB frei) |
| Disk | 194 GB, 38 % belegt (122 GB frei) |

## Container (alle gesund)

`warehouse14-api` up 7 Tage · `-worker` up 13 Tage · `-postgres` (pg17) up 5
Wochen · `-redis` up 5 Wochen · `-storefront`, `-cloudflared` gesund.
`api` Neustarts=0, `worker` Neustarts=0. Beide `healthy`.

- API-Image: `ghcr.io/963s/warehouse14-api:latest`, gebaut **2026-07-04**.

## Datenbank (PostgreSQL 17.10)

| Kennzahl | Wert | Bewertung |
|---|---|---|
| DB-Größe | 181 MB, 72 Tabellen | klein |
| Zeilen (heiß) | ledger_events 537 · products 111 · transactions 51 · appointments 21 · customers 15 | sehr niedriges Volumen |
| Indizes | products 25 · transactions 16 · appointments 10 · daily_closings 5 · ledger_events 5 | gut abgedeckt; jede öffentliche Tabelle hat einen PK |
| max_connections | 100 | reichlich |
| aktuelle Verbindungen | ~12 (api 2 · worker 5 · psql 1 · übrig 5) | winzig |
| Pool | `DB_POOL_MAX` Default 10 pro API-Instanz; SSE nutzt je Abonnent eine eigene `max:1`-Verbindung | weit unter 100 |
| idle-in-transaction | 0 | kein Verbindungsleck |
| längste aktive Abfrage | 0 s | nichts hängt |
| Deadlocks seit Boot | **0** (bei 5.108.177 Commits, 96 Rollbacks) | sehr stabil |
| Cache-Trefferquote | **1,0000** | perfekt, alles im Speicher |

### Postgres-Tuning: Standardwerte

`shared_buffers=128 MB`, `work_mem=4 MB`, `maintenance_work_mem=64 MB`,
`effective_cache_size=4 GB`. Das sind die **Auslieferungs-Standardwerte** auf
einem 23-GiB-Host. Für die aktuelle Last völlig ausreichend (Trefferquote
1,0000). Erst unter echtem Druck wären das die ersten Stellschrauben
(`shared_buffers` auf ~4-6 GB, `work_mem` auf ~16-32 MB). **Keine
Blockade, eine spätere Optimierung.**

## Redis

`used_memory=1,09 MB`, `maxmemory=0` (unbegrenzt), Policy `noeviction`,
`rejected_connections=0`, `evicted_keys=0`. Gesund. Hinweis: unbegrenzter
Speicher plus `noeviction` heißt, Redis wächst theoretisch ohne Grenze in den
Host-RAM. Bei 1 MB Nutzung praktisch kein Risiko; ein `maxmemory`-Limit wäre
eine saubere spätere Absicherung.

## Der eine echte Vorbehalt: Deploy-Stand

- Produktions-Migrationen: neueste = **`0078_customer_erasure.sql`**.
- Der Branch fügt `0079_daily_closings_single_z_bon.sql` und
  `0080_appointments_no_overlap_deferrable.sql` hinzu, plus die
  Backend-Härtungs-Fixes (Z-Snapshot-Advisory-Lock, per-Zeile-Vorzeichen,
  Export-Guard u. a.). Diese sind **nicht in Produktion**.
- Diese Migrationen sind genau die Garantien für **korrekte gleichzeitige
  Schreibvorgänge unter Druck** (ein Z-Bon pro Tag, überschneidungsfreie
  Termine, kein Doppel-Verkauf). Wer echte Mehrkassen-Gleichzeitigkeit erwartet,
  sollte sie zuerst deployen. Das ist Basels Deploy-Tor.

## Empfehlung

1. **Kapazität:** bereit. Kein Handlungsbedarf für das aktuelle Volumen.
2. **Vor echter Mehrkassen-Last:** die Backend-Kampagne + 0079/0080 deployen
   (Steuerberater-/Sicherheits-Sign-off + `migrate.sh` + Container-Neustart).
3. **Später, optional:** `shared_buffers`/`work_mem` anheben; ein Redis
   `maxmemory`-Limit setzen.
