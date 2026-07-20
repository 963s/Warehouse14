/**
 * Vierzehn auf dem Telefon — der React-Native-Port des Desktop-Sprachhirns
 * (apps/tauri-pos useRealtimeSession), bewusst dieselbe Architektur:
 *
 *   1. POST /api/realtime/session   — der SERVER prägt das kurzlebige Secret,
 *      wählt Modell/Stimme/Anweisungen und liefert die Werkzeugliste (nur
 *      assistantExposed). Der echte OpenAI-Schlüssel verlässt den Server nie.
 *   2. WebRTC (react-native-webrtc) — Mikrofonspur hoch, Modell-Audio runter
 *      (spielt automatisch; InCallManager erzwingt den Lautsprecher, damit die
 *      Antwort im Laden hörbar ist, nicht im Ohrhörer).
 *   3. DataChannel — session.update (Anweisungen + Werkzeuge + Laden-VAD),
 *      dann Ereignis-Routing; Werkzeug-Aufrufe werden 1:1 an die auditierte
 *      Schranke POST /api/mcp/assistant weitergereicht (JSON-RPC tools/call)
 *      und das Ergebnis als function_call_output zurückgegeben.
 *
 * EHRLICHKEIT + SICHERHEIT: Fehler werden dem Modell als stabile deutsche
 * Zeile maskiert (nie roher Wire-Text), dem Inhaber als beschriebener Fehler
 * gezeigt. Die Werkzeug-Grenze bleibt komplett serverseitig — dieses Telefon
 * kann nichts aufrufen, was der Server nicht ausdrücklich freigibt.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { PermissionsAndroid, Platform } from "react-native"
import { mediaDevices, MediaStream, RTCPeerConnection } from "react-native-webrtc"
import InCallManager from "react-native-incall-manager"

import { apiClient, describeError } from "@/warehouse14/api"

/** The library's channel type is not exported; infer it from the factory. */
type RTCDataChannel = ReturnType<RTCPeerConnection["createDataChannel"]>

const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/calls"
const HANDSHAKE_TIMEOUT_MS = 15_000
const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_BASE_MS = 900
const STABLE_SESSION_MS = 30_000

export type VoiceState =
  | "aus"
  | "verbinde"
  | "bereit"
  | "hoert"
  | "denkt"
  | "spricht"
  | "fehler"

interface SessionResponse {
  clientSecret: string
  expiresAt: string
  model: string
  voice: string
  instructions: string
  tools: Array<{ name: string; description: string; parameters: unknown }>
}

/** One line of the live conversation record. */
export interface TranscriptTurn {
  id: string
  role: "inhaber" | "vierzehn"
  text: string
}

const TRANSCRIPT_CAP = 12

export interface VierzehnVoice {
  state: VoiceState
  error: string | null
  /** Last spoken tool confirmation (shown as a calm line under the orb). */
  lastToolText: string | null
  /** The live written record of the talk — what Vierzehn heard and answered. */
  transcript: TranscriptTurn[]
  /** Mic muted (session stays alive — for when a customer walks in). */
  muted: boolean
  toggleMute: () => void
  /** Tell Vierzehn mid-talk that fresh photos just landed in the inbox. */
  announcePhotos: (count: number) => void
  connect: () => Promise<void>
  disconnect: () => void
}

