/**
 * JarvisOverlay — „Vierzehn", the dramatic voice-assistant surface.
 *
 * The visual is the ready-made `react-ai-voice-visualizer` (MIT, Canvas). The
 * owner can switch between three dramatic modes, each with its OWN colour:
 *   • Reaktor  — arc-reactor rings (VoiceRing) around a neural brain
 *                (VoiceNeural), electric cyan.
 *   • Partikel — a reactive particle field (VoiceParticles), patina green.
 *   • Gewebe   — a 3D reactive mesh (AudioReactiveMesh), royal violet.
 * The hero fills the screen: it is sized to the whole centre band, live.
 *
 * Every mode reacts to the live Realtime session (`useRealtimeSession`) — the
 * analyser follows whoever is talking (the mic while listening, the model while
 * speaking). The session AUTO-CONNECTS the moment the overlay opens and Vierzehn
 * greets first, in German, by voice. Closing the overlay disconnects.
 *
 * A denied/absent microphone shows an honest typed failure (title + detail) and,
 * when the OS can grant it, a „Systemeinstellungen öffnen" button that opens the
 * microphone privacy pane via the native `open_microphone_settings` command.
 *
 * DESIGN NOTE — deliberate opt-out: this surface is intentionally an always-dark
 * „command center" and does NOT follow the app's light/dark tokens. Focus trap,
 * restore, scroll-lock and aria still mirror the house `ModalShell`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AudioReactiveMesh,
  VoiceNeural,
  VoiceParticles,
  VoiceRing,
  Waveform,
  useAudioAnalyser,
  type VoiceState,
} from 'react-ai-voice-visualizer';
import { invoke } from '@tauri-apps/api/core';

import { useAudioDevices } from './useAudioDevices.js';
import { type JarvisState, useRealtimeSession } from './useRealtimeSession.js';

// The command-center ground — a deep, cool near-black (no warm cast).
const INK = '#05070b';

/** A dramatic visual mode, each with its own signature colour. */
interface JarvisMode {
  id: 'neural' | 'particles' | 'mesh';
  label: string;
  primary: string;
  secondary: string;
}

const MODES = [
  { id: 'neural', label: 'Reaktor', primary: '#31d6f5', secondary: '#8fecff' },
  { id: 'particles', label: 'Partikel', primary: '#4fe0a0', secondary: '#b8f6d6' },
  { id: 'mesh', label: 'Gewebe', primary: '#b98cff', secondary: '#dcc6ff' },
] as const satisfies readonly JarvisMode[];

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

function brace(pos: 'tl' | 'tr' | 'bl' | 'br', color: string): React.CSSProperties {
  const s: React.CSSProperties = {
    position: 'absolute',
    width: 34,
    height: 34,
    borderColor: color,
    borderStyle: 'solid',
    borderWidth: 0,
    opacity: 0.5,
    transition: 'border-color 400ms ease',
  };
  if (pos === 'tl') return { ...s, top: 18, left: 18, borderTopWidth: 2, borderLeftWidth: 2 };
  if (pos === 'tr') return { ...s, top: 18, right: 18, borderTopWidth: 2, borderRightWidth: 2 };
  if (pos === 'bl') return { ...s, bottom: 18, left: 18, borderBottomWidth: 2, borderLeftWidth: 2 };
  return { ...s, bottom: 18, right: 18, borderBottomWidth: 2, borderRightWidth: 2 };
}

