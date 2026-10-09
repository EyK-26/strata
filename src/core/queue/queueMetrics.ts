import { RedisClient } from "bun";
import { createFailedJobService } from "./createAppQueue";
import { queueConfig, resolveRedisQueueTransport } from "./queueConfig";
import { defaultQueueKeys } from "./redisQueueKeys";
import { readStreamQueueDepth } from "./redisStreams";

interface QueueDepthMetrics {
  high: number;
  default: number;
  low: number;
  total: number;
}

interface QueueMetricsSnapshot {
  driver: string;
  pending: QueueDepthMetrics;
  failedCount: number;
}

async function readRedisQueueDepth(redisUrl: string): Promise<QueueDepthMetrics> {
  const client = new RedisClient(redisUrl);
  let high: number;
  let defaultQueue: number;
  let low: number;
  try {
    const readDepth = async (key: string) =>
      resolveRedisQueueTransport() === "streams"
        ? readStreamQueueDepth(client, key)
        : client.llen(key);
    [high, defaultQueue, low] = await Promise.all([
      readDepth(defaultQueueKeys()[0]),
      readDepth(defaultQueueKeys()[1]),
      readDepth(defaultQueueKeys()[2]),
    ]);
  } finally {
    client.close();
  }

  return {
    high: Number(high ?? 0),
    default: Number(defaultQueue ?? 0),
    low: Number(low ?? 0),
    total: Number(high ?? 0) + Number(defaultQueue ?? 0) + Number(low ?? 0),
  };
}

async function collectQueueMetrics(): Promise<QueueMetricsSnapshot> {
  const driver = queueConfig.driver;
  const failedJobs = createFailedJobService();
  const failedCount = (await failedJobs.listRecent(1000)).length;

  if (driver !== "redis") {
    return {
      driver,
      pending: {
        high: 0,
        default: 0,
        low: 0,
        total: 0,
      },
      failedCount,
    };
  }

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    return {
      driver,
      pending: {
        high: 0,
        default: 0,
        low: 0,
        total: 0,
      },
      failedCount,
    };
  }

  return {
    driver,
    pending: await readRedisQueueDepth(redisUrl),
    failedCount,
  };
}

export type { QueueDepthMetrics, QueueMetricsSnapshot };
export { collectQueueMetrics, readRedisQueueDepth };
