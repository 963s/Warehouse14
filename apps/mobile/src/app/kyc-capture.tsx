/**
 * KYC Ausweis erfassen — collect the document fields (type · country · number ·
 * validity), then capture the photo and POST the RAW bytes to the SERVER KYC
 * store in ONE call (addKycDocument via the keystone pipeline). The server
 * compresses, EXIF-strips, hashes, and AES-256-GCM-encrypts at rest; the
 * pipeline ALWAYS discards the temp device file afterwards — an Ausweis must
 * never linger on the phone (no-persist). The POST is ADMIN + step-up: a 403
 * STEP_UP_REQUIRED drives the PIN Dialog and the call retries automatically.
 *
 * The form is validated BEFORE the camera so the sensitive image is captured
 * last and held only briefly (capture → upload → discard). Built on the shared
 * spine: SectionCard + FormField (per-field validation, not just a dead button),
 * the chip picker for the document type, StaggerItem motion, the haptic
 * vocabulary, and InlineError for an upload failure. Tokens only; German UI.
 */
import { useMemo, useState } from "react"
import { ScrollView, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import type { KycDocumentType } from "@warehouse14/api-client"
import { Camera, IdCard, Lock, ShieldCheck } from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { describeError } from "@/warehouse14/api"
import { CapturePhotoScreen } from "@/warehouse14/CapturePhotoScreen"
import { KYC_DOC_TYPE_OPTIONS } from "@/warehouse14/customer-ui"
import { uploadCapturedPhoto, type CapturedPhoto } from "@/warehouse14/photo-pipeline"
import { useW14Theme } from "@/warehouse14/theme"
import {
  FormField,
  haptics,
  InlineError,
  PaperGrain,
  PressableScale,
  SectionCard,
  StaggerItem,
  useScreenInsets,
} from "@/warehouse14/ui"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Build a human reason an ISO-date field is invalid, or null when it's fine. */
function dateError(value: string, { required }: { required: boolean }): string | null {
  if (value === "") return required ? "Pflichtfeld." : null
  if (!ISO_DATE.test(value)) return "Format JJJJ-MM-TT (z. B. 2030-04-21)."
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "Kein gültiges Datum."
  return null
}

export default function KycCaptureRoute() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>()
  const t = useW14Theme()
  const insets = useScreenInsets()

  const [phase, setPhase] = useState<"form" | "camera">("form")
  const [documentType, setDocumentType] = useState<KycDocumentType>("PERSONALAUSWEIS")
  const [country, setCountry] = useState("DE")
  const [documentNumber, setDocumentNumber] = useState("")
  const [issuedOn, setIssuedOn] = useState("")
  const [expiresOn, setExpiresOn] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Show per-field errors only after a submit attempt — never scold an empty,
  // untouched form on first render.
  const [showErrors, setShowErrors] = useState(false)

  // Per-field validation (computed once per render; surfaced after a submit try).
  const countryError = useMemo(
    () => (/^[A-Z]{2}$/.test(country) ? null : "Zwei Buchstaben (ISO), z. B. DE."),
    [country],
  )
  const numberError = useMemo(
    () => (documentNumber.trim().length > 0 ? null : "Pflichtfeld."),
    [documentNumber],
  )
  const issuedError = useMemo(() => dateError(issuedOn, { required: false }), [issuedOn])
  const expiresError = useMemo(() => dateError(expiresOn, { required: true }), [expiresOn])

  const canProceed = !!customerId && !countryError && !numberError && !issuedError && !expiresError

  function goToCamera() {
    if (!canProceed) {
      setShowErrors(true)
      haptics.error()
      return
    }
    haptics.selection()
    setError(null)
    setPhase("camera")
  }

  async function onConfirm(photo: CapturedPhoto) {
    if (!customerId) return
    setBusy(true)
    setError(null)
    try {
      // 403 STEP_UP_REQUIRED → the global PIN Dialog opens + this retries.
      await uploadCapturedPhoto(photo, {
        kind: "kyc",
        customerId,
        documentType,
        issuingCountryIso2: country,
        documentNumber: documentNumber.trim(),
        ...(issuedOn ? { issuedOn } : {}),
        expiresOn,
      })
      // The detail screen refetches on focus and shows the verdigris confirmation.
      haptics.success()
      router.back()
    } catch (e) {
      haptics.error()
      setError(describeError(e))
      setBusy(false)
      setPhase("form")
    }
  }

  if (phase === "camera") {
    return (
      <CapturePhotoScreen
        onConfirm={onConfirm}
        onCancel={() => {
          haptics.selection()
          setPhase("form")
        }}
        busy={busy}
        error={error}
      />
    )
  }

  return (
    <View className="flex-1 bg-background">
      {/* The aged-paper grain canvas behind the form the same layered cream
          depth as the rest of the group (DESIGN.md §5). The camera phase keeps
          its own dark over-feed chrome and is intentionally ungrained. */}
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.contentBottom, gap: 12 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
      {/* Header */}
      <StaggerItem index={0}>
        <View className="flex-row items-center gap-3">
          <View
            className="h-12 w-12 items-center justify-center rounded-xl"
            style={{ backgroundColor: t.colors.raised }}
          >
            <IdCard size={t.icon.xl} color={t.colors.primary} />
          </View>
          <View className="flex-1 gap-0.5">
            {/* The screen identity the display voice (Bricolage Grotesque),
                matching the other group headlines (DESIGN.md §3). */}
            <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
              Ausweis erfassen
            </Text>
            <Text className="text-muted-foreground text-xs" numberOfLines={2}>
              Schritt 1 von 2 · Angaben ausfüllen, dann fotografieren.
            </Text>
          </View>
        </View>
      </StaggerItem>

      {/* Privacy reassurance the honest promise about the sensitive image. */}
      <StaggerItem index={1}>
        <Card
          className="flex-row items-start gap-2.5 px-4 py-3.5"
          style={{
            borderColor: t.colors.verdigris + "44",
            backgroundColor: t.colors.verdigris + "0D",
          }}
        >
          <View className="pt-0.5">
            <ShieldCheck size={t.icon.sm} color={t.colors.verdigris} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="text-sm font-semibold" style={{ color: t.colors.verdigris }}>
              Verschlüsselt, nicht auf dem Gerät
            </Text>
            <Text className="text-muted-foreground text-sm leading-5">
              Das Foto wird sofort serverseitig verschlüsselt abgelegt (AES-256) und auf dem Telefon
              nicht behalten (GwG/DSGVO).
            </Text>
          </View>
        </Card>
      </StaggerItem>

      {/* Document type the chip picker */}
      <StaggerItem index={2}>
        <SectionCard title="Dokument-Typ" icon={IdCard}>
          <View className="flex-row flex-wrap gap-2">
            {KYC_DOC_TYPE_OPTIONS.map((opt) => {
              const selected = documentType === opt.value
              return (
                <PressableScale
                  key={opt.value}
                  accessibilityRole="button"
                  accessibilityLabel={opt.label}
                  accessibilityState={{ selected }}
                  onPress={() => {
                    haptics.selection()
                    setDocumentType(opt.value)
                  }}
                >
                  <Badge variant={selected ? "default" : "outline"} dot={selected}>
                    <Text>{opt.label}</Text>
                  </Badge>
                </PressableScale>
              )
            })}
          </View>
        </SectionCard>
      </StaggerItem>

      {/* Document fields labelled, per-field validated */}
      <StaggerItem index={3}>
        <SectionCard title="Angaben" subtitle="Direkt vom Ausweis übernehmen.">
          <FormField
            label="Ausstellerland"
            required
            hint="ISO-Ländercode, z. B. DE."
            error={showErrors ? countryError : null}
            inputProps={{
              value: country,
              onChangeText: (v: string) => setCountry(v.toUpperCase().slice(0, 2)),
              placeholder: "DE",
              autoCapitalize: "characters",
              autoCorrect: false,
              accessibilityLabel: "Ausstellerland",
            }}
          />
          <FormField
            label="Dokumentnummer"
            required
            error={showErrors ? numberError : null}
            inputProps={{
              value: documentNumber,
              onChangeText: setDocumentNumber,
              placeholder: "z. B. L01X00T47",
              autoCapitalize: "characters",
              autoCorrect: false,
              accessibilityLabel: "Dokumentnummer",
            }}
          />
          <FormField
            label="Ausgestellt am"
            hint="Optional · JJJJ-MM-TT."
            error={showErrors ? issuedError : null}
            inputProps={{
              value: issuedOn,
              onChangeText: setIssuedOn,
              placeholder: "JJJJ-MM-TT",
              autoCorrect: false,
              keyboardType: "numbers-and-punctuation",
              accessibilityLabel: "Ausgestellt am",
            }}
          />
          <FormField
            label="Gültig bis"
            required
            hint="JJJJ-MM-TT."
            error={showErrors ? expiresError : null}
            inputProps={{
              value: expiresOn,
              onChangeText: setExpiresOn,
              placeholder: "JJJJ-MM-TT",
              autoCorrect: false,
              keyboardType: "numbers-and-punctuation",
              accessibilityLabel: "Gültig bis",
            }}
          />
        </SectionCard>
      </StaggerItem>

      {error ? (
        <StaggerItem index={4} exit>
          <InlineError message={error} onDismiss={() => setError(null)} />
        </StaggerItem>
      ) : null}

      {/* Actions Abbrechen + go to the camera (Schritt 2) */}
      <StaggerItem index={5}>
        <View className="flex-row items-center gap-2 pt-1">
          <Button
            variant="outline"
            className="flex-1"
            onPress={() => {
              haptics.selection()
              router.back()
            }}
            disabled={busy}
            accessibilityLabel="Abbrechen"
          >
            <Text>Abbrechen</Text>
          </Button>
          <Button
            size="xl"
            className="h-12 flex-[1.4] flex-row items-center justify-center gap-2"
            onPress={goToCamera}
            disabled={busy}
            accessibilityLabel="Ausweis fotografieren"
          >
            <Camera size={t.icon.sm} color={t.colors.primaryForeground} />
            <Text>Ausweis fotografieren</Text>
          </Button>
        </View>
      </StaggerItem>

      <StaggerItem index={6}>
        <View className="flex-row items-center justify-center gap-1.5 pt-1">
          <Lock size={t.icon.xs} color={t.colors.mutedForeground} />
          <Text className="text-muted-foreground text-2xs">
            PIN-bestätigt · im Prüfprotokoll vermerkt
          </Text>
        </View>
      </StaggerItem>
      </ScrollView>
    </View>
  )
}
