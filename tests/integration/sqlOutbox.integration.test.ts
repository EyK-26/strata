import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";
import { createPersistenceInvocation } from "@getstrata/bootstrap/persistenceInvocation";
import { runOutboxWorkerCommand } from "@getstrata/cli/outboxWorker";
import type { ResourceSpec } from "@getstrata/core/contracts/application";
import { resourceService } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import { createTransactionAcquisitionMetrics } from "@getstrata/core/database/acquisitionMetrics";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type {
  Decision,
  RawPin,
  RawPool,
  RawTransaction,
  SqlStatement,
  Terminal,
} from "@getstrata/core/database/driverPorts";
import { createOwnedReadOnlyObservation } from "@getstrata/core/database/ownedReadOnlyObservation";
import type {
  DatabaseSession,
  TransactionOptions,
  TransactionSession,
} from "@getstrata/core/database/session";
import {
  createOutboxMetricsCollector,
  createOutboxMigration,
  createOutboxWorkerTransport,
  createSqlOutboxBindings,
  type DurableListener,
  type SqlOutbox,
} from "@getstrata/core/events/outbox";
import { createApplication } from "@getstrata/core/runtime/application";
import { currentTenant } from "@getstrata/core/tenant/tenantContext";
import { SQL } from "bun";
import { snapshotQuery } from "../../src/core/events/outbox/metrics";
import { bounded, deferred, pending } from "../fixtures/applicationOwnershipSupport";
import { sessionSql } from "../helpers/nativePersistenceApplication";
import { restoreEnvVar } from "../helpers/restoreEnv";

const adminUrl = process.env.MIGRATION_DATABASE_URL;
const restrictedUrl = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
const tenant = { id: 101, slug: "outbox", plan: "free" as const, region: "eu" as const };

// Kernel execution failures retain native timeout evidence in their causal tree.
function failureErrors(error: unknown): Error[] {
  const seen = new Set<unknown>();
  const visit = (value: unknown): Error[] => {
    if (!(value instanceof Error) || seen.has(value)) return [];
    seen.add(value);
    return [
      value,
      ...visit(value.cause),
      ...(value instanceof AggregateError ? value.errors.flatMap(visit) : []),
    ];
  };
  return visit(error);
}
function failureMessages(error: unknown): string {
  return failureErrors(error)
    .map((value) => value.message)
    .join("\n");
}
async function causalFailure<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    throw new Error(failureMessages(error), { cause: error });
  }
}

