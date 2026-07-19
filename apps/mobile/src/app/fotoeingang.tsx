/**
 * Fotoeingang — die Foto-Brücke zum Sprachassistenten Vierzehn.
 *
 * Der Inhaber steht am Regal, fotografiert Ware (oder wählt Bilder aus der
 * Galerie) und sendet sie hier in den Eingang des Hauses — OHNE Produkt. An
 * der Kasse sagt er dann zu Vierzehn: „Leg ein Produkt an und häng die
 * letzten drei Fotos dran" — der Assistent sieht denselben Eingang und bindet
 * die Bilder an den diktierten Entwurf. So wird das volle Lager Stück für
 * Stück erfasst, ohne eine Tastatur zu berühren.
 *
 * EHRLICHKEIT: die Warteliste unten ist die SERVER-Wahrheit (unassigned
 * photos), nicht der lokale Sendeverlauf. Jeder Sendevorgang zeigt seinen
 * echten Zustand (verkleinern, senden, angekommen, fehlgeschlagen mit
 * erneut-senden). Kein Foto wird lokal gespeichert; nach dem Upload wird die
 * temporäre Datei verworfen (dieselbe No-Persist-Doktrin wie die KYC-Kamera).
 */
import { useCallback, useState, type ReactNode } from "react"
import { Image, RefreshControl, ScrollView, View } from "react-native"
import * as ImagePicker from "expo-image-picker"
import { Camera, ImagePlus, Send } from "lucide-react-native"

import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { absoluteUrl, describeError, listInboxPhotos, sendInboxPhoto } from "@/warehouse14/api"
import { compressToJpegBase64 } from "@/warehouse14/photo-pipeline"
import { useW14Theme } from "@/warehouse14/theme"
import {
  EmptyState,
  Hairline,
  haptics,
  PaperGrain,
  SectionCard,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"
import { useMultiQuery } from "@/warehouse14/ui/data/useMultiQuery"

type SendState = "verkleinern" | "senden" | "fertig" | "fehler"

interface QueueItem {
  key: string
  uri: string
  state: SendState
  error?: string
}

const timeDe = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" })

export default function FotoeingangScreen(): ReactNode {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const [queue, setQueue] = useState<QueueItem[]>([])

  const q = useMultiQuery({ inbox: listInboxPhotos }, { key: "fotoeingang", pollIntervalMs: 30_000 })
  const rc = useRefreshControl(q)
  const inbox = q.results.inbox.data

  const patchItem = useCallback((key: string, patch: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }, [])

  const sendOne = useCallback(
    async (item: QueueItem) => {
      try {
        patchItem(item.key, { state: "verkleinern", error: undefined })
        const dataBase64 = await compressToJpegBase64(item.uri, "product")
        patchItem(item.key, { state: "senden" })
        await sendInboxPhoto(dataBase64)
        patchItem(item.key, { state: "fertig" })
        haptics.success()
        void q.refetch()
      } catch (err) {
        patchItem(item.key, { state: "fehler", error: describeError(err) })
        haptics.error()
      }
    },
    [patchItem, q],
  )

  const enqueue = useCallback(
    (uris: string[]) => {
      const items: QueueItem[] = uris.map((uri, i) => ({
        key: `${Date.now()}-${i}-${uri.slice(-8)}`,
        uri,
        state: "verkleinern",
      }))
      setQueue((prev) => [...items, ...prev].slice(0, 24))
      for (const it of items) void sendOne(it)
    },
    [sendOne],
  )

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

  const captureWithCamera = useCallback(async () => {
    haptics.selection()
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) return
    const res = await ImagePicker.launchCameraAsync({ quality: 1 })
    if (!res.canceled && res.assets.length > 0) enqueue(res.assets.map((a) => a.uri))
  }, [enqueue])

  const sending = queue.filter((it) => it.state === "verkleinern" || it.state === "senden").length
  const failed = queue.filter((it) => it.state === "fehler")

  return (
    <View className="bg-background flex-1">
      <PaperGrain />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: insets.stickyBottom + 24,
          gap: 16,
        }}
        refreshControl={<RefreshControl {...rc} progressViewOffset={8} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Senden ──────────────────────────────────────────────────── */}
        <SectionCard title="Fotos an Vierzehn senden" icon={Send}>
          <Text className="text-muted-foreground pb-3 text-sm">
            Ware am Regal fotografieren und in den Eingang des Hauses senden. An der Kasse dann zu
            Vierzehn sagen: „Leg ein Produkt an und häng die letzten Fotos dran."
          </Text>
          <View className="flex-row gap-3">
            <Button className="flex-1" onPress={() => void captureWithCamera()}>
              <Camera size={18} color={t.colors.primaryForeground} />
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
          {failed.length > 0 ? (
            <View className="pt-3">
              <Hairline />
              {failed.map((it) => (
                <View key={it.key} className="flex-row items-center gap-3 py-2">
                  <Image
                    source={{ uri: it.uri }}
                    style={{ width: 40, height: 40, borderRadius: 8 }}
                  />
                  <Text className="text-muted-foreground flex-1 text-xs">{it.error}</Text>
                  <Button size="sm" variant="secondary" onPress={() => void sendOne(it)}>
                    <Text>Erneut</Text>
                  </Button>
                </View>
              ))}
            </View>
          ) : null}
        </SectionCard>

        {/* ── Warteliste (Server-Wahrheit) ───────────────────────────── */}
        <SectionCard title="Im Eingang, wartet auf einen Artikel">
          {inbox == null ? (
            q.results.inbox.error ? (
              <Text className="text-muted-foreground py-1 text-sm">{q.results.inbox.error}</Text>
            ) : (
              <Text className="text-muted-foreground py-1 text-sm">Lädt …</Text>
            )
          ) : inbox.items.length === 0 ? (
            <EmptyState
              icon={Camera}
              title="Der Eingang ist leer"
              description="Alles Gesendete wurde bereits einem Artikel zugeordnet."
            />
          ) : (
            <View>
              <Text className="text-muted-foreground pb-2 text-xs">
                {inbox.total} {inbox.total === 1 ? "Foto wartet" : "Fotos warten"} · Vierzehn sieht
                genau diese Liste
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {inbox.items.map((ph) => (
                  <View key={ph.id} className="items-center gap-1">
                    <Image
                      source={{ uri: absoluteUrl(ph.thumbUrl ?? ph.publicUrl) }}
                      style={{ width: 92, height: 92, borderRadius: 10 }}
                    />
                    <Text className="text-muted-foreground font-mono text-2xs">
                      {timeDe.format(new Date(ph.createdAt))}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </SectionCard>
      </ScrollView>
    </View>
  )
}
