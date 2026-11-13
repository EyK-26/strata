const DEFAULT_QUEUE_VISIBILITY_MS = 60000;

interface QueueConfig {
  readonly driver: "sync" | "async" | "redis";
  readonly maxAttempts: number;
  readonly backoffMs: number;
}
interface QueueRuntimeConfig {
  readonly transport: "lists" | "streams";
  readonly visibilityMs: number;
  readonly queueKeys: readonly [string, string, string];
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

function snapshotQueueRuntimeConfig(config: QueueRuntimeConfig): QueueRuntimeConfig {
  if (
    (config.transport !== "lists" && config.transport !== "streams") ||
    typeof config.visibilityMs !== "number"
  )
    throw new TypeError("Queue runtime requires explicit transport and numeric visibility.");
  if (
    !Array.isArray(config.queueKeys) ||
    config.queueKeys.length !== 3 ||
    config.queueKeys.some((key) => typeof key !== "string" || !key.length) ||
    new Set(config.queueKeys).size !== 3
  )
    throw new TypeError("Queue runtime requires three distinct nonempty priority keys.");
  return Object.freeze({
    queueKeys: Object.freeze([...config.queueKeys]) as readonly [string, string, string],
    transport: resolveRedisQueueTransport({ QUEUE_REDIS_TRANSPORT: config.transport }),
    visibilityMs: readQueueVisibilityMs({ QUEUE_VISIBILITY_MS: String(config.visibilityMs) }),
  });
}
function resolveQueueRuntimeConfig(env: QueueEnvironment = process.env): QueueRuntimeConfig {
  const prefix = env.APP_KEY_PREFIX?.trim() || "strata";
  return snapshotQueueRuntimeConfig({
    transport: resolveRedisQueueTransport(env),
    visibilityMs: readQueueVisibilityMs(env),
    queueKeys: [`${prefix}:queue:high`, `${prefix}:queue:default`, `${prefix}:queue:low`],
  });
}

export type { QueueConfig, QueueRetryPolicy, QueueRuntimeConfig };
export {
  DEFAULT_QUEUE_VISIBILITY_MS,
  readQueueVisibilityMs,
  resolveQueueConfig,
  resolveQueueRuntimeConfig,
  resolveRedisQueueTransport,
  snapshotQueueRetryPolicy,
  snapshotQueueRuntimeConfig,
};
