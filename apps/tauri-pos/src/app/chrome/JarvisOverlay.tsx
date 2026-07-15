/**
 * JarvisOverlay — „Vierzehn", the dramatic voice-assistant surface.
 *
 * The visual is the ready-made `react-ai-voice-visualizer` (MIT, Canvas): the
 * arc-reactor rings of `VoiceRing` wrapped around the pulsing „brain" of
 * `VoiceNeural`, re-themed to the Warehouse 14 brass identity. Both react to the
 * live Realtime session (`useRealtimeSession`) — the analyser follows whoever is
 * talking (the mic while listening, the model while speaking).
 *
 * The session AUTO-CONNECTS the moment the overlay opens (the owner already
 * summoned it), and Vierzehn greets first, in German, by voice. Closing the
 * overlay disconnects. The persona (security spine: read-only, refuses code,
 * offers a dev ticket) lives server-side and rides in the ephemeral session.
 *
 * To swap the centre visual, change HERO/RING below to any of the library's
 * ready-made components: VoiceNeural, VoiceRing, VoiceParticles, VoiceOrb,
 * AudioReactiveMesh — they share the same (volume, state, size, colors) props.
 *
 * DESIGN NOTE — deliberate opt-out: this surface is intentionally an always-dark
 * brass „command center" and does NOT follow the app's light/dark tokens. Focus
 * trap, restore, scroll-lock and aria still mirror the house `ModalShell`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  VoiceNeural,
  VoiceRing,
  Waveform,
  useAudioAnalyser,
  type VoiceState,
} from 'react-ai-voice-visualizer';

import { useAudioDevices } from './useAudioDevices.js';
import { type JarvisState, useRealtimeSession } from './useRealtimeSession.js';

const BRASS = '#e6c273';
const WAX = '#df7259';
const INK = '#0d0b07';

// Hoisted so a fresh literal each render does not re-init the analyser.
const ANALYSER_OPTS = { fftSize: 256 } as const;

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

/** Hero diameter that always leaves room for the surrounding stack on short windows. */
function pickHeroSize(): number {
  if (typeof window === 'undefined') return 240;
  return Math.max(180, Math.min(280, Math.round(window.innerHeight * 0.32)));
}

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
  const { state, error, micStream, modelStream, connect, disconnect } =
    useRealtimeSession(selectedMicId);

  // Analyse whoever is talking so the visual reacts to the real conversation:
  // the model while it speaks, the mic otherwise.
  const activeStream = state === 'speaking' ? modelStream : micStream;
  const { frequencyData, timeDomainData, volume } = useAudioAnalyser(activeStream, ANALYSER_OPTS);

  const connected = state !== 'idle' && state !== 'error';
  const orbState = ORB_STATE[state];

  const panelRef = useRef<HTMLDivElement>(null);
  const primaryBtnRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const [heroSize, setHeroSize] = useState<number>(() => pickHeroSize());
  useEffect(() => {
    const onResize = (): void => setHeroSize(pickHeroSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleClose = useCallback(() => {
    disconnect();
    onClose();
  }, [disconnect, onClose]);

  // Auto-connect the moment the overlay opens — the owner already summoned it,
  // so Vierzehn wakes and greets immediately (no „press and talk" step).
  useEffect(() => {
    void connect();
    // connect() guards against a double start; run once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Capture the trigger, lock body scroll, move focus in — restore + unlock on close.
  useEffect(() => {
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    primaryBtnRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      const el = restoreRef.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
    };
  }, []);

  // Escape closes; Tab is trapped within the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled])'));
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      const inside = panel.contains(active);
      if (e.shiftKey) {
        if (active === first || !inside) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !inside) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);

  const neuralSize = Math.round(heroSize * 0.78);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Vierzehn, Sprachassistent"
      tabIndex={-1}
      data-w14-jarvis
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        color: BRASS,
        background: `radial-gradient(120% 90% at 50% 30%, rgba(35,26,12,0.72), rgba(8,7,4,0.92) 70%), ${INK}`,
        backdropFilter: 'blur(6px)',
        outline: 'none',
        overflow: 'hidden',
        animation: 'w14JarvisIn 420ms cubic-bezier(0.2,0.8,0.2,1) both',
      }}
    >
      <style>{`
        @keyframes w14JarvisIn { from { opacity: 0; transform: scale(1.03); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { [data-w14-jarvis] { animation: none !important; } }
        [data-w14-jarvis] button:focus-visible { outline: 2px solid ${BRASS}; outline-offset: 2px; }
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
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '8px 22px',
          padding: '0 20px',
          fontFamily: 'var(--w14-font-mono, ui-monospace, monospace)',
          fontSize: '0.66rem',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'rgba(230,194,115,0.7)',
        }}
      >
        <span aria-hidden>System · Warehouse 14</span>
        <span aria-hidden>Modus · Nur-Lesen</span>
        <span aria-live="polite">Status · {STATUS_LABEL[state]}</span>
      </div>

      {/* Scroll region: centres the stack when it fits, scrolls when the window
          is short so the actions are never clipped off-screen. */}
      <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: 'flex' }}>
        <div style={{ margin: 'auto', display: 'grid', placeItems: 'center', gap: 20, textAlign: 'center', padding: '76px 24px' }}>
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

          {/* The hero: arc-reactor rings (VoiceRing) around the neural brain
              (VoiceNeural), both from the library, layered + brass-themed. */}
          <div aria-hidden style={{ position: 'relative', width: heroSize, height: heroSize }}>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <VoiceRing
                audioData={frequencyData}
                volume={volume}
                state={orbState}
                size={heroSize}
                primaryColor={BRASS}
                secondaryColor={WAX}
                rotationSpeed={1.2}
              />
            </div>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <VoiceNeural
                volume={volume}
                state={orbState}
                size={neuralSize}
                primaryColor={BRASS}
                secondaryColor={WAX}
                nodeCount={44}
              />
            </div>
          </div>

          <div aria-hidden style={{ width: 'min(420px, 78vw)', height: 40 }}>
            <Waveform timeDomainData={timeDomainData} height={40} color={BRASS} animated />
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
            Ich bin Vierzehn, Ihr Sprachassistent. Sprechen Sie einfach, ich höre zu. Zurzeit lese
            und berichte ich, zum Beispiel den Stand des Tages.
          </p>

          {error && (
            <p role="alert" style={{ fontFamily: 'var(--w14-font-mono, monospace)', fontSize: '0.72rem', color: WAX }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 8 }}>
            <button
              ref={primaryBtnRef}
              type="button"
              onClick={() => (connected ? disconnect() : void connect())}
              disabled={state === 'connecting'}
              style={{
                fontFamily: 'var(--w14-font-body, system-ui, sans-serif)',
                fontSize: '0.9rem',
                fontWeight: 600,
                letterSpacing: '0.03em',
                minHeight: 48,
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
              {state === 'connecting'
                ? 'Verbinde…'
                : state === 'error'
                  ? 'Erneut verbinden'
                  : connected
                    ? 'Beenden'
                    : 'Sprechen'}
            </button>
            <button
              type="button"
              onClick={handleClose}
              style={{
                fontFamily: 'var(--w14-font-body, system-ui, sans-serif)',
                fontSize: '0.9rem',
                fontWeight: 500,
                minHeight: 48,
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
      </div>
    </div>,
    document.body,
  );
}
