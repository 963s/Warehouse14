/**
 * Enums backing the finance tables (migration 0075, Owner OS finance backend).
 */

import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Categories for one-off operating expenses (Betriebsausgaben). Kept broad and
 * stable; the route validates against this same source of truth.
 */
export const expenseCategory = pgEnum('expense_category', [
  'WARENEINKAUF', // goods / consumables not via Ankauf
  'MIETE', // one-off rent-adjacent (deposit, etc.)
  'MARKETING', // ads, print, listings fees
  'VERSAND', // postage / courier
  'BUEROMATERIAL', // office supplies
  'REPARATUR', // repairs / maintenance
  'GEBUEHREN', // bank / platform / professional fees
  'REISEKOSTEN', // travel
  'SONSTIGES', // other
]);

export const EXPENSE_CATEGORIES = [
  'WARENEINKAUF',
  'MIETE',
  'MARKETING',
  'VERSAND',
  'BUEROMATERIAL',
  'REPARATUR',
  'GEBUEHREN',
  'REISEKOSTEN',
  'SONSTIGES',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
