/**
 * The fingerprint is a CONTRACT between two languages: this TypeScript and
 * the SQL staleness clause in the same job. Both must hash byte for byte the
 * same string, or every sweep sees every cached row as stale, retranslates
 * the same batch forever and never reaches the rest of the catalog.
 *
 * That is not hypothetical. A NUL byte once sat where the separating space
 * belongs, invisible in every editor and even to `grep`, which silently
 * treated the whole file as binary and reported no matches at all.
 * Production spent a paid translation call on the same fifteen pairs every
 * five minutes for hours, logged success each time, and translated nothing
 * new.
 *
 * So the hash is pinned to LITERAL CONSTANTS. A constant cannot be corrupted
 * invisibly: change the separator and the expected value stops matching, in
 * CI, long before it reaches production.
 */

import { describe, expect, it } from 'vitest';

import { fingerprint, targetLocales } from '../../src/jobs/product-translator.js';

describe('product translator fingerprint', () => {
  it('joins name and description with exactly one ASCII space', () => {
    // sha256("basel ") truncated to 32 hex characters, computed independently:
    //   printf 'basel ' | shasum -a 256
    expect(fingerprint('basel', null)).toBe('282729814d3ff390b6dabd3cd74514f8');
  });

  it('handles UTF 8 the same way Postgres digest does', () => {
    // printf 'Schl\xc3\xbcssel ' | shasum -a 256
    expect(fingerprint('Schlüssel', '')).toBe('bf87cbc67d99e552be2a96e3f5cb4407');
  });

  it('treats a null and an empty description alike, as SQL coalesce does', () => {
    expect(fingerprint('Schlüssel', null)).toBe(fingerprint('Schlüssel', ''));
  });

  it('changes when the German source changes, which is the whole point', () => {
    expect(fingerprint('Gold', null)).not.toBe(fingerprint('Golde', null));
    expect(fingerprint('Gold', 'Barren')).not.toBe(fingerprint('Gold', null));
  });

  it('is 32 hex characters, matching left(..., 32) in SQL', () => {
    expect(fingerprint('anything', 'at all')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('target locales', () => {
  it('drops German, junk and duplicates', () => {
    expect(targetLocales('en, ar ,de,EN,xxx,,tr')).toEqual(['en', 'ar', 'tr']);
  });
});
