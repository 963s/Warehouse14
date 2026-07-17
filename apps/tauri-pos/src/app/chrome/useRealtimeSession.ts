/**
 * useRealtimeSession — the voice brain behind Vierzehn (Jarvis).
 *
 * Flow (all secrets stay server-side):
 *   1. POST /api/realtime/session  → ephemeral token + persona + read-only tools.
 *   2. WebRTC peer connection to OpenAI Realtime, mic in, model audio out.
 *   3. data channel "oai-events": push the tools + turn detection; on a
 *      function call, RELAY it to POST /api/mcp/assistant (the app's own
 *      authenticated session + mTLS reach it). That route enforces the
 *      assistant tool allowlist server-side, so even a hallucinating model
 *      cannot reach a withheld mutation tool. OpenAI never touches our server.
 *
 * Exposes a small state machine + the mic/model streams so JarvisOverlay can
 * drive the orb. The WebRTC handshake targets the GA `…/v1/realtime/calls`
 * endpoint; model audio plays through a real (hidden, DOM-attached) element so
 * it is audible on the WebKit WebViews the desktop app ships.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError } from '@warehouse14/i18n-de';
import { useApiClient } from '../../lib/api-context.js';
import { dismissWidget, presentWidget, widgetForTool } from './jarvis-widget-store.js';

export type JarvisState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

interface SessionResponse {
  clientSecret: string;
  model: string;
  voice: string;
  instructions: string;
  tools: Array<{ name: string; description: string; parameters: unknown }>;
}

interface McpEnvelope {
  result?: { data?: unknown };
  error?: { message?: string };
}

/**
 * A user-facing failure: an already-safe German title + detail, plus whether a
 * „Systemeinstellungen öffnen" affordance makes sense (only for permission
 * denials, where the owner can actually grant access). Never carries a raw wire
 * message — every path builds this from safe copy or `describeError`.
 */
export interface VierzehnFailure {
  title: string;
  detail: string;
  canOpenSettings: boolean;
}

export interface UseRealtimeSession {
  state: JarvisState;
  failure: VierzehnFailure | null;
  micStream: MediaStream | null;
  modelStream: MediaStream | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

// GA WebRTC endpoint. The SDP offer is POSTed here with the ephemeral token;
// the older `/v1/realtime` path is the deprecated beta and rejects GA keys.
const OPENAI_REALTIME_SDP_URL = 'https://api.openai.com/v1/realtime/calls';

// Output loudness. A plain <audio>.volume is clamped to 1.0, so Vierzehn was too
// quiet. We route the model stream through a Web Audio GainNode (no upper clamp)
// to AMPLIFY, followed by a brick-wall limiter so the boost never hard-clips.
// Tunable up toward ~4.0 if still quiet on the shipped WebView; never above ~4.
const OUTPUT_GAIN = 2.4;

// Auto-reconnect (C3). The OpenAI Realtime session has a maximum lifetime
// (~30–60 min); when it ends, or a transient network blip drops the peer, the
// owner should not have to notice and re-open Vierzehn mid-conversation. We
// silently re-mint a fresh session (which re-applies every cost guard) instead
// of surfacing an error — but ONLY when a session had actually been established,
// and with a hard cap + backoff so a genuinely broken link fails honestly rather
// than looping token mints. A session that stayed up past STABLE_MS is treated as
// healthy, so its next drop starts the budget over (the 60-min auto-cycle); a
// link that keeps flapping within STABLE_MS burns the budget and then gives up.
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_MS = 900;
const STABLE_SESSION_MS = 30_000;

/**
 * A local failure whose `reason` is ALREADY a safe German sentence, so the
 * overlay can show it verbatim. Every other error in the catch is routed
 * through `describeError` — a raw wire message never reaches the owner.
 */
class VierzehnError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'VierzehnError';
  }
}

/** A capture failure carrying an already-classified, safe German VierzehnFailure. */
class MicError extends Error {
  constructor(readonly failure: VierzehnFailure) {
    super(failure.title);
    this.name = 'MicError';
  }
}

/**
 * getUserMedia rejections are NOT reliably `instanceof DOMException` on WebKit
 * (the desktop WebView): OverconstrainedError is its own interface there, so an
 * instanceof gate silently drops it. Read the name + constraint by duck-typing.
 */
function errName(err: unknown): string {
  return err != null && typeof err === 'object' && 'name' in err
    ? String((err as { name?: unknown }).name ?? '')
    : '';
}
function isOverconstrained(err: unknown): boolean {
  // The OverconstrainedError-specific `constraint` property is the reliable signal
  // for a gone/incompatible saved device, name or no name.
  return err != null && typeof err === 'object' && 'constraint' in err;
}

