/**
 * metal-tick — pure formatting behind the metal-price ticker cell (UX §3.A).
 * No facade: the Δ sign/tone is computed from real current-vs-prior; German
 * comma in, German comma out. The view consumes this; it owns no React.
 */
import { describe, expect, it } from 'vitest';

import { formatMetalTick } from './metal-tick.js';

describe('formatMetalTick', () => {
  it('up → verdigris tone with a + delta, German-comma price', () => {
    const t = formatMetalTick('62.50', '60.00');
    expect(t.tone).toBe('up');
    expect(t.price).toBe('62,50');
    expect(t.deltaLabel.startsWith('+')).toBe(true);
  });

  it('down → wax-red tone with a − delta, tolerating German-comma inputs', () => {
    const t = formatMetalTick('58,00', '60,00');
    expect(t.tone).toBe('down');
    expect(t.deltaLabel.includes('−')).toBe(true);
    expect(t.price).toBe('58,00');
  });

  it('flat → neutral tone when current equals prior', () => {
    expect(formatMetalTick('60.00', '60.00').tone).toBe('flat');
  });

  it('missing / zero prior → neutral, no divide-by-zero, no delta label', () => {
    expect(formatMetalTick('60.00', null).tone).toBe('flat');
    expect(formatMetalTick('60.00', null).deltaLabel).toBe('');
    expect(formatMetalTick('60.00', '0').tone).toBe('flat');
  });

  it('missing current renders a hyphen placeholder price, neutral tone', () => {
    const t = formatMetalTick(null, '60.00');
    expect(t.price).toBe('-');
    expect(t.tone).toBe('flat');
  });
});
