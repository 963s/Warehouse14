/**
 * Reserve-and-pickup business rules — earned trust, not one flat number.
 *
 * The first version (2026-07-21) answered "what stops one shopper reserving
 * ALL products?" with a pair of ceilings: eight per reservation, eight held at
 * once. That closed the catalogue-wide attack and nothing else, because a flat
 * cap treats a customer who has collected six pieces exactly like an account
 * created ninety seconds ago, and it is blind to the two things that actually
 * cost this shop money:
 *
 *   1. VALUE, not count. Three items at 40 Euro is a browsing customer.
 *      Three at 4000 is a fifth of the window locked for three days.
 *   2. NOT TURNING UP. A cap says how much can be held at once; it says
 *      nothing about someone who holds the maximum, never comes, and does it
 *      again next week. Nothing here charged for that.
 *
 * The stock IS the business. Every piece is unique, so a held piece is not
 * "less inventory", it is that specific piece unavailable to the person
 * standing at the counter with cash.
 *
 * WHAT THE LADDER IS BUILT FROM. No new tables: the history already exists in
 * `carts`, written by flows that predate this file.
 *
 *   collected  = carts CONVERTED         → they came and paid
 *   no-shows   = carts ABANDONED with a  → the reservation sweeper flips an
 *                reserved_at               expired hold to ABANDONED, so this
 *                                          is precisely "reserved and never
 *                                          collected"
 *
 * A first-time buyer starts small and earns room by showing up. Someone who
 * repeatedly does not show up loses it. That is the whole design, and it is
 * deliberately legible: a customer who asks "why can I only reserve two?"
 * gets a true answer that also tells them how to change it.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export type ReservationTier = 'GESPERRT' | 'GAST' | 'NEU' | 'BEKANNT' | 'STAMM';

export interface TierLimits {
  /** Distinct products held at once, across every live hold. */
  maxItems: number;
  /** Total value of everything held at once, in whole Euro. */
  maxValueEur: number;
}

/**
 * Value ceilings are the real protection and are set to clear a normal single
 * purchase comfortably while stopping accumulation. They are env-overridable
 * because the right number depends on what is in the window this month, and
 * the owner must be able to tune that without a deploy.
 */
export const TIER_LIMITS: Record<ReservationTier, TierLimits> = {
  GESPERRT: { maxItems: 0, maxValueEur: 0 },
  /**
   * Checkout without an account. The tightest rung that still works, and it
   * can never be climbed: every guest checkout mints a fresh shopper row, so
   * a guest accumulates no history to earn against and equally carries no
   * history to be judged by. One piece is enough to come and collect; it is
   * not enough to lock a window.
   */
  GAST: {
    maxItems: envInt('STOREFRONT_TIER_GAST_ITEMS', 1),
    maxValueEur: envInt('STOREFRONT_TIER_GAST_VALUE', 800),
  },
  NEU: {
    maxItems: envInt('STOREFRONT_TIER_NEU_ITEMS', 2),
    maxValueEur: envInt('STOREFRONT_TIER_NEU_VALUE', 1500),
  },
  BEKANNT: {
    maxItems: envInt('STOREFRONT_TIER_BEKANNT_ITEMS', 4),
    maxValueEur: envInt('STOREFRONT_TIER_BEKANNT_VALUE', 5000),
  },
  STAMM: {
    maxItems: envInt('STOREFRONT_TIER_STAMM_ITEMS', 6),
    maxValueEur: envInt('STOREFRONT_TIER_STAMM_VALUE', 15000),
  },
};

