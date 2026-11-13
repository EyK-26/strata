# Tracing on Bun

Strata HTTP tracing uses the maintained OpenTelemetry JS SDK with manual instrumentation of the framework's Bun handlers. It does not rely on Node HTTP auto-instrumentation to intercept `Bun.serve`. The SDK creates the trace/span identity, epoch timestamps and sampling decision; the W3C propagator extracts valid `traceparent`/`tracestate` and injects the same identity into response headers. Invalid context becomes a new root. The old debug `x-trace-id` input no longer selects an identity. `currentTraceId()` and the response's `x-trace-id`/`x-span-id` agree with the server span.

Span names and `http.route` use the registered route template, or `__unmatched__`. Nonstandard methods use `_OTHER`. Custom dispatchers must supply a trusted registered template through request metadata, just as for metrics. Request URLs, query strings, bodies, cookies, authorization, baggage and exception messages/stacks are not recorded by the framework. W3C trace context remains vendor correlation data; applications control any additional attributes/events they add. HTTP 5xx and thrown errors set ERROR; other HTTP responses retain the SDK's UNSET status. A span ends when the handler produces its response, not when a streaming client finishes reading the body.

## Configuration

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the trusted collector's base HTTP(S) URL (Strata appends `/v1/traces`), or set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to the exact traces endpoint. Private collectors are supported in production. Endpoint configuration is administrator-owned, never request input; embedded credentials, query strings and fragments are rejected. The official HTTP/JSON exporter owns transport, authentication headers and retry behavior. Use its supported `OTEL_EXPORTER_OTLP_HEADERS`/trace-specific header configuration for collector credentials. No endpoint means no exporter, network requests or batching timer; request correlation still works.

`OTEL_SERVICE_NAME` retains the existing default of `<APP_KEY_PREFIX>-api`. Supported `OTEL_TRACES_SAMPLER` values are `always_on`, `always_off`, `traceidratio` and their `parentbased_` forms. The default is `parentbased_traceidratio`, with root ratio `OTEL_TRACES_SAMPLER_ARG` defaulting to 1. Parent-based modes preserve remote sampling decisions. `OTEL_SDK_DISABLED=true` prevents export and recording. Unsupported sampler names and invalid bounds fail initialization visibly.

`createTracingRuntime(options)` accepts an exporter or exact endpoint, service name, root sample ratio and bounded batch controls. An explicit `sampleRatio` selects parent-based ratio sampling. Defaults: queue 2,048 spans; batch 512; delay 5,000 ms; export/flush timeout 5,000 ms; HTTP exporter concurrency one. Queue/batch bounds must be positive integers at most 1,000,000, batch cannot exceed queue; delay/timeout must be positive integers at most 60,000 ms. Span attributes are capped at 16 and 256 characters per value; events/links at eight. The SDK drops excess queued spans during overload: telemetry is best effort, not a durable business event channel. Opt-in health observations expose SDK queue/drop signals and exporter outcomes; see [runtime metrics](RUNTIME-METRICS.md#opt-in-tracing-health). Additional SDK diagnostics remain application-owned. Flush failures reach the lifecycle coordinator and make shutdown unsuccessful; its hard deadline remains the outer bound.

## Lifecycle and application instrumentation

Current generated provider lists call `createTracingProvider({ env })` from `@getstrata/bootstrap`; the default core provider factory does the same. Each context receives its own runtime/exporter and registers `forceFlush` in the flush phase and idempotent shutdown in close. Stopping one context never shuts down another context’s tracing. HTTP/workers drain before flushing. Set `SHUTDOWN_TIMEOUT_MS` above your intended flush budget.

Each returned provider is single-use; create a fresh provider for every context. Reusing a provider rejects before it can attach or close another context’s exporter. An explicitly supplied exporter also belongs to that one context and must not be shared with another provider.

The factory captures environment configuration when the application declares its providers. Default OTLP exporter transport configuration (including SDK environment credentials and TLS settings) is prepared then; batch processing and runtime acquisition begin during provider registration. The exporter makes no network requests until spans are exported. Supply an application-owned `exporter` when using a transport configuration independent of the current process environment. The provider publishes its runtime as `CORE_TRACING_RUNTIME_TOKEN` in that context’s container. HttpKernel traces only when this provider is installed; custom contexts without it explicitly run untraced. Middleware callers must supply their owned runtime; there is no global default runtime or owner counter.

For an explicit runtime, pass it to the middleware and register its ownership yourself:

```ts
import { createTracingMiddleware, createTracingRuntime } from "@getstrata/core/tracing/tracingMiddleware";
import { LifecycleCoordinator } from "@getstrata/core/lifecycle/gracefulShutdown";
const lifecycle = new LifecycleCoordinator();
const runtime = createTracingRuntime({ sampleRatio: 0.1, maxQueueSize: 1024 });
const middleware = createTracingMiddleware(runtime);
// Register after stopping/draining admitted work:
lifecycle.register("traces", () => runtime.forceFlush(), "flush");
lifecycle.register("traces-close", () => runtime.shutdown(), "close");
```

The runtime installs a shared asynchronous API context manager only if the application has not installed one. It does not register or replace the global tracer provider or propagator. `trace.getSpan(context.active())` exposes the active server span to existing instrumentation. Use your owned `runtime.tracer` for manually instrumented child spans exported with this provider, ending each span in `finally`. When using the provider, resolve its runtime through `container.resolve(CORE_TRACING_RUNTIME_TOKEN)`; import the token from `@getstrata/core/contracts/serviceTokens`. An application with its own global SDK retains ownership of that SDK's exports and shutdown. No automatic SQL, queue, scheduler or outbound-fetch spans are claimed by this integration. The compatibility `runWithTraceContext` helper still supplies framework log correlation; it does not create OpenTelemetry spans.

The Bun regression suite verifies actual HTTP/JSON collector output, timestamps/parent IDs, concurrent context, sampling, child spans, request-secret redaction, bounded backlog, real collector timeout and lifecycle flushing. Additional Node instrumentation must be qualified separately on Bun.

References: [OpenTelemetry JS instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/), [SDK environment configuration](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/), [OTLP HTTP exporter](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/exporter-trace-otlp-http).
