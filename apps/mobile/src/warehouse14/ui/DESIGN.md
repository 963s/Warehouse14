# Warehouse14 Owner OS — Design Language (the Antique Identity)

The single visual contract for the OWNER mobile app. Every later agent follows
this. The goal is one feel across all surfaces: native, fluid, beautiful,
instantly understandable, deep, trustworthy — an app you would believe shipped
from Apple, dressed as an aged jeweller's ledger.

The house voice is ANTIQUE: warm aged-cream paper, ink that is never pure black,
brass and gold accents, fine warm-gold hairlines on every edge. Luxurious, calm,
crafted — explainable to a child, trustworthy to an adult. LIGHT is the hero: the
app opens in the warm cream, not in the dark. DARK is a warm candlelit-walnut
variant of the same palette — never the old black+yellow. Consistency is the
whole point; do not invent parallel scales or a flat, cold look.

Source of truth for token VALUES is `apps/mobile/src/warehouse14/theme.ts`
(mirrored 1:1 into `apps/mobile/global.css` as `--w14-*` vars, then exposed as
NativeWind utility tokens). This file is the source of truth for the RULES —
how those tokens are used, plus motion and haptics.

Hard rule that overrides taste: never hardcode a hex colour, a radius, a font
family, or a magic spacing number in a component. Pull from `useW14Theme()` or
a NativeWind class. A surface that hardcodes a value is a regression.

---

## 1. Spacing — a strict 4px grid

All padding, margin, and gaps come from `theme.space` (or the NativeWind step
that equals it). Never an off-grid number.

| token   | px  | role                                                   |
| ------- | --- | ------------------------------------------------------ |
| `x1`    | 4   | hairline gap, icon-to-text nudge                       |
| `x2`    | 8   | tight gap inside a row                                 |
| `x3`    | 12  | default gap between stacked items, card inner gap      |
| `x4`    | 16  | card padding, screen horizontal gutter                 |
| `x5`    | 20  | generous gap between groups                            |
| `x6`    | 24  | section separation                                     |
| `x7`    | 32  | major block separation                                 |
| `x8`    | 40  | screen-top breathing room                              |
| `x9`    | 48  | rare, large empty-state vertical room                  |

Defaults that keep surfaces identical:

- Screen horizontal gutter: `x4` (16). Scroll content gets `x4` top, and bottom
  inset = safe-area bottom + `x6` so the last row clears the tab bar / home bar.
- Card inner padding: `px-4 py-4` (16). Dense tiles may use `px-3 py-3` (12).
- Gap between cards in a list: `x3` (12). Gap between titled sections: `x5`–`x6`.
- Gap inside a `SectionCard` body: `2.5` (10) — already baked into the spine.

---

## 2. Radii — only three values exist (antique, tight)

From `theme.radii`. There is no other radius anywhere. The antique system keeps
corners small and crafted, not bubbly.

- `none` = 0 — full-bleed dividers, edge-to-edge media.
- `button` = 4 — buttons, inputs, chips, badges, small controls.
- `card` = 8 — cards, sheets, panels, the soft disc behind an empty-state icon
  (a circle = `rounded-full`, the one allowed exception, only for icon discs and
  avatars).

NativeWind mapping is pinned in `global.css`: `rounded-md` → 4, `rounded-lg` /
`rounded-xl` / `rounded-2xl` → 8. Do not reach for `rounded-3xl` expecting a new
radius — everything resolves into the allowed set on purpose.

---

## 3. Type ramp — Cormorant Garamond (display) + Inter (body) + JetBrains Mono

Families load in the root layout via `theme.fonts`; never name a raw font
string. Three families, each with one job:

- Cormorant Garamond — the antique DISPLAY serif. Screen titles, the hero KPI,
  section HEADLINES that sit on the canvas — the elegant aged-paper voice. Use
  `font-display` (500), `font-display-semibold` (600), `font-display-bold`
  (700). It is a high-contrast serif that reads light at small sizes, so NEVER
  use it below the section-headline step (16) and never for body or meta.
- Inter — all body and UI text, and the small in-card section title. Calm and
  legible against the serif. Weights: `body` 400, `medium` 500, `semibold` 600,
  `bold` 700.
- JetBrains Mono — numerals that must align in a column (money tables, weights,
  serial numbers, IDs): `mono` 400, `monoMedium` 500. Mono is for tabular
  numerics, not prose.

The ramp (size · family/weight · use). Sizes are the NativeWind text classes:

