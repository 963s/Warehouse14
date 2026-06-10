"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Scroll-into-view fade-up — the storefront's one entrance gesture.
 * Opacity 0→1 + translateY 16px→0, once, on the "curator" ease (650ms).
 * `index` drives a 70ms cascade for sibling groups (vitrine-light effect).
 * Reduced motion collapses to instant, transform-free opacity.
 */
export function Reveal({
  children,
  delay = 0,
  index,
  y = 16,
  className,
}: {
  children: ReactNode;
  delay?: number;
  /** Position in a staggered group; adds index × 70ms to the delay. */
  index?: number;
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const totalDelay = delay + (index ?? 0) * 0.07;

  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-12%" }}
      transition={
        reduce
          ? { duration: 0 }
          : { duration: 0.65, delay: totalDelay, ease: [0.16, 1, 0.3, 1] }
      }
    >
      {children}
    </motion.div>
  );
}
