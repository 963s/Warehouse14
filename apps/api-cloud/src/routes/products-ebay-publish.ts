/**
 * POST /api/products/:id/ebay-publish — push a product to the eBay marketplace
 * (Epic D #38, the LISTING-PUSH path; closes the honest "Bei eBay listen" stub).
 *
 * Flow:
 *   1. Load the product + its photos (public URLs eBay can GET).
 *   2. Map → eBay Sell Inventory payloads (pure, in `lib/ebay/inventory-mapper`).
 *   3. publishProductToEbay() runs createOrReplaceInventoryItem → createOffer →
 *      publishOffer. When EBAY_OAUTH_TOKEN is empty it returns an honest
 *      not-configured result (NO HTTP) — the route echoes that to the POS so it
 *      can show a German "token pending" toast instead of faking a live listing.
 *   4. On a real publish: flip ebay_state → ONLINE, set listed_on_ebay = TRUE,
 *      store the offer/listing id in ebay_listing_id, and append a SYSTEM-sourced
 *      event-log row (the marketplace push is a system action, not an OWNER hand
 *      edit — that keeps the audit source honest).
 *
 * Auth mirrors the eBay state-machine route: Owner step-up + an mTLS device,
 * because this publishes shop inventory to a public marketplace.
 *
 * INBOUND SYNC (orders flowing back) is OUT OF SCOPE — see the TODO in
 * lib/ebay/sell-client.ts.
 */

import { Type } from '@sinclair/typebox';
import { asc, sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { productEbayListingEvents, productPhotos, products } from '@warehouse14/db/schema';

import type { Env } from '../config/env.js';
import { requireAuth, requireOwnerStepUp } from '../lib/auth-policy.js';
import { type EbaySellConfig, publishProductToEbay } from '../lib/ebay/sell-client.js';
import { buildR2PublicUrl } from '../lib/r2.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class ProductNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class DeviceRequiredError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'DEVICE_NOT_AUTHORIZED';
}
class EbayPublishFailedError extends DomainError {
  public readonly httpStatus = 502;
  public readonly code: ApiErrorCode = 'EXTERNAL_SERVICE_FAILED';
}

const Params = Type.Object({ id: Type.String({ format: 'uuid' }) });

const PublishResponse = Type.Object({
  productId: Type.String({ format: 'uuid' }),
  /** False when EBAY_OAUTH_TOKEN is empty — the POS shows a "token pending" toast. */
  configured: Type.Boolean(),
  /** True only when the listing actually went live. */
  published: Type.Boolean(),
  offerId: Type.Union([Type.String(), Type.Null()]),
  listingId: Type.Union([Type.String(), Type.Null()]),
  /** German status / reason — safe to show the operator. */
  detail: Type.String(),
});

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export interface ProductsEbayPublishOpts {
  env: Env;
}

