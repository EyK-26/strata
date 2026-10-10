import { afterEach, expect, test } from "bun:test";
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";
import type { DatabaseConnection } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import {
  createTransactionAcquisitionMetrics,
  renderTransactionAcquisitionMetrics,
  runInTransaction,
} from "@getstrata/core/database/transaction";
import { observeTransactionAcquisition } from "../../src/core/database/acquisitionMetrics";

afterEach(() => resetBoundDatabaseConnection());
function fixture(acquire?: () => Promise<void>) {
  const calls: string[] = [];
  const tx: DatabaseConnection = {
    async unsafe<T>(sql: string) {
      calls.push(sql);
      return [] as T[];
    },
  };
  const reserved = {
    ...tx,
    async begin<T>(run: (db: DatabaseConnection) => Promise<T>) {
      calls.push("begin");
      try {
        return await run(tx);
      } finally {
        calls.push("settled");
      }
    },
    release() {
      calls.push("release");
    },
  };
  bindDatabaseConnection({
    ...reserved,
    async reserve() {
      calls.push("reserve");
      await acquire?.();
      return reserved;
    },
  });
  return calls;
}

test("measured checkout releases once, excludes business duration and nested savepoints", async () => {
  const metrics = createTransactionAcquisitionMetrics();
  const calls = fixture();
  await runInTransaction(
    async (db) => {
      const before = metrics.snapshot();
      expect(before.inflight).toBe(0);
      expect(before.outcomes[0]?.count).toBe(1);
      await Bun.sleep(20);
      await runInTransaction(async (nested) => nested.unsafe("nested"), {
        acquisitionMetrics: metrics,
      });
      await db.unsafe("outer");
      expect(metrics.snapshot()).toEqual(before);
    },
    { acquisitionMetrics: metrics },
  );
  expect(calls.filter((call) => call === "reserve")).toHaveLength(1);
  expect(calls.filter((call) => call === "release")).toHaveLength(1);
  expect(calls.some((call) => call.startsWith("SAVEPOINT "))).toBe(true);
});

test("native checkout failure preserves error identity and records failed duration", async () => {
  const error = new Error("connection-secret");
  const calls = fixture(async () => {
    throw error;
  });
  const metrics = createTransactionAcquisitionMetrics();
  await expect(runInTransaction(async () => {}, { acquisitionMetrics: metrics })).rejects.toBe(
    error,
  );
  expect(metrics.snapshot().inflight).toBe(0);
  expect(metrics.snapshot().outcomes[1]?.count).toBe(1);
  expect(calls).toEqual(["reserve"]);
  expect(renderTransactionAcquisitionMetrics(metrics.snapshot())).not.toContain("secret");
});

test("cancelled native wait is observed, pre-abort and unsupported admission are not checkout attempts", async () => {
  const controller = new AbortController();
  const reason = new Error("abort-secret");
  const metrics = createTransactionAcquisitionMetrics();
  fixture(async () => {
    controller.abort(reason);
    throw reason;
  });
  await expect(
    runInTransaction(async () => {}, {
      acquisitionMetrics: metrics,
      acquisitionSignal: controller.signal,
    }),
  ).rejects.toBe(reason);
  expect(metrics.snapshot().outcomes[2]?.count).toBe(1);
  await expect(
    runInTransaction(async () => {}, {
      acquisitionMetrics: metrics,
      acquisitionSignal: controller.signal,
    }),
  ).rejects.toBe(reason);
  expect(metrics.snapshot().outcomes[2]?.count).toBe(1);
  bindDatabaseConnection({
    async unsafe() {
      return [];
    },
    async begin(run) {
      return run(this);
    },
  });
  await expect(runInTransaction(async () => {}, { acquisitionMetrics: metrics })).rejects.toThrow(
    "observable transaction acquisition",
  );
  expect(metrics.snapshot().outcomes.map((state) => state.count)).toEqual([0, 0, 1]);
});

test("business failure and admission cancellation after successful reservation do not become checkout failures", async () => {
  const metrics = createTransactionAcquisitionMetrics();
  const controller = new AbortController();
  const calls = fixture(async () => {
    controller.abort();
  });
  await expect(
    runInTransaction(async () => {}, {
      acquisitionMetrics: metrics,
      acquisitionSignal: controller.signal,
    }),
  ).rejects.toBeDefined();
  expect(calls).toEqual(["reserve", "release"]);
  fixture();
  await expect(
    runInTransaction(
      async () => {
        throw new Error("business");
      },
      { acquisitionMetrics: metrics },
    ),
  ).rejects.toThrow("business");
  expect(metrics.snapshot().outcomes.map((state) => state.count)).toEqual([2, 0, 0]);
});

