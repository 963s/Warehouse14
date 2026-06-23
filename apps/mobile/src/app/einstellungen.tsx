/**
 * Einstellungen — the System surface of the Owner OS. One calm, scannable column
 * of the few things an owner actually changes or checks, each section honest
 * about where its truth comes from:
 *
 *   • Ankauf-Margen — the per-metal + global safety margin that the Ankauf rate
 *     is built from (Ankaufkurs = 10-Tage-Schnitt × (1 − Marge)). Read LIVE from
 *     GET /api/metal-prices/rates (the real `safetyMarginPct` in effect); each
 *     row edits via PATCH /api/metal-prices/margin — ADMIN + step-up, fired
 *     transparently by the global StepUpDialogHost. Saved as a percent, sent as
 *     the [0, 0.5] fraction the backend expects. A real success → Success haptic
 *     + verdigris confirm + a refetch, so the number on screen is always live.
 *
 *   • Belegtexte: the receipt legal texts (header/footer + per-Steuerschlüssel
 *     clauses + Ankauf declaration), LIVE from GET /api/belegtext-templates. An
 *     ADMIN edits a body and PUBLISHES a new version through the shared
 *     FiscalConfirmSheet, a fiscal-weight commit (the text prints on every
 *     GoBD-relevant Beleg), Owner step-up transparent via the global host. A
 *     non-ADMIN sees the live texts, read-only. (SettingsBelegtextSection.)
 *
 *   • Sammlungen: the category taxonomy (up to 3 levels), LIVE from
 *     GET /api/categories with the server's per-node productCount. ADMIN adds /
 *     renames / deletes; a delete the FK refuses is pre-checked + shown honestly.
 *     No step-up (operator-curated). (SettingsCategoriesSection.)
 *
 *   • Dashboard-Ziele — the owner's editable goals behind the Schatzkammer rings
 *     (Tagesumsatz, Tagesgewinn, Monatsumsatz, Monatsgewinn). Persisted via the
 *     preferences store, seeded from the exact constants the dashboard ships with.
 *
 *   • Gerät & Sitzung — read-only facts from the live session (Rolle, Sitzung
 *     läuft ab, Geräte-Fingerprint, API-Server). Honest; never editable here.
 *
 *   • Darstellung — the live OS appearance + reduced-motion state (read straight
 *     from useColorScheme / useReducedMotion), with a real deep link into the
 *     system settings. Reflections, not fake toggles: the app follows the system,
 *     and the screen says exactly that rather than implying an override it lacks.
 *
 *   • Abmelden — clears the in-memory session; the root auth gate then redirects
 *     to /login. A destructive, confirmed action (DESIGN.md §4 wax-red).
 *
 * Spine only (DESIGN.md): SectionCard / FormField for structure, the §6 motion
 * (screen-enter + a capped StaggerItem cascade, PressableScale), §7 haptics
 * (selection on a control, Success on a saved margin, Error on a blocked save),
 * InlineError for a non-blocking failure, the theme tokens for every colour /
 * radius / space / icon — no hardcoded hex. German throughout; de-DE numbers.
 * Reached from the „Mehr"-Hub (/einstellungen).
 */
import { useCallback, useMemo, useState } from "react"
import { Linking, useColorScheme, View } from "react-native"
import {
  type ActorRole,
  metalPricesApi,
  type MetalKind,
  type MetalRate,
} from "@warehouse14/api-client"
import {
  Check,
  ChevronRight,
  Coins,
  Gauge,
  LogOut,
  Moon,
  Settings2,
  Smartphone,
  Sparkles,
  SunMedium,
  Target,
  X,
} from "lucide-react-native"
import { useReducedMotion } from "react-native-reanimated"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import {
  API_BASE_URL,
  apiClient,
  DEV_DEVICE_FINGERPRINT,
  updateMetalMargin,
} from "@/warehouse14/api"
import { ACTOR_ROLE_LABEL } from "@/warehouse14/german-text"
import { clearCachedRead } from "@/warehouse14/offline"
import {
  DEFAULT_DASHBOARD_TARGETS,
  type DashboardTargets,
  resetDashboardTargets,
  setDashboardTargets,
  useDashboardTargets,
} from "@/warehouse14/preferences"
import { clearSession, useSession } from "@/warehouse14/session"
import { SettingsBelegtextSection } from "@/warehouse14/SettingsBelegtextSection"
import { SettingsCategoriesSection } from "@/warehouse14/SettingsCategoriesSection"
import { useW14Theme } from "@/warehouse14/theme"
import {
  InlineError,
  KeyboardAvoidingScreen,
  PressableScale,
  SectionCard,
  Skeleton,
  StaggerItem,
  haptics,
  useMutation,
  useQuery,
} from "@/warehouse14/ui"

