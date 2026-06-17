/**
 * P0 — PIN login. authPin.login resolves the user from the seeded dev device
 * (X-Dev-Device-Fingerprint header) + the PIN; no email. The session token is
 * stored and carried as Bearer on every later request.
 */
import { useState } from "react"
import { View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { API_BASE_URL, describeError, pinLogin } from "@/warehouse14/api"
import { setSession } from "@/warehouse14/session"

export default function LoginScreen() {
  const insets = useSafeAreaInsets()
  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await pinLogin(pin)
      setSession({ token: res.token, actor: res.actor, expiresAt: res.sessionExpiresAt })
      // The root auth gate redirects to the tab shell once the session lands.
    } catch (e) {
      setError(describeError(e))
      setPin("")
    } finally {
      setBusy(false)
    }
  }

  return (
    <View
      className="flex-1 justify-center bg-background px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      <View className="mb-8 gap-1">
        <Text className="text-3xl font-bold text-foreground">Warehouse14</Text>
        <Text className="text-muted-foreground">Mit PIN anmelden</Text>
      </View>

      <Input
        value={pin}
        onChangeText={(t) => {
          setPin(t)
          setError(null)
        }}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={4}
        placeholder="••••"
        autoFocus
        className="h-14 text-center text-2xl tracking-[12px]"
        onSubmitEditing={() => {
          if (pin.length === 4) void submit()
        }}
      />

      {error ? <Text className="mt-3 text-sm text-destructive">{error}</Text> : null}

      <Button
        size="lg"
        className="mt-6 h-12"
        onPress={() => void submit()}
        disabled={pin.length < 4 || busy}
      >
        <Text>{busy ? "Anmelden…" : "Anmelden"}</Text>
      </Button>

      <Text className="mt-6 text-xs text-muted-foreground">
        Dev-Backend · {API_BASE_URL}
        {"\n"}Owner basel@warehouse14.local · PIN 0000
      </Text>
    </View>
  )
}
