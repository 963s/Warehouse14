import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Reveal } from "@/components/ui/reveal";
import { stats } from "@/lib/placeholder-data";

/**
 * The shared `stats` data still carries a fabricated tenure entry
 * ("Jahre Erfahrung / seit 1987"). We do not know the real founding year, so
 * that cell is replaced at render with a defensible, non-numeric claim — the
 * data file is owned elsewhere and must not assert an invented number.
 */
type Stat = (typeof stats)[number] & { note?: string };

const TENURE_LABEL = "Jahre Erfahrung";
const heritageStat = {
  text: "Schorndorf",
  label: "Ihr Goldhaus vor Ort",
  note: "Ankauf · Verkauf · Bewertung",
} as const;

export function StatsBand() {
  return (
    <section id="vertrauen" className="py-section">
      <div className="mx-auto max-w-edge px-5">
        <Reveal className="mx-auto mb-w14-5 max-w-measure text-center">
          <p className="eyebrow">Warum warehouse14</p>
          <h2 className="mt-w14-3 font-display text-fluid-h2 font-medium">
            Ein Haus, dem Sammler &amp; Anleger vertrauen
          </h2>
          <span className="mx-auto mt-w14-3 block h-px w-16 bg-gold/60" aria-hidden="true" />
        </Reveal>

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card bg-rule lg:grid-cols-4">
          {(stats as Stat[]).map((s, i) => {
            const isTenure = s.label === TENURE_LABEL;
            return (
              <Reveal key={i} delay={i * 0.07} className="bg-card">
                <div className="px-w14-3 py-w14-5 text-center">
                  <div className="font-display text-fluid-h1 font-medium leading-none tracking-tight text-ink tabular-nums">
                    {isTenure ? (
                      heritageStat.text
                    ) : (
                      <AnimatedCounter
                        value={s.value}
                        decimals={s.decimals ?? 0}
                        prefix={s.prefix ?? ""}
                        suffix={s.suffix ?? ""}
                      />
                    )}
                  </div>
                  <div className="mt-w14-3 text-fluid-body text-ink-aged">
                    {isTenure ? heritageStat.label : s.label}
                  </div>
                  {(isTenure ? heritageStat.note : s.note) && (
                    <div className="mt-w14-1 text-eyebrow text-ink-faded">
                      {isTenure ? heritageStat.note : s.note}
                    </div>
                  )}
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
