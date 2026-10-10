import { afterEach, expect, test } from "bun:test";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { LifecycleCoordinator } from "@getstrata/core/lifecycle/gracefulShutdown";
import { currentTraceId } from "@getstrata/core/tracing/traceContext";
import {
  acquireTracingRuntime,
  createTracingMiddleware,
  createTracingRuntime,
  getTracingRuntime,
  type TracingRuntime,
} from "@getstrata/core/tracing/tracingMiddleware";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { ConfigStore, type ProviderContext, ServiceContainer } from "../../src/bootstrap/contracts";
import tracingProvider from "../../src/bootstrap/providers/tracing";

const runtimes: TracingRuntime[] = [];
afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.shutdown()));
});
function memory(options: Parameters<typeof createTracingRuntime>[0] = {}) {
  const exporter = new InMemorySpanExporter();
  const runtime = createTracingRuntime({ exporter, scheduledDelayMillis: 60_000, ...options });
  runtimes.push(runtime);
  return { runtime, exporter, middleware: createTracingMiddleware(runtime) };
}
const incoming = `00-${"a".repeat(32)}-${"b".repeat(16)}-01`;

test("Bun collector receives consistent W3C identities, epoch timestamps and server error status", async () => {
  const payloads: unknown[] = [];
  const collector = Bun.serve({
    port: 0,
    async fetch(request) {
      payloads.push(await request.json());
      return new Response(null);
    },
  });
  const runtime = createTracingRuntime({
    endpoint: new URL("/v1/traces", collector.url).href,
    serviceName: "test-shop",
    scheduledDelayMillis: 60_000,
  });
  runtimes.push(runtime);
  const before = Date.now();
  try {
    const response = await runWithRequestMeta(
      { ipAddress: null, userAgent: null, routeTemplate: "/orders/:id" },
      () =>
        createTracingMiddleware(runtime)(
          new Request("http://shop/orders/customer-secret?token=private", {
            headers: {
              traceparent: incoming,
              authorization: "Bearer private",
              cookie: "session=private",
              baggage: "secret=private",
            },
          }),
          async () => {
            expect(currentTraceId()).toBe("a".repeat(32));
            expect(trace.getSpan(context.active())?.spanContext().traceId).toBe("a".repeat(32));
            return new Response("private-body", { status: 500 });
          },
        ),
    );
    await runtime.forceFlush();
    const payload = payloads[0] as {
      resourceSpans: Array<{
        scopeSpans: Array<{
          spans: Array<{
            traceId: string;
            spanId: string;
            parentSpanId: string;
            startTimeUnixNano: string;
            endTimeUnixNano: string;
            status: { code: number };
            name: string;
          }>;
        }>;
      }>;
    };
    const span = payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    if (!span) throw new Error("Collector received no span.");
    expect(span.traceId).toBe("a".repeat(32));
    expect(span.parentSpanId).toBe("b".repeat(16));
    expect(response.headers.get("x-span-id")).toBe(span.spanId);
    expect(response.headers.get("traceparent")).toBe(`00-${span.traceId}-${span.spanId}-01`);
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.name).toBe("GET /orders/:id");
    expect(Number(BigInt(span.startTimeUnixNano) / 1_000_000n)).toBeGreaterThanOrEqual(before);
    expect(BigInt(span.endTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(span.startTimeUnixNano));
    expect(Number(BigInt(span.endTimeUnixNano) / 1_000_000n)).toBeLessThanOrEqual(Date.now());
    expect(JSON.stringify(payload)).not.toContain("private");
    expect(JSON.stringify(payload)).not.toContain("customer-secret");
  } finally {
    await runtime.shutdown();
    await collector.stop(true);
  }
});

test("parent-based sampling preserves unsampled parents; invalid context and x-trace-id cannot select identity", async () => {
  const { runtime, exporter, middleware } = memory({ sampleRatio: 0 });
  const root = await middleware(
    new Request("http://shop/anything", {
      headers: { traceparent: "invalid", "x-trace-id": "c".repeat(32) },
    }),
    async () => new Response(),
  );
  expect(root.headers.get("x-trace-id")).not.toBe("c".repeat(32));
  expect(root.headers.get("traceparent")?.endsWith("-00")).toBe(true);
  const unsampled = await middleware(
    new Request("http://shop", { headers: { traceparent: `${incoming.slice(0, -2)}00` } }),
    async () => new Response(),
  );
  expect(unsampled.headers.get("x-trace-id")).toBe("a".repeat(32));
  expect(unsampled.headers.get("traceparent")?.endsWith("-00")).toBe(true);
  await runtime.forceFlush();
  expect(exporter.getFinishedSpans()).toHaveLength(0);
  const sampled = await middleware(
    new Request("http://shop", { headers: { traceparent: incoming } }),
    async () => new Response(),
  );
  expect(sampled.headers.get("traceparent")?.endsWith("-01")).toBe(true);
  await runtime.forceFlush();
  expect(exporter.getFinishedSpans()).toHaveLength(1);
});

