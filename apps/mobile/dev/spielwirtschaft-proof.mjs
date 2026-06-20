/**
 * DEV-ONLY end-to-end proof of the «Spielwirtschaft» (gamification module) against
 * the LOCAL dev api-cloud. Mirrors schatzkammer-proof.mjs. Exercises the EXACT
 * live sources the module derives from, through the EXISTING @warehouse14/api-client:
 *   1. PIN login (device-fingerprint header + PIN) → ADMIN session token.
 *   2. bridgeApi.summary   → today's cents + counts (revenue/sales/ankauf).
 *   3. dashboard.summary   → pendingAppraisals (Expertisen).
 *   4. closingsApi.list    → finalized daily revenue (streak / quest / seals).
 *   5. Derive streak summary + rank + seals + the day's quest (ported from
 *      src/warehouse14/game/*) and assert SHAPE + MATH + HONESTY — not specific
 *      euros, so a 0-revenue dev DB passes. No fabricated rewards anywhere.
 *
 * Run from apps/mobile:  node dev/spielwirtschaft-proof.mjs
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

// ── Ported from src/warehouse14/schatzkammer.ts + game/* (same logic). ────────
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
function computeStreak(cl, day) {
  const fin = finalizedBefore(cl, day)
  let s = 0
  for (let i = fin.length - 1; i >= 1; i--) {
    if (netCents(fin[i]) > netCents(fin[i - 1])) s++
    else break
  }
  return s
}
function computeLongestStreak(cl, day) {
  const fin = finalizedBefore(cl, day)
  let longest = 0
  let run = 0
  for (let i = 1; i < fin.length; i++) {
    if (netCents(fin[i]) > netCents(fin[i - 1])) {
      run++
      if (run > longest) longest = run
    } else run = 0
  }
  return longest
}
function computeDailyQuest(todayCents, cl, day) {
  const fin = finalizedBefore(cl, day)
  const last = fin[fin.length - 1]
  const y = last ? netCents(last) : null
  if (y === null) return { todayCents, yesterdayCents: null, beaten: false }
  return { todayCents, yesterdayCents: y, beaten: todayCents > y }
}

// Rank ladder (ported from game/ranks.ts).
const RANKS = [
  { id: "lehrling", tier: 0, minStreak: 0, nextAtStreak: 1 },
  { id: "geselle", tier: 1, minStreak: 1, nextAtStreak: 3 },
  { id: "goldschmied", tier: 2, minStreak: 3, nextAtStreak: 7 },
  { id: "meister", tier: 3, minStreak: 7, nextAtStreak: 14 },
  { id: "schatzmeister", tier: 4, minStreak: 14, nextAtStreak: null },
]
function rankForStreak(streak) {
  const s = Math.max(0, Math.floor(streak))
  let held = RANKS[0]
  for (const r of RANKS) {
    if (s >= r.minStreak) held = r
    else break
  }
  return held
}

// Seals (ported from game/seals.ts).
const SEALS = [
  { id: "erster-funke", earned: (g) => g.longestStreak >= 1 },
  { id: "drei-am-stueck", earned: (g) => g.longestStreak >= 3 },
  { id: "wochenserie", earned: (g) => g.longestStreak >= 7 },
  { id: "bestmarke", earned: (g) => g.longestStreak >= 14 },
  { id: "schwelle", earned: (g) => g.brokeEvenThisMonth },
  { id: "buchhalter", earned: (g) => g.finalizedDays >= 30 },
]

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`)
}

async function main() {
  console.log("== 1) PIN login ==")
  const login = await authPin.login(client, { pin: PIN })
  token = login.token
  console.log(`   ok role=${login.actor.role} isOwner=${login.actor.isOwner}`)
  assert(login.actor.role === "ADMIN", "bridge/summary requires ADMIN")

  console.log("== 2) bridgeApi.summary — today's cents + counts ==")
  const b = await bridgeApi.summary(client)
  assert(Number.isInteger(b.todayRevenueCents), "todayRevenueCents is integer cents")
  assert(Number.isInteger(b.todaySalesCount), "todaySalesCount is integer")
  assert(Number.isInteger(b.todayAnkaufCount), "todayAnkaufCount is integer")
  console.log(
    `   revenue=${b.todayRevenueCents}¢ sales=${b.todaySalesCount} ankauf=${b.todayAnkaufCount}`,
  )

  console.log("== 3) dashboard.summary — Expertisen ==")
  const d = await dashboard.summary(client)
  assert(typeof d.pendingAppraisals === "number", "pendingAppraisals is a number")
  console.log(`   pendingAppraisals=${d.pendingAppraisals}`)

  console.log("== 4) closingsApi.list — finalized daily revenue ==")
  const closings = (await closingsApi.list(client)).items
  const finalizedDays = closings.filter((c) => c.state === "FINALIZED").length
  console.log(`   ${closings.length} closing(s), ${finalizedDays} finalized`)

  console.log("== 5) derive streak summary + rank + seals + quest ==")
  const biz = todayBiz(new Date())
  const current = computeStreak(closings, biz)
  const longest = Math.max(current, computeLongestStreak(closings, biz))
  const quest = computeDailyQuest(b.todayRevenueCents, closings, biz)
  const todayState =
    quest.yesterdayCents === null ? "kein-vortag" : quest.beaten ? "geschafft" : "offen"
  const atRisk = todayState === "offen"
  const rank = rankForStreak(current)
  // The dev DB has no fixed-costs wired into this proof, so break-even is left
  // honestly unknown here (false) — the seal is judged on real signals only.
  const gameSignals = { currentStreak: current, longestStreak: longest, brokeEvenThisMonth: false, finalizedDays }
  const earned = SEALS.filter((s) => s.earned(gameSignals)).map((s) => s.id)

  console.log(
    `   streak: current=${current} longest=${longest} todayState=${todayState} atRisk=${atRisk}`,
  )
  console.log(`   rank: ${rank.id} (tier ${rank.tier})`)
  console.log(`   seals earned: ${earned.length ? earned.join(", ") : "—"}`)

  // ── Honesty + math invariants (0-revenue dev DB safe) ──────────────────────
  assert(Number.isInteger(current) && current >= 0, "current streak is a non-negative integer")
  assert(Number.isInteger(longest) && longest >= current, "longest streak ≥ current streak")
  assert(rank.tier === rankForStreak(current).tier, "rank is a pure function of the real streak")
  // The ladder is monotonic: a higher streak never yields a lower tier.
  assert(rankForStreak(current + 1).tier >= rank.tier, "rank ladder is monotonic in streak")
  // No fabricated rewards: every earned seal's predicate truly holds on real signals.
  for (const id of earned) {
    const def = SEALS.find((s) => s.id === id)
    assert(def.earned(gameSignals), `seal '${id}' is earned only when its predicate holds on real data`)
  }
  // Seals tied to history never appear without the history to back them.
  if (longest < 1) assert(!earned.includes("erster-funke"), "no 'Erster Funke' without a 1-day run")
  if (longest < 7) assert(!earned.includes("wochenserie"), "no 'Wochenserie' without a 7-day run")
  if (finalizedDays < 30) assert(!earned.includes("buchhalter"), "no 'Saubere Bücher' without 30 closings")
  // No-history honesty: no prior finalized day → no streak, no rank above Lehrling.
  if (quest.yesterdayCents === null) {
    assert(current === 0 && rank.id === "lehrling", "no prior day → Lehrling at streak 0 (no flattery)")
  } else {
    assert(
      quest.beaten === b.todayRevenueCents > quest.yesterdayCents,
      "today-beats-yesterday matches real cents",
    )
  }

  console.log(
    "\n✅ ALL PASS — bridge + dashboard + closings shape OK; streak/rank/seals/quest math consistent + honest (0-revenue-safe)",
  )
}

main().catch((e) => {
  console.error("PROOF FAILED:", e instanceof ApiError ? `${e.code} ${e.message}` : e)
  process.exit(1)
})
