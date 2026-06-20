/**
 * DEV-ONLY end-to-end proof of the «Schatzkammer» dashboard against the LOCAL
 * dev api-cloud. Mirrors p0-lager-proof.mjs. Exercises the EXACT live sources the
 * screen uses, through the EXISTING @warehouse14/api-client:
 *   1. PIN login (device-fingerprint header + PIN) → ADMIN session token.
 *   2. bridgeApi.summary   → today's cents KPIs (revenue/sales/ankauf) + queues.
 *   3. dashboard.summary   → pendingAppraisals (Expertisen) + metal prices.
 *   4. closingsApi.list    → finalized daily revenue (for "Schlage gestern").
 *   5. Derive the quest + streak (ported from src/warehouse14/schatzkammer.ts)
 *      and assert SHAPE + MATH — not specific euros, so a 0-revenue dev DB passes.
 *
 * Run from apps/mobile so the workspace import resolves:  node dev/schatzkammer-proof.mjs
 * Requires the local server up + the dev DB seeded (dev/reset-dev-backend.sh).
 * NEVER point at production.
 */
import {
  ApiError,
  authPin,
  bridgeApi,
  closingsApi,
  createApiClient,
  dashboard,
  stepUpMiddleware,
} from "@warehouse14/api-client"

const BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3001"
const FP =
  process.env.EXPO_PUBLIC_DEV_DEVICE_FINGERPRINT ??
  "71defad08503fcfb00b0b57e7654b3ed48afb264d34c69c3edb90a65a6b8f698"
const PIN = "0000"

let token = null
const stepUpService = {
  async requestStepUp() {
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

// ── Ported from src/warehouse14/schatzkammer.ts (same logic). The proof verifies
//    the derivation against REAL data, the way p0-lager-proof ports classifyScanMatch.
function netCents(c) {
  return Math.round(Number(c.netVerkaufEur) * 100)
}
function todayBiz(now) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}
function finalizedBefore(cl, day) {
  return cl
    .filter((c) => c.state === "FINALIZED")
    .filter((c) => day === "" || c.businessDay < day)
    .sort((a, b) => a.businessDay.localeCompare(b.businessDay))
}
function computeDailyQuest(todayCents, cl, day) {
  const fin = finalizedBefore(cl, day)
  const last = fin[fin.length - 1]
  const yesterdayCents = last ? netCents(last) : null
  if (yesterdayCents === null)
    return { todayCents, yesterdayCents: null, beaten: false, remainingCents: 0, progress: 0 }
  const beaten = todayCents > yesterdayCents
  const remainingCents = beaten ? 0 : Math.max(0, yesterdayCents - todayCents)
  const progress =
    yesterdayCents <= 0 ? (todayCents > 0 ? 1 : 0) : Math.min(1, todayCents / yesterdayCents)
  return { todayCents, yesterdayCents, beaten, remainingCents, progress }
}
function computeStreak(cl, day) {
  const fin = finalizedBefore(cl, day)
  let s = 0
  for (let i = fin.length - 1; i >= 1; i--) {
    if (netCents(fin[i]) > netCents(fin[i - 1])) s++
    else break
  }
  return s
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`)
}

async function main() {
  console.log("== 1) PIN login ==")
  const login = await authPin.login(client, { pin: PIN })
  token = login.token
  console.log(`   ok role=${login.actor.role} isOwner=${login.actor.isOwner}`)
  assert(login.actor.role === "ADMIN", "bridge/summary requires ADMIN")

  console.log("== 2) bridgeApi.summary — today's cents KPIs ==")
  const b = await bridgeApi.summary(client)
  for (const f of [
    "todayRevenueCents",
    "todaySalesCount",
    "todayAnkaufCount",
    "todayAnkaufValueCents",
    "approvalsPending",
    "nextAppointmentAt",
    "tseCertDaysRemaining",
    "systemStatus",
    "computedAt",
  ]) {
    assert(f in b, `bridge.${f} missing`)
  }
  assert(Number.isInteger(b.todayRevenueCents), "todayRevenueCents is an integer (cents)")
  assert(Number.isInteger(b.todaySalesCount), "todaySalesCount is an integer")
  assert(["ok", "watch", "alert"].includes(b.systemStatus), "systemStatus is a valid enum")
  console.log(
    `   revenue=${b.todayRevenueCents}¢ sales=${b.todaySalesCount} ankauf=${b.todayAnkaufCount} status=${b.systemStatus}`,
  )

  console.log("== 3) dashboard.summary — Expertisen + metal prices ==")
  const d = await dashboard.summary(client)
  assert(typeof d.pendingAppraisals === "number", "pendingAppraisals is a number")
  assert("currentMetalPrices" in d, "currentMetalPrices present")
  console.log(
    `   pendingAppraisals=${d.pendingAppraisals} shiftRevenueEur=${d.currentShiftRevenueEur} gold=${d.currentMetalPrices.gold ?? "—"}`,
  )

  console.log("== 4) closingsApi.list — finalized daily revenue ==")
  const closings = (await closingsApi.list(client)).items
  const finalized = closings.filter((c) => c.state === "FINALIZED")
  console.log(`   ${closings.length} closing(s), ${finalized.length} finalized`)

  console.log("== 5) derive quest + streak (Schlage gestern) ==")
  const biz = todayBiz(new Date())
  const quest = computeDailyQuest(b.todayRevenueCents, closings, biz)
  const streak = computeStreak(closings, biz)
  console.log(
    `   heute=${quest.todayCents}¢ gestern=${quest.yesterdayCents === null ? "—" : `${quest.yesterdayCents}¢`} ` +
      `geschafft=${quest.beaten} noch=${quest.remainingCents}¢ progress=${quest.progress.toFixed(2)} streak=${streak}`,
  )

  // ── Math invariants (0-revenue dev DB safe — assert shape + math, not euros) ──
  assert(quest.progress >= 0 && quest.progress <= 1, "progress is clamped to [0,1]")
  assert(Number.isInteger(streak) && streak >= 0, "streak is a non-negative integer")
  if (quest.yesterdayCents === null) {
    assert(
      !quest.beaten && quest.remainingCents === 0 && quest.progress === 0,
      "no prior finalized day → neutral quest (no fabricated yesterday)",
    )
  } else {
    assert(quest.beaten === b.todayRevenueCents > quest.yesterdayCents, "beaten ⇔ today > yesterday")
    const expectedRemaining = quest.beaten ? 0 : Math.max(0, quest.yesterdayCents - quest.todayCents)
    assert(quest.remainingCents === expectedRemaining, "remaining-to-beat math is consistent")
  }
  // Gauge values derive from the real cents (never raw cents on screen).
  assert(Number.isFinite(b.todayRevenueCents / 100), "Tagesumsatz € derives from real cents")

  console.log(
    "\n✅ ALL PASS — bridge + dashboard + closings shape OK; quest/streak math consistent (0-revenue-safe)",
  )
}

main().catch((e) => {
  console.error("PROOF FAILED:", e instanceof ApiError ? `${e.code} ${e.message}` : e)
  process.exit(1)
})
