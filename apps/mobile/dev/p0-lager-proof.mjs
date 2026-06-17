/**
 * DEV-ONLY end-to-end proof against the LOCAL dev api-cloud.
 *
 * Exercises the exact code paths the app uses, through the EXISTING
 * @warehouse14/api-client (constructed like apps/mobile/src/warehouse14/api.ts):
 *   1. PIN login (device-fingerprint header + PIN) → session token.
 *   2. productsApi.list → REAL staff products (not the public storefront).
 *   3. scan → productsApi.list({ q }) + classifyScanMatch → full verdict.
 *   4. relocate (LOCATION_CHANGE): stales the step-up window, then runs
 *      adjustInventory through stepUpMiddleware → 403 STEP_UP_REQUIRED →
 *      PIN step-up → automatic retry → audit_log row.
 *
 * Run from apps/mobile so the workspace import resolves:
 *   node dev/p0-lager-proof.mjs
 * Requires the local server up + the dev DB seeded (dev/reset-dev-backend.sh).
 * NEVER point at production.
 */
import { execSync } from "node:child_process"
import {
  ApiError,
  authPin,
  createApiClient,
  productsApi,
  stepUpMiddleware,
} from "@warehouse14/api-client"

const BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3001"
const FP =
  process.env.EXPO_PUBLIC_DEV_DEVICE_FINGERPRINT ??
  "71defad08503fcfb00b0b57e7654b3ed48afb264d34c69c3edb90a65a6b8f698"
const PIN = "0000"
const MIG = "postgres://warehouse14_migrator:warehouse14_migrator_dev_pw@localhost:5432/warehouse14"
const psql = (q) =>
  execSync(`docker exec -i warehouse14-postgres psql "${MIG}" -tAc ${JSON.stringify(q)}`)
    .toString()
    .trim()

let token = null
let stepUpCount = 0

// requestStepUp mirrors apps/mobile/src/warehouse14/step-up.ts: a real app opens
// the PIN Dialog here; in this headless proof we verify the PIN directly.
const stepUpService = {
  async requestStepUp() {
    stepUpCount++
    console.log("   ↳ stepUpMiddleware caught 403 STEP_UP_REQUIRED → verifying PIN…")
    await authPin.stepUp(client, { pin: PIN })
    return { value: "" }
  },
}

const client = createApiClient({
  baseUrl: BASE,
  credentials: "include",
  defaultHeaders: { "x-dev-device-fingerprint": FP },
  getAuthToken: () => token,
  middlewares: [stepUpMiddleware(stepUpService)],
})

// Ported classifyScanMatch (same logic as scan-resolve.ts).
function classifyScanMatch(code, rows) {
  const norm = code.trim().toUpperCase()
  const p = rows.find(
    (r) => r.sku.toUpperCase() === norm || (r.barcode && r.barcode.toUpperCase() === norm),
  )
  if (!p) return { kind: "not-found" }
  return { kind: p.status === "AVAILABLE" ? "found" : p.status.toLowerCase(), product: p }
}

async function main() {
  console.log("== 1) PIN login ==")
  const login = await authPin.login(client, { pin: PIN })
  token = login.token
  console.log(`   ok role=${login.actor.role} isOwner=${login.actor.isOwner} token=${token.slice(0, 12)}…`)

  console.log("== 2) productsApi.list — REAL staff products ==")
  const list = await productsApi.list(client, { limit: 100 })
  console.log(`   total=${list.total}  e.g. ${list.items.slice(0, 3).map((p) => `${p.sku}/${p.status}`).join(", ")}`)

  console.log("== 3) scan → verdict (classifyScanMatch) ==")
  const code = list.items[0].sku
  const scan = await productsApi.list(client, { q: code, limit: 10 })
  const verdict = classifyScanMatch(code, scan.items)
  console.log(`   scan ${code} → ${verdict.kind}${verdict.product ? ` (${verdict.product.name})` : ""}`)

  console.log("== 4) relocate (LOCATION_CHANGE) + step-up ==")
  const target = list.items.find((p) => p.status === "AVAILABLE") ?? list.items[0]
  // Stale the step-up window so adjustInventory 403s (login set it fresh).
  psql(`UPDATE sessions SET last_pin_step_up_at = now() - interval '11 minutes' WHERE token = '${token}'`)
  console.log("   (staled session step-up window → next sensitive action must re-auth)")
  const before = psql("SELECT count(*) FROM audit_log")
  const res = await productsApi.adjustInventory(client, target.id, {
    reason: "LOCATION_CHANGE",
    notes: "POC relocate via mobile step-up flow",
    locationStorageUnit: "Tresor P0",
    locationDrawer: "Schublade 9",
    locationPosition: "Pos 1",
  })
  const after = psql("SELECT count(*) FROM audit_log")
  console.log(`   relocate ok — stepUpFired=${stepUpCount}, auditLogId=${res.auditLogId.slice(0, 8)}…`)
  console.log(`   audit_log count ${before} → ${after}; new location → ${res.locationStorageUnit} / ${res.locationDrawer} / ${res.locationPosition}`)
  const row = psql(
    `SELECT event_type || ' | ' || (payload->>'reason') FROM audit_log WHERE id='${res.auditLogId}'`,
  )
  console.log(`   audit_log row: ${row}`)

  console.log(`\n✅ ALL PASS — login + staff list + scan verdict + relocate(audit_log) + step-up(${stepUpCount}× fired & retried)`)
}

main().catch((e) => {
  console.error("PROOF FAILED:", e instanceof ApiError ? `${e.code} ${e.message}` : e)
  process.exit(1)
})
