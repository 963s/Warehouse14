/**
 * Custom column types not in drizzle-orm's stock pg-core.
 *
 * Each helper preserves the column's native semantics on the wire (so e.g.
 * citext comparisons are case-insensitive at the DB level) while presenting
 * a familiar TypeScript surface (string for citext, etc.).
 *
 * These are the ONLY non-built-in column types we use. Resist adding more
 * unless a new extension genuinely requires it (e.g. vector for ADR-0016 §6.bis
 * will get its helper here when migration 0006_products lands).
 */

import { customType } from 'drizzle-orm/pg-core';

/**
 * citext — case-insensitive text. Backed by the `citext` extension
 * (enabled in migration 0001_extensions.sql).
 *
 * Use for any user-facing identifier where casing should not matter:
 *   • users.email
 *   • lookup keys typed by humans
 *
 * Comparisons (=, IN, indexed lookups) ignore case; storage preserves the
 * original casing for display.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

/**
 * vector(N) — pgvector column of fixed dimension `length`.
 *
 * Backed by the `vector` extension (enabled in migration 0001_extensions.sql).
 * Used by ADR-0016 §6.bis for product similarity (1536-dim OpenAI embeddings
 * truncated from text-embedding-3-large).
 *
 * Wire format: pgvector accepts `'[1,2,3]'` text and returns the same.
 * TS surface: `number[]`. Converters bridge.
 *
 * @example
 *   embedding: vector(1536)('embedding')
 */
export const vector = (length: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${length})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(',')}]`;
    },
    fromDriver(value: string): number[] {
      // pgvector returns '[1,2,3]' — strip brackets, split, parse.
      return value.slice(1, -1).split(',').map(Number);
    },
  });
