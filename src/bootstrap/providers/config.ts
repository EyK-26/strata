import { validateEnv } from "@getstrata/core/config/envSchema";
import { CORE_JSON_RESPONSE_POLICY_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { resolveMaxBodyBytes } from "@getstrata/core/http/bodySizeLimitMiddleware";
import { type CorsOptions, resolveCorsConfig } from "@getstrata/core/http/corsMiddleware";
import { resolveMaxUploadBytes } from "@getstrata/core/http/uploads";
import { envFlagEnabled, isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { parseFrontendMode } from "@getstrata/core/runtime/frontendMode";
import { resolveDefaultTokenExpiryDays } from "@getstrata/core/security/tokenExpiry";
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
import type { HttpPersistenceOptions } from "../persistenceContracts";
import { resolveLoginRateLimit, resolveRegisterRateLimit } from "../rateLimit";

/** Entrypoint adapter: resolve once from the owning application's environment snapshot. */
function resolveHttpResponsePolicy(
  source: Readonly<Record<string, string | undefined>>,
): NonNullable<HttpPersistenceOptions["responsePolicy"]> {
  const cors: CorsOptions = Object.freeze({
    allowedOrigins: Object.freeze(
      (
        source.CORS_ALLOWED_ORIGINS ??
        (source.APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "")
      )
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
    additionalAllowedHeaders: Object.freeze(
      source.CORS_ADDITIONAL_ALLOWED_HEADERS?.trim()
        ? source.CORS_ADDITIONAL_ALLOWED_HEADERS.split(",").map((name) => name.trim())
        : [],
    ),
  });
  resolveCorsConfig(cors);
  const maxAttempts = Number(source.RATE_LIMIT_PER_MINUTE ?? "120");
  return Object.freeze({
    cors,
    securityHeaders: Object.freeze({
      frontendMode: parseFrontendMode(source.FRONTEND_MODE),
      production: isProductionEnv(source),
    }),
    maxBodyBytes: resolveMaxBodyBytes(source.MAX_REQUEST_BODY_BYTES),
    rateLimitPerMinute: Number.isFinite(maxAttempts) ? maxAttempts : 120,
    namespace: source.APP_KEY_PREFIX?.trim() || "strata",
    trustForwardedFor: source.TRUST_FORWARDED_FOR === "true",
    loginRateLimit: Object.freeze(resolveLoginRateLimit({ APP_ENV: "local", ...source })),
    registerRateLimit: Object.freeze(resolveRegisterRateLimit({ APP_ENV: "local", ...source })),
  });
}

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
    "http.responsePolicy": resolveHttpResponsePolicy({ ...source, APP_URL: env.APP_URL }),
    "http.features": Object.freeze({
      emailVerificationRequired: source.FEATURE_EMAIL_VERIFICATION === "true",
      viewsEnabled: ["server-htmx", "hybrid"].includes(source.FRONTEND_MODE ?? "api"),
      publicReadsEnabled: source.FEATURE_PUBLIC_READS === "true",
      etagEnabled: source.FEATURE_ETAG !== "false",
    }),
    "http.uploadPolicy": Object.freeze({
      maxBytes: resolveMaxUploadBytes(
        source.MAX_UPLOAD_BYTES?.trim() ?? source.MAX_REQUEST_BODY_BYTES?.trim(),
      ),
      allowUnknownMime: envFlagEnabled(source.UPLOAD_ALLOW_UNKNOWN_MIME),
    }),
    "auth.defaultTokenExpiryDays": resolveDefaultTokenExpiryDays(
      source.API_TOKEN_DEFAULT_EXPIRY_DAYS,
    ),
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

export { appConfigKeys, createConfigProvider, resolveHttpResponsePolicy };
