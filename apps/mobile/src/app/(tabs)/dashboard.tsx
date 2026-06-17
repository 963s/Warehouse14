import { View } from "react-native"

import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"

export default function DashboardScreen() {
  return (
    <View className="flex-1 justify-center bg-background px-4">
      <Card className="gap-2 px-4 py-5">
        <Text className="text-lg font-semibold">Dashboard</Text>
        <Text className="text-muted-foreground text-sm">
          Kennzahlen folgen — Platzhalter-Oberfläche. Neue Flächen werden über die Registry
          (src/warehouse14/surfaces.ts) mit einer Zeile ergänzt.
        </Text>
      </Card>
    </View>
  )
}
