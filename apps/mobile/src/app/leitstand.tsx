/**
 * Leitstand — der Kontrollraum des Inhabers auf dem Telefon.
 *
 * Eine ruhige Fläche, die die Frage „läuft alles?" beantwortet — das mobile
 * Gegenstück zum Desktop-Leitstand, aus denselben echten Quellen:
 *   • GET /api/risk/overview   — Warnsignale + Kunden-Beobachtungsliste (live),
 *   • GET /api/risk/edge       — Cloudflare Edge-Schutz (env-gated, ehrlich),
 *   • GET /api/system/health   — Systemzustand (Inhaber). Der Endpunkt kommt
 *     mit dem nächsten Server-Update; ein älterer Server liefert 404 und die
 *     Fläche sagt das GENAU SO — nie ein roter Fehler für einen bekannten Stand.
 *
 * Form (DESIGN-SYSTEM.md): keine Kästen in Kästen. Ein Urteils-Kopf mit
 * Ton-Punkt, die Subsysteme als nackte Zeilen mit Haarlinien, die Warnarten als
 * proportionale TopN-Reihen, die Beobachtungsliste als boxlose Mono-Reihe, der
 * Edge-Schutz mit einer ehrlichen „nicht verbunden"-Zeile solange der
 * Cloudflare-Schlüssel fehlt. Tiefe aus dem Papier, nie aus Dekor.
 *
 * EHRLICHKEIT: jede Zahl kommt vom Server; ein nicht konfigurierter oder noch
 * nicht ausgerollter Teil wird benannt statt erfunden. Länder-Codes werden über
 * eine kleine feste Karte eingedeutscht (Hermes hat kein Intl.DisplayNames) und
 * fallen sonst ehrlich auf den Code zurück.
 */
import { type ReactNode } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import { ShieldCheck } from "lucide-react-native"

import { Text } from "@/components/ui/text"
import {
  riskEdge,
  riskOverview,
  systemHealthSafe,
  type RiskEdge,
  type RiskOverview,
  type SystemHealth,
} from "@/warehouse14/api"
import { useW14Theme } from "@/warehouse14/theme"
import {
  ErrorState,
  Hairline,
  PaperGrain,
  SectionCard,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"
import { TopNList } from "@/warehouse14/ui/charts"
import { useMultiQuery } from "@/warehouse14/ui/data/useMultiQuery"

// ── Vokabular ────────────────────────────────────────────────────────────────

/** Deutsche Namen der Warnarten (Spiegel des Desktop-Leitstands). */
const ALERT_DE: Record<string, string> = {
  "alert.suspicious_aml_flagged": "Geldwäsche-Verdacht",
  "alert.smurfing_detected": "Strukturierung erkannt",
  "alert.anomaly_detected": "Auffälliges Muster",
  "alert.customer_marked_suspicious": "Kunde als verdächtig markiert",
  "alert.customer_banned": "Kunde gesperrt",
  "alert.ebay_sale_conflict": "eBay-Verkaufskonflikt",
  "alert.ebay_double_sale_attempt": "eBay-Doppelverkauf",
  "alert.hash_chain_verification_failed": "Prüfsummenkette fehlerhaft",
  "alert.worker_job_dead_letter": "Hintergrundjob fehlgeschlagen",
  "alert.tse_cert_expiry": "TSE-Zertifikat läuft ab",
  "alert.tse_critical_failure": "TSE: kritischer Fehler",
  "alert.duress": "Notfall-Anmeldung",
}

function alertLabel(eventType: string): string {
  const known = ALERT_DE[eventType]
  if (known) return known
  return eventType
    .replace(/^alert\./, "")
    .split(/[_.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

/** Kleine feste Länderkarte (Hermes: kein Intl.DisplayNames). Ehrlicher
 *  Rückfall: der rohe Code. */
const LAND_DE: Record<string, string> = {
  DE: "Deutschland",
  AT: "Österreich",
  CH: "Schweiz",
  US: "USA",
  GB: "Großbritannien",
  FR: "Frankreich",
  NL: "Niederlande",
  PL: "Polen",
  IT: "Italien",
  ES: "Spanien",
  TR: "Türkei",
  UA: "Ukraine",
  RU: "Russland",
  CN: "China",
  IN: "Indien",
  BR: "Brasilien",
  SG: "Singapur",
  HK: "Hongkong",
  T1: "Tor-Netzwerk",
}

function landName(code: string): string {
  return LAND_DE[code] ?? code
}

const VERDICT_DE: Record<SystemHealth["status"], string> = {
  ok: "Alles in Ordnung",
  watch: "Achtung erforderlich",
  alert: "Störung",
}

function timeLabel(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(t))
}

const de0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 })

// ── Kleine Bausteine (boxlos, direkt auf dem Papier) ─────────────────────────

type Tone = "ok" | "watch" | "alert"

function ToneDot({ tone, size = 10 }: { tone: Tone | "info"; size?: number }): ReactNode {
  const t = useW14Theme()
  const color =
    tone === "ok"
      ? t.colors.verdigris
      : tone === "watch"
        ? t.colors.terra
        : tone === "alert"
          ? t.colors.destructive
          : t.colors.mutedForeground
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }}
      accessibilityElementsHidden
    />
  )
}

