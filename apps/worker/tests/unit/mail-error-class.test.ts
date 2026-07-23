/**
 * Der genaue Fall, der einen echten Brief gekostet hat, muss als
 * VORUEBERGEHEND erkannt werden — und eine tote Adresse als endgueltig.
 */
import { describe, expect, it } from 'vitest';

import { classifyMailError, shouldParkAsFailed } from '../../src/jobs/mail-error-class.js';

describe('classifyMailError', () => {
  it('erkennt Googles 421-Ratenlimit als voruebergehend', () => {
    // Wortwoertlich der Fehler aus der Produktion am 23.07.2026.
    expect(classifyMailError('Server terminates connection. response=421-4.7.0 Try again later')).toBe(
      'transient',
    );
  });

  it('erkennt Verbindungs- und Zeitfehler als voruebergehend', () => {
    for (const m of [
      'connect ECONNRESET 142.250.0.1:587',
      'Connection timed out',
      'read ETIMEDOUT',
      'socket hang up',
      'temporary failure, please retry',
      '450 4.2.1 mailbox temporarily unavailable',
    ]) {
      expect(classifyMailError(m), m).toBe('transient');
    }
  });

  it('erkennt endgueltige Fehler als endgueltig', () => {
    for (const m of [
      '550 5.1.1 The email account that you tried to reach does not exist',
      '553 sorry, that domain is not in my list of allowed rcpthosts',
      'recipient decryption returned null',
    ]) {
      expect(classifyMailError(m), m).toBe('permanent');
    }
  });

  it('behandelt Unbekanntes als endgueltig, statt ewig zu klopfen', () => {
    expect(classifyMailError('unknown send failure')).toBe('permanent');
  });
});

describe('shouldParkAsFailed', () => {
  const limits = { permanentAfter: 1, transientAfter: 20 };

  it('parkt einen 550 sofort beim ersten Versuch', () => {
    expect(shouldParkAsFailed('550 no such user', 0, limits)).toBe(true);
  });

  it('laesst ein 421 beim ersten Versuch NICHT sterben', () => {
    // Genau der Bug: attempts=0, ein 421 → frueher „isFinal" bei 5, jetzt
    // bleibt es PENDING, weil das Ratenlimit gleich vorbei ist.
    expect(shouldParkAsFailed('421-4.7.0 Try again later', 0, limits)).toBe(false);
    expect(shouldParkAsFailed('421-4.7.0 Try again later', 4, limits)).toBe(false);
  });

  it('gibt ein 421 erst nach der grosszuegigen Grenze auf', () => {
    expect(shouldParkAsFailed('421-4.7.0 Try again later', 19, limits)).toBe(true);
  });
});
