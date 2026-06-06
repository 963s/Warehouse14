/**
 * digit-nav — pure decision logic for number-key surface navigation.
 *
 * The Karteikasten rail labels its chips 1–8 but the keys were never bound
 * (UX-REDESIGN §1 gap 2 — "a promise the UI visibly breaks"). The shell wires
 * the real keydown listener; THIS module owns the decision + its guards so the
 * behaviour is unit-testable without a DOM:
 *   • never hijack when a modifier is held (Cmd/Ctrl+digit are real shortcuts),
 *   • never hijack while a text-entry element is focused (typing into a field),
 *   • never hijack while a dialog / Spotlight is open.
 *
 * Structurally typed over the surface registry (only digit + path are needed),
 * so importing it pulls in no React/screen code.
 */

export interface DigitNavSurface {
  digit?: number;
  path: string;
}

export interface DigitNavContext {
  /** KeyboardEvent.key */
  key: string;
  /** metaKey || ctrlKey || altKey held */
  hasModifier: boolean;
  /** focus is in an <input>/<textarea>/<select>/[contenteditable] */
  isTextEntry: boolean;
  /** a modal dialog or the Spotlight palette is open */
  isDialogOpen: boolean;
}

/**
 * @returns the target surface path for a digit press, or `null` when the press
 * must be ignored (guarded context, non-1..9 key, or no surface at that digit).
 */
export function resolveDigitNavPath(
  ctx: DigitNavContext,
  primarySurfaces: readonly DigitNavSurface[],
): string | null {
  if (ctx.hasModifier) return null;
  if (ctx.isTextEntry) return null;
  if (ctx.isDialogOpen) return null;
  if (!/^[1-9]$/.test(ctx.key)) return null;

  const digit = Number(ctx.key);
  const surface = primarySurfaces.find((s) => s.digit === digit);
  return surface ? surface.path : null;
}

/** True when the element should swallow digit keys (it's a typing surface). */
export function isTextEntryElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/** True when any modal dialog (incl. Spotlight) is mounted + open in the DOM. */
export function isAnyDialogOpen(doc: Document = document): boolean {
  return doc.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}