export function JarvisOverlay({ onClose }: { onClose: () => void }): JSX.Element {
  const { selectedMicId } = useAudioDevices();
  const { state, failure, micStream, modelStream, connect, disconnect } =
    useRealtimeSession(selectedMicId);

  // Analyse whoever is talking so the visual reacts to the real conversation:
  // the model while it speaks, the mic otherwise.
  const activeStream = state === 'speaking' ? modelStream : micStream;
  const { frequencyData, timeDomainData, volume } = useAudioAnalyser(activeStream, ANALYSER_OPTS);

  const connected = state !== 'idle' && state !== 'error';
  const orbState = ORB_STATE[state];

  // The owner picks the dramatic face; each has its own colour.
  const [modeId, setModeId] = useState<JarvisMode['id']>('neural');
  const mode = MODES.find((m) => m.id === modeId) ?? MODES[0];
  const { primary, secondary } = mode;

  const panelRef = useRef<HTMLDivElement>(null);
  const primaryBtnRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // The hero fills the whole centre band, measured live so the orb is as large
  // as the window allows and adapts on resize.
  const heroBandRef = useRef<HTMLDivElement>(null);
  const [heroSize, setHeroSize] = useState<number>(360);
  useEffect(() => {
    const el = heroBandRef.current;
    if (!el) return;
    const measure = (): void => {
      const s = Math.floor(Math.min(el.clientWidth, el.clientHeight) * 0.98);
      // Fill the band (huge on a normal window); shrink with it on a short one so
      // the orb never overflows into the title/controls. The scroll frame handles
      // whatever still cannot fit.
      setHeroSize(Math.max(160, s));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleClose = useCallback(() => {
    disconnect();
    onClose();
  }, [disconnect, onClose]);

  const openMicSettings = useCallback((): void => {
    // Native command opens the OS microphone privacy pane. In the dev browser
    // (no Tauri) invoke throws — swallow, the button is only meaningful in-app.
    void invoke('open_microphone_settings').catch(() => {
      /* not running inside Tauri — ignore */
    });
  }, []);

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
    // Auto-connect flips state to 'connecting' almost immediately, which DISABLES
    // the primary button; focusing that button here would let the disable blur it
    // to <body> and break the trap. Focus the dialog container instead — it is
    // never disabled, keeps focus inside the modal, and the Tab handler already
    // moves a container-focused start onto the first control.
    panelRef.current?.focus();
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
        color: secondary,
        // The ambient glow takes the active mode's colour, so switching modes
        // re-tints the whole command center — over a cool near-black base.
        background: `radial-gradient(130% 100% at 50% 34%, ${primary}22, ${INK} 68%), ${INK}`,
        transition: 'background 500ms ease',
        backdropFilter: 'blur(6px)',
        outline: 'none',
        overflow: 'hidden',
        animation: 'w14JarvisIn 420ms cubic-bezier(0.2,0.8,0.2,1) both',
      }}
    >
      <style>{`
        @keyframes w14JarvisIn { from { opacity: 0; transform: scale(1.03); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { [data-w14-jarvis] { animation: none !important; } }
        [data-w14-jarvis] button:focus-visible { outline: 2px solid ${primary}; outline-offset: 2px; }
      `}</style>

      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.02) 2px, rgba(255,255,255,0.02) 3px)',
        }}
      />
      <div aria-hidden style={brace('tl', primary)} />
      <div aria-hidden style={brace('tr', primary)} />
      <div aria-hidden style={brace('bl', primary)} />
      <div aria-hidden style={brace('br', primary)} />

      {/* Scroll frame — the decorative corners + glow above stay fixed; the three
          bands live here and scroll ONLY when a short window can't fit them, so the
          controls (and the mic-recovery button) are never clipped off-screen. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
      {/* Top band — status chips + the name. */}
      <div style={{ flex: '0 0 auto', paddingTop: 22, textAlign: 'center', zIndex: 1 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '8px 22px',
            padding: '0 20px',
            fontFamily: 'var(--w14-font-mono, ui-monospace, monospace)',
            fontSize: '0.66rem',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: `${secondary}b0`,
          }}
        >
          <span aria-hidden>System · Warehouse 14</span>
          <span aria-hidden>Modus · Nur-Lesen</span>
          <span aria-live="polite">Status · {STATUS_LABEL[state]}</span>
        </div>
        <div
          style={{
            marginTop: 14,
            fontFamily: 'var(--w14-font-display, Georgia, serif)',
            fontSize: 'clamp(2rem, 5vw, 3rem)',
            fontWeight: 600,
            letterSpacing: '0.04em',
            color: secondary,
            textShadow: `0 0 26px ${primary}66`,
          }}
        >
          Vierzehn
        </div>
      </div>

      {/* Hero band — the huge, screen-filling visual. Sized to this band, live. */}
      <div
        ref={heroBandRef}
        aria-hidden
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          position: 'relative',
          display: 'grid',
          placeItems: 'center',
          zIndex: 0,
        }}
      >
        {mode.id === 'neural' && (
          <div style={{ position: 'relative', width: heroSize, height: heroSize }}>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <VoiceRing
                audioData={frequencyData}
                volume={volume}
                state={orbState}
                size={heroSize}
                primaryColor={primary}
                secondaryColor={secondary}
                rotationSpeed={1.2}
              />
            </div>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <VoiceNeural
                volume={volume}
                state={orbState}
                size={Math.round(heroSize * 0.74)}
                primaryColor={primary}
                secondaryColor={secondary}
                nodeCount={52}
              />
            </div>
          </div>
        )}

        {mode.id === 'particles' && (
          <VoiceParticles
            audioData={frequencyData}
            volume={volume}
            state={orbState}
            size={heroSize}
            primaryColor={primary}
            secondaryColor={secondary}
            particleCount={160}
          />
        )}

        {mode.id === 'mesh' && (
          <AudioReactiveMesh
            audioData={frequencyData}
            volume={volume}
            width={heroSize}
            height={heroSize}
            color={primary}
          />
        )}
      </div>

      {/* Bottom band — waveform, persona line, failure, controls. */}
      <div
        style={{
          flex: '0 0 auto',
          display: 'grid',
          justifyItems: 'center',
          gap: 14,
          padding: '10px 24px 30px',
          textAlign: 'center',
          zIndex: 1,
        }}
      >
        <div aria-hidden style={{ width: 'min(460px, 82vw)', height: 38 }}>
          <Waveform timeDomainData={timeDomainData} height={38} color={secondary} animated />
        </div>

        <p
          style={{
            fontFamily: 'var(--w14-font-body, system-ui, sans-serif)',
            fontSize: '0.92rem',
            fontWeight: 400,
            color: 'rgba(236,241,247,0.82)',
            maxWidth: '46ch',
            lineHeight: 1.55,
            margin: 0,
          }}
        >
          Ich bin Vierzehn, Ihr Sprachassistent. Sprechen Sie einfach, ich höre zu. Zurzeit lese und
          berichte ich, zum Beispiel den Stand des Tages.
        </p>

        {failure && (
          <div
            role="alert"
            style={{
              display: 'grid',
              justifyItems: 'center',
              gap: 8,
              maxWidth: '48ch',
              padding: '12px 16px',
              borderRadius: 12,
              border: '1px solid rgba(238,116,97,0.5)',
              background: 'rgba(238,116,97,0.10)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--w14-font-body, system-ui, sans-serif)',
                fontWeight: 600,
                fontSize: '0.95rem',
                color: '#f4a493',
              }}
            >
              {failure.title}
            </span>
            <span
              style={{
                fontFamily: 'var(--w14-font-body, system-ui, sans-serif)',
                fontSize: '0.85rem',
                color: 'rgba(236,241,247,0.8)',
                lineHeight: 1.5,
              }}
            >
              {failure.detail}
            </span>
            {failure.canOpenSettings && (
              <button
                type="button"
                onClick={openMicSettings}
                style={{
                  marginTop: 2,
                  minHeight: 44,
                  padding: '9px 18px',
                  fontFamily: 'var(--w14-font-body, system-ui, sans-serif)',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  color: '#f4a493',
                  background: 'transparent',
                  border: '1px solid rgba(238,116,97,0.6)',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                Systemeinstellungen öffnen
              </button>
            )}
          </div>
        )}

        {/* Mode switcher — pick the dramatic face; each carries its own colour. */}
        <div
          role="group"
          aria-label="Darstellung"
          style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}
        >
          {MODES.map((m) => {
            const active = m.id === modeId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setModeId(m.id)}
                aria-pressed={active}
                style={{
                  minHeight: 40,
                  padding: '8px 16px',
                  fontFamily: 'var(--w14-font-body, system-ui, sans-serif)',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  color: active ? INK : `${m.secondary}cc`,
                  background: active ? m.primary : 'transparent',
                  border: `1px solid ${active ? m.primary : 'rgba(255,255,255,0.22)'}`,
                  borderRadius: 999,
                  cursor: 'pointer',
                  transition: 'color 200ms ease, background 200ms ease, border-color 200ms ease',
                  ...(active ? { boxShadow: `0 0 18px ${m.primary}66` } : {}),
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Actions. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 2 }}>
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
              background: primary,
              border: `1px solid ${primary}`,
              borderRadius: 'var(--w14-radius-button, 8px)',
              padding: '11px 26px',
              cursor: state === 'connecting' ? 'default' : 'pointer',
              opacity: state === 'connecting' ? 0.7 : 1,
              boxShadow: `0 0 20px ${primary}55`,
            }}
          >
            {state === 'connecting'
              ? 'Verbinde…'
              : state === 'error'
                ? 'Erneut versuchen'
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
              color: `${secondary}d0`,
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.28)',
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
