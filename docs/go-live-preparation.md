# Go-Live Preparation — Warehouse14 (Schorndorf)

> The **software foundation is complete and verified** (full monorepo typecheck +
> tests green). What remains before opening is **preparation, not coding**: enter
> the real shop data, set the secrets you want active, apply the new migration,
> and run the on-site hardware day. This guide is the single checklist for that.
>
> Pair with [`go-live-hardware-checklist.md`](./go-live-hardware-checklist.md) for the device-validation day.

---

## 1. MUST do before the first real sale

| ✓ | Step | Where | Why |
|---|------|-------|-----|
| ☐ | Apply **migration 0044** to the production DB | `pnpm --filter @warehouse14/db migrate` (or your migrate runner) | Creates the `shop.*` identity keys the receipt + Owner Desktop read. |
| ☐ | Enter the **real USt-IdNr.** (VAT id) | Owner Desktop → Einstellungen → **Geschäftsdaten** | The receipt currently prints the DUMMY `DE123456789`. A wrong VAT id on a Kassenbon is a **GoBD breach**. |
| ☐ | Enter the **real shop phone** | same screen | Printed on the receipt. |
| ☐ | Confirm name/address/tagline | same screen | Pre-filled: WAREHOUSE 14 · Antiquitäten · Briefmarken · Münzen · Schornbacher Weg 66 · 73614 Schorndorf. |
| ☐ | **Hardware day** — pair mTLS devices + configure TSE/printer/terminal + run the hardware checklist | on-site | The single go-live gate (TSE signing + card terminal + printers must be proven on real devices). |

> The shop logo, receipt layout, tax footers (§25a/§12), TSE block + QR are
> already correct — see the sample `Warehouse14-Kassenbon-Muster.pdf`.

---

## 2. Secrets / keys — set the ones you want ACTIVE

Every one of these **degrades safely** if left empty (the feature is simply off
or runs in mock), so set only what you're launching with.

| ✓ | Secret | Enables | If empty |
|---|--------|---------|----------|
| ☐ | `TAURI_SIGNING_PRIVATE_KEY` (+ password) as a GitHub Action secret, then tag a release | **Auto-updates** reach installed apps (notify-on-open + background install) | apps must be reinstalled manually to update |
| ☐ | Fiskaly **TSS-ID** + **API key** (POS → Geräte) | Real TSE fiscal signing | receipts print "TSE Ausfall" (not go-live-legal) |
| ☐ | `ANTHROPIC_API_KEY` (worker env) | Real **AI vision** (photo → listing draft) + the WhatsApp bot | intake uses the deterministic mock; bot disabled |
| ☐ | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (api-cloud env) | **Online store** checkout + fulfilment | storefront checkout refuses (online sales off) |
| ☐ | `EBAY_API_TOKEN` (worker env) | **Instant eBay delisting** when an item sells in-store | delisting is mocked (logged, not sent) |
| ☐ | WhatsApp Meta creds (`WHATSAPP_*`) | WhatsApp intake + customer-service bot replies | inbound stored, replies queued (not sent) |

---

## 3. What's READY (no action needed) — verified this build

- **Cashier money path:** PIN login + session restore · open/close shift
  (Blindsturz + variance) · Z-Bon · cash movements (Einlage/Entnahme) ·
  multi-item sales + tax (§25a/§25c/§19/§7) + **Rabatt** + **Gutschein** ·
  B2B reverse-charge (VIES) · **Storno** · **receipt reprint**.
- **Ankauf** (buy from customer) + KYC/AML gate + Ankaufbeleg label.
- **Receipt:** real logo (screen + paper), Schorndorf identity, TSE block + QR,
  legal footers, **preview-before-print**.
- **Manual product add** → photo capture (R2 pipeline) hand-off.
- **Owner Desktop:** 8 surfaces, editable (trust/KYC, settings, shop identity),
  shared theme, auto-update.
- **AI:** real Anthropic vision + auto price estimate (when key set).

---

## 4. Future updates (NOT go-live blockers — ship later)

- eBay **listing push** + inbound stock sync (needs eBay sandbox to build well).
- Split **cash + card** payment (waits on the card-terminal hardware day).
- Phase 1.5 niceties: TSE offline-queue drainer worker, in-store Retoure UI,
  recent-sales list for late storno.

---

### One-line status
**Foundation done.** Open Schorndorf after: migration 0044 applied → real
VAT id/phone entered → hardware day passed. Everything else is optional or a
later update.
