"use client";

import { useEffect } from "react";
import { motion, useScroll, useSpring } from "framer-motion";
import Lenis from "lenis";

/**
 * Unhurried inertia scroll + a thin gold progress hairline at the top.
 *
 * MOBILE-FIRST stance: 95% of visitors are on a phone, where native momentum is
 * already perfect — so Lenis stays fully OFF on touch (`pointer: coarse`) and on
 * reduced-motion. We never hijack the platform's own scroll on a phone. Lenis
 * runs ONLY on a mouse-wheel desktop, where it adds a buttery-but-natural glide.
 */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    // Touch / coarse pointers → native momentum. Desktop wheel → Lenis.
    if (reduce || coarse) return;

    const lenis = new Lenis({
      // A hair longer settle than default for a smooth, premium glide without
      // feeling sluggish or detached from the wheel.
      duration: 1.05,
      // ease-out exponential — a long, calm settle (no spring, no bounce).
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      // Belt-and-braces: never smooth a touch surface even if one is present.
      syncTouch: false,
      wheelMultiplier: 0.92,
      touchMultiplier: 1.6,
    });

    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  return (
    <>
      <ScrollProgress />
      {children}
    </>
  );
}

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 110, damping: 30, mass: 0.35 });
  return (
    <motion.div
      style={{ scaleX }}
      aria-hidden="true"
      className="bg-gold-gradient fixed inset-x-0 top-0 z-[100] h-[2px] origin-left"
    />
  );
}
