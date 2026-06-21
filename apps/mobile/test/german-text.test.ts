/**
 * DEV GUARD — the purification test.
 *
 * Hard owner rule: NO underscore character, NO raw SCREAMING_SNAKE code, and NO
 * English developer string may EVER reach a rendered UI Text, label, badge,
 * toast, or error. This test is the tripwire. It FAILS the build if:
 *
 *   1. Any value in the central enum/status label registry contains an
 *      underscore or reads as an ALLCAPS code token (a leaked enum value).
 *   2. `describeError` — driven through EVERY `ApiErrorCode`, the CONFLICT
 *      constraint tokens, the ajv 400 field paths, and the network failures —
 *      ever returns a string carrying an underscore, an ALLCAPS code token, or
 *      the raw English wire text it was handed.
 *   3. Any German label module source (`*-ui.ts`) holds a string literal with a
 *      bare underscore that could ship to a surface.
 *
 * The first two run against the REAL produced strings at runtime — the truest
 * possible check. The third is a static backstop over the label sources.
 */
import { ApiError, ApiNetworkError, TimeoutError } from "@warehouse14/api-client"
import { execSync } from "child_process"
import { readFileSync } from "fs"
import { join } from "path"

import {
  ACTOR_ROLE_LABEL,
  ANKAUF_CONDITION_LABEL,
  ANKAUF_ITEM_TYPE_LABEL,
  ANKAUF_METAL_LABEL,
  ANKAUF_PAYOUT_METHOD_LABEL,
  APPOINTMENT_NEXT_STATUS_LABEL,
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_TYPE_LABEL,
  BELEGTEXT_KIND_LABEL,
  CUSTOMER_KYC_STATUS_LABEL,
  CUSTOMER_LANGUAGE_LABEL,
  CUSTOMER_TRUST_LEVEL_LABEL,
  DOCUMENT_CATEGORY_LABEL,
  EBAY_STATE_LABEL,
  PAYMENT_METHOD_LABEL,
  PRODUCT_STATUS_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  TAX_TREATMENT_LABEL,
  TRANSACTION_DIRECTION_LABEL,
  WHATSAPP_DIRECTION_LABEL,
  WHATSAPP_OUTBOUND_STATUS_LABEL,
  describeError,
} from "../src/warehouse14/german-text"

// ── Reinheits-Prüfer ──────────────────────────────────────────────────────────

/** A standalone ALLCAPS code token like KYC_REQUIRED, IN_PROGRESS, SOLD. Two+
 *  uppercase letters, optionally joined by underscores/digits, on a word
 *  boundary. "VIP" and "USt-IdNr." and "§25a" are real German — see allow-list. */
const CODE_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\b[A-Z]{3,}\b/

/** German UI strings that legitimately contain an all-caps run (a brand, an
 *  abbreviation, a legal term) — NOT a leaked enum. Kept tight on purpose. */
const ALLOWED_ALLCAPS = new Set([
  "VIP", // Vertrauensstufe (a real German loanword on the badge)
  "PIN", // "PIN gesperrt", "PIN-Bestätigung"
  "USt", // USt-IdNr.
  "IdNr", // USt-IdNr.
  "KYC", // GwG vocabulary the owner knows
  "GoBD", // legal term
  "Min", // "in 5 Min."
])

function offendingAllcaps(s: string): string | null {
  // Strip the accepted all-caps words, then see if any ALLCAPS run survives.
  let rest = s
  for (const ok of ALLOWED_ALLCAPS) rest = rest.split(ok).join(" ")
  const m = rest.match(CODE_TOKEN)
  return m ? m[0] : null
}

function assertCleanGerman(label: string, context: string): void {
  // Check the BARE rendered string only — `context` is a test-side label that
  // may itself name a SCREAMING_SNAKE code (e.g. "describeError(PIN_LOCKED)").
  if (label.includes("_")) {
    throw new Error(`Underscore in rendered string (${context}): "${label}"`)
  }
  const leak = offendingAllcaps(label)
  if (leak) {
    throw new Error(`Leaked code token "${leak}" in rendered string (${context}): "${label}"`)
  }
}

// ── 1 · Register: jedes Label ist sauberes Deutsch ────────────────────────────