export function useRealtimeVoice(): VierzehnVoice {
  const [state, setState] = useState<VoiceState>("aus")
  const [error, setError] = useState<string | null>(null)
  const [lastToolText, setLastToolText] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([])
  const [muted, setMuted] = useState(false)
  // The assistant transcript streams as deltas — accumulate per response and
  // commit on done so the panel shows calm finished lines, not letter soup.
  const pendingAssistantRef = useRef("")

  const pushTurn = useCallback((role: TranscriptTurn["role"], text: string) => {
    const line = text.trim()
    if (!line) return
    setTranscript((prev) =>
      [...prev, { id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`, role, text: line }].slice(
        -TRANSCRIPT_CAP,
      ),
    )
  }, [])

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const micRef = useRef<MediaStream | null>(null)
  const userClosedRef = useRef(false)
  const everConnectedRef = useRef(false)
  const sessionUpSinceRef = useRef(0)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectInternalRef = useRef<((silent: boolean) => Promise<void>) | null>(null)

  const teardown = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    try {
      dcRef.current?.close()
    } catch {
      /* already closed */
    }
    dcRef.current = null
    try {
      micRef.current?.getTracks().forEach((t) => t.stop())
    } catch {
      /* released */
    }
    micRef.current = null
    try {
      pcRef.current?.close()
    } catch {
      /* closed */
    }
    pcRef.current = null
    try {
      InCallManager.stop()
    } catch {
      /* not started */
    }
  }, [])

  /** Relay one model tool-call through the audited assistant boundary. */
  const relayToolCall = useCallback(async (callId: string, name: string, rawArgs: string) => {
    const dc = dcRef.current
    if (!dc) return
    let outputText: string
    try {
      const args: unknown = rawArgs ? JSON.parse(rawArgs) : {}
      const res = await apiClient.request<{
        result?: { content?: Array<{ type: string; text?: string }>; data?: unknown }
        error?: { message?: string }
      }>("POST", "/api/mcp/assistant", {
        body: {
          jsonrpc: "2.0",
          id: callId,
          method: "tools/call",
          params: { name, arguments: args },
        },
      })
      const text = res.result?.content?.find((c) => c.type === "text")?.text
      if (res.error || !text) {
        outputText = "Das Werkzeug hat nicht geantwortet. Sage dem Inhaber ehrlich, dass es gerade nicht ging."
      } else {
        outputText = text
        setLastToolText(text)
      }
    } catch {
      outputText = "Das Werkzeug ist gerade nicht erreichbar. Sage dem Inhaber ehrlich, dass es nicht ging."
    }
    try {
      dc.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: callId, output: outputText },
        }),
      )
      dc.send(JSON.stringify({ type: "response.create" }))
    } catch {
      /* channel died mid-reply; reconnect handles it */
    }
  }, [])

  const handleEvent = useCallback(
    (raw: string) => {
      let ev: { type?: string; [k: string]: unknown }
      try {
        ev = JSON.parse(raw) as { type?: string }
      } catch {
        return
      }
      switch (ev.type) {
        case "input_audio_buffer.speech_started":
          setState("hoert")
          break
        case "input_audio_buffer.speech_stopped":
          setState("denkt")
          break
        case "response.output_audio.delta":
        case "response.audio.delta":
          setState("spricht")
          break
        case "response.done":
        case "response.audio.done":
        case "response.output_audio.done":
          setState("bereit")
          break
        // ── Live written record ─────────────────────────────────────
        // What Vierzehn HEARD (whisper transcription of the owner's turn):
        case "conversation.item.input_audio_transcription.completed": {
          const heard = typeof ev.transcript === "string" ? ev.transcript : ""
          pushTurn("inhaber", heard)
          break
        }
        // What Vierzehn SAYS — streams as deltas, committed on done so the
        // panel shows whole calm sentences (both event-name generations).
        case "response.output_audio_transcript.delta":
        case "response.audio_transcript.delta":
          if (typeof ev.delta === "string") pendingAssistantRef.current += ev.delta
          break
        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done": {
          const said =
            typeof ev.transcript === "string" && ev.transcript.trim()
              ? ev.transcript
              : pendingAssistantRef.current
          pendingAssistantRef.current = ""
          pushTurn("vierzehn", said)
          break
        }
        case "response.function_call_arguments.done": {
          const callId = typeof ev.call_id === "string" ? ev.call_id : null
          const name = typeof ev.name === "string" ? ev.name : null
          const args = typeof ev.arguments === "string" ? ev.arguments : ""
          if (callId && name) void relayToolCall(callId, name, args)
          break
        }
        default:
          break
      }
    },
    [relayToolCall],
  )

  const handleDrop = useCallback(() => {
    if (userClosedRef.current || !everConnectedRef.current) return
    // A session that lived long enough earns a fresh reconnect budget.
    if (Date.now() - sessionUpSinceRef.current > STABLE_SESSION_MS) {
      reconnectAttemptsRef.current = 0
    }
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      teardown()
      setState("fehler")
      setError("Verbindung unterbrochen. Bitte erneut verbinden.")
      return
    }
    reconnectAttemptsRef.current += 1
    const delay = RECONNECT_BASE_MS * reconnectAttemptsRef.current
    reconnectTimerRef.current = setTimeout(() => {
      void connectInternalRef.current?.(true)
    }, delay)
  }, [teardown])

  const connectInternal = useCallback(
    async (silent: boolean) => {
      teardown()
      userClosedRef.current = false
      setError(null)
      setState("verbinde")
      try {
        const session = await apiClient.request<SessionResponse>("POST", "/api/realtime/session", {
          skipOfflineQueue: true,
        } as never)

        const pc = new RTCPeerConnection({})
        pcRef.current = pc

        // Shop speaker, not the ear: route media to the loudspeaker.
        InCallManager.start({ media: "audio" })
        InCallManager.setForceSpeakerphoneOn(true)

        // Android asks for the mic EXPLICITLY before getUserMedia so a denial
        // is a named, recoverable state (the owner sees exactly what to allow)
        // instead of an opaque WebRTC failure. iOS prompts inside getUserMedia.
        if (Platform.OS === "android") {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
            {
              title: "Mikrofon für Vierzehn",
              message:
                "Vierzehn braucht das Mikrofon, um mit dir sprechen zu können.",
              buttonPositive: "Erlauben",
              buttonNegative: "Ablehnen",
            },
          )
          if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            throw new Error("MIC_DENIED")
          }
        }

        let mic: MediaStream
        try {
          mic = await mediaDevices.getUserMedia({ audio: true })
        } catch {
          throw new Error("MIC_DENIED")
        }
        micRef.current = mic
        for (const track of mic.getAudioTracks()) pc.addTrack(track, mic)

        ;(pc as unknown as { onconnectionstatechange: (() => void) | null }).onconnectionstatechange =
          () => {
            if (pc.connectionState === "failed") handleDrop()
          }

        const dc = pc.createDataChannel("oai-events")
        dcRef.current = dc
        ;(dc as unknown as { onopen: (() => void) | null }).onopen = () => {
          everConnectedRef.current = true
          sessionUpSinceRef.current = Date.now()
          dc.send(
            JSON.stringify({
              type: "session.update",
              session: {
                type: "realtime",
                instructions: session.instructions,
                tools: session.tools.map((t) => ({
                  type: "function",
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                })),
                tool_choice: "auto",
                audio: {
                  input: {
                    turn_detection: {
                      type: "server_vad",
                      threshold: 0.65,
                      silence_duration_ms: 700,
                    },
                    noise_reduction: { type: "far_field" },
                    // Written record of the owner's words for the live
                    // transcript panel — trust in a loud shop.
                    transcription: { model: "whisper-1" },
                  },
                },
                max_output_tokens: 1200,
              },
            }),
          )
          if (!silent) {
            dc.send(
              JSON.stringify({
                type: "response.create",
                response: {
                  instructions:
                    "Begrüße den Inhaber jetzt kurz und herzlich auf Deutsch und biete deine Hilfe an.",
                },
              }),
            )
          }
          setState("bereit")
        }
        ;(dc as unknown as { onmessage: ((ev: { data?: unknown }) => void) | null }).onmessage = (
          ev,
        ) => {
          if (typeof ev.data === "string") handleEvent(ev.data)
        }
        ;(dc as unknown as { onclose: (() => void) | null }).onclose = handleDrop
        ;(dc as unknown as { onerror: (() => void) | null }).onerror = handleDrop

        const offer = await pc.createOffer({})
        await pc.setLocalDescription(offer)

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), HANDSHAKE_TIMEOUT_MS)
        let answerSdp: string
        try {
          const res = await fetch(`${OPENAI_CALLS_URL}?model=${encodeURIComponent(session.model)}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.clientSecret}`,
              "Content-Type": "application/sdp",
            },
            body: offer.sdp,
            signal: controller.signal,
          })
          if (!res.ok) throw new Error(`Handshake ${res.status}`)
          answerSdp = await res.text()
        } finally {
          clearTimeout(timer)
        }
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp })
      } catch (err) {
        teardown()
        if (silent) {
          handleDrop()
          return
        }
        setState("fehler")
        // Named failures speak for themselves; everything else goes through the
        // shared German describer (auth/role/network already read correctly).
        const msg = err instanceof Error ? err.message : ""
        if (msg === "MIC_DENIED") {
          setError(
            "Der Mikrofon-Zugriff ist nicht erlaubt. Bitte in den Geräte-Einstellungen unter Apps, Warehouse 14, Berechtigungen das Mikrofon erlauben und erneut verbinden.",
          )
        } else if (msg.startsWith("Handshake")) {
          setError("Die Sprachverbindung kam nicht zustande. Bitte erneut verbinden.")
        } else {
          setError(describeError(err))
        }
      }
    },
    [handleDrop, handleEvent, teardown],
  )
  connectInternalRef.current = connectInternal

  const connect = useCallback(async () => {
    reconnectAttemptsRef.current = 0
    everConnectedRef.current = false
    setTranscript([])
    setMuted(false)
    pendingAssistantRef.current = ""
    await connectInternal(false)
  }, [connectInternal])

  const disconnect = useCallback(() => {
    userClosedRef.current = true
    teardown()
    setState("aus")
    setError(null)
    setMuted(false)
  }, [teardown])

  /** Mute keeps the SESSION alive and only silences the mic track — for the
   *  moment a customer walks up to the counter. Unmute resumes instantly. */
  const toggleMute = useCallback(() => {
    const mic = micRef.current
    if (!mic) return
    setMuted((prev) => {
      const next = !prev
      for (const track of mic.getAudioTracks()) track.enabled = !next
      return next
    })
  }, [])

  /** Tell Vierzehn mid-conversation that fresh shelf photos just arrived, so
   *  it reacts naturally ("die drei Fotos sind da — sollen wir anlegen?")
   *  instead of the owner having to repeat what happened. */
  const announcePhotos = useCallback((count: number) => {
    const dc = dcRef.current
    if (!dc || count <= 0) return
    const line =
      count === 1
        ? "Hinweis: Soeben ist ein neues Foto im Eingang angekommen."
        : `Hinweis: Soeben sind ${count} neue Fotos im Eingang angekommen.`
    try {
      dc.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: line }],
          },
        }),
      )
      dc.send(JSON.stringify({ type: "response.create" }))
    } catch {
      /* channel gone — the inbox strip still shows the truth */
    }
  }, [])

  // Leaving the screen always releases mic + speaker + connection.
  useEffect(() => {
    return () => {
      userClosedRef.current = true
      teardown()
    }
  }, [teardown])

  return { state, error, lastToolText, transcript, muted, toggleMute, announcePhotos, connect, disconnect }
}
