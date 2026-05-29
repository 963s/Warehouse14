import { describe, expect, it } from 'vitest';

import {
  type CommandType,
  LANGUAGE_CODES,
  type LanguageCode,
  OVERRIDE_COMMAND_KEYWORDS,
  type OverrideCommand,
  parseOverrideCommand,
} from '../src/index.js';
import { intBetween, mulberry32, pick } from './fuzz.js';

const COMMANDS: CommandType[] = ['DONE', 'NEW', 'CANCEL', 'HELP'];

function typeOf(r: OverrideCommand | null): string | null {
  return r ? r.type : null;
}

describe('parseOverrideCommand — exhaustive keyword table', () => {
  it('recognizes every keyword as exactly its command type', () => {
    for (const cmd of COMMANDS) {
      for (const lang of LANGUAGE_CODES) {
        for (const kw of OVERRIDE_COMMAND_KEYWORDS[cmd][lang]) {
          // '?' is shared by HELP across languages — it must resolve to HELP.
          const expected = kw === '?' ? 'HELP' : cmd;
          expect(typeOf(parseOverrideCommand(kw, lang))).toBe(expected);
        }
      }
    }
  });
});

describe('parseOverrideCommand — normalization', () => {
  it('is case-insensitive, trims punctuation, strips emoji', () => {
    expect(typeOf(parseOverrideCommand('FERTIG', 'de'))).toBe('DONE');
    expect(typeOf(parseOverrideCommand('  fertig!  ', 'de'))).toBe('DONE');
    expect(typeOf(parseOverrideCommand('Done.', 'en'))).toBe('DONE');
    expect(typeOf(parseOverrideCommand('✅ done', 'en'))).toBe('DONE');
  });

  it('resolves the Arabic question mark and alif variants', () => {
    expect(typeOf(parseOverrideCommand('؟', 'ar'))).toBe('HELP');
    expect(typeOf(parseOverrideCommand('?', 'de'))).toBe('HELP');
    // alif-with-hamza variant of الغاء should still cancel.
    expect(typeOf(parseOverrideCommand('إلغاء', 'ar'))).toBe('CANCEL');
  });

  it('returns null for ordinary caption text', () => {
    expect(parseOverrideCommand('das ist ein schöner Ring', 'de')).toBeNull();
    expect(parseOverrideCommand('hello there friend', 'en')).toBeNull();
    expect(parseOverrideCommand('', 'de')).toBeNull();
    expect(parseOverrideCommand('   ', 'de')).toBeNull();
  });
});

describe('parseOverrideCommand — layout splits', () => {
  it('parses ranges and singletons into labeled groups', () => {
    const r = parseOverrideCommand('1-3 = A, 4 = B', 'en');
    expect(r).toEqual({
      type: 'SPLIT',
      groups: [
        { label: 'A', photoIndices: [1, 2, 3] },
        { label: 'B', photoIndices: [4] },
      ],
    });
  });

  it('accepts optional prefix words/emoji in any language', () => {
    expect(parseOverrideCommand('📷 1-2=A,3=B', 'de')).toEqual({
      type: 'SPLIT',
      groups: [
        { label: 'A', photoIndices: [1, 2] },
        { label: 'B', photoIndices: [3] },
      ],
    });
    expect(typeOf(parseOverrideCommand('Bilder 1=A, 2=B', 'de'))).toBe('SPLIT');
    expect(typeOf(parseOverrideCommand('صور 1=A,2=B', 'ar'))).toBe('SPLIT');
  });

  it('does not treat prose containing "4=B" as a split', () => {
    expect(parseOverrideCommand('the answer to 4=B is unclear', 'en')).toBeNull();
  });
});

describe('parseOverrideCommand — fuzzer (400 inputs)', () => {
  it('recognizes keywords under random casing, padding, and emoji noise', () => {
    const rng = mulberry32(0x5eed);
    const pads = ['', ' ', '  ', '\t'];
    const puncts = ['', '!', '.', '...', '!!'];
    const emojis = ['', '✅', '👍', '📷'];
    for (let i = 0; i < 400; i++) {
      const cmd = pick(rng, COMMANDS);
      const lang = pick(rng, LANGUAGE_CODES) as LanguageCode;
      const kws = OVERRIDE_COMMAND_KEYWORDS[cmd][lang];
      const kw = pick(rng, kws);
      // Random case mutation for Latin scripts.
      const cased = kw
        .split('')
        .map((ch) => (rng() < 0.5 ? ch.toUpperCase() : ch.toLowerCase()))
        .join('');
      const noisy = `${pick(rng, emojis)}${pick(rng, pads)}${cased}${pick(rng, puncts)}${pick(rng, pads)}`;
      const expected = kw === '?' ? 'HELP' : cmd;
      expect(typeOf(parseOverrideCommand(noisy, lang))).toBe(expected);
    }
  });

  it('split fuzzer: random partitions round-trip into sorted groups', () => {
    const rng = mulberry32(0x1234);
    for (let i = 0; i < 100; i++) {
      const n = intBetween(rng, 2, 6);
      const cut = intBetween(rng, 1, n - 1);
      const text = `1-${cut}=A, ${cut + 1}-${n}=B`;
      const r = parseOverrideCommand(text, 'en');
      expect(r?.type).toBe('SPLIT');
      if (r && r.type === 'SPLIT') {
        const a = r.groups.find((g) => g.label === 'A');
        const b = r.groups.find((g) => g.label === 'B');
        expect(a?.photoIndices[0]).toBe(1);
        expect(b?.photoIndices[b.photoIndices.length - 1]).toBe(n);
      }
    }
  });
});