/**
 * Ob eine Abholung überhaupt gebucht werden KANN.
 *
 * Solange dies false ist, darf keine verfallene Reservierung als
 * Nichtabholung gegen den Kunden zählen, denn er hätte sie gar nicht abholen
 * können. Der Grund: eine Web-Reservierung nimmt den Halt mit
 * `reserved_by_user_id = NULL` (`routes/storefront-reserve.ts`), und sowohl
 * `finalize()` als auch `release()` verlangen, dass dieses Feld dem Kassierer
 * entspricht. NULL gegen eine UUID trifft nie zu, also 409, also kann das
 * Stück am Tresen weder verkauft noch freigegeben werden. `CONVERTED` ist
 * damit unerreichbar, `collected` ist für JEDEN Kunden dauerhaft 0, und jede
 * Reservierung landet zwangsläufig auf `ABANDONED`.
 *
 * Das Ergebnis war eine Leiter, die niemand hinaufsteigen konnte und jeder
 * hinunterfiel: eine Sperre von sieben Tagen nach dem ersten Verfall, eine
 * dauerhafte nach dem dritten. Das Haus hat seine eigenen Kunden für eine
 * Funktion bestraft, die nie gebaut wurde.
 *
 * Diese Konstante wird in Phase 2 auf true gesetzt, wenn die Übergabe am
 * Tresen wirklich buchbar ist, und danach ersatzlos entfernt. Ein Test hält
 * beides fest.
 */
export const HANDOVER_IS_BOOKABLE = false;

/** No-shows that cost a tier, and the count that stops reservations entirely. */
export const NO_SHOWS_BEFORE_DEMOTION = envInt('STOREFRONT_NO_SHOWS_DEMOTE', 2);
export const NO_SHOWS_BEFORE_BLOCK = envInt('STOREFRONT_NO_SHOWS_BLOCK', 3);

/**
 * Quiet period after failing to collect. Long enough to be felt, short enough
 * that a customer who was simply ill is not treated as an adversary.
 */
export const NO_SHOW_COOLDOWN_DAYS = envInt('STOREFRONT_NO_SHOW_COOLDOWN_DAYS', 7);

export interface ShopperReservationFacts {
  /** Carts that reached CONVERTED: they came and paid. */
  collected: number;
  /** Carts ABANDONED after being reserved: held and never collected. */
  noShows: number;
  /** When the most recent no-show lapsed, for the cooldown. */
  lastNoShowAt: Date | null;
  /** Staff judgement, which always outranks computed history. */
  trustLevel: string | null;
  /**
   * A confirmed address. Google sign-in supplies this; e-mail sign-up must
   * complete the verification. Unverified means an address nobody has proved
   * they can read, which is exactly the shape of a throwaway.
   */
  emailVerified: boolean;
  /** Checkout without an account: identified by pickup contact only. */
  isGuest: boolean;
}

export interface ReservationAllowance extends TierLimits {
  tier: ReservationTier;
  /** Set when reserving is refused outright. Machine readable, not prose. */
  blockedReason: 'BANNED' | 'TOO_MANY_NO_SHOWS' | 'EMAIL_UNVERIFIED' | 'COOLDOWN' | null;
  /** When a cooldown is what blocks them, when it lifts. */
  cooldownUntil: Date | null;
}

/**
 * The ladder. Pure, so it is testable without a database and reads as the
 * policy it is.
 *
 * Order matters: staff judgement first, then hard blocks, then earned tier.
 * A customer marked BANNED by a human is not argued with by arithmetic.
 */
