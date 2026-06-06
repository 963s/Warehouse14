import { defineConfig } from 'vitest/config';

/**
 * Vitest for @warehouse14/ui-kit — behaviour-level component tests in jsdom.
 *
 * These prove the REAL accessibility + interaction contract of the shared
 * primitives (focus trap, focus restore, ESC / backdrop close, aria wiring,
 * Field error linkage) — not snapshots, not self-consistency.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
