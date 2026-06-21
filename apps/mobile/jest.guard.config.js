/**
 * Dedicated config for the GERMAN TEXT DEV GUARD (`test/german-text.test.ts`).
 *
 * The guard tests a PURE module (`src/warehouse14/german-text.ts`) plus the
 * api-client error classes — it needs none of the React-Native / i18n mocks in
 * the shared `test/setup.ts`, and must keep running even while that Ignite-era
 * setup references scaffolding this app no longer ships. So it runs on its own
 * setup file and only matches the guard spec.
 *
 * Run: `pnpm --filter @warehouse14/mobile test:guard`
 *
 * @type {import('@jest/types').Config.ProjectConfig}
 */
module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/test/guard-setup.js"],
  testMatch: ["<rootDir>/test/german-text.test.ts"],
}
