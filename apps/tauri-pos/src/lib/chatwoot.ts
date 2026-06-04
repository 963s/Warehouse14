/**
 * chatwoot — load + control the self-hosted Chatwoot live-chat widget on demand.
 *
 * The widget SDK is fetched from the operator's own Chatwoot host (configured
 * in Einstellungen → Kundenservice). The Tauri CSP must allow that host (see
 * tauri.conf.json — chat.warehouse14.de is allow-listed). A human agent answers
 * from the Chatwoot dashboard, so "human intervention" is built in.
 */

import type { ChatwootConfig } from '../state/integration-settings-store.js';

interface ChatwootWindow extends Window {
  chatwootSettings?: Record<string, unknown>;
  chatwootSDK?: { run: (opts: { websiteToken: string; baseUrl: string }) => void };
  $chatwoot?: { toggle?: (s?: 'open' | 'close') => void; reset?: () => void };
}

const SCRIPT_ID = 'w14-chatwoot-sdk';

function clean(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function run(cfg: ChatwootConfig): void {
  const w = window as unknown as ChatwootWindow;
  w.chatwootSDK?.run({ websiteToken: cfg.websiteToken.trim(), baseUrl: clean(cfg.baseUrl) });
}

/**
 * Apply the current Chatwoot config: inject + run the widget when enabled and
 * configured; tear it down otherwise. Safe to call repeatedly.
 */
export function applyChatwoot(cfg: ChatwootConfig): void {
  if (typeof document === 'undefined') return;
  const w = window as unknown as ChatwootWindow;
  const ready = cfg.enabled && clean(cfg.baseUrl).length > 0 && cfg.websiteToken.trim().length > 0;

  if (!ready) {
    try {
      w.$chatwoot?.reset?.();
    } catch {
      // ignore
    }
    return;
  }

  // Already loaded → just (re)run with the latest token/host.
  if (document.getElementById(SCRIPT_ID)) {
    run(cfg);
    return;
  }

  w.chatwootSettings = {
    position: 'right',
    type: 'expanded_bubble',
    launcherTitle: 'Kundenservice',
    locale: 'de',
  };
  const s = document.createElement('script');
  s.id = SCRIPT_ID;
  s.src = `${clean(cfg.baseUrl)}/packs/js/sdk.js`;
  s.async = true;
  s.defer = true;
  s.onload = () => run(cfg);
  document.head.appendChild(s);
}

/** Open the chat window programmatically (e.g. from a "Kundenservice" button). */
export function openChatwoot(): void {
  try {
    (window as unknown as ChatwootWindow).$chatwoot?.toggle?.('open');
  } catch {
    // ignore
  }
}
