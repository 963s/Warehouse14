import { describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/config/env.js';
import { initSentry, isSentryEnabled } from '../../src/lib/sentry.js';

/**
 * Telemetry must be optional + fail-safe (goal constraint): with no DSN the
 * config validates and the telemetry init is a harmless no-op — the path the
 * app exercises on startup before anything else runs.
 */
describe('telemetry is optional + fail-safe', () => {
  it('loads a valid config when SENTRY_DSN is absent', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://warehouse14_app@localhost:5432/warehouse14',
      WAREHOUSE14_PII_KEY: 'test-pii-key-do-not-use-in-production-32b',
    });
    // Absent DSN → empty/undefined, never a thrown validation error.
    expect(env.SENTRY_DSN ?? '').toBe('');
  });

  it('initSentry is a no-op (never throws, stays disabled) without a DSN', () => {
    expect(() => initSentry({ dsn: '' })).not.toThrow();
    expect(initSentry({ dsn: '' })).toBe(false);
    expect(initSentry({})).toBe(false);
    expect(initSentry({ dsn: '   ' })).toBe(false);
    expect(isSentryEnabled()).toBe(false);
  });
});
