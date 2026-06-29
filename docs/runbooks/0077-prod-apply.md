# Runbook — apply migration 0077 + ship product dimensions & barcode to production

This ships the **product packing dimensions** feature and the **auto-barcode + scannable
label** fix. It is a two-part deploy: a DB migration (`0077`) **and** an api-cloud
image rebuild (new create/update/detail behaviour). Both must land together — the
mobile app and the api routes read/write the new columns and the auto-assigned barcode.

| Part | What | Why |
|---|---|---|
| DB `0077` | `0077_product_dimensions.sql` — adds nullable `length_cm` / `width_cm` / `height_cm` (`numeric(7,1)`) + three positive CHECK constraints to `products`. | The intake/edit screens store outer dimensions; the size class (S/M/L/XL) is derived on read, never stored. Idempotent (`ADD COLUMN IF NOT EXISTS`); the CHECKs run once (migrate tracks applied files). |
| api-cloud | New code: create auto-assigns `barcode = sku` when none is supplied; create/update accept the three dims; the detail route returns them. | Mobile-created products were saved with `barcode = NULL`, so the cashier scanner could never match them; and the dims columns are written/read by the new routes. |

> Note on the journal: `packages/db/migrations/meta/_journal.json` is empty in-repo and
> is **not** the live mechanism — prod applies the numbered SQL files via the `migrate`
> one-shot, which records each applied file in `_w14_schema_migrations`. `0077_…sql` is
> the correct next file; no journal edit is needed.

Server: `myserver` · prod dir `/opt/warehouse14` · `.env` is root-owned (use `sudo`).
The Mac is arm64 = same arch as the Oracle box, so a local `--platform linux/arm64`
build loads directly on the server. Images are streamed (no GHCR push, no source on
the server), exactly as in `0045-0048-prod-apply.md`.

---

## PRE — quiescence + baseline

1. Stop the writers so nothing lands mid-apply:
   ```bash
   ssh myserver 'cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml stop api worker'
   ```
2. Record the baseline (paste into the deploy log):
   ```bash
   ssh myserver "cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml exec -T postgres \
     psql -U warehouse14 -d warehouse14 \
     -c 'SELECT count(*) AS products, count(barcode) AS with_barcode FROM products;' \
     -c \"SELECT to_regclass('public._w14_schema_migrations') IS NOT NULL AS migrate_table;\""
   ```
   **Expected:** the product count, how many already carry a barcode, and `migrate_table = t`.

---

## APPLY part 1 — migration 0077 (migrate one-shot)

3. Build the migrate image with `0077` baked in (context = repo root):
   ```bash
   cd /Users/basel/Desktop/warehouse14
   docker buildx build --platform linux/arm64 \
     -f infrastructure/docker/migrate.Dockerfile \
     -t ghcr.io/963s/warehouse14-migrate:latest --load .
   ```
4. Stream it to the server:
   ```bash
   docker save ghcr.io/963s/warehouse14-migrate:latest | gzip -1 | ssh myserver 'gunzip | docker load'
   ```
5. Run the migrate one-shot (applies only the new `0077`; already-applied files are skipped):
   ```bash
   ssh myserver 'cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml up migrate'
   ssh myserver 'sudo docker logs warehouse14-migrate --tail 20'
   ```
   **Expected tail:** `[migrate] applying 0077_product_dimensions…` then `[migrate] done — applied 1, already-current N`.
   `migrate.sh` runs with `ON_ERROR_STOP=1`, so any failure aborts before recording — re-runnable.

6. Confirm the columns + constraints exist:
   ```bash
   ssh myserver "cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml exec -T postgres \
     psql -U warehouse14 -d warehouse14 \
     -c \"SELECT column_name, data_type, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_name='products' AND column_name IN ('length_cm','width_cm','height_cm') ORDER BY column_name;\" \
     -c \"SELECT conname FROM pg_constraint WHERE conname LIKE 'products_%_cm_positive' ORDER BY conname;\""
   ```
   **Expected:** three `numeric` columns (precision 7, scale 1) and three `*_cm_positive` constraints.

---

## APPLY part 2 — api-cloud (+ worker) image

The api image bakes the built code (auto-barcode + the dims routes/schemas) and the
updated `@warehouse14/db` schema. Rebuild + stream + recreate. Rebuild the worker too
so the shared `@warehouse14/db` package stays in lockstep across images.