/** Eine nackte Subsystem-Zeile: Punkt · Name · Wert. */
function StatusRow({
  tone,
  label,
  value,
  sub,
}: {
  tone: Tone
  label: string
  value: string
  sub?: string | null
}): ReactNode {
  return (
    <View className="flex-row items-start gap-3 py-2.5">
      <View className="pt-1.5">
        <ToneDot tone={tone} />
      </View>
      <View className="flex-1">
        <Text className="text-foreground text-base font-medium">{label}</Text>
        {sub ? <Text className="text-muted-foreground mt-0.5 text-xs">{sub}</Text> : null}
      </View>
      <Text className="text-foreground font-mono text-sm" style={{ marginTop: 2 }}>
        {value}
      </Text>
    </View>
  )
}

/** Boxlose Mono-Reihe der Beobachtungsliste (Verdächtig · Gesperrt · …). */
function WatchFigure({ label, value, tone }: { label: string; value: number; tone: Tone }): ReactNode {
  return (
    <View className="flex-1 items-center gap-1">
      <Text className="text-foreground font-mono text-xl">{de0.format(value)}</Text>
      <View className="flex-row items-center gap-1.5">
        <ToneDot tone={tone} size={7} />
        <Text className="text-muted-foreground text-xs">{label}</Text>
      </View>
    </View>
  )
}

// ── Fläche ───────────────────────────────────────────────────────────────────