// ── Helpers ───────────────────────────────────────────────────────────────────

const METAL_LABEL: Record<MetalKind, string> = {
  gold: "Gold",
  silver: "Silber",
  platinum: "Platin",
  palladium: "Palladium",
}

/** de-DE integer/2-decimal formatting without inventing a currency symbol. */
function formatDe(value: number, fractionDigits = 0): string {
  return value.toLocaleString("de-DE", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

/** A fraction (0.12) → a de-DE percent label ("12 %"); null → an em-free dash. */
function fractionToPercentLabel(fraction: number | null | undefined): string {
  if (fraction == null || !Number.isFinite(fraction)) return "–"
  const pct = fraction * 100
  // Most margins are whole percents; keep one decimal only when it carries info.
  const digits = Number.isInteger(pct) ? 0 : 1
  return `${formatDe(pct, digits)} %`
}

/** Parse a de-DE percent input ("12" or "12,5") to a [0, 0.5] fraction, or null. */
function parsePercentToFraction(input: string): number | null {
  const trimmed = input.trim().replace("%", "").replace(",", ".")
  if (trimmed.length === 0) return null
  const pct = Number(trimmed)
  if (!Number.isFinite(pct)) return null
  const fraction = pct / 100
  if (fraction < 0 || fraction > 0.5) return null
  return fraction
}

/** Parse a de-DE EUR amount ("1.000" / "1000") to a positive whole-EUR int. */
function parseEur(input: string): number | null {
  const cleaned = input.trim().replace(/\./g, "").replace(",", ".")
  if (cleaned.length === 0) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n)
}

// ── Ankauf-Margen ───────────────────────────────────────────────────────────--

/**
 * One margin row: the metal label, its live margin, and (when editing) a percent
 * field + Speichern/Abbrechen. The save calls updateMetalMargin — ADMIN +
 * step-up, transparent via the global host — then refetches so the row reflects
 * the true server value, never the optimistic guess.
 */
function MarginRow({
  metal,
  label,
  marginFraction,
  onSaved,
}: {
  /** null = the global default margin row. */
  metal: MetalKind | null
  label: string
  marginFraction: number
  onSaved: () => void
}) {
  const t = useW14Theme()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)

  const save = useMutation(
    (fraction: number) =>
      updateMetalMargin(metal ? { metal, marginPct: fraction } : { marginPct: fraction }),
    {
      onSuccess: () => {
        haptics.success()
        setEditing(false)
        setFieldError(null)
        onSaved()
      },
    },
  )

  const beginEdit = useCallback(() => {
    haptics.selection()
    setFieldError(null)
    // Seed the field with the current percent as a plain de-DE number (comma
    // decimal, no "%"), which parsePercentToFraction reads straight back.
    const pct = marginFraction * 100
    setDraft(formatDe(pct, Number.isInteger(pct) ? 0 : 1))
    setEditing(true)
  }, [marginFraction])

  const commit = useCallback(async () => {
    const fraction = parsePercentToFraction(draft)
    if (fraction == null) {
      haptics.error()
      setFieldError("Bitte einen Wert zwischen 0 und 50 % eingeben.")
      return
    }
    try {
      await save.mutate(fraction)
    } catch {
      // The themed error is already on save.error; the InlineError renders it.
    }
  }, [draft, save])

  if (!editing) {
    return (
      <PressableScale
        onPress={beginEdit}
        accessibilityRole="button"
        accessibilityLabel={`Marge für ${label} bearbeiten, aktuell ${fractionToPercentLabel(marginFraction)}`}
      >
        <View className="min-h-[44px] flex-row items-center gap-3 py-2">
          <View className="flex-1">
            <Text className="text-base font-medium" numberOfLines={1}>
              {label}
            </Text>
            <Text className="text-muted-foreground text-xs">Ankauf-Sicherheitsmarge</Text>
          </View>
          <Text className="font-mono-medium text-base">
            {fractionToPercentLabel(marginFraction)}
          </Text>
          <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} />
        </View>
      </PressableScale>
    )
  }

  return (
    <View className="gap-2 py-2">
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text className="text-base font-medium" numberOfLines={1}>
            {label}
          </Text>
          <Text className="text-muted-foreground text-xs">Marge in Prozent (0 bis 50)</Text>
        </View>
        <Input
          value={draft}
          onChangeText={(v) => {
            setDraft(v)
            if (fieldError) setFieldError(null)
          }}
          keyboardType="decimal-pad"
          autoFocus
          placeholder="z. B. 12"
          maxLength={5}
          editable={!save.isPending}
          aria-invalid={!!fieldError}
          style={[
            { width: 96, textAlign: "right" },
            fieldError ? { borderColor: t.colors.destructive } : undefined,
          ]}
        />
      </View>

      {fieldError ? (
        <Text className="text-xs" style={{ color: t.colors.destructive }}>
          {fieldError}
        </Text>
      ) : null}

      {save.error ? <InlineError message={save.error} /> : null}

      <View className="flex-row gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={save.isPending}
          onPress={() => {
            haptics.selection()
            setEditing(false)
            setFieldError(null)
            save.reset()
          }}
          accessibilityLabel="Abbrechen"
        >
          <X size={t.icon.sm} color={t.colors.foreground} />
          <Text>Abbrechen</Text>
        </Button>
        <Button
          className="flex-1"
          disabled={save.isPending}
          onPress={() => void commit()}
          accessibilityLabel={`Marge für ${label} speichern`}
        >
          <Check size={t.icon.sm} color={t.colors.primaryForeground} />
          <Text>{save.isPending ? "Speichern…" : "Speichern"}</Text>
        </Button>
      </View>
    </View>
  )
}

