/**
 * photo-upload-store — a tiny module-level store for OPTIMISTIC, background
 * product-photo uploads. The capture screen reads the bytes, discards the temp
 * file (no-persist), and returns INSTANTLY; the actual upload runs here in the
 * background so „Verwenden" never blocks on the network. The product detail
 * subscribes per product to show a calm „wird hochgeladen" state and to refetch
 * its photos the moment an upload lands (the `tick`).
 *
 * No zustand dependency — React's built-in useSyncExternalStore over a plain
 * module store. State is per productId; getSnapshot returns a STABLE reference
 * while unchanged (shared EMPTY for absent ids), so it never loops.
 *
 * No-persist: this module only ever holds the transient base64 in the closure of
 * one in-flight upload — never a durable device copy. The KYC path keeps its own
 * awaited, server-encrypted flow (photo-pipeline.ts) and does NOT use this.
 */
import { useSyncExternalStore } from "react"
import { photosApi } from "@warehouse14/api-client"

import { apiClient, describeError } from "./api"
import type { PhotoMime } from "./photo-pipeline"

export interface ProductUploadState {
  /** How many background uploads are in flight for this product. */
  uploading: number
  /** The last upload error for this product, until dismissed. */
  error: string | null
  /** Bumps on every SUCCESSFUL upload — the detail refetches its photos on it. */
  tick: number
}

const EMPTY: ProductUploadState = { uploading: 0, error: null, tick: 0 }

let state: Record<string, ProductUploadState> = {}
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

function snapshot(productId: string): ProductUploadState {
  return state[productId] ?? EMPTY
}

function patch(productId: string, next: Partial<ProductUploadState>): void {
  const cur = snapshot(productId)
  state = { ...state, [productId]: { ...cur, ...next } }
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Subscribe a component to one product's upload state (stable snapshot). */
export function useProductUpload(productId: string): ProductUploadState {
  return useSyncExternalStore(
    subscribe,
    () => snapshot(productId),
    () => snapshot(productId),
  )
}

/** Dismiss the surfaced error after the owner has seen it. */
export function clearProductUploadError(productId: string): void {
  if (snapshot(productId).error != null) patch(productId, { error: null })
}

/**
 * Fire a background product-photo upload from already-read bytes. Never throws —
 * success bumps `tick` (the detail refetches), failure surfaces `error`. The
 * server auto-promotes the first photo to primary, so no isPrimary is needed.
 */
export function runProductPhotoUpload(productId: string, dataBase64: string, mime: PhotoMime): void {
  patch(productId, { uploading: snapshot(productId).uploading + 1, error: null })
  void (async () => {
    try {
      await photosApi.uploadDirect(apiClient, {
        dataBase64,
        contentType: mime,
        productId,
        intent: "product",
        isPrimary: false,
      })
      const cur = snapshot(productId)
      patch(productId, { uploading: Math.max(0, cur.uploading - 1), tick: cur.tick + 1 })
    } catch (e) {
      const cur = snapshot(productId)
      patch(productId, { uploading: Math.max(0, cur.uploading - 1), error: describeError(e) })
    }
  })()
}
