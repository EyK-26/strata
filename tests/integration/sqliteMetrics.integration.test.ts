import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMetricsRoutes, createMetricsRuntime } from "@getstrata/bootstrap/metricsRoutes";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { Schema } from "@getstrata/core/database/schema";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { createOutboxMigration } from "@getstrata/core/events/outbox";
import { renderFailedJobMetrics } from "@getstrata/core/queue/queueMetrics";
import { createReadOnlyCollector } from "../../src/core/database/readOnlyCollector";
import { repositoryConnection } from "../../src/core/database/repositoryConnection";
import { restoreEnvVar } from "../helpers/restoreEnv";

async function fixture(
  run: (db: ReturnType<typeof createSqliteConnection>, filename: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "sqlite-metrics-"));
  const filename = join(directory, "app.sqlite");
  const db = createSqliteConnection(filename);
  const previous = getBoundDatabaseConnection();
  const token = process.env.METRICS_TOKEN;
  process.env.METRICS_TOKEN = "sqlite-metrics-fixture";
  try {
    bindDatabaseConnection(db);
    useSqlDialect("sqlite");
    await Schema.run(db, "sqlite", (schema) => {
      schema.create("failed_job", (table) => {
        table.id();
        table.string("job_name");
        table.text("job_id").nullable();
        table.text("payload");
        table.text("exception");
        table.timestamp("failed_at").defaultRaw("CURRENT_TIMESTAMP");
      });
    });
    await createOutboxMigration("fixture", "sqlite").up(db);
    await db.unsafe(
      "INSERT INTO strata_outbox_event VALUES ('fixture', 'private-event', 1, NULL, 'private-payload', 1, 'fixture')",
    );
    await run(db, filename);
  } finally {
    if (previous) bindDatabaseConnection(previous);
    else resetBoundDatabaseConnection();
    resetSqlDialect();
    restoreEnvVar("METRICS_TOKEN", token);
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("SQLite bounded ORM failed-job projections and indexed outbox samples exclude completed history", async () => {
  await fixture(async (db) => {
    const runtime = createMetricsRuntime({
      failedJobs: { sampleLimit: 2 },
      outbox: { sampleLimit: 2 },
    });
    try {
      expect(await runtime.options.failedJobs?.collect()).toEqual({
        sampleLimit: 2,
        count: 0,
        capped: false,
      });
      await db.unsafe(
        "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<20000) INSERT INTO failed_job(job_name,payload,exception) SELECT 'private','private','private' FROM n",
      );
      const snapshot = await runtime.options.failedJobs?.collect();
      expect(snapshot).toEqual({ sampleLimit: 2, count: 2, capped: true });
      if (!snapshot) throw new Error("Missing snapshot");
      expect(renderFailedJobMetrics(snapshot)).not.toContain("private");
      await db.unsafe(
        "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<20000) INSERT INTO strata_outbox_delivery(event_id,listener_name,status,max_attempts,available_at) SELECT 'fixture','completed-'||x,'completed',3,x FROM n",
      );
      await db.unsafe(
        "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000) INSERT INTO strata_outbox_delivery(event_id,listener_name,status,max_attempts,available_at) SELECT 'fixture','pending-'||x,'pending',3,x FROM n",
      );
      for (const [listener, status, available, lease] of [
        ["waiting", "pending", Date.now() + 60000, null],
        ["active", "processing", 1, Date.now() + 60000],
        ["expired", "processing", 1, Date.now() - 5000],
        ["unleased", "processing", 1, null],
        ["failed", "failed", 1, null],
      ])
        await db.unsafe(
          "INSERT INTO strata_outbox_delivery(event_id,listener_name,status,max_attempts,available_at,lease_until) VALUES ('fixture',?,?,3,?,?)",
          [listener, status, available, lease],
        );
      const outbox = await runtime.options.outbox?.collect();
      expect(outbox?.states.map((row) => [row.state, row.count, row.capped])).toEqual([
        ["pending_due", 2, true],
        ["pending_waiting", 1, false],
        ["processing_active", 1, false],
        ["processing_expired", 1, false],
        ["processing_unleased", 1, false],
        ["failed", 1, false],
      ]);
      expect(
        outbox?.states.find((row) => row.state === "processing_expired")?.actionableLatenessSeconds,
      ).toBeGreaterThanOrEqual(5);
      expect(
        outbox?.states.find((row) => row.state === "pending_waiting")?.actionableLatenessSeconds,
      ).toBeNull();
      const plans = await db.observeReadOnly(
        (tx) =>
          tx.unsafe(
            "EXPLAIN QUERY PLAN SELECT available_at FROM strata_outbox_delivery INDEXED BY strata_outbox_due WHERE status='pending' AND available_at<=? ORDER BY available_at,event_id,listener_name LIMIT 3",
            [Date.now()],
          ),
        { signal: AbortSignal.timeout(1000), timeoutMs: 1000 },
      );
      const plan = JSON.stringify(plans);
      expect(plan).toContain("COVERING INDEX strata_outbox_due");
      expect(plan).not.toContain("TEMP B-TREE");
      expect(
        await db.unsafe("SELECT count(*) AS n FROM failed_job WHERE payload='private'"),
      ).toEqual([{ n: 20000 }]);
      expect(
        await db.unsafe(
          "SELECT count(*) AS n FROM strata_outbox_delivery WHERE status='completed'",
        ),
      ).toEqual([{ n: 20000 }]);
    } finally {
      await runtime.close();
    }
  });
});

test("SQLite rejects missing/wrong schemas and indexes, coalesces authenticated scrapes and recovers", async () => {
  await fixture(async (db) => {
    const runtime = createMetricsRuntime({ failedJobs: {}, outbox: {} });
    const routes = createMetricsRoutes(runtime.options);
    const request = () =>
      new Request("http://local/metrics", {
        headers: { authorization: "Bearer sqlite-metrics-fixture" },
      });
    try {
      expect((await routes["/metrics"](new Request("http://local/metrics"))).status).toBe(404);
      const bodies = await Promise.all(
        Array.from({ length: 20 }, () =>
          routes["/metrics"](request()).then((response) => response.text()),
        ),
      );
      expect(new Set(bodies).size).toBe(1);
      expect(bodies[0]).toContain("strata_outbox_collector_success 1");
      await db.unsafe("DROP INDEX strata_outbox_due");
      await expect(runtime.options.outbox?.collect()).rejects.toThrow("standard delivery indexes");
      const failed = await routes["/metrics"](request()).then((response) => response.text());
      expect(failed).toContain("strata_outbox_collector_success 0");
      expect(failed).toContain("strata_queue_failed_job_collector_success 1");
      await db.unsafe("CREATE INDEX strata_outbox_due ON strata_outbox_delivery(status,attempts)");
      await expect(runtime.options.outbox?.collect()).rejects.toThrow("standard delivery indexes");
      await db.unsafe("DROP INDEX strata_outbox_due");
      await db.unsafe(
        "CREATE INDEX strata_outbox_due ON strata_outbox_delivery(status,available_at,event_id,listener_name)",
      );
      await db.unsafe("ALTER TABLE failed_job RENAME TO original_failed_job");
      await expect(runtime.options.failedJobs?.collect()).rejects.toThrow("standard global table");
      await db.unsafe("CREATE TABLE failed_job(id TEXT PRIMARY KEY)");
      await expect(runtime.options.failedJobs?.collect()).rejects.toThrow("standard global table");
      await db.unsafe("DROP TABLE failed_job");
      await db.unsafe("ALTER TABLE original_failed_job RENAME TO failed_job");
      await db.unsafe("ALTER TABLE strata_outbox_delivery RENAME TO saved_delivery");
      await expect(runtime.options.outbox?.collect()).rejects.toThrow("standard delivery table");
      await db.unsafe("ALTER TABLE saved_delivery RENAME TO strata_outbox_delivery");
      expect(
        (await runtime.options.outbox?.collect())?.states.every((row) => row.count === 0),
      ).toBe(true);
    } finally {
      await runtime.close();
    }
  });
});

test("SQLite collector deadline cancels actual VM work and close drains before business connection closure", async () => {
  await fixture(async (db) => {
    const collector = createReadOnlyCollector("Test observation", 100, () =>
      repositoryConnection.unsafe(
        "WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n",
      ),
    );
    const start = performance.now();
    await expect(collector.collect()).rejects.toThrow("timed out");
    await collector.close();
    expect(performance.now() - start).toBeLessThan(1500);
    await expect(collector.collect()).rejects.toThrow("closed");
    expect(await db.unsafe("SELECT 1 AS n")).toEqual([{ n: 1 }]);
  });
});

test("three independent processes observe the same SQLite database without additive counts", async () => {
  await fixture(async (db, filename) => {
    await db.unsafe(
      "INSERT INTO failed_job(job_name,payload,exception) VALUES ('private','private','private')",
    );
    const program = `import {createSqliteConnection} from '@getstrata/core/database/sqliteConnection';
      import {bindDatabaseConnection} from '@getstrata/core/database/boundConnection';
      import {useSqlDialect} from '@getstrata/core/database/dialect';
      import {createMetricsRuntime} from '@getstrata/bootstrap/metricsRoutes';
      const db=createSqliteConnection(process.env.SQLITE_METRICS_FILE); bindDatabaseConnection(db); useSqlDialect('sqlite');
      const runtime=createMetricsRuntime({failedJobs:{},outbox:{}});
      try { const failed=await runtime.options.failedJobs.collect(); const outbox=await runtime.options.outbox.collect();
        console.log(JSON.stringify({failed,states:outbox.states.map(row=>[row.state,row.count,row.capped])})); }
      finally {await runtime.close(); db.close();}`;
    const results = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const child = Bun.spawn([process.execPath, "--no-env-file", "-e", program], {
          env: { PATH: process.env.PATH, SQLITE_METRICS_FILE: filename },
          stdout: "pipe",
          stderr: "pipe",
        });
        const output = await new Response(child.stdout).text();
        expect(await child.exited).toBe(0);
        return JSON.parse(output);
      }),
    );
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
    expect(results[0].failed.count).toBe(1);
  });
});
