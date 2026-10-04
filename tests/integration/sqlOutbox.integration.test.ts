import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
import { createOutboxMigration, SqlOutbox } from "@getstrata/core/events/outbox";
import { currentTenant } from "@getstrata/core/tenant/tenantContext";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { SQL } from "bun";
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