/** A 1px hairline divider between rows in a section (the only divider weight). */
function RowDivider() {
  const t = useW14Theme()
  return <View style={{ height: 1, backgroundColor: t.colors.border }} />
}

function MarginsSection() {
  const t = useW14Theme()

  // Live margins from the rates endpoint — the real safetyMarginPct in effect.
  const q = useQuery(() => metalPricesApi.rates(apiClient), { key: "settings:margins" })

  const refetch = useCallback(() => void q.refetch(), [q])

  return (
    <SectionCard
      title="Ankauf-Margen"
      subtitle="Ankaufkurs = 10-Tage-Schnitt × (1 − Marge). Pro Metall oder global."
      icon={Coins}
    >
      {q.isLoading && q.data == null ? (
        <View className="gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} className="flex-row items-center gap-3 py-1">
              <View className="flex-1 gap-2">
                <Skeleton width="40%" height={15} />
                <Skeleton width="55%" height={12} />
              </View>
              <Skeleton width={56} height={16} />
            </View>
          ))}
        </View>
      ) : q.error != null && q.data == null ? (
        <InlineError message={q.error} onRetry={refetch} />
      ) : q.data != null ? (
        <View>
          {/* Global default margin first, then each metal in canonical order. */}
          <MarginRow
            metal={null}
            label="Standard (global)"
            marginFraction={q.data.safetyMarginPct}
            onSaved={refetch}
          />
          {q.data.rates.map((rate: MetalRate) => (
            <View key={rate.metal}>
              <RowDivider />
              <MarginRow
                metal={rate.metal}
                label={METAL_LABEL[rate.metal]}
                marginFraction={rate.safetyMarginPct}
                onSaved={refetch}
              />
            </View>
          ))}
          <Text
            className="text-muted-foreground mt-1 pt-2 text-2xs"
            style={{ borderTopWidth: 1, borderColor: t.colors.border }}
          >
            Fenster: {q.data.windowDays}-Tage-Durchschnitt. Änderungen sind PIN-bestätigt und werden
            protokolliert.
          </Text>
        </View>
      ) : null}
    </SectionCard>
  )
}

// ── Dashboard-Ziele ─────────────────────────────────────────────────────────--

