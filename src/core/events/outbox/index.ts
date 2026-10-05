import { currentSqlDialect } from "../../database/dialect";
import { repositoryConnection as db } from "../../database/repositoryConnection";
import { hasActiveTransaction, runInTransaction } from "../../database/transaction";
import { runWithMigrationBypass } from "../../tenant/databaseTenantContext";
import { resolveTenant } from "../../tenant/resolveTenant";
import { currentTenant, type TenantContext } from "../../tenant/tenantContext";
import { runWithTenantDatabase } from "../../tenant/tenantDatabaseScope";

interface DurableEvent {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly tenantId: number | null;
  readonly payload: unknown;
}
interface DurableListener {
  readonly name: string;
  readonly event: string;
  handle(event: DurableEvent, context: { signal: AbortSignal }): Promise<void>;
}
interface SqlOutboxOptions {
  listeners: readonly DurableListener[];
  leaseMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  maxPayloadBytes?: number;
  resolveTenant?: (id: number) => Promise<TenantContext | null>;
}
interface EventRow {
  id: string;
  name: string;
  version: number;
  tenant_id: number | null;
  payload: string;
  created_at: number;
  publication_token: string;
}
interface Claim extends EventRow {
  listener_name: string;
  attempts: number;
  max_attempts: number;
  lease_token: string;
}
function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer.`);
  return value;
}
function identifier(value: string, max: number): string {
  if (!value || value.length > max || !/^[\w.:-]+$/.test(value))
    throw new Error("Invalid durable event/listener identifier.");
  return value;
}
function placeholders(count: number): string[] {
  return Array.from({ length: count }, (_, index) => currentSqlDialect().placeholder(index + 1));
}
async function clock(): Promise<number> {
  const [row] = await db.unsafe<{ now_ms: number }>(
    `SELECT ${currentSqlDialect().epochMillisecondsExpression()} AS now_ms`,
  );
  const now = Number(row?.now_ms);
  if (!Number.isSafeInteger(now)) throw new Error("Database did not return a valid outbox clock.");
  return now;
}
async function privileged<T>(work: () => Promise<T>): Promise<T> {
  if (hasActiveTransaction())
    throw new Error("Outbox coordination must run outside business transactions.");
  // These short coordination transactions contain no listener/provider effects.
  // MySQL next-key locks and concurrent Postgres updates can abort a transaction.
  for (let attempt = 0; ; attempt++) {
    try {
      return await runWithMigrationBypass(() => runInTransaction(work));
    } catch (error) {
      const failure =
        error !== null && typeof error === "object"
          ? (error as { code?: string; errno?: string | number })
          : {};
      const code = String(failure.errno ?? failure.code);
      if (attempt >= 4 || !["40001", "40P01", "1213"].includes(code)) throw error;
      await Bun.sleep(10 * (attempt + 1));
    }
  }
}

/** Opt-in SQL effects. Publishing writes only; workers execute listeners at least once. */
class SqlOutbox {
  private readonly listeners = new Map<string, DurableListener>();
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly maxPayloadBytes: number;
  private readonly tenantResolver: (id: number) => Promise<TenantContext | null>;

  constructor(options: SqlOutboxOptions) {
    this.leaseMs = positiveInteger(options.leaseMs ?? 60_000, "leaseMs");
    if (this.leaseMs < 30) throw new Error("leaseMs must be at least 30 milliseconds.");
    this.maxAttempts = positiveInteger(options.maxAttempts ?? 5, "maxAttempts");
    this.retryDelayMs = positiveInteger(options.retryDelayMs ?? 1_000, "retryDelayMs");
    this.maxPayloadBytes = positiveInteger(options.maxPayloadBytes ?? 65_536, "maxPayloadBytes");
    this.tenantResolver = options.resolveTenant ?? resolveTenant;
    for (const listener of options.listeners) {
      identifier(listener.name, 128);
      identifier(listener.event, 128);
      if (this.listeners.has(listener.name))
        throw new Error("Durable listener names must be unique.");
      this.listeners.set(listener.name, listener);
    }
  }

  hasListener(name: string, event?: string): boolean {
    const listener = this.listeners.get(name);
    return listener !== undefined && (event === undefined || listener.event === event);
  }

  async publish(
    name: string,
    payload: unknown,
    options: { id?: string; version?: number } = {},
  ): Promise<string> {
    if (!hasActiveTransaction())
      throw new Error("Durable publication requires an active business transaction.");
    return runInTransaction(() => this.persist(name, payload, options));
  }

  private async persist(
    name: string,
    payload: unknown,
    options: { id?: string; version?: number },
  ): Promise<string> {
    identifier(name, 128);
    const id = identifier(options.id ?? crypto.randomUUID(), 64);
    const version = positiveInteger(options.version ?? 1, "version");
    const serialized = JSON.stringify(payload);
    if (
      serialized === undefined ||
      new TextEncoder().encode(serialized).byteLength > this.maxPayloadBytes
    )
      throw new Error("Invalid or oversized durable payload.");
    const listeners = [...this.listeners.values()].filter((listener) => listener.event === name);
    if (listeners.length === 0) throw new Error("No durable listeners registered for this event.");
    const tenantId = currentTenant()?.id ?? null;
    if (tenantId !== null) positiveInteger(tenantId, "tenantId");
    const token = crypto.randomUUID();
    const now = await clock();
    await db.unsafe(
      `INSERT INTO strata_outbox_event (id, name, version, tenant_id, payload, created_at, publication_token)
      VALUES (${placeholders(7).join(", ")})${currentSqlDialect().upsertSuffix(["id"], [])}`,
      [id, name, version, tenantId, serialized, now, token],
    );
    const [existing] = await db.unsafe<EventRow>(
      `SELECT * FROM strata_outbox_event WHERE id = ${placeholders(1)[0]}`,
      [id],
    );
    if (
      !existing ||
      existing.name !== name ||
      Number(existing.version) !== version ||
      (existing.tenant_id === null ? null : Number(existing.tenant_id)) !== tenantId ||
      existing.payload !== serialized
    )
      throw new Error("Conflicting durable event ID.");
    // A duplicate cannot retroactively add listeners to the original delivery snapshot.
    if (existing.publication_token !== token) return id;
    for (const listener of listeners) {
      await db.unsafe(
        `INSERT INTO strata_outbox_delivery (event_id, listener_name, status, max_attempts, available_at)
        VALUES (${placeholders(5).join(", ")})`,
        [id, listener.name, "pending", this.maxAttempts, now],
      );
    }
    return id;
  }

  private async claim(): Promise<Claim | "exhausted" | null> {
    return privileged(async () => {
      const now = await clock();
      const p = placeholders(2);
      // Separate indexed scans avoid locking the entire due set during a filesort.
      // Recover expired owners first so a constant arrival stream cannot starve recovery.
      const columns = "event_id, listener_name, attempts, max_attempts";
      const [expired] = await db.unsafe<{
        event_id: string;
        listener_name: string;
        attempts: number;
        max_attempts: number;
      }>(
        `SELECT ${columns} FROM strata_outbox_delivery WHERE status = 'processing' AND lease_until <= ${p[0]}
        ORDER BY lease_until, event_id, listener_name LIMIT 1${currentSqlDialect().rowLockClause(true)}`,
        [now],
      );
      const delivery =
        expired ??
        (
          await db.unsafe<{
            event_id: string;
            listener_name: string;
            attempts: number;
            max_attempts: number;
          }>(
            `SELECT ${columns} FROM strata_outbox_delivery WHERE status = 'pending' AND available_at <= ${p[0]}
        ORDER BY available_at, event_id, listener_name LIMIT 1${currentSqlDialect().rowLockClause(true)}`,
            [now],
          )
        )[0];
      if (!delivery) return null;
      const [event] = await db.unsafe<EventRow>(
        `SELECT * FROM strata_outbox_event WHERE id = ${p[0]}`,
        [delivery.event_id],
      );
      if (!event) throw new Error("Outbox event missing for delivery.");
      const candidate = { ...event, ...delivery };
      const token = crypto.randomUUID();
      const exhausted = Number(candidate.attempts) >= Number(candidate.max_attempts);
      const q = placeholders(9);
      await db.unsafe(
        `UPDATE strata_outbox_delivery SET status = ${q[0]}, lease_token = ${q[1]}, lease_until = ${q[2]},
        attempts = ${q[3]}, error_code = ${exhausted ? "'attempts_exhausted'" : "error_code"} WHERE event_id = ${q[4]} AND listener_name = ${q[5]} AND
        ((status = 'pending' AND available_at <= ${q[6]}) OR (status = 'processing' AND lease_until <= ${q[7]})) AND attempts = ${q[8]}`,
        [
          exhausted ? "failed" : "processing",
          token,
          exhausted ? null : now + this.leaseMs,
          Number(candidate.attempts) + (exhausted ? 0 : 1),
          candidate.id,
          candidate.listener_name,
          now,
          now,
          candidate.attempts,
        ],
      );
      const [owner] = await db.unsafe<{ lease_token: string }>(
        `SELECT lease_token FROM strata_outbox_delivery WHERE event_id = ${p[0]} AND listener_name = ${p[1]}${currentSqlDialect().rowLockClause()}`,
        [candidate.id, candidate.listener_name],
      );
      if (owner?.lease_token !== token) return null;
      if (exhausted) return "exhausted";
      return { ...candidate, attempts: Number(candidate.attempts) + 1, lease_token: token };
    });
  }

  private async renew(claim: Claim): Promise<boolean> {
    return privileged(async () => {
      const now = await clock();
      const p = placeholders(5);
      await db.unsafe(
        `UPDATE strata_outbox_delivery SET lease_until = ${p[0]} WHERE event_id = ${p[1]}
        AND listener_name = ${p[2]} AND lease_token = ${p[3]} AND status = 'processing' AND lease_until > ${p[4]}`,
        [now + this.leaseMs, claim.id, claim.listener_name, claim.lease_token, now],
      );
      const q = placeholders(3);
      const [owner] = await db.unsafe<{ lease_until: number }>(
        `SELECT lease_until FROM strata_outbox_delivery WHERE event_id = ${q[0]} AND listener_name = ${q[1]} AND lease_token = ${q[2]} AND status = 'processing'${currentSqlDialect().rowLockClause()}`,
        [claim.id, claim.listener_name, claim.lease_token],
      );
      return Number(owner?.lease_until) > now;
    });
  }

  private async finish(claim: Claim, success: boolean): Promise<void> {
    await privileged(async () => {
      const now = await clock();
      const status = success
        ? "completed"
        : claim.attempts >= Number(claim.max_attempts)
          ? "failed"
          : "pending";
      const delay = Math.min(this.retryDelayMs * 2 ** Math.min(claim.attempts - 1, 16), 300_000);
      const p = placeholders(9);
      await db.unsafe(
        `UPDATE strata_outbox_delivery SET status = ${p[0]}, available_at = ${p[1]}, completed_at = ${p[2]},
        error_code = ${p[3]}, lease_until = NULL WHERE event_id = ${p[4]} AND listener_name = ${p[5]}
        AND lease_token = ${p[6]} AND status = 'processing' AND lease_until > ${p[7]} AND attempts = ${p[8]}`,
        [
          status,
          now + delay,
          success ? now : null,
          success ? null : "listener_failed",
          claim.id,
          claim.listener_name,
          claim.lease_token,
          now,
          claim.attempts,
        ],
      );
    });
  }

  async processNext(options: { signal?: AbortSignal } = {}): Promise<boolean> {
    if (hasActiveTransaction())
      throw new Error("Outbox workers must run outside business transactions.");
    options.signal?.throwIfAborted();
    const claim = await this.claim();
    if (!claim) return false;
    if (claim === "exhausted") return true;
    const controller = new AbortController();
    const forward = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", forward, { once: true });
    if (options.signal?.aborted) forward();
    let renewal: Promise<void> | undefined;
    let watchdog = setTimeout(
      () => controller.abort(new Error("Outbox lease expired.")),
      this.leaseMs,
    );
    const heartbeat = setInterval(
      () => {
        if (renewal || controller.signal.aborted) return;
        renewal = (async () => {
          try {
            if (!(await this.renew(claim))) controller.abort(new Error("Outbox ownership lost."));
            else {
              clearTimeout(watchdog);
              watchdog = setTimeout(
                () => controller.abort(new Error("Outbox lease expired.")),
                this.leaseMs,
              );
            }
          } catch {
            controller.abort(new Error("Outbox lease renewal failed."));
          } finally {
            renewal = undefined;
          }
        })();
      },
      Math.max(10, Math.floor(this.leaseMs / 3)),
    );
    let success = false;
    try {
      const listener = this.listeners.get(claim.listener_name);
      if (!listener || listener.event !== claim.name)
        throw new Error("Durable listener is not registered.");
      const event: DurableEvent = {
        id: claim.id,
        name: claim.name,
        version: Number(claim.version),
        tenantId: claim.tenant_id === null ? null : Number(claim.tenant_id),
        payload: JSON.parse(claim.payload),
      };
      const tenant =
        event.tenantId === null
          ? null
          : await privileged(() => this.tenantResolver(Number(event.tenantId)));
      if (event.tenantId !== null && (!tenant || tenant.id !== event.tenantId))
        throw new Error("Outbox tenant could not be resolved.");
      const handle = async () => {
        controller.signal.throwIfAborted();
        await listener.handle(event, { signal: controller.signal });
        controller.signal.throwIfAborted();
      };
      if (tenant) await runWithTenantDatabase(tenant, handle);
      else await handle();
      success = true;
    } catch {
      // Provider exception messages may contain secrets. Persist a bounded failure code only.
      success = false;
    } finally {
      clearInterval(heartbeat);
      await renewal;
      clearTimeout(watchdog);
      options.signal?.removeEventListener("abort", forward);
    }
    await this.finish(claim, success && !controller.signal.aborted);
    return true;
  }

  /** Stop admission on cancellation; handlers must observe the supplied signal to drain. */
  async work(options: { signal: AbortSignal; pollMs?: number }): Promise<void> {
    const pollMs = positiveInteger(options.pollMs ?? 1_000, "pollMs");
    while (!options.signal.aborted) {
      try {
        if (await this.processNext({ signal: options.signal })) continue;
      } catch (error) {
        if (options.signal.aborted) return;
        throw error;
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          options.signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, pollMs);
        options.signal.addEventListener("abort", done, { once: true });
        if (options.signal.aborted) done();
      });
    }
  }

  /** Operator operation: retains the event and atomically makes one failed delivery eligible. */
  async replay(eventId: string, listenerName: string): Promise<void> {
    identifier(eventId, 64);
    identifier(listenerName, 128);
    await privileged(async () => {
      const now = await clock();
      const p = placeholders(3);
      await db.unsafe(
        `UPDATE strata_outbox_delivery SET status = 'pending', attempts = 0, available_at = ${p[0]},
        lease_token = NULL, lease_until = NULL, completed_at = NULL, error_code = NULL
        WHERE event_id = ${p[1]} AND listener_name = ${p[2]} AND status = 'failed'`,
        [now, eventId, listenerName],
      );
    });
  }
}

export { createOutboxMigration } from "./migration";
export type { DurableEvent, DurableListener, SqlOutboxOptions };
export { SqlOutbox };
