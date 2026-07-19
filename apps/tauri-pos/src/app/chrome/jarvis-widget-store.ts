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
export interface ProductListRow {
  name?: string;
  sku?: string;
  statusDe?: string;
  itemTypeDe?: string;
  listPriceEur?: string;
  liveWeb?: boolean;
  liveEbay?: boolean;
}
export interface ProductListData {
  count?: number;
  products?: ProductListRow[];
}
export interface InventoryData {
  totalActive?: number;
  availableCount?: number;
  reservedCount?: number;
  soldCount?: number;
  availableValueEur?: string;
  publishedCount?: number;
  ebayCount?: number;
}
export interface SalesBreakdownData {
  period?: string;
  saleCount?: number;
  totalUnits?: number;
  totalRevenueEur?: string;
  avgSaleEur?: string;
  byItemType?: Array<{ itemTypeDe?: string; units?: number; revenueEur?: string }>;
  topProducts?: Array<{ name?: string; revenueEur?: string }>;
}
export interface ChannelsData {
  ebayOnline?: number;
  ebayToShip?: number;
  ebayProblem?: number;
  whatsappUnhandledThreads?: number;
  whatsappUnhandledMessages?: number;
  documentsTotal?: number;
  pendingAppraisals?: number;
  openStorefrontOrders?: number;
  checkoutInProgress?: number;
}
export interface TopCustomersData {
  count?: number;
  totalWithRevenue?: number;
  customers?: Array<{
    rank?: number;
    customerNumber?: string;
    cumulativeSpendEur?: string;
    trustLevelDe?: string;
  }>;
}
export interface CustomerBaseData {
  totalActive?: number;
  buyers?: number;
  sellers?: number;
  kycVerified?: number;
  watchlist?: number;
  totalSpendEur?: string;
  totalAnkaufEur?: string;
}

export interface PhotoInboxData {
  count: number;
  photos: Array<{ id: string; thumbPath: string; createdAt: string }>;
}

export type JarvisWidget =
  | { kind: 'revenue'; data: SalesData }
  | { kind: 'daySummary'; data: DaySummaryData }
  | { kind: 'finance'; data: FinanceData }
  | { kind: 'product'; data: ProductData }
  | { kind: 'customer'; data: CustomerData }
  | { kind: 'agenda'; data: AgendaData }
  | { kind: 'productList'; data: ProductListData }
  | { kind: 'inventory'; data: InventoryData }
  | { kind: 'salesBreakdown'; data: SalesBreakdownData }
  | { kind: 'channels'; data: ChannelsData }
  | { kind: 'topCustomers'; data: TopCustomersData }
  | { kind: 'customerBase'; data: CustomerBaseData }
  | { kind: 'photoInbox'; data: PhotoInboxData };

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
    case 'list_products': {
      // The browse tool: show the rows, not just speak the top three. Nothing to
      // paint on an empty result, so the last widget stays.
      const rows = d.products;
      return Array.isArray(rows) && rows.length > 0 ? { kind: 'productList', data: d as ProductListData } : null;
    }
    case 'product_details': {
      // The deep-dive returns { found, product }. Reuse the product card.
      const p = d.product;
      return d.found === true && p != null && typeof p === 'object'
        ? { kind: 'product', data: p as ProductData }
        : null;
    }
    case 'inventory_overview':
      return { kind: 'inventory', data: d as InventoryData };
    case 'sales_breakdown':
      // An empty period has nothing to chart; the spoken line carries it.
      return Number(d.saleCount ?? 0) > 0 ? { kind: 'salesBreakdown', data: d as SalesBreakdownData } : null;
    case 'channels_overview':
      return { kind: 'channels', data: d as ChannelsData };
    case 'top_customers': {
      const rows = d.customers;
      return Array.isArray(rows) && rows.length > 0 ? { kind: 'topCustomers', data: d as TopCustomersData } : null;
    }
    case 'customer_overview':
      return { kind: 'customerBase', data: d as CustomerBaseData };
    case 'list_inbox_photos': {
      // The photo bridge tray: show the thumbnails the phone sent. An empty
      // inbox is carried by the spoken line; nothing to paint.
      const photos = d.photos;
      return Array.isArray(photos) && photos.length > 0
        ? { kind: 'photoInbox', data: d as unknown as PhotoInboxData }
        : null;
    }
    default:
      return null;
  }
}
