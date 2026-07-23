/**
 * StepUpDialogHost — die Nachbestätigung vor einer empfindlichen Handlung.
 *
 * SIE VERLANGT DIE GERÄTESPERRE, also GENAU dasselbe, was beim Öffnen der App
 * verlangt wird: den Gerätecode oder, wenn das Telefon sie hat, die Biometrie.
 * Keine zweite Zahl, kein zweites Schloss.
 *
 * WARUM SIE UMGEBAUT WURDE (Basels Befund, 23.07.2026)
 * Die vierstellige Kassen-PIN ist am 21.07. abgeschafft worden. Trotzdem
 * fragte dieser Dialog weiter nach ihr, bei jedem Steuerexport, jedem Storno,
 * jedem Z-Bon, jeder Löschung. Man wurde nach einer Zahl gefragt, die es nicht
 * mehr geben soll — und wer keinen alten PIN-Abdruck trägt, was auf einen neu
 * angelegten Mitarbeiter zutrifft, hätte diese Handlungen NIE ausführen können.
 *
 * WO GEPRÜFT WIRD
 * Auf dem Gerät, mit `verifyLocalPin` — derselben Funktion wie am Sperrschirm,
 * mit demselben eskalierenden Zähler und derselben Löschung nach zehn
 * Fehlversuchen. Der Code verlässt das Telefon nicht. Erst nach bestandener
 * Prüfung meldet `deviceStepUp` dem Server, dass bestätigt wurde.
 *
 * Ist noch gar kein Code gesetzt, sagt der Dialog das, statt eine Bestätigung
 * vorzutäuschen.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import * as LocalAuthentication from "expo-local-authentication"

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
import { describeError, deviceStepUp } from "@/warehouse14/api"
import {
  WIPE_AFTER,
  clearAttempts,
  readAttempts,
  readLocalPinState,
  recordFailedAttempt,
  verifyLocalPin,
} from "@/warehouse14/local-lock"
import {
  cancelStepUp,
  completeStepUp,
  getPendingStepUp,
  subscribeStepUp,
} from "@/warehouse14/step-up"

export function StepUpDialogHost() {
  const pending = useSyncExternalStore(subscribeStepUp, getPendingStepUp, getPendingStepUp)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Ob auf DIESEM Gerät überhaupt ein Code gesetzt ist. Null = noch unbekannt. */
  const [codeGesetzt, setCodeGesetzt] = useState<boolean | null>(null)
  const [bioReady, setBioReady] = useState(false)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [lockSecs, setLockSecs] = useState(0)
  const bioPrompted = useRef(false)
  const open = pending != null

  /**
   * Dem Server melden, dass die Gerätesperre bestätigt wurde, und die Handlung
   * fortsetzen. Erst wenn der Server das Fenster gestempelt hat, gilt die
   * Bestätigung — sonst liefe der wiederholte Aufruf gleich wieder hier herein.
   */
  const meldenUndFortfahren = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await clearAttempts()
      await deviceStepUp()
      completeStepUp()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const promptBiometric = useCallback(async () => {
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: "Diese Handlung bestätigen",
        cancelLabel: "Code verwenden",
        disableDeviceFallback: true,
      })
      if (res.success) await meldenUndFortfahren()
    } catch {
      // Ein Hardware-Aussetzer: das Codefeld steht ohnehin da. Nichts vortäuschen.
    }
  }, [meldenUndFortfahren])

  // Beim Öffnen: den ECHTEN Stand vom Gerät lesen. Wer schon danebengelegen
  // hat, darf den Zähler nicht durch Schliessen und erneutes Öffnen des
  // Dialogs zurücksetzen — er liegt dauerhaft im Gerät, und darauf beruht der
  // Schutz.
  useEffect(() => {
    if (!open) {
      bioPrompted.current = false
      return
    }
    setCode("")
    setError(null)
    let lebt = true
    void (async () => {
      const [stand, versuche, hw, enrolled] = await Promise.all([
        readLocalPinState(),
        readAttempts(),
        LocalAuthentication.hasHardwareAsync().catch(() => false),
        LocalAuthentication.isEnrolledAsync().catch(() => false),
      ])
      if (!lebt) return
      setCodeGesetzt(stand === "set")
      setLockedUntil(versuche.lockedUntil > Date.now() ? versuche.lockedUntil : 0)
      setBioReady(hw && enrolled)
      // Biometrie zuerst, genau wie am Sperrschirm — aber nur einmal je
      // Öffnung, sonst kämpft die Systemabfrage mit der Tastatur.
      if (stand === "set" && hw && enrolled && !bioPrompted.current) {
        bioPrompted.current = true
        void promptBiometric()
      }
    })()
    return () => {
      lebt = false
    }
  }, [open, promptBiometric])

  // Der laufende Zähler der Sperre.
  useEffect(() => {
    if (lockedUntil <= 0) {
      setLockSecs(0)
      return
    }
    const tick = () => {
      const rest = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000))
      setLockSecs(rest)
      if (rest === 0) setLockedUntil(0)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [lockedUntil])

  const gesperrt = lockSecs > 0

  async function submit() {
    if (gesperrt || busy || code.length < 4) return
    setBusy(true)
    setError(null)
    try {
      // ERST auf dem Gerät prüfen. Der Code geht nicht ans Netz.
      const stimmt = await verifyLocalPin(code)
      if (!stimmt) {
        const f = await recordFailedAttempt()
        setCode("")
        if (f.wiped) {
          setCodeGesetzt(false)
          setError(
            `Nach ${WIPE_AFTER} Fehlversuchen wurde der Gerätecode gelöscht. ` +
              "Bitte die App einmal sperren und einen neuen setzen.",
          )
        } else {
          setLockedUntil(f.lockedUntil > Date.now() ? f.lockedUntil : 0)
          setError("Falscher Gerätecode.")
        }
        return
      }
      await meldenUndFortfahren()
    } catch (e) {
      setError(describeError(e))
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
          <DialogTitle>Bestätigen</DialogTitle>
          <DialogDescription>
            {codeGesetzt === false
              ? "Auf diesem Gerät ist noch kein Code gesetzt. Bitte die App einmal sperren und einen setzen."
              : "Derselbe Code wie beim Entsperren der App."}
          </DialogDescription>
        </DialogHeader>

        {codeGesetzt !== false ? (
          <Input
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            placeholder="••••"
            autoFocus={!bioReady}
            editable={!gesperrt && !busy}
            className="text-center tracking-[8px]"
          />
        ) : null}

        {gesperrt ? (
          <Text className="text-destructive text-center text-sm">
            Gesperrt, noch {lockSecs} Sekunden.
          </Text>
        ) : null}
        {error ? <Text className="text-destructive text-sm">{error}</Text> : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" onPress={() => cancelStepUp()} disabled={busy}>
            <Text>Abbrechen</Text>
          </Button>
          {bioReady && codeGesetzt ? (
            <Button variant="outline" onPress={() => void promptBiometric()} disabled={busy}>
              <Text>Biometrie</Text>
            </Button>
          ) : null}
          <Button
            onPress={() => void submit()}
            disabled={code.length < 4 || busy || gesperrt || codeGesetzt === false}
          >
            <Text>Bestätigen</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
