import { expect, test } from "bun:test";
import { createApplicationCachedJson } from "../../src/bootstrap/cachedJson";
import { createCacheProvider } from "../../src/bootstrap/providers/cacheProvider";
import { createConfigProvider } from "../../src/bootstrap/providers/config";

import { configured } from "../helpers/coreProviderConfiguration";

test("core config rejects malformed declarations before startup effects", () => {
  expect(() => createConfigProvider({ DATABASE_URL: "malformed" })).toThrow();
  expect(() =>
    createConfigProvider({ DATABASE_URL: "sqlite://:memory:", QUEUE_MAX_ATTEMPTS: "1.5" }),
  ).toThrow();
  expect(() => createCacheProvider({ CACHE_DRIVER: "redis", REDIS_URL: "" })).toThrow();
});

test("two core application assemblies retain independent Redis namespaces, settings and ETag policy", async () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl)
    throw new Error("Owned host REDIS_URL required for configuration isolation fixture.");
  const nonce = crypto.randomUUID();
  const firstInput = {
    DATABASE_URL: "sqlite://:memory:",
    CACHE_DRIVER: "redis",
    REDIS_URL: redisUrl,
    APP_KEY_PREFIX: `config-one-${nonce}`,
    APP_NAME: "First",
    APP_ENV: "local",
    APP_URL: "https://first.example.test",
    AUTH_DEV_HEADERS: "true",
    QUEUE_DRIVER: "sync",
    QUEUE_MAX_ATTEMPTS: "5",
    FEATURE_ETAG: "true",
  };
  const secondInput = {
    ...firstInput,
    APP_KEY_PREFIX: `config-two-${nonce}`,
    APP_NAME: "Second",
    APP_ENV: "testing",
    APP_URL: "https://second.example.test",
    AUTH_DEV_HEADERS: "false",
    QUEUE_MAX_ATTEMPTS: "2",
    FEATURE_ETAG: "false",
  };
  const first = configured(firstInput),
    second = configured(secondInput);
  const previous = process.env.APP_KEY_PREFIX;
  try {
    firstInput.APP_KEY_PREFIX = `redirected-${nonce}`;
    secondInput.APP_KEY_PREFIX = firstInput.APP_KEY_PREFIX;
    firstInput.APP_NAME = "Redirected";
    firstInput.AUTH_DEV_HEADERS = "false";
    firstInput.APP_URL = "https://redirected.invalid";
    firstInput.QUEUE_MAX_ATTEMPTS = "1";
    firstInput.FEATURE_ETAG = "false";
    secondInput.FEATURE_ETAG = "true";
    process.env.APP_KEY_PREFIX = firstInput.APP_KEY_PREFIX;
    await first.app.start();
    await second.app.start();
    const one = first.context.dependencies.cache,
      two = second.context.dependencies.cache;
    if (!one || !two) throw new Error("Cache providers did not publish owned capabilities.");
    await one.remember("same-key", async () => "first");
    await two.remember("same-key", async () => "second");
    expect(await one.get("same-key")).toBe("first");
    expect(await two.get("same-key")).toBe("second");
    expect(first.config.get("app.name")).toBe("First");
    expect(second.config.get("app.name")).toBe("Second");
    expect(first.config.get("app.url")).toBe("https://first.example.test");
    expect(first.config.get("auth.allowDevHeaders")).toBe(true);
    expect(second.config.get("auth.allowDevHeaders")).toBe(false);
    expect(first.config.get("queue.maxAttempts")).toBe(5);
    expect(second.config.get("queue.maxAttempts")).toBe(2);
    const request = new Request("https://fixture.test/");
    const responseOne = await createApplicationCachedJson({
      cache: one,
      container: first.context.container,
    })("json", async () => ({ value: 1 }), [], request);
    const responseTwo = await createApplicationCachedJson({
      cache: two,
      container: second.context.container,
    })("json", async () => ({ value: 2 }), [], request);
    expect(responseOne.headers.get("etag")).not.toBeNull();
    expect(responseTwo.headers.get("etag")).toBeNull();
    await one.flush();
    expect(await two.get("same-key")).toBe("second");
    await two.flush();
  } finally {
    if (previous === undefined) delete process.env.APP_KEY_PREFIX;
    else process.env.APP_KEY_PREFIX = previous;
    await first.app.stop();
    await second.app.stop();
  }
});
