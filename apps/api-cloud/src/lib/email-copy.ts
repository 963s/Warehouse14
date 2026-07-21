/**
 * email-copy — every transactional email, in the customer's own language.
 *
 * THE GAP THIS CLOSES: a shopper could read the whole app in Turkish, reserve
 * a piece, and then receive a GERMAN email carrying the one thing they must
 * act on, the pickup number. The app spoke thirteen languages; the letters it
 * sent spoke one.
 *
 * Why a static table and not the translation cache: the set of emails is
 * FIXED and known at build time, exactly like the metal and Erhaltung facets.
 * Product text goes through the model because the owner writes it at runtime;
 * a welcome letter does not. Static copy is also the only responsible choice
 * here, since an email must never wait on a model call inside a checkout
 * transaction, and a transactional letter may not be paraphrased on the fly.
 *
 * Discipline:
 *   • The interface is exhaustive, so tsc refuses a locale that is missing a
 *     phrase. That is the parity gate, enforced by the compiler.
 *   • Each language keeps the POLITENESS REGISTER the app already uses (formal
 *     Sie in German, vous in French, siz in Turkish, informal du in Danish and
 *     Swedish, je in Dutch), and the app's own words for a piece and for
 *     reserving. The letter must sound like the same shop as the screen.
 *   • Plural rules are real, not naive: Arabic has a dual, Polish and
 *     Ukrainian have a few-versus-many form, Turkish and Swedish take no
 *     plural after a numeral.
 *   • Numbers, the reservation reference and the amount are never translated.
 *   • Anything not translated falls back to German rather than to a blank.
 */

/** The thirteen languages the storefront ships. German is the source. */
export const EMAIL_LOCALES = [
  'de', 'en', 'ar', 'tr', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'da', 'sv', 'uk',
] as const;

export type EmailLocale = (typeof EMAIL_LOCALES)[number];

/**
 * Best language guess from the browser or app's Accept Language header. Used
 * ONLY for readers who have not stored a preference, above all guests, who
 * reserve without ever creating an account. A stored preference is a choice
 * and always outranks this.
 */
export function localeFromAcceptLanguage(header: string | string[] | undefined): EmailLocale {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return 'de';
  // "tr-TR,tr;q=0.9,en;q=0.8" — take tags in order, first one we ship wins.
  for (const part of raw.split(',')) {
    const tag = part.split(';')[0]?.trim() ?? '';
    const code = tag.slice(0, 2).toLowerCase();
    if ((EMAIL_LOCALES as readonly string[]).includes(code)) return code as EmailLocale;
  }
  return 'de';
}

/** Anything unknown, malformed or absent reads as German. */
export function normalizeEmailLocale(raw: string | null | undefined): EmailLocale {
  const code = (raw ?? '').trim().slice(0, 2).toLowerCase();
  return (EMAIL_LOCALES as readonly string[]).includes(code) ? (code as EmailLocale) : 'de';
}

export interface EmailCopy {
  /** Text direction of the HTML body. Only Arabic reads right to left. */
  dir: 'ltr' | 'rtl';
  /** Line under the wordmark. */
  tagline: string;
  /** Who operates the shop, for the footer of a business letter. */
  operatorLine: string;
  /** Non German letters say plainly that German governs the contract. */
  courtesyNote: string | null;
  /**
   * When the shop is actually open. This is not decoration: the reservation
   * letter says we hold the piece for three days, and three days that fall
   * across a weekend are worthless if the reader does not know the shop is
   * shut. Telling someone to collect without telling them when they can is
   * how a held piece quietly becomes a lapsed one.
   */
  openingHoursLabel: string;
  openingHours: string;

  greetNamed: (name: string) => string;
  greetPlain: string;

  welcomeSubject: string;
  welcomeLead: string;
  welcomeBody: string;
  welcomeClose: string;

  reservationSubject: (ref: string) => string;
  /** "one piece" / "3 pieces", in the language's real plural rule. */
  pieces: (n: number) => string;
  reservationLead: (pieces: string) => string;
  refLabel: string;
  totalLabel: string;
  euro: string;
  reservationClose: string;

  cancelledSubject: string;
  cancelledLead: (ref: string) => string;
  cancelledClose: string;
}

const BRAND = 'Warehouse 14';
const ADDRESS = 'Rosenstraße 40, 73614 Schorndorf';
const OPERATOR = 'Briefmarken To-Go (stampscoins)';

