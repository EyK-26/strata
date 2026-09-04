import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import { CORE_CONFIG_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { APP_PORT_CONFIG_KEY, DATABASE_URL_CONFIG_KEY, loadEnv } from "../config.ts";

export const configProvider: ServiceProvider = {
  name: "hiroapp.config",
  register({ container, config }) {
    const env = loadEnv();
    container.set(CORE_CONFIG_TOKEN, config);
    config.set(DATABASE_URL_CONFIG_KEY, env.DATABASE_URL);
    config.set(APP_PORT_CONFIG_KEY, Number(env.PORT ?? 3000));
    config.set("cache.driver", env.CACHE_DRIVER ?? "array");
    config.set("cache.ttlMs", 3_600_000);
    config.set("cache.maxEntries", 100);
    config.set("cache.redisUrl", process.env.REDIS_URL ?? "");
    config.set("app.name", env.APP_NAME ?? "HiroApp");
    config.set("app.env", env.APP_ENV ?? "local");
    config.set("app.url", env.APP_URL ?? "http://localhost:3000");
    config.set("queue.driver", env.QUEUE_DRIVER ?? "sync");
  },
};
