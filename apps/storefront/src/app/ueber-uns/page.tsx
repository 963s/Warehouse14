import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { Kicker } from "@/components/brand/kicker";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = {
  title: "Über uns | warehouse14 Schorndorf",
  description:
    "Ihr Fachgeschäft für Antiquitäten, Briefmarken, Münzen und Gold in Schorndorf. Persönliche Beratung, Echtheitsgarantie und Goldankauf zu tagesaktuellen Preisen.",
};

const stats: { value: string; label: string }[] = [
  { value: "Schorndorf", label: "Standort" },
  { value: "100 %", label: "Echtheitsgarantie" },
  { value: "Tagespreis", label: "Goldankauf" },
  { value: "Persönlich", label: "Beratung" },
];

export default function UeberUnsPage() {
  return (
    <PageShell>
      <article className="mx-auto max-w-3xl px-5 py-16 md:py-24">
        {/* Hero */}
        <Reveal>
          {/* the house kicker, full trade: "Goldhaus" sold the Kontor short,
           * Gold ist ein Teil des Hauses, nie das ganze. */}
          <Kicker className="mb-3">
            Antiquitäten, Briefmarken &amp; Münzen in Schorndorf
          </Kicker>
          <h1 className="font-display text-4xl md:text-5xl font-semibold text-ink mb-6 leading-tight">
            Ein Haus, das Zeit versteht.
          </h1>
          <p className="measure text-ink-aged leading-relaxed text-lg">
            Manche Dinge gewinnen mit den Jahren. Gold, alte Münzen, seltene
            Briefmarken, ein gut gearbeitetes Silberstück. Und das Vertrauen, das entsteht, wenn
            man weiß, mit wem man es zu tun hat. warehouse14 steht in
            Schorndorf für genau das: Sachkenntnis, Ehrlichkeit und eine
            echte Leidenschaft für das, was wir tun.
          </p>
        </Reveal>

        <div className="my-12 border-t border-rule" />

        {/* Stats */}
        <Reveal delay={0.05}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
            {stats.map(({ value, label }) => (
              <div
                key={label}
                className="flex min-w-0 flex-col gap-1 rounded-card border border-rule bg-card px-2 py-6 shadow-card"
              >
                {/* whole words only: break-words once sliced "Schorndo/rf" and
                 * "Tagesprei/s" mid-word. The clamp is sized to the tightest
                 * tile (4-up just past 640px), so the longest value fits on
                 * one line at every width. */}
                <span className="whitespace-nowrap font-display text-[clamp(1.0625rem,0.55rem+1.3vw,1.375rem)] font-semibold leading-tight text-ink">
                  {value}
                </span>
                <span className="whitespace-nowrap text-[clamp(0.75rem,0.45rem+0.65vw,0.875rem)] text-ink-faded">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </Reveal>

        <div className="my-12 border-t border-rule" />

        {/* Story */}
        <Reveal delay={0.08}>
          <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink mb-5">
            Wie alles begann
          </h2>
          <div className="measure space-y-4 text-ink-aged leading-relaxed">
            <p>
              Was als kleines Spezialgeschäft für Münzen und Edelmetalle in
              Schorndorf begann, ist heute ein gewachsenes Fachhaus, das Gold,
              Silber, Numismatik und ausgesuchte Antiquitäten unter einem Dach
              vereint. Mit den Jahren haben wir gelernt, was wirklich
              zählt: nicht der schnelle Abschluss, sondern die ruhige, fundierte
              Beratung, bei der Sie am Ende sicher entscheiden können.
            </p>
            <p>
              Die Region schenkt uns ihr Vertrauen, weil wir hier verwurzelt
              sind. Kunden kommen manchmal mit einem Erbstück, manchmal mit
              einer Sammlung, manchmal einfach mit einer Frage. Jede davon nehmen
              wir ernst.
            </p>
          </div>
        </Reveal>

        <div className="my-12 border-t border-rule" />

        {/* Expertise */}
        <Reveal delay={0.06}>
          <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink mb-5">
            Unsere Sachkunde
          </h2>
          <div className="measure space-y-4 text-ink-aged leading-relaxed">
            <p>
              Gold und Edelmetalle sind unser tägliches Handwerk. Wir kennen
              Feingehalt, Marktpreis und Geschichte jedes Stücks, das uns
              vorgelegt wird. Gleiches gilt für Numismatik und Philatelie:
              antike Münzen, Gedenkprägungen, Briefmarken, Raritäten aus
              aller Welt. Wir schätzen sachlich
              und transparent, ohne Druck und ohne Übervorteilung.
            </p>
            <p>
              Antiquitäten erfordern einen anderen Blick, aber dieselbe
              Sorgfalt. Möbel, Schmuck, Uhren, Kunsthandwerk. Wir nehmen uns
              die Zeit, ein Objekt wirklich zu verstehen, bevor wir es bewerten
              oder zum Kauf anbieten.
            </p>
          </div>
        </Reveal>

        <div className="my-12 border-t border-rule" />

        {/* Values */}
        <Reveal delay={0.06}>
          <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink mb-6">
            Was uns leitet
          </h2>
          <div className="grid sm:grid-cols-3 gap-5">
            {[
              {
                title: "Natur und Beständigkeit",
                body: "Gold wächst nicht in Fabriken. Es entsteht in der Erde, über Millionen von Jahren. Eine alte Münze, eine Briefmarke, ein Möbelstück tragen dieselbe Tiefe der Zeit in sich. Diese Nähe zum Echten und Dauerhaften prägt unsere Haltung gegenüber jedem Stück, das wir in den Händen halten.",
              },
              {
                title: "Zeit als Wert",
                body: "Wir eilen nicht. Eine gute Schätzung braucht Stille und Konzentration. Wer zu uns kommt, bekommt unsere volle Aufmerksamkeit, kein Gehetze, kein Standardzettel.",
              },
              {
                title: "Handwerk und Ehrlichkeit",
                body: "Jedes Edelmetall, jede Münze, jede Antiquität erzählt eine Geschichte. Wir sind ehrlich über das, was wir sehen, und ebenso ehrlich über das, was wir nicht wissen.",
              },
            ].map(({ title, body }) => (
              <div
                key={title}
                className="flex flex-col gap-3 rounded-card border border-rule bg-card p-6 shadow-card"
              >
                <h3 className="font-display text-xl font-semibold text-ink">
                  {title}
                </h3>
                <p className="text-ink-aged leading-relaxed text-sm">{body}</p>
              </div>
            ))}
          </div>
        </Reveal>

        <div className="my-12 border-t border-rule" />

        {/* Guarantees */}
        <Reveal delay={0.06}>
          <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink mb-5">
            Unser Versprechen an Sie
          </h2>
          <div className="measure space-y-4 text-ink-aged leading-relaxed">
            <p>
              Alles, was wir verkaufen, verlässt unser Haus mit einer klaren
              Echtheitsgarantie. Wir stehen mit unserem Namen dafür ein, dass
              Edelmetalle echt, Münzen wie beschrieben und Antiquitäten so sind,
              wie wir sie vorstellen. Sollte einmal etwas nicht stimmen, lösen
              wir es. Unkompliziert.
            </p>
            <p>
              Versand ist versichert, sorgfältig verpackt und diskret. Ob eine
              einzelne Goldmünze oder eine größere Sammlung, alles kommt
              sicher bei Ihnen an.
            </p>
          </div>
        </Reveal>

        <div className="my-12 border-t border-rule" />

        {/* Goldankauf */}
        <Reveal delay={0.06}>
          <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink mb-5">
            Goldankauf zu Tagespreisen
          </h2>
          <div className="measure space-y-4 text-ink-aged leading-relaxed">
            <p>
              Sie möchten Gold, Silber oder Platin verkaufen? Wir zahlen den
              tagesaktuellen Marktpreis, immer fair, immer transparent. Kein
              Kleingedrucktes, keine versteckten Abzüge. Bringen Sie Ihr Gold
              vorbei oder fragen Sie vorab per E-Mail an. Wir erklären Ihnen,
              wie sich der Preis zusammensetzt, und Sie entscheiden, ohne
              Zeitdruck.
            </p>
            <p>
              Ankauf auf Augenhöhe: das ist unser Ansatz seit dem ersten Tag.
            </p>
          </div>

          {/* CTA */}
          <div className="mt-8 flex flex-wrap gap-4">
            <a
              href="/kontakt"
              className="inline-flex min-h-[48px] items-center justify-center rounded-button bg-ink px-7 py-3 text-sm font-medium text-white transition-colors duration-fast ease-hover hover:bg-ink-aged focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
            >
              Kontakt aufnehmen
            </a>
            <a
              href="/goldankauf"
              className="inline-flex min-h-[48px] items-center justify-center rounded-button border border-rule px-7 py-3 text-sm font-medium text-ink transition-colors duration-fast ease-hover hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
            >
              Zum Goldankauf
            </a>
          </div>
        </Reveal>
      </article>
    </PageShell>
  );
}