/** One editable EUR goal, persisted to the preferences store on each valid save. */
function TargetRow({
  label,
  hint,
  value,
  onCommit,
  last,
}: {
  label: string
  hint: string
  value: number
  onCommit: (eur: number) => void
  last?: boolean
}) {
  const t = useW14Theme()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)

  const begin = useCallback(() => {
    haptics.selection()
    setError(null)
    setDraft(String(value))
    setEditing(true)
  }, [value])

  const commit = useCallback(() => {
    const eur = parseEur(draft)
    if (eur == null) {
      haptics.error()
      setError("Bitte einen Betrag größer als 0 eingeben.")
      return
    }
    haptics.success()
    onCommit(eur)
    setEditing(false)
    setError(null)
  }, [draft, onCommit])

  return (
    <View>
      {editing ? (
        <View className="gap-2 py-2">
          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-base font-medium" numberOfLines={1}>
                {label}
              </Text>
              <Text className="text-muted-foreground text-xs">In Euro</Text>
            </View>
            <Input
              value={draft}
              onChangeText={(v) => {
                setDraft(v)
                if (error) setError(null)
              }}
              keyboardType="number-pad"
              autoFocus
              placeholder="0"
              maxLength={12}
              aria-invalid={!!error}
              style={[
                { width: 128, textAlign: "right" },
                error ? { borderColor: t.colors.destructive } : undefined,
              ]}
            />
          </View>
          {error ? (
            <Text className="text-xs" style={{ color: t.colors.destructive }}>
              {error}
            </Text>
          ) : null}
          <View className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onPress={() => {
                haptics.selection()
                setEditing(false)
                setError(null)
              }}
              accessibilityLabel="Abbrechen"
            >
              <Text>Abbrechen</Text>
            </Button>
            <Button className="flex-1" onPress={commit} accessibilityLabel={`${label} speichern`}>
              <Text>Speichern</Text>
            </Button>
          </View>
        </View>
      ) : (
        <PressableScale
          onPress={begin}
          accessibilityRole="button"
          accessibilityLabel={`${label} bearbeiten, aktuell ${formatDe(value)} Euro`}
        >
          <View className="min-h-[44px] flex-row items-center gap-3 py-2">
            <View className="flex-1">
              <Text className="text-base font-medium" numberOfLines={1}>
                {label}
              </Text>
              <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                {hint}
              </Text>
            </View>
            <Text className="font-mono-medium text-base">{formatDe(value)} €</Text>
            <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} />
          </View>
        </PressableScale>
      )}
      {last ? null : <RowDivider />}
    </View>
  )
}

function TargetsSection() {
  const targets = useDashboardTargets()
  const isDefault = useMemo(
    () =>
      (Object.keys(DEFAULT_DASHBOARD_TARGETS) as (keyof DashboardTargets)[]).every(
        (k) => targets[k] === DEFAULT_DASHBOARD_TARGETS[k],
      ),
    [targets],
  )

  const set = useCallback((patch: Partial<DashboardTargets>) => setDashboardTargets(patch), [])

  return (
    <SectionCard
      title="Dashboard-Ziele"
      subtitle="Die Zielwerte hinter den Ringen auf der Schatzkammer."
      icon={Target}
      action={
        isDefault ? undefined : (
          <PressableScale
            onPress={() => {
              haptics.selection()
              resetDashboardTargets()
            }}
            accessibilityRole="button"
            accessibilityLabel="Ziele auf Standard zurücksetzen"
            hitSlop={8}
          >
            <Text className="text-primary text-xs font-medium">Zurücksetzen</Text>
          </PressableScale>
        )
      }
    >
      <TargetRow
        label="Tagesumsatz"
        hint="Ziel für den Umsatz-Ring (heute)"
        value={targets.revenueEur}
        onCommit={(eur) => set({ revenueEur: eur })}
      />
      <TargetRow
        label="Tagesgewinn"
        hint="Ziel für den Gewinn-Ring (heute)"
        value={targets.netProfitDayEur}
        onCommit={(eur) => set({ netProfitDayEur: eur })}
      />
      <TargetRow
        label="Monatsumsatz"
        hint="Ziel für den Monatsumsatz-Ring"
        value={targets.monthRevenueEur}
        onCommit={(eur) => set({ monthRevenueEur: eur })}
      />
      <TargetRow
        label="Monatsgewinn"
        hint="Die Truhe am Ende der Schatzkarte"
        value={targets.monthlyProfitTargetEur}
        onCommit={(eur) => set({ monthlyProfitTargetEur: eur })}
        last
      />
    </SectionCard>
  )
}

