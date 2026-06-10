/**
 * GeraeteKoppeln — companion-hub panel. The LAN hub is ALWAYS-ON: it
 * auto-starts with the POS and persisted pairings reconnect on their own, so
 * this panel only REFLECTS the hub state and helps add a NEW device.
 *
 * Tauri commands (src-tauri/src/commands/companion.rs):
 *   companion_status() -> CompanionInfo   (snapshot incl. paired devices)
 *   companion_start()  -> CompanionInfo   (on a running hub: mints a fresh
 *                                          single-use pairing code; pairings
 *                                          are kept — nothing disconnects)
 *
 * Opening the panel mints a pairing code once (that IS the "add a device"
 * intent); the interval refresh only reads status.
 *
 * Fail-safe: in a plain browser (dev, not the Tauri shell) `invoke` throws —
 * we catch it and show a German hint instead of crashing.
 */

import { invoke } from '@tauri-apps/api/core';
import { type CSSProperties, useEffect, useState } from 'react';

import { Button } from '@warehouse14/ui-kit';

/** Mirrors the Rust `CompanionInfo` (serde camelCase). The paired fields are
 *  optional only for forward/backward compat with older native builds. */
interface CompanionInfo {
  running: boolean;
  url: string;
  port: number;
  pairingCode: string;
  qrSvg: string;
  /** Number of currently paired (non-idle-expired) companion devices. */
  pairedCount?: number;
  /** German labels of the paired devices, e.g. "Lager", "Zweitkasse". */
  pairedDevices?: string[];
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

const sectionLabel: CSSProperties = {
  fontSize: '0.72rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
};

export function GeraeteKoppeln(): JSX.Element {
  const [info, setInfo] = useState<CompanionInfo>(EMPTY);
  const [busy, setBusy] = useState(false);
  /** true once we know the native command is unavailable (e.g. plain browser). */
  const [unavailable, setUnavailable] = useState(false);

  // On mount: mint a pairing code (companion_start — rotates on a running hub,
  // boots a hub that lost its bind race; persisted pairings are unaffected).
  // The interval then only refreshes the status snapshot (device list).
  useEffect(() => {
    let active = true;
    invoke<CompanionInfo>('companion_start')
      .then((started) => {
        if (active) {
          setInfo(started);
          setUnavailable(false);
        }
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });

    const timer = window.setInterval(() => {
      invoke<CompanionInfo>('companion_status')
        .then((status) => {
          if (!active) return;
          // Keep the minted code visible — status reports the same snapshot,
          // but never regress to an empty one if a race blanks it briefly.
          setInfo((cur) => (status.running ? status : cur));
          setUnavailable(false);
        })
        .catch(() => {
          if (active) setUnavailable(true);
        });
    }, 10_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  /** The pairing code is single-use — mint the next one for the next device. */
  const issueNewCode = async (): Promise<void> => {
    setBusy(true);
    try {
      const next = await invoke<CompanionInfo>('companion_start');
      setInfo(next);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    } finally {
      setBusy(false);
    }
  };

  const pairedDevices = info.pairedDevices ?? null;
  const pairedCount = pairedDevices?.length ?? info.pairedCount ?? null;
  /** "Lager, Lager, Zweitkasse" → [["Lager", 2], ["Zweitkasse", 1]] (stable keys). */
  const groupedDevices = pairedDevices
    ? [...pairedDevices.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>())]
    : null;

  return (
    <div style={{ padding: 24, display: 'grid', gap: 18, maxWidth: 760 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 600, color: 'var(--w14-ink)' }}>
          Geräte koppeln — iPad · Tablet · Mobil
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--w14-ink-faded)', fontSize: '0.88rem' }}>
          Der Begleit-Server dieser Kasse läuft automatisch — bereits gekoppelte Geräte verbinden
          sich von selbst. Zum Hinzufügen eines neuen Geräts im selben Geschäfts-WLAN scannen Sie
          den QR-Code mit der Kamera des Geräts und geben den Kopplungscode ein.
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
        <>
          {/* Hub status + paired devices */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: 'var(--w14-verdigris)',
                  display: 'inline-block',
                }}
              />
              <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--w14-ink)' }}>
                Begleit-Server aktiv
              </span>
              <span
                style={{
                  fontFamily: 'var(--w14-font-mono)',
                  fontSize: '0.82rem',
                  color: 'var(--w14-ink-faded)',
                  marginLeft: 'auto',
                  wordBreak: 'break-all',
                }}
              >
                {info.url}
              </span>
            </div>

            <div style={{ display: 'grid', gap: 6 }}>
              <span style={sectionLabel}>Gekoppelte Geräte</span>
              {groupedDevices && groupedDevices.length > 0 ? (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
                  {groupedDevices.map(([label, count]) => (
                    <li
                      key={label}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: '0.88rem',
                        color: 'var(--w14-ink)',
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          background: 'var(--w14-verdigris)',
                          display: 'inline-block',
                        }}
                      />
                      <span style={{ fontWeight: 600 }}>{label}</span>
                      {count > 1 ? (
                        <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
                          × {count}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : pairedCount !== null && pairedCount > 0 ? (
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--w14-ink)' }}>
                  {pairedCount === 1 ? '1 Gerät verbunden' : `${pairedCount} Geräte verbunden`}
                </p>
              ) : (
                <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--w14-ink-faded)' }}>
                  Noch kein Gerät gekoppelt — gekoppelte Geräte erscheinen hier.
                </p>
              )}
            </div>
          </div>

          {/* Add a NEW device: QR + single-use code */}
          <div style={card}>
            <span style={sectionLabel}>Neues Gerät hinzufügen</span>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
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
                  <span style={sectionLabel}>Kopplungscode</span>
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
                    {info.pairingCode || '······'}
                  </span>
                  {!info.pairingCode ? (
                    <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
                      Der Code wurde bereits verwendet — erzeugen Sie unten einen neuen.
                    </span>
                  ) : null}
                </div>

                <div style={{ display: 'grid', gap: 5 }}>
                  <span style={sectionLabel}>Adresse im WLAN</span>
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
              Der Kopplungscode gilt für genau ein Gerät. Nach erfolgreicher Kopplung — oder wenn
              der Code abgelaufen ist — erzeugen Sie für das nächste Gerät einfach einen neuen.
              Bereits verbundene Geräte bleiben dabei verbunden.
            </p>

            <div>
              <Button variant="ghost" size="md" disabled={busy} onClick={() => void issueNewCode()}>
                {busy ? 'Bitte warten …' : 'Neuen Kopplungscode erzeugen'}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div style={card}>
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--w14-ink-faded)' }}>
            Der Begleit-Server wird gestartet … Falls diese Meldung bestehen bleibt, ist der
            Netzwerk-Port belegt — bitte Kasse neu starten.
          </p>
        </div>
      )}
    </div>
  );
}
