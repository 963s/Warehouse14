"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Reveal } from "@/components/ui/reveal";
import { eur } from "@/lib/placeholder-data";

const months = ["Jul", "Aug", "Sep", "Okt", "Nov", "Dez", "Jan", "Feb", "Mär", "Apr", "Mai", "Jun"];
const data = [64.5, 65.8, 64.9, 67.2, 69.0, 68.4, 71.1, 72.6, 71.8, 74.2, 75.6, 76.42];

const W = 800;
const H = 280;
const padL = 48;
const padR = 18;
const padT = 24;
const padB = 36;
const plotW = W - padL - padR;
const plotH = H - padT - padB;
const baseY = padT + plotH;

const min = Math.min(...data) * 0.97;
const max = Math.max(...data) * 1.02;
const x = (i: number) => padL + (i / (data.length - 1)) * plotW;
const y = (v: number) => padT + (1 - (v - min) / (max - min)) * plotH;

const linePath = data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
const areaPath = `${linePath} L${x(data.length - 1).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z`;
const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ yy: padT + f * plotH, val: max - f * (max - min) }));

export function GoldChart() {
  const reduce = useReducedMotion();
  const yoy = ((data[data.length - 1] - data[0]) / data[0]) * 100;

  return (
    <section className="py-16 md:py-24">
      <div className="mx-auto max-w-edge px-5">
        <Reveal>
          <div className="overflow-hidden rounded-card border border-rule bg-card shadow-card">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-rule p-6 md:p-8">
              <div>
                <div className="smallcaps mb-1 text-sm font-semibold text-gold">Marktdaten</div>
                <h2 className="font-display text-2xl font-semibold md:text-3xl">Goldpreis · 12 Monate</h2>
              </div>
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-xs uppercase tracking-widest text-ink-faded">Aktuell</div>
                  <div className="tnum font-display text-2xl font-semibold">{eur(data[data.length - 1])}/g</div>
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-verdigris/12 px-3 py-1.5 text-sm font-semibold text-verdigris">
                  <span aria-hidden="true">▲</span>
                  <span className="sr-only">gestiegen</span>
                  +{yoy.toFixed(1)}%
                </div>
              </div>
            </div>

            <div className="p-4 md:p-6">
              <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Goldpreis-Entwicklung über zwölf Monate">
                <defs>
                  <linearGradient id="goldArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#bf9430" stopOpacity="0.34" />
                    <stop offset="100%" stopColor="#bf9430" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="goldStroke" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#ddc486" />
                    <stop offset="100%" stopColor="#bf9430" />
                  </linearGradient>
                </defs>

                {/* gridlines + y labels */}
                {grid.map((g, i) => (
                  <g key={i}>
                    <line x1={padL} y1={g.yy} x2={W - padR} y2={g.yy} stroke="var(--w14-rule)" strokeWidth="1" />
                    <text x={padL - 10} y={g.yy + 4} textAnchor="end" fontSize="11" fill="var(--w14-ink-faded)" className="tnum">
                      {g.val.toFixed(0)}€
                    </text>
                  </g>
                ))}

                {/* area */}
                <motion.path
                  d={areaPath}
                  fill="url(#goldArea)"
                  initial={reduce ? false : { opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 1.2, delay: 0.5 }}
                />

                {/* animated line */}
                <motion.path
                  d={linePath}
                  fill="none"
                  stroke="url(#goldStroke)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={reduce ? false : { pathLength: 0 }}
                  whileInView={{ pathLength: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
                />

                {/* end marker */}
                <motion.circle
                  cx={x(data.length - 1)}
                  cy={y(data[data.length - 1])}
                  r="5.5"
                  fill="#bf9430"
                  stroke="#fff"
                  strokeWidth="2.5"
                  initial={reduce ? false : { scale: 0, opacity: 0 }}
                  whileInView={{ scale: 1, opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 1.7, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  style={{ transformBox: "fill-box", transformOrigin: "center" }}
                />

                {/* x labels */}
                {months.map((m, i) => (
                  <text key={m} x={x(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="var(--w14-ink-faded)">
                    {m}
                  </text>
                ))}
              </svg>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