/** Translate a getUserMedia rejection into a typed, honest German failure. */
function classifyMic(err: unknown): VierzehnFailure {
  const name = errName(err);
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return {
      title: 'Mikrofon ist gesperrt',
      detail:
        'Warehouse14 hat keinen Zugriff auf das Mikrofon. Bitte die Freigabe erlauben, dann erneut versuchen.',
      canOpenSettings: true,
    };
  }
  if (
    isOverconstrained(err) ||
    name === 'NotFoundError' ||
    name === 'OverconstrainedError' ||
    name === 'ConstraintNotSatisfiedError'
  ) {
    return {
      title: 'Kein Mikrofon gefunden',
      detail:
        'Es ist kein Mikrofon angeschlossen. Bitte ein Mikrofon anschließen und erneut versuchen.',
      canOpenSettings: false,
    };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      title: 'Mikrofon ist belegt',
      detail:
        'Das Mikrofon wird gerade von einem anderen Programm verwendet. Bitte das Programm schließen und erneut versuchen.',
      canOpenSettings: false,
    };
  }
  return {
    title: 'Mikrofon nicht verfügbar',
    detail: 'Der Zugriff auf das Mikrofon ist fehlgeschlagen. Bitte erneut versuchen.',
    canOpenSettings: true,
  };
}

/**
 * Acquire the mic. If a SAVED device id (passed as `{ deviceId: { exact } }`)
 * is gone — an unplugged headset — that throws OverconstrainedError/NotFound;
 * retry once with the system default rather than fail. Any capture failure is
 * rethrown as a typed MicError so the overlay shows honest German + the right
 * recovery affordance.
 */
async function acquireMic(micDeviceId?: string): Promise<MediaStream> {
  const preferred: MediaStreamConstraints = {
    audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
  };
  try {
    return await navigator.mediaDevices.getUserMedia(preferred);
  } catch (err) {
    const name = errName(err);
    const staleDevice =
      isOverconstrained(err) ||
      name === 'OverconstrainedError' ||
      name === 'ConstraintNotSatisfiedError' ||
      name === 'NotFoundError';
    if (staleDevice && micDeviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (retryErr) {
        throw new MicError(classifyMic(retryErr));
      }
    }
    throw new MicError(classifyMic(err));
  }
}

