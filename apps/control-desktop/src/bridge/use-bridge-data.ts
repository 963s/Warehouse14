/**
 * useBridgeData — the single read-model hook the Bridge dashboard consumes.
 *
 * Now wired to the live aggregator: `GET /api/bridge/overview` (ADR-0019 §1,
 * ADMIN-only) returns the exact `BridgeData` shape, so this is a straight
 * `client.request` pull. `MOCK_BRIDGE` stays as `initialData` so the Bridge
 * paints instantly (no spinner — ADR-0019 §11) and remains readable offline;
 * `initialDataUpdatedAt: 0` marks that seed stale so a live refetch fires on
 * mount and replaces it. A 30s `refetchInterval` keeps the feed warm until the
 * SSE push lands (ADR-0014) and starts calling `setQueryData` on this key.
 */

import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../api-context.js';
import { MOCK_BRIDGE } from './mock-data.js';
import type { BridgeData } from './types.js';

export function useBridgeData(): BridgeData {
  // baseUrl keys the cache per backend; `client` issues the live request.
  const { baseUrl, client } = useApiClient();

  const { data } = useQuery<BridgeData>({
    queryKey: ['bridge', 'overview', baseUrl],
    queryFn: () => client.request<BridgeData>('GET', '/api/bridge/overview'),
    // Seed for instant first paint + offline fallback; marked stale so the
    // live fetch runs immediately on mount.
    initialData: MOCK_BRIDGE,
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  return data;
}
