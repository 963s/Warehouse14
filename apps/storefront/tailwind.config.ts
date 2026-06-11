import type { Config } from "tailwindcss";

/**
 * warehouse14 storefront — Tailwind theme bound to the @warehouse14/ui-kit
 * design tokens (calm cream + ink, no gold). Values mirror
 * packages/ui-kit/src/tokens.css so web + POS share one identity.
 */
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // rgb(var(--…-rgb) / <alpha-value>) — NOT plain var(--hex): Tailwind can
      // only compile slash-opacity utilities (bg-ink/45, border-rule/60 …)
      // when the color exposes raw channels. The hex vars still exist in
      // globals.css for non-Tailwind use; the -rgb triplets mirror them.
      colors: {
        surface: "rgb(var(--w14-parchment-rgb) / <alpha-value>)",
        card: "rgb(var(--w14-parchment-2-rgb) / <alpha-value>)",
        raised: "rgb(var(--w14-parchment-3-rgb) / <alpha-value>)",
        ink: {
          DEFAULT: "rgb(var(--w14-ink-rgb) / <alpha-value>)",
          aged: "rgb(var(--w14-ink-aged-rgb) / <alpha-value>)",
          faded: "rgb(var(--w14-ink-faded-rgb) / <alpha-value>)",
        },
        rule: "rgb(var(--w14-rule-rgb) / <alpha-value>)",
        gold: {
          DEFAULT: "rgb(var(--w14-gold-rgb) / <alpha-value>)",
          soft: "rgb(var(--w14-gold-soft-rgb) / <alpha-value>)",
          deep: "rgb(var(--w14-gold-deep-rgb) / <alpha-value>)",
        },
        "wax-red": "rgb(var(--w14-wax-red-rgb) / <alpha-value>)",
        verdigris: "rgb(var(--w14-verdigris-rgb) / <alpha-value>)",
        forest: "rgb(var(--w14-forest-rgb) / <alpha-value>)",
        terra: "rgb(var(--w14-terra-rgb) / <alpha-value>)",
        // House gilding (stamp-edge gold): threads, edges and seals ONLY —
        // never fills, never grounds, never body text.
        gilt: {
          DEFAULT: "rgb(var(--w14-gilt-rgb) / <alpha-value>)",
          deep: "rgb(var(--w14-gilt-deep-rgb) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Bricolage Grotesque", "system-ui", "sans-serif"],
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
        // legacy names — now quiet neutral lifts, never a gold glow
        gold: "0 8px 30px -6px rgba(28,28,28,.16)",
        "gold-lg": "0 20px 60px -12px rgba(28,28,28,.22)",
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
      // KEPT: the marquee (price-ticker glide — meaningful, continuous motion)
      // and the finite scroll-in entrances. RETIRED bling keyframes — `shimmer`
      // (specular wipe), `floaty` (idle bob) and `spin-slow` (perpetual gilt
      // turn) were decorative loops. They're mapped to inert no-ops below so any
      // lingering `animate-shimmer/floaty/spin-slow` class renders nothing
      // instead of re-introducing the shine the owner asked us to remove.
      keyframes: {
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
        // inert placeholder — no visual motion (prevents accidental re-bling)
        noop: {
          from: {},
          to: {},
        },
        // Calm, finite entrance — opacity + 20px rise, one pass only.
        "reveal-up": {
          from: { opacity: "0", transform: "translateY(20px)" },
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
        // Retired bling → no-ops (kept as keys so class refs stay valid).
        shimmer: "noop 1ms linear 1",
        floaty: "noop 1ms linear 1",
        "spin-slow": "noop 1ms linear 1",
        // Finite, directive-aligned entrances (use these on product UI).
        "reveal-up": "reveal-up 820ms cubic-bezier(0.16,1,0.3,1) both",
        "fade-in": "fade-in 420ms cubic-bezier(0.16,1,0.3,1) both",
        "draw-x": "draw-x 650ms cubic-bezier(0.16,1,0.3,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
