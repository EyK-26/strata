import { timingSafeEqual } from "node:crypto";
import { prometheusRegistry } from "@getstrata/core/metrics/prometheus";
import {
  type RedisQueueSnapshotOptions,
  readRedisQueueSnapshot,
  renderRedisQueueMetrics,
} from "@getstrata/core/queue/queueMetrics";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";

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
}
function createMetricsRoutes(options: MetricsRoutesOptions = {}) {
  // One concurrent collection per route instance, including failed/timed-out scrapes.
  let collection: Promise<string> | undefined;
  const collect = (): Promise<string> => {
    if (!options.queue) return Promise.resolve("");
    collection ??= readRedisQueueSnapshot(options.queue.redisUrl, options.queue)
      .then(renderRedisQueueMetrics)
      .catch(
        () =>
          "# HELP strata_queue_collector_success Whether the configured queue collection succeeded.\n# TYPE strata_queue_collector_success gauge\nstrata_queue_collector_success 0\n",
      )
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

export type { MetricsRoutesOptions };
export { createMetricsRoutes };
