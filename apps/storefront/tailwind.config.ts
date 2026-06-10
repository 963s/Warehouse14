import type { Config } from "tailwindcss";

/**
 * warehouse14 storefront — Tailwind theme bound to the @warehouse14/ui-kit
 * design tokens (modern clean neutral + sparing gold). Values mirror
 * packages/ui-kit/src/tokens.css so web + POS share one identity.
 */
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "var(--w14-parchment)",
        card: "var(--w14-parchment-2)",
        raised: "var(--w14-parchment-3)",
        ink: {
          DEFAULT: "var(--w14-ink)",
          aged: "var(--w14-ink-aged)",
          faded: "var(--w14-ink-faded)",
        },
        rule: "var(--w14-rule)",
        gold: {
          DEFAULT: "var(--w14-gold)",
          soft: "var(--w14-gold-soft)",
          deep: "var(--w14-gold-deep)",
        },
        "wax-red": "var(--w14-wax-red)",
        verdigris: "var(--w14-verdigris)",
        forest: "var(--w14-forest)",
        terra: "var(--w14-terra)",
      },
      fontFamily: {
        display: ["var(--font-cormorant)", "Cormorant Garamond", "Georgia", "serif"],
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "Menlo", "monospace"],
      },
      // Fluid type ladder — each token resolves to a clamp() custom prop in
      // globals.css. `[size, lineHeight]` so the right rhythm rides along.
      fontSize: {
        eyebrow: ["var(--w14-step--1)", { lineHeight: "1.2", letterSpacing: "0.14em" }],
        "fluid-body": ["var(--w14-step-0)", { lineHeight: "var(--w14-leading-body)" }],
        "fluid-lead": ["var(--w14-step-1)", { lineHeight: "1.5" }],
        "fluid-h3": ["var(--w14-step-2)", { lineHeight: "1.2" }],
        "fluid-h2": ["var(--w14-step-3)", { lineHeight: "var(--w14-leading-display)" }],
        "fluid-h1": ["var(--w14-step-4)", { lineHeight: "var(--w14-leading-display)" }],
        "fluid-hero": ["var(--w14-step-5)", { lineHeight: "1.04" }],
        "fluid-mono": ["var(--w14-step-6)", { lineHeight: "1.0" }],
      },
      // 8pt spacing ladder + section/card rhythm tokens (alongside Tailwind's
      // default scale — these are additive, named to avoid collisions).
      spacing: {
        "w14-1": "var(--w14-space-1)",
        "w14-2": "var(--w14-space-2)",
        "w14-3": "var(--w14-space-3)",
        "w14-4": "var(--w14-space-4)",
        "w14-5": "var(--w14-space-5)",
        "w14-6": "var(--w14-space-6)",
        "w14-7": "var(--w14-space-7)",
        section: "var(--w14-section-pad)",
        card: "var(--w14-card-pad)",
      },
      maxWidth: {
        edge: "1240px",
        measure: "var(--w14-measure)",
      },
      borderRadius: {
        button: "8px",
        card: "12px",
        xl2: "20px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.05), 0 1px 3px rgba(16,24,40,.08)",
        lift: "0 12px 32px -8px rgba(16,24,40,.18)",
        modal: "0 18px 44px rgba(16,24,40,.20)",
        gold: "0 8px 30px -6px rgba(191,148,48,.45)",
        "gold-lg": "0 20px 60px -12px rgba(191,148,48,.55)",
      },
      transitionTimingFunction: {
        curator: "cubic-bezier(0.16, 1, 0.3, 1)", // entrances
        "curator-out": "cubic-bezier(0.16, 1, 0.3, 1)",
        hover: "cubic-bezier(0.4, 0, 0.2, 1)", // micro / hover
      },
      transitionDuration: {
        fast: "180ms",
        base: "420ms",
        slow: "650ms",
      },
      transitionDelay: {
        stagger: "70ms",
      },
      keyframes: {
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        floaty: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "spin-slow": {
          to: { transform: "rotate(360deg)" },
        },
        // Calm, finite entrance — opacity + 16px rise, one pass only.
        "reveal-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "draw-x": {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
      },
      animation: {
        marquee: "marquee 40s linear infinite",
        shimmer: "shimmer 2.2s infinite",
        floaty: "floaty 6s ease-in-out infinite",
        "spin-slow": "spin-slow 26s linear infinite",
        // Finite, directive-aligned entrances (use these on product UI).
        "reveal-up": "reveal-up 650ms cubic-bezier(0.16,1,0.3,1) both",
        "fade-in": "fade-in 420ms cubic-bezier(0.16,1,0.3,1) both",
        "draw-x": "draw-x 650ms cubic-bezier(0.16,1,0.3,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
