/**
 * Rundschreiben — das Benachrichtigungs- und Marketing-Zentrum des Inhabers
 * (0105).
 *
 * BASELS WUNSCH, 24.07.2026
 * „مركز الاشعارات خانة جديده لارسال اشعارات للتطبيق المتجر مثلا شكرا لكم على
 *  ثقتكم او عيد سعيد... احدد الهدف تطبيق او ايميل وارسل لهم اشعار او ايميل
 *  تسويقي اذا كانو موافقين".
 *
 * Der Inhaber schreibt EINEN Gruss (Dank, Feiertag, Neuigkeit), waehlt den
 * Kanal (App-Benachrichtigung, E-Mail oder beides) und den Kreis, und der
 * Server traegt ihn aus — jeden in SEINER Sprache. Deutsch ist Pflicht und die
 * Rueckfallsprache; Arabisch und Englisch sind freiwillig fuer die, die ihre
 * Kundschaft in diesen Sprachen ansprechen will.
 *
 * ZWEI EHRLICHKEITEN, die der Server erzwingt und die Flaeche NENNT:
 *   • E-Mail erreicht IMMER nur, wer der Werbung zugestimmt hat (UWG §7) —
 *     unabhaengig vom gewaehlten Kreis. Das steht als Hinweis am Kanal.
 *   • Nach dem Senden zeigt die Flaeche die WAHREN Zahlen des Servers: wie
 *     viele je Kanal eingereiht, wie viele mangels Einwilligung aussen blieben.
 *     Keine geschoente Gesamtzahl.
 */
import { useCallback, useEffect, useState } from "react"
import { ScrollView, View } from "react-native"

import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { broadcastHistory, describeError, sendBroadcast } from "@/warehouse14/api"
import { useW14Theme } from "@/warehouse14/theme"
import { FormField, FormScreen, PressableScale, haptics } from "@/warehouse14/ui"
import type { BroadcastHistoryItem } from "@warehouse14/api-client"

type Audience = "ALL" | "MARKETING"

