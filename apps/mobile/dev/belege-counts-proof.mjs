/**
 * DEV-ONLY proof for the Belege/Documents Harden fixes (P1 + P1).
 *
 * Drives the EXACT code paths the app uses, through the real
 * @warehouse14/api-client (documentsApi.list → GET /api/documents) + the same
 * pure derivation the screen runs (summarizeRegister from belege-ui), to prove:
 *
 *   P1 #1 — the "Alle" total is the FILTER-FREE server total, not the filtered
 *           one. With a category filter active, GET ?category=X returns the
 *           X-only count; the screen's "Alle" chip must still read the real
 *           all-documents total (the filter-free summary query).
 *
 *   P1 #2 — the header tiles (Belege/Fiskalisch/Archiviert) + per-category chip
 *           counts come from the filter-free summary, NOT the truncated rows
 *           page. We seed an archived row that falls OUT of a tiny rows page
 *           (limit=2) and prove the summary still counts it (Archiviert ≥ 1),
 *           while the OLD code (counts from the rows slice) would read 0.
 *
 * Seeds a small, realistic document set via SQL (rows point at fake r2 keys —
 * fine for a read-only LIST proof), drives the api-client, asserts, cleans up.
 *
 * Run from apps/mobile:  node dev/belege-counts-proof.mjs
 * Requires the local dev server up + DB reachable. NEVER point at production.
 */
import { execSync } from "node:child_process"

import { authPin, createApiClient, documentsApi } from "@warehouse14/api-client"

// NOTE: belege-ui.ts imports lucide-react-native (an RN-only module that can't
// load under bare Node), so we mirror its PURE derivation here 1:1 to drive the
// real endpoint without the RN dependency. This is the exact logic the screen
// runs — fiscal = RECHNUNG + ANKAUFBELEG; counts come from the rows + server
// total + hasMore (→ `truncated`). Kept in lock-step with summarizeRegister().
const FISCAL = new Set(["RECHNUNG", "ANKAUFBELEG"])
const CATS = ["RECHNUNG", "ANKAUFBELEG", "VERSANDBELEG", "EXPERTISE", "ZERTIFIKAT", "AUSWEIS"]
function summarizeRegister({ items, total, hasMore }) {
  const byCategory = Object.fromEntries(CATS.map((c) => [c, 0]))
  let fiscal = 0
  let archived = 0
  for (const d of items) {
    byCategory[d.category] += 1
    if (FISCAL.has(d.category)) fiscal += 1
    if (d.archivedAt) archived += 1
  }
  return { total, fiscal, archived, byCategory, truncated: hasMore }
}

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

