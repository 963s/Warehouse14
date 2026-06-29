/**
 * Photo studio — client-side crop + rotate before upload. Uses
 * expo-image-manipulator to process the captured photo into a square crop +
 * optional rotation + JPEG compression, all on-device. The processed URI
 * replaces the captured URI before upload, so the server gets a clean,
 * owner-curated image.
 *
 * The owner's workflow: capture → see the preview → tap "Drehen" to rotate 90°
 * (repeatable) → tap "Verwenden" to upload the processed result.
 */
import { manipulateAsync, SaveFormat, type Action } from "expo-image-manipulator"

/** Re-encode any picked image (HEIC, PNG, …) to JPEG so the upload pipeline
 *  always sends one predictable mime. No crop; light compression. */
export async function normalizeToJpeg(uri: string): Promise<string> {
  const result = await manipulateAsync(uri, [], { compress: 0.9, format: SaveFormat.JPEG })
  return result.uri
}

/**
 * Rotate the image 90° clockwise on-device. Returns the new local URI.
 * Idempotent: four rotations bring you back to the original orientation.
 */
export async function rotatePhoto(uri: string): Promise<string> {
  const result = await manipulateAsync(uri, [{ rotate: 90 }], {
    compress: 0.85,
    format: SaveFormat.JPEG,
  })
  return result.uri
}

/**
 * Crop the image to a CENTERED square on-device, using the REAL source
 * dimensions. A no-op manipulate pass returns the true width/height; we then
 * take the smaller edge as the square side and crop from the center.
 *
 * (The previous version cropped a fixed 1000×1000 box from the top-left, which
 * simply FAILED on any photo smaller than 1000 px — that's why "Zuschneiden"
 * appeared to do nothing for the owner.)
 */
export async function cropToSquare(uri: string): Promise<string> {
  const info = await manipulateAsync(uri, [], { format: SaveFormat.JPEG })
  const side = Math.min(info.width, info.height)
  const originX = Math.round((info.width - side) / 2)
  const originY = Math.round((info.height - side) / 2)
  const result = await manipulateAsync(
    uri,
    [{ crop: { originX, originY, width: side, height: side } }],
    { compress: 0.85, format: SaveFormat.JPEG },
  )
  return result.uri
}

/**
 * Apply a sequence of edits (rotate, crop) in one pass, then compress.
 */
export async function editPhoto(
  uri: string,
  actions: Action[],
): Promise<string> {
  if (actions.length === 0) return uri
  const result = await manipulateAsync(uri, actions, {
    compress: 0.85,
    format: SaveFormat.JPEG,
  })
  return result.uri
}