test("concurrent async handlers retain context, bounded names and exception redaction", async () => {
  const { runtime, exporter, middleware } = memory();
  await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      middleware(new Request(`http://shop/secret-${index}?password=secret`), async () => {
        const identity = currentTraceId();
        await Bun.sleep(index % 3);
        expect(currentTraceId()).toBe(identity);
        expect(identity ?? undefined).toBe(trace.getSpan(context.active())?.spanContext().traceId);
        return new Response();
      }),
    ),
  );
  await expect(
    middleware(new Request("http://shop"), async () => {
      throw new Error("password=secret");
    }),
  ).rejects.toThrow("password=secret");
  await runtime.forceFlush();
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(25);
  expect(new Set(spans.map((span) => span.name))).toEqual(new Set(["GET __unmatched__"]));
  expect(new Set(spans.map((span) => span.spanContext().traceId)).size).toBe(25);
  expect(spans.at(-1)?.status.code).toBe(SpanStatusCode.ERROR);
  expect(
    JSON.stringify(
      spans.map((span) => ({
        name: span.name,
        attributes: span.attributes,
        events: span.events,
        status: span.status,
      })),
    ),
  ).not.toContain("secret");
  expect(currentTraceId()).toBeNull();
});

test("bounded SDK queue drops excess work and flush times out during exporter outage", async () => {
  let exported = 0;
  let closed = 0;
  const exporter: SpanExporter = {
    export(spans) {
      exported += spans.length; /* Deliberately never acknowledge. */
    },
    async shutdown() {
      closed++;
    },
  };
  const runtime = createTracingRuntime({
    exporter,
    maxQueueSize: 4,
    maxExportBatchSize: 4,
    scheduledDelayMillis: 60_000,
    exportTimeoutMillis: 50,
  });
  runtimes.push(runtime);
  const middleware = createTracingMiddleware(runtime);
  const started = performance.now();
  for (let index = 0; index < 100; index++)
    await middleware(new Request("http://shop"), async () => new Response());
  await expect(runtime.forceFlush()).rejects.toBeDefined();
  expect(exported).toBeLessThanOrEqual(8); // At most one in-flight batch and one bounded queue.
  expect(performance.now() - started).toBeLessThan(1500);
  await runtime.shutdown().catch(() => {});
  await runtime.shutdown().catch(() => {});
  expect(closed).toBe(1);
});

test("shutdown flushes queued spans before resource close through the lifecycle phase", async () => {
  const { runtime, exporter, middleware } = memory();
  await middleware(new Request("http://shop"), async () => new Response());
  expect(exporter.getFinishedSpans()).toHaveLength(0);
  const lifecycle = new LifecycleCoordinator();
  lifecycle.register("telemetry", () => runtime.forceFlush(), "flush");
  lifecycle.register(
    "verify-flushed",
    () => {
      expect(exporter.getFinishedSpans()).toHaveLength(1);
    },
    "close",
  );
  lifecycle.register("telemetry-close", () => runtime.shutdown(), "close");
  expect((await lifecycle.shutdown()).successful).toBe(true);
});

test("core provider owns shared runtime flush and idempotent final release", async () => {
  const handlers: Array<{ callback: () => void | Promise<void>; phase: string }> = [];
  const otherOwner = acquireTracingRuntime();
  const runtime = getTracingRuntime();
  // Exercise the provider's cleanup contract directly without booting unrelated infrastructure.
  const container = new ServiceContainer();
  const registration: ProviderContext = {
    container,
    config: new ConfigStore(),
    dependencies: { container },
    onCleanup(callback, phase = "close") {
      handlers.push({ callback, phase });
    },
  };
  await tracingProvider.register?.(registration);
  expect(handlers.map((handler) => handler.phase)).toEqual(["flush", "close"]);
  const [flush, close] = handlers;
  if (!flush || !close) throw new Error("Provider did not register telemetry cleanup.");
  await flush.callback();
  await close.callback();
  await close.callback();
  expect(getTracingRuntime()).toBe(runtime);
  await otherOwner.release();
  await otherOwner.release();
  const next = acquireTracingRuntime();
  expect(getTracingRuntime()).not.toBe(runtime);
  await next.release();
});

