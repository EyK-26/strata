import { expect, test } from "bun:test";
import { createMetricsRuntime } from "@getstrata/bootstrap/metricsRoutes";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import {
  createMysqlConnection,
  createMysqlConnectionFromPool,
} from "@getstrata/core/database/mysqlConnection";
import { Schema } from "@getstrata/core/database/schema";
import { createOutboxMigration } from "@getstrata/core/events/outbox";
import { createConnection } from "mysql2/promise";

const adminUrl = process.env.MYSQL_OBSERVABILITY_ADMIN_URL;
const mysqlTest = adminUrl ? test : test.skip;
async function fixture(
  run: (
    writer: ReturnType<typeof createMysqlConnection>,
    reader: ReturnType<typeof createMysqlConnection>,
    url: string,
  ) => Promise<void>,
) {
  if (!adminUrl) throw new Error("Missing qualification admin URL");
  const admin = await createConnection(adminUrl);
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 18);
  const database = `obs_${suffix}`;
  const user = `obs_${suffix}`;
  const password = crypto.randomUUID().replaceAll("-", "");
  const previous = getBoundDatabaseConnection();
  let writer: ReturnType<typeof createMysqlConnection> | undefined;
  let reader: ReturnType<typeof createMysqlConnection> | undefined;
  try {
    // Identifiers and credential contain only locally generated ASCII hex, never request input.
    await admin.query(`CREATE DATABASE ${database}`);
    await admin.query(`CREATE USER '${user}'@'%' IDENTIFIED BY '${password}'`);
    await admin.query(`GRANT SELECT ON ${database}.* TO '${user}'@'%'`);
    const writeUrl = new URL(adminUrl);
    writeUrl.pathname = `/${database}`;
    const readUrl = new URL(writeUrl);
    readUrl.username = user;
    readUrl.password = password;
    writer = createMysqlConnection(writeUrl.toString());
    reader = createMysqlConnection(readUrl.toString());
    useSqlDialect("mysql");
    bindDatabaseConnection(writer);
    await Schema.run(writer, "mysql", (schema) => {
      schema.create("failed_job", (table) => {
        table.id();
        table.string("job_name");
        table.text("payload");
        table.text("exception");
      });
    });
    await createOutboxMigration("fixture", "mysql").up(writer);
    await writer.unsafe(
      "INSERT INTO strata_outbox_event VALUES ('fixture','private-event',1,NULL,'private-payload',1,'fixture')",
    );
    bindDatabaseConnection(reader);
    await run(writer, reader, readUrl.toString());
  } finally {
    await reader?.close();
    await writer?.close();
    if (previous) bindDatabaseConnection(previous);
    else resetBoundDatabaseConnection();
    resetSqlDialect();
    await admin.query(`DROP USER IF EXISTS '${user}'@'%'`);
    await admin.query(`DROP DATABASE IF EXISTS ${database}`);
    await admin.end();
  }
}
const options = () => ({ signal: new AbortController().signal, timeoutMs: 2000 });
mysqlTest(
  "MySQL isolated read-only snapshots preserve business writes and enforce SELECT-only privileges",
  async () => {
    await fixture(async (writer, reader) => {
      await writer.unsafe(
        "INSERT INTO failed_job(job_name,payload,exception) VALUES ('private','private','private')",
      );
      await expect(
        writer.observeReadOnly(
          (tx) => tx.unsafe("UPDATE failed_job SET job_name='bad'"),
          options(),
        ),
      ).rejects.toThrow("Read-only SQL observation failed");
      await reader.observeReadOnly(async (tx) => {
        const first = await tx.unsafe("SELECT job_name FROM failed_job");
        await writer.unsafe("UPDATE failed_job SET job_name='changed'");
        expect(await tx.unsafe("SELECT job_name FROM failed_job")).toEqual(first);
        await expect(reader.unsafe("UPDATE failed_job SET job_name='bad'")).rejects.toThrow(
          "Read-only SQL observation failed",
        );
      }, options());
      expect(await reader.unsafe("SELECT job_name FROM failed_job")).toEqual([
        { job_name: "changed" },
      ]);
      await expect(reader.unsafe("DELETE FROM failed_job")).rejects.toThrow();
      const controller = new AbortController();
      controller.abort(new Error("cancelled"));
      let calls = 0;
      await expect(
        reader.observeReadOnly(
          async () => {
            calls++;
          },
          { ...options(), signal: controller.signal },
        ),
      ).rejects.toThrow("cancelled");
      expect(calls).toBe(0);
    });
  },
);
mysqlTest(
  "MySQL cancels blocking native reads, drains and recovers without consuming the business pool",
  async () => {
    await fixture(async (_writer, reader) => {
      let ticks = 0;
      const clock = setInterval(() => ticks++, 5);
      const start = performance.now();
      try {
        await expect(
          reader.observeReadOnly((tx) => tx.unsafe("SELECT SLEEP(10)"), {
            ...options(),
            timeoutMs: 500,
          }),
        ).rejects.toThrow("timed out");
        expect(performance.now() - start).toBeLessThan(2000);
        expect(ticks).toBeGreaterThan(0);
        expect(await reader.observeReadOnly((tx) => tx.unsafe("SELECT 1 AS n"), options())).toEqual(
          [{ n: 1 }],
        );
        await reader.close();
        await expect(reader.observeReadOnly(async () => {}, options())).rejects.toThrow("closed");
        const custom = createMysqlConnectionFromPool({ execute: async () => [[], []] });
        await expect(custom.observeReadOnly(async () => {}, options())).rejects.toThrow(
          "URL-backed",
        );
        await custom.close();
      } finally {
        clearInterval(clock);
      }
    });
  },
);
mysqlTest(
  "MySQL bounded indexed recovery observations exclude completed history across three processes",
  async () => {
    await fixture(async (writer, _reader, url) => {
      // Representative history, inserted in bounded batches using parameters.
      for (let start = 0; start < 20000; start += 500) {
        await writer.unsafe(
          `INSERT INTO failed_job(job_name,payload,exception) VALUES ${Array.from({ length: 500 }, () => "(?,?,?)").join(",")}`,
          Array.from({ length: 500 }, () => ["private", "private", "private"]).flat(),
        );
        await writer.unsafe(
          `INSERT INTO strata_outbox_delivery(event_id,listener_name,status,max_attempts,available_at) VALUES ${Array.from({ length: 500 }, () => "(?,?,?,?,?)").join(",")}`,
          Array.from({ length: 500 }, (_, i) => [
            "fixture",
            `completed-${start + i}`,
            "completed",
            3,
            1,
          ]).flat(),
        );
      }
      for (const [listener, status, time, lease] of [
        ["due", "pending", 1, null],
        ["waiting", "pending", Date.now() + 60000, null],
        ["active", "processing", 1, Date.now() + 60000],
        ["expired", "processing", 1, Date.now() - 5000],
        ["unleased", "processing", 1, null],
        ["failed", "failed", 1, null],
      ]) {
        await writer.unsafe(
          "INSERT INTO strata_outbox_delivery(event_id,listener_name,status,max_attempts,available_at,lease_until) VALUES ('fixture',?,?,3,?,?)",
          [listener, status, time, lease],
        );
      }
      const runtime = createMetricsRuntime({
        failedJobs: { sampleLimit: 2 },
        outbox: { sampleLimit: 2 },
      });
      try {
        expect(await runtime.options.failedJobs?.collect()).toEqual({
          sampleLimit: 2,
          count: 2,
          capped: true,
        });
        expect((await runtime.options.outbox?.collect())?.states.map((row) => row.count)).toEqual([
          1, 1, 1, 1, 1, 1,
        ]);
        const plan = JSON.stringify(
          await writer.unsafe(
            "EXPLAIN ANALYZE SELECT available_at FROM strata_outbox_delivery FORCE INDEX (strata_outbox_due) WHERE status='pending' AND available_at<=? ORDER BY available_at,event_id,listener_name LIMIT 3",
            [Date.now()],
          ),
        );
        expect(plan).toContain("strata_outbox_due");
        expect(plan).not.toContain("Table scan");
        expect(plan).not.toContain("Sort:");
        await writer.unsafe("ALTER TABLE strata_outbox_delivery DROP INDEX strata_outbox_due");
        await expect(runtime.options.outbox?.collect()).rejects.toThrow(
          "standard delivery indexes",
        );
        await writer.unsafe(
          "CREATE INDEX strata_outbox_due ON strata_outbox_delivery(status,available_at,event_id,listener_name)",
        );
        await writer.unsafe("ALTER TABLE failed_job ENGINE=MyISAM");
        await expect(runtime.options.failedJobs?.collect()).rejects.toThrow(
          "standard global table",
        );
        await writer.unsafe("ALTER TABLE failed_job ENGINE=InnoDB");
        const program = `import {createMysqlConnection} from '@getstrata/core/database/mysqlConnection';import {bindDatabaseConnection} from '@getstrata/core/database/boundConnection';import {useSqlDialect} from '@getstrata/core/database/dialect';import {createMetricsRuntime} from '@getstrata/bootstrap/metricsRoutes';const db=createMysqlConnection(process.env.OBS_URL);bindDatabaseConnection(db);useSqlDialect('mysql');const runtime=createMetricsRuntime({failedJobs:{sampleLimit:2},outbox:{sampleLimit:2}});try{console.log(JSON.stringify({failed:await runtime.options.failedJobs.collect(),states:(await runtime.options.outbox.collect()).states.map(r=>[r.state,r.count,r.capped])}));}finally{await runtime.close();await db.close();}`;
        const results = await Promise.all(
          Array.from({ length: 3 }, async () => {
            const child = Bun.spawn([process.execPath, "--no-env-file", "-e", program], {
              env: { PATH: process.env.PATH, OBS_URL: url },
              stdout: "pipe",
              stderr: "ignore",
            });
            const output = await new Response(child.stdout).text();
            expect(await child.exited).toBe(0);
            return JSON.parse(output);
          }),
        );
        expect(results[0]).toEqual(results[1]);
        expect(results[1]).toEqual(results[2]);
      } finally {
        await runtime.close();
      }
    });
  },
  20000,
);
