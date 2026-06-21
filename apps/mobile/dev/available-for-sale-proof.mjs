/**
 * DEV-ONLY end-to-end proof for the AVAILABLE-FOR-SALE feature against the LOCAL
 * dev api-cloud. Exercises the exact wire the app uses through the EXISTING
 * @warehouse14/api-client, then asserts the pure availability model the Lager +
 * Verkauf screens render on top of it:
 *
 *   1. PIN login → session token.
 *   2. Live counts — countProductsByStatus parity (the three status `total`s).
 *   3. Picker page — unfiltered list → available-first sort (compareByAvailability).
 *   4. Sellability gate — isSellable true ONLY for AVAILABLE; notSellableReason
 *      gives an honest German line for RESERVED / SOLD / DRAFT.
 *
 * Run from apps/mobile so the workspace import + the source module resolve:
 *   node dev/available-for-sale-proof.mjs
 * Requires the local server up + the dev DB seeded. NEVER point at production.
 */
import { ApiError, authPin, createApiClient, productsApi } from "@warehouse14/api-client"
import {
  availabilityRank,
  availabilitySummaryLine,
  compareByAvailability,
  isSellable,
  makeInventoryCounts,
  notSellableReason,
} from "../src/warehouse14/availability-ui.ts"

const BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3001"
const FP =
  process.env.EXPO_PUBLIC_DEV_DEVICE_FINGERPRINT ??
  "71defad08503fcfb00b0b57e7654b3ed48afb264d34c69c3edb90a65a6b8f698"
const PIN = "0000"

let token = null
const client = createApiClient({
  baseUrl: BASE,
  credentials: "include",
  defaultHeaders: { "x-dev-device-fingerprint": FP },
  getAuthToken: () => token,
})

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`)
  console.log(`   ✓ ${msg}`)
}

async function main() {
  console.log("== 1) PIN login ==")
  token = (await authPin.login(client, { pin: PIN })).token
  console.log(`   ok token=${token.slice(0, 12)}…`)

  console.log("== 2) Live counts (per-status total) ==")
  const at = (status) =>
    productsApi.list(client, { status, limit: 1 }).then((r) => r.total)
  const [available, reserved, sold] = await Promise.all([
    at("AVAILABLE"),
    at("RESERVED"),
    at("SOLD"),
  ])
  const counts = makeInventoryCounts({ available, reserved, sold })
  console.log(`   verfügbar=${counts.available} reserviert=${counts.reserved} verkauft=${counts.sold} Bestand=${counts.inStock}`)
  assert(counts.inStock === available + reserved + sold, "inStock is the real sum of the three buckets")
  assert(counts.available >= 1, "at least one AVAILABLE article exists to sell")
  console.log(`   summary line → "${availabilitySummaryLine(counts)}"`)

  console.log("== 3) Picker page — available-first sort ==")
  const page = await productsApi.list(client, { limit: 20 })
  const sorted = [...page.items].sort(compareByAvailability)
  const ranks = sorted.map((r) => availabilityRank(r.status))
  const isNonDecreasing = ranks.every((r, i) => i === 0 || r >= ranks[i - 1])
  assert(isNonDecreasing, "rows are floated available-first (rank non-decreasing)")
  const firstAvail = sorted.filter((r) => r.status === "AVAILABLE").length
  if (firstAvail > 0) {
    assert(sorted[0].status === "AVAILABLE", "the top row is sellable when any AVAILABLE is on the page")
  }
  console.log(`   page=${page.items.length}/${page.total}; first→ ${sorted.slice(0, 5).map((r) => `${r.status[0]}`).join("")} … last→ ${sorted.slice(-3).map((r) => `${r.status[0]}`).join("")}`)

  console.log("== 4) Sellability gate + honest reason ==")
  assert(isSellable("AVAILABLE") === true, "AVAILABLE is sellable")
  assert(isSellable("RESERVED") === false, "RESERVED is NOT sellable")
  assert(isSellable("SOLD") === false, "SOLD is NOT sellable")
  assert(isSellable("DRAFT") === false, "DRAFT is NOT sellable")
  assert(notSellableReason("AVAILABLE") === null, "no reason shown for sellable stock")
  for (const s of ["RESERVED", "SOLD", "DRAFT"]) {
    const reason = notSellableReason(s)
    assert(typeof reason === "string" && reason.length > 0, `reason present for ${s}`)
    // Purity: no raw SCREAMING_SNAKE status token leaks into the German line.
    assert(!/[A-Z]{2,}/.test(reason), `reason for ${s} carries no raw token`)
    console.log(`     ${s} → "${reason}"`)
  }
  // Pull a real RESERVED + SOLD row from the wire and confirm the gate refuses them.
  const reservedRow = (await productsApi.list(client, { status: "RESERVED", limit: 1 })).items[0]
  const soldRow = (await productsApi.list(client, { status: "SOLD", limit: 1 })).items[0]
  if (reservedRow) assert(!isSellable(reservedRow.status), `live RESERVED row ${reservedRow.sku} is not addable`)
  if (soldRow) assert(!isSellable(soldRow.status), `live SOLD row ${soldRow.sku} is not addable`)

  console.log("\n✅ ALL PASS — live counts + available-first sort + sellability gate + honest German reasons")
}

main().catch((e) => {
  console.error("PROOF FAILED:", e instanceof ApiError ? `${e.code} ${e.message}` : e)
  process.exit(1)
})
