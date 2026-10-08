import { createHash } from "node:crypto";
import { isProductionEnv } from "../runtime/appEnv";
import { namespacedRedisKey } from "../runtime/appKeyPrefix";
import {
  RedisSchedulerLeaseStore,
  type SchedulerLeaseStore,
  SingleRunnerLeaseStore,
} from "./leases";
import { assertScheduleExpression, isScheduleExpressionDue } from "./osCron";

type ScheduledTaskContext = {
  taskName: string;
  occurrenceId: string;
  scheduledAt: Date;
  /** Aborted on loss/uncertainty of lease ownership, not normal admission shutdown. */
  signal: AbortSignal;
  assertOwnership(): Promise<void>;
};
type ScheduledTask = {
  expression: string;
  name: string;
  run: (context: ScheduledTaskContext) => void | Promise<void>;
};
type SchedulerRunOptions = {
  signal?: AbortSignal;
  coordination?: "redis" | "single-runner";
  redisUrl?: string;
  namespace?: string;
  leaseStore?: SchedulerLeaseStore;
  leaseMs?: number;
  renewalMs?: number;
  commandTimeoutMs?: number;
  completedRetentionMs?: number;
};
class SchedulerLeaseLostError extends Error {
  constructor(taskName: string, options?: ErrorOptions) {
    super(`Scheduler lease lost for task ${taskName}.`, options);
    this.name = "SchedulerLeaseLostError";
  }
}
class Schedule {
  private readonly tasks: ScheduledTask[] = [];
  command(expression: string, name: string, run: ScheduledTask["run"]): this {
    assertScheduleExpression(expression);
    if (typeof run !== "function")
      throw new TypeError("Scheduled task handler must be a function.");
    const normalized = name.trim();
    if (
      !normalized ||
      normalized.length > 200 ||
      this.tasks.some((task) => task.name === normalized)
    )
      throw new TypeError(
        "Scheduled task names must be nonempty and unique (at most 200 characters).",
      );
    if (this.tasks.length >= 4096) throw new RangeError("A schedule supports at most 4096 tasks.");
    this.tasks.push({ expression, name: normalized, run });
    return this;
  }
  dueTasks(now = new Date()): ScheduledTask[] {
    return this.tasks.filter((task) => isScheduleExpressionDue(task.expression, now));
  }
  tasksList(): ScheduledTask[] {
    return [...this.tasks];
  }
}
const appSchedule = new Schedule();
const localStores = new WeakMap<Schedule, SingleRunnerLeaseStore>();
function bounded(value: number, min: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(`Invalid scheduler ${name}.`);
  return value;
}
async function runDueScheduledTasks(
  schedule: Schedule = appSchedule,
  now = new Date(),
  options: SchedulerRunOptions = {},
): Promise<number> {
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) throw new TypeError("Invalid scheduler date.");
  const due = schedule.dueTasks(now);
  if (!due.length || options.signal?.aborted) return 0;
  const coordination =
    options.coordination ??
    process.env.SCHEDULER_COORDINATION ??
    (isProductionEnv() ? "redis" : "single-runner");
  if (coordination !== "redis" && coordination !== "single-runner")
    throw new TypeError("Unsupported scheduler coordination.");
  const leaseMs = bounded(options.leaseMs ?? 30_000, 100, 3_600_000, "leaseMs");
  const renewalMs = bounded(
    options.renewalMs ?? Math.floor(leaseMs / 3),
    1,
    Math.floor(leaseMs / 3),
    "renewalMs",
  );
  const timeoutMs = bounded(
    options.commandTimeoutMs ?? Math.min(1000, Math.floor(leaseMs / 4)),
    1,
    Math.floor(leaseMs / 3),
    "commandTimeoutMs",
  );
  const retention = bounded(
    options.completedRetentionMs ?? 7 * 86400_000,
    leaseMs,
    2_147_483_647,
    "completedRetentionMs",
  );
  const namespace = (options.namespace ?? namespacedRedisKey("schedule")).trim();
  if (!namespace || namespace.length > 512) throw new TypeError("Invalid scheduler namespace.");
  let owned: RedisSchedulerLeaseStore | undefined;
  let store = options.leaseStore;
  if (!store && coordination === "redis") {
    const redisUrl = options.redisUrl ?? process.env.REDIS_URL?.trim();
    if (!redisUrl) throw new Error("Redis scheduler coordination requires REDIS_URL.");
    owned = new RedisSchedulerLeaseStore({
      redisUrl,
      namespace,
      commandTimeoutMs: timeoutMs,
    });
    store = owned;
  }
  if (!store) {
    let local = localStores.get(schedule);
    if (!local) {
      local = new SingleRunnerLeaseStore();
      localStores.set(schedule, local);
    }
    store = local;
  }
  const occurrenceId = String(Math.floor(timestamp / 60_000) * 60_000);
  let completed = 0;
  try {
    for (const task of due) {
      if (options.signal?.aborted) break;
      const lease = { taskId: task.name, occurrenceId, token: crypto.randomUUID() };
      if (!(await store.acquire(lease, leaseMs))) continue;
      if (options.signal?.aborted) {
        await store.release(lease);
        break;
      }
      const controller = new AbortController();
      let lost: SchedulerLeaseLostError | undefined;
      const lose = (cause?: unknown) => {
        lost ??= new SchedulerLeaseLostError(task.name, { cause });
        controller.abort(lost);
        return lost;
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      let renewal: Promise<void> | undefined;
      let stopped = false;
      const renew = async () => {
        try {
          if (!(await store.renew(lease, leaseMs))) throw lose();
        } catch (error) {
          throw lose(error);
        }
      };
      const tick = () => {
        renewal = renew()
          .catch(() => {})
          .finally(() => {
            if (!stopped && !lost) timer = setTimeout(tick, renewalMs);
          });
      };
      timer = setTimeout(tick, renewalMs);
      try {
        await task.run({
          taskName: task.name,
          occurrenceId: createHash("sha256")
            .update(JSON.stringify([namespace, task.name, occurrenceId]))
            .digest("hex"),
          scheduledAt: new Date(Number(occurrenceId)),
          signal: controller.signal,
          async assertOwnership() {
            if (lost) throw lost;
            await renew();
          },
        });
        stopped = true;
        clearTimeout(timer);
        await renewal;
        if (lost || !(await store.complete(lease, retention))) throw lost ?? lose();
        completed++;
      } catch (error) {
        stopped = true;
        clearTimeout(timer);
        await renewal;
        try {
          await store.release(lease);
        } catch (releaseError) {
          throw new AggregateError(
            [error, releaseError],
            "Scheduled task and lease release failed.",
          );
        }
        throw error;
      } finally {
        stopped = true;
        clearTimeout(timer);
      }
    }
    return completed;
  } finally {
    owned?.close();
  }
}

export type { SchedulerLease, SchedulerLeaseStore } from "./leases";
export type { ScheduledTask, ScheduledTaskContext, SchedulerRunOptions };
export {
  appSchedule,
  RedisSchedulerLeaseStore,
  runDueScheduledTasks,
  Schedule,
  SchedulerLeaseLostError,
};
