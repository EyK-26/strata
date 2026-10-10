import { timingSafeEqual } from "node:crypto";
import { type OutboxMetricsCollector, renderOutboxMetrics } from "@getstrata/core/events/outbox";
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
  /** Explicit platform outbox observation; caller owns collector shutdown. */
  outbox?: Pick<OutboxMetricsCollector, "collect">;
}
function createMetricsRoutes(options: MetricsRoutesOptions = {}) {
  // One concurrent collection per route instance, including failed/timed-out scrapes.
  let collection: Promise<string> | undefined;
  const collect = (): Promise<string> => {
    if (!options.queue && !options.outbox) return Promise.resolve("");
    const failure = (name: "queue" | "outbox") =>
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

export type { MetricsRoutesOptions };
export { createMetricsRoutes };