describe.skipIf(!adminUrl || !restrictedUrl)("Postgres outbox with restricted-role RLS", () => {
  const database = `outbox_${crypto.randomUUID().replaceAll("-", "")}`;
  let control: SQL;
  let admin: SQL;
  let pool: SQL;
  const nativeAdmission = { statements: 0, checkouts: 0 };
  let application: ReturnType<typeof createApplication>;
  let invoke: ReturnType<typeof createPersistenceInvocation>;
  let outbox: SqlOutbox;
  let handler: DurableListener["handle"] = async () => {};
  let observeReadOnly: ReturnType<typeof createOwnedReadOnlyObservation>;
  const run = <T>(work: (selected: DatabaseSession) => T | Promise<T>) =>
    invoke({ kind: "command" }, ({ database }) => work(database));
  const runInTransaction = <T>(
    work: (selected: TransactionSession) => T | Promise<T>,
    options?: TransactionOptions,
  ) => run((database) => database.transaction(work, options));
  const runWithTenantDatabase = <T>(
    value: typeof tenant,
    work: (selected: TransactionSession) => T | Promise<T>,
  ) =>
    invoke({ kind: "command", tenant: value }, ({ database, policy }) =>
      policy.run(database, { kind: "tenant", tenantId: value.id }, work),
    );
  const runWithMigrationBypass = <T>(work: (selected: TransactionSession) => T | Promise<T>) =>
    invoke(
      { kind: "command", actor: { kind: "system", policy: "integration.operator" } },
      ({ database, policy }) => policy.run(database, { kind: "bypass" }, work),
    );
  const collect = (options: { timeoutMs?: number; sampleLimit?: number } = {}) =>
    createOutboxMetricsCollector({ observeReadOnly, ...options });
  const publish = (
    selected: TransactionSession,
    name: string,
    payload: unknown,
    options: { id?: string } = {},
  ) => outbox.publish(selected, name, payload, { ...options, tenantId: tenant.id });
  // Hold the application's actual native pool, with explicit selected transactions.
  const saturate = async () => {
    const held: { release(): void; done: Promise<void> }[] = [];
    for (let i = 0; i < 8; i++) {
      let release!: () => void;
      let admitted!: () => void;
      const ready = new Promise<void>((resolve) => {
        admitted = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const done = runInTransaction(async (selected) => {
        await selected.execute({ text: "SELECT 1", params: [] });
        admitted();
        await gate;
      });
      held.push({ release, done });
      await ready;
    }
    return held;
  };
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
    const connection = { driver: "pgsql" as const, url: workerUrl, max: 8 };
    const bindings = createSqlOutboxBindings({
      invoke: (input, work) => invoke(input, work),
      connection: "main",
      tenancy: "rls",
      leaseMs: 300,
      resolveTenant: async () => tenant,
      listeners: [
        { name: "effect", event: "order", handle: (event, context) => handler(event, context) },
      ],
    });
    const databaseBindings = createDatabaseBindings({
      default: "main",
      connections: { main: connection },
      preparation: [bindings.token],
    });
    const declaration = databaseBindings.find((item) => item.kind === "resource");
    if (!declaration) throw new Error("Missing original native pool declaration");
    const createPool = declaration.create as (...values: unknown[]) => ResourceSpec<RawPool>;
    const observeTransaction = (raw: RawTransaction): RawTransaction => ({
      execute: <R>(statement: SqlStatement) => {
        nativeAdmission.statements++;
        return raw.execute<R>(statement);
      },
      savepoint: (work) => raw.savepoint((child) => work(observeTransaction(child))),
    });
    const observePin = (raw: RawPin): RawPin => ({
      begin: (work) => raw.begin((child) => work(observeTransaction(child))),
      release: () => raw.release(),
      discard: () => raw.discard(),
    });
    application = createApplication({
      providers: [],
      services: [...databaseBindings, ...bindings.services],
      overrides: [
        resourceService(declaration.token as ServiceToken<RawPool>, {
          lifetime: "application",
          dependencies: declaration.dependencies,
          create: (...values) => {
            const descriptor = createPool(...values);
            return {
              ...descriptor,
              open: async (signal) => {
                const result = await descriptor.open(signal);
                if (!result.ok) return result;
                const raw = result.value;
                return {
                  ok: true as const,
                  value: {
                    dialect: raw.dialect,
                    capabilities: raw.capabilities,
                    execute: <R>(statement: SqlStatement) => {
                      nativeAdmission.statements++;
                      return raw.execute<R>(statement);
                    },
                    checkout: async (options) => {
                      nativeAdmission.checkouts++;
                      const result = await raw.checkout(options);
                      return result.ok
                        ? { ok: true as const, value: observePin(result.value) }
                        : result;
                    },
                    close: () => raw.close(),
                  },
                };
              },
            };
          },
        }),
      ],
    });
    await application.start();
    invoke = createPersistenceInvocation(application, "main");
    outbox = await application.run((scope) => scope.resolve(bindings.token));
    observeReadOnly = createOwnedReadOnlyObservation(application, "main", connection, {
      postgresPolicy: "bypass",
    });
  });
  afterAll(async () => {
    if (application) expect((await application.stop()).successful).toBe(true);
    await pool?.close();
    await admin?.close();
    if (created) await control.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
    await control?.close();
  });
  const make = (handle: DurableListener["handle"]) => {
    handler = handle;
    return outbox;
  };
  test("platform observations are bounded, read-only and restore restricted-role scope", async () => {
    const collector = collect({ sampleLimit: 2 });
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
          const code = `
          import {createDatabaseBindings} from ${JSON.stringify(new URL("database/bindings.ts", base).pathname)};
          import {createApplication} from ${JSON.stringify(new URL("runtime/application.ts", base).pathname)};
          import {createOwnedReadOnlyObservation} from ${JSON.stringify(new URL("database/ownedReadOnlyObservation.ts", base).pathname)};
          import {createOutboxMetricsCollector} from ${JSON.stringify(new URL("events/outbox/index.ts", base).pathname)};
          const connection={driver:"pgsql",url:process.env.OUTBOX_TEST_DATABASE_URL,max:2};
          const app=createApplication({providers:[],services:createDatabaseBindings({default:"main",connections:{main:connection}})});
          await app.start();
          const collector=createOutboxMetricsCollector({sampleLimit:2,observeReadOnly:createOwnedReadOnlyObservation(app,"main",connection,{postgresPolicy:"bypass"})});
          try { console.log(JSON.stringify((await collector.collect()).states.map(({state,count,capped})=>({state,count,capped})))); }
          finally { await collector.close(); const result=await app.stop(); if(!result.successful)throw Error("Unclean observation shutdown"); }`;
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
        await runInTransaction((selected) =>
          sessionSql(selected).unsafe("SELECT * FROM strata_outbox_event WHERE id='metrics'"),
        ),
      ).toEqual([]);
      const [settings] = await run((database) =>
        sessionSql(database).unsafe<{ timeout: string; bypass: string | null }>(
          "SELECT current_setting('statement_timeout') AS timeout, current_setting('app.bypass_rls', true) AS bypass",
        ),
      );
      expect(settings?.timeout).toBe("0");
      expect(settings?.bypass === "true").toBe(false);
      await runInTransaction(async (selected) => {
        const deny = async () => {
          const before = { ...nativeAdmission };
          await expect(outbox.processNext()).rejects.toThrow("outside business transactions");
          await expect(collector.collect()).rejects.toThrow("independent transaction");
          expect(nativeAdmission).toEqual(before);
        };
        await deny();
        await selected.transaction(async (nested) => {
          await deny();
          await nested.execute({ text: "SELECT 1", params: [] });
        });
        await deny();
      });
      const afterTransaction = await collector.collect();
      expect(afterTransaction.states.map(({ state, count }) => ({ state, count }))).toEqual(
        snapshot.states.map(({ state, count }) => ({ state, count })),
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
      const plans = await runWithMigrationBypass((selected) =>
        sessionSql(selected).unsafe<{ "QUERY PLAN": unknown }>(
          `EXPLAIN (ANALYZE, FORMAT JSON) ${snapshotQuery}`,
          [3],
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
    const collector = collect({ timeoutMs: 100 });
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
    const recovered = collect();
    try {
      expect((await recovered.collect()).states.every((row) => row.count === 0)).toBe(true);
    } finally {
      await recovered.close();
    }
  });

  test("pool checkout timeout does not multiply pending transactions", async () => {
    const reserved = await saturate();
    const collector = collect({ timeoutMs: 50 });
    try {
      await expect(causalFailure(collector.collect())).rejects.toThrow("timed out");
      await Bun.sleep(10);
      await expect(causalFailure(collector.collect())).rejects.toThrow("timed out");
    } finally {
      for (const connection of reserved) connection.release();
      await Promise.all(reserved.map((connection) => connection.done));
      await collector.close();
    }
    expect(
      await runInTransaction((selected) =>
        sessionSql(selected).unsafe("SELECT * FROM strata_outbox_event"),
      ),
    ).toEqual([]);
  });

  test("native transaction acquisition cancellation never admits a late callback", async () => {
    const reserved = await saturate();
    let admissions = 0;
    const metrics = createTransactionAcquisitionMetrics();
    try {
      await expect(
        runInTransaction(
          async () => {
            admissions++;
          },
          { acquisitionSignal: AbortSignal.timeout(50), acquisitionMetrics: metrics },
        ),
      ).rejects.toThrow();
    } finally {
      for (const connection of reserved) connection.release();
      await Promise.all(reserved.map((connection) => connection.done));
    }
    await Bun.sleep(20);
    expect(admissions).toBe(0);
    expect(metrics.snapshot().inflight).toBe(0);
    expect(metrics.snapshot().outcomes[2]?.count).toBe(1);
    expect(metrics.snapshot().outcomes[2]?.sumSeconds).toBeGreaterThan(0.03);
    await runInTransaction(
      async (selected) => {
        const connection = sessionSql(selected);
        const [direct] = await connection.unsafe<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        const [repository] = await sessionSql(selected).unsafe<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        );
        expect(direct?.pid).toBe(repository?.pid);
      },
      { acquisitionSignal: new AbortController().signal },
    );
  });

  test("native acquisition measures a saturated pool wait and keeps restricted-role tenant scopes", async () => {
    const reserved = await saturate();
    const metrics = createTransactionAcquisitionMetrics();
    const operation = invoke({ kind: "command", tenant }, ({ database, policy }) =>
      database.transaction(
        async (selected) => {
          const observed = metrics.snapshot();
          expect(observed.inflight).toBe(0);
          expect(observed.outcomes[0]?.count).toBe(1);
          expect(observed.outcomes[0]?.sumSeconds).toBeGreaterThan(0.025);
          await policy.run(selected, { kind: "tenant", tenantId: tenant.id }, async (scoped) => {
            const db = sessionSql(scoped);
            const [settings] = await db.unsafe<{ bypass: string; tenant: string }>(
              "SELECT current_setting('app.bypass_rls', true) AS bypass, current_setting('app.tenant_id', true) AS tenant",
            );
            expect(settings).toEqual({ bypass: "false", tenant: "101" });
            await scoped.transaction((child) => sessionSql(child).unsafe("SELECT 1"));
            await Bun.sleep(20);
          });
          expect(metrics.snapshot()).toEqual(observed);
        },
        { acquisitionMetrics: metrics },
      ),
    );
    // Invocation admission is asynchronous; wait until native acquisition starts.
    for (let i = 0; i < 100 && metrics.snapshot().inflight === 0; i++) await Bun.sleep(1);
    expect(metrics.snapshot().inflight).toBe(1);
    const release = setTimeout(() => {
      reserved[0]?.release();
    }, 40);
    try {
      await operation;
    } finally {
      clearTimeout(release);
      for (const connection of reserved) connection.release();
      await Promise.all(reserved.map((connection) => connection.done));
    }
    expect(metrics.snapshot().inflight).toBe(0);
    expect(metrics.snapshot().outcomes.map((state) => state.count)).toEqual([1, 0, 0]);
    expect(
      await runInTransaction((selected) =>
        sessionSql(selected).unsafe("SELECT * FROM strata_outbox_event"),
      ),
    ).toEqual([]);
  });

  test("managed configured worker preserves tenant extensions and restricted-role RLS", async () => {
    const id = "managed-configured";
    let observed: unknown;
    let managed!: ReturnType<typeof createApplication>;
    const bindings = createSqlOutboxBindings({
      connection: "main",
      tenancy: "rls",
      leaseMs: 300,
      invoke: (input, work) => createPersistenceInvocation(managed, "main")(input, work),
      resolveTenant: async () => tenant,
      listeners: [
        {
          name: "effect",
          event: "order",
          async handle(event, { database }) {
            const db = sessionSql(database);
            observed = currentTenant();
            const [scope] = await db.unsafe<{ tenant_id: string }>(
              "SELECT current_setting('app.tenant_id') AS tenant_id",
            );
            expect(scope?.tenant_id).toBe("101");
            await db.unsafe("INSERT INTO effects VALUES ($1, $2)", [event.id, 101]);
          },
        },
      ],
    });
    const worker = createOutboxWorkerTransport(bindings.token);
    managed = createApplication({
      providers: [],
      services: [
        ...createDatabaseBindings({
          default: "main",
          connections: { main: { driver: "pgsql", url: workerUrl, max: 8 } },
          preparation: [bindings.token],
        }),
        ...bindings.services,
      ],
      transports: [worker.transport],
    });
    await managed.start();
    const publisher = make(async () => {});
    await runWithTenantDatabase(tenant, (selected) =>
      publisher.publish(selected, "order", {}, { id, tenantId: tenant.id }),
    );
    const running = runOutboxWorkerCommand({
      boot: () => ({ application: managed, outboxWorker: worker }),
    });
    try {
      const start = Date.now();
      for (;;) {
        const [delivery] = await admin.unsafe<{ status: string }[]>(
          "SELECT status FROM strata_outbox_delivery WHERE event_id=$1",
          [id],
        );
        if (delivery?.status === "completed") break;
        if (Date.now() - start > 2000) throw new Error("Managed delivery did not complete");
        await Bun.sleep(10);
      }
      expect(observed).toEqual(tenant);
      expect(await pool.unsafe("SELECT * FROM effects WHERE event_id=$1", [id])).toEqual([]);
      await runWithTenantDatabase(tenant, async (selected) => {
        const db = sessionSql(selected);
        expect(await db.unsafe("SELECT * FROM effects WHERE event_id=$1", [id])).toEqual([
          { event_id: id, tenant_id: 101 },
        ]);
      });
    } finally {
      await worker.stop();
      await running;
      await admin.unsafe("DELETE FROM effects WHERE event_id=$1", [id]);
      await admin.unsafe("DELETE FROM strata_outbox_event WHERE id=$1", [id]);
    }
  });

  test("tenant publication rolls back atomically and delivery runs with captured RLS scope", async () => {
    const outbox = make(async (event, { database }) => {
      const db = sessionSql(database);
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
      runWithTenantDatabase(tenant, async (selected) => {
        await publish(selected, "order", 1, { id: "rolled-back" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(Array.from(await admin.unsafe<unknown[]>("SELECT * FROM strata_outbox_event"))).toEqual(
      [],
    );
    await runWithTenantDatabase(tenant, (selected) =>
      publish(selected, "order", 1, { id: "committed" }),
    );
    expect(Array.from(await admin.unsafe<unknown[]>("SELECT * FROM effects"))).toEqual([]);
    // Anonymous/current-tenant RLS cannot inspect another tenant's delivery.
    expect(
      await runInTransaction((selected) =>
        sessionSql(selected).unsafe("SELECT * FROM strata_outbox_event"),
      ),
    ).toEqual([]);
    await outbox.processNext();
    expect(Array.from(await admin.unsafe<unknown[]>("SELECT * FROM effects"))).toEqual([
      { event_id: "committed", tenant_id: 101 },
    ]);
  });
  test("public delivery inspection retains caller RLS and explicit operator bypass", async () => {
    const outbox = make(async () => {});
    const id = "inspection-private";
    try {
      await runWithTenantDatabase(tenant, (selected) =>
        publish(selected, "order", { secret: "not-in-snapshot" }, { id }),
      );
      expect(
        await runWithTenantDatabase(tenant, (selected) =>
          outbox.getDelivery(selected, id, "effect"),
        ),
      ).toEqual({
        status: "pending",
        attempts: 0,
        maxAttempts: 5,
      });
      expect(
        await runWithTenantDatabase({ ...tenant, id: 102 }, (selected) =>
          outbox.getDelivery(selected, id, "effect"),
        ),
      ).toBeNull();
      expect(
        await runInTransaction((selected) => outbox.getDelivery(selected, id, "effect")),
      ).toBeNull();
      expect(
        await runWithMigrationBypass((selected) => outbox.getDelivery(selected, id, "effect")),
      ).toEqual({
        status: "pending",
        attempts: 0,
        maxAttempts: 5,
      });
      await runWithTenantDatabase(tenant, async (selected) => {
        const db = sessionSql(selected);
        await outbox.getDelivery(selected, id, "effect");
        const [settings] = await db.unsafe<{ bypass: string }>(
          "SELECT current_setting('app.bypass_rls', true) AS bypass",
        );
        expect(settings?.bypass).toBe("false");
      });
    } finally {
      await admin.unsafe("DELETE FROM strata_outbox_event WHERE id=$1", [id]);
    }
  });
  test("three workers claim independently; listener retry rolls back its tenant writes", async () => {
    const outbox = make(async (event, { database }) => {
      const db = sessionSql(database);
      await db.unsafe("INSERT INTO effects VALUES ($1, $2)", [event.id, tenant.id]);
      if (event.id === "retry") throw new Error("redacted");
    });
    for (const id of ["parallel-1", "parallel-2", "retry"])
      await runWithTenantDatabase(tenant, (selected) => publish(selected, "order", 1, { id }));
    await Promise.all([outbox.processNext(), outbox.processNext(), outbox.processNext()]);
    expect((await admin.unsafe<unknown[]>("SELECT * FROM effects ORDER BY event_id")).length).toBe(
      3,
    );
    expect(
      Array.from(await admin.unsafe<unknown[]>("SELECT * FROM effects WHERE event_id='retry'")),
    ).toEqual([]);
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
    await runWithTenantDatabase(tenant, (selected) =>
      publish(selected, "order", { value: 7 }, { id: "crash" }),
    );
    const proc = Bun.spawn(
      [process.execPath, "--no-env-file", "tests/fixtures/outboxCrashWorker.ts"],
      {
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
      },
    );
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
      expect(
        Array.from(
          await admin.unsafe<{ event_id: string; tenant_id: number }[]>(
            "SELECT event_id, tenant_id FROM effects WHERE event_id='crash'",
          ),
        ),
      ).toEqual([{ event_id: "crash", tenant_id: tenant.id }]);
      const [interrupted] = await admin.unsafe<{ status: string; attempts: number }[]>(
        "SELECT status, attempts FROM strata_outbox_delivery WHERE event_id='crash'",
      );
      expect(interrupted).toEqual({ status: "processing", attempts: 1 });
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
  let application: ReturnType<typeof createApplication>;
  let invoke: ReturnType<typeof createPersistenceInvocation>;
  let outbox: SqlOutbox;
  let owned = false;
  const seen: string[] = [];
  const migration = createOutboxMigration("outbox", "mysql");
  const run = <T>(work: (database: DatabaseSession) => T | Promise<T>) =>
    invoke({ kind: "command" }, ({ database }) => work(database));
  beforeAll(async () => {
    if (!mysqlUrl) throw new Error("Dedicated MySQL URL required.");
    const bindings = createSqlOutboxBindings({
      invoke: (input, work) => invoke(input, work),
      connection: "main",
      tenancy: "none",
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
    application = createApplication({
      providers: [],
      services: [
        ...createDatabaseBindings({
          default: "main",
          connections: { main: { driver: "mysql", url: mysqlUrl, max: 8 } },
          preparation: [bindings.token],
        }),
        ...bindings.services,
      ],
    });
    await application.start();
    invoke = createPersistenceInvocation(application, "main");
    outbox = await application.run((scope) => scope.resolve(bindings.token));
    // Never overwrite or drop existing infrastructure, even on a test server.
    expect(
      await run((database) => sessionSql(database).unsafe("SHOW TABLES LIKE 'strata_outbox_%'")),
    ).toEqual([]);
    owned = true;
    await run((database) => migration.up(sessionSql(database)));
    await run((database) => migration.up(sessionSql(database)));
  });
  afterAll(async () => {
    try {
      if (owned)
        await run(async (database) => {
          await sessionSql(database).unsafe("DROP TABLE IF EXISTS strata_outbox_delivery");
          await sessionSql(database).unsafe("DROP TABLE IF EXISTS strata_outbox_event");
        });
    } finally {
      if (application) expect((await application.stop()).successful).toBe(true);
    }
  });
  test("case-sensitive IDs, real commits, rollback and concurrent ownership", async () => {
    await expect(
      run((database) =>
        database.transaction(async (selected) => {
          await outbox.publish(selected, "order", 1, { tenantId: null });
          throw new Error("rollback");
        }),
      ),
    ).rejects.toThrow("rollback");
    expect(
      await run((database) => sessionSql(database).unsafe("SELECT * FROM strata_outbox_event")),
    ).toEqual([]);
    for (const id of ["A", "a", "B"])
      await run((database) =>
        database.transaction((selected) =>
          outbox.publish(selected, "order", 1, { id, tenantId: null }),
        ),
      );
    await Promise.all([outbox.processNext(), outbox.processNext(), outbox.processNext()]);
    expect(seen.sort()).toEqual(["A", "B", "a"]);
    expect(await run((selected) => outbox.getDelivery(selected, "A", "effect"))).toEqual({
      status: "completed",
      attempts: 1,
      maxAttempts: 5,
    });
    expect(await run((selected) => outbox.getDelivery(selected, "missing", "effect"))).toBeNull();
    expect(await outbox.processNext()).toBe(false);
    await run((database) => migration.down(sessionSql(database)));
    owned = false;
  });
});

for (const fault of [false, true]) {
  test.skipIf(!adminUrl || !restrictedUrl)(
    `native admitted outbox finish remains joined during application stop; trigger failure=${fault}`,
    async () => {
      if (!adminUrl || !restrictedUrl)
        throw new Error("Dedicated PostgreSQL credentials required.");
      const name = `finish_${crypto.randomUUID().replaceAll("-", "")}`;
      const control = new SQL(adminUrl);
      let admin: SQL | undefined;
      let application: ReturnType<typeof createApplication> | undefined;
      let originalPool: RawPool | undefined;
      let poolCloses = 0;
      let operatorCloses = 0;
      let created = false;
      let removed = false;
      let running: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
      let completion: typeof running;
      let stopping: ReturnType<ReturnType<typeof createApplication>["stop"]> | undefined;
      let locking: Promise<unknown> | undefined;
      const entered = deferred();
      const releaseListener = deferred();
      const locked = deferred<number>();
      const releaseLock = deferred();
      const marker = "OUTBOX_FINISH_NATIVE_SENTINEL";
      const eventId = "a-admitted-finish";
      const successorId = "z-unadmitted-successor";
      const observations: Record<string, unknown> = { fault };
      const finishTerminals: Terminal<unknown>[] = [];
      const finishSql: Array<{ ok: boolean; error?: unknown }> = [];
      const finishDisposals: Array<{ operation: string; ok: boolean }> = [];
      const errors: unknown[] = [];
      const startedAt = performance.now();
      try {
        await control.unsafe(`CREATE DATABASE ${name}`);
        created = true;
        const ownerUrl = new URL(adminUrl);
        ownerUrl.pathname = `/${name}`;
        const runtimeUrl = new URL(restrictedUrl);
        runtimeUrl.pathname = `/${name}`;
        admin = new SQL(ownerUrl.toString());
        const bindings = createSqlOutboxBindings({
          connection: "main",
          tenancy: "rls",
          leaseMs: 60_000,
          invoke: (input, work) => {
            if (!application) throw new Error("Missing original application.");
            return createPersistenceInvocation(application, "main")(input, work);
          },
          resolveTenant: async () => tenant,
          listeners: [
            {
              name: "finish-proof",
              event: "finish.created",
              async handle(event, { database }) {
                expect(event.id).toBe(eventId);
                await database.execute({ text: "SELECT 1", params: [] });
                entered.resolve();
                await releaseListener.promise;
              },
            },
          ],
        });
        const worker = createOutboxWorkerTransport(bindings.token, { pollMs: 10 });
        const database = createDatabaseBindings({
          default: "main",
          connections: {
            main: { driver: "pgsql", url: runtimeUrl.toString(), max: 3 },
          },
          preparation: [bindings.token],
        });
        const pool = database.find((declaration) => declaration.kind === "resource");
        if (pool?.kind !== "resource") throw new Error("Missing original native pool resource.");
        application = createApplication({
          providers: [],
          services: [...database, ...bindings.services],
          transports: [worker.transport],
          overrides: [
            resourceService(pool.token as ServiceToken<RawPool>, {
              lifetime: "application",
              dependencies: pool.dependencies,
              create: (...dependencies) => {
                const descriptor = pool.create(
                  ...(dependencies as never[]),
                ) as ResourceSpec<RawPool>;
                return {
                  ...descriptor,
                  async open(signal) {
                    const opened = await descriptor.open(signal);
                    if (!opened.ok) return opened;
                    const native = opened.value;
                    originalPool = native;
                    return {
                      ok: true as const,
                      value: {
                        dialect: native.dialect,
                        capabilities: native.capabilities,
                        execute: native.execute.bind(native),
                        close: native.close.bind(native),
                        async checkout(options) {
                          const acquired = await native.checkout(options);
                          if (!acquired.ok) return acquired;
                          const pin = acquired.value;
                          let finishing = false;
                          const observe = (transaction: RawTransaction): RawTransaction => ({
                            async execute<Row>(statement: SqlStatement) {
                              const isFinish =
                                statement.text.startsWith(
                                  "UPDATE strata_outbox_delivery SET status =",
                                ) && statement.text.includes("completed_at");
                              if (isFinish) finishing = true;
                              try {
                                const rows = await transaction.execute<Row>(statement);
                                if (isFinish) finishSql.push({ ok: true });
                                return rows;
                              } catch (error) {
                                if (isFinish) finishSql.push({ ok: false, error });
                                throw error;
                              }
                            },
                            savepoint: (work) =>
                              transaction.savepoint((child) => work(observe(child))),
                          });
                          return {
                            ok: true as const,
                            value: {
                              async begin<R>(
                                work: (transaction: RawTransaction) => Promise<Decision<R>>,
                              ) {
                                const terminal = await pin.begin<R>((transaction) =>
                                  work(observe(transaction)),
                                );
                                if (finishing) finishTerminals.push(terminal);
                                return terminal;
                              },
                              async release() {
                                const ack = await pin.release();
                                if (finishing)
                                  finishDisposals.push({ operation: "release", ok: ack.ok });
                                return ack;
                              },
                              async discard() {
                                const ack = await pin.discard();
                                if (finishing)
                                  finishDisposals.push({ operation: "discard", ok: ack.ok });
                                return ack;
                              },
                            },
                          };
                        },
                      } satisfies RawPool,
                    };
                  },
                  async close(native, context) {
                    poolCloses++;
                    await descriptor.close?.(native, context);
                  },
                };
              },
            }),
          ],
        });
        await application.start();
        const invoke = createPersistenceInvocation(application, "main");
        const [role] = await invoke({ kind: "command" }, ({ database }) =>
          database.execute<{
            role: string;
            rolsuper: boolean;
            rolbypassrls: boolean;
          }>({
            text: "SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
            params: [],
          }),
        );
        if (!role || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(role.role))
          throw new Error("Invalid runtime role.");
        expect(role.rolsuper).toBe(false);
        expect(role.rolbypassrls).toBe(false);
        await createOutboxMigration("finish-proof", "pgsql", { rls: true }).up(admin);
        await admin.unsafe(
          `GRANT SELECT,INSERT,UPDATE ON strata_outbox_event,strata_outbox_delivery TO "${role.role}"`,
        );
        if (fault)
          await admin.unsafe(`CREATE FUNCTION finish_fault() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.status='completed' AND NEW.event_id='${eventId}' THEN
          RAISE EXCEPTION '${marker}' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER finish_fault BEFORE UPDATE ON strata_outbox_delivery FOR EACH ROW EXECUTE FUNCTION finish_fault()`);
        const outbox = await application.run((scope) => scope.resolve(bindings.token));
        for (const id of [eventId, successorId])
          await invoke({ kind: "command", tenant }, ({ database, policy }) =>
            policy.run(database, { kind: "tenant", tenantId: tenant.id }, (selected) =>
              outbox.publish(selected, "finish.created", {}, { tenantId: tenant.id, id }),
            ),
          );
        const observe = (work: Promise<void>) =>
          work.then(
            () => ({ ok: true as const }),
            (error: unknown) => ({ ok: false as const, error }),
          );
        running = observe(worker.start());
        completion = observe(worker.completion);
        await bounded(entered.promise, "actual native listener entry", 3000);
        expect(
          await invoke({ kind: "command", tenant }, ({ database, policy }) =>
            policy.run(database, { kind: "tenant", tenantId: tenant.id }, (selected) =>
              outbox.getDelivery(selected, eventId, "finish-proof"),
            ),
          ),
        ).toEqual({ status: "processing", attempts: 1, maxAttempts: 5 });
        const inspection = admin;
        locking = inspection.begin(async (transaction) => {
          const [row] = await transaction.unsafe<{ pid: number }[]>(
            "SELECT pg_backend_pid() AS pid FROM strata_outbox_delivery WHERE event_id=$1 FOR UPDATE",
            [eventId],
          );
          if (!row) throw new Error("Missing claimed delivery row to lock.");
          locked.resolve(row.pid);
          await releaseLock.promise;
        });
        const holderPid = await bounded(locked.promise, "actual admin row lock", 3000);
        releaseListener.resolve();
        type Blocked = {
          pid: number;
          datname: string;
          usename: string;
          wait_event_type: string;
          query: string;
          blockers: number[];
        };
        let blocked: Blocked | undefined;
        const deadline = performance.now() + 3000;
        while (!blocked && performance.now() < deadline) {
          const rows = await inspection.unsafe<Blocked[]>(
            "SELECT pid,datname,usename,wait_event_type,query,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname=$1 AND usename=$2 AND state='active' AND wait_event_type='Lock' AND query LIKE 'UPDATE strata_outbox_delivery SET status =%completed_at%'",
            [name, role.role],
          );
          blocked = rows.find((row) => row.blockers.includes(holderPid));
          if (!blocked) await Bun.sleep(5);
        }
        expect(blocked).toBeDefined();
        if (!blocked)
          throw new Error("Actual finish UPDATE never blocked on the owned delivery row.");
        expect(blocked.pid).not.toBe(holderPid);
        expect(blocked.datname).toBe(name);
        expect(blocked.usename).toBe(role.role);
        expect(blocked.wait_event_type).toBe("Lock");
        expect(blocked.query).toContain("lease_token");
        observations.admission = {
          ...blocked,
          holderPid,
          elapsedMs: performance.now() - startedAt,
        };
        const stopAt = performance.now();
        stopping = application.stop();
        await pending(stopping);
        await pending(running);
        await pending(completion);
        expect(poolCloses).toBe(0);
        const [stillBlocked] = await inspection.unsafe<
          { pid: number; wait_event_type: string; blockers: number[] }[]
        >(
          "SELECT pid,wait_event_type,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=$1 AND datname=$2 AND usename=$3",
          [blocked.pid, name, role.role],
        );
        expect(stillBlocked?.wait_event_type).toBe("Lock");
        expect(stillBlocked?.blockers).toContain(holderPid);
        await pending(stopping);
        await pending(running);
        await pending(completion);
        expect(poolCloses).toBe(0);
        await expect(invoke({ kind: "command" }, async () => {})).rejects.toThrow();
        expect(
          (
            await inspection.unsafe<{ status: string; attempts: number }[]>(
              "SELECT status,attempts FROM strata_outbox_delivery WHERE event_id=$1",
              [successorId],
            )
          )[0],
        ).toEqual({ status: "pending", attempts: 0 });
        releaseLock.resolve();
        await bounded(locking, "native lock transaction release", 3000);
        const stopped = await bounded(
          stopping,
          "application stop after admitted finish settles",
          5000,
        );
        const outcome = await bounded(running, "worker actual native finish settlement", 3000);
        const completed = await bounded(
          completion,
          "worker completion native finish settlement",
          3000,
        );
        const [delivery] = await inspection.unsafe<
          { status: string; attempts: number; completed_at: number | null }[]
        >("SELECT status,attempts,completed_at FROM strata_outbox_delivery WHERE event_id=$1", [
          eventId,
        ]);
        observations.settlement = {
          elapsedMs: performance.now() - stopAt,
          successful: stopped.successful,
          retained: stopped.snapshot.retainedResources,
          worker: outcome.ok,
          completion: completed.ok,
          errors: stopped.snapshot.errors.map((entry) => failureMessages(entry.error)),
          delivery,
          poolCloses,
        };
        expect(finishTerminals).toHaveLength(1);
        expect(finishTerminals[0]?.data).toBe("rolled-back");
        expect(finishTerminals[0]?.nativeState).toBe("idle");
        expect(
          finishTerminals[0]?.phases.some(
            (phase) => phase.phase === "rollback" && phase.acknowledgement === "confirmed-reply",
          ),
        ).toBe(true);
        expect(finishDisposals).toEqual([{ operation: "release", ok: true }]);
        expect(finishSql).toHaveLength(1);
        observations.native = {
          terminals: finishTerminals.map((terminal) => ({
            data: terminal.data,
            nativeState: terminal.nativeState,
            phases: terminal.phases.map((phase) => ({
              phase: phase.phase,
              acknowledgement: phase.acknowledgement,
            })),
          })),
          sql: finishSql.map((result) => ({
            ok: result.ok,
            errors: result.error ? failureMessages(result.error) : "",
          })),
          disposals: finishDisposals,
        };
        if (fault) {
          expect(outcome.ok).toBe(false);
          expect(completed.ok).toBe(false);
          if (outcome.ok || completed.ok)
            throw new Error("Independent native finish failure was normalized by stop.");
          expect(finishSql[0]?.ok).toBe(false);
          const nativeFailure = failureErrors(finishSql[0]?.error).find(
            (error) =>
              error.message === marker && (error as Error & { errno?: string }).errno === "P0001",
          );
          expect(nativeFailure).toBeDefined();
          if (!nativeFailure) throw new Error("Missing actual native trigger failure.");
          expect(failureErrors(outcome.error)).toContain(nativeFailure);
          expect(failureErrors(completed.error)).toContain(nativeFailure);
          expect(
            stopped.snapshot.errors.some((entry) =>
              failureErrors(entry.error).includes(nativeFailure),
            ),
          ).toBe(true);
          expect(stopped.successful).toBe(false);
          expect(
            stopped.snapshot.errors.some((entry) => failureMessages(entry.error).includes(marker)),
          ).toBe(true);
          expect(stopped.snapshot.retainedResources.length).toBeGreaterThan(0);
          expect(poolCloses).toBe(0);
          expect(delivery).toEqual({ status: "processing", attempts: 1, completed_at: null });
        } else {
          expect(outcome.ok).toBe(true);
          expect(completed.ok).toBe(true);
          expect(stopped.successful).toBe(true);
          expect(stopped.snapshot.retainedResources).toEqual([]);
          expect(poolCloses).toBe(1);
          expect(finishSql[0]?.ok).toBe(true);
          expect(delivery).toEqual({ status: "processing", attempts: 1, completed_at: null });
        }
        expect(
          (
            await inspection.unsafe<{ status: string; attempts: number }[]>(
              "SELECT status,attempts FROM strata_outbox_delivery WHERE event_id=$1",
              [successorId],
            )
          )[0],
        ).toEqual({ status: "pending", attempts: 0 });
      } catch (error) {
        errors.push(error);
      } finally {
        releaseListener.resolve();
        releaseLock.resolve();
        try {
          if (locking) await bounded(locking, "fixture lock cleanup", 5000);
        } catch (error) {
          errors.push(error);
        }
        try {
          if (application) await bounded(application.stop(), "fixture application cleanup", 5000);
          await Promise.all([running, completion]);
          if (originalPool && poolCloses === 0) {
            await originalPool.close();
            operatorCloses++;
          }
        } catch (error) {
          errors.push(error);
        }
        try {
          await admin?.close();
        } catch (error) {
          errors.push(error);
        }
        try {
          if (created) {
            await control.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
            expect(
              await control.unsafe("SELECT datname FROM pg_database WHERE datname=$1", [name]),
            ).toHaveLength(0);
            removed = true;
          }
        } catch (error) {
          errors.push(error);
        }
        try {
          await control.close();
        } catch (error) {
          errors.push(error);
        }
        console.log(
          "[native-finish-proof]",
          JSON.stringify({
            ...observations,
            poolCloses,
            operatorCloses,
            fixtureDatabaseRemoved: removed,
          }),
        );
      }
      if (errors.length)
        throw new AggregateError(errors, "Native finish proof or fixture cleanup failed.");
    },
    15_000,
  );
}
