/**
 * StepUpDialogHost — mounted once at the app root. Subscribes to the step-up
 * bridge; whenever a sensitive action 403s with STEP_UP_REQUIRED the api-client
 * middleware opens this native RNR Dialog. On a correct PIN it calls
 * authPin.stepUp (refreshing the session window) and lets the middleware replay
 * the original request. Build-once: every surface reuses it.
 */
import { useEffect, useState, useSyncExternalStore } from "react"
import { ApiError } from "@warehouse14/api-client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { describeError, pinStepUp } from "@/warehouse14/api"
import {
  cancelStepUp,
  completeStepUp,
  getPendingStepUp,
  subscribeStepUp,
} from "@/warehouse14/step-up"

export function StepUpDialogHost() {
  const pending = useSyncExternalStore(subscribeStepUp, getPendingStepUp, getPendingStepUp)
  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const open = pending != null

  useEffect(() => {
    if (open) {
      setPin("")
      setError(null)
    }
  }, [open])

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await pinStepUp(pin)
      completeStepUp()
    } catch (e) {
      setError(describeError(e))
      // A terminal lockout can't be retried — propagate so the action aborts.
      if (e instanceof ApiError && e.code === "PIN_LOCKED") cancelStepUp(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) cancelStepUp()
      }}
    >
      <DialogContent className="gap-4">
        <DialogHeader>
          <DialogTitle>PIN bestätigen</DialogTitle>
          <DialogDescription>
            Diese Aktion ist abgesichert und erfordert deine PIN.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={pin}
          onChangeText={setPin}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          placeholder="••••"
          autoFocus
          className="text-center tracking-[8px]"
        />
        {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
        <DialogFooter className="gap-2">
          <Button variant="outline" onPress={() => cancelStepUp()} disabled={busy}>
            <Text>Abbrechen</Text>
          </Button>
          <Button onPress={submit} disabled={pin.length < 4 || busy}>
            <Text>Bestätigen</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
