/**
 * useIntakeDrafts — TanStack Query wrappers around the Intake Drafts API
 * (ADR-0015 Control Desktop). List + publish mutation.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type IntakeDraftSummary,
  type IntakePublishRequest,
  type IntakePublishResponse,
  intakeDrafts,
} from '@warehouse14/api-client';

import { useApiClient } from '../lib/api-context.js';

export const intakeDraftsQueryKey = ['intake', 'drafts'] as const;

export interface UseIntakeDraftsResult {
  data: IntakeDraftSummary[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
}

export function useIntakeDrafts(): UseIntakeDraftsResult {
  const api = useApiClient();
  const q = useQuery({
    queryKey: intakeDraftsQueryKey,
    queryFn: () => intakeDrafts.list(api),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  return {
    data: q.data?.items ?? [],
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

export interface PublishVars {
  sessionId: string;
  body: IntakePublishRequest;
}

export function usePublishIntakeDraft() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation<IntakePublishResponse, unknown, PublishVars>({
    mutationFn: (vars: PublishVars) => intakeDrafts.publish(api, vars.sessionId, vars.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: intakeDraftsQueryKey });
    },
  });
}
