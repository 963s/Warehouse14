import { ArrowRight } from "lucide-react";
import { Kicker } from "@/components/brand/kicker";
import { BrandLoupeSketch } from "@/components/brand/marks";
import { EngravedCarton, engravedIconBySlug } from "@/components/brand/engraved-icons";
import { WhatsAppIcon } from "@/components/brand-icons";
import { Reveal, RevealChild, RevealGroup } from "@/components/ui/reveal";
import { waLink } from "@/lib/contact";

/**
 * THE NACHLASS BAND — the estate story as one composed band for the home
 * page. No dedicated estate route: this section carries the whole journey
 * (Karton bringen, Prüfung mit der Lupe, faires Angebot) in three beats,
 * drawn with the house engravings, and ends in the two honest actions:
 * Termin und WhatsApp. Server component; motion comes from Reveal only.
 */

/* The taler from the engraved set seals the third beat (the fair offer). */
const EngravedTaler = engravedIconBySlug["muenzen"] ?? EngravedCarton;

const BEATS = [
  {
    title: "Karton bringen",
    body: "Bringen Sie alles so, wie es ist. Unsortiert ist völlig in Ordnung, genau dafür sind wir da.",
    art: <EngravedCarton className="h-12 w-12" />,
  },
  {
    title: "Wir prüfen mit der Lupe",
    body: "Stück für Stück, mit Fachkenntnis und Ruhe. Wir sortieren, bestimmen und bewerten für Sie.",
    // The official hand-sketched loupe with its motion strokes — the
    // searching gesture itself, never redrawn. Wide aspect: width-capped on
    // phones (inside the 56px art box), height-set from sm up.
    art: <BrandLoupeSketch className="h-auto w-12 sm:h-9 sm:w-auto" />,
  },
  {
    title: "Faires Angebot",
    body: "Sie erhalten ein transparentes, unverbindliches Angebot. Bei Einigung zahlen wir sofort aus.",
    art: <EngravedTaler className="h-12 w-12" />,
  },
] as const;

export function NachlassBand() {
  return (
    <section
      id="nachlass"
      aria-labelledby="nachlass-titel"
      className="scroll-mt-24 border-y border-rule bg-raised py-section"
    >
      <div className="mx-auto max-w-edge px-5">
        <Reveal>
          <Kicker>Nachlass &amp; Sammlungen</Kicker>
          <h2
            id="nachlass-titel"
            className="mt-w14-3 font-display text-fluid-h2 font-medium leading-tight"
          >
            Sie haben einen Nachlass oder eine&nbsp;Sammlung?
          </h2>
          <p className="mt-w14-3 max-w-measure text-fluid-body leading-relaxed text-ink-aged">
            Bringen Sie uns den ganzen Karton. Wir sichten jedes Stück mit der
            Lupe, vom alten Ring bis zum Briefmarkenalbum, und sagen Ihnen
            ehrlich, was Ihre Schätze wert sind.
          </p>
        </Reveal>

        {/* The 3-beat journey — engraved miniatures, hairline-set columns.
            Phone: icon-left rows. From sm: three columns, separated by the
            quiet vertical rules of a printed instruction strip. */}
        <RevealGroup className="mt-w14-5">
          <ol className="grid gap-w14-4 sm:grid-cols-3 sm:gap-0">
            {BEATS.map((beat, i) => (
              <li
                key={beat.title}
                className={
                  i === 0
                    ? "sm:pr-w14-4"
                    : "sm:border-l sm:border-rule sm:px-w14-4"
                }
              >
                <RevealChild className="group flex h-full items-start gap-w14-3 sm:flex-col">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center text-ink sm:h-12 sm:w-auto sm:justify-start">
                    {beat.art}
                  </span>
                  <span className="min-w-0">
                    <span className="tnum block text-sm text-ink-faded">
                      0{i + 1}
                    </span>
                    <span className="mt-w14-1 block font-display text-fluid-h3 font-medium leading-snug text-ink">
                      {beat.title}
                    </span>
                    <span className="mt-w14-1 block max-w-measure text-sm leading-relaxed text-ink-aged">
                      {beat.body}
                    </span>
                  </span>
                </RevealChild>
              </li>
            ))}
          </ol>
        </RevealGroup>

        {/* The two actions: the booked half hour, or the direct line. The
            WhatsApp green stays reserved for icon and hover, never the frame. */}
        <Reveal delay={0.1}>
          <div className="mt-w14-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href="/termin"
              className="group/cta inline-flex min-h-[48px] items-center justify-center gap-2 rounded-button bg-ink px-6 py-3 text-sm font-semibold text-white transition-[background-color,transform] duration-fast ease-hover hover:-translate-y-px hover:bg-ink-aged"
            >
              Termin vereinbaren
              <ArrowRight
                className="h-[18px] w-[18px] transition-transform duration-base ease-hover group-hover/cta:translate-x-1"
                strokeWidth={1.8}
                aria-hidden="true"
              />
            </a>
            <a
              href={waLink(
                "Guten Tag, ich möchte einen Nachlass oder eine Sammlung bewerten lassen.",
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[48px] items-center justify-center gap-2.5 rounded-button border border-ink/25 bg-card px-6 py-3 text-sm font-medium text-ink transition-colors duration-fast ease-hover hover:border-[#25D366]/60"
            >
              <WhatsAppIcon className="h-[18px] w-[18px] text-[#25D366]" />
              Direkt per WhatsApp
            </a>
          </div>
          <p className="mt-w14-3 text-xs leading-relaxed text-ink-faded">
            Kostenlos und unverbindlich. Auch einzelne Stücke sind willkommen.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
