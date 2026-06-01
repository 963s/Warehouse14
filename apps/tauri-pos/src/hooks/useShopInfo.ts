/**
 * useShopInfo — the shop identity for the receipt header, read from
 * `GET /api/shop-info` (Owner-editable, system_settings, migration 0044).
 *
 * The POS falls back to the bundled `SHOP_INFO` constant when the call hasn't
 * resolved yet or fails — a receipt must always have a header. `resolveShopInfo`
 * merges the API result over the constant.
 */

import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../lib/api-context.js';
import { SHOP_INFO, type ShopInfo } from '../lib/shop-info.js';

export interface ShopInfoApi {
  name: string;
  tagline: string;
  addressLine1: string;
  addressLine2: string;
  vatId: string;
  phone: string;
}

export const shopInfoQueryKey = ['shop-info'] as const;

export function useShopInfo(): { data: ShopInfoApi | undefined } {
  const api = useApiClient();
  const { data } = useQuery<ShopInfoApi>({
    queryKey: shopInfoQueryKey,
    queryFn: () => api.request<ShopInfoApi>('GET', '/api/shop-info'),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  return { data };
}

/** Merge the API shop identity over the bundled fallback constant. */
export function resolveShopInfo(api: ShopInfoApi | undefined): ShopInfo {
  if (!api) return SHOP_INFO;
  return {
    name: api.name || SHOP_INFO.name,
    tagline: api.tagline || SHOP_INFO.tagline,
    address: [api.addressLine1, api.addressLine2].filter((l) => l.length > 0),
    vatId: api.vatId || SHOP_INFO.vatId,
    phone: api.phone || null,
  };
}
