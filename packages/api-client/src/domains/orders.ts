/**
 * Bestellungen — die Personal-Sicht auf Web-Reservierungen zur Abholung (0099).
 *
 * Ein Wrapper für beide Personal-Apps (Kasse und Inhaber). Die Abholung selbst
 * läuft NICHT über diese Domain, sondern über den normalen Kassen-Verkauf mit
 * `webOrderNumber`, damit der Kassenbon und die §146a-Trigger dieselben bleiben.
 * Hier liegen nur die Warteschlange, das Laden einer Bestellung und die drei
 * reinen Zustandsübergänge.
 */

import type { ApiClient } from '../client.js';

/** Die deutschen Abholstufen aus 0099, in ihrer Reihenfolge. */
export type PickupStage = 'OFFEN' | 'ANGENOMMEN' | 'IN_VORBEREITUNG' | 'ABHOLBEREIT';

export interface OrderLine {
  productId: string | null;
  name: string;
  sku: string | null;
  quantity: number;
  unitPriceEur: string;
}

export interface OrderView {
  id: string;
  orderNumber: string | null;
  pickupStage: string | null;
  /** Die Reservierungs-Sitzung: die Kasse braucht sie, um die Stücke zur
   *  Übergabe zu finalisieren. Nur die Detail-Abfrage liefert sie gefüllt. */
  reservationSessionId: string | null;
  createdAt: string;
  /** Wann die Reservierung verfällt, falls niemand kommt. Null, wenn unbekannt. */
  expiresAt: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  /** ABHOLUNG oder VERSAND: `PICKUP` oder `SHIPPING`. */
  fulfilmentMethod: string;
  fulfilmentStatus: string;
  /**
   * Die mehrzeilige Lieferanschrift, oder null bei einer Abholung. Sie ist der
   * Inhalt der Versandmarke; ohne sie darf keine gedruckt werden.
   */
  shippingAddress: string | null;
  /** Zweibuchstabiges Zielland, oder null. */
  shippingCountry: string | null;
  itemCount: number;
  totalEur: string;
  lines: OrderLine[];
}

export const ordersApi = {
  /** Die Warteschlange. Optional auf eine Stufe gefiltert. ADMIN + CASHIER. */
  list(client: ApiClient, stage?: PickupStage): Promise<{ items: OrderView[] }> {
    const q = stage ? `?stage=${encodeURIComponent(stage)}` : '';
    return client.request<{ items: OrderView[] }>('GET', `/api/orders${q}`);
  },

  /** Eine Bestellung samt Positionen und Reservierungs-Sitzung, zum Laden an
   *  der Kasse. ADMIN + CASHIER. */
  get(client: ApiClient, orderNumber: string): Promise<OrderView> {
    return client.request<OrderView>('GET', `/api/orders/${encodeURIComponent(orderNumber)}`);
  },

  /** OFFEN → ANGENOMMEN. 409, wenn die Bestellung nicht mehr auf OFFEN steht. */
  approve(client: ApiClient, orderNumber: string): Promise<{ ok: boolean; mailed?: boolean }> {
    return client.request<{ ok: boolean; mailed?: boolean }>(
      'POST',
      `/api/orders/${encodeURIComponent(orderNumber)}/approve`,
    );
  },

  /** ANGENOMMEN → IN_VORBEREITUNG. */
  prepare(client: ApiClient, orderNumber: string): Promise<{ ok: boolean }> {
    return client.request<{ ok: boolean }>(
      'POST',
      `/api/orders/${encodeURIComponent(orderNumber)}/prepare`,
    );
  },

  /** IN_VORBEREITUNG → ABHOLBEREIT. Reiht den Brief „Ihr Stück liegt bereit"
   *  ein; `mailed` sagt ehrlich, ob er wirklich eingereiht wurde. */
  ready(client: ApiClient, orderNumber: string): Promise<{ ok: boolean; mailed?: boolean }> {
    return client.request<{ ok: boolean; mailed?: boolean }>(
      'POST',
      `/api/orders/${encodeURIComponent(orderNumber)}/ready`,
    );
  },

  /**
   * Ablehnen und die Stücke freigeben. Aus JEDEM laufenden Stand erlaubt,
   * auch aus „abholbereit": fällt ein Stück beim Vorbereiten als beschädigt
   * auf, muss man absagen dürfen, statt jemanden für nichts kommen zu lassen.
   *
   * `released` sagt, wie viele Stücke wirklich ins Regal zurückgingen, und
   * `mailed`, ob die Absage an die Kundschaft eingereiht wurde. Beide Zahlen
   * kommen vom Server; die Oberfläche behauptet nichts von sich aus.
   */
  reject(
    client: ApiClient,
    orderNumber: string,
    reason?: string,
  ): Promise<{ ok: boolean; released: number; mailed: boolean }> {
    return client.request<{ ok: boolean; released: number; mailed: boolean }>(
      'POST',
      `/api/orders/${encodeURIComponent(orderNumber)}/reject`,
      reason ? { reason } : {},
    );
  },
};