test("concurrent waits have fixed bookkeeping and snapshot mutation cannot corrupt state", async () => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const metrics = createTransactionAcquisitionMetrics();
  const waits = Array.from({ length: 25 }, () =>
    observeTransactionAcquisition(metrics, () => held),
  );
  expect(metrics.snapshot().inflight).toBe(25);
  release();
  await Promise.all(waits);
  const snapshot = metrics.snapshot();
  expect(snapshot.inflight).toBe(0);
  expect(snapshot.outcomes[0]?.count).toBe(25);
  Object.assign(snapshot.outcomes[0] ?? {}, { count: 999 });
  Object.assign(snapshot.outcomes[0]?.buckets ?? [], { 0: 999 });
  expect(metrics.snapshot().outcomes[0]?.count).toBe(25);
  expect(metrics.snapshot().outcomes[0]?.buckets[0]).not.toBe(999);
  expect(createTransactionAcquisitionMetrics().snapshot().outcomes[0]?.count).toBe(0);
  await expect(
    observeTransactionAcquisition({ snapshot: metrics.snapshot } as never, async () => {}),
  ).rejects.toThrow("framework factory");
});

test("sustained observations use cumulative fixed buckets and fixed scrape cardinality", async () => {
  const metrics = createTransactionAcquisitionMetrics();
  const zero = renderTransactionAcquisitionMetrics(metrics.snapshot());
  for (let i = 0; i < 10000; i++) await observeTransactionAcquisition(metrics, async () => i);
  const state = metrics.snapshot().outcomes[0];
  expect(state?.count).toBe(10000);
  expect(state?.buckets).toHaveLength(12);
  let previous = 0;
  for (const value of state?.buckets ?? []) {
    expect(value).toBeGreaterThanOrEqual(previous);
    previous = value;
  }
  const text = renderTransactionAcquisitionMetrics(metrics.snapshot());
  expect(text.split("\n").length).toBe(zero.split("\n").length);
  expect(text).toContain('outcome="acquired",le="+Inf"} 10000');
  expect(text).not.toContain("tenant");
});

test("authenticated scrapes read local counters without acquiring connections, failures preserve HTTP", async () => {
  const previous = process.env.METRICS_TOKEN;
  process.env.METRICS_TOKEN = "metrics-test";
  let reads = 0;
  const metrics = createTransactionAcquisitionMetrics();
  const routes = createMetricsRoutes({
    transactionAcquisition: {
      snapshot() {
        reads++;
        return metrics.snapshot();
      },
    },
  });
  const request = () =>
    new Request("http://shop/metrics", { headers: { authorization: "Bearer metrics-test" } });
  try {
    expect((await routes["/metrics"](new Request("http://shop/metrics"))).status).toBe(404);
    expect(reads).toBe(0);
    expect(await (await routes["/metrics"](request())).text()).toContain(
      "strata_database_acquisition_collector_success 1",
    );
    expect(reads).toBe(1);
    const failure = createMetricsRoutes({
      transactionAcquisition: {
        snapshot() {
          throw new Error("private URL");
        },
      },
    });
    const response = await failure["/metrics"](request());
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("http_requests_total");
    expect(text).toContain("strata_database_acquisition_collector_success 0");
    expect(text).not.toContain("private URL");
    expect(text).not.toContain("strata_database_transaction_acquisition_inflight");
  } finally {
    if (previous === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = previous;
  }
});

test("invalid observation snapshots fail closed, including label and bucket injection", () => {
  const fresh = () => createTransactionAcquisitionMetrics().snapshot();
  for (const inflight of [-1, Infinity, NaN, 0.5])
    expect(() => renderTransactionAcquisitionMetrics({ ...fresh(), inflight })).toThrow(
      "Invalid transaction acquisition metrics",
    );
  expect(() => renderTransactionAcquisitionMetrics({ ...fresh(), outcomes: [] })).toThrow();
  const valid = fresh();
  const first = valid.outcomes[0];
  if (!first) throw new Error("Missing fixed histogram");
  for (const invalid of [
    { ...first, outcome: 'secret"injection' },
    { ...first, count: -1 },
    { ...first, sumSeconds: NaN },
    { ...first, sumSeconds: -1 },
    { ...first, buckets: [] },
    { ...first, buckets: [1, ...first.buckets.slice(1)] },
    { ...first, buckets: [NaN, ...first.buckets.slice(1)] },
    { ...first, count: 2, buckets: [2, 1, ...first.buckets.slice(2)] },
  ])
    expect(() =>
      renderTransactionAcquisitionMetrics({
        ...valid,
        outcomes: [invalid, ...valid.outcomes.slice(1)],
      } as never),
    ).toThrow();
});
