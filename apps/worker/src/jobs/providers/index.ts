/**
 * Provider barrel + the env-driven factory the worker uses to pick a provider.
 *
 * Selection (`METAL_PRICE_PROVIDER`, default `mock`):
 *   mock          → MockProvider (zero config; dev/demo default)
 *   json_url      → JsonUrlProvider (needs LBMA_PRICES_URL; back-compat)
 *   metalpriceapi → MetalPriceApiProvider (needs METAL_PRICE_API_KEY)
 *   goldapi       → GoldApiProvider (needs METAL_PRICE_API_KEY)
 *   disabled      → null (job no-ops)
 *
 * A provider that is selected but missing its required config resolves to
 * `null` (job skips) rather than crashing worker boot — a metal-price misconfig
 * must not take the whole worker down.
 */

import { GoldApiProvider } from './goldapi-provider.js';
import { JsonUrlProvider } from './json-url-provider.js';
import { MetalPriceApiProvider } from './metalpriceapi-provider.js';
import { MockProvider } from './mock-provider.js';
import { StooqProvider } from './stooq-provider.js';
import type { MetalPriceProvider } from './types.js';

export type MetalPriceProviderKind =
  | 'mock'
  | 'json_url'
  | 'metalpriceapi'
  | 'goldapi'
  | 'stooq'
  | 'disabled';

export interface ProviderFactoryConfig {
  provider: MetalPriceProviderKind;
  apiKey?: string;
  jsonUrl?: string;
}

/** Returns the configured provider, or `null` when disabled / under-configured. */
export function createMetalPriceProvider(config: ProviderFactoryConfig): MetalPriceProvider | null {
  switch (config.provider) {
    case 'disabled':
      return null;
    case 'mock':
      return new MockProvider();
    case 'json_url':
      return config.jsonUrl ? new JsonUrlProvider({ url: config.jsonUrl }) : null;
    case 'metalpriceapi':
      return config.apiKey ? new MetalPriceApiProvider({ apiKey: config.apiKey }) : null;
    case 'goldapi':
      return config.apiKey ? new GoldApiProvider({ apiKey: config.apiKey }) : null;
    case 'stooq':
      return new StooqProvider();
    default: {
      // Exhaustiveness guard — a new kind must be handled above.
      const _never: never = config.provider;
      throw new Error(`unknown METAL_PRICE_PROVIDER: ${String(_never)}`);
    }
  }
}

export { GoldApiProvider } from './goldapi-provider.js';
export { JsonUrlProvider } from './json-url-provider.js';
export { MetalPriceApiProvider } from './metalpriceapi-provider.js';
export { MockProvider } from './mock-provider.js';
export { StooqProvider } from './stooq-provider.js';
export { perOunceToPerGram, toDecimalString, TROY_OUNCE_GRAMS } from './convert.js';
export {
  METAL_KEYS,
  type FetchLike,
  type MetalKey,
  type MetalPriceFetchOptions,
  type MetalPriceProvider,
  type NormalizedMetalPrice,
} from './types.js';
