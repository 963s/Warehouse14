/**
 * Einstellungen — the System surface of the Owner OS. One calm, scannable column
 * of the few things an owner actually changes or checks, each section honest
 * about where its truth comes from. De-boxed (DESIGN-SYSTEM.md §9): the owner-
 * owned regions sit as BARE rows directly on the parchment canvas under an un-
 * carded SectionHeader, separated by the single warm hairline — no card box
 * around a card. Only the two genuinely interactive editor panels (Belegtexte,
 * Sammlungen) keep their SectionCard leaf, because each owns a stateful form.
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
 *   • Darstellung — honest reflection of the live appearance. The app is LIGHT
 *     ONLY (theme.ts) — there is no dark mode, so there is no Hell/Dunkel toggle
 *     to fake. We state the fixed parchment theme and the real reduced-motion
 *     state (read straight from useReducedMotion), nothing the app cannot honour.
 *
 *   • Abmelden — clears the in-memory session; the root auth gate then redirects
 *     to /login. A destructive, confirmed action (DESIGN.md §4 wax-red).
 *
 * Spine only (DESIGN.md): SectionHeader + bare rows + the single Hairline for
 * structure (no box-in-box), SectionCard kept only for the two stateful editor
 * panels, the §6 motion (screen-enter + a capped StaggerItem cascade,
 * PressableScale), §7 haptics (selection on a control, Success on a saved margin,
 * Error on a blocked save), InlineError for a non-blocking failure, the theme
 * tokens for every colour / radius / space / icon — no hardcoded hex. German
 * throughout; de-DE numbers. Reached from the Mehr-Hub (/einstellungen).
 */
import { useCallback, useMemo, useState } from "react"
import { View } from "react-native"
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
  LogOut,
  Smartphone,
  Sparkles,
  SunMedium,
  Target,
  X,
} from "lucide-react-native"
import { useReducedMotion } from "react-native-reanimated"
import Svg, { Circle, Path } from "react-native-svg"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import {
  API_BASE_URL,
  apiClient,
  DEV_DEVICE_FINGERPRINT,
  signOut,
  signOutAllDevices,
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
  Hairline,
  InlineError,
  KeyboardAvoidingScreen,
  PressableScale,
  SectionHeader,
  Skeleton,
  StaggerItem,
  haptics,
  useMutation,
  useQuery,
} from "@/warehouse14/ui"

// ── Bespoke header seal ───────────────────────────────────────────────────────

/**
 * A small wax-seal SVG for the screen header — a struck disc with an engraved
 * gear/cog notch ring, the System mark. Drawn with `currentColor` so it inherits
 * the ink text colour; the design law keeps gilt to the thread, so the seal is
 * ink with one faint gilt centre dot passed explicitly.
 */
function SystemSeal({ size, color, gilt }: { size: number; color: string; gilt: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.4} fill="none" />
      <Circle cx={12} cy={12} r={5.4} stroke={color} strokeWidth={1.2} fill="none" strokeOpacity={0.7} />
      {/* eight engraved notches around the rim — the cog read */}
      <Path
        d="M12 3 L12 5 M12 19 L12 21 M3 12 L5 12 M19 12 L21 12 M5.6 5.6 L7 7 M17 17 L18.4 18.4 M18.4 5.6 L17 7 M7 17 L5.6 18.4"
        stroke={color}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeOpacity={0.55}
      />
      {/* the gilt seal centre — the one gold accent (thread/seal only) */}
      <Circle cx={12} cy={12} r={1.6} fill={gilt} />
    </Svg>
  )
}

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

/** A fraction (0.12) → a de-DE percent label ("12 %"); null → a German marker. */
function fractionToPercentLabel(fraction: number | null | undefined): string {
  if (fraction == null || !Number.isFinite(fraction)) return "k. A."
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

/** The one divider weight: the shared warm hairline, inset under the row text. */
function RowDivider({ inset = 0 }: { inset?: number }) {
  return <Hairline inset={inset} />
}

function MarginsSection() {
  // Live margins from the rates endpoint — the real safetyMarginPct in effect.
  const q = useQuery(() => metalPricesApi.rates(apiClient), { key: "settings:margins" })

  const refetch = useCallback(() => void q.refetch(), [q])

  return (
    <View className="gap-3">
      <SectionHeader
        title="Ankauf-Margen"
        subtitle="Ankaufkurs = 10-Tage-Schnitt × (1 − Marge). Pro Metall oder global."
        icon={Coins}
      />
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
          <Text className="text-muted-foreground pt-3 text-2xs">
            Fenster: {q.data.windowDays}-Tage-Durchschnitt. Änderungen sind PIN-bestätigt und werden
            protokolliert.
          </Text>
        </View>
      ) : null}
    </View>
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
    <View className="gap-3">
      <SectionHeader
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
      />
      <View>
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
      </View>
    </View>
  )
}

// ── Gerät & Sitzung ─────────────────────────────────────────────────────────--

/**
 * The honest role line for the signed-in account. The role comes from the
 * canonical text spine (`ACTOR_ROLE_LABEL`), never a developer token, and a
 * mittiger-Punkt-Zusatz (· Inhaber) is appended only when the session's real
 * `isOwner` flag is set, so the marker reflects truth rather than a baked label.
 */
