/**
 * DEV-ONLY end-to-end proof of the photo pipeline against the LOCAL dev
 * api-cloud. Mirrors p0-lager-proof.mjs. Exercises the SAME path the app uses
 * (photosApi.uploadDirect — server-side LOCAL store, no R2):
 *   1. PIN login.
 *   2. Write a TEST IMAGE FILE, read it → base64 (mirrors camera takePhoto →
 *      file → base64; the live camera capture is device-HIL).
 *   3. uploadDirect{productId, isPrimary} → bind a product_photos row (server
 *      strips EXIF, compresses to WebP, never persists the raw).
 *   4. GET the PUBLIC /api/photos/:id/raw → WebP bytes (no auth needed).
 *   5. listForProduct shows it as primary.
 *   6. setPrimary on a 2nd photo → the primary flips.
 *   7. cleanup — delete the test photos (FK-safe) so reruns stay deterministic.
 *
 * Run from apps/mobile (so the workspace import resolves):  node dev/fotos-proof.mjs
 * Needs the dev server up with a WRITABLE PHOTOS_DIR + dev PHOTOS_PUBLIC_BASE_URL
 * (see dev/reset-dev-backend.sh). NEVER point at production.
 */
import { execSync } from "node:child_process"
import { writeFileSync, readFileSync } from "node:fs"
import { authPin, createApiClient, photosApi, productsApi, ApiError } from "@warehouse14/api-client"

const BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3001"
const FP =
  process.env.EXPO_PUBLIC_DEV_DEVICE_FINGERPRINT ??
  "71defad08503fcfb00b0b57e7654b3ed48afb264d34c69c3edb90a65a6b8f698"
const MIG = "postgres://warehouse14_migrator:warehouse14_migrator_dev_pw@localhost:5432/warehouse14"
const psql = (q) =>
  execSync(`docker exec -i warehouse14-postgres psql "${MIG}" -tAc ${JSON.stringify(q)}`).toString().trim()
function deleteProductPhotos(productId) {
  // FK-safe: workflow events reference the photo rows.
  psql(
    `DELETE FROM product_photo_workflow_events WHERE product_photo_id IN (SELECT id FROM product_photos WHERE product_id='${productId}'); DELETE FROM product_photos WHERE product_id='${productId}'`,
  )
}

let token = null
const c = createApiClient({
  baseUrl: BASE,
  defaultHeaders: { "x-dev-device-fingerprint": FP },
  getAuthToken: () => token,
})

// A real (tiny) PNG written to disk, to mirror the camera→file→base64 flow.
const TEST_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
const TEST_FILE = "/tmp/w14-fotos-test.png"

async function uploadFromFile(productId, isPrimary) {
  const dataBase64 = readFileSync(TEST_FILE).toString("base64")
  return photosApi.uploadDirect(c, {
    dataBase64,
    contentType: "image/png",
    productId,
    intent: "product",
    isPrimary,
  })
}

async function main() {
  console.log("== 1) PIN login ==")
  token = (await authPin.login(c, { pin: "0000" })).token
  console.log("   ok")

  const pid = (await productsApi.list(c, { limit: 1 })).items[0].id
  deleteProductPhotos(pid) // deterministic start
  writeFileSync(TEST_FILE, Buffer.from(TEST_PNG_B64, "base64"))
  console.log(`== 2) test image FILE written (${TEST_FILE}) bound to product ${pid.slice(0, 8)}… ==`)

  console.log("== 3) uploadDirect (LOCAL store; server strips EXIF + WebP) ==")
  const p1 = await uploadFromFile(pid, true)
  console.log(`   photoId=${p1.id.slice(0, 8)}… productId=${p1.productId.slice(0, 8)}… publicUrl=${p1.publicUrl}`)

  console.log("== 4) GET public /api/photos/:id/raw (no auth) ==")
  const raw = await fetch(p1.publicUrl)
  const bytes = Buffer.from(await raw.arrayBuffer())
  console.log(`   ${raw.status} ${raw.headers.get("content-type")} ${bytes.length} bytes (WebP magic: ${bytes.slice(8, 12).toString() === "WEBP"})`)

  console.log("== 5) listForProduct shows it primary ==")
  let list = await photosApi.listForProduct(c, pid)
  console.log(`   ${list.items.length} photo(s); primary=${list.items.find((x) => x.isPrimary)?.id.slice(0, 8)}…`)

  console.log("== 6) setPrimary flips to a 2nd photo ==")
  const p2 = await uploadFromFile(pid, false)
  await photosApi.setPrimary(c, p2.id)
  list = await photosApi.listForProduct(c, pid)
  const primary = list.items.find((x) => x.isPrimary)?.id
  console.log(`   uploaded 2nd ${p2.id.slice(0, 8)}…; primary now ${primary?.slice(0, 8)}… (== 2nd: ${primary === p2.id})`)

  console.log("== 7) cleanup test photos ==")
  deleteProductPhotos(pid)
  console.log(`   remaining photos on product: ${psql(`SELECT count(*) FROM product_photos WHERE product_id='${pid}'`)}`)

  const ok = raw.status === 200 && bytes.slice(8, 12).toString() === "WEBP" && primary === p2.id
  console.log(`\n${ok ? "✅" : "❌"} upload→bind→serve(WebP)→list→setPrimary all ${ok ? "PASS" : "FAILED"}`)
  if (!ok) process.exit(1)
}

main().catch((e) => {
  console.error("PROOF FAILED:", e instanceof ApiError ? `${e.code} ${e.message}` : e)
  process.exit(1)
})
