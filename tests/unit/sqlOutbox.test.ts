import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { runInTransaction } from "@getstrata/core/database/transaction";
import {
  createOutboxMetricsCollector,
  createOutboxMigration,
  type DurableListener,
  SqlOutbox,
} from "@getstrata/core/events/outbox";
import { runWithTenant } from "@getstrata/core/tenant/tenantContext";

const tenant = { id: 42, slug: "outbox", plan: "free" as const, region: "eu" as const };
describe("durable SQL outbox on SQLite", () => {
  let connection: ReturnType<typeof createSqliteConnection>;
  let previous: ReturnType<typeof getBoundDatabaseConnection>;
  let tenancy: string | undefined;
  const migration = createOutboxMigration("outbox", "sqlite");
  test("metrics reject unsupported dialects rather than returning a healthy zero", async () => {
    const collector = createOutboxMetricsCollector();
    await expect(collector.collect()).rejects.toThrow("require Postgres");
    await collector.close();
    for (const timeoutMs of [0, 5001, NaN])
      expect(() => createOutboxMetricsCollector({ timeoutMs })).toThrow();
    for (const sampleLimit of [0, 1001, 1.5])
      expect(() => createOutboxMetricsCollector({ sampleLimit })).toThrow();
  });
  beforeEach(async () => {
    tenancy = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "none";
    previous = getBoundDatabaseConnection();
    connection = createSqliteConnection(":memory:");
    bindDatabaseConnection(connection);
    useSqlDialect("sqlite");
    await migration.up(connection);
  });
  afterEach(() => {
    if (previous) bindDatabaseConnection(previous);
    else resetBoundDatabaseConnection();
    resetSqlDialect();
    if (tenancy === undefined) delete process.env.TENANCY_DRIVER;
    else process.env.TENANCY_DRIVER = tenancy;
    connection.close();
  });
  const listener = (handle: DurableListener["handle"], name = "receipt"): DurableListener => ({
    name,
    event: "orders.created",
    handle,
  });
  const publish = (outbox: SqlOutbox, id = "order:1", payload: unknown = { amount: 100 }) =>
    runInTransaction(() => outbox.publish("orders.created", payload, { id }));
  const delivery = async () =>
    await db.unsafe<{ status: string; attempts: number; error_code: string | null }>(
      "SELECT * FROM strata_outbox_delivery ORDER BY listener_name",
    );

  test("publication commits no side effects; restart delivers the persisted listener snapshot", async () => {
    const received: unknown[] = [];
    const original = new SqlOutbox({
      listeners: [
        listener(async (event) => {
          received.push(event);
        }),
      ],
    });
    await publish(original);
    expect(received).toEqual([]);
    const restarted = new SqlOutbox({
      listeners: [
        listener(async (event) => {
          received.push(event);
        }),
      ],
    });
    expect(await restarted.processNext()).toBe(true);
    expect(received).toEqual([
      {
        id: "order:1",
        name: "orders.created",
        version: 1,
        tenantId: null,
        payload: { amount: 100 },
      },
    ]);
    expect((await delivery())[0]?.status).toBe("completed");
    expect(await restarted.processNext()).toBe(false);
    await migration.down(connection);
  });
  test("rollback and savepoint discard events together with business writes", async () => {
    const outbox = new SqlOutbox({ listeners: [listener(async () => {})] });
    await expect(
      runInTransaction(async () => {
        await outbox.publish("orders.created", 1);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await delivery()).toEqual([]);
    await runInTransaction(async () => {
      await expect(
        runInTransaction(async () => {
          await outbox.publish("orders.created", 2);
          throw new Error("nested");
        }),
      ).rejects.toThrow("nested");
      await outbox.publish("orders.created", 3);
      await expect(outbox.processNext()).rejects.toThrow("outside business transactions");
      await expect(outbox.replay("order:1", "receipt")).rejects.toThrow(
        "outside business transactions",
      );
    });
    expect((await delivery()).length).toBe(1);
    await expect(migration.down(connection)).rejects.toThrow("undelivered");
    await migration.up(connection);
  });
  test("duplicates preserve the original snapshot and conflicting reuse fails", async () => {
    const outbox = new SqlOutbox({ listeners: [listener(async () => {})] });
    await publish(outbox);
    const changed = new SqlOutbox({
      listeners: [listener(async () => {}), listener(async () => {}, "another")],
    });
    await publish(changed);
    expect((await delivery()).length).toBe(1);
    await expect(publish(outbox, "order:1", { amount: 200 })).rejects.toThrow("Conflicting");
    await expect(
      runInTransaction(() =>
        outbox.publish("orders.created", { amount: 100 }, { id: "order:1", version: 2 }),
      ),
    ).rejects.toThrow("Conflicting");
  });
  test("failed listeners retain bounded errors and replay does not repeat completed listeners", async () => {
    let failing = true;
    const calls: string[] = [];
    const outbox = new SqlOutbox({
      maxAttempts: 1,
      listeners: [
        listener(async () => {
          calls.push("receipt");
        }),
        listener(async () => {
          if (failing) throw new Error("provider-secret");
          calls.push("second");
        }, "second"),
      ],
    });
    await publish(outbox);
    await outbox.processNext();
    await outbox.processNext();
    expect((await delivery()).map((row) => [row.status, row.error_code])).toEqual([
      ["completed", null],
      ["failed", "listener_failed"],
    ]);
    failing = false;
    await outbox.replay("order:1", "receipt");
    await outbox.replay("order:1", "second");
    await outbox.processNext();
    expect(calls).toEqual(["receipt", "second"]);
  });
  test("retry schedule persists across worker reconstruction", async () => {
    const outbox = new SqlOutbox({
      retryDelayMs: 35,
      listeners: [
        listener(async () => {
          throw new Error("retry");
        }),
      ],
    });
    await publish(outbox);
    await outbox.processNext();
    expect((await delivery())[0]?.status).toBe("pending");
    const restarted = new SqlOutbox({ listeners: [listener(async () => {})] });
    expect(await restarted.processNext()).toBe(false);
    await Bun.sleep(45);
    expect(await restarted.processNext()).toBe(true);
    expect((await delivery())[0]?.attempts).toBe(2);
  });
  test("abandoned final attempt becomes recoverable failure rather than vanishing", async () => {
    const outbox = new SqlOutbox({ maxAttempts: 1, listeners: [listener(async () => {})] });
    await publish(outbox);
    await db.unsafe(
      "UPDATE strata_outbox_delivery SET status='processing', attempts=1, lease_until=0, lease_token='dead'",
    );
    expect(await outbox.processNext()).toBe(true);
    expect((await delivery())[0]?.error_code).toBe("attempts_exhausted");
    await outbox.replay("order:1", "receipt");
    await outbox.processNext();
    expect((await delivery())[0]?.status).toBe("completed");
  });
  test("renewal keeps a slow listener owned while another worker polls", async () => {
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const outbox = new SqlOutbox({
      leaseMs: 150,
      listeners: [
        listener(async () => {
          enter();
          await Bun.sleep(350);
        }),
      ],
    });
    await publish(outbox);
    const running = outbox.processNext();
    await entered;
    await Bun.sleep(220);
    expect(await outbox.processNext()).toBe(false);
    await running;
    expect((await delivery())[0]?.status).toBe("completed");
  });
  test("lost ownership aborts the old handler and fences its acknowledgement", async () => {
    const outbox = new SqlOutbox({
      leaseMs: 90,
      listeners: [
        listener(async (_, { signal }) => {
          await db.unsafe(
            "UPDATE strata_outbox_delivery SET lease_token='new-owner', status='completed', lease_until=NULL",
          );
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
        }),
      ],
    });
    await publish(outbox);
    await outbox.processNext();
    expect((await delivery())[0]?.status).toBe("completed");
  });
  test("captured tenant is resolved and missing/incorrect tenants fail closed", async () => {
    const seen: number[] = [];
    const outbox = new SqlOutbox({
      maxAttempts: 1,
      resolveTenant: async () => tenant,
      listeners: [
        listener(async (event) => {
          seen.push(Number(event.tenantId));
        }),
      ],
    });
    await runWithTenant(tenant, () => publish(outbox));
    await outbox.processNext();
    expect(seen).toEqual([42]);
    const unavailable = new SqlOutbox({
      maxAttempts: 1,
      resolveTenant: async () => null,
      listeners: [
        listener(async () => {
          throw new Error("must not run");
        }),
      ],
    });
    await runWithTenant(tenant, () => publish(unavailable, "order:2"));
    await unavailable.processNext();
    expect((await delivery())[1]?.status).toBe("failed");
  });
  test("removed or incompatible listeners retain their delivery for repair", async () => {
    const original = new SqlOutbox({ maxAttempts: 1, listeners: [listener(async () => {})] });
    await publish(original);
    const removed = new SqlOutbox({ listeners: [] });
    await removed.processNext();
    expect((await delivery())[0]?.status).toBe("failed");
  });
  test("caller cancellation reaches the handler and never acknowledges success", async () => {
    const controller = new AbortController();
    const outbox = new SqlOutbox({
      maxAttempts: 1,
      listeners: [
        listener(async (_, { signal }) => {
          controller.abort();
          expect(signal.aborted).toBe(true);
        }),
      ],
    });
    await publish(outbox);
    await outbox.processNext({ signal: controller.signal });
    expect((await delivery())[0]?.status).toBe("failed");
    await expect(outbox.processNext({ signal: controller.signal })).rejects.toThrow();
    await outbox.work({ signal: controller.signal });
  });
  test("worker loop drains and wakes promptly from a long poll on cancellation", async () => {
    const controller = new AbortController();
    const outbox = new SqlOutbox({
      listeners: [
        listener(async () => {
          controller.abort();
        }),
      ],
    });
    await publish(outbox);
    await outbox.work({ signal: controller.signal });
    const idle = new AbortController();
    const running = outbox.work({ signal: idle.signal, pollMs: 10_000 });
    await Bun.sleep(5);
    idle.abort();
    await running;
  });
  test("a caught publication failure cannot leave a partial listener snapshot", async () => {
    await connection.unsafe("CREATE TABLE business (value INTEGER)");
    await connection.unsafe(
      "CREATE TRIGGER reject_second BEFORE INSERT ON strata_outbox_delivery WHEN NEW.listener_name='second' BEGIN SELECT RAISE(ABORT, 'delivery rejected'); END",
    );
    const outbox = new SqlOutbox({
      listeners: [listener(async () => {}), listener(async () => {}, "second")],
    });
    await runInTransaction(async () => {
      await db.unsafe("INSERT INTO business VALUES (1)");
      await expect(outbox.publish("orders.created", 1)).rejects.toThrow("delivery rejected");
    });
    expect(await db.unsafe("SELECT * FROM business")).toEqual([{ value: 1 }]);
    expect(await db.unsafe("SELECT * FROM strata_outbox_event")).toEqual([]);
    expect(await delivery()).toEqual([]);
  });
  test("renewal SQL failure aborts cooperative effects and preserves the failed delivery", async () => {
    await connection.unsafe(
      "CREATE TRIGGER reject_renew BEFORE UPDATE ON strata_outbox_delivery WHEN OLD.status='processing' AND NEW.status='processing' BEGIN SELECT RAISE(ABORT, 'renew unavailable'); END",
    );
    const outbox = new SqlOutbox({
      maxAttempts: 1,
      leaseMs: 90,
      listeners: [
        listener(async (_, { signal }) => {
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          expect(signal.aborted).toBe(true);
        }),
      ],
    });
    await publish(outbox);
    await outbox.processNext();
    expect((await delivery())[0]?.status).toBe("failed");
  });
  test("worker infrastructure failures propagate to the supervisor without deleting events", async () => {
    const outbox = new SqlOutbox({ listeners: [listener(async () => {})] });
    await publish(outbox);
    await connection.unsafe("ALTER TABLE strata_outbox_delivery RENAME TO unavailable_delivery");
    await expect(outbox.work({ signal: new AbortController().signal })).rejects.toThrow(
      "no such table",
    );
    expect((await db.unsafe("SELECT * FROM strata_outbox_event")).length).toBe(1);
  });
  test("database abort retries are bounded and never repeat listener effects", async () => {
    let effects = 0;
    const outbox = new SqlOutbox({
      listeners: [
        listener(async () => {
          effects++;
        }),
      ],
    });
    await publish(outbox);
    const begin = connection.begin.bind(connection);
    let aborted = 0;
    connection.begin = async (callback) => {
      if (aborted++ < 2)
        throw Object.assign(new Error("serialization abort"), {
          errno: "40001",
          code: "ERR_POSTGRES_SERVER_ERROR",
        });
      return begin(callback);
    };
    await outbox.processNext();
    expect(effects).toBe(1);
    let attempts = 0;
    connection.begin = async () => {
      attempts++;
      throw Object.assign(new Error("deadlock"), { errno: 1213 });
    };
    await expect(outbox.processNext()).rejects.toThrow("deadlock");
    expect(attempts).toBe(5);
  });
  test("stalled lease renewal expires cooperatively and work remains recoverable", async () => {
    const outbox = new SqlOutbox({
      leaseMs: 90,
      maxAttempts: 1,
      listeners: [
        listener(async (_, { signal }) => {
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          expect(signal.reason.message).toBe("Outbox lease expired.");
        }),
      ],
    });
    await publish(outbox);
    const begin = connection.begin.bind(connection);
    let roots = 0;
    connection.begin = async (callback) =>
      begin(async (tx) => {
        if (++roots === 2) await Bun.sleep(130);
        return callback(tx);
      });
    await outbox.processNext();
    expect((await delivery())[0]?.status).toBe("processing");
    await outbox.processNext();
    expect((await delivery())[0]?.error_code).toBe("attempts_exhausted");
  });
  test("validates the contract before writes", async () => {
    const outbox = new SqlOutbox({ listeners: [listener(async () => {})], maxPayloadBytes: 10 });
    await expect(outbox.publish("orders.created", 1)).rejects.toThrow(
      "active business transaction",
    );
    await expect(publish(outbox, "bad id")).rejects.toThrow("identifier");
    await expect(publish(outbox, "valid", undefined)).rejects.toThrow("oversized");
    await expect(
      runInTransaction(() => outbox.publish("orders.created", undefined)),
    ).rejects.toThrow("payload");
    await expect(runInTransaction(() => outbox.publish("missing", 1))).rejects.toThrow(
      "No durable",
    );
    await expect(
      runInTransaction(() => outbox.publish("orders.created", 1, { version: 0 })),
    ).rejects.toThrow("positive integer");
    expect(() => new SqlOutbox({ leaseMs: 10, listeners: [] })).toThrow("at least 30");
    expect(() => new SqlOutbox({ maxAttempts: 0, listeners: [] })).toThrow("positive integer");
    expect(
      () => new SqlOutbox({ listeners: [listener(async () => {}), listener(async () => {})] }),
    ).toThrow("unique");
  });
});
