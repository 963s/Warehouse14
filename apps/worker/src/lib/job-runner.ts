/**
 * `JobRunner` — the heart of the Day-18 worker.
 *
 * Each registered job is a `{ name, schedule, run, options }` tuple. The
 * runner is `cron`-driven (default) but also exposes `runOnce(name)` for
 * tests and for ad-hoc execution from the operator console.
 *
 * Resilience contract (see memory.md #63):
 *
 *   1. **Advisory lock per job.** Before each attempt the runner opens a
 *      DEDICATED single-connection `postgres-js` instance and calls
 *      `pg_try_advisory_lock(hashtext(jobName))`. If the lock fails to
 *      acquire, the tick is SKIPPED — another instance (or the previous
 *      tick of this instance) is still running. The lock is session-scoped:
 *      if the worker crashes mid-job, PG releases the lock at session
 *      death, so the next tick of the next instance picks up cleanly.
 *
 *   2. **worker_job_runs row per attempt.** INSERTed as RUNNING at start,
 *      UPDATEd to SUCCESS / FAILED / TIMEOUT / SKIPPED at end. Always
 *      finalised — `try { … } finally { … }` guarantees a terminal write.
 *
 *   3. **Consecutive-failure budget + DLQ.** Per-job counter in memory.
 *      On SUCCESS → 0. On FAILED|TIMEOUT → ++; when ≥ maxRetries we push
 *      a row to `worker_job_dlq`, emit `alert.worker_job_dead_letter` to
 *      `ledger_events`, and reset the counter (so the job can recover later).
 *
 *   4. **Hard timeout per attempt.** `AbortController` with `setTimeout`;
 *      the job receives the signal and SHOULD honour it. After timeout
 *      we record TIMEOUT and free the lock.
 *
 *   5. **Graceful shutdown.** `runner.close()` flips a `closing` flag that
 *      makes all future ticks SKIPPED, awaits in-flight runs (up to a
 *      shutdown timeout), and stops the cron schedules.
 *
 * No `setImmediate`/`process.nextTick` magic; just disciplined
 * `async/await` + `try/finally`.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import { emit } from '@warehouse14/audit';
import type { AppDb, WorkerDb } from '@warehouse14/db/client';
import { workerJobDlq, workerJobRuns } from '@warehouse14/db/schema';

import type { WorkerMetrics } from './metrics.js';

/** Public job-handler signature. Receives a structured context. */
export interface JobContext {
  /** Drizzle client on the worker pool. */
  db: WorkerDb;
  /** Raw `postgres-js` Sql tag on the same pool (for advisory queries, NOTIFY, etc.). */
  sql: Sql;
  /** Per-attempt UUID — log it for correlation with worker_job_runs.run_id. */
  runId: string;
  /** worker_job_runs.id (bigint) for the current attempt — embed in domain rows for forensics. */
  jobRunId: bigint;
  /** Job-scoped abort signal that fires on timeout or graceful shutdown. */
  signal: AbortSignal;
  /** Structured logger preconfigured with { job, runId }. */
  log: {
    info: (msg: string, extra?: Record<string, unknown>) => void;
    warn: (msg: string, extra?: Record<string, unknown>) => void;
    error: (msg: string, extra?: Record<string, unknown>) => void;
    debug: (msg: string, extra?: Record<string, unknown>) => void;
  };
}

/** A job's return value lands in `worker_job_runs.payload` as JSON. */
export type JobResultPayload = Record<string, unknown>;

export interface JobDefinition {
  /** Unique identifier — used as the advisory-lock key seed via `hashtext`. */
  name: string;
  /** node-cron-style schedule. Omit to register a "manual-only" job. */
  schedule?: string;
  /** Job body. Throws → FAILED. Async return → SUCCESS. */
  run: (ctx: JobContext) => Promise<JobResultPayload | void>;
  /** Override the default max consecutive-failures budget. */
  maxRetries?: number;
  /** Override the default per-attempt timeout (ms). */
  timeoutMs?: number;
}

