import { defineEnvSchema, validateEnv } from "@getstrata/core/config/envSchema";
import { appCookieName } from "@getstrata/core/runtime/appKeyPrefix";
import { readFrontendMode } from "@getstrata/core/runtime/frontendMode";
import { resolveHiroappDatabaseUrl } from "../db/ensureDatabase.ts";

export const APP_PORT_CONFIG_KEY = "app.port";
export const DATABASE_URL_CONFIG_KEY = "database.url";
export const DEFAULT_APP_PORT = 3000;

export const envSchema = defineEnvSchema({
  DATABASE_URL: { required: true, pattern: /^postgres(ql)?:\/\// },
  PORT: { integer: true, minimum: 1, default: String(DEFAULT_APP_PORT) },
  APP_NAME: { default: "HiroApp" },
  APP_ENV: { default: "local" },
  APP_URL: { default: "http://localhost:3000" },
  APP_KEY_PREFIX: { default: "hiroapp" },
  FRONTEND_MODE: { default: "spa-react", pattern: /^(spa-react|server-htmx|api)$/ },
  TENANCY_DRIVER: { default: "rls", pattern: /^(none|rls)$/ },
  QUEUE_DRIVER: { default: "sync", pattern: /^(sync|async|redis)$/ },
  MAIL_DRIVER: { default: "log", pattern: /^(log|smtp)$/ },
  CACHE_DRIVER: { default: "array", pattern: /^(array|redis)$/ },
  SESSION_SECRET: { default: "hiroapp-dev-session-secret-change-me" },
  HIROAPP_SEED_SCALE: { default: "demo", pattern: /^(demo|full)$/ },
  AUTH_DEV_HEADERS: { default: "false", pattern: /^(true|false|0|1)$/ },
  VIEW_DIRECTORY: { default: "" },
});

export function loadEnv() {
  process.env.DATABASE_URL = resolveHiroappDatabaseUrl();
  process.env.APP_KEY_PREFIX ??= "hiroapp";
  process.env.APP_NAME ??= "HiroApp";
  const env = validateEnv(envSchema);
  if (env.TENANCY_DRIVER) {
    process.env.TENANCY_DRIVER = env.TENANCY_DRIVER;
  }
  return env;
}

export function sessionCookieName() {
  return appCookieName("session");
}

export function seedScale() {
  const scale = (process.env.HIROAPP_SEED_SCALE ?? "demo").trim();
  if (scale === "full") {
    return { users: 450, positions: 550, applications: 255, departments: 20 };
  }
  return { users: 40, positions: 50, applications: 30, departments: 8 };
}

export function frontendMode() {
  return readFrontendMode();
}
