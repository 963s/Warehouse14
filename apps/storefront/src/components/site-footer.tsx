import { MapPin, Phone, Clock, Instagram, Facebook } from "lucide-react";
import { Logo } from "@/components/logo";
import {
  VisaIcon, MastercardIcon, PaypalIcon, ApplePayIcon, GooglePayIcon, KlarnaIcon, SepaIcon, WhatsAppIcon,
} from "@/components/brand-icons";

const cols = [
  {
    title: "Kollektion",
    links: [
      { label: "Goldmünzen", href: "#" },
      { label: "Silbermünzen", href: "#" },
      { label: "Goldbarren", href: "#" },
      { label: "Antiquitäten", href: "#" },
      { label: "Schmuck", href: "#" },
      { label: "Briefmarken", href: "#" },
    ],
  },
  {
    title: "Service",
    links: [
      { label: "Termin vereinbaren", href: "/termin" },
      { label: "Goldankauf", href: "/goldankauf" },
      { label: "Bewertung & Schätzung", href: "#" },
      { label: "Versand & Rückgabe", href: "#" },
      { label: "Echtheitsgarantie", href: "#" },
      { label: "Kontakt", href: "/kontakt" },
      { label: "FAQ", href: "#" },
    ],
  },
];

const legal = ["Impressum", "Datenschutzerklärung", "AGB", "Widerrufsrecht"];
const pay = [VisaIcon, MastercardIcon, PaypalIcon, ApplePayIcon, GooglePayIcon, KlarnaIcon, SepaIcon];

export function SiteFooter() {
  return (
    <footer className="bg-[#14110b] text-white/70">
      {/* hairline gilt edge so the footer reads as a deliberate close, not a void */}
      <div className="bg-gold-gradient h-px w-full opacity-30" aria-hidden="true" />
      <div className="mx-auto max-w-edge px-5 pb-w14-4 pt-section sm:px-6">
        {/* MOBILE-FIRST: one calm column on a phone (brand → links → links →
            contact), opening to a 4-track grid only at lg. The two link
            columns ride side-by-side already at sm to use the phone width well. */}
        <div className="grid gap-w14-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.1fr]">
          {/* brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <Logo className="text-white" />
            <p className="mt-w14-3 max-w-sm text-sm leading-relaxed text-white/55">
              Das Kontor für Anlagegold, seltene Münzen und geprüfte Antiquitäten.
              Sachkundig, fair und versichert — Ihr Goldhaus in Schorndorf.
            </p>
            <div className="mt-w14-3 flex gap-2">
              <a
                href="#"
                className="grid h-10 w-10 place-items-center rounded-full border border-white/12 text-white/60 transition-colors duration-fast ease-hover hover:border-gold hover:text-gold"
                aria-label="Instagram"
              >
                <Instagram className="h-[18px] w-[18px]" aria-hidden="true" />
              </a>
              <a
                href="#"
                className="grid h-10 w-10 place-items-center rounded-full border border-white/12 text-white/60 transition-colors duration-fast ease-hover hover:border-gold hover:text-gold"
                aria-label="Facebook"
              >
                <Facebook className="h-[18px] w-[18px]" aria-hidden="true" />
              </a>
              <a
                href="#"
                aria-label="WhatsApp"
                title="WhatsApp · bald mit Chatbot & KI"
                className="grid h-10 w-10 place-items-center rounded-full border border-[#25D366]/40 text-[#25D366] transition-colors duration-fast ease-hover hover:bg-[#25D366] hover:text-white"
              >
                <WhatsAppIcon className="h-[18px] w-[18px]" />
              </a>
            </div>
          </div>

          {cols.map((c) => (
            <div key={c.title}>
              <h4 className="eyebrow mb-w14-2 text-white">{c.title}</h4>
              <ul className="text-sm">
                {c.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} className="inline-flex min-h-[44px] items-center text-white/55 transition-colors duration-fast ease-hover hover:text-gold">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* contact */}
          <div>
            <h4 className="eyebrow mb-w14-3 text-white">Kontor</h4>
            <ul className="space-y-3 text-sm text-white/55">
              <li className="flex gap-2.5">
                <MapPin className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gold" aria-hidden="true" />
                <span>Musterstraße 14<br />73614 Schorndorf</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Phone className="h-[18px] w-[18px] shrink-0 text-gold" aria-hidden="true" />
                <span className="tnum">+49 (0)7181 000000</span>
              </li>
              <li className="flex gap-2.5">
                <Clock className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gold" aria-hidden="true" />
                <span>Mo–Fr 10–18 Uhr<br />Sa 10–14 Uhr</span>
              </li>
            </ul>
          </div>
        </div>

        {/* payment + legal — stacks on a phone (payments, then legal links),
            sits on one row from md up. */}
        <div className="mt-w14-5 flex flex-col gap-w14-3 border-t border-white/10 pt-w14-4 md:flex-row md:items-center md:justify-between md:gap-6">
          <section aria-label="Akzeptierte Zahlungsmethoden" className="flex flex-wrap items-center gap-2">
            {pay.map((Icon, i) => (
              <Icon key={i} className="h-8 w-12 shrink-0" />
            ))}
          </section>
          <ul className="flex flex-wrap gap-x-5 text-sm">
            {legal.map((l) => (
              <li key={l}>
                <a href="#" className="inline-flex min-h-[44px] items-center text-white/55 transition-colors duration-fast ease-hover hover:text-gold">
                  {l}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-w14-3 flex flex-col items-start justify-between gap-1.5 text-xs leading-relaxed text-white/40 sm:flex-row sm:items-center sm:gap-2">
          <p>© 2026 warehouse14 · Alle Preise inkl. ggf. Differenzbesteuerung (§25a UStG).</p>
          <p className="italic">Vorschau-Build · Platzhalter-Daten (Identität &amp; USt-IdNr folgen)</p>
        </div>
      </div>
    </footer>
  );
}
