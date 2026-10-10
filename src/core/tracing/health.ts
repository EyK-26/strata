import {
  createNoopMeter,
  type Meter,
  type MeterProvider,
  type ObservableCallback,
} from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";

interface TracingMetricsSnapshot {
  enabled: boolean;
  exporterConfigured: boolean;
  active: boolean;
  queueSize: number | null;
  queueCapacity: number | null;
  droppedSpans: number;
  exportedBatches: number;
  failedBatches: number;
  exportedSpans: number;
  failedSpans: number;
  exportDeadlineExceededBatches: number;
  flushFailures: number;
  shutdownFailures: number;
}

// Keep timer closures outside export's scope: they must not retain spans or SDK callbacks.
function observeExportDeadline(state: TracingMetricsSnapshot, timeoutMillis: number) {
  const deadline = setTimeout(() => {
    state.exportDeadlineExceededBatches++;
  }, timeoutMillis);
  deadline.unref();
  return deadline;
}

/** A fixed projection of SDK self-observations, not a general metric registry. */
function createTracingHealth(enabled: boolean, exporterConfigured: boolean, timeoutMillis: number) {
  const state: TracingMetricsSnapshot = {
    enabled,
    exporterConfigured,
    active: true,
    queueSize: null,
    queueCapacity: null,
    droppedSpans: 0,
    exportedBatches: 0,
    failedBatches: 0,
    exportedSpans: 0,
    failedSpans: 0,
    exportDeadlineExceededBatches: 0,
    flushFailures: 0,
    shutdownFailures: 0,
  };
  let exportQueueFullSpans = 0;
  let queueCallback: ObservableCallback | undefined;
  const noop = createNoopMeter();
  const meter: Meter = {
    createGauge: noop.createGauge.bind(noop),
    createHistogram: noop.createHistogram.bind(noop),
    createObservableGauge: noop.createObservableGauge.bind(noop),
    createObservableCounter: noop.createObservableCounter.bind(noop),
    addBatchObservableCallback: noop.addBatchObservableCallback.bind(noop),
    removeBatchObservableCallback: noop.removeBatchObservableCallback.bind(noop),
    createCounter(name, options) {
      if (name !== "otel.sdk.processor.span.processed") return noop.createCounter(name, options);
      return {
        add(value, attributes) {
          // Collapse the SDK's component and error attributes; retain no arbitrary labels.
          if (attributes?.["error.type"] === "queue_full") state.droppedSpans += value;
        },
      };
    },
    createUpDownCounter(name, options) {
      if (name !== "otel.sdk.processor.span.queue.capacity")
        return noop.createUpDownCounter(name, options);
      return {
        add(value) {
          state.queueCapacity = (state.queueCapacity ?? 0) + value;
        },
      };
    },
    createObservableUpDownCounter(name, options) {
      if (name !== "otel.sdk.processor.span.queue.size")
        return noop.createObservableUpDownCounter(name, options);
      return {
        addCallback(callback) {
          queueCallback = callback;
        },
        removeCallback(callback) {
          if (queueCallback === callback) queueCallback = undefined;
        },
      };
    },
  };
  const meterProvider: MeterProvider = { getMeter: () => meter };
  return {
    state,
    meterProvider,
    snapshot(): TracingMetricsSnapshot {
      // SDK queue callbacks are synchronous in the pinned version. No remote IO or span traversal.
      let queueSize: number | null = null;
      queueCallback?.({
        observe(value) {
          queueSize = value;
        },
      });
      return {
        ...state,
        queueSize,
        droppedSpans: Math.max(0, state.droppedSpans - exportQueueFullSpans),
      };
    },
    wrap(exporter: SpanExporter): SpanExporter {
      return {
        export(spans, callback) {
          const count = spans.length;
          let completed = false;
          // Observes callback lateness only; cancellation and batching remain SDK-owned.
          const deadline = observeExportDeadline(state, timeoutMillis);
          const finish = (success: boolean) => {
            completed = true;
            clearTimeout(deadline);
            if (success) {
              state.exportedBatches++;
              state.exportedSpans += count;
            } else {
              state.failedBatches++;
              state.failedSpans += count;
            }
          };
          try {
            exporter.export(spans, (result) => {
              if (completed) return;
              finish(result.code === ExportResultCode.SUCCESS);
              // The SDK also uses exporter Error.name as error.type. Do not mistake a
              // custom exporter error called queue_full for processor overflow.
              if (result.error?.name === "queue_full") exportQueueFullSpans += count;
              callback(result);
            });
          } catch (error) {
            if (!completed) finish(false);
            throw error;
          }
        },
        shutdown: () => exporter.shutdown(),
        ...(exporter.forceFlush ? { forceFlush: exporter.forceFlush.bind(exporter) } : {}),
      };
    },
  };
}

function renderTracingMetrics(snapshot: TracingMetricsSnapshot): string {
  for (const key of ["enabled", "exporterConfigured", "active"] as const)
    if (typeof snapshot[key] !== "boolean") throw new TypeError("Invalid tracing metrics.");
  const values = {
    strata_tracing_enabled: Number(snapshot.enabled),
    strata_tracing_exporter_configured: Number(snapshot.exporterConfigured),
    strata_tracing_active: Number(snapshot.active),
    strata_tracing_queue_size: snapshot.queueSize,
    strata_tracing_queue_capacity: snapshot.queueCapacity,
    strata_tracing_dropped_spans_total: snapshot.droppedSpans,
    strata_tracing_exported_batches_total: snapshot.exportedBatches,
    strata_tracing_failed_batches_total: snapshot.failedBatches,
    strata_tracing_exported_spans_total: snapshot.exportedSpans,
    strata_tracing_failed_spans_total: snapshot.failedSpans,
    strata_tracing_export_deadline_exceeded_batches_total: snapshot.exportDeadlineExceededBatches,
    strata_tracing_flush_failures_total: snapshot.flushFailures,
    strata_tracing_shutdown_failures_total: snapshot.shutdownFailures,
  };
  let output =
    "# HELP strata_tracing_collector_success Whether tracing observation succeeded.\n# TYPE strata_tracing_collector_success gauge\nstrata_tracing_collector_success 1\n";
  for (const [name, value] of Object.entries(values)) {
    if (value === null) {
      if (name === "strata_tracing_queue_size" || name === "strata_tracing_queue_capacity")
        continue;
      throw new TypeError("Invalid tracing metrics.");
    }
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid tracing metrics.");
    const type = name.endsWith("_total") ? "counter" : "gauge";
    output += `# HELP ${name} Process-local tracing ${name.slice(15).replaceAll("_", " ")}.\n# TYPE ${name} ${type}\n${name} ${value}\n`;
  }
  return output;
}

export type { TracingMetricsSnapshot };
export { createTracingHealth, renderTracingMetrics };
