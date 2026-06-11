/**
 * integration-settings-store — operator-configurable integration settings that
 * live on THIS terminal (localStorage). Covers the things the desktop app can
 * wire itself: the Chatwoot customer-service widget, social handles shown in
 * the app, and AI/automation feature toggles. Backend SECRETS (Anthropic key,
 * WhatsApp tokens, R2, …) stay in the server `.env` — the settings UI shows
 * their status, it does not store them here.
 */

import { create } from 'zustand';

const KEY = 'warehouse14.integrations.v1';

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
   * Google-Kalender Embed-URL (oder nur die Kalender-ID). Wird RAW als
   * iframe-`src` eingebettet — z. B.
   * https://calendar.google.com/calendar/embed?src=…&mode=WEEK&hl=de
   */
  embedUrl: string;
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
  googleCalendar: { embedUrl: '' },
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
    const p = JSON.parse(raw) as Partial<IntegrationSettings>;
    return {
      chatwoot: { ...DEFAULT.chatwoot, ...(p.chatwoot ?? {}) },
      social: { ...DEFAULT.social, ...(p.social ?? {}) },
      ai: { ...DEFAULT.ai, ...(p.ai ?? {}) },
      googleCalendar: { ...DEFAULT.googleCalendar, ...(p.googleCalendar ?? {}) },
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
