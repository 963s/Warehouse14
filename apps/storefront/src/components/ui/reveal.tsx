"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Scroll-into-view entrance — the storefront's signature "vitrine light" gesture.
 *
 * The DEFAULT is a refined, premium fade + gentle rise: the element comes up a
 * comfortable 22px and settles on the long "curator" ease (~820ms). It moves on
 * TRANSFORM + OPACITY ONLY — no scale, no blur, no shine — so it stays glassy at
 * 60fps and reads, in a staggered group, like a curator raising the gallery
 * lights one case at a time. Elegant choreography, zero bling.
 *
 * `index` drives an 80ms cascade for sibling groups. The public API is unchanged
 * (`children, delay, index, y, blur, className`); `blur` is retained for call-site
 * compatibility but is now intentionally inert (the focus-pull was decorative).
 * Reduced motion collapses to instant, transform-free opacity. The viewport
 * margin is tuned so reveals fire a touch earlier — better on a tall phone feed.
 */
export function Reveal({
  children,
  delay = 0,
  index,
  y = 22,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  blur = false,
  className,
}: {
  children: ReactNode;
  delay?: number;
  /** Position in a staggered group; adds index × 80ms to the delay. */
  index?: number;
  y?: number;
  /** Retained for API compatibility; the entrance blur was removed (now inert). */
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
      style={{ willChange: "transform, opacity" }}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-8% 0px -12% 0px" }}
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
  hidden: { opacity: 0, y: 22 },
  show: {
    opacity: 1,
    y: 0,
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
    <motion.div className={className} style={{ willChange: "transform, opacity" }} variants={childVariants}>
      {children}
    </motion.div>
  );
}
