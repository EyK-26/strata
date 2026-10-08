import { type Context, context, type Tracer } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  type SpanExporter,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { otelServiceName } from "../runtime/appKeyPrefix";

type TracingOptions = {
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

function createTracingRuntime(options: TracingOptions = {}): TracingRuntime {
  ensureContextManager();
  const disabled = process.env.OTEL_SDK_DISABLED === "true";
  const samplerName =
    options.sampleRatio === undefined
      ? (process.env.OTEL_TRACES_SAMPLER ?? "parentbased_traceidratio")
      : "parentbased_traceidratio";
  const rootName = samplerName.replace(/^parentbased_/, "");
  if (!["always_on", "always_off", "traceidratio"].includes(rootName))
    throw new TypeError("Unsupported tracing sampler.");
  const ratio = options.sampleRatio ?? Number(process.env.OTEL_TRACES_SAMPLER_ARG ?? "1");
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
  let endpoint = options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (!endpoint) {
    const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
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
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ "service.name": options.serviceName ?? otelServiceName() }),
    sampler,
    spanProcessors: exporter
      ? [
          new BatchSpanProcessor(exporter, {
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
    forceFlush: () => provider.forceFlush(),
    shutdown: () => (shutdown ??= provider.shutdown()),
  };
}

const runtimeKey = Symbol.for("@getstrata/otel-runtime");
function runtimeState(): { runtime?: TracingRuntime; owners: number } {
  const state = globalThis as Record<
    symbol,
    { runtime?: TracingRuntime; owners: number } | undefined
  >;
  state[runtimeKey] ??= { owners: 0 };
  return state[runtimeKey];
}
function getTracingRuntime(): TracingRuntime {
  const state = runtimeState();
  state.runtime ??= createTracingRuntime();
  return state.runtime;
}
function acquireTracingRuntime(): { flush(): Promise<void>; release(): Promise<void> } {
  const state = runtimeState();
  const runtime = getTracingRuntime();
  state.owners++;
  let released = false;
  return {
    flush: () => runtime.forceFlush(),
    async release() {
      if (released) return;
      released = true;
      if (--state.owners === 0) {
        if (state.runtime === runtime) state.runtime = undefined;
        await runtime.shutdown();
      }
    },
  };
}

export type { TracingOptions, TracingRuntime };
export { acquireTracingRuntime, createTracingRuntime, getTracingRuntime };
