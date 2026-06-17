/**
 * KYC Ausweis capture — collect the document fields (type / country / number /
 * validity), then capture the photo and POST the RAW bytes to the SERVER KYC
 * store in ONE call (addKycDocument via the keystone pipeline). The server
 * compresses, hashes, and AES-256-GCM-encrypts at rest; the pipeline ALWAYS
 * discards the temp device file afterwards — an Ausweis must never linger on the
 * phone (no-persist). The POST is ADMIN + step-up: a 403 STEP_UP_REQUIRED drives
 * the PIN Dialog and the call retries automatically.
 */
import { useState } from "react"
import { ScrollView, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import type { KycDocumentType } from "@warehouse14/api-client"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { describeError } from "@/warehouse14/api"
import { CapturePhotoScreen } from "@/warehouse14/CapturePhotoScreen"
import { KYC_DOC_TYPE_OPTIONS } from "@/warehouse14/customer-ui"
import { uploadCapturedPhoto, type CapturedPhoto } from "@/warehouse14/photo-pipeline"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export default function KycCaptureRoute() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>()
  const insets = useSafeAreaInsets()
  const [phase, setPhase] = useState<"form" | "camera">("form")
  const [documentType, setDocumentType] = useState<KycDocumentType>("PERSONALAUSWEIS")
  const [country, setCountry] = useState("DE")
  const [documentNumber, setDocumentNumber] = useState("")
  const [issuedOn, setIssuedOn] = useState("")
  const [expiresOn, setExpiresOn] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Validate the form BEFORE the camera, so the sensitive image is captured last
  // and held only briefly (capture → upload → discard).
  const canProceed =
    !!customerId &&
    documentNumber.trim().length > 0 &&
    /^[A-Z]{2}$/.test(country) &&
    ISO_DATE.test(expiresOn) &&
    (issuedOn === "" || ISO_DATE.test(issuedOn))

  async function onConfirm(photo: CapturedPhoto) {
    if (!customerId) return
    setBusy(true)
    setError(null)
    try {
      await uploadCapturedPhoto(photo, {
        kind: "kyc",
        customerId,
        documentType,
        issuingCountryIso2: country,
        documentNumber: documentNumber.trim(),
        ...(issuedOn ? { issuedOn } : {}),
        expiresOn,
      })
      router.back()
    } catch (e) {
      setError(describeError(e))
      setBusy(false)
      setPhase("form")
    }
  }

  if (phase === "camera") {
    return (
      <CapturePhotoScreen
        onConfirm={onConfirm}
        onCancel={() => setPhase("form")}
        busy={busy}
        error={error}
      />
    )
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      <View className="gap-1">
        <Text className="text-2xl font-bold">Ausweis erfassen</Text>
        <Text className="text-muted-foreground text-sm">
          Angaben ausfüllen, dann fotografieren. Das Bild wird serverseitig verschlüsselt
          gespeichert und nicht auf dem Gerät behalten.
        </Text>
      </View>

      <Card className="gap-3 px-4 py-4">
        <Text className="text-sm font-medium">Dokument-Typ</Text>
        <View className="flex-row flex-wrap gap-2">
          {KYC_DOC_TYPE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              size="sm"
              variant={documentType === opt.value ? "default" : "outline"}
              onPress={() => setDocumentType(opt.value)}
            >
              <Text>{opt.label}</Text>
            </Button>
          ))}
        </View>

        <Input
          value={country}
          onChangeText={(v) => setCountry(v.toUpperCase().slice(0, 2))}
          placeholder="Ausstellerland (ISO, z.B. DE)"
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <Input
          value={documentNumber}
          onChangeText={setDocumentNumber}
          placeholder="Dokumentnummer"
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <Input
          value={issuedOn}
          onChangeText={setIssuedOn}
          placeholder="Ausgestellt am (JJJJ-MM-TT, optional)"
          autoCorrect={false}
        />
        <Input
          value={expiresOn}
          onChangeText={setExpiresOn}
          placeholder="Gültig bis (JJJJ-MM-TT)"
          autoCorrect={false}
        />
      </Card>

      {error ? <Text className="text-destructive text-sm">{error}</Text> : null}

      <View className="flex-row gap-2">
        <Button variant="outline" className="flex-1" onPress={() => router.back()} disabled={busy}>
          <Text>Abbrechen</Text>
        </Button>
        <Button
          className="flex-1"
          onPress={() => setPhase("camera")}
          disabled={!canProceed || busy}
        >
          <Text>Ausweis fotografieren</Text>
        </Button>
      </View>
    </ScrollView>
  )
}