export function deriveReservationAllowance(
  f: ShopperReservationFacts,
  now: Date,
): ReservationAllowance {
  const blocked = (
    reason: NonNullable<ReservationAllowance['blockedReason']>,
    cooldownUntil: Date | null = null,
  ): ReservationAllowance => ({
    tier: 'GESPERRT',
    ...TIER_LIMITS.GESPERRT,
    blockedReason: reason,
    cooldownUntil,
  });

  if (f.trustLevel === 'BANNED' || f.trustLevel === 'SUSPICIOUS') return blocked('BANNED');

  // Ein Urteil eines Menschen gilt immer. Gerechnete Nichtabholungen gelten
  // nur, wenn eine Abholung überhaupt möglich war — siehe HANDOVER_IS_BOOKABLE.
  if (HANDOVER_IS_BOOKABLE) {
    if (f.noShows >= NO_SHOWS_BEFORE_BLOCK) return blocked('TOO_MANY_NO_SHOWS');

    if (f.lastNoShowAt) {
      const until = new Date(f.lastNoShowAt.getTime() + NO_SHOW_COOLDOWN_DAYS * 86_400_000);
      if (until > now) return blocked('COOLDOWN', until);
    }
  }

  // A guest is its own rung, not a punished customer. They identified
  // themselves with a pickup contact rather than an account, which is enough
  // to hold one piece and not enough to hold a window.
  if (f.isGuest) {
    return { tier: 'GAST', ...TIER_LIMITS.GAST, blockedReason: null, cooldownUntil: null };
  }

  // Earned by showing up. VIP and VERIFIED are staff-granted and carry KYC
  // (customers_verified_trust_requires_kyc), so they start at the top.
  let tier: ReservationTier =
    f.trustLevel === 'VIP' || f.trustLevel === 'VERIFIED'
      ? 'STAMM'
      : f.collected >= 3
        ? 'STAMM'
        : f.collected >= 1
          ? 'BEKANNT'
          : 'NEU';

  // ONE penalty rule, applied once. An earlier draft also excluded STAMM
  // whenever no-shows were non-zero, which then demoted on top of that: a
  // customer who had collected five times and missed twice landed on the
  // bottom rung beside a brand new account. Punishing the same fact twice is
  // how a rule meant to protect stock starts driving good customers away.
  //
  // One failure to collect is a bad week. Two is a pattern, and costs a rung
  // even for someone with history — but only a rung.
  //
  // Auch diese Stufe gilt nur, wenn eine Abholung buchbar war. Sonst bliebe
  // die halbe Strafe stehen, während der Kunde für nichts bestraft würde.
  if (HANDOVER_IS_BOOKABLE && f.noShows >= NO_SHOWS_BEFORE_DEMOTION) {
    tier = tier === 'STAMM' ? 'BEKANNT' : 'NEU';
  }

  // An unverified address RESTRICTS rather than blocks. Blocking it was the
  // first draft and it was wrong: on the live database only three of fourteen
  // registered shoppers carry a verification timestamp, so that rule would
  // have refused reservations to almost every real customer while calling
  // itself a security improvement. An address nobody has proved they can read
  // is a reason not to extend trust, not a reason to refuse business.
  if (!f.emailVerified && (tier === 'STAMM' || tier === 'BEKANNT')) {
    tier = 'NEU';
  }

  return { tier, ...TIER_LIMITS[tier], blockedReason: null, cooldownUntil: null };
}

/**
 * A single piece worth more than the whole ceiling is not hoarding, it is the
 * purchase. Blocking it would turn a rule meant to stop accumulation into one
 * that refuses the shop's best sales, so one item alone is always allowed to
 * exceed the value ceiling — it simply cannot be joined by a second.
 */
export function valueCeilingApplies(itemCount: number): boolean {
  return itemCount > 1;
}

/**
 * Max distinct products ONE reservation may hold. Kept as an absolute backstop
 * above the tiers: even a STAMM customer sends a script the same message.
 */
export const MAX_ITEMS_PER_RESERVATION = envInt('STOREFRONT_MAX_ITEMS_PER_RESERVATION', 6);

/** @deprecated Superseded by the tier ladder. Retained so older callers that
 *  still import it keep compiling; new checks must use the allowance. */
export const MAX_ACTIVE_RESERVED_PER_SHOPPER = envInt(
  'STOREFRONT_MAX_ACTIVE_RESERVED_PER_SHOPPER',
  6,
);

/** Cart ceiling mirrors the reservation cap so "cart full" arrives honestly
 *  early rather than as a surprise at reserve time. */
export const MAX_ITEMS_PER_CART = MAX_ITEMS_PER_RESERVATION;
