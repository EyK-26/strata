import { beforeEach, expect, test } from "bun:test";
import { dialectFor } from "@getstrata/core/database/sqlDialects";
import type { FailedJobObservation } from "@getstrata/core/queue/failedJobMetrics";
import {
  createFailedJobMetricsCollector,
  renderFailedJobMetrics,
} from "@getstrata/core/queue/queueMetrics";
import { runWithDatabaseConnection } from "../../src/core/database/connectionContext";

let schema: unknown[];
let records: unknown[];
let calls: { query: string; params: readonly unknown[] }[];
let observeReadOnly: FailedJobObservation;
beforeEach(() => {
  schema = [{ supported: true }];
  records = [];
  calls = [];
  observeReadOnly = async (_timeoutMs, work) => {
    calls.push({ query: "SET TRANSACTION READ ONLY", params: [] });
    return work(
      {
        dialect: dialectFor("pgsql"),
        execute: async <T>({
          text,
          params,
        }: import("@getstrata/core/database/driverPorts").SqlStatement) => {
          calls.push({ query: text, params });
          return (
            text.includes("FROM pg_class")
              ? schema
              : text.includes('FROM "failed_job"')
                ? records
                : []
          ) as T[];
        },
      },
      () => 1000,
    );
  };
});

test("failed-job sample uses the ORM projection, primary-key ordering and only a fixed bounded limit", async () => {
  records = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const collector = createFailedJobMetricsCollector({ observeReadOnly, sampleLimit: 2 });
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
    const collector = createFailedJobMetricsCollector({ observeReadOnly });
    await expect(collector.collect()).rejects.toThrow("standard global table");
    await collector.close();
  }
  schema = [{ supported: true }];
  for (const invalid of [[{}], [{ id: null }], [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]]) {
    records = invalid;
    const collector = createFailedJobMetricsCollector({ observeReadOnly, sampleLimit: 2 });
    await expect(collector.collect()).rejects.toThrow("Invalid failed-job metrics response");
    await collector.close();
  }
});

test("invalid limits/deadlines and missing explicit observation runners fail explicitly", async () => {
  for (const sampleLimit of [0, 1001, 0.5, NaN])
    expect(() => createFailedJobMetricsCollector({ observeReadOnly, sampleLimit })).toThrow();
  for (const timeoutMs of [0, 5001, 0.5, NaN])
    expect(() => createFailedJobMetricsCollector({ observeReadOnly, timeoutMs })).toThrow();
  expect(() => createFailedJobMetricsCollector({ observeReadOnly: undefined } as never)).toThrow(
    "explicit read-only",
  );
  const collector = createFailedJobMetricsCollector({ observeReadOnly });
  await collector.close();
  await expect(collector.collect()).rejects.toThrow("closed");
});

test("failed-job rendering validates capped-count semantics and emits a fixed vocabulary", async () => {
  const collector = createFailedJobMetricsCollector({ observeReadOnly });
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

test("explicit observation never selects an ambient raw connection", async () => {
  const collector = createFailedJobMetricsCollector({ observeReadOnly });
  try {
    const snapshot = await runWithDatabaseConnection(
      {
        async unsafe() {
          return [];
        },
      },
      () => collector.collect(),
    );
    expect(snapshot).toEqual({ sampleLimit: 500, count: 0, capped: false });
    expect(calls.some((call) => call.query.includes("FROM pg_class"))).toBe(true);
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
  observeReadOnly = async (_timeout, work) => {
    try {
      await blocked;
      return await work(
        {
          dialect: dialectFor("pgsql"),
          execute: async <T>({
            text,
          }: import("@getstrata/core/database/driverPorts").SqlStatement) =>
            (text.includes("FROM pg_class") ? [{ supported: true }] : []) as T[],
        },
        () => 1000,
      );
    } finally {
      released = true;
    }
  };
  const collector = createFailedJobMetricsCollector({ observeReadOnly, timeoutMs: 20 });
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
