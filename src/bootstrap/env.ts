import { defineEnvSchema, type EnvSchema } from "@getstrata/core/config/envSchema";
import { DEFAULT_SPA_PREFIX, FRONTEND_MODE_PATTERN } from "@getstrata/core/runtime/frontendMode";
import {
  CACHE_MAX_ENTRIES_CONFIG_KEY,
  CACHE_TTL_MS_CONFIG_KEY,
  DATABASE_URL_CONFIG_KEY,
  DEFAULT_API_TOKEN,
  DEFAULT_APP_PORT,
  DEFAULT_CACHE_DRIVER,
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_QUEUE_DRIVER,
} from "./config";

const appEnvSchema: EnvSchema = defineEnvSchema({
  DATABASE_URL: {
    required: true,
    pattern: /^(postgres(ql)?|mysql|sqlite):\/\//i,
  },
  PORT: {
    integer: true,
    minimum: 1,
    default: String(DEFAULT_APP_PORT),
  },
  CACHE_TTL_MS: {
    integer: true,
    minimum: 0,
    default: String(DEFAULT_CACHE_TTL_MS),
  },
  CACHE_MAX_ENTRIES: {
    integer: true,
    minimum: 1,
    default: String(DEFAULT_CACHE_MAX_ENTRIES),
  },
  CACHE_DRIVER: {
    default: DEFAULT_CACHE_DRIVER,
    pattern: /^(array|redis)$/,
  },
  REDIS_URL: {
    default: "",
  },
  QUEUE_DRIVER: {
    default: DEFAULT_QUEUE_DRIVER,
    pattern: /^(sync|async|redis)$/,
  },
  AUTH_DEV_HEADERS: {
    default: "false",
    pattern: /^(true|false|0|1)$/,
  },
  DB_CONNECTION: {
    default: "",
    pattern: /^(pgsql|postgres|postgresql|mysql|mariadb|sqlite)?$/i,
  },
  AUTH_DEFAULT_GUARD: {
    default: "web",
  },
  JWT_TTL_SECONDS: {
    integer: true,
    minimum: 60,
    default: "3600",
  },
  APP_ENV: {
    default: "local",
  },
  APP_DEBUG: {
    default: "true",
  },
  APP_URL: {
    default: "http://localhost:3000",
  },
  FRONTEND_MODE: {
    default: "api",
    pattern: FRONTEND_MODE_PATTERN,
  },
  SPA_PREFIX: {
    default: DEFAULT_SPA_PREFIX,
  },
  API_PREFIX: {
    default: "/api/v1",
  },
  CORS_ALLOWED_ORIGINS: {
    default: "*",
  },
  QUEUE_MAX_ATTEMPTS: {
    integer: true,
    minimum: 1,
    default: "3",
  },
  QUEUE_BACKOFF_MS: {
    integer: true,
    minimum: 0,
    default: "1000",
  },
  ADMIN_API_TOKEN: {
    default: DEFAULT_API_TOKEN,
  },
  MEMBER_API_TOKEN: {
    default: "",
  },
  DB_POOL_MAX: {
    integer: true,
    minimum: 1,
    default: "10",
  },
  DB_POOL_IDLE_TIMEOUT: {
    integer: true,
    minimum: 0,
    default: "30",
  },
  DB_POOL_MAX_LIFETIME: {
    integer: true,
    minimum: 0,
    default: "3600",
  },
  DB_CONNECTION_TIMEOUT: {
    integer: true,
    minimum: 1,
    default: "10",
  },
});

const appConfigKeys = {
  databaseUrl: DATABASE_URL_CONFIG_KEY,
  port: "app.port",
  cacheTtlMs: CACHE_TTL_MS_CONFIG_KEY,
  cacheMaxEntries: CACHE_MAX_ENTRIES_CONFIG_KEY,
} as const;

export { appConfigKeys, appEnvSchema };