const REGISTRIES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  PRODUCT_STATUS_LABEL,
  TASK_STATUS_LABEL,
  TASK_PRIORITY_LABEL,
  APPOINTMENT_TYPE_LABEL,
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_NEXT_STATUS_LABEL,
  CUSTOMER_KYC_STATUS_LABEL,
  CUSTOMER_TRUST_LEVEL_LABEL,
  CUSTOMER_LANGUAGE_LABEL,
  ACTOR_ROLE_LABEL,
  DOCUMENT_CATEGORY_LABEL,
  EBAY_STATE_LABEL,
  WHATSAPP_DIRECTION_LABEL,
  WHATSAPP_OUTBOUND_STATUS_LABEL,
  TRANSACTION_DIRECTION_LABEL,
  PAYMENT_METHOD_LABEL,
  ANKAUF_PAYOUT_METHOD_LABEL,
  ANKAUF_ITEM_TYPE_LABEL,
  ANKAUF_METAL_LABEL,
  ANKAUF_CONDITION_LABEL,
  TAX_TREATMENT_LABEL,
  BELEGTEXT_KIND_LABEL,
}

describe("german-text · enum/status registry", () => {
  for (const [name, registry] of Object.entries(REGISTRIES)) {
    test(`${name} values are clean German`, () => {
      const entries = Object.entries(registry)
      expect(entries.length).toBeGreaterThan(0)
      for (const [key, label] of entries) {
        expect(label.length).toBeGreaterThan(0)
        // The label must never just echo its own SCREAMING_SNAKE key — unless
        // the key IS clean German on its own (e.g. "VIP", a real loanword on
        // the Vertrauensstufe badge), in which case echoing it is correct.
        if (!ALLOWED_ALLCAPS.has(label)) {
          expect(label).not.toBe(key)
        }
        assertCleanGerman(label, `${name}.${key}`)
      }
    })
  }
})

// ── 2 · describeError: jeder Code → sauberes, handlungsleitendes Deutsch ───────

/** Every stable backend `ApiErrorCode` — mirrors error-handler.ts. If the
 *  backend adds a code, add it here and the test forces a German line for it. */
const ALL_ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "STEP_UP_REQUIRED",
  "PIN_LOCKED",
  "CONFLICT",
  "SANCTIONS_BLOCK",
  "KYC_REQUIRED",
  "CLOSING_DAY_FINALIZED",
  "STORNO_OF_STORNO",
  "PRODUCT_NOT_RESERVABLE",
  "DEVICE_NOT_AUTHORIZED",
  "RATE_LIMITED",
  "EXTERNAL_SERVICE_FAILED",
  "INTERNAL_ERROR",
] as const

function apiError(
  code: (typeof ALL_ERROR_CODES)[number],
  message: string,
  details?: unknown,
): ApiError {
  return new ApiError({ code, message, httpStatus: 400, details })
}

