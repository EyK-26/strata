interface QueueConfig {
  readonly driver: "sync" | "async" | "redis";
  readonly maxAttempts: number;
  readonly backoffMs: number;
}
type QueueRetryPolicy = Readonly<Pick<QueueConfig, "maxAttempts" | "backoffMs">>;
type QueueEnvironment = Readonly<Record<string, string | undefined>>;

function snapshotQueueRetryPolicy(policy: QueueRetryPolicy): QueueRetryPolicy {
  const { maxAttempts, backoffMs } = policy;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1)
    throw new TypeError("QUEUE_MAX_ATTEMPTS must be a positive safe integer.");
  if (!Number.isSafeInteger(backoffMs) || backoffMs < 0 || backoffMs > 2147483647)
    throw new TypeError("QUEUE_BACKOFF_MS must be a non-negative integer within the timer range.");
  return Object.freeze({ maxAttempts, backoffMs });
}

/** Configuration adapter. Capture the returned immutable policy during application assembly. */
function resolveQueueConfig(env: QueueEnvironment = process.env): Readonly<QueueConfig> {
  const driver = env.QUEUE_DRIVER ?? "sync";
  if (!["sync", "async", "redis"].includes(driver)) throw new TypeError("Unknown queue driver.");
  const policy = snapshotQueueRetryPolicy({
    maxAttempts: Number(env.QUEUE_MAX_ATTEMPTS ?? "3"),
    backoffMs: Number(env.QUEUE_BACKOFF_MS ?? "1000"),
  });
  return Object.freeze({ driver: driver as QueueConfig["driver"], ...policy });
}

function resolveRedisQueueTransport(env: QueueEnvironment = process.env): "lists" | "streams" {
  const transport = env.QUEUE_REDIS_TRANSPORT ?? "lists";
  if (transport !== "lists" && transport !== "streams")
    throw new Error('QUEUE_REDIS_TRANSPORT must be "lists" or "streams".');
  return transport;
}

function readQueueVisibilityMs(env: QueueEnvironment = process.env): number {
  const value = Number(env.QUEUE_VISIBILITY_MS ?? "60000");
  if (!Number.isSafeInteger(value) || value < 30 || value > 2147483647)
    throw new Error(
      "QUEUE_VISIBILITY_MS must be an integer from 30 through 2147483647 milliseconds.",
    );
  return value;
}

export type { QueueConfig, QueueRetryPolicy };
export {
  readQueueVisibilityMs,
  resolveQueueConfig,
  resolveRedisQueueTransport,
  snapshotQueueRetryPolicy,
};
