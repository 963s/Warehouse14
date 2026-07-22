/**
 * Support tickets — the staff side of the customer conversation (0097).
 *
 * One wrapper for both staff apps. The counter and the owner read the same
 * queue and answer with the same call, so a change here reaches both or
 * neither; there is deliberately no second copy of this shape anywhere.
 */

import type { ApiClient } from '../client.js';

export type TicketStatus = 'OFFEN' | 'WARTET' | 'GESCHLOSSEN';

export interface SupportTicketSummary {
  id: string;
  /** TIC-2026-000001 — said aloud, quoted in a subject line, searched for. */
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  channel: string;
  customerId: string | null;
  customerName: string | null;
  customerNumber: string | null;
  messageCount: number;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  /**
   * The customer spoke last and is still waiting. This is the queue's real
   * sort key: a ticket nobody has answered outranks a newer one that has
   * already had a reply.
   */
  awaitingReply: boolean;
  createdAt: string;
}

export interface SupportMessage {
  id: string;
  direction: string;
  from: string;
  to: string;
  body: string;
  authorUserId: string | null;
  createdAt: string;
}

export interface SupportTicketDetail extends SupportTicketSummary {
  messages: SupportMessage[];
}

export const supportApi = {
  /** Open tickets by default; pass a status to see one bucket. */
  list(client: ApiClient, status?: TicketStatus): Promise<SupportTicketSummary[]> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return client.request<SupportTicketSummary[]>('GET', `/api/support/tickets${q}`);
  },

  get(client: ApiClient, id: string): Promise<SupportTicketDetail> {
    return client.request<SupportTicketDetail>(
      'GET',
      `/api/support/tickets/${encodeURIComponent(id)}`,
    );
  },

  /**
   * Answer. The letter goes out through the same outbox the reservation mail
   * uses, from the address the customer wrote to, and the ticket moves to
   * WARTET — never GESCHLOSSEN, because we have replied and they have not yet
   * said whether that settled it.
   */
  reply(client: ApiClient, id: string, body: string): Promise<{ ok: boolean; ticketNumber: string }> {
    return client.request<{ ok: boolean; ticketNumber: string }>(
      'POST',
      `/api/support/tickets/${encodeURIComponent(id)}/reply`,
      { body: { body } },
    );
  },

  setStatus(client: ApiClient, id: string, status: TicketStatus): Promise<{ ok: boolean; status: string }> {
    return client.request<{ ok: boolean; status: string }>(
      'POST',
      `/api/support/tickets/${encodeURIComponent(id)}/status`,
      { body: { status } },
    );
  },
};
