/**
 * Das Benachrichtigungs- und Marketing-Zentrum (0105) — der Client-Weg.
 *
 * Der Inhaber schreibt EINEN Gruss je Sprache, waehlt Kanal und Kreis, und der
 * Server traegt ihn aus: App-Benachrichtigung, E-Mail oder beides. E-Mail geht
 * IMMER nur an Einwilligende (UWG), unabhaengig vom gewaehlten Kreis.
 */
import type { ApiClient } from '../client.js';

/** Ein Titel + ein Text in EINER Sprache. */
export interface BroadcastLocaleContent {
  title: string;
  body: string;
}

export interface SendBroadcastBody {
  viaPush: boolean;
  viaEmail: boolean;
  /** 'ALL' — jeder Erreichbare (nur fuer Push sinnvoll). 'MARKETING' — nur
   *  wer der Werbung zugestimmt hat. */
  audience: 'ALL' | 'MARKETING';
  /** Sprach-Karte: { de: {...}, ar: {...} }. `de` ist Pflicht. */
  content: Record<string, BroadcastLocaleContent>;
  /** Wohin die App beim Antippen springt, oder weglassen. */
  deepLink?: string;
}

export interface SendBroadcastResult {
  id: string;
  /** Wie viele App-Benachrichtigungen eingereiht wurden. */
  queuedPush: number;
  /** Wie viele E-Mails eingereiht wurden. */
  queuedEmail: number;
  /** Wie viele NICHT erreicht wurden, weil die Einwilligung fehlt. */
  skippedNoConsent: number;
}

export interface BroadcastHistoryItem {
  id: string;
  createdAt: string;
  viaPush: boolean;
  viaEmail: boolean;
  audience: string;
  title: string;
  queuedPush: number;
  queuedEmail: number;
  skippedNoConsent: number;
}

export const broadcastsApi = {
  /** Ein Rundschreiben senden. Nur Inhaber (ADMIN). */
  send(client: ApiClient, body: SendBroadcastBody): Promise<SendBroadcastResult> {
    return client.request<SendBroadcastResult>('POST', '/api/broadcasts', body);
  },

  /** Was zuletzt hinausging — das ehrliche Gedaechtnis des Versands. */
  history(client: ApiClient): Promise<{ items: BroadcastHistoryItem[] }> {
    return client.request<{ items: BroadcastHistoryItem[] }>('GET', '/api/broadcasts');
  },
};
