import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import type { UnsafeQueryable } from "@getstrata/core/database/connection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import {
  createFailedJobMetricsCollector,
  renderFailedJobMetrics,
} from "@getstrata/core/queue/queueMetrics";
import { runWithDatabaseConnection } from "../../src/core/database/connectionContext";

let previous: ReturnType<typeof getBoundDatabaseConnection>;
let schema: unknown[];
let records: unknown[];
let calls: { query: string; params: readonly unknown[] }[];
beforeEach(() => {
  previous = getBoundDatabaseConnection();
  useSqlDialect("pgsql");
  schema = [{ supported: true }];
  records = [];
  calls = [];
  const unsafe = async <T>(query: string, params: readonly unknown[] = []): Promise<T[]> => {
    calls.push({ query, params });
    return (
      query.includes("FROM pg_class") ? schema : query.includes('FROM "failed_job"') ? records : []
    ) as T[];
  };
  const reserved = {
    unsafe,
    release() {},
    async begin<T>(run: (tx: UnsafeQueryable) => Promise<T>) {
      return run({ unsafe });
    },
  };
  bindDatabaseConnection({ ...reserved, reserve: async () => reserved });
});
afterEach(() => {
  if (previous) bindDatabaseConnection(previous);
  else resetBoundDatabaseConnection();
  resetSqlDialect();
});

test("failed-job sample uses the ORM projection, primary-key ordering and only a fixed bounded limit", async () => {
  records = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const collector = createFailedJobMetricsCollector({ sampleLimit: 2 });
  try {
    expect(await collector.collect()).toEqual({ sampleLimit: 2, count: 2, capped: true });
    const query = calls.find((call) => call.query.includes('FROM "failed_job"'));
    expect(query?.query).toContain('SELECT "failed_job"."id"');
    expect(query?.query).toContain('ORDER BY "failed_job"."id" ASC LIMIT 3');
    expect(query?.query).not.toContain("payload");
    expect(query?.query).not.toContain("exception");
    expect(calls.some((call) => call.query === "SET TRANSACTION READ ONLY")).toBe(true);
    records = [{ id: 1 }];
    expect(await collector.collect()).toEqual({ sampleLimit: 2, count: 1, capped: false });
  } finally {
    await collector.close();
  }
});

test("malformed schema or projection responses fail instead of emitting an empty count", async () => {
  for (const unsupported of [
    [],
    [{ supported: false }],
    [{ supported: "true" }],
    [{ supported: true }, { supported: true }],
  ]) {
    schema = unsupported;
    const collector = createFailedJobMetricsCollector();
    await expect(collector.collect()).rejects.toThrow("standard global table");
    await collector.close();
  }
  schema = [{ supported: true }];
  for (const invalid of [[{}], [{ id: null }], [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]]) {
    records = invalid;
    const collector = createFailedJobMetricsCollector({ sampleLimit: 2 });
    await expect(collector.collect()).rejects.toThrow("Invalid failed-job metrics response");
    await collector.close();
  }
});

test("invalid limits/deadlines and unsupported dialects fail explicitly", async () => {
  for (const sampleLimit of [0, 1001, 0.5, NaN])
    expect(() => createFailedJobMetricsCollector({ sampleLimit })).toThrow();
  for (const timeoutMs of [0, 5001, 0.5, NaN])
    expect(() => createFailedJobMetricsCollector({ timeoutMs })).toThrow();
  useSqlDialect("sqlite");
  const collector = createFailedJobMetricsCollector();
  await expect(collector.collect()).rejects.toThrow("Postgres");
  await collector.close();
  await expect(collector.collect()).rejects.toThrow("closed");
});

test("failed-job rendering validates capped-count semantics and emits a fixed vocabulary", async () => {
  const collector = createFailedJobMetricsCollector();
  const snapshot = await collector.collect();
  expect(renderFailedJobMetrics(snapshot)).toContain("strata_queue_failed_jobs_sample 0\n");
  for (const invalid of [
    { ...snapshot, sampleLimit: 0 },
    { ...snapshot, sampleLimit: 1001 },
    { ...snapshot, count: -1 },
    { ...snapshot, count: 501 },
    { ...snapshot, count: NaN },
    { ...snapshot, capped: true },
    { ...snapshot, capped: "true" },
  ])
    expect(() => renderFailedJobMetrics(invalid as never)).toThrow(
      "Invalid failed-job metrics snapshot",
    );
  await collector.close();
});

test("collectors reject an ambient raw connection even without a framework transaction scope", async () => {
  const collector = createFailedJobMetricsCollector();
  try {
    await expect(
      runWithDatabaseConnection(
        {
          async unsafe() {
            return [];
          },
        },
        () => collector.collect(),
      ),
    ).rejects.toThrow("independent transaction");
    expect(calls).toEqual([]);
  } finally {
    await collector.close();
  }
});

test("close drains late rollback/release after a response deadline and does not admit duplicate work", async () => {
  let unblock: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let released = false;
  const unsafe = async <T>(query: string): Promise<T[]> => {
    if (query.includes("set_config")) await blocked;
    return [];
  };
  const reserved = {
    unsafe,
    release() {
      released = true;
    },
    async begin<T>(run: (tx: UnsafeQueryable) => Promise<T>) {
      return run({ unsafe });
    },
  };
  bindDatabaseConnection({ ...reserved, reserve: async () => reserved });
  const collector = createFailedJobMetricsCollector({ timeoutMs: 20 });
  await expect(collector.collect()).rejects.toThrow("timed out");
  await expect(collector.collect()).rejects.toThrow("still settling");
  let drained = false;
  const close = collector.close().then(() => {
    drained = true;
  });
  await Bun.sleep(1);
  expect(drained).toBe(false);
  expect(released).toBe(false);
  unblock();
  await close;
  expect(released).toBe(true);
  expect(drained).toBe(true);
});
