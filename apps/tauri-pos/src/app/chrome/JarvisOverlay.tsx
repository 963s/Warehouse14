/**
 * JarvisOverlay — „Vierzehn", the dramatic voice-assistant surface.
 *
 * The support button opens this full-screen command center. The orb + waveform
 * come from the MIT `react-ai-voice-visualizer` (Canvas), re-themed to the
 * Warehouse 14 brass identity. It is driven by the real Realtime session
 * (`useRealtimeSession`): the orb analyses the microphone while listening and
 * the model's audio while speaking, so it reacts to the actual conversation.
 * Audio devices are auto-discovered in the background (`useAudioDevices`).
 *
 * The session connects on the owner's tap („Sprich mit mir"), never on its own,
 * so cost stays low and the mic is only live when asked. The persona (security
 * spine: read-only, refuses code, offers a dev ticket) lives server-side and
 * rides in the ephemeral session.
 *
 * Live-verify with OPENAI_API_KEY set + the api deployed. Mounted only while open.
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { VoiceOrb, Waveform, useAudioAnalyser, type VoiceState } from 'react-ai-voice-visualizer';

import { useAudioDevices } from './useAudioDevices.js';
import { type JarvisState, useRealtimeSession } from './useRealtimeSession.js';

const BRASS = '#e6c273';
const WAX = '#df7259';
const INK = '#0d0b07';

const STATUS_LABEL: Record<JarvisState, string> = {
  idle: 'Bereit',
  connecting: 'Verbinde',
  listening: 'Hört zu',
  thinking: 'Denkt nach',
  speaking: 'Spricht',
  error: 'Fehler',
};

const ORB_STATE: Record<JarvisState, VoiceState> = {
  idle: 'idle',
  connecting: 'thinking',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  error: 'idle',
};

function brace(pos: 'tl' | 'tr' | 'bl' | 'br'): React.CSSProperties {
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
}

export function JarvisOverlay({ onClose }: { onClose: () => void }): JSX.Element {
  const { selectedMicId } = useAudioDevices();
  const { state, error, micStream, modelStream, connect, disconnect } = useRealtimeSession(selectedMicId);

  // Analyse whichever side is talking: the model while it speaks, else the mic.
  const activeStream = state === 'speaking' ? modelStream : micStream;
  const { frequencyData, timeDomainData, volume } = useAudioAnalyser(activeStream, { fftSize: 256 });

  const connected = state !== 'idle' && state !== 'error';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
        animation: 'w14JarvisIn 420ms cubic-bezier(0.2,0.8,0.2,1) both',
      }}
    >
      <style>{`
        @keyframes w14JarvisIn { from { opacity: 0; transform: scale(1.03); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { [data-w14-jarvis] { animation: none !important; } }
      `}</style>

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
      <div aria-hidden style={brace('tl')} />
      <div aria-hidden style={brace('tr')} />
      <div aria-hidden style={brace('bl')} />
      <div aria-hidden style={brace('br')} />

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
          state={ORB_STATE[state]}
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
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => (connected ? disconnect() : void connect())}
            disabled={state === 'connecting'}
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
              cursor: state === 'connecting' ? 'default' : 'pointer',
              opacity: state === 'connecting' ? 0.7 : 1,
              boxShadow: '0 0 20px rgba(230,194,115,0.3)',
            }}
          >
            {state === 'connecting' ? 'Verbinde…' : connected ? 'Beenden' : 'Sprich mit mir'}
          </button>
          <button
            type="button"
            onClick={() => {
              disconnect();
              onClose();
            }}
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
