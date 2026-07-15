/**
 * MCP tool: `find_customer` — the Jarvis assistant's read-only customer lookup.
 *
 * READ-ONLY. Mutates nothing. Every clause here is copied from the verified
 * `GET /api/customers` search route (routes/customers-list.ts) plus the
 * verified customer-detail decrypt (routes/customers.ts), so the columns +
 * SQL functions are known-good:
 *
 *   • soft-delete filter  `WHERE soft_deleted_at IS NULL`   (customers-list.ts)
 *   • name fragment       `decrypt_pii(full_name_encrypted) ILIKE … ESCAPE`
 *                                                            (customers-list.ts)
 *   • phone fragment      `decrypt_pii(phone_encrypted)`     (customers.ts :id)
 *   • trust level         `trust_level::text`                (both routes)
 *   • recency order       `ORDER BY created_at DESC`         (customers-list.ts)
 *
 * The decrypt happens INSIDE `withPii(...)` so the per-request PII key binding
 * (SET LOCAL, transaction-scoped) is honoured exactly as the HTTP routes do.
 * During an MCP request the key is reachable via the request-context ALS scope,
 * so `withPii(ctx.db, …)` resolves the key the same way `app.withPii(…)` does.
 *
 * PRIVACY
 * ───────
 * Returns ONLY safe fields per match: id, display name, phone, city (see note),
 * trust level, and whether the record is soft-deleted. It NEVER returns KYC
 * scans, ID-document data, birthdate, email, address, or any other sensitive
 * PII. Soft-deleted rows are excluded (mirrors the verified search route), so
 * `softDeleted` is present for contract stability but is false for every match.
 *
 * `city`: the customers table has no structured city column — the only address
 * data is the single encrypted `address_encrypted` blob, which we deliberately
 * do NOT decrypt. `city` is therefore always null.
 *
 * CONTRACT
 * ────────
 * Input:  { query: string }   // a name or phone-number fragment
 * Output: {
 *   query: string,
 *   count: number,
 *   matches: Array<{
 *     id: string,
 *     displayName: string,
 *     phone: string | null,
 *     city: string | null,          // always null — no structured city column
 *     trustLevel: 'NEW'|'VERIFIED'|'VIP'|'SUSPICIOUS'|'BANNED',
 *     softDeleted: boolean,         // always false — soft-deleted rows excluded
 *   }>,
 *   asOf: string,                   // ISO timestamp
 * }
 */

import { type Static, Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';

import { withPii } from '../../lib/pii.js';
import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';

export const FindCustomerArgs = Type.Object({
  query: Type.String({
    minLength: 1,
    maxLength: 120,
    description: 'A name fragment or phone-number fragment to search customers by.',
  }),
});
type FindCustomerArgsType = Static<typeof FindCustomerArgs>;

/** Speakable German label for each operator trust level. */
const TRUST_LABEL_DE: Record<string, string> = {
  NEW: 'Neu',
  VERIFIED: 'Verifiziert',
  VIP: 'VIP',
  SUSPICIOUS: 'Auffällig',
  BANNED: 'Gesperrt',
};

interface CustomerMatch {
  id: string;
  displayName: string;
  phone: string | null;
  city: string | null;
  trustLevel: string;
  softDeleted: boolean;
}

const handler: ToolHandler<FindCustomerArgsType> = async (
  ctx: ToolInvocationContext,
  args: FindCustomerArgsType,
): Promise<ToolResult> => {
  const query = (args.query ?? '').trim();

  // Guard: an empty / whitespace-only query would otherwise scan the whole
  // customer table. Refuse cheaply and ask for a search term.
  if (query.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'Bitte nennen Sie einen Namen oder eine Telefonnummer, um Kunden zu suchen.',
        },
      ],
      data: { query: '', count: 0, matches: [], asOf: new Date().toISOString() },
    };
  }

  // Escaped ILIKE pattern — copied verbatim from routes/customers-list.ts so a
  // typed `%` / `_` / `\` is a literal, not a wildcard.
  const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const rows = await withPii(ctx.db, async (tx) => {
    return await tx.execute<{
      id: string;
      full_name: string;
      phone: string | null;
      trust_level: string;
      soft_deleted: boolean;
    }>(sql`
      SELECT
        id,
        decrypt_pii(full_name_encrypted)      AS full_name,
        decrypt_pii(phone_encrypted)          AS phone,
        trust_level::text                     AS trust_level,
        (soft_deleted_at IS NOT NULL)         AS soft_deleted
      FROM customers
      WHERE soft_deleted_at IS NULL
        AND (
          decrypt_pii(full_name_encrypted) ILIKE ${like} ESCAPE '\\'
          OR decrypt_pii(phone_encrypted)  ILIKE ${like} ESCAPE '\\'
        )
      ORDER BY created_at DESC
      LIMIT 8
    `);
  });

  const list = rows as unknown as Array<Record<string, unknown>>;
  const matches: CustomerMatch[] = list.map((r) => ({
    id: String(r.id),
    displayName: (r.full_name as string | null) ?? '',
    phone: (r.phone as string | null) ?? null,
    // No structured city column exists; the encrypted address blob is not decrypted.
    city: null,
    trustLevel: (r.trust_level as string | null) ?? 'NEW',
    softDeleted: Boolean(r.soft_deleted),
  }));

  const data = {
    query,
    count: matches.length,
    matches,
    asOf: new Date().toISOString(),
  };

  // Compact, speakable German summary. Sie-Form, EUR-free (no money here),
  // never inventing numbers — it only restates the rows found.
  let summary: string;
  if (matches.length === 0) {
    summary = 'Keine Kunden zu Ihrer Suche gefunden.';
  } else {
    const parts = matches.map((m) => {
      const name = m.displayName || 'Ohne Namen';
      const phonePart = m.phone ? `Telefon ${m.phone}` : 'keine Telefonnummer';
      const trust = TRUST_LABEL_DE[m.trustLevel] ?? m.trustLevel;
      return `${name} (${phonePart}, Vertrauensstufe ${trust})`;
    });
    const noun = matches.length === 1 ? 'Kunde' : 'Kunden';
    summary = `${matches.length} ${noun} gefunden: ${parts.join('; ')}.`;
  }

  return {
    content: [{ type: 'text', text: summary }],
    data,
  };
};

export const findCustomerTool: ToolRegistration = {
  manifest: {
    name: 'find_customer',
    description:
      'READ-ONLY. Search customers by a name fragment or phone-number fragment and return up to 8 ' +
      'matches, each with id, display name, phone, trust level, and whether the record is soft-deleted. ' +
      'Call this when the operator wants to find or look up a customer by name or phone. Returns NO ' +
      'KYC scans, ID-document data, birthdate, email, or address. Mutates nothing.',
    inputSchema: FindCustomerArgs,
    requiredRoles: ['ADMIN'],
    isMutation: false,
    // Read-only lookup, ADMIN-scoped, minimal PII (name/phone only) — the
    // assistant may call it to help the operator find a customer.
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
