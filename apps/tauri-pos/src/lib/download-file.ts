/**
 * downloadTextFile — trigger a browser/webview "save as" for an in-memory text
 * payload (CSV exports). The CSV body has already been fetched through the
 * api-client (so the session cookie + step-up interceptor applied); here we
 * only turn the string into a file the operator can hand to the Steuerberater.
 *
 * Works in the Tauri webview (Chromium): a Blob URL on a transient anchor.
 */
export function downloadTextFile(
  filename: string,
  text: string,
  mime = 'text/csv;charset=utf-8',
): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * downloadBase64File — trigger a "save as" for a binary payload that arrived
 * base64-encoded (the DSFinV-K ZIP rides the text-only api-client path, so the
 * route base64-encodes it; here we decode back to the exact bytes and download).
 */
export function downloadBase64File(
  filename: string,
  base64: string,
  mime = 'application/zip',
): void {
  const binary = atob(base64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
