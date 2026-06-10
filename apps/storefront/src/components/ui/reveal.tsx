"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Scroll-into-view entrance — the storefront's signature "vitrine light" gesture.
 *
 * The DEFAULT is rich and premium: the element rises further (28px), eases up
 * from a hair of scale (0.965→1) and lifts a soft blur (6px→0) as it settles on
 * the long "curator" ease (~820ms). Read together, a staggered group feels like
 * gallery lights coming up one case at a time — elegant, buttery, never flat.
 *
 * `index` drives an 80ms cascade for sibling groups. The public API is unchanged
 * (`children, delay, index, y, className`); `blur` lets a caller opt the focus
 * pull out. Reduced motion collapses to instant, transform-free opacity.
 */
export function Reveal({
  children,
  delay = 0,
  index,
  y = 28,
  blur = true,
  className,
}: {
  children: ReactNode;
  delay?: number;
  /** Position in a staggered group; adds index × 80ms to the delay. */
  index?: number;
  y?: number;
  /** Lift a soft focus-blur on entrance (default on). */
  blur?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const totalDelay = delay + (index ?? 0) * 0.08;

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      style={{ willChange: "transform, opacity, filter" }}
      initial={{ opacity: 0, y, scale: 0.965, filter: blur ? "blur(6px)" : "blur(0px)" }}
      whileInView={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-12%" }}
      transition={{
        duration: 0.82,
        delay: totalDelay,
        ease: [0.16, 1, 0.3, 1],
        opacity: { duration: 0.6, delay: totalDelay, ease: [0.16, 1, 0.3, 1] },
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A parent that orchestrates its `RevealChild` descendants in one timeline —
 * the cleanest way to get a true, well-timed cascade (lights coming up in
 * sequence) without hand-threading delays onto every child.
 */
export function RevealGroup({
  children,
  className,
  stagger = 0.08,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-12%" }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: stagger, delayChildren: delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

const childVariants: Variants = {
  hidden: { opacity: 0, y: 26, scale: 0.97, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: { duration: 0.78, ease: [0.16, 1, 0.3, 1] },
  },
};

export function RevealChild({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} style={{ willChange: "transform, opacity, filter" }} variants={childVariants}>
      {children}
    </motion.div>
  );
}