const productsEbayPublishRoute: FastifyPluginAsync<ProductsEbayPublishOpts> = async (app, opts) => {
  const { env } = opts;

  app.post<{ Params: { id: string } }>(
    '/api/products/:id/ebay-publish',
    {
      schema: {
        tags: ['products', 'ebay'],
        summary: 'Push a product to the eBay marketplace (Sell Inventory API).',
        description:
          'Maps the product + photos to an eBay InventoryItem + Offer and runs ' +
          'createOrReplaceInventoryItem → createOffer → publishOffer. Honest stub: ' +
          'with no EBAY_OAUTH_TOKEN it returns configured=false and makes no HTTP call.',
        params: Params,
        response: {
          200: PublishResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireOwnerStepUp(req);

      const { deviceId } = req;
      if (deviceId == null) {
        throw new DeviceRequiredError(
          'eBay-Veröffentlichung erfordert ein mTLS-gekoppeltes Gerät.',
        );
      }

      // Load the product + its photos in parallel (independent reads).
      const [productRows, photoRows] = await Promise.all([
        app.db.select().from(products).where(eq(products.id, req.params.id)).limit(1),
        app.db
          .select({
            id: productPhotos.id,
            r2Key: productPhotos.r2Key,
            storageKind: productPhotos.storageKind,
            displayOrder: productPhotos.displayOrder,
          })
          .from(productPhotos)
          .where(eq(productPhotos.productId, req.params.id))
          .orderBy(asc(productPhotos.displayOrder), asc(productPhotos.createdAt)),
      ]);

      const product = productRows[0];
      if (!product) throw new ProductNotFoundError(`Product ${req.params.id} not found`);

      // Build absolute, publicly-reachable photo URLs (eBay must GET them).
      const photoUrls = photoRows.map((p) =>
        p.storageKind === 'local'
          ? `${env.PHOTOS_PUBLIC_BASE_URL.replace(/\/$/, '')}/api/photos/${p.id}/raw`
          : buildR2PublicUrl(env, p.r2Key),
      );

      const config: EbaySellConfig = {
        oauthToken: env.EBAY_OAUTH_TOKEN,
        marketplaceId: env.EBAY_MARKETPLACE,
        baseUrl: env.EBAY_SELL_API_BASE_URL,
      };

      let result: Awaited<ReturnType<typeof publishProductToEbay>>;
      try {
        result = await publishProductToEbay(
          config,
          {
            id: product.id,
            sku: product.sku,
            name: product.name,
            descriptionDe: product.descriptionDe,
            condition: product.condition,
            listPriceEur: product.listPriceEur,
            weightGrams: product.weightGrams,
            photoUrls,
          },
          {
            ...(env.EBAY_DEFAULT_CATEGORY_ID ? { categoryId: env.EBAY_DEFAULT_CATEGORY_ID } : {}),
            ...(env.EBAY_MERCHANT_LOCATION_KEY
              ? { merchantLocationKey: env.EBAY_MERCHANT_LOCATION_KEY }
              : {}),
            ...(env.EBAY_FULFILLMENT_POLICY_ID
              ? { fulfillmentPolicyId: env.EBAY_FULFILLMENT_POLICY_ID }
              : {}),
            ...(env.EBAY_PAYMENT_POLICY_ID ? { paymentPolicyId: env.EBAY_PAYMENT_POLICY_ID } : {}),
            ...(env.EBAY_RETURN_POLICY_ID ? { returnPolicyId: env.EBAY_RETURN_POLICY_ID } : {}),
          },
        );
      } catch (err) {
        // Configured-but-failed push — surface honestly (502), record nothing.
        throw new EbayPublishFailedError(
          `eBay-Veröffentlichung fehlgeschlagen: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`,
        );
      }

      // On a real, live publish: project the marketplace state back onto the
      // product + append the audit row. Wrapped so a partial failure can't
      // leave the product flipped without an event.
      if (result.published) {
        await app.db.transaction(async (tx) => {
          const fromState = product.ebayState;
          await tx
            .update(products)
            .set({
              ebayState: 'ONLINE',
              ebayStateChangedAt: drizzleSql`now()`,
              listedOnEbay: true,
              ebayListingId: result.listingId ?? result.offerId,
            })
            .where(eq(products.id, product.id));

          // Only append a transition event when the state actually changed (the
          // event-log CHECK forbids from_state = to_state).
          if (fromState !== 'ONLINE') {
            await tx.insert(productEbayListingEvents).values({
              productId: product.id,
              fromState: fromState ?? null,
              toState: 'ONLINE',
              changedByUserId: req.actor.id,
              changedBySource: 'SYSTEM',
              notes: `eBay-Marktplatz-Push: ${result.detail}`,
              payload: {
                offerId: result.offerId,
                listingId: result.listingId,
              } as Record<string, unknown>,
            });
          }
        });
      }

      return reply.status(200).send({
        productId: product.id,
        configured: result.configured,
        published: result.published,
        offerId: result.offerId,
        listingId: result.listingId,
        detail: result.detail,
      });
    },
  );
};

export default productsEbayPublishRoute;
