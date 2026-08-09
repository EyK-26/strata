import { RedisClient } from "bun";
import { queueConfig } from "../../config/queue";
import { createFailedJobService } from "./createAppQueue";
import { QUEUE_HIGH_KEY, QUEUE_LIST_KEY, QUEUE_LOW_KEY } from "./redisQueue";

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
  const [high, defaultQueue, low] = await Promise.all([
    client.llen(QUEUE_HIGH_KEY),
    client.llen(QUEUE_LIST_KEY),
    client.llen(QUEUE_LOW_KEY),
  ]);

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
