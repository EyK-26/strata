import { createHash } from "node:crypto";
import { RedisClient } from "bun";
import { LEASE_SCRIPT } from "./leaseScript.ts";

type SchedulerLease = { taskId: string; occurrenceId: string; token: string };
interface SchedulerLeaseStore {
  acquire(lease: SchedulerLease, leaseMs: number): Promise<boolean>;
  renew(lease: SchedulerLease, leaseMs: number): Promise<boolean>;
  complete(lease: SchedulerLease, retentionMs: number): Promise<boolean>;
  release(lease: SchedulerLease): Promise<void>;
}

// All keys share a task-specific Cluster slot. Validate types before mutation:
// Lua errors do not roll back earlier commands. No keyspace scans are used.

class RedisSchedulerLeaseStore implements SchedulerLeaseStore {
  private readonly client: Pick<RedisClient, "send">;
  private readonly owned?: RedisClient;
  private readonly namespace: string;
  private readonly timeoutMs: number;
  constructor(options: {
    redisUrl: string;
    namespace: string;
    commandTimeoutMs?: number;
    client?: Pick<RedisClient, "send">;
  }) {
    this.namespace = options.namespace.trim();
    if (!this.namespace || this.namespace.length > 512)
      throw new TypeError("Invalid scheduler namespace.");
    this.timeoutMs = options.commandTimeoutMs ?? 1000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000)
      throw new RangeError("Invalid scheduler command timeout.");
    if (options.client) this.client = options.client;
    else {
      const client = new RedisClient(options.redisUrl, { autoReconnect: false, maxRetries: 0 });
      this.owned = client;
      this.client = client;
    }
  }
  private keys(lease: SchedulerLease): string[] {
    const task = createHash("sha256")
      .update(JSON.stringify([this.namespace, lease.taskId]))
      .digest("hex");
    const occurrence = createHash("sha256").update(lease.occurrenceId).digest("hex");
    const prefix = `scheduler:{${task}}`;
    return [
      `${prefix}:active`,
      `${prefix}:occurrence:${occurrence}`,
      `${prefix}:completed:${occurrence}`,
    ];
  }
  private async execute(action: string, lease: SchedulerLease, ttl: number): Promise<boolean> {
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 2_147_483_647)
      throw new RangeError("Invalid scheduler TTL.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.client.send("EVAL", [
          LEASE_SCRIPT,
          "3",
          ...this.keys(lease),
          action,
          lease.token,
          String(ttl),
        ]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Scheduler store deadline exceeded.")),
            this.timeoutMs,
          );
        }),
      ]);
      if (result !== 0 && result !== 1) throw new Error("Invalid scheduler store response.");
      return result === 1;
    } catch (error) {
      this.owned?.close();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  acquire(lease: SchedulerLease, leaseMs: number) {
    return this.execute("acquire", lease, leaseMs);
  }
  renew(lease: SchedulerLease, leaseMs: number) {
    return this.execute("renew", lease, leaseMs);
  }
  complete(lease: SchedulerLease, retentionMs: number) {
    return this.execute("complete", lease, retentionMs);
  }
  async release(lease: SchedulerLease) {
    await this.execute("release", lease, 1);
  }
  close(): void {
    this.owned?.close();
  }
}

// Explicit one-process mode uses one high-water mark per registered task rather
// than retaining each minute forever. A process restart forgets this state.
class SingleRunnerLeaseStore implements SchedulerLeaseStore {
  private readonly tasks = new Map<
    string,
    { active?: SchedulerLease; expires: number; completed?: number }
  >();
  async acquire(lease: SchedulerLease, leaseMs: number): Promise<boolean> {
    const task = this.tasks.get(lease.taskId) ?? { expires: 0 };
    if (task.active && task.expires > performance.now()) return false;
    if ((task.completed ?? -Infinity) >= Number(lease.occurrenceId)) return false;
    task.active = lease;
    task.expires = performance.now() + leaseMs;
    this.tasks.set(lease.taskId, task);
    return true;
  }
  async renew(lease: SchedulerLease, leaseMs: number): Promise<boolean> {
    const task = this.tasks.get(lease.taskId);
    if (!task || task.active?.token !== lease.token || task.expires <= performance.now())
      return false;
    task.expires = performance.now() + leaseMs;
    return true;
  }
  async complete(lease: SchedulerLease): Promise<boolean> {
    const task = this.tasks.get(lease.taskId);
    if (!task || task.active?.token !== lease.token || task.expires <= performance.now())
      return false;
    task.completed = Number(lease.occurrenceId);
    task.active = undefined;
    return true;
  }
  async release(lease: SchedulerLease): Promise<void> {
    const task = this.tasks.get(lease.taskId);
    if (task?.active?.token === lease.token) task.active = undefined;
  }
}

export type { SchedulerLease, SchedulerLeaseStore };
export { RedisSchedulerLeaseStore, SingleRunnerLeaseStore };
