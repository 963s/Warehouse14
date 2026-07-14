/**
 * JarvisOverlay — „Vierzehn", the dramatic voice-assistant surface.
 *
 * The support button opens this full-screen command-center overlay. The orb +
 * waveform come from the MIT `react-ai-voice-visualizer` library (Canvas, zero
 * heavy deps); we re-theme it to the Warehouse 14 brass identity and drive it
 * from the live microphone so the orb reacts to the owner's real voice.
 *
 * PHASE 1 (this file): the VISUAL surface + real mic reactivity, standalone.
 * The OpenAI Realtime brain (POST /api/realtime/session → WebRTC → tool relay
 * to /api/mcp) plugs into `state` + `audioData` next, without touching the look.
 * Until then the persona is honest: read-only, „still under construction".
 */

import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  VoiceOrb,
  Waveform,
  useAudioAnalyser,
  useMicrophoneStream,
  type VoiceState,
} from 'react-ai-voice-visualizer';

// Warehouse 14 identity, pushed a touch futuristic for the orb glow.
const BRASS = '#e6c273';
const WAX = '#df7259';
const INK = '#0d0b07';

const STATUS_LABEL: Record<VoiceState, string> = {
  idle: 'Bereit',
  listening: 'Hört zu',
  thinking: 'Denkt nach',
  speaking: 'Spricht',
};

export interface JarvisOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function JarvisOverlay({ open, onClose }: JarvisOverlayProps): JSX.Element | null {
  const { stream, isActive, error, start, stop } = useMicrophoneStream();
  const { frequencyData, timeDomainData, volume } = useAudioAnalyser(stream, { fftSize: 256 });

  // Phase 1: state follows the mic (idle ↔ listening). Phase 2 drives it from
  // the Realtime session (thinking on tool call, speaking on model audio).
  const state: VoiceState = isActive ? 'listening' : 'idle';

  // Close on Escape; always release the mic when the overlay goes away.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open && isActive) stop();
  }, [open, isActive, stop]);

  const toggleMic = useCallback(() => {
    if (isActive) stop();
    else void start();
  }, [isActive, start, stop]);

  if (!open) return null;

  const brace = (pos: 'tl' | 'tr' | 'bl' | 'br'): React.CSSProperties => {
    const s: React.CSSProperties = {
      position: 'absolute',
      width: 34,
      height: 34,
      borderColor: 'rgba(230,194,115,0.55)',
      borderStyle: 'solid',
      borderWidth: 0,
    };
    if (pos === 'tl') return { ...s, top: 18, left: 18, borderTopWidth: 2, borderLeftWidth: 2 };
    if (pos === 'tr') return { ...s, top: 18, right: 18, borderTopWidth: 2, borderRightWidth: 2 };
    if (pos === 'bl') return { ...s, bottom: 18, left: 18, borderBottomWidth: 2, borderLeftWidth: 2 };
    return { ...s, bottom: 18, right: 18, borderBottomWidth: 2, borderRightWidth: 2 };
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vierzehn, Sprachassistent"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        display: 'grid',
        placeItems: 'center',
        color: BRASS,
        background: `radial-gradient(120% 90% at 50% 30%, rgba(35,26,12,0.72), rgba(8,7,4,0.92) 70%), ${INK}`,
        backdropFilter: 'blur(6px)',
        // scanline texture — the sci-fi tell, very faint
        backgroundBlendMode: 'normal',
        animation: 'w14JarvisIn 420ms cubic-bezier(0.2,0.8,0.2,1) both',
      }}
    >
      <style>{`
        @keyframes w14JarvisIn { from { opacity: 0; transform: scale(1.03); } to { opacity: 1; transform: none; } }
        @keyframes w14Scan { from { background-position: 0 0; } to { background-position: 0 6px; } }
        @media (prefers-reduced-motion: reduce) { [data-w14-jarvis] { animation: none !important; } }
      `}</style>

      {/* scanlines */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(230,194,115,0.03) 2px, rgba(230,194,115,0.03) 3px)',
        }}
      />
      {/* corner braces */}
      <div aria-hidden style={brace('tl')} />
      <div aria-hidden style={brace('tr')} />
      <div aria-hidden style={brace('bl')} />
      <div aria-hidden style={brace('br')} />

      {/* top HUD readout */}
      <div
        style={{
          position: 'absolute',
          top: 26,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          gap: 22,
          fontFamily: 'var(--w14-font-mono, ui-monospace, monospace)',
          fontSize: '0.66rem',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'rgba(230,194,115,0.7)',
        }}
      >
        <span>System · Warehouse 14</span>
        <span>Modus · Nur-Lesen</span>
        <span>Status · {STATUS_LABEL[state]}</span>
      </div>

      {/* centre column: wordmark, orb, waveform, persona, controls */}
      <div data-w14-jarvis style={{ display: 'grid', placeItems: 'center', gap: 18, textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--w14-font-display, Georgia, serif)',
            fontSize: 'clamp(2rem, 5vw, 3rem)',
            fontWeight: 600,
            letterSpacing: '0.04em',
            color: BRASS,
            textShadow: '0 0 24px rgba(230,194,115,0.35)',
          }}
        >
          Vierzehn
        </div>

        <VoiceOrb
          audioData={frequencyData}
          volume={volume}
          state={state}
          size={230}
          primaryColor={BRASS}
          secondaryColor={WAX}
          glowIntensity={1.5}
        />

        <div style={{ width: 'min(420px, 78vw)', height: 44 }}>
          <Waveform timeDomainData={timeDomainData} height={44} color={BRASS} animated />
        </div>

        <p
          style={{
            fontFamily: 'var(--w14-font-body, system-ui, sans-serif)',
            fontSize: '0.92rem',
            fontWeight: 400,
            color: 'rgba(236,229,212,0.8)',
            maxWidth: '46ch',
            lineHeight: 1.55,
            margin: '4px 0 0',
          }}
        >
          Ich bin Vierzehn, noch im Aufbau durch Basel. Zurzeit kann ich lesen und berichten,
          zum Beispiel den Stand des Tages. Sprechen und Handeln kommen bald.
        </p>

        {error && (
          <p style={{ fontFamily: 'var(--w14-font-mono, monospace)', fontSize: '0.72rem', color: WAX }}>
            Kein Mikrofonzugriff. Bitte in den Systemeinstellungen erlauben.
          </p>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button
            type="button"
            onClick={toggleMic}
            style={{
              fontFamily: 'var(--w14-font-body, system-ui, sans-serif)',
              fontSize: '0.9rem',
              fontWeight: 600,
              letterSpacing: '0.03em',
              color: INK,
              background: BRASS,
              border: `1px solid ${BRASS}`,
              borderRadius: 'var(--w14-radius-button, 8px)',
              padding: '11px 26px',
              cursor: 'pointer',
              boxShadow: '0 0 20px rgba(230,194,115,0.3)',
            }}
          >
            {isActive ? 'Zuhören beenden' : 'Sprich mit mir'}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontFamily: 'var(--w14-font-body, system-ui, sans-serif)',
              fontSize: '0.9rem',
              fontWeight: 500,
              color: 'rgba(230,194,115,0.85)',
              background: 'transparent',
              border: '1px solid rgba(230,194,115,0.4)',
              borderRadius: 'var(--w14-radius-button, 8px)',
              padding: '11px 22px',
              cursor: 'pointer',
            }}
          >
            Schließen
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