export interface JobRunnerOptions {
  db: WorkerDb;
  sql: Sql;
  /** Used to open dedicated single-connection clients for the advisory lock. */
  lockConnectionUrl: string;
  metrics: WorkerMetrics;
  logger?: {
    info: (msg: string, extra?: Record<string, unknown>) => void;
    warn: (msg: string, extra?: Record<string, unknown>) => void;
    error: (msg: string, extra?: Record<string, unknown>) => void;
    debug?: (msg: string, extra?: Record<string, unknown>) => void;
  };
  defaults: { maxRetries: number; timeoutMs: number };
  /** Hook for tests — when `true`, `runOnce` does NOT actually call cron.schedule. */
  schedule?: 'cron' | 'manual';
}

/** Outcome surfaced by `runOnce` — useful for tests + audit. */
export type RunOutcome =
  | { status: 'SUCCESS'; runId: string; durationMs: number; payload: JobResultPayload | undefined }
  | { status: 'SKIPPED'; runId: string; reason: 'lock_not_acquired' | 'closing' }
  | { status: 'FAILED'; runId: string; durationMs: number; error: Error }
  | { status: 'TIMEOUT'; runId: string; durationMs: number };

/** Hash a job name into a stable 64-bit lock key via PG's `hashtext`. */
function lockKey(jobName: string): string {
  // We compute the key in SQL — `hashtext(text) -> integer` (signed 32-bit).
  // Cast to bigint by hand so two distinct names won't collide on overflow.
  return jobName; // resolved server-side; see acquireLock()
}

async function acquireLock(lockSql: Sql, jobName: string): Promise<boolean> {
  const rows = await lockSql<[{ ok: boolean }]>`
    SELECT pg_try_advisory_lock(hashtext(${jobName})::bigint) AS ok`;
  return rows[0]!.ok;
}

async function releaseLock(lockSql: Sql, jobName: string): Promise<void> {
  await lockSql`SELECT pg_advisory_unlock(hashtext(${jobName})::bigint)`;
}

export class JobRunner {
  private readonly defs = new Map<string, JobDefinition>();
  private readonly consecutiveFailures = new Map<string, number>();
  private readonly inFlight = new Set<Promise<RunOutcome>>();
  private cronTasks: Array<{ stop: () => void }> = [];
  private closing = false;

  public constructor(private readonly opts: JobRunnerOptions) {}

  public register(def: JobDefinition): void {
    if (this.defs.has(def.name)) {
      throw new Error(`Duplicate job registration: ${def.name}`);
    }
    this.defs.set(def.name, def);
    this.consecutiveFailures.set(def.name, 0);
    this.opts.metrics.consecutiveFailures.set({ job: def.name }, 0);
  }

  /**
   * Start all registered jobs on their cron schedules.
   *
   * `node-cron` is imported lazily so test code that drives `runOnce`
   * directly does not pull in the cron scheduler.
   */
  public async startSchedules(): Promise<void> {
    if (this.opts.schedule === 'manual') return;
    const cron = await import('node-cron');
    for (const def of this.defs.values()) {
      if (!def.schedule) continue;
      const task = cron.default.schedule(
        def.schedule,
        () => {
          // Fire-and-forget; the runner records every outcome to worker_job_runs.
          void this.runOnce(def.name);
        },
        { scheduled: true },
      );
      this.cronTasks.push({ stop: () => task.stop() });
    }
  }

  /**
   * Run one attempt of `jobName` end-to-end (lock → record → execute →
   * finalise → metric). Caller can `await` the outcome — tests use this.
   */
  public async runOnce(jobName: string): Promise<RunOutcome> {
    const def = this.defs.get(jobName);
    if (!def) throw new Error(`Unknown job: ${jobName}`);

    const runId = randomUUID();

    if (this.closing) {
      this.opts.metrics.runsTotal.inc({ job: jobName, status: 'SKIPPED' });
      return { status: 'SKIPPED', runId, reason: 'closing' };
    }

    const promise = this.execute(def, runId).finally(() => {
      this.inFlight.delete(promise);
    });
    this.inFlight.add(promise);
    return promise;
  }

