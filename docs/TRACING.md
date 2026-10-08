# Tracing on Bun

Strata HTTP tracing uses the maintained OpenTelemetry JS SDK with manual instrumentation of the framework's Bun handlers. It does not rely on Node HTTP auto-instrumentation to intercept `Bun.serve`. The SDK creates the trace/span identity, epoch timestamps and sampling decision; the W3C propagator extracts valid `traceparent`/`tracestate` and injects the same identity into response headers. Invalid context becomes a new root. The old debug `x-trace-id` input no longer selects an identity. `currentTraceId()` and the response's `x-trace-id`/`x-span-id` agree with the server span.

Span names and `http.route` use the registered route template, or `__unmatched__`. Nonstandard methods use `_OTHER`. Custom dispatchers must supply a trusted registered template through request metadata, just as for metrics. Request URLs, query strings, bodies, cookies, authorization, baggage and exception messages/stacks are not recorded by the framework. W3C trace context remains vendor correlation data; applications control any additional attributes/events they add. HTTP 5xx and thrown errors set ERROR; other HTTP responses retain the SDK's UNSET status. A span ends when the handler produces its response, not when a streaming client finishes reading the body.

## Configuration

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the trusted collector's base HTTP(S) URL (Strata appends `/v1/traces`), or set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to the exact traces endpoint. Private collectors are supported in production. Endpoint configuration is administrator-owned, never request input; embedded credentials, query strings and fragments are rejected. The official HTTP/JSON exporter owns transport, authentication headers and retry behavior. Use its supported `OTEL_EXPORTER_OTLP_HEADERS`/trace-specific header configuration for collector credentials. No endpoint means no exporter, network requests or batching timer; request correlation still works.

`OTEL_SERVICE_NAME` retains the existing default of `<APP_KEY_PREFIX>-api`. Supported `OTEL_TRACES_SAMPLER` values are `always_on`, `always_off`, `traceidratio` and their `parentbased_` forms. The default is `parentbased_traceidratio`, with root ratio `OTEL_TRACES_SAMPLER_ARG` defaulting to 1. Parent-based modes preserve remote sampling decisions. `OTEL_SDK_DISABLED=true` prevents export and recording. Unsupported sampler names and invalid bounds fail initialization visibly.

`createTracingRuntime(options)` accepts an exporter or exact endpoint, service name, root sample ratio and bounded batch controls. An explicit `sampleRatio` selects parent-based ratio sampling. Defaults: queue 2,048 spans; batch 512; delay 5,000 ms; export/flush timeout 5,000 ms; HTTP exporter concurrency one. Queue/batch bounds must be positive integers at most 1,000,000, batch cannot exceed queue; delay/timeout must be positive integers at most 60,000 ms. Span attributes are capped at 16 and 256 characters per value; events/links at eight. The SDK drops excess queued spans during overload: telemetry is best effort, not a durable business event channel. Enable SDK diagnostics through the OpenTelemetry API in your application when operational drop/error reporting is needed. Flush failures reach the lifecycle coordinator and make shutdown unsuccessful; its hard deadline remains the outer bound.

## Lifecycle and application instrumentation

Current generated provider lists include the public `tracingProvider` from `@getstrata/bootstrap`. The default core provider list uses the same provider. It acquires the process-shared default runtime, registers `forceFlush` in the provider flush phase and releases it in close. The last release shuts down the provider/exporter; release and shutdown are idempotent. HTTP/workers drain before flushing. Set `SHUTDOWN_TIMEOUT_MS` above your intended flush budget. Applications with older generated lists can add `tracingProvider` after configuration and before admission; do not create a second exporter in a custom cleanup hook.

For an explicit runtime, pass it to the middleware and register its ownership yourself:

```ts
import { createTracingMiddleware, createTracingRuntime } from "@getstrata/core/tracing/tracingMiddleware";
const runtime = createTracingRuntime({ sampleRatio: 0.1, maxQueueSize: 1024 });
const middleware = createTracingMiddleware(runtime);
// Register after stopping/draining admitted work:
lifecycle.register("traces", () => runtime.forceFlush(), "flush");
lifecycle.register("traces-close", () => runtime.shutdown(), "close");
```

The runtime installs a shared asynchronous API context manager only if the application has not installed one. It does not register or replace the global tracer provider or propagator. `trace.getSpan(context.active())` exposes the active server span to existing instrumentation. Use `getTracingRuntime().tracer` (or your explicit runtime's tracer) for manually instrumented child spans exported with this provider, ending each span in `finally`. An application with its own global SDK retains ownership of that SDK's exports and shutdown. No automatic SQL, queue, scheduler or outbound-fetch spans are claimed by this integration. The compatibility `runWithTraceContext` helper still supplies framework log correlation; it does not create OpenTelemetry spans.

The Bun regression suite verifies actual HTTP/JSON collector output, timestamps/parent IDs, concurrent context, sampling, child spans, request-secret redaction, bounded backlog, real collector timeout and lifecycle flushing. Additional Node instrumentation must be qualified separately on Bun.

References: [OpenTelemetry JS instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/), [SDK environment configuration](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/), [OTLP HTTP exporter](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/exporter-trace-otlp-http).
