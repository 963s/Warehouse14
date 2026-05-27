/**
 * metal_price_source — PG enum landed in migration 0021.
 *
 *   LBMA              — official London Bullion Market fix
 *   XAUEUR_VENDOR     — third-party live API (metalpriceapi.com, etc.)
 *   MANUAL            — ADMIN override (requires user_id + reason — see CHECK)
 *   INTERNAL_ESTIMATE — fallback when no live feed
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const metalPriceSource = pgEnum('metal_price_source', [
  'LBMA',
  'XAUEUR_VENDOR',
  'MANUAL',
  'INTERNAL_ESTIMATE',
]);
