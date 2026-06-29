/**
 * Capture modal — the reusable entry point. Today it binds to a product
 * (?productId=…); KYC/Ankauf will pass their own target. Captures via
 * CapturePhotoScreen, uploads through the pipeline (first photo → primary),
 * then returns. The pipeline discards the temp device file (no-persist).
 */
import { useState } from "react"
import { router, useLocalSearchParams } from "expo-router"

import { describeError } from "@/warehouse14/api"
import { CapturePhotoScreen } from "@/warehouse14/CapturePhotoScreen"
import {
  type CapturedPhoto,
  discardCapture,
  readCaptureBase64,
} from "@/warehouse14/photo-pipeline"
import { runProductPhotoUpload } from "@/warehouse14/photo-upload-store"

export default function CaptureRoute() {
  const { productId } = useLocalSearchParams<{ productId: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onConfirm(photo: CapturedPhoto) {
    if (!productId) return
    setBusy(true)
    setError(null)
    try {
      // Optimistic: read the bytes into memory (fast), discard the temp file
      // (no-persist), then return INSTANTLY and upload in the BACKGROUND. The
      // product detail shows „wird hochgeladen" and slots the photo in when it
      // lands — so „Verwenden" never blocks on the network (the „Ladehemmung"
      // the owner felt). The server auto-promotes the first photo to primary.
      const dataBase64 = await readCaptureBase64(photo)
      discardCapture(photo)
      runProductPhotoUpload(productId, dataBase64, photo.mime)
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
