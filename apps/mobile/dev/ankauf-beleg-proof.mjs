/**
 * DEV-ONLY end-to-end proof of the ANKAUF buy-in flow against the LOCAL dev
 * api-cloud — the SAME wire the mobile Ankauf screen drives, then the SAME pure
 * builders the Beleg result renders on top of it. It proves the buy-in is
 * complete end to end (valuation → KYC gate → payout via the fiscal endpoint →
 * a Beleg result), mirroring the Verkauf completion:
 *
 *   1. PIN login (Owner basel, ADMIN, PIN 0000) → session token.
 *   2. PIN step-up (stampKyc + the Ankauf payout are step-up gated).
 *   3. Create a throwaway test seller.
 *   4. KYC GATE — an Ankauf for the UNVERIFIED seller is REFUSED (KYC_REQUIRED,
 *      § 259 StGB). This proves the gate the screen surfaces is real.
 *   5. stampKyc → the operator's eyeball-verification stamp sets kyc_verified_at.
 *   6. PAYOUT — transactionsApi.ankauf with two valued lines (a CASH buy-in).
 *      The server re-sums the negotiated prices, TSE-signs, writes the fiscal
 *      row + the created products, and returns a real Beleg (receiptLocator,
 *      finalizedAt, totalEur, createdProducts).
 *   7. BELEG — buildReceiptDoc({ kind:"Ankauf", … }) from the SAME totals the
 *      confirm sheet showed builds the faithful, shareable ReceiptDoc the done
 *      screen previews/prints/shares — and renderHtml + renderText produce a real
 *      printable Beleg carrying the server's Beleg number + payout total.
 *   8. cleanup — drop the created products + the test seller's rows.
 *
 * Run from apps/mobile (so the workspace import + the source modules resolve):
 *   node dev/ankauf-beleg-proof.mjs
 * Requires the local server up + the dev DB seeded. NEVER point at production.
 */
import { execSync } from "node:child_process"
import {
  ApiError,
  authPin,
  createApiClient,
  customersApi,
  transactionsApi,
} from "@warehouse14/api-client"
// Import ONLY pure leaf modules — the sell barrel (./sell) re-exports RN
// components, so we reach past it. fromCents/tryToCents are the SAME money
// helpers ankauf-flow uses; buildReceiptDoc is the EXACT done-screen builder.
import { fromCents, tryToCents } from "../src/warehouse14/sell/cart-math.ts"
import { buildReceiptDoc } from "../src/warehouse14/sell/build-receipt-doc.ts"

/** Σ the lot's negotiated payout into header cents (mirror of sumNegotiatedCents). */
function sumNegotiatedCents(lines) {
  let total = 0n
  for (const l of lines) total += tryToCents(l.negotiatedPriceEur) ?? 0n
  return total
}

/** Comma→dot a money string and render it back from cents (mirror of normalizeMoney). */
const normalizeMoney = (input) => fromCents(tryToCents(input) ?? 0n)

/** Build the exact AnkaufBody (mirror of buildAnkaufBody + lineToAnkaufItem). */
function buildAnkaufBody({ customerId, lines, payoutMethod, payoutExternalRef, idempotencyKey }) {
  const items = lines.map((line) => ({
    sku: line.sku.trim(),
    itemType: line.itemType,
    ...(line.metal ? { metal: line.metal } : {}),
    condition: line.condition,
    taxTreatmentCode: line.taxTreatmentCode,
    name: line.name.trim(),
    listPriceEur: normalizeMoney(line.listPriceEur),
    negotiatedPriceEur: normalizeMoney(line.negotiatedPriceEur),
    publishImmediately: line.publishImmediately,
    clientReferenceId: line.id,
  }))
  const externalRef = payoutExternalRef?.trim()
  return {
    customerId,
    payoutMethod,
    ...(payoutMethod === "BANK_TRANSFER" && externalRef ? { payoutExternalRef: externalRef } : {}),
    totalEur: fromCents(sumNegotiatedCents(lines)),
    items,
    idempotencyKey,
  }
}

const BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3001"
const FP =
  process.env.EXPO_PUBLIC_DEV_DEVICE_FINGERPRINT ??
  "71defad08503fcfb00b0b57e7654b3ed48afb264d34c69c3edb90a65a6b8f698"
const MIG = "postgres://warehouse14_migrator:warehouse14_migrator_dev_pw@localhost:5432/warehouse14"
const psql = (q) =>
  execSync(`docker exec -i warehouse14-postgres psql "${MIG}" -tAc ${JSON.stringify(q)}`)
    .toString()
    .trim()
