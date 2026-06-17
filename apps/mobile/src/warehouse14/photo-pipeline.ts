/**
 * Reusable photo capture→upload→bind pipeline — the Phase-2 keystone.
 * Product photos use it NOW; KYC documents + Ankauf-draft photos reuse it
 * UNCHANGED later (only the BINDING TARGET differs — a parameter here).
 *
 * STORAGE = SERVER-SIDE LOCAL (no R2). `photosApi.uploadDirect` is ONE call:
 * the api-cloud decodes any jpeg/png/webp/heic, bakes the EXIF orientation then
 * STRIPS all metadata, compresses to two WebP renditions (main ≤1600px, thumb
 * ≤400px), writes them under PHOTOS_DIR, binds the product_photos row, and
 * NEVER persists the raw upload (apps/api-cloud/src/lib/photo-store.ts). There
 * is no presigned PUT, no R2 bucket, no orphan key to reconcile.
 *
 * ── NO-PERSIST CONTRACT (inherited by the KYC consumer) ──────────────────────
 * A captured photo is a TEMP device file. This module reads it as base64,
 * uploads it, and ALWAYS DISCARDS the temp file afterwards (success OR failure)
 * — see `discardCapture`. Never write a captured blob anywhere persistent on
 * the device; the only durable copy is the EXIF-stripped WebP the server keeps.
 * KYC reuse MUST keep this contract (Ausweis bytes must not linger on a phone).
 */
import { photosApi, type PhotoDirectUploadResponse } from "@warehouse14/api-client"
import { File } from "expo-file-system"

import { apiClient } from "./api"

export type PhotoMime = "image/jpeg" | "image/png" | "image/webp"

export interface CapturedPhoto {
  /** Local device file path/URI from vision-camera takePhoto(). */
  uri: string
  mime: PhotoMime
}

/**
 * Binding target. Extend with `kyc`/`appraisal` later; the upload mechanism
 * stays identical (uploadDirect) — only the bound entity changes.
 */
export type PhotoBinding =
  | { kind: "product"; productId: string; isPrimary?: boolean }
// future:
//   | { kind: "kyc"; customerId: string; documentType: KycDocumentType }
//   | { kind: "appraisal"; appraisalId: string }

function toFileUri(uri: string): string {
  return uri.startsWith("file://") || uri.startsWith("content://") ? uri : `file://${uri}`
}

/** Discard the temp capture file. Best-effort, NEVER throws (no-persist cleanup). */
export function discardCapture(photo: CapturedPhoto): void {
  try {
    new File(toFileUri(photo.uri)).delete()
  } catch {
    // already gone / never existed — fine.
  }
}

/**
 * Upload a captured photo and bind it to the target in ONE server call. The
 * temp device file is always discarded afterwards (no-persist contract).
 * Returns the bound photo (id + public raw/thumb URLs).
 */
export async function uploadCapturedPhoto(
  photo: CapturedPhoto,
  binding: PhotoBinding,
): Promise<PhotoDirectUploadResponse> {
  try {
    const dataBase64 = await new File(toFileUri(photo.uri)).base64()
    switch (binding.kind) {
      case "product":
        return await photosApi.uploadDirect(apiClient, {
          dataBase64,
          contentType: photo.mime,
          productId: binding.productId,
          intent: "product",
          isPrimary: binding.isPrimary ?? false,
        })
      default:
        // Exhaustive today; future binding kinds add their own bind call here.
        throw new Error(`Unsupported photo binding: ${(binding as { kind: string }).kind}`)
    }
  } finally {
    discardCapture(photo)
  }
}
