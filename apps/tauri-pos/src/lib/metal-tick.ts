/**
 * metal-tick — pure formatting for one metal-price ticker cell (UX §3.A).
 *
 * Takes the REAL current price and a prior reference (the ticker supplies the
 * 10-day average from the rates query) and produces the glanceable trio:
 *   • price      — German-comma, 2 dp (or "—" when unknown)
 *   • deltaLabel — signed percent, German comma (e.g. "+4,2 %"); "" when no Δ
 *   • tone       — 'up' | 'down' | 'flat' (drives verdigris / wax-red / neutral)
 *
 * No facade: the sign/tone is computed from current-vs-prior. No float drift
 * concern — this is a display percent + a sign, not money arithmetic.
 */
import { normalizeDecimal } from './decimal.js';

export type TickTone = 'up' | 'down' | 'flat';

export interface MetalTick {
  price: string;
  deltaLabel: string;
  tone: TickTone;
}

/** Below this absolute percent the move reads as flat (rounds to 0,0 %). */
const FLAT_EPSILON_PCT = 0.05;

function parseDecimal(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const n = Number(normalizeDecimal(String(s)));
  return Number.isFinite(n) ? n : null;
}

/** Locale-free German number: fixed dp, dot → comma. */
function deFixed(n: number, dp: number): string {
  return n.toFixed(dp).replace('.', ',');
}

export function formatMetalTick(
  current: string | null | undefined,
  prior: string | null | undefined,
): MetalTick {
  const cur = parseDecimal(current);
  if (cur === null) return { price: '—', deltaLabel: '', tone: 'flat' };

  const price = deFixed(cur, 2);
  const pri = parseDecimal(prior);
  if (pri === null || pri === 0) return { price, deltaLabel: '', tone: 'flat' };

  const pct = ((cur - pri) / pri) * 100;
  let tone: TickTone = 'flat';
  if (pct > FLAT_EPSILON_PCT) tone = 'up';
  else if (pct < -FLAT_EPSILON_PCT) tone = 'down';

  const sign = tone === 'up' ? '+' : tone === 'down' ? '−' : '';
  const deltaLabel = `${sign}${deFixed(Math.abs(pct), 1)} %`;
  return { price, deltaLabel, tone };
}