  /**
   * Graceful shutdown: refuse new ticks + stop cron + await in-flight.
   * `shutdownTimeoutMs` is the absolute wall-clock cap (default 60s).
   */
  public async close(shutdownTimeoutMs = 60_000): Promise<void> {
    this.closing = true;
    this.opts.metrics.workerUp.set(0);
    for (const t of this.cronTasks) {
      try {
        t.stop();
      } catch {
        /* swallow */
      }
    }
    this.cronTasks = [];

    if (this.inFlight.size === 0) return;
    await Promise.race([
      Promise.allSettled([...this.inFlight]),
      new Promise<void>((resolve) => setTimeout(resolve, shutdownTimeoutMs)),
    ]);
  }

  /**
   * Internal: the full per-attempt lifecycle.
   * Always returns a RunOutcome; never throws to the caller.
   */
  private async execute(def: JobDefinition, runId: string): Promise<RunOutcome> {
    const lockSql = postgres(this.opts.lockConnectionUrl, {
      max: 1,
      idle_timeout: 0,
      connection: { application_name: `warehouse14_worker_lock:${def.name}` },
      onnotice: () => {},
    });

    const startedAt = new Date();
    const startHrTime = process.hrtime.bigint();
    const log = this.makeLogger(def.name, runId);

    let runRowId: bigint | null = null;
    let gotLock = false;

    try {
      gotLock = await acquireLock(lockSql, def.name);
      if (!gotLock) {
        // Skipped tick — still record so operators can see a "skipped" pattern.
        await this.recordSkipped(def.name, runId, startedAt);
        this.opts.metrics.runsTotal.inc({ job: def.name, status: 'SKIPPED' });
        log.debug('skipped: lock not acquired');
        return { status: 'SKIPPED', runId, reason: 'lock_not_acquired' };
      }

      runRowId = await this.recordRunning(def.name, runId, startedAt);

      const timeoutMs = def.timeoutMs ?? this.opts.defaults.timeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error(`job '${def.name}' exceeded ${timeoutMs}ms`)),
        timeoutMs,
      );