// ── Gerät & Sitzung ─────────────────────────────────────────────────────────--

/**
 * The honest role line for the signed-in account. The role comes from the
 * canonical text spine (`ACTOR_ROLE_LABEL`) — never a developer token — and an
 * „· Inhaber"-Zusatz is appended only when the session's real `isOwner` flag is
 * set, so the marker reflects truth rather than being baked into a label.
 */
function roleFactLabel(actor: { role: ActorRole; isOwner: boolean } | null): string {
  if (actor == null) return "–"
  const label = ACTOR_ROLE_LABEL[actor.role]
  return actor.isOwner ? `${label} · Inhaber` : label
}

/** A read-only fact row: label on the left, a value on the right (mono optional). */
function FactRow({
  label,
  value,
  mono,
  last,
}: {
  label: string
  value: string
  mono?: boolean
  last?: boolean
}) {
  return (
    <View>
      <View className="min-h-[40px] flex-row items-center gap-3 py-2">
        <Text className="text-muted-foreground flex-1 text-sm">{label}</Text>
        <Text
          className={mono ? "font-mono text-xs" : "text-sm font-medium"}
          numberOfLines={1}
          style={{ maxWidth: "62%" }}
        >
          {value}
        </Text>
      </View>
      {last ? null : <RowDivider />}
    </View>
  )
}

