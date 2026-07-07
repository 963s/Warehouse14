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
import {
  RECEIPT_VAT_LOCK_REASON,
  type ShopInfoApi,
  isReceiptShopValid,
  resolveShopInfo,
} from '../lib/shop-info.js';

// The pure identity types + resolver live in lib/shop-info.ts (unit-testable, no
// React deps). Re-exported here so existing `../hooks/useShopInfo.js` imports of
// resolveShopInfo continue to work.
export { RECEIPT_VAT_LOCK_REASON, type ShopInfoApi, isReceiptShopValid, resolveShopInfo };

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
