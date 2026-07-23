/**
 * Benachrichtigungen für die Inhaber-App — Erlaubnis, Marke, Anmeldung.
 *
 * WOFÜR
 * Damit eine neue Bestellung das Personal SOFORT erreicht, ohne dass jemand
 * in die Warteschlange sehen muss. Der Server ist dafür seit dem 23.07.2026
 * fertig: `device_push_tokens`, `push_outbox`, der Versender im worker, und
 * jede neue Reservierung reiht bereits eine Nachricht ein. Es fehlte nur die
 * Marke dieses Geräts.
 *
 * DREI SCHRITTE, DREI EHRLICHE ANTWORTEN
 *   1. Die ERLAUBNIS fragt das Betriebssystem. Braucht keinen fremden Dienst.
 *   2. Die MARKE holt Expo. Braucht auf Android die Firebase-Zugangsdaten im
 *      Build (`google-services.json`, seit heute vorhanden).
 *   3. Die ANMELDUNG schickt die Marke an den Server, damit er senden kann.
 *
 * Jeder Schritt kann fehlschlagen, und der Rückgabewert sagt WELCHER. Kein
 * „aktiviert", wenn nur die Hälfte steht — sonst wartet jemand auf einen Ton,
 * der nie kommt.
 */
import * as Device from "expo-device"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"

import { registerPushToken } from "./api"

export interface PushSetupResult {
  granted: boolean
  token: string | null
  /** Ist die Marke beim Server angemeldet? Erst dann kann er senden. */
  registered: boolean
  /** Ein Satz, der sagt, woran es hängt. Null wenn alles steht. */
  reason: string | null
}

/**
 * Android verlangt einen Kanal, sonst erscheint die Nachricht stumm und ohne
 * Rang. „Bestellungen" bekommt einen hohen Rang: eine wartende Kundschaft ist
 * der einzige Anlass, der das Personal wirklich unterbrechen darf.
 */
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return
  await Notifications.setNotificationChannelAsync("bestellungen", {
    name: "Bestellungen",
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  })
}

/**
 * Erlaubnis holen, Marke holen, beim Server anmelden.
 *
 * Wird nach der Anmeldung aufgerufen, nicht davor: eine Marke ohne bekannten
 * Menschen kann der Server niemandem zuordnen.
 */
export async function setUpPushNotifications(): Promise<PushSetupResult> {
  if (!Device.isDevice) {
    return {
      granted: false,
      token: null,
      registered: false,
      reason: "Benachrichtigungen brauchen ein echtes Gerät.",
    }
  }

  await ensureChannel()

  const vorhanden = await Notifications.getPermissionsAsync()
  let status = vorhanden.status
  if (status !== "granted") {
    const gefragt = await Notifications.requestPermissionsAsync()
    status = gefragt.status
  }
  if (status !== "granted") {
    return {
      granted: false,
      token: null,
      registered: false,
      reason: "Benachrichtigungen sind nicht erlaubt. Das lässt sich in den Einstellungen ändern.",
    }
  }

  // DIE MARKE — bewusst die GERÄTEMARKE (FCM) und nicht die Expo-Marke.
  //
  // Der Server stellt seit dem Umbau direkt bei Google zu, ohne Expo in der
  // Mitte. Das heisst: keine hinterlegten Zugangsdaten bei einem Dritten, und
  // vor allem keine Bestätigung für eine Nachricht, die nie ankommt. Dafür
  // braucht es hier die rohe FCM-Marke, die `getDevicePushTokenAsync` liefert.
  //
  // Sie kann trotzdem fehlschlagen — wenn `google-services.json` im gebauten
  // Paket fehlt, hat die App gar keinen Draht zu Google. Dann ist die ERLAUBNIS
  // erteilt und die ZUSTELLUNG nicht möglich, und genau dieser Unterschied wird
  // zurückgemeldet statt verschwiegen.
  let token: string
  try {
    const t = await Notifications.getDevicePushTokenAsync()
    token = String(t.data)
  } catch {
    return {
      granted: true,
      token: null,
      registered: false,
      reason: "Erlaubnis erteilt. Die Zustellung ist auf diesem Gerät nicht eingerichtet.",
    }
  }

  // Die Marke beim Server anmelden. Schlägt das fehl, ist die Erlaubnis
  // trotzdem erteilt — das wird nicht verschwiegen, denn der Unterschied
  // entscheidet, ob ein Ton kommt oder nicht.
  try {
    await registerPushToken(token, Platform.OS === "ios" ? "ios" : "android")
    return { granted: true, token, registered: true, reason: null }
  } catch {
    return {
      granted: true,
      token,
      registered: false,
      reason: "Erlaubnis erteilt, aber das Gerät ist noch nicht beim Server angemeldet.",
    }
  }
}
