# Warehouse14 Owner OS — Design Language

The single visual contract for the OWNER mobile app. Every later agent follows
this. The goal is one feel across all surfaces: native, fluid, beautiful,
instantly understandable, deep, trustworthy — an app you would believe shipped
from Apple. Consistency is the whole point; do not invent parallel scales.

Source of truth for token VALUES is `apps/mobile/src/warehouse14/theme.ts`
(mirrored 1:1 into `apps/mobile/global.css` as `--w14-*` vars, then exposed as
NativeWind utility tokens). This file is the source of truth for the RULES —
how those tokens are used, plus motion and haptics, which have no code yet and
must be built to match what is written here.

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

## 2. Radii — only three values exist

From `theme.radii`. There is no other radius anywhere.

- `none` = 0 — full-bleed dividers, edge-to-edge media.
- `button` = 8 — buttons, inputs, chips, badges, small controls.
- `card` = 12 — cards, sheets, panels, the soft disc behind an empty-state icon
  (a circle = `rounded-full`, the one allowed exception, only for icon discs and
  avatars).

NativeWind mapping is pinned in `global.css`: `rounded-md` → 8, `rounded-xl` /
`rounded-2xl` → 12. Do not reach for `rounded-lg`/`rounded-3xl` expecting a new
radius — they resolve into the allowed set on purpose.

---

## 3. Type ramp — Inter + JetBrains Mono

Families load in the root layout via `theme.fonts`; never name a raw font
string. Two families only:

- Inter — all display and body text. Weights: `body` 400, `medium` 500,
  `semibold` 600, `bold` 700.
- JetBrains Mono — numerals that must align in a column (money tables, weights,
  serial numbers, IDs): `mono` 400, `monoMedium` 500. Mono is for tabular
  numerics, not prose.

The ramp (size · weight · use). Sizes are the NativeWind text classes already
used by the spine:

| step          | class / size      | weight        | use                                         |
| ------------- | ----------------- | ------------- | ------------------------------------------- |
| Hero KPI      | `text-2xl` (24)   | bold 700      | the single big number on a `StatTile`        |
| Screen title  | `text-xl` (20)    | bold 700      | screen header                                |
| Section title | `text-base` (16)  | semibold 600  | `SectionCard` / group headers                |
| Body          | `text-sm`–`base`  | regular 400   | row titles, descriptions                     |
| Label / meta  | `text-xs` (12)    | regular 400   | captions, hints — always `text-muted-foreground` |
| Micro         | `text-2xs` (11)   | regular 400   | the tiniest hint under a value               |

How weight resolves to a face: Inter loads as four DISTINCT named faces, so a
numeric `font-weight` alone does not pick them on native. `global.css` pins each
weight class to its face — `font-medium` → Inter 500, `font-semibold` → 600,
`font-bold` → 700 — so `text-… font-semibold` renders the real SemiBold. Mono is
a separate family: use `font-mono` (IDs/SKUs) or `font-mono-medium` (emphasised
numerics — KPI values, totals) and NEVER pair mono with an Inter weight class,
which would re-select the Inter face and lose the tabular figures. The KPI hero
value is `font-mono-medium text-2xl`; the size carries the emphasis. The `type`
object on `useW14Theme()` mirrors the ramp for the rare style-prop case.

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

## 4. Colour — brass, verdigris, gold, and the honest palette

Pull from `useW14Theme().colors`. Light and dark palettes both live in
`theme.ts` and flip on the OS scheme; never branch on `isDark` to pick a colour
that the palette already resolves.

Role colours and their ONE meaning each — do not cross the wires:

- `primary` — BRASS (`#9a751f` light · `#d8b14e` dark). The primary action and
  the brand. Primary buttons, active states, the leading icon on a `SectionCard`,
  the default `StatTile` value, focus `ring`. This is the colour that carries
  text-bearing emphasis. When in doubt, brass.
- `verdigris` — GREEN POSITIVE (`#157a4b` light · `#2fb277` dark). Success,
  positive deltas, "paid / done / in stock", confirmation banners. Mapped to the
  NativeWind `accent` token. Profit up is verdigris; profit down is
  `destructive` — never colour a real loss green.
- `gold` (`#bf9430`) — DECORATIVE ONLY. Hairline flourishes, a celebratory
  shimmer, a gauge accent on a milestone. NEVER text, never a text-bearing fill,
  never an icon a user must read. If a glyph or label sits on it, it is wrong —
  use brass. This is a hard rule carried from the web tokens.
- `destructive` — WAX RED (`#d63d49` / `#e15862`). Errors, irreversible/danger
  actions, real negative numbers.
- `foreground` / `mutedForeground` — primary text / captions+hints+meta.
- `background` / `card` — app canvas (parchment) / panels.
- `border` — hairline rules (1px), the only divider weight.

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

## 5. Elevation — flat, one soft shadow

Warehouse14 is a flat, paper-calm surface. There is exactly one elevation step
and it is already on the RNR `Card`: `shadow-sm shadow-black/5` over a 1px
`border`. Cards do not stack shadows or get heavier on press.

- Resting card: 1px `border` + the single soft shadow. That is the maximum.
- Pressed card/row: do NOT raise elevation — signal press with the motion +
  haptic below (a brief scale-down and an opacity dip), not a bigger shadow.
- Floating layers (sheets, dialogs, the sticky save bar): same `card` fill, a
  top `border` hairline, and a scrim behind modals (`background` at ~50% via an
  overlay) — not a darker drop shadow. Depth comes from layering and motion, not
  from shadow weight.

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
- Gold appears only as decoration, never under text.
- Every shown number is real from an endpoint, or a locked/empty/`muted` state.
- Reuses the spine components; does not fork them.
- Motion uses the four durations + named easings; press = scale 0.97 + opacity.
- Haptics from the table only; one per action; system setting honoured.
- Reduced-motion path degrades to opacity-only.
- Light and dark both look intentional (verify both).
- Touch targets ≥44px (≥48px on money paths); accessibility labels present.
- `pnpm --filter @warehouse14/mobile typecheck` passes — a type error is failure.
