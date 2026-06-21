/**
 * DEV-ONLY proof for the eBay-channel Harden fixes (P0 + P1).
 *
 * Drives the EXACT code paths the app uses, through the real
 * @warehouse14/api-client, to prove that an Owner-enrolled item (ebay_state set,
 * listed_on_ebay still FALSE — the documented pre-go-live state) is:
 *   • VISIBLE in the pipeline  → listProducts({ enrolledOnEbay: true })   [P0]
 *   • GONE from the enroll search → listProducts({ status:'AVAILABLE',
 *                                                  enrolledOnEbay: false }) [P1]
 * …and that the OLD, buggy filters (listedOnEbay) would still fail both.
 *
 * Run from apps/mobile:  node dev/ebay-pipeline-proof.mjs
 * Requires the local server up (with the NEW schema) + the dev DB seeded.
 * NEVER point at production.
 */
import { execSync } from "node:child_process"

import { authPin, createApiClient, productsApi } from "@warehouse14/api-client"

const BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3001"
const FP =
  process.env.EXPO_PUBLIC_DEV_DEVICE_FINGERPRINT ??
  "71defad08503fcfb00b0b57e7654b3ed48afb264d34c69c3edb90a65a6b8f698"
const PIN = "0000"
const SU = "postgres://warehouse14:warehouse14_dev_pw@localhost:5432/warehouse14"
const psql = (q) =>
  execSync(`docker exec -i warehouse14-postgres psql "${SU}" -tAc ${JSON.stringify(q)}`)
    .toString()
    .trim()

let token = null
const client = createApiClient({
  baseUrl: BASE,
  credentials: "include",
  defaultHeaders: { "x-dev-device-fingerprint": FP },
  getAuthToken: () => token,
})

const ok = (c, m) => console.log(`${c ? "✅" : "❌"} ${m}`)
let failures = 0
const must = (c, m) => {
  ok(c, m)
  if (!c) failures++
}

async function main() {
  // 0. Login (same flow as apps/mobile/src/warehouse14/api.ts).
  const login = await authPin.login(client, { pin: PIN })
  token = login.token
  console.log(`Logged in (role ${login.actor?.role ?? "?"}, owner=${login.actor?.isOwner})\n`)

  // 1. Pick an AVAILABLE, not-yet-enrolled product and enroll it to ENTWURF via
  //    the REAL state-machine route — NULL → ENTWURF, exactly like the app's
  //    enroll() does. listed_on_ebay stays FALSE (no marketplace publish).
  const candidates = await productsApi.list(client, {
    status: "AVAILABLE",
    enrolledOnEbay: false,
    limit: 50,
  })
  const target = candidates.items[0]
  if (!target) throw new Error("no AVAILABLE not-yet-enrolled product to test with")

  // Reset any prior run: make sure THIS product starts un-enrolled.
  psql(`UPDATE products SET ebay_state=NULL, ebay_state_changed_at=NULL WHERE id='${target.id}'`)

  await client.request("PATCH", `/api/products/${target.id}/ebay-state`, { toState: "ENTWURF" })
  const dbRow = psql(
    `SELECT ebay_state || '|' || listed_on_ebay FROM products WHERE id='${target.id}'`,
  )
  console.log(`Enrolled ${target.sku} → DB ebay_state|listed_on_ebay = ${dbRow}`)
  must(dbRow === "ENTWURF|false", "Enroll set ebay_state=ENTWURF while listed_on_ebay stays FALSE")
  console.log("")

  // 2. P0 — the pipeline filter. NEW filter must SHOW the enrolled item; the OLD
  //    filter (listedOnEbay:true) must MISS it.
  const pipelineNew = await productsApi.list(client, { enrolledOnEbay: true, limit: 60 })
  const pipelineOld = await productsApi.list(client, { listedOnEbay: true, limit: 60 })
  const inNew = pipelineNew.items.some((p) => p.id === target.id)
  const inOld = pipelineOld.items.some((p) => p.id === target.id)
  console.log(
    `P0 pipeline: enrolledOnEbay:true → ${pipelineNew.items.length} items (target present: ${inNew}); ` +
      `legacy listedOnEbay:true → ${pipelineOld.items.length} items (target present: ${inOld})`,
  )
  must(inNew, "P0 FIXED: enrolled item IS visible via enrolledOnEbay:true")
  must(!inOld, "P0 confirmed root cause: enrolled item is INVISIBLE via legacy listedOnEbay:true")
  console.log("")

  // 3. P1 — the enroll search. NEW filter must EXCLUDE the enrolled item; the OLD
  //    filter (listedOnEbay:false) must still wrongly INCLUDE it (re-enroll bug).
  const enrollNew = await productsApi.list(client, {
    status: "AVAILABLE",
    enrolledOnEbay: false,
    limit: 50,
  })
  const enrollOld = await productsApi.list(client, {
    status: "AVAILABLE",
    listedOnEbay: false,
    limit: 50,
  })
  const reappearsNew = enrollNew.items.some((p) => p.id === target.id)
  const reappearsOld = enrollOld.items.some((p) => p.id === target.id)
  console.log(
    `P1 enroll search: enrolledOnEbay:false → target reappears: ${reappearsNew}; ` +
      `legacy listedOnEbay:false → target reappears: ${reappearsOld}`,
  )
  must(!reappearsNew, "P1 FIXED: enrolled item no longer offered for re-enroll (enrolledOnEbay:false)")
  must(
    reappearsOld,
    "P1 confirmed root cause: legacy listedOnEbay:false STILL offers the enrolled item",
  )
  console.log("")

  // 4. Walk it deeper (ENTWURF→GEPRUEFT→ONLINE→VERKAUFT) and re-prove it stays in
  //    the pipeline and out of the enroll search at a SOLD-cluster state too —
  //    the finding's exact scenario (VERKAUFT yet listed_on_ebay=false).
  for (const to of ["GEPRUEFT", "ONLINE", "VERKAUFT"]) {
    await client.request("PATCH", `/api/products/${target.id}/ebay-state`, { toState: to })
  }
  const deepRow = psql(
    `SELECT ebay_state || '|' || listed_on_ebay || '|' || status FROM products WHERE id='${target.id}'`,
  )
  const pipeDeep = await productsApi.list(client, { enrolledOnEbay: true, limit: 60 })
  const enrollDeep = await productsApi.list(client, {
    status: "AVAILABLE",
    enrolledOnEbay: false,
    limit: 50,
  })
  const inPipeDeep = pipeDeep.items.some((p) => p.id === target.id)
  const inEnrollDeep = enrollDeep.items.some((p) => p.id === target.id)
  console.log(`Walked to VERKAUFT → DB ebay_state|listed_on_ebay|status = ${deepRow}`)
  must(inPipeDeep, "VERKAUFT item still visible in pipeline (enrolledOnEbay:true)")
  must(!inEnrollDeep, "VERKAUFT item never returns to enroll search (and status no longer AVAILABLE)")
  console.log("")

  console.log(failures === 0 ? "ALL PROOFS PASSED ✅" : `❌ ${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("PROOF ERROR:", e?.message ?? e)
  process.exit(1)
})
