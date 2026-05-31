/**
 * WhatsApp Inbox domain client (Phase 2 Day 9).
 *
 *   listThreads()                 — GET    /api/whatsapp/threads
 *   getThread(phone)              — GET    /api/whatsapp/threads/:phone
 *   send({...})                   — POST   /api/whatsapp/send
 *   markHandled(id)               — PATCH  /api/whatsapp/messages/:id/handled
 *   linkCustomer(id, customerId)  — PATCH  /api/whatsapp/messages/:id/link-customer
 *
 * The send endpoint may resolve to `status: 'queued'` when the operator has
 * not configured Meta credentials yet — the row is stored regardless. A
 * provider rejection surfaces as `ApiError` with code `EXTERNAL_SERVICE_FAILED`.
 */

import type { ApiClient } from '../client.js';

export type WhatsAppOutboundStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
export type WhatsAppMessageDirection = 'inbound' | 'outbound';

export interface WhatsAppThreadSummary {
  phone: string;
  linkedCustomerId: string | null;
  linkedCustomerName: string | null;
  lastMessagePreview: string;
  lastMessageAt: string;
  lastMessageDirection: WhatsAppMessageDirection;
  unreadCount: number;
}

export interface WhatsAppThreadListResponse {
  items: WhatsAppThreadSummary[];
}

export interface WhatsAppMessage {
  id: string;
  direction: WhatsAppMessageDirection;
  body: string;
  timestamp: string;
  /** null for inbound messages; provider lifecycle for outbound. */
  status: WhatsAppOutboundStatus | null;
  /** ISO timestamp when an inbound message was triaged; null otherwise. */
  handledAt: string | null;
}

export interface WhatsAppThreadDetail {
  phone: string;
  linkedCustomerId: string | null;
  linkedCustomerName: string | null;
  /** Whether the AI assistant currently answers this thread. */
  aiActive: boolean;
  /** ISO timestamp the human-takeover cooldown ends, or null. */
  cooldownUntil: string | null;
  messages: WhatsAppMessage[];
}

export interface WhatsAppAiStatusResponse {
  phone: string;
  aiActive: boolean;
  cooldownUntil: string | null;
}

export interface WhatsAppSendBody {
  toPhone: string;
  body: string;
  templateName?: string;
  templateParams?: Record<string, string>;
}

export interface WhatsAppSendResponse {
  id: string;
  toPhone: string;
  body: string;
  status: WhatsAppOutboundStatus;
  providerMessageId: string | null;
  sentAt: string;
}

export interface WhatsAppMarkHandledResponse {
  id: string;
  handledAt: string;
  handledByUserId: string;
}

export interface WhatsAppLinkCustomerResponse {
  id: string;
  linkedCustomerId: string;
}

export const whatsappApi = {
  listThreads(client: ApiClient): Promise<WhatsAppThreadListResponse> {
    return client.request<WhatsAppThreadListResponse>('GET', '/api/whatsapp/threads');
  },
  getThread(client: ApiClient, phone: string): Promise<WhatsAppThreadDetail> {
    return client.request<WhatsAppThreadDetail>(
      'GET',
      `/api/whatsapp/threads/${encodeURIComponent(phone)}`,
    );
  },
  send(client: ApiClient, body: WhatsAppSendBody): Promise<WhatsAppSendResponse> {
    return client.request<WhatsAppSendResponse>('POST', '/api/whatsapp/send', body);
  },
  markHandled(client: ApiClient, messageId: string): Promise<WhatsAppMarkHandledResponse> {
    return client.request<WhatsAppMarkHandledResponse>(
      'PATCH',
      `/api/whatsapp/messages/${encodeURIComponent(messageId)}/handled`,
    );
  },
  linkCustomer(
    client: ApiClient,
    messageId: string,
    customerId: string,
  ): Promise<WhatsAppLinkCustomerResponse> {
    return client.request<WhatsAppLinkCustomerResponse>(
      'PATCH',
      `/api/whatsapp/messages/${encodeURIComponent(messageId)}/link-customer`,
      { customerId },
    );
  },
  updateAiStatus(
    client: ApiClient,
    phone: string,
    aiActive: boolean,
  ): Promise<WhatsAppAiStatusResponse> {
    return client.request<WhatsAppAiStatusResponse>(
      'PATCH',
      `/api/whatsapp/threads/${encodeURIComponent(phone)}/ai-status`,
      { aiActive },
    );
  },
};