export default function RundschreibenScreen() {
  const t = useW14Theme()

  // Kanaele + Kreis
  const [viaPush, setViaPush] = useState(true)
  const [viaEmail, setViaEmail] = useState(false)
  const [audience, setAudience] = useState<Audience>("MARKETING")

  // Inhalt je Sprache. Deutsch Pflicht, Arabisch/Englisch freiwillig.
  const [titelDe, setTitelDe] = useState("")
  const [textDe, setTextDe] = useState("")
  const [mehrSprachen, setMehrSprachen] = useState(false)
  const [titelAr, setTitelAr] = useState("")
  const [textAr, setTextAr] = useState("")
  const [titelEn, setTitelEn] = useState("")
  const [textEn, setTextEn] = useState("")

  // Ergebnis des letzten Versands (ehrliche Zahlen).
  const [ergebnis, setErgebnis] = useState<{
    queuedPush: number
    queuedEmail: number
    skippedNoConsent: number
  } | null>(null)

  // Verlauf
  const [verlauf, setVerlauf] = useState<BroadcastHistoryItem[] | null>(null)
  const ladeVerlauf = useCallback(async () => {
    try {
      const r = await broadcastHistory()
      setVerlauf(r.items)
    } catch {
      // Ein fehlgeschlagener Verlauf-Abruf ist kein Grund, den Versand zu
      // blockieren. Null bleibt null (unbekannt), nie eine erfundene Leere.
    }
  }, [])
  useEffect(() => {
    void ladeVerlauf()
  }, [ladeVerlauf])

  const titelOk = titelDe.trim().length > 0
  const textOk = textDe.trim().length > 0
  const kanalOk = viaPush || viaEmail
  const bereit = titelOk && textOk && kanalOk

  const senden = useCallback(async (): Promise<void | boolean> => {
    if (!bereit) {
      // Client-seitige Pruefung, die Meldung steht schon am Feld.
      return false
    }
    const content: Record<string, { title: string; body: string }> = {
      de: { title: titelDe.trim(), body: textDe.trim() },
    }
    if (mehrSprachen) {
      if (titelAr.trim() && textAr.trim()) {
        content.ar = { title: titelAr.trim(), body: textAr.trim() }
      }
      if (titelEn.trim() && textEn.trim()) {
        content.en = { title: titelEn.trim(), body: textEn.trim() }
      }
    }
    try {
      const r = await sendBroadcast({ viaPush, viaEmail, audience, content })
      setErgebnis({
        queuedPush: r.queuedPush,
        queuedEmail: r.queuedEmail,
        skippedNoConsent: r.skippedNoConsent,
      })
      haptics.success()
      // Felder leeren, damit derselbe Gruss nicht versehentlich zweimal
      // hinausgeht. Kanal + Kreis bleiben, das ist eine Einstellung.
      setTitelDe("")
      setTextDe("")
      setTitelAr("")
      setTextAr("")
      setTitelEn("")
      setTextEn("")
      void ladeVerlauf()
      return true
    } catch (e) {
      throw new Error(describeError(e))
    }
  }, [
    bereit, titelDe, textDe, mehrSprachen, titelAr, textAr, titelEn, textEn,
    viaPush, viaEmail, audience, ladeVerlauf,
  ])

  const chip = (aktiv: boolean) => ({
    borderColor: aktiv ? t.colors.gilt : t.colors.border,
    backgroundColor: aktiv ? t.colors.card : "transparent",
  })

  return (
    <FormScreen
      title="Rundschreiben"
      subtitle="Ein Gruss an die Kundschaft — App-Benachrichtigung, E-Mail oder beides."
      onSubmit={senden}
      submitLabel="Senden"
      submitBusyLabel="Wird gesendet…"
      successMessage="Das Rundschreiben ist unterwegs."
      submitDisabled={!bereit}
    >
      {/* Kanaele */}
      <FormField label="Kanal" required>
        <View className="flex-row gap-2">
          <PressableScale
            onPress={() => {
              haptics.selection()
              setViaPush((v) => !v)
            }}
            className="flex-1 rounded-xl border px-3 py-3"
            style={chip(viaPush)}
          >
            <Text className="text-sm font-medium">App-Benachrichtigung</Text>
            <Text className="text-muted-foreground text-xs">Auf das Kundentelefon</Text>
          </PressableScale>
          <PressableScale
            onPress={() => {
              haptics.selection()
              setViaEmail((v) => !v)
            }}
            className="flex-1 rounded-xl border px-3 py-3"
            style={chip(viaEmail)}
          >
            <Text className="text-sm font-medium">E-Mail</Text>
            <Text className="text-muted-foreground text-xs">Nur mit Einwilligung</Text>
          </PressableScale>
        </View>
      </FormField>

      {/* Kreis */}
      <FormField
        label="Kreis"
        hint={
          viaEmail
            ? "E-Mail erreicht immer nur, wer der Werbung zugestimmt hat."
            : "Alle: jedes Gerät mit erlaubten Benachrichtigungen."
        }
      >
        <View className="flex-row gap-2">
          {(["MARKETING", "ALL"] as const).map((a) => (
            <PressableScale
              key={a}
              onPress={() => {
                haptics.selection()
                setAudience(a)
              }}
              className="flex-1 rounded-xl border px-3 py-3"
              style={chip(audience === a)}
            >
              <Text className="text-sm font-medium">
                {a === "MARKETING" ? "Nur mit Einwilligung" : "Alle Erreichbaren"}
              </Text>
            </PressableScale>
          ))}
        </View>
      </FormField>

      {/* Deutsch — Pflicht */}
      <FormField label="Titel (Deutsch)" required error={!titelOk && titelDe.length > 0 ? "Der Titel darf nicht leer sein." : null}>
        <Input
          value={titelDe}
          onChangeText={setTitelDe}
          placeholder="Zum Beispiel: Danke für Ihr Vertrauen"
          maxLength={120}
        />
      </FormField>
      <FormField label="Text (Deutsch)" required>
        <Input
          value={textDe}
          onChangeText={setTextDe}
          placeholder="Der Gruss, den die Kundschaft liest."
          multiline
          numberOfLines={4}
          style={{ minHeight: 96, textAlignVertical: "top" }}
          maxLength={4000}
        />
      </FormField>

      {/* Weitere Sprachen — freiwillig */}
      <PressableScale
        onPress={() => {
          haptics.selection()
          setMehrSprachen((v) => !v)
        }}
        className="rounded-xl border px-3 py-2.5"
        style={{ borderColor: t.colors.border }}
      >
        <Text className="text-sm" style={{ color: t.colors.mutedForeground }}>
          {mehrSprachen ? "Weitere Sprachen ausblenden" : "In weiteren Sprachen schreiben (Arabisch, Englisch)"}
        </Text>
      </PressableScale>

      {mehrSprachen ? (
        <View className="gap-4">
          <Text className="text-muted-foreground text-xs">
            Wer den Laden auf Arabisch oder Englisch benutzt, bekommt dann diesen Text. Wer eine
            andere Sprache spricht, bekommt den deutschen. Leere Felder werden übersprungen.
          </Text>
          <FormField label="Titel (Arabisch)">
            <Input value={titelAr} onChangeText={setTitelAr} maxLength={120} style={{ textAlign: "right" }} />
          </FormField>
          <FormField label="Text (Arabisch)">
            <Input
              value={textAr}
              onChangeText={setTextAr}
              multiline
              numberOfLines={4}
              maxLength={4000}
              style={{ minHeight: 96, textAlignVertical: "top", textAlign: "right" }}
            />
          </FormField>
          <FormField label="Titel (Englisch)">
            <Input value={titelEn} onChangeText={setTitelEn} maxLength={120} />
          </FormField>
          <FormField label="Text (Englisch)">
            <Input
              value={textEn}
              onChangeText={setTextEn}
              multiline
              numberOfLines={4}
              maxLength={4000}
              style={{ minHeight: 96, textAlignVertical: "top" }}
            />
          </FormField>
        </View>
      ) : null}

      {/* Ergebnis des letzten Versands — die ehrlichen Zahlen */}
      {ergebnis ? (
        <View className="rounded-xl border p-3.5 gap-1" style={{ borderColor: t.colors.gilt }}>
          <Text className="text-sm font-medium">Zuletzt gesendet</Text>
          <Text className="text-sm" style={{ color: t.colors.mutedForeground }}>
            {ergebnis.queuedPush} Benachrichtigung{ergebnis.queuedPush === 1 ? "" : "en"} · {ergebnis.queuedEmail} E-Mail
            {ergebnis.queuedEmail === 1 ? "" : "s"} eingereiht.
          </Text>
          {ergebnis.skippedNoConsent > 0 ? (
            <Text className="text-xs" style={{ color: t.colors.mutedForeground }}>
              {ergebnis.skippedNoConsent} nicht erreicht — keine Einwilligung zur Werbung.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Verlauf */}
      {verlauf && verlauf.length > 0 ? (
        <View className="gap-2">
          <Text className="text-sm font-medium">Zuletzt hinausgegangen</Text>
          {verlauf.slice(0, 8).map((b) => (
            <View
              key={b.id}
              className="rounded-lg border p-2.5"
              style={{ borderColor: t.colors.border }}
            >
              <Text className="text-sm" numberOfLines={1}>
                {b.title || "(ohne Titel)"}
              </Text>
              <Text className="text-muted-foreground text-xs">
                {new Date(b.createdAt).toLocaleDateString("de-DE", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
                {" · "}
                {[b.viaPush ? "App" : null, b.viaEmail ? "E-Mail" : null].filter(Boolean).join(" + ")}
                {" · "}
                {b.queuedPush + b.queuedEmail} erreicht
                {b.skippedNoConsent > 0 ? `, ${b.skippedNoConsent} ohne Einwilligung` : ""}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </FormScreen>
  )
}
