# Warehouse14 Owner OS — PRODUCT.md

## What is this?
The owner's mobile management app for Warehouse14, an antique and precious-metals dealer. The owner manages inventory (add/edit/photo/publish), customers, and monitors the business through a steampunk-styled dashboard. NOT a cashier — sales happen on the desktop POS.

## Register
**product** — design SERVES the product. A tool for the owner, not a brand surface. Calm, precise, functional.

## Users
The shop owner and a small set of staff (2-5 people). They use this daily on their personal iPhone to manage the shop from anywhere.

## Identity (committed — do not reinvent)
- **Ground**: warm parchment `#efece3` + **dark mode** warm umber `#1a1712`
- **Ink**: `#1c1c1c` (light) / `#efece3` (dark)
- **Gilt**: `#a3823b` — thread/edge/seal only
- **Functional**: verdigris `#3f6b54` (positive), wax-red `#c0492f` (negative)
- **Typography**: Bricolage Grotesque (display) + Inter (body) + JetBrains Mono (numbers)
- **Motion**: curator ease, 180/420/650ms
- **Full design system**: `docs/DESIGN-SYSTEM.md`

## Surfaces
- Schatzkammer (dashboard) — steampunk panels with real KPIs (profit, revenue, inventory value, metals)
- Lager (inventory) — product list, add/edit, photo studio, channel control, label printing
- Kunden (customers) — list, profiles, KYC, purchase history
- Mehr (more hub) — eBay, WhatsApp, Belege, Finanzen, Auswertungen, Team, Erfolge

## Constraints
- React Native (Expo SDK 55, RN 0.83.6, New Architecture)
- NativeWind (Tailwind for RN)
- German-only rendered text
- Honest data from `https://api.warehouse14.de`
