import { afterEach, expect, test } from "bun:test";
import { CORE_TRACING_RUNTIME_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { LifecycleCoordinator } from "@getstrata/core/lifecycle/gracefulShutdown";
import { currentTraceId } from "@getstrata/core/tracing/traceContext";
import {
  createTracingMiddleware,
  createTracingRuntime,
  type TracingRuntime,
} from "@getstrata/core/tracing/tracingMiddleware";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { ConfigStore, type ProviderContext, ServiceContainer } from "../../src/bootstrap/contracts";
import { createTracingProvider } from "../../src/bootstrap/providers/tracing";

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

test("interleaved application tracing providers own exporters, config, flush and shutdown", async () => {
  const exporterA = new InMemorySpanExporter();
  const exporterB = new InMemorySpanExporter();
  const env = { OTEL_SERVICE_NAME: "app-a", OTEL_SDK_DISABLED: "false" };
  const providerA = createTracingProvider({
    exporter: exporterA,
    env,
    scheduledDelayMillis: 60_000,
  });
  env.OTEL_SERVICE_NAME = "app-b";
  const providerB = createTracingProvider({
    exporter: exporterB,
    env,
    scheduledDelayMillis: 60_000,
  });
  env.OTEL_SDK_DISABLED = "true";
  function registration() {
    const handlers: Array<{ callback: () => void | Promise<void>; phase: string }> = [];
    const container = new ServiceContainer();
    const context: ProviderContext = {
      container,
      config: new ConfigStore(),
      dependencies: { container },
      invoke: () => {
        throw new Error("No persistence in telemetry test.");
      },
      onCleanup(callback, phase = "close") {
        handlers.push({ callback, phase });
      },
    };
    return { container, context, handlers };
  }
  const appA = registration();
  const appB = registration();
  await providerA.register?.(appA.context);
  await providerB.register?.(appB.context);
  const runtimeA = appA.container.resolve(CORE_TRACING_RUNTIME_TOKEN);
  const runtimeB = appB.container.resolve(CORE_TRACING_RUNTIME_TOKEN);
  runtimes.push(runtimeA, runtimeB);
  expect(runtimeA).not.toBe(runtimeB);
  expect(() => providerA.register?.(appB.context)).toThrow("one application context");
  expect(appB.container.resolve(CORE_TRACING_RUNTIME_TOKEN)).toBe(runtimeB);
  const middlewareA = createTracingMiddleware(runtimeA);
  const middlewareB = createTracingMiddleware(runtimeB);
  await Promise.all([
    middlewareA(new Request("http://app-a/private?secret=a"), async () => new Response()),
    middlewareB(new Request("http://app-b/private?secret=b"), async () => new Response()),
  ]);
  const flushA = appA.handlers.find((handler) => handler.phase === "flush");
  const closeA = appA.handlers.find((handler) => handler.phase === "close");
  if (!flushA || !closeA) throw new Error("Missing telemetry lifecycle hooks.");
  await flushA.callback();
  expect(exporterA.getFinishedSpans()).toHaveLength(1);
  expect(exporterB.getFinishedSpans()).toHaveLength(0);
  expect(exporterA.getFinishedSpans()[0]?.resource.attributes["service.name"]).toBe("app-a");
  await closeA.callback();
  await closeA.callback();
  expect(runtimeA.metrics().active).toBe(false);
  expect(runtimeB.metrics().active).toBe(true);
  await middlewareB(new Request("http://app-b/still-live"), async () => new Response());
  await runtimeB.forceFlush();
  expect(exporterB.getFinishedSpans()).toHaveLength(2);
  expect(
    exporterB
      .getFinishedSpans()
      .every((span) => span.resource.attributes["service.name"] === "app-b"),
  ).toBe(true);
});

test("declared application collectors retain their own endpoint and SDK credentials before delayed startup", async () => {
  const received: Array<{ path: string; authorization: string | null }> = [];
  const collector = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      received.push({
        path: new URL(request.url).pathname,
        authorization: request.headers.get("authorization"),
      });
      await request.arrayBuffer();
      return Response.json({});
    },
  });
  const previous = process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS;
  const owned: TracingRuntime[] = [];
  try {
    const env = { OTEL_SDK_DISABLED: "false" };
    process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS = "authorization=Bearer%20app-a";
    const appA = createTracingProvider({
      env,
      endpoint: `http://127.0.0.1:${collector.port}/app-a`,
      scheduledDelayMillis: 60_000,
    });
    process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS = "authorization=Bearer%20app-b";
    const appB = createTracingProvider({
      env,
      endpoint: `http://127.0.0.1:${collector.port}/app-b`,
      scheduledDelayMillis: 60_000,
    });
    process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS = "authorization=Bearer%20later-app";
    async function start(provider: ReturnType<typeof createTracingProvider>) {
      const container = new ServiceContainer();
      await provider.register?.({
        container,
        config: new ConfigStore(),
        dependencies: { container },
        invoke: () => {
          throw new Error("No persistence.");
        },
        onCleanup() {},
      });
      const runtime = container.resolve(CORE_TRACING_RUNTIME_TOKEN);
      owned.push(runtime);
      return runtime;
    }
    const [runtimeA, runtimeB] = await Promise.all([start(appA), start(appB)]);
    await Promise.all([
      createTracingMiddleware(runtimeA)(new Request("http://a"), async () => new Response()),
      createTracingMiddleware(runtimeB)(new Request("http://b"), async () => new Response()),
    ]);
    await runtimeA.forceFlush();
    await runtimeA.shutdown();
    await runtimeB.forceFlush();
    expect(received.sort((left, right) => left.path.localeCompare(right.path))).toEqual([
      { path: "/app-a", authorization: "Bearer app-a" },
      { path: "/app-b", authorization: "Bearer app-b" },
    ]);
    expect(runtimeB.metrics().active).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS;
    else process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS = previous;
    await Promise.allSettled(owned.map((runtime) => runtime.shutdown()));
    collector.stop(true);
  }
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
  const accepted = Promise.withResolvers<void>();
  const collector = Bun.serve({
    port: 0,
    async fetch(request) {
      await request.text();
      requests++;
      accepted.resolve();
      await blocked;
      return new Response(null);
    },
  });
  const runtime = createTracingRuntime({
    endpoint: new URL("/v1/traces", collector.url).href,
    // Leave transport startup room under coverage; the external deadline remains bounded.
    exportTimeoutMillis: 500,
  });
  runtimes.push(runtime);
  let shutdownMillis = 0;
  try {
    const response = await createTracingMiddleware(runtime)(
      new Request("http://shop"),
      async () => new Response("available"),
    );
    expect(await response.text()).toBe("available");
    const started = performance.now();
    let flushSettled = false;
    const flushed = runtime.forceFlush().then(
      () => {
        flushSettled = true;
        return { failed: false };
      },
      () => {
        flushSettled = true;
        return { failed: true };
      },
    );
    // Establish the outage before checking availability. A timeout before acceptance
    // cannot prove that an application request survived a stalled HTTP collector.
    expect(
      await Promise.race([accepted.promise.then(() => "accepted"), flushed.then(() => "settled")]),
    ).toBe("accepted");
    const duringOutage = await createTracingMiddleware(runtime)(
      new Request("http://shop/during-outage"),
      async () => new Response("still available"),
    );
    expect(await duringOutage.text()).toBe("still available");
    expect(flushSettled).toBe(false);
    expect(requests).toBe(1);
    expect(await flushed).toEqual({ failed: true });
    // The processor timeout can precede transport cancellation. Wait for its
    // completion before shutdown exports the request served during the outage.
    while (runtime.metrics().failedBatches === 0 && performance.now() - started < 1500) {
      await Bun.sleep(5);
    }
    expect(runtime.metrics().failedBatches).toBe(1);
    expect(runtime.metrics().flushFailures).toBe(1);
    expect(runtime.metrics().exportDeadlineExceededBatches).toBe(1);
    // The request served during the outage is retained for the shutdown flush.
    expect(runtime.metrics().queueSize).toBe(1);
    expect(performance.now() - started).toBeLessThan(1500);
  } finally {
    unblock();
    const closing = performance.now();
    try {
      await runtime.shutdown();
      shutdownMillis = performance.now() - closing;
    } finally {
      await collector.stop(true);
    }
  }
  expect(runtime.metrics().active).toBe(false);
  expect(runtime.metrics().queueSize).toBeNull(); // SDK unregisters its queue callback.
  expect(runtime.metrics().exportedSpans).toBe(1);
  expect(requests).toBe(2);
  expect(shutdownMillis).toBeLessThan(1500);
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
