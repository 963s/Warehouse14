/**
 * Outbound status-message templates for the staff loopback (ADR-0015 §8).
 * Pure + testable: the worker resolves the staff member's preferred language
 * and sends the matching string back via WhatsApp.
 */

import type { LanguageCode } from './parser/overrideCommands.js';

export type IntakeStatusKind =
  | 'received'
  | 'processing'
  | 'ready'
  | 'published'
  | 'needs_more_info'
  | 'rejected'
  | 'failed'
  | 'help';

const TEMPLATES: Record<IntakeStatusKind, Record<LanguageCode, string>> = {
  received: {
    de: 'Fotos erhalten. Senden Sie weitere oder „fertig“ zum Abschließen.',
    en: 'Photos received. Send more or “done” to finish.',
    ar: 'تم استلام الصور. أرسل المزيد أو "تم" للإنهاء.',
  },
  processing: {
    de: 'Verarbeite die Artikel … das dauert etwa eine Minute.',
    en: 'Processing the items … this takes about a minute.',
    ar: 'جارٍ معالجة العناصر… يستغرق ذلك حوالي دقيقة.',
  },
  ready: {
    de: 'Entwurf erstellt und liegt zur Prüfung im Control Desktop bereit.',
    en: 'Draft created and ready for review in the Control Desktop.',
    ar: 'تم إنشاء المسودة وهي جاهزة للمراجعة في لوحة التحكم.',
  },
  published: {
    de: 'Artikel veröffentlicht und im Bestand verfügbar.',
    en: 'Item published and available in inventory.',
    ar: 'تم نشر العنصر وهو متاح في المخزون.',
  },
  needs_more_info: {
    de: 'Foto unscharf, bitte erneut senden.',
    en: 'Photo unclear, please send it again.',
    ar: 'الصورة غير واضحة، يرجى إعادة إرسالها.',
  },
  rejected: {
    de: 'Vorgang abgebrochen.',
    en: 'Intake cancelled.',
    ar: 'تم إلغاء العملية.',
  },
  failed: {
    de: 'Bei der Verarbeitung ist ein Fehler aufgetreten. Das Team wurde informiert.',
    en: 'Something went wrong during processing. The team has been notified.',
    ar: 'حدث خطأ أثناء المعالجة. تم إبلاغ الفريق.',
  },
  help: {
    de: 'Befehle: „fertig“ abschließen · „neu“ nächster Artikel · „abbrechen“ verwerfen · „1-3=A, 4=B“ aufteilen.',
    en: 'Commands: “done” finish · “new” next item · “cancel” discard · “1-3=A, 4=B” split.',
    ar: 'الأوامر: "تم" إنهاء · "جديد" العنصر التالي · "إلغاء" تجاهل · "1-3=A، 4=B" تقسيم.',
  },
};

/** Localized staff-facing status message; falls back to German for unknown langs. */
export function intakeStatusMessage(kind: IntakeStatusKind, language: LanguageCode): string {
  const row = TEMPLATES[kind];
  return row[language] ?? row.de;
}
