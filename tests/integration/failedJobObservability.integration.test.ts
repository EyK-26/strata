import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createMetricsRoutes, createMetricsRuntime } from "@getstrata/bootstrap/metricsRoutes";
import { PersistenceError } from "@getstrata/core/database/errors";
import {
  createOwnedReadOnlyObservation,
  type ReadOnlyObservation,
} from "@getstrata/core/database/ownedReadOnlyObservation";
import { buildSelectQuery } from "@getstrata/core/database/query";
import { Schema } from "@getstrata/core/database/schema";
import { dialectFor } from "@getstrata/core/database/sqlDialects";
import { createOutboxMetricsCollector, createOutboxMigration } from "@getstrata/core/events/outbox";
import {
  createFailedJobMetricsCollector,
  renderFailedJobMetrics,
} from "@getstrata/core/queue/queueMetrics";
import { SQL } from "bun";
import { failedJobTable } from "../../src/core/queue/failedJobTable";
import { createNativePersistenceApplication } from "../helpers/nativePersistenceApplication";
import { restoreEnvVar } from "../helpers/restoreEnv";

const adminUrl = process.env.MIGRATION_DATABASE_URL;
const restrictedUrl = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
describe.skipIf(!adminUrl || !restrictedUrl)("bounded Postgres failed-job observations", () => {
  const database = `failed_metrics_${crypto.randomUUID().replaceAll("-", "")}`;
  let control: SQL;
  let admin: SQL;
  let pool: SQL;
  let workerUrl: string;
  let native: Awaited<ReturnType<typeof createNativePersistenceApplication>>;
  let observeReadOnly: ReadOnlyObservation;
  let created = false;
  beforeAll(async () => {
    if (!adminUrl || !restrictedUrl) throw new Error("Dedicated database credentials required.");
    control = new SQL(adminUrl);
    await control.unsafe(`CREATE DATABASE ${database}`);
    created = true;
    const a = new URL(adminUrl);
    a.pathname = `/${database}`;
    const r = new URL(restrictedUrl);
    r.pathname = `/${database}`;
    workerUrl = r.toString();
    admin = new SQL(a.toString());
    pool = new SQL({ url: workerUrl, max: 2 });
    const [role] = await pool.unsafe<{ role: string; rolsuper: boolean; rolbypassrls: boolean }[]>(
      "SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user",
    );
    if (!role || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(role.role)) throw new Error("Invalid role.");
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
    await Schema.run(admin, "pgsql", (schema) => {
      schema.create("failed_job", (table) => {
        table.id();
        table.string("job_name");
        table.text("job_id").nullable();
        table.jsonb("payload");
        table.text("exception");
        table.timestamp("failed_at").defaultRaw("NOW()");
      });
    });
    await admin.unsafe(`GRANT SELECT ON failed_job TO "${role.role}"`);
    const configured = { driver: "pgsql" as const, url: workerUrl, max: 2 };
    native = await createNativePersistenceApplication({
      default: "test",
      connections: { test: configured },
    });
    observeReadOnly = createOwnedReadOnlyObservation(native.application, "test", configured);
  });
  afterAll(async () => {
    await native?.close();
    await pool?.close();
    await admin?.close();
    if (created) await control.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
    await control?.close();
  });

  test("empty, capped and recovered counts preserve private source records and use the primary index", async () => {
    const collector = createFailedJobMetricsCollector({ observeReadOnly, sampleLimit: 2 });
    try {
      expect(await collector.collect()).toEqual({ sampleLimit: 2, count: 0, capped: false });
      // Large performance fixture only: ordinary collection itself uses the repository projection.
      await admin.unsafe(
        "INSERT INTO failed_job(job_name,payload,exception) SELECT 'private-job', '{\"secret\":\"private-payload\"}'::jsonb, 'private-exception' FROM generate_series(1,20000)",
      );
      await admin.unsafe("ANALYZE failed_job");
      const snapshot = await collector.collect();
      expect(snapshot).toEqual({ sampleLimit: 2, count: 2, capped: true });
      const output = renderFailedJobMetrics(snapshot);
      expect(output).not.toContain("private");
      expect(output).not.toContain("id=");
      expect(output).toContain("strata_queue_failed_jobs_sample_capped 1");
      const [source] = await admin.unsafe<{ count: number }[]>(
        "SELECT COUNT(*)::integer AS count FROM failed_job WHERE payload->>'secret'='private-payload' AND exception='private-exception'",
      );
      expect(source?.count).toBe(20000);
      const query = buildSelectQuery(dialectFor("pgsql"), failedJobTable, {
        limit: 3,
        orderBy: { column: "id", direction: "ASC" },
        select: [{ kind: "column", table: "failed_job", column: "id" }],
      });
      const explained = await pool.unsafe(
        `EXPLAIN (ANALYZE, FORMAT JSON) ${query.text}`,
        query.params,
      );
      const plan = JSON.stringify(explained);
      expect(plan).toContain("Index");
      expect(plan).toContain("failed_job_pkey");
      expect(plan).not.toContain("Seq Scan");
      const parsed = explained[0]?.["QUERY PLAN"][0]?.Plan;
      expect(parsed?.["Actual Rows"]).toBe(3);
      // Independent observation cannot enter this application/pool's live business transaction.
      await native.run((database) =>
        database.transaction(async (transaction) => {
          await transaction.execute({ text: "SET LOCAL statement_timeout='2300ms'", params: [] });
          await expect(collector.collect()).rejects.toThrow("independent transaction");
          const [settings] = await transaction.execute<{ timeout: string; readonly: string }>({
            text: "SELECT current_setting('statement_timeout') AS timeout,current_setting('transaction_read_only') AS readonly",
            params: [],
          });
          expect(settings).toEqual({ timeout: "2300ms", readonly: "off" });
        }),
      );
      const [settings] = await native.run((database) =>
        database.transaction((transaction) =>
          transaction.execute<{ timeout: string; readonly: string }>({
            text: "SELECT current_setting('statement_timeout') AS timeout,current_setting('transaction_read_only') AS readonly",
            params: [],
          }),
        ),
      );
      expect(settings).toEqual({ timeout: "0", readonly: "off" });
      await admin.unsafe("DELETE FROM failed_job");
      expect(await collector.collect()).toEqual({ sampleLimit: 2, count: 0, capped: false });
    } finally {
      await collector.close();
      await admin.unsafe("DELETE FROM failed_job");
    }
    await expect(collector.collect()).rejects.toThrow("closed");
  });

  test("RLS-enabled and incompatible schemas are unavailable rather than hidden healthy zero", async () => {
    const collector = createFailedJobMetricsCollector({ observeReadOnly });
    try {
      await admin.unsafe(
        "ALTER TABLE failed_job ENABLE ROW LEVEL SECURITY; ALTER TABLE failed_job FORCE ROW LEVEL SECURITY",
      );
      await expect(collector.collect()).rejects.toThrow("standard global table");
      await admin.unsafe("ALTER TABLE failed_job DISABLE ROW LEVEL SECURITY");
      await admin.unsafe("ALTER TABLE failed_job SET UNLOGGED");
      await expect(collector.collect()).rejects.toThrow("standard global table");
      await admin.unsafe("ALTER TABLE failed_job SET LOGGED");
      await admin.unsafe("ALTER TABLE failed_job DROP CONSTRAINT failed_job_pkey");
      await expect(collector.collect()).rejects.toThrow("standard global table");
      await admin.unsafe("ALTER TABLE failed_job ADD PRIMARY KEY (id)");
      await admin.unsafe("ALTER TABLE failed_job RENAME TO unavailable_failed_job");
      await expect(collector.collect()).rejects.toThrow();
      await admin.unsafe("ALTER TABLE unavailable_failed_job RENAME TO failed_job");
      expect((await collector.collect()).count).toBe(0);
    } finally {
      await collector.close();
    }
  });

  test("authenticated concurrent scrapes coalesce, time out and recover after a table lock", async () => {
    const previousToken = process.env.METRICS_TOKEN;
    process.env.METRICS_TOKEN = "metrics-test";
    const collector = createFailedJobMetricsCollector({ observeReadOnly, timeoutMs: 75 });
    let collections = 0;
    const routes = createMetricsRoutes({
      failedJobs: {
        collect() {
          collections++;
          return collector.collect();
        },
      },
    });
    let release: () => void = () => {};
    let acquired: () => void = () => {};
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = admin.begin(async (tx) => {
      await tx.unsafe("LOCK TABLE failed_job IN ACCESS EXCLUSIVE MODE");
      acquired();
      await held;
    });
    await locked;
    const request = () =>
      new Request("http://shop/metrics", { headers: { authorization: "Bearer metrics-test" } });
    try {
      expect((await routes["/metrics"](new Request("http://shop/metrics"))).status).toBe(404);
      expect(collections).toBe(0);
      const started = performance.now();
      const responses = await Promise.all(
        Array.from({ length: 20 }, () => routes["/metrics"](request())),
      );
      expect(collections).toBe(1);
      expect(performance.now() - started).toBeLessThan(1500);
      for (const response of responses) {
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toContain("strata_queue_failed_job_collector_success 0");
        expect(text).toContain("http_requests_total");
        expect(text).not.toContain("strata_queue_failed_jobs_sample ");
      }
      release();
      await holder;
      await collector.close();
      const recovered = createFailedJobMetricsCollector({ observeReadOnly });
      try {
        expect((await recovered.collect()).count).toBe(0);
      } finally {
        await recovered.close();
      }
    } finally {
      release();
      await holder;
      await collector.close();
      restoreEnvVar("METRICS_TOKEN", previousToken);
    }
  });

  test("managed runtime close waits for admitted SQL release and stops new collections", async () => {
    const runtime = createMetricsRuntime({ failedJobs: { observeReadOnly, timeoutMs: 1000 } });
    const collector = runtime.options.failedJobs;
    if (!collector) throw new Error("Missing owned collector");
    let release: () => void = () => {};
    let acquired: () => void = () => {};
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = admin.begin(async (tx) => {
      await tx.unsafe("LOCK TABLE failed_job IN ACCESS EXCLUSIVE MODE");
      acquired();
      await held;
    });
    await locked;
    const collection = collector.collect();
    // Observe lock admission, not an arbitrary sleep, before starting drain.
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await admin.unsafe(
          "SELECT 1 FROM pg_locks WHERE relation='failed_job'::regclass AND NOT granted",
        );
        if (rows.length) {
          waiting = true;
          break;
        }
        await Bun.sleep(5);
      }
      expect(waiting).toBe(true);
      let closed = false;
      const closing = runtime.close().then(() => {
        closed = true;
      });
      await Bun.sleep(10);
      expect(closed).toBe(false);
      await expect(collector.collect()).rejects.toThrow("closed");
      release();
      await holder;
      expect((await collection).count).toBe(0);
      await closing;
      expect(closed).toBe(true);
      // Both pool slots are available again before pool closure.
      const slots = await Promise.all([
        native.run((database) =>
          database.transaction((transaction) =>
            transaction.execute({ text: "SELECT 1 AS n", params: [] }),
          ),
        ),
        native.run((database) =>
          database.transaction((transaction) =>
            transaction.execute({ text: "SELECT 1 AS n", params: [] }),
          ),
        ),
      ]);
      expect(slots).toHaveLength(2);
    } finally {
      release();
      await holder;
      await collection.catch(() => {});
      await runtime.close();
    }
  });

  test("pool admission timeout is natively cancelled and three processes observe the same shared count", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const entered = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const holders = entered.map((gate) =>
      native.run((database) =>
        database.transaction(async () => {
          gate.resolve();
          await held;
        }),
      ),
    );
    await Promise.all(entered.map((gate) => gate.promise));
    let actualObservation: Promise<unknown> | undefined;
    let callbackEntries = 0;
    const collector = createFailedJobMetricsCollector({
      observeReadOnly: (timeoutMs, work) => {
        const actual = observeReadOnly(timeoutMs, (database, remaining) => {
          callbackEntries++;
          return work(database, remaining);
        });
        actualObservation = actual;
        void actual.catch(() => {});
        return actual;
      },
      timeoutMs: 50,
    });
    const failures: unknown[] = [];
    async function bounded<T>(work: Promise<T>, message: string): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          work,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), 1000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    try {
      const caller = collector.collect().then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      );
      if (!actualObservation) throw new Error("The actual observation was not captured.");
      const actual = await bounded(
        actualObservation.then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason) => ({ status: "rejected" as const, reason }),
        ),
        "Actual pool observation did not reject while both holders remained held.",
      );
      expect(actual.status).toBe("rejected");
      if (actual.status !== "rejected") throw new Error("Saturated observation unexpectedly ran.");
      const error = actual.reason;
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError)) throw error;
      expect(error.message).toBe("Execution task failures.");
      expect(error.errors).toHaveLength(2);
      const [transaction, timeout] = error.errors;
      expect(transaction).toBeInstanceOf(PersistenceError);
      if (!(transaction instanceof PersistenceError))
        throw new Error("Missing transaction disposition.");
      expect(transaction.code).toBe("DATABASE_TRANSACTION_FAILED");
      expect(transaction.data).toBe("not-started");
      expect(Object.hasOwn(transaction, "result")).toBe(false);
      expect(timeout).toBeInstanceOf(Error);
      expect(Object.getPrototypeOf(timeout)).toBe(Error.prototype);
      expect(timeout.message).toBe("SQL observation timed out.");
      expect(Object.hasOwn(timeout, "cause")).toBe(false);
      expect(transaction.cause).toBe(timeout);
      expect(error.cause).toBe(transaction);
      const observedCaller = await bounded(caller, "Collector waiter did not settle.");
      expect(observedCaller.status).toBe("rejected");
      if (observedCaller.status !== "rejected")
        throw new Error("Timed-out collector unexpectedly succeeded.");
      if (observedCaller.reason !== error) {
        expect(Object.getPrototypeOf(observedCaller.reason)).toBe(Error.prototype);
        expect(observedCaller.reason.message).toBe("Failed-job metrics collection timed out.");
        expect(Object.hasOwn(observedCaller.reason, "cause")).toBe(false);
      }
      await bounded(
        collector.close(),
        "Actual cancelled observation did not close while both holders remained held.",
      );
      expect(callbackEntries).toBe(0);
    } catch (error) {
      failures.push(error);
    } finally {
      release();
      const joined = await Promise.allSettled(holders);
      for (const result of joined) if (result.status === "rejected") failures.push(result.reason);
      try {
        await collector.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "Pool observation and cleanup failed.");
    expect(callbackEntries).toBe(0);
    // Hold both recovered transactions until BOTH have entered: two fast SELECTs
    // alone could serialize through a single surviving slot.
    const recoveredEntries = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const recoveredRelease = Promise.withResolvers<void>();
    const recoveredPids: number[] = [];
    const recovered = recoveredEntries.map((gate) =>
      native.run((database) =>
        database.transaction(async (transaction) => {
          const [backend] = await transaction.execute<{ pid: number }>({
            text: "SELECT pg_backend_pid() AS pid",
            params: [],
          });
          if (!backend) throw new Error("Missing recovered backend identity.");
          recoveredPids.push(backend.pid);
          gate.resolve();
          await recoveredRelease.promise;
        }),
      ),
    );
    const recoveredSettlement = Promise.allSettled(recovered);
    try {
      await bounded(
        Promise.all(recoveredEntries.map((gate) => gate.promise)),
        "Both recovered native pool slots did not enter concurrently.",
      );
      expect(new Set(recoveredPids).size).toBe(2);
      expect(callbackEntries).toBe(0);
    } catch (error) {
      failures.push(error);
    } finally {
      recoveredRelease.resolve();
      for (const result of await recoveredSettlement)
        if (result.status === "rejected") failures.push(result.reason);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "Pool recovery and cleanup failed.");
    await admin.unsafe(
      "INSERT INTO failed_job(job_name,payload,exception) VALUES ('private','{}','private')",
    );
    const child = `import{createApplication}from '@getstrata/core/runtime/application';import{createDatabaseBindings}from '@getstrata/core/database/bindings';import{createOwnedReadOnlyObservation}from '@getstrata/core/database/ownedReadOnlyObservation';import{createFailedJobMetricsCollector}from '@getstrata/core/queue/queueMetrics';const configured={driver:'pgsql',url:process.env.FAILED_METRICS_URL};const app=createApplication({providers:[],services:createDatabaseBindings({default:'main',connections:{main:configured}})});await app.start();const observeReadOnly=createOwnedReadOnlyObservation(app,'main',configured);const collector=createFailedJobMetricsCollector({observeReadOnly});try{console.log(JSON.stringify(await collector.collect()));}finally{await collector.close();const result=await app.stop();if(!result.successful)throw Error('Application cleanup not confirmed');}`;
    const snapshots = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const process = Bun.spawn(["bun", "--no-env-file", "-e", child], {
          cwd: `${import.meta.dir}/../..`,
          env: { ...Bun.env, FAILED_METRICS_URL: workerUrl },
          stdout: "pipe",
          stderr: "pipe",
        });
        const output = await new Response(process.stdout).text();
        expect(await process.exited).toBe(0);
        return JSON.parse(output);
      }),
    );
    expect(snapshots).toEqual(
      Array.from({ length: 3 }, () => ({ sampleLimit: 500, count: 1, capped: false })),
    );
    await admin.unsafe("DELETE FROM failed_job");
  });
  test("explicit platform outbox observation sees restricted tenant rows and remains read-only without leaking bypass", async () => {
    const owner = {
      unsafe: <R>(text: string, params: readonly unknown[] = []) =>
        admin.unsafe<R[]>(text, [...params]),
    };
    await createOutboxMigration("observation-policy", "pgsql", { rls: true }).up(owner);
    const [role] = await pool.unsafe<{ role: string }[]>("SELECT current_user AS role");
    if (!role || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(role.role)) throw Error("Invalid runtime role");
    await admin.unsafe(
      `GRANT SELECT ON strata_outbox_event,strata_outbox_delivery TO "${role.role}";GRANT DELETE ON strata_outbox_delivery TO "${role.role}"`,
    );
    await admin.unsafe(
      "INSERT INTO strata_outbox_event VALUES('tenant-1','private',1,1,'private',1,'one'),('tenant-2','private',1,2,'private',1,'two');INSERT INTO strata_outbox_delivery(event_id,listener_name,status,max_attempts,available_at)VALUES('tenant-1','listener','pending',3,1),('tenant-2','listener','pending',3,1)",
    );
    const platform = createOwnedReadOnlyObservation(
      native.application,
      "test",
      { driver: "pgsql", url: workerUrl, max: 2 },
      { postgresPolicy: "bypass" },
    );
    const collector = createOutboxMetricsCollector({ observeReadOnly: platform });
    try {
      const hidden = await observeReadOnly(1000, (executor) =>
        executor.execute<{ n: number }>({
          text: "SELECT count(*)::integer AS n FROM strata_outbox_delivery",
          params: [],
        }),
      );
      expect(hidden[0]?.n).toBe(0);
      const settings = await platform(1000, (executor) =>
        executor.execute<{ bypass: string; readonly: string }>({
          text: "SELECT current_setting('app.bypass_rls',true) AS bypass,current_setting('transaction_read_only') AS readonly",
          params: [],
        }),
      );
      expect(settings[0]).toEqual({ bypass: "true", readonly: "on" });
      const snapshot = await collector.collect();
      expect(snapshot.states.find((state) => state.state === "pending_due")?.count).toBe(2);
      await expect(
        platform(1000, (executor) =>
          executor.execute({ text: "DELETE FROM strata_outbox_delivery", params: [] }),
        ),
      ).rejects.toThrow();
      const [retained] = await admin.unsafe<{ n: number }[]>(
        "SELECT count(*)::integer AS n FROM strata_outbox_delivery",
      );
      expect(retained?.n).toBe(2);
      const [restored] = await native.run((database) =>
        database.execute<{ bypass: string | null; readonly: string }>({
          text: "SELECT current_setting('app.bypass_rls',true) AS bypass,current_setting('transaction_read_only') AS readonly",
          params: [],
        }),
      );
      expect(restored?.bypass).not.toBe("true");
      expect(restored?.readonly).toBe("off");
    } finally {
      await collector.close();
      await admin.unsafe("DROP TABLE strata_outbox_delivery;DROP TABLE strata_outbox_event");
    }
  });
});
