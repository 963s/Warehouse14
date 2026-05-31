/**
 * Deterministic mock Bridge state (ADR-0019 §1 diagram + §5 briefing). Lets the
 * dashboard render fully offline during the UI phase. The shapes match
 * `BridgeData` exactly, so the live SSE + query bindings in the next step are a
 * drop-in replacement — no component edits required.
 */

import type { BridgeData } from './types.js';

export const MOCK_BRIDGE: BridgeData = {
  // ADR-0019 §5 — Arabic by Basel's `users.preferred_language` preference.
  briefing: {
    greeting: 'صباح الخير. اليوم عندك:',
    lines: [
      '3 drafts بانتظار موافقتك (intake bot من أمس بعد 18:00)',
      '1 طلب eBay وصل في الليل — Goldmünze 1oz Krügerrand €1,890',
      'تذكير: Steuerberater يحتاج DSFinV-K export قبل الأربعاء',
      'Marie تبدأ في 09:30 (per schedule)',
      'سعر الذهب اليوم €58.42/g (LBMA Vormittagsfix)',
      '4 مواعيد اليوم — أولها 14:45 Mr. Schmidt VIEWING',
    ],
  },

  // Center column — chronological live feed (newest first).
  feed: [
    {
      id: 'evt-1432',
      time: '14:32',
      tone: 'ok',
      title: 'Verkauf €1.250 · Marie',
      detail: 'Kunde: anonym (Verkauf, Differenzbesteuerung)',
    },
    {
      id: 'evt-1428',
      time: '14:28',
      tone: 'info',
      title: 'KYC erfasst · Marie',
      detail: 'Kunde #4521 · Ankauf €450',
    },
    {
      id: 'evt-1425',
      time: '14:25',
      tone: 'watch',
      title: 'Entwurf bereit: Goldring',
      detail: '585 · 18 mm · Filigran — wartet auf Freigabe',
    },
    {
      id: 'evt-1420',
      time: '14:20',
      tone: 'ok',
      title: 'Verkauf €87 · Marie',
      detail: 'Barzahlung',
    },
    {
      id: 'evt-1414',
      time: '14:14',
      tone: 'info',
      title: 'Termin eingecheckt',
      detail: 'Hr. Schmidt · BESICHTIGUNG',
    },
  ],

  // Left rail — slow-burning watch items (ADR-0019 §1 "WATCH").
  watch: [
    {
      id: 'watch-tse',
      tone: 'watch',
      text: 'TSE-Zertifikat läuft in 14 Tagen ab',
    },
    {
      id: 'watch-reconciler',
      tone: 'watch',
      text: 'Reconciler-Warteschlange verzögert: 3 übersprungen (letzte Stunde)',
    },
  ],

  counts: { alert: 0, watch: 2, ok: 18 },

  // Right rail — quick-action tiles. `surface` is the Karteikasten digit each
  // tile deep-dives into (1 Übersicht · 2 Genehmigungen · 4 Kunden …).
  quickActions: [
    { id: 'drafts', label: 'Intake-Entwürfe', count: 3, surface: 2 },
    { id: 'inbox', label: 'Posteingang', count: 7, surface: 4 },
    { id: 'approvals', label: 'Genehmigungen', count: 1, surface: 2 },
  ],

  bot: { active: 3, awaitingHuman: 2 },

  appointments: { next: '14:45', today: 4 },

  stats: {
    revenueEur: '4250.00',
    salesCount: 12,
    ankaufCount: 3,
    ankaufEur: '1800.00',
  },
};
