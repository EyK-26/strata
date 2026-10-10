import { expect, test } from "bun:test";
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";
import {
  createTracingRuntime,
  renderTracingMetrics,
} from "@getstrata/core/tracing/tracingMiddleware";
import { createNoopMeter } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import { InMemorySpanExporter, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { createTracingHealth } from "../../src/core/tracing/health";

const span = (runtime: ReturnType<typeof createTracingRuntime>) =>
  runtime.tracer.startSpan("secret").end();

test("SDK queue self-observations report occupancy, overflow and draining without retaining labels", async () => {
  let acknowledge: Parameters<SpanExporter["export"]>[1] = () => {};
  const runtime = createTracingRuntime({
    exporter: {
      export(_spans, callback) {
        acknowledge = callback;
      },
      async shutdown() {},
    },
    maxQueueSize: 4,
    maxExportBatchSize: 4,
    scheduledDelayMillis: 60_000,
  });
  try {
    for (let i = 0; i < 4; i++) span(runtime); // First batch is in flight.
    for (let i = 0; i < 10000; i++) span(runtime);
    expect(runtime.metrics().queueSize).toBe(4);
    expect(runtime.metrics().queueCapacity).toBe(4);
    expect(runtime.metrics().droppedSpans).toBe(9996);
    const output = renderTracingMetrics(runtime.metrics());
    expect(output).not.toContain("secret");
    expect(output).not.toContain("otel.component");
    expect(output.split("\n").length).toBeLessThan(50);
    acknowledge({ code: ExportResultCode.SUCCESS });
    await Bun.sleep(1);
    acknowledge({ code: ExportResultCode.SUCCESS });
    await runtime.forceFlush();
    expect(runtime.metrics().queueSize).toBe(0);
    expect(runtime.metrics().exportedBatches).toBe(2);
    expect(runtime.metrics().exportedSpans).toBe(8);
  } finally {
    await runtime.shutdown();
  }
  expect(runtime.metrics().active).toBe(false);
  expect(runtime.metrics().queueSize).toBeNull();
});

test("export callback deadline is distinct from a later success and duplicate callbacks", async () => {
  const health = createTracingHealth(true, true, 10);
  let acknowledge: Parameters<SpanExporter["export"]>[1] = () => {};
  let callbacks = 0;
  let flushes = 0;
  let closes = 0;
  const wrapped = health.wrap({
    export(_spans, callback) {
      acknowledge = callback;
    },
    async forceFlush() {
      flushes++;
    },
    async shutdown() {
      closes++;
    },
  });
  wrapped.export([], () => {
    callbacks++;
  });
  await Bun.sleep(20);
  expect(health.snapshot().exportDeadlineExceededBatches).toBe(1);
  expect(health.snapshot().failedBatches).toBe(0);
  acknowledge({ code: ExportResultCode.SUCCESS });
  acknowledge({ code: ExportResultCode.FAILED, error: new Error("secret") });
  expect(health.snapshot().exportedBatches).toBe(1);
  expect(health.snapshot().failedBatches).toBe(0);
  expect(callbacks).toBe(1);
  await wrapped.forceFlush?.();
  await wrapped.shutdown();
  expect([flushes, closes]).toEqual([1, 1]);
});

test("export failures, synchronous throws and shutdown rejection are bounded and redacted", async () => {
  let attempt = 0;
  const runtime = createTracingRuntime({
    exporter: {
      export(_spans, callback) {
        if (++attempt === 1)
          callback({ code: ExportResultCode.FAILED, error: new Error("token-secret") });
        else throw new Error("token-secret");
      },
      async shutdown() {
        throw new Error("token-secret");
      },
    },
    scheduledDelayMillis: 60_000,
  });
  span(runtime);
  await expect(runtime.forceFlush()).rejects.toBeDefined();
  span(runtime);
  await expect(runtime.forceFlush()).rejects.toBeDefined();
  const before = runtime.metrics();
  expect(before.failedBatches).toBe(2);
  expect(before.failedSpans).toBe(2);
  expect(before.flushFailures).toBe(2);
  await expect(runtime.shutdown()).rejects.toThrow("token-secret");
  await expect(runtime.shutdown()).rejects.toThrow("token-secret");
  expect(runtime.metrics().shutdownFailures).toBe(1);
  expect(runtime.metrics().active).toBe(false);
  expect(renderTracingMetrics(runtime.metrics())).not.toContain("secret");
});

test("authenticated opt-in scrapes observe existing runtime without exporting or flushing", async () => {
  const previous = process.env.METRICS_TOKEN;
  process.env.METRICS_TOKEN = "test-token";
  const exporter = new InMemorySpanExporter();
  const runtime = createTracingRuntime({ exporter, scheduledDelayMillis: 60_000 });
  const routes = createMetricsRoutes({ tracing: runtime });
  try {
    span(runtime);
    expect((await routes["/metrics"](new Request("http://shop/metrics"))).status).toBe(404);
    const response = await routes["/metrics"](
      new Request("http://shop/metrics", { headers: { authorization: "Bearer test-token" } }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("strata_tracing_queue_size 1\n");
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    const broken = createMetricsRoutes({
      tracing: {
        metrics() {
          throw new Error("secret");
        },
      },
    });
    const failed = await broken["/metrics"](
      new Request("http://shop/metrics", { headers: { authorization: "Bearer test-token" } }),
    );
    expect(failed.status).toBe(200);
    const text = await failed.text();
    expect(text).toContain("strata_tracing_collector_success 0");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("strata_tracing_queue_size");
  } finally {
    await runtime.shutdown();
    if (previous === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = previous;
  }
});

test("missing exporter and SDK-disabled configurations omit unavailable queue measurements", async () => {
  const previous = {
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    traces: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    disabled: process.env.OTEL_SDK_DISABLED,
  };
  try {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    const runtime = createTracingRuntime();
    expect(runtime.metrics().exporterConfigured).toBe(false);
    expect(runtime.metrics().enabled).toBe(true);
    expect(renderTracingMetrics(runtime.metrics())).not.toContain("strata_tracing_queue_size");
    await runtime.shutdown();
    process.env.OTEL_SDK_DISABLED = "true";
    const disabled = createTracingRuntime({ exporter: new InMemorySpanExporter() });
    expect(disabled.metrics().enabled).toBe(false);
    expect(disabled.metrics().exporterConfigured).toBe(false);
    await disabled.shutdown();
  } finally {
    for (const [name, value] of Object.entries({
      OTEL_EXPORTER_OTLP_ENDPOINT: previous.endpoint,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: previous.traces,
      OTEL_SDK_DISABLED: previous.disabled,
    }))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
});

test("projection ignores unknown SDK instruments, bounds callbacks and rejects invalid snapshots", () => {
  const health = createTracingHealth(true, true, 10);
  const meter = health.meterProvider.getMeter("sdk");
  meter.createCounter("unknown").add(1);
  meter.createUpDownCounter("unknown").add(1);
  meter.createObservableUpDownCounter("unknown").addCallback(() => {});
  const queue = meter.createObservableUpDownCounter("otel.sdk.processor.span.queue.size");
  const callback = () => {};
  queue.addCallback(callback);
  queue.removeCallback(() => {});
  queue.removeCallback(callback);
  expect(health.snapshot().queueSize).toBeNull();
  const valid = health.snapshot();
  for (const enabled of ["true", null])
    expect(() => renderTracingMetrics({ ...valid, enabled } as never)).toThrow(
      "Invalid tracing metrics",
    );
  for (const value of [-1, Infinity, NaN, 0.5, null])
    expect(() => renderTracingMetrics({ ...valid, failedSpans: value } as never)).toThrow(
      "Invalid tracing metrics",
    );
});

test("SDK no-op meter remains untouched across multiple runtime projections", () => {
  const noop = createNoopMeter();
  const before = noop.createCounter;
  const first = createTracingHealth(true, true, 10);
  const second = createTracingHealth(true, true, 10);
  first.meterProvider
    .getMeter("sdk")
    .createCounter("otel.sdk.processor.span.processed")
    .add(3, { "error.type": "queue_full" });
  expect(first.snapshot().droppedSpans).toBe(3);
  expect(second.snapshot().droppedSpans).toBe(0);
  expect(noop.createCounter).toBe(before);
  noop.createCounter("unknown").add(1);
});

test("custom exporter error names cannot impersonate SDK queue overflow", async () => {
  const error = new Error("secret");
  error.name = "queue_full";
  const runtime = createTracingRuntime({
    exporter: {
      export(_spans, callback) {
        callback({ code: ExportResultCode.FAILED, error });
      },
      async shutdown() {},
    },
    scheduledDelayMillis: 60_000,
  });
  span(runtime);
  await expect(runtime.forceFlush()).rejects.toBeDefined();
  expect(runtime.metrics().failedSpans).toBe(1);
  expect(runtime.metrics().droppedSpans).toBe(0);
  await runtime.shutdown();
});