test("invalid operational tracing configuration fails visibly", () => {
  for (const options of [
    { sampleRatio: -1 },
    { sampleRatio: Number.NaN },
    { maxQueueSize: 0 },
    { maxQueueSize: 4, maxExportBatchSize: 5 },
    { exportTimeoutMillis: Infinity },
    { endpoint: "file:///tmp/trace" },
    { endpoint: "http://user:password@collector" },
  ]) {
    expect(() => createTracingRuntime(options)).toThrow();
  }
});

test("local SDK child spans share request context without replacing the global provider", async () => {
  const globalProvider = trace.getTracerProvider();
  const { runtime, exporter, middleware } = memory();
  const response = await middleware(new Request("http://shop"), async () => {
    const child = runtime.tracer.startSpan("business-operation");
    expect(child.spanContext().traceId).toBe(currentTraceId() ?? "");
    child.end();
    return new Response();
  });
  await runtime.forceFlush();
  const child = exporter.getFinishedSpans().find((span) => span.name === "business-operation");
  expect(child?.parentSpanContext?.spanId ?? null).toBe(response.headers.get("x-span-id"));
  expect(trace.getTracerProvider()).toBe(globalProvider);
});

test("real HTTP collector outage times out, preserves request availability and closes cleanly", async () => {
  let requests = 0;
  let unblock: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const collector = Bun.serve({
    port: 0,
    async fetch(request) {
      await request.text();
      requests++;
      await blocked;
      return new Response(null);
    },
  });
  const runtime = createTracingRuntime({
    endpoint: new URL("/v1/traces", collector.url).href,
    exportTimeoutMillis: 75,
  });
  runtimes.push(runtime);
  try {
    const response = await createTracingMiddleware(runtime)(
      new Request("http://shop"),
      async () => new Response("available"),
    );
    expect(await response.text()).toBe("available");
    const started = performance.now();
    await expect(runtime.forceFlush()).rejects.toBeDefined();
    expect(requests).toBe(1);
    await Bun.sleep(10); // The callback-deadline observer may settle just after SDK timeout.
    expect(runtime.metrics().flushFailures).toBe(1);
    expect(runtime.metrics().exportDeadlineExceededBatches).toBe(1);
    expect(runtime.metrics().queueSize).toBe(0);
    expect(performance.now() - started).toBeLessThan(1500);
  } finally {
    unblock();
    await runtime.shutdown();
    await collector.stop(true);
  }
});

test("standard sampler and SDK-disabled settings are honored", async () => {
  const previous = {
    sampler: process.env.OTEL_TRACES_SAMPLER,
    disabled: process.env.OTEL_SDK_DISABLED,
  };
  try {
    process.env.OTEL_TRACES_SAMPLER = "always_off";
    const off = memory();
    const offResponse = await off.middleware(
      new Request("http://shop", { headers: { traceparent: incoming } }),
      async () => new Response(),
    );
    expect(offResponse.headers.get("traceparent")?.endsWith("-00")).toBe(true);
    await off.runtime.forceFlush();
    expect(off.exporter.getFinishedSpans()).toHaveLength(0);
    process.env.OTEL_TRACES_SAMPLER = "always_on";
    const on = memory();
    await on.middleware(new Request("http://shop"), async () => new Response());
    await on.runtime.forceFlush();
    expect(on.exporter.getFinishedSpans()).toHaveLength(1);
    process.env.OTEL_SDK_DISABLED = "true";
    const disabled = memory();
    await disabled.middleware(new Request("http://shop"), async () => new Response());
    await disabled.runtime.forceFlush();
    expect(disabled.exporter.getFinishedSpans()).toHaveLength(0);
    delete process.env.OTEL_SDK_DISABLED;
    process.env.OTEL_TRACES_SAMPLER = "unsupported";
    expect(() => createTracingRuntime()).toThrow("Unsupported tracing sampler");
  } finally {
    if (previous.sampler === undefined) delete process.env.OTEL_TRACES_SAMPLER;
    else process.env.OTEL_TRACES_SAMPLER = previous.sampler;
    if (previous.disabled === undefined) delete process.env.OTEL_SDK_DISABLED;
    else process.env.OTEL_SDK_DISABLED = previous.disabled;
  }
});
