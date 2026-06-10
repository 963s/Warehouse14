# @warehouse14/storefront

The **customer-facing online store** for warehouse14 (gold, rare coins, antiques). Next.js 14 (App Router) + Tailwind + Framer Motion + React Three Fiber. Warm, natural/antique design on the shared `--w14` identity.

Dev: `npm run dev` → http://localhost:4311

## Architecture — one seam, one truth

Every page reads through a single typed data-adapter: **`src/lib/storefront-data.ts`**.

```ts
import { data } from "@/lib/storefront-data";
const { items } = await data.listProducts({ category, metal, sort });
```

Two implementations behind one interface, selected by env:

| `NEXT_PUBLIC_DATA_SOURCE` | implementation | use |
|---|---|---|
| (unset) / anything | `placeholderData` (in-memory fixtures) | **local build + demo** (today) |
| `live` | `httpData` (fetch `https://api.warehouse14.de/api/storefront/*`) | production |

**So the whole store is built, styled, and verified locally on placeholder data, then goes live by flipping one env flag — no page edits.** Set `NEXT_PUBLIC_API_URL` + `NEXT_PUBLIC_DATA_SOURCE=live` at deploy.

## IMPORTANT: the storefront is READ-ONLY. The POS publishes.

Product creation, photo attachment, and the **"publish to website / publish to eBay"** actions happen in the **Windows POS (cashier) app** — the central system — NOT on this website. Do **not** build product-management or admin UI here.

```
Cashier (POS, Windows)                 Server (api.warehouse14.de)        Storefront (this app)
  add product + photos  ──────────▶  products.is_published_to_web = TRUE  ──▶  reads published rows
  press "Online schalten"            (+ product_photos in R2)                 (GET /api/storefront/products)
  press "Auf eBay"        ──────────▶  ebay_state → ONLINE (Sell API)
```

The storefront only ever **reads** products where `is_published_to_web = TRUE AND status = 'AVAILABLE'`. One boolean on one row, owned by the POS, is the entire "appears on the website" mechanism (no sync job, no second catalog). See `docs/architecture/storefront-build-plan.md`.

## Routes

`/` home · `/kollektion` + `/kategorien/[slug]` + `/suche` catalog · `/artikel/[slug]` product (3D coin) · `/warenkorb` cart · `/kasse` + `/kasse/bestaetigung` checkout · `/konto/*` account · `/anmelden` `/registrieren` auth · `/merkliste` wishlist · `/goldankauf` sell-gold · `/impressum` `/datenschutz` `/agb` `/widerruf` `/ueber-uns` `/kontakt`.

## Before go-live (the "connect the cables" step)

Backend additions (additive, per the build plan): join `product_photos` into the catalog response (#1, so pictures show), public `GET /api/storefront/metal-prices`, `/orders` + `/account` routes, the goldankauf-lead / newsletter / contact endpoints, and the eBay Sell-API forward publish. Then flip the env flag, set real Stripe keys, deploy at `www.warehouse14.de` (same registrable domain as `api.` → the existing `SameSite=Lax` shopper cookie works unchanged).

## Conventions

German copy only, no em-dashes. Money is a decimal string from the data layer, always formatted with `eur()`. Coherent reuse: `ProductCard`, `ProductImage`, `PageShell`, `useCart`, `useWishlist`, `Reveal`.
