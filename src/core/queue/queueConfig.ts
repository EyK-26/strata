interface QueueConfig {
  driver: "sync" | "async" | "redis";
  maxAttempts: number;
  backoffMs: number;
}

function resolveQueueConfig(): QueueConfig {
  const driver = process.env.QUEUE_DRIVER;
  const maxAttempts = Number(process.env.QUEUE_MAX_ATTEMPTS ?? "3");
  const backoffMs = Number(process.env.QUEUE_BACKOFF_MS ?? "1000");

  return {
    driver: driver === "redis" || driver === "async" || driver === "sync" ? driver : "sync",
    maxAttempts: Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 3,
    backoffMs: Number.isFinite(backoffMs) && backoffMs >= 0 ? backoffMs : 1000,
  };
}

const queueConfig: QueueConfig = {
  get driver() {
    return resolveQueueConfig().driver;
  },
  get maxAttempts() {
    return resolveQueueConfig().maxAttempts;
  },
  get backoffMs() {
    return resolveQueueConfig().backoffMs;
  },
};

export type { QueueConfig };
export { queueConfig, resolveQueueConfig };