function roleFactLabel(actor: { role: ActorRole; isOwner: boolean } | null): string {
  if (actor == null) return "k. A."
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
    if (!expiresAt) return "k. A."
    const d = new Date(expiresAt)
    if (Number.isNaN(d.getTime())) return "k. A."
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
    <View className="gap-3">
      <SectionHeader
        title="Gerät & Sitzung"
        subtitle="Angemeldetes Konto und das verbundene Backend."
        icon={Smartphone}
      />
      <View>
        <FactRow label="Rolle" value={roleFactLabel(actor)} />
        <FactRow label="Sitzung läuft ab" value={expiryLabel} mono />
        <FactRow label="Geräte-Fingerprint" value={fingerprintShort} mono />
        <FactRow label="API-Server" value={apiHost} mono last />
      </View>
    </View>
  )
}

// ── Darstellung ─────────────────────────────────────────────────────────────--

/**
 * Darstellung — honest reflection only. The app is LIGHT ONLY (theme.ts: the
 * parchment palette everywhere, the system scheme deliberately ignored), so
 * there is no Hell/Dunkel/System choice to surface — offering one would imply an
 * override the app does not have. Instead two read rows: the fixed theme and the
 * live reduced-motion state. Each row carries a bare ink glyph, no tinted chip.
 */
function AppearanceSection() {
  const t = useW14Theme()
  const reduceMotion = useReducedMotion()

  return (
    <View className="gap-3">
      <SectionHeader
        title="Darstellung"
        subtitle="Das Erscheinungsbild der App. Fest auf hell eingestellt."
        icon={SunMedium}
      />
      <View>
        <View className="min-h-[44px] flex-row items-center gap-3 py-2">
          <View className="h-7 w-7 items-center justify-center">
            <SunMedium size={t.icon.md} color={t.colors.foreground} />
          </View>
          <View className="flex-1">
            <Text className="text-base font-medium">Erscheinungsbild</Text>
            <Text className="text-muted-foreground text-xs">Warmes Pergament, durchgehend hell</Text>
          </View>
          <Text className="text-sm font-medium">Hell</Text>
        </View>
        <RowDivider inset={40} />
        <View className="min-h-[44px] flex-row items-center gap-3 py-2">
          <View className="h-7 w-7 items-center justify-center">
            <Sparkles size={t.icon.md} color={t.colors.foreground} />
          </View>
          <View className="flex-1">
            <Text className="text-base font-medium">Bewegung reduzieren</Text>
            <Text className="text-muted-foreground text-xs">Folgt der Systemeinstellung</Text>
          </View>
          <Text className="text-sm font-medium">{reduceMotion ? "An" : "Aus"}</Text>
        </View>
      </View>
    </View>
  )
}

// ── Abmelden ────────────────────────────────────────────────────────────────--

function LogoutSection() {
  const t = useW14Theme()
  const [confirming, setConfirming] = useState(false)

  const wipeLocal = useCallback(() => {
    // Wipe the last-good read cache FIRST (memory + persisted snapshots), so the
    // next actor to sign in never briefly sees the previous actor's cached
    // finance figures — the honesty rule across sign-ins. Reads only ever; no
    // fiscal/money record lives in this cache.
    clearCachedRead()
    // Clearing the in-memory session flips useSession().isAuthenticated → the
    // root auth gate (useAuthRedirect) replaces the stack with /login.
    clearSession()
  }, [])

  const logout = useCallback(async () => {
    haptics.success()
    // Revoke the session on the SERVER first so a lost or stolen phone can never
    // replay the token after sign-out. Best-effort: if the call fails (offline /
    // flap) we still wipe locally below — logout must never hang or block.
    try {
      await signOut()
    } catch {
      // Local wipe proceeds regardless; the token lapses at its natural expiry.
    }
    wipeLocal()
  }, [wipeLocal])

  // Lost-device kill switch (security review 2026-07-21): revoke EVERY session
  // this owner has, on every device, then sign out here too. If a phone was lost
  // while unlocked, running this from any other device stops it on its next
  // request. Best-effort server call; the local wipe always proceeds.
  const logoutAll = useCallback(async () => {
    haptics.success()
    try {
      await signOutAllDevices()
    } catch {
      // Even if the call fails, wipe locally; the owner can retry from elsewhere.
    }
    wipeLocal()
  }, [wipeLocal])

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
        Du musst dich danach erneut mit Google anmelden.
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
      {/* Lost-device kill switch — revoke the session on ALL devices at once. */}
      <Button
        variant="outline"
        onPress={logoutAll}
        accessibilityLabel="Von allen Geräten abmelden"
        style={{ borderColor: t.colors.destructive }}
      >
        <LogOut size={t.icon.sm} color={t.colors.destructive} />
        <Text style={{ color: t.colors.destructive }}>Von allen Geräten abmelden</Text>
      </Button>
      <Text className="text-muted-foreground text-2xs">
        Nutze das, wenn ein Gerät verloren ging: es beendet die Sitzung auf allen Geräten sofort.
      </Text>
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
      <View className="gap-1.5">
        {/* Kicker — the gilt diamond ◆ + small-caps line (DESIGN-SYSTEM.md §6). */}
        <View className="flex-row items-center gap-2">
          <Text className="text-xs" style={{ color: t.colors.gilt }}>
            ◆
          </Text>
          <Text
            className="text-muted-foreground text-2xs font-semibold uppercase"
            style={{ letterSpacing: 1.4 }}
          >
            System
          </Text>
        </View>
        <View className="flex-row items-center gap-2.5">
          {/* Bespoke struck seal — ink body, one gilt centre (thread/seal only). */}
          <SystemSeal size={t.icon.xl} color={t.colors.foreground} gilt={t.colors.gilt} />
          {/* Bildschirmtitel in der Bricolage-Display-Stimme (DESIGN-SYSTEM.md §3). */}
          <Text className="text-3xl font-display-semibold leading-tight">Einstellungen</Text>
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
