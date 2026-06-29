/**
 * Neuer Kunde — POST /api/customers via createCustomer (ADMIN).
 *
 * Form (DESIGN-SYSTEM.md): keine Kästen in Kästen. Das Formular lebt direkt auf
 * dem warmen Papier — ein ruhiger Kicker + ein bespoke Karteikarten-Siegel öffnen
 * die Fläche, dann drei benannte Feld-Gruppen (Person · Kontakt · Geschäftlich),
 * jede mit einem Gilt-Faden im Gruppen-Kopf. Die Felder sitzen nackt auf dem
 * Papier, getrennt nur durch eine einzige warme Haarlinie. Tiefe kommt aus dem
 * geschichteten Papier und der Linie, nie aus gestapelten Karten.
 *
 * Validierung ist feld-genau und deutsch: ein ungültiger Entwurf färbt die
 * betroffenen Eingaben rot, löst die Fehler-Haptik aus und legt die erste
 * Meldung in eine EINZIGE ruhige Hinweis-Zeile oben — der Bediener sieht genau,
 * welche Zeile zu korrigieren ist, nie zwei gestapelte Fehlerkästen.
 *
 * Ein erfolgreiches Anlegen ist ein echter Meilenstein (ein neuer Kundensatz
 * existiert), also landet es mit der Erfolgs-Haptik und einer einzigen Gilt-Flut
 * (DESIGN-SYSTEM.md §5), bevor sich die Fläche durch die frische Kunden-Detail
 * ersetzt, wo KYC und Vertrauen als Nächstes gestempelt werden. Erreichbar aus
 * dem „Mehr"-Hub (/customer/neu) und dem Kunden-Tab.
 *
 * Eigenständig auf den geteilten Primitiven (KeyboardAvoidingScreen · Hairline ·
 * FormField · Input · ChipSelect · Button · §5-Motion + §7-Haptik) gebaut, damit
 * diese Fläche ihren boxlosen Aufbau selbst besitzt, ohne ein geteiltes Gerüst zu
 * verändern. Deutsche UI.
 */
import { type ComponentRef, type ReactNode, type RefObject, useRef, useState } from "react"
import { View, type TextInputProps } from "react-native"
import { router } from "expo-router"
import Svg, { Circle, Line, Path } from "react-native-svg"
import type { CustomerCreateBody } from "@warehouse14/api-client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { createCustomer, describeError } from "@/warehouse14/api"
import {
  type CustomerFieldKey,
  type CustomerFormErrors,
  EMPTY_CUSTOMER_FORM,
  type CustomerFormState,
  firstCustomerError,
  isCustomerFormValid,
  validateCustomerForm,
} from "@/warehouse14/customer-form"
import { LANGUAGE_OPTIONS } from "@/warehouse14/customer-ui"
import { ChipSelect, DateWheel } from "@/warehouse14/product-form"
import { useW14Theme } from "@/warehouse14/theme"
import {
  FormField,
  GoldFlood,
  Hairline,
  haptics,
  KeyboardAvoidingScreen,
  StaggerItem,
} from "@/warehouse14/ui"

// ────────────────────────────────────────────────────────────────────────────
// Karteikarten-Siegel — ein bespoke react-native-svg-Glyph. Eine gestempelte
// Karteikarte mit einem Reiter und gefüllten Schriftzeilen: die ruhige Marke des
// Kunden-Anlegens. Der Reiter tönt in Gilt (Gold nur als Faden/Siegel), die Karte
// bleibt Tinte.
// ────────────────────────────────────────────────────────────────────────────

function KarteikarteMark({
  size = 26,
  ink,
  gilt,
}: {
  size?: number
  ink: string
  gilt: string
}): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      {/* Karteikarte — der gestempelte Tinten-Rahmen. */}
      <Path
        d="M4.5 7.5 L19.5 7.5 L19.5 18 L4.5 18 Z"
        stroke={ink}
        strokeWidth={1.4}
        strokeLinejoin="round"
        fill="none"
      />
      {/* Reiter oben — der Gilt-Faden im Siegel (Gold nur als Kante). */}
      <Path
        d="M8 7.5 L8 5.6 L13 5.6 L13 7.5"
        stroke={gilt}
        strokeWidth={1.3}
        strokeLinejoin="round"
        fill="none"
      />
      {/* Eingetragene Person — ein ruhiger Kopf, die neue Karte. */}
      <Circle cx={9} cy={12} r={1.7} stroke={ink} strokeWidth={1.1} fill="none" />
      <Path d="M6.6 16 Q9 13.4 11.4 16" stroke={ink} strokeWidth={1.1} strokeLinecap="round" fill="none" />
      {/* Schriftzeilen — die gefüllten Stammdaten. */}
      <Line x1={13.4} y1={11} x2={17.4} y2={11} stroke={ink} strokeWidth={1} strokeOpacity={0.55} strokeLinecap="round" />
      <Line x1={13.4} y1={13.4} x2={17.4} y2={13.4} stroke={ink} strokeWidth={1} strokeOpacity={0.4} strokeLinecap="round" />
      <Line x1={13.4} y1={15.8} x2={16} y2={15.8} stroke={ink} strokeWidth={1} strokeOpacity={0.4} strokeLinecap="round" />
    </Svg>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Gruppen-Kopf — ein un-gekästelter Abschnitts-Titel. Ein leiser Gilt-Punkt als
