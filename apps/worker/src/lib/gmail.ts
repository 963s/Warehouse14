/**
 * Gmail, read and label, through the service account that already exists.
 *
 * There is no password anywhere in this file and there cannot be: Google has
 * app passwords disabled for this tenant, which is the same wall the outbound
 * relay hit. The way in is domain-wide delegation — the service account signs
 * a JWT asserting "let me act as this user", Google hands back an access token
 * for that mailbox, and no human credential is involved.
 *
 * The service account (`GOOGLE_SERVICE_ACCOUNT_B64`) has been on this server
 * since the Calendar work and its delegation already covers gmail.modify. It
 * was verified on 2026-07-22 by minting a live token and reading a profile.
 *
 * Two failures look similar and are not. Learn them once:
 *   unauthorized_client                  → the SCOPE is not delegated
 *   invalid_grant / Invalid email or ... → the SUBJECT is not a real user
 * An alias cannot be impersonated. Only a real mailbox can.
 */

import { SignJWT, importPKCS8 } from 'jose';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
/** Read, label and mark as read. Deliberately NOT gmail.full: no delete. */
const SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  /** Header lookup is case-insensitive: senders capitalise as they please. */
  header: (name: string) => string | null;
  /** Decoded text body, HTML stripped to text when that is all there is. */
  body: string;
}

function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/**
 * Pull the readable text out of a MIME tree.
 *
 * Prefers text/plain. Falls back to text/html with the tags removed, because a
 * customer writing from a phone often sends HTML only, and a ticket showing
 * raw markup is a ticket nobody reads.
 */
function extractBody(payload: unknown): string {
  const parts: string[] = [];
  let htmlFallback = '';

  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    const mime = node.mimeType as string | undefined;
    const data = node.body?.data as string | undefined;
    if (data) {
      if (mime === 'text/plain') parts.push(decodeB64Url(data));
      else if (mime === 'text/html' && !htmlFallback) htmlFallback = decodeB64Url(data);
    }
    for (const child of node.parts ?? []) walk(child);
  };
  walk(payload);

  if (parts.length) return parts.join('\n').trim();
  if (htmlFallback) {
    return htmlFallback
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return '';
}

export class GmailClient {
  private token: string | null = null;
  private expiresAt = 0;

  constructor(
    private readonly serviceAccountB64: string,
    /** The mailbox to act as. MUST be a real user, never an alias. */
    private readonly subject: string,
  ) {}

  /** Cached until a minute before expiry, so a batch costs one token mint. */
  private async accessToken(nowMs: number): Promise<string> {
    if (this.token && nowMs < this.expiresAt - 60_000) return this.token;

    const sa = JSON.parse(
      Buffer.from(this.serviceAccountB64, 'base64').toString('utf8'),
    ) as ServiceAccount;
    const iat = Math.floor(nowMs / 1000);
    const key = await importPKCS8(sa.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(sa.client_email)
      .setSubject(this.subject)
      .setAudience(TOKEN_URL)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(key);

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!json.access_token) {
      throw new Error(
        `gmail auth failed for ${this.subject}: ${json.error ?? res.status} ${json.error_description ?? ''}`.trim(),
      );
    }
    this.token = json.access_token;
    this.expiresAt = nowMs + 3600_000;
    return this.token;
  }

  private async call(path: string, nowMs: number, init?: RequestInit): Promise<unknown> {
    const token = await this.accessToken(nowMs);
    const res = await fetch(`${GMAIL}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (json as { error?: { message?: string } }).error?.message ?? res.statusText;
      throw new Error(`gmail ${path}: ${res.status} ${msg}`);
    }
    return json;
  }

  /** Ids only — the list endpoint never returns useful content anyway. */
  async listIds(query: string, limit: number, nowMs: number): Promise<string[]> {
    const json = (await this.call(
      `/messages?maxResults=${limit}&q=${encodeURIComponent(query)}`,
      nowMs,
    )) as { messages?: { id: string }[] };
    return (json.messages ?? []).map((m) => m.id);
  }

  async get(id: string, nowMs: number): Promise<GmailMessage> {
    const json = (await this.call(`/messages/${id}?format=full`, nowMs)) as {
      id: string;
      threadId: string;
      payload?: { headers?: GmailHeader[] };
    };
    const headers = json.payload?.headers ?? [];
    const lookup = new Map(headers.map((h) => [h.name.toLowerCase(), h.value]));
    return {
      id: json.id,
      threadId: json.threadId,
      header: (name) => lookup.get(name.toLowerCase()) ?? null,
      body: extractBody(json.payload),
    };
  }

  /**
   * Mark as read. This is the ONLY thing that stops the poller seeing the same
   * message next minute, so it must run even when the rest of the handling
   * failed; a message we cannot file is still a message we have seen.
   */
  async markRead(id: string, nowMs: number): Promise<void> {
    await this.call(`/messages/${id}/modify`, nowMs, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    });
  }
}

/** The address a message was delivered to, as written in To or Cc. */
export function addressOf(raw: string | null): string | null {
  if (!raw) return null;
  const angled = raw.match(/<([^>]+)>/);
  const value = (angled?.[1] ?? raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

/** Display name from a From header, when the sender bothered to set one. */
export function displayNameOf(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^\s*"?([^"<]+?)"?\s*</);
  const name = m?.[1]?.trim();
  return name && !name.includes('@') ? name : null;
}