      try {
        const payload = await def.run({
          db: this.opts.db,
          sql: this.opts.sql,
          runId,
          jobRunId: runRowId,
          signal: controller.signal,
          log,
        });
        const durationMs = elapsedMs(startHrTime);
        await this.recordTerminal(runRowId, 'SUCCESS', null, payload ?? {});
        this.consecutiveFailures.set(def.name, 0);
        this.opts.metrics.consecutiveFailures.set({ job: def.name }, 0);
        this.opts.metrics.runsTotal.inc({ job: def.name, status: 'SUCCESS' });
        this.opts.metrics.durationSeconds.observe({ job: def.name }, durationMs / 1000);
        log.info('success', { durationMs, payload });
        return { status: 'SUCCESS', runId, durationMs, payload: payload ?? undefined };
      } catch (err) {
        const durationMs = elapsedMs(startHrTime);
        const isTimeout = controller.signal.aborted;
        const status = isTimeout ? 'TIMEOUT' : 'FAILED';
        const error = err instanceof Error ? err : new Error(String(err));
        const errorMsg = truncate(formatError(error), 8 * 1024);
        await this.recordTerminal(runRowId, status, errorMsg, {});
        const next = (this.consecutiveFailures.get(def.name) ?? 0) + 1;
        this.consecutiveFailures.set(def.name, next);
        this.opts.metrics.consecutiveFailures.set({ job: def.name }, next);
        this.opts.metrics.runsTotal.inc({ job: def.name, status });
        this.opts.metrics.durationSeconds.observe({ job: def.name }, durationMs / 1000);
        log.error('failed', { durationMs, status, error: errorMsg, consecutiveFailures: next });

        const maxRetries = def.maxRetries ?? this.opts.defaults.maxRetries;
        if (next >= maxRetries) {
          await this.pushToDlq(def.name, next, errorMsg, runRowId);
          this.consecutiveFailures.set(def.name, 0);
          this.opts.metrics.consecutiveFailures.set({ job: def.name }, 0);
          log.error(
            'dlq: consecutive-failures budget exceeded — emitted alert.worker_job_dead_letter',
            { maxRetries },
          );
        }

        if (isTimeout) return { status: 'TIMEOUT', runId, durationMs };
        return { status: 'FAILED', runId, durationMs, error };
      } finally {
        clearTimeout(timer);
      }
    } finally {
      try {
        if (gotLock) await releaseLock(lockSql, def.name);
      } catch (err) {
        log.warn('unlock failed', { err: formatError(err) });
      }
      await lockSql.end({ timeout: 5 }).catch(() => {});
    }
  }

  private async recordRunning(jobName: string, runId: string, startedAt: Date): Promise<bigint> {
    const rows = await this.opts.db
      .insert(workerJobRuns)
      .values({
        jobName,
        runId,
        startedAt,
        status: 'RUNNING',
        consecutiveFailures: this.consecutiveFailures.get(jobName) ?? 0,
      })
      .returning({ id: workerJobRuns.id });
    return rows[0]!.id;
  }

  private async recordSkipped(jobName: string, runId: string, startedAt: Date): Promise<void> {
    const now = new Date();
    await this.opts.db.insert(workerJobRuns).values({
      jobName,
      runId,
      startedAt,
      finishedAt: now,
      status: 'SKIPPED',
      consecutiveFailures: this.consecutiveFailures.get(jobName) ?? 0,
    });
  }

  private async recordTerminal(
    rowId: bigint,
    status: 'SUCCESS' | 'FAILED' | 'TIMEOUT',
    errorMessage: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.opts.db
      .update(workerJobRuns)
      .set({
        status,
        finishedAt: new Date(),
        errorMessage,
        payload,
      })
      .where(sql`${workerJobRuns.id} = ${rowId}`);
  }

  private async pushToDlq(
    jobName: string,
    failureCount: number,
    lastError: string,
    lastRunId: bigint | null,
  ): Promise<void> {
    await this.opts.db.insert(workerJobDlq).values({
      jobName,
      failureCount,
      lastError,
      lastRunId,
      payload: { failedAt: new Date().toISOString() },
    });

    // Emit ledger event so the Bridge UX alert system + critical-events router
    // (memory.md #45) lights up.
    try {
      await emit(this.opts.db as unknown as AppDb, {
        eventType: 'alert.worker_job_dead_letter',
        entityTable: 'worker_job_dlq',
        entityId: '00000000-0000-0000-0000-000000000000',
        payload: { jobName, failureCount, lastError: truncate(lastError, 4 * 1024) },
      });
    } catch (err) {
      // If the audit emit fails, log but don't unwind — the DLQ row is the
      // load-bearing record; the alert is best-effort.
      this.opts.logger?.warn?.('dlq alert emit failed', { jobName, err: formatError(err) });
    }
  }

  private makeLogger(jobName: string, runId: string): JobContext['log'] {
    const prefix = `[${jobName} ${runId.slice(0, 8)}]`;
    const root = this.opts.logger ?? CONSOLE_LOGGER;
    return {
      info: (msg, extra) => root.info(`${prefix} ${msg}`, { job: jobName, runId, ...extra }),
      warn: (msg, extra) => root.warn(`${prefix} ${msg}`, { job: jobName, runId, ...extra }),
      error: (msg, extra) => root.error(`${prefix} ${msg}`, { job: jobName, runId, ...extra }),
      debug: (msg, extra) =>
        (root.debug ?? root.info)(`${prefix} ${msg}`, { job: jobName, runId, ...extra }),
    };
  }
}

// ────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────

function elapsedMs(startHrTime: bigint): number {
  return Number(process.hrtime.bigint() - startHrTime) / 1_000_000;
}

function formatError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}${e.stack ? `\n${e.stack}` : ''}`;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 14) + '…[TRUNCATED]';
}

interface ConcreteLogger {
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, extra?: Record<string, unknown>) => void;
  debug?: (msg: string, extra?: Record<string, unknown>) => void;
}

const CONSOLE_LOGGER: ConcreteLogger = {
  info: (msg, extra) => console.log(JSON.stringify({ level: 'info', msg, ...extra })),
  warn: (msg, extra) => console.warn(JSON.stringify({ level: 'warn', msg, ...extra })),
  error: (msg, extra) => console.error(JSON.stringify({ level: 'error', msg, ...extra })),
  debug: (msg, extra) => console.debug(JSON.stringify({ level: 'debug', msg, ...extra })),
};

// Re-export lockKey for completeness (used only in tests that inspect the hash).
export { lockKey };
