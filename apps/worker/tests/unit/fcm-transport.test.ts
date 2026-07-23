/**
 * Die eine Eigenschaft, die hier alles trägt: OHNE Schlüssel darf NIEMALS
 * Erfolg gemeldet werden.
 *
 * Das ist die Fehlerklasse, die in diesem Haus schon zweimal live war: eine
 * unkonfigurierte Anbindung, die trotzdem eine Bestätigung zurückgibt, und
 * danach steht in der Datenbank „zugestellt" für etwas, das nie ein Gerät
 * erreicht hat. Bei Bestellmeldungen heisst das: das Personal wartet auf einen
 * Ton, der nie kommt, und der Bildschirm behauptet, es sei alles hinaus.
 *
 * Geprüft wird ohne Netz. Ein Aufruf, der hier ein `fetch` auslöst, wäre selbst
 * schon der Fehler — deshalb wird `fetch` durch eine Falle ersetzt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL = { ...process.env };

async function frischesModul() {
  // Der Schlüssel wird im Modul zwischengespeichert. Für jeden Fall muss das
  // Modul neu geladen werden, sonst prüft der zweite Fall den ersten mit.
  vi.resetModules();
  return import('../../src/jobs/fcm-transport.js');
}

beforeEach(() => {
  delete process.env.FCM_SERVICE_ACCOUNT_JSON;
  delete process.env.FCM_SERVICE_ACCOUNT_FILE;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

describe('ohne hinterlegten Schlüssel', () => {
  it('sagt offen, dass die Zustellung nicht eingerichtet ist', async () => {
    const { fcmConfigured, fcmProjectId } = await frischesModul();
    expect(fcmConfigured()).toBe(false);
    expect(fcmProjectId()).toBeNull();
  });

  it('meldet NIEMALS Erfolg und rührt das Netz nicht an', async () => {
    const falle = vi.fn();
    vi.stubGlobal('fetch', falle);
    const { fcmSend } = await frischesModul();

    const r = await fcmSend({ token: 'egal', title: 'T', body: 'B', data: {} });

    expect(r.ok).toBe(false);
    expect(falle).not.toHaveBeenCalled();
    // Und ganz besonders: die Marke darf NICHT als tot gelten. Sonst würde ein
    // vergessener Schlüssel reihenweise gesunde Geräte abmelden, und nach dem
    // Nachtragen des Schlüssels bekäme niemand mehr etwas.
    expect(r.ok === false && r.unregistered).toBe(false);
  });
});

describe('mit unbrauchbarem Schlüssel', () => {
  it('behandelt einen kaputten Inhalt wie „nicht eingerichtet", statt zu stürzen', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = '{ das ist kein JSON';
    const { fcmConfigured } = await frischesModul();
    expect(fcmConfigured()).toBe(false);
  });

  it('lehnt einen JSON-Inhalt ohne die nötigen Felder ab', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'w-14' });
    const { fcmConfigured } = await frischesModul();
    expect(fcmConfigured()).toBe(false);
  });
});

describe('mit gültig geformtem Schlüssel', () => {
  const SCHLUESSEL = JSON.stringify({
    project_id: 'w-14-probe',
    client_email: 'probe@w-14-probe.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nnichtecht\n-----END PRIVATE KEY-----\n',
  });

  it('gilt als eingerichtet und nennt das Projekt', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = SCHLUESSEL;
    const { fcmConfigured, fcmProjectId } = await frischesModul();
    expect(fcmConfigured()).toBe(true);
    expect(fcmProjectId()).toBe('w-14-probe');
  });

  it('meldet einen Anmeldefehler als Fehler, nicht als tote Marke', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = SCHLUESSEL;
    // Ein unsignierbarer Schlüssel lässt `createSign` werfen. Das ist eine
    // Störung auf UNSERER Seite — das Gerät darf dafür nicht abgemeldet werden.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })),
    );
    const { fcmSend } = await frischesModul();

    const r = await fcmSend({ token: 'egal', title: 'T', body: 'B', data: {} });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.unregistered).toBe(false);
  });
});
