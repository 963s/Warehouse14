/**
 * useRealtimeSession — the voice brain behind Vierzehn (Jarvis).
 *
 * Flow (all secrets stay server-side):
 *   1. POST /api/realtime/session  → ephemeral token + persona + read-only tools.
 *   2. WebRTC peer connection to OpenAI Realtime, mic in, model audio out.
 *   3. data channel "oai-events": push the tools + turn detection; on a
 *      function call, RELAY it to POST /api/mcp (the app's own authenticated
 *      session + mTLS reach it) and send the result back. OpenAI never touches
 *      our server directly, so the zero-trust gate stays intact.
 *
 * Exposes a small state machine + the mic/model streams so JarvisOverlay can
 * drive the orb. NOTE: live-verify with the API key set + api deployed; the
 * exact Realtime event names are pinned to the 2026 WebRTC contract.
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

const OPENAI_REALTIME_SDP_URL = 'https://api.openai.com/v1/realtime';

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

  const disconnect = useCallback(() => {
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.getSenders().forEach((s) => s.track?.stop());
    pcRef.current?.close();
    pcRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
    }
    setMicStream(null);
    setModelStream(null);
    setState('idle');
  }, []);

  // Relay a model tool call to the app's authenticated MCP endpoint.
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
        const env = await api.request<McpEnvelope>('POST', '/api/mcp', {
          jsonrpc: '2.0',
          id: callId,
          method: 'tools/call',
          params: { name, arguments: args },
        });
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
      } else if (type === 'response.output_audio.delta' || type === 'output_audio_buffer.started') {
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
    if (pcRef.current) return;
    setError(null);
    setState('connecting');
    try {
      const session = await api.request<SessionResponse>('POST', '/api/realtime/session');

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Model audio out.
      const audioEl = new Audio();
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        const [remote] = e.streams;
        if (remote) {
          audioEl.srcObject = remote;
          setModelStream(remote);
        }
      };

      // Mic in.
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
      });
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
              instructions: session.instructions,
              tools: session.tools.map((t) => ({
                type: 'function',
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
              tool_choice: 'auto',
              turn_detection: { type: 'server_vad' },
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

      // SDP handshake with the ephemeral token.
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpRes = await fetch(`${OPENAI_REALTIME_SDP_URL}?model=${encodeURIComponent(session.model)}`, {
        method: 'POST',
        body: offer.sdp ?? '',
        headers: {
          Authorization: `Bearer ${session.clientSecret}`,
          'Content-Type': 'application/sdp',
        },
      });
      if (!sdpRes.ok) {
        throw new VierzehnError('Der Sprachdienst hat die Verbindung abgelehnt. Bitte später erneut versuchen.');
      }
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });
    } catch (err) {
      if (typeof console !== 'undefined') console.error('[Vierzehn] Verbindung fehlgeschlagen', err);
      const reason =
        err instanceof VierzehnError
          ? err.reason
          : err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'NotFoundError')
            ? 'Kein Zugriff auf das Mikrofon. Bitte die Freigabe erlauben und erneut versuchen.'
            : describeError(err);
      setError(reason);
      setState('error');
      disconnect();
    }
  }, [api, micDeviceId, handleEvent, disconnect]);

  // Always tear down on unmount.
  useEffect(() => () => disconnect(), [disconnect]);

  return { state, error, micStream, modelStream, connect, disconnect };
}
