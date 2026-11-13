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

test("HTTP, upload and token policies belong to the configuration declaration before startup", async () => {
  const env = {
    DATABASE_URL: "sqlite://:memory:",
    CACHE_DRIVER: "array",
    APP_URL: "https://a.test/",
    FRONTEND_MODE: "hybrid",
    FEATURE_PUBLIC_READS: "true",
    FEATURE_EMAIL_VERIFICATION: "true",
    MAX_UPLOAD_BYTES: "4",
    UPLOAD_ALLOW_UNKNOWN_MIME: "true",
    API_TOKEN_DEFAULT_EXPIRY_DAYS: "30",
    RATE_LIMIT_PER_MINUTE: "2",
    APP_KEY_PREFIX: "owner-a",
    TRUST_FORWARDED_FOR: "true",
  };
  const owner = configured(env);
  Object.assign(env, {
    APP_URL: "https://other.test",
    FRONTEND_MODE: "api",
    FEATURE_PUBLIC_READS: "false",
    FEATURE_EMAIL_VERIFICATION: "false",
    MAX_UPLOAD_BYTES: "999",
    UPLOAD_ALLOW_UNKNOWN_MIME: "false",
    API_TOKEN_DEFAULT_EXPIRY_DAYS: "999",
    RATE_LIMIT_PER_MINUTE: "999",
    APP_KEY_PREFIX: "other",
    TRUST_FORWARDED_FOR: "false",
  });
  try {
    await owner.app.start();
    expect(owner.config.get("http.features")).toEqual({
      emailVerificationRequired: true,
      viewsEnabled: true,
      publicReadsEnabled: true,
      etagEnabled: true,
    });
    expect(owner.config.get("http.uploadPolicy")).toEqual({ maxBytes: 4, allowUnknownMime: true });
    expect(owner.config.get("auth.defaultTokenExpiryDays")).toBe(30);
    expect(owner.config.get("http.responsePolicy")).toMatchObject({
      cors: { allowedOrigins: ["https://a.test"] },
      rateLimitPerMinute: 2,
      namespace: "owner-a",
      trustForwardedFor: true,
    });
  } finally {
    expect((await owner.app.stop()).successful).toBe(true);
  }
});
