import { type ServiceDeclaration, service } from "@getstrata/core/contracts/services";
import { createServiceToken, type ServiceToken } from "@getstrata/core/contracts/token";
import { PersistenceError } from "@getstrata/core/database/errors";
import {
  assertNoOwnedTransaction,
  assertOwnedSession,
  DATABASE_OWNERSHIP_TOKEN,
  runOwnedSession,
  type SessionOwnerIdentity,
} from "#strata-orm-internal";
import { copyApplicationConfig } from "../../config/configSnapshot";
import type { ApplicationConfig } from "../../contracts/application";
import type { PersistenceInvocation, SelectedSession } from "../../contracts/persistence";
import type { TransactionSession } from "../../database/session";
import { resolveTenant } from "../../tenant/resolveTenant";
import { runWithTenant, type TenantContext } from "../../tenant/tenantContext";
import { workerApplicationShutdown } from "./workerTransport";

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
  handle(
    event: DurableEvent,
    context: Readonly<{ signal: AbortSignal; database: SelectedSession }>,
  ): Promise<void>;
}
type OutboxDeliveryStatus = "pending" | "processing" | "failed" | "completed";
interface OutboxDeliverySnapshot {
  readonly status: OutboxDeliveryStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
}
const ownerBrand: unique symbol = Symbol("sql.outbox.owner");
interface SqlOutboxOwner extends SessionOwnerIdentity {
  readonly invoke: PersistenceInvocation;
  readonly [ownerBrand]: object;
}
interface SqlOutboxBindingOptions {
  readonly invoke: PersistenceInvocation;
  readonly connection: string;
  readonly tenancy: "none" | "column" | "rls";
  readonly listeners: readonly DurableListener[];
  readonly leaseMs?: number;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly maxPayloadBytes?: number;
  readonly resolveTenant?: (
    selected: TransactionSession,
    id: number,
  ) => Promise<TenantContext | null>;
}
interface SqlOutboxOptions extends Omit<SqlOutboxBindingOptions, "invoke" | "connection"> {
  readonly owner: SqlOutboxOwner;
}
interface SqlOutboxBindings {
  readonly token: ServiceToken<SqlOutbox>;
  readonly services: readonly ServiceDeclaration[];
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
  if (typeof value !== "string" || !value || value.length > max || !/^[\w.:-]+$/.test(value))
    throw new Error("Invalid durable event/listener identifier.");
  return value;
}
function rejected<T>(error: unknown): Promise<T> {
  const promise = Promise.reject<T>(error);
  void promise.catch(() => {});
  return promise;
}
function placeholders(selected: SelectedSession, count: number): string[] {
  return Array.from({ length: count }, (_, index) => selected.dialect.placeholder(index + 1));
}
function sql<Row>(
  selected: SelectedSession,
  text: string,
  params: readonly unknown[] = [],
): Promise<readonly Row[]> {
  return selected.execute<Row>({ text, params });
}
async function clock(selected: SelectedSession): Promise<number> {
  const [row] = await sql<{ now_ms: number }>(
    selected,
    `SELECT ${selected.dialect.epochMillisecondsExpression()} AS now_ms`,
  );
  const now = Number(row?.now_ms);
  if (!Number.isSafeInteger(now)) throw new Error("Database did not return a valid outbox clock.");
  return now;
}
function retryable(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error instanceof PersistenceError) {
    if (seen.has(error) || error.data === "unknown" || error.data === "committed") return false;
    seen.add(error);
    error = error.cause;
  }
  if (!error || typeof error !== "object" || error instanceof AggregateError) return false;
  const value = error as { code?: unknown; errno?: unknown };
  return ["40001", "40P01", "1213"].includes(String(value.errno ?? value.code));
}
function originTenantId(tenant: unknown): number | null {
  if (tenant === undefined || tenant === null) return null;
  const id = (tenant as { id?: unknown }).id;
  if (typeof id !== "number") throw new Error("Invalid immutable execution tenant.");
  return positiveInteger(id, "tenantId");
}
function ownField(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") throw new TypeError("Invalid outbox declaration.");
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (!field || !("value" in field))
    throw new TypeError("Outbox metadata requires own data fields.");
  return field.value;
}
function listenerSnapshot(listeners: readonly DurableListener[]): readonly DurableListener[] {
  if (!Array.isArray(listeners)) throw new TypeError("Durable listeners must be an array.");
  const names = new Set<string>();
  return Object.freeze(
    Array.from({ length: listeners.length }, (_, index) => {
      const listener = ownField(listeners, String(index)) as DurableListener;
      const name = identifier(ownField(listener, "name") as string, 128);
      const event = identifier(ownField(listener, "event") as string, 128);
      if (names.has(name)) throw new Error("Durable listener names must be unique.");
      names.add(name);
      let current: object | null = listener;
      let handle: unknown;
      while (current) {
        const descriptor = Object.getOwnPropertyDescriptor(current, "handle");
        if (descriptor) {
          if (!("value" in descriptor)) throw new TypeError("Listener accessors are unsupported.");
          handle = descriptor.value;
          break;
        }
        current = Object.getPrototypeOf(current);
      }
      if (typeof handle !== "function") throw new TypeError("Durable listener requires handle().");
      const callback = handle as DurableListener["handle"];
      return Object.freeze({
        name,
        event,
        handle: (event: DurableEvent, context: Parameters<DurableListener["handle"]>[1]) =>
          callback.call(listener, event, context),
      });
    }),
  );
}
function createSqlOutboxBindings(options: SqlOutboxBindingOptions): SqlOutboxBindings {
  const captured = { ...options };
  if (
    !options ||
    typeof captured.invoke !== "function" ||
    typeof captured.connection !== "string" ||
    !captured.connection.trim() ||
    !["none", "column", "rls"].includes(captured.tenancy)
  )
    throw new TypeError("Explicit outbox owner, connection and tenancy are required.");
  const snapshot = Object.freeze({ ...captured, listeners: listenerSnapshot(captured.listeners) });
  const leaseMs = positiveInteger(snapshot.leaseMs ?? 60_000, "leaseMs");
  if (leaseMs < 30) throw new Error("leaseMs must be at least 30 milliseconds.");
  positiveInteger(snapshot.maxAttempts ?? 5, "maxAttempts");
  positiveInteger(snapshot.retryDelayMs ?? 1000, "retryDelayMs");
  positiveInteger(snapshot.maxPayloadBytes ?? 65_536, "maxPayloadBytes");
  const token = createServiceToken<SqlOutbox>("core.outbox.coordinator");
  const declaration = service(token, {
    lifetime: "application",
    dependencies: [DATABASE_OWNERSHIP_TOKEN] as const,
    create: (ownership) => {
      const configuredPool = ownership.connections[snapshot.connection];
      if (!configuredPool) throw new Error("Outbox connection is not configured.");
      if (
        snapshot.tenancy === "rls" &&
        (configuredPool.driver !== "pgsql" ||
          (configuredPool.max !== undefined && configuredPool.max < 2))
      )
        throw new Error(
          "RLS outbox workers require PostgreSQL with at least two configured connections.",
        );
      const owner = { app: ownership.app, configuredPool, invoke: snapshot.invoke };
      Object.defineProperty(owner, ownerBrand, { value: owner });
      Object.freeze(owner);
      return new SqlOutbox({ ...snapshot, owner: owner as SqlOutboxOwner });
    },
  });
  return Object.freeze({ token, services: Object.freeze([declaration]) });
}

