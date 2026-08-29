import { describe, expect, test } from "bun:test";
import { queueConfig, resolveQueueConfig } from "../../src/core/queue/queueConfig";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("queueConfig", () => {
  test("defaults to sync with three attempts", () => {
    const previousDriver = process.env.QUEUE_DRIVER;
    const previousAttempts = process.env.QUEUE_MAX_ATTEMPTS;
    const previousBackoff = process.env.QUEUE_BACKOFF_MS;
    delete process.env.QUEUE_DRIVER;
    delete process.env.QUEUE_MAX_ATTEMPTS;
    delete process.env.QUEUE_BACKOFF_MS;

    try {
      expect(resolveQueueConfig()).toEqual({
        driver: "sync",
        maxAttempts: 3,
        backoffMs: 1000,
      });
      expect(queueConfig.driver).toBe("sync");
    } finally {
      restoreEnvVar("QUEUE_DRIVER", previousDriver);
      restoreEnvVar("QUEUE_MAX_ATTEMPTS", previousAttempts);
      restoreEnvVar("QUEUE_BACKOFF_MS", previousBackoff);
    }
  });

  test("honors QUEUE_DRIVER and numeric overrides", () => {
    const previousDriver = process.env.QUEUE_DRIVER;
    const previousAttempts = process.env.QUEUE_MAX_ATTEMPTS;
    const previousBackoff = process.env.QUEUE_BACKOFF_MS;
    process.env.QUEUE_DRIVER = "sync";
    expect(resolveQueueConfig().driver).toBe("sync");
    process.env.QUEUE_DRIVER = "async";
    expect(resolveQueueConfig().driver).toBe("async");
    process.env.QUEUE_DRIVER = "redis";
    process.env.QUEUE_MAX_ATTEMPTS = "5";
    process.env.QUEUE_BACKOFF_MS = "250";

    try {
      expect(queueConfig.driver).toBe("redis");
      expect(queueConfig.maxAttempts).toBe(5);
      expect(queueConfig.backoffMs).toBe(250);
    } finally {
      restoreEnvVar("QUEUE_DRIVER", previousDriver);
      restoreEnvVar("QUEUE_MAX_ATTEMPTS", previousAttempts);
      restoreEnvVar("QUEUE_BACKOFF_MS", previousBackoff);
    }
  });

  test("falls back when driver or numbers are invalid", () => {
    const previousDriver = process.env.QUEUE_DRIVER;
    const previousAttempts = process.env.QUEUE_MAX_ATTEMPTS;
    const previousBackoff = process.env.QUEUE_BACKOFF_MS;
    process.env.QUEUE_DRIVER = "horizon";
    process.env.QUEUE_MAX_ATTEMPTS = "nope";
    process.env.QUEUE_BACKOFF_MS = "-1";

    try {
      expect(resolveQueueConfig()).toEqual({
        driver: "sync",
        maxAttempts: 3,
        backoffMs: 1000,
      });
    } finally {
      restoreEnvVar("QUEUE_DRIVER", previousDriver);
      restoreEnvVar("QUEUE_MAX_ATTEMPTS", previousAttempts);
      restoreEnvVar("QUEUE_BACKOFF_MS", previousBackoff);
    }
  });
});