7. Build + stream the api image:
   ```bash
   cd /Users/basel/Desktop/warehouse14
   docker buildx build --platform linux/arm64 \
     -f apps/api-cloud/Dockerfile \
     -t ghcr.io/963s/warehouse14-api:latest --load .
   docker save ghcr.io/963s/warehouse14-api:latest | gzip -1 | ssh myserver 'gunzip | docker load'
   ```
8. (Consistency) Build + stream the worker image the same way:
   ```bash
   docker buildx build --platform linux/arm64 \
     -f apps/worker/Dockerfile \
     -t ghcr.io/963s/warehouse14-worker:latest --load .
   docker save ghcr.io/963s/warehouse14-worker:latest | gzip -1 | ssh myserver 'gunzip | docker load'
   ```
9. Recreate the services (migrate already ran in part 1; it is a no-op now):
   ```bash
   ssh myserver 'cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml up -d api worker'
   ssh myserver 'sudo docker compose -f /opt/warehouse14/docker-compose.prod.yml logs --tail 20 api'
   ```
   **Expected:** api logs show `db smoke test` passing and the server listening (no boot error).

---

## POST-VERIFY (all should pass)

10. **Auto-barcode + dims round-trip** — create one product through the app (or `curl`
    the create route) WITHOUT a barcode, then read it back:
    ```bash
    ssh myserver "cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml exec -T postgres \
      psql -U warehouse14 -d warehouse14 \
      -c \"SELECT sku, barcode, (barcode = sku) AS barcode_is_sku, length_cm, width_cm, height_cm FROM products ORDER BY created_at DESC LIMIT 1;\""
    ```
    **Expected:** the newest product has `barcode = sku` (`barcode_is_sku = t`); if dims were
    entered, they appear; the positive CHECK rejects a `0`/negative dimension.

11. **Scannable label (on a device):** open the new product in the mobile app → Etikett
    drucken → the printed/preview label shows a real Code 128 barcode (bars, not text).
    Scan it with the till's USB scanner — it must resolve to that product in Verkauf.

12. **Cashier end-to-end:** scan the printed label at the till → the product lands in the
    cart (`found`), the sale completes, and the product flips to `SOLD` (deducted). A
    scan of a draft/sold/reserved item gives the precise German toast, not a silent miss.

13. Writers are already up (step 9). Confirm calm:
    ```bash
    ssh myserver 'cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml ps'
    ```
    **Expected:** `postgres`, `redis`, `api`, `worker`, `cloudflared` all `Up`; `migrate` exited 0.

---

## ROLLBACK

- **DB `0077`** is **forward-only and additive** (three nullable columns + positive CHECKs).
  Nothing reads them unless dims are set, so leaving them in place is harmless even if the
  api is rolled back. To revert manually (as `warehouse14_migrator`), and only if a column
  itself misbehaves:
  ```sql
  ALTER TABLE products
    DROP CONSTRAINT IF EXISTS products_length_cm_positive,
    DROP CONSTRAINT IF EXISTS products_width_cm_positive,
    DROP CONSTRAINT IF EXISTS products_height_cm_positive,
    DROP COLUMN IF EXISTS length_cm,
    DROP COLUMN IF EXISTS width_cm,
    DROP COLUMN IF EXISTS height_cm;
  ```
  Then `DELETE FROM _w14_schema_migrations WHERE filename = '0077_product_dimensions.sql';`
  so a future migrate re-applies a corrected file.
- **api-cloud** rollback = rebuild + stream the **previous** api image (the prior git
  commit) and `up -d api`. The auto-barcode default (`barcode = sku`) only fills NULLs on
  NEW creates; existing rows are untouched, so a revert leaves no inconsistent state.

Because prod has near-zero product volume, the safe response to any POST-VERIFY failure is
to STOP, diagnose, and re-apply a corrected forward migration / image rather than revert.

---

## Mobile build (separate — on Basel's explicit command)

The app changes (dimensions UI, the scannable Code 128 in all three print paths, the
optimistic photo upload, the Neuer-Artikel craft pass) ship in the next `.ipa` / `.apk`.
Do NOT build until Basel says so. When commanded, build from the repo root with the
established release env (force the prod backend default; verify the SHIPPED bundle points
at `https://api.warehouse14.de`, per the env-build-trap note). The server side above must
already be live so the new bundle's dims/barcode calls hit columns/behaviour that exist.
