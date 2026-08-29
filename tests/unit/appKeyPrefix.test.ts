import { describe, expect, test } from "bun:test";
import { appKeyPrefix, namespacedRedisKey } from "../../src/core/runtime/appKeyPrefix";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("appKeyPrefix", () => {
  test("defaults to workhub", () => {
    const previous = process.env.APP_KEY_PREFIX;
    delete process.env.APP_KEY_PREFIX;

    try {
      expect(appKeyPrefix()).toBe("workhub");
      expect(namespacedRedisKey("cache:")).toBe("workhub:cache:");
    } finally {
      restoreEnvVar("APP_KEY_PREFIX", previous);
    }
  });

  test("honors APP_KEY_PREFIX for sibling apps", () => {
    const previous = process.env.APP_KEY_PREFIX;
    process.env.APP_KEY_PREFIX = "forum";

    try {
      expect(appKeyPrefix()).toBe("forum");
      expect(namespacedRedisKey("queue:default")).toBe("forum:queue:default");
    } finally {
      restoreEnvVar("APP_KEY_PREFIX", previous);
    }
  });
});
