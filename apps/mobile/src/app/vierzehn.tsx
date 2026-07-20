/**
 * Vierzehn — der Sprach-Agent in der Tasche.
 *
 * Dieselbe Seele wie an der Kasse (derselbe Server prägt die Sitzung, dieselben
 * auditierten Werkzeuge führen aus), aber am Ort des Geschehens: am Regal, mit
 * der Kamera IN der Unterhaltung. Fotografieren, senden, sprechen: „Leg ein
 * Produkt an: Goldring 585, vier Gramm, Preis 289, mit den drei neuen Fotos"
 * — Vierzehn wiederholt, wartet auf das Ja, und der Artikel entsteht komplett
 * mit Bildern auf dem Server. Vom Telefon begonnen, am Rechner fortgesetzt —
 * oder umgekehrt: der Eingang und die Werkzeuge sind EIN gemeinsamer Zustand.
 *
 * Form: Parchment-Identität des Owner OS (die App ist bewusst hell), ein
 * ruhiger atmender Orb statt des dunklen Kommandoraums der Kasse. EHRLICHKEIT:
 * Zustände sind echt (verbinde, bereit, hört, denkt, spricht, Fehler mit
 * beschriebenem Grund), die Warteliste unten ist die Server-Wahrheit.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { Image, Pressable, ScrollView, View } from "react-native"
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated"
import * as ImagePicker from "expo-image-picker"
import { useKeepAwake } from "expo-keep-awake"
import { Camera, ImagePlus, Mic, MicOff, Volume2 } from "lucide-react-native"

import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { absoluteUrl, describeError, listInboxPhotos, sendInboxPhoto } from "@/warehouse14/api"
import { compressToJpegBase64 } from "@/warehouse14/photo-pipeline"
import { useW14Theme } from "@/warehouse14/theme"
import { Hairline, haptics, PaperGrain, SectionCard, useScreenInsets } from "@/warehouse14/ui"
import { useMultiQuery } from "@/warehouse14/ui/data/useMultiQuery"
import {
  useRealtimeVoice,
  type TranscriptTurn,
  type VoiceState,
} from "@/warehouse14/vierzehn/useRealtimeVoice"

/**
 * The live written record — what Vierzehn heard (right, quiet) and answered
 * (left, ink). Auto-follows the newest line; capped height so the orb stays
 * the hero. Only rendered once the first words exist.
 */
