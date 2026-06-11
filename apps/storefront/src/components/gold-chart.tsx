"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Reveal } from "@/components/ui/reveal";
import { eur } from "@/lib/placeholder-data";

const months = ["Jul", "Aug", "Sep", "Okt", "Nov", "Dez", "Jan", "Feb", "Mär", "Apr", "Mai", "Jun"];
const data = [64.5, 65.8, 64.9, 67.2, 69.0, 68.4, 71.1, 72.6, 71.8, 74.2, 75.6, 76.42];

const min = Math.min(...data) * 0.97;
const max = Math.max(...data) * 1.02;

/* Geometry is computed per variant: one 800-wide plot for desktop and one
 * 360-wide plot for the phone. A single wide viewBox scaled down to 390px
 * shrank the 11px axis labels to ~5px — illegible. Two variants keep the
 * labels at true ~11-12px on every screen. */
type Chart = ReturnType<typeof buildChart>;
function buildChart(W: number, H: number, padL: number, monthStep: number) {
  const padR = 14;
  const padT = 20;
  const padB = 32;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseY = padT + plotH;
  const x = (i: number) => padL + (i / (data.length - 1)) * plotW;
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * plotH;
  const linePath = data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(data.length - 1).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z`;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ yy: padT + f * plotH, val: max - f * (max - min) }));
  return { W, H, padL, padR, x, y, linePath, areaPath, grid, monthStep };
}
const chartMobile = buildChart(360, 240, 40, 2); // every 2nd month label
const chartDesktop = buildChart(800, 280, 48, 1);

export function GoldChart() {
  const reduce = useReducedMotion();
  const yoy = ((data[data.length - 1] - data[0]) / data[0]) * 100;

  return (
    <section className="py-section">
      <div className="mx-auto max-w-edge px-5">
        <Reveal>
          <div className="overflow-hidden rounded-card border border-rule bg-card shadow-card">
            <div className="flex flex-wrap items-end justify-between gap-w14-3 border-b border-rule p-card">
              <div>
                <div className="eyebrow">Marktdaten</div>
                <h2 className="mt-w14-1 font-display text-fluid-h2 font-medium">Goldpreis · 12 Monate</h2>
              </div>
              <div className="flex items-center gap-w14-3">
                <div>
                  <div className="eyebrow">Aktuell</div>
                  <div className="tnum mt-w14-1 text-fluid-h3 font-medium">{eur(data[data.length - 1])}/g</div>
                </div>
                {/* verdigris = positive movement (meaning, not decoration) */}
                <div className="tnum inline-flex items-center gap-1.5 rounded-full bg-[color:color-mix(in_srgb,var(--w14-verdigris)_12%,transparent)] px-3 py-1.5 text-sm font-semibold text-verdigris">
                  <span aria-hidden="true">▲</span>
                  <span className="sr-only">gestiegen</span>
                  +{yoy.toFixed(1)}%
                </div>
              </div>
            </div>

            <div className="p-3 sm:p-card">
              {/* phone variant (≈1:1 viewBox scale → true-size labels) */}
              <ChartSvg c={chartMobile} idSuffix="m" reduce={!!reduce} className="block md:hidden" />
              {/* desktop variant */}
              <ChartSvg c={chartDesktop} idSuffix="d" reduce={!!reduce} className="hidden md:block" />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* The chart itself — ink line over a whisper of ink wash, hairline grid,
 * tnum axis labels. Gradient ids are suffixed so the two responsive variants
 * never collide in the same document. */
function ChartSvg({
  c,
  idSuffix,
  reduce,
  className,
}: {
  c: Chart;
  idSuffix: string;
  reduce: boolean;
  className?: string;
}) {
  const last = data.length - 1;
  return (
    <svg
      viewBox={`0 0 ${c.W} ${c.H}`}
      className={`h-auto w-full ${className ?? ""}`}
      role="img"
      aria-label="Goldpreis-Entwicklung über zwölf Monate"
    >
      <defs>
        <linearGradient id={`inkArea-${idSuffix}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--w14-ink)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--w14-ink)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* gridlines + y labels */}
      {c.grid.map((g, i) => (
        <g key={i}>
          <line x1={c.padL} y1={g.yy} x2={c.W - c.padR} y2={g.yy} stroke="var(--w14-rule)" strokeWidth="1" />
          <text x={c.padL - 8} y={g.yy + 4} textAnchor="end" fontSize="11" fill="var(--w14-ink-faded)" className="tnum">
            {g.val.toFixed(0)}€
          </text>
        </g>
      ))}

      {/* area wash */}
      <motion.path
        d={c.areaPath}
        fill={`url(#inkArea-${idSuffix})`}
        initial={reduce ? false : { opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.2, delay: 0.5 }}
      />

      {/* the ink line draws once, then rests */}
      <motion.path
        d={c.linePath}
        fill="none"
        stroke="var(--w14-ink)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* end marker */}
      <motion.circle
        cx={c.x(last)}
        cy={c.y(data[last])}
        r="5"
        fill="var(--w14-ink)"
        stroke="#fff"
        strokeWidth="2.5"
        initial={reduce ? false : { scale: 0, opacity: 0 }}
        whileInView={{ scale: 1, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 1.7, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
      />

      {/* x labels — thinned on the narrow variant so they never collide */}
      {months.map((m, i) =>
        i % c.monthStep === 0 ? (
          <text key={m} x={c.x(i)} y={c.H - 8} textAnchor="middle" fontSize="11" fill="var(--w14-ink-faded)">
            {m}
          </text>
        ) : null,
      )}
    </svg>
  );
}
