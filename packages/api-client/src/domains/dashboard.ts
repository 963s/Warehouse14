/**
 * Dashboard summary domain client. Mirrors
 * `apps/api-cloud/src/routes/dashboard.ts` exactly.
 */

import type { ApiClient } from '../client.js';

export interface DashboardSummary {
  openTasksMine: number;
  tasksDueToday: number;
  tasksOverdue: number;
  pendingAppraisals: number;
  unassignedPhotos: number;
  ebayPipelineDepth: number;
  ebayConflictsWeek: number;
  currentShiftId: string | null;
  currentShiftRevenueEur: string;
  watchlistCustomerCount: number;
  workerJobsRunning: string[];
  lastChainVerifiedAt: string | null;
  workerDlqUnacked: number;
  currentMetalPrices: {
    gold: string | null;
    silver: string | null;
    platinum: string | null;
    palladium: string | null;
  };
  computedAt: string;
}

export const dashboard = {
  summary(client: ApiClient): Promise<DashboardSummary> {
    return client.request<DashboardSummary>('GET', '/api/dashboard/summary');
  },
};
