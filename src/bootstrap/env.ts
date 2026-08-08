import {
  CACHE_MAX_ENTRIES_CONFIG_KEY,
  CACHE_TTL_MS_CONFIG_KEY,
  DATABASE_URL_CONFIG_KEY,
  DEFAULT_API_TOKEN,
  DEFAULT_APP_PORT,
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_CACHE_DRIVER,
  DEFAULT_QUEUE_DRIVER,
} from "./config";
import {
  defineEnvSchema,
  type EnvSchema,
} from "../core/config/envSchema";

const appEnvSchema: EnvSchema = defineEnvSchema({
  DATABASE_URL: { required: true, pattern: /^postgres(ql)?:\/\// },
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
  API_TOKEN: {
    default: DEFAULT_API_TOKEN,
  },
});

const appConfigKeys = {
  databaseUrl: DATABASE_URL_CONFIG_KEY,
  port: "app.port",
  cacheTtlMs: CACHE_TTL_MS_CONFIG_KEY,
  cacheMaxEntries: CACHE_MAX_ENTRIES_CONFIG_KEY,
} as const;

export { appConfigKeys, appEnvSchema };
