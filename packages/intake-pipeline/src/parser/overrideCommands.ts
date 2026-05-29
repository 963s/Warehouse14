/**
 * Override-command parser — ADR-0015 §4. Deterministic regex + keyword table,
 * NEVER an LLM (a misparse could cancel a real session).
 *
 * Recognizes DONE / NEW / CANCEL / HELP across de/en/ar plus layout-split
 * commands like "1-3 = A, 4 = B" (language-agnostic on numbers). Case- and
 * diacritic-insensitive; strips emoji; normalizes Arabic alif/tashkeel and the
 * Arabic question mark.
 */

export type CommandType = 'DONE' | 'NEW' | 'CANCEL' | 'HELP';
export type LanguageCode = 'de' | 'en' | 'ar';

export const LANGUAGE_CODES: readonly LanguageCode[] = ['de', 'en', 'ar'];

export const OVERRIDE_COMMAND_KEYWORDS: Record<
  CommandType,
  Record<LanguageCode, readonly string[]>
> = {
  DONE: {
    de: ['fertig', 'ende', 'erledigt', 'ok'],
    en: ['done', 'finished', 'end', 'ok'],
    ar: ['تم', 'انتهيت', 'خلاص', 'جاهز'],
  },
  NEW: {
    de: ['neu', 'nächster', 'weiter'],
    en: ['new', 'next'],
    ar: ['جديد', 'التالي'],
  },
  CANCEL: {
    de: ['abbrechen', 'verwerfen', 'storno'],
    en: ['cancel', 'discard', 'abort'],
    ar: ['الغاء', 'إلغاء', 'تجاهل', 'حذف'],
  },
  HELP: {
    de: ['hilfe', '?'],
    en: ['help', '?'],
    ar: ['مساعدة', '?', '؟'],
  },
};

const COMMAND_ORDER: readonly CommandType[] = ['DONE', 'NEW', 'CANCEL', 'HELP'];

export interface SplitGroup {
  label: string;
  /** 1-based photo indices belonging to this label, sorted + de-duplicated. */
  photoIndices: number[];
}

export type OverrideCommand = { type: CommandType } | { type: 'SPLIT'; groups: SplitGroup[] };

const SPLIT_PREFIXES = ['📷', 'images', 'bilder', 'صور'];

/**
 * Normalize a token for keyword matching: NFKD, strip combining marks (Latin
 * accents + Arabic tashkeel), fold Arabic alif/hamza + question mark, remove
 * emoji, lowercase, and trim surrounding punctuation (keeping `?`).
 */
export function normalizeToken(raw: string): string {
  let s = raw;
  // Fold Arabic alif/hamza carriers + question mark before decomposition.
  s = s.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/؟/g, '?');
  s = s.normalize('NFKD');
  // Strip combining marks: Latin accents + Arabic tashkeel/hamza marks.
  s = s.replace(/\p{M}/gu, '');
  // Strip emoji / pictographs (variation selectors are covered by \p{M} above).
  s = s.replace(/\p{Extended_Pictographic}/gu, '');
  s = s.toLowerCase();
  // Trim surrounding punctuation/whitespace, but keep `?` (it is a HELP keyword).
  s = s.replace(/^[\s.,!;:'"«»()[\]{}\-_/\\]+/, '').replace(/[\s.,!;:'"«»()[\]{}\-_/\\]+$/, '');
  return s.trim();
}

function matchKeyword(normalized: string, preferred: LanguageCode): CommandType | null {
  const langOrder: LanguageCode[] = [preferred, ...LANGUAGE_CODES.filter((l) => l !== preferred)];
  for (const cmd of COMMAND_ORDER) {
    for (const lang of langOrder) {
      for (const kw of OVERRIDE_COMMAND_KEYWORDS[cmd][lang]) {
        if (normalizeToken(kw) === normalized) return cmd;
      }
    }
  }
  return null;
}

function parseSplit(raw: string): { type: 'SPLIT'; groups: SplitGroup[] } | null {
  let s = raw.trim();
  // Strip an optional leading prefix word/emoji.
  for (const prefix of SPLIT_PREFIXES) {
    if (s.toLowerCase().startsWith(prefix.toLowerCase())) {
      s = s.slice(prefix.length).trim();
      break;
    }
  }
  if (s.length === 0) return null;

  const segmentRe = /(\d+)(?:\s*-\s*(\d+))?\s*=\s*([a-zA-Z])/g;
  const byLabel = new Map<string, Set<number>>();
  let consumed = '';
  let m: RegExpExecArray | null = segmentRe.exec(s);
  let count = 0;
  while (m !== null) {
    count++;
    consumed += m[0];
    const startStr = m[1];
    const endStr = m[2];
    const labelRaw = m[3];
    if (startStr && labelRaw) {
      const start = Number(startStr);
      const end = endStr ? Number(endStr) : start;
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      // Bound the range so a typo can't allocate a huge array.
      if (hi - lo > 200) return null;
      const label = labelRaw.toUpperCase();
      const set = byLabel.get(label) ?? new Set<number>();
      for (let i = lo; i <= hi; i++) set.add(i);
      byLabel.set(label, set);
    }
    m = segmentRe.exec(s);
  }
  if (count === 0) return null;

  // Guard against prose that merely contains "4=B": the message must be
  // (essentially) only the segments + separators.
  const leftover = s.replace(segmentRe, '').replace(/[\s,;]+/g, '');
  if (leftover.length > 0) return null;
  // Sanity: the matched segments should roughly cover the message length.
  if (consumed.replace(/\s+/g, '').length < s.replace(/[\s,;]+/g, '').length) return null;

  const groups: SplitGroup[] = [...byLabel.entries()]
    .map(([label, set]) => ({ label, photoIndices: [...set].sort((a, b) => a - b) }))
    .sort((a, b) => (a.label < b.label ? -1 : 1));
  return { type: 'SPLIT', groups };
}

/**
 * Parse one inbound text message into an override command, or null when it is
 * not a command (ordinary caption text). Tries the staff member's preferred
 * language first, then the others.
 */
export function parseOverrideCommand(
  text: string,
  preferredLanguage: LanguageCode = 'de',
): OverrideCommand | null {
  if (typeof text !== 'string' || text.trim().length === 0) return null;

  // Split commands first (they contain '=' which no keyword does).
  if (text.includes('=')) {
    const split = parseSplit(text);
    if (split) return split;
  }

  const normalized = normalizeToken(text);
  if (normalized.length === 0) return null;

  const cmd = matchKeyword(normalized, preferredLanguage);
  return cmd ? { type: cmd } : null;
}
