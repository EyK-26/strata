import { expect, test } from "bun:test";
import { createMetricsRoutes, createMetricsRuntime } from "@getstrata/bootstrap/metricsRoutes";
import { createTransactionAcquisitionMetrics } from "@getstrata/core/database/transaction";
import { getTracingRuntime } from "@getstrata/core/tracing/tracingMiddleware";
import { restoreEnvVar } from "../helpers/restoreEnv";

test("metrics runtime defaults remain HTTP-only and closing is idempotent", async () => {
  const runtime = createMetricsRuntime();
  expect(Object.values(runtime.options).every((value) => value === undefined)).toBe(true);
  expect(Object.isFrozen(runtime.options)).toBe(true);
  const first = runtime.close();
  expect(runtime.close()).toBe(first);
  await first;
});

test("metrics runtime owns only lazy SQL collectors and borrows tracing/acquisition", async () => {
  const previous = process.env.METRICS_TOKEN;
  process.env.METRICS_TOKEN = "runtime-fixture";
  try {
    const tracing = getTracingRuntime();
    const acquisition = createTransactionAcquisitionMetrics();
    const queue = { redisUrl: "redis://127.0.0.1:1", transport: "streams" as const, timeoutMs: 1 };
    const runtime = createMetricsRuntime({
      outbox: {},
      failedJobs: {},
      queue,
      tracing,
      transactionAcquisition: acquisition,
    });
    expect(runtime.options.tracing).toBe(tracing);
    expect(runtime.options.transactionAcquisition).toBe(acquisition);
    expect(runtime.options.queue).toEqual(queue);
    expect(runtime.options.queue).not.toBe(queue);
    // No collection, schema mutation, tracing initialization or connection is needed to close.
    await runtime.close();
    await expect(runtime.options.outbox?.collect()).rejects.toThrow("closed");
    await expect(runtime.options.failedJobs?.collect()).rejects.toThrow("closed");
    expect(acquisition.snapshot().inflight).toBe(0);
    const routes = createMetricsRoutes(runtime.options);
    const response = await routes["/metrics"](
      new Request("http://localhost/metrics", {
        headers: { authorization: "Bearer runtime-fixture" },
      }),
    );
    const body = await response.text();
    expect(body).toContain("strata_outbox_collector_success 0");
    expect(body).toContain("strata_queue_failed_job_collector_success 0");
    expect(body).toContain("strata_database_acquisition_collector_success 1");
    expect(body).not.toContain(queue.redisUrl);
  } finally {
    restoreEnvVar("METRICS_TOKEN", previous);
  }
});

test("invalid SQL options fail before I/O", () => {
  expect(() => createMetricsRuntime({ outbox: { sampleLimit: 0 } })).toThrow();
  expect(() => createMetricsRuntime({ outbox: {}, failedJobs: { timeoutMs: 0 } })).toThrow();
});
