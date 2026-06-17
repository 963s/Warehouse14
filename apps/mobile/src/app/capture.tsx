/**
 * Capture modal — the reusable entry point. Today it binds to a product
 * (?productId=…); KYC/Ankauf will pass their own target. Captures via
 * CapturePhotoScreen, uploads through the pipeline (first photo → primary),
 * then returns. The pipeline discards the temp device file (no-persist).
 */
import { useState } from "react"
import { router, useLocalSearchParams } from "expo-router"

import { describeError, listProductPhotos } from "@/warehouse14/api"
import { CapturePhotoScreen } from "@/warehouse14/CapturePhotoScreen"
import { uploadCapturedPhoto, type CapturedPhoto } from "@/warehouse14/photo-pipeline"

export default function CaptureRoute() {
  const { productId } = useLocalSearchParams<{ productId: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onConfirm(photo: CapturedPhoto) {
    if (!productId) return
    setBusy(true)
    setError(null)
    try {
      // First photo for the product becomes its primary.
      const existing = await listProductPhotos(productId)
      const isPrimary = existing.items.length === 0
      await uploadCapturedPhoto(photo, { kind: "product", productId, isPrimary })
      router.back()
    } catch (e) {
      setError(describeError(e))
      setBusy(false)
    }
  }

  return (
    <CapturePhotoScreen
      onConfirm={onConfirm}
      onCancel={() => router.back()}
      busy={busy}
      error={error}
    />
  )
}
