/**
 * Preview entry (DEV-ONLY) — renders the FULL management shell with sample data,
 * WITHOUT the Google-login gate or a live server. Reachable at
 * `http://localhost:1422/preview.html`.
 *
 * The real app (main.tsx → AuthGate) is untouched; this is a separate Vite entry
 * so the owner can see every surface (Übersicht, Kunden, Lager, Finanzen, Risiko,
 * API-Schlüssel, eBay, Zielkarte, …) laid out and populated. Every response comes
 * from the in-memory `mockRequest` below — nothing leaves the machine.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import type { ApiClient, HttpMethod } from '@warehouse14/api-client';
import '@warehouse14/ui-kit/styles.css';

import { App } from './App.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { ApiClientProvider } from './api-context.js';

// ── Sample data (realistic, in-memory only) ──────────────────────────────────

const PRODUCTS = [
  { id: 'p1', sku: 'GM-20M-1913', name: '20 Mark Wilhelm II. 1913', itemType: 'gold_coin', metal: 'gold', weightGrams: '7.96', listPriceEur: '498.00', status: 'AVAILABLE', condition: 'USED_EXCELLENT', ebayState: 'ONLINE', ebayStateChangedAt: '2026-07-15T09:12:00Z', createdAt: '2026-07-10T08:00:00Z' },
  { id: 'p2', sku: 'GB-100-DEG', name: 'Goldbarren 100 g Degussa', itemType: 'gold_bar', metal: 'gold', weightGrams: '100', listPriceEur: '6480.00', status: 'AVAILABLE', condition: 'NEW', ebayState: 'GEPRUEFT', ebayStateChangedAt: '2026-07-16T11:00:00Z', createdAt: '2026-07-12T08:00:00Z' },
  { id: 'p3', sku: 'SM-KRÜG-1oz', name: 'Krügerrand Silber 1 oz', itemType: 'silver_coin', metal: 'silver', weightGrams: '31.1', listPriceEur: '38.50', status: 'AVAILABLE', condition: 'NEW', ebayState: 'VERKAUFT', ebayStateChangedAt: '2026-07-16T14:30:00Z', createdAt: '2026-07-09T08:00:00Z' },
  { id: 'p4', sku: 'AQ-UHR-IWC', name: 'IWC Taschenuhr um 1920', itemType: 'watch', metal: null, weightGrams: null, listPriceEur: '1250.00', status: 'RESERVED', condition: 'ANTIQUE_RESTORED', ebayState: 'ENTWURF', ebayStateChangedAt: '2026-07-17T07:45:00Z', createdAt: '2026-07-14T08:00:00Z' },
  { id: 'p5', sku: 'AQ-LEUCHTER', name: 'Silberleuchter Paar, 800er', itemType: 'antique', metal: 'silver', weightGrams: '640', listPriceEur: '890.00', status: 'AVAILABLE', condition: 'USED_GOOD', ebayState: 'VERSENDET', ebayStateChangedAt: '2026-07-13T16:00:00Z', createdAt: '2026-07-05T08:00:00Z' },
  { id: 'p6', sku: 'M-3F9A2C1B7D', name: 'Goldkette 585, 42 cm', itemType: 'gold_jewelry', metal: 'gold', weightGrams: '12.3', listPriceEur: '420.00', status: 'DRAFT', condition: 'USED_GOOD', ebayState: null, ebayStateChangedAt: null, createdAt: '2026-07-17T09:30:00Z' },
  { id: 'p7', sku: 'GM-DUKAT-1915', name: '1 Dukat Österreich 1915', itemType: 'gold_coin', metal: 'gold', weightGrams: '3.49', listPriceEur: '235.00', status: 'AVAILABLE', condition: 'USED_EXCELLENT', ebayState: 'REKLAMIERT', ebayStateChangedAt: '2026-07-16T18:20:00Z', createdAt: '2026-07-08T08:00:00Z' },
  { id: 'p8', sku: 'SB-1KG-HERA', name: 'Silberbarren 1 kg Heraeus', itemType: 'silver_bar', metal: 'silver', weightGrams: '1000', listPriceEur: '980.00', status: 'AVAILABLE', condition: 'NEW', ebayState: 'BEZAHLT', ebayStateChangedAt: '2026-07-16T10:05:00Z', createdAt: '2026-07-11T08:00:00Z' },
];

const CUSTOMERS = [
  { id: 'c1', fullName: 'Heinrich Vogel', kycStatus: 'VERIFIED', kycVerifiedAt: '2026-05-02T10:00:00Z', trustLevel: 'VIP', sanctionsMatch: false, cumulativeAnkaufEur: '12450.00', cumulativeSpendEur: '3820.00' },
  { id: 'c2', fullName: 'Margarethe Klein', kycStatus: 'VERIFIED', kycVerifiedAt: '2026-06-14T10:00:00Z', trustLevel: 'VERIFIED', sanctionsMatch: false, cumulativeAnkaufEur: '2100.00', cumulativeSpendEur: '640.00' },
  { id: 'c3', fullName: 'Anton Bauer', kycStatus: 'PENDING', kycVerifiedAt: null, trustLevel: 'NORMAL', sanctionsMatch: false, cumulativeAnkaufEur: '0.00', cumulativeSpendEur: '150.00' },
  { id: 'c4', fullName: 'Sokolow Iwan', kycStatus: 'PENDING', kycVerifiedAt: null, trustLevel: 'SUSPICIOUS', sanctionsMatch: true, cumulativeAnkaufEur: '8900.00', cumulativeSpendEur: '0.00' },
  { id: 'c5', fullName: 'Friedrich Wolff', kycStatus: 'VERIFIED', kycVerifiedAt: '2026-04-20T10:00:00Z', trustLevel: 'NORMAL', sanctionsMatch: false, cumulativeAnkaufEur: '540.00', cumulativeSpendEur: '1220.00' },
];

const API_KEYS = [
  { id: 'k1', label: 'Buchhaltung (nur Lesen)', role: 'READONLY', readOnly: true, tokenPrefix: 'w14k_a1b2', scopes: [], createdAt: '2026-07-01T10:00:00Z', lastUsedAt: '2026-07-17T06:30:00Z', lastUsedIp: '10.0.0.4', revokedAt: null },
  { id: 'k2', label: 'Lager-Agent (Lesen/Schreiben)', role: 'ADMIN', readOnly: false, tokenPrefix: 'w14k_c3d4', scopes: [], createdAt: '2026-07-10T10:00:00Z', lastUsedAt: '2026-07-16T20:10:00Z', lastUsedIp: '10.0.0.9', revokedAt: null },
  { id: 'k3', label: 'Alt — Test', role: 'READONLY', readOnly: true, tokenPrefix: 'w14k_e5f6', scopes: [], createdAt: '2026-06-01T10:00:00Z', lastUsedAt: null, lastUsedIp: null, revokedAt: '2026-06-20T10:00:00Z' },
];

const STAFF = [
  { id: 's1', email: 'admin@warehouse14.de', name: 'Basel (Inhaber)', role: 'ADMIN', isOwner: true, createdAt: '2026-01-01T10:00:00Z' },
  { id: 's2', email: 'anna@warehouse14.de', name: 'Anna Richter', role: 'CASHIER', isOwner: false, createdAt: '2026-05-10T10:00:00Z' },
  { id: 's3', email: 'jonas@warehouse14.de', name: 'Jonas Weber', role: 'READONLY', isOwner: false, createdAt: '2026-06-22T10:00:00Z' },
];

const RISK = {
  generatedAt: '2026-07-17T10:00:00Z',
  windowDays: 30,
  alerts: [
    { type: 'alert.cash_variance', count: 3 },
    { type: 'alert.structuring', count: 1 },
    { type: 'alert.sanctions_hit', count: 1 },
    { type: 'alert.trust_change', count: 4 },
  ],
  recent: [
    { id: 'a1', eventType: 'alert.sanctions_hit', createdAt: '2026-07-17T08:12:00Z' },
    { id: 'a2', eventType: 'alert.cash_variance', createdAt: '2026-07-16T19:40:00Z' },
    { id: 'a3', eventType: 'alert.structuring', createdAt: '2026-07-15T13:05:00Z' },
  ],
  watchlist: {
    suspicious: 1,
    banned: 0,
    sanctions: 1,
    pep: 1,
    customers: [
      { id: 'c4', fullName: 'Sokolow Iwan', trustLevel: 'SUSPICIOUS', sanctionsMatch: true, pepMatch: true },
    ],
  },
};

function mockFor(path: string): unknown {
  const p = path.split('?')[0] ?? path;
  const q = path.includes('?') ? path.slice(path.indexOf('?') + 1) : '';

  if (p === '/health') return { ok: true };
  if (p === '/api/bridge/summary')
    return {
      todayRevenueCents: 78000,
      todaySalesCount: 17,
      todayAnkaufCount: 7,
      todayAnkaufValueCents: 41500,
      intakeDraftsPending: 2,
      approvalsPending: 2,
      whatsappUnreadCount: 3,
      nextAppointmentAt: '2026-07-17T15:30:00Z',
      todayAppointmentCount: 4,
      tseCertDaysRemaining: 213,
      workerDlqUnacked: 0,
      systemStatus: 'ok',
      computedAt: '2026-07-17T10:00:00Z',
    };
  if (p === '/api/dashboard/summary')
    return { pendingAppraisals: 9, openTasks: 4, pendingApprovals: 2, lowStock: 1 };
  if (p === '/api/finance/profit')
    return q.includes('month')
      ? { period: 'month', netProfitCents: 340000 }
      : { period: 'day', netProfitCents: 24000 };
  if (p === '/api/finance/revenue') return { period: 'month', monthToDateRevenueCents: 1900000 };
  if (p === '/api/inventory/value') return { listValueCents: 3400000 };
  if (p === '/api/inventory/metal-weights') return { goldGrams: 352.4, silverGrams: 640 };
  if (p === '/api/fixed-costs')
    return {
      items: [
        { id: 'f1', label: 'Miete Ladenlokal', monthlyAmountCents: 250000, activeFrom: '2020-01-01', activeTo: null },
        { id: 'f2', label: 'Versicherung', monthlyAmountCents: 80000, activeFrom: '2020-01-01', activeTo: null },
        { id: 'f3', label: 'Software / Kasse', monthlyAmountCents: 10000, activeFrom: '2020-01-01', activeTo: null },
      ],
      total: 3,
      limit: 50,
      offset: 0,
      hasMore: false,
    };
  if (p === '/api/expenses')
    return {
      items: [
        { id: 'e1', category: 'MARKETING', amountCents: 12000, note: 'eBay-Gebühren', incurredAt: '2026-07-14', createdAt: '2026-07-14T10:00:00Z' },
        { id: 'e2', category: 'VERPACKUNG', amountCents: 4500, note: 'Versandmaterial', incurredAt: '2026-07-12', createdAt: '2026-07-12T10:00:00Z' },
      ],
      total: 2,
      limit: 8,
      offset: 0,
      hasMore: false,
    };
  if (p === '/api/products')
    return { items: PRODUCTS, total: PRODUCTS.length, limit: 200, offset: 0, hasMore: false };
  if (p === '/api/customers')
    return { items: CUSTOMERS, total: CUSTOMERS.length, limit: 200, offset: 0, hasMore: false };
  if (p === '/api/risk/overview') return RISK;
  if (p === '/api/api-keys') return { items: API_KEYS };
  if (p === '/api/admin/staff') return { items: STAFF };

  // Unknown reads → an honest empty collection (surfaces render their empty state).
  return { items: [], total: 0, limit: 50, offset: 0, hasMore: false };
}

const mockClient = {
  request<T>(_method: HttpMethod, path: string): Promise<T> {
    return Promise.resolve(mockFor(path) as T);
  },
} as unknown as ApiClient;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 0, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('control-desktop preview: #root element is missing');

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={mockClient} baseUrl="mock://vorschau">
          <App />
        </ApiClientProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
