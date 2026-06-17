/**
 * Customer detail — personal data + KYC (GwG) status + trust + sanctions, via
 * customersApi.get. Actions: "Ausweis erfassen" (the keystone capture →
 * addKycDocument on the SERVER KYC store), "KYC bestätigen" (stampKyc), and a
 * trust-level changer (setTrust). Both PATCH actions are step-up gated — the
 * global StepUpDialogHost fires transparently and the middleware retries.
 * Mirrors the product detail screen.
 */
import { useCallback, useEffect, useState } from "react"
import { ScrollView, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import type { CustomerDetail, CustomerTrustLevel } from "@warehouse14/api-client"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import {
  describeError,
  formatEur,
  getCustomer,
  setCustomerTrust,
  stampCustomerKyc,
} from "@/warehouse14/api"
import {
  KYC_STATUS_LABEL,
  KYC_STATUS_VARIANT,
  TRUST_LEVEL_LABEL,
  TRUST_LEVEL_VARIANT,
} from "@/warehouse14/customer-ui"

const TRUST_OPTIONS: readonly CustomerTrustLevel[] = [
  "NEW",
  "VERIFIED",
  "VIP",
  "SUSPICIOUS",
  "BANNED",
]
/** Trust levels that require a price-expectation note (per the API contract). */
const TRUST_NEEDS_NOTE = new Set<CustomerTrustLevel>(["SUSPICIOUS", "BANNED"])

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-muted-foreground text-sm">{label}</Text>
      <Text className="flex-1 text-right text-sm font-medium" numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [customer, setCustomer] = useState<CustomerDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Trust editor state
  const [editingTrust, setEditingTrust] = useState(false)
  const [trustLevel, setTrustLevel] = useState<CustomerTrustLevel>("NEW")
  const [trustNotes, setTrustNotes] = useState("")

  const load = useCallback(async () => {
    if (!id) return
    setError(null)
    try {
      const c = await getCustomer(id)
      setCustomer(c)
      setTrustLevel(c.trustLevel)
    } catch (e) {
      setError(describeError(e))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  // Refetch on focus so a freshly captured Ausweis / stamp shows immediately.
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  async function confirmKyc() {
    if (!id) return
    setActionError(null)
    setOkMsg(null)
    setBusy(true)
    try {
      // 403 STEP_UP_REQUIRED → PIN Dialog opens + the call retries automatically.
      const res = await stampCustomerKyc(id, {})
      setOkMsg(`KYC bestätigt · ${new Date(res.kycVerifiedAt).toLocaleDateString("de-DE")}`)
      await load()
    } catch (e) {
      setActionError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  async function submitTrust() {
    if (!id) return
    setActionError(null)
    setOkMsg(null)
    if (TRUST_NEEDS_NOTE.has(trustLevel) && trustNotes.trim().length < 8) {
      setActionError("Für „Beobachten“/„Gesperrt“ ist eine Notiz (min. 8 Zeichen) erforderlich.")
      return
    }
    setBusy(true)
    try {
      await setCustomerTrust(id, {
        trustLevel,
        ...(TRUST_NEEDS_NOTE.has(trustLevel) ? { priceExpectationNotes: trustNotes.trim() } : {}),
      })
      setOkMsg(`Vertrauen gesetzt · ${TRUST_LEVEL_LABEL[trustLevel]}`)
      setEditingTrust(false)
      setTrustNotes("")
      await load()
    } catch (e) {
      setActionError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <Card className="gap-2 border-destructive px-4 py-4">
          <Text className="text-destructive text-base font-semibold">Fehler</Text>
          <Text className="text-muted-foreground text-sm">{error}</Text>
          <Button variant="outline" onPress={() => void load()}>
            <Text>Erneut laden</Text>
          </Button>
        </Card>
      </View>
    )
  }

  if (!customer) {
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <Text className="text-muted-foreground">Lade Kunde…</Text>
      </View>
    )
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
    >
      <View className="gap-1">
        <Text className="text-2xl font-bold" numberOfLines={2}>
          {customer.fullName}
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="font-mono text-xs text-muted-foreground">{customer.customerNumber}</Text>
          <Badge variant={KYC_STATUS_VARIANT[customer.kycStatus]}>
            <Text>{KYC_STATUS_LABEL[customer.kycStatus]}</Text>
          </Badge>
          <Badge variant={TRUST_LEVEL_VARIANT[customer.trustLevel]}>
            <Text>{TRUST_LEVEL_LABEL[customer.trustLevel]}</Text>
          </Badge>
          {customer.sanctionsMatch ? (
            <Badge variant="destructive">
              <Text>Sanktionstreffer</Text>
            </Badge>
          ) : null}
          {customer.pepMatch ? (
            <Badge variant="destructive">
              <Text>PEP</Text>
            </Badge>
          ) : null}
        </View>
      </View>

      <Card className="gap-2.5 px-4 py-4">
        <Row label="Geburtsdatum" value={customer.dateOfBirth ?? "—"} />
        <Row label="E-Mail" value={customer.email ?? "—"} />
        <Row label="Telefon" value={customer.phone ?? "—"} />
        <Row label="Adresse" value={customer.address ?? "—"} />
        <Row label="USt-IdNr." value={customer.vatId ?? "—"} />
      </Card>

      <Card className="gap-2.5 px-4 py-4">
        <Text className="text-base font-semibold">KYC + Bilanz</Text>
        <Row
          label="KYC bestätigt am"
          value={
            customer.kycVerifiedAt
              ? new Date(customer.kycVerifiedAt).toLocaleDateString("de-DE")
              : "—"
          }
        />
        <Row label="Ankauf kumuliert" value={formatEur(customer.cumulativeAnkaufEur)} />
        <Row label="Umsatz kumuliert" value={formatEur(customer.cumulativeSpendEur)} />
        <Row
          label={`Ankauf (${customer.gwgRollingAnkauf.windowDays} Tage)`}
          value={formatEur(customer.gwgRollingAnkauf.priorAnkaufEur)}
        />
      </Card>

      {okMsg ? (
        <Card className="gap-1 px-4 py-3" style={{ borderColor: "#157a4b" }}>
          <Text className="text-accent text-sm font-medium">{okMsg}</Text>
        </Card>
      ) : null}
      {actionError ? (
        <Card className="gap-1 border-destructive px-4 py-3">
          <Text className="text-destructive text-sm">{actionError}</Text>
        </Card>
      ) : null}

      {/* KYC actions */}
      <Card className="gap-3 px-4 py-4">
        <Text className="text-base font-semibold">KYC-Dokument</Text>
        <Text className="text-muted-foreground text-sm">
          Ausweis aufnehmen und serverseitig verschlüsselt ablegen (GwG/DSGVO).
        </Text>
        <Button
          onPress={() =>
            router.push({ pathname: "/kyc-capture", params: { customerId: customer.id } })
          }
        >
          <Text>Ausweis erfassen</Text>
        </Button>
        <Button variant="outline" onPress={() => void confirmKyc()} disabled={busy}>
          <Text>{busy ? "Bestätige…" : "KYC bestätigen"}</Text>
        </Button>
      </Card>

      {/* Trust changer */}
      {editingTrust ? (
        <Card className="gap-3 px-4 py-4">
          <Text className="text-base font-semibold">Vertrauensstufe</Text>
          <View className="flex-row flex-wrap gap-2">
            {TRUST_OPTIONS.map((level) => (
              <Button
                key={level}
                size="sm"
                variant={trustLevel === level ? "default" : "outline"}
                onPress={() => setTrustLevel(level)}
              >
                <Text>{TRUST_LEVEL_LABEL[level]}</Text>
              </Button>
            ))}
          </View>
          {TRUST_NEEDS_NOTE.has(trustLevel) ? (
            <Input
              value={trustNotes}
              onChangeText={setTrustNotes}
              placeholder="Begründung / Preiserwartung (min. 8 Zeichen)"
            />
          ) : null}
          <View className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onPress={() => {
                setEditingTrust(false)
                setTrustNotes("")
              }}
              disabled={busy}
            >
              <Text>Abbrechen</Text>
            </Button>
            <Button className="flex-1" onPress={() => void submitTrust()} disabled={busy}>
              <Text>{busy ? "Speichern…" : "Vertrauen setzen"}</Text>
            </Button>
          </View>
        </Card>
      ) : (
        <Button variant="outline" size="lg" className="h-12" onPress={() => setEditingTrust(true)}>
          <Text>Vertrauen ändern</Text>
        </Button>
      )}
    </ScrollView>
  )
}
