import { validateEnv } from "@getstrata/core/config/envSchema";
import { CORE_JSON_RESPONSE_POLICY_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { envFlagEnabled } from "@getstrata/core/runtime/appEnv";
import { resolveQueueConfig } from "../../config/queue";
import {
  APP_PORT_CONFIG_KEY,
  CACHE_DRIVER_CONFIG_KEY,
  CACHE_MAX_ENTRIES_CONFIG_KEY,
  CACHE_TTL_MS_CONFIG_KEY,
  CORE_CONFIG_TOKEN,
  CSRF_TARGET_ORIGIN_CONFIG_KEY,
  DATABASE_URL_CONFIG_KEY,
  REDIS_URL_CONFIG_KEY,
} from "../config";
import type { ServiceProvider } from "../contracts";
import { appConfigKeys, appEnvSchema } from "../env";

/** Validate and capture all settings before any provider can acquire resources. */
function createConfigProvider(
  input: Readonly<Record<string, string | undefined>>,
): ServiceProvider {
  const source = Object.freeze({ ...input });
  const env = validateEnv(appEnvSchema, source);
  const queue = resolveQueueConfig(env);
  const values = Object.freeze({
    [DATABASE_URL_CONFIG_KEY]: env.DATABASE_URL,
    [APP_PORT_CONFIG_KEY]: Number(env.PORT),
    [CACHE_TTL_MS_CONFIG_KEY]: Number(env.CACHE_TTL_MS),
    [CACHE_MAX_ENTRIES_CONFIG_KEY]: Number(env.CACHE_MAX_ENTRIES),
    [CACHE_DRIVER_CONFIG_KEY]: env.CACHE_DRIVER,
    [REDIS_URL_CONFIG_KEY]: env.REDIS_URL,
    "app.name": source.APP_NAME?.trim() || "Strata",
    "app.env": env.APP_ENV,
    "app.debug": source.APP_DEBUG === "true",
    "app.url": env.APP_URL,
    "app.apiPrefix": env.API_PREFIX,
    "auth.allowDevHeaders": envFlagEnabled(env.AUTH_DEV_HEADERS),
    "queue.driver": queue.driver,
    "queue.maxAttempts": queue.maxAttempts,
    "queue.backoffMs": queue.backoffMs,
    ...(source.CSRF_TARGET_ORIGIN !== undefined
      ? { [CSRF_TARGET_ORIGIN_CONFIG_KEY]: source.CSRF_TARGET_ORIGIN }
      : {}),
  });
  return Object.freeze({
    name: "core.config",
    register({ container, config }: Parameters<NonNullable<ServiceProvider["register"]>>[0]) {
      container.set(CORE_CONFIG_TOKEN, config);
      container.set(
        CORE_JSON_RESPONSE_POLICY_TOKEN,
        Object.freeze({ etagEnabled: source.FEATURE_ETAG !== "false" }),
      );
      for (const [key, value] of Object.entries(values)) config.set(key, value);
    },
  });
}

export { appConfigKeys, createConfigProvider };
