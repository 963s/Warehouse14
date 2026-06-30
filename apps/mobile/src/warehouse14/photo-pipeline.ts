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
import { File } from "expo-file-system"
import { manipulateAsync, SaveFormat } from "expo-image-manipulator"
import {
  customersApi,
  photosApi,
  type CustomerKycDocumentResponse,
  type KycDocumentType,
  type PhotoDirectUploadResponse,
} from "@warehouse14/api-client"

import { apiClient } from "./api"

export type PhotoMime = "image/jpeg" | "image/png" | "image/webp"

/**
 * Downscale + compress a captured photo ON-DEVICE before upload (H1, the owner's
 * "hang"). A modern camera capture is multi-MB; sent raw as base64 (~+33% larger)
 * it reliably times out the upload window on slow mobile data. We re-encode to a
 * JPEG bounded at maxWidth so the bytes that go up are a few hundred KB, not
 * several MB. Product photos: ≤1600px / 0.7. KYC/Ausweis: ≤2000px / 0.85 so the
 * ID stays legible (the server re-compresses + AES-encrypts regardless). ALWAYS
 * returns JPEG bytes — callers MUST send contentType "image/jpeg".
 */
async function compressToJpegBase64(uri: string, kind: "product" | "kyc"): Promise<string> {
  const maxWidth = kind === "kyc" ? 2000 : 1600
  const compress = kind === "kyc" ? 0.85 : 0.7
  const out = await manipulateAsync(toFileUri(uri), [{ resize: { width: maxWidth } }], {
    compress,
    format: SaveFormat.JPEG,
    base64: true,
  })
  // base64:true populates .base64; fall back to the raw read only if a platform
  // ever returns undefined, so an upload never silently sends nothing.
  return out.base64 ?? (await new File(toFileUri(uri)).base64())
}

export interface CapturedPhoto {
  /** Local device file path/URI from vision-camera takePhoto(). */
  uri: string
  mime: PhotoMime
}

/**
 * Binding target. The CAPTURE + base64 read + no-persist discard are identical
 * across kinds — only the bind CALL differs (the keystone promise). `product`
 * uploads to the local photo store (uploadDirect); `kyc` POSTs the raw bytes to
 * the server KYC store (addKycDocument), which compresses, hashes, and
 * AES-256-GCM-encrypts at rest.
 */
export type PhotoBinding =
  | { kind: "product"; productId: string; isPrimary?: boolean }
  | {
      kind: "kyc"
      customerId: string
      documentType: KycDocumentType
      /** ISO 3166-1 alpha-2, uppercase. */
      issuingCountryIso2: string
      documentNumber: string
      issuedOn?: string
      expiresOn: string
      retentionYears?: number
    }
// future:
//   | { kind: "appraisal"; appraisalId: string }

function toFileUri(uri: string): string {
  return uri.startsWith("file://") || uri.startsWith("content://") ? uri : `file://${uri}`
}

/**
 * Read a captured photo as base64 (transient, in-memory, never logged). The
 * caller uploads the bytes and discards the temp file — used by the optimistic
 * product path so the screen can return BEFORE the network upload finishes.
 */
export async function readCaptureBase64(photo: CapturedPhoto): Promise<string> {
  // Returns COMPRESSED JPEG bytes — the caller must upload as contentType
  // "image/jpeg" (the optimistic product path passes that literal).
  return await compressToJpegBase64(photo.uri, "product")
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
 * temp device file is ALWAYS discarded afterwards (no-persist contract) — this
 * matters most for a KYC Ausweis, whose bytes must never linger on a phone. The
 * base64 is a transient local, never logged. Only the bind call differs per kind.
 */
export async function uploadCapturedPhoto(
  photo: CapturedPhoto,
  binding: Extract<PhotoBinding, { kind: "product" }>,
): Promise<PhotoDirectUploadResponse>
export async function uploadCapturedPhoto(
  photo: CapturedPhoto,
  binding: Extract<PhotoBinding, { kind: "kyc" }>,
): Promise<CustomerKycDocumentResponse>
export async function uploadCapturedPhoto(
  photo: CapturedPhoto,
  binding: PhotoBinding,
): Promise<PhotoDirectUploadResponse | CustomerKycDocumentResponse> {
  try {
    // Downscale + compress on-device first (H1) — JPEG bytes, so contentType is
    // always "image/jpeg" below regardless of the capture's original mime.
    const dataBase64 = await compressToJpegBase64(photo.uri, binding.kind)
    switch (binding.kind) {
      case "product":
        return await photosApi.uploadDirect(apiClient, {
          dataBase64,
          contentType: "image/jpeg",
          productId: binding.productId,
          intent: "product",
          isPrimary: binding.isPrimary ?? false,
        })
      case "kyc":
        // SERVER KYC store: the (already downscaled) bytes go up; the server
        // compresses, computes the sha256, and AES-256-GCM-encrypts at rest
        // (#I-47). ADMIN + step-up gated — a 403 STEP_UP_REQUIRED drives the PIN
        // dialog + retry.
        return await customersApi.addKycDocument(apiClient, binding.customerId, {
          dataBase64,
          contentType: "image/jpeg",
          documentType: binding.documentType,
          issuingCountryIso2: binding.issuingCountryIso2,
          documentNumber: binding.documentNumber,
          ...(binding.issuedOn ? { issuedOn: binding.issuedOn } : {}),
          expiresOn: binding.expiresOn,
          ...(binding.retentionYears !== undefined
            ? { retentionYears: binding.retentionYears }
            : {}),
        })
      default:
        // Exhaustive today; future binding kinds add their own bind call here.
        throw new Error(`Unsupported photo binding: ${(binding as { kind: string }).kind}`)
    }
  } finally {
    discardCapture(photo)
  }
}