function TranscriptPanel({ turns }: { turns: TranscriptTurn[] }): ReactNode {
  const scrollRef = useRef<ScrollView>(null)
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60)
    return () => clearTimeout(t)
  }, [turns.length])
  if (turns.length === 0) return null
  return (
    <SectionCard title="Das Gespräch">
      <ScrollView ref={scrollRef} style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
        <View className="gap-2 pb-1">
          {turns.map((turn) => (
            <View
              key={turn.id}
              className={turn.role === "inhaber" ? "items-end" : "items-start"}
            >
              <View
                className={
                  turn.role === "inhaber"
                    ? "bg-muted max-w-[85%] rounded-2xl rounded-tr-sm px-3 py-2"
                    : "bg-card border-border max-w-[85%] rounded-2xl rounded-tl-sm border px-3 py-2"
                }
              >
                <Text
                  className={
                    turn.role === "inhaber"
                      ? "text-muted-foreground text-sm"
                      : "text-foreground text-sm"
                  }
                >
                  {turn.text}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SectionCard>
  )
}

const STATE_LABEL: Record<VoiceState, string> = {
  aus: "Bereit, wenn du es bist",
  verbinde: "Verbinde …",
  bereit: "Ich höre zu",
  hoert: "Ich höre dich",
  denkt: "Einen Moment …",
  spricht: "Ich antworte",
  fehler: "Verbindung gestört",
}

function stateColor(state: VoiceState, t: ReturnType<typeof useW14Theme>): string {
  switch (state) {
    case "bereit":
      return t.colors.verdigris
    case "hoert":
      return t.colors.primary
    case "denkt":
      return t.colors.terra
    case "spricht":
      return t.colors.primary
    case "fehler":
      return t.colors.destructive
    default:
      return t.colors.mutedForeground
  }
}

/** The calm breathing orb — state carries the colour, breath carries the life. */
function Orb({ state }: { state: VoiceState }): ReactNode {
  const t = useW14Theme()
  const scale = useSharedValue(1)
  const active = state === "hoert" || state === "spricht" || state === "verbinde"

  useEffect(() => {
    scale.value = active
      ? withRepeat(withTiming(1.12, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true)
      : withTiming(1, { duration: 400 })
  }, [active, scale])

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const color = stateColor(state, t)

  return (
    <View className="items-center justify-center py-6">
      <Animated.View
        style={[
          {
            width: 148,
            height: 148,
            borderRadius: 74,
            backgroundColor: `${color}22`,
            alignItems: "center",
            justifyContent: "center",
          },
          style,
        ]}
      >
        <View
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: `${color}44`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: color }}
          />
        </View>
      </Animated.View>
    </View>
  )
}

type SendState = "verkleinern" | "senden" | "fertig" | "fehler"
interface QueueItem {
  key: string
  uri: string
  state: SendState
  error?: string
}

export default function VierzehnScreen(): ReactNode {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const voice = useRealtimeVoice()
  const [queue, setQueue] = useState<QueueItem[]>([])

  const q = useMultiQuery({ inbox: listInboxPhotos }, { key: "vierzehn-inbox", pollIntervalMs: 20_000 })
  const inbox = q.results.inbox.data

  const patchItem = useCallback((key: string, patch: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }, [])

  const sendOne = useCallback(
    async (item: QueueItem): Promise<boolean> => {
      try {
        patchItem(item.key, { state: "verkleinern", error: undefined })
        const dataBase64 = await compressToJpegBase64(item.uri, "product")
        patchItem(item.key, { state: "senden" })
        await sendInboxPhoto(dataBase64)
        patchItem(item.key, { state: "fertig" })
        haptics.success()
        void q.refetch()
        return true
      } catch (err) {
        patchItem(item.key, { state: "fehler", error: describeError(err) })
        haptics.error()
        return false
      }
    },
    [patchItem, q],
  )

  const enqueue = useCallback(
    (uris: string[]) => {
      const items: QueueItem[] = uris.map((uri, i) => ({
        key: `${Date.now()}-${i}`,
        uri,
        state: "verkleinern",
      }))
      setQueue((prev) => [...items, ...prev].slice(0, 12))
      // When the batch lands, tell Vierzehn MID-CONVERSATION — it reacts
      // naturally ("die Fotos sind da") instead of the owner repeating it.
      void Promise.all(items.map((it) => sendOne(it))).then((results) => {
        const landed = results.filter(Boolean).length
        if (landed > 0) voice.announcePhotos(landed)
      })
    },
    [sendOne, voice],
  )

  const captureWithCamera = useCallback(async () => {
    haptics.selection()
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) return
    const res = await ImagePicker.launchCameraAsync({ quality: 1 })
    if (!res.canceled && res.assets.length > 0) enqueue(res.assets.map((a) => a.uri))
  }, [enqueue])

  const pickFromGallery = useCallback(async () => {
    haptics.selection()
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 12,
      quality: 1,
    })
    if (!res.canceled && res.assets.length > 0) enqueue(res.assets.map((a) => a.uri))
  }, [enqueue])

  const sending = queue.filter((it) => it.state === "verkleinern" || it.state === "senden").length
  const connected = voice.state !== "aus" && voice.state !== "fehler"

  // A live voice session keeps the screen awake — the owner's hands hold the
  // ware, not the phone. Component unmount releases it automatically.
  useKeepAwake()

  return (
    <View className="bg-background flex-1">
      <PaperGrain />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: insets.stickyBottom + 24,
          gap: 16,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Der Orb + Zustand ─────────────────────────────────────── */}
        <View className="items-center">
          {/* Orb tap = the natural toggle: start when idle, end when live. */}
          <Pressable
            onPress={() => {
              haptics.selection()
              if (connected) voice.disconnect()
              else void voice.connect()
            }}
            accessibilityRole="button"
            accessibilityLabel={connected ? "Gespräch beenden" : "Mit Vierzehn sprechen"}
          >
            <Orb state={voice.state} />
          </Pressable>
          <Text className="text-foreground font-display-semibold text-2xl">Vierzehn</Text>
          <Text className="text-muted-foreground mt-1 text-sm">
            {voice.muted && connected ? "Stumm — Vierzehn wartet" : STATE_LABEL[voice.state]}
          </Text>
          {voice.error ? (
            <Text className="text-destructive mt-2 px-6 text-center text-xs">{voice.error}</Text>
          ) : null}
          {voice.lastToolText ? (
            <Text className="text-muted-foreground mt-3 px-4 text-center text-xs">
              {voice.lastToolText}
            </Text>
          ) : null}
          <View className="mt-5 w-full flex-row gap-3">
            {connected ? (
              <>
                {/* Mute keeps the session alive — a customer walked in. */}
                <Button
                  variant={voice.muted ? "default" : "secondary"}
                  className="flex-1"
                  onPress={() => {
                    haptics.selection()
                    voice.toggleMute()
                  }}
                >
                  {voice.muted ? (
                    <Volume2 size={18} color={t.colors.primaryForeground} />
                  ) : (
                    <MicOff size={18} color={t.colors.foreground} />
                  )}
                  <Text>{voice.muted ? "Weiter" : "Stumm"}</Text>
                </Button>
                <Button variant="secondary" className="flex-1" onPress={() => voice.disconnect()}>
                  <Mic size={18} color={t.colors.destructive} />
                  <Text>Beenden</Text>
                </Button>
              </>
            ) : (
              <Button className="flex-1" onPress={() => void voice.connect()}>
                <Mic size={18} color={t.colors.primaryForeground} />
                <Text>{voice.state === "fehler" ? "Erneut verbinden" : "Mit Vierzehn sprechen"}</Text>
              </Button>
            )}
          </View>
        </View>

        {/* ── Das Gespräch — live mitgeschrieben ────────────────────── */}
        <TranscriptPanel turns={voice.transcript} />

        {/* ── Fotos in der Unterhaltung ─────────────────────────────── */}
        <SectionCard title="Fotos für den nächsten Artikel">
          <Text className="text-muted-foreground pb-3 text-sm">
            Fotografiere die Ware und sage dann: „Leg ein Produkt an und häng die letzten Fotos
            dran."
          </Text>
          <View className="flex-row gap-3">
            <Button variant="secondary" className="flex-1" onPress={() => void captureWithCamera()}>
              <Camera size={18} color={t.colors.foreground} />
              <Text>Kamera</Text>
            </Button>
            <Button variant="secondary" className="flex-1" onPress={() => void pickFromGallery()}>
              <ImagePlus size={18} color={t.colors.foreground} />
              <Text>Galerie</Text>
            </Button>
          </View>
          {sending > 0 ? (
            <Text className="text-muted-foreground pt-3 text-xs">
              {sending} {sending === 1 ? "Foto wird gesendet" : "Fotos werden gesendet"} …
            </Text>
          ) : null}
          {queue.filter((it) => it.state === "fehler").map((it) => (
            <View key={it.key} className="flex-row items-center gap-3 pt-3">
              <Image source={{ uri: it.uri }} style={{ width: 36, height: 36, borderRadius: 8 }} />
              <Text className="text-muted-foreground flex-1 text-xs">{it.error}</Text>
              <Button size="sm" variant="secondary" onPress={() => void sendOne(it)}>
                <Text>Erneut</Text>
              </Button>
            </View>
          ))}
          {inbox && inbox.items.length > 0 ? (
            <View className="pt-3">
              <Hairline />
              <Text className="text-muted-foreground py-2 text-xs">
                {inbox.total} {inbox.total === 1 ? "Foto wartet" : "Fotos warten"} im Eingang —
                Vierzehn sieht sie
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-2">
                  {inbox.items.slice(0, 10).map((ph) => (
                    <Image
                      key={ph.id}
                      source={{ uri: absoluteUrl(ph.thumbUrl ?? ph.publicUrl) }}
                      style={{ width: 64, height: 64, borderRadius: 10 }}
                    />
                  ))}
                </View>
              </ScrollView>
            </View>
          ) : null}
        </SectionCard>

        {/* ── Was Vierzehn hier kann ────────────────────────────────── */}
        <SectionCard title="Was du sagen kannst">
          {[
            "Wie läuft der Tag? Was haben wir verkauft?",
            "Leg ein Produkt an: Goldring 585, vier Gramm, Preis 289, mit den neuen Fotos.",
            "Ändere den Preis der Taschenuhr auf 450.",
            "Wie viele Artikel haben wir im Lager, und was ist es wert?",
          ].map((line) => (
            <View key={line} className="flex-row items-start gap-2 py-1.5">
              <Text className="text-muted-foreground text-sm">„{line}"</Text>
            </View>
          ))}
        </SectionCard>
      </ScrollView>
    </View>
  )
}
