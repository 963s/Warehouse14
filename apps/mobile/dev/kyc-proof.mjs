/**
 * DEV-ONLY end-to-end proof of the SERVER KYC store against the LOCAL dev
 * api-cloud. Mirrors fotos-proof.mjs. Exercises the SAME path the mobile app
 * uses (the keystone `kind:"kyc"` binding → customersApi.addKycDocument):
 *   1. PIN login (Owner basel@warehouse14.local, role ADMIN, PIN 0000).
 *   2. PIN step-up (addKycDocument is ADMIN + step-up gated).
 *   3. Create a throwaway test customer.
 *   4. addKycDocument{ dataBase64, contentType, ...doc fields } → the server
 *      compresses to WebP, computes the sha256, AES-256-GCM-encrypts to a LOCAL
 *      file, and binds a kyc_documents row (never persists the raw upload).
 *   5. psql: the row carries a storage key + a 32-byte sha256 + a non-zero size.
 *   6. getKycDocumentImage → the WebP bytes back through the ADMIN+step-up gate
 *      (the private route — NEVER public; Cache-Control: no-store).
 *   7. cleanup — drop the kyc_documents row + the test customer + the .enc file.
 *
 * Run from apps/mobile (so the workspace import resolves):  node dev/kyc-proof.mjs
 * Needs the dev server up with the KYC env (loadEnv REQUIRES the key now):
 *   KYC_IMAGE_ENCRYPTION_KEY="$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')"
 *   KYC_PHOTOS_DIR="/tmp/w14-kyc"
 * (see dev/reset-dev-backend.sh). NEVER point at production.
 */
import { execSync } from "node:child_process"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { ApiError, authPin, createApiClient, customersApi } from "@warehouse14/api-client"

const BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3001"
const FP =
  process.env.EXPO_PUBLIC_DEV_DEVICE_FINGERPRINT ??
  "71defad08503fcfb00b0b57e7654b3ed48afb264d34c69c3edb90a65a6b8f698"
const KYC_DIR = process.env.KYC_PHOTOS_DIR ?? "/tmp/w14-kyc"
const MIG = "postgres://warehouse14_migrator:warehouse14_migrator_dev_pw@localhost:5432/warehouse14"
const psql = (q) =>
  execSync(`docker exec -i warehouse14-postgres psql "${MIG}" -tAc ${JSON.stringify(q)}`)
    .toString()
    .trim()

// A real (tiny) PNG — the server sharp-decodes + re-encodes to WebP.
const TEST_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"

let token = null
const c = createApiClient({
  baseUrl: BASE,
  defaultHeaders: { "x-dev-device-fingerprint": FP },
  getAuthToken: () => token,
})

async function main() {
  console.log("== 1) PIN login (ADMIN Owner) ==")
  token = (await authPin.login(c, { pin: "0000" })).token
  console.log("   ok")

  console.log("== 2) PIN step-up (addKycDocument is ADMIN + step-up) ==")
  await authPin.stepUp(c, { pin: "0000" })
  console.log("   ok")

  console.log("== 3) create a throwaway test customer ==")
  const created = await customersApi.create(c, {
    fullName: "KYC Proof Person",
    retentionYears: 5,
  })
  const customerId = created.id
  console.log(`   customer ${customerId.slice(0, 8)}… (${created.customerNumber})`)

  console.log("== 4) addKycDocument (server compresses + hashes + AES-256-GCM-encrypts) ==")
  const doc = await customersApi.addKycDocument(c, customerId, {
    dataBase64: TEST_PNG_B64,
    contentType: "image/png",
    documentType: "PERSONALAUSWEIS",
    issuingCountryIso2: "DE",
    documentNumber: "PROOF-12345",
    expiresOn: "2032-01-01",
  })
  console.log(`   docId=${doc.id.slice(0, 8)}… capturedAt=${doc.capturedAt}`)

  console.log("== 5) psql: row has storage key + 32-byte sha256 + non-zero size ==")
  const row = psql(
    `SELECT document_photo_storage_key, octet_length(document_photo_sha256), document_photo_size_bytes FROM kyc_documents WHERE id='${doc.id}'`,
  )
  const [storageKey, shaLen, sizeBytes] = row.split("|")
  console.log(`   storage_key=${storageKey?.slice(0, 8)}… sha_len=${shaLen} size=${sizeBytes}`)
  const rowOk = !!storageKey && shaLen === "32" && Number(sizeBytes) > 0

  console.log("== 6) getKycDocumentImage → WebP bytes (ADMIN + step-up, private) ==")
  const buf = await customersApi.getKycDocumentImage(c, customerId, doc.id)
  const bytes = Buffer.from(buf)
  const isWebp = bytes.subarray(8, 12).toString() === "WEBP"
  console.log(`   ${bytes.length} bytes (WebP magic: ${isWebp})`)

  console.log("== 7) cleanup (row + customer + .enc file) ==")
  psql(`DELETE FROM kyc_documents WHERE id='${doc.id}'`)
  psql(`DELETE FROM customers WHERE id='${customerId}'`)
  if (storageKey) {
    const shard = storageKey.slice(0, 2).toLowerCase()
    try {
      rmSync(join(KYC_DIR, shard, `${storageKey}.enc`), { force: true })
    } catch {
      // best-effort — the dev server may use a different KYC_PHOTOS_DIR.
    }
  }
  console.log(`   remaining proof rows: ${psql(`SELECT count(*) FROM kyc_documents WHERE id='${doc.id}'`)}`)

  const ok = rowOk && bytes.length > 0 && isWebp
  console.log(
    `\n${ok ? "✅" : "❌"} login→step-up→addKycDocument→encrypted-row→serve(WebP) all ${ok ? "PASS" : "FAILED"}`,
  )
  if (!ok) process.exit(1)
}

main().catch((e) => {
  console.error("PROOF FAILED:", e instanceof ApiError ? `${e.code} ${e.message}` : e)
  process.exit(1)
})
