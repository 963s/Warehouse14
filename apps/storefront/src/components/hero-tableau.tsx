"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { BrandLoupeSketch } from "@/components/brand/marks";

/* ── THE WOVEN HERO TABLEAU ─────────────────────────────────────────────────
 * A programmatic slow-motion film behind the hero copy: the house's world
 * (an engraved stamp, a hatched coin, a script flourish) drifting like
 * watermarks on old paper, the brand loupe gliding in once to settle beside
 * the headline, and a single gilt thread drawing across — the only color in
 * the layer.
 *
 * Engineering contract: this is ONE absolutely-positioned aria-hidden layer
 * at z-0 inside the hero. A real video could replace its children later
 * without touching the hero — same slot, same mask, same z-order.
 * Everything animates transform/opacity only; loops run 60–120s; phones get
 * 2 objects and slower motion; prefers-reduced-motion renders the settled
 * still. */

const ease = [0.16, 1, 0.3, 1] as const;

/** Drift factor for phones — the tableau breathes even slower on small
 * screens, where motion sits closer to the reader's thumb. */
function usePhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return phone;
}

/** A very slow, mirror-looped drift: transform-only, easeInOut, one gentle
 * excursion and back. The base rotation lives on the child so the loop can
 * own the transform without fighting it. */
function Drift({
  className,
  x = 0,
  y = 0,
  rotate = 0,
  duration,
  reduce,
  children,
}: {
  className?: string;
  x?: number;
  y?: number;
  rotate?: number;
  duration: number;
  reduce: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <motion.div
        className="will-change-transform"
        animate={
          reduce
            ? undefined
            : { x: [0, x, 0], y: [0, y, 0], rotate: [0, rotate, 0] }
        }
        transition={{ duration, repeat: Infinity, ease: "easeInOut" }}
      >
        {children}
      </motion.div>
    </div>
  );
}

/* ── Engraved objects — drawn here, watermark-grade, NOT brand marks ──────
 * Pure hairline stroke work in currentColor: an old engraver's vocabulary
 * (perforation, reeding, hatching, a swash), abstract enough to never read
 * as clipart at 4–8% ink. */

/** A postage stamp: perforated edge, double frame, engraved sky lines and an
 * oval cartouche with hatched shading. */
function StampEngraving({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 220 264"
      fill="none"
      stroke="currentColor"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* perforation: round dots along the sheet edge */}
      <rect
        x="7"
        y="7"
        width="206"
        height="250"
        strokeWidth="5.5"
        strokeDasharray="0.1 11.4"
        strokeLinecap="round"
      />
      <rect x="24" y="24" width="172" height="216" strokeWidth="1.6" />
      <rect x="31" y="31" width="158" height="202" strokeWidth="0.8" />
      {/* engraved sky lines */}
      <g strokeWidth="0.9">
        <line x1="40" y1="58" x2="180" y2="58" />
        <line x1="40" y1="70" x2="180" y2="70" />
        <line x1="40" y1="82" x2="180" y2="82" />
        <line x1="40" y1="94" x2="180" y2="94" />
      </g>
      {/* cartouche with hatched shading */}
      <ellipse cx="110" cy="142" rx="52" ry="64" strokeWidth="1.5" />
      <ellipse cx="110" cy="142" rx="45" ry="57" strokeWidth="0.8" />
      <g strokeWidth="0.9">
        <path d="M 76 162 Q 110 138 144 162" />
        <path d="M 74 174 Q 110 150 146 174" />
        <path d="M 78 186 Q 110 164 142 186" />
      </g>
      {/* letterpress suggestion, top and bottom */}
      <line x1="52" y1="42" x2="168" y2="42" strokeWidth="6" strokeDasharray="10 7" />
      <line x1="60" y1="222" x2="160" y2="222" strokeWidth="6" strokeDasharray="8 6" />
      {/* corner value medallions */}
      <circle cx="44" cy="220" r="9" strokeWidth="1.2" />
      <circle cx="176" cy="220" r="9" strokeWidth="1.2" />
    </svg>
  );
}

/** A large coin: reeded rim, legend dashes, engraved horizontal hatching. */
function CoinEngraving({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 400"
      fill="none"
      stroke="currentColor"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="200" cy="200" r="196" strokeWidth="2" />
      {/* reeding */}
      <circle cx="200" cy="200" r="186" strokeWidth="9" strokeDasharray="1.6 6.4" />
      <circle cx="200" cy="200" r="172" strokeWidth="1.4" />
      <circle cx="200" cy="200" r="164" strokeWidth="0.8" />
      {/* legend dashes around the upper inner rim */}
      <path d="M 78 142 A 136 136 0 0 1 322 142" strokeWidth="7" strokeDasharray="2.4 9" />
      {/* engraved hatching across the lower field */}
      <g strokeWidth="0.8">
        <line x1="76" y1="238" x2="324" y2="238" />
        <line x1="66" y1="256" x2="334" y2="256" />
        <line x1="66" y1="274" x2="334" y2="274" />
        <line x1="76" y1="292" x2="324" y2="292" />
        <line x1="96" y1="310" x2="304" y2="310" />
        <line x1="130" y1="328" x2="270" y2="328" />
      </g>
      {/* central relief arcs */}
      <path d="M 130 206 Q 200 156 270 206" strokeWidth="1.3" />
      <path d="M 142 206 Q 200 166 258 206" strokeWidth="0.9" />
      <line x1="92" y1="206" x2="308" y2="206" strokeWidth="1.6" />
    </svg>
  );
}

