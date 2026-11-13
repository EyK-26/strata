/** Packed compiler contracts exercise this deliberately public policy adapter. */
import {
  type QueueConfig,
  type QueueRetryPolicy,
  resolveQueueConfig,
  snapshotQueueRetryPolicy,
} from "@getstrata/core/queue/queueConfig";

export function queuePolicyContract(): QueueRetryPolicy {
  const configuration: Readonly<QueueConfig> = resolveQueueConfig({
    QUEUE_DRIVER: "sync",
    QUEUE_MAX_ATTEMPTS: "3",
    QUEUE_BACKOFF_MS: "0",
  });
  const policy: QueueRetryPolicy = snapshotQueueRetryPolicy(configuration);
  // @ts-expect-error Captured retry policies cannot be mutated by consumers.
  policy.maxAttempts = 1;
  return policy;
}