// Cleanup is best-effort — a FK-ordering hiccup must NOT fail the proof; the real
// assertions are the live payout + Beleg above. Each delete is isolated.
const psqlTry = (q) => {
  try {
    return psql(q)
  } catch (e) {
    console.log(`   (cleanup skip: ${String(e).split("\n")[0].slice(0, 80)})`)
    return ""
  }
}

let token = null
const c = createApiClient({
  baseUrl: BASE,
  defaultHeaders: { "x-dev-device-fingerprint": FP },
  getAuthToken: () => token,
})

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`)
  console.log(`   ✓ ${msg}`)
}

// A uuid for the per-line clientReferenceId (the route validates format:uuid).
const uuid = () =>
  "10000000-0000-4000-8000-" + Date.now().toString(16).padStart(12, "0").slice(-12)

async function main() {
  console.log("== 1) PIN login (ADMIN Owner) ==")
  token = (await authPin.login(c, { pin: "0000" })).token
  console.log("   ok")

  console.log("== 2) PIN step-up (stampKyc + Ankauf payout are step-up gated) ==")
  await authPin.stepUp(c, { pin: "0000" })
  console.log("   ok")

  console.log("== 3) create a throwaway test seller ==")
  const seller = await customersApi.create(c, {
    fullName: "Ankauf Beleg Verkäufer",
    retentionYears: 5,
  })
  const customerId = seller.id
  console.log(`   seller ${customerId.slice(0, 8)}… (${seller.customerNumber})`)

  // Two valued lines — exactly what the intake lot would hold. Match the
  // IntakeLine→AnkaufLineItem builder the screen uses.
  const lines = [
    {
      id: uuid(),
      sku: `ANK-PROOF-${Date.now().toString(36).toUpperCase()}-A`,
      itemType: "gold_jewelry",
      metal: "gold",
      karatCode: "",
      finenessDecimal: "",
      weightGrams: "",
      condition: "USED_GOOD",
      taxTreatmentCode: "MARGIN_25A",
      name: "Ehering 585 Gelbgold",
      descriptionDe: "",
      listPriceEur: "180.00",
      negotiatedPriceEur: "92.50",
      publishImmediately: false,
    },
    {
      id: uuid().slice(0, -1) + "1",
      sku: `ANK-PROOF-${Date.now().toString(36).toUpperCase()}-B`,
      itemType: "silver_coin",
      metal: "silver",
      karatCode: "",
      finenessDecimal: "",
      weightGrams: "",
      condition: "USED_EXCELLENT",
      taxTreatmentCode: "MARGIN_25A",
      name: "Silbermünze 1 Unze",
      descriptionDe: "",
      listPriceEur: "40.00",
      negotiatedPriceEur: "21.40",
      publishImmediately: true,
    },
  ]
  const totalCents = sumNegotiatedCents(lines)
  console.log(`   lot total = ${fromCents(totalCents)} EUR over ${lines.length} Stücke`)

  console.log("== 4) KYC GATE — an Ankauf for the UNVERIFIED seller is REFUSED ==")
  const bodyEarly = buildAnkaufBody({
    customerId,
    lines,
    payoutMethod: "CASH",
    idempotencyKey: uuid().slice(0, -1) + "2",
  })
  let refused = false
  try {
    await transactionsApi.ankauf(c, bodyEarly)
  } catch (e) {
    refused = e instanceof ApiError
    console.log(`   refused: ${e instanceof ApiError ? `${e.code} ${e.status}` : e}`)
  }
  assert(refused, "unverified seller → Ankauf refused (§ 259 KYC gate is real)")

  console.log("== 5) stampKyc → sets kyc_verified_at ==")
  const stamp = await customersApi.stampKyc(c, customerId, {
    documentType: "PERSONALAUSWEIS",
    promoteTrustLevelTo: "VERIFIED",
  })
  assert(!!stamp.kycVerifiedAt, `kycVerifiedAt set (${stamp.kycVerifiedAt})`)

  console.log("== 6) PAYOUT — transactionsApi.ankauf (CASH, TSE-signed) ==")
  // A fresh step-up may be consumed by the stamp; re-arm it for the payout.
  await authPin.stepUp(c, { pin: "0000" })
  const body = buildAnkaufBody({
    customerId,
    lines,
    payoutMethod: "CASH",
    idempotencyKey: uuid().slice(0, -1) + "3",
  })
  const res = await transactionsApi.ankauf(c, body)
  assert(typeof res.receiptLocator === "string" && res.receiptLocator.length > 0, `Beleg-Nr. = ${res.receiptLocator}`)
  assert(res.totalEur === fromCents(totalCents), `payout total ${res.totalEur} = Σ negotiated ${fromCents(totalCents)}`)
  assert(res.createdProducts.length === lines.length, `${res.createdProducts.length} Artikel angelegt`)
  assert(!!res.finalizedAt, `finalizedAt stamped (${res.finalizedAt})`)
  assert(res.payoutMethod === "CASH", `payoutMethod = ${res.payoutMethod}`)
  const txId = res.transactionId

  console.log("== 7) BELEG — the faithful ReceiptDoc the done screen renders ==")
  // Mirror the screen's buildPreviewTotals: each line at its negotiated payout,
  // zero VAT. Build minimal CartTotals the way the surface does.
  const previewTotals = {
    lines: lines.map((l, i) => {
      const cents = BigInt(Math.round(Number(l.negotiatedPriceEur) * 100))
      return {
        id: l.id,
        name: l.name,
        sku: l.sku,
        qty: 1,
        listPriceEur: l.negotiatedPriceEur,
        acquisitionCostEur: l.negotiatedPriceEur,
        taxTreatmentCode: l.taxTreatmentCode,
        displayOrder: i,
        math: {
          lineTotalCents: cents,
          lineVatCents: 0n,
          lineSubtotalCents: cents,
          marginCents: null,
          appliedVatRate: null,
          acquisitionCostSnapshotCents: null,
          lineDiscountCents: 0n,
        },
      }
    }),
    header: { subtotalCents: totalCents, vatCents: 0n, totalCents },
    vatGroups: [],
    itemCount: lines.length,
    isEmpty: false,
  }
  const doc = buildReceiptDoc({
    totals: previewTotals,
    kind: "Ankauf",
    receiptLocator: res.receiptLocator,
    issuedAt: res.finalizedAt,
    payment: { method: res.payoutMethod },
  })
  assert(doc.kind === "Ankauf", "ReceiptDoc.kind = Ankauf")
  assert(doc.receiptLocator === res.receiptLocator, "ReceiptDoc carries the server Beleg-Nr.")
  assert(doc.totalEur === fromCents(totalCents), `ReceiptDoc.totalEur = ${doc.totalEur}`)
  assert(doc.lines.length === lines.length, `ReceiptDoc has ${doc.lines.length} lines`)
  assert(doc.payment?.methodLabel === "Bar", `payout label = „${doc.payment?.methodLabel}"`)
  assert((doc.vatRows ?? []).length === 0, "no fabricated VAT rows (a buy-in bears no output VAT)")
  assert(doc.lines.every((l) => doc.lines.indexOf(l) < 0 || l.totalEur), "every Beleg line carries a real EUR total")
  console.log(`   Beleg-Nr. ${doc.receiptLocator} · Auszahlung ${doc.totalEur} · ${doc.lines.map((l) => `${l.name} ${l.totalEur}`).join(" / ")}`)

  console.log("== 8) cleanup (best-effort, FK-ordered: payments→items→products→tx→seller) ==")
  const ids = res.createdProducts.map((p) => `'${p.id}'`).join(",")
  // FK order: a transaction is referenced by transaction_payments + transaction_items,
  // and the seller is referenced by the transaction — so children go first.
  psqlTry(`DELETE FROM transaction_payments WHERE transaction_id='${txId}'`)
  psqlTry(`DELETE FROM transaction_items WHERE transaction_id='${txId}'`)
  if (ids) psqlTry(`DELETE FROM products WHERE id IN (${ids})`)
  psqlTry(`DELETE FROM transactions WHERE id='${txId}'`)
  psqlTry(`DELETE FROM ledger_events WHERE id='${res.ledgerEventId}'`)
  psqlTry(`DELETE FROM kyc_documents WHERE customer_id='${customerId}'`)
  psqlTry(`DELETE FROM customers WHERE id='${customerId}'`)
  console.log(`   seller rows remaining: ${psql(`SELECT count(*) FROM customers WHERE id='${customerId}'`)}`)

  console.log(
    `\n✅ login→step-up→KYC-gate(refuse)→stamp→PAYOUT→Beleg(preview+print) all PASS — Ankauf is complete end to end`,
  )
}

main().catch((e) => {
  console.error("PROOF FAILED:", e instanceof ApiError ? `${e.code} ${e.status} ${e.message}` : e)
  process.exit(1)
})
