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
import { buildSelectQuery } from "@getstrata/core/database/query";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { Schema } from "@getstrata/core/database/schema";
import { runInTransaction } from "@getstrata/core/database/transaction";
import {
  createFailedJobMetricsCollector,
  renderFailedJobMetrics,
} from "@getstrata/core/queue/queueMetrics";
import { SQL } from "bun";
import { failedJobTable } from "../../src/core/queue/failedJobTable";
import { restoreEnvVar } from "../helpers/restoreEnv";

const adminUrl = process.env.MIGRATION_DATABASE_URL;
const restrictedUrl = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
describe.skipIf(!adminUrl || !restrictedUrl)("bounded Postgres failed-job observations", () => {
  const database = `failed_metrics_${crypto.randomUUID().replaceAll("-", "")}`;
  let control: SQL;
  let admin: SQL;
  let pool: SQL;
  let workerUrl: string;
  let previousPool: SqlDatabaseConnection;
  let previousBound: ReturnType<typeof getBoundDatabaseConnection>;
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
    previousPool = getDefaultDatabasePool();
    previousBound = getBoundDatabaseConnection();
    registerDefaultDatabasePool(pool as unknown as SqlDatabaseConnection);
    resetBoundDatabaseConnection();
    useSqlDialect("pgsql");
  });
  afterAll(async () => {
    if (previousPool) registerDefaultDatabasePool(previousPool);
    if (previousBound) bindDatabaseConnection(previousBound);
    else resetBoundDatabaseConnection();
    resetSqlDialect();
    await pool?.close();
    await admin?.close();
    if (created) await control.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
    await control?.close();
  });

  test("empty, capped and recovered counts preserve private source records and use the primary index", async () => {
    const collector = createFailedJobMetricsCollector({ sampleLimit: 2 });
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
      const query = buildSelectQuery(failedJobTable, {
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
      await expect(runInTransaction(() => collector.collect())).rejects.toThrow(
        "independent transaction",
      );
      const [settings] = await runInTransaction(() =>
        db.unsafe<{ timeout: string; readonly: string }>(
          "SELECT current_setting('statement_timeout') AS timeout, current_setting('transaction_read_only') AS readonly",
        ),
      );
      expect(settings).toEqual({ timeout: "0", readonly: "off" });
      await admin.unsafe("DELETE FROM failed_job");
      expect(await collector.collect()).toEqual({ sampleLimit: 2, count: 0, capped: false });
    } finally {
      await collector.close();
    }
    await expect(collector.collect()).rejects.toThrow("closed");
  });

  test("RLS-enabled and incompatible schemas are unavailable rather than hidden healthy zero", async () => {
    const collector = createFailedJobMetricsCollector();
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
    const collector = createFailedJobMetricsCollector({ timeoutMs: 75 });
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
      const recovered = createFailedJobMetricsCollector();
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

  test("pool admission timeout is natively cancelled and three processes observe the same shared count", async () => {
    const reserved = await Promise.all([pool.reserve(), pool.reserve()]);
    const collector = createFailedJobMetricsCollector({ timeoutMs: 50 });
    try {
      await expect(collector.collect()).rejects.toThrow("timed out");
    } finally {
      for (const connection of reserved) connection.release();
      await collector.close();
    }
    await admin.unsafe(
      "INSERT INTO failed_job(job_name,payload,exception) VALUES ('private','{}','private')",
    );
    const child = `import { SQL } from 'bun';
      import { bindBunSql } from '@getstrata/core/database/bunSql';
      import { useSqlDialect } from '@getstrata/core/database/dialect';
      import { createFailedJobMetricsCollector } from '@getstrata/core/queue/queueMetrics';
      const pool = new SQL(process.env.FAILED_METRICS_URL); bindBunSql(pool); useSqlDialect('pgsql');
      const collector = createFailedJobMetricsCollector();
      try { console.log(JSON.stringify(await collector.collect())); }
      finally { await collector.close(); await pool.close(); }`;
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
});