// Faden öffnet jede Feld-Gruppe (DESIGN-SYSTEM.md §6: Kicker = Gilt-◆ + Kapitäl-
// chen). Keine Karten, keine Tönung — nur Tinte, Papier und der Faden.
// ────────────────────────────────────────────────────────────────────────────

function GroupHeader({ overline, hint }: { overline: string; hint?: string }): ReactNode {
  const t = useW14Theme()
  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-2">
        <View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }} />
        <Text
          className="text-2xs font-semibold"
          style={{ color: t.colors.inkAged, letterSpacing: 1.1 }}
        >
          {overline}
        </Text>
      </View>
      {hint != null ? (
        <Text className="text-muted-foreground text-xs">{hint}</Text>
      ) : null}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TextField — eine beschriftete Eingabe, die das Spine-`FormField`-Chrom (Label +
// Pflicht-Markierung + Feld-Hinweis/-Fehler) mit einer ref-tragenden `Input`
// verbindet, damit die Tastatur den Fokus weiterreichen kann. Der ungültige
// Zustand färbt den Eingabe-Rand destruktiv — wie der Spine-Default.
// ────────────────────────────────────────────────────────────────────────────

type InputRef = ComponentRef<typeof Input>

function TextField({
  label,
  required,
  hint,
  error,
  inputRef,
  ...inputProps
}: {
  label: string
  required?: boolean
  hint?: string
  error?: string
  inputRef?: RefObject<InputRef | null>
} & TextInputProps): ReactNode {
  const t = useW14Theme()
  const invalid = !!error
  return (
    <FormField label={label} required={required} hint={hint} error={error}>
      <Input
        ref={inputRef}
        aria-invalid={invalid}
        style={invalid ? { borderColor: t.colors.destructive } : undefined}
        {...inputProps}
      />
    </FormField>
  )
}

export default function NeuerKundeScreen(): ReactNode {
  const t = useW14Theme()
  const [form, setForm] = useState<CustomerFormState>(EMPTY_CUSTOMER_FORM)
  const [errors, setErrors] = useState<CustomerFormErrors>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [celebrate, setCelebrate] = useState(false)
  const [busy, setBusy] = useState(false)
  // Idempotenz-Sperre: nach einem erfolgreichen Anlegen navigieren wir nach einer
  // kurzen Flut, aber die Schaltfläche reaktiviert sich, sobald submit() auflöst.
  // Dieses Ref rastet den Moment ein, in dem der POST landet, damit ein zweiter
  // Tipp in diesem Fenster keinen zweiten POST auslöst → kein Doppel-Kunde. Ein
  // Ref (kein State), damit die Sperre synchron sitzt, vor dem Re-Render.
  const submittedRef = useRef(false)

  // Fokus-Weiterreichen für die Tastatur: jedes „Weiter" springt zum nächsten Feld.
  const emailRef = useRef<InputRef>(null)
  const phoneRef = useRef<InputRef>(null)
  const addressRef = useRef<InputRef>(null)
  const vatRef = useRef<InputRef>(null)
  const notesRef = useRef<InputRef>(null)

  const patch = (key: keyof CustomerFormState) => (text: string) => {
    setForm((prev) => ({ ...prev, [key]: text }))
    // Eine rote Zeile wird ruhig, sobald der Bediener anfängt, sie zu beheben.
    if ((key as CustomerFieldKey) in errors) {
      setErrors((prev) => {
        if (!((key as CustomerFieldKey) in prev)) return prev
        const next = { ...prev }
        delete next[key as CustomerFieldKey]
        return next
      })
    }
    // Sobald gestippt wird, ist der eine Hinweis oben nicht mehr aktuell.
    if (banner != null) setBanner(null)
  }

  const focusNext = (ref: RefObject<InputRef | null>) => () => ref.current?.focus()

  const canSubmit = !!form.fullName.trim() && !done && !busy

  async function submit(): Promise<void> {
    // Bereits angelegt + navigierend: einen zweiten Tipp still schlucken, damit
    // nie zweimal gePOSTet wird. (Die Schaltfläche ist unten auch deaktiviert,
    // aber ein Tipp kann das Reaktivieren überholen; dies ist der harte Stopp.)
    if (submittedRef.current) return

    const problems = validateCustomerForm(form)
    setErrors(problems)
    if (!isCustomerFormValid(problems)) {
      // Die roten Eingaben mit der Fehler-Haptik paaren; der Hinweis zeigt den ersten.
      haptics.error()
      setBanner(firstCustomerError(problems) ?? "Bitte Eingaben prüfen.")
      return
    }

    setBusy(true)
    setBanner(null)
    try {
      const body: CustomerCreateBody = {
        fullName: form.fullName.trim(),
        preferredLanguage: form.preferredLanguage,
        ...(form.dateOfBirth.trim() ? { dateOfBirth: form.dateOfBirth.trim() } : {}),
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        ...(form.address.trim() ? { address: form.address.trim() } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        ...(form.vatId.trim() ? { vatId: form.vatId.trim() } : {}),
      }

      const res = await createCustomer(body)
      // Vor der await-freien Schwanz-Zeile einrasten: der Satz existiert jetzt,
      // also muss jeder weitere Tipp ein No-op sein, bis wir wegnavigieren.
      submittedRef.current = true
      // Eine Haptik pro Aktion: die Erfolgs-Benachrichtigung IST die Bestätigung;
      // die folgende Gilt-Flut ist rein visuell, nie ein zweites Summen (§5).
      haptics.success()
      setDone(true)
      setCelebrate(true)
      // Die Flut atmen lassen, dann auf der frischen Detail landen, damit KYC und
      // Vertrauen als Nächstes gestempelt werden. Der replace räumt diese Fläche
      // aus dem Zurück-Stapel.
      setTimeout(() => {
        router.replace({ pathname: "/customer/[id]", params: { id: res.id } })
      }, 620)
    } catch (e) {
      // Ein ehrlicher, deutscher Fehler in der EINEN Hinweis-Zeile — kein Kasten.
      // describeError mappt ApiError-Codes auf Deutsch (Step-up läuft transparent
      // über den globalen Host und landet hier nur bei echtem Scheitern).
      haptics.error()
      setBanner(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  // Die drei benannten Gruppen, jede als boxlose Reihe nackter Felder. Die
  // Stagger gibt einen ruhigen, gestaffelten Eintritt (§5: einmal, beim Erscheinen).
  return (
    <>
      <KeyboardAvoidingScreen
        contentContainerStyle={{ gap: 24 }}
        footer={
          <View className="bg-card border-border border-t px-4 pt-3">
            <Button onPress={() => void submit()} disabled={!canSubmit}>
              <Text>{busy ? "Wird angelegt …" : "Anlegen"}</Text>
            </Button>
          </View>
        }
      >
        {/* ── Kopf: Kicker + Karteikarten-Siegel + Bricolage-Titel ─────────────── */}
        <StaggerItem index={0} exit={false}>
          <View className="gap-3">
            <View className="gap-1.5">
              <View className="flex-row items-center gap-2">
                <View
                  style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }}
                />
                <Text
                  className="text-muted-foreground text-2xs font-semibold"
                  style={{ letterSpacing: 1.2 }}
                >
                  STAMMDATEN
                </Text>
              </View>
              <View className="flex-row items-center gap-2.5">
                <KarteikarteMark size={26} ink={t.colors.primary} gilt={t.colors.gilt} />
                <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
                  Neuer Kunde
                </Text>
              </View>
            </View>
            <Text className="text-muted-foreground text-sm leading-5">
              Stammdaten erfassen. KYC und Vertrauen folgen im Kundenprofil.
            </Text>
          </View>
        </StaggerItem>

        {/* ── Die EINE ruhige Hinweis-Zeile (nie zwei gestapelte Fehlerkästen) ─── */}
        {banner != null ? (
          <View className="flex-row items-start gap-2" accessibilityLiveRegion="polite">
            <View
              style={{
                marginTop: 6,
                height: 6,
                width: 6,
                borderRadius: 3,
                backgroundColor: t.colors.destructive,
              }}
            />
            <Text className="flex-1 text-sm leading-5" style={{ color: t.colors.destructive }}>
              {banner}
            </Text>
          </View>
        ) : null}

        {/* ── Gruppe 1: Person ─────────────────────────────────────────────────── */}
        <StaggerItem index={1} exit={false}>
          <View className="gap-3.5">
            <GroupHeader overline="PERSON" />
            <Hairline />
            <TextField
              label="Name"
              required
              error={errors.fullName}
              value={form.fullName}
              onChangeText={patch("fullName")}
              placeholder="Vor- und Nachname"
              autoCapitalize="words"
              textContentType="name"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={focusNext(emailRef)}
              accessibilityLabel="Name"
            />
            <FormField
              label="Geburtsdatum"
              hint="Optional Tag, Monat und Jahr wählen."
              error={errors.dateOfBirth}
            >
              <DateWheel value={form.dateOfBirth} onChange={patch("dateOfBirth")} />
            </FormField>
            <FormField label="Bevorzugte Sprache">
              <ChipSelect
                options={LANGUAGE_OPTIONS}
                value={form.preferredLanguage}
                onChange={(lang) =>
                  setForm((prev) => ({ ...prev, preferredLanguage: lang ?? "de" }))
                }
              />
            </FormField>
          </View>
        </StaggerItem>

        {/* ── Gruppe 2: Kontakt ────────────────────────────────────────────────── */}
        <StaggerItem index={2} exit={false}>
          <View className="gap-3.5">
            <GroupHeader overline="KONTAKT" hint="Optional für Belege, Termine und Nachrichten." />
            <Hairline />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <TextField
                  label="E-Mail"
                  error={errors.email}
                  inputRef={emailRef}
                  value={form.email}
                  onChangeText={patch("email")}
                  placeholder="kunde@beispiel.de"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={focusNext(phoneRef)}
                  accessibilityLabel="E-Mail"
                />
              </View>
              <View className="flex-1">
                <TextField
                  label="Telefon"
                  error={errors.phone}
                  inputRef={phoneRef}
                  value={form.phone}
                  onChangeText={patch("phone")}
                  placeholder="+49 …"
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={focusNext(addressRef)}
                  accessibilityLabel="Telefon"
                />
              </View>
            </View>
            <TextField
              label="Adresse"
              hint="Optional Straße, PLZ und Ort."
              inputRef={addressRef}
              value={form.address}
              onChangeText={patch("address")}
              placeholder="Musterstraße 1, 12345 Musterstadt"
              textContentType="fullStreetAddress"
              autoCapitalize="words"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={focusNext(vatRef)}
              accessibilityLabel="Adresse"
            />
          </View>
        </StaggerItem>

        {/* ── Gruppe 3: Geschäftlich + Notiz ───────────────────────────────────── */}
        <StaggerItem index={3} exit={false}>
          <View className="gap-3.5">
            <GroupHeader
              overline="GESCHÄFTLICH"
              hint="Nur bei gewerblichen Kunden ausfüllen."
            />
            <Hairline />
            <TextField
              label="USt-IdNr."
              hint="Optional nur bei gewerblichen Kunden."
              error={errors.vatId}
              inputRef={vatRef}
              value={form.vatId}
              onChangeText={patch("vatId")}
              placeholder="DE123456789"
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={focusNext(notesRef)}
              accessibilityLabel="USt-IdNr."
            />
            <TextField
              label="Notiz"
              hint="Optional interne Anmerkung."
              inputRef={notesRef}
              value={form.notes}
              onChangeText={patch("notes")}
              placeholder="z. B. Stammkunde, Sammler …"
              autoCapitalize="sentences"
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
              accessibilityLabel="Notiz"
            />
          </View>
        </StaggerItem>

        {/* ── Ehrlicher Schluss-Hinweis — eine leise Gilt-gefädelte Zeile ──────── */}
        <View className="flex-row items-start gap-2 pt-1">
          <View
            style={{ marginTop: 6, height: 5, width: 5, borderRadius: 3, backgroundColor: t.colors.gilt }}
          />
          <Text className="text-muted-foreground flex-1 text-xs leading-5">
            Pflicht ist nur der Name. Alles Weitere lässt sich jederzeit im Kundenprofil ergänzen.
          </Text>
        </View>
      </KeyboardAvoidingScreen>

      {/* Die Neukunden-Flut — rein visuell (die Erfolgs-Haptik feuerte bereits);
          einmal pro Anlegen, über dem Inhalt, blockiert nie einen Tipp. */}
      <GoldFlood visible={celebrate} onDone={() => setCelebrate(false)} />
    </>
  )
}
