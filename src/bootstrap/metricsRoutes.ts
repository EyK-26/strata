import { timingSafeEqual } from "node:crypto";
import {
  renderTransactionAcquisitionMetrics,
  type TransactionAcquisitionMetrics,
} from "@getstrata/core/database/transaction";
import { type OutboxMetricsCollector, renderOutboxMetrics } from "@getstrata/core/events/outbox";
import { prometheusRegistry } from "@getstrata/core/metrics/prometheus";
import {
  type FailedJobMetricsCollector,
  type RedisQueueSnapshotOptions,
  readRedisQueueSnapshot,
  renderFailedJobMetrics,
  renderRedisQueueMetrics,
} from "@getstrata/core/queue/queueMetrics";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import {
  renderTracingMetrics,
  type TracingRuntime,
} from "@getstrata/core/tracing/tracingMiddleware";

function tokensMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function authorizeMetrics(request: Request): boolean {
  const expected = process.env.METRICS_TOKEN?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  const presented = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (expected) {
    return presented.length > 0 && tokensMatch(presented, expected);
  }

  if (isProductionEnv()) {
    return false;
  }

  return true;
}

interface MetricsRoutesOptions {
  /** Opt in to shared Redis queue observations; no database or failed-job scan. */
  queue?: RedisQueueSnapshotOptions & { redisUrl: string };
  /** Explicit platform outbox observation; caller owns collector shutdown. */
  outbox?: Pick<OutboxMetricsCollector, "collect">;
  /** Read an existing runtime; scraping never initializes tracing or flushes spans. */
  tracing?: Pick<TracingRuntime, "metrics">;
  /** Fixed process-local observations; scrape does not reserve a database connection. */
  transactionAcquisition?: Pick<TransactionAcquisitionMetrics, "snapshot">;
  /** Explicit global failed-job observation; caller owns collector shutdown. */
  failedJobs?: Pick<FailedJobMetricsCollector, "collect">;
}
function createMetricsRoutes(options: MetricsRoutesOptions = {}) {
  // One concurrent collection per route instance, including failed/timed-out scrapes.
  let collection: Promise<string> | undefined;
  const collect = (): Promise<string> => {
    if (
      !options.queue &&
      !options.outbox &&
      !options.tracing &&
      !options.transactionAcquisition &&
      !options.failedJobs
    )
      return Promise.resolve("");
    const failure = (
      name: "queue" | "outbox" | "tracing" | "database_acquisition" | "queue_failed_job",
    ) =>
      `# HELP strata_${name}_collector_success Whether the configured ${name} collection succeeded.\n# TYPE strata_${name}_collector_success gauge\nstrata_${name}_collector_success 0\n`;
    collection ??= Promise.all([
      options.queue
        ? readRedisQueueSnapshot(options.queue.redisUrl, options.queue)
            .then(renderRedisQueueMetrics)
            .catch(() => failure("queue"))
        : Promise.resolve(""),
      options.outbox
        ? Promise.resolve()
            .then(() => options.outbox?.collect())
            .then((snapshot) => (snapshot ? renderOutboxMetrics(snapshot) : ""))
            .catch(() => failure("outbox"))
        : Promise.resolve(""),
      options.tracing
        ? Promise.resolve()
            .then(() => (options.tracing ? renderTracingMetrics(options.tracing.metrics()) : ""))
            .catch(() => failure("tracing"))
        : Promise.resolve(""),
      options.transactionAcquisition
        ? Promise.resolve()
            .then(() =>
              options.transactionAcquisition
                ? renderTransactionAcquisitionMetrics(options.transactionAcquisition.snapshot())
                : "",
            )
            .catch(() => failure("database_acquisition"))
        : Promise.resolve(""),
      options.failedJobs
        ? Promise.resolve()
            .then(() => options.failedJobs?.collect())
            .then((snapshot) => (snapshot ? renderFailedJobMetrics(snapshot) : ""))
            .catch(() => failure("queue_failed_job"))
        : Promise.resolve(""),
    ])
      .then((parts) => parts.join(""))
      .finally(() => {
        collection = undefined;
      });
    return collection;
  };
  return {
    "/metrics": async (request: Request) => {
      if (!authorizeMetrics(request)) {
        return new Response("Not Found", { status: 404 });
      }

      return new Response(prometheusRegistry.renderMetrics() + (await collect()), {
        status: 200,
        headers: {
          "content-type": "text/plain; version=0.0.4; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    },
  };
}

export type { MetricsRuntime, MetricsRuntimeOptions } from "./metricsRuntime";
export { createMetricsRuntime } from "./metricsRuntime";
export type { MetricsRoutesOptions };
export { createMetricsRoutes };