| step           | class / size     | family · weight                | use                                              |
| -------------- | ---------------- | ------------------------------ | ------------------------------------------------ |
| Display        | `text-3xl` (28)  | Cormorant `font-display-bold`  | the big hero title (a splash, a screen overline) |
| Hero KPI       | `text-2xl` (26)  | Cormorant `font-display-semibold` · or `font-mono-medium` for a pure number | the single big number on a `StatTile` |
| Screen title   | `text-2xl` (22)  | Cormorant `font-display-semibold` | screen header                                  |
| Section title  | `text-base` (16) | Inter `font-semibold`          | `SectionCard` in-card headers (kept Inter — small) |
| Body           | `text-sm`–`base` | Inter regular 400              | row titles, descriptions                          |
| Label / meta   | `text-xs` (12)   | Inter regular 400              | captions, hints — always `text-muted-foreground`  |
| Micro          | `text-2xs` (11)  | Inter regular 400              | the tiniest hint under a value                     |

How weight resolves to a face: each family loads as DISTINCT named faces, so a
numeric `font-weight` alone does not pick them on native. `global.css` pins each
weight class to its face — `font-display-semibold` → Cormorant 600,
`font-semibold` → Inter 600, `font-bold` → Inter 700 — so the class renders the
real face. NEVER pair a display class with an Inter weight class (or mono),
which would re-select the other family and lose the serif. Mono is a separate
family: use `font-mono` (IDs/SKUs) or `font-mono-medium` (emphasised numerics —
KPI values, totals). A KPI hero VALUE that is a pure number stays
`font-mono-medium` for tabular figures; a KPI that reads as a phrase (a rank, a
streak) uses the Cormorant display step. The `type` object on `useW14Theme()`
mirrors the ramp for the rare style-prop case.

Rules: one hero number per tile. Captions and hints are always
`text-muted-foreground`. `numberOfLines` everything that can overflow (titles 1,
descriptions 2) — truncation beats reflow. Right-align mono money in any column.

Icons: pull the `size` from `useW14Theme().icon` — one scale, never a raw
number. `xs` 14 (tiny glyph beside small text), `sm` 16 (control/action glyph),
`md` 18 (the STANDARD row/section leading icon + chevron), `lg` 20 (a glyph in a
chip), `xl` 26 (the hero glyph in an empty/error disc). Tint icons with a theme
colour — brass for a leading/section icon, `mutedForeground` for a chevron,
`destructive` for an error.

---

## 4. Colour — brass, sage, terracotta, gold, on aged cream

Pull from `useW14Theme().colors`. Light and dark palettes both live in
`theme.ts` and flip on the OS scheme; never branch on `isDark` to pick a colour
that the palette already resolves. The text-bearing colours are AA-safe antique
variants; the pure brand hues (`gold`, and the bright `#c0492f`/`#3f6b54`) are
decoration only.

The cream is LAYERED for depth, not one flat fill:

- `background` — the aged cream canvas (`#efece3` light · walnut `#17150f` dark).
- `card` — the raised cream leaf (`#faf8f2` · `#1f1c16`).
- `raised` (`bg-raised`) — the SUNKEN surface: inputs, wells, a deep tray
  (`#e8e4da` · `#14110c`). Use it to push a field below the card plane.

Over the canvas sits the aged-paper grain (the `PaperGrain` primitive on native,
the `paper` className on web) — faint warm flecks, decoration only, never
touching contrast.

Role colours and their ONE meaning each — do not cross the wires:

- `primary` — BRASS (`#7e6228` light · `#d8b14e` dark). The primary action and
  the brand. Primary buttons, active states, the leading icon on a `SectionCard`,
  the default `StatTile` value, focus `ring`. This is the colour that carries
  text-bearing emphasis, and it clears AA as text and as a fill with cream text.
  When in doubt, brass — never flat gold.
- `verdigris` — SAGE GREEN POSITIVE (`#3a6450` light · `#5fae89` dark). Success,
  positive deltas, "paid / done / in stock", a price moving UP, confirmation
  banners. Mapped to the NativeWind `accent` token. Profit up is sage; profit
  down is `destructive` — never colour a real loss green.
- `destructive` — TERRACOTTA (`#b8442b` light · `#e07a62` dark). Errors,
  irreversible/danger actions, real negative numbers, a price moving DOWN.
- `gold` (`#bf9430`) and the `border` hairline (`#cdb787`) — DECORATIVE ONLY.
  Hairline flourishes on edges, a celebratory shimmer, a gauge accent on a
  milestone. NEVER text, never a text-bearing fill, never an icon a user must
  read. If a glyph or label sits on it, it is wrong — use brass. Hard rule.
- `foreground` / `mutedForeground` — warm ink (`#17150f`, never pure black) /
  faded ink for captions+hints+meta.
- `border` — the fine warm-gold HAIRLINE (1px), the only divider weight. Use the
  `Hairline` primitive (native) or `hairline` / `hairline-t` / `hairline-b`
  classes (web) for a standalone rule.