/**
 * Contact block, identical in every language: it is data, not prose.
 * The address here MUST match the sender the customer sees, otherwise the
 * letter invites a reply to one place and signs off with another.
 */
export const EMAIL_CONTACT_LINE =
  'Telefon +49 7181 9647511, bestellung@warehouse14.de, USt IdNr DE343451090';

const COPY: Record<EmailLocale, EmailCopy> = {
  de: {
    dir: 'ltr',
    tagline: 'Edelmetalle und Sammlerstücke',
    operatorLine: `${BRAND}, ein Angebot von ${OPERATOR}, ${ADDRESS}`,
    courtesyNote: null,
    openingHoursLabel: 'Öffnungszeiten',
    openingHours: 'Mo bis Do 15:00 bis 18:30, Fr 15:00 bis 19:00',
    greetNamed: (n) => `Guten Tag ${n},`,
    greetPlain: 'Guten Tag,',
    welcomeSubject: `Willkommen bei ${BRAND}`,
    welcomeLead: `herzlich willkommen bei ${BRAND}. Ihr Konto ist eingerichtet.`,
    welcomeBody:
      'Sie können ab sofort unsere Stücke durchstöbern, Favoriten merken und Reservierungen ' +
      'zur Abholung im Geschäft aufgeben. Jedes Stück ist ein Einzelstück, geprüft und kuratiert.',
    welcomeClose: 'Wir freuen uns auf Ihren Besuch.',
    reservationSubject: (ref) => `Ihre Reservierung ${ref} bei ${BRAND}`,
    pieces: (n) => (n === 1 ? 'ein Stück' : `${n} Stücke`),
    reservationLead: (p) =>
      `Ihre Reservierung ist eingegangen. Wir legen ${p} drei Tage im Geschäft für Sie zurück.`,
    refLabel: 'Reservierungsnummer',
    totalLabel: 'Gesamtwert',
    euro: 'Euro',
    reservationClose:
      'Bitte nennen Sie die Reservierungsnummer bei der Abholung im Geschäft. ' +
      'Bezahlt wird bequem vor Ort.',
    cancelledSubject: `Reservierung storniert, ${BRAND}`,
    cancelledLead: (ref) =>
      `Ihre Reservierung ${ref} wurde storniert. Die Stücke sind wieder frei verfügbar.`,
    cancelledClose: 'Sie können jederzeit erneut reservieren. Wir sind gern für Sie da.',
  },

  en: {
    dir: 'ltr',
    tagline: 'Precious metals and collectibles',
    operatorLine: `${BRAND}, operated by ${OPERATOR}, ${ADDRESS}, Germany`,
    courtesyNote: 'This message is a courtesy translation. The contract language is German.',
    openingHoursLabel: 'Opening hours',
    openingHours: 'Mon to Thu 15:00 to 18:30, Fri 15:00 to 19:00',
    greetNamed: (n) => `Hello ${n},`,
    greetPlain: 'Hello,',
    welcomeSubject: `Welcome to ${BRAND}`,
    welcomeLead: `Welcome to ${BRAND}. Your account is ready.`,
    welcomeBody:
      'From now on you can browse our pieces, keep favourites and reserve them for pickup ' +
      'in the shop. Every piece is one of a kind, checked and curated.',
    welcomeClose: 'We look forward to your visit.',
    reservationSubject: (ref) => `Your reservation ${ref} at ${BRAND}`,
    pieces: (n) => (n === 1 ? 'one piece' : `${n} pieces`),
    reservationLead: (p) =>
      `We have your reservation. We hold ${p} in the shop for three days.`,
    refLabel: 'Reservation number',
    totalLabel: 'Total value',
    euro: 'Euro',
    reservationClose:
      'Please give the reservation number when you pick up in the shop. ' +
      'You simply pay on the spot.',
    cancelledSubject: `Reservation cancelled, ${BRAND}`,
    cancelledLead: (ref) =>
      `Your reservation ${ref} has been cancelled. The pieces are available again.`,
    cancelledClose: 'You can reserve again at any time. We are glad to help.',
  },

  ar: {
    dir: 'rtl',
    tagline: 'معادن ثمينة وقطع للمقتنين',
    operatorLine: `${BRAND}، يديره ${OPERATOR}، ${ADDRESS}، ألمانيا`,
    courtesyNote: 'هذه الرسالة ترجمة للتيسير. لغة التعاقد هي الألمانية.',
    openingHoursLabel: 'ساعات العمل',
    openingHours: 'الاثنين إلى الخميس 15:00 حتى 18:30، الجمعة 15:00 حتى 19:00',
    greetNamed: (n) => `مرحباً ${n}،`,
    greetPlain: 'مرحباً،',
    welcomeSubject: `أهلاً بك في ${BRAND}`,
    welcomeLead: `أهلاً بك في ${BRAND}. حسابك جاهز.`,
    welcomeBody:
      'يمكنك من الآن تصفح قطعنا وحفظ ما يعجبك في المفضلة وحجز ما تريد لاستلامه من المتجر. ' +
      'كل قطعة فريدة، مفحوصة ومختارة بعناية.',
    welcomeClose: 'نتطلع إلى زيارتك.',
    reservationSubject: (ref) => `حجزك ${ref} لدى ${BRAND}`,
    pieces: (n) => {
      if (n === 1) return 'قطعة واحدة';
      if (n === 2) return 'قطعتين';
      if (n <= 10) return `${n} قطع`;
      return `${n} قطعة`;
    },
    reservationLead: (p) => `وصلنا حجزك. نحتفظ لك بـ ${p} في المتجر لمدة ثلاثة أيام.`,
    refLabel: 'رقم الحجز',
    totalLabel: 'القيمة الإجمالية',
    euro: 'يورو',
    reservationClose:
      'يرجى ذكر رقم الحجز عند الاستلام من المتجر. الدفع يتم بكل راحة عند الاستلام.',
    cancelledSubject: `تم إلغاء الحجز، ${BRAND}`,
    cancelledLead: (ref) => `تم إلغاء حجزك ${ref}. القطع متاحة من جديد.`,
    cancelledClose: 'يمكنك الحجز مجدداً في أي وقت. نحن هنا من أجلك.',
  },

  tr: {
    dir: 'ltr',
    tagline: 'Kıymetli madenler ve koleksiyon parçaları',
    operatorLine: `${BRAND}, ${OPERATOR} tarafından işletilmektedir, ${ADDRESS}, Almanya`,
    courtesyNote: 'Bu mesaj kolaylık olsun diye çevrilmiştir. Sözleşme dili Almancadır.',
    openingHoursLabel: 'Açılış saatleri',
    openingHours: 'Pzt ile Per 15:00 ile 18:30, Cum 15:00 ile 19:00',
    greetNamed: (n) => `Merhaba ${n},`,
    greetPlain: 'Merhaba,',
    welcomeSubject: `${BRAND} ailesine hoş geldiniz`,
    welcomeLead: `${BRAND} ailesine hoş geldiniz. Hesabınız hazır.`,
    welcomeBody:
      'Artık parçalarımıza göz atabilir, beğendiklerinizi kaydedebilir ve mağazadan teslim ' +
      'almak üzere rezerve edebilirsiniz. Her parça tektir, kontrol edilmiş ve özenle seçilmiştir.',
    welcomeClose: 'Ziyaretinizi dört gözle bekliyoruz.',
    reservationSubject: (ref) => `${BRAND} rezervasyonunuz ${ref}`,
    pieces: (n) => (n === 1 ? 'bir ürün' : `${n} ürün`),
    reservationLead: (p) =>
      `Rezervasyonunuz bize ulaştı. ${p} mağazada üç gün boyunca sizin için ayrılıyor.`,
    refLabel: 'Rezervasyon numarası',
    totalLabel: 'Toplam değer',
    euro: 'euro',
    reservationClose:
      'Mağazadan teslim alırken rezervasyon numarasını söylemeniz yeterli. ' +
      'Ödemeyi orada rahatça yaparsınız.',
    cancelledSubject: `Rezervasyon iptal edildi, ${BRAND}`,
    cancelledLead: (ref) =>
      `${ref} numaralı rezervasyonunuz iptal edildi. Parçalar yeniden satışa açık.`,
    cancelledClose: 'Dilediğiniz zaman yeniden rezerve edebilirsiniz. Her zaman buradayız.',
  },

  fr: {
    dir: 'ltr',
    tagline: 'Métaux précieux et pièces de collection',
    operatorLine: `${BRAND}, exploité par ${OPERATOR}, ${ADDRESS}, Allemagne`,
    courtesyNote: "Ce message est une traduction de courtoisie. La langue du contrat est l'allemand.",
    openingHoursLabel: 'Horaires',
    openingHours: 'Lun à jeu 15:00 à 18:30, ven 15:00 à 19:00',
    greetNamed: (n) => `Bonjour ${n},`,
    greetPlain: 'Bonjour,',
    welcomeSubject: `Bienvenue chez ${BRAND}`,
    welcomeLead: `Bienvenue chez ${BRAND}. Votre compte est prêt.`,
    welcomeBody:
      'Vous pouvez dès maintenant parcourir nos pièces, garder vos favorites et les réserver ' +
      'pour un retrait en boutique. Chaque pièce est unique, vérifiée et choisie avec soin.',
    welcomeClose: 'Au plaisir de vous accueillir.',
    reservationSubject: (ref) => `Votre réservation ${ref} chez ${BRAND}`,
    pieces: (n) => (n === 1 ? 'une pièce' : `${n} pièces`),
    reservationLead: (p) =>
      `Nous avons bien reçu votre réservation. Nous gardons ${p} en boutique pendant trois jours.`,
    refLabel: 'Numéro de réservation',
    totalLabel: 'Valeur totale',
    euro: 'euros',
    reservationClose:
      "Merci d'indiquer le numéro de réservation lors du retrait en boutique. " +
      'Le paiement se fait tranquillement sur place.',
    cancelledSubject: `Réservation annulée, ${BRAND}`,
    cancelledLead: (ref) =>
      `Votre réservation ${ref} a été annulée. Les pièces sont de nouveau disponibles.`,
    cancelledClose:
      'Vous pouvez réserver à nouveau quand vous le souhaitez. Nous restons à votre disposition.',
  },

  es: {
    dir: 'ltr',
    tagline: 'Metales preciosos y piezas de colección',
    operatorLine: `${BRAND}, gestionado por ${OPERATOR}, ${ADDRESS}, Alemania`,
    courtesyNote:
      'Este mensaje es una traducción de cortesía. El idioma del contrato es el alemán.',
    openingHoursLabel: 'Horario',
    openingHours: 'Lun a jue 15:00 a 18:30, vie 15:00 a 19:00',
    greetNamed: (n) => `Hola ${n},`,
    greetPlain: 'Hola,',
    welcomeSubject: `Bienvenido a ${BRAND}`,
    welcomeLead: `Bienvenido a ${BRAND}. Tu cuenta ya está lista.`,
    welcomeBody:
      'Desde ahora puedes explorar nuestras piezas, guardar tus favoritas y reservarlas para ' +
      'recogerlas en la tienda. Cada pieza es única, revisada y elegida con cuidado.',
    welcomeClose: 'Te esperamos con mucho gusto.',
    reservationSubject: (ref) => `Tu reserva ${ref} en ${BRAND}`,
    pieces: (n) => (n === 1 ? 'una pieza' : `${n} piezas`),
    reservationLead: (p) =>
      `Hemos recibido tu reserva. Te guardamos ${p} en la tienda durante tres días.`,
    refLabel: 'Número de reserva',
    totalLabel: 'Valor total',
    euro: 'euros',
    reservationClose:
      'Indica el número de reserva al recoger en la tienda. Pagas cómodamente allí mismo.',
    cancelledSubject: `Reserva cancelada, ${BRAND}`,
    cancelledLead: (ref) =>
      `Tu reserva ${ref} ha sido cancelada. Las piezas vuelven a estar disponibles.`,
    cancelledClose: 'Puedes reservar de nuevo cuando quieras. Estamos a tu disposición.',
  },

  it: {
    dir: 'ltr',
    tagline: 'Metalli preziosi e pezzi da collezione',
    operatorLine: `${BRAND}, gestito da ${OPERATOR}, ${ADDRESS}, Germania`,
    courtesyNote:
      'Questo messaggio è una traduzione di cortesia. La lingua del contratto è il tedesco.',
    openingHoursLabel: 'Orari di apertura',
    openingHours: 'Lun a gio 15:00 a 18:30, ven 15:00 a 19:00',
    greetNamed: (n) => `Buongiorno ${n},`,
    greetPlain: 'Buongiorno,',
    welcomeSubject: `Benvenuto da ${BRAND}`,
    welcomeLead: `Benvenuto da ${BRAND}. Il tuo account è pronto.`,
    welcomeBody:
      'Da ora puoi sfogliare i nostri pezzi, salvare i preferiti e prenotarli per il ritiro ' +
      'in negozio. Ogni pezzo è unico, verificato e scelto con cura.',
    welcomeClose: 'Ti aspettiamo volentieri.',
    reservationSubject: (ref) => `La tua prenotazione ${ref} da ${BRAND}`,
    pieces: (n) => (n === 1 ? 'un pezzo' : `${n} pezzi`),
    reservationLead: (p) =>
      `Abbiamo ricevuto la tua prenotazione. Teniamo ${p} in negozio per tre giorni.`,
    refLabel: 'Numero di prenotazione',
    totalLabel: 'Valore totale',
    euro: 'euro',
    reservationClose:
      'Basta indicare il numero di prenotazione al ritiro in negozio. Paghi con calma sul posto.',
    cancelledSubject: `Prenotazione annullata, ${BRAND}`,
    cancelledLead: (ref) =>
      `La tua prenotazione ${ref} è stata annullata. I pezzi sono di nuovo disponibili.`,
    cancelledClose: 'Puoi prenotare di nuovo quando vuoi. Siamo sempre a disposizione.',
  },

  nl: {
    dir: 'ltr',
    tagline: 'Edelmetalen en verzamelstukken',
    operatorLine: `${BRAND}, geëxploiteerd door ${OPERATOR}, ${ADDRESS}, Duitsland`,
    courtesyNote: 'Dit bericht is een vertaling ter informatie. De contracttaal is Duits.',
    openingHoursLabel: 'Openingstijden',
    openingHours: 'Ma tot do 15:00 tot 18:30, vr 15:00 tot 19:00',
    greetNamed: (n) => `Hallo ${n},`,
    greetPlain: 'Hallo,',
    welcomeSubject: `Welkom bij ${BRAND}`,
    welcomeLead: `Welkom bij ${BRAND}. Je account staat klaar.`,
    welcomeBody:
      'Vanaf nu kun je onze stukken bekijken, favorieten bewaren en reserveren om af te halen ' +
      'in de winkel. Elk stuk is uniek, gecontroleerd en met zorg gekozen.',
    welcomeClose: 'We zien je graag in de winkel.',
    reservationSubject: (ref) => `Je reservering ${ref} bij ${BRAND}`,
    pieces: (n) => (n === 1 ? 'één stuk' : `${n} stuks`),
    reservationLead: (p) =>
      `We hebben je reservering ontvangen. We leggen ${p} drie dagen apart in de winkel.`,
    refLabel: 'Reserveringsnummer',
    totalLabel: 'Totale waarde',
    euro: 'euro',
    reservationClose:
      'Noem het reserveringsnummer bij het afhalen in de winkel. Je betaalt gewoon ter plekke.',
    cancelledSubject: `Reservering geannuleerd, ${BRAND}`,
    cancelledLead: (ref) =>
      `Je reservering ${ref} is geannuleerd. De stukken zijn weer beschikbaar.`,
    cancelledClose: 'Je kunt altijd opnieuw reserveren. We staan voor je klaar.',
  },

  pl: {
    dir: 'ltr',
    tagline: 'Metale szlachetne i przedmioty kolekcjonerskie',
    operatorLine: `${BRAND}, prowadzone przez ${OPERATOR}, ${ADDRESS}, Niemcy`,
    courtesyNote: 'Ta wiadomość jest tłumaczeniem informacyjnym. Językiem umowy jest niemiecki.',
    openingHoursLabel: 'Godziny otwarcia',
    openingHours: 'Pon do czw 15:00 do 18:30, pt 15:00 do 19:00',
    greetNamed: (n) => `Dzień dobry ${n},`,
    greetPlain: 'Dzień dobry,',
    welcomeSubject: `Witamy w ${BRAND}`,
    welcomeLead: `Witamy w ${BRAND}. Twoje konto jest gotowe.`,
    welcomeBody:
      'Od teraz możesz przeglądać nasze przedmioty, zapisywać ulubione i rezerwować je do ' +
      'odbioru w sklepie. Każdy przedmiot jest jedyny w swoim rodzaju, sprawdzony i starannie wybrany.',
    welcomeClose: 'Czekamy na Twoją wizytę.',
    reservationSubject: (ref) => `Twoja rezerwacja ${ref} w ${BRAND}`,
    pieces: (n) => {
      if (n === 1) return 'jeden przedmiot';
      const last = n % 10;
      const two = n % 100;
      if (last >= 2 && last <= 4 && !(two >= 12 && two <= 14)) return `${n} przedmioty`;
      return `${n} przedmiotów`;
    },
    reservationLead: (p) =>
      `Otrzymaliśmy Twoją rezerwację. Odkładamy ${p} w sklepie na trzy dni.`,
    refLabel: 'Numer rezerwacji',
    totalLabel: 'Wartość łączna',
    euro: 'euro',
    reservationClose:
      'Prosimy podać numer rezerwacji przy odbiorze w sklepie. Zapłacisz wygodnie na miejscu.',
    cancelledSubject: `Rezerwacja anulowana, ${BRAND}`,
    cancelledLead: (ref) =>
      `Twoja rezerwacja ${ref} została anulowana. Przedmioty są znowu dostępne.`,
    cancelledClose: 'Możesz zarezerwować ponownie w dowolnej chwili. Chętnie pomożemy.',
  },

  pt: {
    dir: 'ltr',
    tagline: 'Metais preciosos e peças de coleção',
    operatorLine: `${BRAND}, explorado por ${OPERATOR}, ${ADDRESS}, Alemanha`,
    courtesyNote:
      'Esta mensagem é uma tradução de cortesia. A língua do contrato é o alemão.',
    openingHoursLabel: 'Horário',
    openingHours: 'Seg a qui 15:00 a 18:30, sex 15:00 a 19:00',
    greetNamed: (n) => `Olá ${n},`,
    greetPlain: 'Olá,',
    welcomeSubject: `Bem vindo à ${BRAND}`,
    welcomeLead: `Bem vindo à ${BRAND}. A sua conta está pronta.`,
    welcomeBody:
      'A partir de agora pode explorar as nossas peças, guardar as favoritas e reservar o que ' +
      'quiser para levantamento na loja. Cada peça é única, verificada e escolhida com cuidado.',
    welcomeClose: 'Teremos muito gosto na sua visita.',
    reservationSubject: (ref) => `A sua reserva ${ref} na ${BRAND}`,
    pieces: (n) => (n === 1 ? 'uma peça' : `${n} peças`),
    reservationLead: (p) =>
      `Recebemos a sua reserva. Guardamos ${p} na loja durante três dias.`,
    refLabel: 'Número da reserva',
    totalLabel: 'Valor total',
    euro: 'euros',
    reservationClose:
      'Basta indicar o número da reserva no levantamento na loja. ' +
      'O pagamento é feito com toda a calma no local.',
    cancelledSubject: `Reserva cancelada, ${BRAND}`,
    cancelledLead: (ref) =>
      `A sua reserva ${ref} foi cancelada. As peças estão novamente disponíveis.`,
    cancelledClose: 'Pode reservar de novo quando quiser. Estamos ao seu dispor.',
  },

  da: {
    dir: 'ltr',
    tagline: 'Ædelmetaller og samlerobjekter',
    operatorLine: `${BRAND}, drives af ${OPERATOR}, ${ADDRESS}, Tyskland`,
    courtesyNote: 'Denne besked er en oversættelse til orientering. Aftalesproget er tysk.',
    openingHoursLabel: 'Åbningstider',
    openingHours: 'Man til tor 15:00 til 18:30, fre 15:00 til 19:00',
    greetNamed: (n) => `Hej ${n},`,
    greetPlain: 'Hej,',
    welcomeSubject: `Velkommen til ${BRAND}`,
    welcomeLead: `Velkommen til ${BRAND}. Din konto er klar.`,
    welcomeBody:
      'Fra nu af kan du kigge på vores varer, gemme favoritter og reservere dem til afhentning ' +
      'i butikken. Hver vare er unik, gennemgået og udvalgt med omhu.',
    welcomeClose: 'Vi glæder os til dit besøg.',
    reservationSubject: (ref) => `Din reservation ${ref} hos ${BRAND}`,
    pieces: (n) => (n === 1 ? 'en vare' : `${n} varer`),
    reservationLead: (p) =>
      `Vi har modtaget din reservation. Vi lægger ${p} til side i butikken i tre dage.`,
    refLabel: 'Reservationsnummer',
    totalLabel: 'Samlet værdi',
    euro: 'euro',
    reservationClose:
      'Nævn blot reservationsnummeret ved afhentning i butikken. Du betaler nemt på stedet.',
    cancelledSubject: `Reservation annulleret, ${BRAND}`,
    cancelledLead: (ref) => `Din reservation ${ref} er annulleret. Varerne er ledige igen.`,
    cancelledClose: 'Du kan reservere igen når som helst. Vi er her for dig.',
  },

  sv: {
    dir: 'ltr',
    tagline: 'Ädelmetaller och samlarobjekt',
    operatorLine: `${BRAND}, drivs av ${OPERATOR}, ${ADDRESS}, Tyskland`,
    courtesyNote: 'Detta meddelande är en översättning för information. Avtalsspråket är tyska.',
    openingHoursLabel: 'Öppettider',
    openingHours: 'Mån till tors 15:00 till 18:30, fre 15:00 till 19:00',
    greetNamed: (n) => `Hej ${n},`,
    greetPlain: 'Hej,',
    welcomeSubject: `Välkommen till ${BRAND}`,
    welcomeLead: `Välkommen till ${BRAND}. Ditt konto är klart.`,
    welcomeBody:
      'Från och med nu kan du bläddra bland våra föremål, spara favoriter och reservera dem för ' +
      'upphämtning i butiken. Varje föremål är unikt, kontrollerat och utvalt med omsorg.',
    welcomeClose: 'Vi ser fram emot ditt besök.',
    reservationSubject: (ref) => `Din reservation ${ref} hos ${BRAND}`,
    pieces: (n) => (n === 1 ? 'ett föremål' : `${n} föremål`),
    reservationLead: (p) =>
      `Vi har fått din reservation. Vi lägger undan ${p} i butiken i tre dagar.`,
    refLabel: 'Reservationsnummer',
    totalLabel: 'Totalt värde',
    euro: 'euro',
    reservationClose:
      'Nämn reservationsnumret vid upphämtningen i butiken. Du betalar bekvämt på plats.',
    cancelledSubject: `Reservation avbokad, ${BRAND}`,
    cancelledLead: (ref) => `Din reservation ${ref} är avbokad. Föremålen är tillgängliga igen.`,
    cancelledClose: 'Du kan reservera igen när du vill. Vi finns här för dig.',
  },

  uk: {
    dir: 'ltr',
    tagline: 'Дорогоцінні метали та колекційні речі',
    operatorLine: `${BRAND}, керує ${OPERATOR}, ${ADDRESS}, Німеччина`,
    courtesyNote: 'Це повідомлення є перекладом для зручності. Мовою договору є німецька.',
    openingHoursLabel: 'Години роботи',
    openingHours: 'Пн до чт 15:00 до 18:30, пт 15:00 до 19:00',
    greetNamed: (n) => `Доброго дня, ${n},`,
    greetPlain: 'Доброго дня,',
    welcomeSubject: `Вітаємо у ${BRAND}`,
    welcomeLead: `Вітаємо у ${BRAND}. Ваш обліковий запис готовий.`,
    welcomeBody:
      'Відтепер ви можете переглядати наші речі, зберігати улюблені та бронювати їх для ' +
      'отримання в магазині. Кожна річ унікальна, перевірена та дібрана з увагою.',
    welcomeClose: 'Будемо раді вашому візиту.',
    reservationSubject: (ref) => `Ваше бронювання ${ref} у ${BRAND}`,
    pieces: (n) => {
      if (n === 1) return 'одну річ';
      const last = n % 10;
      const two = n % 100;
      if (last >= 2 && last <= 4 && !(two >= 12 && two <= 14)) return `${n} речі`;
      return `${n} речей`;
    },
    reservationLead: (p) =>
      `Ми отримали ваше бронювання. Ми відкладемо ${p} у магазині на три дні.`,
    refLabel: 'Номер бронювання',
    totalLabel: 'Загальна вартість',
    euro: 'євро',
    reservationClose:
      'Будь ласка, назвіть номер бронювання під час отримання в магазині. Оплата зручно на місці.',
    cancelledSubject: `Бронювання скасовано, ${BRAND}`,
    cancelledLead: (ref) => `Ваше бронювання ${ref} скасовано. Речі знову доступні.`,
    cancelledClose: 'Ви можете забронювати знову будь коли. Ми завжди раді допомогти.',
  },
};

/** The letter's voice for one reader. Never null: German is the floor. */
export function emailCopy(locale: string | null | undefined): EmailCopy {
  return COPY[normalizeEmailLocale(locale)];
}