/** Opt-in SQL effects. Publishing writes only; workers execute listeners at least once. */
class SqlOutbox {
  private readonly listeners = new Map<string, DurableListener>();
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly maxPayloadBytes: number;
  private readonly tenantResolver: (
    selected: TransactionSession,
    id: number,
  ) => Promise<TenantContext | null>;
  private readonly owner: SqlOutboxOwner;
  private readonly tenancy: "none" | "column" | "rls";

  constructor(options: SqlOutboxOptions) {
    if (
      !options.owner ||
      Object.getOwnPropertyDescriptor(options.owner, ownerBrand)?.value !== options.owner ||
      !Object.isFrozen(options.owner)
    )
      throw new TypeError("Outbox requires its original graph-owned identity.");
    this.owner = options.owner;
    this.tenancy = options.tenancy;
    this.leaseMs = positiveInteger(options.leaseMs ?? 60_000, "leaseMs");
    this.maxAttempts = positiveInteger(options.maxAttempts ?? 5, "maxAttempts");
    this.retryDelayMs = positiveInteger(options.retryDelayMs ?? 1_000, "retryDelayMs");
    this.maxPayloadBytes = positiveInteger(options.maxPayloadBytes ?? 65_536, "maxPayloadBytes");
    this.tenantResolver = options.resolveTenant ?? resolveTenant;
    for (const listener of options.listeners) {
      identifier(listener.name, 128);
      identifier(listener.event, 128);
      this.listeners.set(listener.name, listener);
    }
  }

