/**
 * jarvis-widget-store — Vierzehn's on-screen "dramatic display" layer.
 *
 * Pattern B (deterministic): when Jarvis calls a read tool, the app already
 * relays it to /api/mcp/assistant and gets the tool's structured `data` back
 * (useRealtimeSession relayToolCall). Right there we tee that data through
 * `widgetForTool()` into this tiny external store; `JarvisWidgets` subscribes and
 * paints a dramatic card over the overlay hero band while Vierzehn speaks. No new
 * tool, no persona edit, no server-tool boundary — presentation is a pure side
 * effect of the read the model already made, so it can never "forget to present".
 *
 * The store holds ONE active widget (the latest read wins). Each `presentWidget`
 * is a fresh object so `useSyncExternalStore` re-renders + the layer resets its
 * auto-dismiss timer.
 */

// ── The widget union — one per presentable tool ────────────────────────────

export interface SalesData {
  period?: string;
  verkaufRevenueEur?: string;
  verkaufCount?: number;
  ankaufValueEur?: string;
  ankaufCount?: number;
}
export interface DaySummaryData {
  openShiftRevenueEur?: string;
  tasksDueToday?: number;
  tasksOverdue?: number;
  pendingAppraisals?: number;
  watchlistCustomers?: number;
  metalPricesEurPerGram?: {
    gold?: string | null;
    silver?: string | null;
    platinum?: string | null;
    palladium?: string | null;
  };
}
export interface FinanceData {
  revenueEur?: string;
  wareneinkaufEur?: string;
  expensesEur?: string;
  fixedCostsAllocatedEur?: string;
  resultEur?: string;
}
export interface ProductData {
  name?: string;
  sku?: string;
  status?: string;
  listPriceEur?: string | null;
  categoryName?: string | null;
  location?: string | null;
}
export interface CustomerData {
  displayName?: string;
  phone?: string | null;
  trustLevel?: string;
}
export interface AgendaData {
  appointmentsUpcoming?: number;
  openTasks?: number;
}

export type JarvisWidget =
  | { kind: 'revenue'; data: SalesData }
  | { kind: 'daySummary'; data: DaySummaryData }
  | { kind: 'finance'; data: FinanceData }
  | { kind: 'product'; data: ProductData }
  | { kind: 'customer'; data: CustomerData }
  | { kind: 'agenda'; data: AgendaData };

// ── The store ──────────────────────────────────────────────────────────────

let current: JarvisWidget | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function presentWidget(w: JarvisWidget | null): void {
  current = w;
  emit();
}
export function dismissWidget(): void {
  if (current === null) return;
  current = null;
  emit();
}
export function subscribeWidget(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function getWidgetSnapshot(): JarvisWidget | null {
  return current;
}

// ── Tool → widget mapping ────────────────────────────────────────────────────

function firstMatch(data: unknown): Record<string, unknown> | null {
  const matches = (data as { matches?: unknown }).matches;
  if (Array.isArray(matches) && matches.length > 0 && typeof matches[0] === 'object') {
    return matches[0] as Record<string, unknown>;
  }
  return null;
}

/**
 * Map a completed read tool + its result `data` to a widget, or null if the tool
 * has nothing to show (open_dev_ticket, appraise, an empty search). Defensive:
 * unknown shapes fall through to null rather than throw.
 */
export function widgetForTool(name: string, data: unknown): JarvisWidget | null {
  if (data == null || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  switch (name) {
    case 'sales_report':
      return { kind: 'revenue', data: d as SalesData };
    case 'situation_report':
      return { kind: 'daySummary', data: d as DaySummaryData };
    case 'finance_overview':
      return { kind: 'finance', data: d as FinanceData };
    case 'find_product': {
      const m = firstMatch(d);
      return m ? { kind: 'product', data: m as ProductData } : null;
    }
    case 'find_customer': {
      const m = firstMatch(d);
      return m ? { kind: 'customer', data: m as CustomerData } : null;
    }
    case 'agenda':
      return { kind: 'agenda', data: d as AgendaData };
    default:
      return null;
  }
}
