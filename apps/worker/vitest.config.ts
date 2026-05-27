import { defineConfig } from 'vitest/config';

/**
 * Worker integration tests — testcontainer PG, all 17 migrations applied.
 * singleFork shares the container across files within one run.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/server.ts'],
    },
  },
});
