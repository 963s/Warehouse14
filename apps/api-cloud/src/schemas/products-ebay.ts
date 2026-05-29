/**
 * TypeBox schemas for the eBay state-machine API surface
 * (Phase 2 Day 2, closes the route gap from Day 24 migration 0022).
 *
 * 9-state lifecycle:
 *   ENTWURF → GEPRUEFT → ONLINE → VERKAUFT → BEZAHLT → VERPACKT → VERSENDET
 *           ↘                 ↘ REKLAMIERT → RETOURNIERT
 *
 * The SECURITY DEFINER trigger from migration 0022 handles the
 * inventory side effect when state enters VERKAUFT/BEZAHLT/VERPACKT/VERSENDET
 * (auto-RESERVE local product via EBAY channel or emit alert). The route
 * only owns the state transition + the event-log row.
 */

import { type Static, Type } from '@sinclair/typebox';

const EBAY_STATE = Type.Union([
  Type.Literal('ENTWURF'),
  Type.Literal('GEPRUEFT'),
  Type.Literal('ONLINE'),
  Type.Literal('VERKAUFT'),
  Type.Literal('BEZAHLT'),
  Type.Literal('VERPACKT'),
  Type.Literal('VERSENDET'),
  Type.Literal('REKLAMIERT'),
  Type.Literal('RETOURNIERT'),
]);

const EBAY_SOURCE = Type.Union([
  Type.Literal('OWNER'),
  Type.Literal('EBAY_WEBHOOK'),
  Type.Literal('WORKER'),
  Type.Literal('SYSTEM'),
]);

export const ProductIdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

// ────────────────────────────────────────────────────────────────────────
// PATCH /api/products/:id/ebay-state
// ────────────────────────────────────────────────────────────────────────

export const TransitionEbayStateBody = Type.Object({
  toState: EBAY_STATE,
  /** Optional eBay order id — populated on / after VERKAUFT. */
  ebayOrderId: Type.Optional(Type.String({ maxLength: 100 })),
  notes: Type.Optional(Type.String({ maxLength: 1000 })),
});

export const TransitionEbayStateResponse = Type.Object({
  productId: Type.String({ format: 'uuid' }),
  fromState: Type.Union([EBAY_STATE, Type.Null()]),
  toState: EBAY_STATE,
  ebayStateChangedAt: Type.String({ format: 'date-time' }),
  /** Inventory side-effect summary — what the trigger did, if anything. */
  inventorySideEffect: Type.Union([
    Type.Literal('AUTO_RESERVED'),
    Type.Literal('IDEMPOTENT_NO_OP'),
    Type.Literal('CONFLICT_LOCAL_RESERVATION'),
    Type.Literal('CONFLICT_LOCAL_SOLD'),
    Type.Literal('NONE'),
  ]),
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/products/:id/ebay-history (paged event log)
// ────────────────────────────────────────────────────────────────────────

export const EbayHistoryQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export const EbayHistoryRow = Type.Object({
  id: Type.String(),
  productId: Type.String({ format: 'uuid' }),
  fromState: Type.Union([EBAY_STATE, Type.Null()]),
  toState: EBAY_STATE,
  changedByUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  changedBySource: EBAY_SOURCE,
  ebayOrderId: Type.Union([Type.String(), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
});

export const EbayHistoryResponse = Type.Object({
  items: Type.Array(EbayHistoryRow),
  total: Type.Integer(),
  limit: Type.Integer(),
  offset: Type.Integer(),
  hasMore: Type.Boolean(),
});

export type TProductIdParams = Static<typeof ProductIdParams>;
export type TTransitionEbayStateBody = Static<typeof TransitionEbayStateBody>;
export type TEbayHistoryQuery = Static<typeof EbayHistoryQuery>;

// ────────────────────────────────────────────────────────────────────────
// Transition table — Owner-defined order, with two branches.
// ────────────────────────────────────────────────────────────────────────

export const ALLOWED_EBAY_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  // From NULL (never listed) — start as ENTWURF.
  __NULL__: ['ENTWURF'],
  ENTWURF: ['GEPRUEFT'],
  GEPRUEFT: ['ONLINE', 'ENTWURF'], // step-back if review fails
  ONLINE: ['VERKAUFT', 'ENTWURF'], // de-list back to draft
  VERKAUFT: ['BEZAHLT', 'REKLAMIERT'], // happy path or dispute
  BEZAHLT: ['VERPACKT', 'REKLAMIERT'],
  VERPACKT: ['VERSENDET', 'REKLAMIERT'],
  VERSENDET: ['REKLAMIERT'], // terminal until claim
  REKLAMIERT: ['RETOURNIERT', 'VERSENDET'], // resolve or re-ship
  RETOURNIERT: [], // terminal
};

/**
 * "States that look sold" — must match the trigger's branch in migration 0022.
 * Used by the route to predict what `inventorySideEffect` will be.
 */
export const EBAY_SOLD_CLUSTER: readonly string[] = [
  'VERKAUFT',
  'BEZAHLT',
  'VERPACKT',
  'VERSENDET',
];
