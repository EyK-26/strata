import { type Context, context, type Tracer } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  ParentBasedSampler,
  type SpanExporter,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { otelServiceName } from "../runtime/appKeyPrefix";
import { createTracingHealth, type TracingMetricsSnapshot } from "./health";

type TracingOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  exporter?: SpanExporter;
  endpoint?: string;
  serviceName?: string;
  sampleRatio?: number;
  maxQueueSize?: number;
  maxExportBatchSize?: number;
  scheduledDelayMillis?: number;
  exportTimeoutMillis?: number;
};
type TracingRuntime = {
  tracer: Tracer;
  propagator: W3CTraceContextPropagator;
  run<T>(parent: Context, callback: () => T): T;
  metrics(): TracingMetricsSnapshot;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
};

function numberOption(
  value: number | undefined,
  fallback: number,
  name: string,
  max = 1_000_000,
): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1 || result > max)
    throw new TypeError(`Invalid tracing ${name}.`);
  return result;
}

// Share API context across package entrypoints; do not replace an application's installed manager.
function ensureContextManager(): void {
  const key = Symbol.for("@getstrata/otel-context-installed");
  const state = globalThis as Record<symbol, boolean | undefined>;
  if (state[key]) return;
  const manager = new AsyncLocalStorageContextManager().enable();
  if (!context.setGlobalContextManager(manager)) manager.disable();
  state[key] = true;
}

/** Prepare SDK transport configuration for one runtime owner; do not reuse the exporter. */
function captureTracingOptions(options: TracingOptions = {}): TracingOptions {
  const env = Object.freeze({ ...(options.env ?? process.env) });
  const timeout = numberOption(options.exportTimeoutMillis, 5000, "exportTimeoutMillis", 60_000);
  const disabled = env.OTEL_SDK_DISABLED === "true";
  let endpoint = options.endpoint ?? env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (!endpoint) {
    const base = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
    if (base)
      endpoint = base.endsWith("/v1/traces") ? base : `${base.replace(/\/$/, "")}/v1/traces`;
  }
  if (endpoint) {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new TypeError("Invalid tracing collector endpoint.");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new TypeError("Invalid tracing collector endpoint.");
  }
  const exporter = disabled
    ? undefined
    : (options.exporter ??
      (endpoint
        ? new OTLPTraceExporter({ url: endpoint, timeoutMillis: timeout, concurrencyLimit: 1 })
        : undefined));

  return Object.freeze({ ...options, env, exporter });
}

function createTracingRuntime(options: TracingOptions = {}): TracingRuntime {
  ensureContextManager();
  const env = options.env ?? process.env;
  const disabled = env.OTEL_SDK_DISABLED === "true";
  const samplerName =
    options.sampleRatio === undefined
      ? (env.OTEL_TRACES_SAMPLER ?? "parentbased_traceidratio")
      : "parentbased_traceidratio";
  const rootName = samplerName.replace(/^parentbased_/, "");
  if (!["always_on", "always_off", "traceidratio"].includes(rootName))
    throw new TypeError("Unsupported tracing sampler.");
  const ratio = options.sampleRatio ?? Number(env.OTEL_TRACES_SAMPLER_ARG ?? "1");
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)
    throw new TypeError("Invalid tracing sampleRatio.");
  const rootSampler =
    rootName === "always_on"
      ? new AlwaysOnSampler()
      : rootName === "always_off"
        ? new AlwaysOffSampler()
        : new TraceIdRatioBasedSampler(ratio);
  const sampler = disabled
    ? new AlwaysOffSampler()
    : samplerName.startsWith("parentbased_")
      ? new ParentBasedSampler({ root: rootSampler })
      : rootSampler;
  const queueSize = numberOption(options.maxQueueSize, 2048, "maxQueueSize");
  const batchSize = numberOption(
    options.maxExportBatchSize,
    Math.min(512, queueSize),
    "maxExportBatchSize",
    queueSize,
  );
  const timeout = numberOption(options.exportTimeoutMillis, 5000, "exportTimeoutMillis", 60_000);
  const delay = numberOption(options.scheduledDelayMillis, 5000, "scheduledDelayMillis", 60_000);
  const exporter = captureTracingOptions(options).exporter;
  const health = createTracingHealth(!disabled, exporter !== undefined, timeout);
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": options.serviceName ?? otelServiceName(env),
    }),
    sampler,
    spanProcessors: exporter
      ? [
          new BatchSpanProcessor({
            exporter: health.wrap(exporter),
            selfObsMeterProvider: health.meterProvider,
            maxQueueSize: queueSize,
            maxExportBatchSize: batchSize,
            scheduledDelayMillis: delay,
            exportTimeoutMillis: timeout,
          }),
        ]
      : [],
    spanLimits: {
      attributeCountLimit: 16,
      attributeValueLengthLimit: 256,
      eventCountLimit: 8,
      linkCountLimit: 8,
    },
    forceFlushTimeoutMillis: timeout,
  });
  let shutdown: Promise<void> | undefined;
  return {
    tracer: provider.getTracer("@getstrata/http"),
    propagator: new W3CTraceContextPropagator(),
    run: (parent, callback) => context.with(parent, callback),
    metrics: () => health.snapshot(),
    async forceFlush() {
      try {
        await provider.forceFlush();
      } catch (error) {
        health.state.flushFailures++;
        throw error;
      }
    },
    shutdown: () =>
      (shutdown ??= provider
        .shutdown()
        .catch((error) => {
          health.state.shutdownFailures++;
          throw error;
        })
        .finally(() => {
          health.state.active = false;
        })),
  };
}

export type { TracingOptions, TracingRuntime };
export { captureTracingOptions, createTracingRuntime };
