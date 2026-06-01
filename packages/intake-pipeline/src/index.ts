/**
 * @warehouse14/intake-pipeline — the deterministic, AI-free core of the AI
 * Intake Pipeline (ADR-0015):
 *   • classifyTaxTreatment   — §25a/§25c/§12 rules (never an LLM),
 *   • parseOverrideCommand   — DONE/NEW/CANCEL/HELP + layout splits,
 *   • grouping-window logic  — the 120s sliding window.
 *
 * Pure + property-tested. The worker/webhook inject the AI + I/O around it.
 */

export * from './types.js';
export * from './tax-treatment-classifier.js';
export * from './parser/overrideCommands.js';
export * from './grouping.js';
export * from './status-messages.js';
export * from './price-estimate.js';