function DeviceSection() {
  const { actor, expiresAt } = useSession()

  const expiryLabel = useMemo(() => {
    if (!expiresAt) return "—"
    const d = new Date(expiresAt)
    if (Number.isNaN(d.getTime())) return "—"
    return d.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }, [expiresAt])

  // Show only the first segment of the dev fingerprint — enough to identify it,
  // not the whole secret on a shoulder-surfable screen.
  const fingerprintShort = `${DEV_DEVICE_FINGERPRINT.slice(0, 12)}…`
  const apiHost = API_BASE_URL.replace(/^https?:\/\//, "")

  return (
    <SectionCard
      title="Gerät & Sitzung"
      subtitle="Angemeldetes Konto und das verbundene Backend."
      icon={Smartphone}
    >
      <FactRow label="Rolle" value={roleFactLabel(actor)} />
      <FactRow label="Sitzung läuft ab" value={expiryLabel} mono />
      <FactRow label="Geräte-Fingerprint" value={fingerprintShort} mono />
      <FactRow label="API-Server" value={apiHost} mono last />
    </SectionCard>
  )
}

// ── Darstellung ─────────────────────────────────────────────────────────────--

function AppearanceSection() {
  const t = useW14Theme()
  const scheme = useColorScheme()
  const reduceMotion = useReducedMotion()

  const isDark = scheme === "dark"
  const SchemeIcon = isDark ? Moon : SunMedium

  const openSystemSettings = useCallback(() => {
    haptics.selection()
    // RN's Linking.openSettings() opens THIS app's settings page on both
    // platforms; it is the honest place to change appearance / reduce motion.
    void Linking.openSettings().catch(() => {})
  }, [])

  return (
    <SectionCard
      title="Darstellung"
      subtitle="Folgt den Systemeinstellungen deines Geräts."
      icon={Settings2}
    >
      <View className="min-h-[40px] flex-row items-center gap-3 py-2">
        <View
          className="h-8 w-8 items-center justify-center rounded-md"
          style={{ backgroundColor: t.colors.primary + "1f" }}
        >
          <SchemeIcon size={t.icon.md} color={t.colors.primary} />
        </View>
        <Text className="text-muted-foreground flex-1 text-sm">Erscheinungsbild</Text>
        <Text className="text-sm font-medium">{isDark ? "Dunkel" : "Hell"}</Text>
      </View>
      <RowDivider />
      <View className="min-h-[40px] flex-row items-center gap-3 py-2">
        <View
          className="h-8 w-8 items-center justify-center rounded-md"
          style={{ backgroundColor: t.colors.primary + "1f" }}
        >
          <Sparkles size={t.icon.md} color={t.colors.primary} />
        </View>
        <Text className="text-muted-foreground flex-1 text-sm">Bewegung reduzieren</Text>
        <Text className="text-sm font-medium">{reduceMotion ? "An" : "Aus"}</Text>
      </View>
      <RowDivider />
      <PressableScale
        onPress={openSystemSettings}
        accessibilityRole="button"
        accessibilityLabel="Systemeinstellungen öffnen"
      >
        <View className="min-h-[44px] flex-row items-center gap-3 py-2">
          <Text className="text-primary flex-1 text-sm font-medium">
            Systemeinstellungen öffnen
          </Text>
          <ChevronRight size={t.icon.md} color={t.colors.primary} />
        </View>
      </PressableScale>
      <Text
        className="text-muted-foreground mt-1 pt-2 text-2xs"
        style={{ borderTopWidth: 1, borderColor: t.colors.border }}
      >
        {"Hell/Dunkel und Bewegung reduzieren steuerst du im System; die App folgt dieser " +
          "Wahl. Eine separate App-Umschaltung gibt es bewusst nicht."}
      </Text>
    </SectionCard>
  )
}

// ── Abmelden ────────────────────────────────────────────────────────────────--

function LogoutSection() {
  const t = useW14Theme()
  const [confirming, setConfirming] = useState(false)

  const logout = useCallback(() => {
    haptics.success()
    // Wipe the last-good read cache FIRST (memory + persisted snapshots), so the
    // next actor to sign in never briefly sees the previous actor's cached
    // finance figures — the honesty rule across sign-ins. Reads only ever; no
    // fiscal/money record lives in this cache.
    clearCachedRead()
    // Clearing the in-memory session flips useSession().isAuthenticated → the
    // root auth gate (useAuthRedirect) replaces the stack with /login.
    clearSession()
  }, [])

  if (!confirming) {
    return (
      <Button
        variant="outline"
        onPress={() => {
          haptics.selection()
          setConfirming(true)
        }}
        accessibilityLabel="Abmelden"
        style={{ borderColor: t.colors.destructive }}
      >
        <LogOut size={t.icon.sm} color={t.colors.destructive} />
        <Text style={{ color: t.colors.destructive }}>Abmelden</Text>
      </Button>
    )
  }

  return (
    <Card className="gap-3 px-4 py-4" style={{ borderColor: t.colors.destructive }}>
      <Text className="text-base font-semibold" style={{ color: t.colors.destructive }}>
        Wirklich abmelden?
      </Text>
      <Text className="text-muted-foreground text-sm">
        Du musst dich danach erneut mit deiner PIN anmelden.
      </Text>
      <View className="flex-row gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onPress={() => {
            haptics.selection()
            setConfirming(false)
          }}
          accessibilityLabel="Doch angemeldet bleiben"
        >
          <Text>Abbrechen</Text>
        </Button>
        <Button
          variant="destructive"
          className="flex-1"
          onPress={logout}
          accessibilityLabel="Jetzt abmelden"
        >
          <Text>Abmelden</Text>
        </Button>
      </View>
    </Card>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function EinstellungenScreen() {
  const t = useW14Theme()

  // A single running index so the whole column settles top-to-bottom as one
  // motion (DESIGN.md §6), capped so it never feels slow.
  const sections = [
    <MarginsSection key="margins" />,
    <SettingsBelegtextSection key="belegtext" />,
    <SettingsCategoriesSection key="categories" />,
    <TargetsSection key="targets" />,
    <DeviceSection key="device" />,
    <AppearanceSection key="appearance" />,
    <LogoutSection key="logout" />,
  ]

  return (
    <KeyboardAvoidingScreen
      contentPadding={t.space.x4}
      contentContainerStyle={{ gap: t.space.x4 }}
      scrollViewProps={{ showsVerticalScrollIndicator: false }}
    >
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Gauge size={t.icon.lg} color={t.colors.primary} />
          {/* Bildschirmtitel in der Bricolage-Display-Stimme (DESIGN-SYSTEM.md §3). */}
          <Text className="text-2xl font-display-semibold leading-tight">Einstellungen</Text>
        </View>
        <Text className="text-muted-foreground text-sm">
          Margen, Belegtexte, Sammlungen, Ziele und Gerät an einem Ort.
        </Text>
      </View>

      {sections.map((node, i) => (
        <StaggerItem key={node.key} index={Math.min(i, 6)} exit={false}>
          {node}
        </StaggerItem>
      ))}

      <Text className="text-muted-foreground pt-1 text-center text-2xs">
        Warehouse14 Owner · v1.0.0
      </Text>
    </KeyboardAvoidingScreen>
  )
}
