/**
 * Catalog grid card. Warm raised leaf, hairline, primary thumb, name, price.
 * Gilt never a fill. Price in mono. Tap navigates to the product detail.
 */

import { memo } from "react"
import { Pressable, Text, View } from "react-native"
import { Image } from "expo-image"

import { resolveImageUrl } from "../lib/api"
import { metalText, priceText } from "../lib/german"
import { palette } from "../theme/tokens"
import type { StorefrontProduct } from "../lib/types"

interface Props {
  product: StorefrontProduct
  onPress: (slug: string) => void
}

function ProductCardBase({ product, onPress }: Props) {
  const slug = product.slug ?? product.id
  const thumb = resolveImageUrl(product.primaryImageThumbUrl)
  const metal = metalText(product.metal)

  return (
    <Pressable
      onPress={() => onPress(slug)}
      className="active:opacity-80"
      accessibilityRole="button"
      accessibilityLabel={product.name}
    >
      <View className="overflow-hidden rounded-xl border border-rule bg-card">
        <View
          style={{
            aspectRatio: 1,
            backgroundColor: palette.raised,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {thumb ? (
            <Image
              source={thumb}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              transition={180}
              recyclingKey={thumb}
              cachePolicy="memory-disk"
            />
          ) : (
            <Text
              className="text-2xs"
              style={{ color: palette.inkFaded, fontFamily: "Inter_400Regular" }}
            >
              Kein Bild
            </Text>
          )}
        </View>
        <View className="gap-0.5 p-3">
          <Text
            numberOfLines={2}
            style={{
              color: palette.ink,
              fontFamily: "Inter_500Medium",
              fontSize: 14,
              lineHeight: 18,
              minHeight: 36,
            }}
          >
            {product.name}
          </Text>
          {metal ? (
            <Text
              className="text-2xs"
              style={{ color: palette.inkFaded, fontFamily: "Inter_400Regular" }}
            >
              {metal}
            </Text>
          ) : null}
          <Text
            className="tnum text-sm"
            style={{ color: palette.ink, marginTop: 2 }}
          >
            {priceText(product.listPriceEur)}
          </Text>
        </View>
      </View>
    </Pressable>
  )
}

export const ProductCard = memo(ProductCardBase)
