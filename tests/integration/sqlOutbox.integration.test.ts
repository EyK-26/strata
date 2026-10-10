import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";
import type { SqlDatabaseConnection } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import {
  getDefaultDatabasePool,
  registerDefaultDatabasePool,
} from "@getstrata/core/database/defaultConnection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { runInTransaction } from "@getstrata/core/database/transaction";
import {
  createOutboxMetricsCollector,
  createOutboxMigration,
  SqlOutbox,
} from "@getstrata/core/events/outbox";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { currentTenant } from "@getstrata/core/tenant/tenantContext";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { SQL } from "bun";
import { snapshotQuery } from "../../src/core/events/outbox/metrics";
import { restoreEnvVar } from "../helpers/restoreEnv";

const adminUrl = process.env.MIGRATION_DATABASE_URL;
const restrictedUrl = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
const tenant = { id: 101, slug: "outbox", plan: "free" as const, region: "eu" as const };

describe.skipIf(!adminUrl || !restrictedUrl)("Postgres outbox with restricted-role RLS", () => {
  const database = `outbox_${crypto.randomUUID().replaceAll("-", "")}`;
  let control: SQL;
  let admin: SQL;
  let pool: SQL;
  let previousPool: SqlDatabaseConnection;
  let previousBound: ReturnType<typeof getBoundDatabaseConnection>;
  let previousTenancy: string | undefined;
  let created = false;
  let workerUrl: string;
  const migration = createOutboxMigration("outbox", "pgsql", { rls: true });
  beforeAll(async () => {
    if (!adminUrl || !restrictedUrl) throw new Error("Dedicated test database URLs required.");
    control = new SQL(adminUrl);
    await control.unsafe(`CREATE DATABASE ${database}`);
    created = true;
    const a = new URL(adminUrl);
    a.pathname = `/${database}`;
    const r = new URL(restrictedUrl);
    r.pathname = `/${database}`;
    workerUrl = r.toString();
    admin = new SQL(a.toString());
    pool = new SQL({ url: workerUrl, max: 8 });
    const [role] = await pool.unsafe<{ role: string; rolsuper: boolean; rolbypassrls: boolean }[]>(
      "SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user",
    );
    if (!role || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(role.role)) throw new Error("Invalid test role.");
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
    await migration.up(admin);
    await migration.up(admin);
    await admin.unsafe(`GRANT SELECT, INSERT, UPDATE ON strata_outbox_event, strata_outbox_delivery TO "${role.role}";
      CREATE TABLE effects (event_id VARCHAR(64) PRIMARY KEY, tenant_id INTEGER NOT NULL);
      ALTER TABLE effects ENABLE ROW LEVEL SECURITY; ALTER TABLE effects FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_scope ON effects USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::integer);
      GRANT SELECT, INSERT ON effects TO "${role.role}";`);
    previousPool = getDefaultDatabasePool();
    previousBound = getBoundDatabaseConnection();
    previousTenancy = process.env.TENANCY_DRIVER;
    registerDefaultDatabasePool(pool as unknown as SqlDatabaseConnection);
    resetBoundDatabaseConnection();
    useSqlDialect("pgsql");
    process.env.TENANCY_DRIVER = "rls";
  });
  afterAll(async () => {
    if (previousPool) registerDefaultDatabasePool(previousPool);
    if (previousBound) bindDatabaseConnection(previousBound);
    else resetBoundDatabaseConnection();
    resetSqlDialect();
    restoreEnvVar("TENANCY_DRIVER", previousTenancy);
    await pool?.close();
    await admin?.close();
    if (created) await control.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
    await control?.close();
  });
  const make = (
    handle: ConstructorParameters<typeof SqlOutbox>[0]["listeners"][number]["handle"],
  ) =>
    new SqlOutbox({
      leaseMs: 300,
      resolveTenant: async () => tenant,
      listeners: [{ name: "effect", event: "order", handle }],
    });
  test("platform observations are bounded, read-only and restore restricted-role scope", async () => {
    const collector = createOutboxMetricsCollector({ sampleLimit: 2 });
    try {
      const empty = await collector.collect();
      expect(empty.states.every((row) => row.count === 0)).toBe(true);
      await admin.unsafe(
        `INSERT INTO strata_outbox_event VALUES ('metrics', 'private-name', 1, 999, 'private-payload', 1, 'private-token')`,
      );
      for (const [listener, status, available, lease] of [
        ["due1", "pending", 1, null],
        ["due2", "pending", 2, null],
        ["due3", "pending", 3, null],
        ["waiting", "pending", 9007199254740991, null],
        ["expired", "processing", 1, 1],
        ["active", "processing", 1, 9007199254740991],
        ["unleased", "processing", 1, null],
        ["failed", "failed", 1, null],
        ["completed", "completed", 1, null],
      ])
        await admin.unsafe(
          `INSERT INTO strata_outbox_delivery (event_id, listener_name, status, max_attempts, available_at, lease_until) VALUES ('metrics', $1, $2, 3, $3, $4)`,
          [listener, status, available, lease],
        );
      const snapshot = await collector.collect();
      expect(snapshot.states.find((row) => row.state === "pending_due")).toMatchObject({
        count: 2,
        capped: true,
      });
      for (const state of [
        "pending_waiting",
        "processing_active",
        "processing_expired",
        "processing_unleased",
        "failed",
      ])
        expect(snapshot.states.find((row) => row.state === state)).toMatchObject({
          count: 1,
          capped: false,
        });
      expect(
        snapshot.states.find((row) => row.state === "pending_due")?.actionableLatenessSeconds,
      ).toBeGreaterThan(1000000);
      expect(
        snapshot.states.find((row) => row.state === "processing_active")?.actionableLatenessSeconds,
      ).toBe(null);
      const previousMetricsToken = process.env.METRICS_TOKEN;
      process.env.METRICS_TOKEN = "outbox-metrics-fixture";
      try {
        const routes = createMetricsRoutes({
          outbox: collector,
          queue: { redisUrl: "invalid-url", timeoutMs: 50 },
        });
        const response = await routes["/metrics"](
          new Request("http://localhost/metrics", {
            headers: { authorization: "Bearer outbox-metrics-fixture" },
          }),
        );
        const body = await response.text();
        expect(response.status).toBe(200);
        expect(body).toContain('strata_outbox_deliveries_sample{state="pending_due"} 2');
        expect(body).toContain('strata_outbox_sample_capped{state="pending_due"} 1');
        expect(body).toContain("strata_outbox_collector_success 1");
        expect(body).toContain("strata_queue_collector_success 0");
        for (const privateValue of ["private-payload", "private-token", "private-name"])
          expect(body).not.toContain(privateValue);
      } finally {
        restoreEnvVar("METRICS_TOKEN", previousMetricsToken);
      }
      const base = new URL("../../src/core/", import.meta.url);
      const processSnapshots = await Promise.all(
        Array.from({ length: 3 }, async () => {
          const code = `import {SQL} from "bun";
          import {registerDefaultDatabasePool} from ${JSON.stringify(new URL("database/defaultConnection.ts", base).pathname)};
          import {createOutboxMetricsCollector} from ${JSON.stringify(new URL("events/outbox/index.ts", base).pathname)};
          const pool=new SQL(process.env.OUTBOX_TEST_DATABASE_URL);
          registerDefaultDatabasePool(pool);
          const collector=createOutboxMetricsCollector({sampleLimit:2});
          try { console.log(JSON.stringify((await collector.collect()).states.map(({state,count,capped})=>({state,count,capped})))); }
          finally { await collector.close(); await pool.close(); }`;
          const child = Bun.spawn([process.execPath, "--no-env-file", "-e", code], {
            env: { ...process.env, OUTBOX_TEST_DATABASE_URL: workerUrl },
            stdout: "pipe",
            stderr: "pipe",
          });
          const output = await new Response(child.stdout).text();
          expect(await child.exited).toBe(0);
          return JSON.parse(output);
        }),
      );
      expect(processSnapshots[0]).toEqual(processSnapshots[1]);
      expect(processSnapshots[1]).toEqual(processSnapshots[2]);
      expect(processSnapshots[0]).toEqual(
        snapshot.states.map(({ state, count, capped }) => ({ state, count, capped })),
      );
      expect(
        (
          await admin.unsafe<unknown[]>(
            "SELECT * FROM strata_outbox_delivery WHERE event_id='metrics'",
          )
        ).length,
      ).toBe(9);
      expect(
        await runInTransaction(() =>
          db.unsafe("SELECT * FROM strata_outbox_event WHERE id='metrics'"),
        ),
      ).toEqual([]);
      const [settings] = await pool.unsafe<{ timeout: string; bypass: string | null }[]>(
        "SELECT current_setting('statement_timeout') AS timeout, current_setting('app.bypass_rls', true) AS bypass",
      );
      expect(settings?.timeout).toBe("0");
      expect(settings?.bypass === "true").toBe(false);
      await expect(runInTransaction(() => collector.collect())).rejects.toThrow(
        "independent transaction",
      );
    } finally {
      await collector.close();
      await admin.unsafe("DELETE FROM strata_outbox_event WHERE id='metrics'");
    }
    await expect(collector.collect()).rejects.toThrow("closed");
  });

  test("real RLS plans seek indexes instead of scanning completed history", async () => {
    await admin.unsafe(
      `INSERT INTO strata_outbox_event VALUES ('metrics-plan', 'private', 1, 999, 'private', 1, 'private')`,
    );
    try {
      await admin.unsafe(`INSERT INTO strata_outbox_delivery (event_id, listener_name, status, max_attempts, available_at)
        SELECT 'metrics-plan', 'completed-' || n, 'completed', 3, n FROM generate_series(1, 20000) n`);
      await admin.unsafe(`INSERT INTO strata_outbox_delivery (event_id, listener_name, status, max_attempts, available_at)
        SELECT 'metrics-plan', 'pending-' || n, 'pending', 3, n FROM generate_series(1, 1000) n`);
      await admin.unsafe("ANALYZE strata_outbox_delivery");
      const plans = await runInTransaction(() =>
        runWithMigrationBypass(() =>
          db.unsafe<{ "QUERY PLAN": unknown }>(
            `EXPLAIN (ANALYZE, FORMAT JSON) ${snapshotQuery}`,
            [3],
          ),
        ),
      );
      const text = JSON.stringify(plans);
      expect(text).toContain("strata_outbox_due");
      expect(text).toContain("strata_outbox_expired");
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
          for (const child of value) visit(child);
          return;
        }
        if (value === null || typeof value !== "object") return;
        const node = value as Record<string, unknown>;
        if (node["Relation Name"] === "strata_outbox_delivery") {
          expect(node["Node Type"]).not.toBe("Seq Scan");
          expect(Number(node["Actual Rows"])).toBeLessThanOrEqual(3);
        }
        for (const child of Object.values(node)) visit(child);
      };
      visit(plans);
    } finally {
      await admin.unsafe("DELETE FROM strata_outbox_event WHERE id='metrics-plan'");
    }
  });

  test("a blocked SQL scrape times out, rolls back and allows recovery", async () => {
    const collector = createOutboxMetricsCollector({ timeoutMs: 100 });
    let unlock: (() => void) | undefined;
    let locked: (() => void) | undefined;
    const admitted = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const locking = admin.begin(async (tx) => {
      await tx.unsafe("LOCK TABLE strata_outbox_delivery IN ACCESS EXCLUSIVE MODE");
      locked?.();
      await gate;
    });
    try {
      await admitted;
      const started = performance.now();
      await expect(collector.collect()).rejects.toThrow();
      expect(performance.now() - started).toBeLessThan(1000);
    } finally {
      unlock?.();
      await locking;
      await collector.close();
    }
    const recovered = createOutboxMetricsCollector();
    try {
      expect((await recovered.collect()).states.every((row) => row.count === 0)).toBe(true);
    } finally {
      await recovered.close();
    }
  });

  test("pool checkout timeout does not multiply pending transactions", async () => {
    const reserved = await Promise.all(Array.from({ length: 8 }, () => pool.reserve()));
    const collector = createOutboxMetricsCollector({ timeoutMs: 50 });
    try {
      await expect(collector.collect()).rejects.toThrow("timed out");
      await expect(collector.collect()).rejects.toThrow("settling");
    } finally {
      for (const connection of reserved) connection.release();
      await collector.close();
    }
    expect(await runInTransaction(() => db.unsafe("SELECT * FROM strata_outbox_event"))).toEqual(
      [],
    );
  });

  test("tenant publication rolls back atomically and delivery runs with captured RLS scope", async () => {
    const outbox = make(async (event) => {
      expect(currentTenant()?.id).toBe(tenant.id);
      const [settings] = await db.unsafe<{ bypass: string; tenant: string }>(
        "SELECT current_setting('app.bypass_rls', true) AS bypass, current_setting('app.tenant_id', true) AS tenant",
      );
      expect(settings).toEqual({ bypass: "false", tenant: "101" });
      await db.unsafe("INSERT INTO effects VALUES ($1, $2) ON CONFLICT DO NOTHING", [
        event.id,
        tenant.id,
      ]);
      expect(await db.unsafe("SELECT * FROM effects WHERE tenant_id <> $1", [tenant.id])).toEqual(
        [],
      );
    });
    await expect(
      runWithTenantDatabase(tenant, async () => {
        await outbox.publish("order", 1, { id: "rolled-back" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await admin.unsafe<unknown[]>("SELECT * FROM strata_outbox_event")).toEqual([]);
    await runWithTenantDatabase(tenant, () => outbox.publish("order", 1, { id: "committed" }));
    expect(await admin.unsafe<unknown[]>("SELECT * FROM effects")).toEqual([]);
    // Anonymous/current-tenant RLS cannot inspect another tenant's delivery.
    expect(await runInTransaction(() => db.unsafe("SELECT * FROM strata_outbox_event"))).toEqual(
      [],
    );
    await outbox.processNext();
    expect(await admin.unsafe<unknown[]>("SELECT * FROM effects")).toEqual([
      { event_id: "committed", tenant_id: 101 },
    ]);
  });
  test("three workers claim independently; listener retry rolls back its tenant writes", async () => {
    const outbox = make(async (event) => {
      await db.unsafe("INSERT INTO effects VALUES ($1, $2)", [event.id, tenant.id]);
      if (event.id === "retry") throw new Error("redacted");
    });
    for (const id of ["parallel-1", "parallel-2", "retry"])
      await runWithTenantDatabase(tenant, () => outbox.publish("order", 1, { id }));
    await Promise.all([outbox.processNext(), outbox.processNext(), outbox.processNext()]);
    expect((await admin.unsafe<unknown[]>("SELECT * FROM effects ORDER BY event_id")).length).toBe(
      3,
    );
    expect(await admin.unsafe<unknown[]>("SELECT * FROM effects WHERE event_id='retry'")).toEqual(
      [],
    );
    await admin.unsafe(
      "UPDATE strata_outbox_delivery SET status='completed' WHERE event_id='retry'",
    );
  });
  test("process death after an external effect before acknowledgement recovers the same event", async () => {
    const outbox = make(async (event) => {
      await admin.unsafe("INSERT INTO effects VALUES ($1, $2) ON CONFLICT DO NOTHING", [
        event.id,
        tenant.id,
      ]);
    });
    await runWithTenantDatabase(tenant, () =>
      outbox.publish("order", { value: 7 }, { id: "crash" }),
    );
    const proc = Bun.spawn(["bun", "tests/fixtures/outboxCrashWorker.ts"], {
      env: {
        ...process.env,
        OUTBOX_TEST_DATABASE_URL: workerUrl,
        OUTBOX_TEST_ADMIN_URL: adminUrl
          ? (() => {
              const u = new URL(adminUrl);
              u.pathname = `/${database}`;
              return u.toString();
            })()
          : "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const reader = proc.stdout.getReader();
      const result = await Promise.race([
        reader.read(),
        Bun.sleep(5_000).then(() => {
          throw new Error("Worker fixture did not reach acknowledgement boundary.");
        }),
      ]);
      expect(new TextDecoder().decode(result.value)).toContain("EXTERNAL_EFFECT_COMMITTED");
      proc.kill("SIGKILL");
      await proc.exited;
      reader.releaseLock();
      await Bun.sleep(400);
      expect(await outbox.processNext()).toBe(true);
      const [row] = await admin.unsafe<{ status: string; attempts: number }[]>(
        "SELECT status, attempts FROM strata_outbox_delivery WHERE event_id='crash'",
      );
      expect(row).toEqual({ status: "completed", attempts: 2 });
      expect(
        (await admin.unsafe<unknown[]>("SELECT * FROM effects WHERE event_id='crash'")).length,
      ).toBe(1);
    } finally {
      proc.kill("SIGKILL");
      await proc.exited;
    }
    await migration.down(admin);
  }, 10_000);
});

const mysqlUrl = process.env.MYSQL_URL;
describe.skipIf(!mysqlUrl)("outbox on dedicated MySQL fixture", () => {
  let connection: ReturnType<typeof createMysqlConnection>;
  let previous: ReturnType<typeof getBoundDatabaseConnection>;
  let tenancy: string | undefined;
  let owned = false;
  const migration = createOutboxMigration("outbox", "mysql");
  beforeAll(async () => {
    if (!mysqlUrl) throw new Error("Dedicated MySQL URL required.");
    connection = createMysqlConnection(mysqlUrl);
    // Never overwrite or drop existing infrastructure, even on a test server.
    expect(await connection.unsafe("SHOW TABLES LIKE 'strata_outbox_%'")).toEqual([]);
    owned = true;
    await migration.up(connection);
    await migration.up(connection);
    previous = getBoundDatabaseConnection();
    bindDatabaseConnection(connection);
    useSqlDialect("mysql");
    tenancy = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "none";
  });
  afterAll(async () => {
    if (previous) bindDatabaseConnection(previous);
    else resetBoundDatabaseConnection();
    resetSqlDialect();
    restoreEnvVar("TENANCY_DRIVER", tenancy);
    if (owned) {
      await connection.unsafe("DROP TABLE IF EXISTS strata_outbox_delivery");
      await connection.unsafe("DROP TABLE IF EXISTS strata_outbox_event");
    }
    await connection?.close();
  });
  test("case-sensitive IDs, real commits, rollback and concurrent ownership", async () => {
    const seen: string[] = [];
    const outbox = new SqlOutbox({
      listeners: [
        {
          name: "effect",
          event: "order",
          handle: async (event) => {
            seen.push(event.id);
          },
        },
      ],
    });
    await expect(
      runInTransaction(async () => {
        await outbox.publish("order", 1);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await connection.unsafe("SELECT * FROM strata_outbox_event")).toEqual([]);
    for (const id of ["A", "a", "B"])
      await runInTransaction(() => outbox.publish("order", 1, { id }));
    await Promise.all([outbox.processNext(), outbox.processNext(), outbox.processNext()]);
    expect(seen.sort()).toEqual(["A", "B", "a"]);
    expect(await outbox.processNext()).toBe(false);
    await migration.down(connection);
    owned = false;
  });
});
