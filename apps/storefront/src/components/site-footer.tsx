import { MapPin, Phone, Clock, Instagram, Facebook } from "lucide-react";
import { BrandPlaque, BrandRule } from "@/components/brand/marks";
import {
  VisaIcon, MastercardIcon, PaypalIcon, ApplePayIcon, GooglePayIcon, KlarnaIcon, SepaIcon, WhatsAppIcon,
} from "@/components/brand-icons";

const cols = [
  {
    title: "Kollektion",
    links: [
      { label: "Goldmünzen", href: "/kategorien/goldmuenzen" },
      { label: "Silbermünzen", href: "/kategorien/silbermuenzen" },
      { label: "Goldbarren", href: "/kategorien/goldbarren" },
      { label: "Antiquitäten", href: "/kategorien/antiquitaeten" },
      { label: "Schmuck", href: "/kategorien/schmuck" },
      { label: "Briefmarken", href: "/kategorien/briefmarken" },
    ],
  },
  {
    title: "Service",
    links: [
      { label: "Termin vereinbaren", href: "/termin" },
      { label: "Goldankauf", href: "/goldankauf" },
      { label: "Bewertung & Schätzung", href: "/goldankauf" },
      { label: "Versand & Rückgabe", href: "/agb" },
      { label: "Echtheitsgarantie", href: "/ueber-uns" },
      { label: "Kontakt", href: "/kontakt" },
      { label: "FAQ", href: "/goldankauf#faq" },
    ],
  },
];

const legal = [
  { label: "Impressum", href: "/impressum" },
  { label: "Datenschutzerklärung", href: "/datenschutz" },
  { label: "AGB", href: "/agb" },
  { label: "Widerrufsrecht", href: "/widerruf" },
];
const pay = [VisaIcon, MastercardIcon, PaypalIcon, ApplePayIcon, GooglePayIcon, KlarnaIcon, SepaIcon];

export function SiteFooter() {
  return (
    <footer className="border-t border-rule bg-surface text-ink-aged">
      <div className="mx-auto max-w-edge px-5 pb-w14-4 pt-section sm:px-6">
        {/* MOBILE-FIRST: one calm column on a phone (brand → links → links →
            contact), opening to a 4-track grid only at lg. The two link
            columns ride side-by-side already at sm to use the phone width well. */}
        <div className="grid gap-w14-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.1fr]">
          {/* brand: the full registered plaque carries name, trade line and
              loupe in one drawing, so no extra logo+descriptor duplication */}
          <div className="sm:col-span-2 lg:col-span-1">
            <BrandPlaque className="w-44 max-w-full text-ink sm:w-48" />
            {/* Social row: all three rest as the same quiet ink-outline circle.
                Only WhatsApp may reveal its brand green, and only on hover or
                focus (recognition without breaking the palette at rest).
                44px circles keep the touch targets honest. */}
            <div className="mt-w14-3 flex gap-2">
              <a
                href="#"
                className="grid h-11 w-11 place-items-center rounded-full border border-ink/15 text-ink-faded transition-colors duration-fast ease-hover hover:border-ink hover:text-ink focus-visible:border-ink focus-visible:text-ink"
                aria-label="Instagram"
              >
                <Instagram className="h-[18px] w-[18px]" aria-hidden="true" />
              </a>
              <a
                href="#"
                className="grid h-11 w-11 place-items-center rounded-full border border-ink/15 text-ink-faded transition-colors duration-fast ease-hover hover:border-ink hover:text-ink focus-visible:border-ink focus-visible:text-ink"
                aria-label="Facebook"
              >
                <Facebook className="h-[18px] w-[18px]" aria-hidden="true" />
              </a>
              <a
                href="#"
                aria-label="WhatsApp"
                title="WhatsApp · bald mit Chatbot & KI"
                className="grid h-11 w-11 place-items-center rounded-full border border-ink/15 text-ink-faded transition-colors duration-fast ease-hover hover:border-[#25D366] hover:text-[#25D366] focus-visible:border-[#25D366] focus-visible:text-[#25D366]"
              >
                <WhatsAppIcon className="h-[18px] w-[18px]" />
              </a>
            </div>
          </div>

          {cols.map((c) => (
            <div key={c.title}>
              <h4 className="eyebrow mb-w14-2 text-ink">{c.title}</h4>
              <ul className="text-sm">
                {c.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} className="inline-flex min-h-[44px] items-center text-ink-faded transition-colors duration-fast ease-hover hover:text-ink">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* contact */}
          <div>
            <h4 className="eyebrow mb-w14-3 text-ink">Kontor</h4>
            <ul className="space-y-3 text-sm text-ink-faded">
              <li className="flex gap-2.5">
                <MapPin className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ink-aged" aria-hidden="true" />
                <span>Musterstraße 14<br />73614 Schorndorf</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Phone className="h-[18px] w-[18px] shrink-0 text-ink-aged" aria-hidden="true" />
                <span className="tnum">+49 (0)7181 000000</span>
              </li>
              <li className="flex gap-2.5">
                <Clock className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ink-aged" aria-hidden="true" />
                <span>Mo bis Fr 10 bis 18 Uhr<br />Sa 10 bis 14 Uhr</span>
              </li>
            </ul>
          </div>
        </div>

        {/* the house rule (hairline ◆ hairline) closes the link columns,
            quiet and centred, before payments and the legal row */}
        <BrandRule className="mx-auto mt-w14-5 block w-44 text-ink/25" />

        {/* payment + legal — stacks on a phone (payments, then legal links),
            sits on one row from md up. */}
        <div className="mt-w14-4 flex flex-col gap-w14-3 md:flex-row md:items-center md:justify-between md:gap-6">
          <section aria-label="Akzeptierte Zahlungsmethoden" className="flex flex-wrap items-center gap-2">
            {pay.map((Icon, i) => (
              <Icon key={i} className="h-8 w-12 shrink-0" />
            ))}
          </section>
          <ul className="flex flex-wrap gap-x-5 text-sm">
            {legal.map((l) => (
              <li key={l.label}>
                <a href={l.href} className="inline-flex min-h-[44px] items-center text-ink-faded transition-colors duration-fast ease-hover hover:text-ink">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-w14-3 flex flex-col items-start justify-between gap-1.5 text-xs leading-relaxed text-ink-faded/90 sm:flex-row sm:items-center sm:gap-2">
          <p>© 2026 warehouse14 · Alle Preise inkl. ggf. Differenzbesteuerung (§ 25a UStG).</p>
          <p className="italic">Vorschau-Build · Platzhalter-Daten (Identität &amp; USt-IdNr folgen)</p>
        </div>
      </div>
    </footer>
  );
}
