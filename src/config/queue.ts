import { DEFAULT_QUEUE_DRIVER } from "../bootstrap/config";

interface QueueConfig {
  driver: "sync" | "async" | "redis";
  maxAttempts: number;
  backoffMs: number;
}

const queueConfig: QueueConfig = {
  driver:
    process.env.QUEUE_DRIVER === "redis" ||
    process.env.QUEUE_DRIVER === "async" ||
    process.env.QUEUE_DRIVER === "sync"
      ? process.env.QUEUE_DRIVER
      : DEFAULT_QUEUE_DRIVER,
  maxAttempts: Number(process.env.QUEUE_MAX_ATTEMPTS ?? "3"),
  backoffMs: Number(process.env.QUEUE_BACKOFF_MS ?? "1000"),
};

export { queueConfig };
export type { QueueConfig };