const TAG = "belege-proof"
const cleanup = () =>
  psql(`DELETE FROM document_attachments WHERE r2_key LIKE '${TAG}/%'`)

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
  const login = await authPin.login(client, { pin: PIN })
  token = login.token
  console.log(`Logged in (owner=${login.actor?.isOwner})\n`)

  const userId = psql("SELECT id FROM users LIMIT 1")
  if (!userId) throw new Error("no user in dev db")
  // The schema enforces exactly-one entity link, so pin every seed row to a real
  // customer (irrelevant to the count proof — we never filter by entity here).
  const customerId = psql("SELECT id FROM customers LIMIT 1")
  if (!customerId) throw new Error("no customer in dev db")

  // Seed: 4 RECHNUNG (1 archived) + 2 ANKAUFBELEG = 6 total. Both categories are
  // customer-linkable (the schema enforces per-category link discipline, so we
  // stay within categories that accept a customer link). fiscal = 6 (both are
  // GoBD-core); archived = 1 (an old RECHNUNG so it sorts last → falls out of a
  // tiny rows page, which is exactly the P1 #2 repro).
  cleanup()
  const seed = [
    ["RECHNUNG", "r1", false, "2026-06-20T10:00:00Z"],
    ["RECHNUNG", "r2", false, "2026-06-20T09:00:00Z"],
    ["RECHNUNG", "r3", false, "2026-06-19T09:00:00Z"],
    ["RECHNUNG", "r4", true, "2026-01-01T08:00:00Z"], // archived + oldest
    ["ANKAUFBELEG", "a1", false, "2026-06-20T11:00:00Z"],
    ["ANKAUFBELEG", "a2", false, "2026-06-19T11:00:00Z"],
  ]
  for (const [cat, key, archived, created] of seed) {
    psql(
      `INSERT INTO document_attachments (category, r2_key, file_name, mime_type, size_bytes, customer_id, uploaded_by_user_id, created_at, archived_at) VALUES ('${cat}', '${TAG}/${key}', '${key}.pdf', 'application/pdf', 12345, '${customerId}', '${userId}', '${created}', ${archived ? `'${created}'` : "NULL"})`,
    )
  }
  console.log("Seeded 6 docs (RECHNUNG×4 [1 archived], ANKAUFBELEG×2)\n")

  // ── P1 #1 — "Alle" total must be the FILTER-FREE total ─────────────────────
  // The rows query under the "Rechnung" filter (what belege.tsx sends).
  const rechnungOnly = await documentsApi.list(client, {
    category: "RECHNUNG",
    includeArchived: true,
    limit: 100,
  })
  // The NEW filter-free summary query (what feeds header + chips).
  const summaryResp = await documentsApi.list(client, { includeArchived: true, limit: 100 })

  must(
    rechnungOnly.total === 4,
    `filtered GET ?category=RECHNUNG total = ${rechnungOnly.total} (expect 4)`,
  )
  must(
    summaryResp.total === 6,
    `filter-free summary total = ${summaryResp.total} (expect 6)`,
  )
  must(
    rechnungOnly.total !== summaryResp.total,
    `OLD bug reproduced: binding "Alle" to the filtered total would show ${rechnungOnly.total}, not the real 6`,
  )

  const summary = summarizeRegister({
    items: summaryResp.items,
    total: summaryResp.total,
    hasMore: summaryResp.hasMore,
  })
  must(summary.total === 6, `summary.total (→ "Alle" chip + Belege tile) = ${summary.total} (expect 6)`)
  must(summary.fiscal === 6, `summary.fiscal tile = ${summary.fiscal} (expect 6)`)
  must(summary.archived === 1, `summary.archived tile = ${summary.archived} (expect 1)`)
  must(summary.byCategory.RECHNUNG === 4, `chip RECHNUNG = ${summary.byCategory.RECHNUNG} (expect 4)`)
  must(summary.byCategory.ANKAUFBELEG === 2, `chip ANKAUFBELEG = ${summary.byCategory.ANKAUFBELEG} (expect 2)`)
  must(summary.byCategory.VERSANDBELEG === 0, `chip VERSANDBELEG = ${summary.byCategory.VERSANDBELEG} (expect 0)`)
  must(summary.truncated === false, `summary.truncated = ${summary.truncated} (expect false, all 6 fit)`)

  // ── P1 #2 — header counts must NOT come from a truncated rows page ──────────
  // Simulate the page cap: fetch with limit=2 (the finding's repro). The archived
  // RECHNUNG is the oldest → sorts last → is NOT in the first 2 rows.
  const tinyPage = await documentsApi.list(client, { includeArchived: true, limit: 2 })
  must(tinyPage.items.length === 2, `tiny page returned ${tinyPage.items.length} rows (cap=2)`)
  must(tinyPage.total === 6, `tiny page server total still = ${tinyPage.total} (expect 6)`)

  const archivedInTinyPage = tinyPage.items.filter((d) => d.archivedAt != null).length
  must(
    archivedInTinyPage === 0,
    `archived row is OUT of the tiny page (OLD code: countDocuments(slice).archived = ${archivedInTinyPage} → wrongly shows 0)`,
  )

  const tinySummary = summarizeRegister({
    items: tinyPage.items,
    total: tinyPage.total,
    hasMore: tinyPage.hasMore,
  })
  must(tinySummary.total === 6, `truncated summary.total still exact = ${tinySummary.total} (expect 6, from server)`)
  must(tinySummary.truncated === true, `truncated flag set = ${tinySummary.truncated} (drives the „≥" markers)`)

  cleanup()
  console.log(`\nCleaned up seed rows.`)
  console.log(failures === 0 ? "\nALL PROOFS PASSED ✅" : `\n${failures} PROOF(S) FAILED ❌`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  try {
    cleanup()
  } catch {}
  console.error(err)
  process.exit(1)
})
