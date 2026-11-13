import { namespacedRedisKey } from "../runtime/appKeyPrefix";
import type { QueuePriority } from "./index";

function queueListKey(): string {
  return namespacedRedisKey("queue:default");
}

function queueHighKey(): string {
  return namespacedRedisKey("queue:high");
}

function queueLowKey(): string {
  return namespacedRedisKey("queue:low");
}

const QUEUE_LIST_KEY = queueListKey();
const QUEUE_HIGH_KEY = queueHighKey();
const QUEUE_LOW_KEY = queueLowKey();
function defaultQueueKeys(): readonly [string, string, string] {
  return [queueHighKey(), queueListKey(), queueLowKey()];
}
const QUEUE_KEYS = defaultQueueKeys();
function queueKeyForPriority(
  priority: QueuePriority = "default",
  keys: readonly [string, string, string] = defaultQueueKeys(),
): string {
  return priority === "high" ? keys[0] : priority === "low" ? keys[2] : keys[1];
}

export {
  defaultQueueKeys,
  QUEUE_HIGH_KEY,
  QUEUE_KEYS,
  QUEUE_LIST_KEY,
  QUEUE_LOW_KEY,
  queueKeyForPriority,
};
