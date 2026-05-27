/**
 * Native PG enum types backing the products schema.
 *
 * Created in migration 0006_products.sql. The pgEnum declarations here mirror
 * the existing types — drizzle-kit does not re-create them because we hand-write
 * migrations (ADR-0008 §9).
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const productStatus = pgEnum('product_status', [
  'DRAFT',
  'AVAILABLE',
  'RESERVED',
  'SOLD',
]);

export const reservationChannel = pgEnum('reservation_channel', [
  'POS',
  'STOREFRONT',
  'EBAY',
]);

export const itemType = pgEnum('item_type', [
  'gold_jewelry',
  'gold_coin',
  'gold_bar',
  'silver_jewelry',
  'silver_coin',
  'silver_bar',
  'platinum_jewelry',
  'platinum_coin',
  'platinum_bar',
  'antique',
  'watch',
  'other',
]);

export const photoSource = pgEnum('photo_source', [
  'intake',
  'admin_upload',
  'storefront_user',
  // Migration 0022 (Day 24) — additive: DSLR + phone capture during intake.
  'photographer',
  'phone_intake',
]);

/**
 * Physical condition (Zustand) — landed in migration 0015 alongside
 * is_commission + acquired_from_customer_id + archived_at columns.
 */
export const productCondition = pgEnum('product_condition', [
  'NEW',
  'USED_EXCELLENT',
  'USED_GOOD',
  'USED_FAIR',
  'ANTIQUE_RESTORED',
  'ANTIQUE_AS_FOUND',
]);

/**
 * Photo workflow state — Owner-defined 5-stage lifecycle. Landed in
 * migration 0022. Transitions are audited via product_photo_workflow_events.
 *
 *   FOTOGRAFIERT → BEARBEITET → FREIGESTELLT → ZUGEORDNET → FUER_EBAY_BEREIT
 */
export const photoWorkflowState = pgEnum('photo_workflow_state', [
  'FOTOGRAFIERT',
  'BEARBEITET',
  'FREIGESTELLT',
  'ZUGEORDNET',
  'FUER_EBAY_BEREIT',
]);

/**
 * eBay listing state — Owner-defined 9-stage lifecycle. Landed in
 * migration 0022. Lives on `products.ebay_state`; transitions audited via
 * product_ebay_listing_events. Entering VERKAUFT (or further) auto-reserves
 * the local product via EBAY channel (see migration 0022 §7 trigger).
 */
export const ebayListingState = pgEnum('ebay_listing_state', [
  'ENTWURF',
  'GEPRUEFT',
  'ONLINE',
  'VERKAUFT',
  'BEZAHLT',
  'VERPACKT',
  'VERSENDET',
  'REKLAMIERT',
  'RETOURNIERT',
]);

/**
 * Allowed sources for a product_ebay_listing_events row.
 * Mirror of the SQL CHECK in migration 0022.
 */
export const EBAY_EVENT_SOURCES = ['OWNER', 'EBAY_WEBHOOK', 'WORKER', 'SYSTEM'] as const;
export type EbayEventSource = (typeof EBAY_EVENT_SOURCES)[number];
