/**
 * GeraeteKoppeln — pair an iPad / tablet / phone with this POS terminal as a
 * companion device. The mother POS embeds a small LAN server; this panel starts
 * it, then shows a QR code (server-rendered SVG), the LAN URL, and a 6-digit
 * pairing code the owner reads to the device.
 *
 * The three Tauri commands are implemented natively (src-tauri):
 *   companion_start()  -> CompanionInfo
 *   companion_stop()   -> ()  (idempotent)
 *   companion_status() -> CompanionInfo
 *
 * Fail-safe: in a plain browser (dev, not the Tauri shell) `invoke` throws —
 * we catch it and show a German hint instead of crashing.
 */

import { invoke } from '@tauri-apps/api/core';
import { type CSSProperties, useEffect, useState } from 'react';

import { Button } from '@warehouse14/ui-kit';

/** Mirrors the Rust `CompanionInfo` (serde camelCase). */
interface CompanionInfo {
  running: boolean;
  url: string;
  port: number;
  pairingCode: string;
  qrSvg: string;
}

const EMPTY: CompanionInfo = { running: false, url: '', port: 0, pairingCode: '', qrSvg: '' };

const card: CSSProperties = {
  background: 'var(--w14-parchment-2)',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-card)',
  padding: 20,
  display: 'grid',
  gap: 14,
  boxShadow: 'var(--w14-shadow-card)',
};

export function GeraeteKoppeln(): JSX.Element {
  const [info, setInfo] = useState<CompanionInfo>(EMPTY);
  const [busy, setBusy] = useState(false);
  /** true once we know the native command is unavailable (e.g. plain browser). */
  const [unavailable, setUnavailable] = useState(false);

  // Reflect current state on mount.
  useEffect(() => {
    let active = true;
    invoke<CompanionInfo>('companion_status')
      .then((status) => {
        if (active) setInfo(status);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      const started = await invoke<CompanionInfo>('companion_start');
      setInfo(started);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    } finally {
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    setBusy(true);
    try {
      await invoke('companion_stop');
      setInfo(EMPTY);
    } catch {
      setUnavailable(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 24, display: 'grid', gap: 18, maxWidth: 760 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 600, color: 'var(--w14-ink)' }}>
          Geräte koppeln — iPad · Tablet · Mobil
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--w14-ink-faded)', fontSize: '0.88rem' }}>
          Verbinden Sie ein iPad, Tablet oder Mobilgerät als Begleitgerät mit dieser Kasse. Das
          Gerät muss sich im selben Geschäfts-WLAN befinden. Scannen Sie den QR-Code mit der Kamera
          des Geräts, um die Begleit-Ansicht zu öffnen.
        </p>
      </div>

      {unavailable && !info.running ? (
        <div style={card}>
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--w14-ink-faded)' }}>
            Die Gerätekopplung ist nur in der installierten Kassen-App verfügbar, nicht in der
            Vorschau im Browser. Bitte öffnen Sie diese Funktion direkt an der Kasse.
          </p>
        </div>
      ) : info.running ? (
        <div style={card}>
          <div
            style={{
              display: 'flex',
              gap: 24,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <div
              aria-label="QR-Code zum Koppeln"
              style={{
                width: 200,
                height: 200,
                flex: '0 0 auto',
                background: '#fff',
                border: '1px solid var(--w14-rule)',
                borderRadius: 'var(--w14-radius-button)',
                padding: 10,
                display: 'grid',
                placeItems: 'center',
              }}
              // The SVG is generated natively by the qrcode crate (trusted source),
              // not user input — safe to inline. Renders without a JS QR library.
              // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered trusted SVG
              dangerouslySetInnerHTML={{ __html: info.qrSvg }}
            />

            <div style={{ display: 'grid', gap: 14, minWidth: 220 }}>
              <div style={{ display: 'grid', gap: 5 }}>
                <span
                  style={{
                    fontSize: '0.72rem',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--w14-ink-faded)',
                  }}
                >
                  Kopplungscode
                </span>
                <span
                  style={{
                    fontFamily: 'var(--w14-font-mono)',
                    fontSize: '2.4rem',
                    fontWeight: 700,
                    letterSpacing: '0.18em',
                    color: 'var(--w14-ink)',
                    lineHeight: 1,
                  }}
                >
                  {info.pairingCode}
                </span>
              </div>

              <div style={{ display: 'grid', gap: 5 }}>
                <span
                  style={{
                    fontSize: '0.72rem',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--w14-ink-faded)',
                  }}
                >
                  Adresse im WLAN
                </span>
                <span
                  style={{
                    fontFamily: 'var(--w14-font-mono)',
                    fontSize: '0.95rem',
                    color: 'var(--w14-ink)',
                    wordBreak: 'break-all',
                  }}
                >
                  {info.url}
                </span>
              </div>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--w14-ink-faded)' }}>
            Scannen Sie den QR-Code mit dem Gerät oder rufen Sie die Adresse im Browser auf. Lassen
            Sie diese Kasse währenddessen eingeschaltet.
          </p>

          <div>
            <Button variant="ghost" size="md" disabled={busy} onClick={() => void stop()}>
              {busy ? 'Bitte warten …' : 'Kopplung beenden'}
            </Button>
          </div>
        </div>
      ) : (
        <div style={card}>
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--w14-ink-faded)' }}>
            Starten Sie die Kopplung, um einen QR-Code und einen 6-stelligen Code für das
            Begleitgerät anzuzeigen.
          </p>
          <div>
            <Button variant="primary" size="md" disabled={busy} onClick={() => void start()}>
              {busy ? 'Wird gestartet …' : 'Kopplung starten'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
