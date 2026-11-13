import { expect, test } from "bun:test";
import { createApplicationCachedJson } from "../../src/bootstrap/cachedJson";
import { createCacheProvider } from "../../src/bootstrap/providers/cacheProvider";
import { createConfigProvider } from "../../src/bootstrap/providers/config";
import { configured } from "../helpers/coreProviderConfiguration";

test("core settings and response policy are captured before application startup", async () => {
  const env = {
    DATABASE_URL: "sqlite://:memory:",
    CACHE_DRIVER: "array",
    APP_NAME: "Owned",
    APP_URL: "https://owned.example.test",
    AUTH_DEV_HEADERS: "true",
    FEATURE_ETAG: "false",
  };
  const owner = configured(env);
  env.APP_NAME = "Changed";
  env.APP_URL = "https://changed.invalid";
  env.AUTH_DEV_HEADERS = "false";
  env.FEATURE_ETAG = "true";
  try {
    await owner.app.start();
    expect(owner.config.get("app.name")).toBe("Owned");
    expect(owner.config.get("app.url")).toBe("https://owned.example.test");
    expect(owner.config.get("auth.allowDevHeaders")).toBe(true);
    const cache = owner.context.dependencies.cache;
    if (!cache) throw new Error("Missing cache capability");
    const response = await createApplicationCachedJson({
      cache,
      container: owner.context.container,
    })("fixture", async () => ({ value: 1 }), [], new Request("https://fixture.test/"));
    expect(response.headers.get("etag")).toBeNull();
    expect(await cache.get("fixture")).toEqual({ value: 1 });
  } finally {
    expect((await owner.app.stop()).successful).toBe(true);
  }
});

test("core config and cache declarations reject invalid settings synchronously", () => {
  expect(() => createConfigProvider({ DATABASE_URL: "invalid" })).toThrow();
  expect(() =>
    createConfigProvider({ DATABASE_URL: "sqlite://:memory:", QUEUE_BACKOFF_MS: "-1" }),
  ).toThrow();
  expect(() => createCacheProvider({ CACHE_DRIVER: "unknown" })).toThrow();
});