export default function LeitstandScreen(): ReactNode {
  const insets = useScreenInsets()

  const q = useMultiQuery(
    {
      overview: riskOverview,
      edge: riskEdge,
      health: systemHealthSafe,
    },
    { key: "leitstand", pollIntervalMs: 60_000 },
  )
  const rc = useRefreshControl(q)

  const overview = q.results.overview.data as RiskOverview | null
  const edge = q.results.edge.data as RiskEdge | null
  const health = q.results.health.data as SystemHealth | null
  const healthSettled = q.results.health.isSettled

  const alertRows = overview
    ? Object.entries(overview.alertCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([type, n]) => ({ label: alertLabel(type), value: n }))
    : []

  const countryRows =
    edge && edge.configured && edge.available
      ? edge.byCountry.map((c) => ({ label: landName(c.country), value: c.threats }))
      : []

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
        {q.allFailed ? (
          <ErrorState
            message={q.results.overview.error}
            cause={q.results.overview.errorCause}
            onRetry={() => void q.refetch()}
            retrying={q.isFetching}
          />
        ) : (
          <>
            {/* ── Systemzustand ─────────────────────────────────────────── */}
            <SectionCard title="Systemzustand" icon={ShieldCheck}>
              {health ? (
                <View>
                  <View className="flex-row items-center gap-3 pb-1">
                    <ToneDot tone={health.status} size={14} />
                    <Text className="text-foreground font-display-semibold text-2xl">
                      {VERDICT_DE[health.status]}
                    </Text>
                  </View>
                  <Text className="text-muted-foreground pb-2 text-xs">
                    Stand {timeLabel(health.computedAt) ?? "gerade eben"}
                    {health.problems.length > 0
                      ? ` · ${health.problems.length} ${health.problems.length === 1 ? "offener Punkt" : "offene Punkte"}`
                      : " · keine offenen Punkte"}
                  </Text>
                  <Hairline />
                  <StatusRow
                    tone={health.components.api.status}
                    label="Server"
                    value="erreichbar"
                  />
                  <StatusRow
                    tone={health.components.database.status}
                    label="Datenbank"
                    value={
                      health.components.database.migrationsApplied === null
                        ? "unbekannt"
                        : `Stand ${String(health.components.database.migrationsApplied)}`
                    }
                  />
                  <StatusRow
                    tone={health.components.worker.status}
                    label="Hintergrund-Jobs"
                    value={
                      health.components.worker.deadLetter > 0
                        ? `${de0.format(health.components.worker.deadLetter)} offen`
                        : "läuft"
                    }
                    sub={
                      health.components.worker.chainLastVerifiedAt
                        ? `Prüfsummenkette ${timeLabel(health.components.worker.chainLastVerifiedAt) ?? ""}`
                        : null
                    }
                  />
                  <StatusRow
                    tone={health.components.fiscal.status}
                    label="Fiskal · TSE"
                    value={
                      health.components.fiscal.tseCertDaysRemaining === null
                        ? "keine TSE"
                        : `${de0.format(health.components.fiscal.tseCertDaysRemaining)} Tage`
                    }
                  />
                  <StatusRow
                    tone={health.components.alerts.status}
                    label="Warnsignale"
                    value={`${de0.format(health.components.alerts.last24h)} · 24 h`}
                    sub={`${de0.format(health.components.alerts.last7d)} in 7 Tagen`}
                  />
                  {health.problems.length > 0 ? (
                    <View className="pt-1">
                      <Hairline />
                      {health.problems.map((p) => (
                        <View key={p.id} className="flex-row items-start gap-3 py-2.5">
                          <View className="pt-1.5">
                            <ToneDot tone={p.severity} />
                          </View>
                          <View className="flex-1">
                            <Text className="text-foreground text-base font-medium">{p.title}</Text>
                            <Text className="text-muted-foreground mt-0.5 text-xs">{p.detail}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : healthSettled ? (
                <View className="flex-row items-center gap-3 py-1">
                  <ToneDot tone="info" />
                  <Text className="text-muted-foreground flex-1 text-sm">
                    Der Systemzustand erscheint mit dem nächsten Server-Update. Warnsignale und
                    Beobachtungsliste unten sind bereits live.
                  </Text>
                </View>
              ) : (
                <Text className="text-muted-foreground py-1 text-sm">Lädt …</Text>
              )}
            </SectionCard>

            {/* ── Risiko ────────────────────────────────────────────────── */}
            <SectionCard title="Risiko & Beobachtung">
              {overview ? (
                <View>
                  <View className="flex-row py-2">
                    <WatchFigure
                      label="Verdächtig"
                      value={overview.watchlist.suspicious}
                      tone="watch"
                    />
                    <WatchFigure label="Gesperrt" value={overview.watchlist.banned} tone="alert" />
                    <WatchFigure
                      label="Sanktionen"
                      value={overview.watchlist.sanctions}
                      tone="alert"
                    />
                    <WatchFigure label="PEP" value={overview.watchlist.pep} tone="watch" />
                  </View>
                  <Hairline />
                  {alertRows.length === 0 ? (
                    <View className="flex-row items-center gap-3 py-3">
                      <ToneDot tone="ok" />
                      <Text className="text-muted-foreground text-sm">
                        Keine Warnungen in den letzten {overview.windowDays} Tagen. Alles ruhig.
                      </Text>
                    </View>
                  ) : (
                    <View className="pt-2">
                      <Text className="text-muted-foreground pb-1 text-xs">
                        Warnungen nach Art · {de0.format(overview.totalAlerts)} in{" "}
                        {overview.windowDays} Tagen
                      </Text>
                      <TopNList
                        data={alertRows}
                        formatValue={(v) => de0.format(v)}
                        limit={6}
                        tone="primary"
                      />
                    </View>
                  )}
                  {overview.recentAlerts.length > 0 ? (
                    <View className="pt-2">
                      <Hairline />
                      {overview.recentAlerts.slice(0, 5).map((a) => (
                        <View key={a.id} className="flex-row items-center gap-3 py-2">
                          <ToneDot tone="watch" size={7} />
                          <Text className="text-foreground flex-1 text-sm">
                            {alertLabel(a.eventType)}
                          </Text>
                          <Text className="text-muted-foreground font-mono text-xs">
                            {timeLabel(a.createdAt) ?? ""}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : q.results.overview.error ? (
                <Text className="text-muted-foreground py-1 text-sm">
                  {q.results.overview.error}
                </Text>
              ) : (
                <Text className="text-muted-foreground py-1 text-sm">Lädt …</Text>
              )}
            </SectionCard>

            {/* ── Edge-Schutz ───────────────────────────────────────────── */}
            <SectionCard title="Edge-Schutz · Cloudflare">
              {edge == null ? (
                q.results.edge.error ? (
                  <Text className="text-muted-foreground py-1 text-sm">{q.results.edge.error}</Text>
                ) : (
                  <Text className="text-muted-foreground py-1 text-sm">Lädt …</Text>
                )
              ) : !edge.configured ? (
                <View className="flex-row items-center gap-3 py-1">
                  <ToneDot tone="info" />
                  <Text className="text-muted-foreground flex-1 text-sm">
                    Cloudflare ist noch nicht verbunden. Sobald der Analyse-Schlüssel hinterlegt
                    ist, stehen hier die abgewehrten Angriffe.
                  </Text>
                </View>
              ) : !edge.available ? (
                <View className="flex-row items-center gap-3 py-1">
                  <ToneDot tone="watch" />
                  <Text className="text-muted-foreground flex-1 text-sm">
                    Cloudflare-Daten derzeit nicht abrufbar.
                  </Text>
                </View>
              ) : (
                <View>
                  <View className="flex-row items-baseline gap-2 pb-1">
                    <Text className="text-foreground font-mono text-2xl">
                      {de0.format(edge.totalThreats)}
                    </Text>
                    <Text className="text-muted-foreground text-xs">
                      abgewehrte Bedrohungen · {edge.windowDays} Tage ·{" "}
                      {de0.format(edge.totalRequests)} Anfragen
                    </Text>
                  </View>
                  {countryRows.length === 0 ? (
                    <View className="flex-row items-center gap-3 py-2">
                      <ToneDot tone="ok" />
                      <Text className="text-muted-foreground text-sm">
                        Keine Bedrohung im Zeitraum. Ruhig an der Grenze.
                      </Text>
                    </View>
                  ) : (
                    <TopNList
                      data={countryRows}
                      formatValue={(v) => de0.format(v)}
                      limit={5}
                      tone="primary"
                    />
                  )}
                </View>
              )}
            </SectionCard>
          </>
        )}
      </ScrollView>
    </View>
  )
}
