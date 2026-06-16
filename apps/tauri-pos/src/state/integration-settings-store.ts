/**
 * integration-settings-store — operator-configurable integration settings that
 * live on THIS terminal (localStorage). Covers the things the desktop app can
 * wire itself: the Chatwoot customer-service widget, social handles shown in
 * the app, and AI/automation feature toggles. Backend SECRETS (Anthropic key,
 * WhatsApp tokens, R2, …) stay in the server `.env` — the settings UI shows
 * their status, it does not store them here.
 */

import { Type } from '@sinclair/typebox';
import { create } from 'zustand';

import { parseResponse } from '@warehouse14/api-client';

const KEY = 'warehouse14.integrations.v1';

// Persisted-config validation (P2.6): a corrupt section (e.g. a non-boolean
// `ai.visionEnabled`) falls back to its default rather than flipping a toggle to
// a truthy string. Each section is merged over its default then validated.
const ChatwootSchema = Type.Object({
  enabled: Type.Boolean(),
  baseUrl: Type.String(),
  websiteToken: Type.String(),
});
const SocialSchema = Type.Object({
  whatsappNumber: Type.String(),
  instagramHandle: Type.String(),
  facebookPage: Type.String(),
});
const AiSchema = Type.Object({
  visionEnabled: Type.Boolean(),
  priceEstimateEnabled: Type.Boolean(),
});
const GoogleCalendarSchema = Type.Object({
  apiKey: Type.String(),
  calendarId: Type.String(),
});

function validateSection<T extends object>(
  schema: Parameters<typeof parseResponse>[0],
  fallback: T,
  raw: unknown,
  label: string,
): T {
  const candidate =
    raw !== null && typeof raw === 'object' ? { ...fallback, ...(raw as object) } : fallback;
  return (parseResponse(schema, candidate, label) as T | null) ?? fallback;
}

export interface ChatwootConfig {
  enabled: boolean;
  baseUrl: string; // e.g. https://chat.warehouse14.de
  websiteToken: string; // Chatwoot inbox website token
}
export interface SocialConfig {
  whatsappNumber: string;
  instagramHandle: string;
  facebookPage: string;
}
export interface GoogleCalendarConfig {
  /**
   * Google-Cloud API-Schlüssel (Calendar API aktiviert). Wird terminal-lokal
   * gespeichert und nur für den clientseitigen Lese-Fetch der Termine genutzt.
   */
  apiKey: string;
  /**
   * Kalender-ID — z. B. `xyz@group.calendar.google.com` oder die Gmail-Adresse
   * des Kontos. Der Kalender muss öffentlich oder für den Schlüssel freigegeben
   * sein, damit die Termine gelesen werden können.
   */
  calendarId: string;
}
export interface AiConfig {
  visionEnabled: boolean; // AI photo → attributes
  priceEstimateEnabled: boolean; // AI price suggestion
}
export interface IntegrationSettings {
  chatwoot: ChatwootConfig;
  social: SocialConfig;
  ai: AiConfig;
  googleCalendar: GoogleCalendarConfig;
}

const DEFAULT: IntegrationSettings = {
  chatwoot: { enabled: false, baseUrl: '', websiteToken: '' },
  social: { whatsappNumber: '', instagramHandle: '', facebookPage: '' },
  ai: { visionEnabled: true, priceEstimateEnabled: true },
  googleCalendar: { apiKey: '', calendarId: '' },
};

interface State {
  settings: IntegrationSettings;
  setChatwoot: (patch: Partial<ChatwootConfig>) => void;
  setSocial: (patch: Partial<SocialConfig>) => void;
  setAi: (patch: Partial<AiConfig>) => void;
  setGoogleCalendar: (patch: Partial<GoogleCalendarConfig>) => void;
}

function load(): IntegrationSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      chatwoot: validateSection(ChatwootSchema, DEFAULT.chatwoot, p.chatwoot, 'int.chatwoot'),
      social: validateSection(SocialSchema, DEFAULT.social, p.social, 'int.social'),
      ai: validateSection(AiSchema, DEFAULT.ai, p.ai, 'int.ai'),
      googleCalendar: validateSection(
        GoogleCalendarSchema,
        DEFAULT.googleCalendar,
        p.googleCalendar,
        'int.googleCalendar',
      ),
    };
  } catch {
    return DEFAULT;
  }
}
function persist(s: IntegrationSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // non-fatal
  }
}

export const useIntegrationSettings = create<State>((set, get) => ({
  settings: load(),
  setChatwoot: (patch) => {
    const next = { ...get().settings, chatwoot: { ...get().settings.chatwoot, ...patch } };
    persist(next);
    set({ settings: next });
  },
  setSocial: (patch) => {
    const next = { ...get().settings, social: { ...get().settings.social, ...patch } };
    persist(next);
    set({ settings: next });
  },
  setAi: (patch) => {
    const next = { ...get().settings, ai: { ...get().settings.ai, ...patch } };
    persist(next);
    set({ settings: next });
  },
  setGoogleCalendar: (patch) => {
    const next = {
      ...get().settings,
      googleCalendar: { ...get().settings.googleCalendar, ...patch },
    };
    persist(next);
    set({ settings: next });
  },
}));
