/**
 * `BoundedDispatcher` — a tiny in-process concurrency gate for the detached bot
 * orchestrators fired from the WhatsApp / Meta-socials / Chatwoot webhooks.
 *
 * WHY (Phase-2 P1.1): the webhooks used to `void runBot(...)` — fire-and-forget,
 * uncapped, and (on the socials path) with no top-level `.catch`. A Meta retry
 * storm could spawn N concurrent bot turns, each holding a pg connection
 * (conversation upsert + spend query + ai_calls + outbound) → the shared pool
 * (`DB_POOL_MAX`, default 10) is exhausted and the whole API stalls. A rejected
 * detached promise was an unhandledRejection that can kill the process.
 *
 * This dispatcher fixes all three: a hard concurrency cap, a guaranteed
 * top-level catch around every task, and a queue shed (backpressure) past a
 * hard cap. The inbound message is ALREADY durably stored before dispatch, so a
 * shed task is recoverable (a future reaper can re-drive it) — we never lose the
 * customer's message, only (at worst) an auto-reply under extreme load.
 *
 * It is deliberately NOT the worker queue: the bot must reply inside the live
 * chat window (a once-a-minute cron sweep would add up to ~60 s latency), and
 * the worker role lacks the grants + EXECUTE on `encrypt_pii` + the provider
 * keys that the API already holds. See `docs/system-logic-audit-2026-06.md`.
 *
 * Discipline mirrors `apps/worker/src/lib/job-runner.ts`: plain async/await +
 * `try/finally`, an in-flight Set for graceful drain — no `setImmediate` magic.
 */

export interface DispatchLogger {
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
}

export class BoundedDispatcher {
  private active = 0;
  private readonly queue: Array<() => Promise<void>> = [];
  private readonly inFlight = new Set<Promise<void>>();
  private shedCount = 0;
  private readonly queueMax: number;

  /**
   * @param maxConcurrent  hard cap on simultaneously-running tasks.
   * @param log            structured logger (Fastify's `app.log` satisfies it).
   * @param queueMax       hard cap on the waiting queue; past it tasks are shed.
   *                       Defaults to `maxConcurrent * 50`.
   */
  public constructor(
    private readonly maxConcurrent: number,
    private readonly log: DispatchLogger,
    queueMax?: number,
  ) {
    this.queueMax = queueMax ?? maxConcurrent * 50;
  }

  /** Tasks currently executing. */
  public get activeCount(): number {
    return this.active;
  }

  /** Tasks waiting for a free slot. */
  public get pendingCount(): number {
    return this.queue.length;
  }

  /** Number of tasks shed because the queue was full. */
  public get shed(): number {
    return this.shedCount;
  }

  /**
   * Enqueue a task. Never throws, never returns a promise the caller must
   * handle. If the queue is full the task is shed (logged) — backpressure.
   */
  public run(task: () => Promise<void>): void {
    if (this.queue.length >= this.queueMax) {
      this.shedCount++;
      this.log.warn(
        { pending: this.queue.length, queueMax: this.queueMax, totalShed: this.shedCount },
        'bot dispatch: queue full — shedding task (inbound message is already stored)',
      );
      return;
    }
    this.queue.push(task);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.maxConcurrent) {
      const task = this.queue.shift();
      if (!task) break; // queue drained — explicit guard, no bare `!`
      this.active++;
      const p = this.runOne(task).finally(() => {
        this.inFlight.delete(p);
      });
      this.inFlight.add(p);
    }
  }

  private async runOne(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (err) {
      // The top-level catch the detached entrypoints lacked. A bot-turn failure
      // is logged and swallowed — the inbound is already stored; we never crash
      // the process on an unhandled rejection.
      this.log.error({ err }, 'bot dispatch: task rejected (caught)');
    } finally {
      this.active--;
      this.pump();
    }
  }

  /**
   * Await in-flight + queued tasks to settle (for graceful shutdown). Returns
   * after everything finishes OR `timeoutMs` elapses, whichever comes first.
   */
  public async drain(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while ((this.queue.length > 0 || this.inFlight.size > 0) && Date.now() < deadline) {
      await Promise.race([
        Promise.allSettled([...this.inFlight]),
        new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now()))),
      ]);
    }
  }
}
