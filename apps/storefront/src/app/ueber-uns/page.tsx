import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = {
  title: "Über uns | warehouse14 Schorndorf",
  description:
    "Ihr Fachgeschäft in Schorndorf für Gold, Münzen und Antiquitäten. Persönliche Beratung, Echtheitsgarantie und Goldankauf zu tagesaktuellen Preisen.",
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
          <p className="smallcaps text-gold mb-3 tracking-widest text-sm">
            Ihr Goldhaus in Schorndorf
          </p>
          <h1 className="font-display text-4xl md:text-5xl font-semibold text-ink mb-6 leading-tight">
            Ein Haus, das Zeit versteht.
          </h1>
          <p className="text-ink-aged leading-relaxed text-lg max-w-2xl">
            Manche Dinge gewinnen mit den Jahren. Gold, alte Münzen, ein gut
            gearbeitetes Silberstück. Und das Vertrauen, das entsteht, wenn
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
                className="bg-card rounded-card shadow-card py-6 px-4 flex flex-col gap-1"
              >
                <span className="font-display text-3xl font-semibold text-gold">
                  {value}
                </span>
                <span className="text-ink-faded text-sm">{label}</span>
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
          <div className="space-y-4 text-ink-aged leading-relaxed">
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
          <div className="space-y-4 text-ink-aged leading-relaxed">
            <p>
              Gold und Edelmetalle sind unser tägliches Handwerk. Wir kennen
              Feingehalt, Marktpreis und Geschichte jedes Stücks, das uns
              vorgelegt wird. Gleiches gilt für die Numismatik: antike Münzen,
              Gedenkprägungen, Raritäten aus aller Welt. Wir schätzen sachlich
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
                body: "Gold wächst nicht in Fabriken. Es entsteht in der Erde, über Millionen von Jahren. Diese Nähe zur Natur, zum Echten und Dauerhaften, prägt unsere Haltung gegenüber jedem Stück, das wir in den Händen halten.",
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
                className="bg-card rounded-card shadow-card p-6 flex flex-col gap-3"
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
          <div className="space-y-4 text-ink-aged leading-relaxed">
            <p>
              Alles, was wir verkaufen, verläuft mit einer klaren
              Echtheitsgarantie. Wir stehen mit unserem Namen dafür ein, dass
              Edelmetalle echt, Münzen wie beschrieben und Antiquitäten so sind,
              wie wir sie vorstellen. Sollte einmal etwas nicht stimmen, lösen
              wir es. Unkompliziert.
            </p>
            <p>
              Versand ist versichert, sorgfältig verpackt und diskret. Ob ein
              einzelnes Goldmünzstück oder eine größere Sammlung, alles kommt
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
          <div className="space-y-4 text-ink-aged leading-relaxed">
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
              className="inline-block rounded-button bg-gold px-7 py-3 text-sm font-medium text-white shadow-card transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--w14-gold] focus-visible:ring-offset-2"
              style={{ backgroundColor: "#bf9430" }}
            >
              Kontakt aufnehmen
            </a>
            <a
              href="/ankauf"
              className="inline-block rounded-button border border-rule px-7 py-3 text-sm font-medium text-ink transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--w14-gold] focus-visible:ring-offset-2"
            >
              Zum Goldankauf
            </a>
          </div>
        </Reveal>
      </article>
    </PageShell>
  );
}
