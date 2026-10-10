import {
  createOutboxMetricsCollector,
  type OutboxMetricsOptions,
} from "@getstrata/core/events/outbox";
import {
  createFailedJobMetricsCollector,
  type FailedJobMetricsOptions,
} from "@getstrata/core/queue/queueMetrics";
import type { MetricsRoutesOptions } from "./metricsRoutes";

interface MetricsRuntimeOptions {
  queue?: MetricsRoutesOptions["queue"];
  outbox?: OutboxMetricsOptions;
  failedJobs?: FailedJobMetricsOptions;
  /** Borrowed: the existing tracing provider retains flush/shutdown ownership. */
  tracing?: MetricsRoutesOptions["tracing"];
  /** Borrowed: callers choose which transactions to instrument. */
  transactionAcquisition?: MetricsRoutesOptions["transactionAcquisition"];
}
interface MetricsRuntime {
  readonly options: Readonly<MetricsRoutesOptions>;
  /** Drain owned SQL observations after HTTP admission stops and requests drain, before pool closure. */
  close(): Promise<void>;
}

/** Lazy, explicit observations only: no schema provisioning, worker or tracing initialization. */
function createMetricsRuntime(options: MetricsRuntimeOptions = {}): MetricsRuntime {
  const outbox = options.outbox ? createOutboxMetricsCollector(options.outbox) : undefined;
  const failedJobs = options.failedJobs
    ? createFailedJobMetricsCollector(options.failedJobs)
    : undefined;
  let closing: Promise<void> | undefined;
  return {
    options: Object.freeze({
      queue: options.queue ? { ...options.queue } : undefined,
      outbox,
      failedJobs,
      tracing: options.tracing,
      transactionAcquisition: options.transactionAcquisition,
    }),
    close() {
      closing ??= Promise.all([outbox?.close(), failedJobs?.close()]).then(() => undefined);
      return closing;
    },
  };
}

export type { MetricsRuntime, MetricsRuntimeOptions };
export { createMetricsRuntime };
