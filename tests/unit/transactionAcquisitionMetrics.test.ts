import { expect, test } from "bun:test";
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";
import { resourceService } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import {
  createTransactionAcquisitionMetrics,
  observeTransactionAcquisition,
  renderTransactionAcquisitionMetrics,
} from "@getstrata/core/database/acquisitionMetrics";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type { RawPool } from "@getstrata/core/database/driverPorts";
import { PersistenceError } from "@getstrata/core/database/errors";
import { createRawPostgresPoolFromNative } from "@getstrata/core/database/rawPostgres";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";

// Synthetic native replies exercise the existing PG adapter+owner; not native acceptance.
async function fixture(
  work: (f: {
    calls: string[];
    run: <T>(body: (database: DatabaseSession) => T | Promise<T>) => Promise<T>;
  }) => Promise<void>,
  acquire?: () => Promise<void>,
  unsupported = false,
) {
  const calls: string[] = [];
  const native = {
    async unsafe(text: string) {
      calls.push(text);
      return Object.assign([], {
        command: text.startsWith("ROLLBACK")
          ? "ROLLBACK"
          : text.startsWith("RELEASE")
            ? "RELEASE"
            : text.startsWith("SAVEPOINT")
              ? "SAVEPOINT"
              : text,
      });
    },
    async reserve() {
      calls.push("reserve");
      await acquire?.();
      return {
        ...native,
        release() {
          calls.push("release");
        },
        async close() {
          calls.push("discard");
        },
      };
    },
    async close() {
      calls.push("pool.close");
    },
  };
  const declarations = createDatabaseBindings({
    default: "main",
    connections: { main: { driver: "sqlite", filename: ":memory:" } },
  });
  const resource = declarations.find((item) => item.kind === "resource");
  if (resource?.kind !== "resource") throw Error("Missing resource");
  const app = createApplication({
    providers: [],
    services: declarations,
    overrides: unsupported
      ? []
      : [
          resourceService(resource.token as ServiceToken<RawPool>, {
            lifetime: "application",
            dependencies: resource.dependencies,
            create: () => ({
              name: "synthetic-native-PG",
              open: () => ({ ok: true, value: createRawPostgresPoolFromNative(native) }),
              close: (pool) => pool.close(),
            }),
          }),
        ],
  });
  const failures: unknown[] = [];
  try {
    await app.start();
    await work({
      calls,
      run: (body) => app.run((scope) => body(scope.resolve(DATABASE_SESSION_TOKEN))),
    });
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      const stop = await app.stop();
      if (!stop.successful)
        failures.push(new Error("Metric fixture cleanup failed", { cause: stop }));
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Metric fixture and cleanup failed");
}
function exactCause(error: unknown, marker: unknown): boolean {
  if (error === marker) return true;
  if (error instanceof AggregateError)
    return error.errors.length > 0 && error.errors.every((item) => exactCause(item, marker));
  return (
    error instanceof PersistenceError &&
    Object.hasOwn(error, "cause") &&
    exactCause(error.cause, marker)
  );
}

test("measured canonical checkout releases once, excludes business duration and nested savepoints", async () => {
  const metrics = createTransactionAcquisitionMetrics();
  await fixture(async ({ calls, run }) => {
    await run((database) =>
      database.transaction(
        async (selected) => {
          const before = metrics.snapshot();
          expect(before.inflight).toBe(0);
          expect(before.outcomes[0]?.count).toBe(1);
          await Bun.sleep(20);
          await selected.transaction((child) =>
            child.execute({ text: "SELECT nested", params: [] }),
          );
          await selected.execute({ text: "SELECT outer", params: [] });
          expect(metrics.snapshot()).toEqual(before);
        },
        { acquisitionMetrics: metrics },
      ),
    );
    expect(calls.filter((call) => call === "reserve")).toHaveLength(1);
    expect(calls.filter((call) => call === "release")).toHaveLength(1);
    expect(calls.some((call) => call.startsWith("SAVEPOINT "))).toBe(true);
  });
});
test("canonical native checkout failure retains exact infrastructure cause and failed duration", async () => {
  const marker = new Error("connection-secret");
  const metrics = createTransactionAcquisitionMetrics();
  await fixture(
    async ({ calls, run }) => {
      let failure: unknown;
      try {
        await run((database) => database.transaction(() => {}, { acquisitionMetrics: metrics }));
      } catch (error) {
        failure = error;
      }
      expect(exactCause(failure, marker)).toBe(true);
      expect(metrics.snapshot().inflight).toBe(0);
      expect(metrics.snapshot().outcomes[1]?.count).toBe(1);
      expect(calls).toEqual(["reserve"]);
      expect(renderTransactionAcquisitionMetrics(metrics.snapshot())).not.toContain("secret");
    },
    async () => {
      throw marker;
    },
  );
});
test("canonical cancelled wait is observed; pre-abort and unsupported admission do not count checkout", async () => {
  const controller = new AbortController();
  const marker = new Error("abort-secret");
  const metrics = createTransactionAcquisitionMetrics();
  await fixture(
    async ({ run, calls }) => {
      let failure: unknown;
      try {
        await run((database) =>
          database.transaction(() => {}, {
            acquisitionMetrics: metrics,
            acquisitionSignal: controller.signal,
          }),
        );
      } catch (error) {
        failure = error;
      }
      expect(controller.signal.aborted).toBe(true);
      expect(exactCause(failure, marker)).toBe(true);
      expect(metrics.snapshot().outcomes[2]?.count).toBe(1);
      await expect(
        run((database) =>
          database.transaction(() => {}, {
            acquisitionMetrics: metrics,
            acquisitionSignal: controller.signal,
          }),
        ),
      ).rejects.toBe(marker);
      expect(metrics.snapshot().outcomes[2]?.count).toBe(1);
      expect(calls).toEqual(["reserve"]);
    },
    async () => {
      controller.abort(marker);
      throw marker;
    },
  );
  await fixture(
    async ({ run, calls }) => {
      await expect(
        run((database) => database.transaction(() => {}, { acquisitionMetrics: metrics })),
      ).rejects.toMatchObject({ code: "DATABASE_UNSUPPORTED_CAPABILITY" });
      expect(calls).toEqual([]);
      expect(metrics.snapshot().outcomes.map((state) => state.count)).toEqual([0, 0, 1]);
    },
    undefined,
    true,
  );
});
test("canonical admission cancellation and business failure after checkout remain acquired observations", async () => {
  const metrics = createTransactionAcquisitionMetrics();
  const controller = new AbortController();
  const cancellation = new Error("cancelled before callback");
  await fixture(
    async ({ run, calls }) => {
      await expect(
        run((database) =>
          database.transaction(
            () => {
              throw Error("must not admit");
            },
            { acquisitionMetrics: metrics, acquisitionSignal: controller.signal },
          ),
        ),
      ).rejects.toBe(cancellation);
      expect(calls).toEqual(["reserve", "BEGIN", "ROLLBACK", "release"]);
      expect(metrics.snapshot().outcomes.map((state) => state.count)).toEqual([1, 0, 0]);
    },
    async () => {
      controller.abort(cancellation);
    },
  );
  await fixture(async ({ run, calls }) => {
    const marker = new Error("business");
    await expect(
      run((database) =>
        database.transaction(
          () => {
            throw marker;
          },
          { acquisitionMetrics: metrics },
        ),
      ),
    ).rejects.toBe(marker);
    expect(calls).toEqual(["reserve", "BEGIN", "ROLLBACK", "release"]);
    expect(metrics.snapshot().outcomes.map((state) => state.count)).toEqual([2, 0, 0]);
  });
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
