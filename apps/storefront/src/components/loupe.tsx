"use client";

import { useId } from "react";

/** The house loupe. One refined design, used in the hero and wherever a piece
 * is being examined. Neutral glass + soft rim, no heavy gold. */
export function Loupe({ size = 132, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 150 150" className={className} aria-hidden="true">
      <defs>
        <radialGradient id={`lg-${id}`} cx="38%" cy="30%" r="78%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.32)" />
          <stop offset="55%" stopColor="rgba(255,247,224,0.08)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.03)" />
        </radialGradient>
      </defs>
      {/* handle */}
      <line x1="97" y1="97" x2="139" y2="139" stroke="#8a8275" strokeWidth="12" strokeLinecap="round" />
      <line x1="97" y1="97" x2="139" y2="139" stroke="#c7c1b3" strokeWidth="6" strokeLinecap="round" />
      {/* rim + glass */}
      <circle cx="60" cy="60" r="52" fill={`url(#lg-${id})`} stroke="#cfc9ba" strokeWidth="5" />
      <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
      {/* a thin gold inlay ring on the bezel */}
      <circle cx="60" cy="60" r="47" fill="none" stroke="rgba(191,148,48,0.45)" strokeWidth="1" />
      {/* glare */}
      <path d="M30 48a36 36 0 0 1 27-21" stroke="rgba(255,255,255,0.5)" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}