Honesty rule (absolute, overrides design): a number shown to the owner must be a
real value from a real endpoint. If the source is unavailable, render a locked or
empty state (see `EmptyState`) or dim the value with the `muted` flag on
`StatTile` — never a fabricated or placeholder number, never a fake currency
amount. Trust is part of the design.

Money is integer CENTS on the wire. Always format through
`formatCents()` (from `@/warehouse14/api`) → de-DE EUR, e.g. `199999` →
`"1.999,99 €"`. Never print raw cents. Dates and weights use de-DE
(`toLocaleDateString("de-DE", …)`, `toLocaleString("de-DE", …)`). German UI
copy throughout; comma decimal, dot thousands.

---

## 5. Elevation — flat paper, the gold hairline, one whisper of shadow

Warehouse14 is a flat, aged-paper surface. Depth comes from LAYERING (the cream
canvas → card leaf → sunken `raised` well), the fine GOLD HAIRLINE on edges, and
the paper grain — NOT from heavy shadows. There is exactly one soft shadow step
and it is already on the RNR `Card`: `shadow-sm shadow-black/5` over a 1px
hairline `border`. Cards do not stack shadows or get heavier on press.

- The canvas: a screen root carries the aged-paper grain (the `PaperGrain`
  primitive on native; the `paper` class on web), behind the content.
- Resting card: a 1px gold hairline `border` + the single soft shadow. That is
  the maximum. The hairline, not the shadow, is what reads as the card's edge.
- A standalone divider is the `Hairline` primitive (native) or `hairline-b`
  (web) — the only divider weight; never a thick rule or a second shadow.
- Pressed card/row: do NOT raise elevation — signal press with the motion +
  haptic below (a brief scale-down and an opacity dip), not a bigger shadow.
- Floating layers (sheets, dialogs, the sticky save bar): same `card` fill, a
  top hairline (`hairline-t` / `<Hairline />`), and a scrim behind modals
  (`background` at ~50% via an overlay) — not a darker drop shadow. Depth comes
  from layering, the hairline, and motion, not from shadow weight.

---

## 6. Motion — calm, physical, fast (reanimated v4 + worklets)

Built on `react-native-reanimated` v4 with `react-native-worklets`; all
animation runs on the UI thread. Motion is confident and quick, never bouncy
toy-spring. Reach for these and nothing else, so every surface moves the same
way. (No motion module exists yet — the spine that builds it implements exactly
this vocabulary.)

Durations (ms) and what they are for:

| token      | ms  | use                                                       |
| ---------- | --- | --------------------------------------------------------- |
| `instant`  | 90  | press feedback (scale/opacity down), toggles              |
| `fast`     | 160 | most enter/exit, value cross-fades, chevron rotation      |
| `base`     | 240 | card/list item entrance, sheet content settle             |
| `slow`     | 320 | full-screen / sheet present + dismiss, route transitions  |

Easings (use `Easing` from reanimated):

- Standard (enter + move): `Easing.out(Easing.cubic)` — decelerate into rest.
- Exit: `Easing.in(Easing.cubic)` — accelerate away.
- Emphasis / springy moments (a KPI gauge filling, a celebratory pop): a spring
  with `damping ≈ 18`, `stiffness ≈ 180`, `mass ≈ 1` — settled, not wobbly. Use
  springs sparingly; timings are the default.

Patterns every surface reuses:

- Press: scale to `0.97` + opacity to `0.9` over `instant`, release back over
  `fast`. Applied to cards, list rows, buttons.
- List/section entrance: fade + 8px rise over `base`, staggered ~30ms per item
  (cap the stagger so long lists do not feel slow).
- Number changes: cross-fade the value over `fast`; gauges/rings animate their
  fill over `base` with the emphasis spring. Never snap a KPI; let it land.
- Skeleton → data: cross-fade over `fast`; never pop. Loading shows a skeleton
  in the card's shape, not a spinner mid-screen.

Respect reduced motion: when the OS "reduce motion" is on, drop to opacity-only
cross-fades and skip translate/scale and stagger.

---

## 7. Haptics — a small, deliberate vocabulary (expo-haptics)

Haptics confirm meaning; they are never decoration. One feeling per meaning, and
nothing fires on scroll, on every render, or more than once per action. (No
haptics module exists yet — the spine builds a thin wrapper over `expo-haptics`
exposing exactly these.)

| trigger                                   | haptic                                  |
| ----------------------------------------- | --------------------------------------- |
| Tap a primary control / row that navigates | selection (`selectionAsync`)            |
| Toggle, segment change, picker tick       | selection                               |
| Save / create / confirm succeeded         | `notificationAsync(Success)`            |
| Validation error / blocked action         | `notificationAsync(Error)`              |
| Warning (e.g. PIN attempts low, lockout)  | `notificationAsync(Warning)`            |
| Money-path commit (sale, payout, Z-Bon)   | `impactAsync(Medium)` on the press      |
| Reaching a milestone / gamification reward | `impactAsync(Heavy)` once, with the gold flourish |
| Light press confirm (sheet open, expand)  | `impactAsync(Light)`                    |

