import { describe, expect, it } from 'vitest';

import { type IntakeStatusKind, LANGUAGE_CODES, intakeStatusMessage } from '../src/index.js';

const KINDS: IntakeStatusKind[] = [
  'received',
  'processing',
  'ready',
  'published',
  'needs_more_info',
  'rejected',
  'failed',
  'help',
];

describe('intakeStatusMessage', () => {
  it('has a non-empty template for every kind × language', () => {
    for (const kind of KINDS) {
      for (const lang of LANGUAGE_CODES) {
        const msg = intakeStatusMessage(kind, lang);
        expect(typeof msg).toBe('string');
        expect(msg.length).toBeGreaterThan(0);
      }
    }
  });

  it('returns the language-specific copy', () => {
    expect(intakeStatusMessage('ready', 'en')).toContain('Control Desktop');
    expect(intakeStatusMessage('ready', 'de')).toContain('Control Desktop');
    expect(intakeStatusMessage('needs_more_info', 'de')).toContain('unscharf');
  });
});