  private async privileged<T>(
    phase: string,
    work: (selected: TransactionSession) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.owner.invoke(
          { kind: "command", actor: { kind: "system", policy: `outbox.${phase}` } },
          (ports) => {
            assertOwnedSession(this.owner, ports.database);
            return this.tenancy === "rls"
              ? ports.policy.run(ports.database, { kind: "bypass" }, work)
              : ports.database.transaction(work);
          },
        );
      } catch (error) {
        if (attempt >= 4 || !retryable(error)) throw error;
        await Bun.sleep(10 * (attempt + 1));
      }
    }
  }

  hasListener(name: string, event?: string): boolean {
    const listener = this.listeners.get(name);
    return listener !== undefined && (event === undefined || listener.event === event);
  }

  /** Read-only advisory observation: caller owns tenant/RLS scope; no implicit bypass. */
  getDelivery(
    db: SelectedSession,
    eventId: string,
    listenerName: string,
  ): Promise<OutboxDeliverySnapshot | null> {
    try {
      assertOwnedSession(this.owner, db);
      identifier(eventId, 64);
      identifier(listenerName, 128);
      return runOwnedSession(this.owner, db, () => this.readDelivery(db, eventId, listenerName));
    } catch (error) {
      return rejected(error);
    }
  }
  private async readDelivery(
    db: SelectedSession,
    eventId: string,
    listenerName: string,
  ): Promise<OutboxDeliverySnapshot | null> {
    const p = placeholders(db, 2);
    const [row] = await sql<{
      status: string;
      attempts: number | string;
      max_attempts: number | string;
    }>(
      db,
      `SELECT status, attempts, max_attempts FROM strata_outbox_delivery WHERE event_id = ${p[0]} AND listener_name = ${p[1]} LIMIT 1`,
      [eventId, listenerName],
    );
    if (!row) return null;
    const attempts = Number(row.attempts);
    const maxAttempts = Number(row.max_attempts);
    if (
      !Number.isSafeInteger(attempts) ||
      attempts < 0 ||
      !Number.isSafeInteger(maxAttempts) ||
      maxAttempts < 1
    )
      throw new Error("Invalid outbox delivery snapshot.");
    const status = row.status;
    if (
      status !== "pending" &&
      status !== "processing" &&
      status !== "failed" &&
      status !== "completed"
    )
      throw new Error("Invalid outbox delivery snapshot.");
    return { status, attempts, maxAttempts };
  }

  publish(
    db: TransactionSession,
    name: string,
    payload: unknown,
    options: { tenantId: number | null; id?: string; version?: number },
  ): Promise<string> {
    const origin = assertOwnedSession(this.owner, db, true);
    const tenantId = ownField(options, "tenantId");
    if (tenantId !== null) positiveInteger(tenantId as number, "tenantId");
    if (tenantId !== originTenantId(origin.tenant))
      throw new Error("Outbox publication tenant must match its immutable execution.");
    const copied = {
      tenantId: tenantId as number | null,
      id: options.id,
      version: options.version,
    };
    return db.transaction((child) => this.persist(child, name, payload, copied));
  }

  private async persist(
    db: TransactionSession,
    name: string,
    payload: unknown,
    options: { tenantId: number | null; id?: string; version?: number },
  ): Promise<string> {
    assertOwnedSession(this.owner, db, true);
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
    const tenantId = options.tenantId;
    if (tenantId !== null) positiveInteger(tenantId, "tenantId");
    const token = crypto.randomUUID();
    const now = await clock(db);
    await sql(
      db,
      `INSERT INTO strata_outbox_event (id, name, version, tenant_id, payload, created_at, publication_token)
      VALUES (${placeholders(db, 7).join(", ")})${db.dialect.upsertSuffix(["id"], [])}`,
      [id, name, version, tenantId, serialized, now, token],
    );
    const [existing] = await sql<EventRow>(
      db,
      `SELECT * FROM strata_outbox_event WHERE id = ${placeholders(db, 1)[0]}`,
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
      await sql(
        db,
        `INSERT INTO strata_outbox_delivery (event_id, listener_name, status, max_attempts, available_at)
        VALUES (${placeholders(db, 5).join(", ")})`,
        [id, listener.name, "pending", this.maxAttempts, now],
      );
    }
    return id;
  }

  private async claim(): Promise<Claim | "exhausted" | null> {
    return this.privileged("claim", async (db) => {
      const now = await clock(db);
      const p = placeholders(db, 2);
      // Separate indexed scans avoid locking the entire due set during a filesort.
      // Recover expired owners first so a constant arrival stream cannot starve recovery.
      const columns = "event_id, listener_name, attempts, max_attempts";
      const [expired] = await sql<{
        event_id: string;
        listener_name: string;
        attempts: number;
        max_attempts: number;
      }>(
        db,
        `SELECT ${columns} FROM strata_outbox_delivery WHERE status = 'processing' AND lease_until <= ${p[0]}
        ORDER BY lease_until, event_id, listener_name LIMIT 1${db.dialect.rowLockClause(true)}`,
        [now],
      );
      const delivery =
        expired ??
        (
          await sql<{
            event_id: string;
            listener_name: string;
            attempts: number;
            max_attempts: number;
          }>(
            db,
            `SELECT ${columns} FROM strata_outbox_delivery WHERE status = 'pending' AND available_at <= ${p[0]}
        ORDER BY available_at, event_id, listener_name LIMIT 1${db.dialect.rowLockClause(true)}`,
            [now],
          )
        )[0];
      if (!delivery) return null;
      const [event] = await sql<EventRow>(
        db,
        `SELECT * FROM strata_outbox_event WHERE id = ${p[0]}`,
        [delivery.event_id],
      );
      if (!event) throw new Error("Outbox event missing for delivery.");
      const candidate = { ...event, ...delivery };
      const token = crypto.randomUUID();
      const exhausted = Number(candidate.attempts) >= Number(candidate.max_attempts);
      const q = placeholders(db, 9);
      await sql(
        db,
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
      const [owner] = await sql<{ lease_token: string }>(
        db,
        `SELECT lease_token FROM strata_outbox_delivery WHERE event_id = ${p[0]} AND listener_name = ${p[1]}${db.dialect.rowLockClause()}`,
        [candidate.id, candidate.listener_name],
      );
      if (owner?.lease_token !== token) return null;
      if (exhausted) return "exhausted";
      return { ...candidate, attempts: Number(candidate.attempts) + 1, lease_token: token };
    });
  }

  private async renew(claim: Claim): Promise<boolean> {
    return this.privileged("renew", async (db) => {
      const now = await clock(db);
      const p = placeholders(db, 5);
      await sql(
        db,
        `UPDATE strata_outbox_delivery SET lease_until = ${p[0]} WHERE event_id = ${p[1]}
        AND listener_name = ${p[2]} AND lease_token = ${p[3]} AND status = 'processing' AND lease_until > ${p[4]}`,
        [now + this.leaseMs, claim.id, claim.listener_name, claim.lease_token, now],
      );
      const q = placeholders(db, 3);
      const [owner] = await sql<{ lease_until: number }>(
        db,
        `SELECT lease_until FROM strata_outbox_delivery WHERE event_id = ${q[0]} AND listener_name = ${q[1]} AND lease_token = ${q[2]} AND status = 'processing'${db.dialect.rowLockClause()}`,
        [claim.id, claim.listener_name, claim.lease_token],
      );
      return Number(owner?.lease_until) > now;
    });
  }

  private async finish(claim: Claim, success: boolean): Promise<void> {
    await this.privileged("finish", async (db) => {
      const now = await clock(db);
      const status = success
        ? "completed"
        : claim.attempts >= Number(claim.max_attempts)
          ? "failed"
          : "pending";
      const delay = Math.min(this.retryDelayMs * 2 ** Math.min(claim.attempts - 1, 16), 300_000);
      const p = placeholders(db, 9);
      await sql(
        db,
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

  processNext(options: { signal?: AbortSignal } = {}): Promise<boolean> {
    return this.processOwned(options);
  }

  private processOwned(
    options: { signal?: AbortSignal },
    applicationShutdown?: AbortSignal,
  ): Promise<boolean> {
    try {
      applicationShutdown?.throwIfAborted();
      assertNoOwnedTransaction(this.owner);
    } catch (error) {
      return rejected(error);
    }
    return this.owner.invoke(
      {
        kind: "command",
        actor: { kind: "system", policy: "outbox.process" },
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (ports) => {
        const scope = assertOwnedSession(this.owner, ports.database);
        return this.processSelected({ signal: scope.signal }, applicationShutdown);
      },
    );
  }

  private async processSelected(
    options: { signal: AbortSignal },
    applicationShutdown?: AbortSignal,
  ): Promise<boolean> {
    options.signal?.throwIfAborted();
    const claim = await this.claim();
    if (!claim) return false;
    if (claim === "exhausted") return true;
    const controller = new AbortController();
    const forward = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", forward, { once: true });
    if (options.signal?.aborted) forward();
    let renewal: Promise<void> | undefined;
    let renewalFailure: { error: unknown } | undefined;
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
          } catch (error) {
            renewalFailure = { error };
            controller.abort(new Error("Outbox lease renewal failed."));
          } finally {
            renewal = undefined;
          }
        })();
      },
      Math.max(10, Math.floor(this.leaseMs / 3)),
    );
    let success = false;
    let listenerFailure: { error: unknown } | undefined;
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
          : await this.privileged("tenant", (selected) =>
              this.tenantResolver(selected, Number(event.tenantId)),
            );
      if (event.tenantId !== null && (!tenant || tenant.id !== event.tenantId))
        throw new Error("Outbox tenant could not be resolved.");
      await this.owner.invoke(
        {
          kind: "job",
          actor: { kind: "system", policy: "outbox.listener" },
          ...(tenant ? { tenant: copyApplicationConfig(tenant) as ApplicationConfig } : {}),
          signal: controller.signal,
        },
        (ports) => {
          assertOwnedSession(this.owner, ports.database);
          const handle = async (database: SelectedSession) => {
            const scope = assertOwnedSession(this.owner, database);
            scope.signal.throwIfAborted();
            const observedTenant = scope.tenant as TenantContext | undefined;
            const invoke = () => listener.handle(event, { signal: scope.signal, database });
            await (observedTenant ? runWithTenant(observedTenant, invoke) : invoke());
            scope.signal.throwIfAborted();
          };
          if (this.tenancy === "rls")
            return ports.policy.run(
              ports.database,
              tenant ? { kind: "tenant", tenantId: tenant.id } : { kind: "bypass" },
              handle,
            );
          return handle(ports.database);
        },
      );
      success = true;
    } catch (error) {
      listenerFailure = { error };
      // Provider exception messages may contain secrets. Persist a bounded failure code only.
      success = false;
    } finally {
      clearInterval(heartbeat);
      await renewal;
      clearTimeout(watchdog);
      options.signal?.removeEventListener("abort", forward);
    }
    const failures = options.signal.aborted
      ? [
          ...(listenerFailure ? [listenerFailure.error] : []),
          ...(renewalFailure ? [renewalFailure.error] : []),
        ]
      : [];
    // Keep each actual failure occurrence and its canonical envelope intact.
    if (options.signal.aborted && !failures.includes(options.signal.reason))
      failures.unshift(options.signal.reason);
    try {
      // An original transport setup signal proves this application's admission is
      // closing. Leave the lease recoverable; never attempt or reopen fresh finish SQL.
      if (!applicationShutdown?.aborted)
        await this.finish(claim, success && !controller.signal.aborted);
    } catch (error) {
      if (failures.length)
        throw new AggregateError([...failures, error], "Outbox cancellation and finish failed.");
      throw error;
    }
    // Persist only the bounded delivery code, then preserve actual caller cancellation
    // and the listener's canonical failure occurrences after all renewal work settles.
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Outbox delivery cancelled.");
    options.signal.throwIfAborted();
    return true;
  }

  /** Stop admission on cancellation; handlers must observe the supplied signal to drain. */
  work(options: { signal: AbortSignal; pollMs?: number }): Promise<void> {
    try {
      assertNoOwnedTransaction(this.owner);
    } catch (error) {
      return rejected(error);
    }
    const shutdownPort = Object.getOwnPropertyDescriptor(options, workerApplicationShutdown);
    const applicationShutdown =
      shutdownPort && "value" in shutdownPort
        ? (shutdownPort.value as AbortSignal | undefined)
        : undefined;
    const pollMs = positiveInteger(options.pollMs ?? 1000, "pollMs");
    return this.owner.invoke(
      {
        kind: "command",
        actor: { kind: "system", policy: "outbox.worker" },
        signal: options.signal,
      },
      async (ports) => {
        const { signal } = assertOwnedSession(this.owner, ports.database);
        while (!signal.aborted) {
          if (await this.processOwned({ signal }, applicationShutdown)) continue;
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              signal.removeEventListener("abort", done);
              resolve();
            };
            const timer = setTimeout(done, pollMs);
            signal.addEventListener("abort", done, { once: true });
            if (signal.aborted) done();
          });
        }
      },
    );
  }

  /** Operator operation: retains the event and atomically makes one failed delivery eligible. */
  replay(eventId: string, listenerName: string): Promise<void> {
    try {
      assertNoOwnedTransaction(this.owner);
      identifier(eventId, 64);
      identifier(listenerName, 128);
    } catch (error) {
      return rejected(error);
    }
    return this.owner.invoke(
      { kind: "command", actor: { kind: "system", policy: "outbox.replay-operation" } },
      (ports) => {
        assertOwnedSession(this.owner, ports.database);
        identifier(eventId, 64);
        identifier(listenerName, 128);
        return this.privileged("replay", async (db) => {
          const now = await clock(db);
          const p = placeholders(db, 3);
          await sql(
            db,
            `UPDATE strata_outbox_delivery SET status = 'pending', attempts = 0, available_at = ${p[0]},
        lease_token = NULL, lease_until = NULL, completed_at = NULL, error_code = NULL
        WHERE event_id = ${p[1]} AND listener_name = ${p[2]} AND status = 'failed'`,
            [now, eventId, listenerName],
          );
        });
      },
    );
  }
}

export type {
  OutboxMetricState,
  OutboxMetricsCollector,
  OutboxMetricsOptions,
  OutboxMetricsSnapshot,
} from "./metrics";
export { createOutboxMetricsCollector, renderOutboxMetrics } from "./metrics";
export { createOutboxMigration } from "./migration";
export type { OutboxWorkerTransport } from "./workerTransport";
export { createOutboxWorkerTransport } from "./workerTransport";
export type {
  DurableEvent,
  DurableListener,
  OutboxDeliverySnapshot,
  OutboxDeliveryStatus,
  SqlOutboxBindingOptions,
  SqlOutboxBindings,
  SqlOutboxOptions,
  SqlOutboxOwner,
};
export { createSqlOutboxBindings, SqlOutbox };