Rules: never haptic on app-driven changes the user did not cause; never chain
two haptics for one event (the Success notification already includes its own
pattern); honour the system setting (if the device has haptics off, the wrapper
is a no-op). Pair a Success haptic with the verdigris confirmation, an Error
haptic with the destructive/error banner — the touch and the colour say the same
thing.

---

## 8. The shared spine — reuse, never re-create

The owner surfaces are assembled from `apps/mobile/src/warehouse14/ui` (exported
via `index.ts`), built on the RNR primitives (`@/components/ui/*`) and the typed
theme. Do not rebuild these; compose them.

- `PaperGrain` — the aged-paper grain overlay. Drop once as the first child of a
  screen root that fills the canvas, behind the content, so the cream reads as
  aged paper, not a flat fill. Pure decoration (no touch, hidden from a11y), no
  native dependency. `surface="card"` for the fainter over-a-card variant.
- `Hairline` — the fine warm-gold rule, the only divider weight. Horizontal by
  default; `vertical` for an inline rule, `inset` for a list-row separator that
  starts under the text.
- `StatTile` — half-width KPI tile (label · value · optional `RingGauge` · hint).
  Caller pre-formats cents via `formatCents`. `tone` = primary | accent | muted;
  `muted` dims when the live source is unavailable (honesty rule).
- `SectionCard` — titled panel: optional brass icon · title · subtitle · right
  action slot, over its rows.
- `ListRow` — tappable/static row (icon · title/subtitle · value · chevron).
- `SectionHeader` — the un-carded group header (a Section title or a quiet
  tracked "overline") for titling content that sits directly on the canvas,
  where `SectionCard` would over-box it.
- `EmptyState` — centred icon disc · title · description · optional CTA. The
  default for "nothing yet" and "not available".
- `Skeleton` (+ `SkeletonText` / `SkeletonRow` / `SkeletonCard`) — the loading
  placeholder in the card/row's shape. A calm opacity pulse on the UI thread;
  static dim under reduce motion. Loading shows this, never a mid-screen spinner.
- `QueryBoundary` — the state-system entry point: feed it a `useQuery` result
  and it renders the right state — first-load `Skeleton`, `ErrorState` + Retry
  when there's nothing to show, `EmptyState` for a real empty result, else the
  content. Every list and detail screen wraps its body in one boundary so the
  four states are uniform and `children` only ever runs with real data.
- `ErrorState` — centred „konnte nicht geladen werden" disc · message · Retry.
  Connection failures read as „Keine Verbindung" (offline copy); a server
  refusal shows the themed `describeError` message.
- `InlineError` — the unified non-blocking destructive card for a mutation or
  background failure while data is still on screen (the one error card every
  surface uses instead of hand-rolling its own). Optional Retry + dismiss.
- `ConnectionBanner` / `ConnectionBannerHost` — the honest offline bar. No
  NetInfo: the data layer reports each read's transport outcome into the
  `connection` store and the bar mirrors it. Mounted once at the root.
- `FormField` / `FormScreen` — labelled input with hint + per-field error; form
  scaffold with error/success banners and a sticky save bar (step-up is
  transparent via the global host).
- `RingGauge` — progress 0..1, SVG-free bar fallback; the fill lands with the
  emphasis spring and shows the gold milestone shimmer at 100%.

Touch targets: minimum 44px (`touch.min`); any money-path action uses 48px
(`touch.comfortable`). Every interactive element gets an accessibility label in
German.

---

## 9. Checklist before a surface is "done"

- No hardcoded hex / radius / font / off-grid spacing — all from theme or
  NativeWind.
- Money via `formatCents` (cents in, de-DE EUR out); dates/weights de-DE; copy
  German.
- Headings use the Cormorant display class (`font-display*`); body + meta stay
  Inter; tabular numbers stay mono. No family is paired with another's weight.
- Gold and the hairline appear only as decoration, never under text.
- A screen carries the `PaperGrain` canvas; dividers are the `Hairline`, the
  only divider weight. Depth is layering + hairline, never a heavy shadow.
- Every shown number is real from an endpoint, or a locked/empty/`muted` state.
- Reuses the spine components; does not fork them.
- Motion uses the four durations + named easings; press = scale 0.97 + opacity.
- Haptics from the table only; one per action; system setting honoured.
- Reduced-motion path degrades to opacity-only.
- Light and dark both look intentional (verify both).
- Touch targets ≥44px (≥48px on money paths); accessibility labels present.
- `pnpm --filter @warehouse14/mobile typecheck` passes — a type error is failure.
