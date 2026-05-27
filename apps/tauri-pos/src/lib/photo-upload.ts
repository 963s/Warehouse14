/**
 * photo-upload — shared two-step R2 upload pipeline for Day 12.
 *
 *   1. POST /api/photos/upload-url → presigned URL + R2 key
 *   2. PUT  the blob to R2 directly (never touches our API)
 *
 * The caller decides what to do with the returned `r2Key`:
 *   • orphan / product → POST /api/photos { r2Key, productId? }
 *   • KYC → POST /api/customers/:id/kyc-documents { r2Key, sha256Hex, … }
 *
 * Errors throw — the caller decides retry / discard semantics. The R2
 * PUT is fenced by the presigned URL's TTL (typically 10 min), so a
 * slow operator won't blow up; a 403 from R2 just means "presign again".
 */

import type { ApiClient } from '@warehouse14/api-client';
import { photosApi, type PhotoUploadIntent } from '@warehouse14/api-client';

export interface UploadedPhoto {
  r2Key: string;
  publicUrl: string;
}

export async function uploadBlobToR2(input: {
  api: ApiClient;
  blob: Blob;
  intent: PhotoUploadIntent;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}): Promise<UploadedPhoto> {
  const { api, blob, intent, contentType } = input;

  // 1. Request presigned URL.
  const signed = await photosApi.requestUploadUrl(api, {
    contentType,
    contentLength: blob.size,
    intent,
  });

  // 2. PUT the blob to R2 directly. Use the headers the API insists on
  //    — they're part of the signature.
  const res = await fetch(signed.uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: { ...signed.requiredHeaders },
  });
  if (!res.ok) {
    throw new Error(
      `R2 PUT failed: ${res.status} ${res.statusText} — die signierte URL ist möglicherweise abgelaufen.`,
    );
  }

  return { r2Key: signed.r2Key, publicUrl: signed.publicUrl };
}
