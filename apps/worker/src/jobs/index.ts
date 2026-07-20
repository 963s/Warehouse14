/**
 * V1 job registry — re-exported through the runner factory.
 *
 * Adding a new job:
 *   1. Define it under `apps/worker/src/jobs/<name>.ts` exporting a `JobDefinition`.
 *   2. Add the import + registration in `app.ts` `registerJobs(...)`.
 *   3. Update memory.md decision #63's job inventory.
 *   4. Add migration if the job needs new tables / columns.
 *   5. Write an integration test that drives it via `runner.runOnce(name)`.
 */

export { reservationSweeperJob } from './reservation-sweeper.js';
export { posReservationSweeperJob } from './pos-reservation-sweeper.js';
export { ebaySyncJob } from './ebay-sync.js';
export { emailOutboxSenderJob } from './email-outbox-sender.js';
export { chainVerifierJob } from './chain-verifier.js';
export { sessionsCleanupJob } from './sessions-cleanup.js';
export { workerJobRunsRetentionJob } from './worker-job-runs-retention.js';
export { anomalyWatchdogJob } from './anomaly-watchdog.js';
export { lbmaPricesJob } from './lbma-prices.js';
export { dsfinvkDailyExportJob } from './dsfinvk-daily-export.js';
export { storefrontCartSweeperJob } from './storefront-cart-sweeper.js';
export { intakeSweepJob } from './intake-sweep.js';
export { appointmentNoShowDetectorJob } from './appointment-no-show-detector.js';
export { appointmentNotificationsJob } from './appointment-notifications.js';
export { tseArchiveExporterJob } from './tse-archive-exporter.js';
export { tseCertCheckerJob } from './tse-cert-checker.js';
export { gdprCleanupJob } from './gdpr-cleanup.js';
export { productPhotoPurgeJob } from './product-photo-purge.js';
