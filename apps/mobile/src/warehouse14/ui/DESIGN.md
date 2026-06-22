# Mobile UI design notes

> **The single source of truth for the visual law is
> [`docs/DESIGN-SYSTEM.md`](../../../../docs/DESIGN-SYSTEM.md).** Read that first.
> This file holds only the *mobile-specific* notes that sit on top of it — the
> RN/NativeWind translation, the spine vocabulary, and the platform feel. Where
> anything here disagrees with `docs/DESIGN-SYSTEM.md`, the official law wins and
> this file is wrong.

## What the law says (one breath — see DESIGN-SYSTEM.md for the full text)

- Warm **parchment** ground (`#efece3`) + one **ink** (`#1c1c1c`) + hairlines.
  Never pure white. **Light only** — the store has no dark mode.
- **Gilt** (`#a3823b`) is a thread / an edge / a seal **only** — never a fill, a
  background, or text.
- **Functional** colors (verdigris green, wax-red) carry **meaning** only
  (positive / error), never decoration.
- Fonts: **Bricolage Grotesque** (display/headings) + **Inter** (body) +
  **JetBrains Mono** (prices/quantities). All self-hosted, zero CDN (DSGVO).
  The retired font is Cormorant Garamond — do not reintroduce it.
- Motion: ease-out **curator** `cubic-bezier(0.16, 1, 0.3, 1)` for entrances;
  **ease-hover** `cubic-bezier(0.4, 0, 0.2, 1)` for small interactions;
  durations fast `180ms` / base `420ms` / slow `650ms`; stagger `70ms`. Calm
  motion only. **No glow, no bloom, no gaudy ripple.**
- No underscore, no `SCREAMING_SNAKE`, no raw English in any rendered text.

## Where it lives in the mobile app

- Tokens: `../theme.ts` (typed palette/radii/space/fonts/type) + `../../../global.css`
  (NativeWind `:root` + `@theme inline` mapping the same hex to `--color-*`).
- Motion: `./motion/tokens.ts` (the exact curves/durations/stagger above).
- Spine primitives: this directory (`PaperGrain`, `Hairline`, `SectionCard`,
  `ListRow`, `EmptyState`, `Skeleton`, `ErrorState`, `QueryBoundary`, …).

## The one-line test

If a screen has a warm paper ground, ink text, a single gold hairline somewhere,
prices in mono, headings in Bricolage, calm motion, and not one underscore
visible — it is on-system. If it has boxes inside boxes, a gold fill, a glow, or
a raw token in view — it is not.
