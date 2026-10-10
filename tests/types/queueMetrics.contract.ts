/** Compiled against source and packed package exports; not executed. */
import { createMetricsRoutes, type MetricsRoutesOptions } from "@getstrata/bootstrap/metricsRoutes";
import {
  type RedisQueueSnapshot,
  readRedisQueueSnapshot,
} from "@getstrata/core/queue/queueMetrics";

export async function queueMetricsContract(): Promise<void> {
  const options: MetricsRoutesOptions = {
    queue: { redisUrl: "redis://localhost", transport: "streams", timeoutMs: 1000 },
  };
  const snapshot: RedisQueueSnapshot = await readRedisQueueSnapshot(
    "redis://localhost",
    options.queue,
  );
  createMetricsRoutes(options);
  const ready: number | null | undefined = snapshot.priorities[0]?.ready;
  // @ts-expect-error Transport must be explicitly supported.
  readRedisQueueSnapshot("redis://localhost", { transport: "memory" });
  // @ts-expect-error Redis URL is mandatory for an opt-in collector.
  createMetricsRoutes({ queue: { timeoutMs: 1000 } });
  const lateness: number | null | undefined =
    snapshot.priorities[0]?.retryActionableLatenessSeconds;
  void lateness;
  void ready;
}