export function useRealtimeSession(micDeviceId?: string): UseRealtimeSession {
  const api = useApiClient();
  const [state, setState] = useState<JarvisState>('idle');
  const [failure, setFailure] = useState<VierzehnFailure | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [modelStream, setModelStream] = useState<MediaStream | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Set synchronously at the top of connect() so a rapid second tap (or a
  // close mid-connect) cannot start a second peer connection or leave a mic on.
  const connectingRef = useRef(false);

  // Auto-reconnect bookkeeping (C3). `everConnected` gates reconnect to sessions
  // that actually came up; `sessionUpSince` measures health; `reconnectAttempts`
  // is the backoff budget; `userClosed` makes a deliberate close win any race
  // with an in-flight drop; `reconnectTimer` holds the pending silent retry so a
  // close/unmount can cancel it. `connectInternalRef` breaks the callback cycle
  // (a drop handler needs to call the connector, which is defined after it).
  const everConnectedRef = useRef(false);
  const sessionUpSinceRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const userClosedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectInternalRef = useRef<((opts: { silent: boolean }) => Promise<void>) | null>(null);

  // Release EVERY live resource. Idempotent, and never leaves the mic hot:
  // the mic is stopped from its own ref, so a stream acquired but not yet added
  // to the peer connection is still stopped.
  const teardown = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    sessionUpSinceRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    dcRef.current?.close();
    dcRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    pcRef.current?.getSenders().forEach((s) => s.track?.stop());
    pcRef.current?.close();
    pcRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.srcObject = null;
      audioElRef.current.remove();
      audioElRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    dismissWidget();
    setMicStream(null);
    setModelStream(null);
  }, []);

  // Boost the model audio through Web Audio. The hidden <audio> element stays the
  // reliable WebKit sink, but is MUTED once the boosted graph is actually running
  // so only the amplified path is heard — and left UNMUTED whenever the graph
  // cannot start (autoplay-suspended context), so audio is never lost to silence.
  const attachOutputBoost = useCallback((remote: MediaStream): void => {
    const el = audioElRef.current;
    try {
      const Ctx: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return; // no Web Audio → the element plays at its native 1.0
      const ctx = audioCtxRef.current ?? new Ctx();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(remote);
      const gain = ctx.createGain();
      gain.gain.value = OUTPUT_GAIN;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      source.connect(gain);
      gain.connect(limiter);
      limiter.connect(ctx.destination);

      // Mute the element ONLY while the boosted graph is truly running (avoids
      // both double audio and silence-behind-a-suspended-context).
      const syncMute = (): void => {
        if (audioElRef.current) audioElRef.current.muted = ctx.state === 'running';
      };
      void ctx.resume().then(syncMute, syncMute);
      if (ctx.state !== 'running') {
        // Unlock on the next interaction if WebKit suspended the context.
        const unlock = (): void => void ctx.resume().then(syncMute, syncMute);
        window.addEventListener('pointerdown', unlock, { once: true });
      }
    } catch (err) {
      if (typeof console !== 'undefined')
        console.error('[Vierzehn] Audio-Verstärkung nicht möglich', err);
      if (el) el.muted = false; // fall back to the element at native volume
    }
  }, []);

  const disconnect = useCallback(() => {
    // A deliberate close wins any race with an in-flight drop: no silent
    // reconnect may fire after this, and the budget resets for next time.
    userClosedRef.current = true;
    everConnectedRef.current = false;
    reconnectAttemptsRef.current = 0;
    teardown();
    setState('idle');
  }, [teardown]);

  // A drop AFTER a live session came up: silently re-mint a fresh session (which
  // re-applies every cost guard) up to the backoff budget, instead of stranding
  // the owner mid-conversation. A deliberate close, an initial-connect failure,
  // or an exhausted budget falls through to the honest "unterbrochen" error.
  const handleDrop = useCallback((): void => {
    if (userClosedRef.current || abortRef.current?.signal.aborted) return;
    if (!everConnectedRef.current) return; // the initial connect owns its own errors

    // Detach our own handlers first so the teardown below (which closes the data
    // channel) cannot re-enter this function and double-count a single drop.
    if (dcRef.current) {
      dcRef.current.onclose = null;
      dcRef.current.onerror = null;
    }
    if (pcRef.current) pcRef.current.onconnectionstatechange = null;

    const upSince = sessionUpSinceRef.current;
    const wasStable = upSince != null && Date.now() - upSince > STABLE_SESSION_MS;
    if (wasStable) reconnectAttemptsRef.current = 0;

    if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttemptsRef.current += 1;
      const delay = RECONNECT_BASE_MS * reconnectAttemptsRef.current;
      teardown(); // frees mic/pc/dc; we re-acquire on the silent reconnect
      setFailure(null);
      setState('connecting');
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        void connectInternalRef.current?.({ silent: true });
      }, delay);
      return;
    }

    if (typeof console !== 'undefined') console.error('[Vierzehn] Verbindung verloren');
    teardown();
    setFailure({
      title: 'Verbindung unterbrochen',
      detail: 'Die Verbindung zur Sprachsitzung wurde unterbrochen. Bitte erneut versuchen.',
      canOpenSettings: false,
    });
    setState('error');
  }, [teardown]);

  // Relay a model tool call to the assistant-scoped MCP endpoint. That route
  // refuses any tool not flagged assistantExposed, regardless of role.
  const relayToolCall = useCallback(
    async (callId: string, name: string, argsJson: string): Promise<void> => {
      const dc = dcRef.current;
      if (!dc || dc.readyState !== 'open') return;
      let args: unknown = {};
      try {
        args = argsJson ? JSON.parse(argsJson) : {};
      } catch {
        args = {};
      }
      let output: unknown;
      try {
        const env = await api.request<McpEnvelope>(
          'POST',
          '/api/mcp/assistant',
          {
            jsonrpc: '2.0',
            id: callId,
            method: 'tools/call',
            params: { name, arguments: args },
          },
          { custom: { skipOfflineQueue: true } },
        );
        // The model reads this JSON back and speaks it, so the failure branch
        // must be a stable German line, never the raw envelope/transport text.
        output = env.error ? { error: 'Das Werkzeug konnte nicht ausgeführt werden.' } : (env.result?.data ?? {});
        // Tee the read into the on-screen "dramatic display" layer — a pure side
        // effect of the read the model already made. A non-presentable tool
        // (ticket, appraise, empty search) leaves any current widget in place.
        if (!env.error) {
          const w = widgetForTool(name, env.result?.data ?? null);
          if (w) presentWidget(w);
        }
      } catch (err) {
        output = { error: describeError(err) };
      }
      dc.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) },
        }),
      );
      dc.send(JSON.stringify({ type: 'response.create' }));
    },
    [api],
  );

  const handleEvent = useCallback(
    (evt: Record<string, unknown>): void => {
      const type = typeof evt.type === 'string' ? evt.type : '';
      if (type === 'input_audio_buffer.speech_started') {
        setState('listening');
      } else if (type === 'response.created') {
        setState('thinking');
      } else if (type === 'output_audio_buffer.started') {
        setState('speaking');
      } else if (type === 'response.done' || type === 'output_audio_buffer.stopped') {
        setState('listening');
      } else if (type === 'response.function_call_arguments.done') {
        setState('thinking');
        void relayToolCall(
          String(evt.call_id ?? ''),
          String(evt.name ?? ''),
          String(evt.arguments ?? ''),
        );
      } else if (type === 'error') {
        if (typeof console !== 'undefined') console.error('[Vierzehn] Realtime-Fehler', evt.error);
        setFailure({
          title: 'Sprachsitzung gestört',
          detail: 'Es gab ein Problem in der Sprachsitzung. Bitte erneut versuchen.',
          canOpenSettings: false,
        });
      }
    },
    [relayToolCall],
  );

  const connectInternal = useCallback(async ({ silent }: { silent: boolean }): Promise<void> => {
    if (pcRef.current || connectingRef.current) return;
    connectingRef.current = true;
    setFailure(null);
    setState('connecting');
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // A voice session has no durable intent — it must NEVER be enqueued into
      // the offline/fiscal outbox (that queue is for sales, Ankäufe, Stornos).
      const session = await api.request<SessionResponse>('POST', '/api/realtime/session', undefined, {
        custom: { skipOfflineQueue: true },
      });
      if (ac.signal.aborted) {
        teardown();
        return;
      }

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // `failed` is terminal (a brief `disconnected` blip can still recover on
      // its own); `closed` is our own teardown, ignored via the abort guard.
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') handleDrop();
      };

      // Model audio out. A real, DOM-attached element that we explicitly
      // play() — a detached autoplay element is unreliable for a live WebRTC
      // stream on WebKit (the macOS/Linux desktop targets).
      const audioEl = new Audio();
      audioEl.autoplay = true;
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        const [remote] = e.streams;
        if (!remote) return;
        audioEl.srcObject = remote;
        setModelStream(remote);
        // Amplify through Web Audio (the element alone caps at 1.0 and is too quiet).
        attachOutputBoost(remote);
        void audioEl.play().catch((err) => {
          if (typeof console !== 'undefined') console.error('[Vierzehn] Audio-Wiedergabe blockiert', err);
        });
      };

      // Mic in. `acquireMic` retries past a stale saved device and rethrows any
      // capture failure as a typed MicError → honest German + recovery button.
      const mic = await acquireMic(micDeviceId);
      micStreamRef.current = mic;
      if (ac.signal.aborted) {
        teardown();
        return;
      }
      setMicStream(mic);
      mic.getTracks().forEach((t) => pc.addTrack(t, mic));

      // Events channel.
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;
      dc.onopen = () => {
        // The session is live: reconnect logic may now bridge a later drop, and
        // the health clock starts (a session that outlives STABLE_SESSION_MS
        // renews the reconnect budget).
        everConnectedRef.current = true;
        sessionUpSinceRef.current = Date.now();
        dc.send(
          JSON.stringify({
            type: 'session.update',
            session: {
              type: 'realtime',
              instructions: session.instructions,
              tools: session.tools.map((t) => ({
                type: 'function',
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
              tool_choice: 'auto',
              audio: {
                input: {
                  // A shop has customers, radio and coins on glass. The 0.5/500ms
                  // defaults let that noise open a turn, and every false turn is a
                  // billed response. Tightened so only real speech opens a turn.
                  turn_detection: {
                    type: 'server_vad',
                    threshold: 0.65,
                    silence_duration_ms: 700,
                  },
                  // The mic sits across the counter, not on a headset.
                  noise_reduction: { type: 'far_field' },
                },
                // A hair faster than 1.0 counters the 2.x generation's reported
                // slow non-English pacing, keeping German lively but clear.
                output: { speed: 1.05 },
              },
              // Re-asserted here, not only at the mint: this session.update owns
              // the session config once the channel opens, so a server-side value
              // could be dropped. Audio output is the biggest line of the bill and
              // the API default is `inf`; 1200 tokens is ~60s, so it only ever
              // clips a runaway, never an honest answer.
              max_output_tokens: 1200,
              truncation: { type: 'retention_ratio', retention_ratio: 0.8 },
            },
          }),
        );
        // Greet first, immediately, in German — Vierzehn speaks before the owner
        // does, so there is no „press and talk" step. A SILENT reconnect skips
        // the greeting: it is resuming an ongoing conversation, not starting one,
        // so it should not re-announce itself every ~60 minutes.
        if (!silent) {
          dc.send(
            JSON.stringify({
              type: 'response.create',
              response: {
                instructions:
                  'Begrüße den Inhaber jetzt sofort, kurz und herzlich auf Deutsch: „Guten Tag, mein Herr. Wie kann ich Ihnen helfen?"',
              },
            }),
          );
        }
        setState('listening');
      };
      dc.onmessage = (e) => {
        try {
          handleEvent(JSON.parse(e.data as string) as Record<string, unknown>);
        } catch {
          /* ignore non-JSON frames */
        }
      };
      // The events channel closing/erroring unexpectedly means the session died.
      dc.onclose = () => handleDrop();
      dc.onerror = () => handleDrop();

      // SDP handshake with the ephemeral token. Bounded by the user's Abort OR
      // a 15s timeout, so a stalled upstream never leaves the UI in „Verbinde…".
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (ac.signal.aborted) {
        teardown();
        return;
      }
      const sdpAc = new AbortController();
      const onUserAbort = (): void => sdpAc.abort();
      ac.signal.addEventListener('abort', onUserAbort, { once: true });
      let sdpTimedOut = false;
      const sdpTimer = setTimeout(() => {
        sdpTimedOut = true;
        sdpAc.abort();
      }, 15000);
      let sdpRes: Response;
      try {
        sdpRes = await fetch(`${OPENAI_REALTIME_SDP_URL}?model=${encodeURIComponent(session.model)}`, {
          method: 'POST',
          body: offer.sdp ?? '',
          headers: {
            Authorization: `Bearer ${session.clientSecret}`,
            'Content-Type': 'application/sdp',
          },
          signal: sdpAc.signal,
        });
      } catch (fetchErr) {
        if (ac.signal.aborted) return; // user closed; teardown already ran
        if (sdpTimedOut) {
          throw new VierzehnError('Zeitüberschreitung beim Verbinden. Bitte später erneut versuchen.');
        }
        throw fetchErr; // genuine transport error → outer catch → describeError
      } finally {
        clearTimeout(sdpTimer);
        ac.signal.removeEventListener('abort', onUserAbort);
      }
      if (!sdpRes.ok) {
        throw new VierzehnError('Der Sprachdienst hat die Verbindung abgelehnt. Bitte später erneut versuchen.');
      }
      const answer = await sdpRes.text();
      if (ac.signal.aborted) {
        teardown();
        return;
      }
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    } catch (err) {
      // A user-initiated cancel (disconnect aborted the fetch) already tore
      // everything down — do not surface it as an error.
      if (ac.signal.aborted) return;
      // A SILENT reconnect that fails at the handshake shouldn't strand the owner
      // on the first blip — route it back through the reconnect budget (which
      // retries with backoff, or fails honestly once spent). The `finally` below
      // clears `connectingRef` before the scheduled retry fires.
      if (silent && !userClosedRef.current && everConnectedRef.current) {
        handleDrop();
        return;
      }
      if (typeof console !== 'undefined') console.error('[Vierzehn] Verbindung fehlgeschlagen', err);
      const nextFailure: VierzehnFailure =
        err instanceof MicError
          ? err.failure
          : err instanceof VierzehnError
            ? { title: 'Verbindung fehlgeschlagen', detail: err.reason, canOpenSettings: false }
            : {
                title: 'Verbindung fehlgeschlagen',
                detail: describeError(err),
                canOpenSettings: false,
              };
      teardown();
      setFailure(nextFailure);
      setState('error');
    } finally {
      connectingRef.current = false;
    }
  }, [api, micDeviceId, handleEvent, teardown, handleDrop]);

  // Keep a stable ref so the drop handler (defined above) can invoke the
  // connector (defined here) without a circular useCallback dependency.
  useEffect(() => {
    connectInternalRef.current = connectInternal;
  }, [connectInternal]);

  // Public connect: a deliberate open. Resets the reconnect budget + the
  // user-closed / never-connected flags, then starts a normal greeting session.
  const connect = useCallback(async (): Promise<void> => {
    userClosedRef.current = false;
    everConnectedRef.current = false;
    reconnectAttemptsRef.current = 0;
    await connectInternal({ silent: false });
  }, [connectInternal]);

  // Always tear down on unmount.
  useEffect(() => () => teardown(), [teardown]);

  return { state, failure, micStream, modelStream, connect, disconnect };
}
