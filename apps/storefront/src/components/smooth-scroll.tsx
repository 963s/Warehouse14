"use client";

import { useEffect } from "react";
import { motion, useScroll, useSpring } from "framer-motion";
import Lenis from "lenis";

/**
 * Unhurried inertia scroll + a thin gold progress hairline at the top.
 * Lenis stays OFF for reduced-motion and on touch — there we defer to the
 * platform's native momentum, which already feels right and shouldn't be fought.
 */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (reduce || coarse) return;

    const lenis = new Lenis({
      duration: 1.2,
      // ease-out exponential — a long, calm settle (no spring, no bounce).
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
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
