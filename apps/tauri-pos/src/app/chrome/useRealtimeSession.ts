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

export interface UseRealtimeSession {
  state: JarvisState;
  error: string | null;
  micStream: MediaStream | null;
  modelStream: MediaStream | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

// GA WebRTC endpoint. The SDP offer is POSTed here with the ephemeral token;
// the older `/v1/realtime` path is the deprecated beta and rejects GA keys.
const OPENAI_REALTIME_SDP_URL = 'https://api.openai.com/v1/realtime/calls';

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

export function useRealtimeSession(micDeviceId?: string): UseRealtimeSession {
  const api = useApiClient();
  const [state, setState] = useState<JarvisState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [modelStream, setModelStream] = useState<MediaStream | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Set synchronously at the top of connect() so a rapid second tap (or a
  // close mid-connect) cannot start a second peer connection or leave a mic on.
  const connectingRef = useRef(false);

  // Release EVERY live resource. Idempotent, and never leaves the mic hot:
  // the mic is stopped from its own ref, so a stream acquired but not yet added
  // to the peer connection is still stopped.
  const teardown = useCallback(() => {
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
    setMicStream(null);
    setModelStream(null);
  }, []);

  const disconnect = useCallback(() => {
    teardown();
    setState('idle');
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
        setError('Es gab ein Problem in der Sprachsitzung. Bitte erneut verbinden.');
      }
    },
    [relayToolCall],
  );

  const connect = useCallback(async (): Promise<void> => {
    if (pcRef.current || connectingRef.current) return;
    connectingRef.current = true;
    setError(null);
    setState('connecting');
    const ac = new AbortController();
    abortRef.current = ac;
    // A drop AFTER a successful connect (ICE failed, or the data channel closed)
    // must surface the loss and free the mic, never hang the UI in listening/
    // speaking. Guarded so our own teardown (which aborts `ac` first) does not
    // flash a spurious error.
    const dropOut = (): void => {
      if (ac.signal.aborted) return;
      if (typeof console !== 'undefined') console.error('[Vierzehn] Verbindung verloren');
      teardown();
      setError('Die Verbindung zur Sprachsitzung wurde unterbrochen. Bitte erneut verbinden.');
      setState('error');
    };
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
        if (pc.connectionState === 'failed') dropOut();
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
        void audioEl.play().catch((err) => {
          if (typeof console !== 'undefined') console.error('[Vierzehn] Audio-Wiedergabe blockiert', err);
        });
      };

      // Mic in.
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
      });
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
              audio: { input: { turn_detection: { type: 'server_vad' } } },
            },
          }),
        );
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
      dc.onclose = () => dropOut();
      dc.onerror = () => dropOut();

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
      if (typeof console !== 'undefined') console.error('[Vierzehn] Verbindung fehlgeschlagen', err);
      const reason =
        err instanceof VierzehnError
          ? err.reason
          : err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'NotFoundError')
            ? 'Kein Zugriff auf das Mikrofon. Bitte die Freigabe erlauben und erneut versuchen.'
            : describeError(err);
      teardown();
      setError(reason);
      setState('error');
    } finally {
      connectingRef.current = false;
    }
  }, [api, micDeviceId, handleEvent, teardown]);

  // Always tear down on unmount.
  useEffect(() => () => teardown(), [teardown]);

  return { state, error, micStream, modelStream, connect, disconnect };
}
