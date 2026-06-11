import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { metalRates, eur } from "@/lib/placeholder-data";

// Deterministic placeholder sparkline series per metal (illustrative).
const series: Record<string, number[]> = {
  XAU: [60, 62, 59, 64, 67, 66, 70, 72, 71, 74, 76, 76.4],
  XAG: [0.78, 0.8, 0.79, 0.83, 0.85, 0.84, 0.88, 0.9, 0.89, 0.91, 0.92, 0.92],
  XPT: [34, 33.4, 33.8, 32.9, 32.4, 32.6, 32, 31.7, 31.9, 31.6, 31.8, 31.78],
  XPD: [26, 26.6, 27, 26.8, 27.4, 27.2, 27.8, 28, 27.9, 28.2, 28.1, 28.14],
};

function sparkPath(points: number[], w = 120, h = 38) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  return points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function LivePrices() {
  return (
    <section className="border-y border-rule bg-raised py-section">
      <div className="mx-auto max-w-edge px-5">
        <Reveal className="mb-w14-4 flex flex-wrap items-end justify-between gap-w14-3">
          <div className="measure">
            {/* a steady verdigris dot — live data, no strobing ping */}
            <div className="eyebrow inline-flex items-center gap-2">
              <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-verdigris" />
              Live · Echtzeit
            </div>
            <h2 className="mt-w14-2 font-display text-fluid-h2 font-medium">Edelmetallkurse</h2>
            <p className="mt-w14-2 text-ink-faded">
              Direkt aus unserem Marktdaten-Feed, dieselben Kurse wie an der Ladentheke.
            </p>
          </div>
          <a
            href="#kollektion"
            className="group/link inline-flex min-h-[44px] items-center gap-w14-1 text-eyebrow font-medium text-ink"
          >
            <span className="underline-draw">Alle Anlageprodukte</span>
            <ArrowRight
              className="h-[18px] w-[18px] transition-transform duration-base ease-hover group-hover/link:translate-x-1"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </a>
        </Reveal>

        <div className="grid gap-w14-2 sm:grid-cols-2 sm:gap-w14-3 lg:grid-cols-4">
          {metalRates.map((m, i) => {
            const up = m.changePct >= 0;
            const pts = series[m.symbol];
            return (
              <Reveal key={m.symbol} delay={i * 0.07}>
                <div className="group rounded-card border border-rule bg-surface p-card transition-[transform,box-shadow,border-color] duration-base ease-hover hover:-translate-y-1 hover:border-[color:color-mix(in_srgb,var(--w14-ink)_30%,transparent)] hover:shadow-lift">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{m.metal}</span>
                    <span className="text-[0.68rem] uppercase tracking-widest text-ink-faded">{m.symbol}</span>
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div className="tnum text-fluid-h3 font-medium">{eur(m.pricePerGram)}<span className="text-base text-ink-faded">/g</span></div>
                    <svg viewBox="0 0 120 38" aria-hidden="true" className="h-9 w-[120px] overflow-visible">
                      <path
                        d={sparkPath(pts)}
                        fill="none"
                        stroke={up ? "var(--w14-verdigris)" : "var(--w14-wax-red)"}
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <div className={`tnum mt-2 text-sm font-semibold ${up ? "text-verdigris" : "text-wax-red"}`}>
                    <span aria-hidden="true">{up ? "▲" : "▼"}</span>
                    <span className="sr-only">{up ? "gestiegen" : "gefallen"}</span>
                    {" "}{Math.abs(m.changePct).toFixed(2)}% <span className="font-normal text-ink-faded">heute</span>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
