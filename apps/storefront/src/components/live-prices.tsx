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
    <section className="border-y border-rule bg-card py-16 md:py-20">
      <div className="mx-auto max-w-edge px-5">
        <Reveal className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="smallcaps mb-2 inline-flex items-center gap-2 text-sm font-semibold text-gold">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-verdigris opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-verdigris" />
              </span>
              Live · Echtzeit
            </div>
            <h2 className="font-display text-3xl font-semibold md:text-4xl">Edelmetallkurse</h2>
            <p className="mt-2 text-ink-faded">
              Direkt aus unserem Marktdaten-Feed, dieselben Kurse wie an der Ladentheke.
            </p>
          </div>
          <a href="#kollektion" className="text-sm font-semibold text-gold hover:underline">
            Alle Anlageprodukte →
          </a>
        </Reveal>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {metalRates.map((m, i) => {
            const up = m.changePct >= 0;
            const pts = series[m.symbol];
            return (
              <Reveal key={m.symbol} delay={i * 0.07}>
                <div className="group rounded-card border border-rule bg-surface p-5 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-gold/40 hover:shadow-lift">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{m.metal}</span>
                    <span className="text-[0.68rem] uppercase tracking-widest text-ink-faded">{m.symbol}</span>
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div className="tnum font-display text-2xl font-semibold">{eur(m.pricePerGram)}<span className="text-base text-ink-faded">/g</span></div>
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
