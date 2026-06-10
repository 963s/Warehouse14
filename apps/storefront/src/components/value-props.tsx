import { ShieldCheck, TrendingUp, FileCheck2, Lock, Truck, Award } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";

const props = [
  { icon: ShieldCheck, title: "Versichert & zertifiziert", body: "Jedes Stück geprüft, dokumentiert und auf dem Versandweg vollständig versichert." },
  { icon: TrendingUp, title: "Live-Marktpreise", body: "Anlagegold zum transparenten Tageskurs, keine versteckten Aufschläge." },
  { icon: FileCheck2, title: "GoBD- & GwG-konform", body: "Fiskalisch sauber nach deutschem Recht, von der Kasse bis zum Online-Beleg." },
  { icon: Lock, title: "Sichere Zahlung", body: "Stripe-verschlüsselt, SEPA, Klarna und Vorkasse für Anlagegold." },
  { icon: Truck, title: "Diskreter Versand", body: "Wertversichert per DHL, neutral verpackt, mit Sendungsverfolgung." },
  { icon: Award, title: "Geprüfte Sachkunde", body: "Fundierte Expertise in Numismatik, Edelmetallen und Antiquitäten." },
];

export function ValueProps() {
  return (
    <section className="py-section">
      <div className="mx-auto max-w-edge px-5">
        <Reveal className="max-w-measure">
          <p className="eyebrow">Worauf Sie zählen können</p>
          <span className="mt-w14-3 block h-px w-16 origin-left bg-gold/60" aria-hidden="true" />
        </Reveal>

        <div className="mt-w14-4 grid gap-x-w14-4 gap-y-w14-4 sm:grid-cols-2 lg:grid-cols-3">
          {props.map((p, i) => (
            <Reveal key={i} delay={(i % 3) * 0.07}>
              <div className="group flex gap-w14-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-card text-gold ring-gold-soft">
                  <p.icon className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-display text-fluid-h3 font-medium leading-snug">
                    <span className="underline-draw decoration-gold">{p.title}</span>
                  </h3>
                  <p className="mt-w14-1 max-w-measure text-fluid-body text-ink-aged">{p.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
