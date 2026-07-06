/**
 * The German text spine has MOVED to the shared, platform-neutral package
 * `@warehouse14/i18n-de` so the desktop cashier and control surface speak
 * through the exact same describeError + enum registries (doctrine a, one
 * source of truth). This thin re-export keeps every existing
 * `@/warehouse14/german-text` import in this app working unchanged.
 *
 * Do not add logic here — edit `packages/i18n-de/src/german-text.ts`.
 */
export * from "@warehouse14/i18n-de"
