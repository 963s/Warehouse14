/**
 * storefront/ — B2C commerce overlay (Day 19, migration 0018).
 *
 *   shoppers + shopper_sessions — online customer accounts (overlay on customers).
 *   carts + cart_items          — basket state machine; 15-min STOREFRONT soft-lock.
 *   payment_intents             — provider-agnostic intent rows (Stripe primary V1).
 *   webhook_events              — idempotency table for every inbound provider hook.
 *
 * `sales_channel`, `shipping_status` enums (used by transactions/) also live
 * here because they were introduced alongside the storefront overlay.
 */

export * from './enums.js';
export * from './shoppers.js';
export * from './shopperSessions.js';
export * from './carts.js';
export * from './emailOutbox.js';
export * from './paymentIntents.js';
export * from './webhookEvents.js';