/** A script flourish — the old ledger's hand, two crossing swashes. */
function FlourishEngraving({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 600 170"
      fill="none"
      stroke="currentColor"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M 14 118 C 80 30 150 26 196 84 C 232 130 196 158 168 144 C 140 130 168 88 232 78 C 330 62 360 128 444 106 C 506 90 540 64 588 76"
        strokeWidth="1.6"
      />
      <path
        d="M 60 140 C 170 96 260 142 352 122 C 430 106 470 130 560 110"
        strokeWidth="0.9"
      />
    </svg>
  );
}

export function HeroTableau() {
  const reduce = !!useReducedMotion();
  const phone = usePhone();
  /* phones: same choreography, slower clock */
  const slow = phone ? 1.35 : 1;

  return (
    <div
      aria-hidden="true"
      /* The cream mask keeps the copy column perfectly readable: phones fade
       * the middle band (copy spans full width), desktop carves a soft
       * ellipse over the left copy column. */
      className="pointer-events-none absolute inset-0 z-0 select-none overflow-hidden text-ink [-webkit-mask-image:linear-gradient(to_bottom,black_0%,rgba(0,0,0,0.45)_22%,rgba(0,0,0,0.3)_48%,rgba(0,0,0,0.55)_78%,black_100%)] [mask-image:linear-gradient(to_bottom,black_0%,rgba(0,0,0,0.45)_22%,rgba(0,0,0,0.3)_48%,rgba(0,0,0,0.55)_78%,black_100%)] md:[-webkit-mask-image:radial-gradient(130%_92%_at_20%_42%,transparent_0%,rgba(0,0,0,0.4)_42%,black_74%)] md:[mask-image:radial-gradient(130%_92%_at_20%_42%,transparent_0%,rgba(0,0,0,0.4)_42%,black_74%)]"
    >
      {/* the coin — large, anchoring the lower right; on phones a sliver
       * peeking from the right edge */}
      <Drift
        className="absolute -right-[42%] top-[30%] w-[340px] opacity-[0.05] md:-right-[6%] md:top-[52%] md:w-[600px] md:opacity-[0.055]"
        x={-10}
        y={-18}
        rotate={0.6}
        duration={110 * slow}
        reduce={reduce}
      >
        <CoinEngraving className="h-auto w-full" />
      </Drift>

      {/* the stamp — top right corner on desktop, settling low on phones */}
      <Drift
        className="absolute -bottom-[7%] right-[5%] w-[148px] opacity-[0.05] md:bottom-auto md:right-[3%] md:top-[2%] md:w-[190px] md:opacity-[0.06]"
        x={-8}
        y={14}
        rotate={1.4}
        duration={85 * slow}
        reduce={reduce}
      >
        <StampEngraving className="h-auto w-full rotate-[6deg] md:-rotate-[7deg]" />
      </Drift>

      {/* the flourish — desktop only (phones carry 2 objects) */}
      <Drift
        className="absolute bottom-[5%] left-[30%] hidden w-[540px] opacity-[0.05] md:block"
        x={22}
        y={-8}
        duration={95 * slow}
        reduce={reduce}
      >
        <FlourishEngraving className="h-auto w-full -rotate-2" />
      </Drift>

      {/* the single gilt thread — draws across once, the only color here */}
      <motion.span
        className="absolute left-[24%] right-0 top-[6%] h-px origin-left bg-gilt/50 will-change-transform md:left-1/2 md:top-[26%]"
        initial={reduce ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 3.4, ease, delay: 1.5 }}
      />

      {/* the meaningful gesture: the brand loupe glides in from the right and
       * settles beside the headline — one pass, then rests. Reduced motion
       * renders it already at rest. Opacity rides an inner element so the
       * watermark strength on the wrapper stays authoritative. */}
      <div className="absolute -right-[5%] top-[0.5%] w-[200px] opacity-[0.06] md:left-[63%] md:right-auto md:top-[30%] md:w-[360px] md:opacity-[0.07]">
        <motion.div
          className="will-change-transform"
          initial={reduce ? false : { x: "26vw", y: 30, rotate: 5, opacity: 0 }}
          animate={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
          transition={{
            duration: 13 * slow,
            ease,
            delay: 0.9,
            opacity: { duration: 5 * slow, ease: "easeOut", delay: 0.9 },
          }}
        >
          <BrandLoupeSketch className="h-auto w-full" />
        </motion.div>
      </div>
    </div>
  );
}
