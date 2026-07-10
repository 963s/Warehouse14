import { describe, expect, it } from "vitest"

import { centsToDecimalString, expenseCategoryLabel, formatCents, profitSteps } from "./finance-vocab"

describe("formatCents", () => {
  it("renders whole cents as a German euro amount", () => {
    expect(formatCents(123456)).toBe("1.234,56 €")
    expect(formatCents(0)).toBe("0,00 €")
    expect(formatCents(5)).toBe("0,05 €")
  })

  it("keeps the sign of a negative amount", () => {
    expect(formatCents(-999)).toBe("-9,99 €")
  })

  it("never throws on a non-finite input", () => {
    expect(formatCents(Number.NaN)).toBe("0,00 €")
  })
})

describe("centsToDecimalString", () => {
  it("produces the wire format MoneyAmount expects", () => {
    expect(centsToDecimalString(123456)).toBe("1234.56")
    expect(centsToDecimalString(-5)).toBe("-0.05")
  })
})

describe("expenseCategoryLabel", () => {
  it("translates every known category", () => {
    expect(expenseCategoryLabel("WARENEINKAUF")).toBe("Wareneinkauf")
    expect(expenseCategoryLabel("BUEROMATERIAL")).toBe("Büromaterial")
  })

  it("never leaks an unknown raw token", () => {
    expect(expenseCategoryLabel("SOMETHING_NEW")).toBe("Sonstiges")
  })
})

describe("profitSteps", () => {
  const p = {
    grossRevenueCents: 100_000,
    grossAnkaufCents: 30_000,
    expensesCents: 10_000,
    fixedCostsAllocatedCents: 5_000,
    netProfitCents: 55_000,
  }

  it("shows deductions as negative and the result last", () => {
    const steps = profitSteps(p)
    expect(steps.map((s) => s.cents)).toEqual([100_000, -30_000, -10_000, -5_000, 55_000])
    expect(steps.at(-1)?.isResult).toBe(true)
  })

  it("reports the server's net verbatim rather than recomputing it", () => {
    // A server that disagrees with naive arithmetic still wins: we display its number.
    const skewed = { ...p, netProfitCents: 1 }
    expect(profitSteps(skewed).at(-1)?.cents).toBe(1)
  })
})
