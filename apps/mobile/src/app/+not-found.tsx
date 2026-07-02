/**
 * +not-found — expo-router's catch-all for any unmatched route.
 *
 * Without this file a dead link (a stale alert href, a removed screen, a bad
 * deep link) dumps the owner on the raw ENGLISH "Unmatched Route" developer
 * screen — a total break of the app's calm German surface. This is the
 * permanent safety net: a quiet German page with one action that always leads
 * somewhere real (back if possible, else the Schatzkammer).
 */
import { router, Stack } from "expo-router"
import { View } from "react-native"
import { Compass } from "lucide-react-native"

import { EmptyState } from "@/warehouse14/ui"

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Nicht gefunden" }} />
      <View className="bg-background flex-1 justify-center">
        <EmptyState
          icon={Compass}
          title="Seite nicht gefunden"
          description="Dieser Bereich existiert nicht mehr oder der Verweis ist veraltet."
          actionLabel="Zurück"
          onAction={() => {
            if (router.canGoBack()) router.back()
            else router.replace("/")
          }}
        />
      </View>
    </>
  )
}