describe("describeError · every backend code maps to clean German", () => {
  // UNAUTHORIZED is the one code whose body the PIN-login route fills with a
  // CLEAN GERMAN message ("Falsche PIN.") that describeError deliberately
  // surfaces — so it is exercised separately, never fed synthetic English.
  const SYNTHETIC_ENGLISH_CODES = ALL_ERROR_CODES.filter((c) => c !== "UNAUTHORIZED")

  test.each(SYNTHETIC_ENGLISH_CODES)("%s → actionable German, no leak", (code) => {
    // Hand it the kind of raw English the backend really sends for this code,
    // so we prove the English is NEVER echoed back.
    const rawEnglish = `Internal trigger: ${code} violated near row 42`
    const out = describeError(apiError(code, rawEnglish))
    expect(out.length).toBeGreaterThan(0)
    expect(out).not.toContain(rawEnglish)
    expect(out).not.toContain("row 42")
    assertCleanGerman(out, `describeError(${code})`)
  })

  test("UNAUTHORIZED surfaces the server's clean German message", () => {
    // The login route sends German here; we pass it through untouched.
    const out = describeError(apiError("UNAUTHORIZED", "Falsche PIN."))
    expect(out).toBe("Falsche PIN.")
    assertCleanGerman(out, "describeError(UNAUTHORIZED)")
    // And with an empty body it still falls back to clean German.
    const fallback = describeError(apiError("UNAUTHORIZED", ""))
    expect(fallback).toBe("Falsche PIN.")
  })

  test("PIN_LOCKED renders a real countdown from details.lockedUntil", () => {
    const inFiveMin = new Date(Date.now() + 5 * 60_000).toISOString()
    const out = describeError(apiError("PIN_LOCKED", "Locked", { lockedUntil: inFiveMin }))
    expect(out).toMatch(/PIN gesperrt/)
    expect(out).toMatch(/Min/)
    assertCleanGerman(out, "describeError(PIN_LOCKED)")
  })

  test("VALIDATION_ERROR names the offending field in German, not ajv English", () => {
    const out = describeError(
      apiError("VALIDATION_ERROR", "body/phone must NOT have fewer than 4 characters", [
        { instancePath: "/phone" },
      ]),
    )
    expect(out).toContain("Telefonnummer")
    expect(out).not.toContain("must NOT")
    assertCleanGerman(out, "describeError(VALIDATION_ERROR)")
  })

  // The CONFLICT branch: each stable Postgres token must produce a distinct,
  // clean German line and never echo the raw constraint name / English.
  const CONFLICT_CASES: ReadonlyArray<{ raw: string; expectIncludes: string }> = [
    {
      raw: 'duplicate key value violates unique constraint "customers_email_blind_index_active_uq"',
      expectIncludes: "E-Mail",
    },
    {
      raw: 'duplicate key value violates unique constraint "customers_phone_blind_index_active_uq"',
      expectIncludes: "Telefonnummer",
    },
    {
      raw: "Invalid appointment status transition: CHECKED_IN → CONFIRMED",
      expectIncludes: "Statuswechsel",
    },
    { raw: "Selected slot is no longer available", expectIncludes: "Slot" },
    {
      raw: 'conflicting key value violates exclusion constraint "appointments_no_staff_overlap"',
      expectIncludes: "Zeit",
    },
    {
      raw: 'violates unique constraint "appointments_one_transaction_link_uq"',
      expectIncludes: "Vorgang",
    },
    {
      raw: 'violates unique constraint "transactions_one_storno_per_original_uq"',
      expectIncludes: "storniert",
    },
    { raw: 'Slug "gold" already exists.', expectIncludes: "Kurznamen" },
    { raw: "without a prior physical-ID check on file", expectIncludes: "KYC" },
    {
      raw: 'Category "Gold" is assigned to 3 product(s). Unassign first.',
      expectIncludes: "3 Artikeln",
    },
    {
      raw: 'Category "Gold" has 2 subcategory/-ies. Delete or re-parent first.',
      expectIncludes: "2 Untersammlungen",
    },
    {
      raw: "some unrecognised english conflict we have never seen",
      expectIncludes: "aktualisieren",
    },
  ]
  test.each(CONFLICT_CASES)("CONFLICT %# maps token → clean German", ({ raw, expectIncludes }) => {
    const out = describeError(apiError("CONFLICT", raw))
    expect(out).toContain(expectIncludes)
    expect(out).not.toContain(raw)
    assertCleanGerman(out, `describeError(CONFLICT: ${raw.slice(0, 24)})`)
  })

  test("network + timeout + unknown errors stay clean German", () => {
    const offline = describeError(new ApiNetworkError("Network request failed"))
    expect(offline).toContain("Verbindung")
    assertCleanGerman(offline, "describeError(offline)")

    const timeout = describeError(new ApiNetworkError("timeout", new TimeoutError("timed out")))
    expect(timeout).toContain("Zeitüberschreitung")
    assertCleanGerman(timeout, "describeError(timeout)")

    const weird = describeError(new Error("TypeError: undefined is not a function"))
    expect(weird).not.toContain("TypeError")
    assertCleanGerman(weird, "describeError(unknown)")
  })
})

// ── 3 · Statische Quell-Prüfung: kein nacktes "_" in Label-Modulen ────────────

describe("german-text · label-module sources carry no underscore strings", () => {
  test("no rendered-text field holds an underscore string in any label module", () => {
    const root = join(__dirname, "..", "src", "warehouse14")
    // Every German label module whose string literals can ship to a surface.
    const files = execSync(`ls ${root}/*-ui.ts ${root}/german-text.ts`, {
      encoding: "utf8",
    })
      .trim()
      .split("\n")

    // The object-property keys whose VALUE is rendered into a UI <Text> — a
    // German sentence. An underscore in any of THESE is a developer-string leak.
    // We deliberately do NOT scan `value:` / `outcome:` / `category:` / `token:`
    // / union-type members: those carry backend ENUM TOKENS on purpose (a
    // <Picker> option's wire value, a status discriminant, a constraint token we
    // MATCH on) and never reach a <Text> as prose.
    const RENDERED_FIELD =
      /\b(?:label|title|message|description|hint|body|placeholder|cta|helper|subtitle|caption|text|name)\s*:\s*"([^"]*_[^"]*)"/g

    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, "utf8")
      const lines = src.split("\n")
      lines.forEach((line, i) => {
        // Skip comment lines — prose about tokens, not rendered.
        if (/^\s*\*|^\s*\/\//.test(line)) return
        for (const m of line.matchAll(RENDERED_FIELD)) {
          offenders.push(`${file}:${i + 1}  ${m[0]}`)
        }
      })
    }
    if (offenders.length) {
      throw new Error(
        "Underscore-bearing rendered-text literal(s) found — leak risk:\n" + offenders.join("\n"),
      )
    }
  })
})
