/**
 * TypeBox schemas for POST /api/transactions/:id/tse-signature (migration 0054).
 *
 * Durable, server-side persistence of the Fiskaly SIGN DE V2 signature the POS
 * received from its local TSE bridge after a successful finalize+FINISH. GoBD /
 * BSI TR-03153 require the signature to be recorded server-side, linked to the
 * transaction it signs — previously it lived only on the thermal receipt + the
 * POS's browser localStorage offline queue.
 *
 * The signature counter and Fiskaly transaction number are monotonic BIGINTs;
 * they ride the wire as decimal STRINGS so we never lose precision through a
 * JS `number`. The POS already stringifies them (`String(signatureCounter)`).
 */

import { type Static, Type } from '@sinclair/typebox';

/** A non-negative integer carried as a decimal string (bigint-safe). */
const BigIntString = Type.String({
  pattern: '^[0-9]+$',
  description: 'A non-negative integer encoded as a decimal string (bigint-safe).',
  examples: ['42', '1000003'],
});

export const TseSignatureParams = Type.Object({
  /** The fiscal transaction this signature belongs to. */
  id: Type.String({ format: 'uuid' }),
});
export type TseSignatureParams = Static<typeof TseSignatureParams>;

export const TseSignatureBody = Type.Object({
  /** Fiskaly TSS module id (the signing TSS). */
  fiskalyTssId: Type.String({ format: 'uuid' }),
  /** Fiskaly client id (the POS register registered with the TSS). */
  fiskalyClientId: Type.String({ format: 'uuid' }),
  /** Fiskaly's TRANSACTION uuid, when the bridge surfaces it. */
  fiskalyTransactionId: Type.Optional(Type.String({ format: 'uuid' })),
  /** Monotonic per-TSS transaction number (KassenSichV). */
  fiskalyTransactionNumber: BigIntString,

  /** Base64 signature value (printed on the receipt). */
  signatureValue: Type.String({ minLength: 1, maxLength: 8192 }),
  /** Monotonic per-TSS signature counter. */
  signatureCounter: BigIntString,
  /** Signature algorithm, e.g. 'ecdsa-plain-SHA256'. */
  signatureAlgorithm: Type.Optional(Type.String({ maxLength: 128 })),

  /** KassenSichV process classification. */
  processType: Type.Optional(Type.String({ maxLength: 128 })),
  /** Receipt-ready QR code payload (BSI TR-03151). */
  qrCodeData: Type.Optional(Type.String({ maxLength: 8192 })),

  /** When the TSE TRANSACTION started (Fiskaly-reported). */
  tseStartTime: Type.Optional(Type.String({ format: 'date-time' })),
  /** When the TSE TRANSACTION finalized / was signed (Fiskaly-reported). */
  tseEndTime: Type.Optional(Type.String({ format: 'date-time' })),
});
export type TseSignatureBody = Static<typeof TseSignatureBody>;

export const TseSignatureResponse = Type.Object({
  /** ID of the tse_signatures evidence row. */
  id: Type.String({ format: 'uuid' }),
  /** The fiscal transaction the signature belongs to. */
  transactionId: Type.String({ format: 'uuid' }),
  /** TRUE when this POST created the row; FALSE when it was already recorded (idempotent no-op). */
  created: Type.Boolean(),
  /** When the signature was recorded server-side. */
  recordedAt: Type.String({ format: 'date-time' }),
});
export type TseSignatureResponse = Static<typeof TseSignatureResponse>;
